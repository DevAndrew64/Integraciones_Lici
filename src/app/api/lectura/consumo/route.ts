import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireSession, isAdmin, resolveSessionUserId } from '@/lib/authz';
import prisma from '@/lib/prisma';

// ═══════════════════════════════════════════════════════════════════════════
// FASE 1 — PANEL DE CONSUMO GEMINI (solo lectura)
// ─────────────────────────────────────────────────────────────────────────
// No modifica datos. Cruza GeminiUsage (ledger real por llamada: modelo,
// tokens, costo) con LecturaAnalisis (documento, modo, proceso) y AuditLog
// (cache, tal como lo registran los endpoints de análisis).
//
// GeminiUsage NO tiene una FK hacia LecturaAnalisis (limitación real del
// esquema actual, documentada en el diagnóstico). Se correlaciona cada
// LecturaAnalisis con sus llamadas Gemini por: mismo usuarioId + endpoint
// correspondiente a su modo + ventana de tiempo alrededor de creadoEn. Es
// una aproximación de mejor esfuerzo, no un vínculo garantizado — ver
// "limitaciones" en la respuesta.
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = 'force-dynamic';

// TRM configurable — constante interna por ahora (Fase 1). Ajustar aquí si cambia.
const TRM_COP_POR_USD = 4000;

// Tarifas de referencia (USD por 1M tokens) — igual que src/lib/gemini-usage.ts,
// usadas solo como fallback cuando no se puede correlacionar con GeminiUsage.
const TARIFAS_REFERENCIA: Record<string, { in: number; out: number }> = {
  'gemini-2.5-pro': { in: 1.25, out: 10.0 },
  'gemini-2.5-flash': { in: 0.15, out: 0.6 },
  'gemini-2.5-flash-lite': { in: 0.075, out: 0.3 },
};

function nivelCosto(usd: number): 'bajo' | 'medio' | 'alto' | 'critico' {
  if (usd < 0.02) return 'bajo';
  if (usd < 0.08) return 'medio';
  if (usd < 0.2) return 'alto';
  return 'critico';
}

// Mapea el modo de LecturaAnalisis al prefijo de endpoint que registra GeminiUsage
const ENDPOINT_POR_MODO: Record<string, string> = {
  completo: 'lectura/analizar',
  basico: 'lectura/analizar',
  profundo: 'lectura/analizar-profundo',
  proceso_completo: 'lectura/analizar-proceso-completo',
  analisis_unico_experto: 'lectura/analizar-unico',
};

function endpointLegible(modo: string | null): string {
  const m = modo || '';
  if (m === 'completo' || m === 'basico') return '/api/lectura/analizar';
  if (m === 'profundo') return '/api/lectura/analizar-profundo';
  if (m === 'proceso_completo') return '/api/lectura/analizar-proceso-completo';
  if (m === 'analisis_unico_experto') return '/api/lectura/analizar-unico';
  return `/api/lectura/(modo: ${m || 'desconocido'})`;
}

function modoLegible(modo: string | null): string {
  const m = modo || '';
  if (m === 'completo' || m === 'basico') return 'normal';
  if (m === 'profundo') return 'profundo';
  if (m === 'proceso_completo') return 'proceso completo (legacy)';
  if (m === 'analisis_unico_experto') return 'análisis único experto';
  return m || 'desconocido';
}

