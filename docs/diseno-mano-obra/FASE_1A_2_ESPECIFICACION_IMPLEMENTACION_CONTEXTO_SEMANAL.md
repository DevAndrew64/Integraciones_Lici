# FASE 1A.2 — Especificación técnica de implementación del contexto semanal

> **Estado: documento de diseño vigente.**
> Referencia conceptual del módulo contexto-semanal. Cualquier cambio en
> tipos o reglas debe actualizarse simultáneamente en el código y en este
> documento.

Documento exclusivamente de especificación (documental, sin ejecutar). No incluye SQL ejecutable, ni Prisma ejecutable, ni código TypeScript real. No modifica `FASE_1A_1_DISENO_CONTEXTO_SEMANAL_MANO_OBRA.md`, el Plan (revisión 7), fixtures ni pruebas. No produce cálculos económicos. No consulta APIs externas. Traduce el diseño conceptual de Fase 1A.1 a especificación exacta de implementación (campos, tipos, enums, servicios, contratos), sin implementarla.

---

## 1. Esquema propuesto (borrador, no ejecutable)

Modelos cubiertos: `PatronTrabajadorManoObra`, `ReglaSemanalPatron`, `ExcepcionProgramacionTrabajador`, `ContextoSemanalManoObra`, `InstantaneaContextoManoObra`.

**`ProgramacionDiariaTrabajador` (nombre usado en Fase 1A.1) — decisión de naturaleza:** conforme a la decisión funcional 6 de tu mensaje de aprobación, **no es un modelo persistente de todas las fechas futuras**. Se especifica como una **estructura calculada** (interfaz TypeScript, no tabla Prisma), materializada en memoria a partir de `ReglaSemanalPatron` + `ExcepcionProgramacionTrabajador` para: (a) la semana consultada, (b) el periodo solicitado, (c) las semanas necesarias para completar contexto, (d) una vista previa pedida por el usuario. **Es persistente únicamente dentro de una `InstantaneaContextoManoObra`** (§7), como copia congelada de un costeo aprobado — nunca como tabla de "todas las fechas futuras de un contrato".

```
// Estructura calculada, NO modelo Prisma
interface ProgramacionDiariaCalculada {
  patronTrabajadorId: number
  fecha: string                          // ISO "YYYY-MM-DD"
  origen: 'REGLA_SEMANAL' | 'EXCEPCION'  // de dónde se derivó
  reglaSemanalPatronId: number | null    // si origen = REGLA_SEMANAL
  excepcionId: number | null             // si origen = EXCEPCION
  turnoManoObraId: number | null
  bloques: { inicio: string; fin: string }[]
  minutosOrdinariosPactados: number
  tipoAsignacion: TipoAsignacionTrabajador
  diaDescansoObligatorioEnEstaFecha: boolean
}
```

## 2. `PatronTrabajadorManoObra`

```
model PatronTrabajadorManoObra {
  id                              Int             @id @default(autoincrement())
  cargoManoObraId                 Int
  cargoManoObra                   CargoManoObra   @relation(fields: [cargoManoObraId], references: [id], onDelete: Cascade)
  codigo                          String?         // identificador corto legible, ej. "PRINCIPAL-DIURNO"
  nombre                          String          // ej. "Operario principal turno diurno"
  descripcion                     String?
  cantidadTrabajadores            Int
  jornadaContractualSemanalMinutos Int
  modalidadDistribucionJornada    ModalidadDistribucionJornada
  acuerdoJornadaFlexible          Boolean?        // obligatorio=true cuando modalidad=FLEXIBLE_ACORDADA, ver restricciones
  regimenLaboral                  RegimenLaboral
  tipoDescanso                    TipoDescansoObligatorio
  diaDescansoObligatorio          String?         // 'L'|'M'|'X'|'J'|'V'|'S'|'D'|null si tipoDescanso=PENDIENTE_CONFIRMACION
  zonaHoraria                     String          @default("America/Bogota")
  vigenteDesde                    DateTime
  vigenteHasta                    DateTime?
  activo                          Boolean         @default(true)
  version                         Int             @default(1)
  origen                          FuenteProgramacion
  creadoPor                       String?
  actualizadoPor                  String?
  createdAt                       DateTime        @default(now())
  updatedAt                       DateTime        @updatedAt

  reglasSemanales   ReglaSemanalPatron[]
  excepciones       ExcepcionProgramacionTrabajador[]
  contextosSemanales ContextoSemanalManoObra[]

  @@index([cargoManoObraId])
  @@index([regimenLaboral])
  @@index([activo])
}
```

**Restricciones (a nivel de aplicación, no todas expresables en Prisma directamente):**

| Restricción | Dónde se aplica |
|---|---|
| `cantidadTrabajadores > 0` | Validador de servicio (§11) — Prisma no expresa `>0` nativamente, se aplica en el validador antes de escribir |
| `jornadaContractualSemanalMinutos > 0` | Idem |
| `acuerdoJornadaFlexible` obligatorio (`=== true`) cuando `modalidadDistribucionJornada === 'FLEXIBLE_ACORDADA'` | Validador de servicio — regla cruzada entre 2 campos, no expresable como constraint de columna |
| `regimenLaboral` obligatorio (no nulo) | Ya es `NOT NULL` por tipo Prisma no-opcional |
| Vigencias no superpuestas para el mismo patrón lógico (mismo `cargoManoObraId`+`codigo`) | Validador de servicio — Prisma no soporta constraints de rango de fechas sin extensión; se valida en aplicación antes de insertar una nueva vigencia |

## 3. `ReglaSemanalPatron`

Programación recurrente por día de semana — reemplaza conceptualmente a `TurnoManoObra.dias` para el propósito de contexto semanal, pero **no reemplaza `TurnoManoObra` como modelo** (ver §9).

```
model ReglaSemanalPatron {
  id                        Int                    @id @default(autoincrement())
  patronTrabajadorId        Int
  patronTrabajador          PatronTrabajadorManoObra @relation(fields: [patronTrabajadorId], references: [id], onDelete: Cascade)
  diaSemana                 String                 // 'L'|'M'|'X'|'J'|'V'|'S'|'D'
  tipoAsignacion             TipoAsignacionTrabajador
  turnoManoObraId            Int?
  turnoManoObra              TurnoManoObra?         @relation(fields: [turnoManoObraId], references: [id])
  horarioCatalogoId          Int?                   // opcional, referencia de sugerencia (ver §4)
  minutosOrdinariosPactados  Int
  orden                      Int                    @default(0)  // para permitir más de una regla el mismo día (ej. turno partido representado como 2 reglas)
  activo                     Boolean                @default(true)
  vigenteDesde               DateTime
  vigenteHasta               DateTime?

  @@index([patronTrabajadorId, diaSemana])
}
```

Representa: día trabajado (`tipoAsignacion=TURNO_ORDINARIO`, con `turnoManoObraId`), descanso (`tipoAsignacion=DESCANSO`, sin turno), ausencia programada recurrente (`tipoAsignacion=AUSENCIA`, caso raro pero posible — ej. estudio los viernes), relevo recurrente (`tipoAsignacion=RELEVO`, con su propio `turnoManoObraId` distinto al del patrón principal).

## 4. Bloques horarios

