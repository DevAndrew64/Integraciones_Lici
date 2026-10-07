/**
 * Ajuste "SEGUIMIENTO DE PROCESO — NAVEGACIÓN RESTRINGIDA PARA MERCADEO" —
 * Analista Mercadeo / Asistente Mercadeo ven el acordeón "Procesos" del
 * Sidebar renombrado a "Seguimiento de proceso", con SOLO 3 vistas
 * (Privados / En evaluación, Cerrados, Todos) — nunca Públicos, ni
 * Por validar/En observación/En ejecución de Privados, ni el "Todos" mixto
 * Público+Privado que ya existe para el resto de roles. Comercial y
 * Administrador conservan la estructura completa sin cambios.
 *
 * Seguridad: no basta con ocultar el enlace — `moduloEfectivo` (antes del
 * `switch` que renderiza cada módulo) sustituye cualquier módulo de
 * Procesos no permitido por 'evaluacionPrivados' para Mercadeo, así que el
 * componente real nunca llega a montarse aunque `activeModule` se fuerce
 * desde fuera del Sidebar (DevTools, o un callback interno como
 * `onModuleChange('asignacionesCerradas')` tras cerrar un proceso).
 *
 * Mismo patrón de texto fuente que el resto de *-page.test.ts (sin harness
 * de render de componentes en este repo).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, 'page.tsx'), 'utf-8');

describe('Sidebar — esMercadeoRol determina etiqueta y estructura de "Procesos"', () => {
  it('usa esMercadeo(rol) del módulo neutral src/lib/roles.ts — el mismo helper que ya usa el backend para permisos de cierre, nunca un array de roles paralelo', () => {
    // El import ahora trae también isAdmin/esProcesoPrivadoPorAlias (ajuste
    // "SEGUIMIENTO — MERCADEO", historial de anotaciones) — esMercadeo
    // sigue viniendo de la misma fuente única @/lib/roles, sin cambios.
    expect(PAGE_TSX).toContain("import { esMercadeo, isAdmin, esProcesoPrivadoPorAlias, esEquipoComercial } from '@/lib/roles';");
    expect(PAGE_TSX).toContain('const esMercadeoRol=esMercadeo(rol);');
  });

  it('la etiqueta del acordeón es "Seguimiento de proceso" para Mercadeo y "Procesos" para todos los demás roles', () => {
    expect(PAGE_TSX).toContain("<span className=\"nav-item-text\">{esMercadeoRol?'Seguimiento de proceso':'Procesos'}</span>");
  });

  it('para Mercadeo, el sub-nav NUNCA renderiza los encabezados "Públicos" ni el "Todos" mixto — solo "Privados"', () => {
    const idxRama = PAGE_TSX.indexOf('{esMercadeoRol?(<>');
    const idxCierreRama = PAGE_TSX.indexOf('</>):(<>', idxRama);
    expect(idxRama).toBeGreaterThan(-1);
    expect(idxCierreRama).toBeGreaterThan(idxRama);
    const ramaMercadeo = PAGE_TSX.slice(idxRama, idxCierreRama);
    expect(ramaMercadeo).not.toContain('<span>Públicos</span>');
    expect(ramaMercadeo).not.toContain('<span>Por validar</span>');
    expect(ramaMercadeo).not.toContain('<span>En observación</span>');
    expect(ramaMercadeo).not.toContain('<span>En ejecución</span>');
    expect(ramaMercadeo).toContain('<span>Privados</span>');
    expect(ramaMercadeo).toContain('En evaluación');
    expect(ramaMercadeo).toContain('<span>Cerrados</span>');
    expect(ramaMercadeo).toContain('<span>Todos</span>');
  });

  it('"Privados / En evaluación" para Mercadeo apunta a evaluacionPrivados (mismo módulo/filtroTipo="Privado" que ya usa Comercial)', () => {
    const idxRama = PAGE_TSX.indexOf('{esMercadeoRol?(<>');
    const idxCierreRama = PAGE_TSX.indexOf('</>):(<>', idxRama);
    const ramaMercadeo = PAGE_TSX.slice(idxRama, idxCierreRama);
    expect(ramaMercadeo).toContain("onClick={()=>onModuleChange('evaluacionPrivados')}");
  });

  it('"Privados / Cerrados" para Mercadeo reutiliza los mismos 4 sub-ítems (privCerradosAdj/NoAdj/NoPres/Canc) que ya usa Comercial — sin duplicar lógica de fetch', () => {
    const idxRama = PAGE_TSX.indexOf('{esMercadeoRol?(<>');
    const idxCierreRama = PAGE_TSX.indexOf('</>):(<>', idxRama);
    const ramaMercadeo = PAGE_TSX.slice(idxRama, idxCierreRama);
    expect(ramaMercadeo).toContain("onClick={()=>onModuleChange('privCerradosAdj')}");
    expect(ramaMercadeo).toContain("onClick={()=>onModuleChange('privCerradosNoAdj')}");
    expect(ramaMercadeo).toContain("onClick={()=>onModuleChange('privCerradosNoPres')}");
    expect(ramaMercadeo).toContain("onClick={()=>onModuleChange('privCerradosCanc')}");
  });

  it('"Privados / Todos" para Mercadeo apunta a un módulo NUEVO y DISTINTO del "Todos" mixto existente (nunca reutiliza asignacionesPorValidar/procesosEnObservacion/etc, que mezclan Público+Privado)', () => {
    const idxRama = PAGE_TSX.indexOf('{esMercadeoRol?(<>');
    const idxCierreRama = PAGE_TSX.indexOf('</>):(<>', idxRama);
    const ramaMercadeo = PAGE_TSX.slice(idxRama, idxCierreRama);
    expect(ramaMercadeo).toContain("onModuleChange('privadosTodosCerrados')");
    expect(ramaMercadeo).not.toContain('asignacionesPorValidar');
    expect(ramaMercadeo).not.toContain('procesosEnObservacion');
    expect(ramaMercadeo).not.toContain('procesosEnEjecucion');
    expect(ramaMercadeo).not.toContain('procesosEnEvaluacion');
  });

  it('al hacer click en "Privados / Todos" se cierra el desglose de "Cerrados" si estaba abierto (feedback en vivo, captura real) — Todos es una fila hermana, no parte del desglose', () => {
    const idxRama = PAGE_TSX.indexOf('{esMercadeoRol?(<>');
    const idxCierreRama = PAGE_TSX.indexOf('</>):(<>', idxRama);
    const ramaMercadeo = PAGE_TSX.slice(idxRama, idxCierreRama);
    expect(ramaMercadeo).toContain("onClick={()=>{setSubOpenSub(null);onModuleChange('privadosTodosCerrados');}}");
  });

  it('la rama de los demás roles (Comercial/Administrador) conserva Públicos, Privados (5 etapas) y el Todos mixto, sin ningún cambio', () => {
    const idxCierreRama = PAGE_TSX.indexOf('</>):(<>');
    const idxFinBloque = PAGE_TSX.indexOf('{/* ── Cronogramas ── */}');
    const ramaResto = PAGE_TSX.slice(idxCierreRama, idxFinBloque);
    expect(ramaResto).toContain('<span>Públicos</span>');
    expect(ramaResto).toContain("onClick={()=>onModuleChange('procesosPrivados')}");
    expect(ramaResto).toContain("onClick={()=>onModuleChange('observacionPrivados')}");
    expect(ramaResto).toContain("onClick={()=>onModuleChange('ejecucionPrivados')}");
    expect(ramaResto).toContain('<span>Todos</span>');
    expect(ramaResto).toContain("onClick={()=>onModuleChange('asignacionesPorValidar')}");
  });
});

