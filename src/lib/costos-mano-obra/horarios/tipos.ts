/**
 * Contratos de dominio para la creación de horarios del catálogo
 * (Bloque HORARIOS 1). Sin dependencias de Prisma, React ni Next.js.
 * Unidad interna de duración: MINUTOS ENTEROS (mismo criterio ya usado
 * en src/lib/costos-mano-obra/contexto-semanal/ y en
 * segmentador-cronologico-referencia.ts, Fase 0 — sin importarlos, este
 * módulo es independiente para no acoplar producción a una utilidad
 * exclusiva de pruebas).
 */

export interface BloqueHorario {
  inicio: string; // "HH:mm"
  fin: string;    // "HH:mm"
  orden: number;
  // Ajuste "MODELO TEMPORAL DE DOBLE OFFSET" (Fase 5, cruce de medianoche)
  // — día calendario relativo al día operativo de referencia en el que
  // ESTE bloque inicia/termina (0 = mismo día). AMBOS opcionales:
  // compatibilidad histórica total, un bloque guardado o construido antes
  // de este ajuste (sin estos campos) se resuelve exactamente igual que
  // siempre — ver `resolverOffsetsBloque` en `tiempo-absoluto.ts`, la
  // única fuente de verdad para completarlos quando se omiten (nunca se
  // reimplementa esa inferencia en otro archivo). `offsetDiaFin` nunca es
  // menor que `offsetDiaInicio`.
  offsetDiaInicio?: number;
  offsetDiaFin?: number;
}

export interface ErrorParseoHorario {
  codigo: string;
  mensaje: string;
}

export type ResultadoParseoHorario =
  | { ok: true; bloques: BloqueHorario[]; advertencias?: string[] }
  | { ok: false; errores: ErrorParseoHorario[] };

export interface DiasJornada {
  lun: boolean; mar: boolean; mie: boolean; jue: boolean;
  vie: boolean; sab: boolean; dom: boolean; fes: boolean;
}

export interface CalculoHorario {
  bloques: BloqueHorario[];
  minutosPorBloque: number[];
  minutosDiarios: number;
  descansoMinutos: number;       // suma de huecos entre bloques (informativo)
  cantidadDiasSemana: number;    // solo lun..dom, fes nunca suma (ver normalizador-horario.ts)
  minutosSemanales: number;
  horasDiariasDecimal: number;   // para el payload externo (horas_jor)
  horasSemanalesDecimal: number; // para el payload externo (horas_sem)
  horaInicial: string;           // "HH:mm" del primer bloque
  horaFinal: string;             // "HH:mm" del último bloque
}

export interface ResumenPresentableHorario {
  horarioTexto: string;      // "08:00-12:00 / 14:00-17:20"
  horasPorDiaTexto: string;  // "7 h 20 min"
  horasPorSemanaTexto: string; // "44 h"
  cantidadBloques: number;
  descansoTexto: string;     // "2 h" o "—" si no hay descanso
  diasTexto: string;         // "Lunes a sábado" (best-effort, ver normalizador)
}

export type ResultadoValidacionCreacionHorario =
  | {
      ok: true;
      bloques: BloqueHorario[];
      calculo: CalculoHorario;
      advertencias: string[];
    }
  | { ok: false; errores: string[] };

// ── Contratos hacia la API externa (grupocolba.com) ────────────────────────

export interface PayloadCrearTurnoExterno {
  empresa: string;
  horario: string;
  turno: string;
  jornada: string;
  horas_sem: number;
  horas_jor: number;
  h_inicial: string; // "HH:mm:ss"
  h_final: string;
  cod_midasoft?: string;
  porvar?: number;
  sn_jorn_lun: boolean; sn_jorn_mar: boolean; sn_jorn_mie: boolean; sn_jorn_jue: boolean;
  sn_jorn_vie: boolean; sn_jorn_sab: boolean; sn_jorn_dom: boolean; sn_jorn_fes: boolean;
  snbono_lunes: boolean; snbono_martes: boolean; snbono_miercoles: boolean; snbono_jueves: boolean;
  snbono_viernes: boolean; snbono_sabado: boolean; snbono_domingo: boolean; snbono_festivos: boolean;
  sndiasdescanso_fijo: boolean;
  snactivo: boolean;
}

export interface DatosTurnoExterno {
  codigo?: string | number;
  id?: string | number;
  horario?: string;
  [k: string]: unknown;
}

export interface RespuestaCrearTurnoExterno {
  success: boolean;
  message?: string;
  data?: DatosTurnoExterno;
}

export type ResultadoValidacionRespuestaExterna =
  | { ok: true; data: DatosTurnoExterno }
  | { ok: false; motivo: string };

// ── Persistencia local (decisión pura, sin Prisma) ──────────────────────────

export type AccionPersistenciaHorario = 'CREAR' | 'ACTUALIZAR';

export interface HorarioCatalogoExistente {
  id: number;
  empresa: string;
  codigo: string;
}

// ── Respuesta interna de POST /api/horarios ─────────────────────────────────

