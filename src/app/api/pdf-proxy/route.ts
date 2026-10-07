import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { validarUrlProxied } from '@/lib/ssrf-guard';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Requiere sesión activa — endpoint era público (hallazgo crítico C-2)
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 });
  }

  const url = req.nextUrl.searchParams.get('url');
  if (!url) return NextResponse.json({ ok: false, error: 'Falta parámetro url' }, { status: 400 });

  // Validar URL contra SSRF y lista blanca de dominios
  const check = validarUrlProxied(url);
  if (!check.ok) {
    return NextResponse.json({ ok: false, error: check.error }, { status: 400 });
  }

  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LicycolbaBot/1.0)' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) return NextResponse.json({ ok: false, error: `HTTP ${resp.status}` }, { status: 502 });

    const data = await resp.arrayBuffer();
    const download = req.nextUrl.searchParams.get('download');
    const filename = req.nextUrl.searchParams.get('filename') || 'documento.pdf';
    const headers: Record<string, string> = {
      'Content-Type': 'application/pdf',
      'Cache-Control': 'private, max-age=3600',
      // Access-Control-Allow-Origin: * eliminado (hallazgo A-6)
    };
    if (download === '1') {
      headers['Content-Disposition'] = `attachment; filename="${filename.replace(/"/g, '')}"`;
    }
    return new NextResponse(data, { status: 200, headers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al descargar PDF';
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}