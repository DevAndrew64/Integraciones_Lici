import { describe, it, expect } from 'vitest';
import { calcularMinutosSemanaDistribucion, calcularTotalSemanalCargo, evaluarProgramacionSemanal, puedeGuardarProgramacion } from './distribucion-semanal';
import type { DistribucionHorarioConfigurada } from './tipos';

const META_42H = 2520; // minutos

function distLunAVie(): DistribucionHorarioConfigurada {
  return {
    idCliente: 'd1', empresa: 'aseo', codigo: '1', horario: '08:00-12:00 Y 14:00-18:00', jornada: '', turno: '',
    diasSemana: ['L', 'M', 'X', 'J', 'V'],
    bloques: [{ inicio: '08:00', fin: '12:00', orden: 1 }, { inicio: '14:00', fin: '18:00', orden: 2 }],
    excepcionesFecha: [], sincronizadoExterno: false,
  };
}

function distSabado(horaFin: string): DistribucionHorarioConfigurada {
  return {
    idCliente: 'd2', empresa: 'aseo', codigo: '2', horario: `08:00-${horaFin}`, jornada: '', turno: '',
    diasSemana: ['S'],
    bloques: [{ inicio: '08:00', fin: horaFin, orden: 1 }],
    excepcionesFecha: [], sincronizadoExterno: false,
  };
}

describe('calcularMinutosSemanaDistribucion', () => {
  it('caso obligatorio: lunes a viernes 8h/día = 2400 min (40 h)', () => {
    expect(calcularMinutosSemanaDistribucion(distLunAVie())).toBe(2400);
  });

  it('caso obligatorio: sábado 2h = 120 min', () => {
    expect(calcularMinutosSemanaDistribucion(distSabado('10:00'))).toBe(120);
  });
});

describe('calcularTotalSemanalCargo', () => {
  it('caso obligatorio: total = 2520 min (42 h)', () => {
    const total = calcularTotalSemanalCargo([distLunAVie(), distSabado('10:00')]);
    expect(total).toBe(2520);
  });
});

describe('ajuste "CORREGIR EL PANEL DE 66 HORAS" — CT 172 (L-V 06:00-18:00 con 1h descanso + sábado 06:00-12:00)', () => {
  function distCT172LV(): DistribucionHorarioConfigurada {
    return {
      idCliente: 'd1', empresa: '', codigo: '', horario: '', jornada: '', turno: '',
      diasSemana: ['L', 'M', 'X', 'J', 'V'],
      bloques: [{ inicio: '06:00', fin: '12:00', orden: 1 }, { inicio: '13:00', fin: '18:00', orden: 2 }],
      excepcionesFecha: [], sincronizadoExterno: false,
    };
  }
  function distCT172Sabado(): DistribucionHorarioConfigurada {
    return {
      idCliente: 'd2', empresa: '', codigo: '', horario: '', jornada: '', turno: '',
      diasSemana: ['S'],
      bloques: [{ inicio: '06:00', fin: '12:00', orden: 1 }],
      excepcionesFecha: [], sincronizadoExterno: false,
    };
  }

  it('1) el total semanal es 61 horas, nunca 66 (11h×5 L-V + 6h sábado = 61h — nunca 11h×6 días)', () => {
    const total = calcularTotalSemanalCargo([distCT172LV(), distCT172Sabado()]);
    expect(total).toBe(61 * 60);
    expect(total).not.toBe(66 * 60);
  });

  it('2) ambas distribuciones participan del total — cada una aporta sus horas reales, ninguna se ignora', () => {
    const horasLV = calcularMinutosSemanaDistribucion(distCT172LV());
    const horasSabado = calcularMinutosSemanaDistribucion(distCT172Sabado());
    expect(horasLV).toBe(55 * 60); // 11h × 5 días
    expect(horasSabado).toBe(6 * 60);
    expect(horasLV + horasSabado).toBe(calcularTotalSemanalCargo([distCT172LV(), distCT172Sabado()]));
  });
});

describe('evaluarProgramacionSemanal', () => {
  it('40 h contra meta 42 h: INCOMPLETA', () => {
    const total = calcularMinutosSemanaDistribucion(distLunAVie());
    expect(evaluarProgramacionSemanal(total, META_42H).estado).toBe('INCOMPLETA');
  });

  it('42 h exactas: COMPLETA', () => {
    const total = calcularTotalSemanalCargo([distLunAVie(), distSabado('10:00')]);
    expect(evaluarProgramacionSemanal(total, META_42H).estado).toBe('COMPLETA');
  });

  it('caso obligatorio: sábado 4h produce 44 h -> SUPERA_META en 2 horas', () => {
    const total = calcularTotalSemanalCargo([distLunAVie(), distSabado('12:00')]);
    expect(total).toBe(2640); // 2400 + 240
    const r = evaluarProgramacionSemanal(total, META_42H);
    expect(r.estado).toBe('SUPERA_META');
    expect(r.mensaje).toBe('La programación suma 44 horas semanales, es decir, 2 horas por encima de la jornada semanal de 42 horas.');
  });

  it('excedente con minutos sueltos usa singular/plural correcto', () => {
    const r = evaluarProgramacionSemanal(META_42H + 90, META_42H);
    expect(r.mensaje).toBe('La programación suma 43 horas 30 minutos semanales, es decir, 1 hora 30 minutos por encima de la jornada semanal de 42 horas.');
  });
});

describe('calcularTotalSemanalCargo — eliminar una distribución recalcula el total', () => {
  it('caso obligatorio: quitar el sábado del total 42h vuelve a 40h', () => {
    const conAmbas = [distLunAVie(), distSabado('10:00')];
    expect(calcularTotalSemanalCargo(conAmbas)).toBe(2520);
    const soloLunAVie = conAmbas.filter(d => d.idCliente !== 'd2');
    expect(calcularTotalSemanalCargo(soloLunAVie)).toBe(2400);
  });

  it('agregar una tercera distribución sin días compartidos suma sobre el total existente', () => {
    const domingo: DistribucionHorarioConfigurada = {
      idCliente: 'd3', empresa: 'aseo', codigo: '3', horario: '08:00-10:00', jornada: '', turno: '',
      diasSemana: ['D'], bloques: [{ inicio: '08:00', fin: '10:00', orden: 1 }],
      excepcionesFecha: [], sincronizadoExterno: false,
    };
    const total = calcularTotalSemanalCargo([distLunAVie(), distSabado('10:00'), domingo]);
    expect(total).toBe(2520 + 120);
  });
});

describe('puedeGuardarProgramacion', () => {
  it('sin distribuciones: no se puede guardar', () => {
    expect(puedeGuardarProgramacion([])).toBe(false);
  });

  it('con al menos una distribución: se puede guardar', () => {
    expect(puedeGuardarProgramacion([distLunAVie()])).toBe(true);
  });

  it('caso obligatorio: con las dos distribuciones (lunes-viernes + sábado) se puede guardar', () => {
    expect(puedeGuardarProgramacion([distLunAVie(), distSabado('10:00')])).toBe(true);
  });
});
