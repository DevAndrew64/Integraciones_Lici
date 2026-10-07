/**
 * Contrato del JSON que el navegador envía a "Exportar costos": son los
 * valores que la pantalla YA calculó y muestra (panel de Resumen + filas de
 * las pestañas). El servidor solo los escribe en el Excel: no recalcula nada,
 * así que el archivo coincide con lo que el usuario ve por construcción.
 *
 * Lo único que valida el servidor es la forma (números finitos, listas) y
 * que las sumas del propio JSON cuadren (detecta un payload corrupto o un
 * bug del cliente, nunca "corrige" un valor).
 */

export interface TotalesPantallaDto {
  /** Panel de Resumen de la pantalla (tarifaMensualTotalManoObra). Ya incluye Turnantes, Dotación/EPP, Exámenes, Cursos y Vacunas. */
  manoObra: number;
  /** Parte de `manoObra` que corresponde a Dotación, EPP, Exámenes, Cursos y Vacunas (informativo, no se suma otra vez). */
  otrosCostosEnManoObra: number;
  insumos: number;
  maquinaria: number;
  serviciosNoContinuos: number;
  valorAgregado: number;
  administrativos: number;
  /** Panel de Resumen de la pantalla (totalCostoInternoProceso). */
  total: number;
}

export interface VariableAdministrativaPantallaDto {
  concepto: string;
  /** Cantidad efectiva que usó la pantalla (la automática ya viene resuelta con el total de trabajadores). */
  cantidad: number;
  valorUnitario: number;
  valorMensual: number;
}

export interface AdministrativosPantallaDto {
  variables: VariableAdministrativaPantallaDto[];
  totalVariables: number;
  valorMensualPolizas: number;
  valorMensualImpuestos: number;
}

export interface FilaDotacionEppPantallaDto {
  grupo: string;
  tipo: 'Dotación' | 'EPP';
  codigo: string;
  descripcion: string;
  unidad: string;
  cantidad: number;
  frecuencia: number;
  valorUnitario: number;
  valorMensual: number;
}

export interface CargoDotacionEppPantallaDto {
  cargo: string;
  cantidadTrabajadores: number;
  /** El "valor único por cargo" que muestra la pestaña EPP y Dotación. */
  totalUnitario: number;
  filas: FilaDotacionEppPantallaDto[];
}

export interface FilaExamenPantallaDto {
  concepto: string;
  detalle: string;
  cantidad: number;
  valor: number;
  valorMensual: number;
}

export interface CargoExamenesPantallaDto {
  cargo: string;
  cantidadTrabajadores: number;
  /** El total por cargo que muestra la pestaña Exámenes, Cursos y Vacunas. */
  totalUnitario: number;
  examenes: FilaExamenPantallaDto[];
  cursos: FilaExamenPantallaDto[];
  vacunas: FilaExamenPantallaDto[];
}

export interface FilaInsumoPantallaDto {
  codigo: string;
  nombre: string;
  unidad: string;
  cantidad: number;
  frecuenciaMeses: number;
  valorUnitarioSinIva: number;
  valorUnitarioConIva: number;
  valorMensual: number;
  /** Marcado como Valor agregado: se lista, pero NO suma en el total de Insumos. */
  valorAgregado: boolean;
}

export interface FilaMaquinariaPantallaDto {
  codigo: string;
  descripcion: string;
  categoria: string;
  cantidadRequerida: number;
  cantidadComprar: number;
  valorUnitario: number;
  valorMesComprar: number;
  valorMesMantenimiento: number;
  /** Marcado como Valor agregado: se lista, pero NO suma en los subtotales de Maquinaria. */
  valorAgregado: boolean;
}

