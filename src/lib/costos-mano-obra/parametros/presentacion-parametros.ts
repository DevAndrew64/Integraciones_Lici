/**
 * Traducción a lenguaje comercial de los tipos internos del módulo
 * Parámetros — igual que `interprete-turnos-presentacion.ts`, nunca
 * altera la clasificación interna, solo la traduce para la UI.
 */
import type { GrupoParametro, OrigenValorParametro, EstadoPerfilNormativo, UnidadParametro } from './tipos';

export const ETIQUETA_GRUPO: Record<GrupoParametro, string> = {
  JORNADA_Y_RECARGOS: 'Jornada y recargos',
  MENSUALIZACION_COMERCIAL: 'Mensualización comercial',
  SEGURIDAD_SOCIAL: 'Seguridad social',
  RIESGOS_LABORALES: 'Riesgos laborales',
  PARAFISCALES: 'Parafiscales',
  PRESTACIONES_SOCIALES: 'Prestaciones sociales',
  BONOS_E_IBC: 'Bonos e IBC',
  REDONDEO_Y_PRECISION: 'Redondeo y precisión',
  HISTORIAL_Y_VIGENCIAS: 'Historial y vigencias',
};

export const ETIQUETA_ORIGEN: Record<OrigenValorParametro, string> = {
  AJUSTE_PROCESO: 'Ajuste del proceso',
  EMPRESARIAL: 'Empresarial',
  NORMATIVO: 'Normativo',
  TECNICO_RESPALDO: 'Técnico de respaldo',
  DERIVADO_AUTOMATICO: 'Derivado automáticamente',
};

export const ETIQUETA_ESTADO_NORMATIVO: Record<EstadoPerfilNormativo, string> = {
  PENDIENTE: 'Pendiente',
  APROBADO: 'Aprobado',
  VIGENTE: 'Vigente',
  DEROGADO: 'Derogado',
};

export function formatearValorParametro(valor: number, unidad: UnidadParametro): string {
  switch (unidad) {
    case 'PORCENTAJE':
      return `${(valor * 100).toLocaleString('es-CO', { maximumFractionDigits: 3 })}%`;
    case 'HORAS':
      return `${valor} h`;
    case 'DIAS':
      return `${valor} d`;
    case 'PESOS':
      return valor.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
    case 'FACTOR':
      return valor.toLocaleString('es-CO', { maximumFractionDigits: 4 });
    default:
      return String(valor);
  }
}