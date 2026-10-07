/**
 * Ajuste "editar/eliminar observaciones" — integración real de PATCH
 * /api/solicitudes contra el gate específico `filasConEliminacionObservacion`/
 * `filasConEdicionContenidoObservacion` (ver `analizarCambiosAsignaciones`/
 * `clasificarCambiosObservaciones` en `./route.ts`).
 *
 * Reglas finales (revisión en vivo sobre el requerimiento original "solo
 * Administrador"):
 *  - Eliminar una observación existente: Administrador de Procesos O quien
 *    la creó (`observaciones[].usuario` === actor) — NINGÚN otro usuario la
 *    puede eliminar, ni siquiera un co-responsable del mismo proceso que sí
 *    puede editarla (caso explícito: "si hay dos responsables y persona 1
 *    creó la obs, persona 2 no podrá eliminarla, solo editar").
 *  - Editar el contenido de una observación existente: Administrador de
 *    Procesos O cualquier usuario que pertenezca al proceso comercial
 *    (`puedeConBD(rol,'asignaciones','editar')` — la matriz hardcodeada da
 *    esto a 'Analista Comercial'/'Coordinador Comercial'/'Director
 *    Comercial'; 'Usuario Final' NO lo tiene).
 *  - Agregar una observación nueva o marcar Aceptada/No aceptada en una ya
 *    existente sigue permitido para el propio responsable de la fila, sin
 *    cambios.
 *  - Ninguna de las dos acciones procede si la Solicitud ya está cerrada
 *    (`ESTADOS_SOLICITUD_TERMINALES`).
 *
 * Prueba comportamiento real end-to-end (llamando al handler exportado),
 * no strings de código.
 *
 * Fixture con DOS filas de `asignaciones` (dos responsables reales del
 * mismo proceso, `canAccessSolicitud` los reconoce a ambos) — necesario
 * porque un usuario sin NINGUNA relación con la solicitud es rechazado
 * antes de llegar a este gate por la autorización general del PATCH
 * (`canAccessSolicitud`/Path 1/Path 2), que es un requisito distinto y ya
 * cubierto por otros tests de `route.test.ts`.
 *
 * Mismo patrón de fake-prisma/sesión mutable que
 * `[id]/reenviar-revision/route.test.ts` (sesión dinámica por test, distinto
 * del mock estático de `route.test.ts`).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

interface UsuarioFake { id: number; usuario: string; email: string; rol: string; estado: string; }
// JUAN: responsable de ASG-1 y creador de la observación en esa fila —
// rol 'Analista Comercial', que la matriz hardcodeada de `puedeConBD` ya
// clasifica como "proceso comercial" (asignaciones.editar=true).
const JUAN: UsuarioFake = { id: 10, usuario: 'juan.davila', email: 'juan.davila@grupocolba.com', rol: 'Analista Comercial', estado: 'Activo' };
// OTRO_COMERCIAL: co-responsable del MISMO proceso (fila ASG-2, distinta de
// la de JUAN) — mismo rol 'Analista Comercial' (deliberadamente NO
// 'Coordinador Comercial'/'Director Comercial': esos ya califican como
// `esAdministradorProcesos` en `authz.ts`, lo que los volvería admin para
// este gate y no probaría nada distinto). NO creó la observación de ASG-1
// — puede Editarla (comercial), no puede Eliminarla.
const OTRO_COMERCIAL: UsuarioFake = { id: 12, usuario: 'nicole.ortiz', email: 'nicole.ortiz@grupocolba.com', rol: 'Analista Comercial', estado: 'Activo' };
// NO_COMERCIAL: responsable de una tercera fila (ASG-3, así `canAccessSolicitud`
// lo reconoce) pero con rol sin `asignaciones.editar` en la matriz — no
// puede ni Editar ni Eliminar la observación de ASG-1 (ninguna condición lo autoriza).
const NO_COMERCIAL: UsuarioFake = { id: 11, usuario: 'ajeno', email: 'ajeno@grupocolba.com', rol: 'Usuario Final', estado: 'Activo' };
const ADMIN: UsuarioFake = { id: 6, usuario: 'admin.proc', email: 'admin.proc@grupocolba.com', rol: 'Administrador', estado: 'Activo' };

let solicitud: Record<string, unknown>;
let sesionActual: { id: number; email: string; rol: string; usuario: string } | null;

function filaAsg1() {
  return {
    idAsignacion: 'ASG-1',
    analistaAsignado: JUAN.usuario,
    estadoRevision: 'CON_OBSERVACIONES',
    observaciones: [
      { tipoCausa: 'Otro', causaEspecifica: 'Otro concepto', detalle: 'detalle original', usuario: JUAN.usuario, fecha: '2026-08-01', decision: '' },
    ],
  };
}
function filaAsg2() {
  return { idAsignacion: 'ASG-2', analistaAsignado: OTRO_COMERCIAL.usuario, estadoRevision: 'CON_OBSERVACIONES', observaciones: [] };
}
function filaAsg3() {
  return { idAsignacion: 'ASG-3', analistaAsignado: NO_COMERCIAL.usuario, estadoRevision: 'CON_OBSERVACIONES', observaciones: [] };
}

function resetFixture() {
  solicitud = {
    id: 700, estadoSolicitud: 'EN_OBSERVACION', procesoId: null,
    asignaciones: [filaAsg1(), filaAsg2(), filaAsg3()],
  };
  sesionActual = { id: JUAN.id, email: JUAN.email, rol: JUAN.rol, usuario: JUAN.usuario };
}

const fakeImpl = {
  solicitud: {
    async findUnique({ where }: { where: { id: number } }) {
      return where.id === solicitud.id ? JSON.parse(JSON.stringify(solicitud)) : null;
    },
  },
  perfilRol: {
    async findFirst() { return null; }, // ningún rol de negocio tiene `asig_gestionar` en este fixture
  },
  auditLog: {
    async create({ data }: { data: Record<string, unknown> }) { return { id: 1, ...data }; },
  },
  async $transaction<T>(cb: (tx: unknown) => Promise<T>): Promise<T> {
    return cb({
      solicitud: {
        async update({ where, data }: { where: { id: number }; data: Record<string, unknown> }) {
          if (where.id !== solicitud.id) throw new Error('No encontrado');
          solicitud = { ...solicitud, ...data };
          return JSON.parse(JSON.stringify(solicitud));
        },
      },
      auditLog: fakeImpl.auditLog,
    });
  },
};

vi.mock('@/lib/prisma', () => ({ default: fakeImpl }));
vi.mock('@/lib/session', () => ({ getSession: async () => sesionActual }));

/** Envía SIEMPRE las 3 filas (ASG-1 modificada según `cambiosAsg1`, ASG-2 y
 * ASG-3 intactas) — el análisis por posición de `analizarCambiosAsignaciones`
 * exige igual longitud entre BD y el body para no tratarlo como reasignación. */