export interface CostosPantallaDto {
  /** Total de trabajadores del servicio que muestra la pantalla (ordinarios + turnantes físicos). */
  nTrabajadores: number;
  /** Nombres de los cargos de Mano de Obra tal como los muestra la pantalla. */
  cargos: string[];
  totales: TotalesPantallaDto;
  administrativos: AdministrativosPantallaDto;
  dotacionEpp: { cargos: CargoDotacionEppPantallaDto[]; total: number };
  examenes: { cargos: CargoExamenesPantallaDto[]; total: number };
  /** `total` = el de la pestaña Insumos (sin las filas de Valor agregado). */
  insumos: { filas: FilaInsumoPantallaDto[]; total: number };
  /** Subtotales de la pestaña Maquinaria y Equipos (sin las filas de Valor agregado). */
  maquinaria: { filas: FilaMaquinariaPantallaDto[]; subtotalAdquisicion: number; subtotalMantenimiento: number };
}

export type ResultadoValidacionCostosPantalla = { ok: true } | { ok: false; errores: string[] };

const MAX_FILAS = 5000;
const TOLERANCIA_PESOS = 1;

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function esNumeroFinito(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function cerca(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOLERANCIA_PESOS;
}

/** Recorre el JSON completo: todo número debe ser finito y todo arreglo razonable. */
function revisarNumeros(valor: unknown, ruta: string, errores: string[]): void {
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) errores.push(`${ruta} debe ser un número finito.`);
    return;
  }
  if (Array.isArray(valor)) {
    if (valor.length > MAX_FILAS) { errores.push(`${ruta} tiene demasiadas filas.`); return; }
    valor.forEach((v, i) => revisarNumeros(v, `${ruta}[${i}]`, errores));
    return;
  }
  if (esObjeto(valor)) {
    for (const [k, v] of Object.entries(valor)) revisarNumeros(v, `${ruta}.${k}`, errores);
  }
}

