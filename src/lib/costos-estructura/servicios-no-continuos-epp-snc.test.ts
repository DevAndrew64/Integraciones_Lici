/**
 * Ajuste "EPP EN SERVICIOS NO CONTINUOS" (petición directa).
 *
 * Bloque visual "EPP" en el modal "Editar servicio no continuo", ENTRE Mano
 * de Obra e Insumos. SOLO EPP (nunca Dotación):
 *  - Reutiliza el selector "Seleccionar EPP" existente (`showSelEpp` /
 *    `/api/epp-ext` / `agregarSeleccionadosEpp`) vía un wrapper delgado
 *    `abrirCatalogoEppServicio(servicioId)` — sin catálogo/API/modelo nuevo.
 *  - Persiste en la infraestructura existente `ServicioNoContinuo.dotacionEpp`
 *    (grupos `DotGroup` con `tipo:'epp'`), nunca un `servicio.epp` nuevo.
 *  - TOTAL EPP = MISMA función pura `calcularTotalDotacionEppServicio`,
 *    pre-filtrada a grupos `tipo:'epp'` — nunca suma Dotación.
 *
 * No hay arnés de render para page.tsx (~43k líneas); mismo patrón de
 * verificación de TEXTO del código fuente ya usado en
 * guardado-modular-turnantes.test.ts, más una prueba de la MECÁNICA real
 * con la función pura de servicios-no-continuos.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calcularTotalDotacionEppServicio, calcularValorMensualItemDotacionEpp, calcularTotalesServicioNoContinuo } from './servicios-no-continuos';
import type { DotGroup, DotItemRow } from '../costos-mano-obra/motor-distribuido/dotacion-epp-tipo';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');

function fila(over: Partial<DotItemRow> = {}): DotItemRow {
  return { id: 1, codigo: '18029', desc: 'GUANTE', medida: 'UND', cant: 1, frec: 1, vUnit: 3183, section: 'epp', origen: 'catalogo', ...over };
}
function grupoEpp(rows: DotItemRow[]): DotGroup {
  return { id: 100, tipo: 'epp', nombre: 'EPP', rows, categoria: 'EPP', lineaManoObraId: 999_999_999 };
}
function grupoDot(rows: DotItemRow[]): DotGroup {
  return { id: 200, tipo: 'dot', nombre: 'Hombre', rows, categoria: 'DOTACION_MASCULINA', lineaManoObraId: 1 };
}

// ── 1. TOTAL EPP = calcularTotalDotacionEppServicio pre-filtrado a tipo:'epp' ──
describe('TOTAL EPP — solo grupos tipo:"epp", nunca Dotación', () => {
  it('con SOLO grupos EPP, el total es la suma de sus filas (misma función pura)', () => {
    const grupos = [grupoEpp([fila({ id: 1, vUnit: 3183 }), fila({ id: 2, codigo: '18111', desc: 'LENTE', vUnit: 2550 })])];
    const total = calcularTotalDotacionEppServicio(grupos);
    expect(total).toBe(
      calcularValorMensualItemDotacionEpp(grupos[0].rows[0]) + calcularValorMensualItemDotacionEpp(grupos[0].rows[1]),
    );
    expect(total).toBeGreaterThan(0);
  });

  it('pre-filtrar `tipo==="epp"` excluye Dotación del TOTAL EPP', () => {
    const eppGrupo = grupoEpp([fila({ id: 1, vUnit: 3183 })]);
    const dotGrupo = grupoDot([fila({ id: 9, codigo: 'M013', desc: 'BOTA', section: 'dot', vUnit: 99999 })]);
    const todos: DotGroup[] = [eppGrupo, dotGrupo];

    const totalConDotacion = calcularTotalDotacionEppServicio(todos);
    const totalSoloEpp = calcularTotalDotacionEppServicio(todos.filter(g => g.tipo === 'epp'));

    expect(totalSoloEpp).toBe(calcularValorMensualItemDotacionEpp(eppGrupo.rows[0]));
    expect(totalSoloEpp).toBeLessThan(totalConDotacion); // la Dotación NO entra en TOTAL EPP
  });

  it('sin grupos EPP → TOTAL EPP = 0', () => {
    expect(calcularTotalDotacionEppServicio([grupoDot([fila({ section: 'dot' })])].filter(g => g.tipo === 'epp'))).toBe(0);
  });
});

// ── 2. Wrapper de apertura: reutiliza el selector EPP existente, solo EPP ──
describe('abrirCatalogoEppServicio — reutiliza "Seleccionar EPP", nunca abre Dotación', () => {
  function bloque(): string {
    const i = PAGE_TSX.indexOf('const abrirCatalogoEppServicio=(servicioId:string)=>{');
    expect(i).toBeGreaterThan(-1);
    const f = PAGE_TSX.indexOf('\n  };', i);
    return PAGE_TSX.slice(i, f);
  }

  it('fija destinoModalDotEpp al servicio y abre el selector EPP existente (showSelEpp), categoria EPP', () => {
    const b = bloque();
    expect(b).toContain('setDestinoModalDotEpp(servicioId);');
    expect(b).toContain("categoriaSeleccionada:'EPP',");
    expect(b).toContain('setShowSelEpp(true);');
    expect(b).toContain('consultarCatalogEpp(1);');
  });

  it('NO abre el modal "Registrar Dotación y EPP" (modalDotEppAbierto) ni ningún selector de Dotación', () => {
    const b = bloque();
    expect(b).not.toContain('setModalDotEppAbierto(true)');
    expect(b).not.toContain('setShowSelDot(true)');
  });

  it('usa un lineaManoObraId sentinel fijo → un único grupo EPP por servicio', () => {
    expect(PAGE_TSX).toContain('const LINEA_ID_EPP_SNC=999_999_999;');
    const b = bloque();
    expect(b).toContain('lineaManoObraId:LINEA_ID_EPP_SNC,');
  });

  it('NO se crea un catálogo/API/endpoint/modelo nuevo — reutiliza agregarSeleccionadosEpp / /api/epp-ext existentes', () => {
    // agregarSeleccionadosEpp (el commit del selector) sigue siendo único y ya
    // enruta a servicio.dotacionEpp vía mutarDotGroups cuando destinoModalDotEpp != null.
    expect((PAGE_TSX.split('const agregarSeleccionadosEpp=').length - 1)).toBe(1);
    expect(PAGE_TSX).not.toContain("fetch('/api/epp-snc");
    expect(PAGE_TSX).not.toContain('servicio.epp');
  });
});

// ── 3. Bloque JSX del modal: solo EPP, entre Mano de Obra e Insumos ──
describe('bloque "EPP" del modal — render y eliminación solo de filas EPP', () => {
  it('el título es exactamente "EPP" (no "EPP y Dotación") y el botón "+ Agregar EPP"', () => {
    const i = PAGE_TSX.indexOf('Ajuste "EPP EN SERVICIOS NO CONTINUOS" (petición directa) —\n                bloque "EPP"');
    expect(i).toBeGreaterThan(-1);
    const f = PAGE_TSX.indexOf('Ajuste "FASE B §5: INSUMOS', i);
    expect(f).toBeGreaterThan(i); // el bloque EPP está ANTES del bloque Insumos
    const b = PAGE_TSX.slice(i, f);
    // el CÓDIGO del bloque (sin el comentario de cabecera, que sí menciona
    // "Dotación" para explicar qué NO hace)
    const codigo = b.slice(b.indexOf('{(() => {'));
    expect(codigo).toContain('letterSpacing:\'.04em\'}}>EPP</div>');
    expect(codigo).toContain('+ Agregar EPP');
    expect(codigo).toContain('onClick={()=>abrirCatalogoEppServicio(b.id)}');
    expect(codigo).toContain('<span>TOTAL EPP</span>');
    expect(codigo).not.toContain('Dotación');
    expect(codigo).not.toContain('EPP y Dotación');
    expect(codigo).not.toContain("g.tipo==='dot'"); // el bloque nunca lee grupos de Dotación
  });

  it('lee/calcula SOLO grupos tipo:"epp" del servicio', () => {
    const i = PAGE_TSX.indexOf('bloque "EPP" ENTRE Mano de Obra e Insumos');
    const f = PAGE_TSX.indexOf('Ajuste "FASE B §5: INSUMOS', i);
    const b = PAGE_TSX.slice(i, f);
    expect(b).toContain("(b.dotacionEpp??[]).filter(g=>g.tipo==='epp')");
    expect(b).toContain('calcularTotalDotacionEppServicio(gruposEpp)');
  });

  it('eliminarFilaEppServicio escribe directo en servicio.dotacionEpp (sin depender de destinoModalDotEpp) y descarta el grupo EPP vacío; nunca toca "dot"', () => {
    const i = PAGE_TSX.indexOf('const eliminarFilaEppServicio=(servicioId:string,gid:number,rid:number)=>{');
    expect(i).toBeGreaterThan(-1);
    const f = PAGE_TSX.indexOf('\n  };', i);
    const b = PAGE_TSX.slice(i, f);
    expect(b).toContain("actualizarArregloServicioNoContinuo(servicioId,'dotacionEpp'");
    expect(b).toContain("g.tipo!=='epp'||g.rows.length>0"); // descarta solo el grupo EPP vacío
    expect(b).not.toContain('mutarDotGroups');
  });
});

// ── 4. Aislamiento: destinoModalDotEpp se limpia al salir; el catálogo EPP global no se contamina ──
describe('aislamiento — el catálogo EPP del módulo global nunca se misrutea a un servicio', () => {
  it('cerrar/guardar el modal de servicio limpia destinoModalDotEpp', () => {
    const ci = PAGE_TSX.indexOf('function cerrarModalServicioNoContinuo(){');
    const cerrar = PAGE_TSX.slice(ci, PAGE_TSX.indexOf('\n  }', ci));
    expect(cerrar).toContain('setDestinoModalDotEpp(null);');
    const gi = PAGE_TSX.indexOf('function guardarModalServicioNoContinuo(){');
    const guardar = PAGE_TSX.slice(gi, PAGE_TSX.indexOf('\n  }', gi));
    expect(guardar).toContain('setDestinoModalDotEpp(null);');
  });

  it('abrirCatalogoEppParaLinea (catálogo EPP global por cargo) limpia destinoModalDotEpp defensivamente', () => {
    const i = PAGE_TSX.indexOf('const abrirCatalogoEppParaLinea=(linea:typeof lineasManoObraDisponibles[number])=>{');
    const f = PAGE_TSX.indexOf('\n  };', i);
    const b = PAGE_TSX.slice(i, f);
    expect(b).toContain('setDestinoModalDotEpp(null);');
  });
});

// ── 5. Columnas de la grilla + persistencia por servicio (aislamiento SNC↔SNC) ──
describe('grilla EPP — columnas y valores con helpers existentes', () => {
  function bloqueEpp(): string {
    const i = PAGE_TSX.indexOf('bloque "EPP" ENTRE Mano de Obra e Insumos');
    const f = PAGE_TSX.indexOf('Ajuste "FASE B §5: INSUMOS', i);
    return PAGE_TSX.slice(i, f);
  }
  it('los encabezados visibles son Vr sin IVA / Vr con IVA / Valor mes', () => {
    const b = bloqueEpp();
    expect(b).toContain('>Vr sin IVA</div>');
    expect(b).toContain('>Vr con IVA</div>');
    expect(b).toContain('>Valor mes</div>');
    expect(b).not.toContain('>Valor und.</div>'); // ya no se usa el formato antiguo
  });
  it('cada columna usa el helper ya existente, sin fórmula duplicada', () => {
    const b = bloqueEpp();
    expect(b).toContain('{cop(row.vUnit||0)}');                              // Vr sin IVA
    expect(b).toContain('{cop(valorConIva(row.vUnit))}');                    // Vr con IVA (misma fn del sistema)
    expect(b).toContain('{cop(calcularValorMensualItemDotacionEpp(row))}');  // Valor mes
    expect(b).toContain('{cop(totalEpp)}');                                  // TOTAL EPP
    // no reimplementa el IVA a mano dentro del bloque
    expect(b).not.toMatch(/vUnit\s*\*\s*1\.19/);
  });
});

describe('aislamiento SNC ↔ SNC — cada servicio conserva su propio dotacionEpp', () => {
  it('mutarDotGroups escribe SOLO en el dotacionEpp del servicio destino; la lectura efectiva también es por servicio', () => {
    const mi = PAGE_TSX.indexOf('const mutarDotGroups=(actualizar:');
    const mut = PAGE_TSX.slice(mi, PAGE_TSX.indexOf('\n  };', mi));
    expect(mut).toContain("actualizarArregloServicioNoContinuo(destinoModalDotEpp,'dotacionEpp'");
    expect(PAGE_TSX).toContain("const dotGroupsEfectivos=destinoModalDotEpp!=null?(buscarServicioOValorAgregadoPorId(destinoModalDotEpp)?.dotacionEpp??[]):dotGroups;");
  });

  it('el sentinel es un id de GRUPO dentro del dotacionEpp de cada servicio, no un id compartido entre servicios', () => {
    expect(PAGE_TSX).toContain('const LINEA_ID_EPP_SNC=999_999_999;');
    // dos servicios, cada uno con su propio arreglo dotacionEpp y su propio
    // grupo EPP con el MISMO id de grupo (999_999_999): filtrar/sumar uno
    // nunca alcanza al otro porque son arreglos distintos de objetos distintos.
    const eppA: DotGroup = grupoEpp([fila({ id: 1, codigo: 'X', vUnit: 1000 })]);
    const eppB: DotGroup = grupoEpp([fila({ id: 1, codigo: 'Y', vUnit: 7000 })]);
    const servicioA: DotGroup[] = [eppA];
    const servicioB: DotGroup[] = [eppB];
    const eppDe = (grupos: DotGroup[]) => grupos.filter(g => g.tipo === 'epp');
    expect(calcularTotalDotacionEppServicio(eppDe(servicioA))).toBe(calcularValorMensualItemDotacionEpp(eppA.rows[0]));
    expect(calcularTotalDotacionEppServicio(eppDe(servicioB))).toBe(calcularValorMensualItemDotacionEpp(eppB.rows[0]));
    expect(calcularTotalDotacionEppServicio(eppDe(servicioA)))
      .not.toBe(calcularTotalDotacionEppServicio(eppDe(servicioB)));
    expect(servicioA.flatMap(g => g.rows.map(r => r.codigo))).not.toContain('Y');
    expect(servicioB.flatMap(g => g.rows.map(r => r.codigo))).not.toContain('X');
  });
});

describe('bloque "EPP" — TOTAL EPP siempre visible (también vacío = $0)', () => {
  function bloqueEpp(): string {
    const i = PAGE_TSX.indexOf('bloque "EPP" ENTRE Mano de Obra e Insumos');
    const f = PAGE_TSX.indexOf('Ajuste "FASE B §5: INSUMOS', i);
    return PAGE_TSX.slice(i, f);
  }
  it('la fila TOTAL EPP se renderiza fuera del ternario de filas vacías (no está condicionada a filasEpp.length>0)', () => {
    const b = bloqueEpp();
    const totalIdx = b.indexOf('<span>TOTAL EPP</span>');
    const ternarioIdx = b.indexOf('filasEpp.length===0?');
    const cierreTernario = b.indexOf(')}', b.indexOf('</>')); // cierre del bloque con tabla
    expect(totalIdx).toBeGreaterThan(-1);
    // el TOTAL EPP aparece DESPUÉS del cierre del ternario de la tabla
    expect(totalIdx).toBeGreaterThan(cierreTernario);
    expect(cierreTernario).toBeGreaterThan(ternarioIdx);
  });
  it('el ternario vacío solo oculta la tabla, no el total', () => {
    const b = bloqueEpp();
    expect(b).toContain('Sin EPP registrados.');
    expect(b).toContain('{cop(totalEpp)}');
    // totalEpp = helper puro sobre gruposEpp (vacío → 0)
    expect(b).toContain('const totalEpp=calcularTotalDotacionEppServicio(gruposEpp);');
  });
  it('calcularTotalDotacionEppServicio([]) === 0 (respaldo del "$0" cuando no hay EPP)', () => {
    expect(calcularTotalDotacionEppServicio([])).toBe(0);
  });
});

// ── 6. Corrección 6.A — "Seleccionar EPP" alcanzable fuera de tab==='epp' ──
describe('catálogo "Seleccionar EPP" (showSelEpp) — corrección 6.A: gate ampliado + wrapper interno (NO se movió/extrajo el bloque)', () => {
  it('la tarjeta ya NO se monta solo con tab==="epp": el gate incluye showSelEpp/showSelDot/modalDotEppAbierto/modalManualDot', () => {
    expect(PAGE_TSX).toContain("{(tab==='epp'||showSelEpp||showSelDot||modalDotEppAbierto||modalManualDot)&&(");
    expect(PAGE_TSX).not.toContain("{tab==='epp'&&(\n          <div style={card}>");
  });
  it('el contenido de SOLO CONSULTA de la pestaña EPP (ficha exterior/acordeones) sigue detrás de un wrapper tab===\'epp\' interno — fuera de esa pestaña no se monta', () => {
    const i = PAGE_TSX.indexOf("{(tab==='epp'||showSelEpp||showSelDot||modalDotEppAbierto||modalManualDot)&&(");
    const f = PAGE_TSX.indexOf('{modalManualDot&&(', i);
    expect(f).toBeGreaterThan(i);
    // hay exactamente un wrapper {tab==='epp'&&(<> ... después de los 4 sub-modales
    const wrap = PAGE_TSX.indexOf("{tab==='epp'&&(<>", f);
    expect(wrap).toBeGreaterThan(f);
  });
  it('el catálogo EPP (showSelEpp) y el de Dotación (showSelDot) NO se movieron ni se extrajeron a una función aparte — un único punto de render de cada uno, mismo bloque de siempre', () => {
    expect(PAGE_TSX.split('{showSelEpp&&(()=>{').length - 1).toBe(1);
    expect(PAGE_TSX.split('{showSelDot&&(()=>{').length - 1).toBe(1);
    expect(PAGE_TSX).not.toContain('function SelectorCatalogoEpp');
    expect(PAGE_TSX).not.toContain('const SelectorCatalogoEpp');
  });
  it('abrirCatalogoEppServicio abre ESE catálogo (setShowSelEpp(true)) apuntando al servicio — nunca "Registrar Dotación y EPP"', () => {
    const i = PAGE_TSX.indexOf('const abrirCatalogoEppServicio=(servicioId:string)=>{');
    expect(i).toBeGreaterThan(-1);
    const b = PAGE_TSX.slice(i, PAGE_TSX.indexOf('\n  };', i));
    expect(b).toContain('setDestinoModalDotEpp(servicioId);');
    expect(b).toContain('setShowSelEpp(true);');
    expect(b).not.toContain('setModalDotEppAbierto(true)');
  });
  it('el botón "+ Agregar EPP" del bloque llama a abrirCatalogoEppServicio(b.id)', () => {
    const i = PAGE_TSX.indexOf('bloque "EPP" ENTRE Mano de Obra e Insumos');
    const b = PAGE_TSX.slice(i, PAGE_TSX.indexOf('Ajuste "FASE B §5: INSUMOS', i));
    expect(b).toContain('onClick={()=>abrirCatalogoEppServicio(b.id)}');
    expect(b).toContain('+ Agregar EPP');
  });
});

// ── 7. EPP para CUALQUIER empresa — no depende de esTarifaAseocolba/Aseocolba ──
describe('EPP en SNC es agnóstico de empresa — nunca "esTarifaAseocolba"/"Aseocolba"/"ASEO" hardcodeado', () => {
  function bloqueEpp(): string {
    const i = PAGE_TSX.indexOf('bloque "EPP" ENTRE Mano de Obra e Insumos');
    const f = PAGE_TSX.indexOf('Ajuste "FASE B §5: INSUMOS', i);
    return PAGE_TSX.slice(i, f);
  }
  it('el bloque "EPP" (render, botón, TOTAL EPP) es una IIFE incondicional — NUNCA envuelta en esTarifaAseocolba ni en una comparación de empresa', () => {
    const b = bloqueEpp();
    expect(b).not.toContain('esTarifaAseocolba&&');
    expect(b).not.toContain("empresa==='aseo'");
    expect(b).not.toContain("empresa==='Aseocolba'");
    expect(b).not.toMatch(/esAseocolbaProceso\s*&&\s*\{?\(?\(\)\s*=>/); // no gatea la IIFE del bloque
    // la IIFE del bloque cuelga directo de la lista de hijos del modal (mismo
    // nivel que las ramas {!esTarifaAseocolba&&...}/{esTarifaAseocolba&&...}
    // de Mano de Obra), no anidada dentro de ninguna de las dos
    const iife = b.indexOf('{(() => {');
    expect(iife).toBeGreaterThan(-1);
    expect(b.slice(0, iife).trimEnd().endsWith('*/}')).toBe(true); // solo el comentario de cabecera precede a la IIFE
  });
  it('abrirCatalogoEppServicio/eliminarFilaEppServicio no referencian empresa/Aseocolba — el destino es siempre el servicio (servicioId), cualquiera sea su empresa', () => {
    const i1 = PAGE_TSX.indexOf('const abrirCatalogoEppServicio=(servicioId:string)=>{');
    const b1 = PAGE_TSX.slice(i1, PAGE_TSX.indexOf('\n  };', i1));
    expect(b1).not.toMatch(/Aseocolba|ASEO|esAseocolbaProceso/);
    const i2 = PAGE_TSX.indexOf('const eliminarFilaEppServicio=(servicioId:string,gid:number,rid:number)=>{');
    const b2 = PAGE_TSX.slice(i2, PAGE_TSX.indexOf('\n  };', i2));
    expect(b2).not.toMatch(/Aseocolba|ASEO|esAseocolbaProceso/);
  });
  it('el catálogo "Seleccionar EPP" usa la empresa/UEN DINÁMICA del proceso (empresaCatalogoProceso), nunca un literal de empresa', () => {
    // selEppEmpresa siempre se deriva de empresaCatalogoProceso — la MISMA
    // fuente para cualquier empresa (aseo/vigi/serviconfort/...), nunca un
    // string fijo de empresa dentro del flujo de consulta.
    expect(PAGE_TSX).toContain("const selEppEmpresa:string=empresaCatalogoProceso??'';");
    const i = PAGE_TSX.indexOf('const consultarCatalogEpp=async(');
    const b = PAGE_TSX.slice(i, PAGE_TSX.indexOf('\n  const onChangeSelEppQ=', i));
    expect(b).toContain('empresa:selEppEmpresa');
    expect(b).not.toMatch(/empresa:\s*'aseo'/);
    expect(b).not.toMatch(/empresa:\s*'Aseocolba'/i);
  });
  it('"TOTAL EPP" se calcula igual para cualquier empresa: SIEMPRE gruposEpp=(b.dotacionEpp??[]).filter(tipo===epp), nunca condicionado por empresa', () => {
    const b = bloqueEpp();
    expect(b).toContain("const gruposEpp=(b.dotacionEpp??[]).filter(g=>g.tipo==='epp');");
    expect(b).not.toMatch(/gruposEpp[^;]*empresa/i);
  });
});

// ── 7. Regla Tarifa Aseocolba intacta: EPP no se suma encima de la tarifa ──
describe('TARIFA_ASEOCOLBA — dotacionEpp del servicio no participa del total', () => {
  it('el modulo puro devuelve dotacionEpp: 0 en la rama TARIFA_ASEOCOLBA aunque el servicio tenga grupos EPP', () => {
    const s = {
      id: '1', descripcion: 'X', tipoCalculo: 'TARIFA_ASEOCOLBA' as const, tarifas: [],
      manoObra: [], examenesMedicos: { examenes: [], cursos: [], vacunas: [] }, insumos: [], maquinariaEquipos: [],
      dotacionEpp: [grupoEpp([fila({ vUnit: 50_000 })])],
    };
    const r = calcularTotalesServicioNoContinuo(s, 0);
    expect(r.dotacionEpp).toBe(0);
  });
});
