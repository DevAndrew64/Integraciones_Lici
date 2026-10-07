/**
 * PRUEBA AISLADA DEL MOTOR PARALELO — FÓRMULA LEGADA CONGELADA.
 * NO ES RESULTADO FUNCIONAL APROBADO. NO SE EJECUTA EN PRODUCCIÓN.
 *
 * Limpieza segura (Fase 1): el bloque inline de `page.tsx` que esta
 * prueba originalmente caracterizaba (jornadaLegalMinParaFecha,
 * calcularHorasYCostoLinea y el useEffect clasificador) fue ELIMINADO en
 * el cierre quirúrgico del motor comercial — page.tsx ya no ejecuta esa
 * fórmula. Esta prueba ya NO caracteriza page.tsx: reconstruye, de forma
 * aislada y congelada, la fórmula legada (clasificación proporcional no
 * cronológica + redondeo anticipado, ambos ya documentados como defectos
 * en la auditoría de Fase 0) usando únicamente 4 primitivas que SÍ siguen
 * existiendo en `motor-mano-obra.ts` (parseHora, calcularHorasBrutas,
 * calcularHorasNetas, contarHorasNocturnas) — motor paralelo sin
 * consumidores de producción, alcanzable solo vía el endpoint
 * `/api/costos/mano-obra/[id]/recalcular`.
 *
 * Se conserva como registro histórico congelado de esa fórmula (útil de
 * referencia si en el futuro se retoma el "Plan de unificación" del
 * motor de Mano de Obra) — no duplica la cobertura de
 * `casos-reales.test.ts`/`distribucion-trabajadores.test.ts`/
 * `motor-mano-obra-casos.test.ts`, que prueban el algoritmo REAL y
 * distinto de `motor-mano-obra.ts` (presupuesto semanal vía
 * `procesarCargo`/`calcularDesgloseSemanale`), no esta fórmula legada.
 */
import { describe, it, expect } from 'vitest';
import { parseHora, calcularHorasBrutas, calcularHorasNetas, contarHorasNocturnas } from './motor-mano-obra';
import { CASO_LEGACY_OPERARIO_ASEO_47 } from './__fixtures__/caso-legacy-operario-aseo-codigo47';

const F = CASO_LEGACY_OPERARIO_ASEO_47;

/**
 * Reconstruye jornadaLegalMinParaFecha (fórmula legada, ya eliminada de
 * page.tsx) — jornada legal
 * ordinaria por día en minutos: 440 (7h20) hasta el 14/07/2026, 420 (7h)
 * desde el 15/07/2026.
 */
function jornadaLegalMinParaFecha(fechaISO: string): number {
  return fechaISO >= '2026-07-15' ? 420 : 440;
}

/**
 * Reconstruye el clasificador de línea 1 (fórmula legada, ya eliminada de
 * page.tsx) EXACTO,
 * incluyendo el redondeo anticipado a 1 decimal (.toFixed(1)) de cada
 * estado — no es una versión corregida.
 */
