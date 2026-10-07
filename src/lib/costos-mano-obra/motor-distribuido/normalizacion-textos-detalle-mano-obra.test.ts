/**
 * Normalización final de textos visibles — Detalle mensual de mano de
 * obra. Verificación de fuente (mismo patrón que texto-ui-mano-obra*.ts):
 * ningún cálculo, fórmula, motor, redondeo ni estructura de datos cambia
 * en este bloque, solo rótulos/jerarquía/presentación. Cubre las 12
 * pruebas obligatorias del bloque.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../../app/page.tsx'), 'utf-8');

describe('Normalización de textos — Detalle mensual de mano de obra', () => {
  it('1) aparece "Detalle mensual de mano de obra"', () => {
    expect(PAGE_TSX).toContain('Detalle mensual de mano de obra');
  });

  it('2) aparece "CARGO" como encabezado de la tabla principal', () => {
    expect(PAGE_TSX).toContain("['CARGO','']");
  });

  it('3) aparece "CANT. TRABAJADORES"', () => {
    expect(PAGE_TSX).toContain('CANT. TRABAJADORES');
  });

  it('4) aparece "COSTO LABORAL MENSUAL/TRAB."', () => {
    expect(PAGE_TSX).toContain('COSTO LABORAL MENSUAL/TRAB.');
  });

  it('5) aparece "Subtotal salarial mensual" (segregación por cargo: ya no lleva "por trabajador", cada panel es de un cargo específico)', () => {
    expect(PAGE_TSX).toContain('Subtotal salarial mensual:');
  });

  it('6) no aparece "Tarifa mensual por trabajador" en ningún texto visible', () => {
    expect(PAGE_TSX).not.toContain('>Tarifa mensual por trabajador');
  });

  // Ajuste "quita esto de acá" / "quita lo otro" — la fila de pie "TOTAL
  // RECARGOS Y HORAS EXTRAS" (RECARGOS Y HORAS EXTRAS MENSUALES — DETALLE
  // POR CONCEPTO) se retiró por redundante: el total ya está en la
  // columna "Costo mensual" de cada fila.
  it('7) "TOTAL RECARGOS Y HORAS EXTRAS" ya no aparece — fila de pie redundante retirada', () => {
    expect(PAGE_TSX).not.toContain('TOTAL RECARGOS Y HORAS EXTRAS');
  });

  it('8) aparece "TOTAL PRESTACIONES SOCIALES"', () => {
    expect(PAGE_TSX).toContain('TOTAL PRESTACIONES SOCIALES');
  });

  it('9) aparece "TOTAL SEGURIDAD SOCIAL"', () => {
    expect(PAGE_TSX).toContain('TOTAL SEGURIDAD SOCIAL');
  });

  it('10) aparece "TOTAL APORTES PARAFISCALES"', () => {
    expect(PAGE_TSX).toContain('TOTAL APORTES PARAFISCALES');
  });

  it('11) aparece el total de mano de obra en la pestaña Resultado (Tarifa del servicio), como "Mano de obra para el servicio"', () => {
    expect(PAGE_TSX).toContain('titulo="Mano de obra para el servicio" valor={rts.manoObra}');
  });

  it('12) "TOTAL MANO DE OBRA" ya no aparece en ninguna subtabla — solo quedan totales específicos por concepto', () => {
    expect(PAGE_TSX).not.toContain('TOTAL MANO DE OBRA');
  });

  it('adicional — "TOTAL TURNANTES" genérico ya no aparece; las subtablas de Turnantes usan el mismo total específico por concepto', () => {
    expect(PAGE_TSX).not.toContain('TOTAL TURNANTES');
  });

  it('adicional — el rótulo de Turnantes distingue "Costo mensual total de Turnantes" del total global del módulo', () => {
    expect(PAGE_TSX).toContain('Costo mensual total de Turnantes:');
  });

  it('adicional — "Aportes parafiscales mensuales" reemplaza a "Parafiscales mensuales" como título del panel', () => {
    expect(PAGE_TSX).toContain("label:'Aportes parafiscales mensuales'");
    expect(PAGE_TSX).not.toContain("label:'Parafiscales mensuales'");
  });

  it('adicional — "Recargos y horas extras mensuales" reemplaza a "Recargos y sobretiempo mensual" como rótulo de fila', () => {
    expect(PAGE_TSX).toContain('Recargos y horas extras mensuales:');
  });

  it('adicional — el título de detalle de recargos usa "RECARGOS Y HORAS EXTRAS MENSUALES — DETALLE POR CONCEPTO"', () => {
    expect(PAGE_TSX).toContain('RECARGOS Y HORAS EXTRAS MENSUALES — DETALLE POR CONCEPTO');
  });

  // Ajuste "NO MEZCLAR HORAS SEMANALES Y MENSUALES" (§2) — renombrado de
  // "HORAS PROMEDIO MENSUALES POR CONCEPTO" a "PROYECCIÓN MENSUAL DE
  // RECARGOS" (ver texto-ui-mano-obra-mensual.test.ts para el detalle).
  it('adicional — el título de horas usa "PROYECCIÓN MENSUAL DE RECARGOS"', () => {
    expect(PAGE_TSX).toContain('PROYECCIÓN MENSUAL DE RECARGOS');
  });

  it('ajuste UX — tarifaMensualLinea por cargo ya no se muestra en la tabla principal (a pedido del usuario); Resultado ahora muestra un RESUMEN por concepto (Mano de obra/Turnantes/Prestaciones/Seguridad social/Parafiscales/Otros costos), nunca el detalle técnico por línea con códigos como TURNANTE-AUTO — esa auditoría fina sigue viviendo exclusivamente en la pestaña Mano de Obra', () => {
    const inicio = PAGE_TSX.indexOf('ETAPA FINAL D/E — tabla y rótulos 100% mensuales');
    const fin = PAGE_TSX.indexOf('La tarifa mensual total no incluye los cargos pendientes');
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).not.toContain('cop(d.financiero!.tarifaMensualLinea)');
    // el resumen de "Mano de obra para el servicio" en Resultado nunca
    // vuelve a mostrar `d.financiero!.tarifaMensualLinea` por cargo/turnante.
    expect(PAGE_TSX).not.toContain("{d.bloqueada?'Pendiente':cop(d.financiero!.tarifaMensualLinea)}");
  });

  it('adicional — "Otros costos mensuales" se mantiene sin cambios como título de panel', () => {
    expect(PAGE_TSX).toContain("label:'Otros costos mensuales'");
  });

  it('adicional — la subtabla de Otros costos usa "TOTAL OTROS COSTOS", nunca "TOTAL MANO DE OBRA"', () => {
    expect(PAGE_TSX).toContain('TOTAL OTROS COSTOS');
  });

  it('ajuste UX — ningún cálculo se movió: la columna COSTO LABORAL MENSUAL/TRAB. se retiró de la tabla principal, pero fin.tarifaMensualPorTrabajador del ensamblador sigue siendo la única fuente (alimenta construirResultadoLineaConOtrosCostos, nunca se recalcula en page.tsx)', () => {
    const inicio = PAGE_TSX.indexOf('ETAPA FINAL D/E — tabla y rótulos 100% mensuales');
    const fin = PAGE_TSX.indexOf('La tarifa mensual total no incluye los cargos pendientes');
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).not.toContain('cop(d.financiero!.tarifaMensualPorTrabajador)');
    expect(PAGE_TSX).toContain('const resultado=construirResultadoLineaConOtrosCostos(fin.tarifaMensualPorTrabajador,fin.tarifaMensualLinea,desglose);');
  });
});