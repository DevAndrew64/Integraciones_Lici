/**
 * Contrato financiero explícito — CIERRE FINANCIERO CORRECTIVO. Antes de
 * este módulo, `resultado-financiero-mensual-linea.ts` leía directamente
 * `PARAMETROS_FINANCIEROS_2026_DEFAULT` (parametros-financieros-default.ts) para TODOS los
 * porcentajes de prestaciones/seguridad social/parafiscales, ignorando por
 * completo los porcentajes que el usuario ya configura hoy en la
 * estructura de costos (pSalud/pPension/pSena/pIcbf/pCaja, page.tsx) — una
 * regresión real: el formulario por defecto usa Salud=0%/SENA=0%/ICBF=0%
 * (usuario explícito), mientras el default legado usa 8.5%/2%/3%.
 *
 * Regla de resolución (§3, cierre correctivo): SIEMPRE
 *   `valorConfiguradoPorUsuario ?? valorPredeterminado`
 * NUNCA `||` — cero es un valor configurado válido y debe conservarse.
 *
 * Cesantías/prima/vacaciones/intereses de cesantías NO tienen hoy un campo
 * editable en page.tsx (el motor legado los tenía hardcodeados: 8.33/
 * 8.33/5/1, idénticos a PARAMETROS_FINANCIEROS_2026_DEFAULT) — se resuelven
 * igual que los demás, por si en el futuro se exponen como editables, sin
 * necesidad de tocar este contrato de nuevo.
 *
 * La ARL SIGUE dependiendo de la clase de riesgo por línea (nunca un
 * porcentaje plano compartido) — `porcentajeArlPorClase` viaja completo
 * (las 5 clases) para que el ensamblador resuelva por la `claseArl` de
 * cada línea, nunca por un único valor global.
 */
import { PARAMETROS_FINANCIEROS_2026_DEFAULT } from '../parametros-financieros-default';

export type ClaseArl = 'I' | 'II' | 'III' | 'IV' | 'V';

const CLASES_ARL_VALIDAS: ReadonlySet<string> = new Set(['I', 'II', 'III', 'IV', 'V']);

/** Ajuste "CORREGIR EL RIESGO DE ARL" — antes, `l.arlKey as ClaseArl || 'II'`
 * solo protegía contra valores vacíos/nulos/undefined (`||`): un dato
 * persistido con un `arlKey` inválido pero no vacío (ej. 'VI', 'XYZ', un
 * registro corrupto) se colaba sin validar, y `porcentajeArlPorClase[valor
 * inválido]` producía `undefined` → NaN en el cálculo financiero. Único
 * punto de validación de clase ARL — nunca se repite este `Set` en otro
 * archivo. Cualquier valor fuera de las 5 clases legales (incluidas
 * cadenas vacías/nulas/undefined) usa el MISMO fallback ya vigente
 * ('II', clase de riesgo media, nunca una tarifa inventada) — el
 * porcentaje real sigue viniendo de `porcentajeArlPorClase` (configuración
 * canónica), esta función solo decide qué CLAVE de esa tabla se usa. */
export function resolverClaseArl(valor: string | null | undefined): ClaseArl {
  return valor != null && CLASES_ARL_VALIDAS.has(valor) ? (valor as ClaseArl) : 'II';
}

/** Contrato ya resuelto — todos los campos presentes, nunca `undefined`.
 * Es lo único que debe consumir el ensamblador financiero mensual. */
export interface ParametrosFinancierosManoObra {
  porcentajeCesantias: number;
  porcentajePrima: number;
  porcentajeVacaciones: number;
  porcentajeInteresesCesantias: number;

  porcentajeSalud: number;
  porcentajePension: number;
  porcentajeCajaCompensacion: number;
  porcentajeSena: number;
  porcentajeIcbf: number;

  porcentajeArlPorClase: Record<ClaseArl, number>;

  // Exoneración explícita (regla legal/empresarial) — CONCEPTUALMENTE
  // DISTINTA de "porcentaje configurado en cero" (§4): un porcentaje en
  // cero es una configuración del usuario; una exoneración es una razón
  // legal aparte. Hoy page.tsx no expone un toggle de exoneración, así
  // que estos campos siempre resuelven en `false` — el 0% ya cubre el
  // caso numérico sin necesidad de inferir una exoneración inexistente.
  exoneradoSalud: boolean;
  exoneradoSena: boolean;
  exoneradoIcbf: boolean;

  /** Trazabilidad interna — nunca se muestra al usuario. */
  fuente: 'CONFIGURACION_USUARIO' | 'VALORES_PREDETERMINADOS';
}

/** Entrada cruda — cualquier campo puede faltar (registro histórico) o
 * venir explícitamente en 0/false. `undefined`/`null` son los ÚNICOS
 * valores que activan el fallback a los predeterminados; `0`/`false`
 * SIEMPRE se conservan tal cual (§3). */
