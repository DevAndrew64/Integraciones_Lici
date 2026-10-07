/**
 * Ajuste "CORREGIR SELECTOR DE EXÁMENES MÉDICOS" (confirmado
 * explícitamente) — módulo PURO: filtra → agrupa por identidad real del
 * examen → elige la oferta de MAYOR valor por grupo → pagina los
 * EXÁMENES AGRUPADOS (nunca las ofertas crudas de proveedor). El bug
 * reportado (4.749 resultados/159 páginas, el mismo `cod_examen`
 * repartido entre páginas distintas) viene de paginar directamente sobre
 * las ofertas de proveedor sin agrupar primero — este módulo es el punto
 * ÚNICO donde se corrige, reutilizado por ambos endpoints de exámenes.
 */

export interface OfertaExamen {
  cod_grupo_exam?: unknown;
  cod_examen?: unknown;
  nit_proveedor?: unknown;
  codmun?: unknown;
  ciudad?: unknown;
  descripcion?: unknown;
  vlr_costo?: unknown;
  [k: string]: unknown;
}

export interface FiltrosExamenes {
  grupoExam?: string;
  codExamen?: string;
  nitProveedor?: string;
  codmun?: string;
  ciudad?: string;
  q?: string;
  valMin?: number;
  valMax?: number;
}

function texto(v: unknown): string {
  return String(v ?? '').trim().toLowerCase();
}

function numero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Filtro EXPLÍCITO campo por campo — nunca solo `q` libre sobre
 * `Object.values` para ciudad/grupo/examen/nit/municipio (eso permitiría
 * coincidencias accidentales en otras columnas). Se aplica ANTES de
 * agrupar (§1/§5/§9 del ajuste): ciudad es un FILTRO que reduce el
 * conjunto de trabajo, nunca parte de la identidad del examen.
 */
export function filtrarOfertasExamenes(ofertas: OfertaExamen[], filtros: FiltrosExamenes): OfertaExamen[] {
  let r = ofertas;
  if (filtros.grupoExam?.trim()) {
    const g = texto(filtros.grupoExam);
    r = r.filter((o) => texto(o.cod_grupo_exam).includes(g));
  }
  if (filtros.codExamen?.trim()) {
    const c = texto(filtros.codExamen);
    r = r.filter((o) => texto(o.cod_examen).includes(c));
  }
  if (filtros.nitProveedor?.trim()) {
    const n = texto(filtros.nitProveedor);
    r = r.filter((o) => texto(o.nit_proveedor).includes(n));
  }
  if (filtros.codmun?.trim()) {
    const c = texto(filtros.codmun);
    r = r.filter((o) => texto(o.codmun).includes(c));
  }
  if (filtros.ciudad?.trim()) {
    const c = texto(filtros.ciudad);
    r = r.filter((o) => texto(o.ciudad).includes(c));
  }
  if (filtros.q?.trim()) {
    const q = texto(filtros.q);
    r = r.filter((o) => Object.values(o).some((v) => texto(v).includes(q)));
  }
  if (filtros.valMin != null && Number.isFinite(filtros.valMin)) {
    r = r.filter((o) => numero(o.vlr_costo) >= filtros.valMin!);
  }
  if (filtros.valMax != null && Number.isFinite(filtros.valMax)) {
    r = r.filter((o) => numero(o.vlr_costo) <= filtros.valMax!);
  }
  return r;
}

export interface ExamenAgrupado {
  cod_grupo_exam: string;
  cod_examen: string;
  descripcion: string;
  vlr_costo: number;
  ciudad: string;
  codmun: string;
  nit_proveedor: string;
  nombre_proveedor: string;
  /** Número de ofertas/proveedores agrupados bajo este examen, DESPUÉS de aplicar los filtros — nunca el total bruto sin filtrar. */
  numOfertas: number;
  /** Todas las ofertas del grupo, ordenadas por valor descendente (la [0] es la representante). */
  ofertas: OfertaExamen[];
}

