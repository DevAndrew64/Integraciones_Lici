/**
 * Ajuste "INDICADORES FINANCIEROS AUTOMÁTICOS SEGÚN EMPRESA" — catálogo
 * puro (sin React) de valores financieros por empresa (fuente: COMERCIAL
 * 2026 1 — Indicadores financieros Año 2025) y funciones de evaluación de
 * cumplimiento. Reutilizado por `page.tsx` en los formularios de captura
 * de indicadores (`ModalGestionAsignacion`/`GestionAsignacionInline`).
 *
 * Identidad de empresa: se reutiliza el mismo código corto ya usado por
 * Dotación/EPP/Insumos (`CodigoEmpresaCatalogoDotEpp` = 'aseo'|'tempo'|
 * 'vigi', derivado de `Solicitud.perfil` vía
 * `derivarCodigoEmpresaCatalogoDotEpp` en page.tsx) — nunca un identificador
 * paralelo. Este módulo NO importa esa función (evita una dependencia
 * lib→page.tsx); el código corto ya resuelto se pasa como parámetro.
 *
 * Todos los valores son números — NUNCA se convierten a porcentaje
 * (0.28 sigue siendo 0.28, no "28%") ni se comparan como strings.
 */

export type CodigoEmpresaIndicadores = 'aseo' | 'tempo' | 'vigi';

export type ClaveIndicadorFinanciero =
  | 'LIQUIDEZ' | 'ENDEUDAMIENTO' | 'COBERTURA_INTERESES'
  | 'RENTABILIDAD_ACTIVO' | 'RENTABILIDAD_PATRIMONIO' | 'CAPITAL_TRABAJO';

/**
 * `MINIMO` => el valor de la empresa debe ser MAYOR O IGUAL al requerido
 * (`valorEmpresa >= requerido`), visualmente "Requerido ≤ Valor empresa".
 * `MAXIMO` => el valor de la empresa debe ser MENOR O IGUAL al requerido
 * (`valorEmpresa <= requerido`), visualmente "Requerido ≥ Valor empresa".
 * Endeudamiento es el ÚNICO de los 6 indicadores que es MAXIMO — los
 * otros 5 son MINIMO (confirmado explícitamente en el requerimiento).
 */
export type TipoComparacionIndicador = 'MINIMO' | 'MAXIMO';

export interface DefinicionIndicadorFinanciero {
  clave: ClaveIndicadorFinanciero;
  /** Etiqueta EXACTA — debe coincidir con `CAUSAS_ESPECIFICAS['Indicador']`
   * en page.tsx (mismo texto usado como `subcausa` al persistir), para
   * poder resolver la definición de un indicador ya guardado por nombre. */
  etiqueta: string;
  tipo: TipoComparacionIndicador;
  /** true SOLO para Capital de trabajo — valor monetario (formato COP,
   * miles con punto), nunca decimal con coma ni tratado como porcentaje. */
  esMonetario?: boolean;
}

/** Fuente única — nunca condiciones dispersas por nombre en el JSX. */
export const DEFINICIONES_INDICADORES_FINANCIEROS: readonly DefinicionIndicadorFinanciero[] = [
  { clave: 'LIQUIDEZ', etiqueta: 'Liquidez', tipo: 'MINIMO' },
  { clave: 'ENDEUDAMIENTO', etiqueta: 'Endeudamiento', tipo: 'MAXIMO' },
  { clave: 'COBERTURA_INTERESES', etiqueta: 'Razón de cobertura de intereses', tipo: 'MINIMO' },
  { clave: 'RENTABILIDAD_ACTIVO', etiqueta: 'Rentabilidad del activo', tipo: 'MINIMO' },
  { clave: 'RENTABILIDAD_PATRIMONIO', etiqueta: 'Rentabilidad del patrimonio', tipo: 'MINIMO' },
  { clave: 'CAPITAL_TRABAJO', etiqueta: 'Capital de trabajo', tipo: 'MINIMO', esMonetario: true },
];

/** Fuente: COMERCIAL 2026 1 — Indicadores financieros Año 2025. */
export const VALORES_FINANCIEROS_POR_EMPRESA: Readonly<Record<CodigoEmpresaIndicadores, Readonly<Record<ClaveIndicadorFinanciero, number>>>> = {
  aseo: {
    LIQUIDEZ: 3.57, ENDEUDAMIENTO: 0.28, COBERTURA_INTERESES: 53.27,
    RENTABILIDAD_ACTIVO: 0.15, RENTABILIDAD_PATRIMONIO: 0.21, CAPITAL_TRABAJO: 35356709367,
  },
  vigi: {
    LIQUIDEZ: 4.07, ENDEUDAMIENTO: 0.42, COBERTURA_INTERESES: 139.66,
    RENTABILIDAD_ACTIVO: 0.13, RENTABILIDAD_PATRIMONIO: 0.23, CAPITAL_TRABAJO: 18212457957,
  },
  tempo: {
    LIQUIDEZ: 2.92, ENDEUDAMIENTO: 0.45, COBERTURA_INTERESES: 14.19,
    RENTABILIDAD_ACTIVO: 0.07, RENTABILIDAD_PATRIMONIO: 0.13, CAPITAL_TRABAJO: 10692855100,
  },
};

