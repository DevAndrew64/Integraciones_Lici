import 'server-only';
import { consultarDestinoContratos } from './directo';
import { empresaDeSolicitud, origenProcesoContratos, type DestinoLeido } from './destino';

export interface SolicitudParaDestino {
  perfil: string | null;
  aliasFuente: string | null;
  linkSecop: string | null;
  linkSecopReg: string | null;
}

export type DestinoDeSolicitud =
  | { ok: true; destino: DestinoLeido; origenProceso: 'LIC' | 'INV' }
  | { ok: false; estado: 409 | 503; error: string; mensaje: string };

/** Empresa y UEN de Contratos (leídas de la base) y origen del proceso de una solicitud. Lo usan la pantalla y el envío. */
export async function destinoDeSolicitud(s: SolicitudParaDestino, consultar = consultarDestinoContratos): Promise<DestinoDeSolicitud> {
  const empresa = empresaDeSolicitud(s.perfil);
  if (!empresa) return { ok: false, estado: 409, error: 'SIN_EMPRESA', mensaje: 'La solicitud no tiene empresa del grupo (perfil): no se sabe a qué empresa de Contratos va la oferta.' };
  const r = await consultar(empresa);
  if (r.ok) return { ok: true, destino: r.destino, origenProceso: origenProcesoContratos(s) };
  if (r.tipo === 'NO_DISPONIBLE') return { ok: false, estado: 503, error: 'CONTRATOS_NO_DISPONIBLE', mensaje: r.mensaje };
  if (r.tipo === 'SIN_EMPRESA') return { ok: false, estado: 409, error: 'SIN_EMPRESA', mensaje: `No se encontró la empresa ${empresa} en Contratos (fc_empresas).` };
  return { ok: false, estado: 409, error: 'EMPRESA_AMBIGUA', mensaje: `El nombre ${empresa} coincide con varias empresas de Contratos (${r.candidatas.join('; ')}): avise a Sistemas.` };
}
