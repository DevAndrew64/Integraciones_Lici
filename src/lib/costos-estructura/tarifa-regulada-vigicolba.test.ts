/**
 * Ajuste "TARIFA REGULADA VIGICOLBA — PESTAÑA PROPIA" — tests puros del
 * módulo `tarifa-regulada-vigicolba.ts`. Cubre exclusivamente el VALOR A
 * PRESENTAR EN LA OFERTA según el tarifario regulado por Supervigilancia
 * — nunca el costo interno de Servicios No Continuos (ver
 * `servicios-no-continuos-cargo-manual.test.ts` para ESE, que ya no tiene
 * ningún acoplamiento con tarifa regulada).
 */
import { describe, expect, it } from 'vitest';
import {
  crearPosicionTarifaReguladaVacia,
  resolverTarifaPosicionRegulada, calcularValorOfertaPosicionRegulada,
  calcularTotalValorOfertaReguladaProceso, calcularDiferencialTarifaRegulada,
  resolverFactorHorasServicioTurno,
  type PosicionTarifaReguladaVigicolba,
} from './tarifa-regulada-vigicolba';
import { resolverTarifaAutomaticaSNCVigilanciaVigicolba, buscarTarifaCatalogoVigilanciaVigicolba, calcularValorProporcionalVigilanciaVigicolba } from './tarifario-vigilancia-vigicolba';

function posicion(p: Partial<PosicionTarifaReguladaVigicolba> = {}): PosicionTarifaReguladaVigicolba {
  return { id: 1, descripcion: 'Puesto Comercial', cantidad: 1, ...p };
}
const COMERCIAL = 'COMERCIAL' as const;
const RESIDENCIAL = 'RESIDENCIAL' as const;
const SIN_ARMA_T1_20D = { tipoServicio: COMERCIAL, modalidad: 'SIN_ARMA' as const, turno: 'TURNO_1' as const, patronDias: 'LUNES_A_VIERNES_SIN_FESTIVOS' as const };

describe('crearPosicionTarifaReguladaVacia — defaults correctos, sin selector preseleccionado', () => {
  it('nace con cantidad=1 y ningún parámetro tarifario configurado', () => {
    const p = crearPosicionTarifaReguladaVacia(1);
    expect(p.cantidad).toBe(1);
    expect(p.tipoServicio).toBeUndefined();
    expect(p.modalidad).toBeUndefined();
    expect(p.turno).toBeUndefined();
    expect(p.patronDias).toBeUndefined();
  });
});

