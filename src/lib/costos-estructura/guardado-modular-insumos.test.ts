/**
 * Ajuste "REDISEÑAR LA PESTAÑA INSUMOS" ETAPA 2 — verificación de cableado
 * en page.tsx: catálogo conectado a /api/insumos-ext (nunca grupocolba.com
 * directamente), borrador local, cálculo centralizado en
 * calcularValorMensualInsumo/calcularValorUnitarioConIva (nunca duplicado
 * en el JSX), sin guardado modular todavía (ETAPA 3, explícitamente
 * diferida). Mismo patrón `bloque()` que el resto de
 * guardado-modular-*.test.ts.
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

describe('1/2) La pestaña consume /api/insumos-ext, nunca crea/llama otra API', () => {
  it('consultarCatalogIns hace fetch a /api/insumos-ext, nunca a grupocolba.com', () => {
    const b = bloque('const consultarCatalogIns=async(', 'const onChangeSelInsQ=');
    expect(b).toContain("fetch('/api/insumos-ext'");
    expect(b).not.toContain('grupocolba.com');
  });

  // Ajuste "IVA DIFERENCIAL/EXENTO POR INSUMO" — el import crece con las
  // funciones de IVA real por producto (resolverIvaCatalogoInsumo/
  // clasificarIvaInsumo/etiqueta), siguen viniendo de la misma librería
  // compartida, nunca reimplementadas en page.tsx.
  it('el import de la fórmula viene de la librería compartida, no se reimplementa la API en otro archivo', () => {
    expect(PAGE_TSX).toContain("import { IVA_INSUMOS_PORCENTAJE, calcularValorUnitarioConIva, calcularValorMensualInsumo, normalizarInsumoHistorico, resolverIvaCatalogoInsumo, clasificarIvaInsumo, ETIQUETA_CLASIFICACION_IVA_INSUMO } from '@/lib/costos-estructura/calculo-insumos';");
  });
});

describe('3) El catálogo conserva la fila completa (código, nombre, unidad, UEN, valor)', () => {
  it('la tabla del selector muestra código, nombre, unidad y valor con/sin IVA', () => {
    const b = bloque('{selInsCatalog.map((r,i)=>{', '</tbody>');
    expect(b).toContain('String(r.codigo??');
    expect(b).toContain('String(r.nombre??');
    expect(b).toContain('String(r.undmed??');
    expect(b).toContain('cop(valorNum)');
  });

  it('agregarSeleccionadosIns conserva unidad (undmed) y UEN (undnegocio) del catálogo', () => {
    const b = bloque('const agregarSeleccionadosIns=()=>{', 'if(omitidos>0)');
    expect(b).toContain('unidad:r.undmed?String(r.undmed):undefined');
    expect(b).toContain('uen:r.undnegocio?String(r.undnegocio):undefined');
  });
});

describe('4/5) Cantidad, frecuencia y VR UNIT. son editables para catálogo; código/nombre/unidad/VR C-IVA son de solo lectura', () => {
  // Ajuste "VR UNIT. EDITABLE EN INSUMOS" — `valorUnitarioSinIva` se suma
  // a los campos editables; `valorUnitarioConIva` sigue siendo SIEMPRE
  // derivado (nunca editable directamente — evita 2 fuentes de verdad).
  it('actualizarInsumoBorrador acepta cantidad/frecuenciaMeses/valorUnitarioSinIva', () => {
    const b = bloque('const actualizarInsumoBorrador=(id:number,cambios:', '=>setBorradorInsumos(p=>p.map(r=>{');
    expect(b).toContain("Partial<Pick<InsumoRow,'cantidad'|'frecuenciaMeses'|'valorUnitarioSinIva'>>");
  });

  it('la fila del borrador tiene inputs de cantidad, frecuencia y VR unit.; código/nombre/VR c-iva son texto plano', () => {
    const b = bloque('{borradorInsumos.map(r=>{', 'const set=(k:keyof FormularioManualInsumo');
    expect(b).toContain("onChange={e=>actualizarInsumoBorrador(r.id,{cantidad:Number(e.target.value)||0})}");
    // Ajuste "Y ACA NO QUIERO DECIMALES" — Frec. (m) del borrador pasó de
    // decimal (min=0.5/step=0.5) a entero (min=1/step=1, redondeado).
    expect(b).toContain("onChange={e=>actualizarInsumoBorrador(r.id,{frecuenciaMeses:Math.max(1,Math.round(Number(e.target.value)))||1})}");
    // Ajuste "QUE SEA FORMATO MONEDA" — input de texto formateado con cop()
    // (mismo formato "$ 21.008" que VR C/IVA), parseado con
    // parsearValorMonetario (misma utilidad ya usada para otros campos
    // monetarios editables del módulo), nunca un <input type="number"> plano.
    expect(b).toContain("value={r.valorUnitarioSinIva?cop(r.valorUnitarioSinIva):''}");
    expect(b).toContain("onChange={e=>actualizarInsumoBorrador(r.id,{valorUnitarioSinIva:parsearValorMonetario(e.target.value)||0})}");
    // código NUNCA editable; VR c/iva sigue siendo texto derivado (cop(r.valorUnitarioConIva)), nunca <input>
    expect(b).not.toMatch(/<input[^>]*value=\{r\.codigo/);
    expect(b).not.toMatch(/<input[^>]*value=\{r\.valorUnitarioConIva/);
    expect(b).toContain('{cop(r.valorUnitarioConIva)}');
  });
});

// Ajuste "IVA DIFERENCIAL/EXENTO POR INSUMO" — el IVA de un insumo de
// catálogo ya NO es la constante fija: viene de `r.iva` (real, confirmado
// en vivo contra la API de Inventarios: 0/5/19 según el producto), vía
// `resolverIvaCatalogoInsumo`.
describe('6) Valor con IVA se calcula una sola vez, nunca se duplica', () => {
  it('agregarSeleccionadosIns calcula valorConIva UNA vez (con el IVA real del insumo, nunca 19% fijo) y lo reutiliza para valorUnitarioConIva y valorMensual', () => {
    const b = bloque('const agregarSeleccionadosIns=()=>{', 'cerrarSelectorInsumos();');
    const ocurrencias = b.match(/calcularValorUnitarioConIva\(/g) ?? [];
    expect(ocurrencias.length).toBe(1);
    expect(b).toContain('const ivaReal=resolverIvaCatalogoInsumo(r.iva);');
    expect(b).toContain('valorUnitarioSinIva:valorSinIva,ivaPorcentaje:ivaReal,valorUnitarioConIva:valorConIva,');
    expect(b).toContain('valorMensual:calcularValorMensualInsumo({cantidad:1,frecuenciaMeses:1,valorUnitarioConIva:valorConIva})');
  });

  it('el valor con IVA de la fila siempre viene de cop(valorConIva), nunca de un campo leído de la fuente', () => {
    const b = bloque('{selInsCatalog.map((r,i)=>{', '</tbody>');
    expect(b).toContain('{cop(valorConIva)}');
  });
});

describe('7/8) Valor mensual usa la fórmula centralizada — cambiar cantidad/frecuencia/VR unit. recalcula', () => {
  it('actualizarInsumoBorrador recalcula valorUnitarioConIva y valorMensual con las funciones centralizadas, nunca inline en el JSX', () => {
    const b = bloque('const actualizarInsumoBorrador=', 'const eliminarInsumoBorrador=');
    // VR C/IVA se recalcula SIEMPRE a partir de valorUnitarioSinIva (editable)
    // + el ivaPorcentaje YA asignado a la fila — nunca editable por separado.
    expect(b).toContain('calcularValorUnitarioConIva(actualizado.valorUnitarioSinIva,actualizado.ivaPorcentaje??IVA_INSUMOS_PORCENTAJE)');
    expect(b).toContain('valorMensual:calcularValorMensualInsumo({...actualizado,valorUnitarioConIva})');
  });

  it('guardarManualInsumo también usa calcularValorMensualInsumo/calcularValorUnitarioConIva, nunca fórmula propia', () => {
    const b = bloque('const guardarManualInsumo=()=>{', 'cerrarModalManualInsumo();');
    expect(b).toContain('calcularValorUnitarioConIva(valorUnitarioSinIva,ivaPorcentaje)');
    expect(b).toContain('calcularValorMensualInsumo({cantidad,frecuenciaMeses,valorUnitarioConIva:valorConIva})');
  });
});

describe('9) Registro manual valida los campos obligatorios', () => {
  it('valida nombre, cantidad, frecuencia, valor, IVA y fecha no futura — código YA NO es obligatorio (Ajuste "CÓDIGO NO OBLIGATORIO EN INSUMO MANUAL")', () => {
    const b = bloque('const guardarManualInsumo=()=>{', 'if(Object.keys(errores).length>0)');
    expect(b).not.toContain("errores.codigo='El código es obligatorio.'");
    expect(b).toContain("errores.nombre='El nombre es obligatorio.'");
    expect(b).toContain("errores.cantidad='La cantidad debe ser mayor que cero.'");
    expect(b).toContain("errores.frecuenciaMeses='La frecuencia debe ser mayor que cero.'");
    expect(b).toContain("errores.valorUnitarioSinIva='El valor unitario debe ser mayor que cero.'");
    expect(b).toContain("errores.ivaPorcentaje='El IVA debe estar entre 0 y 100.'");
    expect(b).toContain("errores.fechaValor='La fecha no puede ser futura.'");
  });
});

describe('10) No permite duplicados por código (catálogo ni manual)', () => {
  it('agregarSeleccionadosIns omite duplicados y muestra el mensaje exacto', () => {
    const b = bloque('const agregarSeleccionadosIns=()=>{', 'cerrarSelectorInsumos();');
    expect(b).toContain('normalizarCodigoInsumo(x.codigo)===claveNueva');
    expect(b).toContain("alert('Este insumo ya se encuentra agregado. Modifica la cantidad o frecuencia del registro existente.');");
  });

  it('guardarManualInsumo valida duplicados excluyendo la propia fila en edición', () => {
    const b = bloque('const guardarManualInsumo=()=>{', 'if(Object.keys(errores).length>0)');
    expect(b).toContain('x.id!==modalManualInsumoFilaId&&normalizarCodigoInsumo(x.codigo)===claveNueva');
  });
});

describe('11) La ficha exterior de solo lectura no tiene inputs', () => {
  it('el bloque de insumosRows.map en la ficha exterior no contiene ningún <input>', () => {
    const b = bloque('{insumosRows.map(r=>(', 'Valor mensual de insumos');
    expect(b).not.toContain('<input');
  });

  it('"Gestionar insumos" reabre el modal, nunca edita directamente la ficha', () => {
    // Ajuste "SERVICIOS NO CONTINUOS — REUTILIZACIÓN REAL DE CATÁLOGOS" —
    // abrirModalInsumos ahora acepta un `servicioId` opcional (para reutilizar
    // el mismo modal/catálogo dentro de un servicio no continuo); el botón
    // del módulo global sigue abriendo el MISMO modal sin destino (global).
    expect(PAGE_TSX).toContain('<button onClick={()=>abrirModalInsumos()} style={{height:30,padding:\'0 14px\',background:\'white\',color:NAVY,border:\'1px solid \'+NAVY,borderRadius:6,fontSize:11,fontWeight:700,fontFamily:F,cursor:\'pointer\'}}>Gestionar insumos</button>');
  });
});

describe('12) No aparece "Últ. compra" en Insumos (la API no la entrega)', () => {
  it('ni el selector ni la ficha exterior de Insumos muestran última compra', () => {
    const bSelector = bloque('const consultarCatalogIns=async(', 'const guardarManualInsumo=()=>{');
    expect(bSelector).not.toContain('Últ. compra');
    expect(bSelector).not.toContain('fechaUltimaCompra');
  });
});

describe('13) Almacenar insumos actualiza solo el estado local, nunca ejecuta PUT', () => {
  it('almacenarInsumos solo hace setInsumosRows, sin fetch', () => {
    const b = bloque('const almacenarInsumos=()=>{', '};');
    expect(b).toContain('setInsumosRows(borradorInsumos)');
    expect(b).not.toContain('fetch(');
  });
});

// Ajuste "VALOR AGREGADO — 5 TIPOS CONSOLIDADOS" — filas marcadas VA
// dejan de sumar aquí (se trasladan al subtotal de Valor Agregado, ver
// valor-agregado.ts), nunca en ambos lugares.
describe('14) Total mensual suma todos los insumos NO marcados Valor Agregado, una sola vez', () => {
  it('totalMensualInsumos es la única fuente del total, reutilizada en el pie del detalle', () => {
    expect(PAGE_TSX).toContain("const totalMensualInsumos=insumosRows.filter(r=>!esRecursoValorAgregado(r)).reduce((s,r)=>s+r.valorMensual,0);");
    expect(PAGE_TSX).toContain('Valor mensual de insumos</span>');
  });
});

describe('15) Selección del catálogo identificada por código — sobrevive al cambio de página', () => {
  it('selInsSeleccion es un Map keyed por código, no por índice de fila', () => {
    expect(PAGE_TSX).toContain('const [selInsSeleccion,setSelInsSeleccion]=useState<Map<string,Record<string,unknown>>>(new Map());');
    expect(PAGE_TSX).toContain("const codigoFilaIns=(r:Record<string,unknown>)=>String(r.codigo??'');");
  });
});

describe('16) Limpiar filtros hace una sola petición con filtros explícitos — Ajuste "APLICAR LA MISMA LÓGICA DE EMPRESA/PERFIL EN INSUMOS": empresa NUNCA se restablece (ya no es un filtro libre)', () => {
  it('limpiarFiltrosCatalogoIns construye filtrosLimpios (sin empresa) y llama consultarCatalogIns una sola vez', () => {
    const b = bloque('const limpiarFiltrosCatalogoIns=async()=>{', '};\n  const toggleSelIns=');
    const ocurrencias = b.match(/consultarCatalogIns\(/g) ?? [];
    expect(ocurrencias.length).toBe(1);
    expect(b).toContain('await consultarCatalogIns(filtrosLimpios.pagina,{uen:filtrosLimpios.uen,q:filtrosLimpios.busqueda,codigo:filtrosLimpios.codigo});');
    expect(b).not.toContain('empresa');
  });
});

describe('21) VR UNIT. editable — no toca el catálogo externo, aplica a manual y catálogo, persiste vía el borrador existente', () => {
  it('editar valorUnitarioSinIva nunca hace fetch — actualizarInsumoBorrador es puro setState local', () => {
    const b = bloque('const actualizarInsumoBorrador=', 'const eliminarInsumoBorrador=');
    expect(b).not.toContain('fetch(');
  });

  it('el insumo manual conserva su propio flujo de edición (guardarManualInsumo), sin cambios — VR unit. sigue siendo editable ahí igual que antes', () => {
    const b = bloque('const guardarManualInsumo=()=>{', 'cerrarModalManualInsumo();');
    expect(b).toContain("errores.valorUnitarioSinIva='El valor unitario debe ser mayor que cero.'");
  });

  it('"Almacenar insumos" persiste la fila completa (incluido valorUnitarioSinIva editado) al estado local — mismo mecanismo ya probado en 13), sin tocar /api/insumos-ext', () => {
    const b = bloque('const almacenarInsumos=()=>{', '};');
    expect(b).toContain('setInsumosRows(borradorInsumos)');
    expect(b).not.toContain('fetch(');
  });

  it('re-seleccionar el mismo código desde el catálogo sigue tomando el valor real de la fuente (agregarSeleccionadosIns lee r.valor del catálogo, nunca un valor editado de otro proceso — no hay estado compartido entre procesos)', () => {
    const b = bloque('const agregarSeleccionadosIns=()=>{', 'cerrarSelectorInsumos();');
    expect(b).toContain('const ivaReal=resolverIvaCatalogoInsumo(r.iva);');
    // El valor sin IVA sale de la fila del catálogo (`r`), nunca de insumosRows/borradorInsumos existente.
    expect(b).toMatch(/valorSinIva\s*=\s*Number\(r\.valor\)/);
  });
});

describe('20) Compatibilidad con el consumidor previo del endpoint (ModuloEquipos)', () => {
  it('fetchInsumos de ModuloEquipos pasa limit alto para preservar el catálogo completo (no queda paginado a 50 por sorpresa)', () => {
    const b = bloque('const fetchInsumos=useCallback(async()=>{', '},[inEmpresa,inUen]);');
    expect(b).toContain('limit:2000');
  });
});