function patchReqAsg1(cambiosAsg1: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/solicitudes', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: solicitud.id, asignaciones: [{ ...filaAsg1(), ...cambiosAsg1 }, filaAsg2(), filaAsg3()] }),
  });
}

describe('PATCH /api/solicitudes — Editar observación existente (Administrador o proceso comercial)', () => {
  beforeEach(resetFixture);

  it('1. Administrador puede editar el detalle -> 200', async () => {
    sesionActual = { id: ADMIN.id, email: ADMIN.email, rol: ADMIN.rol, usuario: ADMIN.usuario };
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReqAsg1({ observaciones: [{ ...filaAsg1().observaciones[0], detalle: 'detalle EDITADO por admin' }] }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    const filaFinal = (solicitud.asignaciones as Record<string, unknown>[])[0];
    expect((filaFinal.observaciones as Record<string, unknown>[])[0].detalle).toBe('detalle EDITADO por admin');
  });

  it('2. Un co-responsable del proceso comercial que NO creó la observación ni es dueño de esa fila SÍ puede editarla -> 200', async () => {
    sesionActual = { id: OTRO_COMERCIAL.id, email: OTRO_COMERCIAL.email, rol: OTRO_COMERCIAL.rol, usuario: OTRO_COMERCIAL.usuario };
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReqAsg1({ observaciones: [{ ...filaAsg1().observaciones[0], detalle: 'detalle editado por otro comercial' }] }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    const filaFinal = (solicitud.asignaciones as Record<string, unknown>[])[0];
    expect((filaFinal.observaciones as Record<string, unknown>[])[0].detalle).toBe('detalle editado por otro comercial');
  });

  it('3. Un responsable SIN pertenecer al proceso comercial (rol "Usuario Final") NO puede editar -> 403, sin escritura', async () => {
    sesionActual = { id: NO_COMERCIAL.id, email: NO_COMERCIAL.email, rol: NO_COMERCIAL.rol, usuario: NO_COMERCIAL.usuario };
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReqAsg1({ observaciones: [{ ...filaAsg1().observaciones[0], detalle: 'intento de edición no autorizado' }] }));
    const data = await res.json();
    expect(res.status).toBe(403);
    expect(data.ok).toBe(false);
    expect(String(data.error)).toMatch(/proceso comercial/);
    const filaFinal = (solicitud.asignaciones as Record<string, unknown>[])[0];
    expect((filaFinal.observaciones as Record<string, unknown>[])[0].detalle).toBe('detalle original');
  });

  it('4. Editar una observación de una Solicitud ya CERRADA se rechaza -> 409, sin escritura (ni para Administrador)', async () => {
    solicitud.estadoSolicitud = 'Cerrada';
    sesionActual = { id: ADMIN.id, email: ADMIN.email, rol: ADMIN.rol, usuario: ADMIN.usuario };
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReqAsg1({ observaciones: [{ ...filaAsg1().observaciones[0], detalle: 'no debería aplicarse' }] }));
    const data = await res.json();
    expect(res.status).toBe(409);
    expect(data.ok).toBe(false);
    const filaFinal = (solicitud.asignaciones as Record<string, unknown>[])[0];
    expect((filaFinal.observaciones as Record<string, unknown>[])[0].detalle).toBe('detalle original');
  });
});

