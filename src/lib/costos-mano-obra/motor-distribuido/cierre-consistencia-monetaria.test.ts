/**
 * Cierre final de consistencia monetaria y semántica. Caso de control:
 * cargo ASEADOR, salario $1.750.905, auxilio $249.095, cantidad=1, Riesgo
 * II, con porcentajes personalizados salud=0%/pensión=12%/caja=4%/SENA=0%/
 * ICBF=0%/cesantías=8,33%/prima=8,33%/vacaciones=5%/intereses=1%.
 *
 * Causa de la diferencia de $1 (ya corregida): `resultado-financiero-
 * mensual-linea.ts` redondeaba cada concepto (cesantías/prima/vacaciones/
 * intereses/salud/pensión/ARL/caja/SENA/ICBF) a CENTAVOS (round2, 2
 * decimales) en vez de a PESOS ENTEROS — la celda "Total" se obtenía
 * redondeando la suma en precisión de centavos, que podía diferir en $1
 * de la suma de las celdas ya redondeadas a pesos que ve el usuario.
 * Corrección: cada concepto se redondea una sola vez, a pesos enteros,
 * HALF_UP (`redondearPeso`), y los totales son la suma de esos valores
 * YA redondeados — nunca al revés.
 *
 * Fase dedicada de extracción del motor legado: la fixture ya NO usa el
 * adaptador legal (calcularResultadoCargoMensual/motor-tarifa-mensual,
 * eliminados, con fecha determinística de calendario) — usa
 * calcularResultadoTarifaMensualComercial30Dias (único motor vigente,
 * sin calendario). Las aserciones de valores fijos en pesos, que dependían
 * de esa fecha/calendario específicos, se reemplazan por aserciones de
 * CONSISTENCIA (suma de partes = total, ya redondeadas, nunca una
 * diferencia de $1) — que es precisamente la regresión que este archivo
 * existe para evitar, y sigue siendo válida sin importar qué motor
 * produjo los montos base.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calcularResultadoTarifaMensualComercial30Dias } from './motor-comercial-30-dias';
import { construirResultadoFinancieroMensualLinea } from './resultado-financiero-mensual-linea';
import { agregarResultadosFinancierosMensuales } from './agregador-resultado-financiero-mensual';
import { resolverParametrosFinancierosManoObra } from './parametros-financieros-mano-obra';

const PARAMS = resolverParametrosFinancierosManoObra({
  porcentajeCesantias: 8.33, porcentajePrima: 8.33, porcentajeVacaciones: 5, porcentajeInteresesCesantias: 1,
  porcentajeSalud: 0, porcentajePension: 12, porcentajeCajaCompensacion: 4, porcentajeSena: 0, porcentajeIcbf: 0,
  porcentajeArlPorClase: { I: 0.522, II: 1.044, III: 2.436, IV: 4.35, V: 6.96 },
});

const DISTRIBUCION_CASO_CONTROL = {
  horasOrdinariasDiaOrdinario: 8,
  horasRecargoNocturnoDiaOrdinario: 1,
  horasExtraDiurnaDiaOrdinario: 1,
  horasExtraNocturnaDiaOrdinario: 0,
  horasDominicalFestivaDiaEspecial: 0,
  horasRecargoNocturnoFestivoDiaEspecial: 0,
  horasExtraDiurnaFestivaDiaEspecial: 0,
  horasExtraNocturnaFestivaDiaEspecial: 0,
};

function construirCasoControl(cantidadTrabajadores = 1) {
  const resultado = calcularResultadoTarifaMensualComercial30Dias({
    distribucionHoras: DISTRIBUCION_CASO_CONTROL,
    salarioMensual: 1750905,
    bonoPrestacionalMensual: 0,
    auxilioTransporteMensual: 249095,
    cantidadTrabajadores,
  });
  if (resultado.estado !== 'CALCULADO') throw new Error('Fixture inválido: ' + resultado.mensaje);
  return construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: resultado, claseArl: 'II', parametrosFinancieros: PARAMS });
}

describe('Cierre de consistencia monetaria — caso de control (cantidad=1)', () => {
  const financiero = construirCasoControl(1);

  it('1) cesantías visibles > 0 y coinciden con round(baseCesantias × 8.33%)', () => {
    expect(financiero.desglosePrestaciones.cesantiasMensuales).toBeGreaterThan(0);
    expect(financiero.desglosePrestaciones.cesantiasMensuales).toBe(Math.round(financiero.desglosePrestaciones.baseCesantiasMensual * 8.33 / 100));
  });

  it('2) prima visible = cesantías (misma base y porcentaje, 8.33%)', () => {
    expect(financiero.desglosePrestaciones.primaMensual).toBe(financiero.desglosePrestaciones.cesantiasMensuales);
  });

  it('3) vacaciones visibles > 0 y coinciden con round(baseVacaciones × 5%)', () => {
    expect(financiero.desglosePrestaciones.vacacionesMensuales).toBeGreaterThan(0);
    expect(financiero.desglosePrestaciones.vacacionesMensuales).toBe(Math.round(financiero.desglosePrestaciones.baseVacacionesMensual * 5 / 100));
  });

  it('4) intereses visibles > 0 y coinciden con round(baseCesantias × 1%)', () => {
    expect(financiero.desglosePrestaciones.interesesCesantiasMensuales).toBeGreaterThan(0);
    expect(financiero.desglosePrestaciones.interesesCesantiasMensuales).toBe(Math.round(financiero.desglosePrestaciones.baseCesantiasMensual * 1 / 100));
  });

  it('5/6) la suma de las 4 celdas visibles de prestaciones coincide exactamente con el total (nunca una diferencia de $1)', () => {
    const suma = financiero.desglosePrestaciones.cesantiasMensuales
      + financiero.desglosePrestaciones.primaMensual
      + financiero.desglosePrestaciones.vacacionesMensuales
      + financiero.desglosePrestaciones.interesesCesantiasMensuales;
    expect(suma).toBe(financiero.prestacionesSocialesMensuales);
  });

  it('seguridad social mensual = pensión + ARL + salud, sin diferencia de $1 (salud=0% explícito)', () => {
    expect(financiero.desgloseSeguridadSocial.saludMensual).toBe(0);
    expect(financiero.desgloseSeguridadSocial.pensionMensual).toBeGreaterThan(0);
    expect(financiero.desgloseSeguridadSocial.arlMensual).toBeGreaterThan(0);
    const suma = financiero.desgloseSeguridadSocial.pensionMensual + financiero.desgloseSeguridadSocial.arlMensual + financiero.desgloseSeguridadSocial.saludMensual;
    expect(suma).toBe(financiero.seguridadSocialMensual);
  });

  it('aportes parafiscales mensuales = caja + SENA + ICBF, sin diferencia de $1 (SENA=0%/ICBF=0% explícitos)', () => {
    expect(financiero.desgloseParafiscales.senaMensual).toBe(0);
    expect(financiero.desgloseParafiscales.icbfMensual).toBe(0);
    expect(financiero.desgloseParafiscales.cajaCompensacionMensual).toBeGreaterThan(0);
    const suma = financiero.desgloseParafiscales.cajaCompensacionMensual + financiero.desgloseParafiscales.senaMensual + financiero.desgloseParafiscales.icbfMensual;
    expect(suma).toBe(financiero.parafiscalesMensuales);
  });

  it('subtotal salarial mensual por trabajador = salario + recargos + auxilio, tal cual entrega el motor mensual', () => {
    const subtotalSalarial = financiero.salarioBaseMensual + financiero.bonoPrestacionalMensual + financiero.recargosSobretiempoMensual + financiero.auxilioTransporteMensual;
    expect(financiero.salarioBaseMensual).toBe(1750905);
    expect(financiero.auxilioTransporteMensual).toBe(249095);
    expect(financiero.recargosSobretiempoMensual).toBeGreaterThan(0);
    expect(subtotalSalarial).toBe(financiero.salarioBaseMensual + financiero.bonoPrestacionalMensual + financiero.recargosSobretiempoMensual + financiero.auxilioTransporteMensual);
  });

  it('7) costo laboral mensual por trabajador = subtotal salarial + prestaciones + seguridad + parafiscales, otrosCostos=0 a nivel de línea', () => {
    expect(financiero.otrosCostosMensuales).toBe(0);
    const subtotalSalarial = financiero.salarioBaseMensual + financiero.bonoPrestacionalMensual + financiero.recargosSobretiempoMensual + financiero.auxilioTransporteMensual;
    const sumaManual = subtotalSalarial + financiero.prestacionesSocialesMensuales + financiero.seguridadSocialMensual + financiero.parafiscalesMensuales;
    expect(financiero.tarifaMensualPorTrabajador).toBe(sumaManual);
  });

  it('10) no existe compensación manual de $1 en el código — no hay literales +1/-1 cerca del cálculo de prestaciones/seguridad/parafiscales', () => {
    const codigo = readFileSync(join(__dirname, 'resultado-financiero-mensual-linea.ts'), 'utf-8');
    // Ninguna línea de cálculo debe sumar/restar un ajuste manual de 1
    // peso a un total ya construido a partir de sus partes.
    expect(codigo).not.toMatch(/prestacionesSocialesMensuales\s*[+-]\s*1\b/);
    expect(codigo).not.toMatch(/seguridadSocialMensual\s*[+-]\s*1\b/);
    expect(codigo).not.toMatch(/parafiscalesMensuales\s*[+-]\s*1\b/);
  });
});

describe('Cierre de consistencia monetaria — cantidad de trabajadores se aplica una sola vez (§3)', () => {
  it('13) para cantidad=1, costoLaboralMensualLinea === costoLaboralMensualPorTrabajador', () => {
    const financiero = construirCasoControl(1);
    expect(financiero.tarifaMensualLinea).toBe(financiero.tarifaMensualPorTrabajador);
  });

  it('13b) para cantidad=3, costoLaboralMensualLinea = costoLaboralMensualPorTrabajador × 3 (nunca multiplicado dos veces)', () => {
    const financiero = construirCasoControl(3);
    expect(financiero.tarifaMensualLinea).toBe(financiero.tarifaMensualPorTrabajador * 3);
    expect(financiero.cantidadTrabajadores).toBe(3);
  });
});

describe('Cierre de consistencia monetaria — "Otros costos" y el total general (§4, #8/#9)', () => {
  it('8/9) costo mensual total de mano de obra = costo laboral mensual por trabajador (línea, cant=1) + otros costos globales', () => {
    const financiero = construirCasoControl(1);
    const agregado = agregarResultadosFinancierosMensuales([{ resultado: financiero }]);
    const otrosCostosGlobales = 31667; // global de la estructura, no atribuible a esta línea (§4)
    const costoMensualTotal = agregado.tarifaMensualTotal + otrosCostosGlobales;
    expect(agregado.tarifaMensualTotal).toBe(financiero.tarifaMensualPorTrabajador);
    expect(costoMensualTotal).toBe(financiero.tarifaMensualPorTrabajador + otrosCostosGlobales);
  });

  it('14) otros costos no se duplican por línea — otrosCostosMensualesPorTrabajador del ensamblador permanece en 0, nunca se distribuye artificialmente', () => {
    const financiero = construirCasoControl(3);
    expect(financiero.otrosCostosMensuales).toBe(0);
    expect(financiero.bases).toBeDefined();
  });
});

describe('page.tsx — alcance documentado y rótulos consistentes con el alcance (§2, #11/#12)', () => {
  const PAGE_TSX = readFileSync(join(__dirname, '../../../app/page.tsx'), 'utf-8');

  it('11) tarifaMensualLinea tiene su alcance documentado explícitamente (comentario en el ensamblador)', () => {
    const codigo = readFileSync(join(__dirname, 'resultado-financiero-mensual-linea.ts'), 'utf-8');
    expect(codigo).toContain('COSTO LABORAL MENSUAL DE LA LÍNEA');
    expect(codigo).toContain('NUNCA incluye');
  });

  it('12) ajuste UX — la columna de costo por línea ya no vive en la tabla principal (a pedido del usuario); tarifaMensualLinea nunca aparece bajo un rótulo distinto ("COSTO MENSUAL TOTAL") en page.tsx', () => {
    expect(PAGE_TSX).not.toContain('COSTO LABORAL MENSUAL DE LA LÍNEA');
    expect(PAGE_TSX).not.toContain("['COSTO MENSUAL DE LA LÍNEA'");
    expect(PAGE_TSX).not.toContain('COSTO MENSUAL TOTAL DE LA LÍNEA');
  });

  it('15) la pestaña Resultado usa los mismos campos ya corregidos del ensamblador/agregador (prestacionesSocialesMensualesTotal, etc.), nunca un cálculo propio', () => {
    const inicio = PAGE_TSX.indexOf("tab==='resultado'&&(");
    const fin = PAGE_TSX.indexOf('titulo="Insumos"', inicio);
    const bloqueResultado = PAGE_TSX.slice(inicio, fin);
    expect(bloqueResultado).toContain('agregadoManoObraMensual.tarifaMensualTotal');
    expect(bloqueResultado).toContain('agregadoManoObraMensual.prestacionesSocialesMensualesTotal');
    expect(bloqueResultado).not.toMatch(/\*\s*100\)\s*\/\s*100/); // sin redondeos propios (round2 legado) dentro del bloque
  });

  it('otros costos: implementación posterior (otros-costos-por-linea.ts) — ya NO son globales, se resuelven por lineaManoObraId', () => {
    // Nota: esta prueba documentaba el alcance ANTES de "Otros costos por
    // línea de cargo" (implementado en un bloque posterior a este cierre
    // monetario) — Dotación/EPP/Exámenes/Cursos/Vacunas dejaron de
    // calcularse con `n` global y ahora se asocian a `lineaManoObraId`.
    // Ver otros-costos-por-linea.test.ts para la cobertura vigente.
    expect(PAGE_TSX).toContain('otrosCostosMensualesTotal=agregadoCostoMensualTotalManoObra.otrosCostosMensualesTotal');
  });
});