# Diagnóstico técnico — Cálculo de horas, sobretiempos y valor de Mano de Obra

> **Estado: documento histórico.**
> Este diagnóstico describe motores y bloques de cálculo que fueron
> retirados durante la consolidación del método comercial de Mano de
> Obra. Se conserva únicamente para trazabilidad técnica.

**Alcance:** exclusivamente diagnóstico. Ningún archivo de producción fue modificado para este informe.
**Caso reproducido:** Cargo "Operario de aseo", código de horario "2" (08:00-12:30 Y 14:00-18:30), salario $1.750.905, plazo 21/07/2026–26/07/2026.
**Método:** lectura de código fuente + script de reproducción temporal (`repro-caso.mjs`, ejecutado y luego eliminado) que reutiliza las funciones puras de `motor-mano-obra.ts` y replica línea a línea las fórmulas inline de `page.tsx`.

---

## 1. Resumen ejecutivo

El "Total: $2.152.816" que muestra la pantalla **se reprodujo exactamente**, cifra por cifra, ejecutando la lógica real del código. No hay divergencia entre lo que el código calcula y lo que la pantalla muestra — el motor de cálculo (fórmulas, factores, redondeos) es internamente consistente y coincide con lo mostrado.

Las dos "inconsistencias" que se ven en pantalla (hora final 18:00 en vez de 18:30, receso 60 min en vez de 90) **no son errores de cálculo ni de redondeo**: son el resultado de que el sistema usa datos **distintos** de los que aparecen en el texto libre del horario:

- La hora final real usada (`horaFin`) viene de un campo separado del catálogo de horarios (`HorarioCatalogo.horaFin`), **independiente** del texto descriptivo `"08:00-12:30 Y 14:00-18:30"`. Ese campo quedó guardado como `18:00`, no `18:30`, en el registro del código "2".
- El "Descanso" es un campo **100% manual** que el usuario tecleó como "1" (hora). El sistema **no** analiza el texto del horario para detectar que hay dos bloques con una brecha de 90 minutos entre las 12:30 y las 14:00.

Por pura coincidencia numérica, `10h brutas − 1h receso = 9h netas` da el mismo resultado que `10.5h brutas − 1.5h receso = 9h netas`, así que en este caso específico el total de horas netas por día no cambia y el error queda oculto. **Esto no seguirá siendo cierto con otros horarios** (ver §16).

No se encontró doble pago de horas dominicales, ni mezcla real de divisores (44 vs 220): lo que parecía una "mezcla" es una identidad algebraica (`220×42/44 = 210`), no dos fórmulas distintas.

El hallazgo funcional más relevante (no es un bug de aritmética, es una decisión de diseño no documentada en la UI) es que el "Subtotal" y el "Aux. transporte" son valores **mensuales completos** (prorrateados solo por horas semanales, nunca por los días reales del plazo), mientras que el "Sobretiempo" sí se calcula **exactamente sobre los 6 días** del plazo de ejecución. El "Total" resultante mezcla una base mensual con un sobretiempo del plazo — ver §13 y §15.

---

## 2. Resultado de la reproducción

Script ejecutado (`node repro-caso.mjs`), salida completa:

```
=== 3. Horas brutas/netas del turno ===
{ bruta: 10, recesoMin: 60, neta: 9, nocBruta: 0, fraccionNoc: 0 }

=== 5. Totales por tipo de hora ===
Ordinarias adicionales: 0.00   Recargo nocturno: 0.0   Extra diurna: 10.0   Extra nocturna: 0.0
Dominicales/festivas: 7.0      Rec. noct-fest: 0.0     Extra festiva: 2.0  Extra festiva noct: 0.0

=== 6. Valor hora / salario básico ===
valorHora = round(1750905/220) = 7959   (sin redondear: 7958.659090909091)
salarioBasico = round((42/44)×1750905) = 1671318

=== 7. Sobretiempo por concepto ===
Extra diurna:        10h × 7959 × 1.25 = 99488
Dominical ordinaria:  7h × 7959 × 1.80 = 100283
Extra dominical:      2h × 7959 × 2.05 = 32632
totalRecargos = 232403

=== 8. Auxilio de transporte ===
SMLMV=1750905, tope 2×SMLMV=3501810, sb=1750905 ≤ tope → aplica → 249095

=== 9. Totales finales ===
subtotalManoObra: 1671318
sobretiempoManoObra: 232403
auxTransporteManoObra: 249095
totalManoObra: 2152816
```

**Coincide exactamente** con lo reportado en pantalla: $1.671.318 / $232.403 / $249.095 / $2.152.816.

---

## 3. Flujo completo del dato

| # | Etapa | Archivo | Función/bloque |
|---|---|---|---|
| 1 | Selección del horario en el catálogo | `src/app/page.tsx` | Modal "Horario · Turnos · Jornadas", `horariosCatalogo.map(...)`, `onClick={()=>aplicarHorarioCatalogo(h,esLinea1,patch)}` (línea ~6986) |
| 2 | Copia de horaInicio/horaFin al formulario | `src/app/page.tsx:5490-5517` | `aplicarHorarioCatalogo()` |
| 3 | Estado local del cargo (línea 1) | `src/app/page.tsx:5403-5406` | `horaInicioProceso`, `horaFinProceso`, `recesoProceso`, `horaRecesoProceso` (useState) |
| 4 | Entrada manual de "Descanso (horas)" | `src/app/page.tsx` (`ModalCargo`, campo "Descanso (horas)") | `onChange={e=>{const min=String(Math.round((Number(e.target.value)||0)*60));...setRecesoProceso(min)}}` |
| 5 | Días trabajados (Plazo de ejecución) | `src/app/page.tsx:5692-5706` | `rangoFechas(ini,fin)` → `diasSeleccionados` |
| 6 | Motor de horas puro (brutas/netas/nocturnas) | `src/lib/costos-mano-obra/motor-mano-obra.ts:206-334` | `parseHora`, `calcularHorasBrutas`, `calcularHorasNetas`, `contarHorasNocturnas` |
| 7 | Clasificación día a día + jornada legal | `src/app/page.tsx:5818-5927` | `jornadaLegalMinParaFecha()` + `useEffect(...)` (línea 5883) |
| 8 | Valor hora / salario proporcional | `src/app/page.tsx:5939-5941` | `valorHora`, `salarioBasico` |
| 9 | Factores de recargo y monto de sobretiempo | `src/app/page.tsx:5942-5953` | `RECARGOS_CFG`, `recargosTotales`, `totalRecargos` |
| 10 | Auxilio de transporte (regla ≤2 SMLMV) | `src/app/page.tsx:5935-5938` (aprox., `atPara`) | `atPara(sb)` |
| 11 | Subtotal / Sobretiempo / Total por cargo | `src/app/page.tsx` (`detalleLineas`, `subtotalManoObra`, `sobretiempoManoObra`, `auxTransporteManoObra`, `totalManoObra`) | multiplicación por `headcount` |
| 12 | Persistencia | `src/app/api/costos-estructura/route.ts` | `POST` guarda `datos` como JSON opaco (no vuelve a calcular nada server-side) |
| 13 | Consulta/edición posterior | `src/app/page.tsx` (`verDetallesCosteo`, `aplicarDatosGuardados`) | reaplica los mismos campos, mismo motor de cálculo del frontend |
| 14 | Presentación "Detalle De Mano De Obra" | `src/app/page.tsx` (tabla `detalleLineas.map`, bloque "Sobretiempo") | render puro de los valores ya calculados |

