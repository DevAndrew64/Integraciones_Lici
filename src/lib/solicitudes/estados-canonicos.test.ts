import { describe, it, expect } from 'vitest';
import {
  normalizarEstadoSolicitud, obtenerEtapaProceso, faseIdxDesdeEstadoCanonico,
  estadoRevisionLegadoEquivalente, resolverEstadoLegadoConsistente, normalizarEstadoSolicitudGlobal,
  ESTADOS_CANONICOS, ETAPA_POR_ESTADO,
  permiteCargarEvidencias, puedeIniciarElaboracion, motivoBloqueoEvidencias, evidenciasBloqueadas,
  puedeMostrarCostosEnFicha,
} from './estados-canonicos';

describe('normalizarEstadoSolicitud — valores legados (texto libre en BD hoy)', () => {
  it('cadena vacía / null / undefined → SELECCION_PROCESO', () => {
    expect(normalizarEstadoSolicitud('')).toBe('SELECCION_PROCESO');
    expect(normalizarEstadoSolicitud(null)).toBe('SELECCION_PROCESO');
    expect(normalizarEstadoSolicitud(undefined)).toBe('SELECCION_PROCESO');
  });
  it("'Selección de proceso' → SELECCION_PROCESO", () => {
    expect(normalizarEstadoSolicitud('Selección de proceso')).toBe('SELECCION_PROCESO');
  });
  it("'Revisión comercial' → REVISION_COMERCIAL", () => {
    expect(normalizarEstadoSolicitud('Revisión comercial')).toBe('REVISION_COMERCIAL');
  });
  it("'Asignado para revisión' sin estadoRevision → ASIGNADO_REVISION (default)", () => {
    expect(normalizarEstadoSolicitud('Asignado para revisión')).toBe('ASIGNADO_REVISION');
  });
  it("'Asignado para revisión' + estadoRevision=EN_REVISION → EN_REVISION", () => {
    expect(normalizarEstadoSolicitud('Asignado para revisión', 'EN_REVISION')).toBe('EN_REVISION');
  });
  it("'Asignado para revisión' + estadoRevision=LISTO_PARA_VALIDAR → REVISION_FINALIZADA", () => {
    expect(normalizarEstadoSolicitud('Asignado para revisión', 'LISTO_PARA_VALIDAR')).toBe('REVISION_FINALIZADA');
  });
  it("'Asignado para revisión' + estadoRevision=ASIGNADO_REVISION → ASIGNADO_REVISION", () => {
    expect(normalizarEstadoSolicitud('Asignado para revisión', 'ASIGNADO_REVISION')).toBe('ASIGNADO_REVISION');
  });
  it("'Asignado para revisión' + estadoRevision irrelevante (ej. CON_OBSERVACIONES) → default ASIGNADO_REVISION", () => {
    // CON_OBSERVACIONES nunca debería quedar como última fila con estadoSolicitud='Asignado para revisión'
    // en datos reales (le corresponde 'En observación'), pero la función no debe romperse ante ese caso.
    expect(normalizarEstadoSolicitud('Asignado para revisión', 'CON_OBSERVACIONES')).toBe('ASIGNADO_REVISION');
  });
  it("'En observación' → EN_OBSERVACION", () => {
    expect(normalizarEstadoSolicitud('En observación')).toBe('EN_OBSERVACION');
  });
  it("'Asignado para elaboración' → APROBADO_ELABORACION", () => {
    expect(normalizarEstadoSolicitud('Asignado para elaboración')).toBe('APROBADO_ELABORACION');
  });
  it("'En elaboración' → EN_ELABORACION", () => {
    expect(normalizarEstadoSolicitud('En elaboración')).toBe('EN_ELABORACION');
  });
  it("'En evaluación' → PRESENTADO (decisión aprobada: no existe EN_EVALUACION separado)", () => {
    expect(normalizarEstadoSolicitud('En evaluación')).toBe('PRESENTADO');
  });
  it("'Cerrada' → CERRADA", () => {
    expect(normalizarEstadoSolicitud('Cerrada')).toBe('CERRADA');
  });
  it("'Cancelada' → CANCELADA", () => {
    expect(normalizarEstadoSolicitud('Cancelada')).toBe('CANCELADA');
  });
  it('valor desconocido / basura → null explícito, NUNCA SELECCION_PROCESO por defecto', () => {
    expect(normalizarEstadoSolicitud('algo-que-no-existe')).toBeNull();
  });
  it("'ESTADO_INVENTADO' (no forma parte del dominio) → null, no se oculta como error", () => {
    expect(normalizarEstadoSolicitud('ESTADO_INVENTADO')).toBeNull();
  });
  it('es insensible a mayúsculas/acentos/espacios extra', () => {
    expect(normalizarEstadoSolicitud('  CANCELADA  ')).toBe('CANCELADA');
    expect(normalizarEstadoSolicitud('cerrada')).toBe('CERRADA');
  });
});

