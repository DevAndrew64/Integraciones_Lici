/**
 * Ajuste "ELIMINAR SELECTOR DE RESPONSABLE — COMENZAR ELABORACIÓN" — el
 * bloque amarillo "Elige sobre qué responsable ver/gestionar el detalle"
 * (y su `<select>`) se retira POR COMPLETO de `VistFichaAsignacion`, en
 * TODOS los estados (no solo CIERRE) — supera la corrección anterior
 * "SELECTOR DE RESPONSABLE — NO EXIGIR EN CIERRE" (que solo excluía la
 * etapa CIERRE de mostrarlo): ahora el selector nunca existe, en ningún
 * estado. La autorización de "Comenzar elaboración" pasa a `puedeElaborar`
 * (Administrador global O asignación propia resuelta automáticamente por
 * identidad — nunca por elección manual), ver `page.tsx` (definición junto
 * a `puedeGestionarFicha`).
 *
 * Este archivo reemplaza las pruebas de la corrección anterior (que
 * verificaban CÓMO se excluía el selector en CIERRE) por pruebas de que
 * el selector YA NO EXISTE en absoluto — conserva únicamente las
 * aserciones que seguían siendo ciertas y no dependían del selector
 * (motivo de cierre, "Ver observaciones", enrutamiento de Cerrados).
 *
 * Mismo patrón de texto fuente que el resto de *-page.test.ts (sin
 * harness de render de componentes en este repo).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, 'page.tsx'), 'utf-8');

function extraerBloque(inicioMarker: string, finMarker: string): string {
  const inicio = PAGE_TSX.indexOf(inicioMarker);
  const fin = PAGE_TSX.indexOf(finMarker, inicio);
  if (inicio === -1 || fin === -1) throw new Error(`No se encontró el bloque ${inicioMarker} → ${finMarker}`);
  return PAGE_TSX.slice(inicio, fin);
}

const BLOQUE_VISTFICHA_ASIGNACION = extraerBloque('function VistFichaAsignacion(', 'function ModuloAsignacionesPorValidar(');

describe('El selector de responsable NO existe en ningún estado (ni CIERRE ni ningún otro)', () => {
  it('el texto "Elige sobre qué responsable ver/gestionar el detalle" no existe en la ficha', () => {
    expect(BLOQUE_VISTFICHA_ASIGNACION).not.toContain('Elige sobre qué responsable ver/gestionar el detalle');
  });
  it('el texto "— Selecciona un responsable —" no existe en la ficha', () => {
    expect(BLOQUE_VISTFICHA_ASIGNACION).not.toContain('— Selecciona un responsable —');
  });
  it('requiereSeleccionPrivilegiado ya no se lee dentro de VistFichaAsignacion (el helper sigue existiendo para otros consumidores, solo no se usa aquí)', () => {
    expect(BLOQUE_VISTFICHA_ASIGNACION).not.toContain('seleccionVisible.requiereSeleccionPrivilegiado');
  });
  it('no queda ningún setter de selección manual (idAsignacionElegidaFicha) en esta ficha', () => {
    expect(BLOQUE_VISTFICHA_ASIGNACION).not.toContain('setIdAsignacionElegidaFicha');
  });
});

const ESTADOS_CANONICOS_SRC = readFileSync(join(__dirname, '..', 'lib', 'solicitudes', 'estados-canonicos.ts'), 'utf-8');

describe('B) Cerrada adjudicada → motivo del cierre visible sin seleccionar responsable', () => {
  it('el bloque de motivo del cierre usa obtenerFilaCierreTerminal(asignaciones) — el array completo, nunca depende de una fila elegida', () => {
    expect(BLOQUE_VISTFICHA_ASIGNACION).toContain('obtenerFilaCierreTerminal(asignaciones)');
    const idxMotivo = BLOQUE_VISTFICHA_ASIGNACION.indexOf("etapaGlobal==='CIERRE'&&estadoGlobalCanonico==='CERRADA'&&(()=>{");
    expect(idxMotivo).toBeGreaterThan(-1);
  });
});

describe('C) Cerrada + observaciones en varias asignaciones → "Ver observaciones" funciona sin selección', () => {
  it('totalObservacionesHistoricas/el botón "Ver observaciones" usan asignaciones (array completo), nunca asigActual', () => {
    expect(BLOQUE_VISTFICHA_ASIGNACION).toContain("const totalObservacionesHistoricas=asignaciones.reduce((s,a)=>s+safeArray(getRecordValue(a,'observaciones')).length,0);");
    expect(BLOQUE_VISTFICHA_ASIGNACION).toContain('{totalObservacionesHistoricas>0&&(');
  });
});

describe('D) Mercadeo consultando privado cerrado → sigue sin selector obligatorio (ahora nunca existe, para ningún rol)', () => {
  it('el aviso "No figuras como responsable activo" sigue oculto para Mercadeo (ajuste previo, sin relación con el selector)', () => {
    expect(BLOQUE_VISTFICHA_ASIGNACION).toContain("cargaResponsablesFicha.tipo!=='loading'&&!puedeGestionarFicha&&asignaciones.length>0&&!esMercadeo(sesion.rol)&&(");
  });
});

describe('No se modificó seleccionarAsignacionVisible (el helper puro sigue siendo el mismo, otros consumidores como ModalEditarAsignacion no se ven afectados)', () => {
  it('seleccionarAsignacionVisible sigue existiendo con la misma firma', () => {
    const src = readFileSync(join(__dirname, '..', 'lib', 'solicitudes', 'seleccion-asignacion.ts'), 'utf-8');
    expect(src).toContain('export function seleccionarAsignacionVisible<T extends AsignacionSeleccionable>(');
    expect(src).toContain('const requiereSeleccionPrivilegiado = puedeSeleccionar && !asignacionPropia && !idAsignacionElegida && universoSeleccion.length > 1;');
  });
  it('puedeGestionarFicha/puedeCerrarSolicitud no fueron tocados por este ajuste (siguen rigiendo observaciones/revisión/rechazo/cierre)', () => {
    expect(BLOQUE_VISTFICHA_ASIGNACION).toContain('const puedeGestionarFicha = (permisosBackend?.puedeRevisarProceso');
  });
  it('puedeElaborar es una regla NUEVA y más estricta, exclusiva de "Comenzar elaboración" — Admin o asignación propia, nunca administrador funcional en general', () => {
    expect(BLOQUE_VISTFICHA_ASIGNACION).toContain('const puedeElaborar = isAdmin(sesion.rol) || !!asignacionPropia;');
  });
});

describe('EN_ELABORACION/APROBADO_ELABORACION caen en la etapa EJECUCION (informativo, sin selector en ningún caso ahora)', () => {
  it('mapeo de estados canónicos sin cambios', () => {
    expect(ESTADOS_CANONICOS_SRC).toContain("EN_ELABORACION: 'EJECUCION',");
    expect(ESTADOS_CANONICOS_SRC).toContain("APROBADO_ELABORACION: 'EJECUCION',");
  });
});

describe('Cubre todas las variantes de Cerrados (mismo componente único, ModuloAsignacionesTerminadas → VistFichaAsignacion)', () => {
  it('el fix vive dentro de VistFichaAsignacion, el único componente de ficha detrás de todos los case de Cerrados', () => {
    expect(PAGE_TSX).toContain("case 'cerradosAdjudicados': return <ModuloAsignacionesTerminadas key={rk('cerradosAdjudicados')} sesion={sesion} filtroEstado='adjudicado'/>;");
    expect(PAGE_TSX).toContain("case 'cerradosNoAdjudicados': return <ModuloAsignacionesTerminadas key={rk('cerradosNoAdjudicados')} sesion={sesion} filtroEstado='noAdjudicado'/>;");
    expect(PAGE_TSX).toContain("case 'cerradosNoPresentados': return <ModuloAsignacionesTerminadas key={rk('cerradosNoPresentados')} sesion={sesion} filtroEstado='noPresentado'/>;");
    expect(PAGE_TSX).toContain("case 'cerradosCancelados': return <ModuloAsignacionesTerminadas key={rk('cerradosCancelados')} sesion={sesion} filtroEstado='cancelado'/>;");
    expect(PAGE_TSX).toContain("case 'privadosTodosCerrados': return <ModuloAsignacionesTerminadas key={rk('privadosTodosCerrados')} sesion={sesion} filtroTipo='Privado'/>;");
  });
});
