'use client';

export interface SimCompetidor {
  id: number;
  nombre: string | null;
  porcentajeOferta: number;
  valorOferta: number | null;
  fuente: string;
  probabilidadParticipacion: number | null;
  observaciones: string | null;
}

export interface SimResultado {
  id: number;
  metodo: string;
  porcentajeOptimo: number;
  valorOptimo: number;
  puntajeOptimo: number;
  miOfertaPorcentaje: number | null;
  miOfertaPuntaje: number | null;
  diferenciaPuntos: number | null;
  esMetodoActivo: boolean;
}

export interface SimulacionAvanzada {
  id: number;
  procesoId: number | null;
  solicitudId: number | null;
  numeroProceso: string | null;
  razonSocial: string | null;
  empresaGrupo: string | null;
  nombre: string | null;
  presupuestoOficial: number;
  trmValor: number;
  trmFecha: string;
  trmCentavos: number;
  trmFuente: string;
  metodoActivo: string;
  puntajeMaximo: number;
  miOfertaPorcentaje: number | null;
  miOfertaValor: number | null;
  creadoPorId: number | null;
  creadoPor: { id: number; usuario: string | null; entidadGrupo: string } | null;
  estado: string;
  notas: string | null;
  createdAt: string;
  updatedAt: string;
  competidores: SimCompetidor[];
  resultados: SimResultado[];
}

export const FORMULA_LABELS: Record<string, string> = {
  mediana: 'Mediana',
  media_geometrica: 'Media geométrica',
  media_geometrica_con_presupuesto: 'M. geom. c/presupuesto',
  media_aritmetica: 'Media aritmética',
  media_aritmetica_baja: 'M. aritmética baja',
  media_aritmetica_alta: 'M. aritmética alta',
  menor_valor: 'Menor valor',
};

export const FORMULA_LABELS_LARGO: Record<string, string> = {
  mediana: 'Mediana',
  media_geometrica: 'Media geométrica',
  media_geometrica_con_presupuesto: 'Media geométrica con presupuesto oficial',
  media_aritmetica: 'Media aritmética',
  media_aritmetica_baja: 'Media aritmética baja',
  media_aritmetica_alta: 'Media aritmética alta',
  menor_valor: 'Menor valor',
};

export const NAVY = '#0d2d5e';
export const BORDER = '1px solid #e2e8f0';
export const CARD_SHADOW = '0 1px 4px rgba(13,45,94,.07)';

export const sCard: React.CSSProperties = {
  background: 'white',
  border: BORDER,
  borderRadius: 10,
  marginBottom: 16,
  overflow: 'hidden',
  boxShadow: CARD_SHADOW,
};

export const sCardHead: React.CSSProperties = {
  padding: '12px 20px',
  borderBottom: BORDER,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  background: '#fafbff',
};

export const sCardBody: React.CSSProperties = {
  padding: '16px 20px',
};

export const fmtCOP = (v: number): string =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v);

export const fmtPct = (v: number): string => v.toFixed(2) + '%';

export const fmtPts = (v: number): string => v.toFixed(2) + ' pts';

export function estadoBadge(estado: string): { bg: string; color: string; label: string } {
  switch (estado) {
    case 'archivada': return { bg: '#f1f5f9', color: '#94a3b8', label: 'Archivada' };
    case 'revisada':  return { bg: '#dcfce7', color: '#16a34a', label: 'Revisada' };
    case 'guardada':  return { bg: '#eff6ff', color: '#2563eb', label: 'Guardada' };
    default:          return { bg: '#fef3c7', color: '#92400e', label: 'Borrador' };
  }
}