describe('normalizarEstadoSolicitud — valores canónicos nuevos (idempotencia)', () => {
  for (const estado of ESTADOS_CANONICOS) {
    it(`'${estado}' ya canónico → se devuelve igual`, () => {
      expect(normalizarEstadoSolicitud(estado)).toBe(estado);
    });
    it(`'${estado.toLowerCase()}' (minúscula) → se reconoce igual`, () => {
      expect(normalizarEstadoSolicitud(estado.toLowerCase())).toBe(estado);
    });
  }
});

describe('normalizarEstadoSolicitud — alias de estadoRevision (snake_case legado)', () => {
  it("'CON_OBSERVACIONES' → EN_OBSERVACION", () => {
    expect(normalizarEstadoSolicitud('CON_OBSERVACIONES')).toBe('EN_OBSERVACION');
  });
  it("'LISTO_PARA_VALIDAR' → REVISION_FINALIZADA", () => {
    expect(normalizarEstadoSolicitud('LISTO_PARA_VALIDAR')).toBe('REVISION_FINALIZADA');
  });
  it("'LISTO_PRESENTAR' (alias legado sin escritura viva) → PRESENTADO", () => {
    expect(normalizarEstadoSolicitud('LISTO_PRESENTAR')).toBe('PRESENTADO');
  });
});

describe('obtenerEtapaProceso — nunca depende de asignaciones[]', () => {
  it('SELECCION_PROCESO / REVISION_COMERCIAL → PRESELECCION', () => {
    expect(obtenerEtapaProceso('Selección de proceso')).toBe('PRESELECCION');
    expect(obtenerEtapaProceso('Revisión comercial')).toBe('PRESELECCION');
  });
  it('estados de validación → VALIDACION', () => {
    expect(obtenerEtapaProceso('Asignado para revisión')).toBe('VALIDACION');
    expect(obtenerEtapaProceso('Asignado para revisión', 'EN_REVISION')).toBe('VALIDACION');
    expect(obtenerEtapaProceso('En observación')).toBe('VALIDACION');
    expect(obtenerEtapaProceso('Asignado para revisión', 'LISTO_PARA_VALIDAR')).toBe('VALIDACION');
  });
  it('estados de ejecución → EJECUCION', () => {
    expect(obtenerEtapaProceso('Asignado para elaboración')).toBe('EJECUCION');
    expect(obtenerEtapaProceso('En elaboración')).toBe('EJECUCION');
  });
  it("'En evaluación' (PRESENTADO) → EVALUACION", () => {
    expect(obtenerEtapaProceso('En evaluación')).toBe('EVALUACION');
  });
  it('Cerrada/Cancelada → CIERRE', () => {
    expect(obtenerEtapaProceso('Cerrada')).toBe('CIERRE');
    expect(obtenerEtapaProceso('Cancelada')).toBe('CIERRE');
  });
  it('ejemplo obligatorio de la aclaración aprobada: EN_ELABORACION → EJECUCION, sin importar asignaciones[]', () => {
    expect(obtenerEtapaProceso('EN_ELABORACION')).toBe('EJECUCION');
  });
  it('estado desconocido → null explícito, NUNCA PRESELECCION por defecto', () => {
    expect(obtenerEtapaProceso('ESTADO_INVENTADO')).toBeNull();
    expect(obtenerEtapaProceso('algo-que-no-existe')).toBeNull();
  });
  it('PRESELECCION solo se devuelve para SELECCION_PROCESO/REVISION_COMERCIAL explícitos', () => {
    expect(obtenerEtapaProceso('SELECCION_PROCESO')).toBe('PRESELECCION');
    expect(obtenerEtapaProceso('REVISION_COMERCIAL')).toBe('PRESELECCION');
    expect(obtenerEtapaProceso('ESTADO_INVENTADO')).not.toBe('PRESELECCION');
  });
});

