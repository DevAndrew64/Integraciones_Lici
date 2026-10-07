/**
 * Ajuste "BACKFILL PREVENTIVO SOLICITUD → PROCESO" — pruebas de la función
 * pura `decidirBackfillLinkProceso`. Casos 1-10 del diseño aprobado.
 */
import { describe, it, expect } from 'vitest';
import { decidirBackfillLinkProceso } from './decidir-backfill-link-proceso';

const SECOP_II_A = 'https://www.secop.gov.co/CO1BusinessLine/Tendering/ContractNoticeView/Index?notice=CO1.NTC.10655536';
const SECOP_II_A_CON_NAVEGACION = 'https://www.secop.gov.co/CO1BusinessLine/Tendering/ContractNoticeView/Index?prevCtxLbl=Buscar+procesos&prevCtxUrl=https%3a%2f%2fwww.secop.gov.co%3a443%2fCO1BusinessLine%2fTendering%2fContractNoticeManagement%2fIndex&notice=CO1.NTC.10655536';
const SECOP_II_B = 'https://www.secop.gov.co/CO1BusinessLine/Tendering/ContractNoticeView/Index?notice=CO1.NTC.99999999';
const PORTAL_PRIVADO = 'https://convocatorias.cruzrojacolombiana.org:9443/form_dbo_Convocatorias_proveedores/';

describe('decidirBackfillLinkProceso', () => {
  it('1) proceso vacío + solicitud con link SECOP II válido → COPIAR', () => {
    const r = decidirBackfillLinkProceso({ procesoLinkDetalle: null, solicitudLinkDetalle: SECOP_II_A });
    expect(r.accion).toBe('COPIAR');
  });

  it('2) proceso vacío + solicitud con portal privado válido → COPIAR (linkDetalle no es exclusivo SECOP)', () => {
    const r = decidirBackfillLinkProceso({ procesoLinkDetalle: '', solicitudLinkDetalle: PORTAL_PRIVADO });
    expect(r.accion).toBe('COPIAR');
  });

  it('3) solicitud sin link → NO_HACER', () => {
    const r = decidirBackfillLinkProceso({ procesoLinkDetalle: null, solicitudLinkDetalle: null });
    expect(r).toEqual({ accion: 'NO_HACER', razon: 'solicitud_sin_link' });
  });

  it('4) solicitud con URL inválida/basura (sin esquema, o esquema no http(s)) → NO_HACER', () => {
    const r1 = decidirBackfillLinkProceso({ procesoLinkDetalle: null, solicitudLinkDetalle: 'no-es-una-url' });
    const r2 = decidirBackfillLinkProceso({ procesoLinkDetalle: null, solicitudLinkDetalle: 'ftp://servidor-externo/detalle-contrato' });
    expect(r1.accion).toBe('NO_HACER');
    expect(r2.accion).toBe('NO_HACER');
  });

  it('5) proceso con el mismo link exacto que la solicitud → NO_HACER (ya coincide)', () => {
    const r = decidirBackfillLinkProceso({ procesoLinkDetalle: PORTAL_PRIVADO, solicitudLinkDetalle: PORTAL_PRIVADO });
    expect(r).toEqual({ accion: 'NO_HACER', razon: 'ya_coincide' });
  });

  it('6) proceso con link diferente (portal privado vs portal privado distinto) → CONFLICTO, nunca sobrescribe', () => {
    const r = decidirBackfillLinkProceso({ procesoLinkDetalle: PORTAL_PRIVADO, solicitudLinkDetalle: 'https://otraentidad.com/convocatorias/123' });
    expect(r.accion).toBe('CONFLICTO');
  });

  it('7) ambas SECOP II con el MISMO notice pero URL con navegación distinta → NO_HACER, nunca conflicto', () => {
    const r = decidirBackfillLinkProceso({ procesoLinkDetalle: SECOP_II_A, solicitudLinkDetalle: SECOP_II_A_CON_NAVEGACION });
    expect(r).toEqual({ accion: 'NO_HACER', razon: 'mismo_notice_secop_ii' });
  });

  it('8) ambas SECOP II con notice DIFERENTE → CONFLICTO', () => {
    const r = decidirBackfillLinkProceso({ procesoLinkDetalle: SECOP_II_A, solicitudLinkDetalle: SECOP_II_B });
    expect(r).toEqual({ accion: 'CONFLICTO', razon: 'proceso_ya_tiene_link_distinto' });
  });

  it('9) proceso con SECOP II, solicitud con portal privado (fuentes incompatibles) → CONFLICTO', () => {
    const r = decidirBackfillLinkProceso({ procesoLinkDetalle: SECOP_II_A, solicitudLinkDetalle: PORTAL_PRIVADO });
    expect(r.accion).toBe('CONFLICTO');
  });

  it('10) solo espacios externos se recortan — nunca se reconstruye la URL', () => {
    const r = decidirBackfillLinkProceso({ procesoLinkDetalle: null, solicitudLinkDetalle: `  ${SECOP_II_A}  ` });
    expect(r.accion).toBe('COPIAR');
  });
});
