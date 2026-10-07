/**
 * Validadores puros del contexto semanal de Mano de Obra (Fase 1A.3A).
 *
 * Importa únicamente desde enums.ts y tipos.ts. Todas las funciones son
 * puras: no lanzan errores inesperados, no consultan BD ni APIs, no leen
 * variables de entorno, no mutan sus entradas. Todas devuelven
 * ResultadoValidacion<T> (o una composición del mismo). Unidad interna de
 * toda duración: MINUTOS ENTEROS.
 *
 * No clasifican horas ni calculan dinero — esa responsabilidad pertenece
 * a etapas posteriores (Etapa 3/5, fuera de este bloque).
 */
import {
  MODALIDADES_DISTRIBUCION_JORNADA,
  REGIMENES_LABORALES,
  TIPOS_ASIGNACION_LABORADA,
  TIPOS_ASIGNACION_SIN_BLOQUES,
  TIPOS_EXCEPCION_CON_SUSTITUCION,
  type ModalidadDistribucionJornada,
  type RegimenLaboral,
  type TipoAsignacionTrabajador,
  type TipoDescansoObligatorio,
  type EstadoConfirmacion,
} from './enums';
import {
  DIAS_SEMANA,
  type DiaSemana,
  type BloqueHorarioContexto,
  type PatronTrabajadorContexto,
  type ReglaSemanalPatronContexto,
  type ExcepcionProgramacionContexto,
  type AlertaContextoSemanal,
  type ErrorValidacionDominio,
  type ResultadoValidacion,
} from './tipos';

// ── Helpers internos (no exportados, sin efectos secundarios) ──────────────

const RE_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;
const RE_FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function ok<T>(valor: T): ResultadoValidacion<T> {
  return { valido: true, valor, errores: [] };
}

function fail<T>(...errores: ErrorValidacionDominio[]): ResultadoValidacion<T> {
  return { valido: false, errores };
}

function error(codigo: string, campo: string, mensaje: string, valorRecibido?: unknown): ErrorValidacionDominio {
  return { codigo, campo, mensaje, valorRecibido };
}