export function validarCostosPantallaDto(dto: unknown): ResultadoValidacionCostosPantalla {
  const errores: string[] = [];
  if (!esObjeto(dto)) return { ok: false, errores: ['costosDto es obligatorio.'] };

  const { totales, administrativos, dotacionEpp, examenes, insumos, maquinaria, cargos } = dto as Record<string, unknown>;
  if (!esNumeroFinito(dto.nTrabajadores)) errores.push('nTrabajadores debe ser un número finito.');
  if (!Array.isArray(cargos) || !cargos.every((c) => typeof c === 'string')) errores.push('cargos debe ser una lista de nombres.');
  if (!esObjeto(insumos) || !Array.isArray(insumos.filas) || !insumos.filas.every(esObjeto)) errores.push('insumos.filas debe ser una lista de filas.');
  if (!esObjeto(maquinaria) || !Array.isArray(maquinaria.filas) || !maquinaria.filas.every(esObjeto)) errores.push('maquinaria.filas debe ser una lista de filas.');
  if (!esObjeto(totales)) errores.push('totales es obligatorio.');
  if (!esObjeto(administrativos) || !Array.isArray(administrativos.variables) || !administrativos.variables.every(esObjeto)) errores.push('administrativos.variables debe ser una lista de filas.');
  if (!esObjeto(dotacionEpp) || !Array.isArray(dotacionEpp.cargos) || !dotacionEpp.cargos.every(esObjeto)) errores.push('dotacionEpp.cargos debe ser una lista de cargos.');
  if (!esObjeto(examenes) || !Array.isArray(examenes.cargos) || !examenes.cargos.every(esObjeto)) errores.push('examenes.cargos debe ser una lista de cargos.');
  if (errores.length > 0) return { ok: false, errores };

  const t = totales as Record<string, unknown>;
  for (const k of ['manoObra', 'otrosCostosEnManoObra', 'insumos', 'maquinaria', 'serviciosNoContinuos', 'valorAgregado', 'administrativos', 'total'] as const) {
    if (!esNumeroFinito(t[k])) errores.push(`totales.${k} debe ser un número finito.`);
  }
  const a = administrativos as Record<string, unknown>;
  for (const k of ['totalVariables', 'valorMensualPolizas', 'valorMensualImpuestos'] as const) {
    if (!esNumeroFinito(a[k])) errores.push(`administrativos.${k} debe ser un número finito.`);
  }
  if (!esNumeroFinito((dotacionEpp as Record<string, unknown>).total)) errores.push('dotacionEpp.total debe ser un número finito.');
  if (!esNumeroFinito((examenes as Record<string, unknown>).total)) errores.push('examenes.total debe ser un número finito.');
  if (!esNumeroFinito((insumos as Record<string, unknown>).total)) errores.push('insumos.total debe ser un número finito.');
  for (const k of ['subtotalAdquisicion', 'subtotalMantenimiento'] as const) {
    if (!esNumeroFinito((maquinaria as Record<string, unknown>)[k])) errores.push(`maquinaria.${k} debe ser un número finito.`);
  }
  revisarNumeros(dto, 'costosDto', errores);
  if (errores.length > 0) return { ok: false, errores };

  const tt = t as unknown as TotalesPantallaDto;
  const aa = a as unknown as AdministrativosPantallaDto;
  const sumaRubros = tt.manoObra + tt.insumos + tt.maquinaria + tt.serviciosNoContinuos + tt.valorAgregado + tt.administrativos;
  if (!cerca(sumaRubros, tt.total)) errores.push(`totales.total no reconcilia: la suma de los rubros es ${sumaRubros}, enviado=${tt.total}.`);
  const sumaAdmin = aa.totalVariables + aa.valorMensualPolizas + aa.valorMensualImpuestos;
  if (!cerca(sumaAdmin, tt.administrativos)) errores.push(`totales.administrativos no reconcilia: variables+pólizas+impuestos=${sumaAdmin}, enviado=${tt.administrativos}.`);
  const sumaFilasVariables = aa.variables.reduce((s, v) => s + v.valorMensual, 0);
  if (!cerca(sumaFilasVariables, aa.totalVariables)) errores.push(`administrativos.totalVariables no reconcilia con sus filas: ${sumaFilasVariables} vs ${aa.totalVariables}.`);

  // Insumos y Maquinaria: el total del panel es la suma de las filas que SÍ cuentan (las de Valor agregado se listan pero no suman).
  const ins = insumos as unknown as CostosPantallaDto['insumos'];
  const maq = maquinaria as unknown as CostosPantallaDto['maquinaria'];
  if (!cerca(ins.total, tt.insumos)) errores.push(`totales.insumos no reconcilia con insumos.total: ${tt.insumos} vs ${ins.total}.`);
  const sumaInsumos = ins.filas.filter((f) => !f.valorAgregado).reduce((s, f) => s + f.valorMensual, 0);
  if (!cerca(sumaInsumos, ins.total)) errores.push(`insumos.total no reconcilia con sus filas: ${sumaInsumos} vs ${ins.total}.`);
  if (!cerca(maq.subtotalAdquisicion + maq.subtotalMantenimiento, tt.maquinaria)) errores.push(`totales.maquinaria no reconcilia con sus subtotales: ${maq.subtotalAdquisicion + maq.subtotalMantenimiento} vs ${tt.maquinaria}.`);
  const sumaCompra = maq.filas.filter((f) => !f.valorAgregado).reduce((s, f) => s + f.valorMesComprar, 0);
  const sumaMtto = maq.filas.filter((f) => !f.valorAgregado).reduce((s, f) => s + f.valorMesMantenimiento, 0);
  if (!cerca(sumaCompra, maq.subtotalAdquisicion)) errores.push(`maquinaria.subtotalAdquisicion no reconcilia con sus filas: ${sumaCompra} vs ${maq.subtotalAdquisicion}.`);
  if (!cerca(sumaMtto, maq.subtotalMantenimiento)) errores.push(`maquinaria.subtotalMantenimiento no reconcilia con sus filas: ${sumaMtto} vs ${maq.subtotalMantenimiento}.`);

  return errores.length > 0 ? { ok: false, errores } : { ok: true };
}
