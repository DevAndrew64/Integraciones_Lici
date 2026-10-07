/**
 * Cliente HTTP del puente LiciColba → Contratos (`puente-contratos/`). Solo lo usa el servidor.
 *
 * Variables de entorno: `PUENTE_CONTRATOS_URL` (p. ej. http://puente-contratos:4010), `PUENTE_CONTRATOS_TOKEN` y, opcional,
 * `PUENTE_CONTRATOS_TIMEOUT_MS` (8000). Sin URL o sin token la integración está APAGADA: nunca se intenta enviar.
 * Los resultados devueltos jamás incluyen la URL ni el token.
 */

/** Contrato JSON v1 del puente (ver `puente-contratos/README.md`). Los vacíos viajan como `null`: el puente decide si bloquean. */
export interface PayloadContratosV1 {
  version: 1;
  origen: { solicitudId: number; procesoCodigo: string | null };
  cliente: { razonSocial: string | null; nit: string | null; direccion: string | null };
  contrato: { objeto: string | null; porcentajeAIU: number | null; valorMensual: number | null; plazoMeses: number | null };
}

export interface ErrorCampo {
  campo: string;
  mensaje: string;
}

export type ResultadoPuente =
  | { ok: true; modo: string; huella: string; advertencias: ErrorCampo[] }
  | { ok: false; tipo: 'NO_CONFIGURADO' }
  | { ok: false; tipo: 'DATOS_INVALIDOS'; errores: ErrorCampo[] }
  | { ok: false; tipo: 'NO_DISPONIBLE' | 'TIMEOUT' | 'RECHAZADO' | 'ERROR_PUENTE'; mensaje: string };

type Entorno = Readonly<Record<string, string | undefined>>;

const aErrores = (v: unknown): ErrorCampo[] =>
  Array.isArray(v) ? v.map((e) => ({ campo: String((e as ErrorCampo)?.campo ?? '?'), mensaje: String((e as ErrorCampo)?.mensaje ?? '') })) : [];

export async function enviarAlPuente(payload: PayloadContratosV1, entorno: Entorno = process.env, fetchFn: typeof fetch = fetch): Promise<ResultadoPuente> {
  const url = entorno.PUENTE_CONTRATOS_URL?.trim().replace(/\/+$/, '');
  const token = entorno.PUENTE_CONTRATOS_TOKEN?.trim();
  if (!url || !token) return { ok: false, tipo: 'NO_CONFIGURADO' };
  const configurado = Number(entorno.PUENTE_CONTRATOS_TIMEOUT_MS);
  const timeoutMs = Number.isInteger(configurado) && configurado >= 500 && configurado <= 120_000 ? configurado : 8000;

  let res: Response;
  try {
    res = await fetchFn(`${url}/contratos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const agotado = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return agotado
      ? { ok: false, tipo: 'TIMEOUT', mensaje: 'El puente de Contratos no respondió a tiempo.' }
      : { ok: false, tipo: 'NO_DISPONIBLE', mensaje: 'No se pudo conectar con el puente de Contratos.' };
  }

  const cuerpo = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (res.ok && cuerpo?.ok === true) {
    return { ok: true, modo: String(cuerpo.modo ?? ''), huella: String(cuerpo.huella ?? ''), advertencias: aErrores(cuerpo.advertencias) };
  }
  if (res.status === 422 && cuerpo?.error === 'DATOS_INVALIDOS') return { ok: false, tipo: 'DATOS_INVALIDOS', errores: aErrores(cuerpo.errores) };
  if (res.status === 401) return { ok: false, tipo: 'RECHAZADO', mensaje: 'El puente de Contratos rechazó las credenciales de LiciColba.' };
  return { ok: false, tipo: 'ERROR_PUENTE', mensaje: `El puente de Contratos respondió con un error (${res.status}).` };
}
