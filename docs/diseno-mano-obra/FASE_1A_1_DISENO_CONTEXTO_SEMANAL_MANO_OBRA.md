# FASE 1A.1 — Diseño del modelo de contexto semanal de Mano de Obra

> **Estado: documento de diseño vigente.**
> Referencia conceptual del módulo contexto-semanal. Cualquier cambio en
> tipos o reglas debe actualizarse simultáneamente en el código y en este
> documento.

Documento exclusivamente de diseño (documental, solo lectura sobre código y BD). No incluye SQL ejecutable ni migraciones Prisma ejecutables. No modifica el Plan (revisión 7) ni `FASE_0_LINEA_BASE_MANO_OBRA.md`. No modifica fixtures, pruebas ni UI. No decide el régimen especial de vigilancia. No produce resultados económicos. No convierte `segmentador-cronologico-referencia.ts` en código productivo.

---

## 1. Resumen ejecutivo

Fase 0 demostró que ningún motor actual puede clasificar correctamente "ordinaria vs. extra" para un periodo parcial (caso código 47, 2 días aislados) porque ninguno recibe la semana laboral completa del trabajador: jornada contractual, distribución pactada por día, acumulado de días anteriores, modalidad de jornada, día de descanso real. Este documento diseña el **modelo de contexto semanal** que cierra esa brecha — la pieza de datos que la Etapa 3 (clasificación ordinaria/extra, ver Fase 0 §9) necesita como entrada antes de poder ejecutarse. Se investigó por qué los modelos existentes (`CargoManoObra`/`TurnoManoObra`) no lo cubren hoy: **los 3 `CargoManoObra` de "aseo"** auditados en Fase 0 tienen `turnos:[]` (confirmado por consulta directa) — el endpoint `recalcular` sí soporta turnos, pero a esos cargos nunca se les asignó ninguno, de ahí `jornadaSemanalCalculada=0`. Los 4 `TurnoManoObra` reales que existen en BD pertenecen a otros 3 cargos (ids 6, 7, 8, turno nocturno 18:00-08:00, ajenos al caso auditado). Se propone reutilizar `CargoManoObra`/`TurnoManoObra`/`EscenarioManoObra` como base, extendiéndolos con 3 estructuras nuevas (`PatronTrabajadorManoObra`, `ProgramacionDiariaTrabajador`, `ContextoSemanalManoObra`) bajo un **modelo híbrido** (Opción C, recomendada en §9): patrón recurrente relacional + excepciones por fecha + instantánea JSON por costeo — nada de esto se crea todavía.

## 2. Problema que resuelve

Un cálculo de mano de obra para un plazo parcial (ej. 2 días de un contrato) necesita saber si las horas de esos 2 días son ordinarias o extra. Esa pregunta **no es respondible mirando solo esos 2 días** — depende de cuánto ya trabajó el operario esa semana, cuál es su jornada contractual pactada, y cómo se distribuye. Hoy ningún modelo de datos captura eso: `CargoManoObra` tiene una jornada semanal *declarada* (un número) pero no una distribución diaria ni un acumulado; `TurnoManoObra` describe un patrón de turno recurrente (días de la semana + horario) pero no una programación por fecha concreta, ni un acumulado, ni distingue modalidad estándar/flexible. Sin este modelo, la Etapa 3 no tiene entrada — solo puede, como quedó decidido en Fase 0, devolver `REQUIERE_CONTEXTO_SEMANAL`.

## 3. Alcance

Cubre: definición de semana laboral; separación operación-del-servicio vs. programación-individual; entidades `PatronTrabajadorManoObra`, `ProgramacionDiariaTrabajador`, `ContextoSemanalManoObra`; su relación con los modelos existentes; el algoritmo conceptual de clasificación ordinaria/extra (sin implementar); el tratamiento de cruce de medianoche, cruce de semana, cruce de vigencia; integración conceptual con la matriz principal (ya aprobada en Fase 0 §17.7) y con la futura cobertura de descanso (Fase 0 §17.8, no implementada); versionado/inmutabilidad; contratos de API interna; alertas; casos de prueba futuros. No cubre: régimen de vigilancia (Fase 0 §18, pendiente), valoración económica (Etapa 5), implementación real de ningún archivo de producción.

## 4. Decisiones funcionales heredadas de Fase 0

Este diseño es una consecuencia directa y obligatoria de las 9 decisiones aprobadas en `FASE_0_LINEA_BASE_MANO_OBRA.md` §17 — en particular: (1) no usar `42h/6=7h/día` como fórmula automática; (2) el caso código 47 exige `REQUIERE_CONTEXTO_SEMANAL`; (3) el motor corregido debe recibir la semana laboral completa con los 9 campos ahí listados; (4) "Lunes a domingos y festivos" = operación del servicio, no programación individual; (5) `diaDescansoObligatorio` explícito, nunca inferido; (6) varios operarios se representan por patrón, sin dividir horas silenciosamente; (7) matriz principal con precedencia fecha+concepto; (8) cobertura de descanso como modelo separado, no implementada aún; (9) separación en 5 etapas. Cada sección de este documento cita cuál decisión implementa.

## 5. Modelo conceptual

### 5.1 Definición de semana laboral (Fase 0 §17.3)

