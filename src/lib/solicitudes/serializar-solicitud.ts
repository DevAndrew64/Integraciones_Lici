/**
 * Fragmentos SQL y serialización de `Solicitud` compartidos por las
 * consultas de bandeja de `src/app/api/solicitudes/route.ts` — separados en
 * un módulo propio (en vez de vivir dentro del route handler) porque los
 * archivos `route.ts` de Next.js solo pueden exportar los nombres
 * reservados (`GET`/`POST`/etc.) — cualquier otro export rompe la
 * verificación de tipos de rutas de Next, así que esto no puede exportarse
 * directamente desde ahí.
 */

// Solo el último elemento sin 'evidencias' (archivos embebidos ~3.5 MB/registro) —
// la lista ve solo estado/causa del último. Además se manda un resumen liviano
// (solo nombre + cargo, sin adjuntos) de TODOS los responsables para poder
// mostrarlos en la columna Responsable sin inflar el payload de la lista.
export const SQL_ASIG_LAST = `CASE WHEN asignaciones IS NULL OR jsonb_array_length(asignaciones) = 0 THEN '[]'::jsonb ELSE jsonb_build_array((asignaciones -> -1) - 'evidencias') END AS asignaciones`;
export const SQL_ASIG_RESUMEN = `CASE WHEN asignaciones IS NULL OR jsonb_array_length(asignaciones) = 0 THEN '[]'::jsonb ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('analistaAsignado', elem->'analistaAsignado', 'analistaCargo', elem->'analistaCargo')) FROM jsonb_array_elements(asignaciones) elem WHERE COALESCE(elem->>'analistaAsignado','') != ''), '[]'::jsonb) END AS "asignacionesResumen"`;

// Optimización "tiempo de carga de responsables" — resumen liviano
// (usuario+cargo, SIN ids/fechas/observaciones/evidencias) de responsables
// ACTIVOS y ÚNICOS, calculado en la propia consulta de listado desde el
// JSONB completo (nunca `asignaciones -> -1`) — permite que la ficha
// muestre a todos los responsables de inmediato, sin esperar el detalle
// completo. `activo` ausente cuenta como activo (compatibilidad histórica,
// misma regla que `obtenerResponsablesActivos` en el cliente); se exige
// `idAsignacion` no vacío (misma validez que `esAsignacionValida`).
//
// Deduplicación e identidad — el modelo actual de `asignaciones[]` NO tiene
// ningún `userId` numérico (auditado: no existe en ninguna fila), así que
// `analistaAsignado` normalizado (`lower(trim(...))`) es la identidad más
// fuerte disponible sin migrar el esquema — NUNCA `idAsignacion`: ya se
// encontró un `idAsignacion` duplicado entre lo que se creyó eran dos
// usuarios distintos (auditoría SQR 273508/273424) — deduplicar por
// `idAsignacion` arriesgaría fusionar a dos personas reales si eso volviera
// a ocurrir. `idAsignacion` se usa aquí SOLO como desempate determinístico
// dentro de un mismo usuario (p.ej. filas históricas duplicadas). El
// `ORDER BY` es explícito y completo (usuario normalizado + idAsignacion)
// tanto para `DISTINCT ON` como para el propio `jsonb_agg` — nunca se
// confía en el orden del JSONB, de inserción, ni el que devuelva Prisma.
// Debe coincidir EXACTAMENTE con `obtenerResponsablesActivos` en
// `seleccion-asignacion.ts` (misma clave de identidad, mismo desempate).
export const SQL_RESPONSABLES_RESUMEN = `CASE WHEN asignaciones IS NULL OR jsonb_array_length(asignaciones) = 0 THEN '[]'::jsonb ELSE COALESCE((
  SELECT jsonb_agg(jsonb_build_object('usuario', sub.u, 'cargo', sub.c) ORDER BY sub.clave, sub.idasig)
  FROM (
    SELECT DISTINCT ON (lower(trim(elem->>'analistaAsignado')))
      elem->>'analistaAsignado' AS u,
      elem->>'analistaCargo' AS c,
      lower(trim(elem->>'analistaAsignado')) AS clave,
      elem->>'idAsignacion' AS idasig
    FROM jsonb_array_elements(asignaciones) elem
    WHERE COALESCE(elem->>'analistaAsignado','') != ''
      AND COALESCE(elem->>'idAsignacion','') != ''
      AND COALESCE(elem->>'activo','true') != 'false'
    ORDER BY lower(trim(elem->>'analistaAsignado')), elem->>'idAsignacion'
  ) sub
), '[]'::jsonb) END AS "responsablesResumen"`;