/** `null` si la empresa no está configurada — NUNCA cae a datos de otra
 * empresa (ver requerimiento §3: "si la empresa no tiene configuración,
 * NO cargues silenciosamente datos de otra empresa"). */
export function obtenerValorFinancieroEmpresa(
  empresa: CodigoEmpresaIndicadores | null | undefined,
  clave: ClaveIndicadorFinanciero,
): number | null {
  if (!empresa) return null;
  const tabla = VALORES_FINANCIEROS_POR_EMPRESA[empresa];
  return tabla ? tabla[clave] : null;
}

export function buscarDefinicionIndicadorPorEtiqueta(etiqueta: string): DefinicionIndicadorFinanciero | undefined {
  return DEFINICIONES_INDICADORES_FINANCIEROS.find((d) => d.etiqueta === etiqueta);
}

/** Operador visual mostrado ENTRE "Valor requerido" y "Valor de la
 * empresa" — la lectura es SIEMPRE "Requerido [operador] Valor empresa". */
export function operadorVisualIndicador(tipo: TipoComparacionIndicador): '≤' | '≥' {
  return tipo === 'MINIMO' ? '≤' : '≥';
}

/**
 * ÚNICA función de cumplimiento — reutilizada por la UI, nunca duplicada.
 * `null` cuando falta el requerido o el valor de la empresa (la UI debe
 * mostrar "—" en ese caso, nunca "No cumple" por defecto). La igualdad
 * SIEMPRE cuenta como cumplimiento (`>=`/`<=`, nunca `>`/`<` estrictos).
 */
export function evaluaCumpleIndicador(
  tipo: TipoComparacionIndicador,
  requerido: number | null,
  valorEmpresa: number | null,
): boolean | null {
  if (requerido == null || valorEmpresa == null || !Number.isFinite(requerido) || !Number.isFinite(valorEmpresa)) return null;
  return tipo === 'MINIMO' ? valorEmpresa >= requerido : valorEmpresa <= requerido;
}

/**
 * Parsea un valor de indicador (ratio, ej. "5,5"/"5.5"/"0,30"/"0.30") a
 * número — coma o punto como separador DECIMAL (nunca agrupador de
 * miles: estos valores nunca superan unidades/decenas). `null` si no es
 * un número válido (nunca NaN silencioso). NO usar para Capital de
 * trabajo (monetario) — ver `parsearValorMonetario`.
 */
export function parsearValorIndicadorDecimal(texto: string | null | undefined): number | null {
  if (texto == null) return null;
  const limpio = String(texto).trim().replace(',', '.');
  if (limpio === '') return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parsea un valor MONETARIO (Capital de trabajo) — quita todo lo que no
 * sea dígito (separadores de miles con punto, "$", espacios), NUNCA
 * interpreta el punto como decimal (mismo patrón ya usado en el resto de
 * la app para inputs de dinero: `e.target.value.replace(/\D/g,'')`).
 */
export function parsearValorMonetario(texto: string | null | undefined): number | null {
  if (texto == null) return null;
  const digitos = String(texto).replace(/\D/g, '');
  if (digitos === '') return null;
  return Number(digitos);
}

/**
 * Ajuste "QUE ACA PERMITA SOLO DIGITAR NUMEROS, NO LETRAS... 3 CIFRAS
 * EJEMPLO 5,24" — sanea el texto que el analista está digitando en un
 * indicador de tipo ratio (nunca monetario) MIENTRAS escribe: solo
 * dígitos y un único separador decimal (coma o punto), máximo
 * `maxDecimales` (2 por defecto) dígitos después del separador. Nunca
 * reordena ni interpreta el texto — solo filtra caracteres inválidos, para
 * usarse directamente en el `onChange` del input (controlado).
 */
export function sanearEntradaDecimalIndicador(texto: string, maxDecimales = 2): string {
  let v = texto.replace(/[^0-9.,]/g, '');
  const idxSep = v.search(/[.,]/);
  if (idxSep !== -1) {
    const separador = v[idxSep];
    const entero = v.slice(0, idxSep).replace(/[.,]/g, '');
    const decimales = v.slice(idxSep + 1).replace(/[.,]/g, '').slice(0, maxDecimales);
    v = entero + separador + decimales;
  }
  return v;
}
