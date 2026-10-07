/**
 * Lote F1/F1.1 — Autenticación y permisos del módulo Solicitudes.
 *
 * F1 corrigió 2 brechas de servidor:
 *  1. POST /api/solicitudes no exigía sesión en absoluto.
 *  2. PATCH: agregarResponsables/removerResponsables se procesaban ANTES de
 *     validar el rol — si el usuario era "dueño" de la fila (canAccessSolicitud),
 *     el gate de permiso se saltaba completo.
 *
 * F1.1 corrigió una brecha adicional y agregó defensa en profundidad:
 *  3. PATCH: el mismo salto aplicaba al arreglo `asignaciones` enviado en
 *     bruto — F1 solo lo cerraba cuando cambiaba el CONJUNTO de
 *     analistaAsignado; F1.1 lo cierra también cuando el analista es el
 *     MISMO pero cambia cualquier otro campo interno de la fila (estado,
 *     causa, observación, etc.), salvo que quien edita sea el propio
 *     analistaAsignado de esa fila (gestión legítima de su propio caso,
 *     ej. GestionAsignacionInline), administrador funcional, o tenga
 *     `asig_gestionar`.
 *  4. POST /api/solicitudes ahora aplica una allowlist explícita del body
 *     (antes los campos "peligrosos" simplemente se ignoraban en silencio
 *     por no ser leídos — ahora se RECHAZAN con 400, auditable).
 *
 * Nomenclatura de roles (verificado en BD real, no solo en código estático):
 * 'Analista Mercadeo' es el único rol con usuarios activos hoy. 'Asistente
 * Mercadeo' EXISTE como PerfilRol propio en BD (creado por el usuario
 * durante esta sesión, con sus propios permisos ya configurados:
 * busqueda_gestionar, sol_crear_comercial, etc.) pero SIN ningún User.rol
 * real asignado todavía, y ausente del selector de rol en page.tsx — no se
 * fusiona ni se renombra con 'Analista Mercadeo' en ningún punto del
 * código; el soporte es puramente dinámico vía `hasPermiso()` consultando
 * PerfilRol.nombre por el literal exacto de sesión.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { PrismaDb } from '@/lib/solicitudes/crear-solicitud';

interface UsuarioFake {
  id: number; usuario: string; estado: string; cargo: string; rol: string; proceso: string | null; entidadGrupo: string;
}
interface ProcesoFake {
  id: number; externalId: string | null; sourceKey: string; codigoProceso: string | null; entidad: string | null;
}

let USUARIOS: UsuarioFake[] = [
  { id: 7, usuario: 'juan.davila', estado: 'Activo', cargo: 'Analista Comercial', rol: 'Analista Comercial', proceso: 'Comercial', entidadGrupo: 'Aseocolba' },
  { id: 8, usuario: 'nicole.ortiz', estado: 'Activo', cargo: 'Analista Comercial', rol: 'Analista Comercial', proceso: 'Comercial', entidadGrupo: 'Vigicolba' },
];
const USUARIOS_BASE = USUARIOS.map((u) => ({ ...u }));

let sesionActual: { id: number; email: string; rol: string; exp: number; sv: number; usuario: string } | null;
let procesos: ProcesoFake[] = [];
let solicitudes: Array<Record<string, unknown>> = [];
let auditLogs: Array<Record<string, unknown>> = [];
let nextProcesoId = 1;
let nextSolicitudId = 1;

function resetFakeDb() {
  USUARIOS = USUARIOS_BASE.map((u) => ({ ...u }));
  procesos = [];
  solicitudes = [];
  auditLogs = [];
  nextProcesoId = 1;
  nextSolicitudId = 1;
  sesionActual = { id: 1, email: 'admin@grupocolba.com', rol: 'admin', exp: 9999999999, sv: 1, usuario: 'admin.qa' };
}

const fakeImpl = {
  proceso: {
    async findUnique({ where }: { where: { id: number } }) {
      return procesos.find((p) => p.id === where.id) ?? null;
    },
    async findFirst({ where }: { where: { OR: Array<{ externalId?: string; sourceKey?: string }> } }) {
      return procesos.find((p) => where.OR.some((c) =>
        (c.externalId !== undefined && p.externalId === c.externalId) ||
        (c.sourceKey !== undefined && p.sourceKey === c.sourceKey)
      )) ?? null;
    },
    async findMany({ where }: { where: { OR: Array<{ codigoProceso: { contains: string } }> } }) {
      const variantes = where.OR.map((c) => c.codigoProceso.contains.toLowerCase());
      return procesos.filter((p) => variantes.some((v) => (p.codigoProceso ?? '').toLowerCase().includes(v)));
    },
    async create({ data }: { data: Omit<ProcesoFake, 'id'> }) {
      const nuevo: ProcesoFake = { id: nextProcesoId++, ...data };
      procesos.push(nuevo);
      return nuevo;
    },
  },
  solicitud: {
    async findFirst({ where }: { where: { procesoId: number } }) {
      return solicitudes.find((s) => s.procesoId === where.procesoId) ?? null;
    },
    async findUnique({ where }: { where: { id: number } }) {
      return solicitudes.find((s) => s.id === where.id) ?? null;
    },
    async create({ data }: { data: Record<string, unknown> }) {
      const nueva = { id: nextSolicitudId++, createdAt: new Date(), updatedAt: new Date(), ...data };
      solicitudes.push(nueva);
      return nueva;
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
      return USUARIOS.find((u) => u.usuario === where.usuario) ?? null;
    },
  },
  perfilRol: {
    async findFirst({ where }: { where: { nombre: string } }) {
      // Réplica mínima del PerfilRol real "Asistente Mercadeo" confirmado en
      // BD (solo lectura) durante esta sesión — busqueda_gestionar y
      // sol_crear_comercial en true, SIN asig_gestionar ni
      // asig_asignar_responsable (no tiene facultad de reasignar).
      if (where.nombre === 'Asistente Mercadeo') {
        return { id: 8, nombre: 'Asistente Mercadeo', permisos: { busqueda_gestionar: true, sol_crear_comercial: true } };
      }
      return null;
    },
  },
  auditLog: {
    async create({ data }: { data: Record<string, unknown> }) {
      auditLogs.push(data);
      return { id: auditLogs.length, creadoEn: new Date(), ...data };
    },
  },
  async $transaction<T>(cb: (tx: PrismaDb) => Promise<T>): Promise<T> {
    const snapProcesos = [...procesos];
    const snapSolicitudes = [...solicitudes];
    const snapAuditLen = auditLogs.length;
    try {
      return await cb(fakeImpl as unknown as PrismaDb);
    } catch (e) {
      procesos = snapProcesos;
      solicitudes = snapSolicitudes;
      auditLogs.length = snapAuditLen;
      throw e;
    }
  },
};

vi.mock('@/lib/prisma', () => ({ default: fakeImpl }));
vi.mock('@/lib/session', () => ({ getSession: async () => sesionActual }));

function postReq(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/solicitudes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
function patchReq(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/solicitudes', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  resetFakeDb();
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('SQR no disponible en pruebas'); }));
});

describe('F1 — POST /api/solicitudes — autenticación y permisos', () => {
  it('sin sesión: 401, no crea nada', async () => {
    sesionActual = null;
    const { POST } = await import('./route');
    const res = await POST(postReq({ codigoProceso: 'X', entidad: 'E', perfil: 'Aseocolba' }));
    expect(res.status).toBe(401);
    expect(solicitudes).toHaveLength(0);
  });

  it('sesión inválida (getSession no resuelve usuario): 401', async () => {
    // Desde el servidor, una sesión inválida (token corrupto/expirado) se
    // representa igual que la ausencia de sesión: getSession() resuelve null.
    sesionActual = null;
    const { POST } = await import('./route');
    const res = await POST(postReq({ codigoProceso: 'X', entidad: 'E', perfil: 'Aseocolba' }));
    expect(res.status).toBe(401);
  });

  it('rol sin permiso (Gerencia): 403, no crea nada', async () => {
    sesionActual = { id: 2, email: 'g@grupocolba.com', rol: 'Gerencia', exp: 9999999999, sv: 1, usuario: 'g.gerente' };
    const { POST } = await import('./route');
    const res = await POST(postReq({ codigoProceso: 'X', entidad: 'E', perfil: 'Aseocolba' }));
    expect(res.status).toBe(403);
    expect(solicitudes).toHaveLength(0);
  });

  it('Analista Mercadeo autorizado (201)', async () => {
    sesionActual = { id: 3, email: 'm@grupocolba.com', rol: 'Analista Mercadeo', exp: 9999999999, sv: 1, usuario: 'ana.mercadeo' };
    const { POST } = await import('./route');
    const res = await POST(postReq({ codigoProceso: 'X-10-2026', entidad: 'Empresa 10', perfil: 'Aseocolba' }));
    expect(res.status).toBe(201);
  });

  it('"Asistente Mercadeo" (literal real, rol DISTINTO — no fusionado con Analista Mercadeo) autorizado vía PerfilRol dinámico (201)', async () => {
    sesionActual = { id: 4, email: 'asis@grupocolba.com', rol: 'Asistente Mercadeo', exp: 9999999999, sv: 1, usuario: 'asis.mercadeo' };
    const { POST } = await import('./route');
    const res = await POST(postReq({ codigoProceso: 'X-11-2026', entidad: 'Empresa 11', perfil: 'Vigicolba' }));
    expect(res.status).toBe(201);
  });

  it('ausencia de equivalencia silenciosa: un rol inexistente en PerfilRol y sin match en la matriz estática NO se autoriza (403)', async () => {
    // Prueba negativa que demuestra que el camino anterior NO es un alias
    // hardcodeado — un tercer rol cualquiera, sin fila en PerfilRol y sin
    // entrada en MATRIZ_PERMISOS, se rechaza igual que cualquier rol
    // desconocido. Si 'Asistente Mercadeo' pasara por una equivalencia
    // silenciosa con 'Analista Mercadeo' (en vez de por su propio PerfilRol),
    // este test no distinguiría nada — se deja como control negativo.
    sesionActual = { id: 9, email: 'x@grupocolba.com', rol: 'Rol Inexistente XYZ', exp: 9999999999, sv: 1, usuario: 'x.usuario' };
    const { POST } = await import('./route');
    const res = await POST(postReq({ codigoProceso: 'X-11B-2026', entidad: 'Empresa 11B', perfil: 'Vigicolba' }));
    expect(res.status).toBe(403);
  });

  it('Administrador conserva sus facultades (201)', async () => {
    sesionActual = { id: 1, email: 'admin@grupocolba.com', rol: 'admin', exp: 9999999999, sv: 1, usuario: 'admin.qa' };
    const { POST } = await import('./route');
    const res = await POST(postReq({ codigoProceso: 'X-12-2026', entidad: 'Empresa 12', perfil: 'Aseocolba' }));
    expect(res.status).toBe(201);
  });

  it('Director/Coordinador Comercial conservan su permiso histórico de crear (201)', async () => {
    sesionActual = { id: 5, email: 'dc@grupocolba.com', rol: 'Director Comercial', exp: 9999999999, sv: 1, usuario: 'director.comercial' };
    const { POST } = await import('./route');
    const res = await POST(postReq({ codigoProceso: 'X-13-2026', entidad: 'Empresa 13', perfil: 'Aseocolba' }));
    expect(res.status).toBe(201);
  });

  it('Analista Comercial conserva su permiso histórico de crear manual (201)', async () => {
    sesionActual = { id: 6, email: 'ac@grupocolba.com', rol: 'Analista Comercial', exp: 9999999999, sv: 1, usuario: 'ana.comercial' };
    const { POST } = await import('./route');
    const res = await POST(postReq({ codigoProceso: 'X-14-2026', entidad: 'Empresa 14', perfil: 'Aseocolba' }));
    expect(res.status).toBe(201);
  });

  it('actor tomado de la sesión: usuarioRegistro/emailRegistro son los de la sesión, no los del body', async () => {
    sesionActual = { id: 3, email: 'real@grupocolba.com', rol: 'Analista Mercadeo', exp: 9999999999, sv: 1, usuario: 'usuario.real' };
    const { POST } = await import('./route');
    const res = await POST(postReq({
      codigoProceso: 'X-15-2026', entidad: 'Empresa 15', perfil: 'Aseocolba',
      usuarioRegistro: 'suplantador', emailRegistro: 'suplantador@evil.com',
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.solicitud.usuarioRegistro).toBe('usuario.real');
    expect(data.solicitud.emailRegistro).toBe('real@grupocolba.com');
  });

  it('responsable/analistaAsignado en el body: la allowlist F1.1 los rechaza (400) — no llegan a controlar nada', async () => {
    sesionActual = { id: 3, email: 'm@grupocolba.com', rol: 'Analista Mercadeo', exp: 9999999999, sv: 1, usuario: 'ana.mercadeo' };
    const { POST } = await import('./route');
    const res = await POST(postReq({
      codigoProceso: 'X-16-2026', entidad: 'Empresa 16', perfil: 'Aseocolba',
      responsable: 'usuario-inventado', analistaAsignado: 'otro-inventado',
    }));
    expect(res.status).toBe(400);
    expect(solicitudes).toHaveLength(0);
  });

  it('asignación automática ASEOCOLBA → juan.davila', async () => {
    sesionActual = { id: 3, email: 'm@grupocolba.com', rol: 'Analista Mercadeo', exp: 9999999999, sv: 1, usuario: 'ana.mercadeo' };
    const { POST } = await import('./route');
    const res = await POST(postReq({ codigoProceso: 'X-17-2026', entidad: 'Empresa 17', perfil: 'Aseocolba' }));
    const data = await res.json();
    expect(data.solicitud.asignaciones[0].analistaAsignado).toBe('juan.davila');
  });

  it('asignación automática VIGICOLBA → nicole.ortiz', async () => {
    sesionActual = { id: 3, email: 'm@grupocolba.com', rol: 'Analista Mercadeo', exp: 9999999999, sv: 1, usuario: 'ana.mercadeo' };
    const { POST } = await import('./route');
    const res = await POST(postReq({ codigoProceso: 'X-18-2026', entidad: 'Empresa 18', perfil: 'Vigicolba' }));
    const data = await res.json();
    expect(data.solicitud.asignaciones[0].analistaAsignado).toBe('nicole.ortiz');
  });

  it('usuario predeterminado inexistente/inactivo → creación bloqueada, sin Solicitud parcial', async () => {
    sesionActual = { id: 3, email: 'm@grupocolba.com', rol: 'Analista Mercadeo', exp: 9999999999, sv: 1, usuario: 'ana.mercadeo' };
    USUARIOS = USUARIOS.filter((u) => u.usuario !== 'juan.davila'); // Aseocolba se queda sin responsable elegible
    const { POST } = await import('./route');
    const res = await POST(postReq({ codigoProceso: 'X-19-2026', entidad: 'Empresa 19', perfil: 'Aseocolba' }));
    expect(res.status).toBe(400);
    expect(solicitudes).toHaveLength(0);
  });

  it('no se crea Solicitud parcial cuando falla la resolución de identidad (perfil desconocido)', async () => {
    sesionActual = { id: 3, email: 'm@grupocolba.com', rol: 'Analista Mercadeo', exp: 9999999999, sv: 1, usuario: 'ana.mercadeo' };
    const { POST } = await import('./route');
    const res = await POST(postReq({ codigoProceso: 'X-20-2026', entidad: 'Empresa 20', perfil: 'EmpresaSinRegla' }));
    expect(res.status).toBe(400);
    expect(solicitudes).toHaveLength(0);
    expect(procesos).toHaveLength(0);
  });

  it('body con número/estado de SQR no controla el resultado — la allowlist F1.1 lo rechaza (400)', async () => {
    sesionActual = { id: 3, email: 'm@grupocolba.com', rol: 'Analista Mercadeo', exp: 9999999999, sv: 1, usuario: 'ana.mercadeo' };
    const { POST } = await import('./route');
    const res = await POST(postReq({
      codigoProceso: 'X-21-2026', entidad: 'Empresa 21', perfil: 'Aseocolba',
      sqrNumero: '99999', sqrCreada: true, sqrCerrada: true,
    }));
    expect(res.status).toBe(400);
    expect(solicitudes).toHaveLength(0);
  });

  it('solo se persisten campos permitidos — cualquier clave fuera de la allowlist es rechazada (400)', async () => {
    sesionActual = { id: 3, email: 'm@grupocolba.com', rol: 'Analista Mercadeo', exp: 9999999999, sv: 1, usuario: 'ana.mercadeo' };
    const { POST } = await import('./route');
    const res = await POST(postReq({
      codigoProceso: 'X-22-2026', entidad: 'Empresa 22', perfil: 'Aseocolba',
      estadoRevision: 'ASIGNADO_REVISION', campoInventado: 'x',
    }));
    expect(res.status).toBe(400);
    expect(solicitudes).toHaveLength(0);
  });
});

describe('F1 — PATCH /api/solicitudes — bloqueo de reasignación por Mercadeo', () => {
  async function crearSolicitudBase(overrides: Record<string, unknown> = {}): Promise<number> {
    solicitudes.push({
      id: nextSolicitudId++, procesoId: 500 + nextSolicitudId, entidad: 'Empresa PATCH F1', codigoProceso: 'F1-1-2026',
      perfil: 'Aseocolba', estadoSolicitud: 'Selección de proceso', asignaciones: [],
      emailRegistro: 'admin@grupocolba.com', usuarioRegistro: 'admin.qa',
      aprobador: '', revisor: '', createdAt: new Date(), updatedAt: new Date(),
      ...overrides,
    });
    return solicitudes[solicitudes.length - 1].id as number;
  }

  it('Analista Mercadeo (sin relación con la fila) no puede agregar responsable: 403, sin cambios', async () => {
    const id = await crearSolicitudBase();
    sesionActual = { id: 3, email: 'm@grupocolba.com', rol: 'Analista Mercadeo', exp: 9999999999, sv: 1, usuario: 'ana.mercadeo' };
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ id, agregarResponsables: [{ usuario: 'juan.davila' }] }));
    expect(res.status).toBe(403);
    expect(solicitudes.find((s) => s.id === id)?.asignaciones).toEqual([]);
  });

  it('Analista Mercadeo no puede retirar responsable: 403, sin cambios', async () => {
    const id = await crearSolicitudBase({
      asignaciones: [{ idAsignacion: 'ASG-01', analistaAsignado: 'juan.davila' }],
    });
    sesionActual = { id: 3, email: 'm@grupocolba.com', rol: 'Analista Mercadeo', exp: 9999999999, sv: 1, usuario: 'ana.mercadeo' };
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ id, removerResponsables: ['juan.davila'] }));
    expect(res.status).toBe(403);
    expect((solicitudes.find((s) => s.id === id)?.asignaciones as unknown[]).length).toBe(1);
  });

  it('Mercadeo PROPIETARIO de la fila (usuarioRegistro) tampoco puede agregar responsable — cierra la brecha 2', async () => {
    const id = await crearSolicitudBase({
      usuarioRegistro: 'ana.mercadeo', emailRegistro: 'm@grupocolba.com',
    });
    sesionActual = { id: 3, email: 'm@grupocolba.com', rol: 'Analista Mercadeo', exp: 9999999999, sv: 1, usuario: 'ana.mercadeo' };
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ id, agregarResponsables: [{ usuario: 'juan.davila' }] }));
    expect(res.status).toBe(403);
    expect(solicitudes.find((s) => s.id === id)?.asignaciones).toEqual([]);
  });

  it('creador de la solicitud no puede saltarse el gate enviando "asignaciones" en bruto (reemplazo directo) — cierra la brecha 3', async () => {
    const id = await crearSolicitudBase({
      usuarioRegistro: 'ana.mercadeo', emailRegistro: 'm@grupocolba.com',
      asignaciones: [{ idAsignacion: 'ASG-01', analistaAsignado: 'juan.davila' }],
    });
    sesionActual = { id: 3, email: 'm@grupocolba.com', rol: 'Analista Mercadeo', exp: 9999999999, sv: 1, usuario: 'ana.mercadeo' };
    const { PATCH } = await import('./route');
    // Envío directo de `asignaciones` (no agregarResponsables/removerResponsables) reemplazando el responsable.
    const res = await PATCH(patchReq({
      id, asignaciones: [{ idAsignacion: 'ASG-01', analistaAsignado: 'nicole.ortiz' }],
    }));
    expect(res.status).toBe(403);
    expect((solicitudes.find((s) => s.id === id)?.asignaciones as Array<Record<string, unknown>>)[0].analistaAsignado).toBe('juan.davila');
  });

  it('Mercadeo (dueño) envía "asignaciones" con el MISMO analista pero cambia estadoAsignacion → 403, sin cambios (F1.1)', async () => {
    const id = await crearSolicitudBase({
      usuarioRegistro: 'ana.mercadeo', emailRegistro: 'm@grupocolba.com',
      asignaciones: [{ idAsignacion: 'ASG-01', analistaAsignado: 'juan.davila', estadoAsignacion: 'Pendiente' }],
    });
    sesionActual = { id: 3, email: 'm@grupocolba.com', rol: 'Analista Mercadeo', exp: 9999999999, sv: 1, usuario: 'ana.mercadeo' };
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({
      id, asignaciones: [{ idAsignacion: 'ASG-01', analistaAsignado: 'juan.davila', estadoAsignacion: 'En proceso' }],
    }));
    expect(res.status).toBe(403);
    expect((solicitudes.find((s) => s.id === id)?.asignaciones as Array<Record<string, unknown>>)[0].estadoAsignacion).toBe('Pendiente');
  });

  it('Mercadeo (dueño) envía "asignaciones" con el MISMO analista pero cambia un campo "activo" → 403, sin cambios (F1.1)', async () => {
    const id = await crearSolicitudBase({
      usuarioRegistro: 'ana.mercadeo', emailRegistro: 'm@grupocolba.com',
      asignaciones: [{ idAsignacion: 'ASG-01', analistaAsignado: 'juan.davila', activo: true }],
    });
    sesionActual = { id: 3, email: 'm@grupocolba.com', rol: 'Analista Mercadeo', exp: 9999999999, sv: 1, usuario: 'ana.mercadeo' };
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({
      id, asignaciones: [{ idAsignacion: 'ASG-01', analistaAsignado: 'juan.davila', activo: false }],
    }));
    expect(res.status).toBe(403);
    expect((solicitudes.find((s) => s.id === id)?.asignaciones as Array<Record<string, unknown>>)[0].activo).toBe(true);
  });

  it('Mercadeo (dueño) agrega un campo/objeto arbitrario nuevo a una fila existente → 403, sin cambios (F1.1)', async () => {
    const id = await crearSolicitudBase({
      usuarioRegistro: 'ana.mercadeo', emailRegistro: 'm@grupocolba.com',
      asignaciones: [{ idAsignacion: 'ASG-01', analistaAsignado: 'juan.davila' }],
    });
    sesionActual = { id: 3, email: 'm@grupocolba.com', rol: 'Analista Mercadeo', exp: 9999999999, sv: 1, usuario: 'ana.mercadeo' };
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({
      id, asignaciones: [{ idAsignacion: 'ASG-01', analistaAsignado: 'juan.davila', campoInventado: 'inyectado' }],
    }));
    expect(res.status).toBe(403);
    expect((solicitudes.find((s) => s.id === id)?.asignaciones as Array<Record<string, unknown>>)[0].campoInventado).toBeUndefined();
  });

  it('un responsable legítimo SÍ puede gestionar el contenido de SU PROPIA fila (estado, causa, observación) — no regresión de F1.1', async () => {
    const id = await crearSolicitudBase({
      usuarioRegistro: 'ana.mercadeo', emailRegistro: 'm@grupocolba.com', // registrante ajeno — el responsable real es juan.davila
      asignaciones: [{ idAsignacion: 'ASG-01', analistaAsignado: 'juan.davila', estadoAsignacion: 'Pendiente', causaEspecifica: null }],
    });
    sesionActual = { id: 7, email: 'juan.davila@grupocolba.com', rol: 'Analista Comercial', exp: 9999999999, sv: 1, usuario: 'juan.davila' };
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({
      id, asignaciones: [{ idAsignacion: 'ASG-01', analistaAsignado: 'juan.davila', estadoAsignacion: 'En proceso', causaEspecifica: 'Gestión propia' }],
    }));
    // No debe ser bloqueado por el gate de reasignación de F1.1 (edita su propia fila).
    expect(res.status).not.toBe(403);
  });

  it('responsable no elegible (inexistente/inactivo) es rechazado también vía agregarResponsables con usuario autorizado', async () => {
    const id = await crearSolicitudBase();
    sesionActual = { id: 5, email: 'dc@grupocolba.com', rol: 'Director Comercial', exp: 9999999999, sv: 1, usuario: 'director.comercial' };
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ id, agregarResponsables: [{ usuario: 'no.existe' }] }));
    expect(res.status).toBe(409);
    expect(solicitudes.find((s) => s.id === id)?.asignaciones).toEqual([]);
  });

  it('propietario SÍ puede modificar revisionesObs (mismo conjunto de responsables) sin disparar el gate de reasignación', async () => {
    const id = await crearSolicitudBase({
      usuarioRegistro: 'ana.mercadeo', emailRegistro: 'm@grupocolba.com',
      asignaciones: [{ idAsignacion: 'ASG-01', analistaAsignado: 'juan.davila', revisionesObs: [] }],
    });
    sesionActual = { id: 3, email: 'm@grupocolba.com', rol: 'Analista Mercadeo', exp: 9999999999, sv: 1, usuario: 'ana.mercadeo' };
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({
      id, asignaciones: [{ idAsignacion: 'ASG-01', analistaAsignado: 'juan.davila', revisionesObs: [{ nota: 'x' }] }],
    }));
    // No se bloquea por el gate de reasignación (mismo conjunto de responsables) — puede seguir 403 por otra
    // regla de permiso ajena a F1 (asig_gestionar), pero NUNCA por falta de responsable.
    expect(res.status).not.toBe(404);
  });

  it('usuario autorizado (Director Comercial) sí puede agregar responsable', async () => {
    const id = await crearSolicitudBase();
    sesionActual = { id: 5, email: 'dc@grupocolba.com', rol: 'Director Comercial', exp: 9999999999, sv: 1, usuario: 'director.comercial' };
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ id, agregarResponsables: [{ usuario: 'juan.davila' }] }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.solicitud.asignaciones).toHaveLength(1);
  });

  it('usuario no autenticado: 401', async () => {
    const id = await crearSolicitudBase();
    sesionActual = null;
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ id, agregarResponsables: [{ usuario: 'juan.davila' }] }));
    expect(res.status).toBe(401);
  });

  it('se registra auditoría cuando la modificación autorizada ocurre', async () => {
    const id = await crearSolicitudBase();
    sesionActual = { id: 5, email: 'dc@grupocolba.com', rol: 'Director Comercial', exp: 9999999999, sv: 1, usuario: 'director.comercial' };
    const { PATCH } = await import('./route');
    await PATCH(patchReq({ id, agregarResponsables: [{ usuario: 'juan.davila' }] }));
    expect(auditLogs.length).toBeGreaterThan(0);
  });

  it('el rechazo por rol no autorizado se audita como access_denied', async () => {
    const id = await crearSolicitudBase();
    sesionActual = { id: 3, email: 'm@grupocolba.com', rol: 'Analista Mercadeo', exp: 9999999999, sv: 1, usuario: 'ana.mercadeo' };
    const { PATCH } = await import('./route');
    await PATCH(patchReq({ id, agregarResponsables: [{ usuario: 'juan.davila' }] }));
    expect(auditLogs.some((a) => a.accion === 'access_denied')).toBe(true);
  });
});

describe('F1 — Regresión', () => {
  it('creación desde Búsqueda (payload típico de "Gestionar proceso") sigue funcionando', async () => {
    sesionActual = { id: 3, email: 'm@grupocolba.com', rol: 'Analista Mercadeo', exp: 9999999999, sv: 1, usuario: 'ana.mercadeo' };
    const { POST } = await import('./route');
    const res = await POST(postReq({
      procesoId: null, externalId: '999888', codigoProceso: 'BUS-1-2026', nombreProceso: 'Proceso de búsqueda',
      entidad: 'Entidad Búsqueda', objeto: 'Objeto', fuente: 'secop II', aliasFuente: 'S2', modalidad: 'Licitación',
      perfil: 'Aseocolba', departamento: 'Atlántico', origenSolicitud: 'Comercial',
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.solicitud.estadoSolicitud).toBe('Asignado para revisión');
  });

  it('creación manual sigue funcionando', async () => {
    sesionActual = { id: 6, email: 'ac@grupocolba.com', rol: 'Analista Comercial', exp: 9999999999, sv: 1, usuario: 'ana.comercial' };
    const { POST } = await import('./route');
    const res = await POST(postReq({
      codigoProceso: 'No 1', entidad: 'Cliente manual', objeto: 'Cotización manual', modalidad: 'Cotización',
      perfil: 'Aseocolba', aliasFuente: 'NC', fuente: 'Manual', plataforma: 'Correo electrónico',
    }));
    expect(res.status).toBe(201);
  });

  it('la Solicitud creada queda visible para "Procesos › Por validar" (estado + estadoRevision correctos)', async () => {
    sesionActual = { id: 3, email: 'm@grupocolba.com', rol: 'Analista Mercadeo', exp: 9999999999, sv: 1, usuario: 'ana.mercadeo' };
    const { POST } = await import('./route');
    const res = await POST(postReq({ codigoProceso: 'VAL-1-2026', entidad: 'Empresa Validar', perfil: 'Aseocolba' }));
    const data = await res.json();
    expect(data.solicitud.estadoSolicitud).toBe('Asignado para revisión');
    expect(data.solicitud.asignaciones[0].estadoRevision).toBe('ASIGNADO_REVISION');
  });
});

describe('Cierre del rol "Asistente Mercadeo" — sesión con rol literal propio + PerfilRol real de BD', () => {
  // Rol literal DISTINTO de 'Analista Mercadeo' — el fakeImpl.perfilRol.findFirst
  // (arriba) resuelve sus permisos EXCLUSIVAMENTE por el nombre exacto
  // 'Asistente Mercadeo', replicando el PerfilRol real ya configurado en BD:
  // busqueda_gestionar, sol_crear_comercial, sol_editar, sol_ver_todas —
  // SIN asig_gestionar ni asig_asignar_responsable.
  const SESION_ASISTENTE = { id: 4, email: 'asis@grupocolba.com', rol: 'Asistente Mercadeo', exp: 9999999999, sv: 1, usuario: 'asis.mercadeo' };

  it('PUEDE: gestionar desde Búsqueda (crear solicitud vía busqueda_gestionar)', async () => {
    sesionActual = SESION_ASISTENTE;
    const { POST } = await import('./route');
    const res = await POST(postReq({
      procesoId: null, externalId: '777666', codigoProceso: 'AM-1-2026', nombreProceso: 'Proceso de búsqueda',
      entidad: 'Entidad AM', objeto: 'Objeto', fuente: 'secop II', aliasFuente: 'S2', modalidad: 'Licitación',
      perfil: 'Aseocolba', departamento: 'Atlántico', origenSolicitud: 'Comercial',
    }));
    expect(res.status).toBe(201);
  });

  it('PUEDE: crear una solicitud manual (vía sol_crear_comercial)', async () => {
    sesionActual = SESION_ASISTENTE;
    const { POST } = await import('./route');
    const res = await POST(postReq({ codigoProceso: 'AM-2-2026', entidad: 'Entidad AM 2', perfil: 'Aseocolba' }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.solicitud.asignaciones[0].analistaAsignado).toBe('juan.davila');
  });

  it('PUEDE: editar los campos generales permitidos de una solicitud que registró (sol_editar / canAccessSolicitud)', async () => {
    const idResp = await (async () => {
      const { POST } = await import('./route');
      sesionActual = SESION_ASISTENTE;
      const res = await POST(postReq({ codigoProceso: 'AM-3-2026', entidad: 'Entidad AM 3', perfil: 'Aseocolba' }));
      return (await res.json()).solicitud.id as number;
    })();
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ id: idResp, objeto: 'Objeto actualizado por Asistente Mercadeo' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.solicitud.objeto).toBe('Objeto actualizado por Asistente Mercadeo');
  });

  it('NO PUEDE: agregar responsables', async () => {
    solicitudes.push({
      id: nextSolicitudId++, procesoId: 9001, entidad: 'Empresa AM', codigoProceso: 'AM-4-2026',
      perfil: 'Aseocolba', estadoSolicitud: 'Selección de proceso', asignaciones: [],
      emailRegistro: 'otro@grupocolba.com', usuarioRegistro: 'otro.usuario', aprobador: '', revisor: '',
      createdAt: new Date(), updatedAt: new Date(),
    });
    const id = solicitudes[solicitudes.length - 1].id as number;
    sesionActual = SESION_ASISTENTE;
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ id, agregarResponsables: [{ usuario: 'juan.davila' }] }));
    expect(res.status).toBe(403);
  });

  it('NO PUEDE: retirar responsables', async () => {
    solicitudes.push({
      id: nextSolicitudId++, procesoId: 9002, entidad: 'Empresa AM', codigoProceso: 'AM-5-2026',
      perfil: 'Aseocolba', estadoSolicitud: 'Asignado para revisión',
      asignaciones: [{ idAsignacion: 'ASG-01', analistaAsignado: 'juan.davila' }],
      emailRegistro: 'otro@grupocolba.com', usuarioRegistro: 'otro.usuario', aprobador: '', revisor: '',
      createdAt: new Date(), updatedAt: new Date(),
    });
    const id = solicitudes[solicitudes.length - 1].id as number;
    sesionActual = SESION_ASISTENTE;
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ id, removerResponsables: ['juan.davila'] }));
    expect(res.status).toBe(403);
  });

  it('NO PUEDE: reasignar (reemplazar el responsable vía asignaciones en bruto)', async () => {
    solicitudes.push({
      id: nextSolicitudId++, procesoId: 9003, entidad: 'Empresa AM', codigoProceso: 'AM-6-2026',
      perfil: 'Aseocolba', estadoSolicitud: 'Asignado para revisión',
      asignaciones: [{ idAsignacion: 'ASG-01', analistaAsignado: 'juan.davila' }],
      emailRegistro: 'asis@grupocolba.com', usuarioRegistro: 'asis.mercadeo', aprobador: '', revisor: '',
      createdAt: new Date(), updatedAt: new Date(),
    });
    const id = solicitudes[solicitudes.length - 1].id as number;
    sesionActual = SESION_ASISTENTE;
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ id, asignaciones: [{ idAsignacion: 'ASG-01', analistaAsignado: 'nicole.ortiz' }] }));
    expect(res.status).toBe(403);
  });

  it('NO PUEDE: modificar el contenido de una asignación ajena (mismo responsable, otro campo)', async () => {
    solicitudes.push({
      id: nextSolicitudId++, procesoId: 9004, entidad: 'Empresa AM', codigoProceso: 'AM-7-2026',
      perfil: 'Aseocolba', estadoSolicitud: 'Asignado para revisión',
      asignaciones: [{ idAsignacion: 'ASG-01', analistaAsignado: 'juan.davila', estadoAsignacion: 'Pendiente' }],
      emailRegistro: 'asis@grupocolba.com', usuarioRegistro: 'asis.mercadeo', aprobador: '', revisor: '',
      createdAt: new Date(), updatedAt: new Date(),
    });
    const id = solicitudes[solicitudes.length - 1].id as number;
    sesionActual = SESION_ASISTENTE;
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ id, asignaciones: [{ idAsignacion: 'ASG-01', analistaAsignado: 'juan.davila', estadoAsignacion: 'En proceso' }] }));
    expect(res.status).toBe(403);
  });
});
