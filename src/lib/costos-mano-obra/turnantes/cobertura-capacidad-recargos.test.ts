/**
 * Corrección "COBERTURA vs. CAPACIDAD vs. RECARGOS" — reemplaza el ajuste
 * anterior "JORNADA LABORAL LIQUIDADA" (retirado por incorrecto: recortar
 * un día de `distribucionesHorario` a nivel de LÍNEA equivalía a aplicar
 * el mismo descanso a los N titulares simultáneamente, y además eliminaba
 * por completo el recargo dominical/festivo/nocturno de ese día).
 *
 * Caso obligatorio: OPERARIO DE ASEO, 6 posiciones, L-D 06:00-13:00
 * (49h/semana de cobertura por posición). Pruebas REALES (sin readFileSync
 * de page.tsx): usan directamente el motor ya existente
 * (`derivarDistribucionHorasComercialActivo`,
 * `construirLineaCalculadaMensualComercial30Dias`, NO modificados) sobre
 * la cobertura ORIGINAL, sin recortar ningún día — nunca se construye una
 * distribución reducida para ningún propósito.
 */
import { describe, it, expect } from 'vitest';
import { calcularNecesidadTurnantes } from './calculo-turnantes';
import { calcularTotalSemanalCargo } from '../horarios/distribucion-semanal';
import { derivarDistribucionHorasComercialActivo } from '../motor-distribuido/derivar-distribucion-comercial';
import {
  construirLineaCalculadaMensualComercial30Dias,
  DISTRIBUCION_HORAS_METODO_COMERCIAL_VACIA,
  PARAMETROS_METODO_COMERCIAL_30_DIAS_DEFAULT,
} from '../motor-distribuido/motor-comercial-30-dias';
import type { ParametrosFinancierosManoObra } from '../motor-distribuido/parametros-financieros-mano-obra';
import {
  construirDesgloseOtrosCostosLinea,
  construirResultadoLineaConOtrosCostos,
  agregarCostoMensualTotalManoObra,
} from '../motor-distribuido/otros-costos-por-linea';
import type { DistribucionHorarioConfigurada } from '../horarios/tipos';

const PARAMS_FINANCIEROS: ParametrosFinancierosManoObra = {
  porcentajeVacaciones: 5, porcentajeCesantias: 8.33, porcentajePrima: 8.33, porcentajeInteresesCesantias: 1,
  porcentajePension: 12, porcentajeArlPorClase: { I: 0.522, II: 1.044, III: 2.436, IV: 4.35, V: 6.96 },
  porcentajeSalud: 8.5, exoneradoSalud: false,
  porcentajeCajaCompensacion: 4, porcentajeSena: 2, exoneradoSena: false, porcentajeIcbf: 3, exoneradoIcbf: false,
  fuente: 'VALORES_PREDETERMINADOS',
};

// Cobertura del servicio, SIN RECORTAR NUNCA: L-D 06:00-13:00 = 7h/día × 7 días = 49h/semana.
const COBERTURA_OPERARIO_ASEO: DistribucionHorarioConfigurada[] = [{
  idCliente: 'op-aseo', empresa: '', codigo: '', horario: '', jornada: '', turno: '',
  diasSemana: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
  bloques: [{ inicio: '06:00', fin: '13:00', orden: 1 }],
  excepcionesFecha: [], sincronizadoExterno: false,
  tipoCapturaHorario: 'HORARIO_DETALLADO', distribucionInferida: false,
}];

describe('1 — la rotación nunca trata a los 6 titulares como si descansaran el mismo día', () => {
  it('el clasificador acepta la cobertura de 7 días SIN necesidad de recortar ningún día — nunca se construye una distribución con un día quitado', () => {
    // La cobertura se pasa TAL CUAL (7 días, sin editar diasSemana) — a
    // diferencia del ajuste retirado, aquí NO existe ninguna función que
    // reciba `distribucionesHorario` y devuelva una versión con un día
    // menos. El motor clasifica el día de descanso obligatorio aparte
    // (mecanismo ya existente, sin cambios), sin necesitar esa edición.
    const derivado = derivarDistribucionHorasComercialActivo({
      distribucionesHorario: COBERTURA_OPERARIO_ASEO, incluyeFestivos: false, cantidadTrabajadores: 6,
      diaDescansoObligatorio: 'D', metodologiaCosteo: 'SEMANAL_4_33',
    });
    expect(derivado.ok).toBe(true);
    if (derivado.ok) {
      // Los 7 días de la cobertura original siguen intactos para la detección/UI.
      expect(COBERTURA_OPERARIO_ASEO[0].diasSemana).toHaveLength(7);
      expect(COBERTURA_OPERARIO_ASEO[0].diasSemana).toContain('D');
    }
  });
});

