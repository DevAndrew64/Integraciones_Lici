import { describe, it, expect } from 'vitest';
import { resolverResponsableElegible } from './validar-responsable';
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

describe('resolverResponsableElegible — validación EXCLUSIVA del backend contra la BD', () => {
  it('usuario activo y con proceso Comercial es elegible', async () => {
    const db = crearFakeDb([
      { id: 7, usuario: 'juan.davila', estado: 'Activo', cargo: 'Analista Comercial', rol: 'Analista Comercial', proceso: 'Comercial', entidadGrupo: 'Aseocolba' },
    ]);
    const r = await resolverResponsableElegible(db, 'juan.davila');
    expect(r).toEqual({ id: 7, usuario: 'juan.davila', cargo: 'Analista Comercial', entidadGrupo: 'Aseocolba', rol: 'Analista Comercial' });
  });

  it('usuario inactivo NO es elegible', async () => {
    const db = crearFakeDb([
      { id: 7, usuario: 'juan.davila', estado: 'Inactivo', cargo: 'Analista Comercial', rol: 'Analista Comercial', proceso: 'Comercial', entidadGrupo: 'Aseocolba' },
    ]);
    expect(await resolverResponsableElegible(db, 'juan.davila')).toBeNull();
  });

  it('usuario inexistente NO es elegible (nunca se inventa)', async () => {
    const db = crearFakeDb([]);
    expect(await resolverResponsableElegible(db, 'usuario.fantasma')).toBeNull();
  });

  it('usuario activo pero sin proceso/cargo/rol comercial NO es elegible', async () => {
    const db = crearFakeDb([
      { id: 9, usuario: 'ana.soporte', estado: 'Activo', cargo: 'Soporte Técnico', rol: 'Usuario Final', proceso: 'Soporte', entidadGrupo: 'Aseocolba' },
    ]);
    expect(await resolverResponsableElegible(db, 'ana.soporte')).toBeNull();
  });

  it('username vacío nunca resuelve nada', async () => {
    const db = crearFakeDb([]);
    expect(await resolverResponsableElegible(db, '')).toBeNull();
    expect(await resolverResponsableElegible(db, '   ')).toBeNull();
  });
});