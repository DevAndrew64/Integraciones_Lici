/**
 * Ajuste "DIAGNOSTICAR E IMPORTAR LA BASE DE TARIFAS DE MANTENIMIENTO DE
 * EQUIPOS" — funciones puras de agrupación/validación del importador. Sin
 * ExcelJS, sin Prisma, sin `fetch` — reutilizables por el script y por
 * pruebas.
 */

export interface FilaTarifaNormalizada {
  empresaPrestadora: string;
  uen: string;
  clienteRazonSocial: string;
  contrato: string;
  consecutivoTarifa: number;
  puntoEntrega: string;
  grupoActivo: string;
  tipoActivo: string;
  subtipoActivo: string;
  descripcionEquipo: string;
  valorMesMantenimiento: number;
  fuenteHoja: string;
  fuenteFila: number;
  llaveNegocio: string;
}

export interface FilaRechazada {
  hoja: string;
  fila: number;
  motivo: string;
}

/**
 * Llave de negocio DEFINITIVA (confirmada con el usuario): empresaPrestadora
 * +uen+contrato+puntoEntrega+consecutivoTarifa+subtipoActivo — "Cons.
 * Tarifa" es fijo por contrato/sitio (NUNCA un consecutivo por línea de
 * equipo), así que subtipoActivo es indispensable para diferenciar las
 * líneas de un mismo sitio.
 */
export function construirLlaveNegocio(f: {
  empresaPrestadora: string; uen: string; contrato: string; puntoEntrega: string;
  consecutivoTarifa: number; subtipoActivo: string;
}): string {
  return [f.empresaPrestadora, f.uen, f.contrato, f.puntoEntrega, f.consecutivoTarifa, f.subtipoActivo].join('|');
}

/**
 * Regla de conflicto de llave (nunca elige arbitrariamente): si dos o más
 * filas comparten la llave de negocio completa, es una ANOMALÍA REAL del
 * Excel origen (confirmado: el mismo código de subtipo identificando dos
 * equipos distintos en el mismo contrato+sitio+consecutivo) — se rechaza
 * TODO el grupo, nunca se elige una fila ni se combinan.
 */
export function resolverConflictosLlave<T extends FilaTarifaNormalizada>(
  filas: readonly T[],
): { aceptadas: T[]; rechazadas: FilaRechazada[] } {
  const porLlave = new Map<string, T[]>();
  for (const f of filas) {
    const arr = porLlave.get(f.llaveNegocio) ?? [];
    arr.push(f);
    porLlave.set(f.llaveNegocio, arr);
  }
  const aceptadas: T[] = [];
  const rechazadas: FilaRechazada[] = [];
  for (const grupo of porLlave.values()) {
    if (grupo.length === 1) { aceptadas.push(grupo[0]); continue; }
    for (const f of grupo) {
      rechazadas.push({
        hoja: f.fuenteHoja, fila: f.fuenteFila,
        motivo: `Conflicto de llave: el mismo código de subtipo (${f.subtipoActivo}) identifica equipos diferentes dentro del mismo contrato (${f.contrato}) y punto de entrega (${f.puntoEntrega}), consecutivo ${f.consecutivoTarifa}. Descripción: "${f.descripcionEquipo}". Se rechaza TODO el grupo (${grupo.length} filas) — no se elige ninguna arbitrariamente.`,
      });
    }
  }
  return { aceptadas, rechazadas };
}

export interface GrupoVariacionContrato<T> {
  clave: string;
  filas: T[];
  valoresDistintos: Set<number>;
}

/**
 * Ajuste "CORREGIR REPORTE DE VARIACIONES ENTRE CONTRATOS" — agrupa SOLO
 * por empresaPrestadora+uen+grupoActivo+tipoActivo+subtipoActivo (NUNCA
 * por contrato/puntoEntrega, que separarían cada fila por definición, ni
 * por descripción libre, que varía de redacción entre contratos aunque
 * sea el mismo tipo de equipo). Puramente informativo: nunca fusiona,
 * nunca elige máximo/mínimo/promedio, nunca rechaza — tarifas distintas
 * de contratos distintos son válidas y se conservan todas.
 */
export function agruparVariacionesEntreContratos<T extends FilaTarifaNormalizada>(
  filas: readonly T[],
): GrupoVariacionContrato<T>[] {
  const porTipoEquipo = new Map<string, T[]>();
  for (const f of filas) {
    const clave = [f.empresaPrestadora, f.uen, f.grupoActivo, f.tipoActivo, f.subtipoActivo].join('|');
    const arr = porTipoEquipo.get(clave) ?? [];
    arr.push(f);
    porTipoEquipo.set(clave, arr);
  }
  return [...porTipoEquipo.entries()]
    .map(([clave, filasGrupo]) => ({ clave, filas: filasGrupo, valoresDistintos: new Set(filasGrupo.map(f => f.valorMesMantenimiento)) }))
    .filter(g => g.valoresDistintos.size > 1);
}
