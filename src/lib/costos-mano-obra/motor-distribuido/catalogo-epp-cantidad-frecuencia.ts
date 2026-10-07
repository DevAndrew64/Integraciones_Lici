/**
 * Ajuste "CANTIDAD Y FRECUENCIA DE EPP DESDE LA API" — la API externa de EPP
 * (`/service/public/api/epp`) devuelve `cantidad` y `frecuencia` por fila.
 * Reglas de negocio pedidas:
 *  - valor 0 (o ausente) = dato NO DEFINIDO → se informa y el usuario lo
 *    ingresa a mano (como antes).
 *  - valor > 0 → se toma el de la API y el campo queda bloqueado.
 *
 * Cada fila del catálogo es de UN grupo de EPP (`codgrp`, EP001…EP450): el
 * mismo `codigo` viene repetido una vez por grupo y `cantidad`/`frecuencia`
 * dependen de ese grupo (medido 2026-09-30: 18111 trae 1/3 en EP001, 1/6 en
 * EP021, 0/0 en EP020). El selector muestra el grupo de la fila y el valor que
 * se toma es el de ESA fila — el usuario elige el grupo buscándolo por su
 * código; sin búsqueda el catálogo muestra el primer grupo que encuentra por
 * producto (una fila por producto, ver `seleccionarUltimaCompraPorProducto`).
 *
 * Pura, sin React ni fetch — la usan la ruta `/api/epp-ext` y `page.tsx`.
 */
import { buscarCampo } from './catalogo-dotacion-filtro';

/**
 * - `'api'`: la fila trae un valor > 0 → se usa y el campo se bloquea.
 * - `'no_definido'`: la fila trae 0 o nada → el usuario lo ingresa a mano.
 */
export type EstadoCampoApi = 'api' | 'no_definido';

export interface ResolucionCampoApi {
  estado: EstadoCampoApi;
  /** Valor de la API cuando `estado === 'api'`; 0 en el otro caso. */
  valor: number;
}

/** Número positivo de un campo de la API (acepta número o texto numérico). 0 si no aplica. */
export function numeroPositivoApi(v: unknown): number {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return 0;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function resolverCampoApi(valor: unknown): ResolucionCampoApi {
  const n = numeroPositivoApi(valor);
  return n > 0 ? { estado: 'api', valor: n } : { estado: 'no_definido', valor: 0 };
}

/** Campos que la ruta agrega a cada item cuando el cliente pide la resolución. */
export interface CamposResolucionApi {
  cantidadEstadoApi: EstadoCampoApi;
  cantidadApi: number;
  frecuenciaEstadoApi: EstadoCampoApi;
  frecuenciaApi: number;
}

export function anotarConResolucion<T extends Record<string, unknown>>(registro: T): T & CamposResolucionApi {
  const cantidad = resolverCampoApi(buscarCampo(registro, 'cantidad'));
  const frecuencia = resolverCampoApi(buscarCampo(registro, 'frecuencia'));
  return {
    ...registro,
    cantidadEstadoApi: cantidad.estado,
    cantidadApi: cantidad.valor,
    frecuenciaEstadoApi: frecuencia.estado,
    frecuenciaApi: frecuencia.valor,
  };
}

/** Lo que `page.tsx` guarda en la fila (`DotItemRow`) al agregar el producto. */
export interface CantidadFrecuenciaFila {
  cant: number;
  frec: number;
  cantEstadoApi: EstadoCampoApi;
  frecEstadoApi: EstadoCampoApi;
}

const VALOR_INICIAL_MANUAL = 1;

/**
 * Valores iniciales de una fila EPP a partir del item del catálogo. Sin
 * resolución del servidor (respuesta antigua, o campo no reconocido) se cae al
 * comportamiento de siempre: 1/1 editables, sin aviso.
 */
export function cantidadFrecuenciaInicialEpp(item: Record<string, unknown>): CantidadFrecuenciaFila | { cant: number; frec: number } {
  const cEstado = item.cantidadEstadoApi;
  const fEstado = item.frecuenciaEstadoApi;
  const esEstado = (e: unknown): e is EstadoCampoApi => e === 'api' || e === 'no_definido';
  if (!esEstado(cEstado) || !esEstado(fEstado)) return { cant: VALOR_INICIAL_MANUAL, frec: VALOR_INICIAL_MANUAL };
  const cantApi = numeroPositivoApi(item.cantidadApi);
  const frecApi = numeroPositivoApi(item.frecuenciaApi);
  // Defensa: un estado 'api' sin valor positivo no puede bloquear el campo.
  const cantBloquea = cEstado === 'api' && cantApi > 0;
  const frecBloquea = fEstado === 'api' && frecApi > 0;
  return {
    cant: cantBloquea ? cantApi : VALOR_INICIAL_MANUAL,
    frec: frecBloquea ? frecApi : VALOR_INICIAL_MANUAL,
    cantEstadoApi: cantBloquea ? 'api' : 'no_definido',
    frecEstadoApi: frecBloquea ? 'api' : 'no_definido',
  };
}

/** true si el campo de la fila vino de la API y no debe editarse a mano. */
export function campoBloqueadoPorApi(
  fila: { cantEstadoApi?: EstadoCampoApi; frecEstadoApi?: EstadoCampoApi },
  campo: string,
): boolean {
  return (campo === 'cant' && fila.cantEstadoApi === 'api') || (campo === 'frec' && fila.frecEstadoApi === 'api');
}

/**
 * Aviso para el usuario cuando alguno de los dos campos hay que ingresarlo a
 * mano. `null` si ninguno lo requiere (ambos del catálogo, o fila sin estado:
 * manual o histórica). Texto para el usuario final: nunca menciona "API", habla
 * del "catálogo", que es lo que ve al seleccionar el EPP.
 */
export function mensajeCantidadFrecuenciaManual(
  fila: { cantEstadoApi?: EstadoCampoApi; frecEstadoApi?: EstadoCampoApi },
): string | null {
  const noDefinidos: string[] = [];
  if (fila.cantEstadoApi === 'no_definido') noDefinidos.push('cantidad');
  if (fila.frecEstadoApi === 'no_definido') noDefinidos.push('frecuencia');
  if (noDefinidos.length === 0) return null;
  if (noDefinidos.length === 2) return 'Este EPP no tiene cantidad ni frecuencia definidas en el catálogo. Ingrésalas manualmente.';
  return `Este EPP no tiene ${noDefinidos[0]} definida en el catálogo. Ingrésala manualmente.`;
}