| Aspecto | Definición propuesta | Naturaleza |
|---|---|---|
| Día de inicio | Lunes 00:00:00 | Decisión técnica por defecto — ver nota |
| Día de finalización | Domingo 23:59:59 | Decisión técnica por defecto |
| Zona horaria | `America/Bogota` (UTC-5, sin horario de verano) | Decisión técnica — fija para todo el sistema, no varía por contrato |
| Turnos que cruzan medianoche | Se dividen en 2 segmentos por día calendario (ya especificado y probado en `segmentador-cronologico-referencia.ts`, Fase 0) | Regla técnica cerrada |
| Turnos que atraviesan dos semanas | Un turno que cruza de domingo 23:xx a lunes 00:xx pertenece, por sus 2 segmentos, a **dos semanas laborales distintas** — cada segmento acumula contra el contexto semanal de su propia semana, nunca contra una sola | Regla técnica, deriva de la definición de semana |
| Semanas que atraviesan dos meses | No requiere tratamiento especial — el contexto semanal es agnóstico del mes; solo importa para reportes de facturación/nómina mensual, fuera de este diseño | Fuera de alcance de este documento |
| Semanas que atraviesan una vigencia normativa | El `ContextoSemanalManoObra` no fija un único set de parámetros para toda la semana — cada segmento/día resuelve su propia vigencia por fecha (ya diseñado en el plan §5, `resolverParametrosVigentes`); una semana que cruza el 15/07/2026 tendrá días con jornada máxima 44h y otros con 42h | Regla técnica, ya cerrada en el plan |
| Periodos parciales | Ver §7 — nunca se asume acumulado cero | Decisión funcional Fase 0 |
| Acumulados anteriores al periodo consultado | Deben resolverse contra el `ContextoSemanalManoObra` de la semana completa, no inventarse | Decisión funcional Fase 0 |

**¿Es configurable por contrato/servicio?** Se propone que **no lo sea por ahora**: la semana laboral lunes-domingo y la zona horaria `America/Bogota` son un estándar operativo único del sistema, no un parámetro de negociación por cliente. Si en el futuro apareciera un contrato con "semana laboral" definida distinto (ej. semana de nómina domingo-sábado para algún cliente específico), eso sería una **decisión funcional nueva y explícita**, no una opción silenciosa — se deja como pregunta abierta en §19, no se diseña un campo de configuración especulativo sin caso real que lo exija.

### 5.2 Operación del servicio vs. programación individual (Fase 0 §17.4)

| | A. Operación del servicio | B. Programación individual |
|---|---|---|
| Qué describe | Cuándo y cómo debe estar cubierto el servicio | Qué hace cada trabajador concreto cada día |
| Dónde vive hoy | `HorarioCatalogo` (horario de operación), `EscenarioManoObra`/`CargoManoObra` (cantidad de puestos, `cantidadSolicitada`) | No existe hoy — es exactamente lo que este documento diseña (`PatronTrabajadorManoObra` + `ProgramacionDiariaTrabajador`) |
| "Lunes a domingos y festivos" | Pertenece aquí — significa que el servicio opera esos días, no que un trabajador los cubre todos | — |
| Relación | La operación del servicio genera la **necesidad** de cobertura; la programación individual **asigna** patrones de trabajador (principal, relevo, turnante) para satisfacerla | La suma de las programaciones individuales de todos los patrones de un cargo debe cubrir la operación del servicio — pero esa verificación es responsabilidad de una etapa posterior (fuera de alcance de este documento; se menciona en §19 como decisión pendiente) |

### 5.3 Unidad de cálculo (Fase 0 §17.9, decisión previa ya aplicada en `segmentador-cronologico-referencia.ts`)

Todo el modelo de contexto semanal (duración de bloques, descansos, acumulados, límites diarios/semanales, clasificación ordinaria/extra) trabaja internamente en **minutos enteros**. Las horas decimales solo aparecen en la frontera de presentación (UI) o en puntos de compatibilidad explícitamente controlados con el motor viejo (igual que ya se hizo en Fase 0 con `caracterizacion-motor-viejo.test.ts`, que sí usa horas decimales porque así es como se comporta hoy `page.tsx`).

---

## 6. Modelo lógico

Todas las estructuras siguientes son **diseño**, no Prisma ni SQL — se muestran como contratos de tipos (pseudocódigo TypeScript) para precisión, sin implicar implementación.

### 6.1 `PatronTrabajadorManoObra`

```
PatronTrabajadorManoObra {
  id: number
  cargoManoObraId: number              // FK a CargoManoObra existente
  nombre: string                       // ej. "Operario principal turno diurno"
  cantidadTrabajadores: number         // cuántas personas comparten EXACTAMENTE este patrón
  jornadaContractualSemanalMinutos: number
  modalidadDistribucionJornada: 'ESTANDAR' | 'FLEXIBLE_ACORDADA' | 'TURNOS_SUCESIVOS_ESPECIALES' | 'REGIMEN_ESPECIAL'
  acuerdoJornadaFlexible: boolean | null   // obligatorio explicitar si modalidad = FLEXIBLE_ACORDADA
  regimenLaboral: 'GENERAL' | 'VIGILANCIA_SEGURIDAD_PRIVADA'  // del plan §5
  diaDescansoObligatorio: DiaSemana | 'PENDIENTE_CONFIRMACION'
  vigenteDesde: Date
  vigenteHasta: Date | null
  activo: boolean
  origen: 'MANUAL' | 'IMPORTADO_GEMINI' | 'MIGRADO_LEGACY'
  version: number                      // incrementa en cada edición, nunca se sobreescribe en sitio
  creadoPor: string | null
  creadoEn: DateTime
}
```

**Regla explícita (Fase 0 §17.1):** `modalidadDistribucionJornada` **nunca se infiere** por encontrar una jornada diaria superior al promedio semanal (`42/6`) — es siempre un campo confirmado por un usuario. `FLEXIBLE_ACORDADA` exige `acuerdoJornadaFlexible=true` con evidencia (ver §14, versionado).

### 6.2 `ProgramacionDiariaTrabajador`

