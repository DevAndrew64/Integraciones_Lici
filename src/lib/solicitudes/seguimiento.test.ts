import { describe, it, expect, vi } from 'vitest';

// `seguimiento.ts` importa `esProcesoPrivado` de `autorizacion-asignacion.ts`,
// que a su vez importa `@/lib/authz` → el singleton real de `@/lib/prisma`
// (falla al cargar sin DATABASE_URL). Nunca se usa el cliente real aquí —
// mismo patrón ya usado por `autorizacion-asignacion.test.ts`.
vi.mock('@/lib/prisma', () => ({ default: {} }));

import { puedeAgregarSeguimiento, puedeGestionarSeguimiento, validarTextoSeguimiento, ordenarSeguimientoMasRecientePrimero, siguienteNumeroSeguimiento, MAX_LONGITUD_TEXTO_SEGUIMIENTO } from './seguimiento';

const PRIVADO = 'NC';
const PUBLICO = 'S1';

function sol(aliasFuente: string | null) {
  return { estadoSolicitud: 'En evaluación', asignaciones: [], aliasFuente };
}

describe('puedeAgregarSeguimiento', () => {
  it('Administrador global: permitido en Privado', () => {
    expect(puedeAgregarSeguimiento('Administrador', sol(PRIVADO)).autorizado).toBe(true);
  });
  it('Administrador global: permitido también en Público', () => {
    expect(puedeAgregarSeguimiento('Administrador', sol(PUBLICO)).autorizado).toBe(true);
  });
  it('Analista Mercadeo: permitido en Privado', () => {
    expect(puedeAgregarSeguimiento('Analista Mercadeo', sol(PRIVADO)).autorizado).toBe(true);
  });
  it('Asistente Mercadeo: permitido en Privado', () => {
    expect(puedeAgregarSeguimiento('Asistente Mercadeo', sol(PRIVADO)).autorizado).toBe(true);
  });
  it('Analista Mercadeo: DENEGADO en Público, con motivo explícito', () => {
    const r = puedeAgregarSeguimiento('Analista Mercadeo', sol(PUBLICO));
    expect(r.autorizado).toBe(false);
    expect(r.motivo).toMatch(/Público/);
  });
  it('Analista Comercial: denegado en Privado', () => {
    expect(puedeAgregarSeguimiento('Analista Comercial', sol(PRIVADO)).autorizado).toBe(false);
  });
  it('Director Comercial (administrador funcional de Procesos, pero no admin global): denegado — Seguimiento no reutiliza esAdministradorProcesos', () => {
    expect(puedeAgregarSeguimiento('Director Comercial', sol(PRIVADO)).autorizado).toBe(false);
  });
  it('aliasFuente null/ausente (legado): esProcesoPrivado NO lo trata como "Privado determinado" (mismo criterio que puedeCerrarSolicitud) — Mercadeo denegado', () => {
    const r = puedeAgregarSeguimiento('Analista Mercadeo', sol(null));
    expect(r.autorizado).toBe(false);
    expect(r.motivo).toMatch(/Público/);
  });
  it('aliasFuente null/ausente (legado): Admin global sigue permitido (conserva privilegios globales)', () => {
    expect(puedeAgregarSeguimiento('Administrador', sol(null)).autorizado).toBe(true);
  });
});

describe('validarTextoSeguimiento', () => {
  it('texto válido: ok, recortado', () => {
    const r = validarTextoSeguimiento('  Una anotación real.  ');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valor).toBe('Una anotación real.');
  });
  it('vacío: rechazado', () => {
    expect(validarTextoSeguimiento('').ok).toBe(false);
  });
  it('solo espacios: rechazado', () => {
    expect(validarTextoSeguimiento('   ').ok).toBe(false);
  });
  it('no-string: rechazado', () => {
    expect(validarTextoSeguimiento(123).ok).toBe(false);
    expect(validarTextoSeguimiento(null).ok).toBe(false);
    expect(validarTextoSeguimiento(undefined).ok).toBe(false);
  });
  it(`excede ${MAX_LONGITUD_TEXTO_SEGUIMIENTO} caracteres: rechazado`, () => {
    expect(validarTextoSeguimiento('a'.repeat(MAX_LONGITUD_TEXTO_SEGUIMIENTO + 1)).ok).toBe(false);
  });
  it(`exactamente ${MAX_LONGITUD_TEXTO_SEGUIMIENTO} caracteres: aceptado`, () => {
    expect(validarTextoSeguimiento('a'.repeat(MAX_LONGITUD_TEXTO_SEGUIMIENTO)).ok).toBe(true);
  });
});

describe('puedeGestionarSeguimiento — alias de puedeAgregarSeguimiento, misma regla para crear/editar/eliminar', () => {
  it('es literalmente la misma función (mismo objeto de referencia)', () => {
    expect(puedeGestionarSeguimiento).toBe(puedeAgregarSeguimiento);
  });
  it('Mercadeo + Privado: autorizado (cubre editar/eliminar, no solo crear)', () => {
    expect(puedeGestionarSeguimiento('Analista Mercadeo', sol(PRIVADO)).autorizado).toBe(true);
  });
  it('Comercial: denegado (solo lectura para editar/eliminar también)', () => {
    expect(puedeGestionarSeguimiento('Analista Comercial', sol(PRIVADO)).autorizado).toBe(false);
  });
});

