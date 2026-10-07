# Diseño funcional — Detección IA en Mano de Obra (Estructura de costos)

**Fecha:** 2026-07-11 · **Alcance:** exclusivamente ASEOCOLBA (aseo, cafetería, servicios generales, conserjería operativa, mantenimiento locativo básico). Sin vigilancia/VIGICOLBA.
**Estado:** DISEÑO — nada de esto está implementado. No se modificó código, BD ni fórmulas.

**Principio rector:** Claude **extrae y sugiere**; el backend **valida y normaliza** (catálogos + Zod); el motor determinístico **calcula** (horas, recargos, salario proporcional, auxilio, IBC, aportes, prestaciones, exámenes, costos). Ningún dato no confirmado afecta el cálculo monetario.

---

## 1. Modelo de datos definitivo (TypeScript)

```ts
// src/lib/costos-mano-obra/tipos-extraccion-v2.ts (NUEVO — no creado aún)

export type FuenteDato = 'requisito' | 'catalogo' | 'parametro' | 'sugerencia' | 'pendiente';
export type NivelConfianza = 'alto' | 'medio' | 'bajo';

export interface TurnoDetectado {
  diasSemana: ('L'|'M'|'X'|'J'|'V'|'S'|'D')[];   // días explícitos ya normalizados
  horaInicio: string | null;                      // "HH:MM" 24h — null si no explícito
  horaFin: string | null;
  cruzaMedianoche: boolean;                       // calculado por código, no por IA
  descansoMinutos: number | null;                 // null = no mencionado (NUNCA inventado)
  descansoRemunerado: boolean | null;
  trabajadoresPorTurno: number | null;
  sede: string | null;                            // nombre de sede si multisede
  textoOriginal: string;                          // trazabilidad
}

export interface CargoDetectadoIA {
  cargo: {
    nombreDetectado: string;                      // texto tal cual del requisito
    nombreNormalizado: string | null;             // match contra CatalogoCargo; null = sin coincidencia
    catalogoCargoId: number | null;
    confirmado: boolean;                          // siempre false al salir de la IA
  };
  horario: {                                      // resumen del turno principal (por compat)
    horaInicio: string | null;
    horaFin: string | null;
    descansoMinutos: number | null;
    descansoRemunerado: boolean | null;
    cruzaMedianoche: boolean;
  };
  jornada: {
    diasSemana: ('L'|'M'|'X'|'J'|'V'|'S'|'D')[];
    horasDiarias: number | null;                  // solo si el requisito lo dice
    horasSemanales: number | null;                // CALCULADO POR CÓDIGO (motor), no por IA
    frecuencia: string | null;                    // "semanal" | "3_veces_semana" | "quincenal" | texto detectado
  };
  turnos: TurnoDetectado[];                       // programación completa (múltiples franjas)
  cantidadTrabajadores: number | null;            // null → pregunta pendiente
  salarioBaseMensual: {
    valor: number | null;
    fuente: FuenteDato;                           // 'requisito' si textual; 'catalogo'/'parametro' si sugerido
    confirmado: boolean;
  };
  auxilioTransporte: {
    estado: 'aplica' | 'no_aplica' | 'proporcional' | 'pendiente';
    valor: number | null;                         // el motor lo fija con la regla corporativa
    fuente: FuenteDato;
    confirmado: boolean;
  };
  arl: {
    clase: 'I'|'II'|'III'|'IV'|'V' | null;
    porcentaje: number | null;                    // resuelto por backend desde ParametrosLaborales
    fuente: FuenteDato;                           // 'requisito' | 'catalogo' (matriz cargo→ARL) | 'pendiente'
    confirmado: boolean;
  };
  examenesMedicos: {
    aplica: boolean | null;                       // null = no mencionado
    examenesDetectados: string[];                 // menciones textuales normalizadas (ver §7 léxico)
    grupoExamenSugerido: string | null;           // cod_grupo_exam del catálogo (EM001, EM005…) — SUGERIDO
    requiereValidacion: true;                     // siempre true en esta fase
  };
  ciudad: {
    nombreDetectado: string;
    nombreNormalizado: string | null;             // match contra catálogo DIVIPOLA
    departamento: string | null;
    codigoDane: string | null;
    confirmada: boolean;
  };
  preguntasPendientes: string[];
  nivelConfianza: NivelConfianza;
}

export interface ExtraccionRequisitoV2 {
  esEscenarioMultiple: boolean;                   // se conserva del modelo actual
  escenarios: { nombreEscenario: string | null; cargos: CargoDetectadoIA[] }[];
  ciudadesDetectadas: string[];                   // todas las menciones, para asociación cargo↔ciudad
  valoresAgregados: string[];                     // se conserva (brigadas, fumigación…)
  observacionesGenerales: string | null;
  preguntasPendientesGlobales: string[];
}
```