describe('estadoRevisionLegadoEquivalente — espejo temporal Fase 2', () => {
  it('mapea los 7 subestados intermedios a su equivalente legado de estadoRevision', () => {
    expect(estadoRevisionLegadoEquivalente('ASIGNADO_REVISION')).toBe('ASIGNADO_REVISION');
    expect(estadoRevisionLegadoEquivalente('EN_REVISION')).toBe('EN_REVISION');
    expect(estadoRevisionLegadoEquivalente('EN_OBSERVACION')).toBe('CON_OBSERVACIONES');
    expect(estadoRevisionLegadoEquivalente('REVISION_FINALIZADA')).toBe('LISTO_PARA_VALIDAR');
    expect(estadoRevisionLegadoEquivalente('APROBADO_ELABORACION')).toBe('APROBADO_ELABORACION');
    expect(estadoRevisionLegadoEquivalente('EN_ELABORACION')).toBe('EN_ELABORACION');
    expect(estadoRevisionLegadoEquivalente('PRESENTADO')).toBe('PRESENTADO');
  });
  it('no aplica a preselección/cierre — se maneja aparte (cerrar/route.ts) o no existe fila que espejar', () => {
    expect(estadoRevisionLegadoEquivalente('SELECCION_PROCESO')).toBeNull();
    expect(estadoRevisionLegadoEquivalente('REVISION_COMERCIAL')).toBeNull();
    expect(estadoRevisionLegadoEquivalente('CERRADA')).toBeNull();
    expect(estadoRevisionLegadoEquivalente('CANCELADA')).toBeNull();
  });
});

describe('ETAPA_POR_ESTADO — cobertura total del dominio (sin huecos)', () => {
  it('todos los estados canónicos tienen una etapa asignada', () => {
    for (const estado of ESTADOS_CANONICOS) {
      expect(ETAPA_POR_ESTADO[estado]).toBeDefined();
    }
  });
});