describe('resolverTarifaPosicionRegulada — sin fallback, coincide exactamente con el tarifario', () => {
  it('faltan parámetros → FALTAN_PARAMETROS, nunca calcula', () => {
    expect(resolverTarifaPosicionRegulada(posicion({ tipoServicio: COMERCIAL }))).toEqual({ estado: 'FALTAN_PARAMETROS' });
  });

  it('los 4 parámetros completos resuelven RESUELTA con el valor exacto del tarifario (Comercial/Sin Arma/T1/20 días = $6.126.509)', () => {
    const r = resolverTarifaPosicionRegulada(posicion(SIN_ARMA_T1_20D));
    expect(r.estado).toBe('RESUELTA');
    if (r.estado === 'RESUELTA') expect(Math.round(r.tarifaPorPosicion)).toBe(6126509);
  });

  it('cambiar Modalidad recalcula', () => {
    const base = resolverTarifaPosicionRegulada(posicion(SIN_ARMA_T1_20D));
    const conArma = resolverTarifaPosicionRegulada(posicion({ ...SIN_ARMA_T1_20D, modalidad: 'CON_ARMA' }));
    expect(base.estado).toBe('RESUELTA'); expect(conArma.estado).toBe('RESUELTA');
    if (base.estado === 'RESUELTA' && conArma.estado === 'RESUELTA') expect(base.tarifaPorPosicion).not.toBe(conArma.tarifaPorPosicion);
  });

  it('cambiar Turno recalcula', () => {
    const base = resolverTarifaPosicionRegulada(posicion(SIN_ARMA_T1_20D));
    const turno2 = resolverTarifaPosicionRegulada(posicion({ ...SIN_ARMA_T1_20D, turno: 'TURNO_2' }));
    expect(base.estado).toBe('RESUELTA'); expect(turno2.estado).toBe('RESUELTA');
    if (base.estado === 'RESUELTA' && turno2.estado === 'RESUELTA') expect(base.tarifaPorPosicion).not.toBe(turno2.tarifaPorPosicion);
  });

  it('cambiar Días de prestación aplica la proporcionalidad correcta (recalcula)', () => {
    const base = resolverTarifaPosicionRegulada(posicion(SIN_ARMA_T1_20D));
    const con22 = resolverTarifaPosicionRegulada(posicion({ ...SIN_ARMA_T1_20D, patronDias: 'LUNES_A_VIERNES_CON_FESTIVOS' }));
    expect(base.estado).toBe('RESUELTA'); expect(con22.estado).toBe('RESUELTA');
    if (base.estado === 'RESUELTA' && con22.estado === 'RESUELTA') expect(base.tarifaPorPosicion).not.toBe(con22.tarifaPorPosicion);
  });

  it('cambiar Comercial↔Residencial recalcula (distinto % de administración)', () => {
    const comercial = resolverTarifaPosicionRegulada(posicion(SIN_ARMA_T1_20D));
    const residencial = resolverTarifaPosicionRegulada(posicion({ ...SIN_ARMA_T1_20D, tipoServicio: RESIDENCIAL }));
    expect(comercial.estado).toBe('RESUELTA'); expect(residencial.estado).toBe('RESUELTA');
    if (comercial.estado === 'RESUELTA' && residencial.estado === 'RESUELTA') expect(comercial.tarifaPorPosicion).not.toBe(residencial.tarifaPorPosicion);
  });

  it('combinación con clave inexistente → SIN_TARIFA_PARA_COMBINACION, nunca inventa un valor', () => {
    const p = { ...posicion(SIN_ARMA_T1_20D), turno: 'INEXISTENTE' as unknown as 'TURNO_1' };
    expect(resolverTarifaPosicionRegulada(p)).toEqual({ estado: 'SIN_TARIFA_PARA_COMBINACION' });
  });
});

describe('Ajuste "TARIFA REGULADA — LUNES A DOMINGOS Y FESTIVOS (30 DÍAS)" — restringido a Servicio 24 Horas', () => {
  const BASE_24H = { tipoServicio: COMERCIAL, modalidad: 'SIN_ARMA' as const, turno: 'SERVICIO_24H' as const, patronDias: 'LUNES_A_DOMINGOS_Y_FESTIVOS' as const };

  it('Servicio 24 Hrs + Lunes a Domingos y Festivos → RESUELTA, Sin Arma = $19.310.119', () => {
    const r = resolverTarifaPosicionRegulada(posicion(BASE_24H));
    expect(r.estado).toBe('RESUELTA');
    if (r.estado === 'RESUELTA') expect(Math.round(r.tarifaPorPosicion)).toBe(19310119);
  });
  it('Servicio 24 Hrs + Lunes a Domingos y Festivos → Con Arma = $19.667.714', () => {
    const r = resolverTarifaPosicionRegulada(posicion({ ...BASE_24H, modalidad: 'CON_ARMA' }));
    expect(r.estado).toBe('RESUELTA');
    if (r.estado === 'RESUELTA') expect(Math.round(r.tarifaPorPosicion)).toBe(19667714);
  });
  it('Servicio 24 Hrs + Lunes a Domingos y Festivos → Con Canino = $19.846.511', () => {
    const r = resolverTarifaPosicionRegulada(posicion({ ...BASE_24H, modalidad: 'CON_CANINO' }));
    expect(r.estado).toBe('RESUELTA');
    if (r.estado === 'RESUELTA') expect(Math.round(r.tarifaPorPosicion)).toBe(19846511);
  });
  it('Turno 1 + Lunes a Domingos y Festivos → SIN_TARIFA_PARA_COMBINACION, nunca un valor parcial inventado', () => {
    expect(resolverTarifaPosicionRegulada(posicion({ ...BASE_24H, turno: 'TURNO_1' }))).toEqual({ estado: 'SIN_TARIFA_PARA_COMBINACION' });
  });
  it('Turno 2 + Lunes a Domingos y Festivos → SIN_TARIFA_PARA_COMBINACION, nunca un valor parcial inventado', () => {
    expect(resolverTarifaPosicionRegulada(posicion({ ...BASE_24H, turno: 'TURNO_2' }))).toEqual({ estado: 'SIN_TARIFA_PARA_COMBINACION' });
  });
  it('calcularValorOfertaPosicionRegulada con Turno 1/2 inválido devuelve 0 (nunca extrapola)', () => {
    expect(calcularValorOfertaPosicionRegulada(posicion({ ...BASE_24H, turno: 'TURNO_1', cantidad: 3 }))).toBe(0);
  });
  it('las 7 alternativas existentes siguen resolviendo igual con Turno 1 (sin cambios por este ajuste)', () => {
    const r = resolverTarifaPosicionRegulada(posicion(SIN_ARMA_T1_20D));
    expect(r.estado).toBe('RESUELTA');
    if (r.estado === 'RESUELTA') expect(Math.round(r.tarifaPorPosicion)).toBe(6126509);
  });
});

