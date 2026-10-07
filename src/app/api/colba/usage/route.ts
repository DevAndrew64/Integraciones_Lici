import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireAdmin } from '@/lib/authz';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

type RowTotales = { consultas: bigint; tokens_in: bigint; tokens_out: bigint; cost_usd: number };
type RowModelo  = { modelo: string; consultas: bigint; tokens_in: bigint; tokens_out: bigint; cost_usd: number };
type RowEndpoint = { endpoint: string; consultas: bigint; tokens_in: bigint; tokens_out: bigint };
type RowHora    = { hora: string; consultas: bigint; tokens: bigint };

// GET /api/colba/usage?periodo=hoy|semana|mes|total
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireAdmin(session);
  if (denied) return denied;

  const periodo = new URL(req.url).searchParams.get('periodo') ?? 'mes';

  let filtroFecha = '';
  if (periodo === 'hoy') {
    filtroFecha = `WHERE "creadoEn" >= DATE_TRUNC('day', NOW())`;
  } else if (periodo === 'semana') {
    filtroFecha = `WHERE "creadoEn" >= NOW() - INTERVAL '7 days'`;
  } else if (periodo === 'mes') {
    filtroFecha = `WHERE "creadoEn" >= DATE_TRUNC('month', NOW())`;
  }

  try {
    const [totalesRows, porModeloRows, porEndpointRows, ultimas24h] = await Promise.all([
      prisma.$queryRawUnsafe<RowTotales[]>(`
        SELECT COUNT(*) AS consultas,
               COALESCE(SUM("tokensIn"), 0) AS tokens_in,
               COALESCE(SUM("tokensOut"), 0) AS tokens_out,
               COALESCE(SUM("costUsd"), 0) AS cost_usd
        FROM "GeminiUsage"
        ${filtroFecha}
      `),
      prisma.$queryRawUnsafe<RowModelo[]>(`
        SELECT modelo,
               COUNT(*) AS consultas,
               COALESCE(SUM("tokensIn"), 0) AS tokens_in,
               COALESCE(SUM("tokensOut"), 0) AS tokens_out,
               COALESCE(SUM("costUsd"), 0) AS cost_usd
        FROM "GeminiUsage"
        ${filtroFecha}
        GROUP BY modelo
        ORDER BY COUNT(*) DESC
      `),
      prisma.$queryRawUnsafe<RowEndpoint[]>(`
        SELECT endpoint,
               COUNT(*) AS consultas,
               COALESCE(SUM("tokensIn"), 0) AS tokens_in,
               COALESCE(SUM("tokensOut"), 0) AS tokens_out
        FROM "GeminiUsage"
        ${filtroFecha}
        GROUP BY endpoint
      `),
      prisma.$queryRawUnsafe<RowHora[]>(`
        SELECT
          TO_CHAR(DATE_TRUNC('hour', "creadoEn"), 'HH24:MI') AS hora,
          COUNT(*) AS consultas,
          COALESCE(SUM("tokensIn" + "tokensOut"), 0) AS tokens
        FROM "GeminiUsage"
        WHERE "creadoEn" >= NOW() - INTERVAL '24 hours'
        GROUP BY DATE_TRUNC('hour', "creadoEn")
        ORDER BY DATE_TRUNC('hour', "creadoEn")
      `),
    ]);

    const t = totalesRows[0] ?? { consultas: BigInt(0), tokens_in: BigInt(0), tokens_out: BigInt(0), cost_usd: 0 };
    const tokensIn  = Number(t.tokens_in);
    const tokensOut = Number(t.tokens_out);
    const costUsd   = Number(t.cost_usd);

    return NextResponse.json({
      ok: true,
      periodo,
      totales: {
        consultas:   Number(t.consultas),
        tokensIn,
        tokensOut,
        tokensTotal: tokensIn + tokensOut,
        costUsd:     Number(costUsd.toFixed(6)),
        costCop:     Number((costUsd * 4200).toFixed(0)),
      },
      porModelo: porModeloRows.map(m => ({
        modelo:    m.modelo,
        consultas: Number(m.consultas),
        tokensIn:  Number(m.tokens_in),
        tokensOut: Number(m.tokens_out),
        costUsd:   Number(Number(m.cost_usd).toFixed(6)),
      })),
      porEndpoint: porEndpointRows.map(e => ({
        endpoint:  e.endpoint,
        consultas: Number(e.consultas),
        tokensIn:  Number(e.tokens_in),
        tokensOut: Number(e.tokens_out),
      })),
      ultimas24h: ultimas24h.map(h => ({
        hora:      h.hora,
        consultas: Number(h.consultas),
        tokens:    Number(h.tokens),
      })),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}