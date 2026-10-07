/**
 * Ajuste "MENSAJE INFORMATIVO EN VEZ DE CONSULTA AUTOMÁTICA" — el catálogo
 * de Dotación (masculina/femenina) ya NO consulta la API al abrirse: sin
 * nombre, código de producto ni código de grupo, el modal muestra un
 * mensaje que pide el criterio.
 *
 * Motivo (medido con datos reales, aseo/BAQ): el listado sin criterio
 * mostraba 262 familias con un Cód. grupo arbitrario por producto (un mismo
 * producto está en decenas de grupos, p. ej. `06043` en 159), lo que hacía
 * "desaparecer" grupos como M026, y además forzaba la carga completa del
 * catálogo (~20-30 s con la caché fría).
 *
 * Verificación de cableado en page.tsx (texto fuente, mismo patrón que el
 * resto de guardado-modular-*.test.ts): la regla vive en UN solo punto,
 * `consultarCatalogDot`, así que apertura, UEN, "Limpiar filtros", borrar
 * la búsqueda y el botón Consultar quedan cubiertos sin duplicar lógica.
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

const CONSULTAR = () => bloque('const consultarCatalogDot=', '\n  /** Búsqueda con debounce');

describe('consultarCatalogDot — sin criterio de búsqueda no llama a la API', () => {
  it('la guarda revisa el texto Y el código de grupo efectivos (override explícito o estado), nunca solo el estado', () => {
    const b = CONSULTAR();
    expect(b).toContain('if(!(filtrosOverride?.q??selDotQ).trim()&&!(filtrosOverride?.codgrp??selDotCodgrp).trim()){');
  });

  it('sin criterio: cancela lo que esté en vuelo, limpia lista/página/total y vuelve a "sin búsqueda" — sin fetch', () => {
    const b = CONSULTAR();
    const idxGuarda = b.indexOf('if(!(filtrosOverride?.q??selDotQ).trim()');
    const idxRetorno = b.indexOf('return;', idxGuarda);
    const cuerpoGuarda = b.slice(idxGuarda, idxRetorno);
    expect(cuerpoGuarda).toContain('selDotAbortRef.current?.abort();');
    expect(cuerpoGuarda).toContain('setSelDotCarg(false)');
    expect(cuerpoGuarda).toContain('setSelDotCatalog([])');
    expect(cuerpoGuarda).toContain('setSelDotTotal(0)');
    expect(cuerpoGuarda).toContain('setSelDotBuscado(false)');
    expect(cuerpoGuarda).not.toContain('fetch(');
  });

  it('la guarda va DESPUÉS del bloqueo por empresa y ANTES de armar la solicitud (AbortController/fetch)', () => {
    const b = CONSULTAR();
    const idxEmpresa = b.indexOf('if(!selDotEmpresa)');
    const idxGuarda = b.indexOf('if(!(filtrosOverride?.q??selDotQ).trim()');
    const idxControlador = b.indexOf('new AbortController()');
    const idxFetch = b.indexOf("fetch('/api/dotacion-ext'");
    expect(idxEmpresa).toBeGreaterThan(-1);
    expect(idxGuarda).toBeGreaterThan(idxEmpresa);
    expect(idxControlador).toBeGreaterThan(idxGuarda);
    expect(idxFetch).toBeGreaterThan(idxControlador);
  });

  it('con criterio: marca selDotBuscado=true al lanzar la solicitud', () => {
    const b = CONSULTAR();
    expect(b).toContain("setSelDotCarg(true);setSelDotErr('');setSelDotBuscado(true);");
  });

  it('la regla vive SOLO en consultarCatalogDot: ningún otro punto del cliente llama a la API de Dotación para el listado del modal', () => {
    // Los otros dos consumidores de /api/dotacion-ext son acciones puntuales
    // (duplicar a femenina / traer un grupo por código escrito), no el listado.
    const llamadas = PAGE_TSX.match(/fetch\('\/api\/dotacion-ext'/g) ?? [];
    expect(llamadas).toHaveLength(3);
    expect(CONSULTAR()).toContain("fetch('/api/dotacion-ext'");
  });
});

describe('Apertura del modal — no consulta por sí sola', () => {
  it('abrirCatalogoDotParaLinea sigue llamando exactamente UNA vez a consultarCatalogDot (la guarda decide si va a la API) y no toca uen/codgrp', () => {
    const b = bloque('const abrirCatalogoDotParaLinea=', '\n  };');
    expect((b.match(/consultarCatalogDot\(/g) ?? [])).toHaveLength(1);
    expect(b).not.toContain('setSelDotUen');
    expect(b).not.toContain('setSelDotCodgrp');
  });

  it('cerrar y agregarSeleccionadosDot limpian el código de grupo y el estado "buscado" — la próxima apertura no arrastra un filtro viejo', () => {
    const bAgregar = bloque('const agregarSeleccionadosDot=', '\n  const [duplicandoMujer');
    expect(bAgregar).toContain("setSelDotCodgrp('')");
    expect(bAgregar).toContain('setSelDotBuscado(false)');
    const bCerrar = bloque('const cerrar=()=>{', '\n                };', PAGE_TSX.indexOf('const tituloCatalogo=categoria'));
    expect(bCerrar).toContain("setSelDotCodgrp('')");
    expect(bCerrar).toContain('setSelDotBuscado(false)');
  });
});

describe('Modal de Dotación — mensaje informativo', () => {
  const MODAL = () => bloque('{/* ══ MODAL CATÁLOGO DOTACIÓN', '{/* ══ MODAL CATÁLOGO EPP');

  it('muestra el mensaje que pide nombre, código del producto o código del grupo mientras no se ha buscado', () => {
    const b = MODAL();
    expect(b).toContain('{!selDotBuscado&&!selDotCarg&&(');
    expect(b).toContain('Busca un producto para ver el catálogo');
    expect(b).toContain('<b>nombre</b>');
    expect(b).toContain('<b>código</b> del producto');
    expect(b).toContain('<b>código del grupo</b>');
    expect(b).toContain('presiona Consultar');
  });

  it('el ejemplo del código de grupo sigue el prefijo de la categoría (M… masculina, F… femenina)', () => {
    const b = MODAL();
    expect(b).toContain("resolverPrefijoGrupoObligatorio(categoria)??'M'}013");
  });

  it('"No se encontraron productos" ahora exige haber buscado — nunca se muestra antes de la primera búsqueda', () => {
    const b = MODAL();
    expect(b).toContain('{selDotBuscado&&selDotCatalog.length===0&&!selDotCarg&&!selDotErr&&(');
    expect(b.indexOf('Busca un producto para ver el catálogo')).toBeLessThan(b.indexOf('No se encontraron productos con los filtros aplicados.'));
  });

  it('el pie no afirma "0 familias" antes de buscar: muestra "Sin búsqueda" y conserva el contador de seleccionados', () => {
    const b = MODAL();
    expect(b).toContain("{selDotBuscado?<>{selDotTotal} familia");
    expect(b).toContain(":'Sin búsqueda'}");
    expect(b).toContain('{selDotSeleccion.size} seleccionado');
  });
});

describe('Alcance — cada catálogo usa SU propio estado (EPP tiene selEppBuscado, ver guardado-modular-epp-catalogo-codgrp.test.ts)', () => {
  it('consultarCatalogEpp y su modal no usan selDotBuscado (no comparten estado con Dotación)', () => {
    const bEpp = bloque('const consultarCatalogEpp=', '\n  const onChangeSelEppQ=');
    expect(bEpp).not.toContain('selDotBuscado');
    // Desde el modal de EPP hasta el final del archivo: `selDotBuscado` solo
    // vive en el modal de Dotación (que va antes) y en su estado/funciones.
    const inicioModalEpp = PAGE_TSX.indexOf('MODAL CATÁLOGO EPP');
    expect(inicioModalEpp).toBeGreaterThan(-1);
    expect(PAGE_TSX.slice(inicioModalEpp)).not.toContain('selDotBuscado');
  });
});
