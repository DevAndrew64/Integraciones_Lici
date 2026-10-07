/**
 * Módulo PARÁMETROS — FASE 1/2 (auditoría + contrato + prototipo aislado).
 *
 * Aislado a propósito: ningún archivo del motor productivo
 * (`motor-distribuido/*`, `liquidador-mo.ts`, `page.tsx`) importa nada de
 * aquí todavía. Este módulo no reemplaza ninguna constante existente — es
 * el contrato de datos y el prototipo visual que el usuario pidió antes de
 * conectar nada al motor. Sin cambios de Prisma/migraciones: todo el
 * historial vive en memoria (`historial-mock.ts`).
 *
 * Modelo de 3 niveles, precedencia (mayor a menor):
 *   AJUSTE_PROCESO > EMPRESARIAL > NORMATIVO_VIGENTE > TECNICO_RESPALDO
 */

export type GrupoParametro =
  | 'JORNADA_Y_RECARGOS'
  | 'MENSUALIZACION_COMERCIAL'
  | 'SEGURIDAD_SOCIAL'
  | 'RIESGOS_LABORALES'
  | 'PARAFISCALES'
  | 'PRESTACIONES_SOCIALES'
  | 'BONOS_E_IBC'
  | 'REDONDEO_Y_PRECISION'
  | 'HISTORIAL_Y_VIGENCIAS';

export type UnidadParametro = 'PORCENTAJE' | 'HORAS' | 'DIAS' | 'PESOS' | 'FACTOR' | 'ADIMENSIONAL' | 'TEXTO';

export type EstadoPerfilNormativo = 'PENDIENTE' | 'APROBADO' | 'VIGENTE' | 'DEROGADO';

/** De dónde salió el valor finalmente resuelto — nunca inferido, siempre trazable. */
export type OrigenValorParametro =
  | 'AJUSTE_PROCESO'
  | 'EMPRESARIAL'
  | 'NORMATIVO'
  | 'TECNICO_RESPALDO'
  | 'DERIVADO_AUTOMATICO';

/**
 * Catálogo — describe QUÉ es el parámetro, no su valor vigente. El valor
 * vigente siempre se obtiene por `resolverParametro()`, nunca leyendo este
 * objeto directamente.
 */
export interface DefinicionParametro {
  id: string; // ej. "jornada.recargoNocturno"
  grupo: GrupoParametro;
  nombre: string;
  descripcion: string;
  unidad: UnidadParametro;
  /** true para los 3 valores que el plan de bonos exige derivar, nunca
   * editar sueltos salvo "modo avanzado" expresamente justificado. */
  derivadoAutomaticamente?: boolean;
  formulaDerivacion?: string; // texto legible, ej. "recargoDescansoObligatorio + extraDiurna"
  /** Última red de seguridad si no hay perfil normativo ni empresarial
   * vigente para la fecha — nunca queda `undefined` en la resolución. */
  valorTecnicoRespaldo: number;
}

export interface PerfilNormativoParametro {
  id: string;
  parametroId: string;
  fuenteLegal: string; // ej. "Ley 2466 de 2025, artículo 14"
  articulo?: string;
  fechaVigenciaDesde: string; // "YYYY-MM-DD"
  fechaVigenciaHasta?: string | null;
  valor: number;
  estado: EstadoPerfilNormativo;
  versionParametro: string;
  creadoEn: string;
  observacion?: string;
}

export interface PerfilEmpresarialParametro {
  id: string;
  parametroId: string;
  empresa: string;
  valorAplicado: number;
  fechaInicial: string;
  fechaFinal?: string | null;
  motivo: string;
  creadoPor: string;
  aprobadoPor?: string | null;
  /** Nunca pierde la referencia normativa original que motivó el ajuste. */
  referenciaPerfilNormativoId?: string | null;
  creadoEn: string;
}

export interface AjusteProcesoParametro {
  id: string;
  parametroId: string;
  procesoId: string; // referencia a proceso/estructura de costeo
  valorAplicado: number;
  motivo: string;
  responsable: string;
  creadoEn: string;
}

/** Resultado de resolver un parámetro para una fecha/empresa/proceso
 * concretos — siempre trazable a su origen, nunca un número suelto. */
export interface ValorResueltoParametro {
  parametroId: string;
  valor: number;
  origen: OrigenValorParametro;
  vigenteDesde?: string | null;
  referenciaId?: string | null;
  estadoPerfilNormativo?: EstadoPerfilNormativo | null;
}

export type RolParametros = 'LECTOR' | 'ANALISTA' | 'ADMINISTRADOR_PARAMETROS' | 'APROBADOR_NORMATIVO';

export type AccionAuditoria =
  | 'CREAR_PERFIL_NORMATIVO'
  | 'APROBAR_PERFIL_NORMATIVO'
  | 'CREAR_AJUSTE_EMPRESARIAL'
  | 'CREAR_AJUSTE_PROCESO'
  | 'RESTAURAR_VALOR_NORMATIVO'
  | 'ACTUALIZAR_A_PARAMETROS_VIGENTES';

export interface EntradaAuditoriaParametros {
  id: string;
  accion: AccionAuditoria;
  parametroId: string;
  usuario: string;
  rol: RolParametros;
  fecha: string;
  detalle: string;
}