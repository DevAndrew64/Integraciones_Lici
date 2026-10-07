/**
 * Otros costos por línea de cargo — implementación funcional posterior a
 * la auditoría de alcance ya aceptada. Reemplaza el modelo anterior
 * ("promedio global × N.° trabajadores global") por asociación explícita
 * de cada concepto (Dotación, EPP, Exámenes, Cursos, Vacunas) a una línea
 * de Mano de Obra o Turnante concreta, vía `lineaManoObraId` — nunca por
 * nombre de cargo (dos líneas pueden compartir el mismo `nombreCargo`).
 *
 * Este módulo es PURO — page.tsx nunca debe sumar/multiplicar estos
 * conceptos por su cuenta; solo debe: resolver la asociación de cada
 * fila/grupo (resolverLineaManoObraId), agrupar por línea, y llamar
 * `construirDesgloseOtrosCostosLinea` / `construirResultadoLineaConOtrosCostos`
 * / `agregarCostoMensualTotalManoObra`.
 *
 * No modifica motor-tarifa-mensual.ts ni resultado-financiero-mensual-linea.ts
 * (el costo LABORAL de la línea, `tarifaMensualLinea`/`tarifaMensualPorTrabajador`,
 * permanece exactamente como ya fue cerrado y aceptado) — este módulo
 * combina ese resultado laboral con los otros costos ya resueltos por
 * línea, en una función de combinación separada, nunca reabriendo el
 * ensamblador financiero.
 */

function redondearPeso(n: number): number { return Math.round(n); }
function sum(valores: number[]): number { return valores.reduce((s, v) => s + v, 0); }

// ── §16 Compatibilidad con registros antiguos ──────────────────────────────

export type EstadoAsignacionCosto = 'ASIGNADO' | 'PENDIENTE_DE_ASIGNACION';

/** Resumen mínimo de una línea (Mano de Obra o Turnante) necesario para
 * resolver asociaciones — `id` es el `lineaManoObraId` estable (nunca el
 * índice del arreglo), `cargoCodigo` se usa SOLO como respaldo histórico. */
export interface LineaManoObraResumen {
  id: number;
  cargoCodigo: string;
  cantidadTrabajadores: number;
}

export interface ConAsociacionLinea {
  lineaManoObraId?: number | null;
  /** Compatibilidad histórica ÚNICAMENTE — nunca clave de cálculo cuando
   * `lineaManoObraId` ya está resuelto. */
  cargoCodigo?: string | null;
}

export interface ResolucionAsociacionLinea {
  lineaManoObraIdResuelto: number | null;
  estado: EstadoAsignacionCosto;
}

/**
 * Resuelve a qué línea pertenece un costo, SIN adivinar (§16):
 * - Si ya trae `lineaManoObraId` explícito → se respeta tal cual.
 * - Caso A: si toda la estructura tiene exactamente 1 línea → se asigna a
 *   esa única línea (no hay ambigüedad posible).
 * - Caso B: si `cargoCodigo` coincide con EXACTAMENTE una línea → se
 *   asigna a esa línea.
 * - Caso C: cualquier otra situación (varias líneas, mismo cargo repetido,
 *   sin coincidencia) → `PENDIENTE_DE_ASIGNACION`, `lineaManoObraIdResuelto:
 *   null`. Nunca se reparte ni se adivina.
 * Esta resolución es una función pura de LECTURA — nunca muta el registro
 * original ni "corrige" el JSON histórico; el JSON solo cambia cuando el
 * usuario guarda de nuevo (page.tsx decide cuándo persistir el resultado).
 */
export function resolverLineaManoObraId(
  item: ConAsociacionLinea,
  lineas: LineaManoObraResumen[],
): ResolucionAsociacionLinea {
  if (item.lineaManoObraId != null) {
    return { lineaManoObraIdResuelto: item.lineaManoObraId, estado: 'ASIGNADO' };
  }
  if (lineas.length === 1) {
    return { lineaManoObraIdResuelto: lineas[0].id, estado: 'ASIGNADO' };
  }
  if (item.cargoCodigo) {
    const coincidencias = lineas.filter(l => l.cargoCodigo === item.cargoCodigo);
    if (coincidencias.length === 1) {
      return { lineaManoObraIdResuelto: coincidencias[0].id, estado: 'ASIGNADO' };
    }
  }
  return { lineaManoObraIdResuelto: null, estado: 'PENDIENTE_DE_ASIGNACION' };
}

// ── §3-§7 Cálculo por línea ─────────────────────────────────────────────────

export type AlcanceCosto = 'POR_TRABAJADOR' | 'POR_LINEA';

