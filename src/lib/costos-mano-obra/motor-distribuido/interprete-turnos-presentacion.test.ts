/**
 * Capa de presentación — pruebas obligatorias del cierre "MEJORA VISUAL Y
 * DE LENGUAJE". Verifica que los textos comerciales sean los exigidos y
 * que ningún valor interno se filtre en ellos.
 */
import { describe, expect, it } from 'vitest';
import {
  etiquetaTipoOperacion, tituloPanelCobertura, badgeTipoServicio, formatearBooleano,
  estadoCalculoTexto, textoMultiplesPosiciones, textoJornadaIndividual, TEXTO_JORNADA_PARCIAL,
  advertenciaCobertura, rotuloTotalCargo, encabezadoCantidad, encabezadoCoberturaHoras,
  tituloTipoJornadaVisible, DESCRIPCION_JORNADA_INDIVIDUAL, textoCalendarioAplicado,
  detectarCoberturaConsolidada24x7, type PosicionParaConsolidacion,
  textoEstadoCoberturaTurnantes, textoHorasPendientesRelevo, rotuloCostoTurnante, alertaCoberturaIncompletaTurnante,
} from './interprete-turnos-presentacion';

describe('Corrección "COSTO PRELIMINAR DEL TURNANTE" — humanización de estados y alerta compacta', () => {
  it('textoEstadoCoberturaTurnantes traduce los 3 enums, nunca los imprime crudos', () => {
    expect(textoEstadoCoberturaTurnantes('COBERTURA_COMPLETA')).toBe('Cobertura completa');
    expect(textoEstadoCoberturaTurnantes('COBERTURA_PARCIAL_PENDIENTE_PROGRAMACION')).toBe('Cobertura incompleta');
    expect(textoEstadoCoberturaTurnantes('SIN_NECESIDAD')).toBe('Sin necesidad de relevo');
  });

  it('textoHorasPendientesRelevo(6) → "Faltan 6 horas semanales por programar"', () => {
    expect(textoHorasPendientesRelevo(6)).toBe('Faltan 6 horas semanales por programar');
  });
  it('textoHorasPendientesRelevo(0) → null (nada pendiente que anunciar)', () => {
    expect(textoHorasPendientesRelevo(0)).toBeNull();
  });

  it('rotuloCostoTurnante — con brecha (horasResiduales>0) usa "Costo preliminar del turnante de {X}" (singular)', () => {
    expect(rotuloCostoTurnante('ASEADOR', 1, 6)).toBe('Costo preliminar del turnante de ASEADOR');
  });
  it('rotuloCostoTurnante — con brecha y varios turnantes físicos usa plural', () => {
    expect(rotuloCostoTurnante('ASEADOR', 2, 6)).toBe('Costo preliminar de los turnantes de ASEADOR');
  });
  it('rotuloCostoTurnante — sin brecha (horasResiduales=0) usa "Costo mensual del turnante de {X}"', () => {
    expect(rotuloCostoTurnante('ASEADOR', 1, 0)).toBe('Costo mensual del turnante de ASEADOR');
  });
  it('rotuloCostoTurnante — sin perfil único (multi-cargo), con y sin brecha', () => {
    expect(rotuloCostoTurnante(null, 1, 6)).toBe('Costo preliminar de las líneas de turnante');
    expect(rotuloCostoTurnante(null, 1, 0)).toBe('Costo mensual de las líneas de turnante');
  });

  it('alertaCoberturaIncompletaTurnante(6,42,48) → el texto compacto exacto pedido, una sola alerta sin párrafo largo ni código técnico', () => {
    expect(alertaCoberturaIncompletaTurnante(6, 42, 48)).toBe(
      'Faltan 6 horas semanales de relevo. El valor mostrado cubre únicamente 42 de las 48 horas requeridas.',
    );
  });
  it('alertaCoberturaIncompletaTurnante(0,...) → null (cobertura completa, nada que alertar)', () => {
    expect(alertaCoberturaIncompletaTurnante(0, 48, 48)).toBeNull();
  });
});

