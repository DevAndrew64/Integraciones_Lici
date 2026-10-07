/**
 * Orquestador — Etapas 1-14 completas. Punto de entrada único del
 * NORMALIZADOR ROBUSTO DE HORARIOS HISTÓRICOS. Combina pre-normalización,
 * extracción de anotaciones, segmentación por "//"/"Y", construcción de
 * bloques, asignación de días (texto propio → JORNADA → flags → pendiente)
 * y validación final, para producir un ResultadoNormalizacionHorario
 * completo. Nunca inventa datos — cuando algo es ambiguo, lo declara.
 */
import { preNormalizarTexto } from './pre-normalizador-texto';
import { extraerAnotaciones } from './parser-anotaciones';
import { segmentarDistribuciones } from './lexer-horario';
import { construirBloquesDistribucion } from './parser-horario-legacy';
import { validarNormalizacion } from './validador-horario-normalizado';
import { resolverPatronTurnoCiclico } from './patron-turno-ciclico';
import type {
  ContextoNormalizacionHorario, DistribucionHorarioNormalizada, EstadoAsignacionOperativa, IntervaloDescanso,
  ResultadoNormalizacionHorario, TipoAplicacionDistribucion,
} from './tipos-normalizacion';
import type { DiaSemanaHorario } from './tipos';

const ORDEN_DIAS: DiaSemanaHorario[] = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const NOMBRE_DIA_COMPLETO: Record<string, DiaSemanaHorario> = {
  LUNES: 'L', MARTES: 'M', MIERCOLES: 'X', MIÉRCOLES: 'X', JUEVES: 'J',
  VIERNES: 'V', SABADO: 'S', SÁBADO: 'S', DOMINGO: 'D',
};

const DIA_ALT = 'LUNES|MARTES|MIERCOLES|MIÉRCOLES|JUEVES|VIERNES|SABADO|SÁBADO|DOMINGO';
// "S?\b" en vez de solo la alternativa — evita que "DOMINGO" haga match
// como simple prefijo de una palabra distinta (ej. nunca debe capturar por
// accidente dentro de otro token); admite el plural común en catálogos
// históricos ("SABADOS", "DOMINGOS").
const RE_DIA_RANGO = new RegExp(`^(${DIA_ALT})S?\\s+A\\s+(${DIA_ALT})S?\\b`);
const RE_DIA_UNICO = new RegExp(`^(${DIA_ALT})S?$`);

/** "LUNES A VIERNES" / "SÁBADO" / "LUNES A SABADO" (texto de JORNADA, nombres
 * completos, no abreviaturas) → lista de días, o null si no es interpretable. */
function interpretarFraseDiasCompleta(texto: string): DiaSemanaHorario[] | null {
  const t = texto.trim();
  const mRango = RE_DIA_RANGO.exec(t);
  if (mRango) {
    const ini = NOMBRE_DIA_COMPLETO[mRango[1]];
    const fin = NOMBRE_DIA_COMPLETO[mRango[2]];
    const iIni = ORDEN_DIAS.indexOf(ini);
    const iFin = ORDEN_DIAS.indexOf(fin);
    if (iIni !== -1 && iFin !== -1 && iFin >= iIni) return ORDEN_DIAS.slice(iIni, iFin + 1);
  }
  const mUnico = RE_DIA_UNICO.exec(t);
  if (mUnico) return [NOMBRE_DIA_COMPLETO[mUnico[1]]];
  // "DOMINGO(S) Y FESTIVOS" — festivos es metadato de cobertura (no un día de
  // semana concreto), el único día calendario que aporta es domingo.
  if (/^DOMINGOS?\s+Y\s+FESTIVOS?$/.test(t)) return ['D'];
  return null;
}

function minutosDeBloque(inicioOffset: number, inicio: string, finOffset: number, fin: string): number {
  const [hi, mi] = inicio.split(':').map(Number);
  const [hf, mf] = fin.split(':').map(Number);
  return (finOffset * 1440 + hf * 60 + mf) - (inicioOffset * 1440 + hi * 60 + mi);
}

