/**
 * Modelo de excepciones operativas del calendario TRM (Fase 2.1).
 *
 * Objetivo: representar cierres/sesiones extraordinarias documentadas (o
 * candidatas a documentar) que el calendario ordinario (Colombia + Fed,
 * calendarioFuturo.ts) no predice — SIN inventar causas ni aplicar nada
 * automáticamente sin evidencia primaria confirmada.
 *
 * REGLA DE EVIDENCIA (obligatoria): cada excepción declara su propio
 * `estadoEvidencia`. SOLO las excepciones con `estadoEvidencia ===
 * 'CONFIRMADA_PRIMARIA'` pueden modificar el resultado del calendario
 * (`resolverSesionConExcepciones`/`resolverIntervaloVigenciaEsperadoConPolitica`
 * las filtran explícitamente). Las `PENDIENTE_DOCUMENTO_PRIMARIO` y
 * `DESCARTADA` quedan en la política solo para trazabilidad/auditoría —
 * nunca alteran el cálculo. El campo `fuente` (texto libre) NUNCA es
 * suficiente por sí solo para confiar en una excepción: lo que decide es
 * `estadoEvidencia`.
 */

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type TipoExcepcionCalendario = 'CIERRE' | 'SESION_FORZADA';
export type AmbitoExcepcionCalendario = 'TRM' | 'CUD' | 'SISTEMA_CAMBIARIO';
export type EstadoEvidenciaExcepcion =
  | 'CONFIRMADA_PRIMARIA'
  | 'PENDIENTE_DOCUMENTO_PRIMARIO'
  | 'DESCARTADA';

export interface ExcepcionCalendarioTrm {
  fecha: string; // YYYY-MM-DD
  tipo: TipoExcepcionCalendario;
  ambito: AmbitoExcepcionCalendario;
  /** Ej. "Banco de la República — Carta Circular Externa GE-1360". */
  fuente: string;
  /** Identificador exacto de la circular, ej. "GE-1360-2022". */
  numeroCircular?: string;
  /** Ej. URL o identificador del documento, si existe. */
  documento?: string;
  observacion: string;
  /**
   * SOLO 'CONFIRMADA_PRIMARIA' puede modificar el calendario. El texto en
   * `fuente` es descriptivo, no probatorio por sí mismo — este campo es la
   * única puerta real de activación.
   */
  estadoEvidencia: EstadoEvidenciaExcepcion;
}

export interface ResultadoValidacionExcepciones {
  validas: boolean;
  errores: string[];
}

export interface PoliticaCalendarioTrm {
  /** Todas las excepciones conocidas, de cualquier ámbito — se conservan
   *  completas para trazabilidad, aunque solo TRM/CUD afecten la sesión. */
  excepciones: ExcepcionCalendarioTrm[];
}

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const TIPOS_VALIDOS: TipoExcepcionCalendario[] = ['CIERRE', 'SESION_FORZADA'];
const AMBITOS_VALIDOS: AmbitoExcepcionCalendario[] = ['TRM', 'CUD', 'SISTEMA_CAMBIARIO'];
const ESTADOS_EVIDENCIA_VALIDOS: EstadoEvidenciaExcepcion[] = [
  'CONFIRMADA_PRIMARIA',
  'PENDIENTE_DOCUMENTO_PRIMARIO',
  'DESCARTADA',
];

// ─── validarExcepcionesCalendario ──────────────────────────────────────────────

/**
 * Valida una lista de excepciones: fecha con formato correcto, tipo/ámbito
 * dentro del enum, fuente no vacía (toda excepción debe ser trazable), y
 * sin 2 excepciones idénticas (misma fecha+tipo+ámbito) — eso sería un
 * dato duplicado, no 2 excepciones distintas.
 */