**No existe backend de cálculo de mano de obra en este flujo.** Todo el cómputo (horas, factores, dinero) ocurre en el cliente (`page.tsx`), usando solo unas funciones puras compartidas desde `motor-mano-obra.ts` para la parte de horas brutas/netas/nocturnas. El endpoint `/api/costos-estructura` solo persiste el JSON ya calculado; no recalcula ni valida nada.

Existe un motor financiero nuevo, más riguroso (`src/lib/costos-mano-obra/liquidador-mo.ts`, con tests en `liquidador-mo.test.ts`), documentado en `docs/plan-implementacion-mano-obra.md`, pero **no está conectado a la UI todavía** (etapas MO-4/MO-5/MO-6 del plan, sin ejecutar). El caso reproducido usa exclusivamente el motor viejo inline de `page.tsx`.

---

## 4. Tabla de valores ingresados

| Campo | Valor mostrado en el formulario |
|---|---|
| Cargo | Operario de aseo |
| Cantidad de operarios | 1 |
| Salario | $1.750.905 |
| Horario (texto libre) | 08:00-12:30 Y 14:00-18:30 |
| Código del horario | 2 |
| Horas semanales | 42 |
| Plazo de ejecución | 21/07/2026 – 26/07/2026 (6 días) |
| Descanso | 1 (hora) |
| Hora de receso | 12:30 p.m. |

## 5. Tabla de valores interpretados por el sistema

| Campo interno | Valor realmente usado | Fuente |
|---|---|---|
| `horaInicioProceso` | `"08:00"` | `HorarioCatalogo.horaInicio` del registro código "2" |
| `horaFinProceso` | `"18:00"` | `HorarioCatalogo.horaFin` del **mismo** registro — campo independiente del texto `"08:00-12:30 Y 14:00-18:30"` |
| `recesoProceso` | `"60"` (minutos) | Tecleado manualmente por el usuario en "Descanso (horas)" = 1h |
| `horaRecesoProceso` | `"12:30"` | Tecleado manualmente, **no se usa en ningún cálculo** (campo puramente informativo) |
| `nHoras` (horas contratadas/día) | `""` → `0` | Nunca se llenó en este caso |
| `diasSeleccionados` | 6 fechas (21→26 jul 2026) | `rangoFechas()` a partir del Plazo de ejecución |
| `hsSem` | `42` | Directo de "Horas semanales" |

## 6. Tabla día por día

| Fecha | Día | H. inicial usada | Receso usado | H. final usada | Bruta | Neta | Jornada legal | Ordinaria | Extra |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 2026-07-21 | Martes | 08:00 | 60 min | 18:00 | 10.0h | 9.0h | 7.0h | 7.0 | 2.0 |
| 2026-07-22 | Miércoles | 08:00 | 60 min | 18:00 | 10.0h | 9.0h | 7.0h | 7.0 | 2.0 |
| 2026-07-23 | Jueves | 08:00 | 60 min | 18:00 | 10.0h | 9.0h | 7.0h | 7.0 | 2.0 |
| 2026-07-24 | Viernes | 08:00 | 60 min | 18:00 | 10.0h | 9.0h | 7.0h | 7.0 | 2.0 |
| 2026-07-25 | Sábado | 08:00 | 60 min | 18:00 | 10.0h | 9.0h | 7.0h | 7.0 | 2.0 |
| 2026-07-26 | **Domingo** | 08:00 | 60 min | 18:00 | 10.0h | 9.0h | 7.0h | 7.0 (dominical) | 2.0 (extra dominical) |

**Acumulado:** 5 días hábiles × 2h extra = **10h extra diurna hábil**. 1 domingo × 7h = **7h dominical ordinaria**; 1 domingo × 2h = **2h extra dominical**. Coincide exactamente con lo mostrado (10 / 7 / 2).

**Nocturno:** el turno 08:00→18:00 no toca la ventana nocturna (19:00–06:00), por eso `fraccionNoc=0` y todos los buckets nocturnos quedan en 0 — correcto para este horario específico.

**No hay ninguna "regla de 7h ordinarias + 2h extra por exceso semanal de 42h".** La jornada legal diaria (7h desde el 15/jul/2026, `jornadaLegalMinParaFecha`) se aplica **por día**, no por semana. Las "42 horas semanales" del formulario **no participan en absoluto** en la clasificación ordinaria/extra: solo se usan para prorratear el salario básico (`salarioBasico = (42/44)×salario`). El límite de 7h/día es fijo y viene de la fecha (calendario legal), no del campo "Horas semanales" del cargo.

---

## 7. Fórmulas actuales encontradas

```
valorHora        = round(salario / 220)
salarioBasico    = round((horasSemanales / 44) × salario)
horasBrutas/día   = horaFin − horaInicio  (o 24 − horaInicio + horaFin si cruza medianoche)
horasNetas/día    = horasBrutas − receso(min)/60
jornadaLegal/día  = 420 min (7h) si fecha ≥ 2026-07-15, si no 440 min (7h20)
ordinaria/día     = min(horasNetas, jornadaLegal)
extra/día         = max(0, horasNetas − jornadaLegal)
  → si domingo: acumula en "dominical ordinaria" / "extra dominical"
  → si hábil:   acumula en "hábil ordinaria(extra sliver)" / "extra diurna|nocturna" según fracciónNoc

recargoConcepto  = round(valorHora × factor × horasDelConcepto)
Sobretiempo      = Σ recargoConcepto (8 conceptos)

auxTransporte    = auxValor (constante, hoy 249095) SI salario ≤ 2×SMLMV, si no 0
                   (regla agregada en esta sesión; NO se prorratea por días del plazo)

Subtotal (por cargo) = salarioBasico × headcount
Sobretiempo (por cargo) = Σrecargos × headcount
Total (por cargo)  = Subtotal + Sobretiempo + auxTransporte×headcount
```

Factores de recargo (constante `RECARGOS_CFG`, `page.tsx:5942-5951`):

| Concepto | Factor |
|---|---:|
| H/Ordinaria sobre N.° horas contratadas | 1.00 |
| Recargo nocturno hábil | 1.35 |
| Extra diurna hábil | 1.25 |
| Extra nocturna hábil | 1.75 |
| Ordinaria dominical/festiva diurna | 1.80 |
| Ordinaria dominical/festiva nocturna | 2.15 |
| Extra dominical/festiva diurna | 2.05 |
| Extra dominical/festiva nocturna | 2.55 |

Estos mismos 8 factores están **duplicados** en `src/lib/costos-mano-obra/liquidador-mo.ts:58-62` bajo el nombre `FACTORES_DOMINICALES.vigentes`, con una segunda variante `'excel'` (1.75/2.10/2.00/2.50) marcada explícitamente como "sin confirmar con Nómina — NO usar sin autorización". El motor viejo (`page.tsx`) usa siempre los factores "vigentes" — no tiene bandera ni forma de cambiar de esquema.

---

## 8–10. Archivos, funciones y variables involucradas

**Archivos:**
- `src/app/page.tsx` — único lugar donde vive el cálculo monetario y de horas de línea 1/extra/turnantes (motor viejo, duplicado 2 veces: línea 1 vía `useEffect` en 5883, y líneas extra/turnantes vía `calcularHorasYCostoLinea` ~5828).
- `src/lib/costos-mano-obra/motor-mano-obra.ts` — funciones puras de horas (brutas/netas/nocturnas), usadas por ambas copias del motor viejo.
- `src/app/api/horarios/route.ts` — CRUD del catálogo de horarios (`horaInicio`/`horaFin` como columnas independientes del texto `horario`).
- `prisma/schema.prisma` (`model HorarioCatalogo`) — define `horario String`, `horaInicio String?`, `horaFin String?` como campos separados sin ninguna restricción de consistencia entre ellos.
- `src/app/api/costos-estructura/route.ts` — persistencia, sin recálculo.
- `src/lib/costos-mano-obra/liquidador-mo.ts` — motor financiero nuevo, NO conectado todavía.
- `docs/plan-implementacion-mano-obra.md` — plan documentado de migración al motor nuevo.

