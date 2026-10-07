/**
 * POST /api/solicitudes/[id]/transicion — FASE 2: autoridad server-side
 * para las 8 transiciones INTERMEDIAS de `Solicitud.estadoSolicitud`
 * (Validación/Ejecución). Deliberadamente NO cubre cierres, rechazos,
 * cancelaciones, adjudicaciones — esos siguen en
 * `POST /api/solicitudes/[id]/cerrar` (matriz de resultados, `resultadoFinal`,
 * `causalCierre`, CAS y auditoría propios).
 *
 * Body permitido: SOLO `{ accion, estadoEsperado, motivo? }`. Nunca acepta
 * `estadoNuevo`, `asignaciones[]`, `actor`/`usuario`/`rol` — el actor se
 * resuelve exclusivamente vía `resolverUsuarioSesionActivo` (sesión + BD),
 * nunca del body.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireSession } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { resolverUsuarioSesionActivo } from '@/lib/solicitudes/autorizacion-asignacion';
import { ejecutarTransicionEstado, type DbTransiciones } from '@/lib/solicitudes/transiciones-estado';

const CLAVES_BODY_PERMITIDAS = new Set(['accion', 'estadoEsperado', 'motivo']);
const MAX_LONGITUD_MOTIVO = 2000;

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const noAuth = requireSession(session);
  if (noAuth) return noAuth;

  const { id } = await context.params;
  const dbId = Number(id);
  if (!Number.isFinite(dbId) || dbId <= 0) {
    return NextResponse.json({ ok: false, error: 'ID inválido.' }, { status: 400 });
  }

  let bodyRaw: unknown = {};
  try {
    bodyRaw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Cuerpo de la petición inválido.' }, { status: 400 });
  }
  if (bodyRaw == null || typeof bodyRaw !== 'object' || Array.isArray(bodyRaw)) {
    return NextResponse.json({ ok: false, error: 'Cuerpo de la petición inválido: se esperaba un objeto.' }, { status: 400 });
  }
  const body = bodyRaw as Record<string, unknown>;

  // Allowlist top-level estricta — cualquier otra clave (incluidos
  // `estadoNuevo`, `asignaciones`, `actor`, `usuario`, `rol`) rechaza la
  // petición completa con 400, nunca se ignora en silencio.
  for (const clave of Object.keys(body)) {
    if (!CLAVES_BODY_PERMITIDAS.has(clave)) {
      return NextResponse.json({ ok: false, error: `Campo no permitido en el body: "${clave}".` }, { status: 400 });
    }
  }

  const accion = typeof body.accion === 'string' ? body.accion.trim() : '';
  const estadoEsperado = typeof body.estadoEsperado === 'string' ? body.estadoEsperado.trim() : '';
  if (!accion || !estadoEsperado) {
    return NextResponse.json({ ok: false, error: '"accion" y "estadoEsperado" son requeridos.' }, { status: 400 });
  }

  // Fase 2B-2.2.4 — "FINALIZAR_REVISION" (EN_OBSERVACION→APROBADO_ELABORACION)
  // ya NO se ejecuta por esta vía genérica: `ejecutarTransicionEstado`
  // espeja el estado nuevo a TODAS las filas de `asignaciones[]`, y
  // `autorizarTransicion` autoriza a cualquier responsable activo de la
  // SOLICITUD completa (no de la fila objetivo) — ambos incompatibles con
  // la autorización y el alcance estrictamente por-fila que ya garantiza
  // `POST /api/solicitudes/[id]/finalizar-revision` (Fase 2B-2.2.1), única
  // autoridad para esta transición. Rechazo ESTRUCTURAL: se evalúa antes de
  // resolver el actor, antes de leer/tocar la Solicitud, y antes de llamar
  // a `ejecutarTransicionEstado` — ocurre sin importar el estado real, el
  // usuario, su autorización, ni el valor de `estadoEsperado`. Se conserva
  // la propia acción en `ACCIONES_TRANSICION`/`MATRIZ_ACCIONES`
  // (`transiciones-estado.ts`) porque el endpoint dedicado reutiliza
  // `resolverTransicion('FINALIZAR_REVISION', ...)` — solo se bloquea el
  // acceso a través de ESTE endpoint genérico.
  if (accion === 'FINALIZAR_REVISION') {
    return NextResponse.json({
      ok: false,
      error: 'La acción "FINALIZAR_REVISION" ya no se ejecuta mediante este endpoint — usa POST /api/solicitudes/[id]/finalizar-revision.',
    }, { status: 400 });
  }

  // Fase 2B-2.2.6 — "ENVIAR_A_OBSERVACION" (EN_REVISION→EN_OBSERVACION)
  // tiene el mismo problema estructural que ya motivó el rechazo de
  // FINALIZAR_REVISION arriba: `ejecutarTransicionEstado` espejaría el
  // estado nuevo a TODAS las filas, y `autorizarTransicion` autoriza a
  // cualquier responsable activo de la SOLICITUD (no de la fila objetivo).
  // `POST /api/solicitudes/[id]/observaciones` ya es la autoridad
  // transaccional y por-fila para "agregar la primera observación" (que
  // produce esta misma transición) desde antes de esta serie de fases.
  // Rechazo ESTRUCTURAL: antes de resolver actor/BD/`ejecutarTransicionEstado`,
  // sin importar estado real, usuario o autorización. Se conserva la
  // acción en `ACCIONES_TRANSICION`/`MATRIZ_ACCIONES` — no se usa desde
  // aquí, pero no se elimina de la matriz compartida.
  if (accion === 'ENVIAR_A_OBSERVACION') {
    return NextResponse.json({
      ok: false,
      error: 'La acción "ENVIAR_A_OBSERVACION" ya no se ejecuta mediante este endpoint — usa POST /api/solicitudes/[id]/observaciones.',
    }, { status: 400 });
  }

  // Fase 2B-2.2.7 — "REENVIAR_REVISION" (EN_OBSERVACION→EN_REVISION) tiene
  // el mismo problema estructural que ya motivó el rechazo de
  // FINALIZAR_REVISION/ENVIAR_A_OBSERVACION arriba: `ejecutarTransicionEstado`
  // espejaría el estado nuevo a TODAS las filas, y `autorizarTransicion`
  // autoriza a cualquier responsable activo de la SOLICITUD (no de la fila
  // objetivo). `POST /api/solicitudes/[id]/reenviar-revision` ya es la
  // autoridad transaccional y por-fila para esta transición (vaciar la
  // última observación de una fila concreta) desde antes de esta serie de
  // fases. Rechazo ESTRUCTURAL: antes de resolver actor/BD/
  // `ejecutarTransicionEstado`, sin importar estado real, usuario o
  // autorización. Se conserva la acción en `ACCIONES_TRANSICION`/
  // `MATRIZ_ACCIONES` — no se usa desde aquí, pero no se elimina de la
  // matriz compartida.
  if (accion === 'REENVIAR_REVISION') {
    return NextResponse.json({
      ok: false,
      error: 'La acción "REENVIAR_REVISION" ya no se ejecuta mediante este endpoint — usa POST /api/solicitudes/[id]/reenviar-revision.',
    }, { status: 400 });
  }

  let motivo: string | null = null;
  if (body.motivo !== undefined && body.motivo !== null) {
    if (typeof body.motivo !== 'string') {
      return NextResponse.json({ ok: false, error: '"motivo" debe ser texto.' }, { status: 400 });
    }
    if (body.motivo.length > MAX_LONGITUD_MOTIVO) {
      return NextResponse.json({ ok: false, error: `"motivo" excede el máximo de ${MAX_LONGITUD_MOTIVO} caracteres.` }, { status: 400 });
    }
    motivo = body.motivo.trim() || null;
  }

  // El actor SIEMPRE se resuelve de sesión + BD — nunca del body.
  const actor = await resolverUsuarioSesionActivo(prisma, session!);
  if (!actor) {
    return NextResponse.json({ ok: false, error: 'Usuario no encontrado o inactivo.' }, { status: 403 });
  }

  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();

  const resultado = await ejecutarTransicionEstado({
    db: prisma as unknown as DbTransiciones,
    solicitudId: dbId,
    accion,
    estadoEsperadoCrudo: estadoEsperado,
    actor,
    motivo,
    requestId,
  });

  if (!resultado.ok) {
    return NextResponse.json({ ok: false, error: resultado.error }, { status: resultado.status });
  }
  return NextResponse.json({
    ok: true,
    estadoAnterior: resultado.estadoAnterior,
    estadoNuevo: resultado.estadoNuevo,
    solicitud: resultado.solicitud,
  });
}