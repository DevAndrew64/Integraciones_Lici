/** Valoriza los buckets de minutos ya clasificados. `ordinariaHabil` NUNCA
 * se valoriza aparte — ya está cubierta por el salario mensual completo
 * (nunca se muestra como costo adicional). El valor hora se conserva con
 * toda su precisión hasta el momento de calcular cada concepto; solo el
 * concepto monetario final se redondea (HALF_UP vía Math.round). */
import type { ConceptoMonetario, HorasBucketsDistribuido } from './tipos';

const FACTORES: Record<Exclude<keyof HorasBucketsDistribuido, 'ordinariaHabil'>, number> = {
  // Recargo adicional (no factor total): la hora nocturna ORDINARIA ya está
  // cubierta por el salario mensual — solo se adiciona el 35% del recargo,
  // nunca 1.35 (eso pagaría el 100% de la hora base una segunda vez).
  recargoNocturno: 0.35,
  extraDiurna: 1.25,
  extraNocturna: 1.75,
  // Recargo adicional (no factor total): la hora dominical/festiva
  // ORDINARIA ya está cubierta por el salario mensual — julio 2026, 90%
  // (Ley 2466/2025 art.14, tramo 01/07/2026-30/06/2027).
  ordinariaDominical: 0.90,
  recargoNocturnoDominical: 1.25, // 0.35 (nocturno) + 0.90 (festivo), ambos adicionales
  extraDiurnaFestiva: 2.05,
  extraNocturnaFestiva: 2.55,
};

export function liquidarConceptos(
  buckets: HorasBucketsDistribuido,
  valorHoraExacto: number,
): { conceptos: ConceptoMonetario[]; costoRecargos: number } {
  const conceptos: ConceptoMonetario[] = [];
  let costoRecargos = 0;
  (Object.keys(FACTORES) as (keyof typeof FACTORES)[]).forEach(concepto => {
    const minutos = buckets[concepto];
    const horasDecimal = minutos / 60;
    const factor = FACTORES[concepto];
    const valorSinRedondear = valorHoraExacto * factor * horasDecimal;
    const valorRedondeado = Math.round(valorSinRedondear);
    conceptos.push({ concepto, minutos, horasDecimal, factor, valorSinRedondear, valorRedondeado });
    costoRecargos += valorRedondeado;
  });
  return { conceptos, costoRecargos };
}
