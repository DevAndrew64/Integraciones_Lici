/**
 * Ajuste "SOLICITUDES ELIMINADAS — SOLO ADMINISTRADOR" (decisión
 * explícita del usuario) — 3 niveles de protección:
 *  1. NAVEGACIÓN: la opción del sidebar solo se renderiza para
 *     `isAdmin(sesion.rol)` — ya NO depende del permiso configurable
 *     `pb?.sol_ver_eliminadas` (que además fallaba abierto: `||!pb`).
 *  2. FRONTEND/ROUTING: `moduloEfectivo` (y el `useEffect` que corrige
 *     `activeModule`) redirigen a 'solicitudesTodas' si el rol activo no
 *     es Admin, aunque `activeModule` se fuerce manualmente — el
 *     componente `ModuloSolicitudesEliminadas` nunca se monta para un
 *     rol no-Admin.
 *  3. BACKEND: `GET`/`PATCH /api/deleted-solicitudes` exigen
 *     `requireAdmin` — ver `deleted-solicitudes/route.test.ts` para la
 *     cobertura 401/403/200 de ese nivel.
 * Mismo patrón de texto fuente que el resto de *-page.test.ts (sin
 * harness de render de componentes en este repo).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, 'page.tsx'), 'utf-8');

describe('1) NAVEGACIÓN — sidebar', () => {
  it('la opción "Solicitudes eliminadas" está condicionada a isAdmin(sesion.rol), no al permiso configurable pb?.sol_ver_eliminadas', () => {
    const idx = PAGE_TSX.indexOf('<span>Solicitudes eliminadas</span>');
    expect(idx).toBeGreaterThan(-1);
    const antes = PAGE_TSX.slice(Math.max(0, idx - 500), idx);
    expect(antes).toContain('{isAdmin(sesion.rol)&&');
    expect(antes).not.toContain('pb?.sol_ver_eliminadas');
  });
  it('ya no existe el fallback inseguro "||!pb" (mostraba la opción si el permiso no había cargado) para esta opción', () => {
    const idx = PAGE_TSX.indexOf('<span>Solicitudes eliminadas</span>');
    const antes = PAGE_TSX.slice(Math.max(0, idx - 500), idx);
    expect(antes).not.toContain('||!pb)&&');
  });
  it('reutiliza isAdmin de src/lib/roles.ts (ya importado), sin un array de roles nuevo tipo [\'Administrador\']', () => {
    expect(PAGE_TSX).toContain("import { esMercadeo, isAdmin, esProcesoPrivadoPorAlias, esEquipoComercial } from '@/lib/roles';");
  });
});

describe('2) FRONTEND/ROUTING — protección de montaje real, no display:none', () => {
  it('moduloEfectivo redirige a "solicitudesTodas" cuando activeModule==="solicitudesEliminadas" y el rol no es Admin', () => {
    expect(PAGE_TSX).toContain("(activeModule==='solicitudesEliminadas'&&!isAdmin(rol))?'solicitudesTodas'");
  });
  it('el redirect vive en el MISMO const moduloEfectivo que ya protege a Mercadeo (mismo mecanismo, sin duplicar lógica)', () => {
    const idx = PAGE_TSX.indexOf('const moduloEfectivo = (esMercadeo(rol)');
    expect(idx).toBeGreaterThan(-1);
    const tramo = PAGE_TSX.slice(idx, idx + 400);
    expect(tramo).toContain("MODULOS_PROCESOS_BLOQUEADOS_MERCADEO.has(activeModule))?'evaluacionPrivados'");
    expect(tramo).toContain("(activeModule==='solicitudesEliminadas'&&!isAdmin(rol))?'solicitudesTodas'");
  });
  it('el switch monta ModuloSolicitudesEliminadas sobre moduloEfectivo (nunca activeModule crudo) — un rol no-Admin jamás llega a ese case', () => {
    expect(PAGE_TSX).toContain('switch (moduloEfectivo) {');
    expect(PAGE_TSX).toContain("case 'solicitudesEliminadas': return <ModuloSolicitudesEliminadas key={rk('solicitudesEliminadas')}/>;");
  });
  it('useEffect corrige también el estado real activeModule (no solo el render) para un rol no-Admin, mismo patrón que el redirect de Mercadeo', () => {
    const idx = PAGE_TSX.indexOf("if(rolActual&&esMercadeo(rolActual)&&MODULOS_PROCESOS_BLOQUEADOS_MERCADEO.has(activeModule))setActiveModule('evaluacionPrivados');");
    expect(idx).toBeGreaterThan(-1);
    const tramo = PAGE_TSX.slice(idx, idx + 900);
    expect(tramo).toContain("if(rolActual&&activeModule==='solicitudesEliminadas'&&!isAdmin(rolActual))setActiveModule('solicitudesTodas');");
  });
});

describe('7) Forzar activeModule manualmente no debe renderizar datos eliminados', () => {
  it('el guard de moduloEfectivo se evalúa ANTES del switch (protección incondicional, no depende de que el sidebar oculte la opción)', () => {
    const idxGuard = PAGE_TSX.indexOf("const moduloEfectivo = (esMercadeo(rol)");
    const idxSwitch = PAGE_TSX.indexOf('switch (moduloEfectivo) {');
    expect(idxGuard).toBeGreaterThan(-1);
    expect(idxSwitch).toBeGreaterThan(idxGuard);
  });
});
