/**
 * FASE A.1 — Análisis económico del pliego, ligado SIEMPRE a Proceso.id.
 *
 *   GET   /api/procesos/[id]/analisis-economico   → estado (documentos, regla ACTIVA/CANDIDATA, conjunto ACTIVO/CANDIDATO, gate)
 *   POST  /api/procesos/[id]/analisis-economico   → registrar un PDF (metadata + refs UploadThing) declarado como portador de los criterios económicos
 *   PATCH /api/procesos/[id]/analisis-economico   → confirmar/descartar el gate USA_PONDERACION_TRM (§1) — SOLO humano, Gemini nunca lo confirma
 *
 * No modifica producción existente. Módulo económico = mismo guard que TRM
 * (requireNoMercadeo).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { requireSession, requireNoMercadeo } from '@/lib/authz';
import { LIMITES_DOCUMENTO } from '@/lib/ponderacion-economica/documento/leer-binario';
import { auditLog } from '@/lib/audit';
import { sincronizarEstadoRevisionPliego } from '@/lib/ponderacion-economica/sincronizar-estado-pliego';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(v: string): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const denied = requireSession(session) ?? requireNoMercadeo(session);
  if (denied) return denied;

  const procesoId = parseId((await ctx.params).id);
  if (!procesoId) return NextResponse.json({ ok: false, error: 'ID inválido' }, { status: 400 });

  const proceso = await prisma.proceso.findUnique({
    where: { id: procesoId },
    select: { id: true, nombre: true, codigoProceso: true, entidad: true, estadoRevisionPliego: true, usaPonderacionTrm: true },
  });
  if (!proceso) return NextResponse.json({ ok: false, error: 'Proceso no encontrado' }, { status: 404 });

  const [documentos, reglas, conjuntos] = await Promise.all([
    prisma.documentoAnalisisEconomicoProceso.findMany({
      where: { procesoId },
      orderBy: { cargadoEn: 'desc' },
      select: {
        id: true, nombreArchivo: true, mimeType: true, tamanoBytes: true, hashArchivo: true,
        nPaginas: true, rol: true, estadoAnalisis: true, errorAnalisis: true, cargadoEn: true,
        storageBackend: true,
        cargadoPor: { select: { id: true, usuario: true } },
        _count: { select: { analisis: true } },
      },
    }),
    prisma.reglaTrmProceso.findMany({
      where: { procesoId, estadoVersion: { in: ['ACTIVA', 'CANDIDATA'] } },
      orderBy: { version: 'desc' },
    }),
    prisma.conjuntoMetodosPonderacionProceso.findMany({
      where: { procesoId, estadoVersion: { in: ['ACTIVA', 'CANDIDATA'] } },
      orderBy: { version: 'desc' },
      include: {
        metodos: {
          orderBy: { rangoTrmDesde: 'asc' },
          select: {
            id: true, nombreMetodo: true, tipoFormula: true, rangoTrmDesde: true, rangoTrmHasta: true,
            puntajeMaximo: true, formulaTexto: true, textoFuente: true, paginaReferencia: true,
            confianzaExtraccion: true, estadoRevision: true, aprobado: true,
          },
        },
      },
    }),
  ]);

  const conjNum = (c: any) => c && ({
    ...c,
    presupuestoOficialAprobado: c.presupuestoOficialAprobado != null ? Number(c.presupuestoOficialAprobado) : null,
    puntajeMaximoEconomicoAprobado: c.puntajeMaximoEconomicoAprobado != null ? Number(c.puntajeMaximoEconomicoAprobado) : null,
    metodos: c.metodos.map((m: any) => ({
      ...m,
      puntajeMaximo: m.puntajeMaximo != null ? Number(m.puntajeMaximo) : null,
      confianzaExtraccion: m.confianzaExtraccion != null ? Number(m.confianzaExtraccion) : null,
    })),
  });

  return NextResponse.json({
    ok: true,
    proceso,
    documentos,
    reglaActiva: reglas.find(r => r.estadoVersion === 'ACTIVA') ?? null,
    reglaCandidata: reglas.find(r => r.estadoVersion === 'CANDIDATA') ?? null,
    conjuntoActivo: conjNum(conjuntos.find((c: any) => c.estadoVersion === 'ACTIVA')),
    conjuntoCandidato: conjNum(conjuntos.find((c: any) => c.estadoVersion === 'CANDIDATA')),
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const denied = requireSession(session) ?? requireNoMercadeo(session);
  if (denied) return denied;

  const procesoId = parseId((await ctx.params).id);
  if (!procesoId) return NextResponse.json({ ok: false, error: 'ID inválido' }, { status: 400 });

  // El BINARIO NO pasa por este endpoint JSON. El cliente sube el PDF a
  // UploadThing (POST /api/upload — multipart) y aquí solo registra la
  // METADATA + refs. Fallback: archivoBase64 solo para PDFs pequeños (< 2 MB).
  let body: {
    nombreArchivo?: string; mimeType?: string; tamanoBytes?: number; hashArchivo?: string;
    storageKey?: string; storageUrl?: string; archivoBase64?: string; rol?: string;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 }); }

  const { nombreArchivo, mimeType, storageKey, storageUrl } = body;
  if (!nombreArchivo) return NextResponse.json({ ok: false, error: 'nombreArchivo es requerido' }, { status: 422 });
  if ((mimeType ?? '') !== 'application/pdf' && !nombreArchivo.toLowerCase().endsWith('.pdf'))
    return NextResponse.json({ ok: false, error: 'Solo se acepta PDF en esta fase' }, { status: 422 });

  let storageBackend: 'uploadthing' | 'db';
  let tamanoBytes: number;
  let hashArchivo: string;
  let archivoBase64: string | null = null;

  if (storageUrl && storageKey) {
    storageBackend = 'uploadthing';
    if (!body.hashArchivo || !body.tamanoBytes) return NextResponse.json({ ok: false, error: 'Falta hashArchivo / tamanoBytes (calcúlalos en el cliente al subir a UploadThing)' }, { status: 422 });
    hashArchivo = body.hashArchivo;
    tamanoBytes = body.tamanoBytes;
    if (tamanoBytes > LIMITES_DOCUMENTO.MAX_BYTES) return NextResponse.json({ ok: false, error: `PDF supera el máximo (${LIMITES_DOCUMENTO.MAX_BYTES / 1024 / 1024} MB)` }, { status: 413 });
  } else if (body.archivoBase64) {
    const buf = Buffer.from(body.archivoBase64, 'base64');
    if (buf.length === 0) return NextResponse.json({ ok: false, error: 'base64 inválido' }, { status: 422 });
    if (buf.length > LIMITES_DOCUMENTO.MAX_BYTES_INLINE_DB) return NextResponse.json({ ok: false, error: `Para PDFs > ${LIMITES_DOCUMENTO.MAX_BYTES_INLINE_DB / 1024 / 1024} MB sube a UploadThing y envía storageKey/storageUrl (no base64 inline)` }, { status: 413 });
    storageBackend = 'db';
    archivoBase64 = body.archivoBase64;
    tamanoBytes = buf.length;
    hashArchivo = createHash('sha256').update(buf).digest('hex');
  } else {
    return NextResponse.json({ ok: false, error: 'Envía (storageKey + storageUrl + hashArchivo + tamanoBytes) o archivoBase64 (PDF pequeño)' }, { status: 422 });
  }

  const proceso = await prisma.proceso.findUnique({ where: { id: procesoId }, select: { id: true } });
  if (!proceso) return NextResponse.json({ ok: false, error: 'Proceso no encontrado' }, { status: 404 });

  const existente = await prisma.documentoAnalisisEconomicoProceso.findUnique({
    where: { procesoId_hashArchivo: { procesoId, hashArchivo } },
    select: { id: true },
  });
  if (existente) return NextResponse.json({ ok: true, yaExistia: true, documentoId: existente.id, mensaje: 'Este PDF ya estaba cargado para el proceso.' });

  const rol = ['PLIEGO', 'CONDICIONES', 'ADENDA', 'OTRO'].includes((body.rol ?? '').toUpperCase())
    ? (body.rol as string).toUpperCase() : 'PLIEGO';

  const doc = await prisma.documentoAnalisisEconomicoProceso.create({
    data: {
      procesoId, nombreArchivo, mimeType: mimeType ?? 'application/pdf',
      tamanoBytes, hashArchivo,
      storageBackend, storageKey: storageKey ?? null, storageUrl: storageUrl ?? null, archivoBase64,
      rol, estadoAnalisis: 'PENDIENTE', cargadoPorId: session!.id,
    },
    select: { id: true, nombreArchivo: true, tamanoBytes: true, storageBackend: true },
  });

  return NextResponse.json({ ok: true, documento: doc, mensaje: 'PDF registrado. Pulsa "Analizar con Gemini".' });
}

/**
 * §1 — Gate backend USA_PONDERACION_TRM. Este flujo NO es un analizador
 * general de pliegos: solo aplica cuando existe la cadena explícita
 * TRM -> decimal/centavos/condición -> rango -> método de evaluación
 * económica. Gemini solo SUGIERE (AnalisisEconomicoProceso.trmGobierna...);
 * SOLO un humano confirma Proceso.usaPonderacionTrm. Sin sesión real no hay
 * ruta que lo escriba.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const denied = requireSession(session) ?? requireNoMercadeo(session);
  if (denied) return denied;

  const procesoId = parseId((await ctx.params).id);
  if (!procesoId) return NextResponse.json({ ok: false, error: 'ID inválido' }, { status: 400 });

  let body: { accion?: string; valor?: string; motivo?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 }); }

  if (body.accion !== 'confirmarUsoTrm') return NextResponse.json({ ok: false, error: 'accion debe ser: confirmarUsoTrm' }, { status: 422 });
  if (body.valor !== 'SI' && body.valor !== 'NO') return NextResponse.json({ ok: false, error: 'valor debe ser SI o NO' }, { status: 422 });

  const proceso = await prisma.proceso.findUnique({ where: { id: procesoId }, select: { id: true, usaPonderacionTrm: true } });
  if (!proceso) return NextResponse.json({ ok: false, error: 'Proceso no encontrado' }, { status: 404 });

  const antes = proceso.usaPonderacionTrm;

  // §2 — atomicidad: UPDATE + AuditLog (antes/después) + sincronización de
  // estadoRevisionPliego (§3: nunca puede quedar en PLIEGO_VERIFICADO sin
  // usaPonderacionTrm='SI') en la MISMA transacción. NUNCA se borra ni toca
  // ReglaTrmProceso/ConjuntoMetodosPonderacionProceso aquí — el historial
  // (ACTIVA/SUPERSEDED/CANDIDATA/RECHAZADA) queda intacto; solo cambia lo que
  // el estado global reporta sobre si son productivamente utilizables (§4).
  try {
    await prisma.$transaction(async (tx) => {
      await tx.proceso.update({ where: { id: procesoId }, data: { usaPonderacionTrm: body.valor as never } });
      await auditLog({
        accion: 'confirmar_uso_ponderacion_trm',
        recurso: `proceso/${procesoId}/analisis-economico`,
        recursoId: String(procesoId),
        usuarioId: session!.id,
        detalle: { entidad: 'Proceso', campo: 'usaPonderacionTrm', antes, despues: body.valor, motivo: body.motivo ?? null },
      }, tx);
      await sincronizarEstadoRevisionPliego(procesoId, tx);
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'No se pudo confirmar (falló el registro de auditoría o la sincronización; no se aplicó nada).' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, usaPonderacionTrm: body.valor, antes });
}