Reglas duras del modelo: la IA **nunca** llena `horasSemanales`, `cruzaMedianoche`, `porcentaje` ARL, `valor` de auxilio ni ningún campo `confirmado=true` — esos los resuelve código.

## 2. Esquema Zod (validación backend de la salida IA)

```ts
// src/lib/costos-mano-obra/schema-extraccion-v2.ts (NUEVO — no creado aún)
import { z } from 'zod';

const ZHora = z.string().regex(/^\d{1,2}:\d{2}$/).nullable();
const ZDia  = z.enum(['L','M','X','J','V','S','D']);
const ZFuente = z.enum(['requisito','catalogo','parametro','sugerencia','pendiente']);

export const ZTurnoDetectado = z.object({
  diasSemana: z.array(ZDia),
  horaInicio: ZHora, horaFin: ZHora,
  cruzaMedianoche: z.boolean().default(false),
  descansoMinutos: z.number().int().min(0).max(240).nullable(),
  descansoRemunerado: z.boolean().nullable(),
  trabajadoresPorTurno: z.number().int().positive().nullable(),
  sede: z.string().nullable(),
  textoOriginal: z.string(),
});

export const ZCargoDetectado = z.object({
  cargo: z.object({
    nombreDetectado: z.string().min(1),
    nombreNormalizado: z.string().nullable(),
    catalogoCargoId: z.number().int().nullable(),
    confirmado: z.literal(false),                    // la IA no puede confirmar
  }),
  horario: z.object({
    horaInicio: ZHora, horaFin: ZHora,
    descansoMinutos: z.number().int().min(0).nullable(),
    descansoRemunerado: z.boolean().nullable(),
    cruzaMedianoche: z.boolean(),
  }),
  jornada: z.object({
    diasSemana: z.array(ZDia),
    horasDiarias: z.number().positive().max(24).nullable(),
    horasSemanales: z.number().positive().max(84).nullable(),  // solo eco de lo declarado
    frecuencia: z.string().nullable(),
  }),
  turnos: z.array(ZTurnoDetectado),
  cantidadTrabajadores: z.number().int().positive().nullable(),
  salarioBaseMensual: z.object({
    valor: z.number().positive().nullable(),
    fuente: ZFuente, confirmado: z.literal(false),
  }),
  auxilioTransporte: z.object({
    estado: z.enum(['aplica','no_aplica','proporcional','pendiente']),
    valor: z.number().nullable(), fuente: ZFuente, confirmado: z.literal(false),
  }),
  arl: z.object({
    clase: z.enum(['I','II','III','IV','V']).nullable(),
    porcentaje: z.number().nullable(),
    fuente: ZFuente, confirmado: z.literal(false),
  }),
  examenesMedicos: z.object({
    aplica: z.boolean().nullable(),
    examenesDetectados: z.array(z.string()),
    grupoExamenSugerido: z.string().nullable(),
    requiereValidacion: z.literal(true),
  }),
  ciudad: z.object({
    nombreDetectado: z.string(),
    nombreNormalizado: z.string().nullable(),
    departamento: z.string().nullable(),
    codigoDane: z.string().nullable(),
    confirmada: z.literal(false),
  }),
  preguntasPendientes: z.array(z.string()),
  nivelConfianza: z.enum(['alto','medio','bajo']),
});

export const ZExtraccionV2 = z.object({
  esEscenarioMultiple: z.boolean().default(false),
  escenarios: z.array(z.object({
    nombreEscenario: z.string().nullable(),
    cargos: z.array(ZCargoDetectado).min(1),
  })).min(1),
  ciudadesDetectadas: z.array(z.string()).default([]),
  valoresAgregados: z.array(z.string()).default([]),
  observacionesGenerales: z.string().nullable(),
  preguntasPendientesGlobales: z.array(z.string()).default([]),
});
```