**Funciones clave:** `aplicarHorarioCatalogo` (5490), `rangoFechas` (5692), `jornadaLegalMinParaFecha` (5818), el `useEffect` de línea 1 (5883-5927), `calcularHorasYCostoLinea` (línea extra/turnante, ~5828), `parseHora`/`calcularHorasBrutas`/`calcularHorasNetas`/`contarHorasNocturnas` (`motor-mano-obra.ts`).

**Variables clave:** `horaInicioProceso`, `horaFinProceso`, `recesoProceso`, `horaRecesoProceso` (sin uso en cálculo), `nHoras`, `diasSeleccionados`, `hsSem`, `sb`, `valorHora`, `salarioBasico`, `RECARGOS_CFG`, `recargosTotales`, `totalRecargos`, `SMLMV`, `AUX_TRANSP_LEGAL`, `atPara`.

## 11. Evidencia con ruta y línea — ya incluida inline en §3, §7 y abajo en la tabla de hallazgos.

## 12. Diferencias entre formulario, cálculo y tabla

No hay diferencia entre "cálculo" y "tabla mostrada": ambos son el mismo número, en el mismo `render`. La única diferencia real es entre **lo que el usuario ve en el campo "Horario" (texto libre)** y **lo que el sistema realmente usa (`horaInicio`/`horaFin`/`receso` de campos separados)**.

---

## 13. Causa raíz principal

**El campo de texto libre `"horario"` (ej. `"08:00-12:30 Y 14:00-18:30"`) y los campos estructurados `horaInicio`/`horaFin`/receso que alimentan el cálculo son independientes entre sí, y nada en el sistema los sincroniza ni los valida entre ellos.** El registro del catálogo con código "2" tiene el texto descriptivo correcto pero `horaFin="18:00"` (no `"18:30"`) guardado en el campo estructurado — probablemente un error de captura al crear el horario (el formulario "Crear horario" pide "H. Inicial"/"H. Final" como campos aparte del texto libre "Horario", sin derivarlos de él). El motor de cálculo usa exclusivamente los campos estructurados; el texto libre es puramente decorativo.

## 14. Causas secundarias

1. El campo "Descanso" es 100% manual: el sistema no analiza el texto del horario para detectar los bloques (`08:00-12:30` y `14:00-18:30`) ni calcular automáticamente el hueco de 90 minutos entre ellos.
2. El campo "Hora de receso" (`horaRecesoProceso`/`l.horaReceso`) se captura pero **no se usa en ningún cálculo** — es puramente informativo hoy.
3. El "Subtotal" (salario básico prorrateado) y el "Aux. transporte" son de alcance **mensual completo**, mientras que el "Sobretiempo" es del alcance **exacto del plazo de ejecución** (6 días). El "Total" combina ambos alcances sin advertirlo en la UI.
4. `SMLMV` y `AUX_TRANSP_LEGAL` están hardcodeados en `page.tsx` (líneas 5361-5362) sin tabla de vigencias — requieren edición manual de código cada año.
5. Los factores de recargo están duplicados entre `page.tsx` y `liquidador-mo.ts` sin garantía de que se mantengan sincronizados si cambian en uno y no en el otro.

## 15. Riesgos de cálculo

- **Alto:** cualquier horario cuyo texto libre no coincida con sus campos `horaInicio`/`horaFin` producirá horas mal clasificadas sin ningún aviso — el bug es silencioso.
- **Alto:** la brecha real entre bloques de un horario partido nunca se calcula automáticamente; si el usuario olvida ajustar "Descanso" manualmente (o lo deja en el valor por defecto de otro cargo copiado), el total de horas netas queda mal para cualquier horario donde el desajuste no sea una coincidencia como en este caso.
- **Medio:** mezclar una base salarial mensual completa con un sobretiempo acotado al plazo puede sub-costear o sobre-costear contratos cortos, dependiendo de qué se espera reportar (costo mensual recurrente vs. costo real del plazo). Hoy la UI no aclara cuál de los dos representa el "Total".
- **Medio:** SMLMV/Aux. transporte hardcodeados; en enero de cada año, si no se actualizan a mano, todos los costeos calculan mal el auxilio de transporte y el umbral de 2×SMLMV.
- **Bajo:** duplicación de fórmulas de recargo entre `page.tsx` y `liquidador-mo.ts` (riesgo de divergencia futura, no de error hoy).

## 16. Casos adicionales potencialmente afectados

Cualquier cargo cuyo horario tenga:
- Un texto libre con bloques (almuerzo/receso) cuya duración real (fin del primer bloque → inicio del segundo) **no coincida** con lo tecleado manualmente en "Descanso" — el error deja de cancelarse como en este caso y las horas extra/ordinarias quedarán mal repartidas.
- Un `horaFin` de catálogo divergente de su descripción textual (cualquier código de horario capturado igual que el "2").
- Turnos que sí cruzan la ventana nocturna (19:00–06:00): ahí el error en `bruta` (10h vs 10.5h reales) sí cambiaría `contarHorasNocturnas` y por tanto `fraccionNoc`, con impacto monetario visible (a diferencia de este caso, donde el turno es 100% diurno).
- Plazos de ejecución muy cortos (2-3 días) o muy largos (varios meses): el desacople entre "Subtotal mensual fijo" y "Sobretiempo del plazo real" se vuelve más notorio cuanto más se aleje el plazo de "un mes calendario".

## 17. Pruebas automatizadas faltantes

- Ninguna prueba hoy verifica que `HorarioCatalogo.horaInicio/horaFin` sean coherentes con el texto `horario` al guardarse.
- Ninguna prueba cubre el `useEffect` de línea 1 en `page.tsx` (la lógica vive inline en el componente, no en una función exportada testeable) — a diferencia de `motor-mano-obra.ts`, que sí tiene suite de tests.
- No hay prueba de regresión que reproduzca este caso exacto (Operario de aseo, 08:00-18:00, receso 60min, 6 días con 1 domingo) para blindar los números $1.671.318 / $232.403 / $249.095 / $2.152.816 ante futuros cambios.
- No hay prueba que verifique la identidad `220×(hsSem/44) = "210"` para dejar documentado que no es una casualidad sino una relación matemática esperada.

## 18. Propuesta de corrección mínima (no implementada — pendiente de tu aprobación)

1. Validar en el formulario "Crear horario" que, si el texto libre describe bloques con horas explícitas, `horaInicio`/`horaFin` se deriven de ese texto (o al menos advertir si no coinciden) — evita que un horario quede con datos internamente inconsistentes como el código "2".
2. Ofrecer auto-cálculo del "Descanso" a partir de los bloques del horario (cuando el texto tenga un formato reconocible tipo `HH:MM-HH:MM Y HH:MM-HH:MM`), dejando el campo manual como override, no como única fuente.
3. Aclarar en la UI (etiqueta o tooltip) si "Subtotal"/"Total" representan un valor mensual recurrente o el costo del plazo de ejecución exacto — y decidir explícitamente cuál debe ser.
4. Mover `SMLMV`/`AUX_TRANSP_LEGAL` a un lugar con vigencia por fecha (como ya existe para `jornadaLegalMinParaFecha`), en vez de constantes fijas.
5. Extraer la lógica del `useEffect` de línea 1 a una función pura testeable (mismo patrón que `calcularHorasYCostoLinea` para líneas extra), para poder cubrirla con tests de regresión.