describe('Render — moduloEfectivo bloquea módulos de Procesos no permitidos para Mercadeo ANTES del switch', () => {
  it('existe el Set MODULOS_PROCESOS_BLOQUEADOS_MERCADEO con exactamente los módulos de Públicos/Privados-otras-etapas/Todos-mixto', () => {
    expect(PAGE_TSX).toContain('const MODULOS_PROCESOS_BLOQUEADOS_MERCADEO = new Set([');
    const idx = PAGE_TSX.indexOf('const MODULOS_PROCESOS_BLOQUEADOS_MERCADEO = new Set([');
    const bloque = PAGE_TSX.slice(idx, PAGE_TSX.indexOf(']);', idx));
    for (const modulo of [
      'procesosPublicos', 'observacionPublicos', 'ejecucionPublicos', 'evaluacionPublicos',
      'pubCerradosAdj', 'pubCerradosNoAdj', 'pubCerradosNoPres', 'pubCerradosCanc',
      'procesosPrivados', 'observacionPrivados', 'ejecucionPrivados',
      'asignacionesPorValidar', 'procesosEnObservacion', 'procesosEnEjecucion', 'procesosEnEvaluacion',
      'cerradosAdjudicados', 'cerradosNoAdjudicados', 'cerradosNoPresentados', 'cerradosCancelados',
      'asignacionesCerradas',
    ]) {
      expect(bloque).toContain(`'${modulo}'`);
    }
    // Nunca los 6 módulos permitidos.
    expect(bloque).not.toContain("'evaluacionPrivados'");
    expect(bloque).not.toContain("'privCerradosAdj'");
    expect(bloque).not.toContain("'privadosTodosCerrados'");
  });

  it('moduloEfectivo sustituye el módulo bloqueado por evaluacionPrivados SOLO si esMercadeo(rol) — el switch nunca usa activeModule directo', () => {
    // Ajuste "SOLICITUDES ELIMINADAS — SOLO ADMINISTRADOR" agregó una
    // segunda cláusula a este mismo ternario (redirect a
    // 'solicitudesTodas' para no-Admin) — la cláusula de Mercadeo sigue
    // siendo la MISMA, solo cambió el formato a multilínea.
    const idx = PAGE_TSX.indexOf('const moduloEfectivo = (esMercadeo(rol)');
    expect(idx).toBeGreaterThan(-1);
    const tramo = PAGE_TSX.slice(idx, idx + 300);
    expect(tramo).toContain("MODULOS_PROCESOS_BLOQUEADOS_MERCADEO.has(activeModule))?'evaluacionPrivados'");
    expect(PAGE_TSX).toContain('switch (moduloEfectivo) {');
  });

  it('case privadosTodosCerrados renderiza ModuloAsignacionesTerminadas con filtroTipo=\'Privado\' y SIN filtroEstado (todos los resultados de cierre combinados)', () => {
    expect(PAGE_TSX).toContain("case 'privadosTodosCerrados': return <ModuloAsignacionesTerminadas key={rk('privadosTodosCerrados')} sesion={sesion} filtroTipo='Privado'/>;");
  });
});

describe('src/lib/roles.ts — fuente única de esMercadeo, reutilizada por frontend y backend', () => {
  it('src/lib/authz.ts re-exporta esMercadeo desde @/lib/roles en vez de definirlo localmente (una sola fuente de verdad)', () => {
    const authz = readFileSync(join(__dirname, '..', 'lib', 'authz.ts'), 'utf-8');
    expect(authz).toContain("export { normalizeRole, isAdmin, esAdministradorProcesos, esMercadeo, esEquipoComercial } from '@/lib/roles';");
    expect(authz).not.toContain("const ROLES_MERCADEO = new Set(['analista mercadeo', 'asistente mercadeo']);");
  });

  it('src/lib/roles.ts no importa nada server-only (ni @/lib/prisma ni next/server) — seguro para un componente \'use client\'', () => {
    const roles = readFileSync(join(__dirname, '..', 'lib', 'roles.ts'), 'utf-8');
    expect(roles).not.toContain("from '@/lib/prisma'");
    expect(roles).not.toContain("from 'next/server'");
    expect(roles).toContain('export function esMercadeo(rol: string): boolean {');
  });
});
