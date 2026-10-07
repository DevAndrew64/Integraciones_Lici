/**
 * Cierre definitivo — único método activo (COMERCIAL_30_DIAS), sin
 * selector, sin rama ejecutable del motor legal anualizado. Verificación
 * de fuente del wiring en page.tsx (no existe arnés de render). El
 * cálculo puro sigue cubierto en motor-comercial-30-dias.test.ts y
 * derivar-distribucion-comercial.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../../app/page.tsx'), 'utf-8');

describe('§15 pruebas 1-3 — sin selector ni textos de método en la UI', () => {
  it('1) no aparece ningún selector de método (<select> con metodoCalculoManoObra)', () => {
    expect(PAGE_TSX).not.toContain('<select value={metodoCalculoManoObra}');
    expect(PAGE_TSX).not.toContain('setMetodoCalculoManoObra');
  });

  it('2) no aparece "Método comercial de promedios mensuales" en la UI (ni como opción ni como título visible)', () => {
    expect(PAGE_TSX).not.toContain('Método comercial de promedios mensuales');
  });

  it('3) no aparece "Método legal anualizado" en la UI', () => {
    expect(PAGE_TSX).not.toContain('Método legal anualizado');
    expect(PAGE_TSX).not.toContain('option value="LEGAL_ANUALIZADO"');
  });

  it('tampoco aparecen textos genéricos de motor/metodología visibles al usuario', () => {
    expect(PAGE_TSX).not.toContain('Motor activo');
    expect(PAGE_TSX).not.toContain('Promedios de 30 días');
  });
});

describe('§15 pruebas 4/12/13 — único constructor, sin condición ejecutable entre motores', () => {
  it('4) todo costeo (nuevo o restaurado) usa automáticamente COMERCIAL_30_DIAS — constante fija, no una elección persistida por el usuario', () => {
    expect(PAGE_TSX).toContain("const METODO_MANO_OBRA_ACTIVO:MetodoCalculoManoObra='COMERCIAL_30_DIAS';");
  });

  it('12) no existen imports del motor anualizado (adaptador-cargo-tarifa-mensual, linea-calculada-mensual con construirLineaCalculadaMensual) desde page.tsx', () => {
    expect(PAGE_TSX).not.toContain("from '@/lib/costos-mano-obra/motor-distribuido/adaptador-cargo-tarifa-mensual'");
    expect(PAGE_TSX).not.toContain("import { construirLineaCalculadaMensual }");
  });

  it('13) no existe selección condicional entre motores — construirCalculadaLinea llama siempre y únicamente al constructor comercial', () => {
    const inicio = PAGE_TSX.indexOf('const construirCalculadaLinea=React.useCallback');
    const fin = PAGE_TSX.indexOf('},[conAux,auxValor,parametrosFinancierosResueltos]);', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).not.toContain("if(metodoCalculoManoObra==='COMERCIAL_30_DIAS')");
    expect(bloque).not.toContain("metodoCalculoManoObra==='LEGAL_ANUALIZADO'");
    // Ajuste "ÚLTIMO ENDURECIMIENTO — IMPEDIR EJECUCIÓN ACTIVA DE 24,08" —
    // page.tsx (único caller activo) usa ahora el punto de entrada
    // fail-closed `derivarDistribucionHorasComercialActivo`, nunca la
    // función base directamente.
    expect(bloque).toContain('derivarDistribucionHorasComercialActivo(');
    expect(bloque).toContain('construirLineaCalculadaMensualComercial30Dias(');
  });
});

describe('§15 pruebas 5/9 — comportamiento con horario estructurado, siempre obligatorio', () => {
  it('9) horario obligatorio en el único método activo — un cargo nunca puede guardarse "Sin programación"', () => {
    expect(PAGE_TSX).toContain("if(distribucionesActuales.length===0)camposFaltantes.push('Horario');");
    expect(PAGE_TSX).not.toContain("if(metodoCalculoManoObra==='LEGAL_ANUALIZADO'&&distribucionesActuales.length===0)");
  });

  it('la sección manual "Horas diarias" fue retirada por completo — no aparece en ningún punto del modal', () => {
    expect(PAGE_TSX).not.toContain('HORAS DIARIAS');
    expect(PAGE_TSX).not.toContain('vDistribucionComercial');
    expect(PAGE_TSX).not.toContain('setVDistribucionComercial');
  });
});

describe('§15 pruebas 10/11 — Titulares y Turnantes comparten el mismo motor comercial', () => {
  it('10/11) ambos useMemo (lineasExtra y cargosTurnantes) usan construirCalculadaLinea — el mismo constructor comercial, sin selección separada por pestaña', () => {
    const ocurrencias = (PAGE_TSX.match(/calculada:construirCalculadaLinea\(l\),/g) || []).length;
    expect(ocurrencias).toBe(2);
  });
});

describe('persistencia — dato fijo de trazabilidad interna, nunca editable', () => {
  it('metodoCalculoManoObra:METODO_MANO_OBRA_ACTIVO viaja en buildDraftData', () => {
    const inicio = PAGE_TSX.indexOf('const buildDraftData=()=>({');
    const fin = PAGE_TSX.indexOf('});', inicio);
    expect(PAGE_TSX.slice(inicio, fin)).toContain('metodoCalculoManoObra:METODO_MANO_OBRA_ACTIVO,');
  });

  it('metodoCalculoManoObra:METODO_MANO_OBRA_ACTIVO viaja en el payload de guardarCosteo', () => {
    const inicio = PAGE_TSX.indexOf('async function guardarCosteo()');
    const finDatos = PAGE_TSX.indexOf('};', PAGE_TSX.indexOf('const datos={', inicio));
    expect(PAGE_TSX.slice(inicio, finDatos)).toContain('metodoCalculoManoObra:METODO_MANO_OBRA_ACTIVO,');
  });

  it('aplicarDatosGuardados ya no restaura ni lee metodoCalculoManoObra — cualquier costeo (con o sin la propiedad, comercial o histórico legal) se recalcula siempre con el único motor activo al abrirse', () => {
    const inicio = PAGE_TSX.indexOf('function aplicarDatosGuardados(');
    const fin = PAGE_TSX.indexOf('function ', inicio + 10);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).not.toContain('setMetodoCalculoManoObra');
  });
});

describe('captura por línea — horas por concepto derivadas, nunca digitadas', () => {
  it('no existen inputs de horas por concepto en el modal (los 8 campos manuales fueron retirados)', () => {
    expect(PAGE_TSX).not.toContain("['horasOrdinariasDiaOrdinario','Horas ordinarias']");
    expect(PAGE_TSX).not.toContain('Días ordinarios</div>');
    expect(PAGE_TSX).not.toContain('Domingos y festivos</div>');
  });

  it('24,08 y 5,92 nunca aparecen como valores editables en la UI de page.tsx', () => {
    expect(PAGE_TSX).not.toContain('value={24.08}');
    expect(PAGE_TSX).not.toContain('defaultValue={24.08}');
    expect(PAGE_TSX).not.toContain('value={5.92}');
    expect(PAGE_TSX).not.toContain('defaultValue={5.92}');
  });
});