## 19. Archivos que sería necesario modificar (si se aprueba la corrección)

`src/app/page.tsx` (formulario Crear horario, ModalCargo, extracción de la lógica de línea 1), `src/app/api/horarios/route.ts` (validación al guardar), posiblemente `prisma/schema.prisma` si se agrega algún campo de vigencia, y nuevos tests en `src/lib/costos-mano-obra/*.test.ts`.

## 20. Validaciones posteriores requeridas

Re-ejecutar este mismo caso reproducido tras cualquier cambio y confirmar que sigue dando $1.671.318 / $232.403 / $249.095 / $2.152.816 (si no cambia intencionalmente la regla), más `tsc --noEmit`, `eslint`, `vitest run` y `next build` como en el resto de esta sesión.

---

## Clasificación de los hallazgos

| Hallazgo | Clasificación |
|---|---|
| Hora final 18:00 vs 18:30 | Error de datos / Inconsistencia entre texto libre y campo estructurado del horario |
| Descanso 60 vs 90 min | Regla funcional ambigua (campo manual, sin derivación automática) |
| Hora de receso no usada en cálculo | Regla funcional ambigua / campo informativo sin efecto |
| Subtotal mensual + sobretiempo del plazo | Regla funcional ambigua (no documentada en UI) |
| Divisor 220 fijo, no ligado a horas semanales | Diseño esperado (no es error — 220 es un estándar de valor-hora, separado de la proporción 44h) |
| "210" en el subtotal | No es error — identidad algebraica (220×42/44=210) |
| Factores de recargo hardcodeados y duplicados en 2 motores | Error de vigencia (riesgo) / duplicación de lógica |
| **Base de aportes inconsistente dentro del mismo cargo (ver Apéndice §A1)** | **Error de cálculo — confirmado en código** |
| **Ausencia total de vigencia por fecha en factores dominicales/festivos (ver Apéndice §A2)** | **Error de vigencia — confirmado en código** |

---

# APÉNDICE CRÍTICO

**Motivo:** revisión de fondo de las conclusiones funcionales del diagnóstico original. Este apéndice **no se limita a la coherencia algebraica** de las fórmulas — evalúa si representan correctamente las reglas salariales, temporales y de vigencia. Ningún archivo de producción fue modificado.

Durante esta revisión se encontraron **dos hallazgos nuevos, no reportados en el diagnóstico original**, con evidencia directa en el código (no especulación): ver §A1 y §A2. Ambos cambian la lectura de "solo hay una diferencia de datos, el motor está bien" del informe original.

---

## A1. Salario mensual, divisor 220 y horas "210"

### ¿El campo "salario" representa salario mensual completo?
Sí. En todo el sistema (`page.tsx`, `liquidador-mo.ts`, la UI "Salario") se trata como salario mensual base completo, sin excepción de nomenclatura.

### ¿Por qué el subtotal ($1.671.318) es inferior al salario digitado ($1.750.905)?
Porque `salarioBasico = round((hsSem/44) × sb)` (`page.tsx:5941`) **reduce proporcionalmente** el salario cuando `hsSem` (horas semanales del cargo, aquí 42) es menor que `44` (jornada legal semanal de referencia). Es el mismo mecanismo que usaría un contrato de tiempo parcial: si trabajas menos que la jornada máxima legal, cobras proporcionalmente menos salario base.

### ¿Existe una regla funcional aprobada que autorice esa reducción?
**Sí — y es más contundente de lo que el diagnóstico original reconoció.** El motor financiero nuevo (`src/lib/costos-mano-obra/liquidador-mo.ts:182-185`) hace exactamente lo mismo, con un comentario explícito:
```ts
// Salario proporcional a la jornada individual del trabajador (regla confirmada §8)
const salarioBasicoProporcional = sb > 0
  ? round2((entrada.horasSemanalesPersona / params.jornadaMaxSemana) * sb)
  : 0;
```
Y `docs/plan-implementacion-mano-obra.md §8` la lista entre las **"Reglas confirmadas (se implementan)"**: *"salario proporcional `(salario/44)×horasSemanales`"*. Es decir: la proporción `hsSem/44` **es la regla corporativa validada**, no un error de programación aislado del motor viejo. El motor viejo (`page.tsx`) y el motor nuevo (`liquidador-mo.ts`) coinciden en esta fórmula específica.

**Pero hay un matiz que el diagnóstico original no distinguió y que sí es un problema real:** en `liquidador-mo.ts`, `horasSemanalesPersona` está documentado como *"jornada individual de ESTE trabajador"* — un dato que debería reflejar la jornada **realmente contratada por esa persona**. En `page.tsx`, en cambio, `horasSemanales` (que alimenta `hsSem`) se autocompleta **directamente desde `HorarioCatalogo.horasSemana`** del horario seleccionado (`aplicarHorarioCatalogo`, `page.tsx:5505`: `if(detalle.horasSemana)setHorasSemanales(String(detalle.horasSemana))`) — es decir, toma un atributo **descriptivo de la plantilla de horario**, no necesariamente la jornada individualmente pactada con el trabajador. Si el horario código "2" trae "42" como etiqueta nominal (quizás una aproximación de quien lo cargó al catálogo) y no como la jornada contractual real de este operario, el sistema reduce el salario base por un dato que no fue pensado para ese propósito.

**Conclusión de este punto:** la fórmula `(hsSem/44)×salario` **no es un error de cálculo** — está confirmada como regla corporativa en el plan y replicada intencionalmente en el motor nuevo. El riesgo real está en **de dónde sale `hsSem`** (plantilla de horario vs. jornada individual del trabajador), no en la fórmula misma.

### ¿El valor hora para 42h debería calcularse como salario/210?
**No.** El divisor `220` es una constante fija, **independiente de las horas semanales contratadas**, tanto en `page.tsx:5940` (`Math.round(sb/220)`) como en `liquidador-mo.ts:97` (`divisorHora: 220`) y `liquidador-mo.ts:180` (`sb / params.divisorHora`, sin ajustar por `horasSemanalesPersona`). **No existe ningún punto del código donde `210` sea un divisor real** — se confirmó por búsqueda exhaustiva (`grep -n "210"` sobre `page.tsx` y todo `costos-mano-obra/`) que el número `210` no aparece hardcodeado en ninguna parte. Solo emerge como resultado de la identidad `220 × 42/44 = 210`, es decir, **valorHora(=sb/220) × 210 y salarioBasico(=sb×42/44) son la misma cantidad expresada de dos formas**, nunca dos fórmulas independientes compitiendo.

### ¿Qué partes usan 220? ¿Qué partes usan "210"?
- `220`: `page.tsx:5940` (valorHora línea 1), `page.tsx` dentro de `calcularHorasYCostoLinea` (líneas extra/turnantes, mismo patrón `Math.round(salLinea/220)`), `liquidador-mo.ts:97,180`.
- `210` (o cualquier equivalente): **no existe en el código**. Es puramente un resultado aritmético derivado, no una entrada.

### ¿Existen constantes por vigencia?
No para el divisor `220` ni para `jornadaMaxSemana=44`: ambos son constantes fijas en ambos motores, sin tabla de vigencias ni dependencia de fecha. (Si legalmente el divisor de jornada cambiara en el futuro — como ya ocurrió con la jornada legal diaria, ver `jornadaLegalMinParaFecha`, que sí tiene vigencia por fecha — ninguno de los dos motores lo reflejaría hoy.)

