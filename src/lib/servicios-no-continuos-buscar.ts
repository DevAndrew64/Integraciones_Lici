// src/lib/servicios-no-continuos-buscar.ts
//
// Ajuste "SERVICIOS NO CONTINUOS — FASE 1: CATÁLOGO ASEOCOLBA" — catálogo
// de servicios no continuos (BRIGADA DE ASEO, LIMPIEZA DE VIDRIOS CON
// ALTURA, etc.), fuente `POST equipos/../no_continuos` con `{empresa}`
// (confirmado por el usuario: body de una sola clave, sin `descripcion` ni
// paginación — la fuente devuelve el catálogo COMPLETO de la empresa en
// una sola llamada).
//
// Corrección "AUDITORÍA FASE 1 §4" — CONTRATO REAL verificado en vivo
// (POST con {empresa:"aseo"}, 146 registros reales, incluye "BRIGADA DE
// ASEO", "LIMPIEZA DE VIDRIOS CON ALTURA", etc. — coincide con el listado
// que dio el usuario en la ronda de Fase 1): la fuente devuelve
// `{codigo:number, uen:string, descripcion:string}` — SIN campo `empresa`
// (ausente en el 100% de los registros observados) y con `uen` (no
// `undneg`, que era una suposición del enunciado original de Fase 1).
// `uen` es el mismo concepto ya usado en el resto del repo (BAQ/BOG/MIN/
// CAL, ver dotacion-ext/epp-ext) — se mapea a nuestro campo `undneg`
// (nombre que sí pidió el usuario conservar), leyendo la clave real `uen`.
// Confirmado también que `codigo` SE REPITE entre `uen` distintos (ej.
// codigo=1 existe para BAQ, MIN y BOG, cada uno un servicio distinto) —
// nunca es un identificador único por sí solo (ver `claveOpcionServicioNoContinuo`).
//
// FASE 1: solo identidad del servicio (codigo/descripcion/uen→undneg). NO
// trae empresa por registro, ni tarifa/precio/unidad/rendimiento — esta
// fuente no los entrega; ninguna fórmula de tarifa se deriva de aquí.

const FUENTE_NO_CONTINUOS_URL = 'https://grupocolba.com/service/public/api/no_continuos';
const TIMEOUT_MS = 15 * 1000;

export interface ServicioNoContinuoCatalogo {
  codigo: string;
  descripcion: string;
  empresa: string;
  undneg: string;
}

function normalizarLista(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  const envuelto = (raw as { data?: unknown })?.data;
  return Array.isArray(envuelto) ? envuelto as Record<string, unknown>[] : [];
}

/**
 * Búsqueda directa contra la fuente externa — sin caché, sin paginación en
 * origen (mismo criterio que `buscarEquiposActivos`/`buscarEquiposRecientes`:
 * una sola llamada por consulta). `empresa` nunca se envía vacía — el
 * llamador (route.ts) la exige antes de invocar esta función.
 */
export async function buscarServiciosNoContinuos(empresa: string): Promise<ServicioNoContinuoCatalogo[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let raw: unknown;
  try {
    const res = await fetch(FUENTE_NO_CONTINUOS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empresa }),
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Error externo: ${res.status}`);
    raw = await res.json();
  } finally {
    clearTimeout(timeoutId);
  }
  const lista = normalizarLista(raw);
  return lista
    .map(item => ({
      codigo: String(item.codigo ?? '').trim(),
      descripcion: String(item.descripcion ?? '').trim(),
      // Corrección "AUDITORÍA FASE 1 §2" — `empresa` es el valor QUE TRAE
      // CADA REGISTRO de la fuente, nunca el parámetro de consulta: antes
      // se sustituía por `empresa` (el código usado para buscar, ej.
      // "aseo") cuando el registro no lo traía, inventando un dato que la
      // fuente no confirmó. Verificado en vivo (§4): la fuente NUNCA trae
      // `empresa` por registro — queda cadena vacía siempre, nunca inferida.
      empresa: String(item.empresa ?? '').trim(),
      // Corrección "AUDITORÍA FASE 1 §4" — el campo real de la fuente es
      // `uen` (no `undneg`, que era una suposición); se lee `uen` y se
      // guarda en nuestro campo `undneg` (nombre pedido por el usuario).
      undneg: String(item.uen ?? item.undneg ?? '').trim(),
    }))
    // Un registro sin descripción no es utilizable en el selector (nunca
    // se muestra una fila en blanco) — no se descarta por falta de código,
    // ya que la fuente podría no informarlo para algún registro.
    .filter(s => s.descripcion !== '');
}