export function validarExcepcionesCalendario(
  excepciones: ExcepcionCalendarioTrm[],
): ResultadoValidacionExcepciones {
  const errores: string[] = [];
  const vistos = new Set<string>();

  for (const ex of excepciones) {
    if (!RE_FECHA.test(ex.fecha)) {
      errores.push(`Excepción con fecha inválida: "${ex.fecha}".`);
    }
    if (!TIPOS_VALIDOS.includes(ex.tipo)) {
      errores.push(`Excepción ${ex.fecha}: tipo inválido "${ex.tipo}".`);
    }
    if (!AMBITOS_VALIDOS.includes(ex.ambito)) {
      errores.push(`Excepción ${ex.fecha}: ámbito inválido "${ex.ambito}".`);
    }
    if (!ex.fuente || !ex.fuente.trim()) {
      errores.push(`Excepción ${ex.fecha} (${ex.tipo}/${ex.ambito}): falta "fuente" — toda excepción debe ser trazable.`);
    }
    if (!ESTADOS_EVIDENCIA_VALIDOS.includes(ex.estadoEvidencia)) {
      errores.push(`Excepción ${ex.fecha}: estadoEvidencia inválido "${ex.estadoEvidencia}".`);
    }
    const clave = `${ex.fecha}|${ex.tipo}|${ex.ambito}`;
    if (vistos.has(clave)) {
      errores.push(`Excepción duplicada: ${clave}.`);
    }
    vistos.add(clave);
  }

  return { validas: errores.length === 0, errores };
}

// ─── crearPoliticaCalendarioTrm ────────────────────────────────────────────────

/**
 * Construye la política de excepciones ya validada. Lanza si la lista no
 * es válida — una política con excepciones malformadas es peor que no
 * tener política (fallaría en silencio en producción).
 */
export function crearPoliticaCalendarioTrm(excepciones: ExcepcionCalendarioTrm[]): PoliticaCalendarioTrm {
  const validacion = validarExcepcionesCalendario(excepciones);
  if (!validacion.validas) {
    throw new Error(`Política de excepciones inválida: ${validacion.errores.join(' | ')}`);
  }
  return { excepciones };
}

// ─── resolverSesionConExcepciones ──────────────────────────────────────────────

export interface ResolucionSesionConExcepciones {
  elegible: boolean;
  /** La excepción TRM/CUD que decidió el resultado, si alguna aplicó. Null
   *  si la respuesta salió de la regla ordinaria (o de una excepción de
   *  SISTEMA_CAMBIARIO, que nunca decide por sí sola — ver más abajo). */
  excepcionAplicada: ExcepcionCalendarioTrm | null;
}

/**
 * Resuelve si `fecha` es sesión elegible, aplicando la política de
 * excepciones con esta prioridad estricta:
 *   1. SESION_FORZADA (ámbito TRM o CUD, estadoEvidencia CONFIRMADA_PRIMARIA)
 *      → elegible=true, máxima prioridad.
 *   2. CIERRE (ámbito TRM o CUD, estadoEvidencia CONFIRMADA_PRIMARIA)
 *      → elegible=false.
 *   3. Si no hay excepción CONFIRMADA_PRIMARIA de ámbito TRM/CUD aplicable
 *      → cae a la regla ordinaria (`esSesionMercadoElegible`, calendario
 *      Colombia + Fed).
 *
 * Excepciones con `estadoEvidencia !== 'CONFIRMADA_PRIMARIA'`
 * (PENDIENTE_DOCUMENTO_PRIMARIO, DESCARTADA) NUNCA participan en el
 * cálculo — quedan en la política solo para trazabilidad/auditoría.
 *
 * Una excepción de ámbito SISTEMA_CAMBIARIO NUNCA decide por sí sola el
 * resultado, incluso si estuviera CONFIRMADA_PRIMARIA — se ignora en el
 * cálculo de elegibilidad (aunque sigue disponible en la política para
 * explicar/documentar). Esto es intencional: un cierre del "Sistema de
 * Información Cambiaria" (soporte técnico, reportería) no implica
 * necesariamente que no haya sesión de mercado ni certificación TRM ese
 * día — son sistemas distintos.
 */
export function resolverSesionConExcepciones(
  fecha: string,
  politica: PoliticaCalendarioTrm,
  esSesionMercadoElegibleOrdinaria: (fecha: string) => boolean,
): ResolucionSesionConExcepciones {
  const aplicables = politica.excepciones.filter(
    ex =>
      ex.fecha === fecha &&
      (ex.ambito === 'TRM' || ex.ambito === 'CUD') &&
      ex.estadoEvidencia === 'CONFIRMADA_PRIMARIA',
  );

  const forzada = aplicables.find(ex => ex.tipo === 'SESION_FORZADA');
  if (forzada) return { elegible: true, excepcionAplicada: forzada };

  const cierre = aplicables.find(ex => ex.tipo === 'CIERRE');
  if (cierre) return { elegible: false, excepcionAplicada: cierre };

  return { elegible: esSesionMercadoElegibleOrdinaria(fecha), excepcionAplicada: null };
}

