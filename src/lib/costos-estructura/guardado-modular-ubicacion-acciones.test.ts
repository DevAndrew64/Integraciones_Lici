/**
 * Ajuste "AJUSTAR UBICACIÓN DE ACCIONES EN LA PESTAÑA MANO DE OBRA"
 * (extendido a Turnantes por el mismo criterio) — el encabezado de
 * "Detalle mensual de mano de obra"/"Detalle De Turnantes" ya NO muestra
 * Guardar/Finalizar (solo la acción de creación de cargo, con texto
 * visible); esos botones se movieron al pie, homologados con EPP y
 * Dotación/Exámenes/Insumos. Mismos handlers ya existentes — solo cambia
 * la ubicación visual, ningún cálculo ni validación se modifica.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');

function bloque(inicioMarcador: string, finMarcador: string, desde = 0): string {
  const inicio = PAGE_TSX.indexOf(inicioMarcador, desde);
  if (inicio === -1) throw new Error(`No se encontró el marcador de inicio: ${inicioMarcador}`);
  const fin = PAGE_TSX.indexOf(finMarcador, inicio);
  if (fin === -1) throw new Error(`No se encontró el marcador de fin: ${finMarcador}`);
  return PAGE_TSX.slice(inicio, fin);
}

describe('Mano de Obra — encabezado (§1/§6)', () => {
  const idxEncabezado = PAGE_TSX.indexOf('Detalle mensual de mano de obra</div>');
  const idxFinCargos = PAGE_TSX.indexOf('Aún no hay cargos. Usa &quot;Añadir cargo&quot;', idxEncabezado);
  const bEncabezado = PAGE_TSX.slice(idxEncabezado, idxFinCargos);

  it('1) el encabezado solo muestra "Agregar cargo"', () => {
    expect(bEncabezado).toContain('Agregar cargo');
    expect(bEncabezado).toContain("onClick={()=>abrirModalCargoNuevo('manoObra')}");
  });

  it('2) el encabezado ya NO contiene los botones Guardar/Finalizar', () => {
    expect(bEncabezado).not.toContain('onClick={guardarAvanceManoObra}');
    expect(bEncabezado).not.toContain('onClick={finalizarManoObra}');
  });

  // Ajuste "MANO DE OBRA COMPLETA EN SERVICIOS NO CONTINUOS" — el segundo
  // parámetro de abrirModalCargoNuevo dejó de ser un booleano
  // (esTurnante) y pasó a ser un destino de 3 vías ('manoObra'|'turnantes'|
  // {servicioId}) para que el mismo modal también sirva a los cargos de
  // Servicios no continuos — el flujo de creación en sí no cambió.
  it('5) "Agregar cargo" sigue llamando exactamente abrirModalCargoNuevo(\'manoObra\'), el mismo flujo de creación', () => {
    expect(bEncabezado).toContain("<button onClick={()=>abrirModalCargoNuevo('manoObra')} style={");
  });
});

describe('Mano de Obra — pie (§2/§3/§4/§5)', () => {
  const bPie = bloque('Estado: {hayCambiosSinGuardarManoObra', "{/* ══ TURNANTES");

  it('3/4) Guardar Mano de Obra aparece debajo del resumen (mismo handler ya existente); Ajuste "quitar esto, que solo sea un solo guardado" — ya no hay un botón separado "Finalizar"', () => {
    expect(bPie).toContain('onClick={guardarAvanceManoObra} disabled={guardandoModuloManoObra}');
    expect(bPie).toContain("{guardandoAvanceMO?'Guardando…':'Guardar Mano de Obra'}");
    expect(bPie).not.toContain('onClick={finalizarManoObra}');
    expect(bPie).not.toContain("'Finalizar Mano de Obra'");
  });

  it('10) ambos botones usan únicamente el estado propio de Mano de Obra (guardandoModuloManoObra), nunca el de otro módulo', () => {
    expect(bPie).not.toContain('guardandoModuloTurnantes');
    expect(bPie).not.toContain('guardandoModuloDotacionEpp');
    expect(bPie).not.toContain('guardandoModuloExamenesMedicos');
    expect(bPie).not.toContain('guardandoModuloInsumos');
  });

  it('el pie sigue mostrando Estado/Último guardado/mensajes, sin cambios', () => {
    expect(bPie).toContain('Estado: {hayCambiosSinGuardarManoObra');
    expect(bPie).toContain('Último guardado:');
  });
});

describe('Mano de Obra — comportamiento sin cambios (§6/§9/§11)', () => {
  it('Ajuste "un solo guardado" — guardarAvanceManoObra valida y guarda COMPLETADO si pasa, EN_PROGRESO si no (misma validación que antes solo corría al finalizar)', () => {
    const b = bloque('async function guardarAvanceManoObra()', 'const [mostrarModalSalidaManoObra');
    expect(b).toContain('validarManoObraParaFinalizar(');
    expect(b).toContain("guardarModuloManoObra(validacion.valido?'COMPLETADO':'EN_PROGRESO')");
  });

  it('8/9) el dirty y el manejo de conflicto 409 no se tocaron (mismo núcleo genérico)', () => {
    const b = bloque('async function guardarModuloManoObra', 'async function guardarAvanceManoObra');
    expect(b).toContain('manoObraBaseline.current=JSON.stringify(datosEntrada);');
    expect(b).toContain('setHayCambiosSinGuardarManoObra(false);');
    const inicioError = b.indexOf('if(!r.ok){');
    const bError = b.slice(inicioError, b.indexOf('return false;', inicioError));
    expect(bError).not.toContain('setHayCambiosSinGuardarManoObra(false)');
  });

  it('11) ningún cálculo cambió — construirDatosEntradaManoObra y el motor comercial siguen intactos', () => {
    expect(PAGE_TSX).toContain('function construirDatosEntradaManoObra(){');
    expect(PAGE_TSX).toContain('const tarifaMensualTotalManoObra=agregadoCostoMensualTotalManoObra.costoMensualTotalManoObra+totalBonosNoPrestacionalesManoObra;');
  });
});

describe('Turnantes — mismo ajuste aplicado (extensión pedida por el usuario)', () => {
  const idxBloque = PAGE_TSX.indexOf('titulo="Detalle De Turnantes"');
  const idxFinExtra = PAGE_TSX.indexOf('Añadir cargo', idxBloque) + 50;
  const bExtra = PAGE_TSX.slice(idxBloque, idxFinExtra);

  it('el encabezado (extra del BloqueColapsable) solo tiene "Añadir cargo", sin Guardar/Finalizar', () => {
    expect(bExtra).toContain('Añadir cargo');
    expect(bExtra).not.toContain('guardarAvanceTurnantes');
    expect(bExtra).not.toContain('finalizarTurnantes');
  });

  it('Ajuste "un solo guardado" — Guardar Turnantes aparece en el pie, con el mismo handler; ya no hay botón "Finalizar" separado', () => {
    const bPie = bloque('Estado: {hayCambiosSinGuardarTurnantes', "{/* ══ EPP ══");
    expect(bPie).toContain('onClick={guardarAvanceTurnantes} disabled={guardandoModuloTurnantes}');
    expect(bPie).toContain("{guardandoAvanceTurnantes?'Guardando…':'Guardar Turnantes'}");
    expect(bPie).not.toContain('finalizarTurnantes');
  });
});