export interface ConfiguracionFinancieraManoObra {
  porcentajeCesantias?: number | null;
  porcentajePrima?: number | null;
  porcentajeVacaciones?: number | null;
  porcentajeInteresesCesantias?: number | null;
  porcentajeSalud?: number | null;
  porcentajePension?: number | null;
  porcentajeCajaCompensacion?: number | null;
  porcentajeSena?: number | null;
  porcentajeIcbf?: number | null;
  porcentajeArlPorClase?: Partial<Record<ClaseArl, number>> | null;
  exoneradoSalud?: boolean | null;
  exoneradoSena?: boolean | null;
  exoneradoIcbf?: boolean | null;
}

const VALORES_PREDETERMINADOS: Omit<ParametrosFinancierosManoObra, 'fuente'> = {
  porcentajeCesantias: PARAMETROS_FINANCIEROS_2026_DEFAULT.pctCesantias,
  porcentajePrima: PARAMETROS_FINANCIEROS_2026_DEFAULT.pctPrima,
  porcentajeVacaciones: PARAMETROS_FINANCIEROS_2026_DEFAULT.pctVacaciones,
  porcentajeInteresesCesantias: PARAMETROS_FINANCIEROS_2026_DEFAULT.pctIntCesantias,
  porcentajeSalud: PARAMETROS_FINANCIEROS_2026_DEFAULT.pctSalud,
  porcentajePension: PARAMETROS_FINANCIEROS_2026_DEFAULT.pctPension,
  porcentajeCajaCompensacion: PARAMETROS_FINANCIEROS_2026_DEFAULT.pctCaja,
  porcentajeSena: PARAMETROS_FINANCIEROS_2026_DEFAULT.pctSena,
  porcentajeIcbf: PARAMETROS_FINANCIEROS_2026_DEFAULT.pctIcbf,
  porcentajeArlPorClase: { ...PARAMETROS_FINANCIEROS_2026_DEFAULT.pctArlPorClase },
  exoneradoSalud: false,
  exoneradoSena: false,
  exoneradoIcbf: false,
};

/** Único punto de resolución — nunca se usa `||` para ninguno de estos
 * campos (cero es válido); solo `??`, que respeta 0/false explícitos y
 * únicamente recurre al predeterminado ante `undefined`/`null` real. */
export function resolverParametrosFinancierosManoObra(
  configuracion: ConfiguracionFinancieraManoObra | null | undefined,
): ParametrosFinancierosManoObra {
  const c = configuracion ?? {};
  return {
    porcentajeCesantias: c.porcentajeCesantias ?? VALORES_PREDETERMINADOS.porcentajeCesantias,
    porcentajePrima: c.porcentajePrima ?? VALORES_PREDETERMINADOS.porcentajePrima,
    porcentajeVacaciones: c.porcentajeVacaciones ?? VALORES_PREDETERMINADOS.porcentajeVacaciones,
    porcentajeInteresesCesantias: c.porcentajeInteresesCesantias ?? VALORES_PREDETERMINADOS.porcentajeInteresesCesantias,
    porcentajeSalud: c.porcentajeSalud ?? VALORES_PREDETERMINADOS.porcentajeSalud,
    porcentajePension: c.porcentajePension ?? VALORES_PREDETERMINADOS.porcentajePension,
    porcentajeCajaCompensacion: c.porcentajeCajaCompensacion ?? VALORES_PREDETERMINADOS.porcentajeCajaCompensacion,
    porcentajeSena: c.porcentajeSena ?? VALORES_PREDETERMINADOS.porcentajeSena,
    porcentajeIcbf: c.porcentajeIcbf ?? VALORES_PREDETERMINADOS.porcentajeIcbf,
    porcentajeArlPorClase: {
      I: c.porcentajeArlPorClase?.I ?? VALORES_PREDETERMINADOS.porcentajeArlPorClase.I,
      II: c.porcentajeArlPorClase?.II ?? VALORES_PREDETERMINADOS.porcentajeArlPorClase.II,
      III: c.porcentajeArlPorClase?.III ?? VALORES_PREDETERMINADOS.porcentajeArlPorClase.III,
      IV: c.porcentajeArlPorClase?.IV ?? VALORES_PREDETERMINADOS.porcentajeArlPorClase.IV,
      V: c.porcentajeArlPorClase?.V ?? VALORES_PREDETERMINADOS.porcentajeArlPorClase.V,
    },
    exoneradoSalud: c.exoneradoSalud ?? VALORES_PREDETERMINADOS.exoneradoSalud,
    exoneradoSena: c.exoneradoSena ?? VALORES_PREDETERMINADOS.exoneradoSena,
    exoneradoIcbf: c.exoneradoIcbf ?? VALORES_PREDETERMINADOS.exoneradoIcbf,
    // `configuracion` ausente por completo (null/undefined) = registro sin
    // parámetros personalizados → predeterminados, marcados como tal. Un
    // objeto presente (aunque algún campo individual caiga en fallback)
    // representa la configuración actual real de la estructura de costos.
    fuente: configuracion == null ? 'VALORES_PREDETERMINADOS' : 'CONFIGURACION_USUARIO',
  };
}