describe('faseIdxDesdeEstadoCanonico — para adaptar el stepper sin romper el heurístico legado', () => {
  it('reconoce los 11 valores canónicos con el índice esperado (0-8, stepper de 9 fases sin "Revisión finalizada")', () => {
    expect(faseIdxDesdeEstadoCanonico('SELECCION_PROCESO')).toBe(0);
    expect(faseIdxDesdeEstadoCanonico('REVISION_COMERCIAL')).toBe(1);
    expect(faseIdxDesdeEstadoCanonico('ASIGNADO_REVISION')).toBe(2);
    expect(faseIdxDesdeEstadoCanonico('EN_REVISION')).toBe(2);
    expect(faseIdxDesdeEstadoCanonico('EN_OBSERVACION')).toBe(3);
    // REVISION_FINALIZADA comparte índice con APROBADO_ELABORACION — ya no
    // hay paso visual propio "Revisión finalizada" (sin aprobación posterior
    // de Coordinador/Director).
    expect(faseIdxDesdeEstadoCanonico('REVISION_FINALIZADA')).toBe(4);
    expect(faseIdxDesdeEstadoCanonico('APROBADO_ELABORACION')).toBe(4);
    expect(faseIdxDesdeEstadoCanonico('EN_ELABORACION')).toBe(5);
    expect(faseIdxDesdeEstadoCanonico('PRESENTADO')).toBe(6);
    expect(faseIdxDesdeEstadoCanonico('CERRADA')).toBe(8);
    expect(faseIdxDesdeEstadoCanonico('CANCELADA')).toBe(8);
  });
  it('reconoce los alias de estadoRevision', () => {
    expect(faseIdxDesdeEstadoCanonico('CON_OBSERVACIONES')).toBe(3);
    // Alias legado LISTO_PARA_VALIDAR → REVISION_FINALIZADA → mismo índice
    // que "Asignado para elaboración" (histórico, sin backfill).
    expect(faseIdxDesdeEstadoCanonico('LISTO_PARA_VALIDAR')).toBe(4);
    expect(faseIdxDesdeEstadoCanonico('LISTO_PRESENTAR')).toBe(6);
  });
  it('devuelve null para texto legado libre (el llamador conserva su propio heurístico)', () => {
    expect(faseIdxDesdeEstadoCanonico('Asignado para revisión')).toBeNull();
    expect(faseIdxDesdeEstadoCanonico('En observación')).toBeNull();
    expect(faseIdxDesdeEstadoCanonico('')).toBeNull();
    expect(faseIdxDesdeEstadoCanonico(null)).toBeNull();
  });
});

describe('resolverEstadoLegadoConsistente — nunca elige el estado de un usuario en particular', () => {
  it('sin ninguna fila con estadoRevision válido → SIN_ASIGNACIONES', () => {
    expect(resolverEstadoLegadoConsistente([])).toEqual({ ok: false, motivo: 'SIN_ASIGNACIONES' });
    expect(resolverEstadoLegadoConsistente([null, undefined, ''])).toEqual({ ok: false, motivo: 'SIN_ASIGNACIONES' });
  });
  it('una sola fila válida → se usa esa', () => {
    expect(resolverEstadoLegadoConsistente(['APROBADO_ELABORACION'])).toEqual({ ok: true, estado: 'APROBADO_ELABORACION' });
  });
  it('varias filas, todas coinciden (mismo canónico, aunque algunas sean alias distintos) → se usa ese', () => {
    expect(resolverEstadoLegadoConsistente(['EN_REVISION', 'EN_REVISION', 'EN_REVISION'])).toEqual({ ok: true, estado: 'EN_REVISION' });
  });
  it('varias filas con estados distintos → AMBIGUO, nunca se elige una', () => {
    expect(resolverEstadoLegadoConsistente(['EN_REVISION', 'CON_OBSERVACIONES'])).toEqual({ ok: false, motivo: 'AMBIGUO' });
  });
  it('caso del proceso 50 (Juan y Laura, ambos APROBADO_ELABORACION) → consistente, sin importar el orden', () => {
    expect(resolverEstadoLegadoConsistente(['APROBADO_ELABORACION', 'APROBADO_ELABORACION'])).toEqual({ ok: true, estado: 'APROBADO_ELABORACION' });
    expect(resolverEstadoLegadoConsistente(['APROBADO_ELABORACION', ''])).toEqual({ ok: true, estado: 'APROBADO_ELABORACION' });
  });
  it('filas con valores irreconocibles se ignoran, no cuentan como fuente de ambigüedad', () => {
    expect(resolverEstadoLegadoConsistente(['EN_REVISION', 'basura-desconocida'])).toEqual({ ok: true, estado: 'EN_REVISION' });
  });
});