Los bloques se relacionan con **`TurnoManoObra`** (vía `ReglaSemanalPatron.turnoManoObraId`), no con una entidad `HorarioBloque` nueva en este alcance — `TurnoManoObra` ya tiene `horaInicio`/`horaFin` (un solo rango); el modelo de bloques múltiples por turno (`HorarioBloque`, con receso estructurado) es el que ya diseñó el Plan revisión 7 §Fase 3F para `HorarioCatalogo` — **se reutiliza esa misma entidad futura cuando exista**, no se duplica aquí. `HorarioCatalogoId` en `ReglaSemanalPatron` es **opcional y de solo sugerencia** — nunca fuente de verdad para el cálculo (mismo principio "el horario sugiere, el cargo confirma" ya establecido en el Plan §L).

| Distinción | Dónde vive |
|---|---|
| Dato declarado por API externa | `HorarioCatalogo.horaInicioDeclarada`/`horasSemanalesDeclaradas` (ya diseñado en el Plan §Fase 3F) |
| Dato normalizado (bloques calculados) | `HorarioBloque` (Plan §Fase 3F, no implementado aún) |
| Dato confirmado para el patrón | `TurnoManoObra.horaInicio`/`horaFin` (ya existente) referenciado por `ReglaSemanalPatron.turnoManoObraId` |
| Instantánea utilizada en el costeo | `InstantaneaContextoManoObra.bloques` (§7) — copia congelada, nunca referencia viva |

## 5. `ExcepcionProgramacionTrabajador`

```
model ExcepcionProgramacionTrabajador {
  id                       Int                    @id @default(autoincrement())
  patronTrabajadorId       Int
  patronTrabajador         PatronTrabajadorManoObra @relation(fields: [patronTrabajadorId], references: [id], onDelete: Cascade)
  fecha                    DateTime               // fecha exacta afectada
  tipoExcepcion            TipoExcepcionProgramacion
  turnoSustitutoId         Int?                   // FK a TurnoManoObra, si tipoExcepcion implica cambio de horario
  bloquesSustitutos         Json?                  // [{inicio,fin}] si el sustituto no corresponde a un TurnoManoObra existente
  motivo                    String
  fuente                    FuenteProgramacion
  usuarioConfirmo            String?
  fechaConfirmacion          DateTime?
  estado                     EstadoConfirmacion
  reglaSemanalSustituidaId   Int?                   // referencia informativa a qué ReglaSemanalPatron reemplaza este día

  @@unique([patronTrabajadorId, fecha])   // una sola excepción activa por patrón+fecha
  @@index([fecha])
}
```

Cubre: cambio de turno, descanso excepcional, trabajo adicional, reemplazo, ausencia, incapacidad, festivo no laborado, cobertura, ajuste confirmado (todos como valores de `TipoExcepcionProgramacion`, §8). **Prevalece sobre `ReglaSemanalPatron` únicamente para la fecha exacta afectada** — la regla `@@unique([patronTrabajadorId, fecha])` impide dos excepciones activas para el mismo día (una nueva excepción reemplaza, no se apila).

## 6. `ContextoSemanalManoObra`

Estructura de cálculo versionada. Se especifica como **modelo persistente ligero** (solo metadatos y totales) — la programación materializada detallada **no se persiste aquí**, se reconstruye en memoria a partir de §1/§3/§5 cada vez, salvo que forme parte de una instantánea (§7).

```
model ContextoSemanalManoObra {
  id                              Int             @id @default(autoincrement())
  patronTrabajadorId              Int
  patronTrabajador                PatronTrabajadorManoObra @relation(fields: [patronTrabajadorId], references: [id])
  semanaInicio                    DateTime        // lunes 00:00 America/Bogota
  semanaFin                       DateTime        // domingo 23:59:59 America/Bogota
  zonaHoraria                     String          @default("America/Bogota")
  versionContexto                 Int             @default(1)
  estado                          EstadoContextoSemanal
  contextoCompleto                Boolean
  jornadaContractualSemanalMinutos Int
  minutosOrdinariosProgramados    Int
  minutosTrabajadosAcumulados     Int
  minutosOrdinariosAcumulados     Int?            // null explícito si no determinable, NUNCA 0 como valor por defecto
  minutosExtraAcumulados          Int?            // idem
  alertas                         Json            // AlertaContextoSemanal[]
  parametrosLaboralesId           Int?            // referencia informativa a la vigencia resuelta (no persiste el valor, solo el id/versión)
  fechaConstruccion               DateTime        @default(now())
  hashIntegridad                  String          // hash de (patronTrabajadorId+semanaInicio+versionContexto+insumos) para detectar reconstrucción con datos distintos

  @@unique([patronTrabajadorId, semanaInicio, versionContexto])
  @@index([patronTrabajadorId, semanaInicio])
}
```

**Persiste:** metadatos, totales agregados, estado, alertas, hash de integridad. **Se construye en memoria (no persiste):** la lista día-a-día de `ProgramacionDiariaCalculada` (§1) — solo se congela dentro de una instantánea si el contexto efectivamente se usó para un costeo aprobado.

## 7. `InstantaneaContextoManoObra`

```
model InstantaneaContextoManoObra {
  id                          Int      @id @default(autoincrement())
  costoEstructuraId           Int?     // FK a CostoEstructura, cuando exista el vínculo (Plan §7)
  cargoManoObraId              Int
  patronTrabajadorId           Int
  versionMotor                 String
  versionEsquemaInstantanea    String   // ej. "v1-2026-XX" — para poder leer instantáneas antiguas si el esquema evoluciona
  cantidadTrabajadores         Int
  semanaInicio                 DateTime
  semanaFin                    DateTime
  bloques                      Json     // copia completa
  segmentosTrabajados          Json     // salida de Etapa 1/2, copia completa
  descansos                    Json
  distribucionDiaria           Json
  acumulados                   Json     // {ordinarios, extra}
  clasificacionPorFechaConcepto Json    // salida de Etapa 3, copia completa
  festivosConsultados           Json     // fechas ISO
  diaDescansoObligatorio        String
  vigenciasAplicadas             Json
  parametrosAplicados            Json
  matrizPrincipalAplicada        Json
  ajustes                        Json?
  alertasAceptadas               Json
  usuario                        String
  fechaCalculo                   DateTime @default(now())
  resultadoCalculo               Json?    // reservado para Etapa 5 (valoración económica), null en Fase 1A

  @@index([cargoManoObraId])
  @@index([patronTrabajadorId])
  @@index([fechaCalculo])
}
```

**Inmutable por diseño de uso** (Prisma no impide un `UPDATE`, pero la regla de aplicación es: **nunca se actualiza una fila existente** — un recálculo siempre `INSERT` una nueva instantánea; el servicio de escritura correspondiente, cuando exista, no debe exponer ninguna operación de actualización sobre este modelo, solo creación y lectura).

## 8. Enums

