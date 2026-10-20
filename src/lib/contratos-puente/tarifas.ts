import { valorConAIU } from '@/lib/costos-estructura/exportacion/contratos';
import type { CostosPantallaDto } from '@/lib/costos-estructura/exportacion/costos-pantalla';
import type { CargoPantallaDto } from './cargos';
import type { CostoAdministrativoPayload } from './payload';

/**
 * Varias tarifas en una oferta de Contratos (reunión del 2026-10-15: «a cada ítem del resumen se le pide el consecutivo y el
 * concepto para facturar»). Quien envía crea las tarifas (consecutivo 1, 2, … con su concepto) y dice en cada línea del
 * costeo (cargo, insumo, equipo, costo administrativo, no continuo, valor agregado) a cuál va; sin decir, va a la 1.
 * Los seis valores de cada tarifa salen de sus líneas y se cuadran con el total del panel: así las tarifas siempre suman
 * exactamente lo que la oferta adjudicada lleva. Pólizas e impuestos (que se calculan sobre todo el costeo) se reparten
 * según lo que pesa cada tarifa.
 */

export const MAX_TARIFAS = 9;

export interface TarifaElegida {
  consec: number;
  codServicio: string;
}

/** Forma que recibe el puente (`tarifas[]` del contrato v1): valores con A.I.U., antes de IVA, en pesos enteros. */
export interface TarifaPayload {
  consec: number;
  codServicio: string;
  descripcion: string | null;
  manoObra: number;
  insumos: number;
  maquinaria: number;
  administrativos: number;
  valorAgregado: number;
  serviciosNoContinuos: number;
}

/**
 * Las tarifas que eligió quien envía: consecutivos 1, 2, … sin huecos, cada una con un concepto. Una lista vacía o ausente
 * es una sola tarifa (la de siempre).
 */
export function leerTarifasElegidas(valor: unknown): { ok: true; tarifas: TarifaElegida[] } | { ok: false; mensaje: string } {
  if (valor === undefined || valor === null) return { ok: true, tarifas: [] };
  if (!Array.isArray(valor)) return { ok: false, mensaje: 'Las tarifas deben ser una lista.' };
  if (valor.length > MAX_TARIFAS) return { ok: false, mensaje: `Máximo ${MAX_TARIFAS} tarifas por oferta.` };
  const tarifas: TarifaElegida[] = [];
  for (const [i, t] of valor.entries()) {
    const o = typeof t === 'object' && t !== null ? (t as Record<string, unknown>) : {};
    const codigo = typeof o.codServicio === 'string' ? o.codServicio.trim().toUpperCase() : '';
    if (o.consec !== i + 1) return { ok: false, mensaje: 'Las tarifas deben ir numeradas 1, 2, 3… sin saltos.' };
    if (!/^[A-Z0-9]{1,3}$/.test(codigo)) return { ok: false, mensaje: `Elija el concepto de facturación de la tarifa ${i + 1}.` };
    tarifas.push({ consec: i + 1, codServicio: codigo });
  }
  return { ok: true, tarifas };
}

/** La tarifa de una línea: la que dice si existe; si no, la 1. */
export const tarifaDeLinea = (valor: unknown, cuantas: number) =>
  typeof valor === 'number' && Number.isInteger(valor) && valor >= 1 && valor <= cuantas ? valor : 1;

/**
 * Reparte `total` (pesos enteros) en proporción a `partes`, sin perder ni sobrar un peso (mayor residuo). Si todas las
 * partes son 0, todo va a la primera.
 */