describe('normalizarEstadoSolicitudGlobal — fuente única del estado visible, arranca en estadoSolicitud', () => {
  it('valores legados NO ambiguos se resuelven sin consultar ninguna fila', () => {
    expect(normalizarEstadoSolicitudGlobal('Asignado para elaboración', ['cualquier-cosa-irrelevante'])).toEqual({ estado: 'APROBADO_ELABORACION', ambiguo: false });
    expect(normalizarEstadoSolicitudGlobal('En observación', [])).toEqual({ estado: 'EN_OBSERVACION', ambiguo: false });
    expect(normalizarEstadoSolicitudGlobal('En evaluación', [])).toEqual({ estado: 'PRESENTADO', ambiguo: false });
    expect(normalizarEstadoSolicitudGlobal('Cerrada', [])).toEqual({ estado: 'CERRADA', ambiguo: false });
    expect(normalizarEstadoSolicitudGlobal('Cancelada', [])).toEqual({ estado: 'CANCELADA', ambiguo: false });
  });
  it('caso real del proceso 50: "Asignado para elaboración" es no ambiguo, se normaliza directo (ignora las filas)', () => {
    const r = normalizarEstadoSolicitudGlobal('Asignado para elaboración', ['APROBADO_ELABORACION', 'APROBADO_ELABORACION']);
    expect(r).toEqual({ estado: 'APROBADO_ELABORACION', ambiguo: false });
    // Y da EXACTAMENTE el mismo resultado sin ninguna fila (Administrador sin asignación propia):
    expect(normalizarEstadoSolicitudGlobal('Asignado para elaboración', [])).toEqual({ estado: 'APROBADO_ELABORACION', ambiguo: false });
  });
  it('"Asignado para revisión" con filas activas consistentes → usa ese subestado', () => {
    expect(normalizarEstadoSolicitudGlobal('Asignado para revisión', ['EN_REVISION', 'EN_REVISION'])).toEqual({ estado: 'EN_REVISION', ambiguo: false });
    expect(normalizarEstadoSolicitudGlobal('Asignado para revisión', ['LISTO_PARA_VALIDAR'])).toEqual({ estado: 'REVISION_FINALIZADA', ambiguo: false });
  });
  it('"Asignado para revisión" sin ninguna fila → ASIGNADO_REVISION por defecto, sin ambigüedad', () => {
    expect(normalizarEstadoSolicitudGlobal('Asignado para revisión', [])).toEqual({ estado: 'ASIGNADO_REVISION', ambiguo: false });
  });
  it('"Asignado para revisión" con filas contradictorias → ASIGNADO_REVISION (base segura VALIDACION) con ambiguo:true, NUNCA null ni "Selección de proceso"', () => {
    const r = normalizarEstadoSolicitudGlobal('Asignado para revisión', ['EN_REVISION', 'CON_OBSERVACIONES']);
    expect(r.estado).toBe('ASIGNADO_REVISION');
    expect(r.ambiguo).toBe(true);
  });
  it('ya canónico → se devuelve igual, sin ambigüedad, sin mirar filas', () => {
    expect(normalizarEstadoSolicitudGlobal('EN_ELABORACION', ['lo-que-sea'])).toEqual({ estado: 'EN_ELABORACION', ambiguo: false });
  });
  it('valor totalmente irreconocible → estado null, ambiguo false (no es el caso de ambigüedad de filas)', () => {
    expect(normalizarEstadoSolicitudGlobal('ESTADO_INVENTADO', [])).toEqual({ estado: null, ambiguo: false });
  });
  it('el resultado es idéntico sin importar qué usuario/rol consulte (misma entrada → misma salida)', () => {
    const entradas = ['Asignado para revisión', ['EN_REVISION', 'EN_REVISION']] as const;
    const r1 = normalizarEstadoSolicitudGlobal(...entradas);
    const r2 = normalizarEstadoSolicitudGlobal(...entradas);
    expect(r1).toEqual(r2);
  });
});

/**
 * Predicados de evidencias — regla GENERAL del módulo Procesos, sin ningún
 * ID/proceso/responsable/SQR hardcodeado. Casos sintéticos únicamente.
 */
