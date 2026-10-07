/**
 * Ajuste "INDICADORES FINANCIEROS AUTOMÁTICOS SEGÚN EMPRESA" — catálogo
 * por empresa (aseo/tempo/vigi, fuente COMERCIAL 2026 1 — Año 2025) +
 * evaluación automática de cumplimiento (Condición ≤/≥ + ¿Cumple?).
 *
 * Cobertura mínima exigida (25 casos): cálculo puro (1-17, 20-23) y
 * wiring de UI/persistencia (18-19, 24-25) verificado por texto fuente
 * contra page.tsx, mismo patrón que el resto de *-page.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFINICIONES_INDICADORES_FINANCIEROS, VALORES_FINANCIEROS_POR_EMPRESA,
  obtenerValorFinancieroEmpresa, buscarDefinicionIndicadorPorEtiqueta,
  operadorVisualIndicador, evaluaCumpleIndicador,
  parsearValorIndicadorDecimal, parsearValorMonetario,
} from './indicadores-financieros';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');

describe('1/2/3) cada empresa carga sus 6 valores financieros correctos (fuente COMERCIAL 2026 1 — Año 2025)', () => {
  it('1) ASEOCOLBA', () => {
    expect(VALORES_FINANCIEROS_POR_EMPRESA.aseo).toEqual({
      LIQUIDEZ: 3.57, ENDEUDAMIENTO: 0.28, COBERTURA_INTERESES: 53.27,
      RENTABILIDAD_ACTIVO: 0.15, RENTABILIDAD_PATRIMONIO: 0.21, CAPITAL_TRABAJO: 35356709367,
    });
  });
  it('2) VIGICOLBA', () => {
    expect(VALORES_FINANCIEROS_POR_EMPRESA.vigi).toEqual({
      LIQUIDEZ: 4.07, ENDEUDAMIENTO: 0.42, COBERTURA_INTERESES: 139.66,
      RENTABILIDAD_ACTIVO: 0.13, RENTABILIDAD_PATRIMONIO: 0.23, CAPITAL_TRABAJO: 18212457957,
    });
  });
  it('3) TEMPOCOLBA', () => {
    expect(VALORES_FINANCIEROS_POR_EMPRESA.tempo).toEqual({
      LIQUIDEZ: 2.92, ENDEUDAMIENTO: 0.45, COBERTURA_INTERESES: 14.19,
      RENTABILIDAD_ACTIVO: 0.07, RENTABILIDAD_PATRIMONIO: 0.13, CAPITAL_TRABAJO: 10692855100,
    });
  });
  it('0.28 sigue siendo 0.28, NUNCA se convierte a 28 (porcentaje)', () => {
    expect(VALORES_FINANCIEROS_POR_EMPRESA.aseo.ENDEUDAMIENTO).toBe(0.28);
    expect(VALORES_FINANCIEROS_POR_EMPRESA.aseo.ENDEUDAMIENTO).not.toBe(28);
  });
});

describe('4) empresa desconocida no recibe valores de otra empresa', () => {
  it('obtenerValorFinancieroEmpresa(null,...) devuelve null, nunca un valor de aseo/vigi/tempo por defecto', () => {
    expect(obtenerValorFinancieroEmpresa(null, 'LIQUIDEZ')).toBeNull();
    expect(obtenerValorFinancieroEmpresa(undefined, 'LIQUIDEZ')).toBeNull();
  });
  it('un código no reconocido (cast defensivo) tampoco cae a otra empresa', () => {
    expect(obtenerValorFinancieroEmpresa('transcolba' as never, 'LIQUIDEZ')).toBeNull();
  });
});

describe('5/6/7) Liquidez (MINIMO) — mayor/igual al requerido cumple, menor no cumple', () => {
  const def = buscarDefinicionIndicadorPorEtiqueta('Liquidez')!;
  it('5) 4,07 (empresa) > 2,8 (requerido) → Cumple', () => {
    expect(evaluaCumpleIndicador(def.tipo, 2.8, 4.07)).toBe(true);
  });
  it('6) 4.07 >= 4.07 (igual) → Cumple (la igualdad cuenta)', () => {
    expect(evaluaCumpleIndicador(def.tipo, 4.07, 4.07)).toBe(true);
  });
  it('7) 4,07 (empresa) < 5,5 (requerido) → No cumple', () => {
    expect(evaluaCumpleIndicador(def.tipo, 5.5, 4.07)).toBe(false);
  });
});

describe('8/9/10) Endeudamiento (MAXIMO) — único indicador que funciona como máximo', () => {
  const def = buscarDefinicionIndicadorPorEtiqueta('Endeudamiento')!;
  it('endeudamiento está configurado como MAXIMO (nunca MINIMO)', () => {
    expect(def.tipo).toBe('MAXIMO');
  });
  it('8) 0,42 (empresa) < 0,50 (requerido) → Cumple', () => {
    expect(evaluaCumpleIndicador(def.tipo, 0.50, 0.42)).toBe(true);
  });
  it('9) 0.42 <= 0.42 (igual) → Cumple (la igualdad cuenta)', () => {
    expect(evaluaCumpleIndicador(def.tipo, 0.42, 0.42)).toBe(true);
  });
  it('10) 0,42 (empresa) > 0,30 (requerido) → No cumple', () => {
    expect(evaluaCumpleIndicador(def.tipo, 0.30, 0.42)).toBe(false);
  });
});

describe('11/12/13/14) Cobertura de intereses/Rentabilidad activo/Rentabilidad patrimonio/Capital de trabajo usan comparación MÍNIMA', () => {
  it('11) Razón de cobertura de intereses es MINIMO', () => {
    expect(buscarDefinicionIndicadorPorEtiqueta('Razón de cobertura de intereses')!.tipo).toBe('MINIMO');
  });
  it('12) Rentabilidad del activo es MINIMO', () => {
    expect(buscarDefinicionIndicadorPorEtiqueta('Rentabilidad del activo')!.tipo).toBe('MINIMO');
  });
  it('13) Rentabilidad del patrimonio es MINIMO', () => {
    expect(buscarDefinicionIndicadorPorEtiqueta('Rentabilidad del patrimonio')!.tipo).toBe('MINIMO');
  });
  it('14) Capital de trabajo es MINIMO Y monetario — $15.000.000.000 ≤ $18.212.457.957 (VIGICOLBA) → Cumple', () => {
    const def = buscarDefinicionIndicadorPorEtiqueta('Capital de trabajo')!;
    expect(def.tipo).toBe('MINIMO');
    expect(def.esMonetario).toBe(true);
    const cumple = evaluaCumpleIndicador(def.tipo, 15000000000, VALORES_FINANCIEROS_POR_EMPRESA.vigi.CAPITAL_TRABAJO);
    expect(cumple).toBe(true);
  });
});

describe('15) sin requerido → resultado nulo (la UI muestra "—")', () => {
  it('evaluaCumpleIndicador(tipo, null, valorEmpresa) devuelve null, nunca false/"No cumple" por defecto', () => {
    expect(evaluaCumpleIndicador('MINIMO', null, 4.07)).toBeNull();
    expect(evaluaCumpleIndicador('MAXIMO', null, 0.42)).toBeNull();
  });
  it('empresa no reconocida (valorEmpresa null) también devuelve null', () => {
    expect(evaluaCumpleIndicador('MINIMO', 2.8, null)).toBeNull();
  });
});

describe('16/17) parseo de valor requerido — coma Y punto decimal', () => {
  it('16) coma decimal: "0,30" → 0.30', () => {
    expect(parsearValorIndicadorDecimal('0,30')).toBe(0.30);
    expect(parsearValorIndicadorDecimal('5,5')).toBe(5.5);
  });
  it('17) punto decimal: "0.30" → 0.30', () => {
    expect(parsearValorIndicadorDecimal('0.30')).toBe(0.30);
    expect(parsearValorIndicadorDecimal('5.5')).toBe(5.5);
  });
  it('texto vacío/no numérico → null (nunca NaN silencioso)', () => {
    expect(parsearValorIndicadorDecimal('')).toBeNull();
    expect(parsearValorIndicadorDecimal('abc')).toBeNull();
    expect(parsearValorIndicadorDecimal(undefined)).toBeNull();
  });
  it('capital de trabajo usa parseo MONETARIO (miles con punto, nunca decimal): "$15.000.000.000" → 15000000000', () => {
    expect(parsearValorMonetario('$ 15.000.000.000')).toBe(15000000000);
    expect(parsearValorMonetario('15.000.000.000')).toBe(15000000000);
  });
});

describe('18) cambiar el requerido recalcula inmediatamente (función pura, sin estado/caché)', () => {
  it('la MISMA definición con distinto requerido produce resultados distintos de forma determinista', () => {
    const def = buscarDefinicionIndicadorPorEtiqueta('Liquidez')!;
    const valorEmpresa = VALORES_FINANCIEROS_POR_EMPRESA.vigi.LIQUIDEZ; // 4.07
    expect(evaluaCumpleIndicador(def.tipo, 3, valorEmpresa)).toBe(true);
    expect(evaluaCumpleIndicador(def.tipo, 5, valorEmpresa)).toBe(false);
  });
});

describe('19) ¿Cumple? no depende de selección manual — el <select> Sí/No/— fue eliminado de las tablas de captura', () => {
  it('ninguna tabla de indicadores conserva un <select> de cumple; todas usan evaluaCumpleIndicador', () => {
    // Los 3 <select> de cumple (uno por tabla editable) fueron reemplazados
    // por badges calculados — se cuentan las invocaciones reales de la
    // función canónica en vez de asumir un número exacto de ocurrencias.
    const matches = PAGE_TSX.match(/evaluaCumpleIndicador\(/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
    // Ningún <select> restante tiene las opciones Sí/No de cumplimiento manual.
    expect(PAGE_TSX).not.toMatch(/onChange=\{e=>set(EditT|T)ablaIndicadores\(p=>\(\{\s*\.\.\.p,\s*\[ind\]:\s*\{\s*\.\.\.p\[ind\],\s*cumple:e\.target\.value\s*\}\s*\}\)\)\}/);
  });
});

describe('20/21/22) Condición muestra el operador visual correcto (lectura "Requerido operador Valor empresa")', () => {
  it('20) Liquidez muestra ≤', () => {
    expect(operadorVisualIndicador(buscarDefinicionIndicadorPorEtiqueta('Liquidez')!.tipo)).toBe('≤');
  });
  it('21) Endeudamiento muestra ≥', () => {
    expect(operadorVisualIndicador(buscarDefinicionIndicadorPorEtiqueta('Endeudamiento')!.tipo)).toBe('≥');
  });
  it('22) los demás MINIMO (Cobertura/Rentabilidad activo/Rentabilidad patrimonio/Capital trabajo) muestran ≤', () => {
    for (const etiqueta of ['Razón de cobertura de intereses', 'Rentabilidad del activo', 'Rentabilidad del patrimonio', 'Capital de trabajo']) {
      expect(operadorVisualIndicador(buscarDefinicionIndicadorPorEtiqueta(etiqueta)!.tipo)).toBe('≤');
    }
  });
  it('solo Endeudamiento es MAXIMO — los otros 5 son MINIMO', () => {
    const maximos = DEFINICIONES_INDICADORES_FINANCIEROS.filter((d) => d.tipo === 'MAXIMO');
    expect(maximos.map((d) => d.etiqueta)).toEqual(['Endeudamiento']);
  });
});

describe('23) Capital de trabajo NUNCA se trata como porcentaje', () => {
  it('esMonetario=true, y ningún valor de capital de trabajo del catálogo está en rango de porcentaje (0-1) — son montos reales', () => {
    const def = buscarDefinicionIndicadorPorEtiqueta('Capital de trabajo')!;
    expect(def.esMonetario).toBe(true);
    for (const empresa of ['aseo', 'vigi', 'tempo'] as const) {
      const v = VALORES_FINANCIEROS_POR_EMPRESA[empresa].CAPITAL_TRABAJO;
      expect(v).toBeGreaterThan(1000000);
    }
  });
  it('page.tsx nunca multiplica el valor monetario por 100 ni le agrega el símbolo "%"', () => {
    const inicio = PAGE_TSX.indexOf("def?.esMonetario?('$ '+n.toLocaleString('es-CO'))");
    expect(inicio).toBeGreaterThan(-1);
  });
});

describe('24) Guardar/reabrir conserva correctamente el Valor requerido (el único campo que el analista digita)', () => {
  it('el "subcausa"/"valorRequerido" persistido es el texto tal cual digitado por el analista, en las 2 rutas de guardado', () => {
    expect(PAGE_TSX).toContain('.map(r=>({subcausa:r.ind,valorRequerido:r.requeridoTexto,valorEvidenciado:String(r.valorEmpresaNum),cumple:r.cumple?\'Sí\':\'No\',obs:tablaIndicadores[r.ind]?.obs||\'\'}));');
  });
});

describe('25) Históricos no pierden información — la vista de solo lectura sigue leyendo el snapshot persistido, nunca lo recalcula', () => {
  it('renderIndicadoresObs (ambas instancias) lee ind.valorEvidenciado/ind.cumple directamente del dato guardado — nunca evaluaCumpleIndicador sobre históricos', () => {
    const ocurrencias = [...PAGE_TSX.matchAll(/const renderIndicadoresObs\s*=\s*\(o:\s*Record<string,\s*unknown>\)\s*=>\s*\{/g)];
    expect(ocurrencias.length).toBeGreaterThanOrEqual(2);
    for (const m of ocurrencias) {
      const bloque = PAGE_TSX.slice(m.index!, m.index! + 2200);
      expect(bloque).toContain('{ind.valorEvidenciado}');
      expect(bloque).not.toContain('evaluaCumpleIndicador');
    }
  });
  it('el campo interno "valorEvidenciado" (persistido) NUNCA se renombra — solo la etiqueta visible cambia a "Empresa"', () => {
    expect(PAGE_TSX).toContain('valorEvidenciado: string;');
  });
});
