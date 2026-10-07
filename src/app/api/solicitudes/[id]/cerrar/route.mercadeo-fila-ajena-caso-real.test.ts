/**
 * Ajuste "CIERRE DE PRIVADOS PARA MERCADEO — FILA AJENA" — reproducción del
 * CASO REAL reportado: proceso Privado, estado Presentado, Mercadeo sin
 * asignación propia, existe una fila presentada de otro responsable,
 * selecciona Adjudicado, escribe observación, pulsa "Finalizar proceso".
 *
 * A diferencia de `route.permisos-alias-fuente.test.ts` (que construye el
 * payload directamente), este test conecta las DOS capas reales que
 * intervinieron en el bug: primero `seleccionarAsignacionVisible`
 * (frontend — decide qué `idAsignacion` existe) y luego el payload
 * resultante se envía tal cual al endpoint real `POST .../cerrar`
 * (backend — autoriza y persiste). Antes del fix: `idAsignacion` salía
 * vacío del paso 1, y el endpoint rechazaba con 400 ("deben enviarse
 * juntos"). Después del fix: el paso 1 entrega el id real de la fila
 * PRESENTADA, y el endpoint la acepta.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { seleccionarAsignacionVisible } from '@/lib/solicitudes/seleccion-asignacion';

interface UsuarioFake { id: number; usuario: string; email: string; rol: string; estado: string; }
const MERCADEO: UsuarioFake = { id: 201, usuario: 'ana.rios', email: 'ana.rios@grupocolba.com', rol: 'Analista Mercadeo', estado: 'Activo' };

// La fila PRESENTADA existente, de OTRO responsable (Comercial) — Mercadeo
// nunca tuvo fila propia en este proceso.
const filaPresentadaDeOtroResponsable = {
  idAsignacion: 'ASG-777', analistaAsignado: 'oscar.pallares', asignadoPor: 'laura.buelvas',
  fechaAsignacion: '2026-01-01 08:00:00', estadoRevision: 'PRESENTADO', observaciones: [],
};

let solicitud: Record<string, unknown>;
let sesionActual: { id: number; email: string; rol: string; usuario: string };

function resetFixture() {
  solicitud = {
    id: 900, estadoSolicitud: 'En evaluación', resultadoFinal: null, causalCierre: null,
    aliasFuente: 'NC', // Privado determinado — mismo criterio que el resto de la suite
    fechaCierre: new Date('2026-09-01T00:00:00.000Z'),
    sqrNumero: null, sqrCerrada: false, sqrError: null,
    procesoId: 9090,
    asignaciones: [filaPresentadaDeOtroResponsable],
  };
  sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => 'SQR no disponible en pruebas' })));
}

const fakeImpl = {
  user: {
    async findUnique({ where }: { where: { id?: number; email?: string } }) {
      if (where.id != null) return where.id === MERCADEO.id ? MERCADEO : null;
      if (where.email != null) return where.email === MERCADEO.email ? MERCADEO : null;
      return null;
    },
  },
  solicitud: {
    async findUnique({ where }: { where: { id: number } }) {
      return where.id === solicitud.id ? JSON.parse(JSON.stringify(solicitud)) : null;
    },
    async updateMany({ where, data }: { where: { id: number; estadoSolicitud?: { notIn: string[] } }; data: Record<string, unknown> }) {
      if (where.id !== solicitud.id) return { count: 0 };
      const estadoActual = String(solicitud.estadoSolicitud);
      if (where.estadoSolicitud?.notIn?.includes(estadoActual)) return { count: 0 };
      solicitud = { ...solicitud, ...data };
      return { count: 1 };
    },
  },
  auditLog: { async create({ data }: { data: Record<string, unknown> }) { return { id: 1, ...data }; } },
  async $queryRaw() { return []; },
  async $transaction<T>(cb: (tx: any) => Promise<T>): Promise<T> { return cb(fakeImpl); },
};

vi.mock('@/lib/prisma', () => ({ default: fakeImpl }));
vi.mock('@/lib/session', () => ({ getSession: async () => sesionActual }));

function req(body: unknown) {
  return new NextRequest('http://localhost/api/solicitudes/900/cerrar', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
function ctx() { return { params: Promise.resolve({ id: '900' }) }; }

describe('CASO REAL — Mercadeo cierra Privado Presentado sobre fila ajena (frontend + backend)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('paso 1 (frontend): seleccionarAsignacionVisible entrega la fila PRESENTADA real, nunca idAsignacion vacío', () => {
    const seleccion = seleccionarAsignacionVisible(
      solicitud?.asignaciones as typeof filaPresentadaDeOtroResponsable[] ?? [filaPresentadaDeOtroResponsable],
      { email: MERCADEO.email, usuario: MERCADEO.usuario, rol: MERCADEO.rol },
      null,
    );
    expect(seleccion.asigActual).toEqual(filaPresentadaDeOtroResponsable);
    expect(seleccion.asigActual?.idAsignacion).toBe('ASG-777');
  });

  it('paso 2 (backend, con el idAsignacion real del paso 1): Adjudicado + observación → sin 400, sin 403, cerrado, persistido', async () => {
    resetFixture();
    const seleccion = seleccionarAsignacionVisible(
      solicitud.asignaciones as typeof filaPresentadaDeOtroResponsable[],
      { email: MERCADEO.email, usuario: MERCADEO.usuario, rol: MERCADEO.rol },
      null,
    );
    const idAsignacion = String(seleccion.asigActual?.idAsignacion ?? '');
    expect(idAsignacion).toBe('ASG-777'); // nunca ''

    const payload = {
      resultadoEstado: 'Cerrada',
      idAsignacion,
      filaExtra: {
        estadoRevision: 'CERRADO_ADJUDICADO',
        resultadoFinal: 'Adjudicado',
        observacionResultado: 'El único proponente habilitado cumplió todos los requisitos técnicos y financieros.',
      },
    };

    const { POST } = await import('./route');
    const res = await POST(req(payload), ctx());
    const data = await res.json();

    expect(res.status).not.toBe(400);
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);

    expect(solicitud.estadoSolicitud).toBe('Cerrada');
    expect(solicitud.resultadoFinal).toBe('Adjudicado');

    const asigs = solicitud.asignaciones as Record<string, unknown>[];
    const filaFinal = asigs.find((a) => a.idAsignacion === 'ASG-777')!;
    expect(filaFinal.estadoRevision).toBe('CERRADO_ADJUDICADO');
    expect(filaFinal.resultadoFinal).toBe('Adjudicado');
    expect(filaFinal.observacionResultado).toBe('El único proponente habilitado cumplió todos los requisitos técnicos y financieros.');
    // La fila sigue perteneciendo al responsable original — Mercadeo nunca se atribuye la asignación.
    expect(filaFinal.analistaAsignado).toBe('oscar.pallares');
    expect(filaFinal.cerradoPor).toBe(MERCADEO.usuario);
  });
});