```
ProgramacionDiariaTrabajador {
  id: number
  patronTrabajadorId: number
  fecha: Date                          // día calendario concreto
  turnoAsignadoId: number | null       // FK a TurnoManoObra si aplica un patrón de turno recurrente
  bloques: { inicio: string; fin: string }[]  // "HH:MM", mismo contrato que BloqueHorarioPrueba de Fase 0
  minutosOrdinariosPactados: number    // cuánto de ese día es contractualmente ordinario, ANTES de clasificar
  minutosTrabajadosProgramados: number // duración neta programada (bloques - descansos)
  diaDescansoObligatorioEnEstaFecha: boolean
  tipoAsignacion: 'TURNO_ORDINARIO' | 'RELEVO' | 'COBERTURA_DESCANSO' | 'REEMPLAZO' | 'TURNO_ADICIONAL' | 'DESCANSO' | 'AUSENCIA' | 'FESTIVO_NO_LABORADO'
  fuente: 'PATRON_RECURRENTE' | 'EXCEPCION_MANUAL' | 'IMPORTADO_API_TURNOS'
  estado: 'PROGRAMADO' | 'CONFIRMADO' | 'EJECUTADO' | 'MODIFICADO_POSTERIOR'
  observacion: string | null
  usuarioConfirmo: string | null
  fechaConfirmacion: DateTime | null
}
```

**Persistir cada fecha vs. generar desde un patrón recurrente — comparación (requerida explícitamente):**

| | Persistir cada fecha | Generar desde patrón + materializar al calcular |
|---|---|---|
| Integridad histórica | Alta — cada fecha es un registro inmutable una vez `EJECUTADO` | Media — depende de que el patrón no cambie retroactivamente antes de materializar |
| Volumen de datos | Alto (1 fila por trabajador×día) | Bajo (1 fila por patrón, expandido solo bajo demanda) |
| Manejo de excepciones (ausencia, relevo puntual) | Natural — es solo otra fila con `tipoAsignacion` distinto | Requiere una tabla de excepciones aparte que sobrescriba la expansión del patrón |
| Auditoría de "qué se sabía en el momento del cálculo" | Directa | Requiere congelar también la versión del patrón usado (ver §14) |
| Riesgo de inconsistencia | Bajo, una vez escrito no cambia solo | Medio-alto: si el patrón cambia después de que ya se calculó un costeo pasado, hay que garantizar que la expansión histórica no se recalcule con el patrón nuevo |

**Recomendación (adelanto de §9):** modelo **híbrido** — `ProgramacionDiariaTrabajador` se **materializa y persiste** solo para el rango de fechas efectivamente relevante a un cálculo (el plazo solicitado + la semana calendario que lo contiene, para poder resolver el acumulado), generada a partir del patrón recurrente (`TurnoManoObra`/`PatronTrabajadorManoObra`) la primera vez que se necesita, y a partir de ahí queda como registro propio editable por excepción (ausencia, relevo puntual) sin volver a regenerarse automáticamente salvo confirmación explícita del usuario.

### 6.3 `ContextoSemanalManoObra`

```
ContextoSemanalManoObra {
  id: number
  patronTrabajadorId: number
  semanaInicio: Date                   // lunes 00:00 America/Bogota
  semanaFin: Date                      // domingo 23:59:59 America/Bogota
  zonaHoraria: 'America/Bogota'
  jornadaContractualSemanalMinutos: number   // copiado del patrón vigente para esta semana (trazabilidad)
  minutosOrdinariosProgramados: number       // Σ ProgramacionDiariaTrabajador.minutosOrdinariosPactados de la semana
  minutosTrabajadosAcumulados: number        // Σ minutos realmente trabajados conocidos hasta el momento del cálculo
  minutosOrdinariosAcumulados: number
  minutosExtraAcumulados: number
  contextoCompleto: boolean                  // true solo si los 7 días de la semana tienen ProgramacionDiariaTrabajador resuelta
  fuenteContexto: 'PROGRAMACION_COMPLETA' | 'PROGRAMACION_PARCIAL' | 'DECLARADO_SIN_PROGRAMACION_DIARIA'
  versionContexto: number
  fechaCalculo: DateTime
  alertas: AlertaContextoSemanal[]           // ver §13
  estado: 'COMPLETO' | 'REQUIERE_CONTEXTO_ANTERIOR' | 'REQUIERE_PROGRAMACION_DIARIA' | 'INCONSISTENTE' | 'BLOQUEADO_POR_PARAMETROS' | 'LISTO_PARA_CLASIFICAR'
}
```

### 6.4 Distribución diaria (Fase 0 §17.1, requisito 8)

- **A. Jornada estándar:** `minutosOrdinariosPactados` por día se deriva de repartir `jornadaContractualSemanalMinutos` entre los días activos del patrón de turno (`TurnoManoObra.dias`), respetando el límite diario aplicable (máx. 480 min/8h, o el tope vigente por fecha) y el límite semanal aplicable — **nunca** como `jornadaSemanal / númeroDeDías` aplicado ciegamente; la repartición debe poder ser desigual (ej. 4 días de 8h + 1 día de 6h) si así está pactado, y el sistema debe permitir declarar esa distribución explícita día por día en vez de derivarla siempre por división.
- **B. Jornada flexible acordada:** `minutosOrdinariosPactados` por fecha se declara explícitamente (no derivado), validado contra: rango diario permitido (240-540 min, es decir 4-9h, según la decisión funcional Fase 0 §17.1-B), y que la suma semanal no supere `jornadaContractualSemanalMinutos` (máx. 2520 min = 42h). Requiere `PatronTrabajadorManoObra.acuerdoJornadaFlexible=true` con evidencia versionada (§14).

---

## 7. Relación con modelos existentes

