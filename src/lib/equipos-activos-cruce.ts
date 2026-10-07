// src/lib/equipos-activos-cruce.ts
//
// Ajuste "INTEGRACIÓN DE DOS ENDPOINTS — CATÁLOGO + DISPONIBILIDAD" (ronda
// original) — cruza un catálogo (una fila por equipo distinto) con la
// disponibilidad real (`equipos/obtener`, una fila por UEN/lote de compra).
// Puro — sin fetch, sin React — para poder probarlo con datos reales sin
// depender de la red.
//
// Confirmado con datos reales (búsqueda "brilla", empresa aseo): `tipo_c +
// sub_tipo_c` NO identifica un equipo de forma única — el subtipo "004+014"
// ("BRILLADORA INDUSTRIAL 17" 175 RPM") agrupa en la práctica más de 10
// `nombre_c` distintos (BRILLADORA INDUSTRIAL 16"/17"/17" ELECTROLUX/
// LAVABRILLADORA...). El cruce exige los TRES: `tipo_c` + `sub_tipo_c` +
// `nombre_c` normalizado — nunca solo los códigos, nunca solo el texto.
//
// Ajuste "CATÁLOGO ÚNICO DESDE equipos/obtener" — el catálogo original
// venía de `equipos/obtener_recientes`, retirado por devolver casi nada
// (ver docblock de `equipos-activos-buscar.ts`). `derivarCatalogoDesdeActivos`
// (más abajo) construye el catálogo agrupando la MISMA respuesta de
// `equipos/obtener` por `codGrupo`+`codSubtipo`+`nombre_c` normalizado (la
// misma identidad que ya exigía el cruce), eligiendo como fila
// representativa la de `fecha_adquisicion` más reciente del grupo — mismo
// criterio ("la compra más reciente") que tenía `obtener_recientes`, pero
// derivado de datos reales completos en vez de depender de una fuente que
// no los entrega.

/** Normalización SOLO para comparar (nunca se usa para mostrar al
 * usuario): trim, mayúsculas, sin tildes, espacios repetidos colapsados a
 * uno — confirmado necesario con datos reales: la misma fuente registra
 * "BRILLADORA INDUSTRIAL  17"" (doble espacio) y "BRILLADORA INDUSTRIAL 17""
 * (un espacio) para el mismo equipo físico en filas distintas. */
