/**
 * Parámetros financieros por defecto 2026 — módulo neutral, extraído de
 * `liquidador-mo.ts` (motor paralelo sin consumidores de producción,
 * fase de limpieza segura) para que `parametros-financieros-mano-obra.ts`
 * (consumido por el motor comercial vigente) no dependa de ese motor
 * únicamente por esta constante.
 *
 * Valores, porcentajes, redondeos y comportamiento financiero: SIN
 * CAMBIOS — copia exacta de lo que ya existía en liquidador-mo.ts.
 */

export type ModoRecargoNocturno = 'hora_completa' | 'solo_recargo';
export type FactoresDominicales = 'vigentes' | 'excel';

export interface ParametrosFinancierosDefaultMO {
  divisorHora: number;                 // 220
  jornadaMaxSemana: number;            // desde ParametrosLaborales (44 vigente)
  pctVacaciones: number;               // 5
  pctPension: number;                  // 12
  pctArlPorClase: Record<'I' | 'II' | 'III' | 'IV' | 'V', number>;
  pctCaja: number;                     // 4
  pctCesantias: number;                // 8.33
  pctPrima: number;                    // 8.33
  pctIntCesantias: number;             // 1
  pctSalud: number;                    // 8.5 — P3 default sin exoneración
  pctSena: number;                     // 2   — P3
  pctIcbf: number;                     // 3   — P3
  exoneracionParafiscal: boolean;      // P3 flag
  modoRecargoNocturno: ModoRecargoNocturno; // P2 flag
  factoresDominicales: FactoresDominicales; // P1 flag
  auxTransporteLegal: number;          // valor legal vigente 2026
}

/** Parámetros 2026 con las 3 banderas pendientes en su valor "vigente" por defecto. */
export const PARAMETROS_FINANCIEROS_2026_DEFAULT: ParametrosFinancierosDefaultMO = {
  divisorHora: 220,
  jornadaMaxSemana: 44,
  pctVacaciones: 5,
  pctPension: 12,
  pctArlPorClase: { I: 0.522, II: 1.044, III: 2.436, IV: 4.35, V: 6.96 },
  pctCaja: 4,
  pctCesantias: 8.33,
  pctPrima: 8.33,
  pctIntCesantias: 1,
  pctSalud: 8.5,
  pctSena: 2,
  pctIcbf: 3,
  exoneracionParafiscal: false,
  modoRecargoNocturno: 'hora_completa',
  factoresDominicales: 'vigentes',
  auxTransporteLegal: 249095,
};