describe('§1 — etiquetaTipoOperacion (traducción exigida por el cierre)', () => {
  it('COBERTURA_12_7 → "Cobertura diaria de 12 horas, todos los días"', () => {
    expect(etiquetaTipoOperacion('COBERTURA_12_7')).toBe('Cobertura diaria de 12 horas, todos los días');
  });
  it('COBERTURA_24_7 → "Cobertura permanente de 24 horas"', () => {
    expect(etiquetaTipoOperacion('COBERTURA_24_7')).toBe('Cobertura permanente de 24 horas');
  });
  it('TURNO_12_HORAS_INDIVIDUAL → "Turno individual de 12 horas"', () => {
    expect(etiquetaTipoOperacion('TURNO_12_HORAS_INDIVIDUAL')).toBe('Turno individual de 12 horas');
  });
  it('JORNADA_INDIVIDUAL → "Jornada individual"', () => {
    expect(etiquetaTipoOperacion('JORNADA_INDIVIDUAL')).toBe('Jornada individual');
  });
  it('JORNADA_PARCIAL → "Jornada en días seleccionados"', () => {
    expect(etiquetaTipoOperacion('JORNADA_PARCIAL')).toBe('Jornada en días seleccionados');
  });
  it('1/2) ningún valor devuelto contiene el nombre técnico interno', () => {
    const tipos: Array<Parameters<typeof etiquetaTipoOperacion>[0]> = ['COBERTURA_12_7', 'COBERTURA_24_7', 'TURNO_12_HORAS_INDIVIDUAL', 'JORNADA_INDIVIDUAL', 'JORNADA_PARCIAL'];
    for (const t of tipos) {
      expect(etiquetaTipoOperacion(t)).not.toMatch(/COBERTURA_|JORNADA_|TURNO_12_HORAS_INDIVIDUAL/);
      expect(tituloPanelCobertura(t)).not.toMatch(/COBERTURA_|JORNADA_|TURNO_12_HORAS_INDIVIDUAL/);
    }
  });
});

describe('§6 — formatearBooleano', () => {
  it('true → "Sí"', () => { expect(formatearBooleano(true)).toBe('Sí'); });
  it('false → "No"', () => { expect(formatearBooleano(false)).toBe('No'); });
});

describe('§3 — estadoCalculoTexto', () => {
  it('brechaCoberturaPendiente=true → "Parcial"', () => { expect(estadoCalculoTexto(true)).toBe('Parcial'); });
  it('brechaCoberturaPendiente=false → "Completo"', () => { expect(estadoCalculoTexto(false)).toBe('Completo'); });
});

describe('§8 — casos de texto exigidos', () => {
  it('A) COBERTURA_12_7 (etiqueta larga)', () => {
    expect(etiquetaTipoOperacion('COBERTURA_12_7')).toContain('Cobertura diaria de 12 horas, todos los días');
  });
  it('B) COBERTURA_24_7 — texto completo con turnos', () => {
    // etiquetaTipoOperacion da la forma corta exigida en §1; el texto largo
    // con "dividida en dos turnos de 12 horas" se compone en el panel (§2)
    // a partir de interpretacion.turnosInterpretados, no aquí.
    expect(tituloPanelCobertura('COBERTURA_24_7')).toBe('Cobertura permanente de 24 horas');
  });
  it('C) múltiples posiciones — "3 posiciones simultáneas de servicio."', () => {
    expect(textoMultiplesPosiciones(3)).toBe('3 posiciones simultáneas de servicio.');
  });
  it('C) una sola posición no genera el texto de múltiples posiciones', () => {
    expect(textoMultiplesPosiciones(1)).toBeNull();
  });
  it('D) JORNADA_INDIVIDUAL — "Jornada individual de 42 horas semanales."', () => {
    expect(textoJornadaIndividual()).toBe('Jornada individual de 42 horas semanales.');
  });
  it('E) JORNADA_PARCIAL — "Jornada configurada únicamente para los días seleccionados."', () => {
    expect(TEXTO_JORNADA_PARCIAL).toBe('Jornada configurada únicamente para los días seleccionados.');
  });
});

describe('4 — advertenciaCobertura (corrección "CAMBIO 4": frase breve, ya no el párrafo largo)', () => {
  it('aparece para COBERTURA_12_7 y COBERTURA_24_7, con el texto breve exigido', () => {
    expect(advertenciaCobertura('COBERTURA_12_7')).toBe('Requiere relevo: la cobertura supera la jornada individual y opera los siete días.');
    expect(advertenciaCobertura('COBERTURA_24_7')).toBe('Requiere relevo: la cobertura supera la jornada individual y opera los siete días.');
  });
  it('ya no contiene el párrafo largo retirado', () => {
    expect(advertenciaCobertura('COBERTURA_12_7')).not.toMatch(/Esta cobertura no corresponde a la jornada de una sola persona/);
  });
  it('no aparece para jornadas normales', () => {
    expect(advertenciaCobertura('JORNADA_INDIVIDUAL')).toBeNull();
    expect(advertenciaCobertura('JORNADA_PARCIAL')).toBeNull();
    expect(advertenciaCobertura('TURNO_12_HORAS_INDIVIDUAL')).toBeNull();
  });
});