// `COUNT(...)` en PostgreSQL devuelve `bigint` — Prisma lo entrega como
// `BigInt` de JS, que `JSON.stringify`/`NextResponse.json` no puede
// serializar ("Do not know how to serialize a BigInt"). Se castea a
// `::integer` en el propio SQL (un conteo de responsables nunca se acerca
// al rango de bigint) — más el respaldo defensivo `Number(...)` en
// `serializeSolicitud` (nunca al revés: los IDs grandes si los hubiera
// deben ir a string, nunca a Number, para no perder precisión — no es el
// caso aquí, es un conteo pequeño).
export const SQL_CANTIDAD_RESPONSABLES = `CASE WHEN asignaciones IS NULL THEN 0 ELSE (
  SELECT COUNT(DISTINCT lower(trim(elem->>'analistaAsignado')))::integer
  FROM jsonb_array_elements(asignaciones) elem
  WHERE COALESCE(elem->>'analistaAsignado','') != ''
    AND COALESCE(elem->>'idAsignacion','') != ''
    AND COALESCE(elem->>'activo','true') != 'false'
) END AS "cantidadResponsablesActivos"`;

export function trimAsignaciones(s: Record<string, unknown>): Record<string, unknown> {
  const asig = s.asignaciones;
  const resumen = Array.isArray(asig)
    ? asig
        .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object' && !!(a as Record<string, unknown>).analistaAsignado)
        .map(a => ({ analistaAsignado: a.analistaAsignado, analistaCargo: a.analistaCargo }))
    : [];
  if (Array.isArray(asig) && asig.length > 0) {
    const last = { ...(asig[asig.length - 1] as Record<string, unknown>) };
    delete last.evidencias;
    return { ...s, asignaciones: [last], asignacionesResumen: resumen };
  }
  return { ...s, asignacionesResumen: resumen };
}

export function serializeSolicitud(s: Record<string, unknown>) {
  return {
    ...s,
    valor: s.valor != null ? Number(s.valor) : null,
    // Defensa contra `BigInt` no serializable — el propio SQL ya castea
    // `COUNT(...)::integer`, esto es un respaldo si esa conversión llegara
    // a faltar en algún camino futuro. Es un conteo pequeño (nunca un ID
    // grande), por eso se convierte a `Number` y no a `String`.
    ...(s.cantidadResponsablesActivos !== undefined
      ? { cantidadResponsablesActivos: Number(s.cantidadResponsablesActivos ?? 0) }
      : {}),
    fechaPublicacion:
      s.fechaPublicacion instanceof Date ? s.fechaPublicacion.toISOString() : (s.fechaPublicacion ?? null),
    fechaVencimiento:
      s.fechaVencimiento instanceof Date ? s.fechaVencimiento.toISOString() : (s.fechaVencimiento ?? null),
    fechaCierre:
      s.fechaCierre instanceof Date ? s.fechaCierre.toISOString() : (s.fechaCierre ?? null),
    fechaAperturaSqr:
      s.fechaAperturaSqr instanceof Date ? s.fechaAperturaSqr.toISOString() : (s.fechaAperturaSqr ?? null),
    fechaCierreSqr:
      s.fechaCierreSqr instanceof Date ? s.fechaCierreSqr.toISOString() : (s.fechaCierreSqr ?? null),
    fechaEntregaInfo:
      s.fechaEntregaInfo instanceof Date ? s.fechaEntregaInfo.toISOString() : (s.fechaEntregaInfo ?? null),
    createdAt:
      s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
    updatedAt:
      s.updatedAt instanceof Date ? s.updatedAt.toISOString() : s.updatedAt,
  };
}