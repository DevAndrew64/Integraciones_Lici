/**
 * Resolver de precedencia (§1 modelo de 3 niveles):
 *   AJUSTE_PROCESO > EMPRESARIAL > NORMATIVO_VIGENTE > TECNICO_RESPALDO
 *
 * Puro respecto al historial mock — lee `historial-mock.ts` y
 * `catalogo-parametros.ts`, nunca escribe. Los 3 valores derivados
 * (extraFestivaDiurna/extraFestivaNocturna/recargoNocturnoFestivo) se
 * calculan SIEMPRE a partir de los parámetros base ya resueltos para el
 * mismo contexto — nunca se leen ni editan sueltos por este resolver.
 */
import { CATALOGO_PARAMETROS, PERFILES_NORMATIVOS_SEMILLA, obtenerDefinicionParametro } from './catalogo-parametros';
import { listarPerfilesEmpresariales, listarAjustesProceso } from './historial-mock';
import type { ValorResueltoParametro } from './tipos';

export interface ContextoResolucion {
  fecha: string; // "YYYY-MM-DD"
  empresa?: string;
  procesoId?: string;
}

const FORMULAS_DERIVADAS: Record<string, (r: (id: string) => number) => number> = {
  'jornada.extraFestivaDiurna': (r) => r('jornada.recargoDescansoObligatorio') + r('jornada.extraDiurna'),
  'jornada.extraFestivaNocturna': (r) => r('jornada.recargoDescansoObligatorio') + r('jornada.extraNocturna'),
  'jornada.recargoNocturnoFestivo': (r) => r('jornada.recargoDescansoObligatorio') + r('jornada.recargoNocturno'),
};

export function resolverParametro(parametroId: string, contexto: ContextoResolucion): ValorResueltoParametro {
  const definicion = obtenerDefinicionParametro(parametroId);
  if (definicion == null) {
    throw new Error(`Parámetro desconocido: "${parametroId}" — no existe en CATALOGO_PARAMETROS.`);
  }

  if (definicion.derivadoAutomaticamente) {
    const formula = FORMULAS_DERIVADAS[parametroId];
    if (formula == null) {
      throw new Error(`Parámetro derivado "${parametroId}" sin fórmula registrada en FORMULAS_DERIVADAS.`);
    }
    const valor = formula((baseId) => resolverParametro(baseId, contexto).valor);
    return {
      parametroId,
      valor,
      origen: 'DERIVADO_AUTOMATICO',
      vigenteDesde: null,
      referenciaId: null,
      estadoPerfilNormativo: null,
    };
  }

  if (contexto.procesoId != null) {
    const ajustes = listarAjustesProceso(parametroId).filter((a) => a.procesoId === contexto.procesoId);
    if (ajustes.length > 0) {
      const masReciente = ajustes.reduce((a, b) => (a.creadoEn > b.creadoEn ? a : b));
      return {
        parametroId,
        valor: masReciente.valorAplicado,
        origen: 'AJUSTE_PROCESO',
        vigenteDesde: null,
        referenciaId: masReciente.id,
        estadoPerfilNormativo: null,
      };
    }
  }

  if (contexto.empresa != null) {
    const vigentes = listarPerfilesEmpresariales(parametroId).filter(
      (p) =>
        p.empresa === contexto.empresa &&
        p.fechaInicial <= contexto.fecha &&
        (p.fechaFinal == null || contexto.fecha < p.fechaFinal),
    );
    if (vigentes.length > 0) {
      const masReciente = vigentes.reduce((a, b) => (a.fechaInicial > b.fechaInicial ? a : b));
      return {
        parametroId,
        valor: masReciente.valorAplicado,
        origen: 'EMPRESARIAL',
        vigenteDesde: masReciente.fechaInicial,
        referenciaId: masReciente.id,
        estadoPerfilNormativo: null,
      };
    }
  }

  const normativosVigentes = PERFILES_NORMATIVOS_SEMILLA.filter(
    (p) =>
      p.parametroId === parametroId &&
      (p.estado === 'VIGENTE' || p.estado === 'APROBADO') &&
      p.fechaVigenciaDesde <= contexto.fecha &&
      (p.fechaVigenciaHasta == null || contexto.fecha < p.fechaVigenciaHasta),
  );
  if (normativosVigentes.length > 0) {
    const masReciente = normativosVigentes.reduce((a, b) => (a.fechaVigenciaDesde > b.fechaVigenciaDesde ? a : b));
    return {
      parametroId,
      valor: masReciente.valor,
      origen: 'NORMATIVO',
      vigenteDesde: masReciente.fechaVigenciaDesde,
      referenciaId: masReciente.id,
      estadoPerfilNormativo: masReciente.estado,
    };
  }

  return {
    parametroId,
    valor: definicion.valorTecnicoRespaldo,
    origen: 'TECNICO_RESPALDO',
    vigenteDesde: null,
    referenciaId: null,
    estadoPerfilNormativo: null,
  };
}

/** Resuelve todo el catálogo para un contexto dado — insumo directo de la
 * vista de administración (tabla completa). */
export function resolverCatalogoCompleto(contexto: ContextoResolucion): ValorResueltoParametro[] {
  return CATALOGO_PARAMETROS.filter((p) => p.unidad !== 'TEXTO').map((p) => resolverParametro(p.id, contexto));
}