| Enum | Valores | Significado | Compatibilidad con datos existentes | Default | Sin default |
|---|---|---|---|---|---|
| `ModalidadDistribucionJornada` | `ESTANDAR`, `FLEXIBLE_ACORDADA`, `TURNOS_SUCESIVOS_ESPECIALES`, `REGIMEN_ESPECIAL` | Cómo se distribuye la jornada contractual entre los días | Nuevo — no existe hoy en ningún modelo | Ninguno — **siempre debe declararse explícitamente** (Fase 0 §17.1: nunca inferido) |
| `RegimenLaboral` | `GENERAL`, `VIGILANCIA_SEGURIDAD_PRIVADA` | Régimen normativo aplicable (Plan §5) | Ya definido conceptualmente en el Plan, no implementado en Prisma aún | Ninguno — obligatorio |
| `TipoAsignacionTrabajador` | `TURNO_ORDINARIO`, `RELEVO`, `COBERTURA_DESCANSO`, `REEMPLAZO`, `TURNO_ADICIONAL`, `DESCANSO`, `AUSENCIA`, `FESTIVO_NO_LABORADO` | Qué representa un día/regla para un patrón | Nuevo | `TURNO_ORDINARIO` solo cuando se crea desde un `TurnoManoObra` existente vía flujo estándar; en cualquier otro caso, sin default |
| `TipoDescansoObligatorio` | `FIJO`, `ROTATIVO`, `EXCEPCIONAL`, `PENDIENTE_CONFIRMACION` | Naturaleza del día de descanso del patrón | Nuevo | `PENDIENTE_CONFIRMACION` — nunca `FIJO` con domingo asumido en silencio (Fase 0 §17.5) |
| `EstadoContextoSemanal` | `COMPLETO`, `REQUIERE_CONTEXTO_ANTERIOR`, `REQUIERE_PROGRAMACION_DIARIA`, `INCONSISTENTE`, `BLOQUEADO_POR_PARAMETROS`, `LISTO_PARA_CLASIFICAR` | Estado del contexto semanal construido | Nuevo | Ninguno — se calcula siempre, nunca se asigna por defecto |
| `FuenteProgramacion` | `MANUAL`, `IMPORTADO_GEMINI`, `MIGRADO_LEGACY`, `PATRON_RECURRENTE`, `EXCEPCION_MANUAL`, `IMPORTADO_API_TURNOS` | Origen del dato, para trazabilidad | Nuevo | Ninguno — obligatorio declarar origen |
| `TipoExcepcionProgramacion` | `CAMBIO_TURNO`, `DESCANSO_EXCEPCIONAL`, `TRABAJO_ADICIONAL`, `REEMPLAZO`, `AUSENCIA`, `INCAPACIDAD`, `FESTIVO_NO_LABORADO`, `COBERTURA`, `AJUSTE_CONFIRMADO` | Tipo de excepción por fecha | Nuevo | Ninguno |
| `EstadoConfirmacion` | `PROGRAMADO`, `CONFIRMADO`, `EJECUTADO`, `MODIFICADO_POSTERIOR` | Estado de una excepción o programación | Nuevo | `PROGRAMADO` al crear, transición manual a los demás |
| `FuenteAplicadaSobretiempo` | `AUTOMATICO`, `MATRIZ_TURNO`, `COBERTURA_DESCANSO`, `AJUSTE_EXCEPCIONAL` | Ya definido en el Plan §L (`ResolucionHoraConcepto.fuenteAplicada`) — se reutiliza sin cambios | Ya diseñado, no implementado | `AUTOMATICO` cuando no hay matriz | — |

## 9. Relación con modelos actuales

| Modelo actual | Campo o relación utilizada | Cambio futuro propuesto | Compatibilidad |
|---|---|---|---|
| `CargoManoObra` | Padre de `PatronTrabajadorManoObra` (1→N) | Migración aditiva: relación inversa `patronesTrabajador PatronTrabajadorManoObra[]`; ningún campo existente se toca | Total — aditivo puro |
| `TurnoManoObra` | Referenciado por `ReglaSemanalPatron.turnoManoObraId` y `ExcepcionProgramacionTrabajador.turnoSustitutoId` | Migración aditiva: relación inversa hacia `ReglaSemanalPatron[]`; **sigue representando el turno** (horario), no se le agrega noción de "a quién" ni "cuándo" | Total — sigue siendo consumido tal cual por el endpoint `recalcular` existente, sin romper nada |
| `HorarioCatalogo` | Referenciado opcionalmente (sugerencia) desde `ReglaSemanalPatron.horarioCatalogoId` | Ninguno en este bloque — la relación bidireccional formal se añade cuando se implemente el Plan §Fase 3F | Total |
| `EscenarioManoObra` | Sin relación directa nueva — el nivel de agrupación sigue siendo el mismo | Ninguno | Total |
| `ParametrosLaborales` | Referenciado informativamente desde `ContextoSemanalManoObra.parametrosLaboralesId` | Ninguno en este bloque (la resolución real por vigencia es del Plan §5, `VigenciaParametrosLaborales`, tampoco implementado aún) | Total |
| `CalendarioFestivos` | Consultado por el futuro servicio `clasificarCalendario()` (§11), sin relación de FK persistente | Ninguno | Total |
| `CostoEstructura` | Referenciado opcionalmente desde `InstantaneaContextoManoObra.costoEstructuraId` | Migración aditiva: campo `costoEstructuraId Int?` en `CostoEstructura` o relación inversa — a definir en el bloque de migración real (fuera de este documento) | Total — `CostoEstructura` tiene 0 registros hoy (Fase 0), sin riesgo de dato existente afectado |

**Aclaraciones (verbatim de lo pedido):** `TurnoManoObra` sigue representando **el turno** (horario); `PatronTrabajadorManoObra` representa **a quién y bajo qué condiciones** se asigna (jornada, modalidad, régimen, cantidad); `ReglaSemanalPatron` representa **cuándo trabaja** (recurrente, por día de semana); `ExcepcionProgramacionTrabajador` representa **cambios por fecha concreta**; `ContextoSemanalManoObra` es **el resultado materializado** (metadatos + estado, reconstruible); `InstantaneaContextoManoObra` conserva **la evidencia histórica** inmutable.

## 10. Cargos legados sin turnos

Tratamiento técnico de los 3 `CargoManoObra` de "aseo" con `turnos:[]` (Fase 0/1A.1):

- **No se modifican automáticamente.** Ningún script de este bloque ni futuro debe escribir sobre ellos sin acción manual explícita.
- **Detección de turnos vacíos:** el servicio `construirContextoSemanal()` (§11), al no encontrar ningún `ReglaSemanalPatron` activo para el `patronTrabajadorId` solicitado (que en este caso ni siquiera existe, porque estos 3 cargos tampoco tienen `PatronTrabajadorManoObra` creado todavía), retorna `EstadoContextoSemanal.REQUIERE_PROGRAMACION_DIARIA`.
- **Alerta generada:** `"El cargo no tiene turnos ni programación individual suficiente para construir el contexto semanal"` (código de alerta propuesto: `CARGO_SIN_PROGRAMACION_INDIVIDUAL`).
- **Impide `LISTO_PARA_CLASIFICAR`:** por diseño del enum `EstadoContextoSemanal`, un contexto en `REQUIERE_PROGRAMACION_DIARIA` nunca transiciona automáticamente a `LISTO_PARA_CLASIFICAR` — requiere que un usuario cree el `PatronTrabajadorManoObra` y sus `ReglaSemanalPatron` correspondientes.
- **Regularización manual futura:** queda como tarea operativa (crear el patrón + reglas semanales para estos 3 cargos específicos), fuera del alcance de este documento — no se diseña un asistente automático de regularización aquí.
- **Conservación de datos originales:** `CargoManoObra.jornadaSemanalDeclarada=44`, `jornadaSemanalCalculada=0`, etc. permanecen sin tocar.

No se incluyen actualizaciones SQL ni scripts de corrección en este documento.

## 11. Servicios TypeScript propuestos (contratos y responsabilidades, no implementados)

