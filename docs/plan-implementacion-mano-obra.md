# Plan de implementación — Mano de Obra con IA (Estructura de costos)

**Fecha:** 2026-07-11 · **Alcance:** exclusivamente la etapa de Mano de Obra de ASEOCOLBA.
**Fuera de alcance (documentado para fase posterior):** EPP, dotación, exámenes, maquinaria, equipos, costos administrativos, AIU, sincronización entre pestañas, relaciones cargo–EPP/dotación/exámenes, catálogos en BD (Fase A de catálogos queda aplazada; en esta etapa la normalización de cargos y ciudades se hace con diccionarios en código, migrables a tablas después).
**Estado:** PLAN — nada implementado. Requiere autorización para ejecutar.

---

## 1. Estado actual (evidencia del diagnóstico)

- La UI de Mano de Obra vive en `ModuloEstructuraCostos` ([page.tsx:5273](../src/app/page.tsx)) — **un solo cargo**, 8 inputs de horas digitados a mano, `jornadaDesc`/`nSedes` decorativos.
- "Analizar con IA" (`analizarTurnoIA`, :5800) llama a `/api/costos/analizar-mano-obra` (Claude Haiku → respaldo Gemini → Zod → motor de horas → persistencia), pero **"Aplicar sugerencias" copia solo el primer cargo del primer escenario** (:5874) y solo las horas.
- El **motor de horas** ([motor-mano-obra.ts](../src/lib/costos-mano-obra/motor-mano-obra.ts)) ya soporta: cruce de medianoche, segmentación por día calendario, festivos reales desde BD, descansos (política por defecto), horas netas vs brutas, FTE y turnante. **No calcula dinero.**
- El **cálculo monetario** está en el frontend con parámetros quemados y bases divergentes de la práctica corporativa (diagnóstico §5; matriz de validación).
- No hay ciudad, ni multi-turno editable, ni estados borrador/listo/confirmado.

## 2. Flujo objetivo (obligatorio)

```
Requisito operativo (texto libre)
  → extracción con Claude (solo estructura, sin dinero, sin inventar)
  → validación Zod (ZExtraccionMOv2)
  → normalización backend (cargo, ciudad, cruces de medianoche)
  → PANEL DE REVISIÓN (usuario corrige/confirma; preguntas pendientes inline)
  → confirmación del usuario (multi-cargo completo)
  → motor determinístico de horas (motor-mano-obra.ts extendido)
  → motor financiero (NUEVO, backend, reglas corporativas confirmadas)
  → resumen de Mano de Obra (por trabajador, por cargo, total MO)
```

## 3. Modelo de datos

Estructura por **escenarios → cargos → turnos**, según lo definido (ajustada a los tipos existentes del proyecto):

```ts
// src/lib/costos-mano-obra/tipos-mo-v2.ts (NUEVO)
export interface TurnoMOv2 {
  diasSemana: ('L'|'M'|'X'|'J'|'V'|'S'|'D')[];
  horaInicio: string | null;          // "HH:MM"
  horaFin: string | null;
  descansoMinutos: number | null;     // null = no mencionado (no inventar)
  descansoRemunerado: boolean | null;
  domingosMes: number | null;         // null = no mencionado
  festivosIncluidos: boolean | null;
  cantidadTrabajadores: number | null; // por turno
  sede: string | null;
  cruzaMedianoche: boolean;           // recalculado por código
  textoOriginal: string;
}

export type ActividadEspecial =
  | 'trabajo_en_alturas' | 'manipulacion_alimentos' | 'exposicion_quimicos'
  | 'conduccion' | 'trabajo_nocturno' | 'otra';

export interface CargoMOv2 {
  cargoDetectado: string;
  cargoNormalizado: string | null;    // vía diccionario en código (sin BD en esta etapa)
  cantidadTrabajadores: number | null;
  ciudad: string;                      // detectada; '' si no mencionada → pregunta
  ciudadNormalizada: string | null;
  numeroSedes: number | null;
  salarioBaseMensual: number | null;   // SOLO si aparece en el requisito
  auxilioTransporte: 'aplica'|'no_aplica'|'proporcional'|'pendiente';
  arl: { clase: 'I'|'II'|'III'|'IV'|'V'|null; fuente: 'requisito'|'pendiente' };
  turnos: TurnoMOv2[];
  actividadesEspeciales: ActividadEspecial[];
  preguntasPendientes: string[];
  nivelConfianza: 'alto'|'medio'|'bajo';
}

export interface ExtraccionMOv2 {
  escenarios: { nombre: string; cargos: CargoMOv2[] }[];
}
```

