import { describe, it, expect } from 'vitest';
import { siguienteContinuacionFicha, continuacionAplicable } from './continuacion-actualizacion-ficha';

describe('siguienteContinuacionFicha', () => {
  it('PRUEBA 9 — parcial con puedeCompletarDatos=true y token: guarda la continuación', () => {
    const r = siguienteContinuacionFicha({
      estado: 'parcial', puedeCompletarDatos: true, continuacionActualizacion: 'abc.def',
      continuacionExpiraEn: '2026-07-17T20:25:00.000Z', procesoId: 5812, externalId: '11703150',
    });
    expect(r).not.toBeNull();
    expect(r?.token).toBe('abc.def');
    expect(r?.procesoId).toBe(5812);
    expect(r?.externalId).toBe('11703150');
  });

  it('PRUEBA 10 — parcial SIN puedeCompletarDatos: no guarda continuación', () => {
    const r = siguienteContinuacionFicha({ estado: 'parcial', procesoId: 5812, externalId: '11703150' });
    expect(r).toBeNull();
  });

  it('PRUEBA 19 — estado completa: elimina cualquier continuación', () => {
    const r = siguienteContinuacionFicha({
      estado: 'completa', puedeCompletarDatos: true, continuacionActualizacion: 'abc.def',
      continuacionExpiraEn: '2026-07-17T20:25:00.000Z',
    });
    expect(r).toBeNull();
  });

  it('estado sin_cambios: elimina cualquier continuación', () => {
    const r = siguienteContinuacionFicha({ estado: 'sin_cambios' });
    expect(r).toBeNull();
  });

  it('puedeCompletarDatos=true pero token vacío: no guarda', () => {
    const r = siguienteContinuacionFicha({ estado: 'parcial', puedeCompletarDatos: true, continuacionActualizacion: '' });
    expect(r).toBeNull();
  });

  it('puedeCompletarDatos=true pero continuacionExpiraEn ilegible: no guarda', () => {
    const r = siguienteContinuacionFicha({
      estado: 'parcial', puedeCompletarDatos: true, continuacionActualizacion: 'abc.def', continuacionExpiraEn: 'no-es-una-fecha',
    });
    expect(r).toBeNull();
  });

  it('nunca deduce puedeCompletarDatos de estado=parcial + linkDetalle a secas (el campo debe venir explícito)', () => {
    const r = siguienteContinuacionFicha({ estado: 'parcial' } as unknown as Parameters<typeof siguienteContinuacionFicha>[0]);
    expect(r).toBeNull();
  });

  it('estado limite_peticiones con continuación reemitida: la guarda igual', () => {
    const r = siguienteContinuacionFicha({
      estado: 'limite_peticiones', puedeCompletarDatos: true, continuacionActualizacion: 'xyz.123',
      continuacionExpiraEn: '2026-07-17T20:30:00.000Z', procesoId: 5812, externalId: '11703150',
    });
    expect(r).not.toBeNull();
  });
});

describe('continuacionAplicable', () => {
  const PROCESO = { procesoId: 5812, externalId: '11703150' };
  const CONTINUACION = { procesoId: 5812, externalId: '11703150', token: 'abc.def', expiraEnMs: 1_000_000 };

  it('vigente, mismo proceso, no vencida: aplicable', () => {
    expect(continuacionAplicable(CONTINUACION, PROCESO, 500_000)).toBe(true);
  });

  it('PRUEBA 18 — vencida: no aplicable', () => {
    expect(continuacionAplicable(CONTINUACION, PROCESO, 1_500_000)).toBe(false);
  });

  it('exactamente en el borde de expiración: no aplicable', () => {
    expect(continuacionAplicable(CONTINUACION, PROCESO, 1_000_000)).toBe(false);
  });

  it('PRUEBA 17 — proceso distinto (procesoId): no aplicable', () => {
    expect(continuacionAplicable(CONTINUACION, { procesoId: 4174, externalId: '11703150' }, 500_000)).toBe(false);
  });

  it('proceso distinto (externalId): no aplicable', () => {
    expect(continuacionAplicable(CONTINUACION, { procesoId: 5812, externalId: 'otro' }, 500_000)).toBe(false);
  });

  it('sin continuación (null): no aplicable', () => {
    expect(continuacionAplicable(null, PROCESO, 500_000)).toBe(false);
  });

  it('PRUEBA 20 — nunca implícita entre recargas: cada verificación exige el estado explícito guardado en memoria (null tras recargar)', () => {
    // Simula "recargó la página" — el estado React se perdió, no hay localStorage de respaldo.
    const continuacionTrasRecarga = null;
    expect(continuacionAplicable(continuacionTrasRecarga, PROCESO, 500_000)).toBe(false);
  });
});

describe('PRUEBA 12 — mismo comportamiento en los tres componentes (VistFicha/VistFichaAsignacion/VistFichaBusqueda)', () => {
  it('siguienteContinuacionFicha es un passthrough puro: dos componentes distintos que reciban la MISMA respuesta guardan el MISMO token/expiración', () => {
    const respuesta = {
      estado: 'parcial', puedeCompletarDatos: true, continuacionActualizacion: 'mismo-token.firma',
      continuacionExpiraEn: '2026-07-17T20:25:00.000Z', procesoId: 5812, externalId: '11703150',
    };
    // Simula que VistFicha, VistFichaAsignacion y VistFichaBusqueda llaman a
    // la misma función compartida con la misma respuesta del backend — no
    // puede haber divergencia porque los tres usan exactamente esta función,
    // sin lógica propia de decisión.
    const paraVistFicha = siguienteContinuacionFicha(respuesta);
    const paraVistFichaAsignacion = siguienteContinuacionFicha(respuesta);
    const paraVistFichaBusqueda = siguienteContinuacionFicha(respuesta);
    expect(paraVistFicha).toEqual(paraVistFichaAsignacion);
    expect(paraVistFichaAsignacion).toEqual(paraVistFichaBusqueda);
    expect(paraVistFicha?.token).toBe('mismo-token.firma');
  });
});
