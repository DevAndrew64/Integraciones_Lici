/**
 * Bloque 1A — regresión del Caso C (Solicitud.id=292, SQR 274379).
 * Ninguna prueba depende del huso horario de la máquina que ejecuta el test
 * (formatearFechaSoloCalendario usa componentes UTC explícitos;
 * formatearFechaHora fija timeZone explícitamente).
 */
import { describe, it, expect } from 'vitest';
import {
  formatearFechaSoloCalendario,
  formatearFechaHora,
  resolverFechaLimiteContractual,
  formatearFechaLimiteContractual,
} from './fechas';

describe('formatearFechaSoloCalendario', () => {
  it('A — 2026-08-14T00:00:00.000Z (medianoche UTC) → 14/08/2026, no retrocede de día', () => {
    expect(formatearFechaSoloCalendario('2026-08-14T00:00:00.000Z')).toBe('14/08/2026');
  });

  it('B — 2026-08-14T12:00:00.000Z (mediodía UTC) → 14/08/2026', () => {
    expect(formatearFechaSoloCalendario('2026-08-14T12:00:00.000Z')).toBe('14/08/2026');
  });

  it('E — null/undefined/vacío → fallback uniforme', () => {
    expect(formatearFechaSoloCalendario(null)).toBe('—');
    expect(formatearFechaSoloCalendario(undefined)).toBe('—');
    expect(formatearFechaSoloCalendario('')).toBe('—');
  });

  it('acepta Date además de string ISO', () => {
    expect(formatearFechaSoloCalendario(new Date('2026-08-14T00:00:00.000Z'))).toBe('14/08/2026');
  });

  it('valor inválido no lanza excepción, devuelve fallback', () => {
    expect(formatearFechaSoloCalendario('no-es-una-fecha')).toBe('—');
  });

  it('F — resultado idéntico sin importar TZ del proceso (componentes UTC explícitos)', () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = 'Pacific/Kiritimati'; // UTC+14
      expect(formatearFechaSoloCalendario('2026-08-14T00:00:00.000Z')).toBe('14/08/2026');
      process.env.TZ = 'Pacific/Niue'; // UTC-11
      expect(formatearFechaSoloCalendario('2026-08-14T00:00:00.000Z')).toBe('14/08/2026');
    } finally {
      process.env.TZ = original;
    }
  });

  it('no modifica el valor original (función pura)', () => {
    const original = new Date('2026-08-14T00:00:00.000Z');
    const copia = original.getTime();
    formatearFechaSoloCalendario(original);
    expect(original.getTime()).toBe(copia);
  });
});

describe('resolverFechaLimiteContractual', () => {
  it('C — fechaCierre y fechaVencimiento presentes → prioriza fechaCierre', () => {
    const r = resolverFechaLimiteContractual({
      fechaCierre: '2026-08-14T12:00:00.000Z',
      fechaVencimiento: '2026-08-14T00:00:00.000Z',
    });
    expect(r).toBe('2026-08-14T12:00:00.000Z');
  });

  it('D — fechaCierre null, fechaVencimiento presente → usa fechaVencimiento', () => {
    const r = resolverFechaLimiteContractual({
      fechaCierre: null,
      fechaVencimiento: '2026-08-14T00:00:00.000Z',
    });
    expect(r).toBe('2026-08-14T00:00:00.000Z');
  });

  it('E — ambas null → null', () => {
    expect(resolverFechaLimiteContractual({ fechaCierre: null, fechaVencimiento: null })).toBeNull();
  });

  it('entrada null/undefined → null', () => {
    expect(resolverFechaLimiteContractual(null)).toBeNull();
    expect(resolverFechaLimiteContractual(undefined)).toBeNull();
  });
});

describe('formatearFechaLimiteContractual — regresión directa del Caso C', () => {
  it('Solicitud.id=292 (SQR 274379): fechaCierre=2026-08-14T12:00:00.000Z, fechaVencimiento=2026-08-14T00:00:00.000Z → 14/08/2026', () => {
    const resultado = formatearFechaLimiteContractual({
      fechaCierre: '2026-08-14T12:00:00.000Z',
      fechaVencimiento: '2026-08-14T00:00:00.000Z',
    });
    expect(resultado).toBe('14/08/2026');
    expect(resultado).not.toBe('13/08/2026');
  });

  it('sin fechaCierre (caso Búsqueda/Procesos, ficha sintética con fechaCierre:null) usa fechaVencimiento sin retroceder de día', () => {
    const resultado = formatearFechaLimiteContractual({
      fechaCierre: null,
      fechaVencimiento: '2026-08-14T00:00:00.000Z',
    });
    expect(resultado).toBe('14/08/2026');
  });
});

describe('formatearFechaHora', () => {
  it('G — timestamp real conserva fecha y hora, usando America/Bogota por defecto', () => {
    // 2026-08-14T15:30:00.000Z en America/Bogota (UTC-5) = 14/08/2026 10:30 a. m.
    const resultado = formatearFechaHora('2026-08-14T15:30:00.000Z');
    expect(resultado).toContain('14/08/2026');
    expect(resultado).toContain('10:30');
  });

  it('resultado idéntico sin importar TZ del proceso (timeZone explícito, no el local)', () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = 'Asia/Tokyo';
      const r1 = formatearFechaHora('2026-08-14T15:30:00.000Z');
      process.env.TZ = 'America/Bogota';
      const r2 = formatearFechaHora('2026-08-14T15:30:00.000Z');
      expect(r1).toBe(r2);
    } finally {
      process.env.TZ = original;
    }
  });

  it('permite sobrescribir la zona horaria explícitamente', () => {
    const resultado = formatearFechaHora('2026-08-14T15:30:00.000Z', { zonaHoraria: 'UTC' });
    expect(resultado).toContain('14/08/2026');
    expect(resultado).toContain('03:30');
  });

  it('null/undefined → fallback uniforme', () => {
    expect(formatearFechaHora(null)).toBe('—');
    expect(formatearFechaHora(undefined)).toBe('—');
  });
});