import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// Ajuste "HOJA INDICADORES EN EL EXPORT DE PROCESOS PÚBLICOS" — esta ruta
// recorre TODO el arreglo `asignaciones` (nunca solo el último elemento,
// a diferencia de `GET /api/solicitudes`) — se mockea `prisma.$queryRaw`
// devolviendo filas "planas" (una por indicador encontrado, como las
// devolvería la consulta SQL real con jsonb_array_elements) y se prueba
// la lógica de agregación (último valor vigente por nombre, exclusión de
// filas sin valor real, agrupación por solicitud) tal cual la hace route.ts.
const mockQueryRaw = vi.fn();
vi.mock('@/lib/prisma', () => ({ default: { $queryRaw: (...args: unknown[]) => mockQueryRaw(...args) } }));
vi.mock('@/lib/session', () => ({
  getSession: async () => ({ id: 1, email: 'admin@grupocolba.com', rol: 'admin', exp: 9999999999, sv: 1, usuario: 'admin.qa' }),
}));

function mkReq(qs = ''): NextRequest {
  return new Request('http://x/api/solicitudes/indicadores-financieros' + (qs ? `?${qs}` : '')) as unknown as NextRequest;
}

afterEach(() => {
  vi.resetModules();
  mockQueryRaw.mockReset();
});

function fila(p: Partial<{ id: number; codigoProceso: string; entidad: string; perfil: string; objeto: string; valor: number; nombreIndicador: string; valorEvidenciado: string; fecha: string }>) {
  return {
    id: 1, codigoProceso: 'LP-001-2026', entidad: 'Entidad X', perfil: 'VIGICOLBA', objeto: 'Objeto de prueba', valor: 19772903798,
    nombreIndicador: 'Liquidez', valorEvidenciado: '3', fecha: '2026-01-10 10:00:00',
    ...p,
  };
}

