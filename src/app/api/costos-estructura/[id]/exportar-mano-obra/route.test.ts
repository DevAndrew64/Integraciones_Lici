/**
 * Ajuste "IMPLEMENTAR EXPORTACIÓN DE MANO DE OBRA USANDO EXACTAMENTE LA
 * PLANTILLA 'Mano de obra.xlsx'" — wiring del endpoint: el servidor NUNCA
 * recalcula la liquidación laboral (eso vive en page.tsx); solo autentica,
 * valida identidad/versión contra lo persistido, valida el esquema y las
 * reconciliaciones del DTO, y genera el Excel. Mismo patrón de mocking
 * (`vi.mock('@/lib/prisma', ...)`) que el resto de route.test.ts del
 * proyecto.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const findUniqueMock = vi.fn();
vi.mock('@/lib/prisma', () => ({ default: { costoEstructura: { findUnique: (...args: unknown[]) => findUniqueMock(...args) } } }));
vi.mock('@/lib/session', () => ({
  getSession: async () => ({ id: 1, email: 'admin@grupocolba.com', rol: 'admin', exp: 9999999999, sv: 1, usuario: 'admin.qa' }),
}));

function mkReq(body: Record<string, unknown>): NextRequest {
  return new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) as unknown as NextRequest;
}

function mkCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

const ULTIMA_ACTUALIZACION = '2026-08-06T12:00:00.000Z';

function registroBase() {
  return {
    id: 1,
    datos: {
      version: 2,
      modulos: {
        manoObra: {
          estado: 'COMPLETADO',
          datos: { datosEntrada: { lineasExtra: [{ id: 1 }], cargosTurnantes: [] } },
          ultimaActualizacion: ULTIMA_ACTUALIZACION,
          actualizadoPor: 'admin.qa',
        },
      },
    },
  };
}

function detalle() {
  return {
    salarioBasico: 1750905, bonoPrestacional: 0,
    recargoNocturno: 50000, horaExtraDiurna: 20000, horaExtraNocturna: 15000, dominicalesFestivos: 300000,
    horaExtraFestiva: 10000, horaExtraFestivaNocturna: 5000, recargoNocturnoFestivo: 8000, totalRecargos: 408000,
    auxilioTransporte: 249095, subtotalSalarial: 2408000,
    cesantias: 100000, prima: 100000, vacaciones: 60000, interesesCesantias: 12000, totalPrestaciones: 272000,
    salud: 0, pension: 150000, arl: 30000, totalSeguridadSocial: 180000,
    cajaCompensacion: 80000, sena: 0, icbf: 0, totalParafiscales: 80000,
    dotacion: 40000, epp: 30000, examenes: 5000, cursos: 3000, vacunas: 2000, totalOtrosCostos: 80000,
    bonosNoPrestacionales: 15000, costoLaboralUnitario: 3035000,
  };
}

function dtoBase() {
  return {
    estructuraCostoId: 1, procesoId: 1, numeroProceso: 'SED-LP-2026-0091',
    ultimaActualizacionManoObra: ULTIMA_ACTUALIZACION,
    fichas: [{
      fichaId: 'f1', tipo: 'CARGO', orden: 0,
      cargo: 'ASEADOR', horario: 'Lunes a Domingo · 06:00-14:00',
      cantidadTrabajadores: 4, horasSemanales: 56,
      detalleUnitario: detalle(),
      totalCargo: 3035000 * 4,
    }],
  };
}

afterEach(() => {
  vi.resetModules();
  findUniqueMock.mockReset();
});

describe('POST /api/costos-estructura/[id]/exportar-mano-obra', () => {
  it('29) exige que estructuraCostoId del DTO coincida con el id de la ruta', async () => {
    const { POST } = await import('./route');
    const res = await POST(mkReq({ ...dtoBase(), estructuraCostoId: 999 }), mkCtx('1'));
    expect(res.status).toBe(400);
  }, 15000); // primer test del archivo — la carga en frío de exceljs (import transitivo vía generar-excel-mano-obra.ts) puede tardar más de 5s bajo la suite completa en paralelo.

  it('404 si la estructura no existe', async () => {
    findUniqueMock.mockResolvedValue(null);
    const { POST } = await import('./route');
    const res = await POST(mkReq(dtoBase()), mkCtx('1'));
    expect(res.status).toBe(404);
  });

  it('§2 — 409 GUARDAR_REQUERIDO si Mano de Obra nunca se ha guardado', async () => {
    findUniqueMock.mockResolvedValue({ id: 1, datos: { version: 2, modulos: {} } });
    const { POST } = await import('./route');
    const res = await POST(mkReq(dtoBase()), mkCtx('1'));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('GUARDAR_REQUERIDO');
  });

  it('4) §5-A — 409 CONFLICTO_CONCURRENCIA si la versión enviada no coincide con la persistida', async () => {
    findUniqueMock.mockResolvedValue(registroBase());
    const { POST } = await import('./route');
    const res = await POST(mkReq({ ...dtoBase(), ultimaActualizacionManoObra: '2020-01-01T00:00:00.000Z' }), mkCtx('1'));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('CONFLICTO_CONCURRENCIA');
  });

  it('6) un DTO con valores que no reconcilian es rechazado con 400', async () => {
    findUniqueMock.mockResolvedValue(registroBase());
    const { POST } = await import('./route');
    const malo = dtoBase();
    malo.fichas[0].totalCargo = 1;
    const res = await POST(mkReq(malo), mkCtx('1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('DTO_INVALIDO');
  });

  it('5) una ficha de cargo ajena a la estructura guardada (más fichas que líneas guardadas) es rechazada', async () => {
    findUniqueMock.mockResolvedValue(registroBase()); // solo 1 línea guardada
    const { POST } = await import('./route');
    const conDosFichas = dtoBase();
    conDosFichas.fichas.push({ ...conDosFichas.fichas[0], fichaId: 'f2', cargo: 'TODERO' });
    const res = await POST(mkReq(conDosFichas), mkCtx('1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('FICHA_NO_RECONOCIDA');
  });

  it('Ajuste "DTO_INVALIDO EN MULTIFICHA" — varias fichas TURNANTE no se rechazan solo por exceder cargosTurnantes (grupos de necesidad se recalculan en pantalla, no son 1:1 con líneas ya materializadas)', async () => {
    findUniqueMock.mockResolvedValue({
      id: 1,
      datos: {
        version: 2,
        modulos: {
          manoObra: {
            estado: 'COMPLETADO',
            // 3 lineasExtra guardadas (suficientes para respaldar hasta 3
            // grupos de turnante), pero SOLO 1 registro materializado en
            // cargosTurnantes — antes de la corrección, esto se rechazaba
            // aunque las 3 fichas TURNANTE del DTO fueran legítimas.
            datos: { datosEntrada: { lineasExtra: [{ id: 1 }, { id: 2 }, { id: 3 }], cargosTurnantes: [{ id: 10 }] } },
            ultimaActualizacion: ULTIMA_ACTUALIZACION,
            actualizadoPor: 'admin.qa',
          },
        },
      },
    });
    const { POST } = await import('./route');
    const base = dtoBase();
    const turnante = (fichaId: string) => ({
      fichaId, tipo: 'TURNANTE' as const, orden: 1,
      cargo: 'TURNANTE DE ASEADOR', horario: '06:00-14:00',
      cantidadTrabajadores: 1, horasSemanales: 7,
      detalleUnitario: detalle(),
      totalCargo: 3035000,
      turnante: { coberturaHoras: 7, diasEquivalentes: 1, factorNumerador: 1, factorDenominador: 1, costoReferencia42Horas: 3035000, cantidadTurnantesFisicos: 1 },
    });
    base.fichas.push(turnante('t1'), turnante('t2'), turnante('t3'));
    const res = await POST(mkReq(base), mkCtx('1'));
    expect(res.status).toBe(200);
  });

  it('23/29 — con datos válidos y autorización correcta, devuelve un archivo Excel (200, content-type xlsx, content-disposition attachment)', async () => {
    findUniqueMock.mockResolvedValue(registroBase());
    const { POST } = await import('./route');
    const res = await POST(mkReq(dtoBase()), mkCtx('1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
    expect(res.headers.get('Content-Disposition')).toContain('Mano_de_Obra_SED-LP-2026-0091');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBeGreaterThan(0);
  });

  it('24 — no se modifican otros módulos guardados: el registro se lee, nunca se actualiza (no se llama a costoEstructura.update)', async () => {
    findUniqueMock.mockResolvedValue(registroBase());
    const { POST } = await import('./route');
    await POST(mkReq(dtoBase()), mkCtx('1'));
    expect(findUniqueMock).toHaveBeenCalledTimes(1);
  });
});
