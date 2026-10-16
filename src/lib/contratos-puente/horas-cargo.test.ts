import { describe, expect, it } from 'vitest';
import type { DistribucionHorarioConfigurada } from '@/lib/costos-mano-obra/horarios/tipos';
import { horasDeProgramacion } from './horas-cargo';

const base: DistribucionHorarioConfigurada = {
  idCliente: 'd1', empresa: '01', codigo: '', horario: '', jornada: '', turno: '',
  diasSemana: [], bloques: [], excepcionesFecha: [], sincronizadoExterno: false,
};

describe('horasDeProgramacion', () => {
  it('«por horas»: usa el total semanal digitado (21 h), no el «44» del campo viejo; sin días no inventa la jornada', () => {
    expect(horasDeProgramacion([{ ...base, tipoCapturaHorario: 'TOTAL_SEMANAL', horasSemanalesManual: 21 }])).toEqual({ horasSemana: 21, jornada: null });
  });

  it('«por horas» con días: la jornada es el promedio diario', () => {
    expect(horasDeProgramacion([{ ...base, tipoCapturaHorario: 'TOTAL_SEMANAL', horasSemanalesManual: 21, diasSemana: ['L', 'X', 'V'] }])).toEqual({ horasSemana: 21, jornada: 7 });
  });

  it('horario detallado: minutos del día × días, sumando distribuciones y contando cada día una vez', () => {
    const r = horasDeProgramacion([
      { ...base, diasSemana: ['L', 'M', 'X', 'J', 'V'], bloques: [{ inicio: '08:00', fin: '15:00', orden: 1 }] },
      { ...base, idCliente: 'd2', diasSemana: ['S'], bloques: [{ inicio: '08:00', fin: '15:00', orden: 1 }] },
    ]);
    expect(r).toEqual({ horasSemana: 42, jornada: 7 });
  });

  it('sin programación: null (la pantalla usa entonces los campos viejos)', () => {
    expect(horasDeProgramacion([])).toEqual({ horasSemana: null, jornada: null });
    expect(horasDeProgramacion(undefined)).toEqual({ horasSemana: null, jornada: null });
  });
});
