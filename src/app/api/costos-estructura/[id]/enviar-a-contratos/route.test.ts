/**
 * Puente a Contratos (módulos 2 y 4) — POST /api/costos-estructura/[id]/enviar-a-contratos: arma el JSON v1 con la
 * solicitud, el Resultado guardado, los totales de la pantalla y el destino (empresa, tipo de tarifa y origen los decide el
 * servidor; quien envía elige la UEN y el concepto entre los de Contratos), lo manda al puente y traduce su respuesta.
 * El puente y la lectura de Contratos se simulan.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import type { CostosPantallaDto } from '@/lib/costos-estructura/exportacion/costos-pantalla';
import type { ResultadoPuente } from '@/lib/contratos-puente/cliente';

const mocks = vi.hoisted(() => ({ enviar: vi.fn(), auditoria: vi.fn(), destino: vi.fn(), nomina: vi.fn() }));

vi.mock('server-only', () => ({}));

let sesionActual: { id: number; usuario: string; email: string; rol: string } | null = null;
vi.mock('@/lib/session', () => ({ getSession: async () => sesionActual }));
vi.mock('@/lib/authz', () => ({
  requireEditarCostos: (s: { rol: string } | null) => (!s ? NextResponse.json({ ok: false }, { status: 401 }) : s.rol === 'Mercadeo' ? NextResponse.json({ ok: false }, { status: 403 }) : null),
}));
vi.mock('@/lib/audit', () => ({ auditFromRequest: (...a: unknown[]) => { mocks.auditoria(...a); return Promise.resolve(); } }));
vi.mock('@/lib/contratos-puente/directo', () => ({
  enviarAContratos: (...a: unknown[]) => mocks.enviar(...a),
  consultarDestinoContratos: (...a: unknown[]) => mocks.destino(...a),
  consultarCargosNomina: (...a: unknown[]) => mocks.nomina(...a),
}));

type Solicitud = {
  id: number; codigoProceso: string | null; resultadoFinal: string | null; entidad: string | null; objeto: string | null; nitContacto: string | null; direccionContacto: string | null;
  perfil: string | null; aliasFuente: string | null; linkSecop: string | null; linkSecopReg: string | null;
};
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
/** Lo que la pantalla manda: la UEN y el concepto elegidos. */
const DESTINO = { undnegocio: 'baq', codServicio: '460' };
/** Lo que Contratos tiene para ASEOCOLBA: BAQ con dos conceptos, BOG con uno. */
const CONTRATOS = () => ({
  ok: true,
  destino: {
    empresa: { codigo: '01', rsocial: 'ASEO COLBA S.A.S.' },
    uens: [
      { codigo: 'BAQ', conceptos: [{ codigo: '460', descripcion: 'SERVICIO DE ASEO' }, { codigo: '461', descripcion: 'SERVICIO DE CAFETERIA' }] },
      { codigo: 'BOG', conceptos: [{ codigo: '470', descripcion: 'ASEO BOGOTA' }] },
    ],
  },
});

beforeEach(() => {
  sesionActual = { id: 1, usuario: 'ana.perez', email: 'ana.perez@grupocolba.com', rol: 'Analista Comercial' };
  registro = { id: 1, procesoCodigo: 'SED-LP-2026-0091', datos: estructura() };
  solicitud = { id: 7, codigoProceso: 'SED-LP-2026-0091', resultadoFinal: 'Adjudicado', entidad: ' Cliente SAS ', objeto: 'Aseo integral', nitContacto: '900123456-8', direccionContacto: null,
    perfil: 'ASEOCOLBA', aliasFuente: 'S2', linkSecop: null, linkSecopReg: null,
  };
  mocks.enviar.mockReset().mockResolvedValue(enviarOk());
  mocks.destino.mockReset().mockResolvedValue(CONTRATOS());
  mocks.auditoria.mockReset();
  envios = [];
});
afterEach(() => { vi.resetModules(); });