### ¿Qué ocurre con nómina, prestaciones, seguridad social y parafiscales si el subtotal queda reducido? — HALLAZGO NUEVO, no reportado en el diagnóstico original

**Nada — y ese "nada" es en sí mismo el problema.** Se rastreó exactamente qué base usa cada aporte/prestación en el motor viejo (el que está en producción hoy) y **no todas usan el salario prorrateado**:

| Concepto | Línea | Base usada | ¿Prorrateada (hsSem/44)? |
|---|---|---|---|
| Subtotal / Devengado (`salarioBasico`) | `page.tsx:5941` | `(hsSem/44)×sb` | ✅ Sí |
| Cesantías / Prima / Int. cesantías (`basePrestLinea`) | `page.tsx:5984` | `salarioBasicoLinea + recargos + aux` | ✅ Sí (hereda de salarioBasico) |
| **Vacaciones** (`vacLinea`) | `page.tsx:5987` | `ln.salLinea × 5%` | ❌ **No — usa `sb` crudo** |
| **Salud / Pensión / ARL** (`saludLinea`/`pensionLinea`/`arlLinea`) | `page.tsx:5994-5996` | `ln.salLinea × %` | ❌ **No — usa `sb` crudo** |
| **Caja / ICBF / SENA** (`cajaLinea`/`icbfLinea`/`senaLinea`) | `page.tsx:6001-6003` | `pr.salLinea (+ pr.vacLinea) × %` | ❌ **No — usa `sb` crudo** |

`ln.salLinea` para la línea 1 se define en `page.tsx:5977` como `salLinea:sb` — el salario **sin prorratear**. Es decir: **el mismo cargo, en la misma pantalla, paga un "Devengado" reducido al 42/44 del salario, pero calcula Salud, Pensión, ARL, Caja, ICBF, SENA y Vacaciones sobre el 100% del salario sin reducir.** Esto es una inconsistencia interna real, verificable en el código, no una diferencia de interpretación.

Comparado con la regla confirmada del motor nuevo (`liquidador-mo.ts:207-215`), donde **todo** (vacaciones, pensión, ARL, caja, salud, sena, icbf) se calcula sobre el mismo `ibc = salarioBasicoProporcional + recargos` (es decir, **todo prorrateado de forma consistente**), el motor viejo diverge de su propia regla de referencia en 7 de 10 conceptos.

**Esto no necesariamente "cuesta más o menos" en un sentido simple — es una inconsistencia interna del modelo, y su efecto neto depende de cuál base es la "correcta" (ver Escenario A/B en §A3).**

---

## A2. Vigencia del recargo por día de descanso — HALLAZGO NUEVO, no reportado en el diagnóstico original

### ¿Dónde se define 1.80 / 2.05 / 0.80?
`page.tsx:5947` (`factor:1.80`, "Hora ordinaria dom./fest. diurna") y `page.tsx:5949` (`factor:2.05`, "Hora extra dom./fest. diurna"), dentro de la constante `RECARGOS_CFG`. El valor `0.80` (recargo dominical puro, sin la hora base) **no aparece como número independiente** en `page.tsx` — está implícito dentro de `1.80` (`1.00 + 0.80`). Sí aparece explícito como `recargo_festivo = 0.8` en el código de referencia legado que compartiste antes en esta sesión (`calcular_adicional`).

### ¿El factor depende de la fecha? — NO, y esto es el hallazgo central de este punto.

Se revisó `RECARGOS_CFG` completo (`page.tsx:5942-5951`) y la función que lo consume (`recargosTotales`, `page.tsx:5952`): **ningún factor recibe la fecha como parámetro.** Son 8 números fijos, aplicados igual sin importar si el `diasSeleccionados` corresponde a enero de 2025 o a diciembre de 2027. Compárese con `jornadaLegalMinParaFecha` (`page.tsx:5818-5821`), que sí implementa vigencia por fecha (440min hasta 14/jul/2026, 420min desde 15/jul/2026) — el patrón para tener vigencia por fecha **ya existe en el mismo archivo**, simplemente no se aplicó a los factores dominicales/festivos.

`liquidador-mo.ts` tampoco tiene vigencia por fecha para estos factores: `FACTORES_DOMINICALES.vigentes` (`liquidador-mo.ts:60`) es un objeto fijo `{1.80, 2.15, 2.05, 2.55}`, con una alternativa `'excel'` (`liquidador-mo.ts:61`) seleccionable solo por una bandera manual (`factoresDominicales: 'vigentes'|'excel'`), **no por fecha automáticamente**.

### Evidencia externa: el código de referencia legado que compartiste SÍ tiene vigencia por fecha

En el bloque `calcular_adicional` que pegaste anteriormente en esta sesión, el sistema de referencia (Midasoft/legado) contiene explícitamente:

```js
const primero_julio = new Date('2026-07-01');
...
if (fecha < primero_julio) {
  hora_extra_festiva_diurna = 2.05;
  hora_extra_festiva_noctura = 2.55;
  recargo_festivo = 0.8;
} else {
  hora_extra_festiva_diurna = 2.15;
  hora_extra_festiva_noctura = 2.65;
  recargo_festivo = 0.9;
}
```

Esto significa que, **según la fuente de referencia que tú mismo aportaste**, a partir del **1 de julio de 2026** el recargo festivo/dominical sube de `0.80` a `0.90` (es decir, la "hora ordinaria dominical" pasa de factor `1.80` a `1.90`), y "hora extra festiva diurna" sube de `2.05` a `2.15` (nocturna de `2.55` a `2.65`).

**El caso diagnosticado es del 21/07/2026 al 26/07/2026 — posterior al 1 de julio de 2026.** Según la vigencia de la fuente de referencia, el sistema **debería** estar usando `1.90` / `2.15` (no `1.80` / `2.05`) para las horas dominicales de este caso. `page.tsx` no tiene ningún mecanismo para aplicar ese cambio — usa `1.80`/`2.05` sin importar la fecha, siempre.

### Pruebas con las 4 fechas solicitadas (aplicando la regla de vigencia de la referencia legada)

| Fecha | ¿`fecha < 2026-07-01`? | Factor "ordinaria dominical" (según referencia) | Factor "extra festiva diurna" (según referencia) | Factor usado hoy en `page.tsx` |
|---|---|---:|---:|---:|
| 30/06/2026 | Sí | 1.80 | 2.05 | 1.80 / 2.05 (✅ coincide) |
| 01/07/2026 | No (igual a la fecha de corte) | 1.90 | 2.15 | 1.80 / 2.05 (❌ desactualizado) |
| 21/07/2026 (caso diagnosticado) | No | 1.90 | 2.15 | 1.80 / 2.05 (❌ desactualizado) |
| 01/07/2027 | No | 1.90 / 2.15 (o una tercera vigencia si existiera otro corte — no hay evidencia de más cambios en la referencia) | — | 1.80 / 2.05 (❌ desactualizado) |

**Qué sucede cuando un periodo atraviesa dos vigencias:** el motor de referencia legado clasifica **día por día** dentro del `dias_laborados.forEach`, así que un plazo que cruce el 1 de julio aplicaría un factor distinto a los días antes y después del corte. `page.tsx` no tiene esa granularidad: aplica un único factor fijo a todas las horas del periodo completo, sin importar cuántos días caen antes o después de cualquier corte de vigencia.

### Recalculo del caso con los factores "post-01/07/2026" de la referencia

