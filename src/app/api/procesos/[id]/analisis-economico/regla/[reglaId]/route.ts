/**
 * FASE A.1 — PATCH /api/procesos/[id]/analisis-economico/regla/[reglaId]
 *
 *   { accion: "editar",   campos: {...} }    → corrige la CANDIDATA in situ (sigue CANDIDATA)
 *   { accion: "aprobar" }                    → T3: ACTIVA anterior → SUPERSEDED, CANDIDATA → ACTIVA
 *   { accion: "rechazar", motivo: "..." }    → T2: CANDIDATA → RECHAZADA, ACTIVA anterior intacta
 *
 * Gemini nunca llega aquí (exige sesión humana). `Proceso.estadoRevisionPliego`
 * lo recalcula el orquestador con `sincronizarEstadoRevisionPliego` (regla +
 * conjunto de métodos, coherentes).
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { requireSession, requireNoMercadeo } from '@/lib/authz';
import { auditLog } from '@/lib/audit';
import { aprobarCandidataRegla, rechazarCandidataRegla } from '@/lib/ponderacion-economica/regla-trm/orquestador';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const pid = (v: string) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

const TIPOS_REGLA = ['RELATIVA_A_EVENTO', 'FECHA_FIJA', 'NO_APLICA', 'OTRA'];
const EVENTOS = ['FECHA_CIERRE', 'FECHA_PRESENTACION_OFERTAS', 'FIN_TRASLADO_INFORME_EVALUACION', 'AUDIENCIA_ADJUDICACION', 'OTRO'];
const POLITICAS = ['SIGUE_CRONOGRAMA', 'CONGELADA_INICIAL', 'OTRA'];
const CENTAVOS = ['NO_DEFINIDA', 'REDONDEO', 'TRUNCADO', 'OTRA'];

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string; reglaId: string }> }) {
  const session = await getSession(req);
  const denied = requireSession(session) ?? requireNoMercadeo(session);
  if (denied) return denied;

  const p = await ctx.params;
  const procesoId = pid(p.id), reglaId = pid(p.reglaId);
  if (!procesoId || !reglaId) return NextResponse.json({ ok: false, error: 'ID inválido' }, { status: 400 });

  let body: { accion?: string; motivo?: string; campos?: Record<string, unknown> };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 }); }

  // §2 — inmutabilidad: se selecciona el estado completo ANTES de cualquier
  // cambio para poder auditar antes/después campo por campo, y para bloquear
  // cualquier edición si la regla ya no es CANDIDATA (ACTIVA/SUPERSEDED/
  // RECHAZADA son inmutables — la única corrección legítima es una nueva
  // versión CANDIDATA que compita/reemplace).
  const regla = await prisma.reglaTrmProceso.findFirst({
    where: { id: reglaId, procesoId },
    select: {
      id: true, estadoVersion: true, reglaCentavos: true,
      tipoReglaTrm: true, eventoBaseTrm: true, fuenteEventoBase: true, offsetDiasHabiles: true,
      politicaActualizacionFecha: true, fechaBaseCongelada: true, fechaFijaTrm: true, textoReglaTrm: true,
    },
  });
  if (!regla) return NextResponse.json({ ok: false, error: 'Regla no encontrada para este proceso' }, { status: 404 });
  if (regla.estadoVersion !== 'CANDIDATA' && body.accion === 'editar') {
    return NextResponse.json({
      ok: false,
      error: `No se puede editar: la regla está en estado ${regla.estadoVersion} (inmutable). Si necesita corrección, un nuevo análisis crea una nueva versión CANDIDATA para corregirla allí antes de aprobarla.`,
    }, { status: 409 });
  }
  if (regla.estadoVersion !== 'CANDIDATA') return NextResponse.json({ ok: false, error: `Solo se puede revisar una regla CANDIDATA (está en ${regla.estadoVersion})` }, { status: 409 });

  if (body.accion === 'editar') {
    const c = body.campos ?? {};
    const data: Record<string, unknown> = { origenTransicion: 'HUMANO' };
    if (typeof c.tipoReglaTrm === 'string') { if (!TIPOS_REGLA.includes(c.tipoReglaTrm)) return NextResponse.json({ ok: false, error: 'tipoReglaTrm inválido' }, { status: 422 }); data.tipoReglaTrm = c.tipoReglaTrm; }
    if (c.eventoBaseTrm === null || typeof c.eventoBaseTrm === 'string') { if (typeof c.eventoBaseTrm === 'string' && !EVENTOS.includes(c.eventoBaseTrm)) return NextResponse.json({ ok: false, error: 'eventoBaseTrm inválido' }, { status: 422 }); data.eventoBaseTrm = c.eventoBaseTrm; }
    if (c.fuenteEventoBase === null || typeof c.fuenteEventoBase === 'string') data.fuenteEventoBase = c.fuenteEventoBase;
    if (c.offsetDiasHabiles === null || Number.isInteger(c.offsetDiasHabiles)) data.offsetDiasHabiles = c.offsetDiasHabiles;
    if (c.politicaActualizacionFecha === null || typeof c.politicaActualizacionFecha === 'string') { if (typeof c.politicaActualizacionFecha === 'string' && !POLITICAS.includes(c.politicaActualizacionFecha)) return NextResponse.json({ ok: false, error: 'politicaActualizacionFecha inválida' }, { status: 422 }); data.politicaActualizacionFecha = c.politicaActualizacionFecha; }
    if (c.fechaBaseCongelada === null || (typeof c.fechaBaseCongelada === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.fechaBaseCongelada))) data.fechaBaseCongelada = c.fechaBaseCongelada ? new Date(c.fechaBaseCongelada) : null;
    if (c.fechaFijaTrm === null || (typeof c.fechaFijaTrm === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.fechaFijaTrm))) data.fechaFijaTrm = c.fechaFijaTrm ? new Date(c.fechaFijaTrm) : null;
    if (typeof c.reglaCentavos === 'string') { if (!CENTAVOS.includes(c.reglaCentavos)) return NextResponse.json({ ok: false, error: 'reglaCentavos inválido' }, { status: 422 }); data.reglaCentavos = c.reglaCentavos; }
    if (c.textoReglaTrm === null || typeof c.textoReglaTrm === 'string') data.textoReglaTrm = c.textoReglaTrm;
    if (Object.keys(data).length === 1) return NextResponse.json({ ok: false, error: 'Nada que editar' }, { status: 422 });
    // politicaActualizacionFecha = CONGELADA_INICIAL sin fecha aún no es aprobable (lo valida resolver-fecha al usarla),
    // pero se permite guardar en borrador mientras el revisor completa el dato.

    // §3 — trazabilidad campo por campo: antes = solo los campos que van a
    // cambiar, tomados de la fila leída ANTES del update (no un mensaje genérico).
    const antes: Record<string, unknown> = {};
    for (const k of Object.keys(data)) { if (k !== 'origenTransicion') antes[k] = (regla as Record<string, unknown>)[k]; }

    // §2 — atomicidad: UPDATE + AuditLog en la MISMA transacción (ver
    // src/lib/audit.ts: `auditLog(params, tx)` relanza si falla → rollback).
    let upd;
    try {
      upd = await prisma.$transaction(async (tx) => {
        const r = await tx.reglaTrmProceso.update({
          where: { id: reglaId }, data: data as never,
          select: { id: true, tipoReglaTrm: true, eventoBaseTrm: true, fuenteEventoBase: true, reglaCentavos: true, offsetDiasHabiles: true, politicaActualizacionFecha: true, fechaBaseCongelada: true, fechaFijaTrm: true },
        });
        await auditLog({
          accion: 'regla_trm_editada', recurso: `proceso/${procesoId}/regla/${reglaId}`, recursoId: String(reglaId),
          usuarioId: session!.id, detalle: { entidad: 'ReglaTrmProceso', entidadId: reglaId, antes, despues: data },
        }, tx);
        return r;
      });
    } catch {
      return NextResponse.json({ ok: false, error: 'No se pudo guardar el cambio (falló el registro de auditoría; no se aplicó nada).' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, regla: upd });
  }

  if (body.accion === 'aprobar') {
    if (regla.reglaCentavos !== 'REDONDEO' && regla.reglaCentavos !== 'TRUNCADO') {
      return NextResponse.json({ ok: false, error: `No se puede aprobar: reglaCentavos = ${regla.reglaCentavos}. Edítala a REDONDEO o TRUNCADO según el pliego.` }, { status: 422 });
    }
    try {
      await aprobarCandidataRegla(procesoId, reglaId, session!.id);
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'No se pudo aprobar' }, { status: 409 });
    }
    const proc = await prisma.proceso.findUnique({ where: { id: procesoId }, select: { estadoRevisionPliego: true } });
    void auditLog({ accion: 'regla_trm_aprobada', recurso: `proceso/${procesoId}/regla/${reglaId}`, usuarioId: session!.id, detalle: { estado: proc?.estadoRevisionPliego } });
    return NextResponse.json({ ok: true, estadoRevisionPliego: proc?.estadoRevisionPliego });
  }

  if (body.accion === 'rechazar') {
    const motivo = (body.motivo ?? '').trim();
    if (!motivo) return NextResponse.json({ ok: false, error: 'Se requiere motivo de rechazo' }, { status: 422 });
    await rechazarCandidataRegla(procesoId, reglaId, session!.id, motivo);
    const proc = await prisma.proceso.findUnique({ where: { id: procesoId }, select: { estadoRevisionPliego: true } });
    void auditLog({ accion: 'regla_trm_rechazada', recurso: `proceso/${procesoId}/regla/${reglaId}`, usuarioId: session!.id, detalle: { motivo } });
    return NextResponse.json({ ok: true, estadoRevisionPliego: proc?.estadoRevisionPliego, mensaje: 'CANDIDATA rechazada. La regla ACTIVA anterior (si existía) permanece intacta.' });
  }

  return NextResponse.json({ ok: false, error: 'accion debe ser: editar | aprobar | rechazar' }, { status: 422 });
}
