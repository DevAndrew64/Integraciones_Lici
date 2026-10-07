import { describe, it, expect } from 'vitest';
import { fusionarHorarioCatalogo } from './fusion-horarios-catalogo';

interface Fila { empresa: string; codigo: string | null; horario: string; bloques: string[]; }

function fila(overrides: Partial<Fila> = {}): Fila {
  return { empresa: 'aseo', codigo: '00042', horario: '08:00-12:00', bloques: [], ...overrides };
}

describe('fusionarHorarioCatalogo', () => {
  it('agregar horario nuevo cuando la lista está vacía', () => {
    const r = fusionarHorarioCatalogo([], fila());
    expect(r).toHaveLength(1);
  });

  it('agregar horario nuevo cuando no existe esa identidad', () => {
    const lista = [fila({ codigo: '1' })];
    const r = fusionarHorarioCatalogo(lista, fila({ codigo: '2' }));
    expect(r).toHaveLength(2);
  });

  it('reemplazar horario existente (misma empresa y mismo código)', () => {
    const original = fila({ codigo: '00042', horario: '08:00-12:00' });
    const actualizado = fila({ codigo: '00042', horario: '08:00-12:00 Y 14:00-17:20' });
    const r = fusionarHorarioCatalogo([original], actualizado);
    expect(r).toHaveLength(1);
    expect(r[0].horario).toBe('08:00-12:00 Y 14:00-17:20');
  });

  it('empresas distintas con el mismo código nunca se fusionan', () => {
    const aseo = fila({ empresa: 'aseo', codigo: '00042' });
    const vigi = fila({ empresa: 'vigi', codigo: '00042', horario: '06:00-14:00' });
    const r = fusionarHorarioCatalogo([aseo], vigi);
    expect(r).toHaveLength(2);
    expect(r[0].empresa).toBe('aseo');
    expect(r[1].empresa).toBe('vigi');
  });

  it('conserva el orden de la lista cuando actualiza (reemplaza en su misma posición)', () => {
    const a = fila({ codigo: 'A' });
    const b = fila({ codigo: 'B' });
    const c = fila({ codigo: 'C' });
    const bActualizado = fila({ codigo: 'B', horario: 'CAMBIADO' });
    const r = fusionarHorarioCatalogo([a, b, c], bActualizado);
    expect(r.map(x => x.codigo)).toEqual(['A', 'B', 'C']);
    expect(r[1].horario).toBe('CAMBIADO');
  });

  it('conserva los bloques al reemplazar (toma los del objeto nuevo, no mezcla con el anterior)', () => {
    const original = fila({ codigo: '1', bloques: ['08:00-17:00'] });
    const actualizado = fila({ codigo: '1', bloques: ['08:00-12:00', '14:00-17:20'] });
    const r = fusionarHorarioCatalogo([original], actualizado);
    expect(r[0].bloques).toEqual(['08:00-12:00', '14:00-17:20']);
  });

  it('no duplica una misma identidad tras dos fusiones sucesivas', () => {
    let lista: Fila[] = [];
    lista = fusionarHorarioCatalogo(lista, fila({ codigo: '00042' }));
    lista = fusionarHorarioCatalogo(lista, fila({ codigo: '00042', horario: 'SEGUNDA VEZ' }));
    expect(lista).toHaveLength(1);
    expect(lista[0].horario).toBe('SEGUNDA VEZ');
  });

  it('nunca convierte el código a Number ("00042" y "42" son identidades distintas)', () => {
    const conCeros = fila({ codigo: '00042' });
    const sinCeros = fila({ codigo: '42' });
    const r = fusionarHorarioCatalogo([conCeros], sinCeros);
    expect(r).toHaveLength(2);
  });
});
