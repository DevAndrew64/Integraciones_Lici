/**
 * Helpers PUROS de URLs de fuentes públicas de contratación (SECOP I / II).
 *
 * Sin dependencias de red, BD ni de ningún proveedor: solo clasificación y
 * extracción de parámetros de una URL ya persistida. Extraído a un módulo
 * neutral para que el runtime (decisión de backfill de link en solicitudes) no
 * dependa del pipeline de adquisición.
 */

/** Extrae el identificador de aviso (`notice`) de una URL de SECOP II, si lo trae. */
export function extraerNotice(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.searchParams.get('notice') ?? u.searchParams.get('noticeUID') ?? u.searchParams.get('Notice');
  } catch {
    const m = String(url).match(/notice(?:UID)?=([^&#\s"']+)/i);
    return m ? decodeURIComponent(m[1]) : null;
  }
}

const SECOP2 = [
  'secop.gov.co/co1businessline/tendering/contractnoticeview',
  'community.secop.gov.co',
  'www.secop.gov.co',
];
const SECOP1 = ['contratos.gov.co/consultas', 'www.contratos.gov.co'];

/**
 * `true` si la URL corresponde a la fuente pública esperada según el alias:
 *   - `S2` → allowlist positiva: la URL contiene un fragmento de SECOP II.
 *   - `S1` → allowlist positiva: la URL contiene un fragmento de SECOP I.
 *   - `NC` → el `linkDetalle` de un NC no es exclusivo de SECOP (puede ser el
 *            portal de la propia entidad); basta con que sea una URL http(s)
 *            bien formada.
 */
export function esUrlSecop(url: string, alias: string): boolean {
  const lower = url.toLowerCase();
  if (alias === 'S2') return SECOP2.some((p) => lower.includes(p));
  if (alias === 'S1') return SECOP1.some((p) => lower.includes(p));
  if (alias === 'NC') {
    return /^https?:\/\/.{4,}/.test(url.trim());
  }
  return false;
}