describe('Ajuste "TARIFA REGULADA — PRIMA SEGURO DE VIDA VISIBLE" — informativa, ya embebida, nunca duplicada', () => {
  it('Turno 1 (o Turno 2) resuelto expone valorPrimaSeguroVida=1500', () => {
    const r = resolverTarifaPosicionRegulada(posicion(SIN_ARMA_T1_20D));
    expect(r.estado).toBe('RESUELTA');
    if (r.estado === 'RESUELTA') expect(r.valorPrimaSeguroVida).toBe(1500);
  });
  it('Servicio 24 Horas expone valorPrimaSeguroVida=3000 (suma de Turno 1 + Turno 2, mismo valor que ya trae el catálogo)', () => {
    const r = resolverTarifaPosicionRegulada(posicion({ tipoServicio: COMERCIAL, modalidad: 'SIN_ARMA', turno: 'SERVICIO_24H', patronDias: 'LUNES_A_VIERNES_SIN_FESTIVOS' }));
    expect(r.estado).toBe('RESUELTA');
    if (r.estado === 'RESUELTA') expect(r.valorPrimaSeguroVida).toBe(3000);
  });
  it('no varía por modalidad (Sin Arma/Con Arma/Con Canino) — misma constante siempre', () => {
    const sinArma = resolverTarifaPosicionRegulada(posicion(SIN_ARMA_T1_20D));
    const conArma = resolverTarifaPosicionRegulada(posicion({ ...SIN_ARMA_T1_20D, modalidad: 'CON_ARMA' }));
    const conCanino = resolverTarifaPosicionRegulada(posicion({ ...SIN_ARMA_T1_20D, modalidad: 'CON_CANINO' }));
    expect(sinArma.estado).toBe('RESUELTA'); expect(conArma.estado).toBe('RESUELTA'); expect(conCanino.estado).toBe('RESUELTA');
    if (sinArma.estado === 'RESUELTA' && conArma.estado === 'RESUELTA' && conCanino.estado === 'RESUELTA') {
      expect(sinArma.valorPrimaSeguroVida).toBe(1500);
      expect(conArma.valorPrimaSeguroVida).toBe(1500);
      expect(conCanino.valorPrimaSeguroVida).toBe(1500);
    }
  });
  it('cambiar Turno actualiza la prima mostrada (Turno 1/2 = 1500, Servicio 24h = 3000) sin tocar tarifaPorPosicion', () => {
    const t1 = resolverTarifaPosicionRegulada(posicion(SIN_ARMA_T1_20D));
    const t24h = resolverTarifaPosicionRegulada(posicion({ ...SIN_ARMA_T1_20D, turno: 'SERVICIO_24H' }));
    expect(t1.estado).toBe('RESUELTA'); expect(t24h.estado).toBe('RESUELTA');
    if (t1.estado === 'RESUELTA' && t24h.estado === 'RESUELTA') {
      expect(t1.valorPrimaSeguroVida).toBe(1500);
      expect(t24h.valorPrimaSeguroVida).toBe(3000);
      expect(t1.tarifaPorPosicion).not.toBe(t24h.tarifaPorPosicion); // el cálculo de tarifa sigue siendo el mismo de siempre
    }
  });
  it('compatible con "Lunes a Domingos y Festivos" (30 días) — Servicio 24 Horas también expone 3000', () => {
    const r = resolverTarifaPosicionRegulada(posicion({ tipoServicio: COMERCIAL, modalidad: 'CON_CANINO', turno: 'SERVICIO_24H', patronDias: 'LUNES_A_DOMINGOS_Y_FESTIVOS' }));
    expect(r.estado).toBe('RESUELTA');
    if (r.estado === 'RESUELTA') {
      expect(r.valorPrimaSeguroVida).toBe(3000);
      expect(Math.round(r.tarifaPorPosicion)).toBe(19846511); // sin alterar el valor oficial ya validado
    }
  });
  it('NO se duplica: calcularValorOfertaPosicionRegulada sigue siendo tarifaPorPosicion×cantidad, sin sumar valorPrimaSeguroVida aparte', () => {
    const r = resolverTarifaPosicionRegulada(posicion(SIN_ARMA_T1_20D));
    const oferta = calcularValorOfertaPosicionRegulada(posicion(SIN_ARMA_T1_20D));
    expect(r.estado).toBe('RESUELTA');
    if (r.estado === 'RESUELTA') expect(oferta).toBe(r.tarifaPorPosicion * 1);
  });
  it('sin combinación resuelta (FALTAN_PARAMETROS/SIN_TARIFA_PARA_COMBINACION) no expone valorPrimaSeguroVida', () => {
    expect(resolverTarifaPosicionRegulada(posicion())).not.toHaveProperty('valorPrimaSeguroVida');
  });

  describe('CASO EXPLÍCITO CONFIRMADO — Comercial/Con Canino/Servicio 24 Hrs/Lunes a Domingos y Festivos: tarifa oficial $19.846.511, prima incluida $3.000, NUNCA se suman', () => {
    const CASO = { tipoServicio: COMERCIAL, modalidad: 'CON_CANINO' as const, turno: 'SERVICIO_24H' as const, patronDias: 'LUNES_A_DOMINGOS_Y_FESTIVOS' as const };

    it('los $3.000 de prima ya forman parte de valorTotalMensual30Dias del catálogo (no es un extra aparte)', () => {
      const tarifa = buscarTarifaCatalogoVigilanciaVigicolba('COMERCIAL:SERVICIO_24H:CON_CANINO')!;
      expect(tarifa.valorPrimaSeguroVida).toBe(3000);
      // Si la prima NO estuviera embebida, restarla del total daría un
      // "valor por posición puro" mayor a 0 y consistente con la fórmula
      // documentada: (valorPorPosición + prima) × (1+%Admin) = total.
      const valorConSeguroVida = tarifa.valorPorPosicion + tarifa.valorPrimaSeguroVida;
      expect(Math.round(valorConSeguroVida * (1 + tarifa.porcentajeAdministracion))).toBe(Math.round(tarifa.valorTotalMensual30Dias));
    });

    it('tarifaPorPosicion (cantidad=1) = $19.846.511 exactos — NUNCA $19.849.511 (tarifa + prima sumada de nuevo)', () => {
      const r = resolverTarifaPosicionRegulada(posicion(CASO));
      expect(r.estado).toBe('RESUELTA');
      if (r.estado !== 'RESUELTA') return;
      expect(r.valorPrimaSeguroVida).toBe(3000);
      expect(Math.round(r.tarifaPorPosicion)).toBe(19846511);
      expect(Math.round(r.tarifaPorPosicion)).not.toBe(19849511);
    });

    it('Valor total de oferta (cantidad=1) = tarifaPorPosicion, NUNCA tarifaPorPosicion+prima', () => {
      const valorOferta = calcularValorOfertaPosicionRegulada(posicion(CASO));
      expect(Math.round(valorOferta)).toBe(19846511);
      expect(Math.round(valorOferta)).not.toBe(19849511);
    });

    it('cantidad=2 → Valor total de oferta = tarifaPorPosicion × 2 (≈$19.846.511 × 2), NUNCA (tarifaPorPosicion + $3.000) × 2', () => {
      const r = resolverTarifaPosicionRegulada(posicion(CASO));
      expect(r.estado).toBe('RESUELTA');
      if (r.estado !== 'RESUELTA') return;
      const valorOferta = calcularValorOfertaPosicionRegulada(posicion({ ...CASO, cantidad: 2 }));
      expect(valorOferta).toBe(r.tarifaPorPosicion * 2);
      expect(Math.round(valorOferta)).not.toBe(Math.round((r.tarifaPorPosicion + 3000) * 2));
      expect(Math.abs(valorOferta - 19846511 * 2)).toBeLessThan(5);
    });

    it('Total Tarifa Regulada del proceso (varias posiciones) tampoco suma la prima aparte', () => {
      const r = resolverTarifaPosicionRegulada(posicion(CASO));
      expect(r.estado).toBe('RESUELTA');
      if (r.estado !== 'RESUELTA') return;
      const posiciones = [
        posicion({ id: 1, ...CASO, cantidad: 1 }),
        posicion({ id: 2, ...CASO, cantidad: 2 }),
      ];
      const total = calcularTotalValorOfertaReguladaProceso(posiciones);
      expect(total).toBe(r.tarifaPorPosicion * 1 + r.tarifaPorPosicion * 2);
      expect(Math.round(total)).not.toBe(Math.round((r.tarifaPorPosicion + 3000) * 1 + (r.tarifaPorPosicion + 3000) * 2));
    });
  });
});

