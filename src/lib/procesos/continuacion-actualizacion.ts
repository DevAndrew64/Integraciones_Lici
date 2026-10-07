/**
 * MÓDULO EXCLUSIVAMENTE DE SERVIDOR — `import 'server-only'` aborta el build
 * si algún componente cliente llega a importar este archivo (directa o
 * transitivamente). El frontend nunca debe importar esto: solo el helper
 * puro `continuacion-actualizacion-ficha.ts`.
 *
 * Token de continuación firmado para el submodo "completar_datos" del
 * actualizador puntual — reemplaza la heurística anterior (scraperEstado +
 * scraperTipoFuente + scraperUltimoIntento reciente), que podía dar un falso
 * positivo: esos campos pueden reflejar una revalidación exitosa de hace
 * varios días mientras que el intento MÁS RECIENTE fue un HTTP 429/500 que
 * solo tocó `scraperUltimoIntento` sin revalidar nada.
 *
 * El token solo se emite en el momento exacto en que, DENTRO DE LA MISMA
 * ejecución, el detalle SECOP fue consultado con éxito y el notice quedó
 * confirmado — nunca a partir de estado persistido de ejecuciones previas.
 * La ventana de 10 minutos es ABSOLUTA desde esa emisión original: reutilizar
 * un token válido en un `completar_datos` posterior que vuelve a fallar NO
 * genera una firma nueva ni una expiración nueva (eso es responsabilidad del
 * llamador — `actualizar-ficha-puntual.ts` — que debe devolver el MISMO
 * token recibido en vez de invocar `emitirTokenContinuacion` de nuevo).
 *
 * Firma: HMAC-SHA256 con `SESSION_SECRET` (mismo secreto ya usado para las
 * cookies de sesión en `src/lib/session.ts` / `src/app/api/auth/login`) —
 * no se crea un secreto nuevo, pero SÍ se agrega separación de dominio
 * (`DOMINIO_CONTINUACION`) para que un token de continuación nunca pueda
 * confundirse con una cookie de sesión ni con un futuro token HMAC que
 * reutilice el mismo secreto para otro propósito. Formato visible:
 * `base64url(JSON.stringify(payload)) + '.' + hex(HMAC-SHA256(dominio + '.' + payload))`.
 */

import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';

export const TIPO_TOKEN_CONTINUACION = 'completar_datos_ficha' as const;

export const DURACION_MAX_CONTINUACION_SEGUNDOS = 10 * 60;

// Separación de dominio criptográfico — nunca compartir este prefijo con
// otro uso de SESSION_SECRET (cookies de sesión, futuros tokens HMAC, etc.).
// Versión fija (`V1`) para poder rotar el esquema de firma sin invalidar
// silenciosamente por accidente si algún día cambia el formato del payload.
const DOMINIO_CONTINUACION = 'LICYCOLBA:CONTINUACION_ACTUALIZACION_FICHA:V1';

function materialFirmado(payloadB64: string): string {
  return `${DOMINIO_CONTINUACION}.${payloadB64}`;
}

export interface PayloadContinuacion {
  tipo: typeof TIPO_TOKEN_CONTINUACION;
  procesoId: number;
  externalId: string;
  notice: string;
  fuente: string;
  emitidoEn: number; // epoch segundos
  expiraEn: number; // epoch segundos
}

export interface DatosEmisionContinuacion {
  procesoId: number;
  externalId: string;
  notice: string;
  fuente: string;
}

function obtenerSecreto(): string {
  return process.env.SESSION_SECRET ?? '';
}

/**
 * Emite el token. Devuelve `null` si no hay `SESSION_SECRET` configurado —
 * fail-safe: sin secreto, nunca se emite continuación (nunca se firma con
 * una clave vacía/predecible).
 */
export function emitirTokenContinuacion(
  datos: DatosEmisionContinuacion,
  ahora: Date = new Date()
): { token: string; expiraEn: string } | null {
  const secret = obtenerSecreto();
  if (!secret) return null;
  if (!datos.procesoId || !datos.externalId?.trim() || !datos.notice?.trim() || !datos.fuente?.trim()) return null;

  const emitidoEn = Math.floor(ahora.getTime() / 1000);
  const payload: PayloadContinuacion = {
    tipo: TIPO_TOKEN_CONTINUACION,
    procesoId: datos.procesoId,
    externalId: datos.externalId.trim(),
    notice: datos.notice.trim(),
    fuente: datos.fuente.trim(),
    emitidoEn,
    expiraEn: emitidoEn + DURACION_MAX_CONTINUACION_SEGUNDOS,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const firma = createHmac('sha256', secret).update(materialFirmado(payloadB64)).digest('hex');
  return { token: `${payloadB64}.${firma}`, expiraEn: new Date(payload.expiraEn * 1000).toISOString() };
}

export type MotivoTokenInvalido =
  | 'sin_secreto'
  | 'formato_invalido'
  | 'firma_invalida'
  | 'expirado'
  | 'tipo_invalido';

/**
 * Verifica ÚNICAMENTE la firma/expiración/forma del token — NO valida
 * todavía contra el Proceso real en PostgreSQL (eso lo hace el llamador,
 * que sí tiene acceso a la fila actual). Nunca revela en el motivo si el
 * payload decodifica pero la firma es inválida vs. si el formato es
 * directamente inválido, más allá de estas categorías genéricas — no da
 * pistas específicas que faciliten falsificar la firma.
 */
export function verificarTokenContinuacion(
  token: string | null | undefined,
  ahora: Date = new Date()
): { ok: true; payload: PayloadContinuacion } | { ok: false; motivo: MotivoTokenInvalido } {
  const secret = obtenerSecreto();
  if (!secret) return { ok: false, motivo: 'sin_secreto' };

  const texto = String(token ?? '').trim();
  const dotIdx = texto.lastIndexOf('.');
  if (dotIdx <= 0) return { ok: false, motivo: 'formato_invalido' };

  const payloadB64 = texto.slice(0, dotIdx);
  const firmaRecibida = texto.slice(dotIdx + 1);
  if (!/^[0-9a-f]{64}$/i.test(firmaRecibida)) return { ok: false, motivo: 'formato_invalido' };

  const firmaEsperada = createHmac('sha256', secret).update(materialFirmado(payloadB64)).digest('hex');
  const bufRecibido = Buffer.from(firmaRecibida, 'hex');
  const bufEsperado = Buffer.from(firmaEsperada, 'hex');
  if (bufRecibido.length !== bufEsperado.length || !timingSafeEqual(bufRecibido, bufEsperado)) {
    return { ok: false, motivo: 'firma_invalida' };
  }

  let payload: PayloadContinuacion;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as PayloadContinuacion;
  } catch {
    return { ok: false, motivo: 'formato_invalido' };
  }

  if (payload.tipo !== TIPO_TOKEN_CONTINUACION) return { ok: false, motivo: 'tipo_invalido' };

  const ahoraSegundos = Math.floor(ahora.getTime() / 1000);
  if (typeof payload.expiraEn !== 'number' || payload.expiraEn <= ahoraSegundos) {
    return { ok: false, motivo: 'expirado' };
  }
  if (
    typeof payload.procesoId !== 'number' ||
    typeof payload.externalId !== 'string' ||
    typeof payload.notice !== 'string' ||
    typeof payload.fuente !== 'string'
  ) {
    return { ok: false, motivo: 'formato_invalido' };
  }

  return { ok: true, payload };
}
