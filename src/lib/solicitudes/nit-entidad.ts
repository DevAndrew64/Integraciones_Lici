/**
 * NIT de la ENTIDAD CONTRATANTE desde los datos abiertos de SECOP (datos.gov.co). LiciColba nunca lo traía de la fuente:
 * solo existía `Solicitud.nitContacto`, digitado a mano, por eso unos procesos lo tenían y otros no.
 *
 * - SECOP II («Procesos de Contratación», p6dx-8zbt): `nit_entidad` por la referencia del proceso (= `codigoProceso`) y
 *   la entidad; si no aparece el proceso, por el nombre exacto de la entidad SOLO si todas sus filas tienen el mismo NIT.
 * - SECOP I («Procesos de Compra Pública», f789-7hwg): `nit_de_la_entidad`, con el mismo criterio.
 * - Procesos privados o manuales: no hay fuente pública; el NIT se digita.
 *
 * Nunca se inventa: si la fuente no responde, no lo trae o trae NIT distintos para la misma entidad, el resultado es null.
 * Se guarda la BASE del NIT (solo dígitos, sin puntos ni dígito de verificación): SECOP lo publica así.
 */

export interface DatosNitEntidad {
  entidad: string | null;
  codigoProceso: string | null;
  aliasFuente: string | null;
  linkSecop?: string | null;
}

export interface NitEncontrado {
  nit: string;
  fuente: 'SECOP II' | 'SECOP I';
  /** `proceso`: la fila del mismo proceso; `entidad`: todas las filas de esa entidad tienen el mismo NIT. */
  criterio: 'proceso' | 'entidad';
}

const SECOP_II = { recurso: 'p6dx-8zbt', nit: 'nit_entidad', entidad: 'entidad', proceso: 'referencia_del_proceso', etiqueta: 'SECOP II' as const };
const SECOP_I = { recurso: 'f789-7hwg', nit: 'nit_de_la_entidad', entidad: 'nombre_entidad', proceso: 'numero_de_proceso', etiqueta: 'SECOP I' as const };
type Dataset = typeof SECOP_II | typeof SECOP_I;

const TIEMPO_MAXIMO_MS = 8000;

/** Base del NIT: solo dígitos, sin puntos, espacios ni dígito de verificación («830.037.739-1» → «830037739»). */
export function normalizarNitEntidad(valor: unknown): string | null {
  const t = String(valor ?? '').replace(/[\s.]/g, '');
  const m = /^(\d{5,15})(?:-\d)?$/.exec(t);
  return m ? m[1] : null;
}

/** Literal SoQL entre comillas simples (la comilla se duplica). */
const literal = (texto: string) => `'${texto.replace(/'/g, "''")}'`;

function datasetDe(d: DatosNitEntidad): Dataset | null {
  const alias = (d.aliasFuente ?? '').trim().toUpperCase();
  if (alias === 'S2' || /community\.secop\.gov\.co/i.test(d.linkSecop ?? '')) return SECOP_II;
  if (alias === 'S1' || /contratos\.gov\.co/i.test(d.linkSecop ?? '')) return SECOP_I;
  return null;
}

async function consultar(ds: Dataset, parametros: Record<string, string>, fetchFn: typeof fetch): Promise<Record<string, unknown>[] | null> {
  const url = new URL(`https://www.datos.gov.co/resource/${ds.recurso}.json`);
  for (const [k, v] of Object.entries(parametros)) url.searchParams.set(k, v);
  try {
    const res = await fetchFn(url.toString(), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS) });
    if (!res.ok) return null;
    const cuerpo = await res.json();
    return Array.isArray(cuerpo) ? (cuerpo as Record<string, unknown>[]) : null;
  } catch {
    return null;
  }
}

/** Un único NIT válido entre las filas, o null si no hay ninguno o hay más de uno (no se elige al azar). */
function nitUnico(filas: Record<string, unknown>[], campo: string): string | null {
  const nits = new Set(filas.map((f) => normalizarNitEntidad(f[campo])).filter((n): n is string => n !== null));
  return nits.size === 1 ? [...nits][0] : null;
}

export async function buscarNitEntidadSecop(d: DatosNitEntidad, fetchFn: typeof fetch = fetch): Promise<NitEncontrado | null> {
  const ds = datasetDe(d);
  const entidad = (d.entidad ?? '').trim();
  if (!ds || !entidad) return null;
  const nombre = `upper(${ds.entidad})=${literal(entidad.toUpperCase())}`;

  const codigo = (d.codigoProceso ?? '').trim();
  if (codigo) {
    const filas = await consultar(ds, { $select: ds.nit, $where: `${ds.proceso}=${literal(codigo)} AND ${nombre}`, $limit: '5' }, fetchFn);
    const nit = filas ? nitUnico(filas, ds.nit) : null;
    if (nit) return { nit, fuente: ds.etiqueta, criterio: 'proceso' };
  }
  const grupos = await consultar(ds, { $select: `${ds.nit}`, $where: nombre, $group: ds.nit, $limit: '5' }, fetchFn);
  const nit = grupos ? nitUnico(grupos, ds.nit) : null;
  return nit ? { nit, fuente: ds.etiqueta, criterio: 'entidad' } : null;
}

interface DbNit {
  solicitud: {
    findUnique(args: { where: { id: number }; select: Record<string, true> }): Promise<Record<string, unknown> | null>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
}

/**
 * Completa `nitContacto` de una solicitud que no lo tiene, desde SECOP. Solo escribe si sigue vacío (nunca pisa un NIT
 * digitado). Devuelve el NIT guardado (o el que ya tenía) y de dónde salió.
 */
export async function completarNitEntidad(db: DbNit, solicitudId: number, fetchFn: typeof fetch = fetch): Promise<{ nit: string | null; origen: 'existente' | 'secop' | 'no_disponible'; detalle?: NitEncontrado }> {
  const s = await db.solicitud.findUnique({ where: { id: solicitudId }, select: { nitContacto: true, entidad: true, codigoProceso: true, aliasFuente: true, linkSecop: true } });
  if (!s) return { nit: null, origen: 'no_disponible' };
  const actual = typeof s.nitContacto === 'string' && s.nitContacto.trim() ? s.nitContacto.trim() : null;
  if (actual) return { nit: actual, origen: 'existente' };
  const encontrado = await buscarNitEntidadSecop(
    { entidad: s.entidad as string | null, codigoProceso: s.codigoProceso as string | null, aliasFuente: s.aliasFuente as string | null, linkSecop: s.linkSecop as string | null },
    fetchFn,
  );
  if (!encontrado) return { nit: null, origen: 'no_disponible' };
  await db.solicitud.updateMany({ where: { id: solicitudId, OR: [{ nitContacto: null }, { nitContacto: '' }] }, data: { nitContacto: encontrado.nit } });
  return { nit: encontrado.nit, origen: 'secop', detalle: encontrado };
}