export function normalizarNombreEquipoActivo(nombre: string): string {
  return nombre
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export interface FilaCatalogoParaCruce {
  codGrupo: string;
  codSubtipo: string;
  nombre_c: string;
}

export interface FilaDisponibilidadParaCruce {
  codGrupo: string;
  codSubtipo: string;
  nombre_c: string;
  uen: string;
  ubicacion: string;
  cantidadDisponible: number;
  valorMantenimiento: number | null;
}

export interface DisponibilidadPorUen {
  uen: string;
  ubicacion: string;
  cantidad: number;
}

export interface ResultadoCruceDisponibilidad {
  disponibilidadPorUen: DisponibilidadPorUen[];
  disponibleTotal: number;
  valorMantenimiento: number | null;
  /** true si distintas filas cruzadas traen `valorMantenimiento` DISTINTO
   * — nunca se elige uno arbitrariamente en ese caso (`valorMantenimiento`
   * queda `null` y este flag avisa que hay que revisar el dato en origen). */
  valorMantenimientoConflictivo: boolean;
  valorMantenimientoValoresDistintos: number[];
}

/**
 * Cruza UN equipo del catálogo contra el arreglo completo de
 * disponibilidad de la misma búsqueda (empresa+descripción) — filtra por
 * `codGrupo`+`codSubtipo`+`nombre_c` normalizado (los tres, nunca solo
 * los códigos: ver nota del encabezado) y agrupa por `uen` (una búsqueda
 * puede traer más de una fila para el mismo UEN — ej. lotes de compra con
 * distinto nombre_c "casi igual" que normalizan igual — se SUMAN, nunca
 * se listan duplicadas). Nunca falla si no hay coincidencias: devuelve
 * disponibilidad vacía/0, `valorMantenimiento:null` — un equipo del
 * catálogo sin match en disponibilidad es un caso válido, no un error.
 */
export function cruzarEquipoConDisponibilidad(
  equipoCatalogo: FilaCatalogoParaCruce,
  disponibilidad: readonly FilaDisponibilidadParaCruce[],
): ResultadoCruceDisponibilidad {
  const nombreNorm = normalizarNombreEquipoActivo(equipoCatalogo.nombre_c);
  const coincidencias = disponibilidad.filter(d =>
    d.codGrupo === equipoCatalogo.codGrupo
    && d.codSubtipo === equipoCatalogo.codSubtipo
    && normalizarNombreEquipoActivo(d.nombre_c) === nombreNorm,
  );

  const porUen = new Map<string, DisponibilidadPorUen>();
  for (const c of coincidencias) {
    const existente = porUen.get(c.uen);
    if (existente) existente.cantidad += c.cantidadDisponible;
    else porUen.set(c.uen, { uen: c.uen, ubicacion: c.ubicacion, cantidad: c.cantidadDisponible });
  }
  const disponibilidadPorUen = [...porUen.values()].sort((a, b) => a.uen.localeCompare(b.uen));
  const disponibleTotal = disponibilidadPorUen.reduce((s, x) => s + x.cantidad, 0);

  // Ajuste "NO ELIJAS UNO SILENCIOSAMENTE" — confirmado con datos reales
  // (mismo equipo, misma búsqueda "brilla": BAQ/BOG=$40.000, MIN=$0) que
  // el mantenimiento SÍ puede diferir entre filas del mismo equipo. Solo
  // se usa el valor cuando TODAS las filas con dato coinciden.
  const valoresMantenimiento = [...new Set(
    coincidencias.map(c => c.valorMantenimiento).filter((v): v is number => v != null),
  )];
  const valorMantenimientoConflictivo = valoresMantenimiento.length > 1;
  const valorMantenimiento = valoresMantenimiento.length === 1 ? valoresMantenimiento[0] : null;

  return { disponibilidadPorUen, disponibleTotal, valorMantenimiento, valorMantenimientoConflictivo, valorMantenimientoValoresDistintos: valoresMantenimiento };
}

/** Cruza TODO el catálogo de una búsqueda contra su disponibilidad — un
 * solo recorrido, reutilizado por cada fila (`cruzarEquipoConDisponibilidad`
 * pura, sin estado compartido entre filas). */
export function cruzarCatalogoConDisponibilidad<T extends FilaCatalogoParaCruce>(
  catalogo: readonly T[],
  disponibilidad: readonly FilaDisponibilidadParaCruce[],
): (T & ResultadoCruceDisponibilidad)[] {
  return catalogo.map(item => ({ ...item, ...cruzarEquipoConDisponibilidad(item, disponibilidad) }));
}

/** Campos de `equipos/obtener` (`EquipoActivoBuscado`) que hacen falta para
 * mostrar una fila de catálogo (además de los ya exigidos por
 * `FilaDisponibilidadParaCruce`) — nunca se inventan, ya vienen todos en la
 * misma respuesta de disponibilidad. */
export interface FilaActivaParaCatalogo extends FilaDisponibilidadParaCruce {
  grupo: string;
  sub_tipo: string;
  fecha_adquisicion: string | null;
  valor: number | null;
}

/**
 * Deriva el catálogo (una fila por equipo distinto) directamente de la
 * respuesta de `equipos/obtener` — agrupa por `codGrupo`+`codSubtipo`+
 * `nombre_c` normalizado (misma identidad que exige el cruce, ver docblock
 * del encabezado) y elige, por grupo, la fila con `fecha_adquisicion` más
 * reciente como representativa para mostrar nombre/valor/fecha (empates:
 * se conserva la primera fila vista del grupo — nunca una elección
 * arbitraria distinta en cada llamada, el recorrido es determinista).
 * Nunca produce más de una fila por grupo — reemplaza por completo al
 * antiguo catálogo de `equipos/obtener_recientes`.
 */
export function derivarCatalogoDesdeActivos<T extends FilaActivaParaCatalogo>(
  activos: readonly T[],
): T[] {
  const porGrupo = new Map<string, T>();
  for (const fila of activos) {
    const clave = `${fila.codGrupo}::${fila.codSubtipo}::${normalizarNombreEquipoActivo(fila.nombre_c)}`;
    const actual = porGrupo.get(clave);
    if (!actual) { porGrupo.set(clave, fila); continue; }
    const fechaActual = actual.fecha_adquisicion ? Date.parse(actual.fecha_adquisicion) : -Infinity;
    const fechaNueva = fila.fecha_adquisicion ? Date.parse(fila.fecha_adquisicion) : -Infinity;
    if (fechaNueva > fechaActual) porGrupo.set(clave, fila);
  }
  return [...porGrupo.values()];
}
