import { describe, it, expect } from 'vitest';
import { obtenerObservacionCierreTerminal, ETIQUETA_CAUSAL_RECHAZO, obtenerFilaCierreTerminal, ESTADOS_REVISION_TERMINALES } from './observacion-cierre-terminal';

describe('ETIQUETA_CAUSAL_RECHAZO', () => {
  it('incluye las 5 causales originales y la nueva OTRA_CAUSA', () => {
    expect(ETIQUETA_CAUSAL_RECHAZO.ESTUDIO_MERCADO).toBe('Estudio de mercado');
    expect(ETIQUETA_CAUSAL_RECHAZO.PROCESO_DUPLICADO).toBe('Proceso duplicado');
    expect(ETIQUETA_CAUSAL_RECHAZO.NO_OBJETO_SOCIAL).toBe('No corresponde a objeto social');
    expect(ETIQUETA_CAUSAL_RECHAZO.SERVICIOS_ESPECIALIZADOS).toBe('Servicios especializados');
    expect(ETIQUETA_CAUSAL_RECHAZO.DECISION_GERENCIAL).toBe('Decisión gerencial');
    expect(ETIQUETA_CAUSAL_RECHAZO.OTRA_CAUSA).toBe('Otra causa');
  });
});

describe('obtenerObservacionCierreTerminal — Ajuste "OTRA CAUSA — RECHAZO"', () => {
  it('null/undefined → null (cierre administrativo directo sin fila)', () => {
    expect(obtenerObservacionCierreTerminal(null)).toBeNull();
    expect(obtenerObservacionCierreTerminal(undefined)).toBeNull();
  });

  it('OTRA_CAUSA con observacionRechazo (detalle) presente devuelve el detalle real (7)', () => {
    const fila = { estadoRevision: 'RECHAZADO', causalRechazo: 'OTRA_CAUSA', observacionRechazo: 'El cliente cambió las condiciones del servicio.' };
    expect(obtenerObservacionCierreTerminal(fila)).toBe('El cliente cambió las condiciones del servicio.');
  });

  it('causalRechazo="OTRA_CAUSA" SIN observacionRechazo (dato histórico/inconsistente) cae a la etiqueta legible "Otra causa" — nunca al código interno', () => {
    const fila = { estadoRevision: 'RECHAZADO', causalRechazo: 'OTRA_CAUSA' };
    expect(obtenerObservacionCierreTerminal(fila)).toBe('Otra causa');
  });

  it('causalRechazo de una de las 5 causales existentes, sin observación, sigue devolviendo su etiqueta (sin regresión)', () => {
    const fila = { estadoRevision: 'RECHAZADO', causalRechazo: 'PROCESO_DUPLICADO' };
    expect(obtenerObservacionCierreTerminal(fila)).toBe('Proceso duplicado');
  });

  it('motivoRechazo (flujo simple) sigue teniendo prioridad sobre causalRechazo/observacionRechazo — comportamiento sin cambios', () => {
    const fila = { estadoRevision: 'RECHAZADO', motivoRechazo: 'Motivo simple.', causalRechazo: 'OTRA_CAUSA', observacionRechazo: 'Detalle causal.' };
    expect(obtenerObservacionCierreTerminal(fila)).toBe('Motivo simple.');
  });
});