Nota: los `z.literal(false)` / `z.literal(true)` hacen imposible que una alucinación de la IA marque algo como confirmado o salte la validación de exámenes.

## 3. Mapeo IA → formulario (Datos del puesto)

| Campo IA | Estado actual en page.tsx | Destino propuesto | Regla de aplicación |
|---|---|---|---|
| `cargo.nombreNormalizado` | `cargo` (:5296) | igual | solo tras confirmar en panel; se guarda también `nombreDetectado` |
| `cantidadTrabajadores` | `nTrab` (:5297) | igual | si null → pregunta, no aplicar |
| `salarioBaseMensual.valor` | `salBase` (:5298) | igual + badge de fuente | **nunca** auto-aplicado: default sigue SMMLV de ParametrosLaborales hasta confirmar |
| `auxilioTransporte.estado` | `conAux`/`auxValor` (:5300-5301) | selector 4 estados | la IA solo propone; la regla definitiva la aplica el motor (salario ≤ 2×SMMLV, proporcional por días) |
| `arl.clase` | `arlKey` única (:5302) | **ARL por cargo** | sugerencia desde matriz cargo→ARL, pendiente hasta confirmar |
| `examenesMedicos.grupoExamenSugerido` | filas manuales `examRows` (:5529) | precarga desde `/api/examenes/por-grupo` | ítems marcados "sugerido" hasta confirmar |
| `ciudad.*` | **no existe** | campo nuevo en Datos del puesto | si vacía → pregunta obligatoria |
| `turnos[]` | 8 inputs de horas (:5315-5322) + `jornadaDesc` texto | **Programación del servicio** estructurada | el motor B calcula los 8 inputs de horas desde los turnos; el usuario ya no digita horas de recargo a mano (quedan visibles como salida del motor, editables como override) |
| `jornada.horasSemanales` | `horasSemanales` (:5315) | calculado por motor | solo lectura + override manual |
| sedes por turno | `nSedes` decorativo (:5310) | sede por turno en programación | reemplaza al campo decorativo |

## 4. Campos nuevos requeridos

**Formulario/UI:** Ciudad (+departamento), Programación del servicio (tabla de turnos: días, inicio, fin, descanso, horas efectivas calculadas, trabajadores por turno, sede), estado de confirmación por campo (chips), ARL por cargo, grupo de exámenes por cargo.
**Persistencia (futuras migraciones — NO ahora):** `CatalogoCargo` (id, nombre, sinónimos, salarioSugerido?, claseArlSugerida, grupoExamen, activo), `CatalogoCiudad` (DIVIPOLA: codigoDane, municipio, departamento, regional), y en el snapshot de costeo: ciudad, turnos estructurados, estados de confirmación.
**Extracción:** todo el modelo §1 (reemplaza al actual `ExtraccionGemini` para esta vista; el motor B se mantiene).

## 5. Campos actuales que se reemplazan o eliminan

| Campo actual | Motivo | Reemplazo |
|---|---|---|
| `jornadaDesc` (texto libre decorativo, :5309) | no alimenta ningún cálculo | Programación del servicio estructurada |
| `nSedes` (decorativo, :5310) | no afecta cálculo | sede por turno |
| Aplicación directa "Aplicar sugerencias" (:5874) que copia solo el primer cargo | descarta cargos 2..n y no muestra fuente | Panel de revisión y confirmación (§8) multi-cargo |
| Digitación manual de las 8 horas de recargo como entrada primaria | error-prone | salida del motor B con override manual |
| `arlKey` única para todo el costeo | los Excel muestran cargos con riesgos distintos (P5) | ARL por cargo |

