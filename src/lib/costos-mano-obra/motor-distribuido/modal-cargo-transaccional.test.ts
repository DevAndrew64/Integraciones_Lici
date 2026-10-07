/**
 * Corrección "ESTADO TRANSACCIONAL DEL MODAL" — el modal Crear/Editar cargo
 * (Mano de Obra y Turnantes) deja de mutar lineasExtra/cargosTurnantes en
 * cada tecla. Ahora trabaja siempre sobre un borrador local (borradorCargo)
 * y solo hace un ÚNICO commit a la colección principal al pulsar "Guardar".
 * Al cancelar/cerrar, el borrador se descarta sin tocar la colección — una
 * línea nueva nunca llega a insertarse, una línea existente conserva
 * exactamente sus últimos valores guardados.
 *
 * Mismo patrón de verificación de fuente (sin jsdom/RTL) ya usado en el
 * resto de este directorio — confirma el cableado exacto en page.tsx.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../../app/page.tsx'), 'utf-8');

function bloqueFuncion(nombreFirma: string): string {
  const inicio = PAGE_TSX.indexOf(nombreFirma);
  expect(inicio).toBeGreaterThan(-1);
  const fin = PAGE_TSX.indexOf('\n  }', inicio);
  return PAGE_TSX.slice(inicio, fin);
}

describe('1 — "Agregar cargo" abre un borrador sin insertar fila en la colección principal', () => {
  it('abrirModalCargoNuevo solo llama a setBorradorCargo/setModalCargoId — nunca setLineasExtra ni setCargosTurnantes', () => {
    const bloque = bloqueFuncion('function abrirModalCargoNuevo(');
    expect(bloque).toContain('setBorradorCargo(');
    expect(bloque).toContain('setModalCargoId(id);');
    expect(bloque).not.toContain('setLineasExtra(');
    expect(bloque).not.toContain('setCargosTurnantes(');
  });
  it('los botones "Añadir cargo" (Mano de Obra y Turnantes) invocan abrirModalCargoNuevo, no un insert directo', () => {
    expect(PAGE_TSX).toContain('onClick={()=>abrirModalCargoNuevo(false)}');
    expect(PAGE_TSX).toContain('onClick={()=>abrirModalCargoNuevo(true)}');
    expect(PAGE_TSX).not.toContain('setModalCargoId(agregarLineaExtra())');
    expect(PAGE_TSX).not.toContain('setModalCargoId(agregarCargoTurnante())');
  });
});

describe('2/4 — cerrar/cancelar descarta el borrador sin dejar fila huérfana ni alterar la línea original', () => {
  it('cerrarModalCargo únicamente limpia el borrador y modalCargoId — nunca llama a setLineasExtra/setCargosTurnantes ni a eliminarLineaExtra/eliminarCargoTurnante', () => {
    const inicio = PAGE_TSX.indexOf('const cerrarModalCargo=()=>{');
    expect(inicio).toBeGreaterThan(-1);
    const fin = PAGE_TSX.indexOf('};', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('setBorradorCargo(null);');
    expect(bloque).toContain('setModalCargoId(null);');
    expect(bloque).not.toContain('setLineasExtra(');
    expect(bloque).not.toContain('setCargosTurnantes(');
    expect(bloque).not.toContain('eliminarLineaExtra(');
    expect(bloque).not.toContain('eliminarCargoTurnante(');
  });
});

describe('3/6/9 — editar/escribir en el modal nunca toca la colección principal ni produce cálculos en $0 detrás del modal', () => {
  it('patch() dentro de ModalCargo escribe únicamente en borradorCargo (setBorradorCargo), nunca en lineasExtra/cargosTurnantes', () => {
    const inicio = PAGE_TSX.indexOf('const patch=(p:Partial<LineaMOExtra>)=>{');
    expect(inicio).toBeGreaterThan(-1);
    const fin = PAGE_TSX.indexOf('};', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('setBorradorCargo(b=>b?{...b,...p}:b);');
    expect(bloque).not.toContain('setLineasExtra(');
    expect(bloque).not.toContain('setCargosTurnantes(');
  });
  it('las funciones de mutación directa por id (actualizarLineaExtra/actualizarCargoTurnante) ya no existen — el único camino de escritura es el borrador', () => {
    expect(PAGE_TSX).not.toContain('function actualizarLineaExtra(');
    expect(PAGE_TSX).not.toContain('function actualizarCargoTurnante(');
  });
  it('resultadosLineasExtraMensuales/resultadosCargosTurnantesMensuales (la tabla de fondo) siguen derivando de lineasExtra/cargosTurnantes (vía cargosTurnantesVigentes, ajuste "EL RESUMEN NO CUADRA CON EL TOTAL"), nunca de borradorCargo', () => {
    expect(PAGE_TSX).toMatch(/lineasExtra\.map\(l=>\{/);
    expect(PAGE_TSX).toMatch(/cargosTurnantesVigentes\.map\(l=>\{/);
    // cargosTurnantesVigentes en sí deriva de cargosTurnantes (filtro de
    // huérfanos), nunca de borradorCargo ni de una colección nueva.
    expect(PAGE_TSX).toContain('cargosTurnantes.filter(l=>!l.esTurnanteAutomatico||clavesGrupoTurnanteVigentes.has(l.claveGrupoTurnante??\'\'))');
  });
});

// Corrección "que abra otra ventana pequeña que notifique lo que falte" /
// "colocalo entonces encima de guardar que salga de alli" — los avisos de
// validación (horario faltante + lista de campos faltantes) dejaron de
// vivir inline dentro del formulario (quedaban fuera de vista sin hacer
// scroll) y pasaron a un único aviso flotante, anclado (position:'absolute'
// dentro de un envoltorio no-scrolleable) justo encima de Cancelar/Guardar
// — nunca centrado sobre el modal ni tapando el encabezado — siempre
// visible mientras intentoGuardarCargo&&!puedeGuardarCargo, con su propio
// botón de cierre.
describe('5 — falta de campos obligatorios: aviso flotante anclado encima de Guardar, siempre visible sin depender del scroll', () => {
  it('el aviso flotante existe, condicionado a intentoGuardarCargo&&!puedeGuardarCargo (nunca apenas se abre el modal), y lista camposFaltantes', () => {
    expect(PAGE_TSX).toContain('{intentoGuardarCargo&&!puedeGuardarCargo&&(');
    expect(PAGE_TSX).toContain("position:'absolute',bottom:76,right:24,zIndex:5");
    expect(PAGE_TSX).toContain('Faltan campos obligatorios');
    expect(PAGE_TSX).toContain('{camposFaltantes.join(\', \')}.');
  });
  it('el envoltorio que ancla el aviso es no-scrolleable (position:relative, sin overflow) — nunca se desplaza con el scroll interno del modal', () => {
    expect(PAGE_TSX).toContain("<div style={{position:'relative',width:760,maxWidth:'100%'}}>");
  });
  it('el aviso flotante tiene su propio botón de cierre, que solo resetea intentoGuardarCargo (no toca el borrador ni el resto del estado)', () => {
    const inicio = PAGE_TSX.indexOf("position:'absolute',bottom:76,right:24");
    expect(inicio).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(inicio, inicio + 900);
    expect(bloque).toContain("onClick={()=>setIntentoGuardarCargo(false)}");
  });
  it('los avisos inline anteriores (junto a Horario y al pie del formulario) ya no existen', () => {
    expect(PAGE_TSX).not.toContain('Selecciona al menos un horario para calcular el cargo');
    expect(PAGE_TSX).not.toContain("<div style={{padding:'0 24px 12px',fontSize:11.5,color:RED}}>Faltan campos obligatorios: {camposFaltantes.join(', ')}.</div>");
  });
});

describe('7 — guardar una línea válida hace un ÚNICO commit', () => {
  it('guardarBorradorCargo hace como máximo una llamada a setLineasExtra y una a setCargosTurnantes (mutuamente excluyentes vía borradorCargoEsTurnante), cada una con un solo setter (crear o reemplazar, nunca ambos)', () => {
    const bloque = bloqueFuncion('function guardarBorradorCargo(){');
    const llamadasLineasExtra = (bloque.match(/setLineasExtra\(/g) || []).length;
    const llamadasTurnantes = (bloque.match(/setCargosTurnantes\(/g) || []).length;
    expect(llamadasLineasExtra).toBe(1);
    expect(llamadasTurnantes).toBe(1);
    expect(bloque).toContain('borradorCargoEsNuevo?[...p,borradorCargo]:p.map(l=>l.id===borradorCargo.id?borradorCargo:l)');
  });
  it('intentarGuardarCargo solo confirma el borrador (guardarBorradorCargo) cuando la validación pasa, y siempre cierra después', () => {
    const inicio = PAGE_TSX.indexOf('const intentarGuardarCargo=()=>{');
    expect(inicio).toBeGreaterThan(-1);
    const fin = PAGE_TSX.indexOf('};', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('if(!puedeGuardarCargo){setIntentoGuardarCargo(true);return;}');
    expect(bloque).toContain('guardarBorradorCargo();');
    expect(bloque).toContain('cerrarModalCargo();');
  });
});

describe('8 — una línea ya persistida y realmente incompleta sigue marcándose como pendiente (no se oculta el problema legítimo)', () => {
  it('construirFilaMensualUI conserva bloqueada:fin===null sin cambios — esta corrección no toca el criterio de "pendiente de cálculo"', () => {
    expect(PAGE_TSX).toContain('bloqueada:fin===null,');
  });
});

describe('10 — el total de Mano de Obra no cambia hasta guardar (consecuencia estructural del borrador)', () => {
  it('abrirModalCargoEditar clona la línea existente en el borrador sin mutar lineasExtra/cargosTurnantes', () => {
    const bloque = bloqueFuncion('function abrirModalCargoEditar(');
    expect(bloque).toContain('setBorradorCargo({...original,distribucionesHorario:[...original.distribucionesHorario]});');
    expect(bloque).not.toContain('setLineasExtra(');
    expect(bloque).not.toContain('setCargosTurnantes(');
  });
  it('los botones "Editar cargo" (Mano de Obra y Turnantes) abren el borrador vía abrirModalCargoEditar, no setModalCargoId directo', () => {
    expect(PAGE_TSX).toContain('onClick={()=>abrirModalCargoEditar(d.id,false)}');
    expect(PAGE_TSX).toContain('onClick={()=>abrirModalCargoEditar(d.id,true)}');
  });
});
