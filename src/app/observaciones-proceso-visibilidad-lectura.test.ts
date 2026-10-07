/**
 * Ajuste "CIERRE — NO USAR asigActual COMO GATE" (bug real reportado: el
 * bloque "Resultado / Adjudicado" se veía bien en el primer render y
 * saltaba a "Motivo del cierre" / fallback en cuanto terminaba de cargar
 * el detalle completo con 2+ asignaciones) — en `VistFichaAsignacion`, el
 * bloque de cierre para un proceso CERRADA usa AHORA variables LOCALES,
 * derivadas de `filaCierreTerminal` (`obtenerFilaCierreTerminal(asignaciones)`,
 * el array COMPLETO), nunca de `asigActual`:
 *
 *   const resultadoFinalCierre = safeString(filaCierreTerminal?.resultadoFinal);
 *   const tipoCausaCierre      = safeString(filaCierreTerminal?.tipoCausa);
 *   const causaEspecificaCierre = safeString(filaCierreTerminal?.causaEspecifica, '—');
 *
 * Las variables GLOBALES del componente (`resultadoFinalTexto`/
 * `tipoCausaTexto`/`causaEspecificaTexto`, derivadas de `asigActual`) NO se
 * tocaron — siguen alimentando otros bloques legítimamente atados a la
 * fila activa del viewer (ej. el badge "Causa registrada" de
 * EN_OBSERVACION). Solo el bloque de cierre dejó de usarlas.
 *
 * CAUSA RAÍZ del bug: `asigActual` (`seleccionVisible.asigActual ?? {}`)
 * puede resolver vacío cuando hay 2+ asignaciones (reasignación) y el
 * viewer no es responsable de ninguna ni eligió una explícitamente
 * (`seleccionarAsignacionVisible`, `requiereSeleccionPrivilegiado`). En el
 * primer render (datos parciales, 1 sola fila visible) autoseleccionaba
 * esa fila y el bloque se veía bien; al terminar de cargar el detalle
 * completo (2 filas reales), dejaba de autoseleccionar y `asigActual`
 * volvía a `{}` — el bloque de cierre "saltaba" a la rama incorrecta.
 * `filaCierreTerminal` nunca tuvo ese problema (no depende de identidad
 * del viewer), pero el GATE (`resultadoFinalTexto`/`tipoCausaTexto`) sí lo
 * heredaba — este ajuste corrige exactamente eso.
 *
 * Regla final del bloque:
 *  - `resultadoFinalCierre` existe → "Resultado" + el literal; si además
 *    `cierreTextoFilaTerminal` existe → se agrega "Detalle del cierre"
 *    (nunca reemplaza "Resultado");
 *  - si no, `tipoCausaCierre` existe → causa gerencial (sin cambios de
 *    presentación);
 *  - si ninguno de los dos → "Motivo del cierre" con
 *    `cierreTextoFilaTerminal` o el fallback neutro.
 *  - `cierreTextoFilaTerminal = obtenerObservacionCierreTerminal(filaCierreTerminal)`
 *    (un único cálculo, reutilizado en ambas ramas) — el propio helper
 *    decide qué campo leer según `estadoRevision` de esa fila
 *    (`observacionResultado` solo para CERRADO_ADJUDICADO/
 *    CERRADO_NO_ADJUDICADO, la prioridad de rechazo para el resto).
 *
 * NO se tocó: backend, payloads de cierre, permisos,
 * `seleccionarAsignacionVisible`, selector de responsable,
 * `obtenerFilaCierreTerminal`, prioridad de `obtenerObservacionCierreTerminal`,
 * observaciones comerciales, ni el badge EN_OBSERVACION (que sí usa la
 * fila activa a propósito).
 *
 * Mismo patrón de texto fuente que el resto de *-page.test.ts (sin harness
 * de render de componentes en este repo).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { obtenerObservacionCierreTerminal, obtenerFilaCierreTerminal } from '@/lib/solicitudes/observacion-cierre-terminal';

const PAGE_TSX = readFileSync(join(__dirname, 'page.tsx'), 'utf-8');

function extraerBloque(inicioMarker: string, finMarker: string): string {
  const inicio = PAGE_TSX.indexOf(inicioMarker);
  const fin = PAGE_TSX.indexOf(finMarker, inicio);
  if (inicio === -1 || fin === -1) throw new Error(`No se encontró el bloque ${inicioMarker} → ${finMarker}`);
  return PAGE_TSX.slice(inicio, fin);
}

const BLOQUE_VISTFICHA = extraerBloque('function VistFicha(', 'function VistFichaBusqueda(');
const BLOQUE_VISTFICHA_BUSQUEDA = extraerBloque('function VistFichaBusqueda(', 'function DptoMultiSelect(');
const BLOQUE_VISTFICHA_ASIGNACION = extraerBloque('function VistFichaAsignacion(', 'function ModuloAsignacionesPorValidar(');
const BLOQUE_MODAL_HISTORIAL = extraerBloque('function ModalHistorialObservaciones(', '/* =========================================================\n   VISTA FICHA DE ASIGNACIÓN');
const BLOQUE_MOTIVO_CIERRE = extraerBloque("{etapaGlobal==='CIERRE'&&estadoGlobalCanonico==='CERRADA'&&(()=>{", "{totalObservacionesHistoricas>0&&(");

describe('Variables locales del bloque de cierre — nunca asigActual', () => {
  it('filaCierreTerminal, cierreTextoFilaTerminal, resultadoFinalCierre, tipoCausaCierre y causaEspecificaCierre se calculan dentro del bloque, todas desde filaCierreTerminal', () => {
    expect(BLOQUE_MOTIVO_CIERRE).toContain('const filaCierreTerminal = obtenerFilaCierreTerminal(asignaciones);');
    expect(BLOQUE_MOTIVO_CIERRE).toContain('const cierreTextoFilaTerminal = filaCierreTerminal ? obtenerObservacionCierreTerminal(filaCierreTerminal) : null;');
    expect(BLOQUE_MOTIVO_CIERRE).toContain('const resultadoFinalCierre = safeString(filaCierreTerminal?.resultadoFinal);');
    expect(BLOQUE_MOTIVO_CIERRE).toContain('const tipoCausaCierre = safeString(filaCierreTerminal?.tipoCausa);');
    expect(BLOQUE_MOTIVO_CIERRE).toContain("const causaEspecificaCierre = safeString(filaCierreTerminal?.causaEspecifica, '—');");
  });
  it('el bloque NUNCA lee asigActual — ni para el gate ni para el texto', () => {
    expect(BLOQUE_MOTIVO_CIERRE).not.toContain('asigActual');
  });
  it('el JSX del bloque usa exclusivamente las variables locales *Cierre, nunca las globales resultadoFinalTexto/tipoCausaTexto/causaEspecificaTexto', () => {
    expect(BLOQUE_MOTIVO_CIERRE).not.toContain('resultadoFinalTexto');
    expect(BLOQUE_MOTIVO_CIERRE).not.toContain('tipoCausaTexto');
    expect(BLOQUE_MOTIVO_CIERRE).not.toContain('causaEspecificaTexto');
  });
  it('las variables globales (usadas por el badge EN_OBSERVACION) siguen existiendo sin cambios, fuera de este bloque', () => {
    expect(BLOQUE_VISTFICHA_ASIGNACION).toContain('const resultadoFinalTexto = safeString(asigActual.resultadoFinal);');
    expect(BLOQUE_VISTFICHA_ASIGNACION).toContain('const tipoCausaTexto = safeString(asigActual.tipoCausa);');
    expect(BLOQUE_VISTFICHA_ASIGNACION).toContain("estadoGlobalCanonico==='EN_OBSERVACION'&&tipoCausaTexto&&(");
  });
});

describe('A) Múltiples asignaciones + Admin sin selección + fila terminal Adjudicado → siempre "Resultado / Adjudicado"', () => {
  it('obtenerFilaCierreTerminal encuentra la fila CERRADO_ADJUDICADO sin importar cuántas filas no-terminales haya, ni quién sea el viewer', () => {
    const filaSinSeleccion1 = { idAsignacion: '1', estadoRevision: 'EN_ELABORACION', analistaAsignado: 'juan.davila' };
    const filaSinSeleccion2 = { idAsignacion: '2', estadoRevision: 'EN_ELABORACION', analistaAsignado: 'laura.buelvas' };
    const filaAdjudicada = { idAsignacion: '3', estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Adjudicado', fechaCierre: '2026-07-06T10:00:00.000Z' };
    const fila = obtenerFilaCierreTerminal([filaSinSeleccion1, filaSinSeleccion2, filaAdjudicada]);
    expect(fila).toBe(filaAdjudicada);
    expect(fila?.resultadoFinal).toBe('Adjudicado');
  });
  it('resultadoFinalCierre se lee de filaCierreTerminal?.resultadoFinal — no de una fila "activa" que pueda no existir', () => {
    expect(BLOQUE_MOTIVO_CIERRE).toContain('const resultadoFinalCierre = safeString(filaCierreTerminal?.resultadoFinal);');
  });
});

describe('B) Después de cargar 2 asignaciones → el bloque NO cambia a "Motivo del cierre"', () => {
  it('el gate de "Resultado"/"Detalle del cierre" depende SOLO de resultadoFinalCierre — nunca de si hay 1 o 2+ filas en el array completo', () => {
    const idx = BLOQUE_MOTIVO_CIERRE.indexOf('{resultadoFinalCierre&&<div');
    expect(idx).toBeGreaterThan(-1);
  });
  it('la rama "Motivo del cierre" solo se activa cuando NI resultadoFinalCierre NI tipoCausaCierre existen — no por la cantidad de asignaciones', () => {
    expect(BLOQUE_MOTIVO_CIERRE).toContain('{!resultadoFinalCierre&&!tipoCausaCierre&&(');
  });
});

describe('C) Múltiples asignaciones + No adjudicado → "Resultado / No adjudicado"', () => {
  it('el helper de fila terminal encuentra CERRADO_NO_ADJUDICADO igual que ADJUDICADO (mismo Set de estados terminales)', () => {
    const filaSinSeleccion = { idAsignacion: '1', estadoRevision: 'EN_ELABORACION' };
    const filaNoAdjudicada = { idAsignacion: '2', estadoRevision: 'CERRADO_NO_ADJUDICADO', resultadoFinal: 'No adjudicado' };
    const fila = obtenerFilaCierreTerminal([filaSinSeleccion, filaNoAdjudicada]);
    expect(fila?.resultadoFinal).toBe('No adjudicado');
  });
});

describe('D) Fila activa (asigActual) vacía pero fila terminal válida → el bloque de cierre sigue correcto', () => {
  it('obtenerFilaCierreTerminal no depende de asignacionPropia/identidad — encuentra la fila terminal aunque asigActual resuelva {}', () => {
    // Simula exactamente el escenario real: 2+ filas, viewer sin fila
    // propia, sin selección explícita → seleccionarAsignacionVisible()
    // devolvería asigActual=null/{}, pero obtenerFilaCierreTerminal igual
    // encuentra la fila terminal por estadoRevision, sin usar identidad.
    const filas = [
      { idAsignacion: '1', estadoRevision: 'EN_ELABORACION', analistaAsignado: 'analista.uno' },
      { idAsignacion: '2', estadoRevision: 'EN_ELABORACION', analistaAsignado: 'analista.dos' },
      { idAsignacion: '3', estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Adjudicado', observacionResultado: 'Cumplió todos los requisitos.' },
    ];
    const fila = obtenerFilaCierreTerminal(filas);
    expect(fila?.resultadoFinal).toBe('Adjudicado');
    expect(obtenerObservacionCierreTerminal(fila)).toBe('Cumplió todos los requisitos.');
  });
});

describe('E) Rechazo/cancelación → sigue mostrando "Motivo del cierre" correctamente', () => {
  it('motivoRechazo (rechazo simple) sigue teniendo prioridad 1', () => {
    expect(obtenerObservacionCierreTerminal({ estadoRevision: 'RECHAZADO', motivoRechazo: 'No cumple requisitos técnicos' })).toBe('No cumple requisitos técnicos');
  });
  it('detalleCierreDirecto (cancelación/cierre directo) tiene prioridad sobre causaNoPresentacion', () => {
    expect(obtenerObservacionCierreTerminal({ estadoRevision: 'CANCELADO', causaNoPresentacion: 'Cancelación por la entidad', detalleCierreDirecto: 'La entidad canceló el proceso.' })).toBe('La entidad canceló el proceso.');
  });
  it('la sección "Motivo del cierre" sigue usando cierreTextoFilaTerminal (mismo cálculo que "Detalle del cierre", sin duplicar)', () => {
    expect(BLOQUE_MOTIVO_CIERRE).toContain("{cierreTextoFilaTerminal||'No se encontró un motivo de cierre registrado.'}");
  });
});

describe('F) Causa gerencial → conserva su rama actual, ahora también sin depender de asigActual', () => {
  it('la línea tipoCausaCierre → causaEspecificaCierre existe, con las variables locales', () => {
    expect(BLOQUE_MOTIVO_CIERRE).toContain('{tipoCausaCierre&&<div');
    expect(BLOQUE_MOTIVO_CIERRE).toContain('{tipoCausaCierre} → {causaEspecificaCierre}');
  });
  it('cuando tipoCausaCierre existe, "Motivo del cierre" no se evalúa (misma exclusión mutua de siempre, ahora con variables locales)', () => {
    expect(BLOQUE_MOTIVO_CIERRE).toContain('{!resultadoFinalCierre&&!tipoCausaCierre&&(');
  });
});

describe('G) Sin dependencia de responsableSeleccionado/selector para la lectura del cierre', () => {
  it('el bloque de cierre no referencia idAsignacionElegidaFicha ni seleccionVisible', () => {
    expect(BLOQUE_MOTIVO_CIERRE).not.toContain('idAsignacionElegidaFicha');
    expect(BLOQUE_MOTIVO_CIERRE).not.toContain('seleccionVisible');
  });
  it('seleccionarAsignacionVisible (el helper del selector) no fue tocado', () => {
    const src = readFileSync(join(__dirname, '..', 'lib', 'solicitudes', 'seleccion-asignacion.ts'), 'utf-8');
    expect(src).toContain('export function seleccionarAsignacionVisible<T extends AsignacionSeleccionable>(');
  });
});

describe('"Detalle del cierre" — solo cuando hay resultado Y texto (sin fallback en esta rama)', () => {
  it('gateado por resultadoFinalCierre&&cierreTextoFilaTerminal — nunca se renderiza vacío ni con el fallback de "Motivo del cierre"', () => {
    const idx = BLOQUE_MOTIVO_CIERRE.indexOf('{resultadoFinalCierre&&cierreTextoFilaTerminal&&(');
    expect(idx).toBeGreaterThan(-1);
    const idxFin = BLOQUE_MOTIVO_CIERRE.indexOf(')}', idx);
    const bloque = BLOQUE_MOTIVO_CIERRE.slice(idx, idxFin);
    expect(bloque).not.toContain('No se encontró un motivo de cierre registrado.');
  });
});

describe('"Observaciones registradas · N" sigue siendo un historial separado, no mezclado con el detalle/motivo del cierre', () => {
  it('el botón "Ver observaciones" (fuera del bloque) sigue usando totalObservacionesHistoricas, fuente distinta', () => {
    expect(BLOQUE_VISTFICHA_ASIGNACION).toContain('{totalObservacionesHistoricas>0&&(');
    expect(BLOQUE_VISTFICHA_ASIGNACION).toContain('Ver observaciones');
    expect(BLOQUE_MOTIVO_CIERRE).not.toContain('totalObservacionesHistoricas');
    expect(BLOQUE_MOTIVO_CIERRE).not.toContain('obtenerObservacionesProceso');
  });
  it('ModalHistorialObservaciones (detrás de "Ver observaciones") sigue usando obtenerObservacionesProceso(sol.asignaciones) — helper distinto, sin cambios', () => {
    expect(BLOQUE_MODAL_HISTORIAL).toContain('const observaciones=obtenerObservacionesProceso(sol.asignaciones);');
  });
});

describe('El detalle/motivo del cierre nunca usa observaciones de seguimiento de Mercadeo', () => {
  it('ni el bloque ni el módulo del helper referencian ningún campo de "seguimiento"', () => {
    expect(BLOQUE_MOTIVO_CIERRE).not.toMatch(/observacionesSeguimiento|seguimientoObservaciones/i);
    const observacionCierreTerminalSrc = readFileSync(join(__dirname, '..', 'lib', 'solicitudes', 'observacion-cierre-terminal.ts'), 'utf-8');
    expect(observacionCierreTerminalSrc).not.toMatch(/observacionesSeguimiento|seguimientoObservaciones/i);
  });
});

describe('Visual — paleta azul corporativo + texto justificado (sin cambios de esta ronda)', () => {
  it('el contenedor usa la misma paleta azul de "Responsables asignados" (#eff6ff/#bfdbfe), no verde', () => {
    expect(BLOQUE_MOTIVO_CIERRE).toContain("background:'#eff6ff',borderRadius:7,border:'1px solid #bfdbfe'");
    expect(BLOQUE_MOTIVO_CIERRE).not.toContain('#f0fdf4');
    expect(BLOQUE_MOTIVO_CIERRE).not.toContain('#15803d');
  });
  it('el texto del detalle y el del motivo están justificados', () => {
    expect(BLOQUE_MOTIVO_CIERRE).toContain("<div style={{fontSize:11.5,color:'#0d2d5e',fontFamily:F,textAlign:'justify' as const}}>{cierreTextoFilaTerminal}</div>");
    expect(BLOQUE_MOTIVO_CIERRE).toContain("textAlign:'justify' as const}}>{cierreTextoFilaTerminal||'No se encontró un motivo de cierre registrado.'}");
  });
});

describe('Admin/Comercial/Mercadeo/solo-lectura con acceso — ven observaciones vía "Ver observaciones", sin gate de rol nuevo (sin regresión)', () => {
  it('en VistFicha, el botón + modal no dependen de ningún rol/permiso', () => {
    const idx = BLOQUE_VISTFICHA.indexOf('Ver observaciones');
    expect(idx).toBeGreaterThan(-1);
    const antes = BLOQUE_VISTFICHA.slice(Math.max(0, idx - 400), idx);
    expect(antes).not.toMatch(/isAdmin\(|esMercadeo\(|sesion\.rol===/);
    expect(BLOQUE_VISTFICHA).toContain('<ModalHistorialObservaciones sol={solActual} onClose={()=>setShowHistorialObs(false)}/>');
  });
  it('el mismo patrón también existe en VistFichaBusqueda', () => {
    const idx = BLOQUE_VISTFICHA_BUSQUEDA.indexOf('Ver observaciones');
    expect(idx).toBeGreaterThan(-1);
    expect(BLOQUE_VISTFICHA_BUSQUEDA).toContain('<ModalHistorialObservaciones sol={sol} onClose={()=>setShowHistorialObs(false)}/>');
  });
});

describe('Sin permisos de gestión → sin Editar/Eliminar/Aceptada/No aceptada en el bloque ni en el modal', () => {
  it('el bloque de detalle/motivo del cierre no incluye ningún control de mutación (solo texto de lectura)', () => {
    expect(BLOQUE_MOTIVO_CIERRE).not.toMatch(/onClick=\{/);
    expect(BLOQUE_MOTIVO_CIERRE).not.toContain('fetch(');
  });
  it('ModalHistorialObservaciones sigue sin ningún control de mutación', () => {
    expect(BLOQUE_MODAL_HISTORIAL).not.toMatch(/onClick=\{[^}]*(eliminar|editar|Editar|Eliminar)/);
    expect(BLOQUE_MODAL_HISTORIAL).not.toContain('>Editar<');
    expect(BLOQUE_MODAL_HISTORIAL).not.toContain('>Eliminar<');
    expect(BLOQUE_MODAL_HISTORIAL).not.toContain('fetch(');
  });
});

describe('Mercadeo en Seguimiento — no regresión del ajuste previo (mensaje "No figuras como responsable activo" oculto)', () => {
  it('la condición sigue incluyendo !esMercadeo(sesion.rol), sin relación con este ajuste', () => {
    expect(BLOQUE_VISTFICHA_ASIGNACION).toContain("cargaResponsablesFicha.tipo!=='loading'&&!puedeGestionarFicha&&asignaciones.length>0&&!esMercadeo(sesion.rol)&&(");
  });
});