function clasificarComoMotorViejo(entrada: typeof F.entrada) {
  const bruta = calcularHorasBrutas(entrada.horaInicioProceso, entrada.horaFinProceso);
  const recesoMin = Number(entrada.recesoProceso) || 0;
  const neta = calcularHorasNetas(bruta, recesoMin, false);
  const ini = parseHora(entrada.horaInicioProceso);
  const nocBruta = contarHorasNocturnas(ini, bruta, 19, 6);
  const fraccionNoc = bruta > 0 ? nocBruta / bruta : 0;

  const horasContratadasDia = Number(entrada.nHoras) || 0;
  const fechas = entrada.diasSeleccionados.length > 0 ? entrada.diasSeleccionados : [null];
  let habilOrd = 0, habilExt = 0, domOrd = 0, domExt = 0, habilOrdSliver = 0;
  for (const f of fechas) {
    const esDomingo = f !== null && new Date(f + 'T12:00:00').getDay() === 0;
    const jornadaLegalDia = jornadaLegalMinParaFecha(f as string) / 60;
    const ordDia = Math.min(neta, jornadaLegalDia);
    const extDia = Math.max(0, neta - jornadaLegalDia);
    if (esDomingo) { domOrd += ordDia; domExt += extDia; }
    else {
      habilOrd += ordDia; habilExt += extDia;
      if (horasContratadasDia > 0) habilOrdSliver += Math.max(0, ordDia - horasContratadasDia);
    }
  }

  const exactasPreRedondeo = {
    recargoNocturnoHabil: habilOrd * fraccionNoc,
    extraDiurnaHabil: habilExt * (1 - fraccionNoc),
    extraNocturnaHabil: habilExt * fraccionNoc,
    ordinariaDomDiurna: domOrd * (1 - fraccionNoc),
    recargoNocturnoDom: domOrd * fraccionNoc,
    extraDomDiurna: domExt * (1 - fraccionNoc),
    extraDomNocturna: domExt * fraccionNoc,
  };

  const redondeadas = {
    recargoNocturnoHabil: Number(exactasPreRedondeo.recargoNocturnoHabil.toFixed(1)),
    extraDiurnaHabil: Number(exactasPreRedondeo.extraDiurnaHabil.toFixed(1)),
    extraNocturnaHabil: Number(exactasPreRedondeo.extraNocturnaHabil.toFixed(1)),
    ordinariaDomDiurna: Number(exactasPreRedondeo.ordinariaDomDiurna.toFixed(1)),
    recargoNocturnoDom: Number(exactasPreRedondeo.recargoNocturnoDom.toFixed(1)),
    extraDomDiurna: Number(exactasPreRedondeo.extraDomDiurna.toFixed(1)),
    extraDomNocturna: Number(exactasPreRedondeo.extraDomNocturna.toFixed(1)),
  };

  return { bruta, neta, nocBruta, fraccionNoc, exactasPreRedondeo, redondeadas };
}

/**
 * Reconstruye el bloque de valorización (valorHora, salarioBasico,
 * RECARGOS_CFG,
 * totalRecargos, dev) EXACTO — divisor 220 fijo, valorHora redondeado a
 * entero ANTES de valorizar (Error B), factores legados.
 */
function valorizarComoMotorViejo(redondeadas: ReturnType<typeof clasificarComoMotorViejo>['redondeadas']) {
  const sb = Number(F.entrada.salBase);
  const valorHora = Math.round(sb / 220);
  const hsSem = Math.max(1, Number(F.entrada.horasSemanales) || 44);
  const salarioBasico = Math.round((hsSem / 44) * sb);

  const factores = F.factoresLegados;
  const conceptos = {
    recargoNocturnoHabil: Math.round(valorHora * factores.recargoNocturnoHabil * redondeadas.recargoNocturnoHabil),
    extraDiurnaHabil: Math.round(valorHora * factores.extraDiurnaHabil * redondeadas.extraDiurnaHabil),
    extraNocturnaHabil: Math.round(valorHora * factores.extraNocturnaHabil * redondeadas.extraNocturnaHabil),
    ordinariaDomDiurna: Math.round(valorHora * factores.ordinariaDomDiurna * redondeadas.ordinariaDomDiurna),
    recargoNocturnoDom: Math.round(valorHora * factores.recargoNocturnoDom * redondeadas.recargoNocturnoDom),
    extraDomDiurna: Math.round(valorHora * factores.extraDomDiurna * redondeadas.extraDomDiurna),
    extraDomNocturna: Math.round(valorHora * factores.extraDomNocturna * redondeadas.extraDomNocturna),
  };
  const sobretiempo = Object.values(conceptos).reduce((s, v) => s + v, 0);
  const total = salarioBasico + sobretiempo + F.resultadoEsperado.auxilioTransporte;

  return { valorHora, salarioBasico, conceptos, sobretiempo, total };
}

