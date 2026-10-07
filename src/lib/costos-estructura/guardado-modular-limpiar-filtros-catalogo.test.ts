/**
 * Ajuste "AGREGAR BOTÓN 'LIMPIAR FILTROS' AL CATÁLOGO DE DOTACIÓN Y EPP" +
 * corrección posterior "BUG DEL BOTÓN LIMPIAR FILTROS" — verificación de
 * cableado en page.tsx (texto fuente, mismo patrón que el resto de
 * guardado-modular-*.test.ts).
 *
 * Causa real del bug (§13 de la corrección): el guard anterior
 * (`if(selDotCarg||selDotLimpiando)return`) hacía un no-op SILENCIOSO
 * cuando ya había una consulta en vuelo (p.ej. el debounce de búsqueda
 * acababa de disparar una petición) — el botón se veía habilitado (su
 * color solo dependía de `hayFiltrosActivosDot`, nunca de `selDotCarg`)
 * pero el clic no restablecía nada.
 *
 * Corrección: `limpiarFiltrosCatalogoDot`/`Epp` ya no ignoran el clic —
 * abortan cualquier consulta/debounce en vuelo, arman un objeto
 * `filtrosLimpios` explícito, aplican el estado visual desde ese mismo
 * objeto y disparan UNA sola consulta pasándolo como override (nunca
 * leyendo el estado recién actualizado, todavía no aplicado).
 *
 * Ajuste "FILTRO DE EMPRESA EN DOTACIÓN/EPP DEBE SER AUTOMÁTICO" — la
 * empresa DEJÓ de ser un filtro libre de este catálogo: ya no vive en
 * `filtrosLimpios`, no tiene setter propio (`setSelDotEmpresa`/
 * `setSelEppEmpresa` ya no existen) y "Limpiar filtros" nunca la toca —
 * las pruebas de esta sección que antes verificaban su reseteo se
 * reemplazan por pruebas que confirman justo lo contrario: que la empresa
 * es inmutable desde este flujo. La cobertura numérica/fuente de verdad
 * de la derivación automática vive en
 * `guardado-modular-empresa-automatica-dotacion-epp.test.ts`.
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

describe('Catálogo de Dotación — botón "Limpiar filtros" (corregido)', () => {
  it('1) aparece junto a "Consultar" (mismo contenedor de filtros)', () => {
    const b = bloque('const consultarCatalogDot=async(', '</div>\n                        <div style={{display:\'flex\',gap:12,flexWrap:\'wrap\' as const}}>\n                          <div style={{width:150}}>\n                            <div style={{fontSize:10,fontWeight:700,color:\'#6b7280\',marginBottom:4,fontFamily:F}}>Empresa</div>');
    const idxLimpiar = b.indexOf('limpiarFiltrosCatalogoDot');
    const idxConsultar = b.indexOf("onEnterSelDotQ()} disabled={selDotCarg}");
    expect(idxLimpiar).toBeGreaterThan(-1);
    expect(idxConsultar).toBeGreaterThan(idxLimpiar);
  });

  it('2/3/4/5) limpiarFiltrosCatalogoDot arma un objeto filtrosLimpios explícito y restablece búsqueda/UEN/código de grupo/página=1 — nunca empresa', () => {
    const b = bloque('const limpiarFiltrosCatalogoDot=async()=>{', '\n  };');
    expect(b).toContain("const filtrosLimpios={busqueda:'',uen:UEN_INICIAL_CATALOGO_DOT,codgrp:'',pagina:1};");
    expect(b).toContain('setSelDotQ(filtrosLimpios.busqueda)');
    expect(b).toContain('setSelDotUen(filtrosLimpios.uen)');
    expect(b).toContain('setSelDotCodgrp(filtrosLimpios.codgrp)');
  });

  it('10) la consulta usa los valores de filtrosLimpios (override explícito), nunca el estado recién actualizado (aún no aplicado)', () => {
    const b = bloque('const limpiarFiltrosCatalogoDot=async()=>{', '\n  };');
    expect(b).toContain('consultarCatalogDot(filtrosLimpios.pagina,undefined,{uen:filtrosLimpios.uen,codgrp:filtrosLimpios.codgrp,q:filtrosLimpios.busqueda})');
  });

  it('6) "Limpiar filtros" NUNCA toca la empresa — no existe setSelDotEmpresa en todo el archivo, ni empresa en filtrosLimpios', () => {
    const b = bloque('const limpiarFiltrosCatalogoDot=async()=>{', '\n  };');
    expect(b).not.toContain('empresa');
    expect(PAGE_TSX).not.toContain('setSelDotEmpresa');
  });

  it('7/8) la categoría (selDotSexo) fija por línea NUNCA se toca al limpiar', () => {
    const b = bloque('const limpiarFiltrosCatalogoDot=async()=>{', '\n  };');
    expect(b).not.toContain('setSelDotSexo');
    expect(b).not.toContain('setCatalogoDotEppContexto');
  });

  it('8) conserva la selección de productos ya hecha (selDotSeleccion nunca se toca)', () => {
    const b = bloque('const limpiarFiltrosCatalogoDot=async()=>{', '\n  };');
    expect(b).not.toContain('setSelDotSeleccion');
  });

  it('9/11) ejecuta una sola petición: 11) ningún useEffect repone BAQ/F001 (no existe un useEffect que escriba UEN_INICIAL_CATALOGO_DOT/selDotCodgrp fuera de esta función y de la apertura del modal)', () => {
    const b = bloque('const limpiarFiltrosCatalogoDot=async()=>{', '\n  };');
    const ocurrencias = (b.match(/consultarCatalogDot\(/g) ?? []).length;
    expect(ocurrencias).toBe(1);
    // abrirCatalogoDotParaLinea (apertura) nunca restablece uen/codgrp — solo catálogo/selección/página/búsqueda
    const bApertura = bloque('const abrirCatalogoDotParaLinea=', '\n  };');
    expect(bApertura).not.toContain('setSelDotUen');
    expect(bApertura).not.toContain('setSelDotCodgrp');
  });

  it('9) nunca ignora el clic silenciosamente: no hay guard sobre selDotCarg (causa real del bug); solo evita reentrar sobre la propia limpieza y aborta lo que esté en vuelo', () => {
    const b = bloque('const limpiarFiltrosCatalogoDot=async()=>{', '\n  };');
    expect(b).toContain('if(selDotLimpiando)return;');
    expect(b).not.toContain('if(selDotCarg||selDotLimpiando)return;');
    expect(b).toContain('selDotAbortRef.current?.abort()');
    expect(b).toContain('if(selDotDebounceRef.current)clearTimeout(selDotDebounceRef.current);');
  });

  it('12) el estado vacío también ofrece "Limpiar filtros" reutilizando la misma función (nunca una segunda implementación)', () => {
    const b = bloque('No se encontraron productos con los filtros aplicados.', '\n                        )}\n                        {selDotCarg&&selDotCatalog.length===0');
    expect(b).toContain('limpiarFiltrosCatalogoDot');
  });

  it('13) queda deshabilitado cuando no hay filtros activos (hayFiltrosActivosDot, sin empresa) — el estilo visual coincide con el disabled real', () => {
    const b = bloque('const hayFiltrosActivosDot=', '\n  const limpiarFiltrosCatalogoDot=');
    expect(b).toContain("selDotQ.trim()!==''");
    expect(b).toContain('selDotUen!==UEN_INICIAL_CATALOGO_DOT');
    expect(b).toContain("selDotCodgrp.trim()!==''");
    expect(b).not.toContain('selDotEmpresa!==');
    const bBoton = bloque('<button onClick={limpiarFiltrosCatalogoDot} disabled={!hayFiltrosActivosDot', '\n                          </button>');
    expect(bBoton).toContain('disabled={!hayFiltrosActivosDot||selDotLimpiando}');
    expect(bBoton).toContain("color:hayFiltrosActivosDot&&!selDotLimpiando?'#374151':'#cbd5e1'");
  });

  it('14) no modifica cargo/sujetoKey/lineaManoObraId/cantidadTrabajadores', () => {
    const b = bloque('const limpiarFiltrosCatalogoDot=async()=>{', '\n  };');
    expect(b).not.toContain('setCatalogoTargetLineaId');
    expect(b).not.toContain('setCatalogoTargetCargo');
  });

  it('el onChange de UEN pasa el valor nuevo como override explícito; Empresa ya no es un <select> ni tiene onChange', () => {
    expect(PAGE_TSX).toContain("onChange={e=>{const v=e.target.value;setSelDotUen(v);consultarCatalogDot(1,undefined,{uen:v});}}");
    expect(PAGE_TSX).not.toContain('setSelDotEmpresa');
  });
});

describe('Catálogo de EPP — botón "Limpiar filtros" (mismo patrón, corregido) — 15) funciona también en EPP', () => {
  it('aparece junto a "Consultar", arma filtrosLimpios y limpia búsqueda/UEN (nunca empresa) en una sola petición', () => {
    const bBoton = bloque('const consultarCatalogEpp=async(', "onEnterSelEppQ()} disabled={selEppCarg}");
    expect(bBoton).toContain('limpiarFiltrosCatalogoEpp');
    const bFn = bloque('const limpiarFiltrosCatalogoEpp=async()=>{', '\n  };');
    // Ajuste "CÓDIGO DE GRUPO EN EL SELECTOR DE EPP": también limpia el código de grupo (igual que Dotación).
    expect(bFn).toContain("const filtrosLimpios={busqueda:'',uen:UEN_INICIAL_CATALOGO_EPP,codgrp:'',pagina:1};");
    expect(bFn).toContain('setSelEppQ(filtrosLimpios.busqueda)');
    expect(bFn).toContain('setSelEppUen(filtrosLimpios.uen)');
    expect(bFn).toContain('setSelEppCodgrp(filtrosLimpios.codgrp)');
    expect(bFn).not.toContain('empresa');
    expect(bFn).toContain('consultarCatalogEpp(filtrosLimpios.pagina,{uen:filtrosLimpios.uen,codgrp:filtrosLimpios.codgrp,q:filtrosLimpios.busqueda})');
    const ocurrencias = (bFn.match(/consultarCatalogEpp\(/g) ?? []).length;
    expect(ocurrencias).toBe(1);
    expect(bFn).not.toContain('setSelEppSeleccion');
    expect(bFn).not.toContain('setCatalogoDotEppContexto');
    expect(bFn).not.toContain('if(selEppCarg||selEppLimpiando)return;');
    expect(bFn).toContain('selEppAbortRef.current?.abort()');
  });

  it('el estado vacío de EPP también ofrece "Limpiar filtros" (mismo handler)', () => {
    const idxSegundaOcurrencia = PAGE_TSX.indexOf('No se encontraron productos con los filtros aplicados.', PAGE_TSX.indexOf('No se encontraron productos con los filtros aplicados.') + 1);
    expect(idxSegundaOcurrencia).toBeGreaterThan(-1);
    const b = bloque('No se encontraron productos con los filtros aplicados.', '\n                        )}', idxSegundaOcurrencia);
    expect(b).toContain('limpiarFiltrosCatalogoEpp');
  });

  it('el botón de EPP queda deshabilitado cuando no hay filtros activos, con estilo visual consistente', () => {
    expect(PAGE_TSX).toContain('const hayFiltrosActivosEpp=');
    const b = bloque('<button onClick={limpiarFiltrosCatalogoEpp} disabled={!hayFiltrosActivosEpp', '\n                          </button>');
    expect(b).toContain('disabled={!hayFiltrosActivosEpp||selEppLimpiando}');
    expect(b).toContain("color:hayFiltrosActivosEpp&&!selEppLimpiando?'#374151':'#cbd5e1'");
  });

  it('el onChange de UEN de EPP pasa el valor nuevo como override explícito; Empresa ya no es un <select> ni tiene onChange', () => {
    expect(PAGE_TSX).toContain("onChange={e=>{const v=e.target.value;setSelEppUen(v);consultarCatalogEpp(1,{uen:v});}}");
    expect(PAGE_TSX).not.toContain('setSelEppEmpresa');
  });
});