/** Minutos enteros desde medianoche (0-1439) para una cadena "HH:mm" ya validada por RE_HORA. */
function minutosDesdeMedianoche(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

function esFechaIsoValida(fecha: string): boolean {
  if (!RE_FECHA_ISO.test(fecha)) return false;
  const [y, m, d] = fecha.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// ── A. Minutos enteros positivos ────────────────────────────────────────────

export function validarMinutosEnterosPositivos(valor: number, campo = 'minutos'): ResultadoValidacion<number> {
  if (!Number.isFinite(valor)) return fail(error('MINUTOS_NO_FINITOS', campo, 'El valor no es un número finito.', valor));
  if (!Number.isInteger(valor)) return fail(error('MINUTOS_NO_ENTEROS', campo, 'El valor debe ser un entero (minutos enteros, nunca decimales).', valor));
  if (valor <= 0) return fail(error('MINUTOS_NO_POSITIVOS', campo, 'El valor debe ser mayor que cero.', valor));
  return ok(valor);
}

// ── B. Cantidad de trabajadores ─────────────────────────────────────────────

export function validarCantidadTrabajadores(cantidad: number): ResultadoValidacion<number> {
  if (!Number.isFinite(cantidad)) return fail(error('CANTIDAD_NO_FINITA', 'cantidadTrabajadores', 'El valor no es un número finito.', cantidad));
  if (!Number.isInteger(cantidad)) return fail(error('CANTIDAD_NO_ENTERA', 'cantidadTrabajadores', 'La cantidad de trabajadores debe ser un entero.', cantidad));
  if (cantidad <= 0) return fail(error('CANTIDAD_NO_POSITIVA', 'cantidadTrabajadores', 'La cantidad de trabajadores debe ser mayor que cero.', cantidad));
  return ok(cantidad);
}

// ── C. Zona horaria ──────────────────────────────────────────────────────────

/** Primera versión: solo se acepta "America/Bogota" (Fase 1A.1 §5.1). Sin librerías externas. */
export function validarZonaHorariaContexto(zona: string): ResultadoValidacion<string> {
  if (zona !== 'America/Bogota') {
    return fail(error('ZONA_HORARIA_NO_SOPORTADA', 'zonaHoraria', 'Esta versión solo admite "America/Bogota".', zona));
  }
  return ok(zona);
}

// ── D. Rango de vigencia ─────────────────────────────────────────────────────

export function validarRangoVigencia(
  vigenteDesde: string,
  vigenteHasta?: string,
): ResultadoValidacion<{ vigenteDesde: string; vigenteHasta: string | null }> {
  const errores: ErrorValidacionDominio[] = [];
  if (!esFechaIsoValida(vigenteDesde)) {
    errores.push(error('VIGENCIA_DESDE_INVALIDA', 'vigenteDesde', 'vigenteDesde no es una fecha ISO válida ("YYYY-MM-DD").', vigenteDesde));
  }
  if (vigenteHasta !== undefined && !esFechaIsoValida(vigenteHasta)) {
    errores.push(error('VIGENCIA_HASTA_INVALIDA', 'vigenteHasta', 'vigenteHasta no es una fecha ISO válida ("YYYY-MM-DD").', vigenteHasta));
  }
  if (errores.length > 0) return fail(...errores);

  if (vigenteHasta !== undefined && vigenteHasta < vigenteDesde) {
    return fail(error('VIGENCIA_HASTA_ANTERIOR_A_DESDE', 'vigenteHasta', 'vigenteHasta no puede ser anterior a vigenteDesde.', { vigenteDesde, vigenteHasta }));
  }
  return ok({ vigenteDesde, vigenteHasta: vigenteHasta ?? null });
}

// ── E. Bloque horario individual ────────────────────────────────────────────

export function validarBloqueHorarioContexto(bloque: BloqueHorarioContexto): ResultadoValidacion<BloqueHorarioContexto> {
  const errores: ErrorValidacionDominio[] = [];
  if (!RE_HORA.test(bloque.inicio)) {
    errores.push(error('BLOQUE_HORA_INICIO_INVALIDA', 'inicio', 'inicio debe tener formato "HH:mm", hora entre 00:00 y 23:59.', bloque.inicio));
  }
  if (!RE_HORA.test(bloque.fin)) {
    errores.push(error('BLOQUE_HORA_FIN_INVALIDA', 'fin', 'fin debe tener formato "HH:mm", hora entre 00:00 y 23:59.', bloque.fin));
  }
  if (!Number.isInteger(bloque.orden) || bloque.orden <= 0) {
    errores.push(error('BLOQUE_ORDEN_INVALIDO', 'orden', 'orden debe ser un entero positivo.', bloque.orden));
  }
  if (errores.length > 0) return fail(...errores);

  if (bloque.inicio === bloque.fin) {
    return fail(error('BLOQUE_INICIO_IGUAL_FIN', 'inicio/fin', 'inicio y fin no pueden ser el mismo minuto.', bloque));
  }
  // Un bloque con fin <= inicio representa un cruce de medianoche estructural
  // (ej. "22:00"-"02:00") — este validador NO lo rechaza; la segmentación
  // cronológica real (con división por día calendario) es responsabilidad
  // de una etapa posterior, no de este validador de dominio.
  return ok(bloque);
}

// ── F. Lista de bloques de un día/regla ─────────────────────────────────────

export function validarBloquesHorarioContexto(
  bloques: BloqueHorarioContexto[],
  tipoAsignacion: TipoAsignacionTrabajador,
): ResultadoValidacion<BloqueHorarioContexto[]> {
  const errores: ErrorValidacionDominio[] = [];

  const requiereBloques = TIPOS_ASIGNACION_LABORADA.includes(tipoAsignacion);
  const prohibeBloques = TIPOS_ASIGNACION_SIN_BLOQUES.includes(tipoAsignacion);

  if (requiereBloques && bloques.length === 0) {
    return fail(error('BLOQUES_REQUERIDOS', 'bloques', `tipoAsignacion="${tipoAsignacion}" requiere al menos un bloque horario.`, tipoAsignacion));
  }
  if (prohibeBloques && bloques.length > 0) {
    errores.push(error('BLOQUES_NO_PERMITIDOS', 'bloques', `tipoAsignacion="${tipoAsignacion}" no debe tener bloques horarios.`, tipoAsignacion));
  }

  for (const b of bloques) {
    const r = validarBloqueHorarioContexto(b);
    if (!r.valido) errores.push(...r.errores);
  }
  if (errores.length > 0) return fail(...errores);

  const ordenes = bloques.map(b => b.orden);
  const ordenesUnicos = new Set(ordenes);
  if (ordenesUnicos.size !== ordenes.length) {
    errores.push(error('BLOQUES_ORDEN_DUPLICADO', 'orden', 'Dos o más bloques comparten el mismo valor de orden.', ordenes));
  }

  // Orden lógico: el campo `orden` debe ser consistente con la secuencia
  // cronológica declarada (inicio ascendente en el mismo orden que `orden`).
  // Nunca se reordena automáticamente — solo se reporta el error.
  const porOrden = [...bloques].sort((a, b) => a.orden - b.orden);
  for (let i = 1; i < porOrden.length; i++) {
    if (minutosDesdeMedianoche(porOrden[i].inicio) < minutosDesdeMedianoche(porOrden[i - 1].inicio)
        && minutosDesdeMedianoche(porOrden[i - 1].fin) > minutosDesdeMedianoche(porOrden[i - 1].inicio)) {
      // Solo se evalúa cuando el bloque anterior no cruza medianoche (comparación
      // simple, estructural); cruces de medianoche quedan para la segmentación real.
      errores.push(error('BLOQUES_FUERA_DE_ORDEN', 'orden', 'La secuencia de "orden" no coincide con el orden cronológico declarado por "inicio".', porOrden));
      break;
    }
  }

  // Solape estructural simple (mismo día, sin considerar cruce de medianoche).
  for (let i = 0; i < porOrden.length; i++) {
    for (let j = i + 1; j < porOrden.length; j++) {
      const a = porOrden[i];
      const b = porOrden[j];
      const aIni = minutosDesdeMedianoche(a.inicio);
      const aFin = minutosDesdeMedianoche(a.fin);
      const bIni = minutosDesdeMedianoche(b.inicio);
      const bFin = minutosDesdeMedianoche(b.fin);
      if (aFin > aIni && bFin > bIni && aIni < bFin && bIni < aFin) {
        errores.push(error('BLOQUES_SUPERPUESTOS', 'bloques', 'Dos bloques del mismo día se superponen en el tiempo.', [a, b]));
      }
    }
  }

  if (errores.length > 0) return fail(...errores);
  return ok(bloques);
}

// ── G. Patrón de trabajador ──────────────────────────────────────────────────

export function validarPatronTrabajadorContexto(patron: PatronTrabajadorContexto): ResultadoValidacion<PatronTrabajadorContexto> {
  const errores: ErrorValidacionDominio[] = [];

  if (!patron.codigo || patron.codigo.trim() === '') {
    errores.push(error('PATRON_CODIGO_OBLIGATORIO', 'codigo', 'El código del patrón es obligatorio.', patron.codigo));
  }
  if (!patron.nombre || patron.nombre.trim() === '') {
    errores.push(error('PATRON_NOMBRE_OBLIGATORIO', 'nombre', 'El nombre del patrón es obligatorio.', patron.nombre));
  }

  const rCantidad = validarCantidadTrabajadores(patron.cantidadTrabajadores);
  if (!rCantidad.valido) errores.push(...rCantidad.errores);

  const rJornada = validarMinutosEnterosPositivos(patron.jornadaContractualSemanalMinutos, 'jornadaContractualSemanalMinutos');
  if (!rJornada.valido) errores.push(...rJornada.errores);

  if (!MODALIDADES_DISTRIBUCION_JORNADA.includes(patron.modalidadDistribucionJornada)) {
    errores.push(error('PATRON_MODALIDAD_INVALIDA', 'modalidadDistribucionJornada', 'modalidadDistribucionJornada no es un valor válido.', patron.modalidadDistribucionJornada));
  }
  if (!REGIMENES_LABORALES.includes(patron.regimenLaboral)) {
    errores.push(error('PATRON_REGIMEN_INVALIDO', 'regimenLaboral', 'regimenLaboral no es un valor válido.', patron.regimenLaboral));
  }

  const rZona = validarZonaHorariaContexto(patron.zonaHoraria);
  if (!rZona.valido) errores.push(...rZona.errores);

  if (!Number.isInteger(patron.version) || patron.version <= 0) {
    errores.push(error('PATRON_VERSION_INVALIDA', 'version', 'version debe ser un entero positivo.', patron.version));
  }

  if (patron.modalidadDistribucionJornada === 'FLEXIBLE_ACORDADA' && patron.acuerdoJornadaFlexible !== true) {
    errores.push(error(
      'PATRON_FLEXIBLE_SIN_ACUERDO', 'acuerdoJornadaFlexible',
      'modalidadDistribucionJornada="FLEXIBLE_ACORDADA" exige acuerdoJornadaFlexible=true.',
      patron.acuerdoJornadaFlexible,
    ));
  }

  if (patron.tipoDescanso === 'FIJO' && !patron.diaDescansoObligatorio) {
    errores.push(error(
      'PATRON_DESCANSO_FIJO_SIN_DIA', 'diaDescansoObligatorio',
      'tipoDescanso="FIJO" exige declarar diaDescansoObligatorio explícitamente — nunca se asigna domingo en silencio.',
      patron.diaDescansoObligatorio,
    ));
  }

  const rVigencia = validarRangoVigencia(patron.vigenteDesde, patron.vigenteHasta);
  if (!rVigencia.valido) errores.push(...rVigencia.errores);

  if (errores.length > 0) return fail(...errores);
  return ok(patron);
}

/**
 * Separado de validarPatronTrabajadorContexto (validación estructural) porque
 * la disponibilidad normativa del régimen NO es un dato estructural del
 * patrón — depende de si existe una VigenciaParametrosLaborales resuelta
 * (Plan revisión 7 §5), algo que este bloque no consulta (sin BD). Por eso
 * recibe `parametrosDisponibles` como entrada explícita en vez de decidirlo
 * por sí mismo.
 */
export function validarParametrosRegimenDisponibles(
  regimenLaboral: RegimenLaboral,
  parametrosDisponibles: boolean,
): ResultadoValidacion<{ regimenLaboral: RegimenLaboral }> {
  if (regimenLaboral === 'VIGILANCIA_SEGURIDAD_PRIVADA' && !parametrosDisponibles) {
    return fail(error(
      'REGIMEN_VIGILANCIA_SIN_PARAMETROS', 'regimenLaboral',
      'El régimen de vigilancia no se encuentra parametrizado para esta vigencia.',
      regimenLaboral,
    ));
  }
  return ok({ regimenLaboral });
}

// ── H. Regla semanal del patrón ──────────────────────────────────────────────

export function validarReglaSemanalPatronContexto(regla: ReglaSemanalPatronContexto): ResultadoValidacion<ReglaSemanalPatronContexto> {
  const errores: ErrorValidacionDominio[] = [];

  if (!DIAS_SEMANA.includes(regla.diaSemana)) {
    errores.push(error('REGLA_DIA_SEMANA_INVALIDO', 'diaSemana', 'diaSemana no es un valor válido.', regla.diaSemana));
  }
  if (!Number.isInteger(regla.minutosOrdinariosPactados) || regla.minutosOrdinariosPactados < 0) {
    errores.push(error('REGLA_MINUTOS_INVALIDOS', 'minutosOrdinariosPactados', 'minutosOrdinariosPactados debe ser un entero no negativo.', regla.minutosOrdinariosPactados));
  }
  if (!Number.isInteger(regla.orden) || regla.orden <= 0) {
    errores.push(error('REGLA_ORDEN_INVALIDO', 'orden', 'orden debe ser un entero positivo.', regla.orden));
  }

  const rBloques = validarBloquesHorarioContexto(regla.bloques, regla.tipoAsignacion);
  if (!rBloques.valido) errores.push(...rBloques.errores);

  const rVigencia = validarRangoVigencia(regla.vigenteDesde, regla.vigenteHasta);
  if (!rVigencia.valido) errores.push(...rVigencia.errores);

  if (errores.length > 0) return fail(...errores);
  return ok(regla);
}

// ── I. Conjunto de reglas semanales de un patrón ─────────────────────────────

function vigenciasSeSuperponen(
  a: { vigenteDesde: string; vigenteHasta?: string },
  b: { vigenteDesde: string; vigenteHasta?: string },
): boolean {
  const aFin = a.vigenteHasta ?? '9999-12-31';
  const bFin = b.vigenteHasta ?? '9999-12-31';
  return a.vigenteDesde <= bFin && b.vigenteDesde <= aFin;
}

export function validarReglasSemanalesPatron(reglas: ReglaSemanalPatronContexto[]): ResultadoValidacion<ReglaSemanalPatronContexto[]> {
  const errores: ErrorValidacionDominio[] = [];

  for (const r of reglas) {
    const rIndividual = validarReglaSemanalPatronContexto(r);
    if (!rIndividual.valido) errores.push(...rIndividual.errores);
  }

  const activas = reglas.filter(r => r.activo);
  for (let i = 0; i < activas.length; i++) {
    for (let j = i + 1; j < activas.length; j++) {
      const a = activas[i];
      const b = activas[j];
      if (a.diaSemana === b.diaSemana && a.orden === b.orden && vigenciasSeSuperponen(a, b)) {
        errores.push(error(
          'REGLA_DUPLICADA_MISMO_DIA_ORDEN_PERIODO', 'diaSemana+orden',
          `Dos reglas activas comparten diaSemana="${a.diaSemana}", orden=${a.orden} con vigencias superpuestas.`,
          [a, b],
        ));
      }
    }
  }

  // No se exige que existan los 7 días — se detecta únicamente si NINGÚN día
  // tiene una asignación laborada (patrón completamente sin trabajo programado).
  const tieneAlgunDiaTrabajado = activas.some(r => TIPOS_ASIGNACION_LABORADA.includes(r.tipoAsignacion));
  if (activas.length > 0 && !tieneAlgunDiaTrabajado) {
    errores.push(error('PATRON_SIN_DIAS_TRABAJADOS', 'reglas', 'Ninguna regla activa del patrón tiene una asignación laborada.', activas));
  }

  // No se infieren automáticamente jornadas faltantes — la ausencia de un día
  // específico no genera error aquí, solo queda reflejada en la lista de reglas.

  if (errores.length > 0) return fail(...errores);
  return ok(reglas);
}

// ── J. Excepción de programación ─────────────────────────────────────────────

export function validarExcepcionProgramacionContexto(excepcion: ExcepcionProgramacionContexto): ResultadoValidacion<ExcepcionProgramacionContexto> {
  const errores: ErrorValidacionDominio[] = [];

  if (!esFechaIsoValida(excepcion.fecha)) {
    errores.push(error('EXCEPCION_FECHA_INVALIDA', 'fecha', 'fecha no es una fecha ISO válida ("YYYY-MM-DD").', excepcion.fecha));
  }
  if (!excepcion.tipo) {
    errores.push(error('EXCEPCION_TIPO_OBLIGATORIO', 'tipo', 'tipo es obligatorio.', excepcion.tipo));
  }
  if (!excepcion.motivo || excepcion.motivo.trim() === '') {
    errores.push(error('EXCEPCION_MOTIVO_OBLIGATORIO', 'motivo', 'motivo es obligatorio.', excepcion.motivo));
  }

  if (TIPOS_EXCEPCION_CON_SUSTITUCION.includes(excepcion.tipo)
      && !excepcion.turnoSustitutoId
      && (!excepcion.bloquesSustitutos || excepcion.bloquesSustitutos.length === 0)) {
    errores.push(error(
      'EXCEPCION_SUSTITUCION_SIN_TURNO_NI_BLOQUES', 'turnoSustitutoId/bloquesSustitutos',
      `tipo="${excepcion.tipo}" requiere turnoSustitutoId o bloquesSustitutos.`,
      excepcion,
    ));
  }

  if (excepcion.estadoConfirmacion === 'CONFIRMADO') {
    if (!excepcion.usuarioConfirmo) {
      errores.push(error('EXCEPCION_CONFIRMADA_SIN_USUARIO', 'usuarioConfirmo', 'estadoConfirmacion="CONFIRMADO" exige usuarioConfirmo.', excepcion.usuarioConfirmo));
    }
    if (!excepcion.fechaConfirmacion) {
      errores.push(error('EXCEPCION_CONFIRMADA_SIN_FECHA', 'fechaConfirmacion', 'estadoConfirmacion="CONFIRMADO" exige fechaConfirmacion.', excepcion.fechaConfirmacion));
    }
  }

  if (excepcion.bloquesSustitutos) {
    const rBloques = validarBloquesHorarioContexto(excepcion.bloquesSustitutos, 'TURNO_ADICIONAL');
    if (!rBloques.valido) errores.push(...rBloques.errores);
  }

  if (errores.length > 0) return fail(...errores);
  return ok(excepcion);
}

// ── K. Contexto parcial (semana incompleta) ──────────────────────────────────

export interface EntradaContextoParcial {
  diasSemanaCompleta: string[];        // los 7 días ISO de la semana calendario
  diasSolicitados: string[];           // el subconjunto que el usuario pidió calcular
  diasConProgramacionConocida: string[]; // días con ProgramacionDiariaCalculada resuelta
  acumuladoAnteriorConocido: boolean;  // si se conoce el acumulado de los días previos al plazo
}

export interface ResultadoContextoParcial {
  estado: 'COMPLETO' | 'REQUIERE_CONTEXTO_ANTERIOR' | 'REQUIERE_PROGRAMACION_DIARIA';
  diasFaltantes: string[];
}

/**
 * Determina si hace falta contexto adicional — NUNCA asume acumulado cero.
 * No lanza REQUIERE_CONTEXTO_SEMANAL directamente (ese es un estado de más
 * alto nivel del servicio orquestador, fuera de este bloque) — determina
 * cuál de los 3 sub-estados aplica.
 */
export function validarContextoParcial(entrada: EntradaContextoParcial): ResultadoValidacion<ResultadoContextoParcial> {
  if (entrada.diasSemanaCompleta.length === 0) {
    return fail(error('CONTEXTO_PARCIAL_SEMANA_VACIA', 'diasSemanaCompleta', 'diasSemanaCompleta no puede estar vacío.', entrada.diasSemanaCompleta));
  }
  if (entrada.diasSolicitados.length === 0) {
    return fail(error('CONTEXTO_PARCIAL_SIN_DIAS_SOLICITADOS', 'diasSolicitados', 'diasSolicitados no puede estar vacío.', entrada.diasSolicitados));
  }

  const conocidos = new Set(entrada.diasConProgramacionConocida);
  const diasFaltantes = entrada.diasSemanaCompleta.filter(d => !conocidos.has(d));

  const diasFaltantesDentroDelPlazo = diasFaltantes.filter(d => entrada.diasSolicitados.includes(d));
  const diasFaltantesFueraDelPlazo = diasFaltantes.filter(d => !entrada.diasSolicitados.includes(d));

  // Falta programación del propio plazo solicitado — nunca se puede cubrir
  // con un acumulado agregado de otros días, siempre bloquea.
  if (diasFaltantesDentroDelPlazo.length > 0) {
    return ok({ estado: 'REQUIERE_PROGRAMACION_DIARIA', diasFaltantes });
  }

  // Faltan días FUERA del plazo (contexto previo de la semana) y no se conoce
  // ni siquiera el acumulado agregado de esos días — no se puede clasificar
  // sin inventar el acumulado (nunca se asume cero).
  if (diasFaltantesFueraDelPlazo.length > 0 && !entrada.acumuladoAnteriorConocido) {
    return ok({ estado: 'REQUIERE_CONTEXTO_ANTERIOR', diasFaltantes });
  }

  // Todo el plazo solicitado tiene programación conocida, y los días fuera del
  // plazo (si los hay) están cubiertos por un acumulado anterior ya conocido.
  return ok({ estado: 'COMPLETO', diasFaltantes: [] });
}

// ── L. Contexto listo para clasificar ────────────────────────────────────────

export interface EntradaContextoListo {
  patronValido: boolean;
  contextoCompleto: boolean;
  programacionSuficiente: boolean;
  jornadaContractualDefinida: boolean;
  descansoObligatorioConfirmado: boolean;
  regimenConParametrosDisponibles: boolean;
  calendarioDisponibleParaFechasRequeridas: boolean;
  alertasBloqueantes: AlertaContextoSemanal[];
}

/**
 * Agrega verificaciones ya resueltas por otros validadores/servicios — no
 * clasifica horas ni calcula dinero, solo determina si el contexto puede
 * pasar a la Etapa 3 (clasificación ordinaria/extra, fuera de este bloque).
 */
export function validarContextoListoParaClasificar(entrada: EntradaContextoListo): ResultadoValidacion<{ listo: true }> {
  const errores: ErrorValidacionDominio[] = [];

  if (!entrada.patronValido) errores.push(error('CONTEXTO_PATRON_INVALIDO', 'patronValido', 'El patrón de trabajador no es válido.', entrada.patronValido));
  if (!entrada.contextoCompleto) errores.push(error('CONTEXTO_INCOMPLETO', 'contextoCompleto', 'El contexto semanal no está completo.', entrada.contextoCompleto));
  if (!entrada.programacionSuficiente) errores.push(error('CONTEXTO_PROGRAMACION_INSUFICIENTE', 'programacionSuficiente', 'La programación diaria disponible es insuficiente.', entrada.programacionSuficiente));
  if (!entrada.jornadaContractualDefinida) errores.push(error('CONTEXTO_JORNADA_NO_DEFINIDA', 'jornadaContractualDefinida', 'La jornada contractual no está definida.', entrada.jornadaContractualDefinida));
  if (!entrada.descansoObligatorioConfirmado) errores.push(error('CONTEXTO_DESCANSO_NO_CONFIRMADO', 'descansoObligatorioConfirmado', 'El día de descanso obligatorio no está confirmado.', entrada.descansoObligatorioConfirmado));
  if (!entrada.regimenConParametrosDisponibles) errores.push(error('CONTEXTO_REGIMEN_SIN_PARAMETROS', 'regimenConParametrosDisponibles', 'El régimen laboral no tiene parámetros disponibles para esta vigencia.', entrada.regimenConParametrosDisponibles));
  if (!entrada.calendarioDisponibleParaFechasRequeridas) errores.push(error('CONTEXTO_CALENDARIO_NO_DISPONIBLE', 'calendarioDisponibleParaFechasRequeridas', 'El calendario de festivos no está disponible para todas las fechas requeridas.', entrada.calendarioDisponibleParaFechasRequeridas));

  const bloqueantes = entrada.alertasBloqueantes.filter(a => a.bloqueaCalculo);
  if (bloqueantes.length > 0) {
    errores.push(error('CONTEXTO_ALERTAS_BLOQUEANTES', 'alertasBloqueantes', 'Existen alertas marcadas como bloqueantes.', bloqueantes));
  }

  if (errores.length > 0) return fail(...errores);
  return ok({ listo: true });
}