export function repartir(total: number, partes: number[]): number[] {
  const suma = partes.reduce((s, p) => s + Math.max(0, p), 0);
  if (partes.length === 0) return [];
  if (suma <= 0) return partes.map((_, i) => (i === 0 ? total : 0));
  const exactos = partes.map((p) => (total * Math.max(0, p)) / suma);
  const enteros = exactos.map(Math.floor);
  let resto = total - enteros.reduce((s, v) => s + v, 0);
  const orden = exactos.map((v, i) => ({ i, r: v - Math.floor(v) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of orden) {
    if (resto <= 0) break;
    enteros[i] += 1;
    resto -= 1;
  }
  return enteros;
}

const porTarifa = <T>(filas: readonly T[] | undefined, cuantas: number, valor: (f: T) => number, tarifa: (f: T) => unknown) => {
  const partes = Array.from({ length: cuantas }, () => 0);
  for (const f of filas ?? []) {
    const v = valor(f);
    if (Number.isFinite(v) && v > 0) partes[tarifaDeLinea(tarifa(f), cuantas) - 1] += v;
  }
  return partes;
};

type ConTarifa = { tarifa?: number | null };

/** Lo que cada tarifa suma, sin A.I.U., rubro por rubro (solo las líneas; sin cuadrar todavía con el panel). */
export function partesPorTarifa(cuantas: number, dto: CostosPantallaDto, cargos: (CargoPantallaDto & ConTarifa)[]) {
  const tarifa = (f: ConTarifa) => f.tarifa;
  const manoObra = porTarifa(cargos, cuantas, (c) => c.valorTotal, tarifa);
  const insumos = porTarifa(dto.insumos?.filas?.filter((f) => !f.valorAgregado), cuantas, (f) => f.valorMensual, tarifa);
  const maquinaria = porTarifa(dto.maquinaria?.filas?.filter((f) => !f.valorAgregado), cuantas, (f) => f.valorMesComprar + f.valorMesMantenimiento, tarifa);
  const serviciosNoContinuos = porTarifa(dto.serviciosNoContinuos?.filter((s) => !s.valorAgregado), cuantas, (s) => s.valorMensual, tarifa);
  const valorAgregado = porTarifa(dto.valoresAgregados, cuantas, (v) => v.valorMensual, tarifa);
  const variables = porTarifa(dto.administrativos?.variables, cuantas, (v) => v.valorMensual, tarifa);
  // Pólizas e impuestos se calculan sobre todo el costeo: van según lo que pesa cada tarifa.
  const peso = manoObra.map((_, i) => manoObra[i] + insumos[i] + maquinaria[i] + serviciosNoContinuos[i] + valorAgregado[i]);
  return { manoObra, insumos, maquinaria, serviciosNoContinuos, valorAgregado, variables, peso };
}

/**
 * Los seis valores de cada tarifa, con A.I.U., cuadrados al peso con los del panel: cada rubro se reparte según lo que
 * suman sus líneas en cada tarifa, así la suma de las tarifas es exactamente la tarifa de la oferta.
 */
export function tarifasDelCosteo(d: {
  tarifas: (TarifaElegida & { descripcion?: string | null })[];
  dto: CostosPantallaDto;
  cargos: (CargoPantallaDto & ConTarifa)[];
  aiu: number | null;
}): TarifaPayload[] {
  const n = d.tarifas.length;
  const p = partesPorTarifa(n, d.dto, d.cargos);
  const t = d.dto.totales;
  const adm = d.dto.administrativos;
  const fijos = (adm?.valorMensualPolizas ?? 0) + (adm?.valorMensualImpuestos ?? 0);
  const fijosPorTarifa = p.peso.every((v) => v <= 0) ? p.peso.map((_, i) => (i === 0 ? fijos : 0)) : p.peso.map((v) => (fijos * v) / p.peso.reduce((s, x) => s + x, 0));
  const administrativos = p.variables.map((v, i) => v + fijosPorTarifa[i]);
  const conAIU = (costo: number) => valorConAIU(costo, d.aiu) ?? 0;
  const rubro = (total: number, partes: number[]) => repartir(conAIU(total), partes);
  const mo = rubro(t.manoObra, p.manoObra);
  const ins = rubro(t.insumos, p.insumos);
  const maq = rubro(t.maquinaria, p.maquinaria);
  const admin = rubro(t.administrativos, administrativos);
  const va = rubro(t.valorAgregado, p.valorAgregado);
  const snc = rubro(t.serviciosNoContinuos, p.serviciosNoContinuos);
  return d.tarifas.map((tf, i) => ({
    consec: tf.consec,
    codServicio: tf.codServicio,
    descripcion: tf.descripcion ?? null,
    manoObra: mo[i],
    insumos: ins[i],
    maquinaria: maq[i],
    administrativos: admin[i],
    valorAgregado: va[i],
    serviciosNoContinuos: snc[i],
  }));
}

/**
 * Pólizas e impuestos repartidos en las tarifas (una fila por tarifa que lleve algo) más cada variable administrativa en su
 * tarifa: la pestaña Costos Admtivos de cada tarifa suma lo mismo que su valor (sin A.I.U.).
 */
export function costosAdministrativosEnTarifas(cuantas: number, dto: CostosPantallaDto, cargos: (CargoPantallaDto & ConTarifa)[]): CostoAdministrativoPayload[] {
  const adm = dto.administrativos;
  if (!adm) return [];
  const { peso } = partesPorTarifa(cuantas, dto, cargos);
  const total = peso.reduce((s, v) => s + v, 0);
  const proporcion = peso.map((v, i) => (total > 0 ? v / total : i === 0 ? 1 : 0));
  const repartido = (concepto: string, valor: number) =>
    proporcion.map((pr, i) => ({ concepto, valorMensual: Math.round(valor * pr * 100) / 100, tarifa: i + 1 })).filter((c) => c.valorMensual > 0);
  const lista: (CostoAdministrativoPayload & { tarifa: number })[] = [
    ...repartido('Pólizas', adm.valorMensualPolizas),
    ...repartido('Impuestos', adm.valorMensualImpuestos),
    ...(adm.variables ?? []).map((v) => ({ concepto: String(v.concepto ?? '').trim(), valorMensual: v.valorMensual, tarifa: tarifaDeLinea((v as ConTarifa).tarifa, cuantas) })),
  ];
  return lista
    .filter((c) => c.concepto !== '' && Number.isFinite(c.valorMensual) && c.valorMensual > 0)
    .map(({ tarifa, ...c }) => (tarifa > 1 ? { ...c, tarifa } : c));
}

/**
 * Deja la tarifa de cada línea lista para enviar. Con una sola tarifa se quita de todas (lo enviado queda igual que
 * siempre). Con varias, una línea sin tarifa va a la 1 y una que pide una tarifa que no existe es un error.
 */
export function normalizarTarifasDeLineas<C extends ConTarifa>(
  cuantas: number,
  dto: CostosPantallaDto,
  cargos: C[],
): { ok: true; dto: CostosPantallaDto; cargos: C[] } | { ok: false; mensaje: string } {
  const malas: string[] = [];
  const fijar = <T extends ConTarifa>(filas: T[] | undefined, nombre: (f: T, i: number) => string): T[] | undefined =>
    filas?.map((f, i) => {
      const { tarifa, ...resto } = f;
      if (cuantas <= 1 || tarifa === undefined || tarifa === null) return resto as T;
      if (!(Number.isInteger(tarifa) && tarifa >= 1 && tarifa <= cuantas)) malas.push(nombre(f, i));
      return { ...resto, tarifa } as T;
    });
  const nuevo: CostosPantallaDto = {
    ...dto,
    ...(dto.insumos ? { insumos: { ...dto.insumos, filas: fijar(dto.insumos.filas, (f) => `insumo «${f.nombre}»`) ?? [] } } : {}),
    ...(dto.maquinaria ? { maquinaria: { ...dto.maquinaria, filas: fijar(dto.maquinaria.filas, (f) => `equipo «${f.descripcion}»`) ?? [] } } : {}),
    ...(dto.administrativos ? { administrativos: { ...dto.administrativos, variables: fijar(dto.administrativos.variables, (f) => `costo «${f.concepto}»`) ?? [] } } : {}),
    ...(dto.serviciosNoContinuos ? { serviciosNoContinuos: fijar(dto.serviciosNoContinuos, (f) => `no continuo «${f.descripcion}»`) } : {}),
    ...(dto.valoresAgregados ? { valoresAgregados: fijar(dto.valoresAgregados, (f) => `valor agregado «${f.descripcion}»`) } : {}),
  };
  const nuevosCargos = fijar(cargos, (_, i) => `cargo ${i + 1}`) ?? [];
  if (malas.length > 0) return { ok: false, mensaje: `Estas líneas piden una tarifa que no está en la oferta: ${malas.join(', ')}.` };
  return { ok: true, dto: nuevo, cargos: nuevosCargos };
}
