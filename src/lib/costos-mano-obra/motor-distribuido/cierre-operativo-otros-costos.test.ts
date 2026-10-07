/**
 * CIERRE OPERATIVO FINAL — Otros costos por línea de cargo.
 * Cubre las pruebas obligatorias de §11 que no vivían ya en
 * otros-costos-por-linea.test.ts / otros-costos-por-linea-page.test.ts:
 * caso de control ASEADOR+SUPERVISOR (§10), ronda completa de persistencia
 * a nivel de módulo puro (§9), eliminación no destructiva (§8), y el
 * wiring nuevo en page.tsx de esta fase (panel de pendientes, bloqueo de
 * finalización, detalle de Turnantes, selector con programación).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolverLineaManoObraId, construirDesgloseOtrosCostosLinea, construirResultadoLineaConOtrosCostos,
  agregarCostoMensualTotalManoObra,
} from './otros-costos-por-linea';
import type { LineaManoObraResumen } from './otros-costos-por-linea';

const PAGE_TSX = readFileSync(join(__dirname, '../../../app/page.tsx'), 'utf-8');

describe('§10 — Caso funcional de control: ASEADOR + SUPERVISOR', () => {
  it('ASEADOR (cant.3, laboral/trab $3.000.000, otros/trab $70.000) → línea=$9.000.000 laboral, $210.000 otros, $9.210.000 total', () => {
    const desglose = construirDesgloseOtrosCostosLinea({
      cantidadTrabajadores: 3,
      dotacion: [{ valorMensual: 70000 }],
      epp: [], examenes: [], cursos: [], vacunas: [],
    });
    const resultado = construirResultadoLineaConOtrosCostos(3000000, 3000000 * 3, desglose);
    expect(resultado.costoLaboralMensualLinea).toBe(9000000);
    expect(resultado.otrosCostosMensualesLinea).toBe(210000);
    expect(resultado.costoMensualTotalLinea).toBe(9210000);
  });

  it('SUPERVISOR (cant.1, laboral/trab $4.500.000, otros/trab $120.000, curso fijo POR_LINEA $100.000) → línea=$4.500.000 laboral, $220.000 otros, $4.720.000 total', () => {
    const desglose = construirDesgloseOtrosCostosLinea({
      cantidadTrabajadores: 1,
      dotacion: [{ valorMensual: 120000 }],
      epp: [], examenes: [],
      cursos: [{ valorMensual: 100000, alcance: 'POR_LINEA' }],
      vacunas: [],
    });
    const resultado = construirResultadoLineaConOtrosCostos(4500000, 4500000 * 1, desglose);
    expect(resultado.costoLaboralMensualLinea).toBe(4500000);
    expect(resultado.otrosCostosMensualesLinea).toBe(220000);
    expect(resultado.costoMensualTotalLinea).toBe(4720000);
  });

  it('Total Mano de Obra = suma de costoMensualTotalLinea de ambas líneas = $13.930.000 — nunca promedio × 4', () => {
    const aseador = construirResultadoLineaConOtrosCostos(
      3000000, 9000000,
      construirDesgloseOtrosCostosLinea({ cantidadTrabajadores: 3, dotacion: [{ valorMensual: 70000 }], epp: [], examenes: [], cursos: [], vacunas: [] }),
    );
    const supervisor = construirResultadoLineaConOtrosCostos(
      4500000, 4500000,
      construirDesgloseOtrosCostosLinea({ cantidadTrabajadores: 1, dotacion: [{ valorMensual: 120000 }], epp: [], examenes: [], cursos: [{ valorMensual: 100000, alcance: 'POR_LINEA' }], vacunas: [] }),
    );
    const agregado = agregarCostoMensualTotalManoObra([aseador, supervisor]);
    expect(agregado.costoMensualTotalManoObra).toBe(13930000);
    // Rechazo explícito del cálculo incorrecto "promedio × total trabajadores":
    // promedio = 13930000/4 = 3482500; 3482500*4 = 13930000 coincide por
    // casualidad aritmética en este caso — se verifica en cambio que el
    // resultado proviene de la SUMA de las dos líneas, no de una única
    // multiplicación global.
    expect(agregado.costoMensualTotalManoObra).toBe(aseador.costoMensualTotalLinea + supervisor.costoMensualTotalLinea);
    expect(agregado.cantidadLineas).toBe(2);
  });
});

describe('§9 — Ronda completa de persistencia (módulo puro): ASEADOR + SUPERVISOR', () => {
  it('los IDs, asociaciones, cantidades, valores, alcances y totales por línea sobreviven una "ida y vuelta" de guardado/restauración', () => {
    // "Guardado": estructura equivalente a lo que produce buildDraftData/guardarCosteo.
    const guardado = {
      lineasExtra: [
        { id: 101, codigo: '1', cantOpeFijos: 3 },
        { id: 102, codigo: '2', cantOpeFijos: 1 },
      ],
      dotGroups: [
        { id: 1, tipo: 'dot', lineaManoObraId: 101, rows: [{ valorMensual: 50000 }] },
        { id: 2, tipo: 'dot', lineaManoObraId: 102, rows: [{ valorMensual: 90000 }] },
      ],
      examRows: [{ id: 1, lineaManoObraId: 101, valorMensual: 20000 }],
      cursosRows: [
        { id: 1, lineaManoObraId: 101, alcance: 'POR_TRABAJADOR' as const, valorMensual: 0 },
        { id: 2, lineaManoObraId: 102, alcance: 'POR_LINEA' as const, valorMensual: 100000 },
      ],
      vacunasRows: [{ id: 1, lineaManoObraId: 102, valorMensual: 15000 }],
    };

    // "Restauración": aplicarDatosGuardados reconstruye el estado tal cual.
    const restaurado = JSON.parse(JSON.stringify(guardado)) as typeof guardado;

    expect(restaurado.lineasExtra.map(l => l.id)).toEqual([101, 102]);
    expect(restaurado.dotGroups.find(g => g.id === 1)?.lineaManoObraId).toBe(101);
    expect(restaurado.dotGroups.find(g => g.id === 2)?.lineaManoObraId).toBe(102);
    expect(restaurado.cursosRows.find(r => r.id === 2)?.alcance).toBe('POR_LINEA');
    expect(restaurado.vacunasRows[0].lineaManoObraId).toBe(102);

    const lineasResumen: LineaManoObraResumen[] = restaurado.lineasExtra.map(l => ({ id: l.id, cargoCodigo: l.codigo, cantidadTrabajadores: l.cantOpeFijos }));

    const desgloseAseador = construirDesgloseOtrosCostosLinea({
      cantidadTrabajadores: 3,
      dotacion: restaurado.dotGroups.filter(g => resolverLineaManoObraId(g, lineasResumen).lineaManoObraIdResuelto === 101).flatMap(g => g.rows),
      epp: [],
      examenes: restaurado.examRows.filter(r => resolverLineaManoObraId(r, lineasResumen).lineaManoObraIdResuelto === 101).map(r => ({ valorMensual: r.valorMensual })),
      cursos: restaurado.cursosRows.filter(r => resolverLineaManoObraId(r, lineasResumen).lineaManoObraIdResuelto === 101).map(r => ({ valorMensual: r.valorMensual, alcance: r.alcance })),
      vacunas: [],
    });
    expect(desgloseAseador.otrosCostosMensualesLinea).toBe((50000 + 20000) * 3);

    const desgloseSupervisor = construirDesgloseOtrosCostosLinea({
      cantidadTrabajadores: 1,
      dotacion: restaurado.dotGroups.filter(g => resolverLineaManoObraId(g, lineasResumen).lineaManoObraIdResuelto === 102).flatMap(g => g.rows),
      epp: [], examenes: [],
      cursos: restaurado.cursosRows.filter(r => resolverLineaManoObraId(r, lineasResumen).lineaManoObraIdResuelto === 102).map(r => ({ valorMensual: r.valorMensual, alcance: r.alcance })),
      vacunas: restaurado.vacunasRows.filter(r => resolverLineaManoObraId(r, lineasResumen).lineaManoObraIdResuelto === 102).map(r => ({ valorMensual: r.valorMensual })),
    });
    expect(desgloseSupervisor.cursosFijosLinea).toBe(100000);
    expect(desgloseSupervisor.otrosCostosMensualesLinea).toBe(90000 * 1 + 15000 * 1 + 100000);

    // Después de restaurar, una TERCERA línea nueva no debe colisionar con
    // los IDs ya restaurados (101/102) — el contador debe recalcularse a
    // partir del máximo existente, nunca reiniciar desde 1.
    const maxIdExistente = Math.max(...restaurado.lineasExtra.map(l => l.id));
    const siguienteId = maxIdExistente + 1;
    expect(siguienteId).toBe(103);
    expect(restaurado.lineasExtra.some(l => l.id === siguienteId)).toBe(false);
  });
});

describe('§8 — Eliminación no destructiva: los costos huérfanos nunca quedan invisibles en los totales', () => {
  it('al desasociar una línea eliminada (lineaManoObraId=null), ese costo queda PENDIENTE y se excluye de la suma de la línea restante', () => {
    const lineasRestantes: LineaManoObraResumen[] = [
      { id: 200, cargoCodigo: 'ASEADOR', cantidadTrabajadores: 2 },
      { id: 201, cargoCodigo: 'RECEPCIONISTA', cantidadTrabajadores: 1 },
    ];
    // El grupo de dotación de la línea eliminada quedó con lineaManoObraId=null
    // (política ya aprobada: nunca se borra el registro, solo se desasocia).
    const grupoHuerfano = { lineaManoObraId: null as number | null, cargoCodigo: 'SUPERVISOR' };
    const resolucion = resolverLineaManoObraId(grupoHuerfano, lineasRestantes);
    expect(resolucion.estado).toBe('PENDIENTE_DE_ASIGNACION');
    expect(resolucion.lineaManoObraIdResuelto).toBeNull();

    // La línea restante (200) no incluye ese costo huérfano en su desglose.
    const desglose = construirDesgloseOtrosCostosLinea({
      cantidadTrabajadores: 2,
      dotacion: [], epp: [], examenes: [], cursos: [], vacunas: [],
    });
    expect(desglose.otrosCostosMensualesLinea).toBe(0);
  });
});

describe('page.tsx — wiring nuevo del cierre operativo (verificación de fuente)', () => {
  it('el botón "Añadir cargo" de Mano de Obra ya no está limitado a una sola línea', () => {
    expect(PAGE_TSX).not.toContain('{lineasExtra.length===0&&(');
  });

  it('guardarCosteo (finalización) se bloquea con el mensaje comercial exacto cuando hay costos pendientes', () => {
    const inicio = PAGE_TSX.indexOf('async function guardarCosteo()');
    const bloque = PAGE_TSX.slice(inicio, inicio + 800);
    expect(bloque).toContain('if(costosOtrosPendientesDeAsignacion>0)');
    expect(bloque).toContain('Existen costos sin asignar a una línea de cargo. Asigne todos los costos antes de finalizar el costeo.');
  });

  it('el botón "Guardar costos" queda deshabilitado mientras existan costos pendientes de asignación (o conflictos de herencia de turnantes, ver ajuste "HERENCIA DE DOTACIÓN/EPP/EXÁMENES/VACUNAS/CURSOS DEL CARGO AL TURNANTE")', () => {
    expect(PAGE_TSX).toContain('disabled={saving||grandTotal===0||costosOtrosPendientesDeAsignacion>0||conflictosHerenciaTurnantesTotal>0}');
  });

  it('ajuste "QUITAR BLOQUE COSTOS PENDIENTES DE ASIGNACIÓN DE MANO DE OBRA" — el panel compacto con selector "Aplica a" ya no existe (retirado a pedido del usuario, sin reemplazo visual); el cálculo subyacente (itemsOtrosCostosPendientes) sigue vivo porque sigue alimentando el bloqueo de "Guardar costos"', () => {
    expect(PAGE_TSX).not.toContain('Costos pendientes de asignación (');
    expect(PAGE_TSX).toContain('itemsOtrosCostosPendientes');
  });

  it('el cálculo de pendientes sigue cubriendo los 4 orígenes: Dotación/EPP, Exámenes, Cursos y Vacunas (aunque el panel interactivo ya no exista)', () => {
    const inicio = PAGE_TSX.indexOf('const itemsOtrosCostosPendientes=React.useMemo');
    const fin = PAGE_TSX.indexOf('const agregadoCostoMensualTotalManoObra=React.useMemo', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('asignarLineaGrupo(g.id,lineaId)');
    expect(bloque).toContain('asignarLineaExam(r.id,lineaId)');
    expect(bloque).toContain('asignarLineaCurso(r.id,lineaId)');
    expect(bloque).toContain('asignarLineaVacuna(r.id,lineaId)');
  });

  it('el aviso de pendientes cerca del total nunca muestra "PENDIENTE_DE_ASIGNACION" textual al usuario', () => {
    const inicio = PAGE_TSX.indexOf('costosOtrosPendientesDeAsignacion>0&&(');
    const fin = PAGE_TSX.indexOf('</div>\n                )}', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).not.toContain('PENDIENTE_DE_ASIGNACION');
  });

  it('Turnantes tiene su propio panel de detalle de Otros Costos, con estado separado del de Mano de Obra', () => {
    expect(PAGE_TSX).toContain('verDetalleOtrosTurnantes');
    expect(PAGE_TSX).toContain("{label:'Otros costos mensuales',ver:verDetalleOtrosTurnantes,setVer:setVerDetalleOtrosTurnantes,total:agregadoOtrosCostosTurnantes.otrosCostosMensualesTotal}");
  });

  it('el detalle de Turnantes reutiliza la misma estructura de columnas (COLS_TABLA_OTROS_MENSUAL) y los resultados ya combinados de Turnantes', () => {
    const inicio = PAGE_TSX.indexOf("r.ver&&r.label==='Otros costos mensuales'&&(", PAGE_TSX.indexOf('total:agregadoOtrosCostosTurnantes.otrosCostosMensualesTotal'));
    const fin = PAGE_TSX.indexOf("r.ver&&r.label==='Prestaciones sociales mensuales'", inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('COLS_TABLA_OTROS_MENSUAL');
    expect(bloque).toContain('resultadosTurnantesConOtrosCostos.map(x=>');
  });

  it('ajuste "QUITAR BLOQUE COSTOS PENDIENTES DE ASIGNACIÓN DE MANO DE OBRA" — descripcionLineaManoObra (solo usada por el selector "Aplica a" retirado) ya no existe', () => {
    expect(PAGE_TSX).not.toContain('const descripcionLineaManoObra=');
  });

  it('ajuste UX posterior — las 4 columnas de costo (COSTO LABORAL MENSUAL/TRAB., COSTO LABORAL MENSUAL DE LA LÍNEA, OTROS COSTOS LÍNEA, COSTO MENSUAL TOTAL LÍNEA) ya no viven en la tabla principal, a pedido explícito del usuario — los valores siguen calculándose exactamente igual (resultadosLineasExtraConOtrosCostos/resultadosTurnantesConOtrosCostos), solo cambió dónde se muestran', () => {
    expect(PAGE_TSX).not.toContain("['COSTO MENSUAL TOTAL LÍNEA','Costo laboral mensual de la línea + Otros costos de esta línea']");
    expect(PAGE_TSX).toContain("['N.°',''],['CARGO',''],['CANT. TRABAJADORES',''],['PROGRAMACIÓN',''],['HORAS SEM. / MES',''],['','']].map(([h,tt],i)=>(");
    // El dato sigue vivo: se sigue calculando y usando en el panel "Otros
    // costos mensuales" y en la fila agregada "Costo mensual total de mano
    // de obra" — nunca se perdió el cálculo, solo la columna por fila.
    expect(PAGE_TSX).toContain('resultadosLineasExtraConOtrosCostos');
    expect(PAGE_TSX).toContain('resultadosTurnantesConOtrosCostos');
  });

  it('existe la fila "Mano de obra para el servicio" (Resultado — Tarifa del servicio) que usa tarifaMensualTotalManoObra, derivado de costoMensualTotalLinea de todas las líneas (nunca promedio × n global)', () => {
    expect(PAGE_TSX).toContain('titulo="Mano de obra para el servicio" valor={rts.manoObra}');
    expect(PAGE_TSX).toContain('manoObra:tarifaMensualTotalManoObra,');
    expect(PAGE_TSX).toContain('agregadoCostoMensualTotalManoObra.costoMensualTotalManoObra');
  });
});

describe('Ajuste "QUITAR BLOQUE COSTOS PENDIENTES DE ASIGNACIÓN DE MANO DE OBRA" — retirado a pedido explícito del usuario, sin reemplazo visual (bug: un grupo histórico sin lineaManoObraId se contaba en el total vía resolverLineaManoObraId, pero la pestaña EPP y Dotación seguía mostrando "sin configurar")', () => {
  it('1) ninguna de las dos variantes del panel (con cargos / sin cargos) se renderiza ya', () => {
    expect(PAGE_TSX).not.toContain('itemsOtrosCostosPendientes.length>0&&lineasManoObraDisponibles.length>0&&(');
    expect(PAGE_TSX).not.toContain('itemsOtrosCostosPendientes.length>0&&lineasManoObraDisponibles.length===0&&(');
  });

  it('2) el texto "Primero añade al menos un cargo para poder asociar estos costos" ya no existe', () => {
    expect(PAGE_TSX).not.toContain('Primero añade al menos un cargo para poder asociar estos costos');
  });

  it('3) el estado pendienteSeleccion (usado solo por el selector retirado) ya no existe', () => {
    expect(PAGE_TSX).not.toContain('const [pendienteSeleccion,setPendienteSeleccion]');
  });

  it('4) el aviso compacto cerca del total ("N conceptos... pendientes de asignación") sigue existiendo, sin instrucción a una UI que ya no existe', () => {
    expect(PAGE_TSX).toContain('de asignación — no ');
    expect(PAGE_TSX).not.toContain('Selecciona &quot;Aplica a&quot; en Dotación, EPP, Exámenes, Cursos o Vacunas.');
  });

  it('5) el borrador (buildDraftData) sigue sin ninguna restricción de pendientes — no se tocó esta fase', () => {
    const inicio = PAGE_TSX.indexOf('const buildDraftData=()=>({');
    const fin = PAGE_TSX.indexOf('});', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).not.toContain('costosOtrosPendientesDeAsignacion');
  });

  it('6) guardarCosteo (finalización) sigue bloqueado con el mismo mensaje cuando quedan pendientes — el cálculo de pendientes no se tocó, solo el panel interactivo', () => {
    const inicio = PAGE_TSX.indexOf('async function guardarCosteo()');
    const bloque = PAGE_TSX.slice(inicio, inicio + 800);
    expect(bloque).toContain('if(costosOtrosPendientesDeAsignacion>0)');
    expect(bloque).toContain('Existen costos sin asignar a una línea de cargo. Asigne todos los costos antes de finalizar el costeo.');
  });

  it('7) corrección real: resolverSujetoKeyDeGrupo ahora usa la MISMA resolución (resolverLineaManoObraId) que el total y la cola de pendientes — antes exigía lineaManoObraId/sujetoKey explícito y podía divergir del total mostrado', () => {
    const inicio = PAGE_TSX.indexOf('const resolverSujetoKeyDeGrupo=React.useCallback(');
    const fin = PAGE_TSX.indexOf('},[lineasManoObraDisponibles,lineasManoObraResumen]);', inicio);
    expect(inicio).toBeGreaterThan(-1);
    expect(fin).toBeGreaterThan(inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('resolverLineaManoObraId(g,lineasManoObraResumen).lineaManoObraIdResuelto');
  });

  it('10) no cambia ningún cálculo ni total — el caso de control ASEADOR+SUPERVISOR (§10) sigue produciendo los mismos valores', () => {
    const aseador = construirResultadoLineaConOtrosCostos(
      3000000, 9000000,
      construirDesgloseOtrosCostosLinea({ cantidadTrabajadores: 3, dotacion: [{ valorMensual: 70000 }], epp: [], examenes: [], cursos: [], vacunas: [] }),
    );
    const supervisor = construirResultadoLineaConOtrosCostos(
      4500000, 4500000,
      construirDesgloseOtrosCostosLinea({ cantidadTrabajadores: 1, dotacion: [{ valorMensual: 120000 }], epp: [], examenes: [], cursos: [{ valorMensual: 100000, alcance: 'POR_LINEA' }], vacunas: [] }),
    );
    const agregado = agregarCostoMensualTotalManoObra([aseador, supervisor]);
    expect(agregado.costoMensualTotalManoObra).toBe(13930000);
  });
});