/**
 * A dónde va la oferta en Contratos sin que nadie lo digite: la empresa sale del perfil de la solicitud (buscada por nombre
 * en Contratos), el tipo de tarifa del costeo, el origen de la fuente del proceso y la UEN se elige entre las que la
 * empresa tiene en Contratos. El concepto de facturación sale solo cuando la UEN tiene uno; si tiene varios, se elige.
 */

export interface ConceptoContratos {
  codigo: string;
  descripcion: string;
}

export interface UenContratos {
  codigo: string;
  conceptos: ConceptoContratos[];
}

/** Lo que responde Contratos para la empresa de la solicitud. */
export interface DestinoLeido {
  empresa: { codigo: string; rsocial: string };
  uens: UenContratos[];
}

/**
 * Tipo de tarifa de Contratos: «C» (administración y costos asumidos) cuando el costeo lleva Costos Administrativos,
 * «A» (solo A.I.U.) cuando no.
 */
export function tipoTarifaContratos(totalAdministrativos: number | null | undefined): 'A' | 'C' {
  return typeof totalAdministrativos === 'number' && Number.isFinite(totalAdministrativos) && totalAdministrativos > 0 ? 'C' : 'A';
}

/**
 * Origen del proceso para Contratos: «LIC» (licitación pública) si la solicitud viene de SECOP (alias S1/S2 o enlace a
 * SECOP); si no, «INV» (invitación privada: procesos digitados a mano o de clientes privados).
 */
export function origenProcesoContratos(s: { aliasFuente?: string | null; linkSecop?: string | null; linkSecopReg?: string | null }): 'LIC' | 'INV' {
  const alias = String(s.aliasFuente ?? '').trim().toUpperCase();
  const conEnlace = [s.linkSecop, s.linkSecopReg].some((v) => String(v ?? '').trim() !== '');
  return alias === 'S1' || alias === 'S2' || conEnlace ? 'LIC' : 'INV';
}

/** Empresa del grupo en LiciColba (el perfil de la solicitud), en mayúsculas; null si no hay. */
export function empresaDeSolicitud(perfil: string | null | undefined): string | null {
  const p = String(perfil ?? '').trim().toUpperCase();
  return p || null;
}

/**
 * La UEN que se marca de entrada: la preferida (la última que usó quien envía, o una ciudad de LiciColba) si la empresa la
 * tiene en Contratos; si la empresa tiene una sola UEN, esa; si no, ninguna (quien envía elige).
 */
const UEN_POR_CIUDAD: Record<string, string> = { BARRANQUILLA: 'BAQ', BOGOTA: 'BOG', MINA: 'MNA' };
export function uenSugerida(preferida: string | null | undefined, uens: readonly UenContratos[]): string | null {
  const clave = String(preferida ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
  const codigo = UEN_POR_CIUDAD[clave] ?? clave;
  if (codigo && uens.some((u) => u.codigo === codigo)) return codigo;
  return uens.length === 1 ? uens[0].codigo : null;
}

/** El concepto que va solo: el único de la UEN. Con varios, quien envía elige; sin ninguno, no se puede enviar. */
export function conceptoAutomatico(uen: UenContratos | undefined): string | null {
  return uen && uen.conceptos.length === 1 ? uen.conceptos[0].codigo : null;
}

/**
 * Comprueba la UEN y el concepto elegidos contra lo que Contratos tiene para la empresa.
 * @returns el concepto que se envía, o el mensaje para quien envía
 */
export function validarEleccion(destino: DestinoLeido, undnegocio: string | null, codServicio: string | null): { ok: true; undnegocio: string; codServicio: string } | { ok: false; mensaje: string } {
  const uenCodigo = String(undnegocio ?? '').trim().toUpperCase();
  const uen = destino.uens.find((u) => u.codigo === uenCodigo);
  if (!uen) {
    const opciones = destino.uens.map((u) => u.codigo).join(', ');
    return { ok: false, mensaje: uenCodigo ? `La UEN ${uenCodigo} no tiene contador de ofertas en Contratos para ${destino.empresa.rsocial} (UEN disponibles: ${opciones || 'ninguna'}).` : 'Seleccione la UEN de Contratos.' };
  }
  if (uen.conceptos.length === 0) return { ok: false, mensaje: `La UEN ${uen.codigo} no tiene conceptos de facturación en Contratos. Créelo en Contratos y vuelva a enviar.` };
  const concepto = conceptoAutomatico(uen) ?? String(codServicio ?? '').trim().toUpperCase();
  if (!concepto) return { ok: false, mensaje: `Seleccione el concepto de facturación de la UEN ${uen.codigo}.` };
  if (!uen.conceptos.some((c) => c.codigo === concepto)) return { ok: false, mensaje: `El concepto ${concepto} no es de la UEN ${uen.codigo} en Contratos.` };
  return { ok: true, undnegocio: uen.codigo, codServicio: concepto };
}
