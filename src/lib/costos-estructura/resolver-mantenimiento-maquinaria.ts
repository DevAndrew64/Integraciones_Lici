/**
 * Ajuste "MAQUINARIA Y EQUIPOS — RESOLVEDOR DETERMINÍSTICO DE
 * MANTENIMIENTO" — resuelve la tarifa mensual unitaria de mantenimiento
 * de un equipo (identificado por los códigos que SÍ entrega la nueva API
 * de Equipos: `tipo_c`/`sub_tipo_c`/`nombre_c`) contra el catálogo
 * normalizado generado por `scripts/generar-catalogo-mantenimiento-equipos.ts`
 * (`src/data/costos-estructura/mantenimiento-equipos.json`). Puro — sin
 * React, sin `fetch`, sin I/O — recibe el catálogo ya cargado.
 *
 * Arquitectura confirmada con datos reales (ver diagnóstico "MAQUINARIA Y
 * EQUIPOS — DIAGNÓSTICO DEFINITIVO"):
 *  - La API NO entrega "Tipo Activo" (el nivel intermedio del histórico,
 *    ej. "003 RADIOS") — por eso el matching NUNCA depende de ese campo,
 *    solo de Grupo Activo (`tipo_c`) + Sub-Tipo Activo (`sub_tipo_c`).
 *  - 0 conflictos maestro↔histórico donde son comparables por
 *    descripción (13/13 coinciden); 0 diferencias reales de tarifa entre
 *    UEN — por eso la UEN NUNCA participa en esta resolución (sí en
 *    disponibilidad, un cruce distinto y no implementado en esta ronda).
 *  - 7 de 49 códigos Grupo+SubTipo son ambiguos en el histórico (más de
 *    una tarifa) — quedan pre-calculados en `catalogo.codigosAmbiguos`;
 *    el Nivel 2 nunca elige arbitrariamente entre ellas.
 *
 * Niveles de coincidencia (nunca fuzzy, nunca "se parece"):
 *  NIVEL 1 — código (Grupo+SubTipo) + descripción EXACTA normalizada
 *            contra una fila del histórico → más confiable, ignora
 *            cualquier fila del mismo código con descripción distinta
 *            (así se auto-inmuniza contra errores de captura del código
 *            en filas de OTRO equipo, confirmado con los 7 casos reales).
 *  NIVEL 2 — código solo, SOLO SI todas las filas de ese código
 *            comparten la MISMA tarifa (`codigosAmbiguos` lo descarta).
 *  NIVEL 3 — descripción EXACTA normalizada contra el maestro
 *            (COSTOS MTTO 31/07/2025), sin pasar por el histórico.
 *  SIN MATCH / AMBIGUO — `mantenimientoEncontrado:false`,
 *            `valorMantenimientoUnitarioMensual:null` (NUNCA 0).
 */

export interface EntradaMaestroMantenimiento {
  descripcionOriginal: string;
  descripcionNormalizada: string;
  valorMensual: number;
  referenciaId: string;
}

export interface EntradaHistoricoMantenimiento {
  grupoActivo: string;
  subTipoActivo: string;
  descripcionOriginal: string;
  descripcionNormalizada: string;
  valorMensual: number;
  uen: string;
  hoja: string;
  fila: number;
}

export interface CodigoAmbiguoMantenimiento {
  grupoActivo: string;
  subTipoActivo: string;
  tarifasDistintas: number[];
  descripcionesInvolucradas: string[];
}

export interface CatalogoMantenimientoEquipos {
  version: number;
  maestro: EntradaMaestroMantenimiento[];
  historico: EntradaHistoricoMantenimiento[];
  codigosAmbiguos: CodigoAmbiguoMantenimiento[];
}

/** Misma normalización que `normalizarDescripcionEquipoMtto`
 * (`catalogo-mantenimiento-equipos.ts`) y que el generador del catálogo —
 * trim/mayúsculas/sin tildes/espacios colapsados, nunca quita números. */