describe('calcularValorOfertaPosicionRegulada / calcularTotalValorOfertaReguladaProceso — cantidad 1 y 2, sin fallback', () => {
  it('cantidad=1 y cantidad=2 — valor de oferta = tarifa × cantidad', () => {
    const c1 = calcularValorOfertaPosicionRegulada(posicion({ ...SIN_ARMA_T1_20D, cantidad: 1 }));
    const c2 = calcularValorOfertaPosicionRegulada(posicion({ ...SIN_ARMA_T1_20D, cantidad: 2 }));
    expect(Math.round(c1)).toBe(6126509);
    expect(Math.round(c2)).toBe(12253018);
    expect(Math.round(c2)).toBe(Math.round(c1) * 2);
  });

  it('sin tarifa resuelta, el valor de oferta es 0 (nunca inventa un valor)', () => {
    expect(calcularValorOfertaPosicionRegulada(posicion())).toBe(0);
  });

  it('el total del proceso es la suma de todas las posiciones', () => {
    const posiciones = [
      posicion({ id: 1, ...SIN_ARMA_T1_20D, cantidad: 1 }),
      posicion({ id: 2, ...SIN_ARMA_T1_20D, cantidad: 2 }),
      posicion({ id: 3 }), // sin tarifa configurada → 0
    ];
    const total = calcularTotalValorOfertaReguladaProceso(posiciones);
    expect(Math.round(total)).toBe(Math.round(calcularValorOfertaPosicionRegulada(posiciones[0]) + calcularValorOfertaPosicionRegulada(posiciones[1])));
  });
});