describe('GET /api/solicitudes/indicadores-financieros — recorre TODO asignaciones, nunca solo el estado actual', () => {
  it('proceso "En observación" con indicadores aparece', async () => {
    mockQueryRaw.mockResolvedValue([fila({})]);
    const { GET } = await import('./route');
    const res = await GET(mkReq());
    const d = await res.json();
    expect(d.ok).toBe(true);
    expect(d.data).toHaveLength(1);
    expect(d.data[0].indicadores).toEqual({ Liquidez: '3' });
  });

  it('proceso que YA avanzó de estado (la fila SQL ya no depende de "última asignación") conserva sus indicadores', async () => {
    // La consulta real usa jsonb_array_elements sobre TODO el arreglo, así
    // que esta fila simula un indicador registrado en una asignación que
    // YA NO es la última (el proceso avanzó) — la ruta no filtra por eso.
    mockQueryRaw.mockResolvedValue([fila({ id: 25, nombreIndicador: 'Endeudamiento', valorEvidenciado: '0.5' })]);
    const { GET } = await import('./route');
    const res = await GET(mkReq());
    const d = await res.json();
    expect(d.data[0].id).toBe(25);
    expect(d.data[0].indicadores).toEqual({ Endeudamiento: '0.5' });
  });

  it('proceso con causa "Indicador" pero SIN valores reales (valorEvidenciado vacío) no aparece', async () => {
    mockQueryRaw.mockResolvedValue([fila({ valorEvidenciado: '' }), fila({ valorEvidenciado: '   ' })]);
    const { GET } = await import('./route');
    const res = await GET(mkReq());
    const d = await res.json();
    expect(d.data).toEqual([]);
  });

  it('proceso con varios indicadores: todos quedan en el mapa de esa solicitud', async () => {
    mockQueryRaw.mockResolvedValue([
      fila({ nombreIndicador: 'Liquidez', valorEvidenciado: '3' }),
      fila({ nombreIndicador: 'Endeudamiento', valorEvidenciado: '0.5' }),
      fila({ nombreIndicador: 'Capital de trabajo', valorEvidenciado: '80%' }),
    ]);
    const { GET } = await import('./route');
    const res = await GET(mkReq());
    const d = await res.json();
    expect(d.data).toHaveLength(1);
    expect(d.data[0].indicadores).toEqual({ Liquidez: '3', Endeudamiento: '0.5', 'Capital de trabajo': '80%' });
  });

  it('dos procesos con conjuntos DIFERENTES de indicadores nunca se mezclan', async () => {
    mockQueryRaw.mockResolvedValue([
      fila({ id: 1, nombreIndicador: 'Liquidez', valorEvidenciado: '3' }),
      fila({ id: 2, nombreIndicador: 'Razón de cobertura de intereses', valorEvidenciado: '10' }),
    ]);
    const { GET } = await import('./route');
    const res = await GET(mkReq());
    const d = await res.json();
    expect(d.data).toHaveLength(2);
    const p1 = d.data.find((x: { id: number }) => x.id === 1);
    const p2 = d.data.find((x: { id: number }) => x.id === 2);
    expect(p1.indicadores).toEqual({ Liquidez: '3' });
    expect(p2.indicadores).toEqual({ 'Razón de cobertura de intereses': '10' });
  });

  it('mismo indicador (mismo nombre) en varios procesos: cada proceso conserva su propio valor', async () => {
    mockQueryRaw.mockResolvedValue([
      fila({ id: 1, nombreIndicador: 'Liquidez', valorEvidenciado: '3' }),
      fila({ id: 2, nombreIndicador: 'Liquidez', valorEvidenciado: '4' }),
    ]);
    const { GET } = await import('./route');
    const res = await GET(mkReq());
    const d = await res.json();
    const p1 = d.data.find((x: { id: number }) => x.id === 1);
    const p2 = d.data.find((x: { id: number }) => x.id === 2);
    expect(p1.indicadores.Liquidez).toBe('3');
    expect(p2.indicadores.Liquidez).toBe('4');
  });

  it('proceso con VARIAS observaciones de Indicador para el MISMO nombre: usa el último valor por fecha', async () => {
    mockQueryRaw.mockResolvedValue([
      fila({ nombreIndicador: 'Liquidez', valorEvidenciado: '3', fecha: '2026-01-10 10:00:00' }),
      fila({ nombreIndicador: 'Liquidez', valorEvidenciado: '5', fecha: '2026-03-01 09:00:00' }),
    ]);
    const { GET } = await import('./route');
    const res = await GET(mkReq());
    const d = await res.json();
    expect(d.data[0].indicadores.Liquidez).toBe('5');
  });

  it('ningún proceso duplicado — una sola entrada por id de solicitud aunque tenga varias filas de indicador', async () => {
    mockQueryRaw.mockResolvedValue([
      fila({ nombreIndicador: 'Liquidez', valorEvidenciado: '3' }),
      fila({ nombreIndicador: 'Endeudamiento', valorEvidenciado: '0.5' }),
    ]);
    const { GET } = await import('./route');
    const res = await GET(mkReq());
    const d = await res.json();
    expect(d.data).toHaveLength(1);
  });

  it('conserva codigoProceso/entidad/perfil/objeto/valor de la Solicitud (misma fuente que las demás hojas)', async () => {
    mockQueryRaw.mockResolvedValue([fila({})]);
    const { GET } = await import('./route');
    const res = await GET(mkReq());
    const d = await res.json();
    expect(d.data[0]).toMatchObject({ codigoProceso: 'LP-001-2026', entidad: 'Entidad X', perfil: 'VIGICOLBA', objeto: 'Objeto de prueba', valor: 19772903798 });
  });

  it('filtra por aliasFuentePublico agregando la condición SQL correspondiente', async () => {
    mockQueryRaw.mockResolvedValue([]);
    const { GET } = await import('./route');
    await GET(mkReq('aliasFuentePublico=true'));
    expect(mockQueryRaw).toHaveBeenCalled();
    const sqlLlamado = mockQueryRaw.mock.calls[0][0];
    expect(String(sqlLlamado?.sql ?? sqlLlamado)).toContain(`'S1','S2'`);
  });

  it('sin aliasFuentePublico/aliasFuentePrivado no agrega filtro de alias (trae todo)', async () => {
    mockQueryRaw.mockResolvedValue([]);
    const { GET } = await import('./route');
    await GET(mkReq());
    const sqlLlamado = mockQueryRaw.mock.calls[0][0];
    expect(String(sqlLlamado?.sql ?? sqlLlamado)).not.toContain('aliasFuente');
  });
});