```
Extra diurna (no cambia, no es festivo):  10h × 7959 × 1.25 =  99.488
Dominical ordinaria (1.90 en vez de 1.80): 7h × 7959 × 1.90 = 105.856
Extra dominical (2.15 en vez de 2.05):     2h × 7959 × 2.15 =  34.224
                                                    Sobretiempo = 239.568
```

Contra el `$232.403` mostrado hoy: **diferencia de $7.165 en este único cargo**, solo por la vigencia no aplicada. En un proceso con varios cargos y varios meses, el efecto se multiplica.

**Importante — esto NO se afirma como corrección definitiva:** no se confirmó con una fuente normativa oficial (Decreto/CST) que el 1 de julio de 2026 sea realmente el corte vigente para el recargo dominical general (a diferencia de la reducción de jornada legal, que sí tiene una fuente citada en el propio código: `Ley 2101/2021`). La evidencia proviene del código de referencia legado que tú aportaste, no de una norma verificada por mí en este diagnóstico. **Se marca como pendiente de confirmación tuya antes de tocar el código.**

---

## A3. Posible doble contabilización dominical — dos escenarios numéricos

### Escenario A: el subtotal YA contiene la hora ordinaria dominical
Si el salario básico mensual (`salarioBasico`) se entiende como el pago de **todos** los días del mes en que el trabajador debía laborar según su horario — incluidos los domingos que le correspondan según su patrón de turno — entonces las 7h "ordinaria dominical" ya están remuneradas dentro del devengado base, y el factor `1.80` (que ya excluye el 100% base, sumando solo el 80% de recargo) sería el correcto: pagas el 100% dentro del salario + 80% adicional = 180% total, sin duplicar.

### Escenario B: el subtotal NO contiene la hora ordinaria dominical
Si el `salarioBasico` prorrateado (`hsSem/44 × sb`) representa **solo las horas ordinarias hábiles** de una semana "estándar" de 44h (sin domingos, ya que el estándar semanal de jornada legal en Colombia se define de lunes a sábado), entonces el domingo trabajado **no está cubierto en absoluto** por el salario base, y pagarlo con el factor `1.80` (que ya asume que el 100% base "ya se pagó" y solo suma el 80%) **subpagaría** ese día — debería usarse un factor de `1.80` sobre el valor hora como pago **total** (no adicional), lo cual es exactamente lo que hoy hace el código (`total = valorHora × 1.80 × horas`, sin restar nada previamente pagado) — es decir, si este es el escenario real, el código **está correcto** porque el factor `1.80` ya actúa como "valor total de la hora dominical", no como "recargo adicional sobre una hora ya pagada".

### ¿Cuál escenario representa el código actual?

**El código actual implementa el Escenario B de forma consistente para el cálculo del sobretiempo en sí** (el factor `1.80`/`2.05` se aplica como valor **total** de la hora, calculado desde `valorHora`, sin restar nada del `salarioBasico`) — por lo tanto, **dentro del bucket de "Sobretiempo" no hay doble pago**: cada hora dominical se paga una sola vez, a factor total.

**Pero el nombre de la fórmula (`Hora ordinaria dom./fest.`, con la palabra "ordinaria") y su ubicación conceptual sugieren el Escenario A** (que el domingo es parte de la "jornada ordinaria" del trabajador, solo que festiva) — mientras que matemáticamente se comporta como B (factor total, no incremental). **No hay doble contabilización de dinero**, pero sí hay una inconsistencia de nomenclatura/semántica: llamar "ordinaria" a algo que se paga con un factor de valor-hora-total (no de recargo puro) puede llevar a un futuro desarrollador (o a este mismo diagnóstico, en su primera versión) a asumir erróneamente que esas horas "ya estaban incluidas" en otro lado y restarlas por error, generando ahí sí un **subpago**. Es un riesgo de mantenimiento, no un error de dinero hoy.

**Revisión de la conclusión original:** el diagnóstico inicial afirmó "no se encontró evidencia de doble pago" basándose únicamente en que el subtotal y el sobretiempo son sumas separadas. Esa conclusión **se sostiene** tras este análisis más profundo — el bucket de sobretiempo no duplica nada internamente —, pero **no se había verificado, como se hace aquí, qué representa realmente `salarioBasico`** (Escenario A vs B), que es la pregunta correcta. La respuesta requiere una definición de negocio (¿el domingo está o no dentro de la jornada ordinaria contratada?) que **no está documentada en ningún archivo del proyecto** — es una decisión funcional pendiente de tu aprobación, no algo que el código resuelva por sí solo.

---

## A4. Clasificación 10 / 7 / 2 — ¿regla general o coincidencia de este caso?

- **¿Está documentada?** No. No existe comentario, test, ni documento (`docs/*.md`) que declare "jornada legal diaria = horas semanales del cargo ÷ días trabajados". La regla real implementada es distinta: `jornadaLegalMinParaFecha()` devuelve una constante **fija por fecha** (420 o 440 min), **no calculada a partir de `hsSem` ni del número de días del plazo**. Que `42÷6=7` coincida con la jornada legal (420min=7h) vigente para julio de 2026 **es una coincidencia numérica de este caso**, no una fórmula real del sistema.
- **¿El sistema siempre divide horas semanales entre días?** No — nunca lo hace. La jornada "7h/día" viene de la vigencia legal por fecha, no de dividir 42/6.
- **¿Admite jornadas variables (8, 9, 6h/día)?** El límite de horas **ordinarias** (7h o 7h20 según fecha) es fijo para todos los cargos por igual; lo que varía por cargo es cuántas horas **por encima** de ese límite se trabajan (el `extDia` del día), calculado como `neta − jornadaLegalDia`, así que sí admite que cada cargo trabaje más o menos horas extra según su propio horario, pero el límite ordinario diario es el mismo para todos.
- **¿El sobretiempo se determina por exceso diario o semanal?** **Exclusivamente diario** (`page.tsx:5883-5927`, el bucle `for(const f of fechas)` compara `neta` contra `jornadaLegalDia` en cada iteración, sin acumular ni comparar contra un total semanal). No existe ninguna comparación contra 42h ni contra 44h semanales para decidir qué es extra.
- **¿Cómo identifica el día de descanso obligatorio?** Con una sola regla: `new Date(f+'T12:00:00').getDay()===0` — es decir, **domingo del calendario, siempre**, sin excepción. No consulta ninguna tabla de "día de descanso pactado" por trabajador.
- **¿El trabajador podría tener otro día de descanso (ej. lunes)?** El campo `diaDescansoFijo` existe en el modelo `HorarioCatalogo` (visto en el esquema Prisma), pero **no se usa en ningún punto de la clasificación de horas** en `page.tsx` — se guarda, pero el cálculo de "es domingo" ignora por completo si el horario declaró otro día de descanso.
- **¿Qué ocurre si el plazo empieza a mitad de semana (como este caso, que empieza martes)?** No hay ningún efecto especial — el sistema simplemente clasifica cada fecha individual del rango como hábil o domingo, sin reconstruir "semanas completas". No hay concepto de "semana" en absoluto en esta lógica, solo una lista plana de fechas.
- **¿Semanas que cruzan dos meses?** Sin efecto — de nuevo, no hay agrupación semanal ni mensual; cada fecha se evalúa de forma independiente.

