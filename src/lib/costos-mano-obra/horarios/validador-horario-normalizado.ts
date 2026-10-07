/**
 * Etapas 12-14 — compara datos calculados contra declarados, evalúa el
 * nivel de confianza y produce el estado operativo final + advertencias +
 * campos pendientes. No decide NADA por sí solo cuando hay ambigüedad —
 * solo clasifica.
 */
import type {
  AdvertenciaNormalizacion, CampoPendienteHorario, DistribucionHorarioNormalizada,
  EstadoNormalizacionHorario,
} from './tipos-normalizacion';

export interface ResultadoValidacion {
  estado: EstadoNormalizacionHorario;
  nivelConfianza: 'ALTO' | 'MEDIO' | 'BAJO';
  advertenciasAdicionales: AdvertenciaNormalizacion[];
  camposPendientes: CampoPendienteHorario[];
  puedeAplicarse: boolean;
  puedeCalcularTiempoTotal: boolean;
  puedeClasificarCronologicamente: boolean;
  requiereConfirmacion: boolean;
}

export interface EntradaValidacion {
  distribuciones: DistribucionHorarioNormalizada[];
  huboFalloDeParseo: boolean;
  motivoFalloParseo: string | null;
  requiereConfirmarHora: boolean;
  sugerenciaHora: string | null;
  separadorDegradado: boolean;
  posibleIntercambioDeCampos: boolean;
  minutosSemanaCalculados: number | null;
  horasSemanaDeclaradas: number | null;
}

