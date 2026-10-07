/**
 * Semántica temporal correcta de TRM basada en VIGENCIAS oficiales
 * (vigenciaDesde/vigenciaHasta), no en igualdad de valor.
 *
 * Defecto auditado en `construirEventosEfectivos()` (producción, sin tocar):
 * esa función recibe una serie ya "aplanada" a un valor por día calendario
 * (expandirRangos() en trmFetchDatosGov.ts repite el valor en cada día que
 * cubre una vigencia, incluidos fines de semana/festivos) y colapsa por
 * IGUALDAD CONSECUTIVA DE VALOR sobre esa unidad de día calendario — nunca
 * ve vigenciaDesde/vigenciaHasta, porque esa información ya se perdió
 * aguas arriba. Consecuencia: 2 certificaciones oficiales DISTINTAS que
 * por coincidencia tengan el mismo valor y sean temporalmente adyacentes
 * se fusionan hoy en un solo "evento efectivo" — un error conceptual, no
 * solo de implementación.
 *
 * Este módulo reconstruye los eventos a partir de la fuente oficial
 * (valor + vigenciaDesde + vigenciaHasta) SIN pasar por ese aplanado:
 * cada certificación oficial es su propio evento, exista o no otra
 * certificación con el mismo valor antes o después.
 */

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface RegistroTrmOficial {
  valor: number;
  vigenciaDesde: string; // YYYY-MM-DD
  vigenciaHasta: string; // YYYY-MM-DD
}

export interface EventoTrmOficial {
  valor: number;
  decimal: number;
  vigenciaDesde: string;
  vigenciaHasta: string;
}

export interface ResultadoNormalizacionTrm {
  registros: RegistroTrmOficial[];
  /** Filas descartadas por valor no numérico/≤0 o fechas inválidas (desde>hasta, formato incorrecto). */
  descartados: number;
  /** Filas idénticas (mismo valor + misma vigencia exacta) eliminadas — duplicado real de datos, no evento nuevo. */
  duplicadosExactosEliminados: number;
  /** Huecos detectados entre el fin de una vigencia y el inicio de la siguiente (día calendario faltante en la fuente). */
  huecos: { desde: string; hasta: string }[];
}

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function decimalesDeValor(valor: number): number {
  return Math.round(valor * 100) % 100;
}

function addDiasStr(fecha: string, n: number): string {
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ─── 1) normalizarRegistrosTrmOficiales ────────────────────────────────────────

/**
 * Valida y ordena registros oficiales crudos (valor + vigenciaDesde + vigenciaHasta).
 *
 * - Descarta filas con valor no numérico/≤0, fechas con formato inválido, o
 *   vigenciaDesde > vigenciaHasta.
 * - Elimina duplicados EXACTOS (mismo valor + misma vigencia completa) —
 *   esto es basura de datos (la misma fila repetida en la fuente), no un
 *   evento nuevo.
 * - NUNCA fusiona registros distintos solo porque el valor coincide —
 *   eso es responsabilidad explícitamente evitada aquí y en
 *   `construirEventosTrmDesdeVigencias`.
 * - Detecta (y reporta, no descarta) solapamientos entre vigencias: lanza
 *   un Error — dos certificaciones oficiales no deberían solaparse; si
 *   ocurre, es una señal de datos corruptos que requiere revisión manual,
 *   no una decisión silenciosa del harness.
 * - Detecta huecos (días calendario sin ninguna vigencia que los cubra)
 *   y los reporta en el resultado, sin lanzar — un hueco no es un error
 *   de integridad, es información faltante de la fuente.
 */
export function normalizarRegistrosTrmOficiales(
  crudos: { valor: unknown; vigenciaDesde: unknown; vigenciaHasta: unknown }[],
): ResultadoNormalizacionTrm {
  let descartados = 0;
  const validos: RegistroTrmOficial[] = [];

  for (const r of crudos) {
    const valor = Number(r.valor);
    const desde = typeof r.vigenciaDesde === 'string' ? r.vigenciaDesde.slice(0, 10) : '';
    const hasta = typeof r.vigenciaHasta === 'string' ? r.vigenciaHasta.slice(0, 10) : '';
    const fechasValidas = RE_FECHA.test(desde) && RE_FECHA.test(hasta) && desde <= hasta;
    if (!isFinite(valor) || valor <= 0 || !fechasValidas) {
      descartados++;
      continue;
    }
    validos.push({ valor, vigenciaDesde: desde, vigenciaHasta: hasta });
  }

  // Duplicados exactos (misma tupla completa) — se conserva 1 copia.
  const vistos = new Set<string>();
  const sinDuplicados: RegistroTrmOficial[] = [];
  let duplicadosExactosEliminados = 0;
  for (const r of validos) {
    const clave = `${r.valor}|${r.vigenciaDesde}|${r.vigenciaHasta}`;
    if (vistos.has(clave)) { duplicadosExactosEliminados++; continue; }
    vistos.add(clave);
    sinDuplicados.push(r);
  }

  const ordenados = sinDuplicados.sort((a, b) => a.vigenciaDesde.localeCompare(b.vigenciaDesde));

  // Solapamientos → error explícito (dato corrupto, requiere revisión manual).
  for (let i = 1; i < ordenados.length; i++) {
    const prev = ordenados[i - 1];
    const cur = ordenados[i];
    if (cur.vigenciaDesde <= prev.vigenciaHasta) {
      throw new Error(
        `Vigencias solapadas: [${prev.vigenciaDesde}, ${prev.vigenciaHasta}] (valor ${prev.valor}) ` +
          `se solapa con [${cur.vigenciaDesde}, ${cur.vigenciaHasta}] (valor ${cur.valor}).`,
      );
    }
  }

  // Huecos: día calendario entre el fin de una vigencia y el inicio de la siguiente.
  const huecos: { desde: string; hasta: string }[] = [];
  for (let i = 1; i < ordenados.length; i++) {
    const finAnterior = ordenados[i - 1].vigenciaHasta;
    const inicioActual = ordenados[i].vigenciaDesde;
    const diaSiguienteFinAnterior = addDiasStr(finAnterior, 1);
    if (diaSiguienteFinAnterior < inicioActual) {
      huecos.push({ desde: diaSiguienteFinAnterior, hasta: addDiasStr(inicioActual, -1) });
    }
  }

  return { registros: ordenados, descartados, duplicadosExactosEliminados, huecos };
}

