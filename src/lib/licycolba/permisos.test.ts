/**
 * Cierre del rol "Asistente Mercadeo" — confirma que es una entrada PROPIA
 * de MATRIZ_PERMISOS (fila independiente, exigida por el tipo RolSistema),
 * nunca un alias/fusión con "Analista Mercadeo".
 */
import { describe, it, expect } from 'vitest';
import { MATRIZ_PERMISOS, puede, puedeConBD, normalizarRol } from './permisos';

describe('Rol "Asistente Mercadeo" — fila propia, sin fusión con "Analista Mercadeo"', () => {
  it('existe como clave propia en MATRIZ_PERMISOS', () => {
    expect(MATRIZ_PERMISOS['Asistente Mercadeo']).toBeDefined();
  });

  it('su objeto de permisos NO es el mismo objeto ni tiene el mismo contenido que Analista Mercadeo', () => {
    expect(MATRIZ_PERMISOS['Asistente Mercadeo']).not.toBe(MATRIZ_PERMISOS['Analista Mercadeo']);
    expect(MATRIZ_PERMISOS['Asistente Mercadeo']).not.toEqual(MATRIZ_PERMISOS['Analista Mercadeo']);
  });

  it('normalizarRol conserva el literal exacto (no lo colapsa a Usuario Final ni a Analista Mercadeo)', () => {
    expect(normalizarRol('Asistente Mercadeo')).toBe('Asistente Mercadeo');
  });

  it('puede crear/gestionar desde Búsqueda vía la matriz estática de respaldo', () => {
    expect(puede('Asistente Mercadeo', 'busqueda', 'gestionar')).toBe(true);
    expect(puede('Asistente Mercadeo', 'solicitudesComercial', 'crear')).toBe(true);
  });

  it('NO tiene la facultad de reasignar (asignaciones.asignar) en la matriz estática', () => {
    expect(puede('Asistente Mercadeo', 'asignaciones', 'asignar')).toBe(false);
  });

  it('puedeConBD respeta permisosRol de BD por encima de la matriz estática, sin mezclarlo con Analista Mercadeo', () => {
    const permisosBd = { busqueda_gestionar: true, sol_crear_comercial: true, sol_editar: true };
    expect(puedeConBD('Asistente Mercadeo', 'busqueda', 'gestionar', permisosBd)).toBe(true);
    expect(puedeConBD('Asistente Mercadeo', 'asignaciones', 'asignar', permisosBd)).toBe(false);
  });
});
