/**
 * Ajuste "MAQUINARIA Y EQUIPOS SNC — MODELO SERVICIOS ESPECIALIZADOS" —
 * catálogo y cálculo puros (sin React, sin `fetch`) para el bloque
 * "Maquinaria y Equipos" DENTRO de Servicios No Continuos (SNC), basado en
 * el catálogo REAL de Servicios Especializados
 * (`GET https://grupocolba.com/service/public/api/equipos/obtener_espec`,
 * proxy en `/api/equipos-especializados-ext`) — un modelo COMPLETAMENTE
 * DISTINTO del catálogo general de Maquinaria/Activos Fijos (Cant.
 * disponible/A comprar/Compra por mes/Mantenimiento/Valor con IVA, fuente
 * `POST equipos/obtener`, ver `calculo-maquinaria.ts` y
 * `MaquinariaServicioNoContinuo` en `servicios-no-continuos.ts`), que
 * permanece intacto y sin relación con este archivo — nunca se mezclan
 * ambas fuentes ni ambas lógicas, nunca hay fallback entre ellas.
 *
 * FUENTE — re-verificada en vivo (2026-08-21, tras un ajuste del backend
 * anunciado explícitamente por el usuario): la API AHORA sí trae un campo
 * `codigo` (number, ÚNICO en las 45 filas — confirmado sin colisiones) y
 * YA NO trae `marca` ni `referencia` (retirados de la fuente). Los 6
 * campos vigentes son `codigo, descripcion, vlr_dia, codtipo_c, codstipo_c,
 * sub_tipo`. Una ronda anterior de este archivo, ANTES de este ajuste del
 * backend, no tenía `codigo` en la fuente real (solo un mock lo inventaba,
 * ya eliminado) — este es el segundo cambio de contrato de la misma API en
 * la misma sesión; el adaptador (`/api/equipos-especializados-ext`) es el
 * ÚNICO lugar que debe volver a tocarse si la fuente cambia otra vez.
 *
 * CLAVE ESTABLE — con `codigo` único y confirmado, es la clave natural
 * (`claveEquipoEspecializado` usa `codigo` cuando está presente). Las
 * filas MANUALES (sin catálogo, ver `crearEquipoEspecializadoManual`)
 * nunca tienen `codigo` real — para esas se conserva el respaldo
 * `codigoTipo:codigoSubtipo:descripcion` (vacíos en una fila manual, pero
 * sigue sirviendo como clave de React por id real de todos modos).
 *
 * FÓRMULA — confirmada explícitamente por el usuario para esta
 * implementación: `total = cantidad × numeroDias × valorDia`, donde
 * `valorDia` es EXACTAMENTE `vlr_dia` de la fuente (la fuente define el
 * precio como valor POR DÍA, nunca mensual). Deliberadamente SIN
 * frecuencia mensual, SIN IVA adicional, SIN mantenimiento, SIN valor de
 * compra/cantidad a comprar/disponibilidad/depreciación — todos esos
 * conceptos son EXCLUSIVOS de Maquinaria y Equipos NORMAL (modelo de
 * activos fijos), nunca de este bloque.
 *
 * VALOR DÍA EN CERO — 3 de los 45 registros reales traen `vlr_dia:0`.
 * Ajuste (feedback en vivo) "si la API devuelve vlr_dia=0, el equipo sí
 * debe poder agregarse" — decisión explícita del usuario: NUNCA se
 * bloquea el selector por esto (se retiró el predicado que antes lo
 * hacía); el equipo se agrega con `valorDia:0` tal cual, editable después
 * (ver siguiente nota) — nunca se inventa, reemplaza ni convierte a
 * `null` el valor recibido.
 *
 * VALOR DÍA EDITABLE TRAS AGREGAR — Ajuste (feedback en vivo) "quiero que
 * ese valor funcione como valor inicial sugerido, pero que... el usuario
 * pueda editarlo manualmente" — `vlr_dia` de la API es solo el valor
 * INICIAL al agregar desde catálogo (`crearEquipoEspecializadoDesdeCatalogo`);
 * una vez en `ServicioNoContinuo.equiposEspecializados[]`, `valorDia` es
 * editable igual que `cantidad`/`numeroDias` para CUALQUIER origen
 * (`'CATALOGO'` o `'MANUAL'`) — el catálogo/caché en memoria (`fetch` a
 * `/api/equipos-especializados-ext`) NUNCA se muta; el override vive
 * ÚNICAMENTE en la copia ya agregada al borrador. Volver a agregar el
 * MISMO equipo desde el catálogo crea una fila NUEVA con el `vlr_dia`
 * ACTUAL de la API (nunca el override de una fila anterior, que son
 * copias independientes por `id`).
 */

/** Entrada normalizada del catálogo — el ÚNICO contrato que la UI/selector
 * deben consumir; el adaptador de `/api/equipos-especializados-ext` hace
 * la conversión `snake_case` (fuente) → este tipo, nunca al revés. */
