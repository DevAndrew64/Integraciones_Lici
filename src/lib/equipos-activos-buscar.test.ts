import { afterEach, describe, expect, it, vi } from 'vitest';
import { buscarEquiposActivos } from './equipos-activos-buscar';

const RAW_EJEMPLO = {
  nombre_c: 'COMPUTADOR DE ESCRITORIO', empresa_c: 'aseo', uen: 'MNI',
  tipo_c: '006', sub_tipo_c: '002', cant_disponible: 3,
  fecha_adquisicion: '2015-09-23', valor: 2275000,
  estado: 'Activo', estado_producto: 'Normal',
  grupo: 'EQUIPO DE COMPUTACION Y COMUNICACION', sub_tipo: 'COMPUTADORES DE MESA',
  ubicacion: 'Mina Bodega Informática', valor_mantenimiento: 0,
};

function mockFetchOk(body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => body }) as unknown as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buscarEquiposActivos — consulta directa a equipos/obtener{empresa,descripcion}', () => {
  it('llama POST equipos/obtener con {empresa,descripcion} exactos, nunca grupo_activo/subtipo_activo', async () => {
    mockFetchOk([RAW_EJEMPLO]);
    await buscarEquiposActivos('aseo', 'compu');
    expect(fetch).toHaveBeenCalledWith(
      'https://grupocolba.com/service/public/api/equipos/obtener',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ empresa: 'aseo', descripcion: 'compu' }),
      }),
    );
  });

  it('mapea nombre_c, cant_disponible→cantidadDisponible, valor_mantenimiento→valorMantenimiento, tipo_c→codGrupo, sub_tipo_c→codSubtipo', async () => {
    mockFetchOk([RAW_EJEMPLO]);
    const [r] = await buscarEquiposActivos('aseo', 'compu');
    expect(r.nombre_c).toBe('COMPUTADOR DE ESCRITORIO');
    expect(r.cantidadDisponible).toBe(3);
    expect(r.valorMantenimiento).toBe(0);
    expect(r.codGrupo).toBe('006');
    expect(r.codSubtipo).toBe('002');
    expect(r.ubicacion).toBe('Mina Bodega Informática');
  });

  it('nunca confunde `valor` (precio del activo) con `valor_mantenimiento` (costo de mantenimiento)', async () => {
    mockFetchOk([{ ...RAW_EJEMPLO, valor: 2275000, valor_mantenimiento: 250000 }]);
    const [r] = await buscarEquiposActivos('aseo', 'compu');
    expect(r.valor).toBe(2275000);
    expect(r.valorMantenimiento).toBe(250000);
  });

  it('valorMantenimiento en 0 se respeta tal cual (nunca se convierte en null/"sin dato")', async () => {
    mockFetchOk([{ ...RAW_EJEMPLO, valor_mantenimiento: 0 }]);
    const [r] = await buscarEquiposActivos('aseo', 'compu');
    expect(r.valorMantenimiento).toBe(0);
  });

  it('valorMantenimiento ausente en la respuesta queda null (nunca se convierte en 0 en silencio)', async () => {
    const sinMantenimiento: Record<string, unknown> = { ...RAW_EJEMPLO };
    delete sinMantenimiento.valor_mantenimiento;
    mockFetchOk([sinMantenimiento]);
    const [r] = await buscarEquiposActivos('aseo', 'compu');
    expect(r.valorMantenimiento).toBeNull();
  });

  it('cada equipo conserva su propia cantidadDisponible/valorMantenimiento — varios equipos nunca comparten un valor', async () => {
    mockFetchOk([
      { ...RAW_EJEMPLO, nombre_c: 'EQUIPO A', cant_disponible: 3, valor_mantenimiento: 100000 },
      { ...RAW_EJEMPLO, nombre_c: 'EQUIPO B', cant_disponible: 1, valor_mantenimiento: 250000 },
    ]);
    const equipos = await buscarEquiposActivos('aseo', 'compu');
    expect(equipos[0].cantidadDisponible).toBe(3);
    expect(equipos[0].valorMantenimiento).toBe(100000);
    expect(equipos[1].cantidadDisponible).toBe(1);
    expect(equipos[1].valorMantenimiento).toBe(250000);
  });

  it('sin resultados devuelve arreglo vacío', async () => {
    mockFetchOk([]);
    const equipos = await buscarEquiposActivos('aseo', 'xyzxyznoexiste');
    expect(equipos).toEqual([]);
  });

  it('conserva estado/estado_producto cuando la fuente los entrega, sin filtrar por ellos', async () => {
    mockFetchOk([RAW_EJEMPLO]);
    const [r] = await buscarEquiposActivos('aseo', 'compu');
    expect(r.estado).toBe('Activo');
    expect(r.estado_producto).toBe('Normal');
  });

  it('error HTTP del proveedor se propaga como excepción, nunca como catálogo vacío disfrazado', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({}) }) as unknown as typeof fetch;
    await expect(buscarEquiposActivos('aseo', '')).rejects.toThrow();
  });
});