type GeminiUsageRow = {
  id: number;
  modelo: string;
  endpoint: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  usuario: string | null;
  usuarioId: number | null;
  creadoEn: Date;
};

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  const usuarioId = await resolveSessionUserId(session!);
  if (usuarioId === null) {
    return NextResponse.json({ ok: false, error: 'Sesión inválida. Inicie sesión nuevamente.' }, { status: 401 });
  }
  const admin = isAdmin(session!.rol);

  const sp = req.nextUrl.searchParams;
  const fechaInicio = sp.get('fechaInicio'); // YYYY-MM-DD
  const fechaFin = sp.get('fechaFin'); // YYYY-MM-DD
  const filtroUsuario = sp.get('usuario')?.trim() || null;
  const filtroEndpoint = sp.get('endpoint')?.trim() || null;
  const filtroModelo = sp.get('modelo')?.trim() || null;
  const filtroModo = sp.get('modo')?.trim() || null;
  const filtroDocumento = sp.get('documento')?.trim() || null;
  const filtroCodigoProceso = sp.get('codigoProceso')?.trim() || null;

  const desde = fechaInicio ? new Date(fechaInicio + 'T00:00:00.000Z') : null;
  const hasta = fechaFin ? new Date(fechaFin + 'T23:59:59.999Z') : null;

  try {
    // ── 1) Ledger real de Gemini (GeminiUsage) — filtrado a endpoints de lectura ──
    const usageWhere: Record<string, unknown> = {
      endpoint: { startsWith: 'lectura/' },
    };
    if (desde || hasta) usageWhere.creadoEn = { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) };
    if (!admin) usageWhere.usuarioId = usuarioId;
    if (filtroUsuario) usageWhere.usuario = { contains: filtroUsuario, mode: 'insensitive' };
    if (filtroEndpoint) usageWhere.endpoint = { contains: filtroEndpoint, mode: 'insensitive' };
    if (filtroModelo) usageWhere.modelo = filtroModelo;

    const usageRows = (await prisma.geminiUsage.findMany({
      where: usageWhere,
      select: { id: true, modelo: true, endpoint: true, tokensIn: true, tokensOut: true, costUsd: true, usuario: true, usuarioId: true, creadoEn: true },
      orderBy: { creadoEn: 'desc' },
      take: 20_000,
    })) as GeminiUsageRow[];

    // ── Resumen general (basado en el ledger real) ──────────────────────────────
    const totalLlamadas = usageRows.length;
    const tokensEntradaTotal = usageRows.reduce((a, r) => a + r.tokensIn, 0);
    const tokensSalidaTotal = usageRows.reduce((a, r) => a + r.tokensOut, 0);
    const costoTotalUsd = usageRows.reduce((a, r) => a + r.costUsd, 0);

    const porModeloMap = new Map<string, { llamadas: number; costo: number }>();
    const porEndpointMap = new Map<string, { llamadas: number; costo: number; tokensIn: number; tokensOut: number }>();
    const porDiaMap = new Map<string, { llamadas: number; tokensIn: number; tokensOut: number; costo: number }>();
    for (const r of usageRows) {
      const m = porModeloMap.get(r.modelo) ?? { llamadas: 0, costo: 0 };
      m.llamadas++; m.costo += r.costUsd; porModeloMap.set(r.modelo, m);

      const e = porEndpointMap.get(r.endpoint) ?? { llamadas: 0, costo: 0, tokensIn: 0, tokensOut: 0 };
      e.llamadas++; e.costo += r.costUsd; e.tokensIn += r.tokensIn; e.tokensOut += r.tokensOut; porEndpointMap.set(r.endpoint, e);

      const dia = r.creadoEn.toISOString().slice(0, 10);
      const d = porDiaMap.get(dia) ?? { llamadas: 0, tokensIn: 0, tokensOut: 0, costo: 0 };
      d.llamadas++; d.tokensIn += r.tokensIn; d.tokensOut += r.tokensOut; d.costo += r.costUsd; porDiaMap.set(dia, d);
    }
    const modeloMasUsado = [...porModeloMap.entries()].sort((a, b) => b[1].llamadas - a[1].llamadas)[0]?.[0] ?? null;
    const endpointMasCostoso = [...porEndpointMap.entries()].sort((a, b) => b[1].costo - a[1].costo)[0]?.[0] ?? null;

    // ── 2) Documentos analizados (LecturaAnalisis) ──────────────────────────────
    const laWhere: Record<string, unknown> = {};
    if (desde || hasta) laWhere.creadoEn = { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) };
    if (!admin) laWhere.usuarioId = usuarioId;
    if (filtroModo) laWhere.modo = filtroModo;
    if (filtroDocumento) laWhere.nombreDocumento = { contains: filtroDocumento, mode: 'insensitive' };
    if (filtroCodigoProceso) laWhere.codigoProceso = { contains: filtroCodigoProceso, mode: 'insensitive' };

    const analisisRows = await prisma.lecturaAnalisis.findMany({
      where: laWhere,
      select: {
        id: true, nombreDocumento: true, codigoProceso: true, modo: true, pdfHash: true, urlDocumento: true,
        tokensEntrada: true, tokensSalida: true, creadoEn: true, usuarioId: true,
        usuario: { select: { usuario: true } },
      },
      orderBy: { creadoEn: 'desc' },
      take: 2_000,
    });

    // Filtro adicional por nombre de usuario (join manual, ya que el filtro de arriba es por id)
    const analisisFiltrados = filtroUsuario
      ? analisisRows.filter(r => (r.usuario?.usuario || '').toLowerCase().includes(filtroUsuario.toLowerCase()))
      : analisisRows;

    // ── 3) Audit log de cache — para saber cuántas veces se sirvió cada análisis desde caché ──
    const idsAnalisis = analisisFiltrados.map(r => String(r.id));
    const auditRows = idsAnalisis.length
      ? await prisma.auditLog.findMany({
          where: { recurso: 'lectura_analisis', recursoId: { in: idsAnalisis } },
          select: { recursoId: true, detalle: true, creadoEn: true },
        })
      : [];
    const cacheCountPorId = new Map<string, number>();
    for (const a of auditRows) {
      const det = a.detalle as Record<string, unknown> | null;
      if (det?.cache === true && a.recursoId) {
        cacheCountPorId.set(a.recursoId, (cacheCountPorId.get(a.recursoId) ?? 0) + 1);
      }
    }

    // ── 4) Correlación best-effort con GeminiUsage por análisis ─────────────────
    // Ventana: [creadoEn - 5min, creadoEn + 20min] — cubre tanto el patrón síncrono
    // (analizar/analizar-profundo, donde las llamadas Gemini preceden al guardado)
    // como el patrón en segundo plano (analizar-unico/proceso-completo, donde las
    // llamadas ocurren después de crear el registro "PROCESANDO").
    const VENTANA_ANTES_MS = 5 * 60 * 1000;
    const VENTANA_DESPUES_MS = 20 * 60 * 1000;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const detalle: any[] = analisisFiltrados.map(la => {
      const endpointPrefix = ENDPOINT_POR_MODO[la.modo || ''] || null;
      const creado = la.creadoEn.getTime();
      const candidatos = endpointPrefix
        ? usageRows.filter(u =>
            u.usuarioId === la.usuarioId &&
            u.endpoint.startsWith(endpointPrefix) &&
            u.creadoEn.getTime() >= creado - VENTANA_ANTES_MS &&
            u.creadoEn.getTime() <= creado + VENTANA_DESPUES_MS)
        : [];

      const correlacionado = candidatos.length > 0;
      const usoPro = candidatos.some(c => c.modelo === 'gemini-2.5-pro');
      const modeloUsado = correlacionado ? (usoPro ? 'gemini-2.5-flash + gemini-2.5-pro (fallback)' : 'gemini-2.5-flash') : 'no correlacionado';

      const tokensIn = la.tokensEntrada ?? 0;
      const tokensOut = la.tokensSalida ?? 0;
      let costoUsd: number;
      if (correlacionado) {
        costoUsd = candidatos.reduce((a, c) => a + c.costUsd, 0);
      } else {
        // Fallback: tarifa de referencia flash (subestima si en realidad usó Pro)
        const tarifa = TARIFAS_REFERENCIA['gemini-2.5-flash'];
        costoUsd = (tokensIn / 1_000_000) * tarifa.in + (tokensOut / 1_000_000) * tarifa.out;
      }

      return {
        id: la.id,
        documento: la.nombreDocumento,
        codigoProceso: la.codigoProceso,
        modo: modoLegible(la.modo),
        modoRaw: la.modo,
        endpoint: endpointLegible(la.modo),
        modelo: modeloUsado,
        fallbackPro: usoPro,
        correlacionConGeminiUsage: correlacionado,
        tokensEntrada: tokensIn,
        tokensSalida: tokensOut,
        tokensTotales: tokensIn + tokensOut,
        costoUsd: Number(costoUsd.toFixed(6)),
        costoCop: Math.round(costoUsd * TRM_COP_POR_USD),
        fecha: la.creadoEn,
        usuario: la.usuario?.usuario || null,
        vecesServidoDesdeCache: cacheCountPorId.get(String(la.id)) ?? 0,
        nivelCosto: nivelCosto(costoUsd),
      };
    });

    // ── 5) Agrupaciones adicionales ──────────────────────────────────────────────
    const porModoMap = new Map<string, { analisis: number; tokensIn: number; tokensOut: number; costo: number }>();
    for (const d of detalle) {
      const e = porModoMap.get(d.modo) ?? { analisis: 0, tokensIn: 0, tokensOut: 0, costo: 0 };
      e.analisis++; e.tokensIn += d.tokensEntrada; e.tokensOut += d.tokensSalida; e.costo += d.costoUsd;
      porModoMap.set(d.modo, e);
    }

    const topCostosos = [...detalle].sort((a, b) => b.costoUsd - a.costoUsd).slice(0, 10);

    const porHash = new Map<string, { veces: number; ids: number[]; tokens: number; nombre: string }>();
    const porUrl = new Map<string, { veces: number; ids: number[]; nombre: string }>();
    for (const la of analisisFiltrados) {
      if (la.pdfHash) {
        const h = porHash.get(la.pdfHash) ?? { veces: 0, ids: [], tokens: 0, nombre: la.nombreDocumento };
        h.veces++; h.ids.push(la.id); h.tokens += (la.tokensEntrada ?? 0) + (la.tokensSalida ?? 0);
        porHash.set(la.pdfHash, h);
      }
      if (la.urlDocumento) {
        const u = porUrl.get(la.urlDocumento) ?? { veces: 0, ids: [], nombre: la.nombreDocumento };
        u.veces++; u.ids.push(la.id);
        porUrl.set(la.urlDocumento, u);
      }
    }
    const duplicadosPdfHash = [...porHash.entries()].filter(([, v]) => v.veces > 1).map(([hash, v]) => ({ pdfHash: hash, ...v }));
    const duplicadosUrl = [...porUrl.entries()].filter(([, v]) => v.veces > 1).map(([url, v]) => ({ urlDocumento: url, ...v }));

    const costoTotalDetalleUsd = detalle.reduce((a, d) => a + d.costoUsd, 0);
    const costoPromedioPorAnalisis = detalle.length ? costoTotalDetalleUsd / detalle.length : 0;

    return NextResponse.json({
      ok: true,
      filtros: { fechaInicio, fechaFin, usuario: filtroUsuario, endpoint: filtroEndpoint, modelo: filtroModelo, modo: filtroModo, documento: filtroDocumento, codigoProceso: filtroCodigoProceso },
      trm: TRM_COP_POR_USD,
      resumen: {
        totalLlamadasGemini: totalLlamadas,
        tokensEntradaTotal,
        tokensSalidaTotal,
        tokensTotales: tokensEntradaTotal + tokensSalidaTotal,
        costoTotalUsd: Number(costoTotalUsd.toFixed(4)),
        costoTotalCop: Math.round(costoTotalUsd * TRM_COP_POR_USD),
        totalAnalisisDocumentos: detalle.length,
        costoPromedioPorAnalisisUsd: Number(costoPromedioPorAnalisis.toFixed(4)),
        costoPromedioPorAnalisisCop: Math.round(costoPromedioPorAnalisis * TRM_COP_POR_USD),
        modeloMasUsado,
        endpointMasCostoso,
      },
      detalle,
      agrupaciones: {
        porDia: [...porDiaMap.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([fecha, v]) => ({ fecha, ...v, costo: Number(v.costo.toFixed(4)) })),
        porEndpoint: [...porEndpointMap.entries()].sort((a, b) => b[1].costo - a[1].costo).map(([endpoint, v]) => ({ endpoint, ...v, costo: Number(v.costo.toFixed(4)) })),
        porModelo: [...porModeloMap.entries()].sort((a, b) => b[1].costo - a[1].costo).map(([modelo, v]) => ({ modelo, ...v, costo: Number(v.costo.toFixed(4)) })),
        porModo: [...porModoMap.entries()].sort((a, b) => b[1].costo - a[1].costo).map(([modo, v]) => ({ modo, ...v, costo: Number(v.costo.toFixed(4)) })),
        topCostosos,
        duplicadosPdfHash,
        duplicadosUrl,
      },
      limitaciones: [
        'GeminiUsage no tiene relación directa (foreign key) con LecturaAnalisis. El campo "modelo" y el costo real por análisis se estiman correlacionando por usuario + endpoint + ventana de tiempo (-5min/+20min alrededor de la fecha del análisis). Si "correlacionConGeminiUsage" es false, el costo mostrado es una estimación con tarifa flash de referencia (puede subestimar si en realidad se usó Gemini Pro).',
        'Si el mismo usuario ejecuta dos análisis del mismo modo casi al mismo tiempo, la correlación puede mezclar llamadas entre ambos (caso raro, pero posible).',
        'El costo de Google Document AI (OCR) no se registra en GeminiUsage — no está incluido en ninguna cifra de este panel.',
      ],
    });
  } catch (err) {
    console.error('[GET /api/lectura/consumo]', err);
    return NextResponse.json({ ok: false, error: 'Error al calcular el consumo.' }, { status: 500 });
  }
}