**Aclaración pedida:** las "12 horas suplementarias totales" (10 extra diurna + 2 extra dominical) sí son coherentes con `54h trabajadas (9×6) − 42h "ordinarias" (7×6)`, pero esa aritmética es una **coincidencia derivada** de que la jornada legal diaria (7h) multiplicada por 6 días da 42 — no significa que el sistema use "42 horas semanales" como parámetro de cálculo. Si `hsSem` fuera 40 en vez de 42, la distribución de horas extra **no cambiaría en absoluto** (seguiría siendo 7h ordinaria/día porque viene de la fecha, no de `hsSem`); solo cambiaría el `salarioBasico` (el subtotal), que sí usa `hsSem` directamente.

---

## A5. Alcance temporal del "Total"

| Componente | Alcance real (evidencia en código) |
|---|---|
| Subtotal (`salarioBasico`) | Mensual — no se multiplica ni divide por los días del plazo en ningún punto |
| Auxilio de transporte | Mensual — `atPara()` retorna el valor legal completo o cero; no hay modo `proporcional` implementado en `page.tsx` (aunque **sí existe** como opción `'proporcional'` en el motor nuevo, `liquidador-mo.ts:115,160-168`, con fórmula `aux/30 × díasSemana × 4.333` — no conectada a la UI) |
| Sobretiempo | Exactamente el plazo de ejecución (`diasSeleccionados`, aquí 6 fechas puntuales) |
| Prestaciones/Seguridad/Parafiscales | Mensual (derivan de `sb`/`salarioBasico`, ninguno de los dos escalado por el plazo) |
| **Total** | **Suma directa de una base mensual + un sobretiempo de 6 días — no representa de forma coherente ni "un mes" ni "el plazo real"** |

Esto confirma y profundiza el hallazgo ya señalado en el diagnóstico original (§13/§15): no es un error aislado del Auxilio, es un patrón que atraviesa **todos** los componentes salvo el Sobretiempo. Dado que el nombre del módulo es "Estructura de costos" y el resto de la aplicación reporta valores como "costo mensual" (`$/mes` en otras pestañas), la interpretación más probable es que el "Total" pretende ser un **costo mensual recurrente proyectado**, usando el plazo de ejecución únicamente como muestra representativa de qué días de la semana (incluye o no domingo) se trabajan — pero **esto no está declarado en ningún lugar de la UI ni del código**, es una inferencia, no un hecho confirmado.

**No están implementados los dos resultados separados que pide el apéndice** (a. costo del periodo real; b. costo mensual proyectado) — hoy solo existe un número ("Total") que mezcla ambos supuestos.

---

## A6. Propuesta de arquitectura para el catálogo de horarios (sin implementar)

Estructura propuesta (para discusión, no implementada):

```ts
interface BloqueHorario {
  horaInicio: string;   // "HH:MM"
  horaFin: string;
  // el descanso entre bloques se DERIVA, no se digita
}
interface HorarioCatalogoV2 {
  codigo: string;
  bloques: BloqueHorario[];      // 1 bloque = jornada continua; 2 = con receso partido
  descansoMinutos: number;       // = suma de huecos entre bloques consecutivos, calculado
  horaInicio: string;            // = bloques[0].horaInicio (derivado, no editable aparte)
  horaFin: string;                // = bloques[ultimo].horaFin (derivado, no editable aparte)
  diaDescansoFijo: string | null; // ya existe en el esquema — falta CONECTARLO al cálculo
  horario: string;                // texto descriptivo, GENERADO desde bloques, no independiente
}
```

Reglas de validación propuestas:
- El texto libre `horario` se **genera** a partir de `bloques` (no se digita aparte) — elimina por diseño la posibility de que diverjan, como pasó con el código "2".
- `descansoMinutos` se **calcula** como la suma de los huecos entre `bloques[i].horaFin` y `bloques[i+1].horaInicio` — elimina la necesidad de que el usuario digite "1" a mano y adivine mal.
- Si se mantiene compatibilidad con el modelo actual (`horario` + `horaInicio` + `horaFin` como columnas sueltas), como mínimo agregar una validación en `POST /api/horarios` que rechace o advierta si `horaInicio`/`horaFin` no aparecen literalmente dentro del texto `horario`.

---

## A7. Resultado del apéndice

### Riesgos económicos
- Sobretiempo posiblemente subvalorado en toda fecha ≥ 01/07/2026 si la vigencia de la referencia legada es la correcta (≈3% de subvaloración del sobretiempo en este caso, escalable a todos los procesos con fechas recientes).
- Inconsistencia de base (prorrateada vs. cruda) en prestaciones/seguridad/parafiscales — dirección del efecto (sobre o sub costeo) depende de cuál base sea la correcta (decisión pendiente, §A3).

### Riesgos legales
- Si la vigencia real normativa cambió el recargo dominical/festivo desde julio de 2026 (a confirmar) y la herramienta sigue licitando con el factor anterior, los costos presentados en propuestas podrían quedar por debajo del costo legal real de operar el contrato — riesgo de subestimar AIU/margen en licitaciones.
- Base de aportes a seguridad social inconsistente con el devengado reportado podría no sostenerse ante una auditoría de Nómina/UGPP si se usa como soporte de la estructura de costos presentada.

### Riesgos para licitaciones y estructura de costos
- Como el "Total" mezcla alcance mensual y de plazo sin declararlo, un usuario podría presentar por error un costo mensual como si fuera el costo del contrato de 6 días (o viceversa), afectando directamente el precio ofertado.

### Casos afectados
Todo cargo con fecha de plazo ≥ 01/07/2026 que incluya horas dominicales/festivas (bucket `hOrdDomD`/`hOrdDomN`/`hExtDomD`/`hExtDomN` > 0) está usando factores potencialmente desactualizados. Todo cargo con `hsSem < 44` está generando una base de aportes inconsistente entre el devengado y la seguridad social/parafiscales.

### Plan de corrección por fases (propuesto, no implementado)
1. **Fase 0 (decisión, sin código):** confirmar con Nómina/fuente normativa si el corte de vigencia del 01/07/2026 para el recargo dominical es real y cuáles son los factores correctos por fecha; confirmar si Vacaciones/Salud/Pensión/ARL/Caja/ICBF/SENA deben calcularse sobre `sb` crudo o sobre `salarioBasico` prorrateado (Escenario A vs B).
2. **Fase 1:** unificar la base de aportes en `page.tsx` según lo decidido en la Fase 0 (una sola base para los 7 conceptos, igual que ya hace `liquidador-mo.ts`).
3. **Fase 2:** agregar vigencia por fecha a los factores dominicales/festivos, con el mismo patrón que `jornadaLegalMinParaFecha`.
4. **Fase 3:** rediseño del catálogo de horarios (§A6) para eliminar la posibilidad de texto/campos divergentes, con migración de los registros existentes.
5. **Fase 4:** declarar explícitamente en la UI si "Total" es costo mensual o del plazo, con la opción de mostrar ambos.

### Pruebas unitarias requeridas
- Caso de regresión exacto de este diagnóstico (fijar $1.671.318/$232.403/$249.095/$2.152.816 **o** los valores corregidos, una vez se apruebe la Fase 0/1/2).
- Prueba paramétrica de `RECARGOS_CFG` con al menos 2 fechas (antes/después de cualquier corte de vigencia que se confirme).
- Prueba de que Vacaciones/Salud/Pensión/ARL/Caja/ICBF/SENA usan la misma base que Cesantías/Prima (una vez unificado).
- Prueba de que `hsSem` proviene de la jornada individual del trabajador y no silenciosamente de un horario de catálogo con una etiqueta nominal distinta.

---

## Respuestas directas del apéndice

