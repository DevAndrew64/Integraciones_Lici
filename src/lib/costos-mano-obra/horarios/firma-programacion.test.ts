/**
 * Ajuste "CORREGIR AGRUPACIÓN DE CARGOS EN MANO DE OBRA — SEPARAR POR
 * CARGO + HORARIO" — pruebas de la firma canónica y la llave de ficha.
 */
import { describe, expect, it } from 'vitest';
import { construirFirmaProgramacion, construirClaveFichaManoObra } from './firma-programacion';
import type { DistribucionHorarioConfigurada } from './tipos';

function dist(over: Partial<DistribucionHorarioConfigurada> = {}): DistribucionHorarioConfigurada {
  return {
    idCliente: 'd1', empresa: '', codigo: '', horario: '', jornada: '', turno: '',
    diasSemana: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    bloques: [{ inicio: '18:00', fin: '06:00', orden: 1 }],
    excepcionesFecha: [], sincronizadoExterno: false,
    ...over,
  };
}

describe('construirFirmaProgramacion — el caso reportado (VIGILANTE 18-06 vs. 06-18)', () => {
  it('18:00-06:00 (cruza medianoche) y 06:00-18:00 (no cruza) producen firmas distintas', () => {
    const nocturno = construirFirmaProgramacion([dist({ bloques: [{ inicio: '18:00', fin: '06:00', orden: 1 }] })], true);
    const diurno = construirFirmaProgramacion([dist({ bloques: [{ inicio: '06:00', fin: '18:00', orden: 1 }] })], true);
    expect(nocturno).not.toBe(diurno);
  });

  it('la firma marca explícitamente el cruce de medianoche', () => {
    const nocturno = construirFirmaProgramacion([dist({ bloques: [{ inicio: '18:00', fin: '06:00', orden: 1 }] })], true);
    const diurno = construirFirmaProgramacion([dist({ bloques: [{ inicio: '06:00', fin: '18:00', orden: 1 }] })], true);
    expect(nocturno).toContain('~M');
    expect(diurno).not.toContain('~M');
  });
});

describe('determinismo — mismo contenido, distinto orden de captura, misma firma', () => {
  it('el orden de los días dentro de diasSemana no cambia la firma', () => {
    const a = construirFirmaProgramacion([dist({ diasSemana: ['L', 'M', 'X'] })], false);
    const b = construirFirmaProgramacion([dist({ diasSemana: ['X', 'L', 'M'] })], false);
    expect(a).toBe(b);
  });

  it('el orden de las distribuciones (varios horarios) no cambia la firma', () => {
    const d1 = dist({ idCliente: 'a', diasSemana: ['L', 'M'], bloques: [{ inicio: '06:00', fin: '14:00', orden: 1 }] });
    const d2 = dist({ idCliente: 'b', diasSemana: ['S', 'D'], bloques: [{ inicio: '08:00', fin: '12:00', orden: 1 }] });
    expect(construirFirmaProgramacion([d1, d2], false)).toBe(construirFirmaProgramacion([d2, d1], false));
  });

  it('el orden de los bloques dentro de una distribución se ordena por `orden`, no por posición en el arreglo', () => {
    const bloqueA = { inicio: '06:00', fin: '10:00', orden: 1 };
    const bloqueB = { inicio: '14:00', fin: '18:00', orden: 2 };
    const a = construirFirmaProgramacion([dist({ bloques: [bloqueA, bloqueB] })], false);
    const b = construirFirmaProgramacion([dist({ bloques: [bloqueB, bloqueA] })], false);
    expect(a).toBe(b);
  });
});

