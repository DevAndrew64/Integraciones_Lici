/**
 * Verificación de fuente — Otros costos por línea de cargo, wiring en
 * page.tsx (persistencia, selectores "Aplica a", política de eliminación,
 * bandera). Mismo patrón que texto-ui-mano-obra*.ts: no existe arnés de
 * render de componentes para este archivo, así que se verifica el TEXTO
 * exacto del código fuente. Cubre las pruebas #15-#18, #20-#22, #26-#27.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../../app/page.tsx'), 'utf-8');

describe('page.tsx — persistencia de cursosRows/vacunasRows (§15, pruebas #15-#18)', () => {
  it('15) cursosRows se guarda en guardarCosteo (payload JSON)', () => {
    const inicio = PAGE_TSX.indexOf('async function guardarCosteo()');
    const finDatos = PAGE_TSX.indexOf('};', PAGE_TSX.indexOf('const datos={', inicio));
    const bloque = PAGE_TSX.slice(inicio, finDatos);
    expect(bloque).toContain('cursosRows');
  });

  it('16) cursosRows se restaura en aplicarDatosGuardados', () => {
    const inicio = PAGE_TSX.indexOf('function aplicarDatosGuardados(');
    const fin = PAGE_TSX.indexOf('function ', inicio + 10);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('d.cursosRows');
    expect(bloque).toContain('setCursosRows(cursosRowsD)');
  });

  it('17) vacunasRows se guarda en guardarCosteo (payload JSON)', () => {
    const inicio = PAGE_TSX.indexOf('async function guardarCosteo()');
    const finDatos = PAGE_TSX.indexOf('};', PAGE_TSX.indexOf('const datos={', inicio));
    const bloque = PAGE_TSX.slice(inicio, finDatos);
    expect(bloque).toContain('vacunasRows');
  });

  it('18) vacunasRows se restaura en aplicarDatosGuardados', () => {
    const inicio = PAGE_TSX.indexOf('function aplicarDatosGuardados(');
    const fin = PAGE_TSX.indexOf('function ', inicio + 10);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('d.vacunasRows');
    expect(bloque).toContain('setVacunasRows(vacunasRowsD)');
  });

  it('cursosRows/vacunasRows también viajan en buildDraftData (borrador local) — sobreviven un recargo del navegador sin guardar', () => {
    const inicio = PAGE_TSX.indexOf('const buildDraftData=()=>({');
    const fin = PAGE_TSX.indexOf('});', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('cursosRows');
    expect(bloque).toContain('vacunasRows');
  });

  it('alcance ausente en un cursosRows histórico se completa explícitamente en POR_TRABAJADOR (nunca queda undefined)', () => {
    const inicio = PAGE_TSX.indexOf('function aplicarDatosGuardados(');
    const fin = PAGE_TSX.indexOf('function ', inicio + 10);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain("alcance:r.alcance??('POR_TRABAJADOR' as const)");
  });
});

describe('page.tsx — asociación por lineaManoObraId, no por cargoCodigo ni índice (§1, §3-§6)', () => {
  it('Dotación/EPP se agrupan por lineaManoObraId resuelto (resolverLineaManoObraId), nunca por índice de arreglo', () => {
    expect(PAGE_TSX).toContain('resolverLineaManoObraId(g,lineasManoObraResumen).lineaManoObraIdResuelto===lineaId');
  });

  it('Rediseño "EPP y Dotación" — la ficha externa agrupa por sujetoKey discriminado (resolverSujetoKeyDeGrupo), no solo por lineaManoObraId', () => {
    expect(PAGE_TSX).toContain('resolverSujetoKeyDeGrupo(g)===key');
  });

  it('cada línea/turnante disponible expone un id ESTABLE (l.id) para "Aplica a" — nunca el índice del map', () => {
    expect(PAGE_TSX).toContain('...lineasExtra.map(l=>({id:l.id,codigo:l.codigo');
    expect(PAGE_TSX).toContain('...cargosTurnantes.map(l=>({id:l.id,codigo:l.codigo');
  });

  it('ajuste "QUITAR BLOQUE COSTOS PENDIENTES DE ASIGNACIÓN DE MANO DE OBRA" — descripcionLineaManoObra (solo usada por ese selector) se retiró como código muerto', () => {
    expect(PAGE_TSX).not.toContain('descripcionLineaManoObra=(l:{codigo:string;nombre:string;cantidadTrabajadores:number;origen:');
  });

  it('Cursos exponen un selector de alcance POR_TRABAJADOR/POR_LINEA en el modal de registro manual, con POR_TRABAJADOR como valor predeterminado en filas nuevas', () => {
    expect(PAGE_TSX).toContain("FORM_MANUAL_VACIO:FormularioRegistroManual={codigo:'',codigoGrupo:'',descripcion:'',ciudad:'',cantidad:'1',frecuencia:'1',valorUnitario:'',fechaValor:'',alcance:'POR_TRABAJADOR',dosisPorTrabajador:'1'};");
    expect(PAGE_TSX).toContain("<option value=\"POR_TRABAJADOR\">Por trabajador</option>");
    expect(PAGE_TSX).toContain("<option value=\"POR_LINEA\">Fijo por línea</option>");
  });
});

describe('page.tsx — eliminación de líneas con otros costos asociados (§17)', () => {
  it('22) eliminar una línea con costos asociados solicita confirmación explícita antes de continuar', () => {
    expect(PAGE_TSX).toContain('tieneOtrosCostosAsociados(id,linea.codigo)');
    expect(PAGE_TSX).toContain('Esta línea tiene dotación, EPP, exámenes, cursos o vacunas asociados');
  });

  it('política elegida: los costos NUNCA se eliminan — quedan PENDIENTE_DE_ASIGNACION (lineaManoObraId=null), documentado en el código', () => {
    expect(PAGE_TSX).toContain('function desasociarOtrosCostosDeLinea(lineaId:number)');
    expect(PAGE_TSX).toContain('NUNCA se borran esos registros');
  });

  it('la misma política aplica a Turnantes (eliminarCargoTurnante)', () => {
    const inicio = PAGE_TSX.indexOf('function eliminarCargoTurnante(id:number){');
    const fin = PAGE_TSX.indexOf('}', PAGE_TSX.indexOf('setCargosTurnantes(p=>p.filter(l=>l.id!==id));', inicio));
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('tieneOtrosCostosAsociados');
    expect(bloque).toContain('desasociarOtrosCostosDeLinea(id)');
  });

  it('un costo pendiente de asignación se advierte al usuario en el panel de detalle, sin ocultarlo silenciosamente', () => {
    expect(PAGE_TSX).toContain('costosOtrosPendientesDeAsignacion');
    expect(PAGE_TSX).toContain('pendiente');
  });
});

describe('page.tsx — sin bandera de transición, motor comercial único (§26/§27)', () => {
  it('26) USAR_TARIFA_MENSUAL_COMPLETA ya no existe — el motor comercial es el único camino', () => {
    expect(PAGE_TSX).not.toContain('USAR_TARIFA_MENSUAL_COMPLETA');
  });

  it('27) el resultado mensual nuevo (otrosCostosMensualesTotal, tarifaMensualTotalManoObra) ya NO depende de eppTotal/examTotal (global ×n) — usa el agregado por línea', () => {
    const inicioTotal = PAGE_TSX.indexOf('const tarifaMensualTotalManoObra=');
    const finTotal = PAGE_TSX.indexOf(';', inicioTotal);
    const lineaTotal = PAGE_TSX.slice(inicioTotal, finTotal);
    expect(lineaTotal).toContain('agregadoCostoMensualTotalManoObra.costoMensualTotalManoObra');
    expect(lineaTotal).not.toContain('eppTotal');
    expect(lineaTotal).not.toContain('examTotal');
  });
});