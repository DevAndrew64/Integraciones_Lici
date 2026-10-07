/**
 * Decisión PURA para el backfill preventivo Solicitud → Proceso (evita el
 * patrón detectado en los procesos 8009/7731: Solicitud.linkDetalle con una
 * URL válida mientras Proceso.linkDetalle queda vacío para siempre, porque
 * `buscarOCrearProceso` nunca recibe/persiste ese dato).
 *
 * Regla: la Solicitud solo puede COMPLETAR un Proceso.linkDetalle vacío —
 * nunca sobrescribir uno ya existente. Si ambos tienen un link pero
 * distinto, es CONFLICTO (no se modifica). No filtra por prefijo de
 * sourceKey (`manual:`/`ext:`) — la única condición relevante es que
 * Proceso.linkDetalle esté vacío, sea cual sea el origen del Proceso.
 *
 * Reutiliza `esUrlSecop`/`extraerNotice` de `@/lib/procesos/url-secop`. Para
 * NC, `esUrlSecop(url, 'NC')` expresa "URL http(s) bien formada" — el criterio
 * mínimo de aceptación que necesita este módulo para cualquier tipo de fuente
 * (SECOP I/II o portal de la entidad).
 */
import { esUrlSecop, extraerNotice } from '@/lib/procesos/url-secop';

export type DecisionBackfillLinkProceso =
  | { accion: 'COPIAR'; razon: string }
  | { accion: 'NO_HACER'; razon: string }
  | { accion: 'CONFLICTO'; razon: string };

export interface InputDecisionBackfillLinkProceso {
  procesoLinkDetalle: string | null | undefined;
  solicitudLinkDetalle: string | null | undefined;
}

export function decidirBackfillLinkProceso(
  input: InputDecisionBackfillLinkProceso
): DecisionBackfillLinkProceso {
  // Normalización mínima (solo espacios externos) — nunca reconstruye ni
  // transforma la URL en sí.
  const procesoLink = String(input.procesoLinkDetalle ?? '').trim();
  const solicitudLink = String(input.solicitudLinkDetalle ?? '').trim();

  if (!solicitudLink) {
    return { accion: 'NO_HACER', razon: 'solicitud_sin_link' };
  }

  // Validación mínima de URL aceptable — reutilizada, no duplicada.
  if (!esUrlSecop(solicitudLink, 'NC')) {
    return { accion: 'NO_HACER', razon: 'url_invalida_o_no_aceptable' };
  }

  if (!procesoLink) {
    return { accion: 'COPIAR', razon: 'proceso_vacio_solicitud_valida' };
  }

  if (procesoLink === solicitudLink) {
    return { accion: 'NO_HACER', razon: 'ya_coincide' };
  }

  // Ambas son SECOP II con URLs distintas por diferencias de navegación
  // (ej. "?prevCtxLbl=...&prevCtxUrl=..." vs "?notice=..." limpio) pero el
  // MISMO notice → es el mismo proceso real, nunca un conflicto genuino.
  if (esUrlSecop(procesoLink, 'S2') && esUrlSecop(solicitudLink, 'S2')) {
    const noticeProceso = extraerNotice(procesoLink);
    const noticeSolicitud = extraerNotice(solicitudLink);
    if (noticeProceso && noticeSolicitud && noticeProceso === noticeSolicitud) {
      return { accion: 'NO_HACER', razon: 'mismo_notice_secop_ii' };
    }
  }

  return { accion: 'CONFLICTO', razon: 'proceso_ya_tiene_link_distinto' };
}