| Servicio | Archivo propuesto | Entrada | Salida | Errores | Dependencias | Función pura | Consulta BD | Puede escribirse sin infraestructura |
|---|---|---|---|---|---|---|---|---|
| `construirContextoSemanal()` | `src/lib/costos-mano-obra/contexto-semanal/construir-contexto.ts` | `patronTrabajadorId`, `fecha` | `ResultadoContextoSemanal` (§12) | Ninguno lanzado — todo se modela como estado en la respuesta | `materializarProgramacionSemana`, `ParametrosLaborales`/`CalendarioFestivos` (lectura) | No (consulta BD) | Sí | No — requiere BD |
| `materializarProgramacionSemana()` | `.../materializar-programacion.ts` | `patronTrabajadorId`, `semanaInicio` | `ProgramacionDiariaCalculada[]` | `PATRON_INEXISTENTE` | `ReglaSemanalPatron`, `ExcepcionProgramacionTrabajador` (lectura) | No | Sí | No |
| `aplicarExcepcionesProgramacion()` | `.../aplicar-excepciones.ts` | `ProgramacionDiariaCalculada[]` (de regla recurrente), `ExcepcionProgramacionTrabajador[]` | `ProgramacionDiariaCalculada[]` (con excepciones aplicadas) | Ninguno | Ninguna | **Sí** | No | Sí |
| `validarContextoSemanal()` | `.../validar-contexto.ts` | `ContextoSemanalManoObra` (parcial, en construcción) | `{ valido: boolean; alertas: AlertaContextoSemanal[] }` | Ninguno | Ninguna | **Sí** | No | Sí |
| `segmentarBloquesTrabajados()` | `.../segmentar-bloques.ts` | Bloques + fecha (mismo contrato que `segmentador-cronologico-referencia.ts` de Fase 0) | Segmentos cronológicos | Errores controlados (`BLOQUE_INVALIDO_*`, igual que la referencia de pruebas) | Ninguna | **Sí** | No | Sí — **este es el candidato directo a promover `segmentador-cronologico-referencia.ts` de referencia de pruebas a implementación real**, sin alterar su contrato |
| `clasificarFranjaHoraria()` | `.../clasificar-franja.ts` | Segmentos + vigencia horario nocturno | Segmentos con franja diurna/nocturna | Ninguno | Ninguna | **Sí** | No | Sí |
| `clasificarOrdinariaExtra()` | `.../clasificar-ordinaria-extra.ts` | Segmentos clasificados por franja + `ContextoSemanalManoObra` + `PatronTrabajadorManoObra` | Segmentos clasificados ordinaria/extra (Fase 1A.1 §11.1) | Ninguno | Ninguna | **Sí** | No | Sí |
| `clasificarCalendario()` | `.../clasificar-calendario.ts` | Fecha + `CalendarioFestivos` + `diaDescansoObligatorio` | `tipoDia` por fecha | Ninguno | `CalendarioFestivos` (lectura) | No (consulta BD) | Sí | No |
| `aplicarMatrizSobretiempos()` | `.../aplicar-matriz.ts` | Segmentos clasificados + matriz principal (Plan §L) | Segmentos con `fuenteAplicada` resuelta | Ninguno | Ninguna | **Sí** | No | Sí |
| `construirInstantaneaCosteo()` | `.../construir-instantanea.ts` | Todo lo anterior consolidado + usuario | `InstantaneaContextoManoObra` (payload listo para insertar) | Ninguno | Ninguna | **Sí** (construye el objeto; la escritura en BD es responsabilidad de otra capa) | No | Sí |

## 12. Contratos de respuesta

```ts
type ResultadoContextoSemanal =
  | ContextoSemanalListo
  | ContextoSemanalIncompleto
  | ContextoSemanalInconsistente
  | ContextoSemanalBloqueado;

interface ContextoSemanalListo {
  estado: 'LISTO_PARA_CLASIFICAR';
  contexto: ContextoSemanalManoObraDTO;   // incluye acumulados numéricos reales, nunca null aquí
}
interface ContextoSemanalIncompleto {
  estado: 'REQUIERE_PROGRAMACION_DIARIA' | 'REQUIERE_CONTEXTO_ANTERIOR';
  diasFaltantes: string[];
  diasConocidos: string[];
  minutosConocidos: number;               // solo lo verificable, nunca extrapolado
  accionRequerida: string;
}
interface ContextoSemanalInconsistente {
  estado: 'INCONSISTENTE';
  inconsistencias: { campo: string; detalle: string }[];
}
interface ContextoSemanalBloqueado {
  estado: 'BLOQUEADO_POR_PARAMETROS';
  motivo: string;
  regimenLaboral: RegimenLaboral;
  vigenciaFaltante: { desde: string; hasta: string | null };
}
```

Cada variante tiene campos propios — **ningún campo `null` sin estado claro**: la unión discriminada por `estado` obliga a que cada consumidor maneje explícitamente cada caso (TypeScript exhaustivo con `switch`), en vez de un objeto único con 6 campos opcionales que dejarían ambiguo si `null` significa "no aplica" o "no se sabe".

**Ejemplos JSON:**

```json
// LISTO_PARA_CLASIFICAR
{ "estado": "LISTO_PARA_CLASIFICAR", "contexto": { "patronTrabajadorId": 12, "semanaInicio": "2026-07-20", "semanaFin": "2026-07-26", "minutosOrdinariosAcumulados": 1980, "minutosExtraAcumulados": 20, "contextoCompleto": true } }
```
```json
// REQUIERE_PROGRAMACION_DIARIA (caso código 47)
{ "estado": "REQUIERE_PROGRAMACION_DIARIA", "diasFaltantes": ["2026-07-20","2026-07-21","2026-07-22","2026-07-23","2026-07-24"], "diasConocidos": ["2026-07-25","2026-07-26"], "minutosConocidos": 440, "accionRequerida": "COMPLETAR_PROGRAMACION_DIARIA_SEMANA" }
```
```json
// REQUIERE_CONTEXTO_ANTERIOR
{ "estado": "REQUIERE_CONTEXTO_ANTERIOR", "diasFaltantes": ["2026-07-20","2026-07-21"], "diasConocidos": ["2026-07-22","2026-07-23","2026-07-24","2026-07-25","2026-07-26"], "minutosConocidos": 2200, "accionRequerida": "COMPLETAR_INICIO_SEMANA" }
```
```json
// BLOQUEADO_POR_PARAMETROS (vigilancia sin matriz)
{ "estado": "BLOQUEADO_POR_PARAMETROS", "motivo": "El régimen de vigilancia no se encuentra parametrizado para esta vigencia", "regimenLaboral": "VIGILANCIA_SEGURIDAD_PRIVADA", "vigenciaFaltante": { "desde": "2026-07-20", "hasta": null } }
```
```json
// INCONSISTENTE
{ "estado": "INCONSISTENTE", "inconsistencias": [{ "campo": "minutosOrdinariosPactados", "detalle": "Suma semanal (2600 min) supera jornadaContractualSemanalMinutos (2520 min) sin modalidad FLEXIBLE_ACORDADA" }] }
```

## 13. APIs internas

| Operación | Naturaleza | Lectura/Escritura |
|---|---|---|
| Construir contexto | Servicio de dominio (`construirContextoSemanal`) | Lectura (BD) + cálculo puro |
| Consultar contexto (uno ya construido, sin reconstruir) | Función interna sobre `ContextoSemanalManoObra` persistido | Lectura |
| Validar contexto | Función interna pura (`validarContextoSemanal`) | Ninguna (recibe el objeto ya construido) |
| Obtener faltantes | Función interna (`consultarContextoFaltante`, ya nombrada en Fase 1A.1) | Lectura |
| Confirmar programación | Servicio de dominio — transiciona una `ExcepcionProgramacionTrabajador` o `ReglaSemanalPatron` a `CONFIRMADO` | Escritura |
| Recalcular contexto | Servicio de dominio — invoca `construirContextoSemanal` de nuevo, incrementa `versionContexto`, nunca sobrescribe la instantánea previa si ya existe una | Lectura + Escritura (nueva fila de `ContextoSemanalManoObra`, nunca `UPDATE` de una instantánea) |