export function normalizarDescripcionMantenimiento(s: string): string {
  const sinTildes = s
    .toUpperCase()
    .replace(/[ÁÀÂÄ]/g, 'A').replace(/[ÉÈÊË]/g, 'E').replace(/[ÍÌÎÏ]/g, 'I')
    .replace(/[ÓÒÔÖ]/g, 'O').replace(/[ÚÙÛÜ]/g, 'U');
  return sinTildes.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export interface EquipoApiParaMantenimiento {
  /** API `tipo_c` — homologa con Grupo Activo del histórico (NUNCA con
   * "Tipo Activo", que la API no entrega). Conserva ceros a la izquierda. */
  tipoCodigo: string;
  /** API `sub_tipo_c` — homologa con Sub-Tipo Activo. */
  subTipoCodigo: string;
  /** API `nombre_c`. */
  nombre: string;
  /** API `sub_tipo` (texto) — candidato adicional de descripción exacta
   * para el Nivel 1, además de `nombre`. */
  subTipoDescripcion?: string;
}

export type FuenteMantenimiento = 'PLANTILLA_COSTO_MES_MANTTO' | 'COSTOS_MTTO_MAESTRO' | 'SIN_COINCIDENCIA';
export type MotivoSinTarifa = 'MATCH_AMBIGUO' | 'SIN_COINCIDENCIA';

export interface ResultadoResolucionMantenimiento {
  mantenimientoEncontrado: boolean;
  requiereRevision: boolean;
  motivo?: MotivoSinTarifa;
  valorMantenimientoUnitarioMensual: number | null;
  fuenteMantenimiento: FuenteMantenimiento;
  /** 1/2 = resuelto vía histórico (crosswalk); 3 = resuelto directo
   * contra el maestro; `null` = sin coincidencia o ambiguo. */
  nivelMatch: 1 | 2 | 3 | null;
  /** Trazabilidad de la consulta — SIEMPRE presente, incluso sin match. */
  claveEquipoApi: string;
  /** Descripción/categoría real que produjo la tarifa (histórico o
   * maestro, según `fuenteMantenimiento`) — ausente si no hubo match. */
  categoriaMantenimiento?: string;
  /** `true` únicamente si, ADEMÁS, existe una entrada en el maestro con
   * la MISMA descripción normalizada y el MISMO valor — nunca se fuerza
   * una homologación textual que no coincide exactamente (ver
   * diagnóstico: la mayoría de descripciones del histórico NO tienen
   * equivalente literal en el maestro, y eso es SANO, no un error). */
  validadoContraMaestro?: boolean;
}

function construirClave(equipo: EquipoApiParaMantenimiento): string {
  return `${equipo.tipoCodigo}|${equipo.subTipoCodigo}|${equipo.nombre}`;
}

function esCodigoAmbiguo(catalogo: CatalogoMantenimientoEquipos, tipoCodigo: string, subTipoCodigo: string): boolean {
  return catalogo.codigosAmbiguos.some(c => c.grupoActivo === tipoCodigo && c.subTipoActivo === subTipoCodigo);
}

function buscarValidacionMaestro(catalogo: CatalogoMantenimientoEquipos, descripcionNormalizada: string, valor: number): boolean {
  const enMaestro = catalogo.maestro.find(m => m.descripcionNormalizada === descripcionNormalizada);
  return !!enMaestro && enMaestro.valorMensual === valor;
}

/** Único punto de resolución — nunca se duplica esta lógica en page.tsx
 * ni en el motor de Servicios no continuos (ambos deben llamar esta
 * misma función, solo cambia qué `EquipoCosteado`/fila recibe el
 * resultado). */
export function resolverMantenimientoMaquinaria(
  equipo: EquipoApiParaMantenimiento,
  catalogo: CatalogoMantenimientoEquipos,
): ResultadoResolucionMantenimiento {
  const claveEquipoApi = construirClave(equipo);
  const nombreNorm = normalizarDescripcionMantenimiento(equipo.nombre);
  const subTipoDescNorm = equipo.subTipoDescripcion ? normalizarDescripcionMantenimiento(equipo.subTipoDescripcion) : undefined;

  const candidatosCodigo = catalogo.historico.filter(
    h => h.grupoActivo === equipo.tipoCodigo && h.subTipoActivo === equipo.subTipoCodigo,
  );

  // NIVEL 1 — código + descripción exacta.
  const matchNivel1 = candidatosCodigo.find(
    h => h.descripcionNormalizada === nombreNorm || (subTipoDescNorm != null && h.descripcionNormalizada === subTipoDescNorm),
  );
  if (matchNivel1) {
    return {
      mantenimientoEncontrado: true, requiereRevision: false,
      valorMantenimientoUnitarioMensual: matchNivel1.valorMensual,
      fuenteMantenimiento: 'PLANTILLA_COSTO_MES_MANTTO',
      nivelMatch: 1, claveEquipoApi,
      categoriaMantenimiento: matchNivel1.descripcionOriginal,
      validadoContraMaestro: buscarValidacionMaestro(catalogo, matchNivel1.descripcionNormalizada, matchNivel1.valorMensual),
    };
  }

  // NIVEL 2 — código solo, únicamente si NUNCA es ambiguo para ese código.
  if (candidatosCodigo.length > 0) {
    if (esCodigoAmbiguo(catalogo, equipo.tipoCodigo, equipo.subTipoCodigo)) {
      return {
        mantenimientoEncontrado: false, requiereRevision: true, motivo: 'MATCH_AMBIGUO',
        valorMantenimientoUnitarioMensual: null, fuenteMantenimiento: 'SIN_COINCIDENCIA',
        nivelMatch: null, claveEquipoApi,
      };
    }
    const valor = candidatosCodigo[0].valorMensual;
    return {
      mantenimientoEncontrado: true, requiereRevision: false,
      valorMantenimientoUnitarioMensual: valor,
      fuenteMantenimiento: 'PLANTILLA_COSTO_MES_MANTTO',
      nivelMatch: 2, claveEquipoApi,
      categoriaMantenimiento: candidatosCodigo[0].descripcionOriginal,
      validadoContraMaestro: buscarValidacionMaestro(catalogo, candidatosCodigo[0].descripcionNormalizada, valor),
    };
  }

  // NIVEL 3 — maestro directo por descripción exacta (sin pasar por el histórico).
  const matchMaestro = catalogo.maestro.find(
    m => m.descripcionNormalizada === nombreNorm || (subTipoDescNorm != null && m.descripcionNormalizada === subTipoDescNorm),
  );
  if (matchMaestro) {
    return {
      mantenimientoEncontrado: true, requiereRevision: false,
      valorMantenimientoUnitarioMensual: matchMaestro.valorMensual,
      fuenteMantenimiento: 'COSTOS_MTTO_MAESTRO',
      nivelMatch: 3, claveEquipoApi,
      categoriaMantenimiento: matchMaestro.descripcionOriginal,
    };
  }

  // SIN MATCH — nunca se convierte en 0.
  return {
    mantenimientoEncontrado: false, requiereRevision: true, motivo: 'SIN_COINCIDENCIA',
    valorMantenimientoUnitarioMensual: null, fuenteMantenimiento: 'SIN_COINCIDENCIA',
    nivelMatch: null, claveEquipoApi,
  };
}
