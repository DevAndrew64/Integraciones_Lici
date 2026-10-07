/**
 * Validador de CRITERIOS DEL PLIEGO para optimización robusta.
 *
 * FASE 0.1 — investigación. NO se usa en producción.
 *
 * Entrada: MetodoPonderacionProceso[] (subconjunto de campos). SOLO los
 * métodos APROBADOS (`estadoRevision='aprobado'` && `aprobado=true`) pueden
 * ser candidatos productivos.
 *
 * Reutiliza `validarConfiguracionCriterios()` (trm/backtest/criterios.ts).
 *
 * Salida:
 *   OK { criterios, probabilidadEstructural }   — listo para optimizar
 *   REQUIERE_REVISION { errores[] }              — el humano debe corregir el pliego
 *
 * NUNCA hace fallback silencioso a RANGOS_TRM hardcodeado ni renormaliza
 * huecos. Cobertura incompleta 00–99 → REQUIERE_REVISION.
 */

import { validarConfiguracionCriterios } from '@/lib/trm/backtest/criterios';
import type { ConfiguracionCriterioTrm } from '@/lib/trm/backtest/types';
import { FORMULA_KEYS } from '../formulas';
import type { FormulaKey } from '../types';

/** FormulaKeys del motor que REQUIEREN un presupuesto oficial verificado. */
export function formulaRequierePresupuesto(fk: FormulaKey | string | null): boolean {
  return fk === 'media_geometrica_con_presupuesto';
}

/** Campos de MetodoPonderacionProceso que necesita el validador. */
export interface MetodoPliegoEntrada {
  id: number | string;
  nombreMetodo: string;
  tipoFormula: string;
  rangoTrmDesde: number | null;
  rangoTrmHasta: number | null;
  puntajeMaximo: number | null;
  estadoRevision: string;
  aprobado: boolean;
  formulaTexto?: string | null;
  textoFuente?: string | null;
  // FASE A.1 §6 — la equivalencia con el motor se confirma por SEMÁNTICA, nunca por nombre.
  formulaKeyMotor?: string | null;
  equivalenciaMotorEstado?: string | null;   // 'EQUIVALENTE_CONFIRMADA' habilita productivo
}

export interface CriterioResuelto {
  codigo: string;
  nombreMetodo: string;
  formulaKey: FormulaKey;
  puntajeMaximo: number;
  desde: number;
  hasta: number;
  /** trazabilidad obligatoria al pliego. */
  formulaTexto: string | null;
  textoFuente: string | null;
}

export type ResultadoCriteriosPliego =
  | {
      ok: true;
      criterios: CriterioResuelto[];
      /** P(c) = (hasta − desde + 1) / 100. Suma exactamente 1 (cobertura completa garantizada). */
      probabilidadEstructural: Record<string, number>;
      /** true si algún criterio usa una fórmula que necesita presupuesto oficial verificado. */
      requierePresupuesto: boolean;
    }
  | { ok: false; motivo: 'REQUIERE_REVISION'; errores: string[] };

const ES_FORMULA_KEY = (v: unknown): v is FormulaKey => (FORMULA_KEYS as readonly string[]).includes(v as string);

const ES_ENTERO_0_99 = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 99;

/**
 * @param metodos  TODOS los métodos del proceso (aprobados y no). El filtro
 *                 de aprobación se hace aquí.
 */
export function resolverCriteriosPliego(metodos: MetodoPliegoEntrada[]): ResultadoCriteriosPliego {
  const errores: string[] = [];

  const aprobados = metodos.filter(m => m.aprobado === true && m.estadoRevision === 'aprobado');
  if (aprobados.length === 0) {
    return { ok: false, motivo: 'REQUIERE_REVISION', errores: ['No hay métodos de ponderación aprobados para este proceso.'] };
  }

  const cfg: ConfiguracionCriterioTrm[] = [];
  const resueltosParciales: Omit<CriterioResuelto, never>[] = [];

  for (const m of aprobados) {
    const codigo = `M${m.id}`;

    // §6 — EQUIVALENCIA con el motor por SEMÁNTICA (no por nombre). Sin
    // EQUIVALENTE_CONFIRMADA + una FormulaKey válida, no hay activación productiva.
    const equivOk = m.equivalenciaMotorEstado === 'EQUIVALENTE_CONFIRMADA' && ES_FORMULA_KEY(m.formulaKeyMotor);
    if (!equivOk) {
      errores.push(
        `Método ${codigo} ("${m.nombreMetodo}", fórmula "${m.tipoFormula}"): equivalencia con el motor no confirmada ` +
        `(equivalenciaMotorEstado=${m.equivalenciaMotorEstado ?? 'NO_EVALUADA'}, formulaKeyMotor=${m.formulaKeyMotor ?? 'null'}). ` +
        'Un humano/el motor debe confirmar la SEMÁNTICA (valor de referencia, variables, tratamiento del presupuesto, asignación de puntaje). Sin fuzzy matching.',
      );
    }
    const fkMotor = equivOk ? (m.formulaKeyMotor as FormulaKey) : null;

    // PM válido
    if (m.puntajeMaximo == null || !(m.puntajeMaximo > 0)) {
      errores.push(`Método ${codigo}: puntaje máximo faltante o <= 0 (${m.puntajeMaximo}).`);
    }

    // rangos presentes y 0–99 (validarConfiguracionCriterios re-chequea, pero
    // necesitamos números para construir la config)
    if (!ES_ENTERO_0_99(m.rangoTrmDesde) || !ES_ENTERO_0_99(m.rangoTrmHasta)) {
      errores.push(`Método ${codigo}: rango TRM ausente o fuera de 00–99 (desde=${m.rangoTrmDesde}, hasta=${m.rangoTrmHasta}).`);
      continue; // sin rango numérico no se puede añadir a la config
    }

    cfg.push({ codigo, nombre: m.nombreMetodo, desde: m.rangoTrmDesde as number, hasta: m.rangoTrmHasta as number });
    resueltosParciales.push({
      codigo,
      nombreMetodo: m.nombreMetodo,
      formulaKey: (fkMotor ?? 'mediana') as FormulaKey, // placeholder si hubo error; no se devuelve si errores>0
      puntajeMaximo: m.puntajeMaximo ?? 0,
      desde: m.rangoTrmDesde as number,
      hasta: m.rangoTrmHasta as number,
      formulaTexto: m.formulaTexto ?? null,
      textoFuente: m.textoFuente ?? null,
    });
  }

  // validación estructural (solapamientos, huecos, duplicados, cobertura completa)
  const v = validarConfiguracionCriterios(cfg, { exigirCoberturaCompleta: true });
  if (!v.valida) errores.push(...v.errores);
  if (!v.coberturaCompleta) {
    const faltan = v.decimalesSinCubrir;
    errores.push(
      `Cobertura incompleta de centavos 00–99: ${faltan.length} sin criterio ` +
        `(${faltan.slice(0, 8).map(d => String(d).padStart(2, '0')).join(', ')}${faltan.length > 8 ? '…' : ''}). ` +
        'No se renormaliza el hueco — requiere revisión del pliego.',
    );
  }

  if (errores.length > 0) {
    return { ok: false, motivo: 'REQUIERE_REVISION', errores };
  }

  const criterios = resueltosParciales as CriterioResuelto[];
  const probabilidadEstructural: Record<string, number> = {};
  for (const c of criterios) probabilidadEstructural[c.codigo] = (c.hasta - c.desde + 1) / 100;
  const requierePresupuesto = criterios.some(c => formulaRequierePresupuesto(c.formulaKey));

  return { ok: true, criterios, probabilidadEstructural, requierePresupuesto };
}