| Modelo actual | Qué ya cubre | Qué falta | Se reutiliza | Se extiende | Se reemplaza |
|---|---|---|---|---|---|
| `EscenarioManoObra` | Agrupador de cargos por escenario/servicio, `costoTotalMensual` | Nada relevante a contexto semanal — sigue siendo el nivel correcto para agrupar | Sí, tal cual | No | No |
| `CargoManoObra` | Identificación del cargo, `jornadaSemanalDeclarada` (un número), `cantidadSolicitada`, `diaDescansoObligatorio` (campo ya existe, hoy sin usar consistentemente) | No distingue **patrones** (varios grupos de trabajadores con distinta jornada/modalidad dentro del mismo cargo); no tiene `modalidadDistribucionJornada` ni `acuerdoJornadaFlexible` | Sí, como padre de `PatronTrabajadorManoObra` (relación 1→N) | Sí — agregar los 2 campos nuevos citados, o dejarlos en el patrón (recomendado: en el patrón, no en el cargo, porque un cargo puede tener patrones con modalidades distintas) | No |
| `TurnoManoObra` | Patrón de turno recurrente: `dias[]`, `horaInicio/horaFin`, `descansoMinutos` — exactamente el insumo para generar `ProgramacionDiariaTrabajador` por expansión | No representa una **fecha concreta** (es un patrón semanal recurrente, no una instancia); no tiene estado de confirmación ni excepciones | Sí — sigue siendo la fuente del patrón recurrente | Sí — agregar `patronTrabajadorId` (hoy cuelga directo de `cargoId`, sin noción de "patrón" cuando un cargo tiene varios grupos de trabajadores con turnos distintos) | No |
| `HorarioCatalogo` | Catálogo de horarios de **operación del servicio** (bloques, jornada, matriz de sobretiempos) | No representa programación individual — nunca debería (es una fuente de sugerencia para `TurnoManoObra`/`ProgramacionDiariaTrabajador`, no la programación en sí) | Sí, como fuente de sugerencia (igual que ya diseñado en el plan §L: "el horario sugiere, el cargo confirma") | No | No |
| `ParametrosLaborales` | Parámetros no fraccionados por vigencia intra-régimen (SMLMV, tope auxilio, ARL) | Vigencias por tramo — ya cubierto por `VigenciaParametrosLaborales` (plan §5, no implementado aún) | Sí, para lo que no varía por vigencia | No en este documento (ya diseñado en el plan) | No |
| `CalendarioFestivos` | Festivos reales por fecha, único para consulta de tipo de día | Cobertura 2025/2027 (dato, no modelo) | Sí, tal cual | No | No |
| `CostoEstructura` | Registro histórico de un costeo (JSON `datos`, totales) | No tiene campos de versionado de contexto/patrón/programación (ya identificado en el plan §7: `versionMotor`/`parametrosSnapshot`/`fechaCalculo`) | Sí, como destino final de la instantánea (§14) | Sí — los mismos campos ya diseñados en el plan §7, más la instantánea de contexto semanal de este documento | No |

**Investigación específica solicitada:**

- **¿Por qué `TurnoManoObra` no es consumido hoy por `recalcular`?** Confirmado leyendo `route.ts:102-109`: los `turnos` que el endpoint procesa vienen del **body de la petición HTTP** (`turnosPayload`), nunca de una consulta a la tabla `TurnoManoObra`. La tabla existe y tiene registros reales, pero el endpoint no la lee ni la escribe — es infraestructura de datos sin conectar al flujo de cálculo, exactamente igual que `costoLaboral` (Fase 0, hallazgo "campo muerto").
- **¿Por qué `CargoManoObra` tiene `jornadaSemanalCalculada=0`?** Confirmado con consulta directa (solo lectura): los 3 cargos de "aseo" auditados en Fase 0 (ids 3, 4, 5) tienen **`turnos: []`** — ningún `TurnoManoObra` vinculado. Los 4 `TurnoManoObra` que sí existen en BD pertenecen a los cargos **6, 7 y 8** (turno nocturno 18:00-08:00, ajenos al caso auditado). Es decir: `procesarCargo` se ejecutó (o el cargo se creó/actualizó) sin turnos asociados, y `calcularDesgloseSemanale` retorna correctamente `totalSemana=0` por su propio diseño (`if (!cargo.turnos || cargo.turnos.length === 0) return {...acumVacio()...}`) — no es un bug del motor, es un dato de origen incompleto (cargos creados sin turnos).
- **¿`TurnoManoObra` puede representar programación por fecha?** No en su forma actual — es un patrón recurrente por día de semana (`dias: String[]`), no por fecha concreta. Necesita la entidad nueva `ProgramacionDiariaTrabajador` para eso.
- **¿Necesita una entidad intermedia?** Sí — `PatronTrabajadorManoObra`, porque hoy `TurnoManoObra` cuelga directo de `CargoManoObra` (relación 1→N sin agrupación), y un cargo puede necesitar varios grupos de trabajadores con jornada/modalidad/régimen distintos (Fase 0 §17.6) — sin el patrón como nivel intermedio, no hay dónde colgar `modalidadDistribucionJornada` por grupo.
- **¿El modelo existente soporta varios patrones por cargo?** No — `CargoManoObra` no tiene ningún concepto de "grupo de trabajadores" distinto de `cantidadSolicitada`/`cantidadPersonasCalculadas` (cantidades, no patrones diferenciados). Confirma la necesidad de `PatronTrabajadorManoObra`.

---

## 8. Opciones de diseño

### Opción A — JSON dentro de `CargoManoObra`

Toda la programación semanal (patrones, programación diaria, contexto) se guarda en un campo `Json` del cargo, similar a como hoy vive `inputsMensuales`.

### Opción B — Modelo completamente relacional

Cada patrón, cada fecha, cada bloque es una fila en tablas relacionales normalizadas (lo diseñado en §6, sin instantánea JSON).

### Opción C — Modelo híbrido

Patrón recurrente relacional (`PatronTrabajadorManoObra`, `TurnoManoObra` extendido) + excepciones por fecha relacionales (`ProgramacionDiariaTrabajador`, materializada solo cuando se necesita) + instantánea JSON inmutable por costeo (en `CostoEstructura`/`CargoManoObra`, igual que el plan §7 ya diseñó para vigencias/parámetros).

