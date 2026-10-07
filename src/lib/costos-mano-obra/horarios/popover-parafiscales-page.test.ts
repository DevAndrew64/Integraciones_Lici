/**
 * Ajuste "AJUSTE DE REDACCIÓN — POPOVER DE CAJA DE COMPENSACIÓN" —
 * pruebas de fuente (mismo patrón ya establecido: escanear page.tsx como
 * texto, sin jsdom/RTL) que confirman que el popover de Caja de
 * compensación/SENA/ICBF explica la composición real de la base (nunca
 * solo "Base: $X"), sin haber tocado ningún cálculo financiero.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../../app/page.tsx'), 'utf-8');

describe('IconoDetalleCalculoParafiscal — contenido explicativo de la base (nunca solo "Base: $X")', () => {
  it('el popover ya no muestra el formato viejo "Base: $X" para Caja/SENA/ICBF', () => {
    // El formato viejo (title=`${pct} · Base: ${base}`) fue retirado por
    // completo de las 3 celdas de parafiscales.
    expect(PAGE_TSX).not.toContain('title={dpf?`${ppCorto(dpf.porcentajeCaja)} · Base:');
    expect(PAGE_TSX).not.toContain('title={dpf?`${ppCorto(dpf.porcentajeSena)} · Base:');
    expect(PAGE_TSX).not.toContain('title={dpf?`${ppCorto(dpf.porcentajeIcbf)} · Base:');
  });

  it('el componente explica los 5 bloques exigidos: conceptos incluidos, concepto no incluido, base de cálculo, cálculo del aporte, valor mensual', () => {
    const inicio = PAGE_TSX.indexOf('function IconoDetalleCalculoParafiscal');
    const fin = PAGE_TSX.indexOf('function ', inicio + 10);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('Conceptos incluidos en la base:');
    expect(bloque).toContain('Concepto no incluido:');
    expect(bloque).toContain('Auxilio de transporte: no se incluye en esta base');
    expect(bloque).toContain('Base de cálculo:');
    expect(bloque).toContain('Cálculo del aporte:');
    expect(bloque).toContain('Valor mensual:');
  });

  it('la composición de la base nunca se recalcula en el popover — usa exactamente los mismos campos ya producidos por el ensamblador financiero (salarioBaseMensual, bonoPrestacionalMensual, recargosSobretiempoMensual, vacacionesMensuales)', () => {
    const inicio = PAGE_TSX.indexOf('function IconoDetalleCalculoParafiscal');
    const fin = PAGE_TSX.indexOf('function ', inicio + 10);
    const bloque = PAGE_TSX.slice(inicio, fin);
    // Los "partes" que arman la base son parámetros recibidos, nunca
    // literales ni un recálculo local — mismos valores que se pasan desde
    // los call sites (d.financiero!.salarioBaseMensual, etc.).
    expect(bloque).toContain('salarioBase,bonoPrestacional,sobretiempos,vacaciones');
    expect(bloque).not.toContain('* 0.04');
    expect(bloque).not.toContain('*0.04');
  });

  it('Caja de compensación incluye vacaciones en su base; SENA e ICBF NO (vacaciones={null} en sus llamadas) — coherente con la fórmula real del ensamblador (baseCajaMensual = base + vacaciones; baseSena/baseIcbf = base sin vacaciones)', () => {
    expect(PAGE_TSX).toContain("IconoDetalleCalculoParafiscal clave={d.codigo+':caja'} etiqueta=\"Caja de compensación\" salarioBase={d.financiero!.salarioBaseMensual} bonoPrestacional={d.financiero!.bonoPrestacionalMensual} sobretiempos={d.financiero!.recargosSobretiempoMensual} vacaciones={d.financiero!.desglosePrestaciones.vacacionesMensuales}");
    expect(PAGE_TSX).toContain("IconoDetalleCalculoParafiscal clave={d.codigo+':sena'} etiqueta=\"SENA\" salarioBase={d.financiero!.salarioBaseMensual} bonoPrestacional={d.financiero!.bonoPrestacionalMensual} sobretiempos={d.financiero!.recargosSobretiempoMensual} vacaciones={null}");
    expect(PAGE_TSX).toContain("IconoDetalleCalculoParafiscal clave={d.codigo+':icbf'} etiqueta=\"ICBF\" salarioBase={d.financiero!.salarioBaseMensual} bonoPrestacional={d.financiero!.bonoPrestacionalMensual} sobretiempos={d.financiero!.recargosSobretiempoMensual} vacaciones={null}");
  });

  it('las 3 celdas (Caja/SENA/ICBF) usan IconoDetalleCalculoParafiscal, nunca el ícono genérico IconoDetalleCalculoBaseFactor (retirado de estas 3 celdas específicamente)', () => {
    const ocurrenciasCaja = (PAGE_TSX.match(/IconoDetalleCalculoParafiscal clave=\{d\.codigo\+':caja'\}/g) || []).length;
    const ocurrenciasSena = (PAGE_TSX.match(/IconoDetalleCalculoParafiscal clave=\{d\.codigo\+':sena'\}/g) || []).length;
    const ocurrenciasIcbf = (PAGE_TSX.match(/IconoDetalleCalculoParafiscal clave=\{d\.codigo\+':icbf'\}/g) || []).length;
    // 2 tablas mirror (lineasExtra + Turnantes) → 2 ocurrencias cada una.
    expect(ocurrenciasCaja).toBe(2);
    expect(ocurrenciasSena).toBe(2);
    expect(ocurrenciasIcbf).toBe(2);
    expect(PAGE_TSX).not.toContain("IconoDetalleCalculoBaseFactor clave={d.codigo+':caja'}");
    expect(PAGE_TSX).not.toContain("IconoDetalleCalculoBaseFactor clave={d.codigo+':sena'}");
    expect(PAGE_TSX).not.toContain("IconoDetalleCalculoBaseFactor clave={d.codigo+':icbf'}");
  });

  it('Cesantías/Prima/Vacaciones/Intereses/Salud/Pensión/ARL siguen usando el ícono genérico IconoDetalleCalculoBaseFactor (fuera de alcance de este ajuste, sin cambios)', () => {
    expect(PAGE_TSX).toContain("IconoDetalleCalculoBaseFactor clave={d.codigo+':cesantias'}");
    expect(PAGE_TSX).toContain("IconoDetalleCalculoBaseFactor clave={d.codigo+':prima'}");
    expect(PAGE_TSX).toContain("IconoDetalleCalculoBaseFactor clave={d.codigo+':vacaciones'}");
    expect(PAGE_TSX).toContain("IconoDetalleCalculoBaseFactor clave={d.codigo+':intCesantias'}");
    expect(PAGE_TSX).toContain("IconoDetalleCalculoBaseFactor clave={d.codigo+':salud'}");
    expect(PAGE_TSX).toContain("IconoDetalleCalculoBaseFactor clave={d.codigo+':pension'}");
    expect(PAGE_TSX).toContain("IconoDetalleCalculoBaseFactor clave={d.codigo+':arl'}");
  });
});