describe('§5 — rotuloTotalCargo', () => {
  it('12) con brecha pendiente: "Costo parcial calculado — ASEADOR"', () => {
    expect(rotuloTotalCargo('ASEADOR', true)).toBe('Costo parcial calculado — ASEADOR');
  });
  it('sin brecha pendiente: "Costo mensual total — ASEADOR" (comportamiento ya existente)', () => {
    expect(rotuloTotalCargo('ASEADOR', false)).toBe('Costo mensual total — ASEADOR');
  });
});

describe('§6 — encabezados dinámicos', () => {
  it('10) significadoCantidad=POSICIONES → "CANT. POSICIONES"', () => {
    expect(encabezadoCantidad('POSICIONES')).toBe('CANT. POSICIONES');
  });
  it('13) significadoCantidad=TRABAJADORES → conserva "CANT. TRABAJADORES"', () => {
    expect(encabezadoCantidad('TRABAJADORES')).toBe('CANT. TRABAJADORES');
  });
  it('undefined (sin interpretación aún) → conserva "CANT. TRABAJADORES"', () => {
    expect(encabezadoCantidad(undefined)).toBe('CANT. TRABAJADORES');
  });
  it('11) significadoCantidad=POSICIONES → "COBERTURA SEM. / MES"', () => {
    expect(encabezadoCoberturaHoras('POSICIONES')).toBe('COBERTURA SEM. / MES');
  });
  it('significadoCantidad=TRABAJADORES → conserva "HORAS SEM. / MES"', () => {
    expect(encabezadoCoberturaHoras('TRABAJADORES')).toBe('HORAS SEM. / MES');
  });
});

describe('badgeTipoServicio — nunca expone el nombre técnico', () => {
  it('COBERTURA_12_7 → "COBERTURA 12/7"', () => {
    expect(badgeTipoServicio('COBERTURA_12_7')).toBe('COBERTURA 12/7');
    expect(badgeTipoServicio('COBERTURA_12_7')).not.toContain('_');
  });
  it('COBERTURA_24_7 → "COBERTURA 24/7"', () => {
    expect(badgeTipoServicio('COBERTURA_24_7')).toBe('COBERTURA 24/7');
  });
});

describe('§1/§2 — tituloTipoJornadaVisible (cierre "PRESENTACIÓN DE JORNADA INDIVIDUAL")', () => {
  it('A) JORNADA_PARCIAL (TRABAJADORES, sin relevo, sin cálculo pendiente) → "Jornada individual"', () => {
    expect(tituloTipoJornadaVisible({
      tipoOperacionInterpretada: 'JORNADA_PARCIAL', significadoCantidad: 'TRABAJADORES',
      requiereTurnantes: false, brechaCoberturaPendiente: false,
    })).toBe('Jornada individual');
  });

  it('B) JORNADA_INDIVIDUAL → "Jornada individual"', () => {
    expect(tituloTipoJornadaVisible({
      tipoOperacionInterpretada: 'JORNADA_INDIVIDUAL', significadoCantidad: 'TRABAJADORES',
      requiereTurnantes: false, brechaCoberturaPendiente: false,
    })).toBe('Jornada individual');
  });

  it('C) las coberturas conservan sus textos ya aprobados', () => {
    expect(tituloTipoJornadaVisible({
      tipoOperacionInterpretada: 'COBERTURA_12_7', significadoCantidad: 'POSICIONES',
      requiereTurnantes: true, brechaCoberturaPendiente: true,
    })).toBe('Cobertura diaria de 12 horas');
    expect(tituloTipoJornadaVisible({
      tipoOperacionInterpretada: 'COBERTURA_24_7', significadoCantidad: 'POSICIONES',
      requiereTurnantes: true, brechaCoberturaPendiente: true,
    })).toBe('Cobertura permanente de 24 horas');
  });

  it('nunca devuelve "JORNADA_PARCIAL" ni el texto "jornada parcial"', () => {
    const r = tituloTipoJornadaVisible({
      tipoOperacionInterpretada: 'JORNADA_PARCIAL', significadoCantidad: 'TRABAJADORES',
      requiereTurnantes: false, brechaCoberturaPendiente: false,
    });
    expect(r).not.toMatch(/JORNADA_PARCIAL/);
    expect(r.toLowerCase()).not.toContain('jornada parcial');
  });
});

