/**
 * Ajuste "EL CATÁLOGO SE CONSULTA POR EMPRESA, SIN FILTRAR POR UBICACIÓN"
 * (decisión funcional final) — el modal "Seleccionar maquinaria y equipos"
 * no exige Grupo/Subtipo/Ubicación como filtros visibles: el usuario solo
 * ve Empresa + Buscar equipo.
 *
 * Ajuste "NUEVA API DE MAQUINARIA Y EQUIPOS — BÚSQUEDA DIRECTA" (ronda
 * posterior) — el backend YA NO recorre grupo_activo→subtipo_activo→
 * equipos/obtener (`equipos-activos-cache.ts`, conservado sin tocar pero
 * sin consumidor en este flujo): consulta directamente `equipos/obtener`
 * con `{empresa,descripcion}` (`@/lib/equipos-activos-buscar`). El
 * precalentado en background del catálogo completo dejó de tener sentido
 * (ya no hay catálogo completo que precalentar) y se retiró.
 *
 * No existe arnés de render de componentes para page.tsx — mismo patrón de
 * verificación de TEXTO exacto del código fuente ya usado en el resto de
 * *-page.test.ts.
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

const BLOQUE_MODAL_SELECTOR = bloque(
  '{showSelMaq&&(()=>{',
  '\n            {/* ══ MODAL "Agregar equipo manual" ══ */}',
);

describe('Modal "Seleccionar maquinaria y equipos" — solo Empresa + Buscar equipo, sin Ubicación/Grupo/Subtipo como filtros', () => {
  it('la barra de filtros ya no tiene un <select> de Ubicación (ni de Grupo/Subtipo, que nunca existió)', () => {
    expect(BLOQUE_MODAL_SELECTOR).not.toContain("<select value={selMaqUen}");
    expect(BLOQUE_MODAL_SELECTOR).not.toMatch(/<div[^>]*>Grupo<\/div>/);
    expect(BLOQUE_MODAL_SELECTOR).not.toMatch(/<div[^>]*>Subtipo<\/div>/);
  });

  it('Empresa y Buscar equipo siguen presentes, con los controles Consultar/Limpiar búsqueda', () => {
    expect(BLOQUE_MODAL_SELECTOR).toContain("<select value={selMaqEmpresa}");
    expect(BLOQUE_MODAL_SELECTOR).toContain('Buscar equipo');
    expect(BLOQUE_MODAL_SELECTOR).toContain('Limpiar búsqueda');
  });

  it('consultarCatalogMaq nunca envía `uen` al backend', () => {
    const b = bloque('const consultarCatalogMaq=async(', 'const onChangeSelMaqEmpresa=');
    expect(b).not.toContain('uen:');
    expect(b).toContain("const body={empresa:empresaActual,q:(filtrosOverride?.q??selMaqQ).trim()||undefined,page:pagina,limit:SEL_MAQ_LIMIT};");
  });

  // Ajuste "INTEGRACIÓN DE DOS ENDPOINTS — CATÁLOGO + DISPONIBILIDAD" —
  // esta tabla pasó a ser el CATÁLOGO puro (equipos/obtener_recientes):
  // TIPO/SUBTIPO/NOMBRE/FECHA ADQ./VALOR, sin Ubicación (que ahora es
  // información de DISPONIBILIDAD, cruzada por equipo — visible recién en
  // el listado de Maquinaria y Equipos tras agregar la selección).
  it('la tabla de resultados es el catálogo (TIPO/SUBTIPO/NOMBRE/FECHA ADQ./VALOR), sin columna de Ubicación', () => {
    expect(BLOQUE_MODAL_SELECTOR).toContain('>TIPO</th>');
    expect(BLOQUE_MODAL_SELECTOR).toContain('>SUBTIPO</th>');
    expect(BLOQUE_MODAL_SELECTOR).toContain('>NOMBRE</th>');
    expect(BLOQUE_MODAL_SELECTOR).toContain('>FECHA ADQ.</th>');
    expect(BLOQUE_MODAL_SELECTOR).toContain('>VALOR</th>');
    expect(BLOQUE_MODAL_SELECTOR).not.toContain('>UBICACIÓN</th>');
  });

  it('abrir el selector NUNCA dispara una consulta automática (la fuente exige descripción real) — el catálogo queda vacío hasta "Consultar"', () => {
    const b = bloque('const abrirSelectorMaquinaria=(', 'const cerrarSelectorMaquinaria=');
    expect(b).not.toContain('consultarCatalogMaq');
    expect(b).toContain('setSelMaqCatalog([])');
  });

  it('cambiar Empresa limpia búsqueda/selección (nunca mezcla catálogos de dos empresas)', () => {
    const b = bloque('const onChangeSelMaqEmpresa=(', 'const onChangeSelMaqQ=');
    expect(b).toContain('setSelMaqCatalog([]);setSelMaqSeleccion(new Map());');
    expect(b).toContain("consultarCatalogMaq(1,{empresaCodigo:EMPRESA_EXTERNA[empresaLabel]||'aseo'});");
  });

  it('"Limpiar búsqueda" solo vacía el texto de búsqueda, nunca toca Empresa', () => {
    const b = bloque('const limpiarFiltrosCatalogoMaq=async()=>{', '};');
    expect(b).toContain("setSelMaqQ('');");
    expect(b).not.toContain('setSelMaqEmpresa');
    expect(b).toContain("await consultarCatalogMaq(1,{q:''});");
  });

  it('mientras carga (selMaqCarg), el contador nunca muestra "0 resultados" como si la consulta ya hubiera terminado', () => {
    expect(BLOQUE_MODAL_SELECTOR).toContain("{selMaqCarg?'Cargando resultados…':");
  });

  it('el mensaje de "sin resultados" distingue "todavía no se ha buscado" de "no hay coincidencias"', () => {
    expect(BLOQUE_MODAL_SELECTOR).toContain('Escribe una descripción');
    expect(BLOQUE_MODAL_SELECTOR).toContain('No se encontraron equipos para');
  });

  it('el contador de resultados usa el TOTAL real del backend (nunca solo el tamaño de la página actual)', () => {
    expect(BLOQUE_MODAL_SELECTOR).toContain('${selMaqTotal} resultado${selMaqTotal!==1?\'s\':\'\'}');
    expect(BLOQUE_MODAL_SELECTOR).toContain('Página {selMaqPage} de {selMaqTotalPages}');
  });

  it('la selección múltiple (selMaqSeleccion) es independiente de selMaqCatalog — cambiar de búsqueda solo reemplaza los resultados visibles, nunca la selección acumulada', () => {
    const bQ = bloque('const onChangeSelMaqQ=(v:string)=>{', 'const onEnterSelMaqQ=');
    expect(bQ).not.toContain('setSelMaqSeleccion');
  });
});

