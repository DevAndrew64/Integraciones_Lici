import { describe, it, expect } from 'vitest';
import { calcularYValidarEstadoFinal, EstadoAsignacionInvalidoError } from './validar-estado-asignacion';
import type { PrismaDb } from './crear-solicitud';

interface UsuarioFake {
  id: number;
  usuario: string;
  estado: string;
  cargo: string;
  rol: string;
  proceso: string | null;
  entidadGrupo: string;
}

function crearFakeDb(usuarios: UsuarioFake[]) {
  return {
    user: {
      async findFirst({ where }: { where: { usuario: string } }) {
        return usuarios.find((u) => u.usuario === where.usuario) ?? null;
      },
    },
  } as unknown as PrismaDb;
}

const JUAN: UsuarioFake = { id: 7, usuario: 'juan.davila', estado: 'Activo', cargo: 'Analista Comercial', rol: 'Analista Comercial', proceso: 'Comercial', entidadGrupo: 'Aseocolba' };

const construirAsignacion = (r: { usuario: string; cargo?: string; entidadGrupo?: string }) => ({
  idAsignacion: `ASG-${r.usuario}`,
  analistaAsignado: r.usuario,
  analistaCargo: r.cargo ?? '',
  analistaEntidad: r.entidadGrupo ?? '',
});

describe('calcularYValidarEstadoFinal — blindaje centralizado', () => {
  it('1. NO se puede guardar "Asignado para revisión" sin responsable (actuales vacío, sin agregar)', async () => {
    const db = crearFakeDb([JUAN]);
    await expect(calcularYValidarEstadoFinal(db, {
      estadoActual: 'Selección de proceso',
      actuales: [],
      estadoSolicitalPedido: 'Asignado para revisión',
      construirAsignacion,
    })).rejects.toThrow(EstadoAsignacionInvalidoError);
  });

  it('2. SÍ se puede guardar cuando existe un responsable válido (agregado en esta misma operación)', async () => {
    const db = crearFakeDb([JUAN]);
    const r = await calcularYValidarEstadoFinal(db, {
      estadoActual: 'Selección de proceso',
      actuales: [],
      agregar: [{ usuario: 'juan.davila' }],
      estadoSolicitalPedido: 'Asignado para revisión',
      construirAsignacion,
    });
    expect(r.estadoFinal).toBe('Asignado para revisión');
    expect(r.asignacionesFinal).toHaveLength(1);
    expect(r.asignacionesFinal[0].analistaAsignado).toBe('juan.davila');
  });

  it('3. Quitar el último responsable, conservando el estado que lo exige, se RECHAZA (no se guarda un estado incoherente)', async () => {
    const db = crearFakeDb([JUAN]);
    await expect(calcularYValidarEstadoFinal(db, {
      estadoActual: 'Asignado para revisión',
      actuales: [construirAsignacion({ usuario: 'juan.davila' })],
      remover: ['juan.davila'],
      // no se pide un estadoSolicitalPedido nuevo → se conserva el actual, que exige responsable
      construirAsignacion,
    })).rejects.toThrow(EstadoAsignacionInvalidoError);
  });

  it('3b. Quitar el último responsable ES posible si se pide explícitamente un estado coherente', async () => {
    const db = crearFakeDb([JUAN]);
    const r = await calcularYValidarEstadoFinal(db, {
      estadoActual: 'Asignado para revisión',
      actuales: [construirAsignacion({ usuario: 'juan.davila' })],
      remover: ['juan.davila'],
      estadoSolicitalPedido: 'Selección de proceso',
      construirAsignacion,
    });
    expect(r.asignacionesFinal).toHaveLength(0);
    expect(r.estadoFinal).toBe('Selección de proceso');
  });

  it('agregar un usuario que no existe/no está activo/no es elegible rechaza toda la operación', async () => {
    const db = crearFakeDb([]); // sin usuarios
    await expect(calcularYValidarEstadoFinal(db, {
      estadoActual: 'Selección de proceso',
      actuales: [],
      agregar: [{ usuario: 'fantasma' }],
      construirAsignacion,
    })).rejects.toThrow(EstadoAsignacionInvalidoError);
  });

  it('no duplica responsables ya presentes', async () => {
    const db = crearFakeDb([JUAN]);
    const r = await calcularYValidarEstadoFinal(db, {
      estadoActual: 'Asignado para revisión',
      actuales: [construirAsignacion({ usuario: 'juan.davila' })],
      agregar: [{ usuario: 'juan.davila' }], // ya está — no debe duplicarse
      construirAsignacion,
    });
    expect(r.asignacionesFinal).toHaveLength(1);
  });

  it('estados que no exigen responsable (ej. "Cerrada") permiten quedar sin ninguno', async () => {
    const db = crearFakeDb([JUAN]);
    const r = await calcularYValidarEstadoFinal(db, {
      estadoActual: 'Asignado para revisión',
      actuales: [construirAsignacion({ usuario: 'juan.davila' })],
      remover: ['juan.davila'],
      estadoSolicitalPedido: 'Cerrada',
      construirAsignacion,
    });
    expect(r.asignacionesFinal).toHaveLength(0);
    expect(r.estadoFinal).toBe('Cerrada');
  });
});