| Criterio | A. JSON en cargo | B. Relacional puro | C. Híbrido |
|---|---|---|---|
| Integridad | Baja — sin validación de tipos/referencias a nivel de BD | Alta | Alta para el patrón/excepciones; la instantánea es intencionalmente inmutable (no necesita integridad referencial, es un snapshot) |
| Trazabilidad | Baja — difícil auditar "qué cambió y cuándo" dentro de un JSON mutable | Alta — cada fila tiene su propia auditoría | Alta — el patrón se audita relacionalmente, el snapshot es la prueba histórica |
| Consultas (ej. "todos los cargos con jornada flexible sin acuerdo") | Difícil — requiere parsear JSON | Directa (SQL/Prisma normal) | Directa para el patrón; el snapshot no se consulta, solo se lee completo |
| Rendimiento | Aceptable para lectura simple, malo para consultas agregadas | Mejor para agregados (acumulados semanales) | Mejor de ambos mundos — agregados sobre relacional, lectura O(1) del snapshot histórico |
| Complejidad de implementación | Baja | Alta | Media-alta (más piezas, pero cada una simple) |
| Migración | Trivial (un campo nuevo) | Requiere 2-3 tablas nuevas + relaciones | Igual que B, más el campo snapshot (ya se va a necesitar de todas formas por el plan §7) |
| Auditoría | Débil | Fuerte | Fuerte (relacional) + inmutable (snapshot) |
| Compatibilidad con Prisma | Alta (Json nativo) | Alta (es el uso estándar de Prisma) | Alta |
| Facilidad para recalcular | Baja — hay que reconstruir el JSON completo cada vez | Alta — se consulta solo lo que cambió | Alta — igual que B, y el snapshot permite comparar "antes vs. después" directamente (ya es el mecanismo de retroactividad del plan §7) |
| Facilidad para versionar | Baja | Media (requiere campos de versión explícitos en cada tabla) | Alta — el patrón se versiona relacionalmente (`version` en `PatronTrabajadorManoObra`), el cálculo histórico congela con el snapshot |
| Riesgo de inconsistencias | Alto — nada impide que el JSON quede con datos contradictorios | Bajo | Bajo — mismo nivel que B, sin el riesgo adicional de JSON libre |

## 9. Recomendación

**Opción C — modelo híbrido.** Es la única que satisface simultáneamente dos necesidades que Fase 0 dejó como requisitos explícitos y que no son negociables entre sí: (a) el patrón y la programación deben ser **consultables y auditables** (descarta la Opción A), y (b) un costeo ya calculado **nunca debe cambiar retroactivamente** porque alguien editó un horario o un parámetro después (decisión ya cerrada en el plan §7 para vigencias, y consistente con el requisito de versionado de este documento, §14) — la Opción B pura no resuelve esto sin añadir, de todas formas, un mecanismo de snapshot, con lo cual termina siendo la Opción C en la práctica. Se recomienda además que `ProgramacionDiariaTrabajador` se materialice **bajo demanda** (no se pre-generen los 365 días del año para cada patrón) — mismo criterio ya usado y aprobado en el plan para la hidratación de horarios (Fase 3D: "bajo demanda, no por lotes").

## 10. Contratos de datos

### 10.1 Periodo parcial — contrato de respuesta cuando falta contexto (Fase 0 §17.2-3)

Ejemplo: se solicita calcular el plazo 25/07/2026-26/07/2026 para un patrón cuya semana (20-26/07/2026) no tiene programación diaria completa de lunes a viernes.

```
ResultadoContextoSemanal {
  estado: 'REQUIERE_CONTEXTO_SEMANAL'
  semanaInicio: '2026-07-20'
  semanaFin: '2026-07-26'
  diasConProgramacionConocida: ['2026-07-25', '2026-07-26']
  diasSinProgramacion: ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24']
  minutosTrabajadosConocidos: 440        // solo lo que sí se sabe (los 2 días del plazo)
  minutosOrdinariosAcumulados: null      // explícitamente null, NUNCA 0
  minutosExtraAcumulados: null           // explícitamente null, NUNCA 0
  accionRequerida: 'COMPLETAR_PROGRAMACION_DIARIA_SEMANA'
  motivo: 'No hay ProgramacionDiariaTrabajador para 5 de los 7 días de la semana calendario que contiene el plazo solicitado. No es posible determinar si los minutos del plazo son ordinarios o extra sin conocer el acumulado real de esos 5 días.'
  resultadoEconomico: null               // nunca se calcula bajo este estado
}
```

**Regla explícita:** este contrato **nunca** contiene un número en `minutosOrdinariosAcumulados`/`minutosExtraAcumulados` cuando faltan días — ni siquiera `0`, porque `0` es indistinguible de "se verificó y no hay acumulado", que es una afirmación distinta de "no se sabe".

### 10.2 Otros contratos de ejemplo — ver §15 (API interna) para los 4 contratos completos (construir, validar, clasificar, consultar faltante).

---

## 11. Flujo de cálculo

### 11.1 Algoritmo conceptual de clasificación ordinaria/extra (Fase 0 §17.9 — diseño conceptual, sin implementar)

**Entradas:**
- Segmentos cronológicos trabajados (salida de la Etapa 1/2, ya especificada y probada en Fase 0 — `segmentador-cronologico-referencia.ts` como referencia de comportamiento, no como código productivo).
- `ProgramacionDiariaTrabajador` del día.
- `ContextoSemanalManoObra` (acumulado antes de este día).
- `PatronTrabajadorManoObra` (jornada contractual, modalidad).
- Calendario (`CalendarioFestivos`, día de descanso obligatorio).
- `regimenLaboral`.
- Parámetros vigentes por fecha (plan §5).

