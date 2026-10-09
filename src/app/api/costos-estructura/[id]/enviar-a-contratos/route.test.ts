/**
 * Puente a Contratos (módulos 2 y 4) — POST /api/costos-estructura/[id]/enviar-a-contratos: arma el JSON v1 con la
 * solicitud, el Resultado guardado, los totales de la pantalla y el destino que elige quien envía, lo manda al puente y
 * traduce su respuesta. El puente se simula.
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

type Solicitud = { id: number; codigoProceso: string | null; resultadoFinal: string | null; entidad: string | null; objeto: string | null; nitContacto: string | null; direccionContacto: string | null };
let registro: { id: number; procesoCodigo: string | null; datos: Record<string, unknown> } | null = null;
let solicitud: Solicitud | null = null;
let envios: { detalle: Record<string, unknown>; creadoEn: Date }[] = [];

vi.mock('@/lib/prisma', () => ({
  default: {
    costoEstructura: { async findUnique({ where }: { where: { id: number } }) { return registro && where.id === registro.id ? { ...registro } : null; } },
    solicitud: { async findUnique({ where }: { where: { id: number } }) { return solicitud && where.id === solicitud.id ? { ...solicitud } : null; } },
    auditLog: { async findMany() { return envios; } },
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
const enviarOk = (): ResultadoPuente => ({
  ok: true, modo: 'dry-run', huella: 'h'.repeat(64), advertencias: [{ campo: 'cliente.direccion', mensaje: 'Sin dato: se completa en Contratos.' }], oferta: null, noEscrito: [],
});
const DESTINO = { empresa: '01', undnegocio: 'baq', tipoAdm: 'a', origenProceso: 'lic', codServicio: 'ase', descripcionServicio: 'Aseo y cafetería' };

beforeEach(() => {
  sesionActual = { id: 1, usuario: 'ana.perez', email: 'ana.perez@grupocolba.com', rol: 'Analista Comercial' };
  registro = { id: 1, procesoCodigo: 'SED-LP-2026-0091', datos: estructura() };
  solicitud = { id: 7, codigoProceso: 'SED-LP-2026-0091', resultadoFinal: 'Adjudicado', entidad: ' Cliente SAS ', objeto: 'Aseo integral', nitContacto: '900.123.456-8', direccionContacto: null };
  mocks.enviar.mockReset().mockResolvedValue(enviarOk());
  mocks.auditoria.mockReset();
  envios = [];
});
afterEach(() => { vi.resetModules(); });

async function llamar(body: unknown) {
  const { POST } = await import('./route');
  const res = await POST(req(body), ctx());
  return { res, json: (await res.json()) as Record<string, unknown> };
}

describe('POST /api/costos-estructura/[id]/enviar-a-contratos', () => {
  it('arma el JSON v1 (NIT sin puntos ni dígito de verificación, A.I.U. = % de I.U. del Resultado, valor mensual del Resultado guardado) y lo envía', async () => {
    const { res, json } = await llamar({ solicitudId: 7, costosDto: costosDto() });
    expect(res.status).toBe(200);
    expect(mocks.enviar).toHaveBeenCalledTimes(1);
    expect(mocks.enviar.mock.calls[0][0]).toEqual({
      version: 1,
      origen: { solicitudId: 7, procesoCodigo: 'SED-LP-2026-0091' },
      cliente: { razonSocial: 'Cliente SAS', nit: '900123456', direccion: null },
      contrato: { objeto: 'Aseo integral', porcentajeAIU: 8, valorMensual: 16000000, plazoMeses: 12 },
      // Sin destino elegido viaja vacío (nunca se infiere); la tarifa sale de los totales con el A.I.U. incluido (8 %).
      oferta: { empresa: null, undnegocio: null, tipoAdm: null, origenProceso: null, codServicio: null, descripcionServicio: null },
      tarifa: { manoObra: 13111200, insumos: 0, maquinaria: 0, administrativos: 5400, valorAgregado: 0, serviciosNoContinuos: 0 },
    });
    expect(json.ok).toBe(true);
    expect(String(json.mensaje)).toContain('modo prueba');
    expect(String(json.mensaje)).toContain('Dirección del cliente'); // lo que queda por completar en Contratos
  });

  const CARGOS = () => [
    { id: 1, nombre: 'ASEADOR', cantidad: 4, horasSemana: 48, jornada: 8, salario: 1423500, arlKey: 'I', codigoHorario: '941', valorTotal: 9140000, esTurnante: false },
    { id: 2, nombre: 'Turnante — bloque integrado de 42h', cantidad: 1, horasSemana: 42, jornada: null, salario: 1423500, arlKey: 'II', codigoHorario: '', valorTotal: 3000000, esTurnante: true },
  ];

  it('los cargos de la pantalla viajan al puente en su forma (valor por trabajador = total ÷ personas, riesgo en número) cuando suman la Mano de Obra', async () => {
    await llamar({ solicitudId: 7, costosDto: costosDto(), cargos: CARGOS() });
    expect(mocks.enviar.mock.calls[0][0].cargos).toEqual([
      { nombre: 'ASEADOR', cantidad: 4, horasSemana: 48, jornada: 8, salario: 1423500, riesgo: 1, valorUnitario: 2285000, valorTotal: 9140000, codigoHorario: '941' },
      { nombre: 'Turnante — bloque integrado de 42h', cantidad: 1, horasSemana: 42, jornada: 0, salario: 1423500, riesgo: 2, valorUnitario: 3000000, valorTotal: 3000000, codigoHorario: null },
    ]);
  });

  it('cargos que no suman la Mano de Obra del panel: 400 y no se envía nada a Contratos', async () => {
    const r = await llamar({ solicitudId: 7, costosDto: costosDto(), cargos: [CARGOS()[0]] });
    expect(r.res.status).toBe(400);
    expect(r.json.error).toBe('CARGOS_INVALIDOS');
    expect(String(r.json.mensaje)).toContain('no cuadran con la Mano de Obra del panel');
    expect(mocks.enviar).not.toHaveBeenCalled();
    const malformado = await llamar({ solicitudId: 7, costosDto: costosDto(), cargos: 'x' });
    expect(malformado.res.status).toBe(400);
    expect(mocks.enviar).not.toHaveBeenCalled();
  });

  it('sin «cargos» en la petición el JSON viaja sin esa clave (la oferta se crea sin mano de obra)', async () => {
    await llamar({ solicitudId: 7, costosDto: costosDto() });
    expect('cargos' in mocks.enviar.mock.calls[0][0]).toBe(false);
  });

  it('un error del puente en un cargo se nombra por su posición y su nombre, y dice dónde corregirlo', async () => {
    mocks.enviar.mockResolvedValueOnce({ ok: false, tipo: 'DATOS_INVALIDOS', errores: [{ campo: 'cargos[0].codigoHorario', mensaje: 'El horario «941» no existe en Contratos.' }] });
    const r = await llamar({ solicitudId: 7, costosDto: costosDto(), cargos: CARGOS() });
    expect(r.res.status).toBe(422);
    expect(String(r.json.mensaje)).toContain('Cargo 1 «ASEADOR» · Horario: El horario «941» no existe en Contratos. Revise el horario del cargo en Mano de Obra.');
  });

  it('el destino que elige quien envía llega al puente normalizado (códigos en mayúsculas); lo desconocido se ignora', async () => {
    await llamar({ solicitudId: 7, costosDto: costosDto(), contratos: { ...DESTINO, rol: 'Administrador' } });
    expect(mocks.enviar.mock.calls[0][0].oferta).toEqual({
      empresa: '01', undnegocio: 'BAQ', tipoAdm: 'A', origenProceso: 'LIC', codServicio: 'ASE', descripcionServicio: 'Aseo y cafetería',
    });
  });

  it('en modo escritura responde con la oferta creada en Contratos y la audita con su número (sin datos del cliente)', async () => {
    mocks.enviar.mockResolvedValueOnce({
      ok: true, modo: 'escritura', huella: 'h'.repeat(64), advertencias: [], oferta: { empresa: '01', undnegocio: 'BAQ', numOferta: 937 },
      noEscrito: [{ campo: 'contrato.plazoMeses', motivo: 'Va en las fechas del contrato.' }],
    } satisfies ResultadoPuente);
    const { res, json } = await llamar({ solicitudId: 7, costosDto: costosDto(), contratos: DESTINO });
    expect(res.status).toBe(200);
    expect(json.oferta).toEqual({ empresa: '01', undnegocio: 'BAQ', numOferta: 937 });
    expect(String(json.mensaje)).toContain('Oferta 937 creada en Contratos (empresa 01, UEN BAQ).');
    expect(String(json.mensaje)).toContain('Se digitan en Contratos: Plazo (meses).');
    expect(String(json.mensaje)).not.toContain('modo prueba');
    const [, , params] = mocks.auditoria.mock.calls[0] as [unknown, unknown, { detalle: Record<string, unknown> }];
    expect(params.detalle).toMatchObject({ solicitudId: 7, resultado: 'OK', modo: 'escritura', numOferta: 937, empresa: '01', undnegocio: 'BAQ' });
    expect(JSON.stringify(params)).not.toMatch(/Cliente SAS|900123456/);
  });

  it('un reenvío (la solicitud ya está en Contratos) responde 409 con la oferta existente y avisa si los datos cambiaron', async () => {
    mocks.enviar.mockResolvedValueOnce({ ok: false, tipo: 'YA_ENVIADA', oferta: { empresa: '01', undnegocio: 'BAQ', numOferta: 930 }, sinCambios: true });
    const igual = await llamar({ solicitudId: 7, costosDto: costosDto() });
    expect(igual.res.status).toBe(409);
    expect(igual.json.error).toBe('YA_ENVIADA');
    expect(String(igual.json.mensaje)).toContain('como la oferta 930 (empresa 01, UEN BAQ)');
    expect(String(igual.json.mensaje)).not.toContain('cambiaron');

    mocks.enviar.mockResolvedValueOnce({ ok: false, tipo: 'YA_ENVIADA', oferta: { empresa: '01', undnegocio: 'BAQ', numOferta: 930 }, sinCambios: false });
    const cambiado = await llamar({ solicitudId: 7, costosDto: costosDto() });
    expect(String(cambiado.json.mensaje)).toContain('Los datos cambiaron desde entonces');
  });

  it('un rechazo del puente que el usuario puede entender (servicio ocupado, contador desfasado) llega con su mensaje', async () => {
    mocks.enviar.mockResolvedValueOnce({ ok: false, tipo: 'CONFLICTO', codigo: 'OCUPADO', mensaje: 'Hay otro envío de esta solicitud en curso. Intente de nuevo en unos segundos.' });
    const r = await llamar({ solicitudId: 7, costosDto: costosDto() });
    expect(r.res.status).toBe(409);
    expect(r.json).toMatchObject({ ok: false, error: 'OCUPADO', mensaje: 'Hay otro envío de esta solicitud en curso. Intente de nuevo en unos segundos.' });
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

  it('solo se envía con la solicitud Adjudicada: en cualquier otra etapa responde 409 y no llama al puente', async () => {
    for (const resultadoFinal of [null, 'No adjudicado', '']) {
      solicitud = { ...solicitud!, resultadoFinal };
      const { res, json } = await llamar({ solicitudId: 7, costosDto: costosDto(), contratos: DESTINO });
      expect(res.status).toBe(409);
      expect(json.error).toBe('SOLICITUD_NO_ADJUDICADA');
    }
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

  it('sin el Resultado guardado el valor mensual, el plazo, el A.I.U. y la tarifa viajan vacíos (nunca se inventan)', async () => {
    registro = { id: 1, procesoCodigo: 'SED-LP-2026-0091', datos: estructura({ resultado: undefined }) };
    await llamar({ solicitudId: 7, costosDto: costosDto() });
    expect(mocks.enviar.mock.calls[0][0].contrato).toEqual({ objeto: 'Aseo integral', porcentajeAIU: null, valorMensual: null, plazoMeses: null });
    expect(mocks.enviar.mock.calls[0][0].tarifa).toEqual({ manoObra: null, insumos: null, maquinaria: null, administrativos: null, valorAgregado: null, serviciosNoContinuos: null });
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

  describe('GET: ¿ya se envió a Contratos?', () => {
    const consultar = async (solicitudId = 7) => {
      const { GET } = await import('./route');
      const res = await GET(new NextRequest(`http://localhost/api/costos-estructura/1/enviar-a-contratos?solicitudId=${solicitudId}`), ctx());
      return { res, json: (await res.json()) as Record<string, unknown> };
    };
    const envio = (detalle: Record<string, unknown>) => ({ detalle: { solicitudId: 7, ...detalle }, creadoEn: new Date('2026-10-09T12:00:00Z') });

    it('sin envíos, o solo con envíos en modo prueba o rechazados, responde que no se ha enviado', async () => {
      expect((await consultar()).json).toEqual({ ok: true, enviada: false });
      envios = [envio({ resultado: 'OK', modo: 'dry-run' }), envio({ resultado: 'DATOS_INVALIDOS' }), envio({ resultado: 'OK', modo: 'escritura', numOferta: 937 })];
      envios[2].detalle.solicitudId = 8;
      expect((await consultar()).json.enviada).toBe(false);
    });

    it('con un envío que escribió en Contratos, o un reenvío rechazado por ya existir, responde la oferta', async () => {
      envios = [envio({ resultado: 'OK', modo: 'escritura', numOferta: 937, empresa: '01', undnegocio: 'BAQ' })];
      const { json } = await consultar();
      expect(json).toMatchObject({ ok: true, enviada: true, oferta: { numOferta: 937, empresa: '01', undnegocio: 'BAQ' } });
      envios = [envio({ resultado: 'YA_ENVIADA', numOferta: 937, empresa: '01', undnegocio: 'BAQ' })];
      expect((await consultar()).json.enviada).toBe(true);
    });

    it('exige la solicitud y el permiso de editar costos', async () => {
      expect((await consultar(0)).res.status).toBe(400);
      sesionActual = null;
      expect((await consultar()).res.status).toBe(401);
    });
  });
});