1. **¿El subtotal $1.671.318 debe conservarse o es incorrecto?** La fórmula que lo produce (`(hsSem/44)×salario`) está confirmada como regla corporativa en `docs/plan-implementacion-mano-obra.md §8` y replicada en el motor nuevo — no es un error de fórmula. El riesgo real es de **dato de origen** (`hsSem` autocompletado desde el horario de catálogo, no necesariamente la jornada individual del trabajador) — requiere verificar el dato, no cambiar la fórmula.
2. **¿El valor hora debe salir de 220 o 210?** De 220, siempre — confirmado en ambos motores (viejo y nuevo) y sin ninguna evidencia de que 210 sea un divisor real en algún punto del sistema.
3. **¿Los factores 1,80 y 2,05 están vigentes para el 21/07/2026?** Según el propio código de referencia legado que aportaste, **no** — a partir del 01/07/2026 deberían ser 1,90 y 2,15. Esto no está implementado en `page.tsx` (que no tiene ninguna vigencia por fecha en estos factores) y requiere tu confirmación normativa antes de corregirse.
4. **¿DOM-FEST debe sumar 0,90 o 1,90 sobre el subtotal?** No "suma sobre el subtotal" — se calcula como factor **total** sobre `valorHora`, independiente del subtotal (Escenario B, §A3). Si la vigencia post-01/07/2026 aplica, el factor total sería 1,90 (no 0,90 — 0,90 sería solo el recargo puro, no el valor total de la hora).
5. **¿Existe o no doble contabilización?** No, dentro del bucket de Sobretiempo cada hora se paga una sola vez. Sí existe una inconsistencia real (no un doble pago) en qué base usa cada aporte/prestación (§A1).
6. **¿La distribución 10/7/2 es una regla general válida?** Es el resultado correcto de aplicar la jornada legal diaria (7h, vigente por fecha) a cada uno de los 6 días del plazo, clasificando el domingo aparte — es una regla real y consistente, pero **no proviene de dividir 42÷6** como parecía sugerir el patrón numérico; es coincidencia que ambos den 7.
7. **¿El total representa un mes o seis días?** Ninguno de los dos de forma pura — mezcla Subtotal/Auxilio/Prestaciones (mensual) con Sobretiempo (los 6 días exactos), sin declararlo en la UI.
8. **¿Cuáles son las causas raíz verdaderas?** (a) el horario de catálogo permite datos divergentes entre texto y campos estructurados (diagnóstico original); (b) ausencia total de vigencia por fecha en los factores dominicales/festivos, pese a que el patrón para implementarla ya existe en el propio archivo (`jornadaLegalMinParaFecha`); (c) siete de diez conceptos de nómina no usan la misma base salarial que el Devengado dentro del mismo cargo.
9. **¿Qué correcciones son obligatorias?** Ninguna corrección de código todavía — se requiere primero la Fase 0 (decisión de negocio, §A7) antes de que cualquier corrección tenga una base confirmada.
10. **¿Qué decisiones funcionales necesita aprobar el usuario?** (1) si el corte de vigencia 01/07/2026 para recargos dominicales/festivos es real y cuáles son los factores correctos; (2) si Vacaciones/Salud/Pensión/ARL/Caja/ICBF/SENA deben basarse en el salario crudo o en el salario prorrateado; (3) si `hsSem` debe seguir autocompletándose desde el horario de catálogo o debe ser un campo propio del trabajador; (4) si el "Total" debe representar costo mensual, costo del plazo, o ambos por separado.

**No se implementó ninguna corrección en este apéndice — continúa a la espera de tu revisión y aprobación.**
| SMLMV/Aux. transporte hardcodeados | Error de vigencia |
| Cálculo 100% en frontend, sin validación backend | Inconsistencia entre frontend y backend (arquitectónica) |

---

## Resultado final — respuestas directas

1. **¿10, 7 y 2 están correctamente clasificados según la lógica actual?** Sí — dado `horaFin=18:00` y `receso=60min` (los valores reales usados, no los del texto libre), la clasificación día a día es matemáticamente correcta según las reglas de jornada legal por día vigentes hoy en el código.
2. **¿La lógica actual representa la regla funcional requerida?** Parcialmente: la jornada legal por día y los factores de recargo sí corresponden a la normativa. Pero la interpretación del horario (ignora el texto libre, no auto-calcula el receso) y la mezcla de alcance mensual/plazo no reflejan de forma clara ninguna regla de negocio documentada.
3. **¿Por qué se muestra 18:00 cuando el horario "dice" 18:30?** Porque `horaFinProceso` se llena directamente desde `HorarioCatalogo.horaFin` del registro código "2" (`page.tsx:5507`), campo independiente del texto libre `horario`, y ese registro tiene `horaFin="18:00"` guardado.
4. **¿El sistema descuenta 60 o 90 minutos?** 60 minutos — el valor tecleado manualmente en "Descanso (horas)" = 1h; nunca se calculan los 90 minutos reales entre bloques.
5. **¿Cuántas horas efectivas calcula diariamente?** 9 horas netas por día (10h brutas − 1h receso), igual las 6 fechas del plazo.
6. **¿De dónde sale $7.959?** `Math.round(1.750.905 / 220)` — `page.tsx:5940`.
7. **¿De dónde sale $1.671.318?** `Math.round((42/44) × 1.750.905)` — `page.tsx:5941` (algebraicamente igual a `valorHora × 210`, no una fórmula distinta).
8. **¿De dónde sale $232.403?** Suma de 3 conceptos con horas>0: `10×7959×1.25 + 7×7959×1.80 + 2×7959×2.05` = `99.488 + 100.283 + 32.632` — `page.tsx:5942-5953`.
9. **¿Qué factores aplica?** Los 8 de `RECARGOS_CFG` (§7); en este caso solo intervienen 1.25, 1.80 y 2.05 porque las demás horas son 0.
10. **¿Existe doble contabilización de horas dominicales?** No se encontró evidencia de doble pago: el "Subtotal" es el salario básico mensual (cubre jornada ordinaria contratada en general, sin discriminar qué días específicos), y el "Sobretiempo" (incluida la dominical) es un cargo adicional separado, coherente con la práctica de pagar recargo dominical **sobre** el salario base, no en reemplazo de una porción de él. Lo que sí se advierte (no se afirma como error) es que el "Subtotal" no está *disminuido* proporcionalmente a los 6 días del plazo, mientras que el "Sobretiempo" sí está acotado a esos 6 días exactos — ver hallazgo de alcance mixto (§13/§15).
11. **¿Se mezcla el divisor de una jornada con las horas mensuales de otra?** No — es una única fórmula, la aparente "mezcla" (220 vs 210) es una identidad matemática, no dos parámetros en conflicto.
12. **¿El cálculo corresponde a un mes completo o solo al plazo 21-26 de julio?** Mixto: Subtotal y Aux. transporte = mes completo (prorrateado solo por horas semanales); Sobretiempo = exactamente el plazo de 6 días.
13. **¿Causa raíz principal?** El texto libre del horario y sus campos estructurados (`horaInicio`/`horaFin`) son independientes y no se validan entre sí; el registro del código "2" quedó con datos internamente inconsistentes.
14. **¿Corrección mínima?** Ver §18 — validar/derivar `horaInicio`/`horaFin` desde el texto del horario al crearlo, y ofrecer auto-cálculo del receso a partir de los bloques.
15. **¿Qué pruebas agregar?** Prueba de regresión que fije este caso exacto + tests para el `useEffect` de línea 1 (hoy sin cobertura) + validación de consistencia horario-texto vs horario-estructurado.

**No se implementó ninguna corrección — este documento es exclusivamente diagnóstico, a la espera de tu aprobación.**
