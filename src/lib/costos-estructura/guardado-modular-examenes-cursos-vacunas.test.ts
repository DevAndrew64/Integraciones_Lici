/**
 * Ajuste "REDISEÑAR EXÁMENES, CURSOS Y VACUNAS CON EL MISMO PATRÓN DE
 * DOTACIÓN Y EPP" — verificación de cableado en page.tsx (texto fuente,
 * mismo patrón que el resto de guardado-modular-*.test.ts). La lógica pura
 * (factor EX001) ya está cubierta en factor-examen.test.ts; el ensamblador
 * de totales por línea (construirEntradaOtrosCostosLinea) reutiliza
 * otros-costos-por-linea.ts sin cambios propios (ya probado).
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

describe('7) Existe un único modal principal "Registrar Exámenes, Cursos y Vacunas"', () => {
  it('el botón de la ficha exterior abre ModalExamenesCursosVacunas, mismo patrón que EPP y Dotación', () => {
    expect(PAGE_TSX).toContain('{modalExamenesAbierto&&ModalExamenesCursosVacunas()}');
    expect(PAGE_TSX).toContain('Gestionar exámenes, cursos y vacunas');
    expect(PAGE_TSX).toContain('Registrar Exámenes, Cursos y Vacunas');
  });

  it('15/17) los cargos se leen de lineasManoObraDisponiblesOrdenadas (mismo orden agrupado ya aprobado — familia de cargo + turnante después)', () => {
    const b = bloque('function ModalExamenesCursosVacunas(){', 'function ModalRegistroManualExamCursoVacuna(){');
    expect(b).toContain(':lineasManoObraDisponiblesOrdenadas).map((linea,i)=>tarjetaCargoExam(linea,i))');
  });

  it('6) un cargo por horas muestra "21 h semanales" — reutiliza formatearResumenSujetoDotEpp, nunca una lógica de horario ad-hoc', () => {
    const b = bloque('const tarjetaCargoExam=', '\n    return(\n      <div style={{position:\'fixed\'');
    expect(b).toContain('formatearResumenSujetoDotEpp(linea.cantidadTrabajadores,distribuciones)');
  });
});

describe('8) Exámenes, Cursos y Vacunas son colecciones independientes', () => {
  it('examRows/cursosRows/vacunasRows son estados separados, nunca el mismo arreglo', () => {
    expect(PAGE_TSX).toContain('const [examRows,setExamRows]=useState<ExamRow[]>([]);');
    expect(PAGE_TSX).toContain('const [cursosRows,setCursosRows]=useState<CursoRow[]>([]);');
    expect(PAGE_TSX).toContain('const [vacunasRows,setVacunasRows]=useState<VacunaRow[]>([]);');
  });

  it('9/10/11) cada sección del cargo filtra ÚNICAMENTE su propio arreglo — seleccionar examen nunca toca cursosRows/vacunasRows', () => {
    const b = bloque('const tarjetaCargoExam=(linea:typeof lineasManoObraDisponibles[number],indice:number)=>{', 'const abierto=ocultarEncabezado?true:cargoExamAbiertoId===linea.id;');
    expect(b).toContain('const examDeLinea=examRows.filter(r=>r.lineaManoObraId===linea.id);');
    expect(b).toContain('const cursosDeLinea=cursosRows.filter(r=>r.lineaManoObraId===linea.id);');
    expect(b).toContain('const vacunasDeLinea=vacunasRows.filter(r=>r.lineaManoObraId===linea.id);');
  });
});

describe('4/12/13) Trazabilidad de origen — Catálogo vs Manual', () => {
  it('agregarSeleccionadosExam guarda origen:CATALOGO con la fila completa (grupo/código/proveedor/ciudad/municipio), nunca solo descripción+valor', () => {
    const b = bloque('const agregarSeleccionadosExam=()=>{', 'cerrarSelectorExam();');
    expect(b).toContain("origen:'CATALOGO'");
    expect(b).toContain('codGrupoExamen:');
    expect(b).toContain('nitProveedor,');
    expect(b).toContain('codigoMunicipio,');
    expect(b).toContain('factorExamen:resolverFactorExamen(codExamen),');
    expect(b).toContain('fechaUltimaCompra:null,');
  });

  it('guardarRegistroManual guarda origen:MANUAL con usuarioRegistro/fechaRegistro (solo en alta, nunca en edición)', () => {
    const b = bloque('const guardarRegistroManual=()=>{', 'cerrarModalManual();');
    expect(b).toContain("const trazabilidad=esNuevo?{usuarioRegistro:sesion?.usuario,fechaRegistro:new Date().toISOString()}:{};");
    expect(b).toContain("origen:'MANUAL',");
  });
});

describe('14/15) Regla EX001 ×2 — aplicada una sola vez, nunca duplica el valor unitario', () => {
  it('construirEntradaOtrosCostosLinea aplica el factor sobre el valor mensual del examen, nunca sobre r.valor directamente', () => {
    const b = bloque('const mensualRowCurso=(r:{cant:number;valor:number;frecAnios:number})=>', 'const cursos:ItemCostoResuelto[]=cursosRows');
    expect(b).toContain('r.cant*r.valor*(r.factorExamen??resolverFactorExamen(r.codExamen))/resolverFrecuenciaMesesExamen(r)');
  });

  it('examMesPorTrab (agregado global de respaldo) también aplica el mismo factor, una sola fuente de verdad', () => {
    expect(PAGE_TSX).toContain('const examMesPorTrab=examRows.reduce((s,r)=>s+(r.cant*r.valor*(r.factorExamen??resolverFactorExamen(r.codExamen))/resolverFrecuenciaMesesExamen(r)),0);');
  });

  it('la trazabilidad de EX001 se muestra en la fila del modal ("Factor especial ×2")', () => {
    expect(PAGE_TSX).toContain('` · Factor especial ×${factor}`');
    expect(PAGE_TSX).toContain('Factor ×{factor}');
  });
});

describe('16) Almacenar solo aplica el borrador local (nunca ejecuta el PUT modular)', () => {
  it('almacenarConfiguracionExamenesCursosVacunas solo cierra el modal, nunca llama ejecutarGuardadoModuloCosteo', () => {
    const b = bloque('const almacenarConfiguracionExamenesCursosVacunas=()=>{', '\n  };');
    expect(b).not.toContain('ejecutarGuardadoModuloCosteo');
    expect(b).toContain('setModalExamenesAbierto(false);');
  });
});

describe('20) Guardado modular independiente — modulo:"examenesMedicos"', () => {
  it('guardarModuloExamenesMedicos persiste examRows/cursosRows/vacunasRows + las 3 decisiones "No aplica" por cargo, nunca dotGroups/lineasExtra/cargosTurnantes/maqRows/adminRows', () => {
    expect(PAGE_TSX).toContain('function construirDatosEntradaExamenesMedicos(){\n    return { examRows, cursosRows, vacunasRows, examenesNoAplicaLineas, cursosNoAplicaLineas, vacunasNoAplicaLineas };\n  }');
    expect(PAGE_TSX).toContain("ejecutarGuardadoModuloCosteo('examenesMedicos',estadoDestino,datosEntrada,examenesMedicosUltimaActualizacion);");
  });

  it('19/21) guardar/finalizar Exámenes tienen su propio baseline/dirty — nunca tocan el de Mano de Obra/Turnantes/EPP y Dotación', () => {
    expect(PAGE_TSX).toContain('const examenesMedicosBaseline=useRef<string|null>(null);');
    expect(PAGE_TSX).not.toContain('dotacionEppBaseline.current=JSON.stringify(construirDatosEntradaExamenesMedicos');
    expect(PAGE_TSX).not.toContain('manoObraBaseline.current=JSON.stringify(construirDatosEntradaExamenesMedicos');
  });

  it('Ajuste "un solo guardado" — botón "Guardar Exámenes, Cursos y Vacunas" existe y usa su propio estado de guardando; ya no hay botón "Finalizar" separado', () => {
    expect(PAGE_TSX).toContain('Guardar Exámenes, Cursos y Vacunas');
    expect(PAGE_TSX).not.toContain('Finalizar Exámenes, Cursos y Vacunas');
    expect(PAGE_TSX).toContain('onClick={guardarAvanceExamenesMedicos} disabled={guardandoModuloExamenesMedicos}');
  });
});

describe('22) Compatibilidad histórica — módulo nuevo con respaldo del payload plano', () => {
  it('la hidratación prioriza el módulo examenesMedicos y usa d.examRows/cursosRows/vacunasRows como respaldo histórico', () => {
    const b = bloque('const moduloExamenesMedicosResuelto=obtenerModulo<', 'const examRowsCrudo=');
    expect(b.length).toBeGreaterThan(0);
    expect(PAGE_TSX).toContain('const examRowsCrudo=Array.isArray(moduloExamenesMedicosResuelto?.datos?.examRows)?moduloExamenesMedicosResuelto?.datos?.examRows:d.examRows;');
  });
});

describe('17) Ficha exterior de solo lectura', () => {
  it('la ficha exterior (renderSujetoExamSoloLectura) nunca contiene <input> editable — toda edición reabre el modal', () => {
    const b = bloque('const filaSoloLecturaExam=(titulo:string,categoria:CategoriaExamCursoVacuna,filas:(ExamRow|CursoRow|VacunaRow)[])=>{', 'const seccionExam=(origen:OrigenSujetoDotacion,titulo:string)=>{');
    expect(b).not.toContain('<input');
  });
});

// Ajuste "QUITAR LA COLUMNA TIPO DE CURSOS" (feedback en vivo) — el select
// Primera vez/Reentrenamiento de cada fila de Cursos (y su columna de
// encabezado) se retiran de la UI del modal "Registrar Exámenes, Cursos y
// Vacunas". `tipoValorSeleccionado` NUNCA se elimina del modelo: sigue en
// CursoRow, se sigue guardando al agregar desde catálogo (siempre
// 'PRIMERA_VEZ', mismo criterio ya vigente en el selector de catálogo) y
// sigue alimentando `configuracionCurso` (herencia-turnante-otros-costos.ts)
// para la herencia hacia Turnantes. El cálculo mensual sigue usando
// r.valor sin ninguna alteración.
describe('Ajuste "QUITAR LA COLUMNA TIPO DE CURSOS" — el select Primera vez/Reentrenamiento desaparece de la UI, tipoValorSeleccionado se conserva internamente', () => {
  const bFilaCursoTabla = () => bloque('const filaCursoTabla=(linea:typeof lineasManoObraDisponibles[number],r:CursoRow,eliminar:()=>void)=>{', 'const seccionCursosTabla=(');
  const bEncabezadoCursos = () => bloque('const seccionCursosTabla=(', 'const filaVacunaTabla=');

  it('no existe el encabezado "Tipo" en la sección Cursos renderizada', () => {
    const b = bEncabezadoCursos();
    expect(b).not.toContain('>Tipo</div>');
  });

  it('no existe el <select> de tipo (Primera vez/Reentrenamiento) en filaCursoTabla', () => {
    const b = bFilaCursoTabla();
    expect(b).not.toContain('tipoValorSeleccionado??\'PRIMERA_VEZ\'');
    expect(b).not.toContain('REENTRENAMIENTO');
    expect(b).not.toMatch(/<select[^>]*onChange=\{e=>\{[\s\S]*?actualizarCursoRow\(r\.id,\{tipoValorSeleccionado/);
  });

  it('tipoValorSeleccionado sigue existiendo en el modelo CursoRow y se sigue guardando al agregar desde catálogo (agregarSeleccionadosCurso), siempre PRIMERA_VEZ', () => {
    expect(PAGE_TSX).toContain("tipoValorSeleccionado?:'PRIMERA_VEZ'|'REENTRENAMIENTO';");
    const bAgregar = bloque('const agregarSeleccionadosCurso=()=>{', '// ══ SELECTOR "Seleccionar vacunas"');
    expect(bAgregar).toContain('tipoValorSeleccionado:tipoValor,fechaValor:null,');
  });

  it('tipoValorSeleccionado sigue alimentando configuracionCurso (herencia hacia Turnantes) — sin cambios en herencia-turnante-otros-costos.ts', () => {
    const herenciaTs = readFileSync(join(__dirname, '../costos-mano-obra/motor-distribuido/herencia-turnante-otros-costos.ts'), 'utf-8');
    expect(herenciaTs).toContain('tipoValorSeleccionado?: string');
    expect(herenciaTs).toContain('${norm(r.tipoValorSeleccionado)}');
  });

  it('el costo mensual de cada fila sigue calculándose EXACTAMENTE igual (r.cant*r.valor/((r.frecAnios||1)*12)), sin ninguna alteración por quitar la columna', () => {
    const b = bFilaCursoTabla();
    expect(b).toContain('const mensual=r.cant*r.valor/((r.frecAnios||1)*12);');
    expect(b).toContain('{cop(mensual)}');
  });

  it('las columnas Vr curso/Costo mes se reacomodan (100px cada una) para usar el espacio liberado, sin dejar hueco antes del botón eliminar', () => {
    const b = bEncabezadoCursos();
    const idxVr = b.indexOf('Vr curso');
    const idxCosto = b.indexOf('Costo mes');
    const idxAccion = b.lastIndexOf('width:24,flexShrink:0');
    expect(idxVr).toBeGreaterThan(-1);
    expect(idxCosto).toBeGreaterThan(idxVr);
    expect(idxAccion).toBeGreaterThan(idxCosto);
    expect(b).not.toContain('width:80,flexShrink:0,textAlign:\'right\' as const,fontSize:8.5,fontWeight:700,color:\'#64748b\',textTransform:\'uppercase\' as const,letterSpacing:\'.02em\'}}>Vr curso');
  });
});