/** Un ítem/grupo YA resuelto a una línea concreta, con su valor mensual
 * YA calculado (page.tsx sigue siendo responsable de calcular el valor
 * mensual de una fila individual — cant×valor/frecuencia — este módulo
 * solo agrupa y suma esos valores ya calculados por concepto). */
export interface ItemCostoResuelto {
  valorMensual: number;
  /** Solo aplica a Cursos; ausente o 'POR_TRABAJADOR' en todo lo demás. */
  alcance?: AlcanceCosto;
}

export interface EntradaDesgloseOtrosCostosLinea {
  cantidadTrabajadores: number;
  dotacion: ItemCostoResuelto[];
  epp: ItemCostoResuelto[];
  examenes: ItemCostoResuelto[];
  cursos: ItemCostoResuelto[];
  vacunas: ItemCostoResuelto[];
}

export interface DesgloseOtrosCostosLinea {
  dotacionMensualPorTrabajador: number;
  eppMensualPorTrabajador: number;
  examenesMensualesPorTrabajador: number;
  cursosPorTrabajadorMensuales: number;
  cursosFijosLinea: number;
  vacunasMensualesPorTrabajador: number;
  otrosCostosMensualesPorTrabajadorLinea: number;
  otrosCostosFijosMensualesLinea: number;
  otrosCostosMensualesLinea: number;
  cantidadTrabajadores: number;
}

/**
 * Regla comercial vigente de promedio de Dotación entre las aplicaciones
 * Masculina y Femenina de UN MISMO sujeto de costo (línea principal o
 * turnante, nunca entre sujetos distintos):
 * - si ambas aplicaciones tienen elementos → promedio de sus dos totales
 *   unitarios (mensual por trabajador);
 * - si solo una tiene elementos → se usa ese valor tal cual, SIN
 *   promediar con la aplicación vacía (que daría la mitad de lo real);
 * - si ninguna tiene elementos → 0.
 * Un producto "Ambos/Unisex" que aparece con el MISMO valor en ambas
 * aplicaciones (ej. $20.000 en Hombre y $20.000 en Mujer) da como
 * resultado ese mismo valor ($20.000), nunca el doble ($40.000) —
 * `construirEntradaOtrosCostosLinea` (page.tsx) DEBE llamar esta función
 * y pasar únicamente el resultado (un solo ítem) a `dotacion`, nunca los
 * totales de Hombre y Mujer por separado (eso los SUMARÍA, no los
 * promediaría — bug histórico corregido aquí, fuente única). */
export function promediarDotacionPorSexo(
  totalMasculinoUnitario: number,
  hayMasculino: boolean,
  totalFemeninoUnitario: number,
  hayFemenino: boolean,
): number {
  if (hayMasculino && hayFemenino) return redondearPeso((totalMasculinoUnitario + totalFemeninoUnitario) / 2);
  if (hayMasculino) return redondearPeso(totalMasculinoUnitario);
  if (hayFemenino) return redondearPeso(totalFemeninoUnitario);
  return 0;
}

/** Único ensamblador puro de "otros costos" por línea — nunca se
 * duplica esta fórmula en page.tsx. Los conceptos POR_TRABAJADOR se
 * multiplican por `cantidadTrabajadores` UNA sola vez; los conceptos
 * POR_LINEA (hoy solo Cursos) nunca se multiplican por cantidad.
 * `entrada.dotacion` YA debe venir promediada por sexo (ver
 * `promediarDotacionPorSexo`) — este ensamblador solo suma lo que recibe,
 * nunca decide cómo se combinan Masculino/Femenino. */