Los campos `pSalud/pPension/pSena/pIcbf/pCaja` editables se mantienen en esta fase (su centralización pertenece a la fase de parametrización ya diseñada, pendiente de P1–P4).

## 6. Fuentes internas necesarias

| Fuente | Estado hoy | Acción requerida |
|---|---|---|
| **Catálogo de cargos** | No existe. Los 48 Excel usan un vocabulario estable: operario de aseo, operaria de cafetería, todero, todero/alturas, piscinero, salvavidas, piscinero-salvavidas, conserje, jardinero, operario líder, supervisor | Crear `CatalogoCargo` con sinónimos (seed desde los Excel + `normalizar-perfil.ts` como referencia de técnica) |
| **Matriz ARL cargo→clase** | No existe; los Excel usan II para todo (hallazgo P5 pendiente de SST) | Crear tabla/constante; hasta resolver P5, default II con marca "sugerido" |
| **Matriz de exámenes** | **Parcial**: catálogo externo con `cod_grupo_exam` (EM001 BÁSICO, EM005 ALTURAS, EM009 PISCINERO…) vía [/api/examenes/por-grupo](../src/app/api/examenes/por-grupo/route.ts) | Mapear cargo→grupo en `CatalogoCargo.grupoExamen`; los valores vienen del catálogo existente |
| **Catálogo de ciudades** | No existe ([colombia-map.ts](../src/lib/colombia-map.ts) es solo polígonos de departamentos para el mapa) | Cargar DIVIPOLA (DANE) municipio+departamento+regional; normalización de variantes ("B/quilla", "Bogotá D.C.") |
| **ParametrosLaborales** | Existe (fila 2026 activa) | Fuente del SMMLV sugerido, auxilio, tope 2×SMMLV y % ARL por clase |

## 7. Preguntas pendientes que puede generar la IA (léxico cerrado)

1. "¿En qué ciudad se prestará el servicio?" (si no hay mención)
2. "¿Cuántos trabajadores se requieren para el cargo X?" (cantidad ausente — sin confundir con nº de sedes)
3. "¿Cuál es el salario base para el cargo X o se usa el SMMLV vigente?"
4. "¿El horario de X incluye descanso? ¿Es remunerado?" (si turno > umbral de política y no se menciona)
5. "¿El servicio de X se presta también domingos y festivos?"
6. "¿El cargo X requiere trabajo en alturas / manipulación de alimentos?" (dispara grupo de exámenes y ARL)
7. "¿Los N trabajadores rotan entre sedes o cada sede tiene personal fijo?"
8. "El requisito menciona 'medio tiempo' sin horas: ¿cuántas horas semanales?"

Detección de exámenes por expresiones (para `examenesDetectados`): examen de ingreso, examen ocupacional, trabajo en alturas, manipulación de alimentos, audiometría, visiometría, espirometría, énfasis osteomuscular.

## 8. Diseño del panel de revisión y confirmación

Reemplaza el modal actual de "Aplicar sugerencias". Un bloque por cargo detectado:

```
┌─ Revisión del análisis — Cargo 1 de 2: "OPERARIO DE ASEO"  [confianza: ALTA] ─┐
│ Campo             Detectado             Fuente        Estado                  │
│ Cargo             Operario de Aseo      catálogo ✓    [Confirmar] [Corregir]  │
│ Ciudad            Barranquilla/Atl.     requisito     [Confirmar] [Corregir]  │
│ Trabajadores      3                     requisito     [Confirmar] [Corregir]  │
│ Programación      L-S 06:00-14:00 ·     requisito     [Confirmar] [Editar]    │
│                   D 06:00-12:00 (2 op.)               (horas/sem: 47 — motor) │
│ Salario base      $1.750.905            parámetro ⚠   [Confirmar] [Corregir]  │
│ Aux. transporte   aplica ($249.095)     motor (regla) [Confirmar]             │
│ ARL               Clase II (1.044%)     sugerencia ⚠  [Confirmar] [Cambiar]   │
│ Exámenes          Grupo BÁSICO (3 ítems) sugerencia ⚠ [Ver y confirmar]       │
│ ── Preguntas pendientes (2) ──────────────────────────────────────────────    │
│ • ¿El servicio dominical lo cubren los mismos 3 operarios o personal extra?   │
│ • ¿El turno incluye descanso remunerado?                                      │
└─ [Confirmar todo lo detectado del requisito]  [Aplicar confirmados al costeo] ┘
```