**No se exponen endpoints públicos en este bloque** — todo lo anterior vive como funciones/servicios de `src/lib/costos-mano-obra/contexto-semanal/`, consumibles desde un futuro endpoint interno (`/api/costos/mano-obra/.../contexto-semanal`, no diseñado aquí) cuando se apruebe conectar a la UI.

## 14. Validaciones

| Regla | Validador |
|---|---|
| Patrones superpuestos (mismo `cargoManoObraId`+`codigo`, vigencias que se cruzan) | `validarContextoSemanal` (o un validador de patrón dedicado, a nivel de escritura de `PatronTrabajadorManoObra`) |
| Reglas semanales duplicadas (mismo `patronTrabajadorId`+`diaSemana`+`orden` activos simultáneamente) | Validador de `ReglaSemanalPatron` |
| Bloques superpuestos | Reutiliza la lógica ya probada de `segmentador-cronologico-referencia.ts` (Fase 0) — mismo criterio, sin reimplementar |
| Excepciones contradictorias (dos excepciones para la misma fecha) | Constraint `@@unique([patronTrabajadorId, fecha])` en `ExcepcionProgramacionTrabajador` — a nivel de BD, no solo de aplicación |
| Doble asignación (mismo trabajador con 2 patrones activos que se solapan en fecha/hora) | Validador de nivel superior — requiere cruzar `ProgramacionDiariaCalculada` de distintos patrones del mismo cargo, no de un patrón aislado |
| Descanso no confirmado | `tipoDescanso=PENDIENTE_CONFIRMACION` → alerta `DESCANSO_OBLIGATORIO_SIN_CONFIRMAR` (ya definida en Fase 1A.1 §13) |
| Jornada flexible sin acuerdo | `modalidadDistribucionJornada=FLEXIBLE_ACORDADA` con `acuerdoJornadaFlexible≠true` → rechaza la escritura del patrón, no solo alerta |
| Acumulado previo ausente | `EstadoContextoSemanal.REQUIERE_CONTEXTO_ANTERIOR` |
| Contexto parcial | `EstadoContextoSemanal.REQUIERE_PROGRAMACION_DIARIA` |
| Régimen sin parámetros | `EstadoContextoSemanal.BLOQUEADO_POR_PARAMETROS` (decisión funcional 4 de tu mensaje — vigilancia) |
| Calendario incompleto | Alerta `CALENDARIO_FESTIVOS_INCOMPLETO` (ya definida en Fase 1A.1 §13), no bloquea, pero degrada `contextoCompleto` a advertencia |
| Turno que cruza semana | `construirContextoSemanal` debe invocarse dos veces (una por cada semana afectada) — cada segmento post-medianoche-de-domingo pertenece al `ContextoSemanalManoObra` de la semana siguiente |
| Turno que cruza vigencia | No es una validación de rechazo — cada segmento resuelve su propia vigencia (Fase 1A.1 §5.1); se documenta como comportamiento esperado, no como error |
| Cantidad de trabajadores inválida | `cantidadTrabajadores > 0` — rechaza escritura |
| Patrón sin días de trabajo | Alerta si un `PatronTrabajadorManoObra` activo no tiene ninguna `ReglaSemanalPatron` con `tipoAsignacion≠DESCANSO` |
| Operación no cubierta | **Fuera de alcance de este documento** — pertenece a la validación de cobertura de servicio (decisión funcional 2 de tu mensaje: validación separada a nivel de `CargoManoObra`/servicio/escenario, no del clasificador individual) |

## 15. Estrategia de migración futura (no ejecutada aquí)

1. Crear los enums nuevos (§8) — aditivo, sin impacto en datos existentes.
2. Crear los modelos nuevos (§2-7) — aditivo, todos con relaciones opcionales o `onDelete: Cascade` desde el lado nuevo hacia el existente (nunca al revés).
3. No eliminar ningún campo actual de `CargoManoObra`/`TurnoManoObra`/`HorarioCatalogo`/`CalendarioFestivos`/`ParametrosLaborales`/`CostoEstructura`.
4. No migrar automáticamente los 3 cargos sin turnos (§10) — quedan en `REQUIERE_PROGRAMACION_DIARIA` hasta regularización manual.
5. Mantener el motor viejo (`page.tsx`) y `motor-mano-obra.ts`/`recalcular` operativos sin cambios — el contexto semanal es una capa nueva en paralelo, no un reemplazo inmediato.
6. Usar un feature flag (§16) para construir contextos **en modo sombra** — calcular y persistir `ContextoSemanalManoObra`/alertas sin que ningún resultado se muestre todavía en UI ni afecte ningún costeo real.
7. Comparar resultados del modo sombra contra el comportamiento legacy caracterizado en Fase 0 (`caracterizacion-motor-viejo.test.ts` como referencia) — mismo patrón de "reporte de comparación" ya aprobado en el Plan §8 Opción A.
8. Activar por escenario o usuario específico (no un interruptor global) cuando el modo sombra valide consistencia suficiente.
9. Rollback: como toda la migración es aditiva y ningún dato existente se sobrescribe, el rollback es **desactivar el feature flag** — no requiere revertir ninguna migración de esquema para volver al comportamiento actual (las tablas nuevas simplemente dejan de consultarse).

## 16. Feature flags

| Flag | Valor por defecto | Alcance | Dependencia | Comportamiento si está desactivado | Estrategia de retiro |
|---|---|---|---|---|---|
| `CONTEXTO_SEMANAL_MO_ENABLED` | `false` | Global, o por escenario/usuario (a definir en implementación) | Ninguna | El sistema opera exactamente igual que hoy — ningún `PatronTrabajadorManoObra` se lee ni se construye | Se retira cuando el motor corregido sea el único camino soportado (Fase 5) |
| `CLASIFICADOR_CRONOLOGICO_MO_ENABLED` | `false` | Depende de `CONTEXTO_SEMANAL_MO_ENABLED=true` | `CONTEXTO_SEMANAL_MO_ENABLED` | Los servicios de Etapa 1-3 (§11) no se invocan, aunque existan como código | Se retira junto con el anterior |
| `MOTOR_FINANCIERO_UNIFICADO_MO_ENABLED` | `false` | Depende de los dos anteriores | `CLASIFICADOR_CRONOLOGICO_MO_ENABLED` | `liquidador-mo.ts` sigue sin conectarse a nada (estado actual) | Se retira cuando el Plan Fase 2 quede aprobada y estable |
| `API_TURNOS_MO_ENABLED` | Ya existe implícitamente como comportamiento actual (fallback a catálogo local si falla) | No aplica a este documento — mencionado por completitud, pertenece al Plan Fase 3 | Ninguna | N/A | N/A |

## 17. Plan de pruebas (especificado, no creado)