**Estados del costeo** (definidos ahora, aplicados en la UI de esta etapa):

| Estado | Regla |
|---|---|
| `borrador` | Se puede guardar con cualquier campo pendiente (autosave localStorage se mantiene + guardado explícito) |
| `listo_para_calculo` | Requiere confirmados: cargo, cantidad, programación mínima (≥1 turno con días+horas), salario, ciudad y ARL |
| `confirmado` | Además: cero preguntas **críticas** pendientes (salario, ciudad, cantidad, domingos si el turno los insinúa) |

El cálculo financiero corre cuando el cargo está `listo_para_calculo`; antes se muestra "preliminar" sin números monetarios definitivos. **No se bloquea el guardado** en ningún estado.

## 4. Esquema Zod

`ZExtraccionMOv2` en `src/lib/costos-mano-obra/schema-mo-v2.ts`: espejo del modelo §3 con:
- `ZHora = /^\d{1,2}:\d{2}$/ | null`, días enum, `descansoMinutos ≤ 240`, `cantidadTrabajadores` entero positivo o null;
- `auxilioTransporte` enum de 4 estados; `arl.fuente` enum `requisito|pendiente` (la IA no puede decir "catálogo": no hay catálogo aún);
- `actividadesEspeciales` enum cerrado; `preguntasPendientes: string[]`;
- sin campos `confirmado` en la salida IA — la confirmación vive en el estado de la UI, no en la extracción;
- `.strict()` en todos los objetos para rechazar campos alucinados.

## 5. Cambios de UI (solo sección Mano de Obra)

1. **Lista de cargos** (nuevo estado `cargosMO: CargoUI[]` reemplaza al cargo único): agregar/duplicar/eliminar cargo; cada cargo con sus Datos del puesto y su Programación.
2. **Datos del puesto** por cargo: cargo, ciudad (nuevo), sedes (funcional, por turno), cantidad, salario (con badge de fuente y confirmación), auxilio (4 estados), ARL por cargo.
3. **Programación del servicio** (reemplaza el campo libre "Jornada" y la digitación manual de horas): tabla de turnos con días, inicio, fin, descanso (min + remunerado), horas de permanencia y efectivas (calculadas, solo lectura), trabajadores por turno, sede, domingos/festivos, indicador de cruce de medianoche. Acciones: agregar, editar, duplicar, eliminar.
4. Los 8 valores de horas/recargos pasan a ser **salida del motor** (visibles, con override manual marcado como "manual").
5. Cinta de estado del costeo (borrador / listo / confirmado) + contador de preguntas pendientes.
6. Las demás pestañas (EPP, exámenes, maquinaria, admin, resumen, registros) **no se tocan**; el total de MO que consumen (`costoMO`) se alimenta del nuevo resumen.

## 6. Panel de revisión (post-análisis IA)

Por cargo (acordeón multi-cargo, nunca solo el primero): cargo, ciudad, sedes, trabajadores, días, horarios, descanso, salario, auxilio, ARL, actividades especiales, preguntas pendientes, confianza. Cada fila: valor detectado + fuente (`requisito`/`pendiente`) + acción Confirmar/Corregir. Preguntas pendientes respondibles inline (la respuesta llena el campo y lo confirma). Botón "Aplicar análisis" habilitado siempre — aplica **todo lo confirmado de todos los cargos** y deja lo pendiente marcado; nada incompleto entra al cálculo.

## 7. Motor de cálculo de horas (determinístico, sin IA)

Base: `motor-mano-obra.ts` existente (ya cubre 1, 2, 5–14 de la lista requerida). Extensiones:
- **horas de permanencia vs efectivas** expuestas por turno (hoy: brutas/netas — renombrar en la salida);
- `domingosMes`/`festivosIncluidos` por turno (hoy el festivo se deriva de BD; se agrega el override del requisito);
- horas mensuales con `factorMensual` vigente; horarios distintos por día ya soportados (turnos con subconjuntos de días);
- salida por cargo: los 8 buckets de horas + FTE + turnante + horas semanales/mensuales.
Sin cambios a las fórmulas de horas ya probadas (los 3 scripts `test-*.ts` del motor se renombran a `*.test.ts` para entrar a CI — sin tocar su contenido).

## 8. Motor financiero (NUEVO — backend)

`src/lib/costos-mano-obra/liquidador-mo.ts` — puro, testeable, parámetros inyectados (desde `ParametrosLaborales` + banderas):