/**
 * Identidad ESTABLE de un examen — Ajuste §4 + corrección de seguimiento
 * (confirmada explícitamente tras ver el caso real sin filtro de
 * ciudad): `cod_grupo_exam` + `cod_examen` + `ciudad`. La ciudad SIEMPRE
 * forma parte de la identidad — nunca solo un filtro previo — porque de
 * lo contrario, sin filtro de ciudad activo, se mezclarían ofertas de
 * ciudades distintas bajo un mismo "×N" y la columna Ciudad de la fila
 * representante mostraría solo UNA de varias ciudades reales, ocultando
 * el resto (confuso e incorrecto: "×31" pareciendo un solo lugar cuando
 * en realidad son 31 ofertas repartidas en ciudades distintas). Con
 * ciudad en la identidad, cada ciudad queda SIEMPRE en su propia fila —
 * nunca se mezclan `EM001|EX001|Cartago` con `EM001|EX001|Bogotá`, ni
 * `EM001|EX001` con `EM002|EX001` (grupos distintos, identidades distintas).
 */
export function identidadExamenAgrupado(o: OfertaExamen): string {
  return `${texto(o.cod_grupo_exam)}|${texto(o.cod_examen)}|${texto(o.ciudad)}`;
}

/**
 * Agrupa por identidad y elige SIEMPRE la oferta de MAYOR valor como
 * representante (Ajuste §3, deliberado — nunca promedio ni mínimo).
 * Orden de salida ESTABLE por `cod_grupo_exam` y luego `cod_examen`
 * (Ajuste §13) — para que cambiar de página nunca reordene registros.
 */
export function agruparExamenesPorMayorValor(ofertas: OfertaExamen[]): ExamenAgrupado[] {
  const grupos = new Map<string, OfertaExamen[]>();
  for (const o of ofertas) {
    const key = identidadExamenAgrupado(o);
    const arr = grupos.get(key);
    if (arr) arr.push(o);
    else grupos.set(key, [o]);
  }
  const resultado: ExamenAgrupado[] = [];
  for (const grupo of grupos.values()) {
    const ordenado = [...grupo].sort((a, b) => numero(b.vlr_costo) - numero(a.vlr_costo));
    const rep = ordenado[0];
    resultado.push({
      cod_grupo_exam: String(rep.cod_grupo_exam ?? ''),
      cod_examen: String(rep.cod_examen ?? ''),
      descripcion: String(rep.descripcion ?? ''),
      vlr_costo: numero(rep.vlr_costo),
      ciudad: String(rep.ciudad ?? ''),
      codmun: String(rep.codmun ?? ''),
      nit_proveedor: String(rep.nit_proveedor ?? ''),
      nombre_proveedor: String(rep.nombre_proveedor ?? ''),
      numOfertas: grupo.length,
      ofertas: ordenado,
    });
  }
  resultado.sort((a, b) => a.cod_grupo_exam.localeCompare(b.cod_grupo_exam) || a.cod_examen.localeCompare(b.cod_examen));
  return resultado;
}

export interface ResultadoConsultaExamenes {
  data: ExamenAgrupado[];
  total: number;
  totalPages: number;
  page: number;
  limit: number;
}

/**
 * Punto ÚNICO de consulta — Ajuste §5/§12: filtra → agrupa → pagina
 * EXÁMENES AGRUPADOS. `total`/`totalPages` representan exámenes únicos,
 * nunca ofertas brutas — el mismo examen agrupado nunca queda repartido
 * entre dos páginas porque la paginación ocurre DESPUÉS de agrupar.
 */
export function consultarExamenesAgrupados(
  todos: OfertaExamen[],
  filtros: FiltrosExamenes,
  page: number,
  limit: number,
  exportAll: boolean,
): ResultadoConsultaExamenes {
  const filtrados = filtrarOfertasExamenes(todos, filtros);
  const agrupados = agruparExamenesPorMayorValor(filtrados);
  const total = agrupados.length;
  const totalPages = exportAll ? 1 : Math.max(1, Math.ceil(total / limit));
  const safePage = exportAll ? 1 : Math.min(Math.max(1, page), totalPages);
  const data = exportAll ? agrupados : agrupados.slice((safePage - 1) * limit, safePage * limit);
  return { data, total, totalPages, page: safePage, limit };
}