export function validarNormalizacion(entrada: EntradaValidacion): ResultadoValidacion {
  const camposPendientes: CampoPendienteHorario[] = [];
  const advertenciasAdicionales: AdvertenciaNormalizacion[] = [];

  if (entrada.huboFalloDeParseo) {
    if (entrada.requiereConfirmarHora) {
      camposPendientes.push({ campo: 'hora', motivo: entrada.motivoFalloParseo ?? 'Hora ambigua.' });
      return {
        estado: 'REQUIERE_CONFIRMAR_HORA', nivelConfianza: 'BAJO', advertenciasAdicionales, camposPendientes,
        puedeAplicarse: false, puedeCalcularTiempoTotal: false, puedeClasificarCronologicamente: false, requiereConfirmacion: true,
      };
    }
    camposPendientes.push({ campo: 'horario', motivo: entrada.motivoFalloParseo ?? 'No se pudo interpretar el texto del horario.' });
    return {
      estado: 'HORARIO_NO_INTERPRETABLE', nivelConfianza: 'BAJO', advertenciasAdicionales, camposPendientes,
      puedeAplicarse: false, puedeCalcularTiempoTotal: false, puedeClasificarCronologicamente: false, requiereConfirmacion: true,
    };
  }

  if (entrada.posibleIntercambioDeCampos) {
    camposPendientes.push({ campo: 'horario/jornada', motivo: 'HORARIO parece contener días/rotación y JORNADA parece contener horas — posible intercambio de campos.' });
    return {
      estado: 'POSIBLE_INTERCAMBIO_DE_CAMPOS', nivelConfianza: 'BAJO', advertenciasAdicionales, camposPendientes,
      puedeAplicarse: false, puedeCalcularTiempoTotal: false, puedeClasificarCronologicamente: false, requiereConfirmacion: true,
    };
  }

  const algunaRequiereDescansoDetalle = entrada.distribuciones.some(d => d.descansoDeclaradoMinutos === null && !d.descansoUbicado && d.minutosTrabajoCalculados === null);
  if (algunaRequiereDescansoDetalle) {
    camposPendientes.push({ campo: 'descanso', motivo: 'El horario incluye un descanso sin duración conocida — no se puede determinar el tiempo trabajado.' });
    return {
      estado: 'REQUIERE_DETALLE_DESCANSO', nivelConfianza: 'BAJO', advertenciasAdicionales, camposPendientes,
      puedeAplicarse: true, puedeCalcularTiempoTotal: false, puedeClasificarCronologicamente: false, requiereConfirmacion: true,
    };
  }

  const algunaRequiereUbicarDescanso = entrada.distribuciones.some(d => d.descansoDeclaradoMinutos !== null && !d.descansoUbicado);
  if (algunaRequiereUbicarDescanso) {
    camposPendientes.push({ campo: 'descanso', motivo: 'Se conoce la duración del descanso pero no su ubicación dentro de la jornada.' });
    return {
      estado: 'REQUIERE_UBICAR_DESCANSO', nivelConfianza: 'MEDIO', advertenciasAdicionales, camposPendientes,
      puedeAplicarse: true, puedeCalcularTiempoTotal: true, puedeClasificarCronologicamente: false, requiereConfirmacion: true,
    };
  }

  const algunaSinDias = entrada.distribuciones.some(d => d.diasSemana.length === 0);
  const algunaRotacionPendiente = entrada.distribuciones.some(d => d.tipoAplicacion === 'PENDIENTE_CONFIRMACION');
  // Una distribución ROTACION_SEMANAL/TURNANTE siempre requiere confirmar el
  // patrón de rotación, incluso si un rango de días (ej. "LUNES A DOMINGO")
  // ya se asignó mecánicamente — un trabajador en rotación no "trabaja los 7
  // días": esos 7 días describen la COBERTURA del turno, no el patrón
  // individual, y nunca deben tratarse como si ya estuviera confirmado.
  const algunaEsRotacionOTurnante = entrada.distribuciones.some(d => d.tipoAplicacion === 'ROTACION_SEMANAL' || d.tipoAplicacion === 'TURNANTE');
  if (algunaSinDias || algunaRotacionPendiente || algunaEsRotacionOTurnante) {
    if (algunaEsRotacionOTurnante) {
      camposPendientes.push({ campo: 'rotacion', motivo: 'Se detectó una rotación/turnante pero la secuencia de semanas no es suficientemente clara.' });
      return {
        estado: 'REQUIERE_CONFIRMAR_ROTACION', nivelConfianza: 'MEDIO', advertenciasAdicionales, camposPendientes,
        puedeAplicarse: true, puedeCalcularTiempoTotal: true, puedeClasificarCronologicamente: true, requiereConfirmacion: true,
      };
    }
    if (entrada.distribuciones.length > 1) {
      camposPendientes.push({ campo: 'dias', motivo: 'Hay varias distribuciones pero no se pudieron asignar los días de cada una.' });
      return {
        estado: 'HORARIO_COMPUESTO_PENDIENTE', nivelConfianza: 'MEDIO', advertenciasAdicionales, camposPendientes,
        puedeAplicarse: true, puedeCalcularTiempoTotal: true, puedeClasificarCronologicamente: true, requiereConfirmacion: true,
      };
    }
    camposPendientes.push({ campo: 'dias', motivo: 'No se pudieron determinar los días de la semana de este horario.' });
    return {
      estado: 'REQUIERE_ASIGNAR_DIAS', nivelConfianza: 'MEDIO', advertenciasAdicionales, camposPendientes,
      puedeAplicarse: true, puedeCalcularTiempoTotal: true, puedeClasificarCronologicamente: true, requiereConfirmacion: true,
    };
  }

  if (entrada.separadorDegradado) {
    camposPendientes.push({ campo: 'separadores', motivo: 'Se usó un separador no estándar (posible error de digitación) entre distribuciones.' });
    return {
      estado: 'REQUIERE_CONFIRMAR_SEPARADORES', nivelConfianza: 'MEDIO', advertenciasAdicionales, camposPendientes,
      puedeAplicarse: true, puedeCalcularTiempoTotal: true, puedeClasificarCronologicamente: true, requiereConfirmacion: true,
    };
  }

  const cruzaMedianoche = entrada.distribuciones.some(d => d.cruzaMedianoche);
  const hayAdvertenciasDeBloques = entrada.distribuciones.some(d => d.advertencias.length > 0);

  const difiereDeDeclarado =
    entrada.horasSemanaDeclaradas !== null && entrada.minutosSemanaCalculados !== null &&
    Math.abs(entrada.minutosSemanaCalculados - entrada.horasSemanaDeclaradas * 60) > 1;
  if (difiereDeDeclarado) {
    advertenciasAdicionales.push({ codigo: 'DIFIERE_HORAS_SEMANA_DECLARADAS', mensaje: `Las horas semanales declaradas (${entrada.horasSemanaDeclaradas}) no coinciden con las calculadas desde los bloques (${(entrada.minutosSemanaCalculados! / 60).toFixed(2)}). Se conservan ambas, sin descartar ninguna.` });
    return {
      estado: 'DIFIERE_DE_DATOS_DECLARADOS', nivelConfianza: 'MEDIO', advertenciasAdicionales, camposPendientes,
      puedeAplicarse: true, puedeCalcularTiempoTotal: true, puedeClasificarCronologicamente: true, requiereConfirmacion: false,
    };
  }

  if (hayAdvertenciasDeBloques) {
    return {
      estado: 'NORMALIZADO_CON_ADVERTENCIAS', nivelConfianza: 'MEDIO', advertenciasAdicionales, camposPendientes,
      puedeAplicarse: true, puedeCalcularTiempoTotal: true, puedeClasificarCronologicamente: true, requiereConfirmacion: true,
    };
  }

  if (cruzaMedianoche) {
    // El cruce de medianoche ya se resolvió con offsets de día (no es un
    // bloqueo) — se conserva como advertencia informativa, no como estado.
    advertenciasAdicionales.push({ codigo: 'CRUCE_MEDIANOCHE', mensaje: 'El horario cruza la medianoche — resuelto con offsets de día.' });
  }

  return {
    estado: 'NORMALIZADO', nivelConfianza: 'ALTO', advertenciasAdicionales, camposPendientes,
    puedeAplicarse: true, puedeCalcularTiempoTotal: true, puedeClasificarCronologicamente: true, requiereConfirmacion: false,
  };
}