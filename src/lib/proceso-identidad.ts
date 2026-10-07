/**
 * Identidad centralizada de procesos — Fase 1 (contención inmediata).
 *
 * Contexto: un mismo `codigoProceso` (ej. "No. 001-2026") puede pertenecer a
 * entidades distintas (ej. "Concejo Municipal de Fortul" y "El Grupo Honor &
 * Laurel"), y hasta ahora varios endpoints cruzaban `Proceso`/`Solicitud`
 * usando solo `codigoProceso`, mezclando registros de entidades distintas.
 *
 * Orden obligatorio de resolución de identidad (nunca saltar pasos):
 *   1. procesoId interno (Proceso.id) — cuando ya se conoce.
 *   2. externalId / sourceKey — para procesos importados de la fuente externa.
 *   3. codigoProcesoNormalizado + entidadNormalizada (llave de negocio) —
 *      única forma válida de "adivinar" el proceso cuando no hay 1 ni 2.
 *   4. Si nada de lo anterior alcanza, la operación debe rechazarse
 *      explícitamente — nunca asumir por `codigoProceso` a secas.
 *
 * Todo endpoint que necesite relacionar Proceso↔Solicitud debe importar estas
 * funciones en vez de reimplementar su propia normalización o su propio Map
 * keyeado solo por código.
 */

import type { Prisma, PrismaClient } from '@prisma/client';

export type PrismaTx = PrismaClient | Prisma.TransactionClient;

// ─── Normalización ────────────────────────────────────────────────────────

// "No.", "No", "Nro.", "N°" al inicio del número — es una etiqueta, no forma
// parte del número en sí (ver diagnóstico: "No. 001-2026" == "001-2026").
const PREFIJO_ETIQUETA_NUMERO = /^(no\.?|nro\.?|n[°º])\s*/i;

/**
 * Normaliza un código/número de proceso para comparación de identidad.
 * Acepta variaciones de formato ("No. 001-2026", "No 001-2026", "001-2026",
 * "001 / 2026") sin eliminar información sustancial del número.
 */
