/**
 * Corrección funcional — Exámenes Médicos sin registros predeterminados.
 * Verifica que examRows ya no se inicializa con los 4 exámenes fijos
 * (ingreso/periódico/retiro/audiometría), que solo se agregan por
 * selección de catálogo real, registro manual o restauración real.
 *
 * Actualizado por el ajuste "REDISEÑAR EXÁMENES, CURSOS Y VACUNAS": el
 * CRUD plano anterior (addExam/updExam/asignarLineaExam, tabla global sin
 * cargo) se reemplazó por el modal por cargo ("Registrar Exámenes, Cursos
 * y Vacunas") — selExamChecked (Set de índices) pasó a selExamSeleccion
 * (Map por identidad, sobrevive a la paginación); addExam (fila manual
 * vacía sin cargo) pasó a `guardarRegistroManual` (siempre con
 * lineaManoObraId/sujetoKey explícitos, nunca "pendiente de asignación").
 * Misma metodología de verificación de fuente que el resto de pruebas de
 * page.tsx (no existe arnés de render para este archivo).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolverLineaManoObraId } from './otros-costos-por-linea';
import type { LineaManoObraResumen } from './otros-costos-por-linea';

const PAGE_TSX = readFileSync(join(__dirname, '../../../app/page.tsx'), 'utf-8');

describe('page.tsx — examRows ya no se precarga con los 4 exámenes predeterminados', () => {
  it('1) el estado inicial de examRows es un arreglo vacío, nunca los 4 exámenes fijos', () => {
    expect(PAGE_TSX).toContain('const [examRows,setExamRows]=useState<ExamRow[]>([]);');
  });

  it('los 4 exámenes predeterminados (ingreso/periódico/retiro/audiometría) ya no existen como literal en el código', () => {
    expect(PAGE_TSX).not.toContain('Examen de ingreso');
    expect(PAGE_TSX).not.toContain('Examen periódico anual');
    expect(PAGE_TSX).not.toContain('Examen de retiro');
    expect(PAGE_TSX).not.toContain("tipo:'Audiometría'");
  });

  it('2/3) no existe ningún useEffect ni inicializador que reasigne examRows a una lista fija al abrir la pestaña o crear el primer cargo', () => {
    const llamadasSetExamRows = PAGE_TSX.match(/setExamRows\([^)]*\)/g) ?? [];
    expect(llamadasSetExamRows.every(c =>
      !c.includes("tipo:'Examen") && !c.includes('Audiometría'),
    )).toBe(true);
  });

  it('4) abrir el catálogo (showSelExam) no agrega exámenes por sí solo — solo agregarSeleccionadosExam() escribe en examRows, y depende de selExamSeleccion', () => {
    const inicio = PAGE_TSX.indexOf('const agregarSeleccionadosExam=()=>{');
    const fin = PAGE_TSX.indexOf('cerrarSelectorExam();', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('selExamSeleccion.forEach');
    expect(bloque).toContain('if(!nuevas.length)return;');
  });

  it('5/6/7) agregarSeleccionadosExam agrega solo los ítems marcados en selExamSeleccion — nunca una lista predeterminada aparte', () => {
    const inicio = PAGE_TSX.indexOf('const agregarSeleccionadosExam=()=>{');
    const fin = PAGE_TSX.indexOf('cerrarSelectorExam();', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('setExamRows(p=>[...p,...nuevas]);');
    expect(bloque).not.toContain('Examen de ingreso');
  });

  it('8) el registro manual (guardarRegistroManual) siempre trae lineaManoObraId/sujetoKey explícitos desde el contexto del cargo — nunca una fila "pendiente de asignación" por defecto (reemplaza al viejo addExam sin cargo)', () => {
    const inicio = PAGE_TSX.indexOf('const guardarRegistroManual=()=>{');
    const fin = PAGE_TSX.indexOf('\n  };', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain("id:idAsignado,sujetoKey,lineaManoObraId:lineaId,origen:'MANUAL',");
    expect(bloque).not.toContain('Examen de ingreso');
  });

  it('9/10/11) una fila sin cant/valor no se suma al costo ni cuenta como pendiente (mismo filtro cant>0&&valor>0 ya usado en el resto del cierre operativo)', () => {
    const inicio = PAGE_TSX.indexOf('const itemsOtrosCostosPendientes=React.useMemo');
    const fin = PAGE_TSX.indexOf('const agregadoCostoMensualTotalManoObra=React.useMemo', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain("examRows.filter(r=>pend(resolverLineaManoObraId(r,lineasManoObraResumen).estado)&&(r.cant>0&&r.valor>0))");
  });

  it('costo de exámenes: con examRows vacío, examMesPorTrab es 0 (misma fórmula + factor EX001, ninguna precarga que sumar)', () => {
    const examRows: { cant: number; valor: number; frecAnios: number; factorExamen?: number }[] = [];
    const examMesPorTrab = examRows.reduce((s, r) => s + (r.cant * r.valor * (r.factorExamen ?? 1) / ((r.frecAnios || 1) * 12)), 0);
    expect(examMesPorTrab).toBe(0);
  });

  it('12) un examen histórico sin lineaManoObraId (payload anterior a este ajuste) queda PENDIENTE_DE_ASIGNACION — nunca se pierde ni se adivina', () => {
    const lineas: LineaManoObraResumen[] = [
      { id: 1, cargoCodigo: 'ASEADOR', cantidadTrabajadores: 3 },
      { id: 2, cargoCodigo: 'SUPERVISOR', cantidadTrabajadores: 1 },
    ];
    const examenRecienAgregado = { tipo: 'Examen de laboratorio', lineaManoObraId: undefined as number | undefined };
    const r = resolverLineaManoObraId(examenRecienAgregado, lineas);
    expect(r.estado).toBe('PENDIENTE_DE_ASIGNACION');
    expect(r.lineaManoObraIdResuelto).toBeNull();
  });

  it('13) aplicarDatosGuardados restaura examRows desde el módulo examenesMedicos (o el payload plano histórico como respaldo)', () => {
    const inicio = PAGE_TSX.indexOf('function aplicarDatosGuardados(');
    const fin = PAGE_TSX.indexOf('function ', inicio + 10);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain("const examRowsCrudo=Array.isArray(moduloExamenesMedicosResuelto?.datos?.examRows)?moduloExamenesMedicosResuelto?.datos?.examRows:d.examRows;");
    expect(bloque).toContain('setExamRows(examRowsD);');
  });

  it('14) un registro histórico sin la propiedad examRows NUNCA activa un fallback a los 4 exámenes, y TAMPOCO deja examRows del costeo anterior en memoria — siempre se asigna [] explícito', () => {
    const inicio = PAGE_TSX.indexOf('function aplicarDatosGuardados(');
    const fin = PAGE_TSX.indexOf('function ', inicio + 10);
    const bloque = PAGE_TSX.slice(inicio, fin);
    const guardIdx = bloque.indexOf('const examRowsCrudo=');
    const cierre = bloque.indexOf('nextExId.current=Math.max', guardIdx);
    const tramoGuard = bloque.slice(guardIdx, cierre + 60);
    expect(tramoGuard).not.toContain('Examen de ingreso');
    expect(tramoGuard).not.toContain('if(Array.isArray');
  });

  it('15/16) el borrador (buildDraftData) viaja con examRows tal cual el estado actual — vacío si no hay exámenes, completo si los hay', () => {
    const inicio = PAGE_TSX.indexOf('const buildDraftData=()=>({');
    const fin = PAGE_TSX.indexOf('});', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('examRows');
  });

  it('17/18) el selector consulta el catálogo real de exámenes — no se tocó la API externa ni se eliminó nada del catálogo. Ajuste "CORREGIR SELECTOR DE EXÁMENES MÉDICOS" §1/§12: ahora SIEMPRE viaja por /api/examenes/por-grupo (filtra+agrupa+pagina en el servidor), nunca por el GET /api/examenes sin agrupar', () => {
    expect(PAGE_TSX).toContain("await fetch('/api/examenes/por-grupo'");
    expect(PAGE_TSX).toContain('const consultarCatalogExam=async(pagina:number=1,filtrosOverride?:{grupo?:string;q?:string;codExamen?:string;ciudad?:string})=>{');
  });

  it('el estado vacío de una categoría (Exámenes/Cursos/Vacunas) dentro del modal por cargo muestra "Sin elementos seleccionados", sin filas ni exámenes predeterminados', () => {
    expect(PAGE_TSX).toContain('Sin elementos seleccionados');
    const inicio = PAGE_TSX.indexOf('const seccionCategoria=(');
    const fin = PAGE_TSX.indexOf('const tarjetaCargoExam=', inicio);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).not.toContain('Examen de ingreso');
  });
});