**Salida — por cada segmento cronológico:**

```
SegmentoClasificado {
  fecha: string
  inicio: string
  fin: string
  minutos: number
  franja: 'DIURNA' | 'NOCTURNA'
  tipoDia: 'HABIL' | 'DESCANSO_OBLIGATORIO' | 'FESTIVO'
  clasificacion: 'ORDINARIA' | 'EXTRA'
  concepto: 'RN' | 'HE' | 'HEN' | 'DOM_FEST' | 'HEDF' | 'HENF' | 'RNF'  // los 7 conceptos ya definidos en el plan §Q
  fundamentoClasificacion: string   // ej. "Dentro de minutosOrdinariosPactados del día (360 de 360)" o "Excede minutosOrdinariosPactados del día Y el acumulado semanal ya alcanzó 2520 min"
  acumuladoSemanalAntes: number     // minutos ordinarios acumulados antes de este segmento
  acumuladoSemanalDespues: number
  fuenteDecision: 'PROGRAMACION_DIARIA' | 'ACUMULADO_SEMANAL' | 'MATRIZ_PRINCIPAL' | 'LIMITE_DIARIO_ESTANDAR'
}
```

**No valoriza dinero** — el resultado son minutos clasificados con su fundamento, nunca un valor monetario (eso es la Etapa 5, fuera de este documento).

**Lógica conceptual (orden de evaluación, sin código):**
1. Si el segmento cae en un día `tipoDia=DESCANSO_OBLIGATORIO` o `FESTIVO`: todo el segmento es una franja "dominical/festiva" (concepto `DOM_FEST`/`HEDF`/`RNF`/`HENF` según franja horaria) — la distinción ordinaria/extra dentro de un día de descanso obligatorio depende de si excede `minutosOrdinariosPactados` de ESE día (que puede ser 0 si el trabajador no debía trabajar ese día en absoluto) o el acumulado semanal, igual que un día hábil.
2. Si el día es hábil: el segmento consume primero `minutosOrdinariosPactados` del día (cronológicamente, respetando la posición real del segmento, nunca proporcionalmente); lo que excede ese consumo diario se compara contra el acumulado semanal restante (`jornadaContractualSemanalMinutos - minutosOrdinariosAcumulados`) — solo si también excede el acumulado semanal se clasifica como `EXTRA`.
3. Franja diurna/nocturna (ya resuelta en Etapa 2) determina el concepto final entre los 7 posibles, cruzado con ordinaria/extra y con tipo de día.
4. Si la matriz principal (§12) tiene un valor para `(fecha, concepto)`, reemplaza el resultado automático de ESE concepto específico — nunca decide el acumulado semanal por sí sola (la matriz informa minutos de un concepto puntual, el acumulado sigue siendo responsabilidad del contexto semanal).

### 11.2 Turnos que cruzan medianoche (Fase 0 §17.10)

Turno `22:00-06:00`: se generan, como mínimo, 2 segmentos (uno antes de medianoche con `fecha=D`, otro después con `fecha=D+1`) — mecanismo ya implementado y probado en `segmentador-cronologico-referencia.ts` (Fase 0, caso CR6). Cada segmento resultante:
- Tiene **fecha propia** (no hereda la del inicio del turno).
- Se evalúa contra `CalendarioFestivos` **independientemente** — el segmento de después de medianoche puede caer en un festivo real aunque el de antes no, y viceversa.
- Puede pertenecer a una **semana laboral distinta** si el cruce ocurre de domingo a lunes (ver §5.1).
- Puede cruzar una vigencia normativa si el cruce ocurre exactamente en la fecha de corte de una vigencia (ej. turno que empieza el 14/07/2026 23:xx y termina el 15/07/2026 0x:xx — el segundo segmento ya está bajo la jornada 42h/divisor 210).
- El **tipo de día nunca se hereda** — se resuelve de nuevo para cada segmento con su propia fecha.

---

## 12. Estados

**`ContextoSemanalManoObra.estado`:**

| Estado | Significado |
|---|---|
| `COMPLETO` | Los 7 días de la semana tienen `ProgramacionDiariaTrabajador` resuelta y confirmada |
| `REQUIERE_CONTEXTO_ANTERIOR` | Faltan días previos al plazo solicitado dentro de la misma semana |
| `REQUIERE_PROGRAMACION_DIARIA` | Existe el patrón pero no se ha materializado la programación de uno o más días |
| `INCONSISTENTE` | Datos contradictorios detectados (ej. suma de `minutosOrdinariosPactados` de la semana ≠ `jornadaContractualSemanalMinutos` sin que sea jornada flexible declarada así) |
| `BLOQUEADO_POR_PARAMETROS` | No hay `VigenciaParametrosLaborales`/`ParametrosLaborales` resuelta para alguna fecha de la semana (ej. régimen `VIGILANCIA_SEGURIDAD_PRIVADA` sin matriz — Fase 0 §18) |
| `LISTO_PARA_CLASIFICAR` | Contexto completo y consistente — puede pasar a la Etapa 3 |

**Contrato de respuesta general (`ResultadoContextoSemanal.estado`):** además de los 6 anteriores, `REQUIERE_CONTEXTO_SEMANAL` como estado de salida de más alto nivel cuando el periodo solicitado no puede resolverse (ver §10.1) — es el estado que corresponde al caso código 47.

## 13. Alertas