export function construirDesgloseOtrosCostosLinea(
  entrada: EntradaDesgloseOtrosCostosLinea,
): DesgloseOtrosCostosLinea {
  const dotacionMensualPorTrabajador = redondearPeso(sum(entrada.dotacion.map(i => i.valorMensual)));
  const eppMensualPorTrabajador = redondearPeso(sum(entrada.epp.map(i => i.valorMensual)));
  const examenesMensualesPorTrabajador = redondearPeso(sum(entrada.examenes.map(i => i.valorMensual)));

  const cursosPorTrabajador = entrada.cursos.filter(c => (c.alcance ?? 'POR_TRABAJADOR') === 'POR_TRABAJADOR');
  const cursosFijos = entrada.cursos.filter(c => c.alcance === 'POR_LINEA');
  const cursosPorTrabajadorMensuales = redondearPeso(sum(cursosPorTrabajador.map(i => i.valorMensual)));
  const cursosFijosLinea = redondearPeso(sum(cursosFijos.map(i => i.valorMensual)));

  const vacunasMensualesPorTrabajador = redondearPeso(sum(entrada.vacunas.map(i => i.valorMensual)));

  const otrosCostosMensualesPorTrabajadorLinea = redondearPeso(
    dotacionMensualPorTrabajador + eppMensualPorTrabajador + examenesMensualesPorTrabajador
    + cursosPorTrabajadorMensuales + vacunasMensualesPorTrabajador,
  );
  const otrosCostosFijosMensualesLinea = cursosFijosLinea;
  // Única multiplicación por cantidadTrabajadores — nunca se repite.
  const otrosCostosMensualesLinea = redondearPeso(
    otrosCostosMensualesPorTrabajadorLinea * entrada.cantidadTrabajadores + otrosCostosFijosMensualesLinea,
  );

  return {
    dotacionMensualPorTrabajador, eppMensualPorTrabajador, examenesMensualesPorTrabajador,
    cursosPorTrabajadorMensuales, cursosFijosLinea, vacunasMensualesPorTrabajador,
    otrosCostosMensualesPorTrabajadorLinea, otrosCostosFijosMensualesLinea, otrosCostosMensualesLinea,
    cantidadTrabajadores: entrada.cantidadTrabajadores,
  };
}

// ── §8 Resultado financiero de la línea (laboral + otros costos) ──────────

export interface ResultadoLineaConOtrosCostos {
  /** Alias preferido — mismo valor que
   * ResultadoFinancieroMensualLinea.tarifaMensualPorTrabajador. */
  costoLaboralMensualPorTrabajador: number;
  /** Alias preferido — mismo valor que
   * ResultadoFinancieroMensualLinea.tarifaMensualLinea. NUNCA incluye
   * otros costos (dotación/EPP/exámenes/cursos/vacunas) — ver §8. */
  costoLaboralMensualLinea: number;
  otrosCostosMensualesPorTrabajadorLinea: number;
  otrosCostosFijosMensualesLinea: number;
  otrosCostosMensualesLinea: number;
  /** costoLaboralMensualLinea + otrosCostosMensualesLinea — NUNCA incluye
   * administración ni maquinaria (§10). */
  costoMensualTotalLinea: number;
  cantidadTrabajadores: number;
}

/** Combina el resultado LABORAL ya calculado (resultado-financiero-mensual-
 * linea.ts, sin modificar) con el desglose de otros costos de la misma
 * línea — nunca recalcula ni el uno ni el otro, solo suma una vez. */
export function construirResultadoLineaConOtrosCostos(
  costoLaboralMensualPorTrabajador: number,
  costoLaboralMensualLinea: number,
  desglose: DesgloseOtrosCostosLinea,
): ResultadoLineaConOtrosCostos {
  const costoMensualTotalLinea = redondearPeso(costoLaboralMensualLinea + desglose.otrosCostosMensualesLinea);
  return {
    costoLaboralMensualPorTrabajador,
    costoLaboralMensualLinea,
    otrosCostosMensualesPorTrabajadorLinea: desglose.otrosCostosMensualesPorTrabajadorLinea,
    otrosCostosFijosMensualesLinea: desglose.otrosCostosFijosMensualesLinea,
    otrosCostosMensualesLinea: desglose.otrosCostosMensualesLinea,
    costoMensualTotalLinea,
    cantidadTrabajadores: desglose.cantidadTrabajadores,
  };
}

// ── §13 Resultado agregado — Costo mensual total de Mano de Obra ──────────

export interface AgregadoCostoMensualTotalManoObra {
  costoLaboralMensualTotal: number;
  otrosCostosMensualesTotal: number;
  costoMensualTotalManoObra: number;
  cantidadLineas: number;
}

/** Único punto de entrada para agregar el costo mensual total de varias
 * líneas ya resueltas — nunca "costo promedio × total de trabajadores". */
export function agregarCostoMensualTotalManoObra(
  lineas: ResultadoLineaConOtrosCostos[],
): AgregadoCostoMensualTotalManoObra {
  const costoLaboralMensualTotal = redondearPeso(sum(lineas.map(l => l.costoLaboralMensualLinea)));
  const otrosCostosMensualesTotal = redondearPeso(sum(lineas.map(l => l.otrosCostosMensualesLinea)));
  const costoMensualTotalManoObra = redondearPeso(sum(lineas.map(l => l.costoMensualTotalLinea)));
  return { costoLaboralMensualTotal, otrosCostosMensualesTotal, costoMensualTotalManoObra, cantidadLineas: lineas.length };
}