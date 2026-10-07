import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// Ajuste "CATÁLOGO ÚNICO DESDE equipos/obtener" — esta ruta consulta UNA
// sola fuente externa (`buscarEquiposActivos`, `equipos/obtener`); el
// catálogo se DERIVA de esa misma respuesta (`derivarCatalogoDesdeActivos`)
// y se cruza contra sí misma (`cruzarCatalogoConDisponibilidad`) — nunca
// se llama a `equipos/obtener_recientes` (retirada por devolver casi nada,
// ver docblock de `equipos-activos-buscar.ts`).
vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/session', () => ({
  getSession: async () => ({ id: 1, email: 'admin@grupocolba.com', rol: 'admin', exp: 9999999999, sv: 1, usuario: 'admin.qa' }),
}));

const mockActivos = vi.fn();
vi.mock('@/lib/equipos-activos-buscar', () => ({
  buscarEquiposActivos: (...args: unknown[]) => mockActivos(...args),
}));

function mkReq(body: Record<string, unknown>): NextRequest {
  return new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) as unknown as NextRequest;
}

afterEach(() => {
  vi.resetModules();
  mockActivos.mockReset();
});

const ACTIVO_A = {
  nombre_c: 'BRILLADORA INDUSTRIAL 17"', empresa_c: 'aseo', uen: 'BAQ', ubicacion: 'Barranquilla',
  codGrupo: '004', grupo: 'MAQUINARIA Y EQUIPO', codSubtipo: '014', sub_tipo: 'BRILLADORA INDUSTRIAL  17" 175 RPM',
  fecha_adquisicion: '2019-12-04', valor: 1450000, cantidadDisponible: 37, valorMantenimiento: 40000,
};