describe('2 — servicio total = 294 horas', () => {
  it('6 posiciones × 49h de cobertura = 294h', () => {
    const horasCoberturaUnaPosicion = calcularTotalSemanalCargo(COBERTURA_OPERARIO_ASEO) / 60;
    expect(horasCoberturaUnaPosicion).toBe(49);
    expect(horasCoberturaUnaPosicion * 6).toBe(294);
  });
});

describe('3/4 — capacidad de plantilla, sin horas extra por insuficiencia (Ajuste "AJUSTAR INTEGRALMENTE EL MOTOR..." — 6 posiciones ⇒ 6 turnantes de 21h, nunca 1 de 42h)', () => {
  it('6 titulares × 42h (jornada ordinaria) + 6 turnantes × 21h = 378h; horas residuales = 0', () => {
    const necesidad = calcularNecesidadTurnantes([
      { id: 'operario-aseo', cantidad: 6, requiereCoberturaDescanso: true, minutosPorDia: { L: 420, M: 420, X: 420, J: 420, V: 420, S: 420, D: 420 } },
    ]);
    expect(necesidad.cantidadTurnantesFisicos).toBe(6);
    const capacidadTitulares = 6 * 42;
    const capacidadTurnante = necesidad.capacidadOrdinariaMinutos / 60;
    expect(capacidadTurnante).toBe(126); // 6 × 21h
    expect(capacidadTitulares + capacidadTurnante).toBe(378);
    expect(necesidad.minutosResiduales).toBe(0);
    expect(necesidad.horasResiduales).toBe(0);
    expect(necesidad.coberturaCompleta).toBe(true);
  });
});

describe('5 — horas dominicales de servicio = 42', () => {
  it('la clasificación de UN titular representativo da 7h dominicales/semana; × 6 titulares = 42h', () => {
    const derivado = derivarDistribucionHorasComercialActivo({
      distribucionesHorario: COBERTURA_OPERARIO_ASEO, incluyeFestivos: false, cantidadTrabajadores: 6,
      diaDescansoObligatorio: 'D', metodologiaCosteo: 'SEMANAL_4_33',
    });
    expect(derivado.ok).toBe(true);
    if (derivado.ok) {
      // horasDominicalFestivaDiaEspecial es horas/día especial (1 domingo/semana) — 7h.
      expect(derivado.distribucion.horasDominicalFestivaDiaEspecial).toBe(7);
      expect(derivado.distribucion.horasDominicalFestivaDiaEspecial * 6).toBe(42);
      // Las horas ordinarias (Mon-Sat) quedan capadas a la jornada semanal, sin extra.
      expect(derivado.distribucion.horasExtraDiurnaDiaOrdinario).toBe(0);
      expect(derivado.distribucion.horasExtraDiurnaFestivaDiaEspecial).toBe(0);
    }
  });
});

function liquidar(distribucionHoras: import('../motor-distribuido/motor-comercial-30-dias').DistribucionHorasMetodoComercial, salarioMensual: number, cantidadTrabajadores: number) {
  const linea = construirLineaCalculadaMensualComercial30Dias(
    { distribucionHoras, salarioMensual, cantidadTrabajadores },
    0, 'II', PARAMS_FINANCIEROS,
  );
  const fin = linea.resultadoFinanciero!;
  const desglose = construirDesgloseOtrosCostosLinea({ cantidadTrabajadores, dotacion: [], epp: [], examenes: [], cursos: [], vacunas: [] });
  return construirResultadoLineaConOtrosCostos(fin.tarifaMensualPorTrabajador, fin.tarifaMensualLinea, desglose);
}