export interface HorarioCatalogoRowInterna {
  id: string;
  localId: number;
  empresa: string;
  codigo: string | null;
  horario: string;
  turno: string | null;
  jornada: string | null;
  horasSemana: number;
  horasJornada: number | null;
  horaInicio: string | null;
  horaFin: string | null;
  porvar: number;
  jornLun: boolean; jornMar: boolean; jornMie: boolean; jornJue: boolean;
  jornVie: boolean; jornSab: boolean; jornDom: boolean; jornFes: boolean;
  bonoLun: boolean; bonoMar: boolean; bonoMie: boolean; bonoJue: boolean;
  bonoVie: boolean; bonoSab: boolean; bonoDom: boolean; bonoFes: boolean;
  diaDescansoFijo: boolean;
  origen: 'api' | 'local';
  sincronizadoExterno: boolean;
  bloques: BloqueHorario[];
  resumen: ResumenPresentableHorario | null;
  // true si `bloques` viene de reconstruir el texto `horario` (GET, Bloque
  // HORARIOS 2A) en vez de venir fresco de una creación (POST). Cuando es
  // false, `bloques` está vacío y `horaInicio`/`horaFin` deben tratarse como
  // dato legado — nunca como si describieran el tiempo continuo trabajado.
  bloquesReconstruidos: boolean;
  advertenciaBloques: string | null;
}

export interface RespuestaCrearHorarioInterna {
  ok: boolean;
  horario?: HorarioCatalogoRowInterna;
  bloques?: BloqueHorario[];
  minutosJornada?: number;
  minutosSemana?: number;
  horasJornada?: number;
  horasSemana?: number;
  sincronizadoExterno?: boolean;
  verificadoExterno?: boolean;
  warning?: string;
  error?: string;
}

// ── Identidad y fusión (Bloque HORARIOS 2A) ─────────────────────────────────

export interface HorarioConIdentidad {
  empresa: string;
  codigo: string | null;
}

// ── Acción de la solicitud POST /api/horarios ───────────────────────────────
// 'CREAR' (default) llama a /turnos/crear. 'RECUPERAR' NUNCA llama a
// /turnos/crear — solo reconsulta /turnos/obtener y persiste localmente lo
// ya creado externamente. La ausencia de `accion` en el body SIEMPRE se
// interpreta como 'CREAR', nunca como 'RECUPERAR'.
export type AccionSolicitudHorario = 'CREAR' | 'RECUPERAR';

export interface ParametrosRecuperacionHorario {
  empresa: string;
  codigoExterno: string;
}

// ── Respuesta de fallo cuando /turnos/crear tuvo éxito pero la persistencia
// local falló — nunca oculta codigoExterno si ya fue recibido. ─────────────
export interface RespuestaFalloCreacionHorario {
  ok: false;
  creadoExterno: boolean;
  codigoExterno?: string;
  empresa: string;
  verificadoExterno: boolean;
  requiereRecuperacionLocal: boolean;
  bloques?: BloqueHorario[];
  warning?: string;
  error?: string;
}

/** Estado de recuperación pendiente conservado temporalmente en el cliente (estado React + sessionStorage). Nunca contiene credenciales ni URLs. */
export interface RecuperacionHorarioPendiente {
  empresa: string;
  codigoExterno: string;
  horario: string;
  turno: string;
  bloques: BloqueHorario[];
  guardadoEn: string; // ISO, informativo
}

// ── Distribuciones semanales + fechas programadas (Bloque HORARIOS 2A-UNIFICADO) ──
//
// Conceptos obligatoriamente separados:
//   A. Período del servicio      -> fechaInicio/fechaFin (vive fuera de la distribución, a nivel de cargo)
//   B. Patrón semanal            -> diasSemana + bloques (fuente editable)
//   C. Excepciones por fecha     -> excepcionesFecha (fuente editable)
//   D. Fechas programadas        -> fechasProgramadas (SIEMPRE derivado de A+B+C, nunca editado directo)

export type DiaSemanaHorario = 'L' | 'M' | 'X' | 'J' | 'V' | 'S' | 'D';

export const DIAS_SEMANA_HORARIO: readonly DiaSemanaHorario[] = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

export type AccionExcepcionFecha = 'INCLUIR' | 'EXCLUIR';

export interface ExcepcionFechaProgramada {
  fecha: string; // "YYYY-MM-DD"
  accion: AccionExcepcionFecha;
}

