/**
 * SSRF Guard — protección contra peticiones a redes internas, loopback y metadata cloud.
 *
 * Dos niveles de validación:
 *
 *   validarUrlAntiSSRF  — rutas con auth (análisis Gemini, descarga de documentos):
 *     bloquea IPs peligrosas y protocolos no permitidos. NO usa allowlist de dominios,
 *     para no romper procesos NC con documentos en servidores propios.
 *
 *   validarUrlProxied   — pdf-proxy (endpoint público sin auth):
 *     aplica validarUrlAntiSSRF + exige dominio en la lista configurable
 *     ALLOWED_DOCUMENT_HOSTS (o la lista por defecto si no está definida).
 *
 * Variable de entorno:
 *   ALLOWED_DOCUMENT_HOSTS=community.secop.gov.co,www.contratos.gov.co,grupocolba.com
 *   Si no está definida, se usa la lista por defecto que cubre dominios SECOP y Colba.
 */

// ── Patrones de destinos peligrosos ──────────────────────────────────────────

const ES_IPV4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const ES_IPV6_BARE = /^[0-9a-f:]+$/i;

const HOSTS_PELIGROSOS = new Set([
  'localhost',
  '0.0.0.0',
  '::1',
  '0000::1',
  'ip6-localhost',
  'ip6-loopback',
  '169.254.169.254',  // metadata AWS / GCP / Azure
  'metadata.google.internal',
]);

/** Detecta IPs en rangos RFC-1918, loopback, link-local y metadata cloud. */
function esIpPeligrosa(host: string): boolean {
  if (HOSTS_PELIGROSOS.has(host)) return true;

  // IPv4 privadas / loopback / link-local
  if (ES_IPV4.test(host)) {
    const parts = host.split('.').map(Number);
    const [a, b] = parts;
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0
    );
  }

  // IPv6 loopback / unique local
  const bare = host.replace(/^\[|\]$/g, '');
  if (ES_IPV6_BARE.test(bare)) {
    const norm = bare.toLowerCase();
    return (
      norm === '::1' ||
      norm.startsWith('fc') ||
      norm.startsWith('fd') ||
      norm === '::'
    );
  }

  return false;
}

// ── Resultado ─────────────────────────────────────────────────────────────────

export type SsrfResult = { ok: true } | { ok: false; error: string };

// ── validarUrlAntiSSRF ────────────────────────────────────────────────────────

/**
 * Bloquea URLs con:
 * - Protocolo distinto a http o https (file://, ftp://, gopher://, etc.)
 * - Hostname vacío o sin puntos (no se puede resolver externamente)
 * - IPs internas / loopback / link-local / metadata cloud
 * - Cualquier dirección IP literal (incluso pública) — las URLs legítimas
 *   de SECOP y Colba usan nombres de host, no IPs.
 *
 * NO aplica allowlist de dominios: compatible con procesos NC en servidores propios.
 */
export function validarUrlAntiSSRF(rawUrl: string): SsrfResult {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: 'URL inválida o mal formada.' };
  }

  // Solo http y https — no file://, ftp://, gopher://, data:, javascript:, etc.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: `Protocolo no permitido: ${parsed.protocol}` };
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (!host) {
    return { ok: false, error: 'URL sin hostname válido.' };
  }

  // Bloquear IPs peligrosas
  if (esIpPeligrosa(host)) {
    return { ok: false, error: 'URL no permitida: apunta a red interna o metadata cloud.' };
  }

  // Bloquear IPs literales (cualquier IP pública también) —
  // los documentos legítimos usan nombres de host
  if (ES_IPV4.test(host) || ES_IPV6_BARE.test(host)) {
    return { ok: false, error: 'URLs con dirección IP no están permitidas. Usa el nombre de dominio.' };
  }

  return { ok: true };
}

// ── validarUrlProxied ─────────────────────────────────────────────────────────

/**
 * Lista por defecto de dominios autorizados para pdf-proxy (endpoint público).
 * Se puede extender con la variable ALLOWED_DOCUMENT_HOSTS.
 */
const DOMINIOS_PROXY_DEFAULT = [
  'community.secop.gov.co',
  'www.contratos.gov.co',
  'contratos.gov.co',
  'secop.gov.co',
  'colombiacompra.gov.co',
  'www.colombiacompra.gov.co',
  'grupocolba.com',
  'www.grupocolba.com',
  'utfs.io',
];

function obtenerDominiosPermitidos(): Set<string> {
  const envVar = process.env.ALLOWED_DOCUMENT_HOSTS ?? '';
  const extra = envVar
    .split(',')
    .map(d => d.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...DOMINIOS_PROXY_DEFAULT.map(d => d.toLowerCase()), ...extra]);
}

/**
 * Versión estricta para pdf-proxy (público).
 * Aplica validarUrlAntiSSRF + verifica dominio en lista configurable.
 * Exige HTTPS para el proxy público.
 */
export function validarUrlProxied(rawUrl: string): SsrfResult {
  // Primero validar anti-SSRF base
  const base = validarUrlAntiSSRF(rawUrl);
  if (!base.ok) return base;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: 'URL inválida.' };
  }

  // El proxy público solo acepta HTTPS
  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'El proxy solo admite URLs con protocolo HTTPS.' };
  }

  const host = parsed.hostname.toLowerCase();
  const permitidos = obtenerDominiosPermitidos();

  // Verificar dominio exacto o subdominio
  const permitido = [...permitidos].some(
    d => host === d || host.endsWith('.' + d)
  );

  if (!permitido) {
    return {
      ok: false,
      error: `Dominio no permitido para descarga automática: ${host}. ` +
        'Agregue este dominio a la variable ALLOWED_DOCUMENT_HOSTS si es confiable.',
    };
  }

  return { ok: true };
}