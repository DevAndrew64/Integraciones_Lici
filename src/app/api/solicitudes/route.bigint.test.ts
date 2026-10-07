/**
 * Corrección "Do not know how to serialize a BigInt" — `COUNT(...)` de
 * PostgreSQL llega a Prisma como `BigInt` de JS; `NextResponse.json`
 * (y `JSON.stringify`) no puede serializarlo. Cubre: (1) el SQL de
 * `cantidadResponsablesActivos` castea `::integer` explícitamente, (2)
 * `serializeSolicitud` convierte defensivamente incluso si ese cast
 * faltara, (3) el resultado completo sobrevive `JSON.stringify`.
 */
import { describe, it, expect } from 'vitest';
import { SQL_CANTIDAD_RESPONSABLES, serializeSolicitud } from '@/lib/solicitudes/serializar-solicitud';

describe('SQL_CANTIDAD_RESPONSABLES — cast explícito a integer', () => {
  it('el SQL castea COUNT(...) a ::integer, nunca deja bigint sin convertir', () => {
    expect(SQL_CANTIDAD_RESPONSABLES).toMatch(/COUNT\(DISTINCT lower\(trim\([^)]*\)\)\)::integer/);
  });
});

describe('serializeSolicitud — defensa contra BigInt no serializable', () => {
  it('convierte cantidadResponsablesActivos de BigInt a Number', () => {
    const fila = { id: 300, cantidadResponsablesActivos: BigInt(2), estadoSolicitud: 'Asignado para elaboración' };
    const resultado = serializeSolicitud(fila as unknown as Record<string, unknown>);
    expect(typeof resultado.cantidadResponsablesActivos).toBe('number');
    expect(resultado.cantidadResponsablesActivos).toBe(2);
  });

  it('cantidadResponsablesActivos ausente no se agrega artificialmente', () => {
    const resultado = serializeSolicitud({ id: 300 });
    expect('cantidadResponsablesActivos' in resultado).toBe(false);
  });

  it('el resultado completo (incluida responsablesResumen y el conteo) sobrevive JSON.stringify sin lanzar excepción', () => {
    const fila = {
      id: 300,
      estadoSolicitud: 'Asignado para elaboración',
      responsablesResumen: [
        { usuario: 'laura.buelvas', cargo: 'Coordinador Comercial' },
        { usuario: 'juan.davila', cargo: 'Analista Comercial' },
      ],
      cantidadResponsablesActivos: BigInt(2), // simula el peor caso: el cast SQL faltó
      createdAt: new Date('2026-07-01'),
      updatedAt: new Date('2026-07-02'),
    };
    const resultado = serializeSolicitud(fila as unknown as Record<string, unknown>);
    expect(() => JSON.stringify(resultado)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(resultado));
    expect(parsed.cantidadResponsablesActivos).toBe(2);
    expect(parsed.responsablesResumen).toHaveLength(2);
  });
});