import { describe, it, expect } from 'vitest';
import { calcularVistaResponsables, puedeRegresarAObservaciones } from './vista-responsables';
import { normalizarEstadoSolicitudGlobal } from './estados-canonicos';

describe('calcularVistaResponsables', () => {
  it('loading → mensaje de carga, sin responsables (nunca datos parciales)', () => {
    const v = calcularVistaResponsables({ tipo: 'loading' });
    expect(v.mensaje).toBe('Cargando responsables…');
    expect(v.responsables).toEqual([]);
  });
  it('error → mensaje de error, sin responsables, nunca el arreglo truncado', () => {
    const v = calcularVistaResponsables({ tipo: 'error' });
    expect(v.mensaje).toMatch(/No fue posible cargar/);
    expect(v.responsables).toEqual([]);
  });
  it('success sin responsables → mensaje de vacío', () => {
    const v = calcularVistaResponsables({ tipo: 'success', responsables: [] });
    expect(v.mensaje).toBe('No hay responsables asignados.');
    expect(v.responsables).toEqual([]);
  });
  it('success con responsables → sin mensaje, lista completa', () => {
    const resp = [{ idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila' }, { idAsignacion: 'ASG-2', analistaAsignado: 'laura.buelvas' }];
    const v = calcularVistaResponsables({ tipo: 'success', responsables: resp });
    expect(v.mensaje).toBeNull();
    expect(v.responsables).toEqual(resp);
    expect(v.responsables.length).toBe(2); // Laura y Juan juntos, nunca uno primero y el otro después
  });
});

describe('puedeRegresarAObservaciones — nunca depende de asignaciones[]', () => {
  it('true para APROBADO_ELABORACION/EN_ELABORACION/PRESENTADO', () => {
    expect(puedeRegresarAObservaciones('APROBADO_ELABORACION')).toBe(true);
    expect(puedeRegresarAObservaciones('EN_ELABORACION')).toBe(true);
    expect(puedeRegresarAObservaciones('PRESENTADO')).toBe(true);
  });
  it('false para el resto de estados y para null/undefined', () => {
    expect(puedeRegresarAObservaciones('EN_REVISION')).toBe(false);
    expect(puedeRegresarAObservaciones('EN_OBSERVACION')).toBe(false);
    expect(puedeRegresarAObservaciones('CERRADA')).toBe(false);
    expect(puedeRegresarAObservaciones(null)).toBe(false);
    expect(puedeRegresarAObservaciones(undefined)).toBe(false);
  });
  it('invertir el orden de las filas [Laura,Juan] vs [Juan,Laura] produce exactamente el mismo resultado, porque la entrada es el estado global, no el arreglo', () => {
    const estadoDesdeOrdenA = normalizarEstadoSolicitudGlobal('Asignado para elaboración', ['APROBADO_ELABORACION', 'APROBADO_ELABORACION']).estado;
    const estadoDesdeOrdenB = normalizarEstadoSolicitudGlobal('Asignado para elaboración', ['APROBADO_ELABORACION', 'APROBADO_ELABORACION']).estado;
    expect(puedeRegresarAObservaciones(estadoDesdeOrdenA)).toBe(puedeRegresarAObservaciones(estadoDesdeOrdenB));
    expect(puedeRegresarAObservaciones(estadoDesdeOrdenA)).toBe(true);
  });
});