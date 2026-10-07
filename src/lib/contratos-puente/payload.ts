import { porcentajeAIU, type ResultadoGuardado } from '@/lib/costos-estructura/exportacion/contratos';
import type { ErrorCampo, PayloadContratosV1 } from './cliente';

export interface SolicitudParaPuente {
  id: number;
  codigoProceso: string | null;
  entidad: string | null;
  objeto: string | null;
  nitContacto: string | null;
  direccionContacto: string | null;
}

const texto = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
const numero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * El puente pide solo dígitos (5 a 15), sin puntos, guion ni dígito de verificación: Contratos guarda «base-DV» y el
 * puente calcula el DV. «900.123.456-8» → «900123456».
 * Sin guion no se puede saber si el último dígito es el de verificación: se envía tal cual y se revisará contra los NIT
 * de Contratos en el módulo MySQL. Lo que no son dígitos se deja como llegó: el puente lo rechaza (nunca se «arregla»).
 */
export function normalizarNit(valor: string | null | undefined): string | null {
  const t = (valor ?? '').replace(/[\s.]/g, '');
  if (!t) return null;
  const conDigitoVerificacion = /^(\d{5,15})-\d$/.exec(t);
  return conDigitoVerificacion ? conDigitoVerificacion[1] : t;
}

/** JSON v1 del puente a partir de lo que LiciColba ya tiene: la solicitud y el Resultado guardado. */
export function armarPayloadContratos(d: {
  solicitud: SolicitudParaPuente;
  procesoCodigo: string | null;
  resultado: ResultadoGuardado | null;
}): PayloadContratosV1 {
  const { solicitud: s, resultado: r } = d;
  return {
    version: 1,
    origen: { solicitudId: s.id, procesoCodigo: texto(s.codigoProceso) ?? texto(d.procesoCodigo) },
    cliente: { razonSocial: texto(s.entidad), nit: normalizarNit(s.nitContacto), direccion: texto(s.direccionContacto) },
    contrato: {
      objeto: texto(s.objeto),
      porcentajeAIU: porcentajeAIU(r?.porcentajeIU),
      valorMensual: numero(r?.valorMesIncluidoIva),
      plazoMeses: numero(r?.vigenciaMeses),
    },
  };
}

const ETIQUETA_CAMPO: Record<string, string> = {
  'origen.solicitudId': 'Solicitud',
  'origen.procesoCodigo': 'Código del proceso',
  'cliente.razonSocial': 'Razón social del cliente',
  'cliente.nit': 'NIT del cliente',
  'cliente.direccion': 'Dirección del cliente',
  'contrato.objeto': 'Objeto',
  'contrato.porcentajeAIU': '% A.I.U.',
  'contrato.valorMensual': 'Valor mensual del contrato',
  'contrato.plazoMeses': 'Plazo (meses)',
};
const COMPLETAR_EN_FICHA = new Set(['cliente.razonSocial', 'cliente.nit']);

export const etiquetaCampo = (campo: string) => ETIQUETA_CAMPO[campo] ?? campo;

/** Texto para el usuario: «NIT del cliente: Es obligatorio. Complételo en la ficha de la solicitud.» */
export function describirError(e: ErrorCampo): string {
  return `${etiquetaCampo(e.campo)}: ${e.mensaje}${COMPLETAR_EN_FICHA.has(e.campo) ? ' Complételo en la ficha de la solicitud.' : ''}`;
}