Reglas del panel: (1) "Aplicar" solo transfiere campos **confirmados**; (2) los campos `fuente≠requisito` llevan badge ⚠ "sugerido — requiere confirmación"; (3) mientras haya salario/ARL/ciudad sin confirmar, el costeo muestra la cinta "Cálculo preliminar — datos pendientes de confirmación" y el botón Guardar queda deshabilitado; (4) las preguntas pendientes se pueden responder inline (la respuesta actualiza el campo y lo confirma); (5) multi-cargo: pestañas o acordeón por cargo — nada de "solo el primero".

## 9. Archivos que se modificarían (cuando se autorice)

| Archivo | Cambio |
|---|---|
| `src/lib/costos-mano-obra/tipos-extraccion-v2.ts` + `schema-extraccion-v2.ts` | NUEVOS (§1, §2) |
| [prompt-gemini.ts](../src/lib/costos-mano-obra/prompt-gemini.ts) | Prompt v2: nuevos campos, regla "no inventar", léxico de preguntas y exámenes |
| [gemini-extractor.ts](../src/lib/costos-mano-obra/gemini-extractor.ts) | Validar contra `ZExtraccionV2`; post-proceso backend: normalizar cargo/ciudad contra catálogos, resolver % ARL, calcular `cruzaMedianoche` |
| [motor-mano-obra.ts](../src/lib/costos-mano-obra/motor-mano-obra.ts) | Sin cambios de fórmulas en esta fase; consume `turnos[]` (ya compatible con `TurnoEntrada`) |
| [analizar-mano-obra/route.ts](../src/app/api/costos/analizar-mano-obra/route.ts) | Orquestar v2: IA → normalización → motor → respuesta con estados/preguntas |
| `src/app/page.tsx` (ModuloEstructuraCostos) | Datos del puesto ampliado, Programación del servicio, panel de revisión (§8); extraer a componentes en `src/components/costos/estructura/` |
| `prisma/schema.prisma` | `CatalogoCargo`, `CatalogoCiudad` + campos snapshot (migración futura, NO ahora) |
| Nuevos endpoints | `GET /api/catalogos/cargos`, `GET /api/catalogos/ciudades`, `GET /api/parametros-laborales` |
| Tests | `extraccion-v2.test.ts` (Zod + casos de los 48 Excel como fixtures de texto), tests de mapeo panel→formulario |

## 10. Plan de implementación (por fases, tras autorización)

1. **Fase A — Fuentes**: `CatalogoCargo` + `CatalogoCiudad` (migración + seeds desde los 48 Excel y DIVIPOLA) + endpoints de catálogo + `GET /api/parametros-laborales`. Riesgo bajo; sin tocar cálculos.
2. **Fase B — Extracción v2**: tipos + Zod + prompt v2 + post-proceso de normalización en backend + tests con fixtures reales. La ruta `analizar-mano-obra` responde v2 manteniendo compat con el modal actual (feature flag).
3. **Fase C — UI**: Datos del puesto ampliado (ciudad, ARL por cargo, exámenes por grupo), Programación del servicio, panel de revisión/confirmación multi-cargo; eliminación de `jornadaDesc`/`nSedes` decorativos.
4. **Fase D — Enlace con cálculo**: las horas del formulario pasan a ser salida del motor B (con override); bloqueo de guardado con pendientes; ciudad alimenta exámenes/proveedores/regional.
5. **Fase E — Cierre**: depende de las respuestas P1–P8 de la matriz de validación (bases IBC, factores, exoneración) — se integra con la fase de parametrización ya diseñada.

Dependencias: Fase A no depende de nadie; B depende de A; C de B; D de C; E de la matriz de validación.