| Archivo futuro | Casos |
|---|---|
| `patron-trabajador.test.ts` | Validación de `cantidadTrabajadores>0`, `acuerdoJornadaFlexible` obligatorio con `FLEXIBLE_ACORDADA`, vigencias no superpuestas |
| `materializacion-programacion.test.ts` | Semana completa desde `ReglaSemanalPatron`; semana con excepciones aplicadas; excepción que reemplaza exactamente 1 día sin afectar los demás |
| `contexto-semanal-parcial.test.ts` | Caso código 47 (§Fase 0) reproducido como `REQUIERE_PROGRAMACION_DIARIA`; caso con 2 días conocidos + 5 desconocidos como `REQUIERE_CONTEXTO_ANTERIOR` |
| `contexto-semanal-completo.test.ts` | Semana completa estándar; semana completa flexible |
| `clasificacion-descansos.test.ts` | Descanso distinto a domingo; descanso `PENDIENTE_CONFIRMACION` genera alerta y no bloquea construcción, pero sí bloquea `LISTO_PARA_CLASIFICAR` |
| `relevistas-multiples-patrones.test.ts` | 2 patrones del mismo cargo, contextos independientes, sin mezclar acumulados |
| `medianoche-cambio-semana.test.ts` | Turno 22:00-06:00; turno que cruza de domingo a lunes (2 `ContextoSemanalManoObra` distintos) |
| `cambio-vigencia.test.ts` | Semana que cruza el 15/07/2026 (jornada 44h→42h a mitad de semana) |
| `calendario-incompleto.test.ts` | Año sin cobertura de festivos — alerta, no bloqueo |
| `cargos-sin-turnos.test.ts` | Los 3 casos reales de "aseo" (Fase 0/1A.1) reproducidos como `REQUIERE_PROGRAMACION_DIARIA` con la alerta `CARGO_SIN_PROGRAMACION_INDIVIDUAL` |
| `instantanea-inmutabilidad.test.ts` | Dos cálculos sucesivos del mismo contexto producen 2 filas de `InstantaneaContextoManoObra`, nunca 1 sobrescrita |
| `feature-flags-modo-sombra.test.ts` | Con flag desactivado, ningún servicio nuevo se invoca; con flag activado, se construye y persiste sin afectar UI |
| `rollback.test.ts` | Desactivar el flag después de tener contextos construidos no rompe el comportamiento legacy existente |

## 18. Propuesta de archivos (matriz)

| Orden | Archivo futuro | Nuevo/modificado | Propósito | Dependencias | Riesgo |
|---:|---|---|---|---|---|
| 1 | `src/lib/costos-mano-obra/contexto-semanal/enums.ts` | Nuevo | Enums de dominio (§8), sin Prisma | Ninguna | Ninguno |
| 2 | `src/lib/costos-mano-obra/contexto-semanal/tipos.ts` | Nuevo | Interfaces TypeScript puras (contratos §1, §12) | (1) | Ninguno |
| 3 | `src/lib/costos-mano-obra/contexto-semanal/validadores.ts` | Nuevo | Validadores puros (§14, sin BD) | (2) | Ninguno |
| 4 | `src/lib/costos-mano-obra/contexto-semanal/*.test.ts` | Nuevo | Pruebas unitarias aisladas de (1)-(3) | (1)-(3) | Ninguno |
| — | *(bloques posteriores, fuera de este documento — requieren aprobación de migración Prisma antes de continuar)* | | | | |

**El primer bloque de implementación futuro (1A.3A, sugerido) se limita exactamente a enums + tipos de dominio + validadores puros + pruebas unitarias aisladas — sin tocar Prisma, sin tocar `page.tsx`, sin servicios que consulten BD.**

## 19. Orden de implementación (bloques pequeños, cada uno aprobable por separado)

| Bloque | Contenido | Pruebas | Rollback | Criterio de aceptación |
|---|---|---|---|---|
| **1A.3A** | Enums + tipos de dominio + validadores puros (§18, filas 1-4) | Unitarias sobre los validadores puros | Eliminar los archivos nuevos — cero impacto, nada los consume todavía | `tsc`/`eslint`/`vitest` limpios; cero cambios en Prisma o BD |
| **1A.3B** | Migración Prisma aditiva: enums + 5 modelos nuevos (§2-7), sin tocar modelos existentes | Ninguna de código todavía — solo verificación de que `prisma migrate dev`/`db push` no rompe el esquema actual | `prisma migrate resolve --rolled-back` o migración inversa aditiva (DROP de las tablas nuevas, ninguna existente afectada) | Migración revisada y aprobada explícitamente antes de ejecutar; build limpio |
| **1A.3C** | Servicios puros de Etapa 1-2 (`segmentarBloquesTrabajados`, `clasificarFranjaHoraria`) — promovidos desde `segmentador-cronologico-referencia.ts` sin alterar su contrato | `especificacion-cronologica.test.ts` (Fase 0) sigue pasando sin modificarse; nuevas pruebas del servicio productivo en paralelo | Eliminar los archivos nuevos — el motor viejo sigue intacto, nada lo consume | Mismo comportamiento verificado que la referencia de Fase 0 |
| **1A.3D** | Servicios con BD: `construirContextoSemanal`, `materializarProgramacionSemana`, `clasificarCalendario` | Pruebas de integración con BD de prueba | Feature flag `CONTEXTO_SEMANAL_MO_ENABLED=false` | Modo sombra funcional sin afectar UI |
| **1A.3E** | `clasificarOrdinariaExtra`, `aplicarMatrizSobretiempos`, `construirInstantaneaCosteo` | Pruebas del caso código 47 con contexto completo simulado | Flags desactivados | Reproduce exactamente los casos de §17 |
| **1A.3F** | Feature flags + reporte de comparación en modo sombra (Plan §8 Opción A) | — | Desactivar flags | Reporte de comparación revisado por el usuario |

No se avanza de un bloque al siguiente sin aprobación manual explícita, igual que en Fase 0.

## 20. Criterios para aprobar implementación

- Diseño sin contradicciones (verificado entre este documento y Fase 1A.1 — sin hallar ninguna en esta redacción).
- Campos y enums cerrados (§8) — cualquier adición futura de valores de enum se trata como cambio de diseño, no como implementación silenciosa.
- Ningún dato histórico se sobrescribe — `InstantaneaContextoManoObra` es solo-inserción por regla de aplicación.
- Cargos sin turnos quedan bloqueados en `REQUIERE_PROGRAMACION_DIARIA`, nunca autocompletados.
- Contexto parcial nunca asume acumulado cero — `minutosOrdinariosAcumulados`/`minutosExtraAcumulados` son `number | null`, nunca con default `0`.
- Minutos enteros como unidad interna en todos los modelos y contratos de este documento.
- Zona horaria explícita (`America/Bogota`) en cada modelo relevante, campo propio, no supuesto implícito.
- Régimen general (`GENERAL`) puede avanzar independientemente de `VIGILANCIA_SEGURIDAD_PRIVADA` (bloqueado por diseño, §10 de Fase 1A.1 / decisión funcional 4 de este mensaje).
- Instantánea inmutable por regla de aplicación (Prisma no lo impone a nivel de esquema, pero ningún servicio propuesto expone actualización).
- Estrategia de feature flag definida (§16), con dependencia explícita entre flags y comportamiento por defecto desactivado.
- Plan de pruebas previsto (§17) antes de escribir cualquier servicio real.
- Migración reversible (§15, §19 bloque 1A.3B) — aditiva, sin campos eliminados, rollback sin pérdida de datos existentes.

---

## 21. Corrección — reclasificación de decisiones (las 6 de Fase 1A.1 §19 no siguen "abiertas")

