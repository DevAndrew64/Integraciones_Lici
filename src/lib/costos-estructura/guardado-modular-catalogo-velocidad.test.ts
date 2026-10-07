/**
 * Ajuste "OPTIMIZAR VELOCIDAD DEL CATÁLOGO DE DOTACIÓN Y EPP" — wiring del
 * cliente: selección persistente por código de producto (sobrevive a la
 * paginación), AbortController (cancela solicitudes en vuelo), debounce de
 * búsqueda, paginación real consumiendo la respuesta del servidor. La
 * lógica de deduplicación/paginación en sí ya está cubierta, sin red, en
 * catalogo-dotacion-dedup.test.ts y api/dotacion-ext/route.test.ts.
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

describe('1/4) La consulta inicial usa limit ≤50 y nunca carga el catálogo completo', () => {
  it('SEL_DOT_LIMIT/SEL_EPP_LIMIT están fijados en 50, enviados como `limit` a la API', () => {
    expect(PAGE_TSX).toContain('const SEL_DOT_LIMIT=50;');
    expect(PAGE_TSX).toContain('const SEL_EPP_LIMIT=50;');
    const bDot = bloque('const consultarCatalogDot=', '\n  /** Búsqueda con debounce');
    expect(bDot).toContain('page:pagina,limit:SEL_DOT_LIMIT,');
  });
});

describe('2) Envía categoría masculina/femenina explícita', () => {
  it('consultarCatalogDot envía `categoria` — override explícito o el del contexto ya abierto', () => {
    const b = bloque('const consultarCatalogDot=', '\n  /** Búsqueda con debounce');
    expect(b).toContain('categoria:categoriaOverride??catalogoDotEppContexto?.categoriaSeleccionada,');
  });
});

describe('5) Una sola solicitud inicial — AbortController cancela la anterior', () => {
  it('consultarCatalogDot aborta la solicitud previa antes de lanzar una nueva, e ignora respuestas ya obsoletas', () => {
    const b = bloque('const consultarCatalogDot=', '\n  /** Búsqueda con debounce');
    expect(b).toContain('selDotAbortRef.current?.abort();');
    expect(b).toContain('signal:controlador.signal');
    expect(b).toContain('if(controlador.signal.aborted)return;');
  });

  it('lo mismo en consultarCatalogEpp', () => {
    const b = bloque('const consultarCatalogEpp=', '\n  const onChangeSelEppQ=');
    expect(b).toContain('selEppAbortRef.current?.abort();');
    expect(b).toContain('signal:controlador.signal');
    expect(b).toContain('if(controlador.signal.aborted)return;');
  });

  it('abrirCatalogoDotParaLinea/EppParaLinea disparan exactamente una consulta al abrir (nunca dos por apertura+botón simultáneos)', () => {
    const bDot = bloque('const abrirCatalogoDotParaLinea=', '\n  const abrirCatalogoEppParaLinea=');
    expect((bDot.match(/consultarCatalogDot\(/g) ?? []).length).toBe(1);
    const bEpp = bloque('const abrirCatalogoEppParaLinea=', '\n  // Ajuste "AJUSTAR TURNANTES POR BLOQUES DE 21 Y 42 HORAS" — cada grupo');
    expect((bEpp.match(/consultarCatalogEpp\(/g) ?? []).length).toBe(1);
  });
});

describe('6) Búsqueda con debounce', () => {
  it('onChangeSelDotQ usa un debounce de 400ms y exige mínimo 2 caracteres (o vacío) antes de relanzar', () => {
    const b = bloque('const onChangeSelDotQ=', '\n  const onEnterSelDotQ=');
    expect(b).toContain('setTimeout(()=>consultarCatalogDot(1,undefined,{q:v}),400)');
    expect(b).toContain('if(limpio.length>0&&limpio.length<2)return;');
  });

  it('Enter cancela el debounce pendiente y consulta de inmediato', () => {
    const b = bloque('const onEnterSelDotQ=', '\n  const toggleSelDot=');
    expect(b).toContain('if(selDotDebounceRef.current)clearTimeout(selDotDebounceRef.current);');
    expect(b).toContain('consultarCatalogDot(1);');
  });
});

describe('Corrección "BORRAR LA BÚSQUEDA NO RESTAURA EL CATÁLOGO" — cierre obsoleto en el debounce', () => {
  // Causa raíz: el callback diferido (`setTimeout`) leía `selDotQ`/`selEppQ`/
  // `selMaqQ`/`selInsQ` del CIERRE del handler — ese cierre es del render en
  // que se tecleó ESTA letra, que todavía tiene el valor ANTERIOR
  // (`setSelDotQ(v)` recién se aplica en el próximo render, el estado nuevo
  // no existe todavía dentro de este mismo handler). Como cada tecla
  // reprograma el debounce y solo sobrevive el último temporizador, la
  // consulta que finalmente se dispara SIEMPRE queda una tecla por detrás
  // de lo escrito — al borrar manualmente hasta dejar el campo vacío, la
  // API se consulta con el penúltimo valor no vacío en vez de q=undefined
  // (repro real: 27 familias → escribir → borrar todo → 20, no 27). La
  // corrección pasa `v` (el valor recién tecleado, fresco, del propio
  // parámetro del handler — nunca del estado) como override explícito al
  // `consultarCatalogX`, mismo patrón ya usado por
  // `limpiarFiltrosCatalogoDot`/`onChangeSelInsCodigoF`/
  // `dispararFiltroExamDebounced` (los únicos que no tenían este bug).
  it('Dotación (masculina/femenina): onChangeSelDotQ pasa `v` fresco, nunca lee selDotQ del cierre', () => {
    const b = bloque('const onChangeSelDotQ=', '\n  const onEnterSelDotQ=');
    expect(b).toContain('consultarCatalogDot(1,undefined,{q:v})');
    expect(b).not.toContain('consultarCatalogDot(1),400)');
  });

  it('EPP: onChangeSelEppQ pasa `v` fresco, nunca lee selEppQ del cierre', () => {
    const b = bloque('const onChangeSelEppQ=', '\n  const onEnterSelEppQ=');
    expect(b).toContain('consultarCatalogEpp(1,{q:v})');
    expect(b).not.toContain('consultarCatalogEpp(1),400)');
  });

  it('Maquinaria: onChangeSelMaqQ pasa `v` fresco, nunca lee selMaqQ del cierre', () => {
    const b = bloque('const onChangeSelMaqQ=', '\n  const onEnterSelMaqQ=');
    expect(b).toContain('consultarCatalogMaq(1,{q:v})');
    expect(b).not.toContain('consultarCatalogMaq(1),400)');
  });

  it('Insumos (nombre): onChangeSelInsQ pasa `v` fresco, nunca lee selInsQ del cierre', () => {
    const b = bloque('const onChangeSelInsQ=', '\n  const onEnterSelInsQ=');
    expect(b).toContain('consultarCatalogIns(1,{q:v})');
    expect(b).not.toContain('consultarCatalogIns(1),400)');
  });

  it('Exámenes e Insumos-código YA usaban override explícito antes de esta corrección — sin regresión, mismo patrón', () => {
    expect(PAGE_TSX).toContain('selExamFiltroDebounceRef.current=setTimeout(()=>consultarCatalogExam(1,override),400);');
    expect(PAGE_TSX).toContain('selInsCodigoDebounceRef.current=setTimeout(()=>consultarCatalogIns(1,{codigo:v}),400);');
  });

  it('ningún selector de catálogo (Dotación/EPP/Maquinaria/Insumos/Exámenes) programa un debounce de búsqueda sin override explícito', () => {
    const llamadasSinOverride = PAGE_TSX.match(/consultarCatalog(Dot|Epp|Maq|Ins|Exam)\(1\),400\)/g) ?? [];
    expect(llamadasSinOverride).toEqual([]);
  });
});

describe('9) Caché — evita repetir consultas iguales (ver route.test.ts para la prueba real de caché de servidor)', () => {
  it('el servidor documenta y usa una caché en memoria por combinación empresa+uen con TTL', () => {
    const dotacionExt = readFileSync(join(__dirname, '../../app/api/dotacion-ext/route.ts'), 'utf-8');
    expect(dotacionExt).toContain('const TTL_CACHE_MS = 10 * 60 * 1000;');
    expect(dotacionExt).toContain('cacheCatalogoDotacion.set(clave');
  });
});

describe('10/11) Selección por código de producto — sobrevive a la paginación', () => {
  it('selDotSeleccion es un Map<string,EquipoRow> (clave=código), nunca un Set de índices', () => {
    expect(PAGE_TSX).toContain('const [selDotSeleccion,setSelDotSeleccion]=useState<Map<string,EquipoRow>>(new Map());');
  });

  it('toggleSelDot marca/desmarca por el código de la fila, no por su posición en la página actual', () => {
    const b = bloque('const toggleSelDot=', '\n  const toggleAllSelDotPagina=');
    expect(b).toContain('const key=codigoFila(r);');
  });

  it('agregarSeleccionadosDot recorre selDotSeleccion.forEach — incluye selecciones de páginas anteriores, no solo la página visible', () => {
    const b = bloque('const agregarSeleccionadosDot=', '\n  const [duplicandoMujer');
    expect(b).toContain('selDotSeleccion.forEach(r=>{');
  });
});

describe('12) Un timeout/error no deja el spinner infinito; permite reintentar', () => {
  it('consultarCatalogDot siempre limpia selDotCarg en finally (nunca queda cargando indefinidamente)', () => {
    const b = bloque('const consultarCatalogDot=', '\n  /** Búsqueda con debounce');
    expect(b).toContain('if(selDotAbortRef.current===controlador)setSelDotCarg(false);');
  });

  it('el pie del catálogo ofrece "Reintentar" cuando hay un error', () => {
    const b = bloque('{/* ══ MODAL CATÁLOGO DOTACIÓN', '{/* ══ MODAL CATÁLOGO EPP');
    expect(b).toContain('Reintentar');
  });
});

describe('14) El botón cerrar funciona mientras carga (nunca bloquea el cierre)', () => {
  it('el botón ✕/Cancelar del catálogo de Dotación siempre está habilitado, incluso con selDotCarg=true', () => {
    const b = bloque('{/* ══ MODAL CATÁLOGO DOTACIÓN', '{/* ══ MODAL CATÁLOGO EPP');
    expect(b).not.toContain('disabled={selDotCarg}>✕');
    expect(b).not.toContain('button onClick={cerrar} disabled');
  });
});

describe('15) La tabla no renderiza más filas que el límite del servidor', () => {
  it('la tabla mapea filasPagina (= la página ya recibida), nunca todo selDotCatalog sin paginar de por medio', () => {
    const b = bloque('{/* ══ MODAL CATÁLOGO DOTACIÓN', '{/* ══ MODAL CATÁLOGO EPP');
    expect(b).toContain('{filasPagina.map((r,i)=>{');
  });
});

describe('16/17) El backend ya filtra antes de paginar y expone total/totalPages (ver route.test.ts para la prueba end-to-end)', () => {
  it('el cliente lee page/total/totalPages de la respuesta del servidor, nunca los calcula localmente', () => {
    const b = bloque('const consultarCatalogDot=', '\n  /** Búsqueda con debounce');
    expect(b).toContain('setSelDotPage(d.page??1);setSelDotTotal(d.total??0);setSelDotTotalPages(d.totalPages??1);');
  });
});
