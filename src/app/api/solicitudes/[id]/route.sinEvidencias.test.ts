/**
 * Ajuste "SEGUIMIENTO — MERCADEO" — verifica que `GET /api/solicitudes/[id]?sinEvidencias=true`
 * (la ruta liviana usada por la ficha para pintar "Responsables asignados"
 * y el resto del detalle, incluyendo `observacionesSeguimiento`) sigue
 * respondiendo 200 con la columna nueva ya migrada — regresión directa del
 * incidente real donde este mismo endpoint devolvía 500 ("column does not
 * exist") mientras la migración no estaba aplicada.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

interface UsuarioFake { id: number; usuario: string; email: string; rol: string; estado: string; }
const ADMIN: UsuarioFake = { id: 1, usuario: 'admin1', email: 'admin1@grupocolba.com', rol: 'Administrador', estado: 'Activo' };

let solicitud: Record<string, unknown> | null;
let sesionActual: { id: number; email: string; rol: string; usuario: string };

function resetFixture(observacionesSeguimiento: unknown = []) {
  solicitud = {
    id: 700, procesoId: null, procesoSourceKey: null, externalId: null,
    codigoProceso: 'IMC-2026-700', nombreProceso: 'Contratación de vigilancia', entidad: 'Cruz Roja Colombiana', objeto: 'Vigilancia',
    fuente: 'Manual', aliasFuente: 'NC', modalidad: 'Contratación directa', perfil: 'Vigilancia',
    departamento: 'Bogotá', ciudad: 'Bogotá D.C.', sede: null, plataforma: null,
    estadoSolicitud: 'Presentado', estadoFuente: null, origenSolicitud: 'Comercial',
    fechaPublicacion: null, fechaVencimiento: null, fechaCierre: null,
    valor: null, linkDetalle: null, linkSecop: null, linkSecopReg: null,
    sqrNumero: '274379', sqrCreada: true, sqrCerrada: false, sqrError: null,
    fechaAperturaSqr: null, fechaCierreSqr: null, fechaEntregaInfo: null,
    asignaciones: [{ idAsignacion: 'ASG-1', analistaAsignado: 'andrea.calderin', analistaCargo: 'Analista Senior Mercadeo', estadoRevision: 'PRESENTADO' }],
    revisor: null, aprobador: null, observacion: null,
    resultadoFinal: null, causalCierre: null, usuarioRegistro: 'andrea.calderin',
    emailRegistro: 'andrea.calderin@grupocolba.com', cargoRegistro: 'Analista Senior Mercadeo', entidadRegistro: null,
    nitContacto: null, personaContacto: null, telefonoContacto: null,
    direccionContacto: null, correoContacto: null, procStep: 6,
    createdAt: new Date('2026-07-28T11:49:00.000Z'), updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    // Ajuste "SEGUIMIENTO — MERCADEO" — la columna real, ya migrada.
    observacionesSeguimiento,
  };
  sesionActual = { id: ADMIN.id, email: ADMIN.email, rol: ADMIN.rol, usuario: ADMIN.usuario };
}

const fakeImpl = {
  user: {
    async findUnique({ where }: { where: { id?: number; email?: string } }) {
      if (where.id != null) return where.id === ADMIN.id ? ADMIN : null;
      if (where.email != null) return where.email === ADMIN.email ? ADMIN : null;
      return null;
    },
  },
  solicitud: {
    // Réplica de Prisma real: `select` filtra las claves devueltas — así el
    // test detecta si el código pide una columna que Prisma real rechazaría.
    async findUnique({ where, select }: { where: { id: number }; select?: Record<string, boolean> }) {
      if (!solicitud || where.id !== solicitud.id) return null;
      if (!select) return JSON.parse(JSON.stringify(solicitud));
      const out: Record<string, unknown> = {};
      for (const clave of Object.keys(select)) {
        if (select[clave]) out[clave] = (solicitud as Record<string, unknown>)[clave];
      }
      return JSON.parse(JSON.stringify(out));
    },
  },
};

vi.mock('@/lib/prisma', () => ({ default: fakeImpl }));
vi.mock('@/lib/session', () => ({ getSession: async () => sesionActual }));

function req(qs = '?sinEvidencias=true') {
  return new NextRequest(`http://localhost/api/solicitudes/700${qs}`);
}
function ctx() { return { params: Promise.resolve({ id: '700' }) }; }

describe('GET /api/solicitudes/[id]?sinEvidencias=true — regresión del incidente "RESPONSABLES ASIGNADOS"', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('(1) responde 200, nunca 500 por columna inexistente', async () => {
    resetFixture();
    const { GET } = await import('./route');
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
  });

  it('(2) incluye asignaciones — "Responsables asignados" puede pintarse', async () => {
    resetFixture();
    const { GET } = await import('./route');
    const res = await GET(req(), ctx());
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.solicitud.asignaciones)).toBe(true);
    expect(data.solicitud.asignaciones.length).toBe(1);
    expect(data.solicitud.asignaciones[0].analistaAsignado).toBe('andrea.calderin');
  });

  it('incluye observacionesSeguimiento en la respuesta liviana', async () => {
    resetFixture([{ id: 'a1', texto: 'nota', creadoEn: '2026-08-25 15:00:00', creadoPor: 'ana.rios', rol: 'Analista Mercadeo' }]);
    const { GET } = await import('./route');
    const res = await GET(req(), ctx());
    const data = await res.json();
    expect(Array.isArray(data.solicitud.observacionesSeguimiento)).toBe(true);
    expect(data.solicitud.observacionesSeguimiento.length).toBe(1);
  });

  it('(11) solicitud histórica con observacionesSeguimiento=[] responde 200 sin romper', async () => {
    resetFixture([]);
    const { GET } = await import('./route');
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.solicitud.observacionesSeguimiento).toEqual([]);
  });

  it('solicitud no encontrada → 404, no 500', async () => {
    resetFixture();
    const { GET } = await import('./route');
    const res = await GET(req(), { params: Promise.resolve({ id: '999999' }) });
    expect(res.status).toBe(404);
  });
});