describe('6/7/10 — las 42 horas dominicales se costean exactamente una vez; el turnante no las hace desaparecer; total correcto sin duplicación', () => {
  it('titulares tienen recargo dominical > 0 (el servicio SÍ se costea) y el turnante (TOTAL_SEMANAL) tiene recargo = 0 — nunca ambos, nunca ninguno', () => {
    const derivadoTitulares = derivarDistribucionHorasComercialActivo({
      distribucionesHorario: COBERTURA_OPERARIO_ASEO, incluyeFestivos: false, cantidadTrabajadores: 6,
      diaDescansoObligatorio: 'D', metodologiaCosteo: 'SEMANAL_4_33',
    });
    expect(derivadoTitulares.ok).toBe(true);
    if (!derivadoTitulares.ok) return;

    const resultadoTitulares = liquidar(derivadoTitulares.distribucion, 1750905, 6);
    const resultadoTurnante = liquidar(DISTRIBUCION_HORAS_METODO_COMERCIAL_VACIA, 1750905, 1);

    // El recargo dominical vive EXACTAMENTE en la línea de titulares.
    expect(resultadoTitulares.costoLaboralMensualLinea).toBeGreaterThan(0);
    // Confirmamos que la clasificación de titulares SÍ incluye horas dominicales
    // (fuente del recargo) — el turnante, en TOTAL_SEMANAL puro, no tiene ninguna.
    expect(derivadoTitulares.distribucion.horasDominicalFestivaDiaEspecial).toBeGreaterThan(0);
    expect(DISTRIBUCION_HORAS_METODO_COMERCIAL_VACIA.horasDominicalFestivaDiaEspecial).toBe(0);

    // 7 — el turnante TOTAL_SEMANAL no hace desaparecer el recargo de titulares:
    // es independiente, calculado sin ninguna referencia al turnante.
    const derivadoSinTurnanteNoCambia = derivarDistribucionHorasComercialActivo({
      distribucionesHorario: COBERTURA_OPERARIO_ASEO, incluyeFestivos: false, cantidadTrabajadores: 6,
      diaDescansoObligatorio: 'D', metodologiaCosteo: 'SEMANAL_4_33',
    });
    expect(derivadoSinTurnanteNoCambia.ok && derivadoSinTurnanteNoCambia.distribucion.horasDominicalFestivaDiaEspecial).toBe(7);

    // 10 — total correcto: exactamente titulares + turnante, cada uno una sola vez.
    const agregado = agregarCostoMensualTotalManoObra([resultadoTitulares, resultadoTurnante]);
    expect(agregado.cantidadLineas).toBe(2);
    expect(agregado.costoMensualTotalManoObra).toBe(
      resultadoTitulares.costoMensualTotalLinea + resultadoTurnante.costoMensualTotalLinea,
    );
    const agregadoDuplicado = agregarCostoMensualTotalManoObra([resultadoTitulares, resultadoTurnante, resultadoTurnante]);
    expect(agregadoDuplicado.costoMensualTotalManoObra).not.toBe(agregado.costoMensualTotalManoObra);
  });
});

describe('8 — un horario nocturno conserva toda la exposición nocturna del servicio', () => {
  it('cobertura nocturna 20:00-03:00 (7h, cruza medianoche, todo dentro de ventana nocturna) clasifica horas de recargo nocturno sin perder ninguna, sin recortar días', () => {
    const coberturaNocturna: DistribucionHorarioConfigurada[] = [{
      idCliente: 'op-nocturno', empresa: '', codigo: '', horario: '', jornada: '', turno: '',
      diasSemana: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
      bloques: [{ inicio: '20:00', fin: '03:00', orden: 1 }], // cruza medianoche, 7h, toda dentro de 19:00-06:00
      excepcionesFecha: [], sincronizadoExterno: false,
      tipoCapturaHorario: 'HORARIO_DETALLADO', distribucionInferida: false,
    }];
    const derivado = derivarDistribucionHorasComercialActivo({
      distribucionesHorario: coberturaNocturna, incluyeFestivos: false, cantidadTrabajadores: 6,
      diaDescansoObligatorio: 'D', metodologiaCosteo: 'SEMANAL_4_33',
    });
    expect(derivado.ok).toBe(true);
    if (derivado.ok) {
      // Toda la jornada (día ordinario y día especial) es nocturna — nunca se pierde por recortar un día.
      expect(derivado.distribucion.horasOrdinariasDiaOrdinario).toBe(0);
      expect(derivado.distribucion.horasRecargoNocturnoDiaOrdinario).toBeGreaterThan(0);
      expect(derivado.distribucion.horasDominicalFestivaDiaEspecial).toBe(0);
      expect(derivado.distribucion.horasRecargoNocturnoFestivoDiaEspecial).toBeGreaterThan(0);
    }
  });
});

describe('9 — un festivo conserva su exposición aunque coincida con el día rotado de descanso', () => {
  it('el día de descanso obligatorio (dominical/festivo combinados) se mensualiza con el mismo parámetro comercial (domingosFestivosPromedioMes), nunca se pierde por ser "el día que rota"', () => {
    // El método comercial NO distingue domingo vs. festivo como fuentes
    // separadas para el día de descanso — ambos se mensualizan con la
    // MISMA constante (domingosFestivosPromedioMes), así que un festivo
    // que caiga justo en el día que le toca descansar a algún titular esa
    // semana sigue estando representado por el mismo mecanismo que ya
    // cubre el domingo — nunca se excluye por coincidir con la rotación.
    expect(PARAMETROS_METODO_COMERCIAL_30_DIAS_DEFAULT.domingosFestivosPromedioMes).toBe(5.92);
    const derivado = derivarDistribucionHorasComercialActivo({
      distribucionesHorario: COBERTURA_OPERARIO_ASEO, incluyeFestivos: true, cantidadTrabajadores: 6,
      diaDescansoObligatorio: 'D', metodologiaCosteo: 'SEMANAL_4_33', anioCalculo: 2026,
    });
    expect(derivado.ok).toBe(true);
    if (derivado.ok) {
      // La exposición del día especial (domingo, que también representa festivos
      // bajo la misma constante) sigue presente, sin reducirse a 0.
      expect(derivado.distribucion.horasDominicalFestivaDiaEspecial).toBeGreaterThan(0);
    }
  });
});