**Reglas confirmadas (se implementan):**
- divisor hora **220** → `valorHora = salarioMes/220`;
- salario proporcional `(salario/44)×horasSemanales` con 44 leído de BD (`horasMaxSemanaActual/Posterior` por fecha);
- devengado = básico proporcional + recargos + auxilio;
- **IBC = básico proporcional + recargos (sin auxilio)**;
- vacaciones = **5% × IBC** (auxilio excluido) — parámetro `pctVacacionesCorporativo` con la descripción corporativa definida;
- pensión 12% × IBC; ARL %clase × IBC;
- caja = 4% × (IBC + vacaciones);
- cesantías 8.33%, prima 8.33%, intereses 1% × (básico prop. + recargos + auxilio);
- auxilio: regla `aplica/no_aplica/proporcional` (proporcional por días: `aux/30 × díasSemana × 4.333`, patrón de los Excel).

**Reglas pendientes (banderas, comportamiento vigente por defecto, sin afirmar validación):**
- `modoRecargoNocturno: 'hora_completa' (vigente, 1.35) | 'solo_recargo' (0.35)` — pendiente P2;
- `factoresDominicales: 'vigentes' (1.80/2.05/2.15/2.55) | 'excel' (1.75/2.00/2.10/2.50)` — pendiente P1;
- `exoneracionParafiscal: false` por defecto (salud 8.5%, SENA 2%, ICBF 3% sobre IBC) — pendiente P3;
- Sin AIU ni impuestos en esta etapa.

Salidas: devengado, IBC, prestaciones, seguridad social, parafiscales, costo por trabajador, costo por cargo (×cantidad), **total Mano de Obra** (Σ cargos). Nota de transparencia en la respuesta: qué banderas están en modo "pendiente de validación".

## 9–11. Multi-cargo, multi-turno, multi-sede

- **Multi-cargo:** array en UI y en cálculo; "Aplicar análisis" crea N cargos con sus turnos (regla explícita: no usar solo `escenarios[0].cargos[0]`). Escenarios múltiples de la IA se presentan como selector de escenario antes de aplicar (se aplica uno; los demás quedan visibles en el panel).
- **Multi-turno:** cada cargo tiene `turnos[]` editables (§5.3); el motor de horas ya los soporta.
- **Multi-sede:** `sede` por turno (texto en esta etapa, sin catálogo); `numeroSedes` se calcula de las sedes distintas y deja de ser decorativo. Reparto de trabajadores por sede vía `cantidadTrabajadores` por turno.

## 12. Manejo de preguntas pendientes

- Generadas por la IA (léxico cerrado: ciudad, cantidad, descanso/duración/remunerado, domingos/festivos, salario, horas de "medio tiempo") + generadas por el backend (inconsistencias del motor: jornada declarada ≠ calculada, FTE > cantidad).
- Clasificación `critica | informativa`: las críticas bloquean el paso a `confirmado` (no el guardado ni el borrador).
- Persisten en el estado del costeo y se muestran en la cinta; responder una pregunta actualiza el campo asociado.

## 13. Archivos que se modificarán

| Archivo | Cambio | Nuevo |
|---|---|---|
| `src/lib/costos-mano-obra/tipos-mo-v2.ts` | Modelo §3 | ✅ |
| `src/lib/costos-mano-obra/schema-mo-v2.ts` | Zod §4 | ✅ |
| `src/lib/costos-mano-obra/normalizacion-mo.ts` | Diccionarios en código: cargos ASEOCOLBA (seed de los 48 Excel, sin vigilancia) + ciudades principales con variantes (B/quilla, Bogotá D.C., Cartagena de Indias…) | ✅ |
| `src/lib/costos-mano-obra/liquidador-mo.ts` | Motor financiero §8 | ✅ |
| `prompt-gemini.ts` → `prompt-mo.ts` | Prompt v2: campos §3, regla de no invención, preguntas léxico cerrado | renombrado |
| `gemini-extractor.ts` | Validar `ZExtraccionMOv2`; post-proceso (normalización, cruzaMedianoche) | edit |
| `motor-mano-obra.ts` | Extensiones §7 (permanencia/efectivas, domingosMes/festivos override) — sin tocar fórmulas de horas | edit |
| `/api/costos/analizar-mano-obra/route.ts` | Orquestar v2 + liquidación financiera server-side | edit |
| `src/app/page.tsx` (solo bloque MO) + nuevos componentes `src/components/costos/estructura/` (`ProgramacionServicio.tsx`, `PanelRevisionIA.tsx`, `ListaCargosMO.tsx`, `ResumenMO.tsx`) | UI §5–6; el resto de pestañas intactas | edit/✅ |
| `ParametrosLaborales` (schema) | **Solo si autorizas en la ejecución**: campo `pctVacacionesCorporativo` (5%, descripción corporativa) + banderas pendientes; alternativa sin migración: constantes en `liquidador-mo.ts` con TODO documentado | pendiente de tu decisión |
| Tests | ver §14 | ✅ |

