import { describe, it, expect } from 'vitest';
import { ESTADOS_SOLICITUD_TERMINALES, esEstadoSolicitudTerminal } from './estados-solicitud';

describe('estados-solicitud — terminales', () => {
  it('Cerrada y Cancelada son terminales', () => {
    expect(esEstadoSolicitudTerminal('Cerrada')).toBe(true);
    expect(esEstadoSolicitudTerminal('Cancelada')).toBe(true);
  });

  it('Presentado y En evaluación NO son terminales (llevan a un siguiente paso)', () => {
    expect(esEstadoSolicitudTerminal('Presentado')).toBe(false);
    expect(esEstadoSolicitudTerminal('En evaluación')).toBe(false);
  });

  it('estados intermedios conocidos no son terminales', () => {
    ['Selección de proceso', 'Asignado para revisión', 'En observación', 'Asignado para elaboración', 'En elaboración'].forEach((e) => {
      expect(esEstadoSolicitudTerminal(e)).toBe(false);
    });
  });

  it('null/undefined/vacío no son terminales', () => {
    expect(esEstadoSolicitudTerminal(null)).toBe(false);
    expect(esEstadoSolicitudTerminal(undefined)).toBe(false);
    expect(esEstadoSolicitudTerminal('')).toBe(false);
  });

  it('el conjunto terminal es exactamente {Cerrada, Cancelada}', () => {
    expect(ESTADOS_SOLICITUD_TERMINALES).toEqual(new Set(['Cerrada', 'Cancelada']));
  });
});