**Error a corregir:** el entregable de cierre del Bloque 1A.2 afirmó "las 6 decisiones de Fase 1A.1 §19 siguen abiertas". Eso es incorrecto — 5 de esas 6 decisiones fueron cerradas explícitamente en el mensaje de aprobación que autorizó este mismo bloque (Fase 1A.2), antes de que este documento se redactara. Confundir "decisión funcional cerrada cuyo detalle técnico se resuelve durante la implementación" con "decisión pendiente" es un error de clasificación, no un matiz — se corrige aquí formalmente.

### A. Decisiones funcionales cerradas (ya no pendientes)

1. **Semana laboral y zona horaria** — lunes 00:00 a domingo 23:59:59, `America/Bogota`, no configurable por contrato en la primera versión, arquitectura preparada para configurabilidad futura, turnos domingo→lunes se dividen entre las dos semanas correspondientes. **DECISIÓN FUNCIONAL APROBADA.**
2. **Cobertura de la operación del servicio** — se valida por separado, a nivel de `CargoManoObra`/servicio/escenario; no es responsabilidad del clasificador individual de horas (§11 de este documento, servicios `construirContextoSemanal`/`clasificarOrdinariaExtra`, todos alcance-patrón, nunca alcance-servicio). **DECISIÓN FUNCIONAL APROBADA.**
3. **Rango de jornada flexible** — no hardcodeado en el clasificador; se obtiene de parámetros vigentes por régimen (mínimo 240 min, máximo 540 min como referencia inicial para régimen general, con vigencia y fuente normativa). **DECISIÓN FUNCIONAL APROBADA PARA EL DISEÑO.**
4. **Cargos sin turnos** — no se migran automáticamente, no reciben turno por defecto, no se eliminan, no se recalculan silenciosamente; quedan en `REQUIERE_PROGRAMACION_DIARIA` con alerta `CARGO_SIN_PROGRAMACION_INDIVIDUAL` (§10), pendientes de regularización manual y auditable. **DECISIÓN FUNCIONAL APROBADA.**
5. **Materialización y retención** — patrones/reglas/excepciones se conservan (persistencia permanente); `ProgramacionDiariaCalculada` se materializa bajo demanda (nunca todas las fechas futuras); cada costeo aprobado conserva una instantánea inmutable; la purga fija por cantidad de días queda sin definir. **ARQUITECTURA APROBADA.**

Ninguna de estas 5 es una decisión pendiente. Lo que puede seguir resolviéndose durante la implementación (categoría B, no C ni D) son detalles técnicos que ya tienen regla funcional aprobada — por ejemplo, la carga concreta de los valores 240/540 minutos en `VigenciaParametrosLaborales` (Plan §5), o la política administrativa exacta de retención/purga de `ContextoSemanalManoObra` — ninguno de estos detalles bloquea ni contradice la decisión ya cerrada.

### B. Decisión que sí sigue pendiente y bloqueante (solo para vigilancia)

6. **Régimen `VIGILANCIA_SEGURIDAD_PRIVADA`** — matriz de jornada/divisor/recargo sin validar normativa ni funcionalmente. Mientras no exista: no se infieren parámetros, no se copian los del régimen general, no se activa jornada extendida automáticamente; el sistema devuelve `BLOQUEADO_POR_PARAMETROS`. **PENDIENTE DE DEFINICIÓN — NO BLOQUEA EL RÉGIMEN GENERAL.**

### Clasificación en 4 categorías (según lo exigido)

| Categoría | Contenido |
|---|---|
| **A. Decisiones funcionales cerradas** | Semana laboral/zona horaria; cobertura de operación (responsabilidad, no diseño detallado); rango de jornada flexible (regla de diseño); cargos sin turnos; arquitectura de materialización/retención |
| **B. Detalles técnicos que se resuelven durante la implementación** | Carga concreta de 240/540 min en `VigenciaParametrosLaborales`; diseño detallado del validador de cobertura de servicio (Fase 1A.3+ posterior, fuera de contexto semanal); umbral exacto de retención/purga administrativa |
| **C. Mejoras futuras no bloqueantes** | Configurabilidad de semana laboral por contrato (si algún caso real lo exige más adelante); purga automática por antigüedad |
| **D. Decisiones realmente pendientes y bloqueantes** | Únicamente la matriz de vigencia de `VIGILANCIA_SEGURIDAD_PRIVADA` — y solo bloquea ese régimen, no el régimen `GENERAL` |

### Matriz de decisiones

| Decisión | Estado | Regla aprobada | Bloquea 1A.3A | Bloquea régimen general |
|---|---|---|---|---|
| Semana laboral (lunes-domingo) | DECISIÓN FUNCIONAL APROBADA | §1 de este documento / Fase 1A.1 §5.1 | No | No |
| Zona horaria (`America/Bogota`) | DECISIÓN FUNCIONAL APROBADA | Campo `zonaHoraria` en `PatronTrabajadorManoObra`/`ContextoSemanalManoObra` | No | No |
| Cobertura del servicio | DECISIÓN FUNCIONAL APROBADA (responsabilidad); diseño detallado en categoría B | Fuera del clasificador individual — validador separado futuro | No | No |
| Rango flexible (240-540 min) | DECISIÓN FUNCIONAL APROBADA PARA EL DISEÑO | §3 y §14 de este documento | No | No |
| Vigilancia (`VIGILANCIA_SEGURIDAD_PRIVADA`) | PENDIENTE DE DEFINICIÓN | `BLOQUEADO_POR_PARAMETROS` mientras no exista matriz | No | **Sí, solo para ese régimen — no para `GENERAL`** |
| Cargos sin turnos (3 casos "aseo") | DECISIÓN FUNCIONAL APROBADA | §10 de este documento | No | No |
| Materialización diaria (bajo demanda) | ARQUITECTURA APROBADA | §1, §6 de este documento | No | No |
| Retención/purga | ARQUITECTURA APROBADA (política exacta en categoría B) | §6, §15 de este documento — "no definir todavía purga fija" | No | No |
| Instantánea histórica (inmutable) | DECISIÓN FUNCIONAL APROBADA | §7 de este documento | No | No |

**Conclusión de la matriz:**
- Ninguna de las decisiones cerradas (categoría A) bloquea la Fase 1A.3A.
- Vigilancia (única decisión de categoría D) no bloquea la implementación del régimen general — bloquea exclusivamente el régimen `VIGILANCIA_SEGURIDAD_PRIVADA`.
- La Fase 1A.3A puede limitarse a tipos y validadores independientes de Prisma y de los parámetros concretos de vigilancia — no depende de ninguna fila de la matriz para poder ejecutarse.

---

## 22. Revisión de los modelos propuestos — verificación de no solapamiento

| Modelo | Responsabilidad única |
|---|---|
| `PatronTrabajadorManoObra` | Identidad laboral y reglas contractuales del grupo de trabajadores (quién, cuántos, bajo qué jornada/modalidad/régimen) |
| `ReglaSemanalPatron` | Recurrencia semanal (cuándo trabaja, de forma repetitiva por día de semana) |
| `ExcepcionProgramacionTrabajador` | Alteraciones puntuales por fecha concreta (cuándo cambia respecto a la recurrencia) |
| `ProgramacionDiariaCalculada` | Estructura temporal en memoria — nunca tabla permanente, es la combinación resuelta de regla + excepciones para un rango de fechas concreto |
| `ContextoSemanalManoObra` | Resultado calculado y validado para una semana — metadatos, totales, estado; no contiene la programación día-a-día como dato editable |
| `InstantaneaContextoManoObra` | Evidencia histórica inmutable ligada a un costeo aprobado |

