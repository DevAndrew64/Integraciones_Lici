import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireSession } from '@/lib/authz';

// Catálogo de cargos de Grupo Colba (Midasoft) — mismo patrón que
// /api/horarios: el servidor es quien llama a la API externa (nunca el
// navegador directamente), con timeout propio para no dejar la petición
// colgada si el host no responde.
const BASE_URL = 'https://grupocolba.com/service/public/api/cargos';
const TIMEOUT_MS = 6000;

function fetchConTimeout(url: string, init: RequestInit) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

// Forma exacta de la respuesta no confirmada contra la API real todavía —
// se maneja de forma defensiva: admite tanto un array crudo como
// {success, data:[...]} (mismo patrón que /turnos), y prueba varios
// nombres de campo usuales para "nombre" y "código" del cargo.
interface CargoExterno {
  [k: string]: unknown;
}

function nombreDeCargo(item: CargoExterno): string {
  for (const campo of ['nombre', 'cargo', 'nombreCargo', 'descripcion', 'name']) {
    const v = item[campo];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function codigoDeCargo(item: CargoExterno): string | null {
  for (const campo of ['codigo', 'id', 'codigoCargo']) {
    const v = item[campo];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return null;
}

// GET /api/cargos?empresa=aseo[&q=texto] — catálogo de cargos de la
// empresa; si se envía "q", además filtra en servidor (el cliente ya
// filtra en vivo sobre la lista cacheada, esto es un filtro adicional
// opcional, no la vía principal de búsqueda "tipo Google").
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  const empresa = req.nextUrl.searchParams.get('empresa') || 'aseo';
  const q = req.nextUrl.searchParams.get('q')?.trim().toLowerCase();

  try {
    const r = await fetchConTimeout(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empresa }),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    const lista: CargoExterno[] = Array.isArray(data)
      ? data
      : Array.isArray((data as { data?: unknown })?.data)
        ? (data as { data: CargoExterno[] }).data
        : [];
    const normalizados = lista
      .map(item => ({ codigo: codigoDeCargo(item), nombre: nombreDeCargo(item) }))
      .filter(c => c.nombre !== '');
    const filtrados = q ? normalizados.filter(c => c.nombre.toLowerCase().includes(q)) : normalizados;
    return NextResponse.json({ ok: true, cargos: filtrados });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: 'No se pudo conectar con el catálogo de cargos: ' + String(e) },
      { status: 502 },
    );
  }
}