describe('Diferencial $ / % — fórmula confirmada, sin promediar porcentajes, sin recortar negativos', () => {
  it('diferencialPesos = valorOfertaRegulado - costoInterno (ejemplo del usuario: 6.126.509 - 5.295.024 = 831.485)', () => {
    const d = calcularDiferencialTarifaRegulada(5295024, 6126509);
    expect(d.diferencialPesos).toBe(831485);
  });

  it('diferencialPorcentaje = diferencial / valorOfertaRegulado × 100 (nunca sobre el costo interno)', () => {
    const d = calcularDiferencialTarifaRegulada(5295024, 6126509);
    expect(d.diferencialPorcentaje).not.toBeNull();
    expect(d.diferencialPorcentaje!).toBeCloseTo((831485 / 6126509) * 100, 6);
  });

  it('valorOfertaRegulado<=0 → diferencialPorcentaje null (nunca división por cero)', () => {
    expect(calcularDiferencialTarifaRegulada(500000, 0).diferencialPorcentaje).toBeNull();
    expect(calcularDiferencialTarifaRegulada(500000, -100).diferencialPorcentaje).toBeNull();
  });

  it('diferencial NEGATIVO se devuelve tal cual, nunca recortado a 0', () => {
    const d = calcularDiferencialTarifaRegulada(7000000, 6126509);
    expect(d.diferencialPesos).toBeLessThan(0);
    expect(d.diferencialPorcentaje!).toBeLessThan(0);
  });
});