// ─── 2) construirEventosTrmDesdeVigencias ──────────────────────────────────────

/**
 * Convierte registros oficiales YA normalizados/ordenados en eventos.
 * Mapeo 1:1 — cada certificación oficial (cada RegistroTrmOficial) es su
 * propio EventoTrmOficial, exista o no otra certificación con el mismo
 * valor antes o después. Nunca fusiona por igualdad de valor.
 */
export function construirEventosTrmDesdeVigencias(
  registros: RegistroTrmOficial[],
): EventoTrmOficial[] {
  return registros.map(r => ({
    valor: r.valor,
    decimal: decimalesDeValor(r.valor),
    vigenciaDesde: r.vigenciaDesde,
    vigenciaHasta: r.vigenciaHasta,
  }));
}

// ─── 3) resolverTrmVigenteEnFecha ──────────────────────────────────────────────

/**
 * Evento oficial cuya vigencia [vigenciaDesde, vigenciaHasta] (inclusiva)
 * contiene `fecha`. Null si ninguna vigencia la cubre — NUNCA se inventa
 * un dato ni se extrapola desde el evento más cercano.
 * Requiere `eventos` ordenados ascendente por vigenciaDesde (ya lo están
 * si vienen de `construirEventosTrmDesdeVigencias` sobre registros normalizados).
 */
export function resolverTrmVigenteEnFecha(
  fecha: string,
  eventos: EventoTrmOficial[],
): EventoTrmOficial | null {
  // Búsqueda binaria: los intervalos no se solapan (garantizado por la
  // validación de normalizarRegistrosTrmOficiales) y están ordenados.
  let lo = 0, hi = eventos.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const e = eventos[mid];
    if (fecha < e.vigenciaDesde) hi = mid - 1;
    else if (fecha > e.vigenciaHasta) lo = mid + 1;
    else return e;
  }
  return null;
}

// ─── 4) resolverEventoObjetivo ─────────────────────────────────────────────────

/**
 * Evento oficial que responde por `fechaObjetivo`, dentro del histórico ya
 * certificado. Hoy es equivalente a `resolverTrmVigenteEnFecha` — se separa
 * como función propia porque en la Fase 2 (calendario futuro) ganará un
 * fallback explícito al "intervalo de vigencia esperado" cuando
 * `fechaObjetivo` sea posterior a la última certificación oficial
 * disponible (nunca inventa el VALOR, solo predice a qué intervalo de
 * vigencia pertenecerá una vez publicado). Esa lógica de fallback NO se
 * implementa todavía — ver `resolverIntervaloVigenciaEsperado` (diseño).
 */
export function resolverEventoObjetivo(
  fechaObjetivo: string,
  eventos: EventoTrmOficial[],
): EventoTrmOficial | null {
  return resolverTrmVigenteEnFecha(fechaObjetivo, eventos);
}

// ─── 5) agruparFechasPorEventoTrm ──────────────────────────────────────────────

/**
 * Agrupa una lista de fechas candidatas por el evento cuya vigencia las
 * cubre. Varias fechas de la misma vigencia (ej. sábado/domingo/lunes que
 * comparten la misma certificación) quedan en el mismo grupo — deben
 * reutilizar la misma predicción/evento, nunca tratarse como observaciones
 * independientes. La clave del mapa es `${vigenciaDesde}|${vigenciaHasta}`
 * (estable, determinística); fechas sin evento (fuera de cobertura) quedan
 * bajo la clave `null`, sin inventar un evento para ellas.
 */
export function agruparFechasPorEventoTrm(
  fechas: string[],
  eventos: EventoTrmOficial[],
): { evento: EventoTrmOficial | null; clave: string | null; fechas: string[] }[] {
  const grupos = new Map<string | null, { evento: EventoTrmOficial | null; fechas: string[] }>();
  for (const fecha of fechas) {
    const evento = resolverTrmVigenteEnFecha(fecha, eventos);
    const clave = evento ? `${evento.vigenciaDesde}|${evento.vigenciaHasta}` : null;
    if (!grupos.has(clave)) grupos.set(clave, { evento, fechas: [] });
    grupos.get(clave)!.fechas.push(fecha);
  }
  return Array.from(grupos.entries()).map(([clave, g]) => ({ evento: g.evento, clave, fechas: g.fechas }));
}
