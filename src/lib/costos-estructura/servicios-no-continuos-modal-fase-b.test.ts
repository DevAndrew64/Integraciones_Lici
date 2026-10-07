/**
 * Ajuste "SERVICIOS NO CONTINUOS — FASE B: MODAL AGREGAR/EDITAR" —
 * verificación por texto fuente (mismo patrón `bloque()` que el resto de
 * *-page.test.ts, sin arnés de render de componentes para page.tsx) del
 * modal consolidado `ModalServicioNoContinuo`, su arquitectura de borrador
 * (draft real, aislado de `serviciosNoContinuos` hasta "Agregar/Actualizar
 * servicio"), la grilla horizontal de cargos (estilo Pólizas), las
 * secciones independientes de Insumos/Maquinaria, y la tarjeta exterior de
 * solo lectura.
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
const bTab = () => bloque("{tab==='serviciosNoContinuos'&&(()=>{", '{/* ══ VALOR AGREGADO ══');
const bModal = () => bloque('function ModalServicioNoContinuo(){', '  // ═══ Ajuste "VALOR AGREGADO — 5 TIPOS CONSOLIDADOS" — CRUD de\n  // Reinversión, el ÚNICO tipo administrado directamente en esta pestaña');

describe('1) "+ Agregar servicio no continuo" abre el modal', () => {
  it('el botón llama abrirModalServicioNoContinuoNuevo, que reserva un id y abre showModalServicioNoContinuo', () => {
    expect(bTab()).toContain('onClick={abrirModalServicioNoContinuoNuevo}');
    const f = bloque('function abrirModalServicioNoContinuoNuevo(){', 'function abrirModalServicioNoContinuoEditar(');
    expect(f).toContain('nextServicioNoContinuoId.current++');
    expect(f).toContain('setBorradorServicioNoContinuoEsNuevo(true);');
    expect(f).toContain('setShowModalServicioNoContinuo(true);');
  });
});

describe('2) Crear SNC genera un nuevo elemento del arreglo sin reemplazar anteriores', () => {
  it('guardarModalServicioNoContinuo agrega (append) cuando es nuevo, reemplaza por id cuando es edición — nunca sobrescribe el arreglo completo', () => {
    const f = bloque('function guardarModalServicioNoContinuo(){', 'function actualizarDescripcionBorradorServicioNoContinuo(');
    expect(f).toContain('setServiciosNoContinuos(p=>borradorServicioNoContinuoEsNuevo?[...p,borrador]:p.map(s=>s.id===borrador.id?borrador:s));');
  });
});

describe('3) Editar abre el mismo modal precargado', () => {
  it('abrirModalServicioNoContinuoEditar clona el servicio real (nunca lo referencia) y normaliza tarifa→tarifas', () => {
    const f = bloque('function abrirModalServicioNoContinuoEditar(servicioId:string){', 'function cerrarModalServicioNoContinuo(){');
    expect(f).toContain('const clon=clonarServicioNoContinuo(original);');
    // Ajuste "OTROS COSTOS DE SNC" — también normaliza otrosCostos
    // ausente/histórico a [] al construir el borrador (mismo criterio que tarifas).
    expect(f).toContain("setBorradorServicioNoContinuo({...clon,tarifas:tarifasServicio(clon).map(t=>({...t})),tarifa:undefined,otrosCostos:clon.otrosCostos??[],frecuenciaServicioCodigo:sugerirFrecuenciaServicioCodigo(clon)});");
    expect(f).toContain('setBorradorServicioNoContinuoEsNuevo(false);');
  });
  it('clonarServicioNoContinuo hace una copia estructural (JSON), nunca copia el objeto por referencia', () => {
    const f = bloque('function clonarServicioNoContinuo(servicio:ServicioNoContinuo):ServicioNoContinuo{', 'function abrirModalServicioNoContinuoNuevo(){');
    expect(f).toContain('return JSON.parse(JSON.stringify(servicio));');
  });
});

describe('4) Cancelar no modifica el SNC existente', () => {
  it('cerrarModalServicioNoContinuo solo descarta el borrador — nunca llama setServiciosNoContinuos', () => {
    const f = bloque('function cerrarModalServicioNoContinuo(){', 'function guardarModalServicioNoContinuo(){');
    expect(f).not.toMatch(/setServiciosNoContinuos\(/);
    expect(f).toContain('setShowModalServicioNoContinuo(false);');
    expect(f).toContain('setBorradorServicioNoContinuo(null);');
  });
  it('mientras el modal está abierto, TODA escritura por servicioId del borrador se redirige al borrador (nunca al arreglo real) — draft real, no mutación directa', () => {
    // Los puntos de despacho compartido (Insumos/Maquinaria/Cargo manual de
    // Mano de Obra/Exámenes, todos vía `actualizarArregloServicioNoContinuo`/
    // `actualizarExamenesMedicosServicioNoContinuo`) verifican
    // `borradorServicioNoContinuo.id` ANTES de tocar
    // `serviciosNoContinuos`/`valorAgregado`. Ajuste "TARIFARIO GENERAL
    // VIGICOLBA EN MANO DE OBRA — CARGO MANUAL DE SNC" — el despacho
    // dedicado de Cargo genérico (`arregloCargosDeDestino`/
    // `guardarBorradorCargo` con destino `{servicioId}`) se retiró: ese
    // modal nunca tuvo un render real montado en esta pestaña, y la Mano
    // de Obra manual del servicio ahora pasa por el MISMO dispatcher
    // genérico que Insumos/Maquinaria/Otros Costos.
    expect(PAGE_TSX.match(/if\(borradorServicioNoContinuo&&servicioId===borradorServicioNoContinuo\.id\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(PAGE_TSX).toContain('if(borradorServicioNoContinuo&&id===borradorServicioNoContinuo.id)return borradorServicioNoContinuo;');
  });
});

describe('5) Botón de edición actualiza el SNC correcto', () => {
  it('la tarjeta de solo lectura llama abrirModalServicioNoContinuoEditar(servicio.id) por cada servicio de su propio .map', () => {
    const b = bTab();
    expect(b).toContain('onClick={()=>abrirModalServicioNoContinuoEditar(servicio.id)}');
  });
});

describe('6/7) Aseocolba permite agregar 2+ tarifas[] — Operario + Coordinador al mismo SNC', () => {
  it('agregarTarifaBorradorServicioNoContinuo siempre agrega al final (spread), nunca reemplaza el arreglo', () => {
    const f = bloque('function agregarTarifaBorradorServicioNoContinuo(tarifaKey:string){', 'function actualizarTarifaBorradorServicioNoContinuo(');
    expect(f).toContain('setBorradorServicioNoContinuo(b=>b?{...b,tarifas:[...tarifasServicio(b),nueva]}:b);');
  });
  it('el catálogo de cargos disponibles (Operario/Operario Todero/Operario Servicio Especial/Coordinador Servicio Especial) no se restringe artificialmente en el <select> de "+ Agregar cargo"', () => {
    const b = bModal();
    expect(b).toContain('catalogoTarifasAseocolba.filter(t=>t.modalidad===modalidad)');
  });
});

describe('8) Eliminar un cargo no elimina los demás', () => {
  it('eliminarTarifaBorradorServicioNoContinuo filtra por índice — nunca vacía ni reemplaza el arreglo completo', () => {
    const f = bloque('function eliminarTarifaBorradorServicioNoContinuo(indice:number){', '  // ── Modal Agregar/Editar Servicio no continuo');
    expect(f).toContain('setBorradorServicioNoContinuo(b=>b?{...b,tarifas:tarifasServicio(b).filter((_,i)=>i!==indice)}:b);');
  });
});

describe('9) Cantidad por cargo permanece independiente', () => {
  it('actualizarTarifaBorradorServicioNoContinuo actualiza SOLO el índice indicado (map con condición ===indice)', () => {
    const f = bloque('function actualizarTarifaBorradorServicioNoContinuo(indice:number,cambios:Partial<TarifaServicioAseocolba>){', 'function eliminarTarifaBorradorServicioNoContinuo(');
    expect(f).toContain('setBorradorServicioNoContinuo(b=>b?{...b,tarifas:tarifasServicio(b).map((t,i)=>i!==indice?t:{...t,...cambios})}:b);');
  });
});

describe('10) Formato antiguo tarifa aparece correctamente al editar', () => {
  it('abrirModalServicioNoContinuoEditar usa tarifasServicio(clon) (normaliza tarifa singular → [tarifa]) — mismo mecanismo de Fase A', () => {
    const f = bloque('function abrirModalServicioNoContinuoEditar(servicioId:string){', 'function cerrarModalServicioNoContinuo(){');
    expect(f).toContain('tarifasServicio(clon)');
  });
});

describe('11) Guardar desde el modal utiliza tarifas[]', () => {
  it('el borrador nunca vuelve a escribir tarifa singular — abrirModalServicioNoContinuoEditar fija tarifa:undefined explícitamente', () => {
    const f = bloque('function abrirModalServicioNoContinuoEditar(servicioId:string){', 'function cerrarModalServicioNoContinuo(){');
    expect(f).toContain('tarifa:undefined');
  });
  it('agregarTarifaBorradorServicioNoContinuo/actualizarTarifaBorradorServicioNoContinuo/eliminarTarifaBorradorServicioNoContinuo operan EXCLUSIVAMENTE sobre `tarifas` (nunca sobre `tarifa`)', () => {
    const f = bloque('function agregarTarifaBorradorServicioNoContinuo(', '  // ── Modal Agregar/Editar Servicio no continuo');
    expect(f).not.toMatch(/\{\.\.\.b,tarifa:/);
  });
});

describe('12/13/14) Insumos y Maquinaria permanecen asociados al SNC correcto — dos SNC no comparten cargos/insumos/equipos', () => {
  it('la sección Insumos del modal lee b.insumos y elimina con eliminarInsumoServicio(b.id,...) — el mismo id del borrador activo, nunca otro; ya NO edita cantidad/valor aquí (solo informativo, edición real en el modal "Registrar insumos")', () => {
    const b = bModal();
    const bInsumos = bloque("letterSpacing:'.04em'}}>Insumos</div>", "letterSpacing:'.04em'}}>Maquinaria y Equipos - Especializados</div>", PAGE_TSX.indexOf(b));
    expect(bInsumos).not.toContain('actualizarInsumoServicio(b.id,item.id,{cantidad:');
    expect(bInsumos).toContain('eliminarInsumoServicio(b.id,item.id)');
  });
  // Ajuste "MAQUINARIA Y EQUIPOS SNC — MODELO SERVICIOS ESPECIALIZADOS"
  // (corrección explícita del usuario) — dentro del modal de SNC,
  // "Maquinaria y Equipos" pasó a operar EXCLUSIVAMENTE sobre
  // `b.equiposEspecializados[]` (catálogo `GET equipos/obtener_espec`,
  // nunca el modelo general de activos fijos que usaba
  // `actualizarMaquinariaServicio`/`eliminarMaquinariaServicio` en esta
  // misma sección — esas funciones siguen existiendo para la pestaña
  // global "Maq. y Equipos", sin cambios, solo ya no se invocan desde
  // aquí).
  it('la sección Maquinaria del modal opera sobre b.equiposEspecializados / actualizarEquipoEspecializadoServicio(b.id,...) — nunca el modelo general', () => {
    const b = bModal();
    const bMaq = bloque("letterSpacing:'.04em'}}>Maquinaria y Equipos - Especializados</div>", '{esTarifaAseocolba&&totales.tarifaValida===false&&(', PAGE_TSX.indexOf(b));
    expect(bMaq).toContain('actualizarEquipoEspecializadoServicio(b.id,item.id,{cantidad:');
    expect(bMaq).toContain('eliminarEquipoEspecializadoServicio(b.id,item.id)');
    expect(bMaq).not.toContain('actualizarMaquinariaServicio(b.id');
    expect(bMaq).not.toContain('cantidadDisponible');
  });
  it('cada servicio guarda su PROPIO arreglo insumos[]/maquinariaEquipos[] (tipo ServicioNoContinuo) — nunca un pool compartido entre servicios', () => {
    const tipos = readFileSync(join(__dirname, 'servicios-no-continuos.ts'), 'utf-8');
    expect(tipos).toContain('insumos: InsumoServicioNoContinuo[];');
    expect(tipos).toContain('maquinariaEquipos: MaquinariaServicioNoContinuo[];');
  });
});

describe('15/16) La tarjeta exterior queda en modo lectura; Editar vuelve a abrir el modal', () => {
  it('la tarjeta ya NO tiene <input>/<select> de configuración — solo botones de gestión/eliminación y el chevron de expandir', () => {
    // Ajuste posterior — el botón "Editar" se renombró a "Gestionar Serv.
    // no continuos" (mismo patrón que "Gestionar insumos"/"Gestionar
    // maquinaria y equipos" ya usado en el resto de la app); "Eliminar"
    // sigue existiendo, junto a él, en el pie del detalle expandido.
    const b = bTab();
    expect(b).not.toMatch(/<select\b/);
    expect(b).not.toMatch(/<input\b/);
    expect(b).toContain('>Gestionar Serv. no continuos</button>');
    expect(b).toContain('>Eliminar</button>');
  });
  it('la cantidad de cargos por servicio se sigue calculando (cantidadCargos), reutilizada por el resumen tipo tabla', () => {
    // Ajuste "QUITAR ESTO" — el resumen en grid (Tipo de cálculo/UEN/
    // Cargos/Insumos/Maquinaria) se retiró del colapsado; `cantidadCargos`
    // se conserva como cálculo interno (usado por la tabla de detalle
    // expandido "Cargos" y por la fila de advertencia de tarifa inválida).
    const b = bTab();
    expect(b).toContain('cantidadCargos');
  });
});

describe('17) Eliminar SNC sigue funcionando (patrón de confirmación sin cambios)', () => {
  it('eliminarServicioNoContinuo/confirmarEliminarServicioNoContinuo intactos, invocados desde la tarjeta de solo lectura', () => {
    expect(PAGE_TSX).toContain('function eliminarServicioNoContinuo(servicioId:string,descripcion:string){');
    expect(PAGE_TSX).toContain('function confirmarEliminarServicioNoContinuo(){');
    expect(bTab()).toContain('onClick={()=>eliminarServicioNoContinuo(servicio.id,servicio.descripcion)}');
  });
});

describe('18/19) Total mostrado coincide con calcularTotalesServicioNoContinuo; no hay doble AIU', () => {
  it('el resumen del modal y la tarjeta usan calcularTotalesServicioNoContinuo como única fuente de verdad', () => {
    expect(bModal()).toContain('const totales=calcularTotalesServicioNoContinuo(b,totalManoObraBorrador);');
    expect(bTab()).toContain('const totales=calcularTotalesServicioNoContinuo(servicio,totalesManoObraPorServicioNoContinuo.get(servicio.id)??0);');
  });
  it('el modal NUNCA aplica un porcentaje de AIU global adicional sobre el total — solo suma cargos+insumos+maquinaria ya calculados por sección', () => {
    // Ajuste "ESTO NO VA ACA" — se retiró el bloque único "Resumen del
    // servicio"; ahora cada sección (Mano de obra/Insumos/Maquinaria)
    // muestra su propio total al pie. Se verifica sobre TODO el modal que
    // no exista ningún multiplicador de AIU global adicional.
    const b = bModal();
    expect(b).not.toMatch(/\*\s*1\.\d|porcentajeIU|AIU_GLOBAL/i);
    expect(b).toContain('TOTAL MANO DE OBRA DEL SERVICIO');
    // Ajuste "TOTAL MANO DE OBRA DEL SERVICIO MOSTRABA UN NEGATIVO" — el
    // subtotal de MO de la rama Tarifa Aseocolba ahora usa el campo
    // `tarifaTotalCargos` (suma bruta de los cargos de la tarifa), nunca la
    // derivación rota `total - insumos - maquinariaEquipos` (mezclaba una
    // cifra ya dividida por frecuencia con cifras sin dividir → negativos).
    expect(b).toContain('{cop(totales.tarifaTotalCargos??0)}');
    expect(b).not.toContain('{cop(totales.total-totales.insumos-totales.maquinariaEquipos)}');
    expect(b).toContain('TOTAL INSUMOS DEL SERVICIO');
    expect(b).toContain('{cop(totales.insumos)}');
    expect(b).toContain('TOTAL MAQUINARIA Y EQUIPOS');
    expect(b).toContain('{cop(totales.maquinariaEquipos)}');
  });
});

describe('20) Ajuste "TARIFARIO GENERAL VIGICOLBA EN MANO DE OBRA — CARGO MANUAL DE SNC" — la Mano de Obra manual del servicio usa su propio modelo ligero, nunca ModalCargo', () => {
  it('el modal usa agregarCargoManualServicio/actualizarCargoManualServicio/eliminarCargoManualServicio sobre b.cargosManuales — nunca abrirModalCargoNuevo/abrirModalCargoEditar con servicioId (ese modal nunca tuvo un render real montado en esta pestaña)', () => {
    const b = bModal();
    expect(b).toContain('onClick={()=>agregarCargoManualServicio(b.id)}');
    expect(b).toContain('actualizarCargoManualServicio(b.id,cargo.id,');
    expect(b).toContain('onClick={()=>eliminarCargoManualServicio(b.id,cargo.id)}');
    // Nunca un onClick real que abra ModalCargo desde aquí — los comentarios
    // sí mencionan el nombre de la función retirada como contexto histórico,
    // por eso se verifica la ausencia del CALL SITE real, no del identificador.
    expect(b).not.toContain('onClick={()=>abrirModalCargoNuevo(');
    expect(b).not.toContain('abrirModalCargoEditar(idUnico');
  });
});

describe('21) Guardado modular sigue funcionando', () => {
  it('guardarModuloServiciosNoContinuos/construirDatosEntradaServiciosNoContinuos intactos, el modal nunca persiste directo', () => {
    expect(PAGE_TSX).toContain("function construirDatosEntradaServiciosNoContinuos(){\n    return { servicios: serviciosNoContinuos };\n  }");
    expect(PAGE_TSX).toContain('function guardarModuloServiciosNoContinuos(estadoDestino:EstadoModuloResultado):Promise<boolean>{');
    const bModalCompleto = bModal();
    expect(bModalCompleto).not.toMatch(/fetch\(|ejecutarGuardadoModuloCosteo/);
  });
});

describe('22) Código existente del SNC se conserva y se muestra sin edición manual', () => {
  it('el campo "Código SNC" es readOnly+disabled — nunca editable', () => {
    const b = bModal();
    expect(b).toContain("<label style={lbl}>Código SNC</label>");
    expect(b).toContain("value={b.codigo||'—'} readOnly disabled");
  });
});

// ═══ Rediseño visual (grilla estilo Pólizas) ═══
describe('Rediseño visual — grilla de cargos "un cargo = una fila" (estilo Pólizas)', () => {
  const b = bModal();
  it('1) existe la sección "Mano de obra del servicio"', () => {
    expect(b).toContain("letterSpacing:'.04em'}}>Mano de obra del servicio</div>");
  });
  it('2) existe "+ Agregar cargo…"', () => {
    expect(b).toContain('+ Agregar cargo…');
  });
  it('3) los cargos se renderizan iterando tarifas.map — cada índice es una fila independiente de un grid (nunca una tarjeta acumulativa)', () => {
    expect(b).toContain('{tarifas.map((t,indice)=>{');
    // Ajuste "AUN SE VE PEGADO... QUE TODO QUEDE LINEAL" + "MUEVE MAS ESAS
    // COLUMNAS A LA IZQUIERDA" — grilla compacta (8 columnas, sin depender
    // de overflow-x:auto en escritorio); el ancho de columnas se ajustó
    // varias veces por feedback visual, pero el patrón "un grid por fila,
    // cada índice independiente" sigue igual.
    expect(b).toContain("gridTemplateColumns:'minmax(150px,260px) 80px 60px 50px 80px 100px 110px 22px'");
  });
  it('4) cantidad de personas se edita por índice (actualizarTarifaBorradorServicioNoContinuo(indice,{cantidadPersonas:...}))', () => {
    expect(b).toContain('actualizarTarifaBorradorServicioNoContinuo(indice,{cantidadPersonas:Number(e.target.value)||0})');
  });
  it('5) cantidad de días se edita por índice, condicionada a la modalidad', () => {
    expect(b).toContain('actualizarTarifaBorradorServicioNoContinuo(indice,{cantidadDias:Number(e.target.value)||0})');
  });
  it('6) AIU (checkbox + %) se edita por índice — independiente por cargo', () => {
    expect(b).toContain('actualizarTarifaBorradorServicioNoContinuo(indice,{aplicaAiu:e.target.checked})');
    expect(b).toContain('actualizarTarifaBorradorServicioNoContinuo(indice,{porcentajeAiuOverride:');
  });
  it('7) valor unitario y valor cargo son visibles y de solo lectura (derivados de calcularTarifaServicioAseocolba)', () => {
    expect(b).toContain('{cop(r.valorUnitarioAplicado)}');
    expect(b).toContain('{cop(r.total)}');
  });
  it('8) eliminar una fila (BtnDel) usa el índice de ESA fila — nunca afecta otras', () => {
    expect(b).toContain('<BtnDel onClick={()=>eliminarTarifaBorradorServicioNoContinuo(indice)}/>');
  });
  it('9) Insumos se muestra en grilla compacta propia (grid, no tarjeta), con "+ Agregar insumo"', () => {
    expect(b).toContain('+ Agregar insumo');
    const bIns = bloque("letterSpacing:'.04em'}}>Insumos</div>", "letterSpacing:'.04em'}}>Maquinaria y Equipos - Especializados</div>", PAGE_TSX.indexOf(b));
    expect(bIns).toContain("gridTemplateColumns:'minmax(140px,1fr) 60px 60px 70px 100px 110px 24px'");
  });
  it('ajuste "que aca solo sea informativo... editar en el modal de insumos" — Cantidad y Valor und. son de solo lectura (nunca <input>), incluye columna Frec., y el valor mostrado es CON IVA', () => {
    const bIns = bloque("letterSpacing:'.04em'}}>Insumos</div>", "letterSpacing:'.04em'}}>Maquinaria y Equipos - Especializados</div>", PAGE_TSX.indexOf(b));
    expect(bIns).not.toMatch(/<input[^>]*value=\{item\.cantidad/);
    expect(bIns).not.toMatch(/<input[^>]*value=\{item\.valorUnitarioSinIva/);
    expect(bIns).toContain('>Frec.</div>');
    expect(bIns).toContain('>Valor und.</div>');
    expect(bIns).toContain('{cop(item.valorUnitarioConIva||0)}');
    expect(bIns).toContain('{item.frecuenciaMeses||1}');
    // La edición real sigue viviendo en el modal "Registrar insumos"
    // (actualizarInsumoServicio invocado SOLO desde allá para este SNC).
    expect(bIns).not.toContain('actualizarInsumoServicio(b.id,item.id,{cantidad:');
    expect(bIns).not.toContain('actualizarInsumoServicio(b.id,item.id,{valorUnitarioSinIva:');
  });
  it('10) Maquinaria/equipos se muestra en grilla compacta propia, con "+ Agregar equipo"', () => {
    expect(b).toContain('+ Agregar equipo');
  });
  it('11) el resumen económico se muestra por sección (Mano de obra/Insumos/Maquinaria), cada uno con su propio total, y usa totales ya existentes, sin fórmulas nuevas', () => {
    // Ajuste "ESTO NO VA ACA" — se retiró el bloque único "Resumen del
    // servicio" (redundante con los totales por sección).
    expect(b).not.toContain('Resumen del servicio');
    expect(b).toContain('TOTAL MANO DE OBRA DEL SERVICIO');
    expect(b).toContain('TOTAL INSUMOS DEL SERVICIO');
    expect(b).toContain('TOTAL MAQUINARIA Y EQUIPOS');
  });
  it('12) Crear y Editar usan el mismo componente ModalServicioNoContinuo (un solo modal, título condicional)', () => {
    expect(b).toContain("{borradorServicioNoContinuoEsNuevo?'Agregar servicio no continuo':'Editar servicio no continuo'}");
    expect(b).toContain("{borradorServicioNoContinuoEsNuevo?'Agregar servicio':'Actualizar servicio'}");
  });
  it('13) la tarjeta exterior sigue en modo lectura tras el rediseño visual (sin selects/inputs)', () => {
    const bt = bTab();
    expect(bt).not.toMatch(/<select\b/);
    expect(bt).not.toMatch(/<input\b/);
  });
});

// ═══ Ajuste "QUITAR CON INSUMOS DE CADA CARGO" ═══
describe('Ajuste "QUITAR CON INSUMOS DE CADA CARGO" — los insumos pertenecen al SERVICIO, no al cargo', () => {
  it('ningún cargo (fila de la grilla) muestra checkbox "Con insumos" ni permite tocar t.conInsumos', () => {
    const bCargos = bloque(
      "letterSpacing:'.04em'}}>Mano de obra del servicio</div>",
      "letterSpacing:'.04em'}}>Insumos</div>",
    );
    expect(bCargos).not.toContain('Con insumos');
    expect(bCargos).not.toMatch(/checked=\{t\.conInsumos\}/);
  });
  it('t.conInsumos se sigue fijando automáticamente desde el catálogo (construirTarifaServicioDesdeCatalogo), nunca por un toggle manual del usuario', () => {
    const tarifario = readFileSync(join(__dirname, 'tarifario-especiales-aseocolba.ts'), 'utf-8');
    const inicio = tarifario.indexOf('export function construirTarifaServicioDesdeCatalogo(');
    const fin = tarifario.indexOf('export interface ResultadoCalculoTarifaAseocolba');
    const f = tarifario.slice(inicio, fin);
    expect(f).toContain('conInsumos: entrada.conInsumos,');
  });
  it('agregar insumos modifica ÚNICAMENTE servicio.insumos[] — nunca tarifas[] ni ningún cargo', () => {
    const f = bloque('function actualizarInsumoServicio(servicioId:string,id:number,cambios:Partial<InsumoServicioNoContinuo>){', 'function eliminarInsumoServicio(');
    expect(f).toContain("actualizarArregloServicioNoContinuo(servicioId,'insumos',");
    expect(f).not.toMatch(/tarifas/);
  });
  it('eliminar un insumo no modifica tarifas[] (funciones completamente independientes)', () => {
    const f = bloque('function eliminarInsumoServicio(servicioId:string,id:number){', 'function actualizarMaquinariaServicio(');
    expect(f).toContain("actualizarArregloServicioNoContinuo(servicioId,'insumos',arr=>arr.filter(i=>i.id!==id));");
    expect(f).not.toMatch(/tarifas/);
  });
  it('los insumos se suman UNA sola vez al total del servicio, sin importar cuántos cargos tenga (fórmula de Fase A; Ajuste "OTROS COSTOS DE SNC" agregó +otrosCostos y la división por frecuenciaServicioMeses, ver servicios-no-continuos-otros-costos.test.ts)', () => {
    const src = readFileSync(join(__dirname, 'servicios-no-continuos.ts'), 'utf-8');
    expect(src).toContain('const insumos = calcularTotalInsumosServicio(servicio.insumos);');
    expect(src).toContain('const subtotalAntesFrecuenciaAseo = totalCargos + insumos + maquinariaEquipos + otrosCostos;');
  });
  it('maquinaria/equipos continúan completamente independientes de los cargos (sin mezclar)', () => {
    const f = bloque('function actualizarMaquinariaServicio(servicioId:string,id:number,cambios:Partial<MaquinariaServicioNoContinuo>){', 'function eliminarMaquinariaServicio(');
    expect(f).not.toMatch(/tarifas/);
  });
  it('AIU de cada cargo sigue igual (Fase A intacta: cada tarifa calcula su propio AIU vía calcularTarifaServicioAseocolba)', () => {
    const src = readFileSync(join(__dirname, 'tarifario-especiales-aseocolba.ts'), 'utf-8');
    expect(src).toContain('export function calcularTarifaServicioAseocolba(');
  });
});

// ═══ Filtrado UEN → Servicio No Continuo (adelanto puntual de Fase C, a
// pedido explícito y reiterado del usuario, confirmado por AskUserQuestion
// antes del primer cambio y reiterado 2 veces más con capturas de pantalla) ═══
describe('Filtrado UEN → Servicio No Continuo (adelanto puntual de Fase C)', () => {
  const b = bModal();
  it('UEN es un <select> (ya no de solo lectura) alimentado por las UEN reales del catálogo cargado', () => {
    expect(b).toContain('const uenesDisponibles=Array.from(new Set(catalogoServiciosNoContinuos.map(c=>c.undneg).filter(Boolean))).sort();');
    expect(b).toContain('onChange={e=>actualizarUenBorradorServicioNoContinuo(e.target.value)}');
  });
  it('el combobox de Servicio no continuo usa la lista YA FILTRADA por la UEN elegida — nunca el catálogo completo', () => {
    // Ajuste "QUE NO LLEGUE TAN ABAJO" — el control dejó de ser un <select>
    // nativo (combobox propio con panel en portal), pero sigue iterando
    // EXCLUSIVAMENTE `serviciosFiltradosPorUen`, nunca el catálogo completo.
    expect(b).toContain('const serviciosFiltradosPorUen=b.undneg?catalogoServiciosNoContinuos.filter(c=>c.undneg===b.undneg):[];');
    expect(b).toContain('{serviciosFiltradosPorUen.map((c,i)=>(');
    expect(b).not.toContain('{catalogoServiciosNoContinuos.map(c=>(');
  });
  it('el Servicio no continuo permanece deshabilitado hasta elegir una UEN', () => {
    expect(b).toContain('disabled={cargandoServiciosNoContinuosCatalogo||!b.undneg}');
  });
  it('el Código SNC sigue siendo automático/solo lectura — nunca escrito a mano, incluso con el filtrado nuevo', () => {
    expect(b).toContain("value={b.codigo||'—'} readOnly disabled");
  });
  it('cambiar de UEN limpia la selección de servicio previa (podría no pertenecer a la UEN nueva) — nunca deja un codigo/descripcion inconsistente con la UEN', () => {
    const f = bloque('function actualizarUenBorradorServicioNoContinuo(uen:string){', '  /** Ajuste "FASE A: MÚLTIPLES CARGOS/TARIFAS" — agrega UN cargo/tarifa más');
    expect(f).toContain('codigo:undefined,descripcion:\'\',origen:undefined,empresaCatalogo:undefined,');
  });
});