export interface EquipoEspecializadoCatalogoSNC {
  codigo: number;
  descripcion: string;
  subTipo: string;
  valorDia: number;
  codigoTipo: string;
  codigoSubtipo: string;
}

/** Fila YA AGREGADA a `ServicioNoContinuo.equiposEspecializados[]` — copia
 * INMUTABLE del catálogo en el momento de agregar (nunca una referencia
 * viva a él, para que el equipo agregado no cambie si el catálogo externo
 * se actualiza después). `cantidad`/`numeroDias`/`valorDia` son editables
 * para CUALQUIER origen (`vlr_dia` de la API es solo el valor inicial
 * sugerido); una fila MANUAL (sin `codigo`) también permite editar
 * descripción/subtipo — ver `origen`. */
export interface EquipoEspecializadoServicioNoContinuo {
  id: number;
  /** Ausente = fila MANUAL (sin catálogo, nunca se inventa un código). */
  codigo?: number;
  descripcion: string;
  subTipo: string;
  valorDia: number;
  codigoTipo: string;
  codigoSubtipo: string;
  /** Editable. Default 1. */
  cantidad: number;
  /** Editable. Default 1. */
  numeroDias: number;
  /** Ajuste (feedback en vivo) "coloca un boton para crear manual con la
   * misma estructura" — `'CATALOGO'` (default, filas históricas sin este
   * campo se tratan como catálogo) viene de `obtener_espec` y es de solo
   * lectura salvo cantidad/numeroDias; `'MANUAL'` no tiene contraparte en
   * el catálogo — descripción/subtipo/valor día también son editables
   * (nunca se inventa un código/tipo/subtipo para una fila manual, quedan
   * vacíos/ausentes). */
  origen?: 'CATALOGO' | 'MANUAL';
}

/** Clave estable — `codigo` (único, confirmado en la fuente real) cuando
 * está presente; respaldo `codigoTipo:codigoSubtipo:descripcion` para
 * filas MANUALES (sin `codigo`, ver `crearEquipoEspecializadoManual`). */
export function claveEquipoEspecializado(item: { codigo?: number; codigoTipo: string; codigoSubtipo: string; descripcion: string }): string {
  if (item.codigo != null) return `cod:${item.codigo}`;
  return `${item.codigoTipo}:${item.codigoSubtipo}:${item.descripcion}`;
}

/** Copia el catálogo hacia una fila nueva del servicio — cantidad=1,
 * numeroDias=1 (defaults), `valorDia` inicia con el `vlr_dia` ACTUAL del
 * catálogo (incluido `0`, nunca bloqueado — ver nota de arquitectura del
 * encabezado) y queda editable de inmediato en el borrador. */
export function crearEquipoEspecializadoDesdeCatalogo(
  item: EquipoEspecializadoCatalogoSNC,
  id: number,
): EquipoEspecializadoServicioNoContinuo {
  return {
    id,
    codigo: item.codigo,
    descripcion: item.descripcion,
    subTipo: item.subTipo,
    valorDia: item.valorDia,
    codigoTipo: item.codigoTipo,
    codigoSubtipo: item.codigoSubtipo,
    cantidad: 1,
    numeroDias: 1,
    origen: 'CATALOGO',
  };
}

/** Fila en blanco SIN catálogo — descripción/subtipo/valor día quedan
 * vacíos/en 0 para que el usuario los diligencie; `codigo` queda AUSENTE
 * (nunca se inventa uno — ver clave estable). */
export function crearEquipoEspecializadoManual(id: number): EquipoEspecializadoServicioNoContinuo {
  return {
    id, descripcion: '', subTipo: '',
    valorDia: 0, codigoTipo: '', codigoSubtipo: '',
    cantidad: 1, numeroDias: 1, origen: 'MANUAL',
  };
}

/** total = cantidad × numeroDias × valorDia — ver nota de fórmula del
 * encabezado (confirmada explícitamente por el usuario para esta
 * implementación, exclusiva de este bloque). */
export function calcularValorTotalEquipoEspecializado(item: EquipoEspecializadoServicioNoContinuo): number {
  return item.cantidad * item.numeroDias * item.valorDia;
}

export function calcularTotalEquiposEspecializadosServicio(
  items: readonly EquipoEspecializadoServicioNoContinuo[],
): number {
  return items.reduce((s, i) => s + calcularValorTotalEquipoEspecializado(i), 0);
}

/** Búsqueda LOCAL sobre el catálogo ya cargado — por código (coincidencia
 * exacta o parcial del número, ahora que la fuente lo confirma único),
 * descripción o subtipo (ambos case insensitive, coincidencia parcial). */
export function buscarEquiposEspecializados(
  catalogo: readonly EquipoEspecializadoCatalogoSNC[],
  query: string,
): readonly EquipoEspecializadoCatalogoSNC[] {
  const q = query.trim().toLowerCase();
  if (!q) return catalogo;
  return catalogo.filter((e) => String(e.codigo).includes(q) || e.descripcion.toLowerCase().includes(q) || e.subTipo.toLowerCase().includes(q));
}
