/**
 * Ajuste "UNIFICACIÓN SNC — TARIFARIO PROPIO DE VIGICOLBA" — tests puros.
 * Los valores esperados están tomados EXACTOS de la hoja "Tarifas
 * vigilancia 2026" (data/importaciones/tarifa/tar.xlsx, no versionado) —
 * nunca recalculados aquí con una fórmula distinta a la ya documentada en
 * tarifario-vigilancia-vigicolba.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  CATALOGO_VIGILANCIA_VIGICOLBA_2026,
  buscarTarifaCatalogoVigilanciaVigicolba,
  calcularValorProporcionalVigilanciaVigicolba,
  resolverTarifaAutomaticaSNCVigilanciaVigicolba,
  DIAS_POR_PATRON_VIGILANCIA_VIGICOLBA,
} from './tarifario-vigilancia-vigicolba';
import { CATALOGO_PROVISIONAL_ASEOCOLBA } from './tarifario-especiales-aseocolba';

function esperar(valor: number, esperado: number, tolerancia = 0.01) {
  expect(Math.abs(valor - esperado)).toBeLessThan(tolerancia);
}

describe('CATALOGO_VIGILANCIA_VIGICOLBA_2026 — valores exactos de la hoja', () => {
  it('Comercial · Sin Arma · Turno 1/2/24h', () => {
    esperar(buscarTarifaCatalogoVigilanciaVigicolba('COMERCIAL:TURNO_1:SIN_ARMA')!.valorTotalMensual30Dias, 9189763.836978601);
    esperar(buscarTarifaCatalogoVigilanciaVigicolba('COMERCIAL:TURNO_2:SIN_ARMA')!.valorTotalMensual30Dias, 10120355.4170214);
    esperar(buscarTarifaCatalogoVigilanciaVigicolba('COMERCIAL:SERVICIO_24H:SIN_ARMA')!.valorTotalMensual30Dias, 19310119.254);
  });

  it('Comercial · Con Arma · Turno 1/2/24h', () => {
    esperar(buscarTarifaCatalogoVigilanciaVigicolba('COMERCIAL:TURNO_1:CON_ARMA')!.valorTotalMensual30Dias, 9359944.648774501);
    esperar(buscarTarifaCatalogoVigilanciaVigicolba('COMERCIAL:TURNO_2:CON_ARMA')!.valorTotalMensual30Dias, 10307769.4062255);
    esperar(buscarTarifaCatalogoVigilanciaVigicolba('COMERCIAL:SERVICIO_24H:CON_ARMA')!.valorTotalMensual30Dias, 19667714.055);
  });

  it('Comercial · Con Canino · Turno 1/2/24h', () => {
    esperar(buscarTarifaCatalogoVigilanciaVigicolba('COMERCIAL:TURNO_1:CON_CANINO')!.valorTotalMensual30Dias, 9445035.054672452);
    esperar(buscarTarifaCatalogoVigilanciaVigicolba('COMERCIAL:TURNO_2:CON_CANINO')!.valorTotalMensual30Dias, 10401476.40082755);
    esperar(buscarTarifaCatalogoVigilanciaVigicolba('COMERCIAL:SERVICIO_24H:CON_CANINO')!.valorTotalMensual30Dias, 19846511.4555);
  });

  it('Residencial · Sin Arma/Con Arma coinciden (misma administración 10%) · Turno 1/2/24h', () => {
    esperar(buscarTarifaCatalogoVigilanciaVigicolba('RESIDENCIAL:TURNO_1:SIN_ARMA')!.valorTotalMensual30Dias, 9359944.648774501);
    esperar(buscarTarifaCatalogoVigilanciaVigicolba('RESIDENCIAL:TURNO_1:CON_ARMA')!.valorTotalMensual30Dias, 9359944.648774501);
    esperar(buscarTarifaCatalogoVigilanciaVigicolba('RESIDENCIAL:TURNO_2:SIN_ARMA')!.valorTotalMensual30Dias, 10307769.4062255);
    esperar(buscarTarifaCatalogoVigilanciaVigicolba('RESIDENCIAL:SERVICIO_24H:SIN_ARMA')!.valorTotalMensual30Dias, 19667714.055);
  });

  it('Residencial · Con Canino · Turno 1/2/24h', () => {
    esperar(buscarTarifaCatalogoVigilanciaVigicolba('RESIDENCIAL:TURNO_1:CON_CANINO')!.valorTotalMensual30Dias, 9445035.054672452);
    esperar(buscarTarifaCatalogoVigilanciaVigicolba('RESIDENCIAL:TURNO_2:CON_CANINO')!.valorTotalMensual30Dias, 10401476.40082755);
    esperar(buscarTarifaCatalogoVigilanciaVigicolba('RESIDENCIAL:SERVICIO_24H:CON_CANINO')!.valorTotalMensual30Dias, 19846511.4555);
  });

  it('el catálogo tiene exactamente 18 entradas (2 tipos × 3 turnos × 3 modalidades)', () => {
    expect(CATALOGO_VIGILANCIA_VIGICOLBA_2026.length).toBe(18);
  });

  it('tarifaKey desconocida → undefined, nunca un fallback silencioso a otra tarifa', () => {
    expect(buscarTarifaCatalogoVigilanciaVigicolba('COMERCIAL:TURNO_3:SIN_ARMA')).toBeUndefined();
    expect(buscarTarifaCatalogoVigilanciaVigicolba('')).toBeUndefined();
    expect(buscarTarifaCatalogoVigilanciaVigicolba('ASEOCOLBA:TURNO_1:SIN_ARMA')).toBeUndefined();
  });
});

describe('calcularValorProporcionalVigilanciaVigicolba — proporcionalidad por días (fórmula exacta de la hoja)', () => {
  const comercialSinArmaT1 = buscarTarifaCatalogoVigilanciaVigicolba('COMERCIAL:TURNO_1:SIN_ARMA')!;
  const comercialSinArma24h = buscarTarifaCatalogoVigilanciaVigicolba('COMERCIAL:SERVICIO_24H:SIN_ARMA')!;

  it('Lunes a Viernes sin Festivos (20 días) · Turno 1 · Sin Arma', () => {
    esperar(calcularValorProporcionalVigilanciaVigicolba(comercialSinArmaT1, 'LUNES_A_VIERNES_SIN_FESTIVOS'), 6126509.224652401);
  });

  it('Lunes a Viernes con Festivos (22 días) · Turno 1 · Sin Arma', () => {
    esperar(calcularValorProporcionalVigilanciaVigicolba(comercialSinArmaT1, 'LUNES_A_VIERNES_CON_FESTIVOS'), 6739160.147117641);
  });

  it('Lunes a Sábados sin Festivos (24 días) · Servicio 24h · Sin Arma', () => {
    esperar(calcularValorProporcionalVigilanciaVigicolba(comercialSinArma24h, 'LUNES_A_SABADOS_SIN_FESTIVOS'), 15448095.4032);
  });

  it('cambio de turno cambia correctamente el valor proporcional (Turno 1 vs Turno 2, mismos días)', () => {
    const t2 = buscarTarifaCatalogoVigilanciaVigicolba('COMERCIAL:TURNO_2:SIN_ARMA')!;
    const v1 = calcularValorProporcionalVigilanciaVigicolba(comercialSinArmaT1, 'LUNES_A_VIERNES_SIN_FESTIVOS');
    const v2 = calcularValorProporcionalVigilanciaVigicolba(t2, 'LUNES_A_VIERNES_SIN_FESTIVOS');
    expect(v1).not.toBeCloseTo(v2, 0);
    esperar(v2, 6746903.6113476);
  });

  it('cambio de modalidad cambia correctamente el valor (Sin Arma vs Con Canino, mismo turno/días)', () => {
    const conCanino = buscarTarifaCatalogoVigilanciaVigicolba('COMERCIAL:TURNO_1:CON_CANINO')!;
    const vSinArma = calcularValorProporcionalVigilanciaVigicolba(comercialSinArmaT1, 'LUNES_A_VIERNES_SIN_FESTIVOS');
    const vConCanino = calcularValorProporcionalVigilanciaVigicolba(conCanino, 'LUNES_A_VIERNES_SIN_FESTIVOS');
    expect(vConCanino).toBeGreaterThan(vSinArma);
    esperar(vConCanino, 6296690.036448301);
  });

  it('acepta un número de días personalizado (fuera de los 7 patrones fijos), misma fórmula', () => {
    esperar(calcularValorProporcionalVigilanciaVigicolba(comercialSinArmaT1, 30), comercialSinArmaT1.valorTotalMensual30Dias);
    esperar(calcularValorProporcionalVigilanciaVigicolba(comercialSinArmaT1, 15), comercialSinArmaT1.valorTotalMensual30Dias / 2);
  });

  it('Festivos (2 días) y Sábados/Domingos (8 días) · Servicio 24h · Con Arma', () => {
    const conArma24h = buscarTarifaCatalogoVigilanciaVigicolba('COMERCIAL:SERVICIO_24H:CON_ARMA')!;
    esperar(calcularValorProporcionalVigilanciaVigicolba(conArma24h, 'FESTIVOS'), 1311180.937);
    esperar(calcularValorProporcionalVigilanciaVigicolba(conArma24h, 'SABADOS_Y_DOMINGOS'), 5244723.748);
  });
});

describe('Aislamiento entre tarifarios — Vigicolba nunca consume tarifas Aseocolba y viceversa', () => {
  it('el catálogo Aseocolba y el catálogo Vigicolba no comparten ninguna tarifaKey', () => {
    const clavesAseocolba = new Set(CATALOGO_PROVISIONAL_ASEOCOLBA.map(t => t.tarifaKey));
    const clavesVigicolba = new Set(CATALOGO_VIGILANCIA_VIGICOLBA_2026.map(t => t.tarifaKey));
    for (const clave of clavesVigicolba) expect(clavesAseocolba.has(clave)).toBe(false);
  });

  it('buscar una tarifaKey de Aseocolba en el catálogo de Vigicolba no devuelve nada', () => {
    const primeraClaveAseocolba = CATALOGO_PROVISIONAL_ASEOCOLBA[0].tarifaKey;
    expect(buscarTarifaCatalogoVigilanciaVigicolba(primeraClaveAseocolba)).toBeUndefined();
  });

  it('ninguna tarifa de Vigicolba coincide numéricamente por casualidad con una de Aseocolba (fuentes independientes)', () => {
    const valoresAseocolba = new Set(CATALOGO_PROVISIONAL_ASEOCOLBA.map(t => t.valorUnitarioConAIU));
    for (const t of CATALOGO_VIGILANCIA_VIGICOLBA_2026) {
      expect(valoresAseocolba.has(t.valorTotalMensual30Dias)).toBe(false);
    }
  });
});

describe('resolverTarifaAutomaticaSNCVigilanciaVigicolba — los 3 SNC de Vigicolba nunca resuelven tarifa automática', () => {
  const SERVICIOS_SNC_VIGICOLBA_CONFIRMADOS = [
    'ESTUDIO DE SEGURIDAD CON POLIGRAFIA',
    'CURSO PERSONA AUTORIZADA T.S.A.',
    'EXAMEN MEDICO TRABAJO EN ALTURA',
  ];

  it.each(SERVICIOS_SNC_VIGICOLBA_CONFIRMADOS)('"%s" → SIN_TARIFA_AUTOMATICA, nunca una tarifa de vigilancia por defecto', (descripcion) => {
    const resultado = resolverTarifaAutomaticaSNCVigilanciaVigicolba(descripcion);
    expect(resultado.estado).toBe('SIN_TARIFA_AUTOMATICA');
    expect(resultado).not.toHaveProperty('tarifa');
  });

  it('una descripción cualquiera/desconocida también devuelve SIN_TARIFA_AUTOMATICA (nunca un fallback silencioso)', () => {
    expect(resolverTarifaAutomaticaSNCVigilanciaVigicolba('SERVICIO NUEVO NO CATALOGADO').estado).toBe('SIN_TARIFA_AUTOMATICA');
    expect(resolverTarifaAutomaticaSNCVigilanciaVigicolba('').estado).toBe('SIN_TARIFA_AUTOMATICA');
  });

  it('el resultado nunca incluye una combinación Sin Arma/Con Arma/Con Canino ni Turno 1/2/24h por defecto', () => {
    for (const descripcion of SERVICIOS_SNC_VIGICOLBA_CONFIRMADOS) {
      const resultado = resolverTarifaAutomaticaSNCVigilanciaVigicolba(descripcion);
      expect(JSON.stringify(resultado)).not.toMatch(/SIN_ARMA|CON_ARMA|CON_CANINO|TURNO_1|TURNO_2|SERVICIO_24H/);
    }
  });
});

describe('Ajuste "TARIFA REGULADA — LUNES A DOMINGOS Y FESTIVOS (30 DÍAS)" — nuevo patrón, catálogo puro', () => {
  it('DIAS_POR_PATRON_VIGILANCIA_VIGICOLBA.LUNES_A_DOMINGOS_Y_FESTIVOS = 30', () => {
    expect(DIAS_POR_PATRON_VIGILANCIA_VIGICOLBA.LUNES_A_DOMINGOS_Y_FESTIVOS).toBe(30);
  });
  it('las 7 alternativas existentes conservan exactamente sus días (sin alterar nada)', () => {
    expect(DIAS_POR_PATRON_VIGILANCIA_VIGICOLBA).toMatchObject({
      LUNES_A_VIERNES_SIN_FESTIVOS: 20,
      LUNES_A_VIERNES_CON_FESTIVOS: 22,
      LUNES_A_SABADOS_SIN_FESTIVOS: 24,
      LUNES_A_SABADOS_CON_FESTIVOS: 26,
      FESTIVOS: 2,
      SABADOS_Y_DOMINGOS: 8,
      SABADOS_DOMINGOS_Y_FESTIVOS: 10,
    });
  });
  it('Servicio 24 Horas · Comercial · Sin Arma/Con Arma/Con Canino — usa exactamente valorTotalMensual30Dias (no una fórmula proporcional distinta, no un valor hardcodeado nuevo)', () => {
    const sinArma = buscarTarifaCatalogoVigilanciaVigicolba('COMERCIAL:SERVICIO_24H:SIN_ARMA')!;
    const conArma = buscarTarifaCatalogoVigilanciaVigicolba('COMERCIAL:SERVICIO_24H:CON_ARMA')!;
    const conCanino = buscarTarifaCatalogoVigilanciaVigicolba('COMERCIAL:SERVICIO_24H:CON_CANINO')!;
    const resultadoSinArma = calcularValorProporcionalVigilanciaVigicolba(sinArma, 'LUNES_A_DOMINGOS_Y_FESTIVOS');
    const resultadoConArma = calcularValorProporcionalVigilanciaVigicolba(conArma, 'LUNES_A_DOMINGOS_Y_FESTIVOS');
    const resultadoConCanino = calcularValorProporcionalVigilanciaVigicolba(conCanino, 'LUNES_A_DOMINGOS_Y_FESTIVOS');
    // Idéntico al valor ya presente en el catálogo — la MISMA función
    // genérica, sin caso especial ni número copiado aparte.
    expect(resultadoSinArma).toBe(sinArma.valorTotalMensual30Dias);
    expect(resultadoConArma).toBe(conArma.valorTotalMensual30Dias);
    expect(resultadoConCanino).toBe(conCanino.valorTotalMensual30Dias);
    esperar(resultadoSinArma, 19310119, 1);
    esperar(resultadoConArma, 19667714, 1);
    esperar(resultadoConCanino, 19846511, 1);
  });
});

describe('el tarifario general Vigicolba solo resuelve con parámetros válidos de vigilancia', () => {
  it('combinaciones válidas (tipoServicio:turno:modalidad reales) siempre resuelven', () => {
    for (const tarifa of CATALOGO_VIGILANCIA_VIGICOLBA_2026) {
      expect(buscarTarifaCatalogoVigilanciaVigicolba(tarifa.tarifaKey)).toBeDefined();
    }
  });

  it('un tipoServicio/turno/modalidad inventado (no de la hoja) nunca resuelve por aproximación', () => {
    expect(buscarTarifaCatalogoVigilanciaVigicolba('COMERCIAL:TURNO_1:SIN_CANINO')).toBeUndefined();
    expect(buscarTarifaCatalogoVigilanciaVigicolba('INDUSTRIAL:TURNO_1:SIN_ARMA')).toBeUndefined();
    expect(buscarTarifaCatalogoVigilanciaVigicolba('comercial:turno_1:sin_arma')).toBeUndefined();
  });
});
