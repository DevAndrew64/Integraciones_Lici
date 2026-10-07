import { describe, it, expect } from 'vitest';
import { resolverResponsableInicialPorPerfil } from './responsable-inicial';

describe('resolverResponsableInicialPorPerfil — regla única, pura', () => {
  it('Vigicolba → nicole.ortiz', () => {
    expect(resolverResponsableInicialPorPerfil('Vigicolba')).toBe('nicole.ortiz');
  });
  it('Aseocolba → juan.davila', () => {
    expect(resolverResponsableInicialPorPerfil('Aseocolba')).toBe('juan.davila');
  });
  it('Tempocolba → juan.davila', () => {
    expect(resolverResponsableInicialPorPerfil('Tempocolba')).toBe('juan.davila');
  });
  it('Transcolba → juan.davila (la copia D del frontend omitía este caso — ya no)', () => {
    expect(resolverResponsableInicialPorPerfil('Transcolba')).toBe('juan.davila');
  });

  it('normaliza mayúsculas/espacios/tildes', () => {
    expect(resolverResponsableInicialPorPerfil('  ASEOCOLBA  ')).toBe('juan.davila');
    expect(resolverResponsableInicialPorPerfil('Vígicólba')).toBe('nicole.ortiz'); // tildes no deben impedir la coincidencia
  });

  it('perfil desconocido devuelve null, nunca inventa un usuario', () => {
    expect(resolverResponsableInicialPorPerfil('Otraempresa')).toBeNull();
    expect(resolverResponsableInicialPorPerfil('')).toBeNull();
    expect(resolverResponsableInicialPorPerfil(null)).toBeNull();
    expect(resolverResponsableInicialPorPerfil(undefined)).toBeNull();
  });

  it('no usa coincidencia parcial: "Aseocolba Norte" no debe resolver a juan.davila', () => {
    // Regla explícita del cierre: exact-match tras normalizar, nunca
    // `includes`/`startsWith` — evita confundir empresas distintas que
    // compartan una subcadena.
    expect(resolverResponsableInicialPorPerfil('Aseocolba Norte')).toBeNull();
    expect(resolverResponsableInicialPorPerfil('Pre-Vigicolba')).toBeNull();
  });
});