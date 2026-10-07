import { describe, it, expect } from 'vitest';
import { validarDiasSinSolape } from './validar-solapes-distribuciones';
import type { DistribucionHorarioConfigurada } from './tipos';

function dist(idCliente: string, diasSemana: DistribucionHorarioConfigurada['diasSemana']): DistribucionHorarioConfigurada {
  return {
    idCliente, empresa: 'aseo', codigo: '1', horario: '08:00-12:00', jornada: '', turno: '',
    diasSemana, bloques: [{ inicio: '08:00', fin: '12:00', orden: 1 }], excepcionesFecha: [], sincronizadoExterno: false,
  };
}

describe('validarDiasSinSolape', () => {
  it('sin distribuciones previas, cualquier día es válido', () => {
    const r = validarDiasSinSolape(['S'], []);
    expect(r.ok).toBe(true);
  });

  it('caso obligatorio: sábado repetido en dos distribuciones se bloquea', () => {
    const existentes = [dist('d1', ['L', 'M', 'X', 'J', 'V', 'S'])];
    const r = validarDiasSinSolape(['S'], existentes);
    expect(r.ok).toBe(false);
    expect(r.diasSolapados).toEqual(['S']);
    expect(r.error).toBe('El sábado ya está asignado a otra distribución horaria');
  });

  it('días distintos entre distribuciones no chocan', () => {
    const existentes = [dist('d1', ['L', 'M', 'X', 'J', 'V'])];
    const r = validarDiasSinSolape(['S'], existentes);
    expect(r.ok).toBe(true);
  });

  it('editar una distribución no choca contra sus propios días (idClienteExcluir)', () => {
    const existentes = [dist('d1', ['S'])];
    const r = validarDiasSinSolape(['S'], existentes, 'd1');
    expect(r.ok).toBe(true);
  });

  it('mensaje con varios días solapados usa "y"', () => {
    const existentes = [dist('d1', ['S', 'D'])];
    const r = validarDiasSinSolape(['S', 'D'], existentes);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('El sábado y el domingo ya están asignados a otra distribución horaria');
  });
});