describe('POST /api/equipos-activos — catálogo derivado de equipos/obtener (fuente única)', () => {
  it('exige empresa', async () => {
    const { POST } = await import('./route');
    expect((await POST(mkReq({ q: 'brilla' }))).status).toBe(400);
  });

  it('sin descripción real (menos de 2 caracteres) responde vacío de inmediato, SIN llamar a la fuente externa', async () => {
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo' }));
    const d = await res.json();
    expect(d.ok).toBe(true);
    expect(d.total).toBe(0);
    expect(d.data).toEqual([]);
    expect(mockActivos).not.toHaveBeenCalled();
  });

  it('llama a la fuente UNA sola vez por búsqueda (empresa+descripcion) — nunca dos fuentes externas', async () => {
    mockActivos.mockResolvedValue([ACTIVO_A]);
    const { POST } = await import('./route');
    await POST(mkReq({ empresa: 'aseo', q: 'brilla' }));
    expect(mockActivos).toHaveBeenCalledWith('aseo', 'brilla');
    expect(mockActivos).toHaveBeenCalledTimes(1);
  });

  it('el catálogo (tipo/subtipo/nombre/fecha/valor) sale de la MISMA respuesta de equipos/obtener', async () => {
    mockActivos.mockResolvedValue([ACTIVO_A]);
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo', q: 'brilla' }));
    const d = await res.json();
    expect(d.data[0].codGrupo).toBe('004');
    expect(d.data[0].subtipo).toBe('BRILLADORA INDUSTRIAL  17" 175 RPM');
    expect(d.data[0].nombre).toBe('BRILLADORA INDUSTRIAL 17"');
    expect(d.data[0].fechaAdquisicion).toBe('2019-12-04');
    expect(d.data[0].valor).toBe(1450000);
  });

  it('la disponibilidad viene del cruce (disponibleTotal/disponibilidadPorUen/valorMantenimiento)', async () => {
    mockActivos.mockResolvedValue([ACTIVO_A]);
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo', q: 'brilla' }));
    const d = await res.json();
    expect(d.data[0].disponibleTotal).toBe(37);
    expect(d.data[0].disponibilidadPorUen).toEqual([{ uen: 'BAQ', ubicacion: 'Barranquilla', cantidad: 37 }]);
    expect(d.data[0].valorMantenimiento).toBe(40000);
  });

  it('varias UEN para el mismo equipo (mismo tipo+subtipo+nombre normalizado): conserva el detalle por UEN y suma el total, UNA sola fila de catálogo', async () => {
    mockActivos.mockResolvedValue([
      ACTIVO_A,
      { ...ACTIVO_A, uen: 'BOG', ubicacion: 'Bogotá', cantidadDisponible: 42, fecha_adquisicion: '2020-01-01' },
      { ...ACTIVO_A, uen: 'MIN', ubicacion: 'Mina', cantidadDisponible: 1, valorMantenimiento: 0, fecha_adquisicion: '2018-06-01' },
    ]);
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo', q: 'brilla' }));
    const d = await res.json();
    expect(d.total).toBe(1);
    expect(d.data[0].disponibilidadPorUen).toEqual([
      { uen: 'BAQ', ubicacion: 'Barranquilla', cantidad: 37 },
      { uen: 'BOG', ubicacion: 'Bogotá', cantidad: 42 },
      { uen: 'MIN', ubicacion: 'Mina', cantidad: 1 },
    ]);
    expect(d.data[0].disponibleTotal).toBe(80);
    // valorMantenimiento distinto entre UEN (40000 vs 0) → conflicto, nunca elige uno silenciosamente
    expect(d.data[0].valorMantenimiento).toBeNull();
    expect(d.data[0].valorMantenimientoConflictivo).toBe(true);
    // la fila representativa del grupo es la de fecha_adquisicion más reciente (BOG, 2020-01-01)
    expect(d.data[0].fechaAdquisicion).toBe('2020-01-01');
  });

  it('dos nombre_c distintos con el mismo tipo_c+sub_tipo_c: nunca se mezclan en una sola fila de catálogo', async () => {
    mockActivos.mockResolvedValue([
      ACTIVO_A,
      { ...ACTIVO_A, nombre_c: 'BRILLADORA INDUSTRIAL 16"', cantidadDisponible: 8, fecha_adquisicion: '2021-01-01' },
    ]);
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo', q: 'brilla' }));
    const d = await res.json();
    expect(d.total).toBe(2);
  });

  it('sin resultados de la fuente: catálogo vacío, sin error', async () => {
    mockActivos.mockResolvedValue([]);
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo', q: 'brilla' }));
    const d = await res.json();
    expect(d.ok).toBe(true);
    expect(d.data).toEqual([]);
    expect(d.total).toBe(0);
  });

  it('empresa visible ASEOCOLBA se traduce a "aseo" antes de llamar a la fuente', async () => {
    mockActivos.mockResolvedValue([]);
    const { POST } = await import('./route');
    await POST(mkReq({ empresa: 'aseo', q: 'brilla' }));
    expect(mockActivos.mock.calls[0][0]).toBe('aseo');
  });

  it('error del proveedor externo se reporta como error, nunca como catálogo vacío disfrazado', async () => {
    mockActivos.mockRejectedValue(new Error('Error externo: 500'));
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo', q: 'brilla' }));
    expect(res.status).toBe(500);
    const d = await res.json();
    expect(d.ok).toBe(false);
  });

  it('muchos tipos distintos con la misma descripción (ej. 15 subtipos de escalera): ninguno se pierde — el catálogo tiene una fila por cada uno', async () => {
    const subtipos = Array.from({ length: 15 }, (_, i) => ({
      ...ACTIVO_A,
      nombre_c: `ESCALERA TIPO ${i}`,
      codSubtipo: String(i).padStart(3, '0'),
      cantidadDisponible: i + 1,
    }));
    mockActivos.mockResolvedValue(subtipos);
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo', q: 'escalera', limit: 50 }));
    const d = await res.json();
    expect(d.total).toBe(15);
    expect(d.data).toHaveLength(15);
  });
});