// Ajuste "IDENTIFICADOR ÚNICO — DOS FILAS CON LA MISMA KEY" — bug real
// reportado por React en consola: dos activos físicos distintos (mismo
// grupo+subtipo+nombre, ej. dos motosierras del mismo modelo) compartían
// clave, lo que además de la advertencia visual hacía que seleccionar uno
// seleccionara ambos (mismo Map key en selMaqSeleccion).
//
// Ajuste "INTEGRACIÓN DE DOS ENDPOINTS — CATÁLOGO + DISPONIBILIDAD" — el
// catálogo (equipos/obtener_recientes) ya trae una fila por equipo
// distinto (nunca repetida por UEN — eso vive en `disponibilidadPorUen`,
// agregado en el backend), así que la clave vuelve a NO necesitar `uen`.
describe('codigoFilaMaq — clave única incluso cuando dos equipos comparten codGrupo+codSubtipo+nombre', () => {
  it('incluye fechaAdquisicion y valor en la clave (nunca solo codGrupo+codSubtipo+nombre)', () => {
    const b = bloque("const codigoFilaMaq=(r:Record<string,unknown>)=>", '\n\n  const consultarCatalogMaq=');
    expect(b).toContain('r.fechaAdquisicion');
    expect(b).toContain('r.valor');
  });
});

describe('Backend /api/equipos-activos — búsqueda directa (empresa+descripción), nunca recorrido de grupo/subtipo', () => {
  it('exige descripción real (mínimo 2 caracteres) antes de llamar a la fuente externa — nunca un recorrido/consulta automática', () => {
    const routeTs = readFileSync(join(__dirname, '../../app/api/equipos-activos/route.ts'), 'utf-8');
    expect(routeTs).toContain('q.length < 2');
    expect(routeTs).toContain('buscarEquiposActivos(empresa, q)');
  });
});