describe('permiteCargarEvidencias — regla general (cualquier solicitud)', () => {
  it('EN_ELABORACION (canónico) permite cargar evidencias', () => {
    expect(permiteCargarEvidencias('EN_ELABORACION')).toBe(true);
  });
  it('alias legado "En elaboración..." permite cargar evidencias', () => {
    expect(permiteCargarEvidencias('En elaboración')).toBe(true);
    expect(permiteCargarEvidencias('en elaboracion')).toBe(true);
  });
  it('APROBADO_ELABORACION NO permite cargar evidencias todavía (etapa "por iniciar", no "en curso")', () => {
    expect(permiteCargarEvidencias('APROBADO_ELABORACION')).toBe(false);
    expect(permiteCargarEvidencias('Asignado para elaboración')).toBe(false);
  });
  it('PRESENTADO no permite cargar evidencias', () => {
    expect(permiteCargarEvidencias('PRESENTADO')).toBe(false);
  });
  it('En evaluación (legado) no permite cargar evidencias', () => {
    expect(permiteCargarEvidencias('En evaluación')).toBe(false);
  });
  it('estados terminales no permiten cargar evidencias', () => {
    for (const e of ['CERRADA', 'CANCELADA', 'RECHAZADO', 'CERRADO_ADJUDICADO', 'CERRADO_NO_ADJUDICADO', 'CERRADO_NO_CUMPLIMIENTO', 'CANCELADO']) {
      expect(permiteCargarEvidencias(e)).toBe(false);
    }
  });
  it('estados anteriores (validación) no permiten cargar evidencias', () => {
    for (const e of ['ASIGNADO_REVISION', 'EN_REVISION', 'CON_OBSERVACIONES', 'LISTO_PARA_VALIDAR', 'REVISION_FINALIZADA']) {
      expect(permiteCargarEvidencias(e)).toBe(false);
    }
  });
  it('vacío/null/undefined no permite cargar evidencias', () => {
    expect(permiteCargarEvidencias('')).toBe(false);
    expect(permiteCargarEvidencias(null)).toBe(false);
    expect(permiteCargarEvidencias(undefined)).toBe(false);
  });
});

describe('puedeIniciarElaboracion — regla general', () => {
  it('APROBADO_ELABORACION (canónico) permite Iniciar elaboración', () => {
    expect(puedeIniciarElaboracion('APROBADO_ELABORACION')).toBe(true);
  });
  it('alias legado "Asignado para elaboración" permite Iniciar elaboración', () => {
    expect(puedeIniciarElaboracion('Asignado para elaboración')).toBe(true);
  });
  it('EN_ELABORACION ya no permite (re)iniciar elaboración', () => {
    expect(puedeIniciarElaboracion('EN_ELABORACION')).toBe(false);
  });
  it('estados fuera de ejecución no permiten iniciar elaboración', () => {
    for (const e of ['ASIGNADO_REVISION', 'EN_REVISION', 'PRESENTADO', 'CERRADA']) {
      expect(puedeIniciarElaboracion(e)).toBe(false);
    }
  });
});

describe('motivoBloqueoEvidencias / evidenciasBloqueadas — regla general, mensaje correcto por estado', () => {
  it('EN_ELABORACION nunca produce un motivo de bloqueo (bug reproducido: no debe decir "Enviado a evaluación")', () => {
    expect(motivoBloqueoEvidencias('EN_ELABORACION')).toBeNull();
    expect(evidenciasBloqueadas('EN_ELABORACION')).toBe(false);
  });
  it('APROBADO_ELABORACION tampoco produce motivo de bloqueo (no es "enviado", solo "aún no iniciado")', () => {
    expect(motivoBloqueoEvidencias('APROBADO_ELABORACION')).toBeNull();
    expect(evidenciasBloqueadas('APROBADO_ELABORACION')).toBe(false);
  });
  it('PRESENTADO → motivo PRESENTADO', () => {
    expect(motivoBloqueoEvidencias('PRESENTADO')).toBe('PRESENTADO');
    expect(evidenciasBloqueadas('PRESENTADO')).toBe(true);
  });
  it('En evaluación (legado) → motivo EN_EVALUACION', () => {
    expect(motivoBloqueoEvidencias('En evaluación')).toBe('EN_EVALUACION');
    expect(evidenciasBloqueadas('En evaluación')).toBe(true);
  });
  it('cualquier estado terminal → motivo TERMINAL', () => {
    for (const e of ['CERRADA', 'CANCELADA', 'RECHAZADO', 'CERRADO_ADJUDICADO', 'CERRADO_NO_ADJUDICADO', 'CERRADO_NO_CUMPLIMIENTO', 'CANCELADO']) {
      expect(motivoBloqueoEvidencias(e)).toBe('TERMINAL');
      expect(evidenciasBloqueadas(e)).toBe(true);
    }
  });
  it('estados de validación (aún no llegan a ejecución) no tienen motivo de bloqueo de evidencias — no aplica la pregunta todavía', () => {
    expect(motivoBloqueoEvidencias('ASIGNADO_REVISION')).toBeNull();
    expect(motivoBloqueoEvidencias('EN_REVISION')).toBeNull();
  });
});