describe('Aislamiento — los 3 SNC especiales de Vigicolba siguen sin tarifa automática (mecanismo distinto, sin relación con esta pestaña)', () => {
  it('resolverTarifaAutomaticaSNCVigilanciaVigicolba sigue devolviendo SIN_TARIFA_AUTOMATICA', () => {
    for (const descripcion of ['ESTUDIO DE SEGURIDAD CON POLIGRAFIA', 'CURSO PERSONA AUTORIZADA T.S.A.', 'EXAMEN MEDICO TRABAJO EN ALTURA']) {
      expect(resolverTarifaAutomaticaSNCVigilanciaVigicolba(descripcion)).toEqual({ estado: 'SIN_TARIFA_AUTOMATICA' });
    }
  });
});

describe('Ajuste "TARIFA REGULADA — HORAS DE SERVICIO POR TURNO" — resolverFactorHorasServicioTurno (mecánica pura del factor)', () => {
  it('Servicio 24 Horas SIEMPRE factor=1 (nunca prorratea por horas), sin importar horasServicio', () => {
    expect(resolverFactorHorasServicioTurno('SERVICIO_24H', 6)).toBe(1);
    expect(resolverFactorHorasServicioTurno('SERVICIO_24H', undefined)).toBe(1);
    expect(resolverFactorHorasServicioTurno('SERVICIO_24H', 999)).toBe(1);
  });
  it('Turno 1: 13 horas (jornada completa) → factor=1 (idéntico al cálculo actual)', () => {
    expect(resolverFactorHorasServicioTurno('TURNO_1', 13)).toBe(1);
  });
  it('Turno 1: 6 horas → factor=6/13', () => {
    expect(resolverFactorHorasServicioTurno('TURNO_1', 6)).toBeCloseTo(6 / 13, 10);
  });
  it('Turno 2: 11 horas (jornada completa) → factor=1', () => {
    expect(resolverFactorHorasServicioTurno('TURNO_2', 11)).toBe(1);
  });
  it('Turno 2: 6 horas → factor=6/11', () => {
    expect(resolverFactorHorasServicioTurno('TURNO_2', 6)).toBeCloseTo(6 / 11, 10);
  });
  it('horasServicio ausente (undefined) en Turno 1/2 → factor=1 (jornada completa, retrocompatible con posiciones guardadas antes de este ajuste)', () => {
    expect(resolverFactorHorasServicioTurno('TURNO_1', undefined)).toBe(1);
    expect(resolverFactorHorasServicioTurno('TURNO_2', undefined)).toBe(1);
  });
  it('horasServicio inválido (0, negativo, o mayor a la jornada) → factor=1, NUNCA reduce el valor por un dato corrupto', () => {
    expect(resolverFactorHorasServicioTurno('TURNO_1', 0)).toBe(1);
    expect(resolverFactorHorasServicioTurno('TURNO_1', -5)).toBe(1);
    expect(resolverFactorHorasServicioTurno('TURNO_1', 20)).toBe(1);
    expect(resolverFactorHorasServicioTurno('TURNO_2', 15)).toBe(1);
  });
  it('mecánica de la fórmula con el ejemplo ilustrativo del usuario ($8.507.541 base, $9.369.199 base) — valida la división/multiplicación en sí, no un combo específico del catálogo', () => {
    const t1Completo = 8507541 * resolverFactorHorasServicioTurno('TURNO_1', 13);
    const t1Seis = 8507541 * resolverFactorHorasServicioTurno('TURNO_1', 6);
    expect(Math.round(t1Completo)).toBe(8507541);
    expect(t1Seis).toBeCloseTo(3926557.38, 1);
    const t2Completo = 9369199 * resolverFactorHorasServicioTurno('TURNO_2', 11);
    const t2Seis = 9369199 * resolverFactorHorasServicioTurno('TURNO_2', 6);
    expect(Math.round(t2Completo)).toBe(9369199);
    expect(t2Seis).toBeCloseTo(5110472.18, 1);
  });
});