describe('obtenerObservacionCierreTerminal — Ajuste "DETALLE DEL CIERRE — ADJUDICADO/NO ADJUDICADO"', () => {
  it('CERRADO_ADJUDICADO con observacionResultado devuelve ese texto', () => {
    expect(obtenerObservacionCierreTerminal({ estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Adjudicado', observacionResultado: 'Cumplió todos los requisitos.' })).toBe('Cumplió todos los requisitos.');
  });
  it('CERRADO_NO_ADJUDICADO con observacionResultado devuelve ese texto (misma rama)', () => {
    expect(obtenerObservacionCierreTerminal({ estadoRevision: 'CERRADO_NO_ADJUDICADO', resultadoFinal: 'No adjudicado', observacionResultado: 'Otro oferente ganó.' })).toBe('Otro oferente ganó.');
  });
  it('CERRADO_ADJUDICADO sin observacionResultado (o solo espacios) → null, nunca cae a motivoRechazo/causalRechazo/etc.', () => {
    expect(obtenerObservacionCierreTerminal({ estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Adjudicado' })).toBeNull();
    expect(obtenerObservacionCierreTerminal({ estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Adjudicado', observacionResultado: '   ' })).toBeNull();
  });
  it('observacionResultado NUNCA se usa como fallback genérico para otros estados (RECHAZADO/CANCELADO/etc.) — el gate es por estadoRevision, no por presencia del campo', () => {
    // Aunque el campo estuviera presente por error de datos, una fila
    // RECHAZADO sigue resolviendo por su propia prioridad, ignorando
    // observacionResultado por completo.
    const filaConCampoAjeno = { estadoRevision: 'RECHAZADO', motivoRechazo: 'Motivo real del rechazo', observacionResultado: 'No debería usarse esto' };
    expect(obtenerObservacionCierreTerminal(filaConCampoAjeno)).toBe('Motivo real del rechazo');
  });
  it('CERRADO_ADJUDICADO/CERRADO_NO_ADJUDICADO nunca leen motivoRechazo/causalRechazo/causaNoPresentacion (aunque estuvieran presentes) — la rama de resultado es exclusiva', () => {
    const filaMezclada = { estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Adjudicado', motivoRechazo: 'No debería usarse', causaEspecifica: 'Tampoco esto' };
    expect(obtenerObservacionCierreTerminal(filaMezclada)).toBeNull();
  });
});

describe('ESTADOS_REVISION_TERMINALES — reutiliza ESTADOS_REVISION_NO_PRESENTADO, sin duplicar la lista', () => {
  it('incluye los 5 estados terminales reales del proyecto', () => {
    expect(ESTADOS_REVISION_TERMINALES.has('CERRADO_ADJUDICADO')).toBe(true);
    expect(ESTADOS_REVISION_TERMINALES.has('CERRADO_NO_ADJUDICADO')).toBe(true);
    expect(ESTADOS_REVISION_TERMINALES.has('RECHAZADO')).toBe(true);
    expect(ESTADOS_REVISION_TERMINALES.has('CANCELADO')).toBe(true);
    expect(ESTADOS_REVISION_TERMINALES.has('CERRADO_NO_CUMPLIMIENTO')).toBe(true);
    expect(ESTADOS_REVISION_TERMINALES.size).toBe(5);
  });
});

describe('obtenerFilaCierreTerminal — Ajuste "MOTIVO DEL CIERRE — FILA TERMINAL REAL"', () => {
  it('sin asignaciones (null/undefined/[]) → null', () => {
    expect(obtenerFilaCierreTerminal(null)).toBeNull();
    expect(obtenerFilaCierreTerminal(undefined)).toBeNull();
    expect(obtenerFilaCierreTerminal([])).toBeNull();
  });

  it('(A) 2 filas: asigActual sin motivo (no terminal) + otra fila RECHAZADO con motivoRechazo → devuelve la fila RECHAZADO', () => {
    const asigActualSinMotivo = { idAsignacion: '1', estadoRevision: 'EN_ELABORACION', analistaAsignado: 'juan.davila' };
    const filaRechazada = { idAsignacion: '2', estadoRevision: 'RECHAZADO', motivoRechazo: 'No cumple requisitos técnicos', fechaCierre: '2026-08-13T17:28:00.000Z' };
    const fila = obtenerFilaCierreTerminal([asigActualSinMotivo, filaRechazada]);
    expect(fila).toBe(filaRechazada);
    expect(obtenerObservacionCierreTerminal(fila)).toBe('No cumple requisitos técnicos');
  });

  it('(B) fila terminal con observacionRechazo → el motivo real sale de esa fila', () => {
    const filaRechazada = { idAsignacion: '2', estadoRevision: 'RECHAZADO', causalRechazo: 'ESTUDIO_MERCADO', observacionRechazo: 'Detalle específico del rechazo', fechaCierre: '2026-08-13T17:28:00.000Z' };
    const fila = obtenerFilaCierreTerminal([{ idAsignacion: '1', estadoRevision: 'EN_ELABORACION' }, filaRechazada]);
    expect(obtenerObservacionCierreTerminal(fila)).toBe('Detalle específico del rechazo');
  });

  it('(C) fila terminal con detalleCierreDirecto → el motivo real sale de esa fila', () => {
    const filaCierreDirecto = { idAsignacion: '2', estadoRevision: 'CERRADO_NO_CUMPLIMIENTO', causaNoPresentacion: 'Presupuesto insuficiente', detalleCierreDirecto: 'Presupuesto asignado no alcanzó', fechaCierre: '2026-08-13T17:28:00.000Z' };
    const fila = obtenerFilaCierreTerminal([{ idAsignacion: '1', estadoRevision: 'PRESENTADO' }, filaCierreDirecto]);
    expect(obtenerObservacionCierreTerminal(fila)).toBe('Presupuesto asignado no alcanzó');
  });

  it('(D) varias filas terminales → selecciona la más reciente por fechaCierre', () => {
    const antigua = { idAsignacion: '1', estadoRevision: 'RECHAZADO', motivoRechazo: 'Motivo antiguo', fechaCierre: '2026-01-10T10:00:00.000Z' };
    const reciente = { idAsignacion: '2', estadoRevision: 'CERRADO_NO_CUMPLIMIENTO', causaNoPresentacion: 'Otros', detalleCierreDirecto: 'Motivo reciente', fechaCierre: '2026-08-13T17:28:00.000Z' };
    const fila = obtenerFilaCierreTerminal([antigua, reciente]);
    expect(fila).toBe(reciente);
    expect(obtenerObservacionCierreTerminal(fila)).toBe('Motivo reciente');
  });

  it('varias filas terminales sin fechaCierre parseable → fallback determinístico: la última en el orden recibido', () => {
    const primera = { idAsignacion: '1', estadoRevision: 'RECHAZADO', motivoRechazo: 'Primera' };
    const segunda = { idAsignacion: '2', estadoRevision: 'CANCELADO', causaNoPresentacion: 'Cancelación por la entidad' };
    const fila = obtenerFilaCierreTerminal([primera, segunda]);
    expect(fila).toBe(segunda);
  });

  it('(E) ninguna fila es terminal → null', () => {
    expect(obtenerFilaCierreTerminal([
      { idAsignacion: '1', estadoRevision: 'EN_ELABORACION' },
      { idAsignacion: '2', estadoRevision: 'PRESENTADO' },
    ])).toBeNull();
  });

  it('(G) la fila propia del viewer (asignacionPropia) puede no ser la terminal — el resultado no depende de analistaAsignado ni de ningún criterio de identidad', () => {
    const filaDelViewer = { idAsignacion: '1', estadoRevision: 'EN_ELABORACION', analistaAsignado: 'viewer.actual' };
    const filaTerminalDeOtroAnalista = { idAsignacion: '2', estadoRevision: 'RECHAZADO', motivoRechazo: 'Motivo real', analistaAsignado: 'otro.analista', fechaCierre: '2026-08-13T17:28:00.000Z' };
    const fila = obtenerFilaCierreTerminal([filaDelViewer, filaTerminalDeOtroAnalista]);
    expect(fila).toBe(filaTerminalDeOtroAnalista);
    expect(fila?.analistaAsignado).toBe('otro.analista');
  });
});
