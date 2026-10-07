/**
 * Lote F2D — Bloqueo de edición general para registros sincronizados.
 *
 * PATCH /api/solicitudes rechaza (409, SOLICITUD_SINCRONIZADA_SOLO_LECTURA)
 * cualquier intento de tocar los campos de ORIGEN (entidad, objeto,
 * modalidad, perfil, ciudad, plataforma, fechaCierre, origenSolicitud,
 * contacto, linkDetalle, urlProceso) de una Solicitud cuyo Proceso
 * relacionado NO se clasifique como MANUAL por `determinarOrigenProceso`
 * (reutilizado tal cual de `src/lib/procesos/origen-proceso.ts`, sin
 * lógica duplicada). Política conservadora: sin Proceso relacionado, o
 * clasificación DESCONOCIDA, también bloquea.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { PrismaDb } from '@/lib/solicitudes/crear-solicitud';

interface ProcesoFake {
  id: number;
  sourceKey: string;
  externalId: string | null;
  aliasFuente: string | null;
  fuente: string | null;
  rawJson: string | null;
}

const RAW_FUENTE_HISTORICA = JSON.stringify({
  idContrato: '11833728',
  EntidadContratante: 'Rama Judicial de Cúcuta',
  Objeto: 'Objeto de prueba',
  link: 'https://portal-nc.example/proceso/123',
});

let sesionActual: { id: number; email: string; rol: string; exp: number; sv: number; usuario: string } | null;
let procesos: ProcesoFake[] = [];
let solicitudes: Array<Record<string, unknown>> = [];
let auditLogs: Array<Record<string, unknown>> = [];

function resetFakeDb() {
  procesos = [
    // Proceso manual — sourceKey "manual:" sin identidad externa.
    { id: 900, sourceKey: 'manual:abc-123', externalId: null, aliasFuente: 'NC', fuente: 'Manual', rawJson: null },
    // SECOP II sincronizado — ext: + externalId + aliasFuente S2.
    { id: 901, sourceKey: 'ext:11833728', externalId: '11833728', aliasFuente: 'S2', fuente: 'secop II', rawJson: null },
    // SECOP I sincronizado.
    { id: 902, sourceKey: 'ext:22222', externalId: '22222', aliasFuente: 'S1', fuente: 'secop I', rawJson: null },
    // NC importado de una fuente histórica sincronizada — requiere ext: + externalId + forma de rawJson.
    { id: 903, sourceKey: 'ext:33333', externalId: '33333', aliasFuente: 'NC', fuente: 'fuente-historica', rawJson: RAW_FUENTE_HISTORICA },
    // NC con alias pero SIN firma estructural reconocible → DESCONOCIDO (determinarOrigenProceso ya lo trata así).
    { id: 904, sourceKey: 'ext:44444', externalId: '44444', aliasFuente: 'NC', fuente: 'otra', rawJson: null },
  ];
  solicitudes = [];
  auditLogs = [];
  sesionActual = { id: 5, email: 'dc@grupocolba.com', rol: 'Director Comercial', exp: 9999999999, sv: 1, usuario: 'director.comercial' };
}

function agregarSolicitud(overrides: Record<string, unknown>): number {
  const id = 100 + solicitudes.length;
  solicitudes.push({
    id, entidad: 'Empresa Original', codigoProceso: 'F2D-1', perfil: 'Aseocolba',
    estadoSolicitud: 'Selección de proceso', asignaciones: [],
    emailRegistro: 'admin@grupocolba.com', usuarioRegistro: 'admin.qa',
    aprobador: '', revisor: '', procesoId: null,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  });
  return id;
}

const fakeImpl = {
  proceso: {
    async findUnique({ where }: { where: { id: number } }) {
      return procesos.find((p) => p.id === where.id) ?? null;
    },
  },
  solicitud: {
    async findUnique({ where }: { where: { id: number } }) {
      return solicitudes.find((s) => s.id === where.id) ?? null;
    },
    async update({ where, data }: { where: { id: number }; data: Record<string, unknown> }) {
      const idx = solicitudes.findIndex((s) => s.id === where.id);
      if (idx < 0) throw new Error('No encontrado');
      solicitudes[idx] = { ...solicitudes[idx], ...data };
      return solicitudes[idx];
    },
  },
  user: {
    async findFirst({ where }: { where: { usuario: string } }) {
      if (where.usuario === 'juan.davila') {
        return { id: 7, usuario: 'juan.davila', estado: 'Activo', cargo: 'Analista Comercial', rol: 'Analista Comercial', proceso: 'Comercial', entidadGrupo: 'Aseocolba' };
      }
      return null;
    },
  },
  perfilRol: { async findFirst() { return null; } },
  auditLog: {
    async create({ data }: { data: Record<string, unknown> }) {
      auditLogs.push(data);
      return { id: auditLogs.length, creadoEn: new Date(), ...data };
    },
  },
  async $transaction<T>(cb: (tx: PrismaDb) => Promise<T>): Promise<T> {
    return cb(fakeImpl as unknown as PrismaDb);
  },
};

vi.mock('@/lib/prisma', () => ({ default: fakeImpl }));
vi.mock('@/lib/session', () => ({ getSession: async () => sesionActual }));

function patchReq(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/solicitudes', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

beforeEach(() => { resetFakeDb(); });

describe('F2D — PATCH /api/solicitudes bloquea edición de origen en sincronizados', () => {
  it('SECOP I sincronizado (procesoId=902): PATCH de entidad devuelve 409 SOLICITUD_SINCRONIZADA_SOLO_LECTURA', async () => {
    const id = agregarSolicitud({ procesoId: 902 });
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ id, entidad: 'Nueva entidad' }));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe('SOLICITUD_SINCRONIZADA_SOLO_LECTURA');
    expect(solicitudes.find((s) => s.id === id)?.entidad).toBe('Empresa Original');
  });

  it('SECOP II sincronizado (procesoId=901): PATCH de objeto/modalidad devuelve 409', async () => {
    const id = agregarSolicitud({ procesoId: 901 });
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ id, objeto: 'Objeto nuevo', modalidad: 'Otra modalidad' }));
    expect(res.status).toBe(409);
  });

  it('NC sincronizado de fuente histórica (procesoId=903): PATCH de ciudad devuelve 409', async () => {
    const id = agregarSolicitud({ procesoId: 903 });
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ id, ciudad: 'Otra ciudad' }));
    expect(res.status).toBe(409);
  });

  it('origen DESCONOCIDO (procesoId=904, NC sin evidencia real): PATCH de plataforma devuelve 409 (política conservadora)', async () => {
    const id = agregarSolicitud({ procesoId: 904 });
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ id, plataforma: 'Otra' }));
    expect(res.status).toBe(409);
  });

  it('Solicitud SIN Proceso relacionado (procesoId=null): PATCH de fechaCierre devuelve 409 conservador', async () => {
    const id = agregarSolicitud({ procesoId: null });
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ id, fechaCierre: '2026-08-01' }));
    expect(res.status).toBe(409);
  });

  it('procesoId apunta a un Proceso inexistente: PATCH de origenSolicitud devuelve 409 conservador', async () => {
    const id = agregarSolicitud({ procesoId: 999999 });
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ id, origenSolicitud: 'Especializada' }));
    expect(res.status).toBe(409);
  });

  it('público manual (procesoId=900): PATCH de entidad/objeto FUNCIONA (200)', async () => {
    const id = agregarSolicitud({ procesoId: 900 });
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ id, entidad: 'Entidad corregida', objeto: 'Objeto corregido' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.solicitud.entidad).toBe('Entidad corregida');
  });

  it('Cotización manual (mismo Proceso manual=900): PATCH de contacto FUNCIONA (200)', async () => {
    const id = agregarSolicitud({ procesoId: 900, modalidad: 'Cotización', aliasFuente: 'NC', fuente: 'Manual' });
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ id, nitContacto: '900123456', personaContacto: 'Juan Pérez' }));
    expect(res.status).toBe(200);
  });

  it('Oferta/NC manual (mismo Proceso manual=900) NO se confunde con NC sincronizada — PATCH funciona (200)', async () => {
    const id = agregarSolicitud({ procesoId: 900, modalidad: 'Oferta', aliasFuente: 'NC', fuente: 'Manual', plataforma: 'Contrato privado' });
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ id, plataforma: 'Contrato privado', linkDetalle: 'https://x.com' }));
    expect(res.status).toBe(200);
  });

  it('Administrador tampoco puede editar el origen de un sincronizado por el PATCH genérico', async () => {
    sesionActual = { id: 1, email: 'admin@grupocolba.com', rol: 'admin', exp: 9999999999, sv: 1, usuario: 'admin.qa' };
    const id = agregarSolicitud({ procesoId: 901 });
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ id, entidad: 'Intento de admin' }));
    expect(res.status).toBe(409);
  });

  it('payload mixto (origen + agregarResponsables) sobre sincronizado: rechazo completo, sin escritura parcial', async () => {
    const id = agregarSolicitud({ procesoId: 901 });
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ id, entidad: 'Intento mixto', agregarResponsables: [{ usuario: 'juan.davila' }] }));
    expect(res.status).toBe(409);
    expect((solicitudes.find((s) => s.id === id)?.asignaciones as unknown[])).toEqual([]);
    expect(solicitudes.find((s) => s.id === id)?.entidad).toBe('Empresa Original');
  });

  it('PATCH que NO toca ningún campo de origen (solo agregarResponsables) sobre un sincronizado sigue funcionando normalmente', async () => {
    const id = agregarSolicitud({ procesoId: 901 });
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ id, agregarResponsables: [{ usuario: 'juan.davila' }] }));
    expect(res.status).toBe(200);
  });

  it('campos de identidad del sistema (procesoId/procesoSourceKey/externalId/usuarioRegistro/emailRegistro/sqrNumero) no controlan nada: se ignoran incluso enviados', async () => {
    const id = agregarSolicitud({ procesoId: 900 });
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({
      id, entidad: 'Cambio válido',
      procesoId: 999, procesoSourceKey: 'ext:falso', externalId: 'falso',
      usuarioRegistro: 'suplantador', emailRegistro: 'x@evil.com', sqrNumero: '00000',
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.solicitud.procesoId).toBe(900); // no cambió por el body
  });
});
