/**
 * Ajuste "CATÁLOGO — PRODUCTOS ÚNICOS CON ÚLTIMO VALOR DE COMPRA" —
 * deduplicación y paginación del catálogo externo de Dotación/EPP. Pura,
 * sin React ni fetch — se usa tanto en el servidor (route.ts, antes de
 * paginar) como en pruebas.
 *
 * Diagnóstico real (medido contra la API externa, empresa=aseo/uen=BAQ):
 * la respuesta NO trae `id` ni `updatedAt`/`fechaSincronizacion` — solo
 * `codigo, codgrp, undnegocio, descripcion, undmed, valor, frecuencia,
 * cantidad, fecha_ultima_compra`. El mismo `codigo` aparece repetido con
 * distinto `codgrp` pero MISMO valor/fecha/descripción — `codgrp` no es
 * parte de la identidad comercial real, solo genera filas redundantes.
 * Por eso la identidad de producto es `codigo` (o el nombre normalizado
 * como respaldo, cuando no hay código) — nunca `codigo+codgrp`.
 */
import { buscarCampo } from './catalogo-dotacion-filtro';

function resolverClaveProducto(registro: Record<string, unknown>): string {
  const codigo = buscarCampo(registro, 'codigo', 'code', 'ref');
  if (codigo !== undefined && String(codigo).trim() !== '') return `cod:${String(codigo).trim().toLowerCase()}`;
  // Respaldo controlado (§1) — sin código confiable, se agrupa por nombre
  // normalizado; se reporta aparte (`sinCodigoConfiable`) para diagnóstico,
  // nunca se mezcla silenciosamente con productos que sí tienen código.
  const nombre = String(buscarCampo(registro, 'nombre', 'descripcion', 'description', 'name') ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return `nombre:${nombre}`;
}

function fechaValidaDe(registro: Record<string, unknown>): Date | null {
  const f = buscarCampo(registro, 'fecha_ultima_compra', 'fechaultimacompra', 'ultima_compra', 'fecha_compra');
  if (f === undefined) return null;
  const d = new Date(String(f));
  return isNaN(d.getTime()) ? null : d;
}

function tieneValorValido(registro: Record<string, unknown>): boolean {
  const v = Number(buscarCampo(registro, 'valor', 'precio', 'price', 'vlr', 'value'));
  return !!v && !isNaN(v) && v > 0;
}

interface Candidato<T> { registro: T; fecha: Date | null }

/** true si `candidato` debe reemplazar a `actual` como ganador — nunca
 * combina MAX(fecha) con MAX(valor) de filas distintas: siempre compara
 * la fila COMPLETA candidata contra la fila COMPLETA actual (§2). */
function candidatoGana<T extends Record<string, unknown>>(candidato: Candidato<T>, actual: Candidato<T>): boolean {
  // 1/2) fecha válida > fecha nula; entre dos fechas válidas, la más reciente.
  if (candidato.fecha && !actual.fecha) return true;
  if (!candidato.fecha && actual.fecha) return false;
  if (candidato.fecha && actual.fecha && candidato.fecha.getTime() !== actual.fecha.getTime()) {
    return candidato.fecha.getTime() > actual.fecha.getTime();
  }
  // 3/4) desempate (misma fecha, o ambas sin fecha): valor válido gana;
  // si sigue empatado, se conserva el primero visto — nunca se deja al
  // orden accidental de una comparación adicional.
  const candidatoValido = tieneValorValido(candidato.registro);
  const actualValido = tieneValorValido(actual.registro);
  if (candidatoValido && !actualValido) return true;
  return false;
}

export interface ResultadoDeduplicacion<T> {
  productos: T[];
  totalProductosUnicos: number;
  productosConCodigoConfiable: number;
  productosSinCodigoConfiable: number;
}

/**
 * Selecciona, por cada producto (identidad = código, o nombre normalizado
 * como respaldo), la FILA COMPLETA que representa la compra vigente —
 * nunca todas las versiones históricas. Determinístico: el mismo arreglo
 * de entrada siempre produce el mismo resultado, sin depender del orden
 * accidental de la base/API de origen.
 */
export function seleccionarUltimaCompraPorProducto<T extends Record<string, unknown>>(
  registros: readonly T[],
): ResultadoDeduplicacion<T> {
  const ganadores = new Map<string, Candidato<T>>();
  for (const registro of registros) {
    const clave = resolverClaveProducto(registro);
    const fecha = fechaValidaDe(registro);
    const actual = ganadores.get(clave);
    if (!actual) { ganadores.set(clave, { registro, fecha }); continue; }
    if (candidatoGana({ registro, fecha }, actual)) ganadores.set(clave, { registro, fecha });
  }
  // sinCodigo se cuenta por PRODUCTO único (clave ganadora), no por fila de
  // entrada — varias filas históricas del mismo producto sin código no
  // deben inflar este contador.
  const sinCodigo = Array.from(ganadores.keys()).filter(k => k.startsWith('nombre:')).length;
  const productos = Array.from(ganadores.values()).map(c => c.registro);
  return {
    productos,
    totalProductosUnicos: productos.length,
    productosConCodigoConfiable: productos.length - sinCodigo,
    productosSinCodigoConfiable: sinCodigo,
  };
}

export interface PaginaResultado<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Paginación pura sobre un arreglo YA filtrado/deduplicado — nunca al
 * revés (§5/§11 del ajuste: filtrar y deduplicar SIEMPRE antes de
 * paginar, o el mismo producto podría reaparecer en otra página). */
export function paginar<T>(items: readonly T[], page: number, limit: number): PaginaResultado<T> {
  const limiteSeguro = Math.max(1, limit);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / limiteSeguro));
  const paginaSegura = Math.min(Math.max(1, page), totalPages);
  const inicio = (paginaSegura - 1) * limiteSeguro;
  return { items: items.slice(inicio, inicio + limiteSeguro), total, page: paginaSegura, limit: limiteSeguro, totalPages };
}