describe('PRUEBA AISLADA DEL MOTOR PARALELO — fórmula legada congelada. NO ES RESULTADO FUNCIONAL APROBADO.', () => {
  const clasificacion = clasificarComoMotorViejo(F.entrada);
  const valorizacion = valorizarComoMotorViejo(clasificacion.redondeadas);

  describe('duración e identificación de la franja nocturna (fórmula legada congelada)', () => {
    it('duración bruta = 9,333333... horas (incluye el receso — Error A)', () => {
      expect(clasificacion.bruta).toBeCloseTo(F.intermedios.horasBrutas, 10);
    });
    it('duración neta = 7,333333... horas', () => {
      expect(clasificacion.neta).toBeCloseTo(F.intermedios.horasNetas, 10);
    });
    it('fraccionNoc = 1 / 9,333333...', () => {
      expect(clasificacion.fraccionNoc).toBeCloseTo(F.intermedios.fraccionNoc, 10);
    });
  });

  describe('horas exactas ANTES de redondear (fórmula legada congelada)', () => {
    it('R.N. exacta = 0,75', () => {
      expect(clasificacion.exactasPreRedondeo.recargoNocturnoHabil).toBeCloseTo(F.horasExactasPreRedondeo.recargoNocturnoHabil, 10);
    });
    it('H.E. exacta = 0,297619...', () => {
      expect(clasificacion.exactasPreRedondeo.extraDiurnaHabil).toBeCloseTo(F.horasExactasPreRedondeo.extraDiurnaHabil, 10);
    });
    it('H.E.N. exacta = 0,035714... (Error A: el excedente real 14:00-14:20 es 100% diurno)', () => {
      expect(clasificacion.exactasPreRedondeo.extraNocturnaHabil).toBeCloseTo(F.horasExactasPreRedondeo.extraNocturnaHabil, 10);
    });
    it('Dom./Fest. exacta = 6,25', () => {
      expect(clasificacion.exactasPreRedondeo.ordinariaDomDiurna).toBeCloseTo(F.horasExactasPreRedondeo.ordinariaDomDiurna, 10);
    });
    it('R.N.F. exacta = 0,75', () => {
      expect(clasificacion.exactasPreRedondeo.recargoNocturnoDom).toBeCloseTo(F.horasExactasPreRedondeo.recargoNocturnoDom, 10);
    });
    it('H.E.D.F. exacta = 0,297619...', () => {
      expect(clasificacion.exactasPreRedondeo.extraDomDiurna).toBeCloseTo(F.horasExactasPreRedondeo.extraDomDiurna, 10);
    });
    it('H.E.N.F. exacta = 0,035714...', () => {
      expect(clasificacion.exactasPreRedondeo.extraDomNocturna).toBeCloseTo(F.horasExactasPreRedondeo.extraDomNocturna, 10);
    });
  });

  describe('redondeo anticipado a 1 decimal (fórmula legada congelada, Error B)', () => {
    it('0,75 → 0,8 (R.N. y R.N.F.)', () => {
      expect(clasificacion.redondeadas.recargoNocturnoHabil).toBe(F.horasRedondeadasAnticipadamente.recargoNocturnoHabil);
      expect(clasificacion.redondeadas.recargoNocturnoDom).toBe(F.horasRedondeadasAnticipadamente.recargoNocturnoDom);
    });
    it('0,297619... → 0,3 (H.E. y H.E.D.F.)', () => {
      expect(clasificacion.redondeadas.extraDiurnaHabil).toBe(F.horasRedondeadasAnticipadamente.extraDiurnaHabil);
      expect(clasificacion.redondeadas.extraDomDiurna).toBe(F.horasRedondeadasAnticipadamente.extraDomDiurna);
    });
    it('0,035714... → 0,0 (H.E.N. y H.E.N.F.)', () => {
      expect(clasificacion.redondeadas.extraNocturnaHabil).toBe(F.horasRedondeadasAnticipadamente.extraNocturnaHabil);
      expect(clasificacion.redondeadas.extraDomNocturna).toBe(F.horasRedondeadasAnticipadamente.extraDomNocturna);
    });
    it('6,25 → 6,3 (Dom./Fest.)', () => {
      expect(clasificacion.redondeadas.ordinariaDomDiurna).toBe(F.horasRedondeadasAnticipadamente.ordinariaDomDiurna);
    });
  });

  describe('valores visibles (fórmula legada congelada)', () => {
    it('valorHora = $7.959 (Math.round(1.750.905/220), redondeado ANTES de valorizar)', () => {
      expect(valorizacion.valorHora).toBe(F.resultadoEsperado.valorHora);
    });
    it('salarioBasico = $1.750.905 (sin prorrateo, hsSem=44 declarado)', () => {
      expect(valorizacion.salarioBasico).toBe(F.resultadoEsperado.salarioBasico);
    });
    it('cada concepto del detalle de sobretiempo coincide con lo mostrado en pantalla', () => {
      expect(valorizacion.conceptos).toEqual(F.resultadoEsperado.conceptos);
    });
    it('sobretiempo = $120.420', () => {
      expect(valorizacion.sobretiempo).toBe(F.resultadoEsperado.sobretiempo);
    });
    it('total = $2.120.420', () => {
      expect(valorizacion.total).toBe(F.resultadoEsperado.total);
    });
  });
});