function construirDistribucion(
  idTemporal: string,
  textoOriginalSegmento: string,
  textoSinAnotacionesSegmento: string,
  diasDelSegmento: DiaSemanaHorario[] | null,
  fuenteDiasSegmento: 'TEXTO_HORARIO' | null,
  esAlternativa: boolean,
  esRotacionGlobal: boolean,
  esTurnanteGlobal: boolean,
  descansoDeclaradoGlobal: number | null,
  descansoSinDuracionGlobal: boolean,
  aliasGlobal: string | null,
  anotacionesGlobales: string[],
): { distribucion: DistribucionHorarioNormalizada; huboFallo: boolean; motivoFallo: string | null; requiereConfirmarHora: boolean; sugerenciaHora: string | null } {
  const anotSegmento = extraerAnotaciones(textoSinAnotacionesSegmento);
  const dias = diasDelSegmento ?? anotSegmento.diasDetectados ?? [];
  const fuenteDias = diasDelSegmento ? fuenteDiasSegmento! : (anotSegmento.diasDetectados ? 'TEXTO_HORARIO' : 'NO_DETERMINADO');
  const descansoDeclarado = anotSegmento.descansoDeclaradoMinutos ?? descansoDeclaradoGlobal;
  const descansoSinDuracion = anotSegmento.descansoSinDuracion || descansoSinDuracionGlobal;

  const resBloques = construirBloquesDistribucion(anotSegmento.textoSinAnotaciones);
  const advertencias = [...resBloques.advertencias];

  let tipoAplicacion: TipoAplicacionDistribucion;
  if (esTurnanteGlobal) tipoAplicacion = 'TURNANTE';
  else if (esRotacionGlobal || anotSegmento.esRotacionOTurnante) tipoAplicacion = 'ROTACION_SEMANAL';
  else if (esAlternativa) tipoAplicacion = 'ALTERNATIVO';
  else if (dias.length === 0) tipoAplicacion = 'PENDIENTE_CONFIRMACION';
  else tipoAplicacion = 'POR_DIAS';

  if (!resBloques.ok) {
    return {
      distribucion: {
        idTemporal, textoOriginal: textoOriginalSegmento, textoCanonico: null, tipoAplicacion,
        diasSemana: dias, fuenteDias, bloques: [], descansoDeclaradoMinutos: descansoDeclarado,
        descansoUbicado: false, descansosDerivados: [], cruzaMedianoche: false, minutosTrabajoCalculados: null,
        alias: aliasGlobal ?? anotSegmento.alias, anotaciones: [...anotacionesGlobales, ...anotSegmento.anotaciones], advertencias,
      },
      huboFallo: true, motivoFallo: resBloques.motivoFallo, requiereConfirmarHora: resBloques.requiereConfirmarHora, sugerenciaHora: resBloques.sugerenciaHora,
    };
  }

  const bloques = resBloques.bloques;
  const cruzaMedianoche = bloques.some(b => b.finDiaOffset > b.inicioDiaOffset);
  const descansosDerivados: IntervaloDescanso[] = [];
  for (let i = 1; i < bloques.length; i++) {
    const anterior = bloques[i - 1];
    const actual = bloques[i];
    const minutos = minutosDeBloque(anterior.finDiaOffset, anterior.fin, actual.inicioDiaOffset, actual.inicio);
    descansosDerivados.push({ inicio: anterior.fin, fin: actual.inicio, minutos });
  }

  let descansoUbicado: boolean;
  let minutosTrabajoCalculados: number | null;
  const minutosBrutos = bloques.reduce((s, b) => s + b.minutos, 0);

  if (bloques.length >= 2) {
    // Descanso derivable cronológicamente de los huecos entre bloques.
    descansoUbicado = true;
    minutosTrabajoCalculados = minutosBrutos;
  } else if (descansoSinDuracion) {
    descansoUbicado = false;
    minutosTrabajoCalculados = null;
  } else if (descansoDeclarado !== null) {
    // Un solo bloque (ventana total) con descanso de duración conocida pero
    // ubicación desconocida dentro de la ventana.
    descansoUbicado = false;
    minutosTrabajoCalculados = minutosBrutos - descansoDeclarado;
  } else {
    descansoUbicado = bloques.length <= 1; // un solo bloque sin descanso declarado: no hay descanso que ubicar
    minutosTrabajoCalculados = minutosBrutos;
  }

  const textoCanonico = bloques.map(b => `${b.inicio}-${b.fin}`).join(' Y ');

  return {
    distribucion: {
      idTemporal, textoOriginal: textoOriginalSegmento, textoCanonico, tipoAplicacion,
      diasSemana: dias, fuenteDias, bloques, descansoDeclaradoMinutos: descansoDeclarado,
      descansoUbicado, descansosDerivados, cruzaMedianoche, minutosTrabajoCalculados,
      alias: aliasGlobal ?? anotSegmento.alias, anotaciones: [...anotacionesGlobales, ...anotSegmento.anotaciones], advertencias,
    },
    huboFallo: false, motivoFallo: null, requiereConfirmarHora: false, sugerenciaHora: null,
  };
}

