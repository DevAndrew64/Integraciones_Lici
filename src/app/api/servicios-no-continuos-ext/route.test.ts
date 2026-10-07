/**
 * Ajuste "SERVICIOS NO CONTINUOS — FASE 1: CATÁLOGO ASEOCOLBA" — mismo
 * patrón de test que /api/equipos-activos: sesión válida stubeada,
 * `buscarServiciosNoContinuos` mockeada (la cobertura de la llamada
 * externa real vive en servicios-no-continuos-buscar.test.ts).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => ({ id: 1, rol: 'admin' })) }));
vi.mock('@/lib/authz', () => ({
  requireSession: vi.fn(() => null),
  hasPermiso: vi.fn(async () => true),
}));

const buscarServiciosNoContinuosMock = vi.fn();
vi.mock('@/lib/servicios-no-continuos-buscar', () => ({
  buscarServiciosNoContinuos: (...args: unknown[]) => buscarServiciosNoContinuosMock(...args),
}));

function req(body: unknown) {
  return new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) as unknown as import('next/server').NextRequest;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('POST /api/servicios-no-continuos-ext', () => {
  it('empresa ausente se rechaza con 400, sin llamar a la fuente externa', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(buscarServiciosNoContinuosMock).not.toHaveBeenCalled();
  });

  it('devuelve {ok:true, servicios:[...]} con la lista normalizada', async () => {
    buscarServiciosNoContinuosMock.mockResolvedValue([
      { codigo: '001', descripcion: 'BRIGADA DE ASEO', empresa: 'aseo', undneg: 'ASE' },
    ]);
    const { POST } = await import('./route');
    const res = await POST(req({ empresa: 'aseo' }));
    const d = await res.json();
    expect(d.ok).toBe(true);
    expect(d.servicios).toEqual([{ codigo: '001', descripcion: 'BRIGADA DE ASEO', empresa: 'aseo', undneg: 'ASE' }]);
  });

  it('respuesta vacía de la fuente → servicios:[] (nunca un error)', async () => {
    buscarServiciosNoContinuosMock.mockResolvedValue([]);
    const { POST } = await import('./route');
    const res = await POST(req({ empresa: 'aseo' }));
    const d = await res.json();
    expect(d.ok).toBe(true);
    expect(d.servicios).toEqual([]);
  });

  it('error de la fuente externa se controla con 502, nunca revienta el endpoint', async () => {
    buscarServiciosNoContinuosMock.mockRejectedValue(new Error('timeout'));
    const { POST } = await import('./route');
    const res = await POST(req({ empresa: 'aseo' }));
    expect(res.status).toBe(502);
    const d = await res.json();
    expect(d.ok).toBe(false);
  });

  it('dos consultas seguidas de la MISMA empresa reutilizan la caché — evita llamadas duplicadas', async () => {
    buscarServiciosNoContinuosMock.mockResolvedValue([{ codigo: '001', descripcion: 'BRIGADA DE ASEO', empresa: 'aseo', undneg: 'ASE' }]);
    const { POST } = await import('./route');
    await POST(req({ empresa: 'aseo' }));
    await POST(req({ empresa: 'aseo' }));
    expect(buscarServiciosNoContinuosMock).toHaveBeenCalledTimes(1);
  });

  it('sin permiso ver_estructura_costos → 403, sin llamar a la fuente', async () => {
    const authz = await import('@/lib/authz');
    vi.mocked(authz.hasPermiso).mockResolvedValueOnce(false);
    const { POST } = await import('./route');
    const res = await POST(req({ empresa: 'aseo' }));
    expect(res.status).toBe(403);
    expect(buscarServiciosNoContinuosMock).not.toHaveBeenCalled();
  });
});

describe('Ajuste "UNIFICACIÓN SNC — PROTECCIÓN CONTRA FALLBACK SILENCIOSO DE LA API" — whitelist backend, defensa en profundidad', () => {
  // Confirmado en vivo contra la fuente real: para CUALQUIER empresa fuera
  // de aseo/vigi, la fuente externa responde 200 con el catálogo de
  // Aseocolba como fallback silencioso (nunca un catálogo propio). Estos
  // tests demuestran que la ruta NUNCA expone esa respuesta — rechaza
  // ANTES de invocar la fuente, sin importar lo que esta devolvería.
  it('ASEOCOLBA (aseo) recibe su propio catálogo — la fuente SÍ se invoca', async () => {
    buscarServiciosNoContinuosMock.mockResolvedValue([
      { codigo: '1', descripcion: 'BRIGADA DE ASEO', empresa: '', undneg: 'BAQ' },
    ]);
    const { POST } = await import('./route');
    const res = await POST(req({ empresa: 'aseo' }));
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.servicios).toEqual([{ codigo: '1', descripcion: 'BRIGADA DE ASEO', empresa: '', undneg: 'BAQ' }]);
    expect(buscarServiciosNoContinuosMock).toHaveBeenCalledWith('aseo');
  });

  it('VIGICOLBA (vigi) recibe ÚNICAMENTE sus propios servicios — la fuente SÍ se invoca', async () => {
    buscarServiciosNoContinuosMock.mockResolvedValue([
      { codigo: '1', descripcion: 'ESTUDIO DE SEGURIDAD CON POLIGRAFIA', empresa: '', undneg: 'BAQ' },
      { codigo: '2', descripcion: 'CURSO PERSONA AUTORIZADA T.S.A.', empresa: '', undneg: 'BAQ' },
      { codigo: '3', descripcion: 'EXAMEN MEDICO TRABAJO EN ALTURA', empresa: '', undneg: 'BAQ' },
    ]);
    const { POST } = await import('./route');
    const res = await POST(req({ empresa: 'vigi' }));
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.servicios).toHaveLength(3);
    expect(d.servicios.map((s: { descripcion: string }) => s.descripcion)).not.toContain('BRIGADA DE ASEO');
    expect(buscarServiciosNoContinuosMock).toHaveBeenCalledWith('vigi');
  });

  it('TEMPOCOLBA (tempo) NUNCA recibe el catálogo de Aseocolba — la ruta rechaza ANTES de invocar la fuente, aunque esta "respondería" con datos de Aseocolba', async () => {
    // La fuente mockeada simula EXACTAMENTE el fallback real confirmado:
    // para 'tempo' devuelve el catálogo de Aseocolba. Si la ruta llegara a
    // invocarla, este test lo detectaría.
    buscarServiciosNoContinuosMock.mockResolvedValue([
      { codigo: '1', descripcion: 'BRIGADA DE ASEO', empresa: '', undneg: 'BAQ' },
    ]);
    const { POST } = await import('./route');
    const res = await POST(req({ empresa: 'tempo' }));
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.ok).toBe(true);
    expect(d.servicios).toEqual([]);
    expect(buscarServiciosNoContinuosMock).not.toHaveBeenCalled();
  });

  it('TRANSCOLBA (trans) NUNCA recibe el catálogo de Aseocolba — la ruta rechaza ANTES de invocar la fuente, aunque esta "respondería" con datos de Aseocolba', async () => {
    buscarServiciosNoContinuosMock.mockResolvedValue([
      { codigo: '1', descripcion: 'BRIGADA DE ASEO', empresa: '', undneg: 'BAQ' },
    ]);
    const { POST } = await import('./route');
    const res = await POST(req({ empresa: 'trans' }));
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.ok).toBe(true);
    expect(d.servicios).toEqual([]);
    expect(buscarServiciosNoContinuosMock).not.toHaveBeenCalled();
  });

  it('ninguna empresa desconocida recibe silenciosamente el catálogo de otra — variantes de formato también se rechazan', async () => {
    buscarServiciosNoContinuosMock.mockResolvedValue([
      { codigo: '1', descripcion: 'BRIGADA DE ASEO', empresa: '', undneg: 'BAQ' },
    ]);
    const { POST } = await import('./route');
    for (const empresa of ['TEMPO', 'TRANS', 'tempocolba', 'transcolba', 'TEMPOCOLBA', 'TRANSCOLBA', 'desconocida', 'ASEO', 'VIGI']) {
      const res = await POST(req({ empresa }));
      const d = await res.json();
      expect(d.servicios, `empresa="${empresa}" no debería recibir catálogo`).toEqual([]);
    }
    expect(buscarServiciosNoContinuosMock).not.toHaveBeenCalled();
  });
});