describe('PATCH /api/solicitudes — Eliminar observación existente (Administrador o quien la creó)', () => {
  beforeEach(resetFixture);

  it('5b. Eliminar UNA observación entre varias solo elimina la seleccionada — las demás permanecen intactas (mecanismo canónico para este caso: PATCH genérico, no reenviar-revision, que es exclusivo de vaciar la ÚLTIMA)', async () => {
    sesionActual = { id: ADMIN.id, email: ADMIN.email, rol: ADMIN.rol, usuario: ADMIN.usuario };
    const fila = filaAsg1();
    const segunda = { tipoCausa: 'Otro', causaEspecifica: 'Otro concepto', detalle: 'segunda observación', usuario: OTRO_COMERCIAL.usuario, fecha: '2026-08-10', decision: '' };
    fila.observaciones = [fila.observaciones[0], segunda];
    solicitud.asignaciones = [fila, filaAsg2(), filaAsg3()];
    const { PATCH } = await import('./route');
    // Elimina SOLO la primera (detalle original), conserva la segunda.
    const res = await PATCH(patchReqAsg1({ observaciones: [segunda] }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    const filaFinal = (solicitud.asignaciones as Record<string, unknown>[])[0];
    const obsFinal = filaFinal.observaciones as Record<string, unknown>[];
    expect(obsFinal).toHaveLength(1);
    expect(obsFinal[0].detalle).toBe('segunda observación');
  });

  it('5. Administrador puede eliminar una observación existente -> 200, arreglo queda vacío', async () => {
    sesionActual = { id: ADMIN.id, email: ADMIN.email, rol: ADMIN.rol, usuario: ADMIN.usuario };
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReqAsg1({ observaciones: [] }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    const filaFinal = (solicitud.asignaciones as Record<string, unknown>[])[0];
    expect(filaFinal.observaciones).toEqual([]);
  });

  it('6. JUAN (creador original de la observación) SÍ puede eliminarla, sin ser administrador -> 200', async () => {
    // sesionActual ya es JUAN (resetFixture) y la observación de ASG-1 tiene usuario: JUAN.usuario
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReqAsg1({ observaciones: [] }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('7. Persona 2 (co-responsable del mismo proceso, puede editar) NO creó la observación de ASG-1 -> NO puede eliminarla -> 403, sin escritura', async () => {
    sesionActual = { id: OTRO_COMERCIAL.id, email: OTRO_COMERCIAL.email, rol: OTRO_COMERCIAL.rol, usuario: OTRO_COMERCIAL.usuario };
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReqAsg1({ observaciones: [] }));
    const data = await res.json();
    expect(res.status).toBe(403);
    expect(data.ok).toBe(false);
    expect(String(data.error)).toMatch(/quien creó la observación/);
    const filaFinal = (solicitud.asignaciones as Record<string, unknown>[])[0];
    expect((filaFinal.observaciones as Record<string, unknown>[]).length).toBe(1);
  });

  it('8. Un responsable sin vínculo comercial (ni creador, ni comercial, ni admin) tampoco puede eliminar -> 403', async () => {
    sesionActual = { id: NO_COMERCIAL.id, email: NO_COMERCIAL.email, rol: NO_COMERCIAL.rol, usuario: NO_COMERCIAL.usuario };
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReqAsg1({ observaciones: [] }));
    expect(res.status).toBe(403);
  });

  it('9. Eliminar una observación de una Solicitud ya CERRADA se rechaza -> 409, sin escritura (ni para Administrador)', async () => {
    solicitud.estadoSolicitud = 'Cerrada';
    sesionActual = { id: ADMIN.id, email: ADMIN.email, rol: ADMIN.rol, usuario: ADMIN.usuario };
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReqAsg1({ observaciones: [] }));
    const data = await res.json();
    expect(res.status).toBe(409);
    expect(data.ok).toBe(false);
    const filaFinal = (solicitud.asignaciones as Record<string, unknown>[])[0];
    expect((filaFinal.observaciones as Record<string, unknown>[]).length).toBe(1);
  });
});

describe('PATCH /api/solicitudes — flujos previos sin cambios (agregar / marcar decisión)', () => {
  beforeEach(resetFixture);

  it('10. El responsable de la fila SÍ puede agregar una observación nueva (append) sin ser administrador -> 200', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReqAsg1({
      observaciones: [
        ...filaAsg1().observaciones,
        { tipoCausa: 'Otro', causaEspecifica: 'Otro concepto', detalle: 'observación nueva agregada por JUAN', usuario: JUAN.usuario, fecha: '2026-08-20', decision: '' },
      ],
    }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    const filaFinal = (solicitud.asignaciones as Record<string, unknown>[])[0];
    expect((filaFinal.observaciones as Record<string, unknown>[])).toHaveLength(2);
  });

  it('11. El responsable de la fila SÍ puede marcar decision (Aceptada/No aceptada) en una observación existente sin ser administrador -> 200', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReqAsg1({ observaciones: [{ ...filaAsg1().observaciones[0], decision: 'aceptada' }] }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    const filaFinal = (solicitud.asignaciones as Record<string, unknown>[])[0];
    expect((filaFinal.observaciones as Record<string, unknown>[])[0].decision).toBe('aceptada');
  });

  it('12. Los cambios que no tocan `asignaciones` no disparan este gate ni alteran datos — un PATCH sin `asignaciones` en el body sigue funcionando igual que antes', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(new NextRequest('http://localhost/api/solicitudes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: solicitud.id }),
    }));
    expect(res.status).toBe(200);
    const filaFinal = (solicitud.asignaciones as Record<string, unknown>[])[0];
    expect((filaFinal.observaciones as Record<string, unknown>[])[0].detalle).toBe('detalle original');
  });
});
