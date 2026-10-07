/**
 * Ajuste "RESPONSABLES ASIGNADOS — SOLO LECTURA DESDE SOLICITUDES"
 * (decisión explícita del usuario) — `VistFicha` es la ficha EXCLUSIVA
 * del módulo Solicitudes (único call site en todo `page.tsx`, vía
 * `ModuloSolicitudesAbiertasBase` — Procesos públicos/privados/Todas las
 * solicitudes/Rechazadas comparten este mismo componente). `puedeAsignar`
 * pasa a ser una constante `false` (desacople de UI real, nunca un
 * `display:none`): ningún botón con `onClick` que dispare una mutación
 * de `asignaciones` llega a renderizarse desde esta ficha, sin tocar el
 * endpoint compartido `PATCH /api/solicitudes` (sigue funcionando igual
 * para Procesos vía `VistFichaAsignacion`, un componente COMPLETAMENTE
 * distinto y sin ninguna variable `puedeAsignar` propia).
 *
 * Mismo patrón de texto fuente que el resto de *-page.test.ts (sin
 * harness de render de componentes en este repo).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, 'page.tsx'), 'utf-8');

function extraerVistFicha(): string {
  const inicio = PAGE_TSX.indexOf('function VistFicha(');
  const fin = PAGE_TSX.indexOf('function VistFichaBusqueda(', inicio);
  if (inicio === -1 || fin === -1) throw new Error('No se encontró VistFicha en page.tsx');
  return PAGE_TSX.slice(inicio, fin);
}
const BLOQUE_VISTFICHA = extraerVistFicha();

function extraerVistFichaAsignacion(): string {
  const inicio = PAGE_TSX.indexOf('function VistFichaAsignacion(');
  const fin = PAGE_TSX.indexOf('function ModuloAsignacionesPorValidar(', inicio);
  if (inicio === -1 || fin === -1) throw new Error('No se encontró VistFichaAsignacion en page.tsx');
  return PAGE_TSX.slice(inicio, fin);
}
const BLOQUE_ASIGNACION = extraerVistFichaAsignacion();

describe('Componente/contexto — VistFicha es exclusivo del módulo Solicitudes', () => {
  it('VistFicha tiene un único call site en todo page.tsx (ModuloSolicitudesAbiertasBase)', () => {
    const usos = PAGE_TSX.match(/<VistFicha /g) ?? [];
    expect(usos.length).toBe(1);
  });
  it('ModuloSolicitudesProcesosPublicos/Privados/Todas/Rechazadas comparten ModuloSolicitudesAbiertasBase (mismo puedeAsignar=false para las 4 variantes)', () => {
    expect(PAGE_TSX).toContain('return <ModuloSolicitudesAbiertasBase sesion={sesion} variante="COMERCIAL" filtroTipo="Público"/>;');
    expect(PAGE_TSX).toContain('return <ModuloSolicitudesAbiertasBase sesion={sesion} variante="COMERCIAL" filtroTipo="Privado"/>;');
    expect(PAGE_TSX).toContain('return <ModuloSolicitudesAbiertasBase sesion={sesion} variante="TODAS" filtroTipo="todos" busquedaInicial={busquedaInicial}/>;');
    expect(PAGE_TSX).toContain('return <ModuloSolicitudesAbiertasBase sesion={sesion} variante="RECHAZADA" filtroTipo="todos"/>;');
  });
});

describe('Regla de vistas públicas/privadas — sin filtro por asignaciones', () => {
  it('la vista pública/privada no excluye solicitudes por tener asignaciones', () => {
    expect(PAGE_TSX).toContain('Filtro temporal desactivado: la vista de públicos/privados debe mostrar');
    expect(PAGE_TSX).not.toMatch(/const asigs=safeArray<Record<string,unknown>>\(s\.asignaciones\);\s*if\(asigs\.length>0\)\s*return false;/m);
  });
  it('la clasificación por aliasFuente se mantiene igual', () => {
    expect(PAGE_TSX).toContain("if(alias==='S1'||alias==='S2')return'Público';");
    expect(PAGE_TSX).toContain("return'Privado';");
  });
});

describe('1) Ficha abierta desde Solicitudes — responsables visibles, sin controles de mutación', () => {
  it('puedeAsignar es una constante false (nunca depende de rol/permisosRol) dentro de VistFicha', () => {
    expect(BLOQUE_VISTFICHA).toContain('const puedeAsignar=false;');
    expect(BLOQUE_VISTFICHA).not.toContain("['Administrador','Director Comercial','Coordinador Comercial'].includes(sesion.rol)");
  });
  it('los responsables (usuario, cargo) se siguen mostrando — solo se ocultan los controles de mutación', () => {
    // Ajuste "FORMATO VISIBLE DE USERNAMES" — el nombre ahora pasa por
    // formatearUsuarioVisible (misma fuente cruda a.analistaAsignado, solo
    // presentación). Ajuste "OCULTAR ID TÉCNICO DE ASIGNACIÓN" — idAsignacion
    // (identificador interno tipo "ASG-01", sin valor de negocio) ya no se
    // muestra junto al cargo en esta ficha; sigue existiendo y usándose
    // igual internamente (keys, lookups, payloads) — solo se retiró del
    // texto renderizado aquí.
    expect(BLOQUE_VISTFICHA).toContain("{formatearUsuarioVisible(String(a.analistaAsignado||''))||'—'}");
    expect(BLOQUE_VISTFICHA).toContain("{String(a.analistaCargo||'')}</div>");
    expect(BLOQUE_VISTFICHA).not.toContain('{String(a.analistaCargo||\'\')} · {String(a.idAsignacion||\'\')}');
  });
  it('botón "+ Agregar" queda estructuralmente inalcanzable: gateado por puedeAsignar, que siempre es false', () => {
    const idx = BLOQUE_VISTFICHA.indexOf('>+ Agregar</button>');
    expect(idx).toBeGreaterThan(-1);
    const antes = BLOQUE_VISTFICHA.slice(Math.max(0, idx - 700), idx);
    expect(antes).toContain('{!asignacionBloqueada&&puedeAsignar&&(');
  });
  it('botón de quitar (✕) por responsable queda estructuralmente inalcanzable: mismo gate puedeAsignar', () => {
    const idx = BLOQUE_VISTFICHA.indexOf("asignaciones.filter((_,idx)=>idx!==i)");
    expect(idx).toBeGreaterThan(-1);
    const antes = BLOQUE_VISTFICHA.slice(Math.max(0, idx - 300), idx);
    expect(antes).toContain('{!asignacionBloqueada&&puedeAsignar&&(');
  });
  it('el bloque completo de reasignación/"Asignar responsable de revisión" queda estructuralmente inalcanzable: mismo gate puedeAsignar', () => {
    const idx = BLOQUE_VISTFICHA.indexOf('Asignar responsable de revisión');
    expect(idx).toBeGreaterThan(-1);
    const antes = BLOQUE_VISTFICHA.slice(Math.max(0, idx - 1000), idx);
    expect(antes).toContain('):puedeAsignar?(');
  });
});

describe('2/3) Cualquier rol dentro de Solicitudes — incluido Administrador — es solo lectura', () => {
  it('la constante false no distingue rol: no hay ninguna condición role-based envolviendo puedeAsignar dentro de VistFicha', () => {
    const idx = BLOQUE_VISTFICHA.indexOf('const puedeAsignar=false;');
    const contexto = BLOQUE_VISTFICHA.slice(Math.max(0, idx - 150), idx);
    expect(contexto).not.toMatch(/rol===['"]Administrador['"]/);
    expect(contexto).not.toMatch(/isAdmin\(/);
  });
});

describe('4) Ficha abierta desde Procesos (VistFichaAsignacion) — mantiene los controles existentes, sin tocar', () => {
  it('VistFichaAsignacion NO declara ninguna variable local puedeAsignar (arquitectura distinta, nunca compartida con VistFicha)', () => {
    expect(BLOQUE_ASIGNACION).not.toContain('const puedeAsignar');
  });
  it('VistFichaAsignacion no fue tocado por este ajuste: sin la constante puedeAsignar=false ni el comentario de este cambio', () => {
    expect(BLOQUE_ASIGNACION).not.toContain('const puedeAsignar=false;');
    expect(BLOQUE_ASIGNACION).not.toContain('RESPONSABLES ASIGNADOS — SOLO LECTURA DESDE SOLICITUDES');
  });
});

describe('5) El endpoint compartido PATCH /api/solicitudes no fue modificado', () => {
  it('el mismo endpoint sigue siendo llamado (código fuente intacto) — la restricción es 100% de UI en VistFicha, nunca de backend', () => {
    expect(BLOQUE_VISTFICHA).toContain("const res=await fetch('/api/solicitudes',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:sol.id,estadoSolicitud:nuevoEstado,asignaciones:nuevasAsig})});");
  });
});

describe('6) Forzar acciones desde Solicitudes no ejecuta handlers de mutación', () => {
  it('la llamada fetch de "quitar responsable" vive EXCLUSIVAMENTE dentro del bloque gateado por puedeAsignar (siempre false) — nunca alcanzable desde el árbol de render', () => {
    const idxDefine = BLOQUE_VISTFICHA.indexOf('const puedeAsignar=false;');
    const idxGate = BLOQUE_VISTFICHA.search(/!\s*asignacionBloqueada\s*&&\s*puedeAsignar\s*&&\s*\(/m);
    const idxFetch = BLOQUE_VISTFICHA.indexOf("fetch('/api/solicitudes',{method:'PATCH'");
    expect(idxDefine).toBeGreaterThan(-1);
    expect(idxGate).toBeGreaterThan(-1);
    expect(idxFetch).toBeGreaterThan(idxDefine);
    expect(idxFetch).toBeGreaterThan(idxGate);
    expect(BLOQUE_VISTFICHA).toContain('!asignacionBloqueada&&puedeAsignar&&');
    expect(BLOQUE_VISTFICHA).toContain("fetch('/api/solicitudes',{method:'PATCH'");
  });
  it('el botón "Asignar responsable" (formulario completo) también vive dentro del branch gateado por puedeAsignar', () => {
    const idxGate = BLOQUE_VISTFICHA.indexOf('):puedeAsignar?(');
    const idxBoton = BLOQUE_VISTFICHA.indexOf('onClick={asignar} disabled={asignando||!responsable}');
    expect(idxGate).toBeGreaterThan(-1);
    expect(idxBoton).toBeGreaterThan(idxGate);
  });
});
