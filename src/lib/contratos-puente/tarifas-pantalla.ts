import type { CostosPantallaDto } from '@/lib/costos-estructura/exportacion/costos-pantalla';
import type { CargoPantallaDto } from './cargos';

/**
 * Lo que la pantalla «Enviar a Contratos» muestra para repartir el costeo en tarifas: una fila por cada línea que llega a
 * Contratos (cargos, insumos, equipos, costos administrativos, no continuos y valores agregados), con una clave estable para
 * recordar en qué tarifa va. Las líneas marcadas Valor Agregado dentro de insumos, equipos y no continuos no se listan: su
 * costo viaja en Valores Agregados.
 */
export interface LineaParaTarifa {
  clave: string;
  grupo: 'Mano de obra' | 'Insumos' | 'Equipos' | 'Costos admtivos' | 'No continuos' | 'Valores agregados';
  nombre: string;
  /** Costo mensual de la línea, sin A.I.U. */
  valor: number;
}

/** Clave por contenido; si dos líneas se llaman igual se numeran (#2, #3…) en el orden en que aparecen. */
function conClaves<T>(filas: readonly T[] | undefined, prefijo: string, texto: (f: T) => string) {
  const vistas = new Map<string, number>();
  return (filas ?? []).map((f) => {
    const base = `${prefijo}:${texto(f).trim().toUpperCase()}`;
    const n = (vistas.get(base) ?? 0) + 1;
    vistas.set(base, n);
    return { fila: f, clave: n === 1 ? base : `${base}#${n}` };
  });
}

const claveCargo = (c: CargoPantallaDto) => `${c.esTurnante ? 't' : 'c'}:${c.id}`;

function enlazar(dto: CostosPantallaDto) {
  return {
    insumos: conClaves(dto.insumos?.filas, 'i', (f) => `${f.codigo}|${f.nombre}`),
    equipos: conClaves(dto.maquinaria?.filas, 'e', (f) => `${f.codigo}|${f.descripcion}`),
    administrativos: conClaves(dto.administrativos?.variables, 'a', (f) => String(f.concepto ?? '')),
    noContinuos: conClaves(dto.serviciosNoContinuos, 's', (f) => `${f.codigo}|${f.descripcion}`),
    valoresAgregados: conClaves(dto.valoresAgregados, 'v', (f) => `${f.tipo}|${f.descripcion}`),
  };
}

export function lineasParaTarifas(dto: CostosPantallaDto, cargos: CargoPantallaDto[]): LineaParaTarifa[] {
  const e = enlazar(dto);
  const pos = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);
  return [
    ...cargos.filter((c) => c.cantidad > 0).map((c) => ({ clave: claveCargo(c), grupo: 'Mano de obra' as const, nombre: c.nombre, valor: pos(c.valorTotal) })),
    ...e.insumos.filter(({ fila }) => !fila.valorAgregado).map(({ fila, clave }) => ({ clave, grupo: 'Insumos' as const, nombre: fila.nombre, valor: pos(fila.valorMensual) })),
    ...e.equipos.filter(({ fila }) => !fila.valorAgregado).map(({ fila, clave }) => ({ clave, grupo: 'Equipos' as const, nombre: fila.descripcion, valor: pos(fila.valorMesComprar + fila.valorMesMantenimiento) })),
    ...e.administrativos.map(({ fila, clave }) => ({ clave, grupo: 'Costos admtivos' as const, nombre: String(fila.concepto ?? ''), valor: pos(fila.valorMensual) })),
    ...e.noContinuos.filter(({ fila }) => !fila.valorAgregado).map(({ fila, clave }) => ({ clave, grupo: 'No continuos' as const, nombre: fila.descripcion, valor: pos(fila.valorMensual) })),
    ...e.valoresAgregados.map(({ fila, clave }) => ({ clave, grupo: 'Valores agregados' as const, nombre: fila.descripcion, valor: pos(fila.valorMensual) })),
  ];
}

