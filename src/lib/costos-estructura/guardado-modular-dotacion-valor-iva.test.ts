/**
 * Ajuste "AÑADIR COLUMNAS VALOR SIN IVA / VALOR CON IVA (DOTACIÓN)" —
 * confirmado en vivo contra la API real (grupocolba.com/service/public/api/dotacion):
 * solo trae un campo `valor` (sin IVA discriminado). "Valor con IVA" es un
 * cálculo local (19%, tarifa general vigente en Colombia) — nunca un dato
 * inventado como si viniera de la fuente.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');

describe('Tabla del selector de Dotación — Valor sin IVA / Valor con IVA', () => {
  it('la constante IVA_COLOMBIA existe (19%, documentada como cálculo local, nunca dato de la API)', () => {
    expect(PAGE_TSX).toContain('const IVA_COLOMBIA=0.19;');
  });

  it('los encabezados son "VALOR SIN IVA" y "VALOR CON IVA" (nunca "VALOR VIGENTE" a secas)', () => {
    expect(PAGE_TSX).toContain('>VALOR SIN IVA</th>');
    expect(PAGE_TSX).toContain('>VALOR CON IVA</th>');
  });

  it('valorConIva se deriva de valorNum×(1+IVA_COLOMBIA), nunca un campo leído de la API', () => {
    expect(PAGE_TSX).toContain('const valorConIva=sinValor?0:valorNum*(1+IVA_COLOMBIA);');
  });

  it('sin valor vigente, la celda de IVA muestra "—" (nunca $0 ni NaN)', () => {
    expect(PAGE_TSX).toContain('{sinValor?\'—\':fmtV(valorConIva)}');
  });

  it('Cód. grupo, Código, Producto y Últ. compra siguen presentes en la misma tabla (no se perdió ninguna columna existente)', () => {
    const finIva = PAGE_TSX.indexOf('>VALOR CON IVA</th>');
    const inicioGrupo = PAGE_TSX.lastIndexOf('>CÓD. GRUPO</th>', finIva);
    const bloque = PAGE_TSX.slice(inicioGrupo, finIva + 300);
    expect(inicioGrupo).toBeGreaterThan(-1);
    expect(bloque).toContain('>CÓDIGO</th>');
    expect(bloque).toContain('>PRODUCTO</th>');
    expect(bloque).toContain('>ÚLT. COMPRA</th>');
  });
});
