import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const countMock = vi.fn(async (_args?: unknown) => 0);
const findManyMock = vi.fn(async (_args?: unknown) => [] as unknown[]);

vi.mock('@/lib/prisma', () => ({
  default: { tarifaMantenimientoEquipo: { count: (a: unknown) => countMock(a), findMany: (a: unknown) => findManyMock(a) } },
}));

let sessionActual: { id: number; email: string; rol: string; exp: number; sv: number; usuario?: string } | null = {
  id: 1, email: 'admin@grupocolba.com', rol: 'admin', exp: 9999999999, sv: 1, usuario: 'admin.qa',
};
vi.mock('@/lib/session', () => ({ getSession: async () => sessionActual }));

function mkReq(query: string): NextRequest {
  return new Request('http://x/api/mantenimiento-equipos' + query) as unknown as NextRequest;
}

const FILA_EJEMPLO = {
  id: 1, empresaPrestadora: 'ASEOCOLBA', uen: 'BAQ', clienteRazonSocial: 'CLIENTE X',
  contrato: 'C1', puntoEntrega: '00000000502', grupoActivo: '004', tipoActivo: '013', subtipoActivo: '015',
  descripcionEquipo: 'BRILLADORA INDUSTRIAL 20"', frecuencia: 36, valorMesMantenimiento: 40000,
  fuenteArchivo: 'PLANTILLA COSTO MES MANTTO.xlsx', fuenteHoja: 'PLANTILLA UEN BAQ', fuenteFila: 4,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  countMock.mockClear();
  findManyMock.mockClear();
  sessionActual = { id: 1, email: 'admin@grupocolba.com', rol: 'admin', exp: 9999999999, sv: 1, usuario: 'admin.qa' };
});

describe('GET /api/mantenimiento-equipos', () => {
  it('11) exige autenticación — sin sesión devuelve 401', async () => {
    sessionActual = null;
    const { GET } = await import('./route');
    const res = await GET(mkReq(''));
    expect(res.status).toBe(401);
  });

  it('11) exige el permiso ver_equipos — un rol sin permiso devuelve 403', async () => {
    sessionActual = { id: 2, email: 'user@grupocolba.com', rol: 'Usuario Final', exp: 9999999999, sv: 1, usuario: 'user' };
    const { GET } = await import('./route');
    const res = await GET(mkReq(''));
    expect(res.status).toBe(403);
  });

  it('8) pagina correctamente (page/limit/total/totalPages en la respuesta)', async () => {
    countMock.mockResolvedValueOnce(120);
    findManyMock.mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => ({ ...FILA_EJEMPLO, id: i + 1 })));
    const { GET } = await import('./route');
    const res = await GET(mkReq('?page=1&limit=50'));
    const d = await res.json();
    expect(d.ok).toBe(true);
    expect(d.page).toBe(1);
    expect(d.limit).toBe(50);
    expect(d.total).toBe(120);
    expect(d.totalPages).toBe(3);
    expect(d.data).toHaveLength(50);
  });

  it('9) filtra por UEN/grupo/tipo/subtipo — el where enviado a Prisma refleja los filtros', async () => {
    const { GET } = await import('./route');
    await GET(mkReq('?uen=BAQ&grupoActivo=004&tipoActivo=013&subtipoActivo=015'));
    const whereUsado = (findManyMock.mock.calls[0]?.[0] ?? {}) as { where: Record<string, unknown> };
    expect(whereUsado.where).toMatchObject({ uen: 'BAQ', grupoActivo: '004', tipoActivo: '013', subtipoActivo: '015' });
  });

  it('10) devuelve TODAS las coincidencias sin seleccionar una — dos filas del mismo grupo llegan ambas', async () => {
    countMock.mockResolvedValueOnce(2);
    findManyMock.mockResolvedValueOnce([
      { ...FILA_EJEMPLO, id: 1, contrato: 'C1', valorMesMantenimiento: 233333.33 },
      { ...FILA_EJEMPLO, id: 2, contrato: 'C2', valorMesMantenimiento: 250000 },
    ]);
    const { GET } = await import('./route');
    const res = await GET(mkReq('?uen=BAQ&grupoActivo=004&tipoActivo=005&subtipoActivo=051'));
    const d = await res.json();
    expect(d.data).toHaveLength(2);
    expect(d.data.map((f: { contrato: string }) => f.contrato)).toEqual(['C1', 'C2']);
  });

  it('12) los códigos con ceros iniciales viajan como string, sin convertir a number', async () => {
    findManyMock.mockResolvedValueOnce([{ ...FILA_EJEMPLO, puntoEntrega: '00000000502', subtipoActivo: '008' }]);
    const { GET } = await import('./route');
    const res = await GET(mkReq(''));
    const d = await res.json();
    expect(d.data[0].puntoEntrega).toBe('00000000502');
    expect(d.data[0].subtipoActivo).toBe('008');
  });

  it('por defecto solo consulta tarifas activas (activo=true)', async () => {
    const { GET } = await import('./route');
    await GET(mkReq(''));
    const whereUsado = (findManyMock.mock.calls[0]?.[0] ?? {}) as { where: Record<string, unknown> };
    expect(whereUsado.where).toMatchObject({ activo: true });
  });
});