// Ajuste "COSTOS SOLO DESDE 'EN EJECUCIÓN' EN ADELANTE" — fuente única de
// la regla de visibilidad de la pestaña "Costos" en la ficha del proceso.
describe('puedeMostrarCostosEnFicha — Por validar/En observación NO, En ejecución/En evaluación/Cerrado SÍ', () => {
  it('Por validar (SELECCION_PROCESO/REVISION_COMERCIAL/ASIGNADO_REVISION/EN_REVISION) → false', () => {
    for (const e of ['SELECCION_PROCESO', 'REVISION_COMERCIAL', 'ASIGNADO_REVISION', 'EN_REVISION', '', 'Asignado para revisión']) {
      expect(puedeMostrarCostosEnFicha(e)).toBe(false);
    }
  });

  it('En observación (EN_OBSERVACION/REVISION_FINALIZADA, canónico y legado) → false', () => {
    expect(puedeMostrarCostosEnFicha('EN_OBSERVACION')).toBe(false);
    expect(puedeMostrarCostosEnFicha('En observación')).toBe(false);
    expect(puedeMostrarCostosEnFicha('REVISION_FINALIZADA')).toBe(false);
  });

  it('En ejecución (APROBADO_ELABORACION/EN_ELABORACION, canónico y legado) → true', () => {
    expect(puedeMostrarCostosEnFicha('APROBADO_ELABORACION')).toBe(true);
    expect(puedeMostrarCostosEnFicha('Asignado para elaboración')).toBe(true);
    expect(puedeMostrarCostosEnFicha('EN_ELABORACION')).toBe(true);
    expect(puedeMostrarCostosEnFicha('En elaboración')).toBe(true);
  });

  it('En evaluación (PRESENTADO, canónico y legado) → true', () => {
    expect(puedeMostrarCostosEnFicha('PRESENTADO')).toBe(true);
    expect(puedeMostrarCostosEnFicha('En evaluación')).toBe(true);
  });

  it('Cerrado (CERRADA/CANCELADA, canónico y legado) → true', () => {
    expect(puedeMostrarCostosEnFicha('CERRADA')).toBe(true);
    expect(puedeMostrarCostosEnFicha('Cerrada')).toBe(true);
    expect(puedeMostrarCostosEnFicha('CANCELADA')).toBe(true);
    expect(puedeMostrarCostosEnFicha('Cancelada')).toBe(true);
  });

  it('el costeo iniciado en ejecución acompaña al proceso hasta el cierre — nunca se vuelve a ocultar entre EJECUCION→EVALUACION→CIERRE', () => {
    const secuencia = ['APROBADO_ELABORACION', 'EN_ELABORACION', 'PRESENTADO', 'CERRADA'];
    expect(secuencia.every(e => puedeMostrarCostosEnFicha(e))).toBe(true);
  });

  it('estado desconocido/irreconocible → false (nunca se asume visible ante un dato inesperado)', () => {
    expect(puedeMostrarCostosEnFicha('algo-que-no-existe')).toBe(false);
    expect(puedeMostrarCostosEnFicha(null)).toBe(false);
    expect(puedeMostrarCostosEnFicha(undefined)).toBe(false);
  });
});