describe('DESCRIPCION_JORNADA_INDIVIDUAL', () => {
  it('es "Programada únicamente en los días seleccionados."', () => {
    expect(DESCRIPCION_JORNADA_INDIVIDUAL).toBe('Programada únicamente en los días seleccionados.');
  });
});

describe('§5 — textoCalendarioAplicado', () => {
  it('"Calendario de festivos aplicado: 2026"', () => {
    expect(textoCalendarioAplicado(2026)).toBe('Calendario de festivos aplicado: 2026');
  });
});

const TODOS_LOS_DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

describe('detectarCoberturaConsolidada24x7 — caso obligatorio OPERARIO DE ASEO', () => {
  it('2 — 06:00-18:00 + 18:00-06:00, los 7 días: se detecta 24/7 consolidada', () => {
    const posiciones: PosicionParaConsolidacion[] = [
      { diasSemana: TODOS_LOS_DIAS, bloques: [{ inicio: '06:00', fin: '18:00' }] },
      { diasSemana: TODOS_LOS_DIAS, bloques: [{ inicio: '18:00', fin: '06:00' }] },
    ];
    expect(detectarCoberturaConsolidada24x7(posiciones)).toBe(true);
  });

  it('7 — un hueco horario (ej. 18:00-05:00, falta 05:00-06:00) NUNCA se etiqueta 24/7', () => {
    const posiciones: PosicionParaConsolidacion[] = [
      { diasSemana: TODOS_LOS_DIAS, bloques: [{ inicio: '06:00', fin: '18:00' }] },
      { diasSemana: TODOS_LOS_DIAS, bloques: [{ inicio: '18:00', fin: '05:00' }] },
    ];
    expect(detectarCoberturaConsolidada24x7(posiciones)).toBe(false);
  });

  it('un día sin ninguna posición programada tampoco se etiqueta 24/7 (aunque los demás días sí cubran 24h)', () => {
    const posiciones: PosicionParaConsolidacion[] = [
      { diasSemana: ['L', 'M', 'X', 'J', 'V', 'S'], bloques: [{ inicio: '06:00', fin: '18:00' }] }, // sin domingo
      { diasSemana: TODOS_LOS_DIAS, bloques: [{ inicio: '18:00', fin: '06:00' }] },
    ];
    expect(detectarCoberturaConsolidada24x7(posiciones)).toBe(false);
  });

  it('una sola posición de 12h (sin la posición complementaria) nunca es 24/7', () => {
    const posiciones: PosicionParaConsolidacion[] = [
      { diasSemana: TODOS_LOS_DIAS, bloques: [{ inicio: '06:00', fin: '18:00' }] },
    ];
    expect(detectarCoberturaConsolidada24x7(posiciones)).toBe(false);
  });

  it('sin posiciones, nunca es 24/7', () => {
    expect(detectarCoberturaConsolidada24x7([])).toBe(false);
  });

  it('3 bloques que juntos cubren 24h sin huecos (8h+8h+8h) también se detectan como 24/7', () => {
    const posiciones: PosicionParaConsolidacion[] = [
      { diasSemana: TODOS_LOS_DIAS, bloques: [{ inicio: '06:00', fin: '14:00' }] },
      { diasSemana: TODOS_LOS_DIAS, bloques: [{ inicio: '14:00', fin: '22:00' }] },
      { diasSemana: TODOS_LOS_DIAS, bloques: [{ inicio: '22:00', fin: '06:00' }] },
    ];
    expect(detectarCoberturaConsolidada24x7(posiciones)).toBe(true);
  });

  it('un solapamiento (sin hueco) sigue siendo 24/7 — el solapamiento no es un hueco', () => {
    const posiciones: PosicionParaConsolidacion[] = [
      { diasSemana: TODOS_LOS_DIAS, bloques: [{ inicio: '06:00', fin: '19:00' }] }, // se solapa 1h con el siguiente
      { diasSemana: TODOS_LOS_DIAS, bloques: [{ inicio: '18:00', fin: '06:00' }] },
    ];
    expect(detectarCoberturaConsolidada24x7(posiciones)).toBe(true);
  });
});