/** Fuente editable: lo que el usuario configura para una distribución. */
export interface DistribucionHorarioConfigurada {
  idCliente: string; // identificador local (React key / edición), no es el código externo
  empresa: string;
  codigo: string;
  horario: string;
  jornada: string;
  turno: string;
  diasSemana: DiaSemanaHorario[];
  bloques: BloqueHorario[];
  excepcionesFecha: ExcepcionFechaProgramada[];
  sincronizadoExterno: boolean;
  advertencia?: string;
  // "trabajaFestivos" fue ELIMINADO (bloque de corrección de festivos): una
  // fecha festiva que cae en un día YA cubierto por diasSemana siempre se
  // trabaja por defecto — la única forma de excluirla es una excepción
  // explícita por fecha (excepcionesFecha, accion 'EXCLUIR'), nunca un
  // campo/checkbox general que decida para todos los festivos a la vez.
  //
  // "cubreFestivosFueraDePatron" es un concepto DISTINTO: si es true, esta
  // distribución también cubre fechas festivas que caen en un día de la
  // semana que NO está en diasSemana (ej. domingo festivo con patrón
  // lunes-sábado) — equivalente a sn_jorn_fes de la API externa. Nunca
  // excluye nada ya cubierto por diasSemana; solo EXTIENDE cobertura.
  cubreFestivosFueraDePatron?: boolean;
  // Ajuste "CREAR UN MODO EXPLÍCITO DE CAPTURA" — `bloques` (arriba) sigue
  // siendo la ÚNICA fuente que consume el motor de cálculo (nunca cambia
  // su semántica: siempre 1 o 2 bloques con los horarios reales
  // trabajados). Estos 3 campos son ADITIVOS, exclusivamente para que la
  // presentación y el editor sepan CÓMO se capturaron esos bloques —
  // nunca para recalcular horas. Opcionales: un registro guardado antes
  // de este ajuste no los tiene (compatibilidad histórica, ver
  // `resolverModoCapturaHorario` en page.tsx).
  //
  // 'RANGO_CON_DESCANSO': el usuario digitó UN rango continuo con un
  // descanso explícito (ej. 08:00-18:00, descanso 1h30) — `bloques` se
  // deriva partiendo ese rango (con el descanso centrado), pero la
  // presentación/edición deben usar `rangoOriginal`/`descansoAplicadoMinutos`,
  // nunca los bloques partidos.
  //
  // 'BLOQUES_INDEPENDIENTES': el usuario digitó 2 turnos genuinamente
  // distintos (ej. 08:00-12:30 y 14:00-18:00) — `bloques` YA son la
  // fuente de verdad exacta para presentación/edición, sin reconstrucción.
  modoCapturaHorario?: 'RANGO_CON_DESCANSO' | 'BLOQUES_INDEPENDIENTES';
  rangoOriginal?: { inicio: string; fin: string };
  descansoAplicadoMinutos?: number;
  // Ajuste "SIGUIENTE AJUSTE — SERVICIO PARCIAL POR TOTAL DE HORAS
  // SEMANALES" — captura alternativa para jornadas parciales ordinarias
  // (≤42h/semana) sin horario detallado: el usuario digita únicamente el
  // total de horas semanales, nunca hora de inicio/fin. `bloques` queda
  // vacío para estas distribuciones — nunca se inventan bloques ficticios
  // (§3/§10 del ajuste). Un registro guardado antes de este ajuste no
  // tiene `tipoCapturaHorario` — se resuelve siempre como
  // 'HORARIO_DETALLADO' (compatibilidad histórica total, §5/§15 pruebas).
  tipoCapturaHorario?: 'HORARIO_DETALLADO' | 'TOTAL_SEMANAL';
  /** Total de horas semanales digitado por el usuario (dato autoritativo,
   * nunca reemplazado por la suma de un promedio diario redondeado) —
   * solo presente cuando `tipoCapturaHorario==='TOTAL_SEMANAL'`. */
  horasSemanalesManual?: number;
  /** true cuando la distribución diaria mostrada (promedio) es
   * puramente informativa/inferida a partir de `horasSemanalesManual` y
   * los días seleccionados — nunca una fuente de cálculo real por
   * concepto/franja horaria. */
  distribucionInferida?: boolean;
}

/** Resultado derivado: nunca se persiste nada de esto de forma independiente. */
export interface DistribucionHorarioCalculada {
  configuracion: DistribucionHorarioConfigurada;
  fechasBase: string[];        // patrón sin excepciones (D antes de C)
  fechasProgramadas: string[]; // patrón + excepciones aplicadas (D final)
  cantidadDias: number;        // SIEMPRE fechasProgramadas.length
  minutosDia: number;
  minutosPeriodo: number;      // SIEMPRE minutosDia × cantidadDias (distribución homogénea, mismos bloques todos los días)
  bloquesReconstruidos: boolean;
  advertencias: string[];
}

// ── Solapes ──────────────────────────────────────────────────────────────

export interface ResultadoSolapePatron {
  ok: boolean;
  diasSolapados: DiaSemanaHorario[];
  advertencia: string | null; // no bloqueante por sí solo — ver validar-solapes-distribuciones.ts
}

export interface ResultadoSolapeFechas {
  ok: boolean;
  fechasSolapadas: string[];
  error: string | null; // bloqueante
}

// ── Guard del motor legado ──────────────────────────────────────────────

export type EstadoCompatibilidadMotorLegado = 'COMPATIBLE' | 'REQUIERE_MOTOR_DISTRIBUIDO';

export interface ResultadoGuardMotorLegado {
  estado: EstadoCompatibilidadMotorLegado;
  mensaje: string | null;
}
