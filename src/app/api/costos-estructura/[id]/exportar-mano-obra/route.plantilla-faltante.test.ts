/**
 * Ajuste "EXPORTAR SIN LA PLANTILLA" — con `data/importaciones/` ausente (está
 * en .gitignore), el endpoint respondía un 500 genérico. Aquí se simula que
 * `Mano de obra.xlsx` no existe (independiente de si el equipo la tiene) y se
 * comprueba que la respuesta dice qué falta. El resto de rutas y validaciones
 * del endpoint se cubren en route.test.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { MENSAJE_ERROR_GENERAR_EXCEL } from '@/lib/costos-mano-obra/exportacion/mensajes-exportacion';

vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  const readFile = (async (...args: Parameters<typeof real.readFile>) => {
    if (String(args[0]).includes('Mano de obra.xlsx')) {
      throw Object.assign(new Error("ENOENT: no such file or directory, open 'Mano de obra.xlsx'"), { code: 'ENOENT' });
    }
    return real.readFile(...args);
  }) as typeof real.readFile;
  return { ...real, readFile, default: { ...real, readFile } };
});

const findUniqueMock = vi.fn();
vi.mock('@/lib/prisma', () => ({ default: { costoEstructura: { findUnique: (...args: unknown[]) => findUniqueMock(...args) } } }));
vi.mock('@/lib/session', () => ({
  getSession: async () => ({ id: 1, email: 'admin@grupocolba.com', rol: 'admin', exp: 9999999999, sv: 1, usuario: 'admin.qa' }),
}));

const ULTIMA = '2026-08-06T12:00:00.000Z';
const registro = () => ({
  id: 1,
  datos: { version: 2, modulos: { manoObra: { estado: 'COMPLETADO', datos: { datosEntrada: { lineasExtra: [{ id: 1 }], cargosTurnantes: [] } }, ultimaActualizacion: ULTIMA, actualizadoPor: 'admin.qa' } } },
});
const detalle = () => ({
  salarioBasico: 1750905, bonoPrestacional: 0,
  recargoNocturno: 50000, horaExtraDiurna: 20000, horaExtraNocturna: 15000, dominicalesFestivos: 300000,
  horaExtraFestiva: 10000, horaExtraFestivaNocturna: 5000, recargoNocturnoFestivo: 8000, totalRecargos: 408000,
  auxilioTransporte: 249095, subtotalSalarial: 2408000,
  cesantias: 100000, prima: 100000, vacaciones: 60000, interesesCesantias: 12000, totalPrestaciones: 272000,
  salud: 0, pension: 150000, arl: 30000, totalSeguridadSocial: 180000,
  cajaCompensacion: 80000, sena: 0, icbf: 0, totalParafiscales: 80000,
  dotacion: 40000, epp: 30000, examenes: 5000, cursos: 3000, vacunas: 2000, totalOtrosCostos: 80000,
  bonosNoPrestacionales: 15000, costoLaboralUnitario: 3035000,
});
const dto = () => ({
  estructuraCostoId: 1, procesoId: 1, numeroProceso: 'SED-LP-2026-0091', ultimaActualizacionManoObra: ULTIMA,
  fichas: [{ fichaId: 'f1', tipo: 'CARGO', orden: 0, cargo: 'ASEADOR', horario: 'Lunes a Domingo · 06:00-14:00', cantidadTrabajadores: 4, horasSemanales: 56, detalleUnitario: detalle(), totalCargo: 3035000 * 4 }],
});
const req = (body: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) as unknown as NextRequest;

afterEach(() => { vi.resetModules(); findUniqueMock.mockReset(); });

describe('POST /api/costos-estructura/[id]/exportar-mano-obra — plantilla ausente', () => {
  it('responde 500 con el mensaje genérico "ocurrió un error" (pedido del usuario) y un código corto para soporte — sin exponer archivos ni rutas', async () => {
    findUniqueMock.mockResolvedValue(registro());
    const { POST } = await import('./route');
    const res = await POST(req(dto()), { params: Promise.resolve({ id: '1' }) });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('PLANTILLA_NO_ENCONTRADA');
    expect(body.mensaje).toBe(MENSAJE_ERROR_GENERAR_EXCEL);
    // ni la ruta, ni el nombre del archivo, ni el detalle interno del error llegan al navegador
    const texto = JSON.stringify(body);
    expect(texto).not.toContain('.xlsx');
    expect(texto).not.toContain('data/importaciones');
    expect(texto).not.toMatch(/[A-Z]:\\/);
    expect(texto).not.toContain('ENOENT');
  }, 20000);

  it('el detalle técnico (qué archivo falta) queda en el log del servidor', async () => {
    findUniqueMock.mockResolvedValue(registro());
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { POST } = await import('./route');
    await POST(req(dto()), { params: Promise.resolve({ id: '1' }) });
    expect(String(log.mock.calls.flat().map(String).join(' '))).toContain('data/importaciones/Mano de obra/Mano de obra.xlsx');
    log.mockRestore();
  }, 20000);

  it('las validaciones previas siguen mandando: un DTO inválido se rechaza con 400 antes de tocar la plantilla', async () => {
    findUniqueMock.mockResolvedValue(registro());
    const { POST } = await import('./route');
    const malo = dto();
    malo.fichas[0].totalCargo = 1;
    const res = await POST(req(malo), { params: Promise.resolve({ id: '1' }) });
    expect(res.status).toBe(400);
  }, 20000);
});