Verificado, sin encontrar solapamiento: cada modelo tiene exactamente una responsabilidad y ningún par de modelos puede usarse indistintamente para el mismo propósito.

**Confirmaciones explícitas solicitadas:**

- **`ContextoSemanalManoObra` no debe convertirse en una segunda fuente editable de programación.** Confirmado por diseño: en el esquema de §6, el modelo no tiene ningún campo que represente bloques/turnos editables día a día — solo `minutosOrdinariosProgramados`/`minutosTrabajadosAcumulados` (agregados numéricos) y `alertas` (Json de solo lectura). Ningún servicio propuesto en §11 escribe programación individual a través de este modelo — `aplicarExcepcionesProgramacion` y `materializarProgramacionSemana` leen de `ReglaSemanalPatron`/`ExcepcionProgramacionTrabajador`, nunca de `ContextoSemanalManoObra`.
- **La programación recurrente (`ReglaSemanalPatron`) y las excepciones (`ExcepcionProgramacionTrabajador`) son las únicas fuentes editables.** Confirmado — son los dos únicos modelos de este diseño con campos de captura humana (`usuarioConfirmo`, `fechaConfirmacion`, `motivo`, etc.) y sin marca de inmutabilidad.
- **El contexto es un resultado derivado, no una fuente.** Confirmado — `ContextoSemanalManoObra` se reconstruye determinísticamente a partir de `ReglaSemanalPatron`+`ExcepcionProgramacionTrabajador`+parámetros vigentes; dos reconstrucciones con los mismos insumos deben producir el mismo resultado (de ahí el campo `hashIntegridad`, §6, pensado exactamente para detectar si un "mismo" contexto se reconstruyó con insumos distintos).
- **La instantánea es histórica e inmutable.** Confirmado — `InstantaneaContextoManoObra` (§7) no tiene ningún campo de estado editable ni relación de actualización propuesta en ningún servicio de §11; `construirInstantaneaCosteo()` solo construye el payload para `INSERT`, nunca para `UPDATE`.

---

## 23. Preparación de Fase 1A.3A — propuesta definitiva (no implementada)

### FASE 1A.3A — Tipos de dominio y validadores puros

**1. Archivos que se crearían:**

| Archivo | Propósito |
|---|---|
| `src/lib/costos-mano-obra/contexto-semanal/enums.ts` | Los 9 enums de dominio (§8 de este documento) |
| `src/lib/costos-mano-obra/contexto-semanal/tipos.ts` | Interfaces de dominio puras: `ProgramacionDiariaCalculada`, `ResultadoContextoSemanal` (unión discriminada, §12) y sus 4 variantes, `AlertaContextoSemanal` |
| `src/lib/costos-mano-obra/contexto-semanal/validadores.ts` | Validadores puros descritos en §14 que no requieren BD: formato de rango flexible (240-540 min por defecto, parametrizable), coherencia `acuerdoJornadaFlexible`↔`modalidadDistribucionJornada`, `cantidadTrabajadores>0`, `jornadaContractualSemanalMinutos>0`, detección de excepciones/reglas contradictorias sobre listas ya cargadas en memoria (sin tocar BD) |
| `src/lib/costos-mano-obra/contexto-semanal/enums.test.ts` | Pruebas de los enums (valores esperados, exhaustividad de los `switch` de ejemplo) |
| `src/lib/costos-mano-obra/contexto-semanal/validadores.test.ts` | Pruebas unitarias de cada validador puro, con casos válidos e inválidos |

**2. Tipos y enums contenidos en cada archivo:**
- `enums.ts`: `ModalidadDistribucionJornada`, `RegimenLaboral`, `TipoAsignacionTrabajador`, `TipoDescansoObligatorio`, `EstadoContextoSemanal`, `FuenteProgramacion`, `TipoExcepcionProgramacion`, `EstadoConfirmacion`, `FuenteAplicadaSobretiempo` (exactamente los de §8, como `type` de valores literales string, no `enum` de Prisma).
- `tipos.ts`: `ProgramacionDiariaCalculada` (§1), `ResultadoContextoSemanal`/`ContextoSemanalListo`/`ContextoSemanalIncompleto`/`ContextoSemanalInconsistente`/`ContextoSemanalBloqueado` (§12), `AlertaContextoSemanal` (Fase 1A.1 §13).

**3. Validadores contenidos en cada archivo (`validadores.ts`):**
- `validarRangoJornadaFlexible(minutosOrdinariosPactados, minMinutos, maxMinutos): boolean` — recibe el rango como parámetro (nunca hardcodeado), por defecto documentado 240-540 pero sobreescribible.
- `validarAcuerdoJornadaFlexible(modalidad, acuerdoJornadaFlexible): { valido: boolean; motivo?: string }`.
- `validarCantidadTrabajadores(cantidad): boolean`.
- `validarJornadaContractualPositiva(minutos): boolean`.
- `detectarExcepcionesContradictorias(excepciones: ExcepcionProgramacionTrabajador[]): { patronTrabajadorId: number; fecha: string }[]` — opera sobre listas ya en memoria, sin consultar BD.
- `detectarReglasSemanalesDuplicadas(reglas: ReglaSemanalPatron[]): {...}[]` — idem.

**4. Pruebas unitarias previstas:** un `describe`/`it` por cada validador, con al menos un caso válido y uno o más casos inválidos por regla (siguiendo el mismo estilo ya usado en `especificacion-cronologica.test.ts` de Fase 0 — expectativas explícitas, sin snapshots).

**5. Imports permitidos:** únicamente entre los archivos nuevos de este mismo bloque (`enums.ts` ↔ `tipos.ts` ↔ `validadores.ts`), y `vitest` (`describe`, `it`, `expect`) en los `.test.ts`.

**6. Imports prohibidos:** `@/lib/prisma` o cualquier cliente de BD; `page.tsx` o cualquier componente de `src/app`; `motor-mano-obra.ts`; `liquidador-mo.ts`; cualquier endpoint bajo `src/app/api`; cualquier SDK externo (Gemini, UploadThing, etc.).

**7. Criterios de aceptación:**
- `npx tsc --noEmit` limpio.
- `npx eslint --quiet` limpio sobre los archivos nuevos.
- `npx vitest run` de los `.test.ts` nuevos, 100% en verde.
- Suite completa de Vitest sin interferencias (igual que se verificó en el Bloque 0.4A).
- Cero cambios en `git status` fuera de los archivos nuevos listados en el punto 1.
- Ningún archivo de este bloque importa Prisma, React, ni ningún módulo de producción existente.

**8. Estrategia de rollback:** eliminar los 5 archivos nuevos. Ningún otro archivo del repositorio los referencia todavía (no hay ningún import entrante desde fuera de esta misma carpeta), por lo que el rollback no tiene ningún efecto colateral — es la misma garantía de aislamiento que ya se documentó en §19, fila 1A.3A, columna "Rollback".

### Restricciones explícitas para cuando se ejecute 1A.3A

En ese bloque, cuando se autorice: no se modifica Prisma; no se modifica `page.tsx`; no se modifica `motor-mano-obra.ts`; no se modifica `liquidador-mo.ts`; no se modifica ningún endpoint; no se consulta BD; no se conectan feature flags; no se implementa segmentación productiva; no se implementa clasificación ordinaria/extra; no se implementa valorización económica; no se crea ninguno de los 5 modelos en la base de datos. Únicamente: enums TypeScript, tipos discriminados, contratos de dominio, validadores puros, pruebas unitarias aisladas.