describe('siguienteNumeroSeguimiento — numeración estable', () => {
  it('arreglo vacío/null/undefined: siguiente número es 1', () => {
    expect(siguienteNumeroSeguimiento([])).toBe(1);
    expect(siguienteNumeroSeguimiento(null)).toBe(1);
    expect(siguienteNumeroSeguimiento(undefined)).toBe(1);
  });
  it('con anotaciones existentes: max(numero) + 1', () => {
    expect(siguienteNumeroSeguimiento([{ numero: 1 }, { numero: 2 }, { numero: 3 }])).toBe(4);
  });
  it('no depende del orden de inserción — siempre max + 1', () => {
    expect(siguienteNumeroSeguimiento([{ numero: 3 }, { numero: 1 }, { numero: 2 }])).toBe(4);
  });
  it('tras "eliminar" el número más alto (arreglo ya sin él): NUNCA reutiliza ese número — sigue emitiendo el siguiente por encima del máximo restante más el histórico ya usado', () => {
    // Caso real: existían 1,2,3; se eliminó el 3 → quedan 1,2. Si se
    // asignara aquí sin más contexto, el resultado sería 3 (reutilizando
    // el número ya usado por la anotación eliminada) — por diseño, este
    // helper trabaja SOLO sobre el arreglo actual (no conoce el histórico
    // ya eliminado): la garantía de "nunca reutilizar" depende de que
    // NINGÚN endpoint decremente/reindexe `numero` al eliminar (ver
    // route.test.ts, DELETE nunca renumera). Aquí solo se verifica el
    // cálculo puro sobre el arreglo dado.
    expect(siguienteNumeroSeguimiento([{ numero: 1 }, { numero: 2 }])).toBe(3);
  });
  it('ignora elementos sin numero válido (dato histórico anterior a este ajuste) al calcular el máximo', () => {
    expect(siguienteNumeroSeguimiento([{ numero: 5 }, { texto: 'sin numero' }, { numero: 'no-es-numero' }])).toBe(6);
  });

  it('CUENTA las anotaciones con activo:false (soft-eliminadas) al calcular el máximo — nunca reutiliza su número', () => {
    // Caso real: existían 1,2,3; se "eliminó" (soft delete) la 3 — sigue
    // en el arreglo con activo:false. El siguiente número debe ser 4,
    // nunca 3 (que sería reutilizar el número de la eliminada).
    const arr = [
      { numero: 1 }, { numero: 2 }, { numero: 3, activo: false },
    ];
    expect(siguienteNumeroSeguimiento(arr)).toBe(4);
  });
});

describe('ordenarSeguimientoMasRecientePrimero — por numero descendente', () => {
  const a1 = { id: '1', numero: 1, texto: 'primera', creadoEn: '2026-08-24 10:15:00', creadoPor: 'natalia.jimenez', rol: 'Asistente Mercadeo' };
  const a2 = { id: '2', numero: 2, texto: 'segunda', creadoEn: '2026-08-25 15:42:00', creadoPor: 'andrea.calderin', rol: 'Analista Mercadeo' };
  const a3 = { id: '3', numero: 3, texto: 'tercera', creadoEn: '2026-08-25 17:59:00', creadoPor: 'admin.qa', rol: 'Administrador' };

  it('ordena más reciente primero (numero más alto primero) sin importar el orden de inserción', () => {
    expect(ordenarSeguimientoMasRecientePrimero([a1, a2]).map(a => a.id)).toEqual(['2', '1']);
    expect(ordenarSeguimientoMasRecientePrimero([a2, a1]).map(a => a.id)).toEqual(['2', '1']);
  });
  it('con 3+ elementos: orden 3, 2, 1 (numeración estable, más reciente arriba)', () => {
    expect(ordenarSeguimientoMasRecientePrimero([a1, a3, a2]).map(a => a.numero)).toEqual([3, 2, 1]);
  });
  it('eliminar una anotación intermedia (ej. la 2) no altera el orden/numero de las restantes — quedan 3, 1', () => {
    expect(ordenarSeguimientoMasRecientePrimero([a1, a3]).map(a => a.numero)).toEqual([3, 1]);
  });
  it('crudo no-array (histórico [] o null/undefined): devuelve arreglo vacío, nunca lanza', () => {
    expect(ordenarSeguimientoMasRecientePrimero([])).toEqual([]);
    expect(ordenarSeguimientoMasRecientePrimero(null)).toEqual([]);
    expect(ordenarSeguimientoMasRecientePrimero(undefined)).toEqual([]);
  });
  it('filtra elementos con forma inválida en vez de lanzar', () => {
    const invalido = { texto: 'sin id ni creadoPor' };
    expect(ordenarSeguimientoMasRecientePrimero([a1, invalido])).toEqual([a1]);
  });

  it('excluye anotaciones con activo:false (soft-eliminadas) — nunca se muestran, aunque sigan en el arreglo', () => {
    const eliminada = { ...a3, activo: false };
    const resultado = ordenarSeguimientoMasRecientePrimero([a1, a2, eliminada]);
    expect(resultado.map(a => a.id)).toEqual(['2', '1']);
    expect(resultado.find(a => a.id === '3')).toBeUndefined();
  });

  it('activo ausente o true: se muestra normalmente (compatibilidad — ausente = activa)', () => {
    const sinActivo = { ...a1 };
    const activoExplicito = { ...a2, activo: true };
    expect(ordenarSeguimientoMasRecientePrimero([sinActivo, activoExplicito]).map(a => a.id)).toEqual(['2', '1']);
  });
});