export function normalizarCodigoProceso(codigo: string | null | undefined): string {
  if (!codigo) return '';
  return codigo
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(PREFIJO_ETIQUETA_NUMERO, '')
    .trim()
    .toLowerCase()
    .replace(/\s*\/\s*/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-');
}

/**
 * Normaliza el nombre de una entidad para comparación de identidad.
 * Solo trim + minúsculas + colapso de espacios + remoción de acentos.
 * NO aplica equivalencias semánticas (ej. "Concejo Mpal." != "Concejo
 * Municipal") — eso requeriría un catálogo canónico que no existe hoy.
 */
// Ruido final claramente accidental de captura/sincronización (ej. "Superintendencia
// de Transporte**", "MINTRABAJO NIVEL CENTRAL*/", "MUNICIPIO DE ENVIGADO*") — solo
// se recorta al FINAL del texto; nunca signos internos ni abreviaturas.
const RUIDO_FINAL_ENTIDAD = /[\s*/]+$/;

export function normalizarEntidad(entidad: string | null | undefined): string {
  if (!entidad) return '';
  return entidad
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(RUIDO_FINAL_ENTIDAD, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Llave de negocio: `codigoProcesoNormalizado|entidadNormalizada`. */
export function construirLlaveNegocio(
  codigo: string | null | undefined,
  entidad: string | null | undefined
): string {
  return `${normalizarCodigoProceso(codigo)}|${normalizarEntidad(entidad)}`;
}

/** true si código y entidad alcanzan para construir una llave de negocio útil. */
export function llaveNegocioValida(codigo: string | null | undefined, entidad: string | null | undefined): boolean {
  return normalizarCodigoProceso(codigo) !== '' && normalizarEntidad(entidad) !== '';
}

/**
 * Variantes de texto crudo (separadores - / espacio, y sin separador) para el
 * MISMO número ya normalizado — para usarlas como sobre-búsqueda `contains`
 * insensitive en SQL. "equals" exacto (aunque sea insensitive) no encuentra
 * "001-2026" cuando el dato guardado es "No. 001-2026" o "001 / 2026", aunque
 * normalicen igual. Cualquier endpoint que arme un `where` de Prisma sobre
 * `codigoProceso` para resolver identidad debe usar estas variantes en vez de
 * comparar el texto crudo directamente — así se evita tanto el "falso sin
 * gestionar" (Proceso con Solicitud pero formato distinto) como la creación
 * de un Proceso duplicado por no encontrar el existente.
 */
export function variantesCodigoProceso(codigo: string | null | undefined): string[] {
  const nucleo = normalizarCodigoProceso(codigo);
  if (!nucleo) return [];
  return [...new Set([nucleo, nucleo.replace(/-/g, '/'), nucleo.replace(/-/g, ' '), nucleo.replace(/-/g, '')])];
}

// ─── Actualizable desde fuente externa (botón/endpoint "Actualizar ficha") ──

export interface IdentidadActualizable {
  externalId?: string | number | null;
  sourceKey?: string | null;
}

/**
 * Regla POSITIVA: un proceso solo es actualizable desde una fuente externa
 * (fuente externa) cuando se DEMUESTRA que tiene un `externalId` real Y un
 * `sourceKey` con el prefijo `ext:` — nunca por descarte de "no parece
 * manual". Un proceso 100% manual usa `sourceKey = manual:<uuid>` y
 * `externalId = null` (ver `buscarOCrearProceso`); una Solicitud creada sobre
 * un proceso manual usa `procesoSourceKey = mix:<codigo>||<fuente>||<entidad>`
 * (nunca `manual:` literal — ver `crearSolicitudConIdentidad`), por eso la
 * condición se basa en el prefijo `ext:`, no en detectar `manual:`.
 * No debe usarse `codigoProceso`, `tipoProceso` ni `fuente`/`aliasFuente`
 * como criterio — un proceso Privado importado con `externalId`/`sourceKey`
 * externos válidos también debe poder actualizarse.
 */
export function puedeActualizarProcesoDesdeFuenteExterna(proceso: IdentidadActualizable): boolean {
  const externalId = String(proceso.externalId ?? '').trim();
  const sourceKey = String(proceso.sourceKey ?? '').trim().toLowerCase();

  if (!externalId) return false;
  if (!sourceKey) return false;
  if (sourceKey.startsWith('manual:')) return false;

  return sourceKey.startsWith('ext:');
}

export interface IdentidadRevalidableLink extends IdentidadActualizable {
  aliasFuente?: string | null;
}

/**
 * Regla POSITIVA para permitir la REVALIDACIÓN de un `linkDetalle` ya
 * existente (distinto de rellenarlo por primera vez cuando está vacío).
 *
 * Solo SECOP II (`aliasFuente === 'S2'`) puede generar un nuevo enlace
 * "principal" y mover el anterior a "Proceso(s) relacionado(s)" — SECOP I
 * (`S1`) usa un enlace único y estable (`contratos.gov.co/consultas/...`,
 * sin concepto de notice/relacionados), y los procesos NC/manuales no tienen
 * fuente externa que consultar. Por eso la revalidación NUNCA debe activarse
 * fuera de S2, incluso si el proceso es externamente actualizable.
 */
export function puedeRevalidarLinkExistente(proceso: IdentidadRevalidableLink): boolean {
  const alias = String(proceso.aliasFuente ?? '').trim().toUpperCase();
  return puedeActualizarProcesoDesdeFuenteExterna(proceso) && alias === 'S2';
}

// ─── Resolución contra PostgreSQL (Prisma) ─────────────────────────────────

export interface ProcesoIdentidad {
  id: number;
  externalId: string | null;
  sourceKey: string;
  codigoProceso: string | null;
  entidad: string | null;
}

const SELECT_IDENTIDAD = {
  id: true, externalId: true, sourceKey: true, codigoProceso: true, entidad: true,
} as const;

export type MetodoResolucion = 'procesoId' | 'externalId' | 'llaveNegocio' | 'ninguno';

export interface ResultadoIdentidad {
  proceso: ProcesoIdentidad | null;
  metodo: MetodoResolucion;
  /** true si la búsqueda por llave de negocio encontró más de un candidato — no se debe asignar automáticamente. */
  ambiguo: boolean;
}

/**
 * Busca un Proceso por su llave de negocio (código+entidad), comparando la
 * versión NORMALIZADA en JS (no solo `mode:'insensitive'` en SQL, que no
 * colapsa espacios ni quita acentos/prefijos "No."). Devuelve `ambiguo:true`
 * si hay más de un Proceso cuya llave normalizada coincide — en ese caso NO
 * se debe asociar automáticamente (ver diagnóstico, Fase 1.2).
 */
export async function resolverProcesoPorLlaveNegocio(
  tx: PrismaTx,
  codigoProceso: string | null | undefined,
  entidad: string | null | undefined
): Promise<{ proceso: ProcesoIdentidad | null; ambiguo: boolean }> {
  if (!llaveNegocioValida(codigoProceso, entidad)) return { proceso: null, ambiguo: false };
  const llave = construirLlaveNegocio(codigoProceso, entidad);

  // Sobre-búsqueda segura en SQL — ver variantesCodigoProceso(). Es una
  // sobre-búsqueda (puede traer falsos positivos), pero la decisión final de
  // coincidencia exacta se hace siempre en JS con la normalización completa.
  const variantes = variantesCodigoProceso(codigoProceso);
  const candidatos = variantes.length > 0
    ? await tx.proceso.findMany({
        where: { OR: variantes.map((v) => ({ codigoProceso: { contains: v, mode: 'insensitive' as const } })) },
        select: SELECT_IDENTIDAD,
      })
    : [];

  const exactos = candidatos.filter((p) => construirLlaveNegocio(p.codigoProceso, p.entidad) === llave);
  if (exactos.length === 0) return { proceso: null, ambiguo: false };
  if (exactos.length > 1) {
    console.warn('[proceso-identidad] llave de negocio ambigua, no se asigna automáticamente:', llave, exactos.map((p) => p.id));
    return { proceso: null, ambiguo: true };
  }
  return { proceso: exactos[0], ambiguo: false };
}

export async function resolverProcesoPorExternalId(
  tx: PrismaTx,
  externalId: string | number | null | undefined
): Promise<ProcesoIdentidad | null> {
  const externalIdStr = externalId != null ? String(externalId).trim() : '';
  if (!externalIdStr) return null;
  return tx.proceso.findFirst({
    where: { OR: [{ externalId: externalIdStr }, { sourceKey: `ext:${externalIdStr}` }] },
    select: SELECT_IDENTIDAD,
  });
}

export interface InputResolucionIdentidad {
  procesoId?: number | string | null;
  externalId?: string | number | null;
  codigoProceso?: string | null;
  entidad?: string | null;
}

/**
 * Resuelve la identidad de un Proceso siguiendo el orden obligatorio:
 * procesoId → externalId/sourceKey → llave de negocio. Nunca usa
 * `codigoProceso` a secas.
 */
export async function resolverIdentidadProceso(
  tx: PrismaTx,
  input: InputResolucionIdentidad
): Promise<ResultadoIdentidad> {
  if (input.procesoId) {
    const id = Number(input.procesoId);
    if (Number.isFinite(id) && id > 0) {
      const proceso = await tx.proceso.findUnique({ where: { id }, select: SELECT_IDENTIDAD });
      if (proceso) return { proceso, metodo: 'procesoId', ambiguo: false };
    }
  }

  const porExternalId = await resolverProcesoPorExternalId(tx, input.externalId);
  if (porExternalId) return { proceso: porExternalId, metodo: 'externalId', ambiguo: false };

  const { proceso, ambiguo } = await resolverProcesoPorLlaveNegocio(tx, input.codigoProceso, input.entidad);
  if (proceso) return { proceso, metodo: 'llaveNegocio', ambiguo: false };
  return { proceso: null, metodo: 'ninguno', ambiguo };
}

export interface InputResolverLinkDetalle {
  id?: number | string | null;
  externalId?: string | null;
  sourceKey?: string | null;
  codigoProceso?: string | null;
  entidad?: string | null;
}

export type ResultadoResolucionLinkDetalle =
  | { ok: true; procesoId: number }
  | { ok: false; motivo: 'no_encontrado' | 'ambiguo' | 'entidad_requerida' };

/**
 * Resuelve el `Proceso.id` para `resolver-link-detalle` sin caer nunca en un
 * `findFirst({codigoProceso})` sin desambiguar (ver diagnóstico: MC-002-2026,
 * SAMC-001-2026, SAMC-012-2026, CM-MC-001-2026 y LP-002-2026 existen en
 * varias entidades). Orden: id → externalId/sourceKey → llave de negocio
 * (codigoProceso + entidad). Si solo llega `codigoProceso` sin `entidad`, se
 * rechaza como operación ambigua en vez de adivinar.
 */
export async function resolverProcesoIdParaLinkDetalle(
  tx: PrismaTx,
  input: InputResolverLinkDetalle
): Promise<ResultadoResolucionLinkDetalle> {
  const id = Number(input.id);
  if (Number.isFinite(id) && id > 0) {
    const existe = await tx.proceso.findUnique({ where: { id }, select: { id: true } });
    if (existe) return { ok: true, procesoId: existe.id };
    return { ok: false, motivo: 'no_encontrado' };
  }

  const externalIdCandidato = (input.externalId ?? '').trim()
    || (input.sourceKey?.startsWith('ext:') ? input.sourceKey.slice(4).trim() : '');
  if (externalIdCandidato) {
    const proceso = await resolverProcesoPorExternalId(tx, externalIdCandidato);
    if (proceso) return { ok: true, procesoId: proceso.id };
  }

  if (input.codigoProceso) {
    if (normalizarEntidad(input.entidad) === '') {
      return { ok: false, motivo: 'entidad_requerida' };
    }
    const { proceso, ambiguo } = await resolverProcesoPorLlaveNegocio(tx, input.codigoProceso, input.entidad);
    if (ambiguo) return { ok: false, motivo: 'ambiguo' };
    if (proceso) return { ok: true, procesoId: proceso.id };
    return { ok: false, motivo: 'no_encontrado' };
  }

  return { ok: false, motivo: 'no_encontrado' };
}

export interface InputResolverRevalidacionLink {
  procesoId?: number | string | null;
  externalId?: string | null;
  codigoProceso?: string | null;
  entidad?: string | null;
}

export type ResultadoResolucionRevalidacion =
  | { ok: true; procesoId: number }
  | { ok: false; motivo: 'no_encontrado' | 'ambiguo' | 'entidad_requerida' | 'externalId_no_coincide' };

/**
 * Resuelve el `Proceso.id` para la REVALIDACIÓN DIRIGIDA de `linkDetalle`
 * (endpoint de sync puntual), reutilizando el mismo orden aprobado de
 * `resolverProcesoIdParaLinkDetalle` (id → externalId/sourceKey → llave de
 * negocio) y agregando una validación cruzada adicional: si el caller trae
 * TANTO `procesoId` COMO `externalId`, ambos deben apuntar al mismo Proceso
 * — nunca se confía ciegamente en `procesoId` si el `externalId` declarado
 * no corresponde. `codigoProceso` (ej. "SAMC-001-2026", que se repite entre
 * Ministerio del Interior, Bomberos, etc.) NUNCA es identidad suficiente por
 * sí solo; solo se usa como fallback junto con `entidad`, y solo si la
 * coincidencia normalizada es única (ver `resolverProcesoPorLlaveNegocio`).
 */
export async function resolverProcesoIdParaRevalidacionLink(
  tx: PrismaTx,
  input: InputResolverRevalidacionLink
): Promise<ResultadoResolucionRevalidacion> {
  const resolucion = await resolverProcesoIdParaLinkDetalle(tx, {
    id: input.procesoId,
    externalId: input.externalId,
    codigoProceso: input.codigoProceso,
    entidad: input.entidad,
  });
  if (!resolucion.ok) return resolucion;

  const externalIdEsperado = (input.externalId ?? '').trim();
  if (externalIdEsperado) {
    const proceso = await tx.proceso.findUnique({
      where: { id: resolucion.procesoId },
      select: { externalId: true },
    });
    if (!proceso || String(proceso.externalId ?? '').trim() !== externalIdEsperado) {
      return { ok: false, motivo: 'externalId_no_coincide' };
    }
  }

  return resolucion;
}

/**
 * Busca un Proceso existente por llave de negocio; si no existe, crea uno
 * nuevo canónico. Úsese cuando NO se resolvió por procesoId ni por
 * externalId/sourceKey vía `resolverIdentidadProceso` — para registros 100%
 * manuales (sin `externalId`) usa `sourceKey = manual:<uuid>`; si se conoce
 * un `externalId` (proceso importado que aún no tenía fila en `Proceso`),
 * usa `sourceKey = ext:<externalId>` en su lugar, consistente con el
 * formato que ya usa `procesos-sync.ts`.
 *
 * NOTA (Fase 1): `sourceSystem`/`manualUid`/`codigoProcesoNormalizado`/
 * `entidadNormalizada` todavía no existen como columnas propias en el schema
 * — el UUID manual se guarda temporalmente dentro de `sourceKey`. Migrar a
 * columnas dedicadas queda para la Fase 2 (ver diagnóstico).
 */
export async function buscarOCrearProceso(
  tx: PrismaTx,
  datos: {
    codigoProceso: string;
    entidad: string;
    objeto?: string | null;
    nombreProceso?: string | null;
    aliasFuente?: string | null;
    externalId?: string | null;
    generarUuid?: () => string;
  }
): Promise<{ proceso: ProcesoIdentidad; creado: boolean }> {
  if (!llaveNegocioValida(datos.codigoProceso, datos.entidad)) {
    throw new Error('No existen datos suficientes (codigoProceso + entidad) para identificar el proceso de forma segura.');
  }

  const { proceso: existente, ambiguo } = await resolverProcesoPorLlaveNegocio(tx, datos.codigoProceso, datos.entidad);
  if (ambiguo) {
    throw new Error(
      `Existe más de un proceso con la misma llave de negocio (${construirLlaveNegocio(datos.codigoProceso, datos.entidad)}). ` +
      'No se puede resolver automáticamente — requiere revisión manual.'
    );
  }
  if (existente) return { proceso: existente, creado: false };

  const externalIdStr = datos.externalId != null ? String(datos.externalId).trim() : '';
  const sourceKey = externalIdStr
    ? `ext:${externalIdStr}`
    : `manual:${(datos.generarUuid ?? (() => crypto.randomUUID()))()}`;

  const creado = await tx.proceso.create({
    data: {
      sourceKey,
      externalId: externalIdStr || null,
      codigoProceso: datos.codigoProceso,
      entidad: datos.entidad,
      objeto: datos.objeto ?? null,
      nombre: datos.nombreProceso ?? null,
      fuente: externalIdStr ? 'Manual (externalId sin sincronizar)' : 'Manual',
      aliasFuente: datos.aliasFuente ?? 'NC',
    },
    select: SELECT_IDENTIDAD,
  });
  return { proceso: creado, creado: true };
}
