/**
 * Ajuste "FORMATO VISIBLE DE USERNAMES" — `formatearUsuarioVisible` es la
 * fuente ÚNICA de presentación de usernames ("andrea.calderin" →
 * "Andrea Calderin"), reutilizada por `src/app/page.tsx` (fichas, tablas,
 * exportes) y `src/components/licycolba/LicyTopbar.tsx` (perfil de sesión).
 * Nunca se usa para login/permisos/comparaciones/filtros/payloads — el
 * valor interno permanece intacto en todos esos usos.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatearUsuarioVisible } from './formato-usuario';

describe('formatearUsuarioVisible', () => {
  it('andrea.calderin -> Andrea Calderin', () => {
    expect(formatearUsuarioVisible('andrea.calderin')).toBe('Andrea Calderin');
  });
  it('laura.buelvas -> Laura Buelvas', () => {
    expect(formatearUsuarioVisible('laura.buelvas')).toBe('Laura Buelvas');
  });
  it('juan.davila -> Juan Davila', () => {
    expect(formatearUsuarioVisible('juan.davila')).toBe('Juan Davila');
  });
  it('sergio (un solo segmento, sin punto) -> Sergio', () => {
    expect(formatearUsuarioVisible('sergio')).toBe('Sergio');
  });
  it('vacío/null/undefined -> cadena vacía (el caller aplica su propio fallback "—"/"Usuario", sin cambios)', () => {
    expect(formatearUsuarioVisible('')).toBe('');
    expect(formatearUsuarioVisible(null)).toBe('');
    expect(formatearUsuarioVisible(undefined)).toBe('');
  });
  it('ya viene con mayúsculas/formato mixto -> normaliza igual (ANDREA.CALDERIN -> Andrea Calderin)', () => {
    expect(formatearUsuarioVisible('ANDREA.CALDERIN')).toBe('Andrea Calderin');
  });
});

describe('UI — page.tsx usa el helper central (no una reimplementación local)', () => {
  const PAGE_TSX = readFileSync(join(__dirname, '..', 'app', 'page.tsx'), 'utf-8');

  it('importa formatearUsuarioVisible desde la fuente única (@/lib/formato-usuario)', () => {
    expect(PAGE_TSX).toContain("import { formatearUsuarioVisible } from '@/lib/formato-usuario';");
  });
  it('no existe una función local formatearUsuarioVisible dentro de page.tsx (evita duplicar la lógica)', () => {
    expect(PAGE_TSX).not.toContain('function formatearUsuarioVisible(');
  });
  it('Sidebar — el perfil de usuario en el pie del sidebar usa el helper (antes: regex local propia, dejaba "Andrea.Calderin")', () => {
    expect(PAGE_TSX).toContain('{formatearUsuarioVisible(sesion.usuario)||sesion.usuario}');
    expect(PAGE_TSX).not.toMatch(/sesion\.usuario\.replace\(\/\(\?:\^\|\[\.\\s_-\]\)/);
  });
  it('VistFicha — Responsables asignados usa el helper', () => {
    const idx = PAGE_TSX.indexOf("formatearUsuarioVisible(String(a.analistaAsignado||''))||'—'");
    expect(idx).toBeGreaterThan(-1);
  });
  it('VistFicha/FilaDetalle/ModalProceso — "Registrado por" usa el helper en sus 3 puntos de uso', () => {
    const usos = PAGE_TSX.match(/label:'Registrado por',value:`\$\{formatearUsuarioVisible\(sol\.usuarioRegistro\)/g) ?? [];
    const usosEspaciado = PAGE_TSX.match(/label: 'Registrado por', value: `\$\{formatearUsuarioVisible\(sol\.usuarioRegistro\)/g) ?? [];
    expect(usos.length + usosEspaciado.length).toBeGreaterThanOrEqual(2);
    expect(PAGE_TSX).toContain('{formatearUsuarioVisible(solActual.usuarioRegistro)||\'—\'}');
    expect(PAGE_TSX).toContain("{formatearUsuarioVisible(solLocal.usuarioRegistro)||'—'}");
  });
  it('ModalProceso — "Historial de gestiones" usa el helper', () => {
    expect(PAGE_TSX).toContain("{formatearUsuarioVisible(String(a.analistaAsignado||''))||'—'}");
  });
  it('VistFichaAsignacion — "Responsables asignados" formatea SOLO el texto mostrado, sin tocar el valor crudo usado para key/cargo/iniciales', () => {
    expect(PAGE_TSX).toContain('const nombreVisible=formatearUsuarioVisible(nombre)||nombre;');
    // El avatar (iniciales) y el lookup de cargo siguen usando `nombre` crudo.
    expect(PAGE_TSX).toContain('{nombre.slice(0,2).toUpperCase()}');
    expect(PAGE_TSX).toContain('usuariosCargos[nombre]');
  });
  it('GestionAsignacionInline — "Por:", "validadoPor" y "cerradoPor" usan el helper', () => {
    expect(PAGE_TSX).toContain("Por: {formatearUsuarioVisible(safeString(o.usuario))}");
    expect(PAGE_TSX).toContain("Por: {formatearUsuarioVisible(safeString(getRecordValue(asigActual, 'validadoPor'))) || '--'}");
    expect(PAGE_TSX).toContain('Por: {formatearUsuarioVisible(cerradoPor) || cerradoPor}');
  });
  it('ModuloAsignacionesTerminadas (tabla de Cerrados) — columna Responsable usa el helper', () => {
    expect(PAGE_TSX).toContain('{formatearUsuarioVisible(a)||a}');
  });
});

describe('Exportes — el Excel de Cerrados usa el mismo helper (no imprime el username crudo)', () => {
  const PAGE_TSX = readFileSync(join(__dirname, '..', 'app', 'page.tsx'), 'utf-8');
  it('la columna "Responsable" del export de ModuloAsignacionesTerminadas mapea cada nombre con formatearUsuarioVisible antes de unir', () => {
    expect(PAGE_TSX).toContain("respArr.map(formatearUsuarioVisible).join('\\n')");
  });
});

describe('Presentación — nunca lógica: el valor interno permanece intacto', () => {
  const PAGE_TSX = readFileSync(join(__dirname, '..', 'app', 'page.tsx'), 'utf-8');
  it('las comparaciones de identidad (coincideIdentidad/seleccionarAsignacionVisible) siguen usando sesion.usuario crudo, nunca formatearUsuarioVisible', () => {
    expect(PAGE_TSX).toContain('usuario: sesion.usuario || \'\'');
    expect(PAGE_TSX).not.toMatch(/coincideIdentidad\([^)]*formatearUsuarioVisible/);
  });
  it('los payloads de gestión/cierre (gestionadoPor/cerradoPor/validadoPor/usuarioRegistro/asignadoPor) siguen enviando sesion.usuario crudo al backend', () => {
    expect(PAGE_TSX).toContain('gestionadoPor: sesion.usuario');
    expect(PAGE_TSX).toContain('cerradoPor: sesion.usuario');
    expect(PAGE_TSX).toContain('validadoPor: sesion.usuario');
    expect(PAGE_TSX).not.toMatch(/gestionadoPor:\s*formatearUsuarioVisible/);
    expect(PAGE_TSX).not.toMatch(/cerradoPor:\s*formatearUsuarioVisible/);
  });
});
