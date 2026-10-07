/**
 * FASE A.1 — PATCH /api/procesos/[id]/analisis-economico/conjunto/[conjuntoId]
 *
 *   { accion: "aprobar",  presupuestoOficialAprobado, puntajeMaximoEconomicoAprobado, provenance? }
 *        → T3: CONJUNTO ACTIVO anterior → SUPERSEDED, CANDIDATO → ACTIVO.
 *          Exige: todos los métodos revisados/aprobados + resolverCriteriosDeConjunto.ok
 *          + cobertura 00–99 + presupuesto + PM APROBADOS por el humano.
 *   { accion: "rechazar", motivo }
 *        → T2: CONJUNTO CANDIDATO → RECHAZADA, ACTIVO anterior intacto.
 *
 * Los métodos individuales se revisan con PATCH /api/ponderacion/metodos/[id].
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { requireSession, requireNoMercadeo } from '@/lib/authz';
import { auditLog } from '@/lib/audit';
import { aprobarConjunto, rechazarConjunto } from '@/lib/ponderacion-economica/conjunto-metodos/orquestador';
import { resolverCriteriosDeConjunto, estadoRevisionMetodosDeConjunto } from '@/lib/ponderacion-economica/robusto/gate-conjunto';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const pid = (v: string) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string; conjuntoId: string }> }) {
  const session = await getSession(req);
  const denied = requireSession(session) ?? requireNoMercadeo(session);
  if (denied) return denied;

  const p = await ctx.params;
  const procesoId = pid(p.id), conjuntoId = pid(p.conjuntoId);
  if (!procesoId || !conjuntoId) return NextResponse.json({ ok: false, error: 'ID inválido' }, { status: 400 });

  let body: { accion?: string; motivo?: string; presupuestoOficialAprobado?: number; puntajeMaximoEconomicoAprobado?: number; provenance?: Record<string, unknown> };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 }); }

  const conjunto = await prisma.conjuntoMetodosPonderacionProceso.findFirst({ where: { id: conjuntoId, procesoId }, select: { id: true, estadoVersion: true } });
  if (!conjunto) return NextResponse.json({ ok: false, error: 'Conjunto no encontrado para este proceso' }, { status: 404 });
  if (conjunto.estadoVersion !== 'CANDIDATA') return NextResponse.json({ ok: false, error: `Solo se puede revisar un CONJUNTO CANDIDATO (está en ${conjunto.estadoVersion})` }, { status: 409 });

  if (body.accion === 'aprobar') {
    // §3 — presupuesto/PM NO son requisito universal aquí: se envían si el
    // humano los tiene: el orquestador (vía validarPreAprobacionConjunto)
    // decide si son OBLIGATORIOS según si alguna fórmula del conjunto los
    // necesita / si algún método ya trae su propio PM. Nunca se fuerza > 0 en
    // esta capa — eso sería exigir presupuesto universalmente.
    const pres = body.presupuestoOficialAprobado != null ? Number(body.presupuestoOficialAprobado) : null;
    const pm = body.puntajeMaximoEconomicoAprobado != null ? Number(body.puntajeMaximoEconomicoAprobado) : null;
    try {
      await aprobarConjunto(procesoId, conjuntoId, session!.id, pres, pm, {
        presupuestoTextoFuente: (body.provenance?.presupuestoTextoFuente as string) ?? null,
        presupuestoPaginaReferencia: (body.provenance?.presupuestoPaginaReferencia as number) ?? null,
        presupuestoOrigen: (body.provenance?.presupuestoOrigen as string) ?? null, // "PROCESO_CANONICO" | "REVISION_HUMANA" | "FUENTE_EXPLICITA"
        puntajeMaximoTextoFuente: (body.provenance?.puntajeMaximoTextoFuente as string) ?? null,
        puntajeMaximoPaginaReferencia: (body.provenance?.puntajeMaximoPaginaReferencia as number) ?? null,
      });
    } catch (e) {
      // el mensaje trae la lista de errores de validarPreAprobacionConjunto (incl. "requiere presupuesto" si corresponde)
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'No se pudo aprobar el conjunto' }, { status: 422 });
    }
    const proc = await prisma.proceso.findUnique({ where: { id: procesoId }, select: { estadoRevisionPliego: true } });
    void auditLog({
      accion: 'conjunto_metodos_aprobado', recurso: `proceso/${procesoId}/conjunto/${conjuntoId}`, recursoId: String(conjuntoId),
      usuarioId: session!.id,
      detalle: { entidad: 'ConjuntoMetodosPonderacionProceso', entidadId: conjuntoId, despues: { estadoVersion: 'ACTIVA', presupuestoOficialAprobado: pres, puntajeMaximoEconomicoAprobado: pm }, estadoRevisionPliego: proc?.estadoRevisionPliego },
    });
    return NextResponse.json({ ok: true, estadoRevisionPliego: proc?.estadoRevisionPliego });
  }

  if (body.accion === 'rechazar') {
    const motivo = (body.motivo ?? '').trim();
    if (!motivo) return NextResponse.json({ ok: false, error: 'Se requiere motivo de rechazo' }, { status: 422 });
    await rechazarConjunto(procesoId, conjuntoId, session!.id, motivo);
    const proc = await prisma.proceso.findUnique({ where: { id: procesoId }, select: { estadoRevisionPliego: true } });
    void auditLog({ accion: 'conjunto_metodos_rechazado', recurso: `proceso/${procesoId}/conjunto/${conjuntoId}`, usuarioId: session!.id, detalle: { motivo } });
    return NextResponse.json({ ok: true, estadoRevisionPliego: proc?.estadoRevisionPliego, mensaje: 'CONJUNTO CANDIDATO rechazado. El CONJUNTO ACTIVO anterior (si existía) permanece intacto.' });
  }

  if (body.accion === 'estado' || !body.accion) {
    const [criterios, rev] = await Promise.all([resolverCriteriosDeConjunto(conjuntoId), estadoRevisionMetodosDeConjunto(conjuntoId)]);
    return NextResponse.json({ ok: true, criterios, revisionMetodos: rev });
  }

  return NextResponse.json({ ok: false, error: 'accion debe ser: aprobar | rechazar | estado' }, { status: 422 });
}