// ─── resolverIntervaloVigenciaEsperadoConPolitica (sección 5) ──────────────────

import { esSesionMercadoElegible, type ConfiguracionCalendarioFuturo } from './calendarioFuturo';

export type CalendarioEstado = 'OFICIAL' | 'ESTIMADO' | 'ESTIMADO_CON_EXCEPCION';

export interface IntervaloVigenciaConEstado {
  desde: string;
  hasta: string;
  sesionOrigen: string;
  /**
   * Siempre 'ESTIMADO' o 'ESTIMADO_CON_EXCEPCION' — esta función es
   * exclusivamente para fechas SIN certificación oficial todavía.
   * 'OFICIAL' es responsabilidad de vigencias.ts (vigenciaDesde/vigenciaHasta
   * reales), nunca de este cálculo.
   */
  calendarioEstado: CalendarioEstado;
  /** Fuente de la excepción aplicada, si el resultado depende de alguna. */
  fuenteCalendario?: string;
}

function addDiasStr(fecha: string, n: number): string {
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Igual que `resolverIntervaloVigenciaEsperado` (calendarioFuturo.ts) pero
 * dejando que la `PoliticaCalendarioTrm` intervenga en cada verificación de
 * elegibilidad (sesiones forzadas / cierres extraordinarios de ámbito
 * TRM|CUD tienen prioridad sobre la regla ordinaria Colombia+Fed).
 *
 * `calendarioEstado` queda en 'ESTIMADO_CON_EXCEPCION' si CUALQUIER
 * excepción participó en determinar el intervalo devuelto; en
 * 'ESTIMADO' si el resultado salió enteramente de la regla ordinaria.
 * Para fin de año sin circular confirmada todavía (política sin
 * excepciones para esas fechas): siempre 'ESTIMADO', nunca se afirma que
 * el intervalo es definitivo.
 */
export function resolverIntervaloVigenciaEsperadoConPolitica(
  fechaObjetivo: string,
  politica: PoliticaCalendarioTrm,
  configCalendario: ConfiguracionCalendarioFuturo = {},
): IntervaloVigenciaConEstado {
  const ordinaria = (f: string) => esSesionMercadoElegible(f, configCalendario);
  let excepcionUsada: ExcepcionCalendarioTrm | null = null;

  let f = addDiasStr(fechaObjetivo, -1);
  let sesionOrigen = '';
  for (let i = 0; i < 30; i++) {
    const r = resolverSesionConExcepciones(f, politica, ordinaria);
    if (r.excepcionAplicada) excepcionUsada = r.excepcionAplicada;
    if (r.elegible) { sesionOrigen = f; break; }
    f = addDiasStr(f, -1);
  }
  if (!sesionOrigen) {
    throw new Error(`No se encontró sesión de mercado elegible retrocediendo desde ${fechaObjetivo}`);
  }

  const desde = addDiasStr(sesionOrigen, 1);
  let siguienteSesion = addDiasStr(sesionOrigen, 1);
  let hasta = '';
  for (let i = 0; i < 30; i++) {
    const r = resolverSesionConExcepciones(siguienteSesion, politica, ordinaria);
    if (r.excepcionAplicada) excepcionUsada = r.excepcionAplicada;
    if (r.elegible) { hasta = siguienteSesion; break; }
    siguienteSesion = addDiasStr(siguienteSesion, 1);
  }
  if (!hasta) {
    throw new Error(`No se encontró la siguiente sesión elegible después de ${sesionOrigen}`);
  }

  return {
    desde,
    hasta,
    sesionOrigen,
    calendarioEstado: excepcionUsada ? 'ESTIMADO_CON_EXCEPCION' : 'ESTIMADO',
    fuenteCalendario: excepcionUsada?.fuente,
  };
}
