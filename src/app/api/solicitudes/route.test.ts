/**
 * Integración REAL de POST/PATCH /api/solicitudes — llama a los handlers
 * exportados de `route.ts` tal cual (no solo la función pura extraída),
 * con `@/lib/prisma` y `@/lib/session` reemplazados por dobles en memoria.
 * `getSession` devuelve un usuario admin fijo — `canAccessSolicitud`/
 * `hasPermiso`/`puedeConBD` son `true` para admin sin tocar BD, así que no
 * hace falta mockear `authz.ts`/`permisos.ts` por separado. El `fetch`
 * externo (apertura de SQR) se mockea para no depender de la red — su
 * éxito/fallo no es lo que estas pruebas verifican.
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

const USUARIOS: UsuarioFake[] = [
  { id: 7, usuario: 'juan.davila', estado: 'Activo', cargo: 'Analista Comercial', rol: 'Analista Comercial', proceso: 'Comercial', entidadGrupo: 'Aseocolba' },
  { id: 8, usuario: 'nicole.ortiz', estado: 'Activo', cargo: 'Analista Comercial', rol: 'Analista Comercial', proceso: 'Comercial', entidadGrupo: 'Aseocolba' },
];

let procesos: ProcesoFake[] = [];
let solicitudes: Array<Record<string, unknown>> = [];
let auditLogs: Array<Record<string, unknown>> = [];
let nextProcesoId = 1;
let nextSolicitudId = 1;

function resetFakeDb() {
  procesos = [];
  solicitudes = [];
  auditLogs = [];
  nextProcesoId = 1;
  nextSolicitudId = 1;
}

// procesoId=500: fixture usada por los `crearSolicitudBase()` de la
// sección PATCH de este archivo como "la Solicitud PATCH de prueba" —
// desde el Lote F2D, el PATCH genérico exige que el Proceso relacionado
// clasifique como MANUAL (`determinarOrigenProceso`) antes de aceptar
// ediciones de campos de origen; se siembra como manual (`sourceKey` con
// prefijo `manual:`, sin `externalId`) para no alterar la intención
// original de esos tests (edición administrativa general, no relacionada
// con F2D). No se agrega a `resetFakeDb()` porque el describe de POST
// verifica explícitamente `procesos` vacío tras un rechazo.
function sembrarProcesoManual500() {
  if (!procesos.some((p) => p.id === 500)) {
    procesos.push({ id: 500, externalId: null, sourceKey: 'manual:fixture-500', codigoProceso: null, entidad: null });
  }
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
vi.mock('@/lib/session', () => ({
  getSession: async () => ({ id: 1, email: 'admin@grupocolba.com', rol: 'admin', exp: 9999999999, sv: 1, usuario: 'admin.qa' }),
}));

describe('Integración real — POST /api/solicitudes', () => {
  beforeEach(() => {
    resetFakeDb();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('SQR no disponible en pruebas'); }));
  });

  it('crea la Solicitud con responsable y estado resueltos por el backend (perfil Aseocolba → juan.davila)', async () => {
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/solicitudes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        codigoProceso: 'IP 026 2026', entidad: 'Rama Judicial de Cúcuta', externalId: '11833728',
        aliasFuente: 'S2', fuente: 'secop II', perfil: 'Aseocolba',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.solicitud.estadoSolicitud).toBe('Asignado para revisión');
    expect(data.solicitud.asignaciones).toHaveLength(1);
    expect(data.solicitud.asignaciones[0].analistaAsignado).toBe('juan.davila');
  });

  it('rechaza con 400 si el cliente manda "asignaciones" o "estadoSolicitud" (contrato ya no los acepta)', async () => {
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/solicitudes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        codigoProceso: 'X-1-2026', entidad: 'Empresa X', perfil: 'Aseocolba',
        estadoSolicitud: 'Asignado para revisión', asignaciones: [],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(solicitudes).toHaveLength(0);
  });

  it('perfil desconocido: responde con error controlado y NO crea una Solicitud huérfana', async () => {
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/solicitudes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigoProceso: 'X-2-2026', entidad: 'Empresa Desconocida', perfil: 'EmpresaSinRegla' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(solicitudes).toHaveLength(0);
    expect(procesos).toHaveLength(0);
  });

  it('repetir el POST para el mismo proceso (mismo externalId) es idempotente — no duplica', async () => {
    const { POST } = await import('./route');
    const body = JSON.stringify({
      codigoProceso: 'IP 026 2026', entidad: 'Rama Judicial de Cúcuta', externalId: '11833728',
      aliasFuente: 'S2', fuente: 'secop II', perfil: 'Aseocolba',
    });
    const res1 = await POST(new NextRequest('http://localhost/api/solicitudes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }));
    const res2 = await POST(new NextRequest('http://localhost/api/solicitudes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }));
    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    const data1 = await res1.json();
    const data2 = await res2.json();
    expect(data2.solicitud.id).toBe(data1.solicitud.id);
    expect(solicitudes).toHaveLength(1);
  });
});

describe('Integración real — PATCH /api/solicitudes', () => {
  beforeEach(() => {
    resetFakeDb();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('SQR no disponible en pruebas'); }));
  });

  async function crearSolicitudBase(): Promise<number> {
    sembrarProcesoManual500();
    solicitudes.push({
      id: nextSolicitudId++, procesoId: 500, entidad: 'Empresa PATCH Test', codigoProceso: 'X-3-2026',
      perfil: 'Aseocolba', estadoSolicitud: 'Selección de proceso', asignaciones: [],
      emailRegistro: 'admin@grupocolba.com', usuarioRegistro: 'admin.qa',
      aprobador: '', revisor: '', createdAt: new Date(), updatedAt: new Date(),
    });
    return solicitudes[solicitudes.length - 1].id as number;
  }

  it('agregar un responsable válido permite pasar a "Asignado para revisión"', async () => {
    const id = await crearSolicitudBase();
    const { PATCH } = await import('./route');
    const req = new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, agregarResponsables: [{ usuario: 'juan.davila' }] }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.solicitud.estadoSolicitud).toBe('Asignado para revisión');
    expect(data.solicitud.asignaciones).toHaveLength(1);
  });

  it('rechaza con 409 forzar estadoSolicitud="Asignado para revisión" sin ningún responsable', async () => {
    const id = await crearSolicitudBase();
    const { PATCH } = await import('./route');
    const req = new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, estadoSolicitud: 'Asignado para revisión' }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.ok).toBe(false);
    // No queda ningún cambio parcial: el estado en el fake sigue igual.
    expect(solicitudes.find((s) => s.id === id)?.estadoSolicitud).toBe('Selección de proceso');
  });

  it('rechaza agregar un responsable que no existe en la BD (409, sin cambios parciales)', async () => {
    const id = await crearSolicitudBase();
    const { PATCH } = await import('./route');
    const req = new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, agregarResponsables: [{ usuario: 'fantasma' }] }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(409);
    expect(solicitudes.find((s) => s.id === id)?.asignaciones).toEqual([]);
  });

  it('registra un AuditLog con estado anterior/nuevo y responsables anteriores/nuevos', async () => {
    const id = await crearSolicitudBase();
    const { PATCH } = await import('./route');
    await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, agregarResponsables: [{ usuario: 'juan.davila' }] }),
    }));
    const log = auditLogs.find((l) => l.recursoId === String(id));
    expect(log).toBeTruthy();
    const detalle = log!.detalle as Record<string, unknown>;
    expect(detalle.estadoAnterior).toBe('Selección de proceso');
    expect(detalle.estadoNuevo).toBe('Asignado para revisión');
    expect(detalle.responsablesNuevos).toEqual(['juan.davila']);
    expect(JSON.stringify(log)).not.toMatch(/password|token|secret/i);
  });
});

describe('Integración real — PATCH /api/solicitudes rechaza transiciones a estado terminal (auditoría: cierre por PATCH genérico eliminado)', () => {
  beforeEach(() => {
    resetFakeDb();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('SQR no disponible en pruebas'); }));
  });

  async function crearSolicitudBase(estadoSolicitud = 'En evaluación'): Promise<number> {
    sembrarProcesoManual500();
    solicitudes.push({
      id: nextSolicitudId++, procesoId: 500, entidad: 'Empresa PATCH Test', codigoProceso: 'X-4-2026',
      perfil: 'Aseocolba', estadoSolicitud, asignaciones: [{ idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila' }],
      emailRegistro: 'admin@grupocolba.com', usuarioRegistro: 'admin.qa',
      aprobador: '', revisor: '', createdAt: new Date(), updatedAt: new Date(),
    });
    return solicitudes[solicitudes.length - 1].id as number;
  }

  it('rechaza con 400 un intento de forzar estadoSolicitud="Cerrada" vía PATCH directo', async () => {
    const id = await crearSolicitudBase();
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, estadoSolicitud: 'Cerrada' }),
    }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/POST \/api\/solicitudes\/\[id\]\/cerrar/);
    expect(solicitudes.find((s) => s.id === id)?.estadoSolicitud).toBe('En evaluación'); // sin cambios
  });

  it('rechaza con 400 un intento de forzar estadoSolicitud="Cancelada" vía PATCH directo', async () => {
    const id = await crearSolicitudBase();
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, estadoSolicitud: 'Cancelada' }),
    }));
    expect(res.status).toBe(400);
  });

  it('un intento de cerrar además mandando el arreglo completo de asignaciones también se rechaza (400) — nunca se procesa parcialmente', async () => {
    const id = await crearSolicitudBase();
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, estadoSolicitud: 'Cerrada', asignaciones: [{ idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', estadoRevision: 'CERRADO_ADJUDICADO' }] }),
    }));
    expect(res.status).toBe(400);
    expect((solicitudes.find((s) => s.id === id)?.asignaciones as any[])[0].estadoRevision).toBeUndefined();
  });

  it('si la solicitud YA estaba en un estado terminal, un intento de "cerrarla de nuevo" vía PATCH da 409 con el mismo mensaje que el endpoint dedicado', async () => {
    const id = await crearSolicitudBase('Cerrada');
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, estadoSolicitud: 'Cerrada' }),
    }));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe('La solicitud ya fue cerrada por otro usuario.');
  });

  it('un PATCH que NO toca estadoSolicitud (otra edición administrativa) sigue funcionando con normalidad', async () => {
    const id = await crearSolicitudBase();
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, entidad: 'Nueva razón social' }),
    }));
    expect(res.status).toBe(200);
    expect(solicitudes.find((s) => s.id === id)?.entidad).toBe('Nueva razón social');
  });

  it('agregarResponsables en una solicitud sin responsables sigue fijando "Asignado para revisión" (transición NO terminal) sin ser bloqueado por el guard nuevo', async () => {
    const id = await crearSolicitudBase('Selección de proceso');
    solicitudes.find((s) => s.id === id)!.asignaciones = [];
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, agregarResponsables: [{ usuario: 'juan.davila' }] }),
    }));
    expect(res.status).toBe(200);
    expect(solicitudes.find((s) => s.id === id)?.estadoSolicitud).toBe('Asignado para revisión');
  });
});

describe('Integración real — PATCH /api/solicitudes: cierre parcial Fase 2B-1 (valores exclusivos de /transicion)', () => {
  beforeEach(() => {
    resetFakeDb();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('SQR no disponible en pruebas'); }));
  });

  async function crearSolicitudBase(estadoSolicitud = 'Asignado para revisión'): Promise<number> {
    sembrarProcesoManual500();
    solicitudes.push({
      id: nextSolicitudId++, procesoId: 500, entidad: 'Empresa PATCH Test', codigoProceso: 'X-5-2026',
      perfil: 'Aseocolba', estadoSolicitud, asignaciones: [{ idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila' }],
      emailRegistro: 'admin@grupocolba.com', usuarioRegistro: 'admin.qa',
      aprobador: '', revisor: '', createdAt: new Date(), updatedAt: new Date(),
    });
    return solicitudes[solicitudes.length - 1].id as number;
  }

  it.each(['EN_REVISION', 'ASIGNADO_REVISION', 'EN_ELABORACION', 'en_revision'])(
    'rechaza con 400 estadoSolicitud="%s" — debe usar POST .../transicion',
    async (valor) => {
      const id = await crearSolicitudBase();
      const { PATCH } = await import('./route');
      const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, estadoSolicitud: valor }),
      }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/POST \/api\/solicitudes\/\[id\]\/transicion/);
      expect(solicitudes.find((s) => s.id === id)?.estadoSolicitud).toBe('Asignado para revisión'); // sin cambios
    },
  );

  it('NO bloquea todavía "Asignado para elaboración" — APROBAR_PARA_ELABORACION sigue sin migrar (Fase 2B-2)', async () => {
    const id = await crearSolicitudBase();
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, estadoSolicitud: 'Asignado para elaboración' }),
    }));
    expect(res.status).toBe(200);
  });

  it('NO bloquea todavía "En observación" — ENVIAR_A_OBSERVACION sigue sin migrar (Fase 2B-2)', async () => {
    const id = await crearSolicitudBase();
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, estadoSolicitud: 'En observación' }),
    }));
    expect(res.status).toBe(200);
  });

  it('detecta y rechaza la evasión: estadoSolicitud legado sin cambios, pero asignaciones[].estadoRevision modificado a un valor bloqueado', async () => {
    const id = await crearSolicitudBase();
    solicitudes.find((s) => s.id === id)!.asignaciones = [{ idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', estadoRevision: 'ASIGNADO_REVISION' }];
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id, estadoSolicitud: 'Asignado para revisión', // sin cambios, mismo texto legado de siempre
        asignaciones: [{ idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', estadoRevision: 'en_revision' }], // minúscula, alias
      }),
    }));
    expect(res.status).toBe(400);
    expect((solicitudes.find((s) => s.id === id)?.asignaciones as any[])[0].estadoRevision).toBe('ASIGNADO_REVISION'); // sin cambios
  });
});

describe('Integración real — PATCH /api/solicitudes: bloqueo de APROBADO_ELABORACION (Fase 2B-2.2.5 — FINALIZAR_REVISION exclusivo de /finalizar-revision)', () => {
  beforeEach(() => {
    resetFakeDb();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('SQR no disponible en pruebas'); }));
  });

  async function crearSolicitudConDosAsignaciones(): Promise<number> {
    sembrarProcesoManual500();
    solicitudes.push({
      id: nextSolicitudId++, procesoId: 500, entidad: 'Empresa PATCH Test', codigoProceso: 'X-6-2026',
      perfil: 'Aseocolba', estadoSolicitud: 'En observación',
      asignaciones: [
        { idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', estadoRevision: 'CON_OBSERVACIONES', observaciones: [{ detalle: 'obs A' }] },
        { idAsignacion: 'ASG-2', analistaAsignado: 'nicole.ortiz', estadoRevision: 'CON_OBSERVACIONES', observaciones: [{ detalle: 'obs B' }] },
      ],
      emailRegistro: 'admin@grupocolba.com', usuarioRegistro: 'admin.qa',
      aprobador: '', revisor: '', createdAt: new Date(), updatedAt: new Date(),
    });
    return solicitudes[solicitudes.length - 1].id as number;
  }

  it('a) rechaza con 400 estadoSolicitud="APROBADO_ELABORACION" — debe usar POST .../finalizar-revision', async () => {
    const id = await crearSolicitudConDosAsignaciones();
    const antes = JSON.parse(JSON.stringify(solicitudes.find((s) => s.id === id)));
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, estadoSolicitud: 'APROBADO_ELABORACION' }),
    }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/POST \/api\/solicitudes\/\[id\]\/transicion/);
    expect(JSON.parse(JSON.stringify(solicitudes.find((s) => s.id === id)))).toEqual(antes); // d) igual a la snapshot previa
  });

  it('b) rechaza con 400 asignaciones[].estadoRevision="APROBADO_ELABORACION" (cambio real respecto a BD)', async () => {
    const id = await crearSolicitudConDosAsignaciones();
    const antes = JSON.parse(JSON.stringify(solicitudes.find((s) => s.id === id)));
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        asignaciones: [
          { idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', estadoRevision: 'APROBADO_ELABORACION', decisionObservaciones: 'aceptada' },
        ],
      }),
    }));
    expect(res.status).toBe(400);
    expect(JSON.parse(JSON.stringify(solicitudes.find((s) => s.id === id)))).toEqual(antes);
  });

  it('c) con múltiples asignaciones, NINGUNA fila cambia (ni A ni B) — sin escritura parcial', async () => {
    const id = await crearSolicitudConDosAsignaciones();
    const antes = JSON.parse(JSON.stringify(solicitudes.find((s) => s.id === id)));
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        estadoSolicitud: 'APROBADO_ELABORACION',
        asignaciones: [
          { idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', estadoRevision: 'APROBADO_ELABORACION', decisionObservaciones: 'aceptada', validadoPor: 'usuario-falso', fechaValidacion: '2020-01-01' },
          { idAsignacion: 'ASG-2', analistaAsignado: 'nicole.ortiz', estadoRevision: 'APROBADO_ELABORACION' },
        ],
      }),
    }));
    expect(res.status).toBe(400);
    const actual = solicitudes.find((s) => s.id === id);
    expect(JSON.parse(JSON.stringify(actual))).toEqual(antes); // e) sin ningún efecto secundario
    const asigs = actual!.asignaciones as Record<string, unknown>[];
    expect(asigs[0].estadoRevision).toBe('CON_OBSERVACIONES');
    expect(asigs[1].estadoRevision).toBe('CON_OBSERVACIONES');
    expect(asigs[0]).not.toHaveProperty('decisionObservaciones');
    expect(asigs[0]).not.toHaveProperty('validadoPor');
  });

  it('f) los flujos legítimos restantes del PATCH continúan funcionando (agregar responsable, sin tocar APROBADO_ELABORACION)', async () => {
    const id = await crearSolicitudConDosAsignaciones();
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, agregarResponsables: [{ usuario: 'nicole.ortiz' }] }),
    }));
    expect(res.status).toBe(200);
  });

  it('sigue sin bloquear la etiqueta legada "Asignado para elaboración" (distinta del token canónico)', async () => {
    const id = await crearSolicitudConDosAsignaciones();
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, estadoSolicitud: 'Asignado para elaboración' }),
    }));
    expect(res.status).toBe(200);
  });
});

describe('Integración real — PATCH /api/solicitudes: bloqueo de EN_OBSERVACION/CON_OBSERVACIONES (Fase 2B-2.2.6 — ENVIAR_A_OBSERVACION exclusivo de /observaciones)', () => {
  beforeEach(() => {
    resetFakeDb();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('SQR no disponible en pruebas'); }));
  });

  async function crearSolicitudEnRevisionConDosAsignaciones(): Promise<number> {
    sembrarProcesoManual500();
    solicitudes.push({
      id: nextSolicitudId++, procesoId: 500, entidad: 'Empresa PATCH Test', codigoProceso: 'X-7-2026',
      perfil: 'Aseocolba', estadoSolicitud: 'En revisión',
      asignaciones: [
        { idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', estadoRevision: 'EN_REVISION' },
        { idAsignacion: 'ASG-2', analistaAsignado: 'nicole.ortiz', estadoRevision: 'EN_REVISION' },
      ],
      emailRegistro: 'admin@grupocolba.com', usuarioRegistro: 'admin.qa',
      aprobador: '', revisor: '', createdAt: new Date(), updatedAt: new Date(),
    });
    return solicitudes[solicitudes.length - 1].id as number;
  }

  it('1. rechaza con 400 estadoSolicitud="EN_OBSERVACION" — sin escritura', async () => {
    const id = await crearSolicitudEnRevisionConDosAsignaciones();
    const antes = JSON.parse(JSON.stringify(solicitudes.find((s) => s.id === id)));
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, estadoSolicitud: 'EN_OBSERVACION' }),
    }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/POST \/api\/solicitudes\/\[id\]\/transicion/);
    expect(JSON.parse(JSON.stringify(solicitudes.find((s) => s.id === id)))).toEqual(antes);
  });

  it('2. rechaza con 400 asignaciones[].estadoRevision="CON_OBSERVACIONES" (cambio real respecto a BD) — sin escritura', async () => {
    const id = await crearSolicitudEnRevisionConDosAsignaciones();
    const antes = JSON.parse(JSON.stringify(solicitudes.find((s) => s.id === id)));
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        asignaciones: [
          { idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', estadoRevision: 'CON_OBSERVACIONES', observaciones: [{ autor: 'usuario-falso', detalle: 'observación colada por PATCH' }] },
        ],
      }),
    }));
    expect(res.status).toBe(400);
    expect(JSON.parse(JSON.stringify(solicitudes.find((s) => s.id === id)))).toEqual(antes);
  });

  it('3. con 2 asignaciones, NINGUNA fila cambia cuando se intenta el bypass', async () => {
    const id = await crearSolicitudEnRevisionConDosAsignaciones();
    const antes = JSON.parse(JSON.stringify(solicitudes.find((s) => s.id === id)));
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        estadoSolicitud: 'EN_OBSERVACION',
        asignaciones: [
          { idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', estadoRevision: 'CON_OBSERVACIONES', observaciones: [{ autor: 'usuario-falso' }] },
          { idAsignacion: 'ASG-2', analistaAsignado: 'nicole.ortiz', estadoRevision: 'CON_OBSERVACIONES' },
        ],
      }),
    }));
    expect(res.status).toBe(400);
    const actual = solicitudes.find((s) => s.id === id);
    expect(JSON.parse(JSON.stringify(actual))).toEqual(antes);
    const asigs = actual!.asignaciones as Record<string, unknown>[];
    expect(asigs[0].estadoRevision).toBe('EN_REVISION');
    expect(asigs[1].estadoRevision).toBe('EN_REVISION');
    expect(asigs[0]).not.toHaveProperty('observaciones');
  });

  it('4. no se genera ningún AuditLog cuando se intenta el bypass', async () => {
    const id = await crearSolicitudEnRevisionConDosAsignaciones();
    const { PATCH } = await import('./route');
    await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, estadoSolicitud: 'EN_OBSERVACION' }),
    }));
    expect(auditLogs.filter((l) => l.recursoId === String(id))).toHaveLength(0);
  });

  it('5. la edición legítima de una observación en una fila que YA está en CON_OBSERVACIONES continúa funcionando (200) — no es un cambio real de estadoRevision', async () => {
    sembrarProcesoManual500();
    solicitudes.push({
      id: nextSolicitudId++, procesoId: 500, entidad: 'Empresa PATCH Test', codigoProceso: 'X-8-2026',
      perfil: 'Aseocolba', estadoSolicitud: 'En observación',
      asignaciones: [
        { idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', estadoRevision: 'CON_OBSERVACIONES', observaciones: [{ detalle: 'vieja' }] },
      ],
      emailRegistro: 'admin@grupocolba.com', usuarioRegistro: 'admin.qa',
      aprobador: '', revisor: '', createdAt: new Date(), updatedAt: new Date(),
    });
    const id = solicitudes[solicitudes.length - 1].id as number;
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        asignaciones: [
          { idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', estadoRevision: 'CON_OBSERVACIONES', observaciones: [{ detalle: 'vieja' }, { detalle: 'nueva editada' }] },
        ],
      }),
    }));
    expect(res.status).toBe(200);
  });

  it('6. los flujos legítimos restantes del PATCH continúan funcionando (agregar responsable, sin tocar EN_OBSERVACION)', async () => {
    const id = await crearSolicitudEnRevisionConDosAsignaciones();
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, agregarResponsables: [{ usuario: 'nicole.ortiz' }] }),
    }));
    expect(res.status).toBe(200);
  });

  it('sigue sin bloquear la etiqueta legada "En observación" (distinta del token canónico/alias)', async () => {
    const id = await crearSolicitudEnRevisionConDosAsignaciones();
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, estadoSolicitud: 'En observación' }),
    }));
    expect(res.status).toBe(200);
  });
});

describe('Integración real — PATCH /api/solicitudes: bloqueo de PRESENTADO (Fase 2B-2.2.8 — PRESENTAR exclusivo de /transicion)', () => {
  beforeEach(() => {
    resetFakeDb();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('SQR no disponible en pruebas'); }));
  });

  async function crearSolicitudEnElaboracionConDosAsignaciones(): Promise<number> {
    sembrarProcesoManual500();
    solicitudes.push({
      id: nextSolicitudId++, procesoId: 500, entidad: 'Empresa PATCH Test', codigoProceso: 'X-9-2026',
      perfil: 'Aseocolba', estadoSolicitud: 'En elaboración',
      asignaciones: [
        { idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', estadoRevision: 'EN_ELABORACION' },
        { idAsignacion: 'ASG-2', analistaAsignado: 'nicole.ortiz', estadoRevision: 'EN_ELABORACION' },
      ],
      emailRegistro: 'admin@grupocolba.com', usuarioRegistro: 'admin.qa',
      aprobador: '', revisor: '', createdAt: new Date(), updatedAt: new Date(),
    });
    return solicitudes[solicitudes.length - 1].id as number;
  }

  it('1. rechaza con 400 estadoSolicitud="PRESENTADO" — sin escritura', async () => {
    const id = await crearSolicitudEnElaboracionConDosAsignaciones();
    const antes = JSON.parse(JSON.stringify(solicitudes.find((s) => s.id === id)));
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, estadoSolicitud: 'PRESENTADO' }),
    }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/POST \/api\/solicitudes\/\[id\]\/transicion/);
    expect(JSON.parse(JSON.stringify(solicitudes.find((s) => s.id === id)))).toEqual(antes);
  });

  it('2. rechaza con 400 asignaciones[].estadoRevision="PRESENTADO" (cambio real respecto a BD) — sin escritura', async () => {
    const id = await crearSolicitudEnElaboracionConDosAsignaciones();
    const antes = JSON.parse(JSON.stringify(solicitudes.find((s) => s.id === id)));
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        asignaciones: [
          { idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', estadoRevision: 'PRESENTADO' },
        ],
      }),
    }));
    expect(res.status).toBe(400);
    expect(JSON.parse(JSON.stringify(solicitudes.find((s) => s.id === id)))).toEqual(antes);
  });

  it('3. con 2 asignaciones, NINGUNA fila cambia cuando se intenta el bypass', async () => {
    const id = await crearSolicitudEnElaboracionConDosAsignaciones();
    const antes = JSON.parse(JSON.stringify(solicitudes.find((s) => s.id === id)));
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        estadoSolicitud: 'PRESENTADO',
        asignaciones: [
          { idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', estadoRevision: 'PRESENTADO' },
          { idAsignacion: 'ASG-2', analistaAsignado: 'nicole.ortiz', estadoRevision: 'PRESENTADO' },
        ],
      }),
    }));
    expect(res.status).toBe(400);
    const actual = solicitudes.find((s) => s.id === id);
    expect(JSON.parse(JSON.stringify(actual))).toEqual(antes);
    const asigs = actual!.asignaciones as Record<string, unknown>[];
    expect(asigs[0].estadoRevision).toBe('EN_ELABORACION');
    expect(asigs[1].estadoRevision).toBe('EN_ELABORACION');
  });

  it('4. no se genera ningún AuditLog cuando se intenta el bypass', async () => {
    const id = await crearSolicitudEnElaboracionConDosAsignaciones();
    const { PATCH } = await import('./route');
    await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, estadoSolicitud: 'PRESENTADO' }),
    }));
    expect(auditLogs.filter((l) => l.recursoId === String(id))).toHaveLength(0);
  });

  it('5. la edición legítima de una fila que YA está en PRESENTADO continúa funcionando (200) — no es un cambio real de estadoRevision', async () => {
    sembrarProcesoManual500();
    solicitudes.push({
      id: nextSolicitudId++, procesoId: 500, entidad: 'Empresa PATCH Test', codigoProceso: 'X-10-2026',
      perfil: 'Aseocolba', estadoSolicitud: 'En evaluación',
      asignaciones: [
        { idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', estadoRevision: 'PRESENTADO', observaciones: [{ detalle: 'vieja' }] },
      ],
      emailRegistro: 'admin@grupocolba.com', usuarioRegistro: 'admin.qa',
      aprobador: '', revisor: '', createdAt: new Date(), updatedAt: new Date(),
    });
    const id = solicitudes[solicitudes.length - 1].id as number;
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        asignaciones: [
          { idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', estadoRevision: 'PRESENTADO', observaciones: [{ detalle: 'vieja' }, { detalle: 'nueva editada' }] },
        ],
      }),
    }));
    expect(res.status).toBe(200);
  });

  it('6. los flujos legítimos restantes del PATCH continúan funcionando (agregar responsable, sin tocar PRESENTADO)', async () => {
    const id = await crearSolicitudEnElaboracionConDosAsignaciones();
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, agregarResponsables: [{ usuario: 'nicole.ortiz' }] }),
    }));
    expect(res.status).toBe(200);
  });
});

describe('Integración real — PATCH /api/solicitudes: bloqueo de estados de cierre por fila (Fase 2B-2.2.9 — RECHAZADO/CERRADO_ADJUDICADO/CERRADO_NO_ADJUDICADO/CERRADO_NO_CUMPLIMIENTO/CANCELADO exclusivos de /[id]/cerrar)', () => {
  beforeEach(() => {
    resetFakeDb();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('SQR no disponible en pruebas'); }));
  });

  const ESTADOS_CIERRE_FILA = ['RECHAZADO', 'CERRADO_ADJUDICADO', 'CERRADO_NO_ADJUDICADO', 'CERRADO_NO_CUMPLIMIENTO', 'CANCELADO'];

  async function crearSolicitudEnEjecucionConUnaAsignacion(): Promise<number> {
    sembrarProcesoManual500();
    solicitudes.push({
      id: nextSolicitudId++, procesoId: 500, entidad: 'Empresa PATCH Test', codigoProceso: 'X-11-2026',
      perfil: 'Aseocolba', estadoSolicitud: 'En ejecución',
      asignaciones: [
        { idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', estadoRevision: 'EN_ELABORACION' },
      ],
      emailRegistro: 'admin@grupocolba.com', usuarioRegistro: 'admin.qa',
      aprobador: '', revisor: '', createdAt: new Date(), updatedAt: new Date(),
    });
    return solicitudes[solicitudes.length - 1].id as number;
  }

  it.each(ESTADOS_CIERRE_FILA)('1. rechaza con 400 asignaciones[].estadoRevision="%s" (cambio real) — sin escritura', async (estado) => {
    const id = await crearSolicitudEnEjecucionConUnaAsignacion();
    const antes = JSON.parse(JSON.stringify(solicitudes.find((s) => s.id === id)));
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        asignaciones: [
          { idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', estadoRevision: estado, resultadoFinal: 'Adjudicado' },
        ],
      }),
    }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/POST \/api\/solicitudes\/\[id\]\/transicion/);
    expect(JSON.parse(JSON.stringify(solicitudes.find((s) => s.id === id)))).toEqual(antes);
  });

  it('2. el rechazo ocurre ANTES de cualquier modificación — la Solicitud queda exactamente igual', async () => {
    const id = await crearSolicitudEnEjecucionConUnaAsignacion();
    const antes = JSON.parse(JSON.stringify(solicitudes.find((s) => s.id === id)));
    const { PATCH } = await import('./route');
    await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        asignaciones: [
          { idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Adjudicado' },
        ],
      }),
    }));
    const actual = solicitudes.find((s) => s.id === id);
    expect(JSON.parse(JSON.stringify(actual))).toEqual(antes);
    const asigs = actual!.asignaciones as Record<string, unknown>[];
    expect(asigs[0].estadoRevision).toBe('EN_ELABORACION');
    expect(asigs[0]).not.toHaveProperty('resultadoFinal');
  });

  it('3. no se genera ningún AuditLog cuando se intenta el bypass', async () => {
    const id = await crearSolicitudEnEjecucionConUnaAsignacion();
    const { PATCH } = await import('./route');
    await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        asignaciones: [
          { idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', estadoRevision: 'RECHAZADO' },
        ],
      }),
    }));
    expect(auditLogs.filter((l) => l.recursoId === String(id))).toHaveLength(0);
  });

  it('4. una edición legítima NO relacionada (agregar responsable) sigue funcionando', async () => {
    const id = await crearSolicitudEnEjecucionConUnaAsignacion();
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, agregarResponsables: [{ usuario: 'nicole.ortiz' }] }),
    }));
    expect(res.status).toBe(200);
  });
});

describe('Integración real — PATCH /api/solicitudes: bloqueo de resultadoFinal/causalCierre top-level (Fase 2B-2.2.10 — exclusivos de /[id]/cerrar)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetFakeDb();
    // Mismo mock global usado por el resto del archivo — si `cerrarSqr()`
    // (interno a route.ts, invocado vía `fetch`) llegara a ejecutarse, este
    // mock lo capturaría. Se guarda la referencia para poder aserter
    // `.not.toHaveBeenCalled()`.
    fetchSpy = vi.fn(async () => { throw new Error('SQR no disponible en pruebas'); });
    vi.stubGlobal('fetch', fetchSpy);
  });

  async function crearSolicitudEnObservacionConSqr(): Promise<number> {
    sembrarProcesoManual500();
    solicitudes.push({
      id: nextSolicitudId++, procesoId: 500, entidad: 'Empresa PATCH Test', codigoProceso: 'X-12-2026',
      perfil: 'Aseocolba', estadoSolicitud: 'En observación',
      asignaciones: [{ idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', estadoRevision: 'CON_OBSERVACIONES' }],
      emailRegistro: 'admin@grupocolba.com', usuarioRegistro: 'admin.qa',
      aprobador: '', revisor: '', createdAt: new Date(), updatedAt: new Date(),
      sqrNumero: '999', sqrCreada: true, sqrCerrada: false,
    });
    return solicitudes[solicitudes.length - 1].id as number;
  }

  // A. resultadoFinal solo
  it('A. rechaza con 400 al enviar solo resultadoFinal — sin escritura, sin AuditLog', async () => {
    const id = await crearSolicitudEnObservacionConSqr();
    const antes = JSON.parse(JSON.stringify(solicitudes.find((s) => s.id === id)));
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, resultadoFinal: 'Adjudicado' }),
    }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/POST \/api\/solicitudes\/\[id\]\/cerrar/);
    expect(JSON.parse(JSON.stringify(solicitudes.find((s) => s.id === id)))).toEqual(antes);
    expect(auditLogs.filter((l) => l.recursoId === String(id))).toHaveLength(0);
  });

  // B. causalCierre solo
  it('B. rechaza con 400 al enviar solo causalCierre — sin escritura, sin AuditLog', async () => {
    const id = await crearSolicitudEnObservacionConSqr();
    const antes = JSON.parse(JSON.stringify(solicitudes.find((s) => s.id === id)));
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, causalCierre: 'texto' }),
    }));
    expect(res.status).toBe(400);
    expect(JSON.parse(JSON.stringify(solicitudes.find((s) => s.id === id)))).toEqual(antes);
    expect(auditLogs.filter((l) => l.recursoId === String(id))).toHaveLength(0);
  });

  // C. ambos campos
  it('C. rechaza con 400 al enviar ambos campos juntos — sin escritura, sin AuditLog', async () => {
    const id = await crearSolicitudEnObservacionConSqr();
    const antes = JSON.parse(JSON.stringify(solicitudes.find((s) => s.id === id)));
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, resultadoFinal: 'Adjudicado', causalCierre: 'texto' }),
    }));
    expect(res.status).toBe(400);
    expect(JSON.parse(JSON.stringify(solicitudes.find((s) => s.id === id)))).toEqual(antes);
    expect(auditLogs.filter((l) => l.recursoId === String(id))).toHaveLength(0);
  });

  // D. campos protegidos + campo legítimo
  it('D. rechaza con 400 incluso combinado con un campo legítimo — sin escritura parcial', async () => {
    const id = await crearSolicitudEnObservacionConSqr();
    const antes = JSON.parse(JSON.stringify(solicitudes.find((s) => s.id === id)));
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, resultadoFinal: 'Adjudicado', revisor: 'nuevo.revisor' }),
    }));
    expect(res.status).toBe(400);
    const actual = solicitudes.find((s) => s.id === id);
    expect(JSON.parse(JSON.stringify(actual))).toEqual(antes);
    expect(actual!.revisor).not.toBe('nuevo.revisor');
  });

  // Presencia con valores "inocuos" — null/vacío — igual se rechaza
  it('rechaza igual cuando el valor es null o cadena vacía — la PRESENCIA de la clave es lo que se evalúa, no su verdad', async () => {
    const id = await crearSolicitudEnObservacionConSqr();
    const { PATCH } = await import('./route');
    const resNull = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, resultadoFinal: null }),
    }));
    expect(resNull.status).toBe(400);
    const resVacio = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, causalCierre: '' }),
    }));
    expect(resVacio.status).toBe(400);
  });

  // E. protección contra efecto secundario (cerrarSqr)
  it('E. cerrarSqr() (invocado internamente vía fetch) NUNCA se llama cuando el PATCH es rechazado por este guard', async () => {
    const id = await crearSolicitudEnObservacionConSqr();
    const { PATCH } = await import('./route');
    await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, estadoSolicitud: 'En observación', resultadoFinal: 'No favorable' }),
    }));
    // Este payload es EXACTAMENTE el escenario documentado en la auditoría
    // (estadoFinalEvaluado==='En observación' && resultadoFinal==='No favorable'
    // ⇒ debeCerrarSqr) — si el guard no actuara ANTES de esa lógica, `fetch`
    // (usado internamente por `cerrarSqr`) se habría invocado.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // F. regresión — PATCH legítimo sin estos campos sigue funcionando
  it('F. un PATCH legítimo que no use resultadoFinal ni causalCierre sigue funcionando exactamente igual (200)', async () => {
    const id = await crearSolicitudEnObservacionConSqr();
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, agregarResponsables: [{ usuario: 'nicole.ortiz' }] }),
    }));
    expect(res.status).toBe(200);
  });

  // G. el guard no interfiere con la lógica normal de cierre de SQR cuando
  // el request SÍ es legítimo (no toca resultadoFinal/causalCierre).
  it('G. una edición legítima sin resultadoFinal/causalCierre en el body no dispara cerrarSqr por una razón distinta al guard (falta resultadoFinal, no por bloqueo)', async () => {
    const id = await crearSolicitudEnObservacionConSqr();
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, estadoSolicitud: 'En observación', revisor: 'ana.lopez' }),
    }));
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});