/**
 * Ajuste "SEGUIMIENTO DE PROCESO — EL ACORDEÓN NO DEBE COLAPSARSE AL
 * NAVEGAR ENTRE SUS PROPIOS SUBMÓDULOS" (bug real reportado por el
 * usuario) — causa raíz: `onModuleChange` (LicycolbaPage) mantenía una
 * copia local `_G` a mano de qué módulos pertenecen a cada grupo del
 * acordeón, desincronizada de la lista REAL que ya usa `Sidebar`
 * (`childMap`/`asignacionesModules`) — a `_G` le faltaban
 * `'privadosTodosCerrados'` (el bug reportado, click en "Todos") y
 * `'asignacionesCerradas'` (mismo tipo de bug, no reportado pero
 * confirmado por auditoría). Corrección: ambos consumidores leen ahora
 * la MISMA constante de módulo `CHILD_MAP_ACORDEON` — nunca una segunda
 * lista mantenida a mano.
 *
 * Mismo patrón de texto fuente que el resto de *-page.test.ts (sin
 * harness de render de componentes en este repo).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, 'page.tsx'), 'utf-8');

describe('1/2/3/4) CHILD_MAP_ACORDEON.asignaciones incluye TODOS los submódulos de Seguimiento de proceso/Procesos', () => {
  it('incluye evaluacionPrivados, los 4 cerrados privados y privadosTodosCerrados', () => {
    expect(PAGE_TSX).toContain("const PRIVADOS_MODULES=['procesosPrivados','observacionPrivados','ejecucionPrivados','evaluacionPrivados',...CERRADOS_PRIVADOS_MODULES,'privadosTodosCerrados'];");
    expect(PAGE_TSX).toContain("const CERRADOS_PRIVADOS_MODULES=['privCerradosAdj','privCerradosNoAdj','privCerradosNoPres','privCerradosCanc'];");
  });
  it('ASIGNACIONES_MODULES (el grupo "asignaciones" = Seguimiento de proceso/Procesos) incluye PRIVADOS_MODULES completo + asignacionesCerradas', () => {
    expect(PAGE_TSX).toContain("const ASIGNACIONES_MODULES=[...PUBLICOS_MODULES,...PRIVADOS_MODULES,...TODOS_MODULES,'asignacionesCerradas'];");
  });
  it('CHILD_MAP_ACORDEON.asignaciones = ASIGNACIONES_MODULES (única fuente, sin re-listar módulos a mano)', () => {
    const idx = PAGE_TSX.indexOf('const CHILD_MAP_ACORDEON:Record<string,string[]>={');
    expect(idx).toBeGreaterThan(-1);
    const tramo = PAGE_TSX.slice(idx, idx + 250);
    expect(tramo).toContain('asignaciones:ASIGNACIONES_MODULES,');
  });
});

describe('Causa raíz eliminada — ya no existe la copia local duplicada (_G) en onModuleChange', () => {
  it('no queda ningún rastro de la lista "_G" hardcodeada dentro de onModuleChange', () => {
    expect(PAGE_TSX).not.toContain('const _G:Record<string,string[]>=');
  });
  it('onModuleChange calcula el acordeón a abrir usando CHILD_MAP_ACORDEON (la MISMA fuente que Sidebar), no una lista propia', () => {
    const idx = PAGE_TSX.indexOf('onModuleChange={(m)=>{');
    expect(idx).toBeGreaterThan(-1);
    const tramo = PAGE_TSX.slice(idx, idx + 900);
    expect(tramo).toContain('Object.entries(CHILD_MAP_ACORDEON).find(([,mods])=>mods.includes(m))?.[0]??null;setOpenAccordion(_tgt);');
  });
});

describe('Sidebar reutiliza la MISMA constante (childMap=CHILD_MAP_ACORDEON), sin estado duplicado', () => {
  it('childMap dentro de Sidebar es una referencia directa a CHILD_MAP_ACORDEON, no un objeto literal nuevo', () => {
    expect(PAGE_TSX).toContain('const childMap=CHILD_MAP_ACORDEON;');
  });
  it('publicosModules/privadosModules/todosModules/busquedaModules/asignacionesModules/usuariosModules dentro de Sidebar son alias de las constantes de módulo (mismo array, sin duplicar literales)', () => {
    expect(PAGE_TSX).toContain('const publicosModules=PUBLICOS_MODULES;');
    expect(PAGE_TSX).toContain('const privadosModules=PRIVADOS_MODULES;');
    expect(PAGE_TSX).toContain('const todosModules=TODOS_MODULES;');
    expect(PAGE_TSX).toContain('const busquedaModules=BUSQUEDA_MODULES;');
    expect(PAGE_TSX).toContain('const asignacionesModules=ASIGNACIONES_MODULES;');
    expect(PAGE_TSX).toContain('const usuariosModules=USUARIOS_MODULES;');
  });
});

describe('5) Navegar fuera de Seguimiento conserva el comportamiento normal del menú (otros 3 grupos intactos)', () => {
  it('CHILD_MAP_ACORDEON sigue exponiendo los 4 grupos de siempre (busqueda/solicitudes/asignaciones/usuarios), ninguno eliminado', () => {
    const idx = PAGE_TSX.indexOf('const CHILD_MAP_ACORDEON:Record<string,string[]>={');
    const tramo = PAGE_TSX.slice(idx, idx + 250);
    expect(tramo).toContain('busqueda:BUSQUEDA_MODULES,');
    expect(tramo).toContain('solicitudes:SOLICITUDES_MODULES,');
    expect(tramo).toContain('asignaciones:ASIGNACIONES_MODULES,');
    expect(tramo).toContain('usuarios:USUARIOS_MODULES,');
  });
  it('SOLICITUDES_MODULES conserva exactamente sus 4 módulos de siempre (sin alterar el flujo Solicitudes, ya cubierto por otro ajuste de esta sesión)', () => {
    expect(PAGE_TSX).toContain("const SOLICITUDES_MODULES=['solicitudesPublicas','solicitudesPrivadas','solicitudesTodas','solicitudesEliminadas'];");
  });
});

describe('6) No se altera la navegación/restricción de Mercadeo ni los permisos', () => {
  it('MODULOS_PROCESOS_BLOQUEADOS_MERCADEO y esMercadeo siguen sin relación con CHILD_MAP_ACORDEON (mecanismos independientes, ninguno tocado)', () => {
    expect(PAGE_TSX).toContain('const MODULOS_PROCESOS_BLOQUEADOS_MERCADEO = new Set([');
    expect(PAGE_TSX).toContain("if(rolActual&&esMercadeo(rolActual)&&MODULOS_PROCESOS_BLOQUEADOS_MERCADEO.has(activeModule))setActiveModule('evaluacionPrivados');");
  });
});
