/**
 * Módulo 2 del puente — POST /api/costos-estructura/[id]/enviar-a-contratos: arma el JSON v1 con la solicitud, el
 * Resultado guardado y los totales de la pantalla, lo envía al puente y traduce su respuesta. El puente se simula.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import type { CostosPantallaDto } from '@/lib/costos-estructura/exportacion/costos-pantalla';
import type { ResultadoPuente } from '@/lib/contratos-puente/cliente';

const mocks = vi.hoisted(() => ({ enviar: vi.fn(), auditoria: vi.fn() }));

let sesionActual: { id: number; usuario: string; email: string; rol: string } | null = null;
vi.mock('@/lib/session', () => ({ getSession: async () => sesionActual }));
vi.mock('@/lib/authz', () => ({
  requireEditarCostos: (s: { rol: string } | null) => (!s ? NextResponse.json({ ok: false }, { status: 401 }) : s.rol === 'Mercadeo' ? NextResponse.json({ ok: false }, { status: 403 }) : null),
}));
vi.mock('@/lib/audit', () => ({ auditFromRequest: (...a: unknown[]) => { mocks.auditoria(...a); return Promise.resolve(); } }));
vi.mock('@/lib/contratos-puente/cliente', () => ({ enviarAlPuente: (...a: unknown[]) => mocks.enviar(...a) }));

type Solicitud = { id: number; codigoProceso: string | null; entidad: string | null; objeto: string | null; nitContacto: string | null; direccionContacto: string | null };
let registro: { id: number; procesoCodigo: string | null; datos: Record<string, unknown> } | null = null;
let solicitud: Solicitud | null = null;

vi.mock('@/lib/prisma', () => ({
  default: {
    costoEstructura: { async findUnique({ where }: { where: { id: number } }) { return registro && where.id === registro.id ? { ...registro } : null; } },
    solicitud: { async findUnique({ where }: { where: { id: number } }) { return solicitud && where.id === solicitud.id ? { ...solicitud } : null; } },
  },
}));

const modulo = (estado: string, datos: unknown = {}) => ({ estado, datos, ultimaActualizacion: 't0', actualizadoPor: 'ana' });
function estructura(extra: Record<string, unknown> = {}) {
  return {
    version: 2 as const,
    modulos: {
      manoObra: modulo('COMPLETADO', { datosEntrada: { lineasExtra: [{ id: 1 }] } }),
      dotacionEpp: modulo('COMPLETADO'),
      examenesMedicos: modulo('NO_APLICA'),
      insumos: modulo('COMPLETADO'),
      maquinariaEquipos: modulo('NO_APLICA'),
      costosAdministrativos: modulo('COMPLETADO'),
      resultado: modulo('COMPLETADO', { subtotalAntesIva: 14000000, valorMesIncluidoIva: 16000000, porcentajeIU: 8, vigenciaMeses: 12 }),
      ...extra,
    },
  };
}
/** Mano de Obra 12.140.000 + Papelería 5.000 = TOTAL 12.145.000 (mismo DTO válido del export). */
function costosDto(): CostosPantallaDto {
  return {
    nTrabajadores: 4,
    cargos: ['ASEADOR'],
    totales: { manoObra: 12140000, otrosCostosEnManoObra: 320000, insumos: 0, maquinaria: 0, serviciosNoContinuos: 0, valorAgregado: 0, administrativos: 5000, total: 12145000 },
    administrativos: { variables: [{ concepto: 'Papelería', cantidad: 1, valorUnitario: 5000, valorMensual: 5000 }], totalVariables: 5000, valorMensualPolizas: 0, valorMensualImpuestos: 0 },
    dotacionEpp: { total: 0, cargos: [] },
    examenes: { total: 0, cargos: [] },
    insumos: { filas: [], total: 0 },
    maquinaria: { filas: [], subtotalAdquisicion: 0, subtotalMantenimiento: 0 },
  };
}
const req = (body: unknown) => new NextRequest('http://localhost/api/costos-estructura/1/enviar-a-contratos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const ctx = () => ({ params: Promise.resolve({ id: '1' }) });
const enviarOk = (): ResultadoPuente => ({ ok: true, modo: 'dry-run', huella: 'h'.repeat(64), advertencias: [{ campo: 'cliente.direccion', mensaje: 'Sin dato: se completa en Contratos.' }] });

beforeEach(() => {
  sesionActual = { id: 1, usuario: 'ana.perez', email: 'ana.perez@grupocolba.com', rol: 'Analista Comercial' };
  registro = { id: 1, procesoCodigo: 'SED-LP-2026-0091', datos: estructura() };
  solicitud = { id: 7, codigoProceso: 'SED-LP-2026-0091', entidad: ' Cliente SAS ', objeto: 'Aseo integral', nitContacto: '900.123.456-8', direccionContacto: null };
  mocks.enviar.mockReset().mockResolvedValue(enviarOk());
  mocks.auditoria.mockReset();
});
afterEach(() => { vi.resetModules(); });

async function llamar(body: unknown) {
  const { POST } = await import('./route');
  const res = await POST(req(body), ctx());
  return { res, json: (await res.json()) as Record<string, unknown> };
}

describe('POST /api/costos-estructura/[id]/enviar-a-contratos', () => {
  // A.I.U.: directos 12.140.000 · I.U. 8 % de (12.140.000 + 5.000) = 971.600 · (5.000 + 971.600) ÷ 12.140.000 = 8,04 %
  it('arma el JSON v1 (NIT sin puntos ni dígito de verificación, A.I.U. con la «A», valor mensual del Resultado guardado) y lo envía', async () => {
    const { res, json } = await llamar({ solicitudId: 7, costosDto: costosDto() });
    expect(res.status).toBe(200);
    expect(mocks.enviar).toHaveBeenCalledTimes(1);
    expect(mocks.enviar.mock.calls[0][0]).toEqual({
      version: 1,
      origen: { solicitudId: 7, procesoCodigo: 'SED-LP-2026-0091' },
      cliente: { razonSocial: 'Cliente SAS', nit: '900123456', direccion: null },
      contrato: { objeto: 'Aseo integral', porcentajeAIU: 8, valorMensual: 16000000, plazoMeses: 12 },
    });
    expect(json.ok).toBe(true);
    expect(String(json.mensaje)).toContain('modo prueba');
    expect(String(json.mensaje)).toContain('Dirección del cliente'); // lo que queda por completar en Contratos
  });

  it('audita el envío sin datos del cliente: solo ids, resultado y huella', async () => {
    await llamar({ solicitudId: 7, costosDto: costosDto() });
    const [, , params] = mocks.auditoria.mock.calls[0] as [unknown, unknown, { accion: string; recursoId: string; detalle: Record<string, unknown> }];
    expect(params).toMatchObject({ accion: 'CONTRATOS_PUENTE_ENVIO', recursoId: '1', detalle: { solicitudId: 7, resultado: 'OK', modo: 'dry-run', advertencias: 1 } });
    expect(JSON.stringify(params)).not.toMatch(/Cliente SAS|900123456|Calle/);
  });

  it('sin permiso de editar costos no envía nada (401/403)', async () => {
    sesionActual = null;
    expect((await llamar({ solicitudId: 7, costosDto: costosDto() })).res.status).toBe(401);
    sesionActual = { id: 2, usuario: 'm', email: 'm@x.co', rol: 'Mercadeo' };
    expect((await llamar({ solicitudId: 7, costosDto: costosDto() })).res.status).toBe(403);
    expect(mocks.enviar).not.toHaveBeenCalled();
  });

  it('exige la solicitud explícita, que exista y que corresponda al costeo (mismo código de proceso)', async () => {
    expect((await llamar({ costosDto: costosDto() })).res.status).toBe(400);
    expect((await llamar({ solicitudId: 99, costosDto: costosDto() })).res.status).toBe(404);
    solicitud = { ...solicitud!, codigoProceso: 'OTRO-PROCESO' };
    const r = await llamar({ solicitudId: 7, costosDto: costosDto() });
    expect(r.res.status).toBe(409);
    expect(r.json.error).toBe('SOLICITUD_NO_CORRESPONDE');
    expect(mocks.enviar).not.toHaveBeenCalled();
  });

  it('con módulos de costos pendientes (409) o un costeo inexistente (404) no envía', async () => {
    registro = { id: 1, procesoCodigo: 'SED-LP-2026-0091', datos: estructura({ insumos: modulo('EN_PROGRESO') }) };
    expect((await llamar({ solicitudId: 7, costosDto: costosDto() })).res.status).toBe(409);
    registro = null;
    expect((await llamar({ solicitudId: 7, costosDto: costosDto() })).res.status).toBe(404);
    expect(mocks.enviar).not.toHaveBeenCalled();
  });

  it('rechaza totales de pantalla que no cuadran (400)', async () => {
    const malo = costosDto();
    malo.totales.total = 1;
    expect((await llamar({ solicitudId: 7, costosDto: malo })).res.status).toBe(400);
    expect(mocks.enviar).not.toHaveBeenCalled();
  });

  it('sin el Resultado guardado el valor mensual, el plazo y el A.I.U. viajan vacíos (nunca se inventan)', async () => {
    registro = { id: 1, procesoCodigo: 'SED-LP-2026-0091', datos: estructura({ resultado: undefined }) };
    await llamar({ solicitudId: 7, costosDto: costosDto() });
    expect(mocks.enviar.mock.calls[0][0].contrato).toEqual({ objeto: 'Aseo integral', porcentajeAIU: null, valorMensual: null, plazoMeses: null });
  });

  it('traduce las respuestas del puente: datos inválidos (422, con etiquetas legibles), sin configurar (503), sin conexión (502), tiempo agotado (504)', async () => {
    mocks.enviar.mockResolvedValueOnce({ ok: false, tipo: 'DATOS_INVALIDOS', errores: [{ campo: 'cliente.nit', mensaje: 'Es obligatorio.' }] });
    const invalido = await llamar({ solicitudId: 7, costosDto: costosDto() });
    expect(invalido.res.status).toBe(422);
    expect(String(invalido.json.mensaje)).toContain('NIT del cliente: Es obligatorio. Complételo en la ficha de la solicitud.');

    mocks.enviar.mockResolvedValueOnce({ ok: false, tipo: 'NO_CONFIGURADO' });
    expect((await llamar({ solicitudId: 7, costosDto: costosDto() })).res.status).toBe(503);
    mocks.enviar.mockResolvedValueOnce({ ok: false, tipo: 'NO_DISPONIBLE', mensaje: 'No se pudo conectar con el puente de Contratos.' });
    expect((await llamar({ solicitudId: 7, costosDto: costosDto() })).res.status).toBe(502);
    mocks.enviar.mockResolvedValueOnce({ ok: false, tipo: 'TIMEOUT', mensaje: 'El puente de Contratos no respondió a tiempo.' });
    expect((await llamar({ solicitudId: 7, costosDto: costosDto() })).res.status).toBe(504);
  });
});