| Código de alerta | Dispara cuando |
|---|---|
| `SEMANA_INCOMPLETA` | Faltan uno o más días de `ProgramacionDiariaTrabajador` en la semana |
| `JORNADA_CONTRACTUAL_FALTANTE` | `PatronTrabajadorManoObra.jornadaContractualSemanalMinutos` no declarado |
| `DISTRIBUCION_DIARIA_FALTANTE` | Modalidad estándar sin `minutosOrdinariosPactados` por día |
| `DESCANSO_OBLIGATORIO_SIN_CONFIRMAR` | `diaDescansoObligatorio='PENDIENTE_CONFIRMACION'` |
| `BLOQUES_SUPERPUESTOS` | Dos bloques de la misma `ProgramacionDiariaTrabajador` se solapan (mismo error ya definido en `segmentador-cronologico-referencia.ts`) |
| `HUECOS_INCONSISTENTES` | Suma de bloques + descansos declarados no reconstruye la duración total del turno |
| `JORNADA_FLEXIBLE_SIN_ACUERDO` | `modalidadDistribucionJornada='FLEXIBLE_ACORDADA'` con `acuerdoJornadaFlexible≠true` |
| `ACUMULADO_SEMANAL_DESCONOCIDO` | Se solicita clasificar un día sin que el contexto semanal esté `COMPLETO` |
| `EXCESO_DE_JORNADA` | `minutosTrabajadosAcumulados` supera `jornadaContractualSemanalMinutos` + el margen legal de horas extra |
| `PARAMETRO_LEGAL_FALTANTE` | No hay `VigenciaParametrosLaborales` resuelta para alguna fecha |
| `CALENDARIO_FESTIVOS_INCOMPLETO` | El año de alguna fecha de la semana no tiene cobertura completa en `CalendarioFestivos` (ya identificado en el plan §G) |
| `PATRON_SIN_TRABAJADORES` | `PatronTrabajadorManoObra.cantidadTrabajadores=0` o nulo |
| `TURNO_SIN_BLOQUES` | `ProgramacionDiariaTrabajador.bloques=[]` con `tipoAsignacion` distinto de `DESCANSO`/`AUSENCIA` |
| `DOBLE_ASIGNACION_TRABAJADOR` | Dos `ProgramacionDiariaTrabajador` del mismo `patronTrabajadorId` se solapan en la misma fecha/hora |
| `MATRIZ_CONTRADICE_CALCULO_AUTOMATICO` | `alertaDiferencia=true` en la resolución de matriz principal para algún `(fecha, concepto)` |

## 14. Versionado

Cada cálculo debe poder reconstruirse posteriormente sin depender de que el patrón/programación/parámetros sigan siendo los mismos. Instantánea propuesta (extiende la ya diseñada en el plan §7 para `CostoEstructura`):

```
InstantaneaCalculoManoObra {
  versionMotor: string                    // ej. 'v2-2026-XX'
  versionContextoSemanal: number
  patronTrabajadorUtilizado: PatronTrabajadorManoObra   // copia completa, no referencia
  programacionUtilizada: ProgramacionDiariaTrabajador[] // copia completa de los 7 días
  bloques: {...}[]
  descansos: {...}[]
  acumulados: { ordinarios: number; extra: number }
  jornadaContractualSemanalMinutos: number
  regimenLaboral: string
  diaDescansoObligatorio: string
  festivosConsultados: string[]            // fechas ISO de CalendarioFestivos usadas
  parametrosVigentesUtilizados: {...}       // copia de VigenciaParametrosLaborales aplicada (plan §5)
  matrizAplicada: ResolucionHoraConcepto[]  // copia de lo resuelto en la matriz principal (plan §L)
  fechaCalculo: DateTime
}
```

**Regla explícita:** cambios futuros a `TurnoManoObra`, `PatronTrabajadorManoObra`, `HorarioCatalogo` o `ParametrosLaborales` **nunca modifican silenciosamente** un costeo histórico — este es exactamente el mismo principio ya aprobado en el plan §7 (acción explícita "Recalcular con motor nuevo", nunca automática).

## 15. APIs internas propuestas (contratos, sin implementar; no son endpoints externos públicos)

### A. Construir contexto semanal

```
construirContextoSemanal(patronTrabajadorId: number, fecha: string): ContextoSemanalManoObra
```
- Request ejemplo (contexto completo): `{ patronTrabajadorId: 12, fecha: '2026-07-25' }`
- Response (completo): `{ estado: 'LISTO_PARA_CLASIFICAR', contextoCompleto: true, minutosOrdinariosAcumulados: 1800, ... }`
- Response (parcial): ver contrato §10.1.

### B. Validar contexto

```
validarContextoSemanal(contexto: ContextoSemanalManoObra): { valido: boolean; alertas: AlertaContextoSemanal[] }
```
- Request ejemplo (turno nocturno): contexto con un segmento `22:00-06:00` — response valida que ambos segmentos (pre/post medianoche) tengan `tipoDia` resuelto independientemente.
- Request ejemplo (relevista): contexto de un `patronTrabajadorId` con `tipoAsignacion='RELEVO'` — response valida que no se solape con el patrón principal cubierto.

### C. Clasificar segmentos

```
clasificarSegmentos(segmentos: SegmentoCronologico[], contexto: ContextoSemanalManoObra, patron: PatronTrabajadorManoObra, calendario: {...}): SegmentoClasificado[]
```
- Request ejemplo (varios patrones): se invoca una vez **por patrón**, nunca una sola vez para "el cargo completo" — cada patrón tiene su propio contexto y se clasifica independientemente (Fase 0 §17.6).

### D. Consultar contexto faltante

```
consultarContextoFaltante(patronTrabajadorId: number, semanaInicio: string): { diasFaltantes: string[]; accionSugerida: string }
```
- Request/response ejemplo: mismo formato que §10.1, reutilizado como consulta independiente (para que la UI pueda, por ejemplo, mostrar "faltan 5 días de esta semana" antes de que el usuario intente calcular).

## 16. Casos de ejemplo (no implementados, listado para Fase 1A.2)

