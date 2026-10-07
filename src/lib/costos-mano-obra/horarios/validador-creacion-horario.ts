/**
 * Validación de servidor para la creación de horarios (Bloque HORARIOS 1).
 * Combina parser-horario.ts + normalizador-horario.ts. Función pura, sin
 * BD ni red — la ruta POST /api/horarios es quien la invoca y quien hace
 * las llamadas externas.
 */
import { parsearBloquesHorario } from './parser-horario';
import { calcularHorario, formatearMinutosComoHoras } from './normalizador-horario';
import type {
  DiasJornada,
  ResultadoValidacionCreacionHorario,
  PayloadCrearTurnoExterno,
  ResultadoValidacionRespuestaExterna,
  AccionPersistenciaHorario,
  HorarioCatalogoExistente,
} from './tipos';

const TOLERANCIA_HORAS = 0.01; // margen para comparar decimales de horas sin falsos positivos por redondeo

/**
 * Valida y calcula el horario en el servidor, SIN confiar en
 * horasSemana/horasJornada/horaInicio/horaFin digitados manualmente.
 * Si el usuario declaró valores que no coinciden con los bloques reales,
 * se devuelve una advertencia trazable — nunca se guardan datos
 * inconsistentes en silencio.
 */
export function validarYCalcularHorario(input: {
  empresa: string;
  horario: string;
  dias: DiasJornada;
  horasSemanaDeclarada?: number;
  horasJornadaDeclarada?: number;
}): ResultadoValidacionCreacionHorario {
  const errores: string[] = [];

  if (!input.empresa || !input.empresa.trim()) {
    errores.push('El campo "empresa" es obligatorio.');
  }
  if (!input.horario || !input.horario.trim()) {
    errores.push('El campo "horario" es obligatorio.');
  }

  const algunDiaSemana = input.dias.lun || input.dias.mar || input.dias.mie || input.dias.jue
    || input.dias.vie || input.dias.sab || input.dias.dom;
  if (!algunDiaSemana) {
    errores.push('Debe seleccionar al menos un día de lunes a domingo (festivos por sí solo no cuenta como día de operación semanal).');
  }

  if (errores.length > 0) return { ok: false, errores };

  const parseo = parsearBloquesHorario(input.horario);
  if (!parseo.ok) {
    return { ok: false, errores: parseo.errores.map(e => e.mensaje) };
  }

  const calculo = calcularHorario(parseo.bloques, input.dias);

  const advertencias: string[] = [];
  const declaradaSemana = input.horasSemanaDeclarada;
  const declaradaJornada = input.horasJornadaDeclarada;
  const difiereSemana = declaradaSemana !== undefined && Math.abs(declaradaSemana - calculo.horasSemanalesDecimal) > TOLERANCIA_HORAS;
  const difiereJornada = declaradaJornada !== undefined && Math.abs(declaradaJornada - calculo.horasDiariasDecimal) > TOLERANCIA_HORAS;
  if (difiereSemana || difiereJornada) {
    advertencias.push(
      `Las horas declaradas no coincidían con los bloques del horario. Se utilizaron ${formatearMinutosComoHoras(calculo.minutosDiarios)} diarias y ${round2(calculo.horasSemanalesDecimal)} horas semanales.`,
    );
  }

  return { ok: true, bloques: parseo.bloques, calculo, advertencias };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function aHms(hm: string): string {
  if (!hm) return '00:00:00';
  return hm.length === 5 ? hm + ':00' : hm;
}

/**
 * Construye el payload hacia POST /turnos/crear a partir de valores ya
 * validados/calculados — nunca usa `Number(x)||0` (que ocultaría un dato
 * inválido detrás de un 0 silencioso), nunca envía `undefined`, nunca
 * convierte un booleano `false` en ausencia del campo.
 */
export function construirPayloadCreacionExterna(input: {
  empresa: string;
  horario: string;
  turno: string;
  jornada: string;
  horasSemanalesDecimal: number;
  horasDiariasDecimal: number;
  horaInicial: string;
  horaFinal: string;
  codMidasoft?: string;
  porvar?: number;
  dias: DiasJornada;
  bonos: DiasJornada;
  diaDescansoFijo: boolean;
}): PayloadCrearTurnoExterno {
  return {
    empresa: input.empresa,
    horario: input.horario,
    turno: input.turno,
    jornada: input.jornada,
    horas_sem: round2(input.horasSemanalesDecimal),
    horas_jor: round2(input.horasDiariasDecimal),
    h_inicial: aHms(input.horaInicial),
    h_final: aHms(input.horaFinal),
    ...(input.codMidasoft ? { cod_midasoft: input.codMidasoft } : {}),
    ...(input.porvar !== undefined ? { porvar: input.porvar } : {}),
    sn_jorn_lun: input.dias.lun, sn_jorn_mar: input.dias.mar, sn_jorn_mie: input.dias.mie, sn_jorn_jue: input.dias.jue,
    sn_jorn_vie: input.dias.vie, sn_jorn_sab: input.dias.sab, sn_jorn_dom: input.dias.dom, sn_jorn_fes: input.dias.fes,
    snbono_lunes: input.bonos.lun, snbono_martes: input.bonos.mar, snbono_miercoles: input.bonos.mie, snbono_jueves: input.bonos.jue,
    snbono_viernes: input.bonos.vie, snbono_sabado: input.bonos.sab, snbono_domingo: input.bonos.dom, snbono_festivos: input.bonos.fes,
    sndiasdescanso_fijo: input.diaDescansoFijo,
    snactivo: true,
  };
}

/** Valida la forma de la respuesta de POST /turnos/crear antes de confiar en ella. */
export function validarRespuestaCrearTurnoExterno(respuesta: unknown): ResultadoValidacionRespuestaExterna {
  if (!respuesta || typeof respuesta !== 'object') {
    return { ok: false, motivo: 'La respuesta del servicio externo no es un objeto JSON válido.' };
  }
  const r = respuesta as Record<string, unknown>;
  if (r.success !== true) {
    return { ok: false, motivo: typeof r.message === 'string' ? r.message : 'El servicio externo no reportó éxito (success != true).' };
  }
  if (!r.data || typeof r.data !== 'object') {
    return { ok: false, motivo: 'El servicio externo no devolvió el campo "data".' };
  }
  const data = r.data as Record<string, unknown>;
  if (data.codigo === undefined || data.codigo === null || String(data.codigo).trim() === '') {
    return { ok: false, motivo: 'El servicio externo no devolvió un código de turno.' };
  }
  return { ok: true, data };
}

/**
 * Trata el código externo SIEMPRE como String — nunca lo convierte a
 * Number, nunca completa ceros inventados, nunca asume un ancho fijo.
 * Si llega como número, genera advertencia explícita: los ceros a la
 * izquierda que pudo tener ya se perdieron antes de este punto (en el
 * JSON.parse de la respuesta externa), y este código no los reconstruye.
 */
export function normalizarCodigoExterno(codigoCrudo: unknown): { codigo: string; advertencia: string | null } {
  if (typeof codigoCrudo === 'string' && codigoCrudo.trim() !== '') {
    return { codigo: codigoCrudo, advertencia: null };
  }
  if (typeof codigoCrudo === 'number' && Number.isFinite(codigoCrudo)) {
    return {
      codigo: String(codigoCrudo),
      advertencia: 'El código externo llegó como número, no como texto — no se puede confirmar si tenía ceros a la izquierda; no se completaron ceros inventados.',
    };
  }
  return { codigo: '', advertencia: 'El código externo no llegó en un formato reconocible.' };
}

/**
 * Decisión pura de crear vs. actualizar en HorarioCatalogo, por identidad
 * empresa+codigo — separada de Prisma para poder probarla sin BD real.
 * No implementa @@unique todavía (Prisma no autorizado en este bloque);
 * queda documentado que esto NO elimina una condición de carrera real —
 * ver advertencia en src/app/api/horarios/route.ts.
 */
export function decidirAccionPersistencia(existente: HorarioCatalogoExistente | null): AccionPersistenciaHorario {
  return existente ? 'ACTUALIZAR' : 'CREAR';
}
