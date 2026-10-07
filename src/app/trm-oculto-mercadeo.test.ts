/**
 * Ajuste "TRM — NO VISIBLE NI ACCESIBLE PARA MERCADEO" (decisión explícita
 * del usuario) — 2 niveles de protección, mismo patrón ya usado para
 * "Solicitudes eliminadas — solo Administrador" y "Seguimiento de proceso
 * — navegación restringida para Mercadeo":
 *
 *  1. NAVEGACIÓN: el ítem "TRM" del Sidebar solo se renderiza cuando
 *     `!esMercadeoRol` (helper central `esMercadeo(rol)`, sin array de
 *     roles nuevo).
 *  2. MONTAJE: `moduloEfectivo` (evaluado ANTES del switch) sustituye
 *     `activeModule==='trm'` por `'dashboard'` cuando `esMercadeo(rol)` —
 *     el componente real (`ModuloTRM`) nunca llega a montarse para
 *     Mercadeo aunque `activeModule` se fuerce manualmente (DevTools,
 *     `onModuleChange('trm')` forzado, estado stale). El mismo `useEffect`
 *     que ya corrige `activeModule` para los otros 2 casos (Mercadeo en
 *     Procesos / solicitudesEliminadas) gana una tercera cláusula
 *     análoga.
 *
 * BACKEND — auditado, NO modificado en esta ronda: `/api/trm` y
 * `/api/trm/proyeccion-decimal` (`src/app/api/trm/route.ts`,
 * `src/app/api/trm/proyeccion-decimal/route.ts`) solo exigen
 * `requireSession` (cualquier sesión activa), sin gate de rol — y son
 * consumidos EXCLUSIVAMENTE por `ModuloTRM` en `page.tsx` (ningún otro
 * componente/flujo llama a estos 2 endpoints). El usuario pidió reportar
 * esto antes de tocar permisos de backend — pendiente de decisión
 * explícita, no incluido en este ajuste.
 *
 * Mismo patrón de texto fuente que el resto de *-page.test.ts (sin harness
 * de render de componentes en este repo).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, 'page.tsx'), 'utf-8');

describe('1) Mercadeo — TRM no visible en el sidebar', () => {
  it('el ítem "TRM" está condicionado a !esMercadeoRol (mismo helper central esMercadeo, sin array de roles nuevo)', () => {
    const idx = PAGE_TSX.indexOf('<span className="nav-item-text">TRM</span>');
    expect(idx).toBeGreaterThan(-1);
    const antes = PAGE_TSX.slice(Math.max(0, idx - 300), idx);
    expect(antes).toContain('{!esMercadeoRol&&(');
  });
  it('esMercadeoRol viene de esMercadeo(rol) (src/lib/roles.ts), la misma fuente ya usada para el acordeón "Seguimiento de proceso"', () => {
    expect(PAGE_TSX).toContain('const esMercadeoRol=esMercadeo(rol);');
  });
});

describe('2) Mercadeo — activeModule="trm" forzado no monta el componente (guard real de montaje, no display:none)', () => {
  it('moduloEfectivo redirige a "dashboard" cuando activeModule==="trm" y esMercadeo(rol)', () => {
    expect(PAGE_TSX).toContain("(esMercadeo(rol)&&activeModule==='trm')?'dashboard'");
  });
  it('el redirect vive en el MISMO const moduloEfectivo que ya protege Procesos/Solicitudes eliminadas para Mercadeo (mismo mecanismo, sin duplicar lógica)', () => {
    const idx = PAGE_TSX.indexOf('const moduloEfectivo = (esMercadeo(rol)');
    expect(idx).toBeGreaterThan(-1);
    const tramo = PAGE_TSX.slice(idx, idx + 500);
    expect(tramo).toContain("MODULOS_PROCESOS_BLOQUEADOS_MERCADEO.has(activeModule))?'evaluacionPrivados'");
    expect(tramo).toContain("(activeModule==='solicitudesEliminadas'&&!isAdmin(rol))?'solicitudesTodas'");
    expect(tramo).toContain("(esMercadeo(rol)&&activeModule==='trm')?'dashboard'");
  });
  it('el switch monta ModuloTRM sobre moduloEfectivo (nunca activeModule crudo) — un rol Mercadeo jamás llega a ese case', () => {
    expect(PAGE_TSX).toContain('switch (moduloEfectivo) {');
    expect(PAGE_TSX).toContain("case 'trm': return <ModuloTRM key={rk('trm')}/>;");
  });
  it('el guard de moduloEfectivo se evalúa ANTES del switch (protección incondicional, no depende de que el sidebar oculte el ítem)', () => {
    const idxGuard = PAGE_TSX.indexOf('const moduloEfectivo = (esMercadeo(rol)');
    const idxSwitch = PAGE_TSX.indexOf('switch (moduloEfectivo) {');
    expect(idxGuard).toBeGreaterThan(-1);
    expect(idxSwitch).toBeGreaterThan(idxGuard);
  });
  it('el useEffect corrige también el estado real activeModule (no solo el render) para Mercadeo — mismo patrón que los otros 2 redirects', () => {
    const idx = PAGE_TSX.indexOf("if(rolActual&&activeModule==='solicitudesEliminadas'&&!isAdmin(rolActual))setActiveModule('solicitudesTodas');");
    expect(idx).toBeGreaterThan(-1);
    const tramo = PAGE_TSX.slice(idx, idx + 900);
    expect(tramo).toContain("if(rolActual&&esMercadeo(rolActual)&&activeModule==='trm')setActiveModule('dashboard');");
  });
});

describe('3) Administrador — TRM sigue visible y accesible, sin cambios', () => {
  it('la condición del sidebar es una simple negación (!esMercadeoRol) — Administrador/Comercial/cualquier rol no-Mercadeo sigue viendo el ítem', () => {
    const idx = PAGE_TSX.indexOf('<span className="nav-item-text">TRM</span>');
    const antes = PAGE_TSX.slice(Math.max(0, idx - 300), idx);
    expect(antes).not.toMatch(/isAdmin\(|sesion\.rol===['"]Administrador['"]/);
  });
  it('moduloEfectivo no redirige "trm" para ningún rol que no sea Mercadeo (la cláusula exige esMercadeo(rol)&&... en AND, nunca solo activeModule)', () => {
    expect(PAGE_TSX).toContain("(esMercadeo(rol)&&activeModule==='trm')?'dashboard'");
    expect(PAGE_TSX).not.toMatch(/:\(activeModule==='trm'\)\?'dashboard'/);
  });
});

describe('4) Comercial y otros roles — comportamiento actual sin regresión', () => {
  it('ModuloTRM y su onClick de navegación no fueron modificados (misma clave "trm", mismo componente)', () => {
    expect(PAGE_TSX).toContain("onClick={()=>onModuleChange('trm')}");
    expect(PAGE_TSX).toContain('function ModuloTRM(){');
  });
  it('MODULOS_PROCESOS_BLOQUEADOS_MERCADEO (alcance específico de "Procesos") no fue tocado — TRM no se agregó ahí, evitando mezclar semánticas distintas', () => {
    const idx = PAGE_TSX.indexOf('const MODULOS_PROCESOS_BLOQUEADOS_MERCADEO = new Set([');
    const bloque = PAGE_TSX.slice(idx, PAGE_TSX.indexOf(']);', idx));
    expect(bloque).not.toContain("'trm'");
  });
});

describe('5) Backend — Parte A: TRM también bloqueado para Mercadeo vía requireNoMercadeo (esMercadeo, fuente única, sin array de roles nuevo)', () => {
  it('/api/trm exige requireNoMercadeo (401 sin sesión, 403 Mercadeo, sin cambios para el resto) — ya no requireSession a secas', () => {
    const route = readFileSync(join(__dirname, 'api', 'trm', 'route.ts'), 'utf-8');
    expect(route).toContain("import { requireNoMercadeo } from '@/lib/authz';");
    expect(route).toContain('requireNoMercadeo(session)');
    expect(route).not.toContain('requireSession');
  });
  it('/api/trm/proyeccion-decimal exige requireNoMercadeo, mismo helper — sin duplicar el chequeo de rol', () => {
    const route = readFileSync(join(__dirname, 'api', 'trm', 'proyeccion-decimal', 'route.ts'), 'utf-8');
    expect(route).toContain("import { requireNoMercadeo } from '@/lib/authz';");
    expect(route).toContain('requireNoMercadeo(session)');
    expect(route).not.toContain('requireSession');
  });
  it('requireNoMercadeo (src/lib/authz.ts) reutiliza esMercadeo de la fuente central @/lib/roles — 401 sin sesión, 403 solo para Mercadeo', () => {
    const authz = readFileSync(join(__dirname, '..', 'lib', 'authz.ts'), 'utf-8');
    expect(authz).toContain('export function requireNoMercadeo(session: SessionUser | null): NextResponse | null {');
    const idx = authz.indexOf('export function requireNoMercadeo(');
    const bloque = authz.slice(idx, authz.indexOf('\n}', idx));
    expect(bloque).toContain('esMercadeo(session.rol)');
    expect(bloque).toContain("status: 401");
    expect(bloque).toContain("status: 403");
  });
});

describe('No se tocaron cálculos TRM, datos históricos, Seguimiento, cierre de privados, observaciones, Solicitudes ni costos', () => {
  it('ModuloTRM conserva su lógica interna (motor ARIMA/bootstrap, fetch a /api/trm) intacta', () => {
    expect(PAGE_TSX).toContain("fetch('/api/trm?dias=15000')");
    expect(PAGE_TSX).toContain('Motor estadístico determinístico: ARIMA sobre eventos efectivos de TRM');
  });
  it('el ajuste de Mercadeo en Seguimiento de proceso (MODULOS_PROCESOS_BLOQUEADOS_MERCADEO/evaluacionPrivados) sigue intacto', () => {
    expect(PAGE_TSX).toContain("const MODULOS_PROCESOS_BLOQUEADOS_MERCADEO = new Set([");
  });
});
