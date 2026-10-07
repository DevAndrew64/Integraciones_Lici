/**
 * Ajuste "HERENCIA DE DOTACIÓN/EPP/EXÁMENES/VACUNAS/CURSOS DEL CARGO AL
 * TURNANTE" — verificación de cableado en page.tsx (texto fuente, mismo
 * patrón que el resto de guardado-modular-*.test.ts). La cobertura
 * numérica real de la consolidación/costeo vive en
 * `herencia-turnante-otros-costos-integracion.test.ts` (motor real, sin
 * readFileSync).
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

describe('Caso 7 — HORAS_REALES: la línea de referencia TURNANTE-AUTO-REF42 nunca genera por sí sola Dotación/EPP/etc.', () => {
  it('el costeo de herencia se multiplica por grupo.necesidad.cantidadTurnantesFisicos, nunca por cantOpeFijos ni por la línea técnica', () => {
    const b = bloque('const resultadosHerenciaOtrosCostosTurnantes=React.useMemo(()=>{', 'lineasManoObraDisponibles]);');
    expect(b).toContain('const cantidadTurnantesFisicos=grupo.necesidad.cantidadTurnantesFisicos;');
    expect(b).toContain('cantidadTrabajadores:cantidadTurnantesFisicos');
    expect(b).not.toContain('cantOpeFijos');
    expect(b).not.toContain('calcularCostoProporcionalTurnante');
  });

  it('el costeo de herencia nunca lee dotGroups/examRows/cursosRows/vacunasRows filtrados por el id de una línea TURNANTE-AUTO — solo por posicionIds (posiciones de origen del cargo)', () => {
    const b = bloque('const resultadosHerenciaOtrosCostosTurnantes=React.useMemo(()=>{', 'lineasManoObraDisponibles]);');
    expect(b).toContain('const posicionIds=grupo.coberturaPorPosicion.map(c=>Number(c.id))');
    expect(b).not.toContain('cargosTurnantes.find');
    expect(b).not.toContain("l.esTurnanteAutomatico");
  });

  it('construirLineaTurnanteAutomaticaBase (línea técnica) nunca recibe/escribe dotGroups/examRows/cursosRows/vacunasRows — sigue exclusivamente laboral', () => {
    const inicio = PAGE_TSX.indexOf('function construirLineaTurnanteAutomaticaBase(');
    expect(inicio).toBeGreaterThan(-1);
    const b = PAGE_TSX.slice(inicio, inicio + 2500);
    expect(b).not.toContain('setDotGroups');
    expect(b).not.toContain('setExamRows');
    expect(b).not.toContain('setCursosRows');
    expect(b).not.toContain('setVacunasRows');
  });
});

describe('Caso 8 — 42h + 21h combinado: la cantidad de cobros depende de personas físicas, nunca de líneas técnicas', () => {
  it('resultadosHerenciaOtrosCostosTurnantes se calcula UNA vez por grupo (Map keyed por claveGrupo), nunca una vez por línea técnica (linea42/linea21)', () => {
    const b = bloque('const resultadosHerenciaOtrosCostosTurnantes=React.useMemo(()=>{', 'lineasManoObraDisponibles]);');
    expect(b).toContain('for(const grupo of gruposNecesidadTurnantes){');
    expect(b).toContain('resultado.set(grupo.claveGrupo,');
    // nunca itera cargosTurnantes/líneas técnicas para decidir cuántas veces costear
    expect(b).not.toContain('for(const linea of cargosTurnantes)');
  });
});

describe('CORRECCIÓN DE REGLA DE NEGOCIO — el heredado entra como "Otros costos" de la propia ficha financiera del turnante, ANTES del factor laboral, nunca sumado aparte después', () => {
  it('resultadosHerenciaComoLineas (la entrada separada del agregado, con costoLaboralMensualLinea:0) ya NO existe — fue retirada', () => {
    expect(PAGE_TSX).not.toContain('resultadosHerenciaComoLineas');
  });

  it('resultadosTurnantesConOtrosCostos usa entradaOtrosCostos de resultadosHerenciaOtrosCostosTurnantes para una línea técnica de turnante — nunca construirEntradaOtrosCostosLinea(r.id) (que para el turnante siempre está vacía)', () => {
    const b = bloque('const resultadosTurnantesConOtrosCostos=React.useMemo(', '\n  );');
    expect(b).toContain('const herenciaGrupo=r.claveGrupoTurnante?resultadosHerenciaOtrosCostosTurnantes.get(r.claveGrupoTurnante):undefined;');
    expect(b).toContain('const entradaOtros=herenciaGrupo?herenciaGrupo.entradaOtrosCostos:construirEntradaOtrosCostosLinea(r.id);');
    // el factor laboral se sigue aplicando DESPUÉS (costoTotalGrupoTurnante/
    // resultadosTurnantesConOtrosCostosParaAgregado, sin cambios) — nunca aquí.
    expect(b).not.toContain('calcularCostoProporcionalTurnante');
  });

  it('resultadosCargosTurnantesMensuales expone claveGrupoTurnante por línea — la relación estable que resultadosTurnantesConOtrosCostos usa para encontrar su herencia', () => {
    const b = bloque('const resultadosCargosTurnantesMensuales=React.useMemo(', '\n  );');
    expect(b).toContain('claveGrupoTurnante:l.claveGrupoTurnante,');
  });

  it('agregadoCostoMensualTotalManoObra y agregadoOtrosCostosTurnantes ya NO agregan una entrada de herencia por separado — el heredado llega dentro de resultadosTurnantesConOtrosCostosParaAgregado (ya escalado por el factor laboral)', () => {
    const bTotal = bloque('const agregadoCostoMensualTotalManoObra=React.useMemo(', '\n  );');
    expect(bTotal).toContain('...resultadosLineasExtraConOtrosCostos.map(r=>r.resultado)');
    expect(bTotal).toContain('...resultadosTurnantesConOtrosCostosParaAgregado.map(r=>r.resultado)');
    expect(bTotal).not.toContain('resultadosHerenciaComoLineas');

    const bTurnantes = bloque('const agregadoOtrosCostosTurnantes=React.useMemo(', '\n  );');
    expect(bTurnantes).toContain('...resultadosTurnantesConOtrosCostosParaAgregado.map(r=>r.resultado)');
    expect(bTurnantes).not.toContain('resultadosHerenciaComoLineas');
  });

  it('resultadosHerenciaOtrosCostosTurnantes expone entradaOtrosCostos (arreglos crudos de UNA persona física, sin multiplicar por cantidadTurnantesFisicos) — la línea técnica es quien multiplica por su propio headcount', () => {
    const b = bloque('const resultadosHerenciaOtrosCostosTurnantes=React.useMemo(()=>{', 'lineasManoObraDisponibles]);');
    expect(b).toContain('entradaOtrosCostos:{dotacion,epp,examenes,cursos,vacunas},');
  });
});

describe('Consolidación por identidad — reutiliza el módulo puro, nunca una fórmula de dedup propia en page.tsx', () => {
  it('page.tsx importa consolidarFilasPorIdentidad y las funciones de identidad/configuración de los 5 módulos desde herencia-turnante-otros-costos.ts', () => {
    expect(PAGE_TSX).toContain("from '@/lib/costos-mano-obra/motor-distribuido/herencia-turnante-otros-costos';");
    expect(PAGE_TSX).toContain('consolidarFilasPorIdentidad');
    expect(PAGE_TSX).toContain('identidadDotItem, configuracionDotItem');
    expect(PAGE_TSX).toContain('identidadExamen, configuracionExamen');
    expect(PAGE_TSX).toContain('identidadVacuna, configuracionVacuna');
    expect(PAGE_TSX).toContain('identidadCurso, configuracionCurso');
  });

  it('los 5 módulos se consolidan por separado (Dotación masculina/femenina/otros, EPP, Exámenes, Cursos, Vacunas) — nunca mezclados en una sola llamada', () => {
    const b = bloque('const resultadosHerenciaOtrosCostosTurnantes=React.useMemo(()=>{', 'lineasManoObraDisponibles]);');
    expect(b).toContain('const conHombre=consolidarFilasPorIdentidad(hombreFilas,identidadDotItem,configuracionDotItem);');
    expect(b).toContain('const conMujer=consolidarFilasPorIdentidad(mujerFilas,identidadDotItem,configuracionDotItem);');
    expect(b).toContain('const conEpp=consolidarFilasPorIdentidad(eppFilas,identidadDotItem,configuracionDotItem);');
    expect(b).toContain('const conExam=consolidarFilasPorIdentidad(examFilas,identidadExamen,configuracionExamen);');
    expect(b).toContain('const conCurso=consolidarFilasPorIdentidad(cursoFilas,identidadCurso,configuracionCurso);');
    expect(b).toContain('const conVacuna=consolidarFilasPorIdentidad(vacunaFilas,identidadVacuna,configuracionVacuna);');
  });

  it('el promedio Masculino/Femenino de la herencia reutiliza promediarDotacionPorSexo (nunca suma directa)', () => {
    const b = bloque('const resultadosHerenciaOtrosCostosTurnantes=React.useMemo(()=>{', 'lineasManoObraDisponibles]);');
    expect(b).toContain('const dotacionPromedioUnitaria=promediarDotacionPorSexo(totalHombre,conHombre.consolidadas.length>0,totalMujer,conMujer.consolidadas.length>0);');
  });
});

describe('UI — el heredado se ve "tal cual" en "Otros costos mensuales" (Ver detalle) del turnante, ya afectado por el factor junto con el resto de la ficha, con conflictos siempre visibles', () => {
  it('gruposTurnantesManoObra vuelve a la fórmula original de "otros" (resultadoRef.otrosCostosMensualesLinea/cantidadTrabajadoresLinea) — sin ningún ajuste cosmético aparte, porque resultadoRef YA incluye el heredado real', () => {
    const inicio = PAGE_TSX.indexOf('const gruposTurnantesManoObra=React.useMemo(');
    expect(inicio).toBeGreaterThan(-1);
    const b = PAGE_TSX.slice(inicio, inicio + 11000);
    expect(b).toContain('otros:cantidadTrabajadoresLinea>0?Math.round(resultadoRef.otrosCostosMensualesLinea/cantidadTrabajadoresLinea):0,');
    expect(b).not.toContain('otrosPorTrabajadorHeredado');
    // costoMensualTotal (el motor salarial real) sigue viniendo EXCLUSIVAMENTE de costoTotalGrupoTurnante — ya con el heredado adentro de resultado42/resultado21
    expect(b).toContain('const costoMensualTotal=costoTotalGrupoTurnante(grupo,resultado42,resultado21);');
  });

  it('FichaTurnante muestra la advertencia de conflicto de herencia de forma visible, nunca en silencio, y nunca ofrece edición directa', () => {
    const inicio = PAGE_TSX.indexOf('function FichaTurnante(');
    expect(inicio).toBeGreaterThan(-1);
    const b = PAGE_TSX.slice(inicio, inicio + 20000);
    expect(b).toContain('con configuración distinta entre posiciones de origen');
    expect(b).toContain('no se costean hasta resolver el conflicto desde el cargo principal');
    const inicioHerencia = b.indexOf('g.herencia&&g.herencia.conflictos.length>0');
    expect(inicioHerencia).toBeGreaterThan(-1);
    const bloqueHerencia = b.slice(inicioHerencia, inicioHerencia + 1200);
    expect(bloqueHerencia).not.toContain('<input');
    expect(bloqueHerencia).not.toContain('<select');
  });

  it('FichaTurnante nunca repite el desglose por módulo (Dotación/EPP/Exámenes/Vacunas/Cursos) debajo — ya se ve arriba en "Otros costos mensuales" y en las pestañas con tabla', () => {
    const inicio = PAGE_TSX.indexOf('function FichaTurnante(');
    const b = PAGE_TSX.slice(inicio, inicio + 20000);
    expect(b).not.toContain("etiqueta:'Dotación heredada'");
    expect(b).not.toContain("etiqueta:'EPP heredado'");
    expect(b).not.toContain('Otros costos heredados del cargo');
  });
});

describe('Ajuste "EL TURNANTE NO DEBE TENER EDICIÓN MANUAL INDEPENDIENTE" — Dotación/EPP/Exámenes/Vacunas/Cursos son SOLO LECTURA para un turnante', () => {
  it('renderSujetoDotEppSoloLectura nunca renderiza el botón "Gestionar dotación y EPP" para un sujeto turnante — solo lectura, con la MISMA tabla con columnas que ya usa el cargo', () => {
    const inicio = PAGE_TSX.indexOf('const renderSujetoDotEppSoloLectura=');
    expect(inicio).toBeGreaterThan(-1);
    const b = PAGE_TSX.slice(inicio, inicio + 12000);
    expect(b).toContain('const esTurnanteSoloLectura=linea.origen===\'turnante\';');
    expect(b).toContain('esTurnanteSoloLectura?(');
    // el botón "Gestionar" solo se renderiza en la rama NO turnante
    const idxBoton = b.indexOf('>Gestionar dotación y EPP</button>');
    const idxRamaNoTurnante = b.indexOf('):(');
    expect(idxBoton).toBeGreaterThan(idxRamaNoTurnante);
    // reutiliza renderGrupoDotEppSoloLectura (misma tabla con columnas), nunca un listado de texto plano
    expect(b).toContain("renderGrupoDotEppSoloLectura('Dotación masculina',{id:-1,tipo:'dot'");
    expect(b).toContain("renderGrupoDotEppSoloLectura('EPP',{id:-4,tipo:'epp'");
  });

  it('renderSujetoExamSoloLectura nunca renderiza el botón "Gestionar exámenes, cursos y vacunas" para un sujeto turnante', () => {
    const inicio = PAGE_TSX.indexOf('const renderSujetoExamSoloLectura=');
    expect(inicio).toBeGreaterThan(-1);
    const b = PAGE_TSX.slice(inicio, inicio + 8000);
    expect(b).toContain('const esTurnanteSoloLectura=linea.origen===\'turnante\';');
    expect(b).toContain('{!esTurnanteSoloLectura&&(');
    const idxBoton = b.indexOf('>Gestionar exámenes, cursos y vacunas</button>');
    const idxGuard = b.indexOf('{!esTurnanteSoloLectura&&(');
    expect(idxBoton).toBeGreaterThan(idxGuard);
  });

  it('para un turnante, examDeLinea/cursosDeLinea/vacunasDeLinea vienen de la herencia (filasExam/filasCurso/filasVacuna) — nunca de examRows/cursosRows/vacunasRows filtradas por su propio id (esas siempre están vacías por diseño)', () => {
    const inicio = PAGE_TSX.indexOf('const renderSujetoExamSoloLectura=');
    const b = PAGE_TSX.slice(inicio, inicio + 2000);
    expect(b).toContain('esTurnanteSoloLectura?(herenciaLinea?.filasExam??[])');
    expect(b).toContain('esTurnanteSoloLectura?(herenciaLinea?.filasCurso??[])');
    expect(b).toContain('esTurnanteSoloLectura?(herenciaLinea?.filasVacuna??[])');
  });
});

describe('Ajuste "CONFLICTOS NO DEBEN CONVERTIRSE SILENCIOSAMENTE EN COSTO $0" — bloquean guardar/finalizar, reutilizando el mecanismo ya existente de "costos pendientes de asignación"', () => {
  it('exportarCostos se detiene con un mensaje explícito si hay conflictos de herencia — antes de intentar guardar', () => {
    const inicio = PAGE_TSX.indexOf('async function exportarCostos(){');
    expect(inicio).toBeGreaterThan(-1);
    const b = PAGE_TSX.slice(inicio, inicio + 2000);
    expect(b).toContain('if(conflictosHerenciaTurnantesTotal>0){');
    expect(b).toContain("setSaveMsg('Conflicto de configuración heredada — costo pendiente.");
    expect(b).toContain('return;');
  });

  it('el botón de guardar queda deshabilitado si hay conflictos de herencia, igual que con costos pendientes de asignación', () => {
    const inicio = PAGE_TSX.indexOf('<button onClick={exportarCostos}');
    expect(inicio).toBeGreaterThan(-1);
    const b = PAGE_TSX.slice(inicio, inicio + 1200);
    expect(b).toContain('conflictosHerenciaTurnantesTotal>0');
    expect(b).toContain('Conflicto de configuración heredada — costo pendiente.');
  });

  it('conflictosHerenciaTurnantesTotal se deriva de resultadosHerenciaOtrosCostosTurnantes — nunca un conteo aparte', () => {
    const inicio = PAGE_TSX.indexOf('const conflictosHerenciaTurnantesTotal=React.useMemo(');
    expect(inicio).toBeGreaterThan(-1);
    const b = PAGE_TSX.slice(inicio, inicio + 300);
    expect(b).toContain('resultadosHerenciaOtrosCostosTurnantes.values()');
    expect(b).toContain('h.conflictos.length');
  });
});