describe('Ajuste "TARIFA REGULADA — HORAS DE SERVICIO POR TURNO" — integrado en resolverTarifaPosicionRegulada (con datos REALES del catálogo)', () => {
  const tarifaT1 = buscarTarifaCatalogoVigilanciaVigicolba('COMERCIAL:TURNO_1:SIN_ARMA')!;
  const valorTurnoSegunDias20d = calcularValorProporcionalVigilanciaVigicolba(tarifaT1, 'LUNES_A_VIERNES_SIN_FESTIVOS');

  it('10) el patrón de días se resuelve ANTES del prorrateo por horas — 13 horas (jornada completa) da EXACTAMENTE el mismo valor que sin horasServicio (comportamiento histórico)', () => {
    const sinHoras = resolverTarifaPosicionRegulada(posicion(SIN_ARMA_T1_20D));
    const con13Horas = resolverTarifaPosicionRegulada(posicion({ ...SIN_ARMA_T1_20D, horasServicio: 13 }));
    expect(sinHoras.estado).toBe('RESUELTA'); expect(con13Horas.estado).toBe('RESUELTA');
    if (sinHoras.estado === 'RESUELTA' && con13Horas.estado === 'RESUELTA') {
      expect(sinHoras.tarifaPorPosicion).toBe(valorTurnoSegunDias20d);
      expect(con13Horas.tarifaPorPosicion).toBe(sinHoras.tarifaPorPosicion);
    }
  });
  it('6 horas de Turno 1 (sobre el valor YA calculado para 20 días) = valorTurnoSegunDias20d/13×6, nunca sobre el valor mensual de 30 días', () => {
    const r = resolverTarifaPosicionRegulada(posicion({ ...SIN_ARMA_T1_20D, horasServicio: 6 }));
    expect(r.estado).toBe('RESUELTA');
    if (r.estado === 'RESUELTA') {
      expect(r.tarifaPorPosicion).toBeCloseTo((valorTurnoSegunDias20d / 13) * 6, 6);
      expect(r.tarifaPorPosicion).not.toBeCloseTo(tarifaT1.valorTotalMensual30Dias / 13 * 6, 2); // nunca el valor mensual de 30 días
    }
  });
  it('11) cantidad de posiciones multiplica el valor YA prorrateado por horas, no antes', () => {
    const c1 = calcularValorOfertaPosicionRegulada(posicion({ ...SIN_ARMA_T1_20D, horasServicio: 6, cantidad: 1 }));
    const c3 = calcularValorOfertaPosicionRegulada(posicion({ ...SIN_ARMA_T1_20D, horasServicio: 6, cantidad: 3 }));
    expect(c3).toBeCloseTo(c1 * 3, 6);
  });
  it('12) Servicio 24 Horas conserva el cálculo actual completo, incluso con horasServicio seteado (dato ignorado, nunca se prorratea)', () => {
    const sin = resolverTarifaPosicionRegulada(posicion({ tipoServicio: COMERCIAL, modalidad: 'SIN_ARMA', turno: 'SERVICIO_24H', patronDias: 'LUNES_A_VIERNES_SIN_FESTIVOS' }));
    const conHorasIgnoradas = resolverTarifaPosicionRegulada(posicion({ tipoServicio: COMERCIAL, modalidad: 'SIN_ARMA', turno: 'SERVICIO_24H', patronDias: 'LUNES_A_VIERNES_SIN_FESTIVOS', horasServicio: 5 }));
    expect(sin.estado).toBe('RESUELTA'); expect(conHorasIgnoradas.estado).toBe('RESUELTA');
    if (sin.estado === 'RESUELTA' && conHorasIgnoradas.estado === 'RESUELTA') expect(conHorasIgnoradas.tarifaPorPosicion).toBe(sin.tarifaPorPosicion);
  });
  it('prima informativa (valorPrimaSeguroVida) no se descompone ni se prorratea por horas — sigue siendo el valor íntegro del turno', () => {
    const r = resolverTarifaPosicionRegulada(posicion({ ...SIN_ARMA_T1_20D, horasServicio: 6 }));
    expect(r.estado).toBe('RESUELTA');
    if (r.estado === 'RESUELTA') expect(r.valorPrimaSeguroVida).toBe(1500);
  });
  it('16) las tarifas actuales sin fracción de horas (turno lleno o Servicio 24h) no cambian sus valores', () => {
    const r24h = resolverTarifaPosicionRegulada(posicion({ tipoServicio: COMERCIAL, modalidad: 'CON_CANINO', turno: 'SERVICIO_24H', patronDias: 'LUNES_A_DOMINGOS_Y_FESTIVOS' }));
    expect(r24h.estado).toBe('RESUELTA');
    if (r24h.estado === 'RESUELTA') expect(Math.round(r24h.tarifaPorPosicion)).toBe(19846511);
  });
});
