/**
 * Ajuste "HORAS EXTRAS POR JORNADA SEMANAL, NO POR DÍA" — guardas de cableado
 * de `jornadaFlexible` en page.tsx. El motor (derivar-distribucion-comercial.ts)
 * ya está probado aparte; aquí solo se protege que la bandera del cargo
 * llegue SIEMPRE al derivador: si una de las llamadas la omitiera, ese
 * cálculo (tarifa, interpretación, advertencia o resumen semanal) usaría la
 * jornada fija de 8h aunque el cargo tenga jornada flexible pactada, y las
 * cuatro pantallas dejarían de coincidir entre sí.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../../app/page.tsx'), 'utf-8');

describe('page.tsx — jornadaFlexible llega a todas las llamadas del derivador', () => {
  const llamadas = PAGE_TSX.match(/derivarDistribucionHorasComercialActivo\(\{[^}]*\}\)/g) ?? [];

  it('existen llamadas al derivador en page.tsx (la guarda no es vacía)', () => {
    expect(llamadas.length).toBeGreaterThan(0);
  });

  it('cada llamada pasa jornadaFlexible del cargo, con false como valor por defecto', () => {
    for (const llamada of llamadas) {
      expect(llamada).toContain('jornadaFlexible:l.jornadaFlexible??false');
    }
  });
});

describe('page.tsx — jornadaFlexible nace apagada y los borradores antiguos se completan en false', () => {
  it('un cargo nuevo de Mano de Obra se crea con jornadaFlexible:false', () => {
    expect(PAGE_TSX).toMatch(/incluyeFestivos:false,jornadaFlexible:false,diaDescansoObligatorio:'D'/);
  });

  it('un borrador guardado antes del campo se normaliza explícitamente a false al restaurarse', () => {
    expect(PAGE_TSX).toMatch(/jornadaFlexible:l\.jornadaFlexible\?\?false,/);
  });

  it('el modal del cargo expone el control "Jornada flexible pactada"', () => {
    expect(PAGE_TSX).toContain('Jornada flexible pactada');
  });
});