/** Sin «contratos» en el cuerpo, la pantalla manda la UEN y el concepto de DESTINO. */
async function llamar(body: unknown) {
  const { POST } = await import('./route');
  const cuerpo = body && typeof body === 'object' && !('contratos' in body) ? { ...body, contratos: DESTINO } : body;
  const res = await POST(req(cuerpo), ctx());
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
      // Empresa por el perfil, tarifa «C» (lleva Costos Administrativos), origen LIC (SECOP II), concepto con su descripción.
      // La tarifa sale de los totales con el A.I.U. incluido (8 %).
      oferta: { empresa: '01', undnegocio: 'BAQ', tipoAdm: 'C', origenProceso: 'LIC', codServicio: '460', descripcionServicio: 'SERVICIO DE ASEO' },
      tarifa: { manoObra: 13111200, insumos: 0, maquinaria: 0, administrativos: 5400, valorAgregado: 0, serviciosNoContinuos: 0 },
      // Pestaña «Costos Admtivos»: cada concepto con su valor mensual sin A.I.U.
      costosAdministrativos: [{ concepto: 'Papelería', valorMensual: 5000 }],
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
      { nombre: 'ASEADOR', cantidad: 4, horasSemana: 48, jornada: 8, salario: 1423500, riesgo: 1, valorUnitario: 2285000, valorTotal: 9140000, codigoHorario: '941', grupoDotacionMasculina: null, grupoDotacionFemenina: null, grupoEpp: null, grupoExamen: null, grupoCurso: null },
      { nombre: 'Turnante — bloque integrado de 42h', cantidad: 1, horasSemana: 42, jornada: 0, salario: 1423500, riesgo: 2, valorUnitario: 3000000, valorTotal: 3000000, codigoHorario: null, grupoDotacionMasculina: null, grupoDotacionFemenina: null, grupoEpp: null, grupoExamen: null, grupoCurso: null },
    ]);
  });

  it('el cargo de nómina elegido en la pantalla y la base de la vista previa viajan al puente', async () => {
    const [aseador, turnante] = CARGOS();
    await llamar({ solicitudId: 7, costosDto: costosDto(), cargos: [{ ...aseador, codigoNomina: 99 }, turnante], contratos: { ...DESTINO, baseNomina: 'nominabq' } });
    const enviado = mocks.enviar.mock.calls[0][0];
    expect(enviado.cargos.map((c: { codigoNomina?: number }) => c.codigoNomina)).toEqual([99, undefined]);
    expect(enviado.oferta.baseNomina).toBe('nominabq');
    // Una base con caracteres raros no viaja (el puente igual la compararía con las de la UEN).
    await llamar({ solicitudId: 7, costosDto: costosDto(), cargos: CARGOS(), contratos: { ...DESTINO, baseNomina: 'x`; DROP' } });
    expect('baseNomina' in mocks.enviar.mock.calls[1][0].oferta).toBe(false);
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

  it('empresa, tipo de tarifa y origen los decide el servidor: lo que mande la pantalla para ellos se ignora', async () => {
    await llamar({ solicitudId: 7, costosDto: costosDto(), contratos: { ...DESTINO, empresa: '99', tipoAdm: 'A', origenProceso: 'INV', descripcionServicio: 'otra' } });
    expect(mocks.destino).toHaveBeenCalledWith('ASEOCOLBA');
    expect(mocks.enviar.mock.calls[0][0].oferta).toEqual({
      empresa: '01', undnegocio: 'BAQ', tipoAdm: 'C', origenProceso: 'LIC', codServicio: '460', descripcionServicio: 'SERVICIO DE ASEO',
    });
  });

  it('un proceso digitado a mano (sin SECOP) va como invitación privada', async () => {
    solicitud = { ...solicitud!, aliasFuente: null };
    await llamar({ solicitudId: 7, costosDto: costosDto() });
    expect(mocks.enviar.mock.calls[0][0].oferta.origenProceso).toBe('INV');
  });

  it('una UEN con un solo concepto lo lleva sola; con varios hay que elegir uno de esa UEN', async () => {
    await llamar({ solicitudId: 7, costosDto: costosDto(), contratos: { undnegocio: 'BOG' } });
    expect(mocks.enviar.mock.calls[0][0].oferta).toMatchObject({ undnegocio: 'BOG', codServicio: '470', descripcionServicio: 'ASEO BOGOTA' });
    for (const [contratos, texto] of [
      [{ undnegocio: 'BAQ' }, 'Seleccione el concepto'],
      [{ undnegocio: 'BAQ', codServicio: '470' }, 'no es de la UEN BAQ'],
      [{ undnegocio: 'MNA', codServicio: '460' }, 'UEN disponibles: BAQ, BOG'],
      [{}, 'Seleccione la UEN'],
    ] as const) {
      mocks.enviar.mockClear();
      const { res, json } = await llamar({ solicitudId: 7, costosDto: costosDto(), contratos });
      expect(res.status).toBe(422);
      expect(json.error).toBe('DESTINO_INVALIDO');
      expect(String(json.mensaje)).toContain(texto);
      expect(mocks.enviar).not.toHaveBeenCalled();
    }
  });

  it('sin la empresa en Contratos (o sin perfil) responde 409; con Contratos caído, 503; en ningún caso envía', async () => {
    mocks.destino.mockResolvedValueOnce({ ok: false, tipo: 'SIN_EMPRESA', candidatas: [] });
    let r = await llamar({ solicitudId: 7, costosDto: costosDto() });
    expect(r.res.status).toBe(409);
    expect(String(r.json.mensaje)).toContain('No se encontró la empresa ASEOCOLBA');
    mocks.destino.mockResolvedValueOnce({ ok: false, tipo: 'NO_DISPONIBLE', mensaje: 'No se pudo conectar con la base de datos de Contratos.' });
    r = await llamar({ solicitudId: 7, costosDto: costosDto() });
    expect(r.res.status).toBe(503);
    solicitud = { ...solicitud!, perfil: null };
    r = await llamar({ solicitudId: 7, costosDto: costosDto() });
    expect(r.res.status).toBe(409);
    expect(r.json.error).toBe('SIN_EMPRESA');
    expect(mocks.enviar).not.toHaveBeenCalled();
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

  it('sin NIT verificado (vacío, de antes sin DV o con DV que no corresponde) responde 409 y no llama al puente', async () => {
    for (const nitContacto of [null, '', '900087223', '900123456-1']) {
      solicitud = { ...solicitud!, nitContacto };
      const { res, json } = await llamar({ solicitudId: 7, costosDto: costosDto(), contratos: DESTINO });
      expect(res.status, String(nitContacto)).toBe(409);
      expect(json.error).toBe('NIT_SIN_VERIFICAR');
      expect(json.mensaje).toMatch(/dígito de verificación/);
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

  describe('POST cargos-nomina: vista previa de los cargos contra la nómina de la UEN', () => {
    const VISTA = { base: 'nominabq', bases: ['nominabq'], cargos: [{ nombre: 'Jefe', estado: 'falta', codigo: null, nombreNomina: null, parecidos: [] }], catalogo: [{ codigo: 99, nombre: 'ASEADOR' }] };
    const revisar = async (body: unknown) => {
      const { POST } = await import('./cargos-nomina/route');
      const res = await POST(new NextRequest('http://localhost/api/costos-estructura/1/enviar-a-contratos/cargos-nomina', { method: 'POST', body: JSON.stringify(body) }));
      return { res, json: (await res.json()) as Record<string, unknown> };
    };
    beforeEach(() => { mocks.nomina.mockReset().mockResolvedValue({ ok: true, vista: VISTA }); });

    it('la empresa sale del perfil de la solicitud (no de la pantalla) y responde la vista', async () => {
      const { res, json } = await revisar({ solicitudId: 7, undnegocio: 'baq', empresa: '99', cargos: [{ nombre: 'Jefe', codigoNomina: 5 }, { nombre: 'Aseador', codigoNomina: 'x' }] });
      expect(res.status).toBe(200);
      expect(json).toEqual({ ok: true, ...VISTA });
      expect(mocks.nomina).toHaveBeenCalledWith({ empresa: '01', undnegocio: 'BAQ', baseNomina: null, cargos: [{ nombre: 'Jefe', codigoNomina: 5 }, { nombre: 'Aseador', codigoNomina: null }] });
    });

    it('una UEN que no es de la empresa en Contratos: 422 sin consultar la nómina', async () => {
      const { res } = await revisar({ solicitudId: 7, undnegocio: 'ZZZ', cargos: [] });
      expect(res.status).toBe(422);
      expect(mocks.nomina).not.toHaveBeenCalled();
    });

    it('sin nómina en Contratos: 503 con el mensaje; exige la solicitud, la UEN y el permiso', async () => {
      mocks.nomina.mockResolvedValueOnce({ ok: false, mensaje: 'Contratos no tiene una base de nómina…' });
      const { res, json } = await revisar({ solicitudId: 7, undnegocio: 'BAQ', cargos: [{ nombre: 'Jefe' }] });
      expect(res.status).toBe(503);
      expect(json.mensaje).toBe('Contratos no tiene una base de nómina…');
      expect((await revisar({ undnegocio: 'BAQ', cargos: [] })).res.status).toBe(400);
      expect((await revisar({ solicitudId: 7, cargos: [] })).res.status).toBe(400);
      sesionActual = null;
      expect((await revisar({ solicitudId: 7, undnegocio: 'BAQ', cargos: [] })).res.status).toBe(401);
    });
  });

  describe('GET destino: empresa, UEN y conceptos de Contratos para la pantalla', () => {
    const consultar = async (solicitudId = 7) => {
      const { GET } = await import('./destino/route');
      const res = await GET(new NextRequest(`http://localhost/api/costos-estructura/1/enviar-a-contratos/destino?solicitudId=${solicitudId}`));
      return { res, json: (await res.json()) as Record<string, unknown> };
    };

    it('responde la empresa, sus UEN con conceptos y el origen del proceso', async () => {
      const { res, json } = await consultar();
      expect(res.status).toBe(200);
      expect(json).toEqual({ ok: true, empresa: CONTRATOS().destino.empresa, uens: CONTRATOS().destino.uens, origenProceso: 'LIC' });
    });

    it('sin la empresa en Contratos responde 409 con el motivo; exige la solicitud y el permiso', async () => {
      mocks.destino.mockResolvedValueOnce({ ok: false, tipo: 'EMPRESA_AMBIGUA', candidatas: ['01 ASEO COLBA', '05 ASEO COLBA MINA'] });
      const { res, json } = await consultar();
      expect(res.status).toBe(409);
      expect(String(json.mensaje)).toContain('coincide con varias empresas');
      expect((await consultar(0)).res.status).toBe(400);
      expect((await consultar(99)).res.status).toBe(404);
      sesionActual = null;
      expect((await consultar()).res.status).toBe(401);
    });
  });
});
