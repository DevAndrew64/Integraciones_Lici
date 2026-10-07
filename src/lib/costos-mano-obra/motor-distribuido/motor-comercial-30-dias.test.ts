/**
 * Metodología comercial parametrizada de 30 días (COMERCIAL_30_DIAS) —
 * pruebas obligatorias §16. Motor aislado del legal anualizado
 * (motor-tarifa-mensual.ts): este archivo de prueba nunca importa nada
 * de construir-semana/clasificar-segmentos/calendario-festivos-colombia,
 * confirmando por diseño que el resultado no depende del calendario real.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  calcularResultadoTarifaMensualComercial30Dias,
  construirLineaCalculadaMensualComercial30Dias,
  PARAMETROS_METODO_COMERCIAL_30_DIAS_DEFAULT,
  DISTRIBUCION_HORAS_METODO_COMERCIAL_VACIA,
  normalizarMetodoCalculoManoObra,
} from './motor-comercial-30-dias';

const CODIGO_MOTOR_COMERCIAL = readFileSync(join(__dirname, 'motor-comercial-30-dias.ts'), 'utf-8');
import type { DistribucionHorasMetodoComercial } from './motor-comercial-30-dias';
import type { ParametrosFinancierosManoObra } from './parametros-financieros-mano-obra';

const PARAMS_FINANCIEROS: ParametrosFinancierosManoObra = {
  porcentajeVacaciones: 5, porcentajeCesantias: 8.33, porcentajePrima: 8.33, porcentajeInteresesCesantias: 1,
  porcentajePension: 12, porcentajeArlPorClase: { I: 0.522, II: 1.044, III: 2.436, IV: 4.35, V: 6.96 },
  porcentajeSalud: 8.5, exoneradoSalud: true,
  porcentajeCajaCompensacion: 4, porcentajeSena: 2, exoneradoSena: true, porcentajeIcbf: 3, exoneradoIcbf: true,
  fuente: 'VALORES_PREDETERMINADOS',
};

describe('§16 pruebas 1-8 — parámetros y aislamiento del calendario', () => {
  it('1) el método COMERCIAL_30_DIAS existe (tipo, parámetros default y función de cálculo exportados)', () => {
    expect(PARAMETROS_METODO_COMERCIAL_30_DIAS_DEFAULT).toBeDefined();
    expect(typeof calcularResultadoTarifaMensualComercial30Dias).toBe('function');
  });

  it('2) está aislado de LEGAL_ANUALIZADO — el módulo no importa en tiempo de ejecución ni en tipos ningún archivo del motor anualizado', () => {
    const codigo = CODIGO_MOTOR_COMERCIAL;
    // Fase dedicada de extracción: ya ni siquiera como "import type" —
    // ConceptoMensual/ResultadoTarifaMensual/DetalleMetodologiaMensual
    // vienen del módulo neutral tipos-resultado-mensual.ts.
    expect(codigo).toContain("import type { ConceptoMensual, ResultadoTarifaMensual, DetalleMetodologiaMensual, DetalleCalculoConcepto } from './tipos-resultado-mensual';");
    expect(codigo).not.toContain("from './motor-tarifa-mensual'");
    expect(codigo).not.toContain("from './adaptador-cargo-tarifa-mensual'");
    expect(codigo).not.toContain("from './linea-calculada-mensual'");
    expect(codigo).not.toContain("from './construir-semana'");
    expect(codigo).not.toContain("from './clasificar-segmentos'");
    expect(codigo).not.toContain("from './calendario-festivos-colombia'");
    expect(codigo).not.toContain("from './perfil-mensual-anualizado'");
  });

  it('3) utiliza 24.08 para días ordinarios (parámetro default)', () => {
    expect(PARAMETROS_METODO_COMERCIAL_30_DIAS_DEFAULT.diasOrdinariosPromedioMes).toBe(24.08);
  });

  it('4) utiliza 5.92 para domingos/festivos (parámetro default)', () => {
    expect(PARAMETROS_METODO_COMERCIAL_30_DIAS_DEFAULT.domingosFestivosPromedioMes).toBe(5.92);
  });

  it('5) 24.08 + 5.92 = 30.00', () => {
    const suma = PARAMETROS_METODO_COMERCIAL_30_DIAS_DEFAULT.diasOrdinariosPromedioMes + PARAMETROS_METODO_COMERCIAL_30_DIAS_DEFAULT.domingosFestivosPromedioMes;
    expect(Math.round(suma * 100) / 100).toBe(30);
    expect(PARAMETROS_METODO_COMERCIAL_30_DIAS_DEFAULT.diasComercialesMes).toBe(30);
  });

  it('6/7) no utiliza calendario real ni materializa el año — el resultado es idéntico para cualquier fecha porque no recibe ninguna fecha de referencia', () => {
    const distribucion: DistribucionHorasMetodoComercial = { ...DISTRIBUCION_HORAS_METODO_COMERCIAL_VACIA, horasDominicalFestivaDiaEspecial: 7 };
    const r = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1 });
    // La función no acepta ningún parámetro de fecha — confirmado por el
    // tipo EntradaMetodoComercial30Dias (sin fechaVigenciaTarifa alguna);
    // el resultado depende solo de horas/salario/parámetros comerciales.
    expect(r.metodologia.anioVigencia).toBe(0);
    expect(r.metodologia.cantidadDomingosAnio).toBe(0);
    expect(r.metodologia.cantidadFestivosAnio).toBe(0);
  });

  it('8) no controla coincidencias domingo-festivo — el campo queda en 0, no aplica en este método', () => {
    const r = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: DISTRIBUCION_HORAS_METODO_COMERCIAL_VACIA, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1 });
    expect(r.metodologia.cantidadCoincidenciasDomingoFestivo).toBe(0);
  });
});

describe('cierre quirúrgico — LEGAL_ANUALIZADO retirado del tipo operativo (§1)', () => {
  it('MetodoCalculoManoObra ya no admite LEGAL_ANUALIZADO como valor — solo COMERCIAL_30_DIAS compila', () => {
    // @ts-expect-error — LEGAL_ANUALIZADO ya no es miembro del tipo activo.
    const invalido: import('./motor-comercial-30-dias').MetodoCalculoManoObra = 'LEGAL_ANUALIZADO';
    void invalido;
    const valido: import('./motor-comercial-30-dias').MetodoCalculoManoObra = 'COMERCIAL_30_DIAS';
    expect(valido).toBe('COMERCIAL_30_DIAS');
  });

  it('LEGAL_ANUALIZADO no aparece como miembro del tipo MetodoCalculoManoObra (solo puede sobrevivir en comentarios explicando la normalización histórica)', () => {
    expect(CODIGO_MOTOR_COMERCIAL).toContain("export type MetodoCalculoManoObra = 'COMERCIAL_30_DIAS';");
    expect(CODIGO_MOTOR_COMERCIAL).not.toMatch(/type MetodoCalculoManoObra\s*=\s*'LEGAL_ANUALIZADO'/);
    expect(CODIGO_MOTOR_COMERCIAL).not.toContain("'LEGAL_ANUALIZADO' | 'COMERCIAL_30_DIAS'");
  });

  it('normalizarMetodoCalculoManoObra: valor ausente (undefined) → COMERCIAL_30_DIAS', () => {
    expect(normalizarMetodoCalculoManoObra(undefined)).toBe('COMERCIAL_30_DIAS');
  });

  it('normalizarMetodoCalculoManoObra: valor ausente (null) → COMERCIAL_30_DIAS', () => {
    expect(normalizarMetodoCalculoManoObra(null)).toBe('COMERCIAL_30_DIAS');
  });

  it('normalizarMetodoCalculoManoObra: COMERCIAL_30_DIAS → COMERCIAL_30_DIAS', () => {
    expect(normalizarMetodoCalculoManoObra('COMERCIAL_30_DIAS')).toBe('COMERCIAL_30_DIAS');
  });

  it('normalizarMetodoCalculoManoObra: JSON histórico con LEGAL_ANUALIZADO se lee sin error → COMERCIAL_30_DIAS (nunca selecciona el motor legal)', () => {
    expect(normalizarMetodoCalculoManoObra('LEGAL_ANUALIZADO')).toBe('COMERCIAL_30_DIAS');
  });

  it('normalizarMetodoCalculoManoObra: cualquier valor desconocido → COMERCIAL_30_DIAS, sin lanzar', () => {
    expect(normalizarMetodoCalculoManoObra('valor-inexistente')).toBe('COMERCIAL_30_DIAS');
    expect(normalizarMetodoCalculoManoObra(123)).toBe('COMERCIAL_30_DIAS');
    expect(normalizarMetodoCalculoManoObra({})).toBe('COMERCIAL_30_DIAS');
    expect(normalizarMetodoCalculoManoObra([])).toBe('COMERCIAL_30_DIAS');
  });

  it('normalizarMetodoCalculoManoObra nunca introduce una rama condicional distinta por valor recibido (siempre retorna el mismo literal)', () => {
    const codigo = CODIGO_MOTOR_COMERCIAL;
    const inicio = codigo.indexOf('export function normalizarMetodoCalculoManoObra');
    const fin = codigo.indexOf('\n}', inicio);
    const cuerpo = codigo.slice(inicio, fin);
    expect(cuerpo).not.toContain('if(');
    expect(cuerpo).not.toContain('if (');
    expect(cuerpo).not.toContain('switch');
    expect(cuerpo).not.toContain('?');
  });
});

describe('§16 pruebas 9-19 — caso de control principal (OPERARIO DE ASEO)', () => {
  const distribucionCasoControl: DistribucionHorasMetodoComercial = {
    ...DISTRIBUCION_HORAS_METODO_COMERCIAL_VACIA,
    horasOrdinariasDiaOrdinario: 7,
    horasDominicalFestivaDiaEspecial: 7,
  };

  it('9) 7 × 5.92 = 41.44', () => {
    const r = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: distribucionCasoControl, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1 });
    const dominical = r.conceptos.find(c => c.concepto === 'ordinariaDominical')!;
    expect(dominical.horasMensualesPromedio).toBe(41.44);
  });

  it('10) el caso de control genera $656.473 en el concepto dominical/festivo', () => {
    const r = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: distribucionCasoControl, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1 });
    const dominical = r.conceptos.find(c => c.concepto === 'ordinariaDominical')!;
    expect(dominical.valorMensual).toBe(656473);
  });

  it('resultados esperados del caso de control: HED=0, HEDF=0, recargos nocturnos=0', () => {
    const r = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: distribucionCasoControl, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1 });
    expect(r.conceptos.find(c => c.concepto === 'extraDiurna')!.valorMensual).toBe(0);
    expect(r.conceptos.find(c => c.concepto === 'extraDiurnaFestiva')!.valorMensual).toBe(0);
    expect(r.conceptos.find(c => c.concepto === 'recargoNocturno')!.valorMensual).toBe(0);
    expect(r.conceptos.find(c => c.concepto === 'recargoNocturnoDominical')!.valorMensual).toBe(0);
  });

  it('15) el valor hora no se redondea prematuramente — 1.750.905/210 conserva su precisión completa hasta el redondeo final del concepto', () => {
    // Si se redondeara valorHora a 8.338 antes de calcular, el resultado
    // sería 41.44×8338×1.90=$656.559 (rechazado explícitamente) — el
    // resultado correcto exige precisión completa hasta el final.
    const r = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: distribucionCasoControl, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1 });
    const dominical = r.conceptos.find(c => c.concepto === 'ordinariaDominical')!;
    expect(dominical.valorMensual).not.toBe(656559);
    expect(dominical.valorMensual).toBe(656473);
  });

  it('16) dominical/festivo usa el factor completo 1.90 (nunca 0.90 — convención exclusiva del motor legal, no aplica aquí)', () => {
    const dominical = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: distribucionCasoControl, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1 }).conceptos.find(c => c.concepto === 'ordinariaDominical')!;
    expect(dominical.factor).toBe(1.90);
    expect(dominical.factorTipo).toBe('FACTOR_TOTAL');
  });

  it('17) HEDN (extra diurna normal) usa factor 1.25', () => {
    expect(PARAMETROS_METODO_COMERCIAL_30_DIAS_DEFAULT.factorHoraExtraDiurnaNormal).toBe(1.25);
  });

  it('18) HEDF (extra diurna festiva) usa factor 2.15', () => {
    expect(PARAMETROS_METODO_COMERCIAL_30_DIAS_DEFAULT.factorHoraExtraDiurnaFestiva).toBe(2.15);
  });

  it('19) el redondeo es HALF_UP por concepto — la suma de conceptos ya redondeados coincide exactamente con recargosSobretiempoMensual', () => {
    const r = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: distribucionCasoControl, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1 });
    const sumaConceptos = r.conceptos.reduce((s, c) => s + c.valorMensual, 0);
    expect(sumaConceptos).toBe(r.recargosSobretiempoMensual);
  });
});

describe('§16 pruebas 11-14 — casos A-E (horas extra)', () => {
  it('11/12) CASO A — 1 hora extra diurna en día ordinario genera 24.08 HEDN mensuales, nunca 21.08', () => {
    const dist: DistribucionHorasMetodoComercial = { ...DISTRIBUCION_HORAS_METODO_COMERCIAL_VACIA, horasExtraDiurnaDiaOrdinario: 1 };
    const r = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: dist, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1 });
    const hed = r.conceptos.find(c => c.concepto === 'extraDiurna')!;
    expect(hed.horasMensualesPromedio).toBe(24.08);
    expect(hed.horasMensualesPromedio).not.toBe(21.08);
  });

  it('13) CASO B — 2 horas extra diurnas en día ordinario generan 48.16 HEDN mensuales', () => {
    const dist: DistribucionHorasMetodoComercial = { ...DISTRIBUCION_HORAS_METODO_COMERCIAL_VACIA, horasExtraDiurnaDiaOrdinario: 2 };
    const r = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: dist, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1 });
    expect(r.conceptos.find(c => c.concepto === 'extraDiurna')!.horasMensualesPromedio).toBe(48.16);
  });

  it('14) CASO C — 2 horas extra festivas generan 11.84 HEDF mensuales', () => {
    const dist: DistribucionHorasMetodoComercial = { ...DISTRIBUCION_HORAS_METODO_COMERCIAL_VACIA, horasExtraDiurnaFestivaDiaEspecial: 2 };
    const r = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: dist, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1 });
    expect(r.conceptos.find(c => c.concepto === 'extraDiurnaFestiva')!.horasMensualesPromedio).toBe(11.84);
  });

  it('CASO D — 7 horas dominicales/festivas generan 41.44 horas mensuales', () => {
    const dist: DistribucionHorasMetodoComercial = { ...DISTRIBUCION_HORAS_METODO_COMERCIAL_VACIA, horasDominicalFestivaDiaEspecial: 7 };
    const r = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: dist, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1 });
    expect(r.conceptos.find(c => c.concepto === 'ordinariaDominical')!.horasMensualesPromedio).toBe(41.44);
  });

  it('CASO E — combinación: HEDN=48.16, Dom/Fest.=41.44, HEDF=11.84, sin distribución automática por acumulación semanal', () => {
    const dist: DistribucionHorasMetodoComercial = {
      ...DISTRIBUCION_HORAS_METODO_COMERCIAL_VACIA,
      horasOrdinariasDiaOrdinario: 7,
      horasExtraDiurnaDiaOrdinario: 2,
      horasDominicalFestivaDiaEspecial: 7,
      horasExtraDiurnaFestivaDiaEspecial: 2,
    };
    const r = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: dist, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1 });
    expect(r.conceptos.find(c => c.concepto === 'extraDiurna')!.horasMensualesPromedio).toBe(48.16);
    expect(r.conceptos.find(c => c.concepto === 'ordinariaDominical')!.horasMensualesPromedio).toBe(41.44);
    expect(r.conceptos.find(c => c.concepto === 'extraDiurnaFestiva')!.horasMensualesPromedio).toBe(11.84);
  });
});

describe('§16 pruebas 20-24 — ensamblador financiero, cantidad de trabajadores y aislamiento', () => {
  const distribucionCasoControl: DistribucionHorasMetodoComercial = {
    ...DISTRIBUCION_HORAS_METODO_COMERCIAL_VACIA,
    horasOrdinariasDiaOrdinario: 7,
    horasDominicalFestivaDiaEspecial: 7,
  };

  it('20) prestaciones y aportes reciben los valores comerciales — basePrestacionesMensual incluye recargosSobretiempoMensual comercial (656.473)', () => {
    const linea = construirLineaCalculadaMensualComercial30Dias(
      { distribucionHoras: distribucionCasoControl, salarioMensual: 1750905, cantidadTrabajadores: 1 },
      0, 'II', PARAMS_FINANCIEROS,
    );
    expect(linea.resultadoFinanciero).not.toBeNull();
    const fin = linea.resultadoFinanciero!;
    expect(fin.basePrestacionesMensual).toBe(1750905 + 656473);
    expect(fin.prestacionesSocialesMensuales).toBeGreaterThan(0);
    expect(fin.seguridadSocialMensual).toBeGreaterThan(0);
  });

  it('21) la cantidad de trabajadores se aplica una sola vez — tarifaMensualLinea = tarifaMensualPorTrabajador × cantidadTrabajadores', () => {
    const linea1 = construirLineaCalculadaMensualComercial30Dias(
      { distribucionHoras: distribucionCasoControl, salarioMensual: 1750905, cantidadTrabajadores: 1 },
      0, 'II', PARAMS_FINANCIEROS,
    );
    const linea3 = construirLineaCalculadaMensualComercial30Dias(
      { distribucionHoras: distribucionCasoControl, salarioMensual: 1750905, cantidadTrabajadores: 3 },
      0, 'II', PARAMS_FINANCIEROS,
    );
    expect(linea3.resultadoFinanciero!.tarifaMensualPorTrabajador).toBe(linea1.resultadoFinanciero!.tarifaMensualPorTrabajador);
    expect(linea3.resultadoFinanciero!.tarifaMensualLinea).toBe(linea3.resultadoFinanciero!.tarifaMensualPorTrabajador * 3);
  });

  it('23) el motor anualizado no alimenta el resultado comercial — construirLineaCalculadaMensualComercial30Dias nunca importa el motor legal ni construirLineaCalculadaMensual', () => {
    const codigo = CODIGO_MOTOR_COMERCIAL;
    expect(codigo).not.toContain('calcularTarifaMensual(');
    expect(codigo).not.toContain('construirLineaCalculadaMensual(');
    // Fase dedicada de extracción: los tipos compartidos (LineaCalculadaMensual/
    // OpcionesLineaCalculadaMensual/ResultadoAdaptadorCargo/EstadoAdaptadorCargo/
    // ResultadoTarifaMensual/ConceptoMensual/DetalleMetodologiaMensual) ya NO se
    // importan desde archivos del motor legal — viven en módulos neutrales.
    expect(codigo).toContain("from './tipos-linea-calculada'");
    expect(codigo).toContain("from './tipos-adaptador-cargo'");
    expect(codigo).toContain("from './tipos-resultado-mensual'");
    expect(codigo).not.toContain("from './linea-calculada-mensual'");
    expect(codigo).not.toContain("from './adaptador-cargo-tarifa-mensual'");
    expect(codigo).not.toContain("from './motor-tarifa-mensual'");
  });

  it('un salario mensual no configurado (0) bloquea el cálculo con mensaje comercial, sin producir un resultado con ceros disfrazado de cálculo', () => {
    const linea = construirLineaCalculadaMensualComercial30Dias(
      { distribucionHoras: distribucionCasoControl, salarioMensual: 0, cantidadTrabajadores: 1 },
      0, 'II', PARAMS_FINANCIEROS,
    );
    expect(linea.resultadoFinanciero).toBeNull();
    expect(linea.resultadoAdaptador.estadoUI).toBe('PROGRAMACION_INCOMPLETA');
    expect(linea.resultadoAdaptador.mensajeUsuario).toBe('Indique el salario mensual del cargo.');
  });
});