import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { validarUrlAntiSSRF } from '@/lib/ssrf-guard';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function formatoDesdeHeaders(ct: string, cd: string): string {
  const fnMatch = cd.match(/filename\*?=(?:UTF-8'')?["']?([^;"'\r\n]+)/i);
  let filename = fnMatch?.[1]?.trim().replace(/["']/g, '') ?? '';
  try { filename = decodeURIComponent(filename); } catch { /* ignorar si no es válido */ }
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';

  if (ext === 'pdf' || ct.includes('pdf')) return 'PDF';
  if (ext === 'xlsx' || ext === 'xls' || ct.includes('spreadsheet') || ct.includes('excel') || ct.includes('ms-excel')) return 'Excel';
  if (ext === 'docx' || ext === 'doc' || ct.includes('wordprocessing') || ct.includes('msword')) return 'Word';
  if (ext === 'pptx' || ext === 'ppt' || ct.includes('presentation') || ct.includes('powerpoint')) return 'PPT';
  if (ext === 'csv' || ct.includes('csv')) return 'CSV';
  if (ext) return ext.toUpperCase();
  return 'Doc';
}

async function detectarFormato(url: string): Promise<string> {
  // Validar URL antes de hacer fetch (hallazgo crítico C-3 / A-6)
  const check = validarUrlAntiSSRF(url);
  if (!check.ok) return 'Doc'; // No lanzar — solo marcar como desconocido

  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LicycolbaBot/1.0)' },
      signal: AbortSignal.timeout(10_000),
    });
    const ct = resp.headers.get('content-type') ?? '';
    const cd = resp.headers.get('content-disposition') ?? '';
    try { await resp.body?.cancel(); } catch { /* ignorar */ }
    return formatoDesdeHeaders(ct, cd);
  } catch {
    return 'Doc';
  }
}

export async function POST(req: NextRequest) {
  // Requiere sesión activa — endpoint era público (hallazgo crítico C-4 / A-6)
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 });
  }

  let body: { urls?: string[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, formatos: {} }); }

  const { urls = [] } = body;
  if (!urls.length) return NextResponse.json({ ok: true, formatos: {} });

  const entries = await Promise.allSettled(
    urls.slice(0, 20).map(async (url) => {
      const fmt = await detectarFormato(url);
      return [url, fmt] as [string, string];
    })
  );

  const formatos: Record<string, string> = {};
  for (const r of entries) {
    if (r.status === 'fulfilled') formatos[r.value[0]] = r.value[1];
  }

  return NextResponse.json({ ok: true, formatos });
}