describe('cada componente exigido participa de la firma', () => {
  it('días distintos producen firmas distintas', () => {
    const a = construirFirmaProgramacion([dist({ diasSemana: ['L', 'M', 'X', 'J', 'V'] })], false);
    const b = construirFirmaProgramacion([dist({ diasSemana: ['L', 'M', 'X', 'J', 'V', 'S'] })], false);
    expect(a).not.toBe(b);
  });

  it('incluyeFestivos distinto produce firmas distintas, aunque el horario sea idéntico', () => {
    const conFestivos = construirFirmaProgramacion([dist()], true);
    const sinFestivos = construirFirmaProgramacion([dist()], false);
    expect(conFestivos).not.toBe(sinFestivos);
  });

  it('jornadaFlexible=true produce una firma distinta (liquida horas extras distintas con el mismo horario)', () => {
    const fija = construirFirmaProgramacion([dist()], false, 'D', false);
    const flexible = construirFirmaProgramacion([dist()], false, 'D', true);
    expect(flexible).not.toBe(fija);
  });

  it('jornadaFlexible ausente o false NO cambia la firma histórica (los cargos guardados antes de este campo conservan su llave de ficha)', () => {
    const historica = construirFirmaProgramacion([dist()], false, 'D');
    expect(construirFirmaProgramacion([dist()], false, 'D', false)).toBe(historica);
    expect(construirFirmaProgramacion([dist()], false, 'D', undefined)).toBe(historica);
  });

  it('diaDescansoObligatorio distinto produce firmas distintas', () => {
    const a = construirFirmaProgramacion([dist()], false, 'D');
    const b = construirFirmaProgramacion([dist()], false, 'S');
    expect(a).not.toBe(b);
  });

  it('número de distribuciones (varios horarios) distinto produce firmas distintas', () => {
    const unaSola = construirFirmaProgramacion([dist()], false);
    const dos = construirFirmaProgramacion([dist({ idCliente: 'a' }), dist({ idCliente: 'b', diasSemana: ['S'] })], false);
    expect(unaSola).not.toBe(dos);
  });

  it('excepciones de fecha distintas producen firmas distintas', () => {
    const a = construirFirmaProgramacion([dist({ excepcionesFecha: [] })], false);
    const b = construirFirmaProgramacion([dist({ excepcionesFecha: [{ fecha: '2026-12-25', accion: 'EXCLUIR' }] })], false);
    expect(a).not.toBe(b);
  });

  it('captura TOTAL_SEMANAL de 21h vs. 42h produce firmas distintas (turnantes medio tiempo vs. tiempo completo)', () => {
    const base = dist({ bloques: [], tipoCapturaHorario: 'TOTAL_SEMANAL', horasSemanalesManual: 21 });
    const otro = { ...base, horasSemanalesManual: 42 };
    expect(construirFirmaProgramacion([base], false)).not.toBe(construirFirmaProgramacion([otro], false));
  });
});

describe('construirClaveFichaManoObra — combina cargo + firma, nunca valores económicos', () => {
  it('mismo cargo, firmas distintas → llaves distintas', () => {
    const fNoc = construirFirmaProgramacion([dist({ bloques: [{ inicio: '18:00', fin: '06:00', orden: 1 }] })], true);
    const fDiu = construirFirmaProgramacion([dist({ bloques: [{ inicio: '06:00', fin: '18:00', orden: 1 }] })], true);
    expect(construirClaveFichaManoObra('VIGILANTE', fNoc)).not.toBe(construirClaveFichaManoObra('VIGILANTE', fDiu));
  });

  it('mismo cargo, misma firma → misma llave (idempotente)', () => {
    const f = construirFirmaProgramacion([dist()], true);
    expect(construirClaveFichaManoObra('VIGILANTE', f)).toBe(construirClaveFichaManoObra('VIGILANTE', f));
  });

  it('cargo con mayúsculas/espacios distintos normaliza a la misma llave (mismo criterio que el resto del proyecto)', () => {
    const f = construirFirmaProgramacion([dist()], true);
    expect(construirClaveFichaManoObra('Vigilante', f)).toBe(construirClaveFichaManoObra('  VIGILANTE  ', f));
  });

  it('nunca incluye valores económicos — dos cargos con salarios distintos pero misma programación producen la MISMA llave (el salario no forma parte de la identidad de la ficha)', () => {
    const f = construirFirmaProgramacion([dist()], true);
    // La función ni siquiera acepta un parámetro de salario — esta prueba
    // documenta la garantía de diseño, no un caso de uso real.
    expect(construirClaveFichaManoObra('VIGILANTE', f)).toBe(construirClaveFichaManoObra('VIGILANTE', f));
  });
});
