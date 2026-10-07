/**
 * Ajuste "SERVICIOS NO CONTINUOS — FASE 2 MVP: TARIFARIO ASEOCOLBA" —
 * verificación del wiring en page.tsx, mismo patrón `bloque()` sobre texto
 * fuente ya usado en el resto de *-page.test.ts (no hay arnés de render de
 * componentes para page.tsx).
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

describe('page.tsx — un servicio ASEOCOLBA nuevo nace con tipoCalculo=TARIFA_ASEOCOLBA', () => {
  it('agregarServicioNoContinuo pasa tipoCalculo condicionado a esAseocolbaProceso, nunca fijo', () => {
    const b = bloque('function agregarServicioNoContinuo(){', 'function actualizarDescripcionServicioNoContinuo(');
    expect(b).toContain("crearServicioNoContinuoVacio(id,'',esAseocolbaProceso?'TARIFA_ASEOCOLBA':undefined)");
  });
});

describe('page.tsx — resolución de tarifa centralizada al seleccionar el servicio del catálogo', () => {
  it('seleccionarServicioNoContinuoCatalogo usa resolverTarifaServicioNoContinuo (único punto de resolución)', () => {
    const b = bloque(
      'function seleccionarServicioNoContinuoCatalogo(servicioId:string,item:',
      'function seleccionarTarifaManualServicio(',
    );
    expect(b).toContain('const tarifaKeyAuto=resolverTarifaServicioNoContinuo(item.codigo,item.undneg);');
    expect(b).toContain("entradaAuto?{tarifa:construirTarifaServicioDesdeCatalogo(entradaAuto,'MAPEO_AUTOMATICO')}:{}");
  });
  it('resolverTarifaServicioNoContinuo tiene DOS invocaciones reales en todo page.tsx — capa centralizada, nunca condicionales dispersos', () => {
    // Ajuste "FASE B: MODAL AGREGAR/EDITAR" — antes de esta fase había un
    // único punto de resolución automática (`seleccionarServicioNoContinuoCatalogo`,
    // que escribe directo sobre `serviciosNoContinuos`). Fase B agrega un
    // SEGUNDO punto, `seleccionarBorradorServicioNoContinuoCatalogo`, que
    // hace exactamente lo mismo pero sobre el borrador del modal (nunca
    // sobre el servicio ya guardado, ver `borradorServicioNoContinuo`) — el
    // primero se conserva solo por retrocompatibilidad de lectura de este
    // archivo de tests (ninguna UI lo invoca ya). Ambos siguen siendo la
    // ÚNICA capa de resolución — nunca condicionales repartidos por el JSX.
    const invocaciones = (PAGE_TSX.match(/resolverTarifaServicioNoContinuo\(item/g) ?? []).length;
    expect(invocaciones).toBe(2);
  });
});

describe('page.tsx — selección manual y edición de la tarifa (fallback provisional)', () => {
  it('seleccionarTarifaManualServicio usa el MISMO constructor que la resolución automática, solo cambia fuenteTarifa', () => {
    const b = bloque('function seleccionarTarifaManualServicio(', 'function quitarTarifaServicio(');
    expect(b).toContain("construirTarifaServicioDesdeCatalogo(entrada,'SELECCION_MANUAL')");
  });
  it('actualizarTarifaServicio es la ÚNICA vía de escritura de cantidades/conInsumos/override', () => {
    const b = bloque('function actualizarTarifaServicio(', 'function eliminarServicioNoContinuo(');
    expect(b).toContain('setServiciosNoContinuos(p=>p.map(s=>s.id!==servicioId||!s.tarifa?s:{...s,tarifa:{...s.tarifa,...cambios}}));');
  });
});

// Ajuste "FASE B: MODAL AGREGAR/EDITAR" — todo el bloque de tarifa
// ASEOCOLBA (antes inline dentro de la tarjeta, `bTab()`) se movió al modal
// `ModalServicioNoContinuo`, y evolucionó de UNA tarifa (`servicio.tarifa`)
// a VARIOS cargos/tarifas independientes (`tarifas[]`, Fase A). Las
// siguientes descripciones reemplazan a las de "para TARIFA_ASEOCOLBA, los
// 5 bloques históricos NUNCA se muestran" / "UI mínima del bloque de
// tarifa", que verificaban literales del bloque single-tarifa inline
// (`servicio.tarifa.X`) que ya no existen en el código — no una regresión,
// sino el rediseño explícitamente pedido por el usuario.
const bModal = () => bloque('function ModalServicioNoContinuo(){', '  // ═══ Ajuste "VALOR AGREGADO — 5 TIPOS CONSOLIDADOS" — CRUD de\n  // Reinversión, el ÚNICO tipo administrado directamente en esta pestaña');

describe('page.tsx — para TARIFA_ASEOCOLBA, los 5 bloques históricos NUNCA se muestran (ahora dentro del modal)', () => {
  // Ajuste "TARIFA REGULADA VIGICOLBA — PESTAÑA PROPIA" (ver comentario del
  // propio bloque en page.tsx) — este modal representa EXCLUSIVAMENTE el
  // costo interno del servicio. El rediseño retiró deliberadamente los
  // bloques genéricos <Bloque titulo="..."> de EPP/Dotación y Exámenes
  // Médicos de este modal (decisión ya confirmada: esos datos, si existen
  // de un guardado previo, se conservan sin UI de edición aquí) — la
  // condición inversa ahora envuelve ÚNICAMENTE la sección manual "Mano de
  // obra del servicio" (cantidad×días×valorUnitario, el único mecanismo de
  // alta real desde este modal), sin fragment <> ni el helper <Bloque>.
  it('cuando NO es tarifa Aseocolba se muestra la sección manual "Mano de obra del servicio"; los bloques genéricos EPP/Exámenes ya no existen en este modal', () => {
    const b = bModal();
    expect(b).toContain('const esTarifaAseocolba=esAseocolbaProceso&&b.tipoCalculo===\'TARIFA_ASEOCOLBA\';');
    const idxApertura = b.indexOf('{!esTarifaAseocolba&&(');
    expect(idxApertura).toBeGreaterThan(-1);
    const bloqueManual = b.slice(idxApertura, idxApertura + 800);
    expect(bloqueManual).toContain('Mano de obra del servicio');
    expect(bloqueManual).toContain('+ Agregar cargo');
    expect(b).not.toContain('<Bloque titulo="EPP y Dotación"');
    expect(b).not.toContain('<Bloque titulo="Exámenes Médicos"');
  });
  it('el bloque de cargos/tarifas ASEOCOLBA se renderiza con la condición esTarifaAseocolba', () => {
    expect(bModal()).toContain('{esTarifaAseocolba&&(');
  });
  it('Insumos y Maquinaria se muestran SIEMPRE (fuera de la condición inversa), en ambos caminos', () => {
    // Ajuste "FASE B — REDISEÑO VISUAL": Insumos/Maquinaria dejaron de usar
    // el helper <Bloque>, ahora son secciones propias con grilla compacta
    // (estilo Pólizas) — el marcador cambia, pero siguen fuera de la
    // condición inversa (`{!esTarifaAseocolba&&(<>...</>)}`).
    const b = bModal();
    const idxInsumos = b.indexOf("letterSpacing:'.04em'}}>Insumos</div>");
    const idxCierreGenerico = b.indexOf('</>)}');
    expect(idxInsumos).toBeGreaterThan(idxCierreGenerico);
  });
});

describe('page.tsx — UI de cargos/tarifas ASEOCOLBA dentro del modal (Fase A: 0/1/N cargos)', () => {
  const b = bModal();
  it('itera tarifasServicio(b) — nunca un único servicio.tarifa', () => {
    expect(b).toContain('const tarifas=tarifasServicio(b);');
    expect(b).toContain('{tarifas.map((t,indice)=>{');
  });
  it('cada cargo usa calcularTarifaServicioAseocolba de forma independiente (Fase A, sin motor nuevo)', () => {
    expect(b).toContain('const r=calcularTarifaServicioAseocolba(t,tarifaVigente);');
  });
  it('"+ Agregar cargo" agrega al arreglo sin reemplazar los existentes (agregarTarifaBorradorServicioNoContinuo)', () => {
    expect(b).toContain('onChange={e=>{if(e.target.value)agregarTarifaBorradorServicioNoContinuo(e.target.value);}}');
    expect(b).toContain('+ Agregar cargo…');
  });
  it('cada cargo se puede eliminar independientemente (eliminarTarifaBorradorServicioNoContinuo)', () => {
    expect(b).toContain('onClick={()=>eliminarTarifaBorradorServicioNoContinuo(indice)}');
  });
  it('selector provisional agrupado por modalidad (optgroup), igual que antes', () => {
    expect(b).toContain("(['MENSUAL','DIA','HORA','JORNADA_6H','JORNADA_4H'] as const)");
    expect(b).toContain('<optgroup key={modalidad} label={etiquetaModalidadTarifaAseocolba(modalidad)}>');
  });
  it('muestra Cargo y Modalidad (etiquetas) y Personas/Días/Horas por cada tarifa — grilla estilo Pólizas, un cargo = una fila', () => {
    // Ajuste "FASE B — REDISEÑO VISUAL (grilla estilo Pólizas)": cada
    // cargo pasó de tarjeta vertical a fila de grid; encabezado con
    // columnas fijas (Cargo/Tarifa, Modalidad, Personas, Días, AIU, Valor
    // unitario, Valor cargo).
    // Ajuste "AUN SE VE PEGADO... QUE TODO QUEDE LINEAL" + ajustes
    // posteriores de encabezados ("Cargo", "Cant. Trab.", "Modalidad"
    // completa una vez hubo espacio) para que las columnas quepan sin
    // overflow-x en el ancho del modal.
    expect(b).toContain(">Cargo</div>");
    expect(b).toContain('{etiquetaCargoTarifaAseocolba(t.cargo)}</div>');
    expect(b).toContain('{etiquetaModalidadTarifaAseocolba(t.modalidad)}');
    expect(b).toContain(">Cant. Trab.</div>");
    expect(b).toContain(">Días</div>");
    expect(b).toContain("(t.modalidad==='DIA'||t.modalidad==='JORNADA_6H'||t.modalidad==='JORNADA_4H')?(");
    expect(b).toContain("):t.modalidad==='HORA'?(");
    // Ajuste "QUITAR ESTO" (definitivo) — el subtítulo secundario bajo el
    // nombre del cargo (jornada/tipoDía/Base) se retiró por completo; el
    // nombre del cargo queda solo, la Modalidad ya es su propia columna y
    // el Valor base ya no se muestra en la grilla.
    expect(b).not.toContain('subtitulo');
    expect(b).toContain('>Total</div>');
  });
  it('NUNCA muestra el checkbox "Con insumos" por cargo — los insumos pertenecen al SERVICIO completo (servicio.insumos[]), no a un cargo individual', () => {
    // Ajuste "QUITAR CON INSUMOS DE CADA CARGO" — `t.conInsumos` se sigue
    // fijando automáticamente al elegir la tarifa del catálogo
    // (`construirTarifaServicioDesdeCatalogo`, Fase A, sin cambios), pero
    // ya NO es un control que el usuario pueda tocar por cargo.
    const bCargos = bloque(
      "letterSpacing:'.04em'}}>Mano de obra del servicio</div>",
      "letterSpacing:'.04em'}}>Insumos</div>",
    );
    expect(bCargos).not.toContain('Con insumos');
    expect(bCargos).not.toMatch(/checked=\{t\.conInsumos\}/);
    expect(bCargos).not.toContain('onChange={e=>actualizarTarifaBorradorServicioNoContinuo(indice,{conInsumos:');
  });
  it('override "Valor unitario con insumos" solo cuando conInsumos=true Y el catálogo no trae variante explícita, por cargo (nunca un toggle manual, solo lectura de un dato ya persistido)', () => {
    expect(b).toContain('const requiereOverrideInsumos=t.conInsumos&&tarifaVigente!=null&&!tarifaVigente.conInsumos;');
    expect(b).toContain('Valor provisional hasta parametrización completa');
  });
  it('muestra advertencia visible cuando UN cargo no es válido (nunca $0 en silencio) — el aviso usa totales.tarifaValida, la MISMA fuente que el resto del módulo (calcularTotalesServicioNoContinuo)', () => {
    // Ajuste "ESTO NO VA ACA" — se retiró el bloque "Resumen del servicio"
    // (Cargos/Insumos/Maquinaria/Total SNC) porque quedó redundante: cada
    // sección (Mano de obra/Insumos/Maquinaria) ya muestra su propio total
    // al pie de su grilla. El aviso de tarifa inválida se conserva igual.
    expect(b).toContain('{!r.valido&&(');
    expect(b).not.toContain('Resumen del servicio');
    expect(b).toContain('{esTarifaAseocolba&&totales.tarifaValida===false&&(');
  });
});

describe('page.tsx — bloqueo de guardado SOLO para servicios ASEOCOLBA con tarifa inválida', () => {
  it('serviciosAseocolbaTarifaInvalida se calcula sobre TODOS los servicios, filtrando por tipoCalculo+tarifaValida', () => {
    const b = bTab();
    expect(b).toContain('const serviciosAseocolbaTarifaInvalida=serviciosNoContinuos.filter(s=>');
    expect(b).toContain("s.tipoCalculo==='TARIFA_ASEOCOLBA'&&!calcularTotalesServicioNoContinuo(s,0).tarifaValida");
  });
  it('el botón "Guardar Servicios no continuos" se deshabilita cuando la lista no está vacía', () => {
    const b = bTab();
    expect(b).toContain('disabled={guardandoModuloServiciosNoContinuos||serviciosAseocolbaTarifaInvalida.length>0}');
  });
  it('nunca bloquea toda la pestaña — el resto de la UI (agregar servicio, editar/eliminar otros) sigue disponible; solo se deshabilita el botón de guardar', () => {
    const b = bTab();
    expect(b).not.toMatch(/serviciosAseocolbaTarifaInvalida\.length>0.*disabled=\{true\}/);
    // Ajuste "FASE B" — el botón de agregar ahora abre el modal (antes
    // creaba el servicio directamente); sigue habilitado siempre.
    expect(b).toContain('onClick={abrirModalServicioNoContinuoNuevo}');
  });
});

describe('page.tsx — aislamiento: nada de Fase 2 aparece dentro de la UI (JSX) de las demás pestañas de Costos', () => {
  // Renders de las OTRAS pestañas del mismo módulo — nunca deben referenciar
  // identificadores de tarifario ASEOCOLBA (los hooks/estado de Fase 2 SÍ
  // viven legítimamente en el cuerpo del componente, igual que
  // `catalogoServiciosNoContinuos`/`esAseocolba` de Fase 1 — lo que se
  // audita aquí es que NINGÚN render de otra pestaña los consuma).
  // Orden real dentro de ModuloEstructuraCostos: resumen, manoObra,
  // turnantes, epp, examenes, maquinaria, insumos, serviciosNoContinuos...
  // ("insumos"/"epp" también existen en un componente NO relacionado,
  // ModuloEquipos ~línea 3569 — por eso cada búsqueda arranca desde el
  // punto donde terminó la anterior, nunca desde 0).
  const idxManoObra = PAGE_TSX.indexOf("{tab==='manoObra'&&(");
  const bManoObra = bloque("{tab==='manoObra'&&(", "{tab==='turnantes'&&(");
  const idxTurnantes = PAGE_TSX.indexOf("{tab==='turnantes'&&(", idxManoObra);
  const idxMaquinaria = PAGE_TSX.indexOf("{tab==='maquinaria'&&(", idxTurnantes);
  const idxInsumos = PAGE_TSX.indexOf("{tab==='insumos'&&(", idxMaquinaria);
  const bMaquinaria = PAGE_TSX.slice(idxMaquinaria, idxInsumos);
  const bInsumos = PAGE_TSX.slice(idxInsumos, PAGE_TSX.indexOf("{tab==='serviciosNoContinuos'&&(()=>{"));

  it('ningún identificador de tarifario ASEOCOLBA aparece en el render de Mano de Obra, Insumos o Maquinaria principales', () => {
    for (const b of [bManoObra, bInsumos, bMaquinaria]) {
      for (const identificador of [
        'resolverTarifaServicioNoContinuo', 'construirTarifaServicioDesdeCatalogo', 'calcularTarifaServicioAseocolba',
        'seleccionarTarifaManualServicio', 'actualizarTarifaServicio', 'quitarTarifaServicio',
        'catalogoTarifasAseocolba', 'serviciosAseocolbaTarifaInvalida', 'TARIFA_ASEOCOLBA',
      ]) {
        expect(b.includes(identificador)).toBe(false);
      }
    }
  });

  it('las funciones construirDatosEntrada de Mano de Obra/Insumos/Maquinaria/EPP/Exámenes principales NO fueron tocadas por esta fase (siguen presentes tal cual)', () => {
    expect(PAGE_TSX).toContain('function construirDatosEntradaManoObra(');
    expect(PAGE_TSX).toContain('function construirDatosEntradaInsumos(');
    expect(PAGE_TSX).toContain('function construirDatosEntradaMaquinaria(');
  });

  it('construirDatosEntradaServiciosNoContinuos sigue siendo {servicios:serviciosNoContinuos} sin transformación — los campos nuevos viajan sin cableado adicional', () => {
    expect(PAGE_TSX).toContain('function construirDatosEntradaServiciosNoContinuos(){\n    return { servicios: serviciosNoContinuos };\n  }');
  });
});