/** La tarifa elegida para una línea; sin elegir, o si ya no existe (se quitó una tarifa), va a la 1. */
export const tarifaElegida = (asignacion: Record<string, number>, clave: string, cuantas: number) => {
  const t = asignacion[clave];
  return Number.isInteger(t) && t >= 1 && t <= cuantas ? t : 1;
};

/** Costo de las líneas de cada tarifa (sin A.I.U., sin pólizas ni impuestos): solo para mostrar. */
export function costoPorTarifa(lineas: LineaParaTarifa[], asignacion: Record<string, number>, cuantas: number) {
  const totales = Array.from({ length: cuantas }, () => 0);
  for (const l of lineas) totales[tarifaElegida(asignacion, l.clave, cuantas) - 1] += l.valor;
  return totales;
}

/** El costeo y los cargos con la tarifa de cada línea puesta; con una sola tarifa no se toca nada. */
export function ponerTarifas(dto: CostosPantallaDto, cargos: CargoPantallaDto[], asignacion: Record<string, number>, cuantas: number) {
  if (cuantas <= 1) return { dto, cargos };
  const t = (clave: string) => tarifaElegida(asignacion, clave, cuantas);
  const e = enlazar(dto);
  return {
    dto: {
      ...dto,
      ...(dto.insumos ? { insumos: { ...dto.insumos, filas: e.insumos.map(({ fila, clave }) => ({ ...fila, tarifa: t(clave) })) } } : {}),
      ...(dto.maquinaria ? { maquinaria: { ...dto.maquinaria, filas: e.equipos.map(({ fila, clave }) => ({ ...fila, tarifa: t(clave) })) } } : {}),
      ...(dto.administrativos ? { administrativos: { ...dto.administrativos, variables: e.administrativos.map(({ fila, clave }) => ({ ...fila, tarifa: t(clave) })) } } : {}),
      ...(dto.serviciosNoContinuos ? { serviciosNoContinuos: e.noContinuos.map(({ fila, clave }) => ({ ...fila, tarifa: t(clave) })) } : {}),
      ...(dto.valoresAgregados ? { valoresAgregados: e.valoresAgregados.map(({ fila, clave }) => ({ ...fila, tarifa: t(clave) })) } : {}),
    },
    cargos: cargos.map((c) => ({ ...c, tarifa: t(claveCargo(c)) })),
  };
}

/** Lo que el navegador recuerda por costeo y UEN: el concepto de las tarifas 2, 3… y la tarifa de cada línea. */
export interface TarifasGuardadas {
  conceptos: string[];
  lineas: Record<string, number>;
}
export const TARIFAS_VACIAS: TarifasGuardadas = { conceptos: [], lineas: {} };

export function leerTarifasGuardadas(valor: unknown): TarifasGuardadas {
  if (typeof valor !== 'object' || valor === null) return TARIFAS_VACIAS;
  const o = valor as Record<string, unknown>;
  const conceptos = Array.isArray(o.conceptos) ? o.conceptos.filter((c): c is string => typeof c === 'string').slice(0, 8) : [];
  const lineas: Record<string, number> = {};
  if (typeof o.lineas === 'object' && o.lineas !== null) {
    for (const [k, v] of Object.entries(o.lineas as Record<string, unknown>)) if (Number.isInteger(v) && (v as number) >= 2) lineas[k] = v as number;
  }
  return { conceptos, lineas };
}

/** Quitar la tarifa N: sus líneas vuelven a la 1 y las de las tarifas siguientes bajan un número. */
export function quitarTarifa(g: TarifasGuardadas, n: number): TarifasGuardadas {
  const lineas: Record<string, number> = {};
  for (const [k, t] of Object.entries(g.lineas)) {
    if (t === n) continue;
    const nueva = t > n ? t - 1 : t;
    if (nueva >= 2) lineas[k] = nueva;
  }
  return { conceptos: g.conceptos.filter((_, i) => i !== n - 2), lineas };
}