export function normalizarHorarioLegacy(
  textoOriginal: string,
  contexto: ContextoNormalizacionHorario = {},
): ResultadoNormalizacionHorario {
  const { textoPreNormalizado } = preNormalizarTexto(textoOriginal ?? '');

  if (!textoPreNormalizado) {
    return {
      textoOriginal: textoOriginal ?? '', textoPreNormalizado: '', textoCanonico: null, distribuciones: [],
      horasJornadaDeclaradas: contexto.horasJornadaDeclaradas ?? null, horasSemanaDeclaradas: contexto.horasSemanaDeclaradas ?? null,
      minutosJornadaCalculados: null, minutosSemanaCalculados: null,
      estado: 'HORARIO_NO_INTERPRETABLE', nivelConfianza: 'BAJO',
      advertencias: [], camposPendientes: [{ campo: 'horario', motivo: 'El texto del horario está vacío.' }],
      puedeAplicarse: false, puedeCalcularTiempoTotal: false, puedeClasificarCronologicamente: false, requiereConfirmacion: true,
      patronTurnoCiclico: null, minutosCicloCalculados: null, promedioSemanalMinutosCiclo: null,
      estadoAsignacion: 'NINGUNO', informacionOperativa: [],
    };
  }

  // Patrón cíclico trabajo/descanso (ej. 7X1) — cuando el TURNO corresponde
  // a uno conocido, su semántica reemplaza por completo la detección
  // genérica de rotación (nunca se trata como un patrón semanal fijo).
  const patronCiclico = resolverPatronTurnoCiclico(contexto.turnoTexto, contexto.fechaInicioCicloTurno);

  const anotGlobal = extraerAnotaciones(textoPreNormalizado);

  // Posible intercambio de campos (§Q): HORARIO contiene sobre todo
  // días/rotación y no tiene ningún token de hora reconocible.
  const tieneHoras = /\d{1,2}[:.]\d{2}/.test(anotGlobal.textoSinAnotaciones);
  const jornadaTieneHoras = contexto.jornadaTexto ? /\d{1,2}[:.]\d{2}/.test(contexto.jornadaTexto) : false;
  const posibleIntercambio = !tieneHoras && jornadaTieneHoras;

  const segDist = segmentarDistribuciones(anotGlobal.textoSinAnotaciones);
  const esAlternativa = segDist.separador === 'ALTERNATIVA';
  const esTurnanteGlobal = anotGlobal.anotaciones.some(a => /TURNANTE/.test(a));
  // El campo TURNO (ej. "6X1", "4X3", códigos NxN no reconocidos como
  // patrón cíclico) también es una fuente de rotación genérica — pero SOLO
  // cuando no corresponde a un patrón cíclico ya modelado (7X1), que tiene
  // su propio tratamiento completo más abajo y nunca debe caer en el
  // genérico "requiere confirmar rotación".
  const rotacionPorTurno = !patronCiclico && contexto.turnoTexto ? extraerAnotaciones(contexto.turnoTexto.toLocaleUpperCase('es-CO')).esRotacionOTurnante : false;
  const esRotacionGlobal = (anotGlobal.esRotacionOTurnante || rotacionPorTurno) && !esTurnanteGlobal;

  // Asignación por JORNADA cuando la cantidad de segmentos coincide y cada
  // uno de sus tramos es interpretable (familia D) — nunca si hay
  // contradicción con lo ya detectado en el propio texto de HORARIO.
  let diasPorSegmentoJornada: (DiaSemanaHorario[] | null)[] | null = null;
  if (contexto.jornadaTexto && segDist.segmentos.length > 1) {
    const segJornada = contexto.jornadaTexto.toLocaleUpperCase('es-CO').split(/\/\//).map(s => s.trim());
    if (segJornada.length === segDist.segmentos.length) {
      const interpretados = segJornada.map(interpretarFraseDiasCompleta);
      if (interpretados.every(d => d !== null)) diasPorSegmentoJornada = interpretados;
    }
  } else if (contexto.jornadaTexto && segDist.segmentos.length === 1) {
    const unaSola = interpretarFraseDiasCompleta(contexto.jornadaTexto.toLocaleUpperCase('es-CO').trim());
    if (unaSola) diasPorSegmentoJornada = [unaSola];
  }

  let huboFalloGlobal = false;
  let motivoFalloGlobal: string | null = null;
  let requiereConfirmarHoraGlobal = false;
  let sugerenciaHoraGlobal: string | null = null;

  const distribuciones: DistribucionHorarioNormalizada[] = posibleIntercambio ? [] : segDist.segmentos.map((segmento, i) => {
    const diasDeTextoPropio = extraerAnotaciones(segmento).diasDetectados;
    // Si el texto trae un único segmento, los días pudieron haberse extraído
    // ya en la pasada global (extraerAnotaciones sobre el texto completo,
    // antes de segmentar) — se recuperan de ahí como último recurso.
    const diasDeTextoGlobal = segDist.segmentos.length === 1 ? anotGlobal.diasDetectados : null;
    const diasAsignados = diasDeTextoPropio ?? diasDeTextoGlobal ?? (diasPorSegmentoJornada ? diasPorSegmentoJornada[i] : null);
    const fuente = (diasDeTextoPropio || diasDeTextoGlobal) ? 'TEXTO_HORARIO' : (diasPorSegmentoJornada ? 'TEXTO_JORNADA' : null);
    const r = construirDistribucion(
      `d${i + 1}`, segmento, segmento, diasAsignados, fuente as 'TEXTO_HORARIO' | null,
      esAlternativa, esRotacionGlobal, esTurnanteGlobal,
      anotGlobal.descansoDeclaradoMinutos, anotGlobal.descansoSinDuracion,
      anotGlobal.alias, anotGlobal.anotaciones,
    );
    if (r.huboFallo) {
      huboFalloGlobal = true;
      motivoFalloGlobal = r.motivoFallo;
      requiereConfirmarHoraGlobal = r.requiereConfirmarHora;
      sugerenciaHoraGlobal = r.sugerenciaHora;
    }
    return r.distribucion;
  });

  // El total semanal solo se calcula cuando hay UNA única distribución (un
  // patrón inequívoco para un mismo trabajador en una misma semana). Con
  // varias distribuciones ("//") no se suman automáticamente como si
  // ocurrieran simultáneamente — combinarlas en una sola cifra semanal es
  // una decisión que corresponde a la aplicación sobre un cargo/patrón
  // concreto, no a la normalización del catálogo. Cada distribución sigue
  // exponiendo su propio minutosTrabajoCalculados.
  const minutosSemanaReal = posibleIntercambio || huboFalloGlobal || distribuciones.length !== 1 || distribuciones.some(d => d.minutosTrabajoCalculados === null || d.diasSemana.length === 0)
    ? null
    : distribuciones.reduce((s, d) => s + (d.minutosTrabajoCalculados ?? 0) * d.diasSemana.length, 0);
  const minutosJornadaCalculados = distribuciones.length === 1 ? distribuciones[0].minutosTrabajoCalculados : null;

  // Cálculo del ciclo (7X1 y equivalentes) — el titular trabaja N días
  // CONSECUTIVOS (no una semana calendario) y descansa uno, cubierto por
  // turnante. minutosCicloCalculados es la duración de UN ciclo completo;
  // promedioSemanalMinutosCiclo es SOLO un dato de validación frente a lo
  // declarado — la liquidación real exige materializar fechas concretas
  // (materializarCiclo7x1), nunca este promedio.
  let minutosCicloCalculados: number | null = null;
  let promedioSemanalMinutosCiclo: number | null = null;
  let estadoAsignacion: EstadoAsignacionOperativa = 'NINGUNO';
  const informacionOperativa: string[] = [];

  if (patronCiclico && distribuciones.length === 1 && distribuciones[0].minutosTrabajoCalculados !== null) {
    const minutosPorDia = distribuciones[0].minutosTrabajoCalculados;
    minutosCicloCalculados = minutosPorDia * patronCiclico.diasTrabajoConsecutivos;
    promedioSemanalMinutosCiclo = (minutosCicloCalculados * 7) / patronCiclico.duracionCicloDias;
    informacionOperativa.push(
      `El horario ${patronCiclico.codigoTurno} genera un ciclo de ${patronCiclico.diasTrabajoConsecutivos} jornadas trabajadas y ${patronCiclico.diasDescansoConsecutivos} día(s) de descanso, cubierto por turnante. El día de descanso rota — no cae siempre en el mismo día de la semana.`,
    );
    if (!patronCiclico.confirmado) {
      estadoAsignacion = 'REQUIERE_FECHA_INICIO_ROTACION';
      informacionOperativa.push(`Indique la fecha de inicio del ciclo ${patronCiclico.codigoTurno} para determinar los días de trabajo y descanso.`);
    }
  }

  // Con patrón cíclico activo, el total "semanal" genérico (bloques × días
  // de cobertura) NUNCA se expone como si fuera una semana real — el ciclo
  // no está alineado con la semana calendario. La comparación contra lo
  // declarado usa el promedio de validación, y el total semanal expuesto
  // queda null (se materializa por fecha cuando se aplique a un cargo).
  const minutosSemanaExpuesto = patronCiclico ? null : minutosSemanaReal;
  const minutosSemanaParaValidar = patronCiclico ? promedioSemanalMinutosCiclo : minutosSemanaReal;

  const validacion = validarNormalizacion({
    distribuciones,
    huboFalloDeParseo: huboFalloGlobal,
    motivoFalloParseo: motivoFalloGlobal,
    requiereConfirmarHora: requiereConfirmarHoraGlobal,
    sugerenciaHora: sugerenciaHoraGlobal,
    separadorDegradado: segDist.separadorDegradado,
    posibleIntercambioDeCampos: posibleIntercambio,
    minutosSemanaCalculados: minutosSemanaParaValidar,
    horasSemanaDeclaradas: contexto.horasSemanaDeclaradas ?? null,
  });

  const textoCanonico = huboFalloGlobal ? null : distribuciones.map(d => d.textoCanonico).join(' // ');

  // El mensaje genérico de diferencia ("Las horas semanales declaradas...
  // no coinciden con las calculadas desde los bloques") no aplica a un
  // ciclo — se reemplaza por la advertencia específica del patrón cíclico.
  const advertenciasValidacion = patronCiclico && validacion.estado === 'DIFIERE_DE_DATOS_DECLARADOS'
    ? validacion.advertenciasAdicionales
        .filter(a => a.codigo !== 'DIFIERE_HORAS_SEMANA_DECLARADAS')
        .concat([{
          codigo: 'DIFIERE_CICLO_TURNO',
          mensaje: `El horario ${patronCiclico.codigoTurno} genera un ciclo de ${patronCiclico.diasTrabajoConsecutivos} jornadas trabajadas y ${patronCiclico.diasDescansoConsecutivos} día(s) de descanso. Las horas declaradas requieren validación frente a la programación materializada.`,
        }])
    : validacion.advertenciasAdicionales;

  const camposPendientesFinal = estadoAsignacion === 'REQUIERE_FECHA_INICIO_ROTACION'
    ? [...validacion.camposPendientes, { campo: 'fechaInicioCicloTurno', motivo: `Indique la fecha de inicio del ciclo ${patronCiclico!.codigoTurno} para determinar los días de trabajo y descanso.` }]
    : validacion.camposPendientes;

  return {
    textoOriginal: textoOriginal ?? '',
    textoPreNormalizado,
    textoCanonico,
    distribuciones,
    horasJornadaDeclaradas: contexto.horasJornadaDeclaradas ?? null,
    horasSemanaDeclaradas: contexto.horasSemanaDeclaradas ?? null,
    minutosJornadaCalculados,
    minutosSemanaCalculados: minutosSemanaExpuesto,
    estado: validacion.estado,
    nivelConfianza: validacion.nivelConfianza,
    advertencias: [
      ...segDist.advertencias.map(m => ({ codigo: 'SEPARADOR', mensaje: m })),
      ...distribuciones.flatMap(d => d.advertencias.map(m => ({ codigo: 'BLOQUE', mensaje: m }))),
      ...advertenciasValidacion,
    ],
    camposPendientes: camposPendientesFinal,
    puedeAplicarse: validacion.puedeAplicarse,
    puedeCalcularTiempoTotal: validacion.puedeCalcularTiempoTotal,
    puedeClasificarCronologicamente: validacion.puedeClasificarCronologicamente,
    requiereConfirmacion: validacion.requiereConfirmacion,
    patronTurnoCiclico: patronCiclico,
    minutosCicloCalculados,
    promedioSemanalMinutosCiclo,
    estadoAsignacion,
    informacionOperativa,
  };
}