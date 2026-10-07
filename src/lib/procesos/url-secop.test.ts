import { describe, it, expect } from 'vitest';
import { esUrlSecop, extraerNotice } from './url-secop';

// URLs SECOP reales, con los mismos dominios que ya soporta el proyecto.
const SECOP_II = 'https://www.secop.gov.co/CO1BusinessLine/Tendering/ContractNoticeView/Index?notice=CO1.NTC.10655536';
const SECOP_II_COMMUNITY = 'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.123';
const SECOP_I = 'https://www.contratos.gov.co/consultas/detalleProceso.do?numConstancia=99';
const PORTAL_ENTIDAD = 'https://convocatorias.cruzrojacolombiana.org:9443/form_dbo_Convocatorias_proveedores/';

describe('esUrlSecop — S2 / S1 son allowlist positiva de fragmentos SECOP', () => {
  it('1) URL SECOP válida existente → true', () => {
    expect(esUrlSecop(SECOP_II, 'S2')).toBe(true);
    expect(esUrlSecop(SECOP_II_COMMUNITY, 'S2')).toBe(true);
    expect(esUrlSecop(SECOP_I, 'S1')).toBe(true);
  });

  it('2) dominio que NO contiene ningún fragmento SECOP → false', () => {
    expect(esUrlSecop('https://foo.example.test/x', 'S2')).toBe(false);
    expect(esUrlSecop('https://foo.example.test/x', 'S1')).toBe(false);
  });

  it('3) fuente cruzada (S1 vs S2) → false', () => {
    expect(esUrlSecop(SECOP_I, 'S2')).toBe(false);
    expect(esUrlSecop(SECOP_II, 'S1')).toBe(false);
  });

  it('4) URL vacía / sin fragmento SECOP → false', () => {
    expect(esUrlSecop('', 'S2')).toBe(false);
    expect(esUrlSecop('no-es-una-url', 'S1')).toBe(false);
  });
});

describe('esUrlSecop — NC (URL http(s) bien formada)', () => {
  it('acepta cualquier URL http(s) bien formada (SECOP o portal de la entidad)', () => {
    expect(esUrlSecop(SECOP_II, 'NC')).toBe(true);
    expect(esUrlSecop(PORTAL_ENTIDAD, 'NC')).toBe(true);
    expect(esUrlSecop('http://otraentidad.gov.co/convocatorias/123', 'NC')).toBe(true);
  });

  it('rechaza cadenas que no son URL http(s) bien formada', () => {
    expect(esUrlSecop('no-es-una-url', 'NC')).toBe(false);
    expect(esUrlSecop('ftp://servidor-externo/detalle', 'NC')).toBe(false);
    expect(esUrlSecop('mailto:alguien@dominio.co', 'NC')).toBe(false);
    expect(esUrlSecop('http://x', 'NC')).toBe(false); // < 4 chars tras el esquema
    expect(esUrlSecop('', 'NC')).toBe(false);
  });
});

describe('esUrlSecop — alias no reconocido', () => {
  it('cualquier alias distinto de S1/S2/NC → false', () => {
    expect(esUrlSecop(SECOP_II, 'XX')).toBe(false);
    expect(esUrlSecop(SECOP_II, '')).toBe(false);
  });
});

describe('extraerNotice', () => {
  it('extrae ?notice= de una URL de SECOP II', () => {
    expect(extraerNotice(SECOP_II)).toBe('CO1.NTC.10655536');
  });
  it('extrae ?noticeUID= como alternativa', () => {
    expect(extraerNotice(SECOP_II_COMMUNITY)).toBe('CO1.NTC.123');
  });
  it('devuelve null si no hay notice', () => {
    expect(extraerNotice(SECOP_I)).toBeNull();
    expect(extraerNotice(null)).toBeNull();
    expect(extraerNotice('')).toBeNull();
  });
});
