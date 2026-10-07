/**
 * `esMercadeo` es la fuente ÚNICA de la regla "INFORMES GERENCIALES — TODOS
 * EXCEPTO MERCADEO":
 *   - Sidebar (`page.tsx`): el ítem "Informes" se renderiza con `!esMercadeoRol`.
 *   - Dashboard (`page.tsx`): el botón de exportación de adjudicados se
 *     renderiza con `!esMercadeo(sesion.rol)`.
 *   - Backend (`GET /api/informes/procesos-adjudicados`): `requireNoMercadeo`,
 *     que internamente es `esMercadeo(session.rol)` → 403.
 * Estas pruebas fijan el comportamiento de ese helper para los roles REALES
 * del repo y descartan match parcial. Ver también `authz.test.ts`
 * (`requireNoMercadeo`) y `procesos-adjudicados/route.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { esMercadeo, esEquipoComercial, isAdmin } from './roles';

describe('esMercadeo — roles reales de Mercadeo en el repo', () => {
  it.each(['Analista Mercadeo', 'Asistente Mercadeo'])('%s → true', (rol) => {
    expect(esMercadeo(rol)).toBe(true);
  });

  it('normaliza mayúsculas/espacios', () => {
    expect(esMercadeo('  analista mercadeo ')).toBe(true);
    expect(esMercadeo('ASISTENTE MERCADEO')).toBe(true);
  });

  it.each([
    'Administrador', 'Gerencia',
    'Director Comercial', 'Coordinador Comercial', 'Analista Comercial', 'Asistente Comercial',
    'Usuario Final',
  ])('%s (no Mercadeo) → false', (rol) => {
    expect(esMercadeo(rol)).toBe(false);
  });

  it('nunca por coincidencia parcial: "Jefe de Mercadeo Digital" NO es Mercadeo', () => {
    expect(esMercadeo('Jefe de Mercadeo Digital')).toBe(false);
  });
  it('nunca por coincidencia parcial: "Analista Mercadeo Senior" NO matchea el set exacto', () => {
    expect(esMercadeo('Analista Mercadeo Senior')).toBe(false);
  });
});

describe('regla "todos EXCEPTO Mercadeo" — resultado esperado para Informes Gerenciales', () => {
  // El acceso al módulo/botón/endpoint es: autenticado && !esMercadeo(rol).
  const puedeVerInformes = (rol: string) => !esMercadeo(rol);

  it.each([
    ['Administrador', true],
    ['Director Comercial', true],
    ['Coordinador Comercial', true],
    ['Analista Comercial', true],
    ['Gerencia', true],
    ['Usuario Final', true],
    ['Analista Mercadeo', false],
    ['Asistente Mercadeo', false],
  ] as [string, boolean][])('%s → %s', (rol, esperado) => {
    expect(puedeVerInformes(rol)).toBe(esperado);
  });
});

describe('no se alteran otros permisos — Costos / Equipo Comercial intactos', () => {
  it('Mercadeo sigue SIN ser Equipo Comercial (edición de Costos no cambia)', () => {
    expect(esEquipoComercial('Analista Mercadeo')).toBe(false);
    expect(esEquipoComercial('Asistente Mercadeo')).toBe(false);
  });
  it('Equipo Comercial sigue siendo Equipo Comercial (Costos)', () => {
    for (const rol of ['Director Comercial', 'Coordinador Comercial', 'Analista Comercial', 'Asistente Comercial']) {
      expect(esEquipoComercial(rol)).toBe(true);
    }
  });
  it('isAdmin no se amplía', () => {
    expect(isAdmin('Administrador')).toBe(true);
    expect(isAdmin('Analista Mercadeo')).toBe(false);
    expect(isAdmin('Analista Comercial')).toBe(false);
  });
});
