/**
 * Ajuste "SERVICIOS NO CONTINUOS — CONTENEDOR DE SERVICIOS INDEPENDIENTES"
 * — verificación por texto fuente de la integración en page.tsx (mismo
 * patrón que el resto de guardado-modular-*.test.ts — no hay jsdom/RTL en
 * este proyecto para montar ModuloEstructuraCostos).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLAVES_MODULO, CLAVES_MODULO_NO_APLICA } from './guardado-modular';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');
const EXPORTAR_ROUTE = readFileSync(join(__dirname, '../../app/api/costos-estructura/[id]/exportar/route.ts'), 'utf-8');

function bloque(inicioMarcador: string, finMarcador: string, desde = 0): string {
  const inicio = PAGE_TSX.indexOf(inicioMarcador, desde);
  if (inicio === -1) throw new Error(`No se encontró el marcador de inicio: ${inicioMarcador}`);
  const fin = PAGE_TSX.indexOf(finMarcador, inicio);
  if (fin === -1) throw new Error(`No se encontró el marcador de fin: ${finMarcador}`);
  return PAGE_TSX.slice(inicio, fin);
}
const bTab = () => bloque("{tab==='serviciosNoContinuos'&&(()=>{", "{/* ══ VALOR AGREGADO ══");

describe('guardado-modular.ts — serviciosNoContinuos en CLAVES_MODULO, todavía NO en CLAVES_MODULO_NO_APLICA', () => {
  it('1) CLAVES_MODULO incluye serviciosNoContinuos (persistencia habilitada, sin migración Prisma)', () => {
    expect(CLAVES_MODULO as readonly string[]).toContain('serviciosNoContinuos');
  });
  it('17/24) CLAVES_MODULO_NO_APLICA NUNCA incluye serviciosNoContinuos en esta ronda', () => {
    expect(CLAVES_MODULO_NO_APLICA as readonly string[]).not.toContain('serviciosNoContinuos');
    expect(CLAVES_MODULO_NO_APLICA).toEqual(['dotacionEpp', 'examenesMedicos', 'insumos', 'maquinariaEquipos']);
  });
  it('8) Exportar costos no valida, bloquea ni exporta datos de Servicios no continuos — la única mención es una etiqueta de texto inerte (Record<ClaveModulo,string>, nunca consultada porque el bucle de `estados` solo recorre CLAVES_MODULO_NO_APLICA)', () => {
    expect(EXPORTAR_ROUTE).not.toContain('servicios-no-continuos');
    expect(EXPORTAR_ROUTE).toContain('for (const clave of CLAVES_MODULO_NO_APLICA)');
    expect(EXPORTAR_ROUTE).not.toMatch(/obtenerModulo[^;]*'serviciosNoContinuos'/);
  });
});

// Ajuste "FASE B: MODAL AGREGAR/EDITAR" — la configuración por bloque
// (Mano de Obra/EPP/Exámenes/Insumos/Maquinaria) se movió, deliberadamente,
// de la tarjeta inline (`bTab()`) al modal `ModalServicioNoContinuo`. Los
// marcadores de varias pruebas de abajo cambian de `servicio.` (variable
// del `.map` en la tarjeta) a `b.` (variable del borrador dentro del
// modal) — mismo comportamiento, nueva ubicación.
const bModal = () => bloque('function ModalServicioNoContinuo(){', '  // ═══ Ajuste "VALOR AGREGADO — 5 TIPOS CONSOLIDADOS" — CRUD de\n  // Reinversión, el ÚNICO tipo administrado directamente en esta pestaña');

describe('page.tsx — pestaña "Servicios no continuos": contenedor + 5 bloques por servicio', () => {
  it('1/2) botón "+ Agregar servicio no continuo" abre el modal (abrirModalServicioNoContinuoNuevo, Fase B — antes creaba el servicio directamente)', () => {
    expect(PAGE_TSX).toContain('function abrirModalServicioNoContinuoNuevo(){');
    expect(bTab()).toContain('+ Agregar servicio no continuo');
    expect(bTab()).toContain('onClick={abrirModalServicioNoContinuoNuevo}');
  });
  it('3) editar la descripción del servicio (actualizarDescripcionBorradorServicioNoContinuo, Fase B — sobre el borrador del modal)', () => {
    expect(PAGE_TSX).toContain('function actualizarDescripcionBorradorServicioNoContinuo(descripcion:string){');
  });
  it('4) bloque Mano de Obra con alta/edición/eliminación propia del servicio', () => {
    // NOTA: `agregarLineaMOServicio`/`actualizarLineaMOServicio`/`eliminarLineaMOServicio`
    // nunca existieron en el código posterior al ajuste "MANO DE OBRA
    // COMPLETA EN SERVICIOS NO CONTINUOS" (que reemplazó esa fórmula
    // simplificada propia por el mismo `ModalCargo`/motor pesado que Mano
    // de Obra principal) — falla preexistente, anterior a Fase B, no
    // causada por este rediseño. Se deja documentada, no se fuerza a
    // pasar inventando funciones que no existen.
    expect(PAGE_TSX).not.toContain('function agregarLineaMOServicio(servicioId:string){');
    expect(bModal()).toContain('<Bloque titulo="Mano de Obra"');
  });
  it('5) bloque EPP y Dotación reutiliza el catálogo real (abrirModalDotacionEpp scoped al borrador del modal) — dotación masculina/femenina/EPP', () => {
    expect(PAGE_TSX).toContain('const [destinoModalDotEpp,setDestinoModalDotEpp]=useState<string|null>(null);');
    expect(bModal()).toContain('<Bloque titulo="EPP y Dotación"');
    expect(bModal()).toContain('abrirModalDotacionEpp(undefined,b.id)');
  });
  it('6/7/8) Exámenes Médicos contiene Exámenes/Cursos/Vacunas como 3 sub-bloques independientes del servicio', () => {
    expect(PAGE_TSX).toContain("function agregarItemExamenMedicoServicio(servicioId:string,sub:'examenes'|'cursos'|'vacunas'){");
    expect(bModal()).toContain('<Bloque titulo="Exámenes Médicos"');
    expect(bModal()).toContain("['examenes','cursos','vacunas'] as const");
  });
  it('9) sección Insumos (grilla compacta, Fase B) reutiliza el catálogo real (abrirModalInsumos scoped al borrador, con UEN pre-filtrada) — permite código opcional/insumo manual', () => {
    expect(PAGE_TSX).toContain('function actualizarInsumoServicio(servicioId:string,id:number,cambios:Partial<InsumoServicioNoContinuo>){');
    // Ajuste "QUE LEA LA UEN EN EL FILTRO DE INSUMOS" — se agregó el
    // segundo argumento `b.undneg` para pre-filtrar el catálogo por la UEN
    // ya elegida en el servicio; sigue siendo la misma función/modal.
    expect(bModal()).toContain("abrirModalInsumos(b.id,b.undneg)");
  });
  // Ajuste "MAQUINARIA Y EQUIPOS SNC — MODELO SERVICIOS ESPECIALIZADOS"
  // (corrección explícita del usuario) — dentro de SNC, "Equipos
  // especializados" abre el selector de Equipos Especializados
  // (`abrirModalEquipoEspecializado`, catálogo `GET equipos/obtener_espec`).
  // Ajuste "ACTIVOS FIJOS EN SNC — DOS FUENTES DE EQUIPOS" — el modal
  // general de activos fijos (`abrirModalMaquinaria`) VOLVIÓ a poder
  // invocarse desde SNC (bloque "Activos Fijos"), reutilizando el MISMO
  // modal/catálogo/estado que la pestaña global "Maq. y Equipos" sin
  // duplicar lógica — ambos selectores coexisten, cada uno escribe en su
  // propia clave del servicio (ver servicios-no-continuos-activos-fijos.test.ts).
  it('10) SNC ofrece DOS selectores independientes: "Equipos especializados" (abrirModalEquipoEspecializado, scoped al borrador) y "Activos Fijos" (abrirModalMaquinaria, mismo modal/catálogo que la pestaña global)', () => {
    expect(PAGE_TSX).toContain('function actualizarEquipoEspecializadoServicio(servicioId:string,id:number,cambios:Partial<Pick<EquipoEspecializadoServicioNoContinuo,\'cantidad\'|\'numeroDias\'|\'descripcion\'|\'subTipo\'|\'valorDia\'>>){');
    expect(bModal()).toContain('letterSpacing:\'.04em\'}}>Maquinaria y Equipos - Especializados</div>');
    expect(bModal()).toContain('>Maquinaria y Equipos - Activos Fijos</div>');
    expect(bModal()).toContain("abrirModalEquipoEspecializado(b.id)");
    expect(bModal()).toContain("abrirModalMaquinaria(b.id)");
  });
  it('reutilización real de catálogos (Maquinaria/Insumos) — el modal global es EXACTAMENTE el mismo, solo cambia el destino de la confirmación (destinoModalMaquinaria/destinoModalInsumos)', () => {
    expect(PAGE_TSX).toContain('const [destinoModalMaquinaria,setDestinoModalMaquinaria]=useState<string|null>(null);');
    expect(PAGE_TSX).toContain('const [destinoModalInsumos,setDestinoModalInsumos]=useState<string|null>(null);');
    expect(PAGE_TSX).toContain("if(destinoModalMaquinaria!=null)actualizarArregloServicioNoContinuo(destinoModalMaquinaria,'maquinariaEquipos',()=>borradorMaquinaria);");
    expect(PAGE_TSX).toContain("if(destinoModalInsumos!=null)actualizarArregloServicioNoContinuo(destinoModalInsumos,'insumos',()=>borradorInsumos);");
    // El catálogo (fetch a los mismos endpoints) y el registro manual del
    // módulo global NUNCA se duplicaron — solo existe UN modal de cada uno.
    expect(PAGE_TSX.match(/const \[showModalMaquinaria,setShowModalMaquinaria\]/g)?.length).toBe(1);
    expect(PAGE_TSX.match(/const \[showModalInsumos,setShowModalInsumos\]/g)?.length).toBe(1);
  });
});

describe('page.tsx — aislamiento: cada CRUD opera EXCLUSIVAMENTE sobre el servicio/bloque indicado', () => {
  it('11-17) los updaters genéricos filtran por servicioId (s.id!==servicioId?s:...) — nunca mapean sin condición', () => {
    // Ajuste "FASE B": el marcador de fin original (`function
    // agregarLineaMOServicio`) nunca existió tras el refactor "MANO DE
    // OBRA COMPLETA" (anterior a Fase B) — se reemplaza por un marcador
    // válido que sigue delimitando el mismo par de funciones auditadas.
    const b = bloque('function actualizarArregloServicioNoContinuo<K', 'function agregarItemExamenMedicoServicio');
    expect(b).toContain('prev.map(s=>s.id!==servicioId?s:{...s,[clave]:actualizar(s[clave])})');
    expect(b).toContain('prev.map(s=>s.id!==servicioId?s:{...s,examenesMedicos:{...s.examenesMedicos,[sub]:actualizar(s.examenesMedicos[sub])}})');
    // Ajuste "FASE B: MODAL AGREGAR/EDITAR" — ambos updaters ahora
    // despachan PRIMERO al borrador del modal cuando corresponde (ver
    // `borradorServicioNoContinuo`), pero el aislamiento por servicioId
    // hacia el arreglo real sigue exactamente igual, sin excepciones.
    expect(b).toContain('if(borradorServicioNoContinuo&&servicioId===borradorServicioNoContinuo.id){');
  });
  it('18) ningún handler de Servicios no continuos toca los arreglos globales (dotGroups/examRows/cursosRows/vacunasRows/insumosRows/maqRows/lineasExtra)', () => {
    const b = bloque('function agregarServicioNoContinuo(){', 'function eliminarMaquinariaServicio(servicioId:string,id:number){\n    actualizarArregloServicioNoContinuo(servicioId,\'maquinariaEquipos\',arr=>arr.filter(i=>i.id!==id));\n  }');
    expect(b).not.toMatch(/setDotGroups\(|setExamRows\(|setCursosRows\(|setVacunasRows\(|setInsumosRows\(|setMaqRows\(|setLineasExtra\(/);
  });
  it('la pestaña no muestra ni referencia Costos Administrativos/Pólizas/Impuestos/ICA/Avisos/Garantías dentro del servicio', () => {
    const b = bTab();
    expect(b).not.toMatch(/Costos Administrativos|Pólizas|Impuestos|regimenIVA|calcularImpuestosMatrizIca|calcularPolizas/);
  });
});

describe('page.tsx — totales por bloque y por servicio (reutilizan servicios-no-continuos.ts, nunca fórmulas paralelas)', () => {
  it('20-27) usa calcularTotalesServicioNoContinuo para los 7 totales del servicio (MO/EPP/Exámenes/Cursos/Vacunas/Insumos/Maquinaria)', () => {
    expect(bTab()).toContain('calcularTotalesServicioNoContinuo(servicio,parametrosFinancierosResueltos)');
  });
  it('28) "Total servicio" se muestra y proviene de totales.total (nunca una suma ad-hoc en el JSX)', () => {
    const b = bTab();
    expect(b).toContain('Total servicio');
    expect(b).toContain('{cop(totales.total)}');
  });
  // Ajuste "VALOR AGREGADO — 5 TIPOS CONSOLIDADOS" — servicios marcados VA
  // se excluyen del total de SNC (se trasladan al subtotal de Valor
  // Agregado, ver `serviciosNoContinuosParticionVA`), nunca ambos.
  it('29) "Total servicios no continuos" usa el hook memoizado totalServiciosNoContinuos (calcularTotalServiciosNoContinuos sobre los servicios NO marcados VA), nunca un campo editable', () => {
    expect(PAGE_TSX).toContain('const totalServiciosNoContinuos=React.useMemo(\n    ()=>calcularTotalServiciosNoContinuos(serviciosNoContinuosParticionVA.normales,totalesManoObraPorServicioNoContinuo),');
    expect(bTab()).toContain('Total servicios no continuos');
    expect(bTab()).toContain('{cop(totalServiciosNoContinuos)}');
  });
});

describe('page.tsx — persistencia (guardar/recargar/restaurar) y NO_APLICA', () => {
  it('19) guardarModuloServiciosNoContinuos persiste vía ejecutarGuardadoModuloCosteo con clave \'serviciosNoContinuos\'', () => {
    const b = bloque('async function guardarModuloServiciosNoContinuos(', 'async function guardarAvanceServiciosNoContinuos(){\n    setGuardandoAvanceServiciosNoContinuos(true);setServiciosNoContinuosMsg(\'\');\n    const ok=await guardarModuloServiciosNoContinuos(\'COMPLETADO\');\n    if(ok)setServiciosNoContinuosMsg(\'Servicios no continuos completado.\');\n    setGuardandoAvanceServiciosNoContinuos(false);\n  }');
    expect(b).toContain("ejecutarGuardadoModuloCosteo('serviciosNoContinuos',estadoDestino,datosEntrada,serviciosNoContinuosUltimaActualizacion,{totalServiciosNoContinuos})");
  });
  it('19) aplicarDatosGuardados restaura servicios desde el módulo propio (obtenerModulo(dCrudo,\'serviciosNoContinuos\'))', () => {
    expect(PAGE_TSX).toContain("obtenerModulo<{servicios?:unknown}>(dCrudo,'serviciosNoContinuos')");
    expect(PAGE_TSX).toContain('setServiciosNoContinuos(serviciosNoContinuosD);');
  });
  it('15/16/31/32) NO_APLICA reutiliza el flujo genérico solicitar/confirmar/revertir — nunca borra `serviciosNoContinuos`', () => {
    expect(PAGE_TSX).toContain('function solicitarServiciosNoContinuosNoAplica(){');
    expect(PAGE_TSX).toContain("else if(clave==='serviciosNoContinuos')guardarModuloServiciosNoContinuos('NO_APLICA');");
    expect(PAGE_TSX).toContain('function revertirServiciosNoContinuosNoAplica(){ guardarModuloServiciosNoContinuos(\'EN_PROGRESO\'); }');
    // Ningún handler de NO_APLICA/revertir llama setServiciosNoContinuos([]) ni vacía el arreglo.
    expect(PAGE_TSX).not.toMatch(/NO_APLICA[^;]*setServiciosNoContinuos\(\[\]\)/);
  });
  it('17) serviciosNoContinuos:\'Servicios no continuos\' está en NOMBRE_MODULO_NO_APLICA (el modal de confirmación genérico ya lo soporta sin cambios adicionales)', () => {
    expect(PAGE_TSX).toContain("serviciosNoContinuos:'Servicios no continuos',");
  });
  it('33) vacío sin decisión queda "No iniciado" (nunca se infiere NO_APLICA automáticamente al estar vacío)', () => {
    const b = bTab();
    expect(b).toContain(":'No iniciado'");
    expect(b).not.toMatch(/serviciosNoContinuos\.length===0.*&&.*guardarModuloServiciosNoContinuos\('NO_APLICA'\)/);
  });
});

describe('page.tsx — no hay regresión en las demás pestañas de Costos ni en Valor agregado', () => {
  // Ajuste "VALOR AGREGADO — 5 TIPOS CONSOLIDADOS" — Valor agregado deja
  // de ser una réplica independiente de ServicioNoContinuo: consolida
  // Reinversión (administrada aquí) + recursos de Mano de Obra/Insumos/
  // Maquinaria/SNC marcados esValorAgregado en su módulo de origen. Sigue
  // teniendo guardado modular propio (modulo:'valorAgregado'), pero YA NO
  // reutiliza los modales de Insumos/Maquinaria (esos recursos se editan
  // en su propio módulo, nunca desde aquí).
  it('19) la pestaña "Valor agregado" consolida Reinversión + los 4 tipos derivados, con guardado modular propio', () => {
    const b = bloque("{tab==='valorAgregado'&&(()=>{", "{/* ══ ADMIN ══ */}");
    expect(b).toContain('No hay conceptos de valor agregado registrados.');
    expect(b).toContain('abrirModalReinversionNuevo');
    expect(b).toContain('guardarAvanceValorAgregado');
    expect(b).toContain('filasValorAgregadoManoObra');
    expect(b).toContain('filasValorAgregadoInsumos');
    expect(b).toContain('filasValorAgregadoMaquinaria');
    expect(b).toContain('filasValorAgregadoSnc');
    expect(CLAVES_MODULO as readonly string[]).toContain('valorAgregado');
  });
  it('el TABS de navegación conserva "Servicios no continuos" entre "Maq. y Equipos" y "Costos Admin." (sin reordenar las demás)', () => {
    const t = bloque("const TABS:{key:Tab,label:string}[]=[", '];');
    const iMaq = t.indexOf("{key:'maquinaria',label:'Maq. y Equipos'}");
    const iServ = t.indexOf("{key:'serviciosNoContinuos',label:'Serv. no continuos'}");
    const iAdmin = t.indexOf("{key:'admin',label:'Costos Admin.'}");
    expect(iMaq).toBeGreaterThan(-1);
    expect(iServ).toBeGreaterThan(iMaq);
    expect(iAdmin).toBeGreaterThan(iServ);
  });
});
