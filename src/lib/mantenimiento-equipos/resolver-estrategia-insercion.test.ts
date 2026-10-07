import { describe, expect, it } from 'vitest';
import { resolverAccionFila, resumirAcciones } from './resolver-estrategia-insercion';

describe('resolverAccionFila', () => {
  it('A) llave inexistente → INSERTAR', () => {
    expect(resolverAccionFila({ hashFila: 'abc' }, null)).toBe('INSERTAR');
    expect(resolverAccionFila({ hashFila: 'abc' }, undefined)).toBe('INSERTAR');
  });

  it('B) llave existente con el mismo hashFila → SIN_CAMBIOS (nunca reescribe un registro idéntico)', () => {
    expect(resolverAccionFila({ hashFila: 'abc' }, { hashFila: 'abc' })).toBe('SIN_CAMBIOS');
  });

  it('C) llave existente con hashFila distinto → ACTUALIZAR', () => {
    expect(resolverAccionFila({ hashFila: 'nuevo' }, { hashFila: 'viejo' })).toBe('ACTUALIZAR');
  });
});

describe('resumirAcciones', () => {
  it('cuenta insertados/actualizados/sinCambios correctamente', () => {
    const acciones = ['INSERTAR', 'INSERTAR', 'ACTUALIZAR', 'SIN_CAMBIOS', 'SIN_CAMBIOS', 'SIN_CAMBIOS'] as const;
    expect(resumirAcciones(acciones)).toEqual({ insertados: 2, actualizados: 1, sinCambios: 3 });
  });

  it('base vacía real esperada: 412 insertados, 0 actualizados, 0 sin cambios', () => {
    const acciones = Array(412).fill('INSERTAR') as ('INSERTAR' | 'ACTUALIZAR' | 'SIN_CAMBIOS')[];
    expect(resumirAcciones(acciones)).toEqual({ insertados: 412, actualizados: 0, sinCambios: 0 });
  });
});