1. Semana completa estándar (jornada 42h, 6 días, sin excepciones).
2. Semana parcial (caso código 47: solo sábado y domingo).
3. Acumulado anterior desconocido (mismo caso, sin programación de lunes a viernes).
4. Jornada flexible (distribución 4-9h/día declarada, con acuerdo).
5. Jornada estándar (distribución fija 7h/día).
6. Sábado y domingo (clasificación de tipo de día correcta para cada uno).
7. Festivo real (vía `CalendarioFestivos`, no solo domingo).
8. Descanso obligatorio distinto al domingo (ej. lunes).
9. Relevista (patrón separado, `tipoAsignacion='RELEVO'`, no se suma al principal).
10. Varios patrones para el mismo cargo (principal + relevo + turnante, cada uno con su propio contexto).
11. Cambio de turno a mitad de semana.
12. Ausencia (día sin trabajo, `tipoAsignacion='AUSENCIA'`, no cuenta como ordinaria ni extra).
13. Reemplazo (`tipoAsignacion='REEMPLAZO'`).
14. Turno que cruza medianoche (22:00-06:00, dos segmentos, dos fechas).
15. Turno que cruza semana (domingo noche a lunes madrugada — dos `ContextoSemanalManoObra` distintos).
16. Turno que cruza vigencia normativa (ej. cruce del 14 al 15/07/2026).
17. Matriz principal con `null` (usa cálculo automático).
18. Matriz principal con `0` explícito (anula el concepto automático).
19. Matriz principal con valor positivo (reemplaza el concepto automático).
20. Calendario de festivos incompleto (año sin cobertura — debe alertar, no asumir "no festivo").

## 17. Migración futura

No se ejecuta en este documento. Cuando se apruebe: (1) migración aditiva — ninguna columna existente de `CargoManoObra`/`TurnoManoObra` se elimina; (2) los 3 `CargoManoObra` de "aseo" con `turnos:[]` quedan como candidatos a completar manualmente (no se les puede migrar automáticamente un patrón que nunca existió); (3) los 4 `TurnoManoObra` reales (cargos 6,7,8) sirven como primer caso de prueba real para expandir a `ProgramacionDiariaTrabajador` vía el mecanismo bajo-demanda (§9); (4) ninguna migración retroactiva sobre `CostoEstructura` (0 registros existentes hoy, confirmado en Fase 0 — no hay nada que migrar ahí todavía).

## 18. Riesgos

- **Volumen:** si `ProgramacionDiariaTrabajador` no se limita estrictamente a "bajo demanda" (§9), el volumen de filas puede crecer sin control (1 fila por trabajador×día potencialmente durante meses de contrato).
- **Consistencia patrón-programación:** si el patrón cambia (ej. nueva jornada contractual) mientras hay `ProgramacionDiariaTrabajador` ya materializada con la jornada anterior, debe quedar claro cuál de las dos versiones aplica para cálculos ya hechos (resuelto por la instantánea, §14, pero requiere disciplina de implementación).
- **Régimen de vigilancia:** este diseño es agnóstico del régimen (`regimenLaboral` es un campo del patrón), pero no se puede probar contra `VIGILANCIA_SEGURIDAD_PRIVADA` hasta tener su matriz (Fase 0 §18, sigue bloqueado).
- **Complejidad de UI:** capturar `PatronTrabajadorManoObra` + `ProgramacionDiariaTrabajador` día por día es sustancialmente más trabajo de captura para el usuario que el formulario actual de una sola jornada semanal — riesgo de fricción de adopción, a evaluar en Fase 5.
- **Dependencia de dato externo:** la calidad del contexto semanal depende de que la API de turnos (Fase 3 del plan) esté conectada — mientras no lo esté, la captura manual de `ProgramacionDiariaTrabajador` es el único camino, lo que puede hacer que `REQUIERE_CONTEXTO_SEMANAL` aparezca con más frecuencia de la deseable en el arranque de la Fase 1A.2.

## 19. Decisiones pendientes

1. ¿La "semana laboral" (lunes-domingo, `America/Bogota`) puede llegar a ser configurable por contrato en el futuro, o se mantiene como estándar único del sistema indefinidamente? (§5.1 — se dejó como estándar único por ahora, sin caso real que exija lo contrario).
2. ¿Quién verifica que la suma de programaciones individuales de todos los patrones de un cargo cubre la operación del servicio declarada (§5.2)? — no diseñado en este documento, requiere su propia fase.
3. Rango exacto de "jornada flexible" (4-9h/día) — tomado literalmente de tu mensaje de aprobación; confirmar si es un rango fijo del sistema o debe ser parametrizable por régimen/vigencia.
4. Matriz de vigencia para `VIGILANCIA_SEGURIDAD_PRIVADA` (heredado de Fase 0 §18, sigue sin resolver).
5. Proceso de completar manualmente los 3 `CargoManoObra` de "aseo" con `turnos:[]` — ¿se migran con datos ficticios de prueba, se dejan vacíos hasta tener datos reales, o se excluyen del primer piloto de Fase 1A.2?
6. Si `ProgramacionDiariaTrabajador` requiere un límite de retención/purga para plazos muy largos (ej. contratos de 12 meses) — no evaluado en este documento.

## 20. Criterios de aceptación para iniciar implementación (Fase 1A.2)

- Este documento aprobado explícitamente por el usuario.
- Confirmación de la Opción C (modelo híbrido) como diseño a implementar, o corrección explícita si se prefiere otra.
- Las 6 decisiones pendientes de §19 resueltas o explícitamente diferidas con dueño y fecha.
- Ningún campo de este diseño se implementa en Prisma hasta que exista una migración propuesta y revisada aparte (fuera de este documento).
- Los 7 archivos de prueba de Fase 0 y `FASE_0_LINEA_BASE_MANO_OBRA.md` permanecen como referencia de comportamiento esperado — cualquier implementación futura de la Etapa 1/2 debe seguir pasando `especificacion-cronologica.test.ts` sin modificarlo.