Sin cambios en: pestañas EPP/exámenes/maquinaria/admin/resumen/registros, endpoints existentes (no se elimina ninguno), TRM, Gemini en otros módulos.

## 14. Pruebas

1. **Extractor v2** (mocks Claude/Gemini): ejemplos 1 y 2 del enunciado como fixtures + 6–8 requisitos reales de los 48 Excel (Vivance, Alto Prado 12h, Lugano…); regla de no invención (requisito sin ciudad → pregunta, sin descanso → null); campos alucinados rechazados por `.strict()`.
2. **Normalización**: alias de cargos (tildes, género, abreviaturas), ciudades variantes, exclusión de términos de vigilancia.
3. **Motor de horas**: cruce de medianoche (19:00–06:00), L-V con almuerzo 60 min (ejemplo 1 → 40h efectivas), domingos, festivos, multi-turno, jornada parcial; los `test-*.ts` existentes renombrados a `*.test.ts` (entran a CI: ~120 asserts ya escritos).
4. **Liquidador financiero**: una prueba por regla confirmada — en particular **vacaciones = 5% × (básico proporcional + extras + recargos), auxilio excluido**; caja sobre IBC+vacaciones; cesantías/prima/int con auxilio; divisor 220; proporcionalidad 44h; banderas pendientes en ambos modos; casos límite: SMMLV, salario superior, sin auxilio, ARL I–V, valores nulos, costo nunca negativo.
5. **Estados**: borrador guardable incompleto; `listo_para_calculo` exige los 6 confirmados; pregunta crítica bloquea `confirmado`.
6. **Aplicar análisis**: multi-cargo completo (2 escenarios × 2 cargos → 2 cargos aplicados del escenario elegido, no 1).

## 15. Riesgos

| Riesgo | Mitigación |
|---|---|
| Las bases confirmadas (IBC, vacaciones 5% con recargos, caja) **cambian los resultados** vs costeos históricos del módulo | Nota visible "motor v2" + registro del snapshot con versión de motor; comparativo en pruebas |
| Reglas pendientes P1/P2 con default "vigente" pueden sobre-costear nocturnos/dominicales | Banderas + advertencia en la respuesta del liquidador ("pendiente de validación Nómina") |
| `page.tsx` monolítico: editar el bloque MO es propenso a romper otras pestañas | Componentes nuevos aparte; typecheck+build+tests en cada etapa |
| IA hoy sin credenciales (Anthropic sin clave, Gemini sin créditos) | El flujo manual (crear cargos/turnos a mano) debe funcionar 100% sin IA; la IA es acelerador, no requisito |
| Diccionarios de cargos/ciudades en código quedarán obsoletos | Documentado: migran a tablas en la fase de catálogos aplazada |
| Doble motor transitorio (cálculo viejo del frontend vs liquidador nuevo) | Feature flag: el resumen MO usa liquidador v2; el cálculo viejo se retira al validar paridad de casos de prueba |

## 16. Orden de implementación propuesto

| Etapa | Contenido | Depende de |
|---|---|---|
| **MO-1** | Tipos + Zod + normalización en código + prompt v2 + extractor v2 + tests | — |
| **MO-2** | Liquidador financiero + parámetros/banderas + tests de reglas confirmadas | decisión tuya sobre migración `pctVacacionesCorporativo` |
| **MO-3** | Extensiones del motor de horas + renombrar tests a CI | MO-1 |
| **MO-4** | Ruta `analizar-mano-obra` v2 (extracción→normalización→horas→liquidación) | MO-1..3 |
| **MO-5** | UI: lista de cargos, Programación del servicio, panel de revisión, estados, resumen MO | MO-4 |
| **MO-6** | Aplicar análisis multi-cargo + retiro del cálculo viejo tras paridad + validación final (tests, typecheck, lint, build) | MO-5 |

Cada etapa termina con la suite completa en verde y sin tocar las áreas excluidas.

---
*La Fase A de catálogos (BD de cargos/ciudades, perfiles ocupacionales, relación cargo–exámenes, tarifas por ciudad, endpoints `/api/costos/catalogos/*`) queda **aplazada** — su diseño está en `docs/diseno-funcional-mano-obra-ia.md` §6/§9 y se retomará después de cerrar Mano de Obra.*
