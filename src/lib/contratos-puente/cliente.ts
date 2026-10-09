import type { CargoPayload } from './cargos';
import type { InsumoPayload } from './payload';

/**
 * Cliente HTTP del puente LiciColba → Contratos (`puente-contratos/`). Solo lo usa el servidor.
 *
 * Variables de entorno: `PUENTE_CONTRATOS_URL` (p. ej. http://puente-contratos:4010), `PUENTE_CONTRATOS_TOKEN` y, opcional,
 * `PUENTE_CONTRATOS_TIMEOUT_MS` (8000). Sin URL o sin token la integración está APAGADA: nunca se intenta enviar.
 * Los resultados devueltos jamás incluyen la URL ni el token.
 */

/**
 * Contrato JSON v1 del puente (ver `puente-contratos/README.md`). Los vacíos viajan como `null`: el puente decide si bloquean.
 * `oferta` y `tarifa` son del módulo 4: la clave de la oferta en Contratos y los seis valores de «Operación del Contrato»
 * (con el A.I.U. incluido, antes de IVA, en pesos enteros). `cargos` es del módulo 5 (una fila por línea de cargo, SIN A.I.U.);
 * se omite si la pantalla no los mandó.
 */
export interface PayloadContratosV1 {
  version: 1;
  origen: { solicitudId: number; procesoCodigo: string | null };
  cliente: { razonSocial: string | null; nit: string | null; direccion: string | null };
  contrato: { objeto: string | null; porcentajeAIU: number | null; valorMensual: number | null; plazoMeses: number | null };
  oferta: {
    empresa: string | null;
    undnegocio: string | null;
    tipoAdm: string | null;
    origenProceso: string | null;
    codServicio: string | null;
    descripcionServicio: string | null;
  };
  tarifa: {
    manoObra: number | null;
    insumos: number | null;
    maquinaria: number | null;
    administrativos: number | null;
    valorAgregado: number | null;
    serviciosNoContinuos: number | null;
  };
  cargos?: CargoPayload[];
  /** Módulo 6: lista de precios de insumos (código de elemento + costo unitario). */
  insumos?: InsumoPayload[];
}

export interface ErrorCampo {
  campo: string;
  mensaje: string;
}

/** Oferta que el puente creó (o que ya existía) en Contratos: la clave es (empresa, UEN, número). */
export interface OfertaContratos {
  empresa: string;
  undnegocio: string;
  numOferta: number;
}

/** Dato que LiciColba envió y que el puente no escribe todavía (se digita en Contratos). */
export interface NoEscrito {
  campo: string;
  motivo: string;
}

export type ResultadoPuente =
  | { ok: true; modo: string; huella: string; advertencias: ErrorCampo[]; oferta: OfertaContratos | null; noEscrito: NoEscrito[] }
  | { ok: false; tipo: 'NO_CONFIGURADO' }
  | { ok: false; tipo: 'DATOS_INVALIDOS'; errores: ErrorCampo[] }
  | { ok: false; tipo: 'YA_ENVIADA'; oferta: OfertaContratos | null; sinCambios: boolean }
  | { ok: false; tipo: 'CONFLICTO'; codigo: string; mensaje: string }
  | { ok: false; tipo: 'NO_DISPONIBLE' | 'TIMEOUT' | 'RECHAZADO' | 'ERROR_PUENTE'; mensaje: string };

type Entorno = Readonly<Record<string, string | undefined>>;

const aErrores = (v: unknown): ErrorCampo[] =>
  Array.isArray(v) ? v.map((e) => ({ campo: String((e as ErrorCampo)?.campo ?? '?'), mensaje: String((e as ErrorCampo)?.mensaje ?? '') })) : [];

const aNoEscrito = (v: unknown): NoEscrito[] =>
  Array.isArray(v) ? v.map((e) => ({ campo: String((e as NoEscrito)?.campo ?? '?'), motivo: String((e as NoEscrito)?.motivo ?? '') })) : [];

/** La oferta solo se toma si trae su clave completa; lo demás de la respuesta del puente no se confía. */
function aOferta(v: unknown): OfertaContratos | null {
  const o = v as Partial<OfertaContratos> | null | undefined;
  return o && typeof o.empresa === 'string' && typeof o.undnegocio === 'string' && typeof o.numOferta === 'number' && Number.isFinite(o.numOferta)
    ? { empresa: o.empresa, undnegocio: o.undnegocio, numOferta: o.numOferta }
    : null;
}

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
    const escrito = cuerpo.escrito as Record<string, unknown> | undefined;
    return {
      ok: true,
      modo: String(cuerpo.modo ?? ''),
      huella: String(cuerpo.huella ?? ''),
      advertencias: aErrores(cuerpo.advertencias),
      oferta: aOferta(escrito),
      noEscrito: aNoEscrito(cuerpo.noEscrito),
    };
  }
  if (res.status === 422 && cuerpo?.error === 'DATOS_INVALIDOS') return { ok: false, tipo: 'DATOS_INVALIDOS', errores: aErrores(cuerpo.errores) };
  if (res.status === 409 && cuerpo?.error === 'YA_ENVIADA') return { ok: false, tipo: 'YA_ENVIADA', oferta: aOferta(cuerpo.oferta), sinCambios: cuerpo.sinCambios === true };
  if (res.status === 401) return { ok: false, tipo: 'RECHAZADO', mensaje: 'El puente de Contratos rechazó las credenciales de LiciColba.' };
  // Otros rechazos del puente que el usuario puede entender (servicio ocupado, contador de Contratos desfasado, base sin conexión):
  // sus mensajes no llevan datos del cliente ni de la base.
  if ((res.status === 409 || res.status === 503) && typeof cuerpo?.error === 'string' && typeof cuerpo?.mensaje === 'string') {
    return { ok: false, tipo: 'CONFLICTO', codigo: cuerpo.error, mensaje: cuerpo.mensaje };
  }
  return { ok: false, tipo: 'ERROR_PUENTE', mensaje: `El puente de Contratos respondió con un error (${res.status}).` };
}
