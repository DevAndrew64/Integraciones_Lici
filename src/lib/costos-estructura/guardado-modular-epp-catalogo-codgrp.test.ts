/**
 * Ajuste "CÓDIGO DE GRUPO EN EL SELECTOR DE EPP" — el modal "Seleccionar EPP"
 * ya NO carga todo el catálogo al abrir: pide nombre, código de producto o
 * código de grupo (EP001…), igual que el selector de Dotación (ver
 * guardado-modular-catalogo-sin-consulta-inicial.test.ts). Guardas por código
 * fuente sobre page.tsx; la lógica de la ruta está en epp-ext/route.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');

function bloque(inicio: string, fin: string, desde = 0): string {
  const i = PAGE_TSX.indexOf(inicio, desde);
  expect(i, `no se encontró "${inicio}"`).toBeGreaterThanOrEqual(0);
  const j = PAGE_TSX.indexOf(fin, i);
  expect(j, `no se encontró "${fin}" después de "${inicio}"`).toBeGreaterThan(i);
  return PAGE_TSX.slice(i, j);
}

const CONSULTA = () => bloque('const consultarCatalogEpp=async(', '\n  };');
// Del inicio del modal de EPP hasta su último botón ("Agregar selección"), sin arrastrar código ajeno.
const MODAL = () => {
  const i = PAGE_TSX.indexOf('{showSelEpp&&(()=>{');
  expect(i).toBeGreaterThan(-1);
  const finMarca = "'Agregar selección'}</button>";
  const j = PAGE_TSX.indexOf(finMarca, i);
  expect(j, 'no se encontró el último botón del modal de EPP').toBeGreaterThan(i);
  return PAGE_TSX.slice(i, j + finMarca.length);
};

describe('consultarCatalogEpp — único punto de control', () => {
  it('sin texto de búsqueda ni código de grupo NO llama a la API: cancela lo que esté en vuelo y vuelve a "sin búsqueda"', () => {
    const b = CONSULTA();
    expect(b).toContain("const qEfectivo=(filtrosOverride?.q??selEppQ).trim();");
    expect(b).toContain("const codgrpEfectivo=(filtrosOverride?.codgrp??selEppCodgrp).trim();");
    const guarda = b.indexOf('if(!qEfectivo&&!codgrpEfectivo){');
    expect(guarda).toBeGreaterThan(-1);
    expect(guarda).toBeLessThan(b.indexOf("fetch('/api/epp-ext'"));
    const cuerpoGuarda = b.slice(guarda, b.indexOf('return;', guarda));
    expect(cuerpoGuarda).toContain('selEppAbortRef.current?.abort()');
    expect(cuerpoGuarda).toContain('setSelEppBuscado(false)');
    expect(cuerpoGuarda).toContain('setSelEppCatalog([])');
  });

  it('con criterio marca "buscado" y envía el código de grupo a /api/epp-ext (junto con la resolución de cantidad/frecuencia)', () => {
    const b = CONSULTA();
    expect(b).toContain('setSelEppBuscado(true)');
    expect(b).toContain('q:qEfectivo||undefined,codgrp:codgrpEfectivo||undefined');
    expect(b).toContain('resolverCantidadFrecuencia:true');
  });

  it('el override acepta codgrp (para "Limpiar filtros") y sigue sin aceptar empresa', () => {
    const firma = PAGE_TSX.slice(PAGE_TSX.indexOf('const consultarCatalogEpp=async('), PAGE_TSX.indexOf('=>{', PAGE_TSX.indexOf('const consultarCatalogEpp=async(')));
    expect(firma).toContain('codgrp?:string');
    expect(firma).not.toContain('empresa?:string');
  });
});

describe('código de grupo — validación y disparadores', () => {
  it('un código mal escrito (p. ej. M001 de Dotación) bloquea la consulta y muestra el motivo; vacío no filtra', () => {
    const b = bloque('const consultarCatalogEppConCodgrpValidado=()=>{', '\n  };');
    expect(b).toContain('validarCodigoGrupoEpp(codigo)');
    expect(b).toContain('setSelEppErr(validacion.mensaje);return;');
    expect(b).toContain('consultarCatalogEpp(1);');
    expect(b.indexOf('validarCodigoGrupoEpp(')).toBeLessThan(b.indexOf('consultarCatalogEpp(1);'));
  });

  it('Enter en el buscador y el botón Consultar pasan por la misma validación', () => {
    const b = bloque('const onEnterSelEppQ=()=>{', '\n  };');
    expect(b).toContain('consultarCatalogEppConCodgrpValidado()');
  });

  it('hayFiltrosActivosEpp cuenta el código de grupo (habilita "Limpiar filtros")', () => {
    expect(PAGE_TSX).toContain("const hayFiltrosActivosEpp=selEppQ.trim()!==''||selEppUen!==UEN_INICIAL_CATALOGO_EPP||selEppCodgrp.trim()!=='';");
  });
});

describe('modal "Seleccionar EPP"', () => {
  it('tiene el campo "Cód. grupo" (Ej. EP001) que consulta al salir del campo y con Enter', () => {
    const b = MODAL();
    expect(b).toContain('Cód. grupo');
    expect(b).toContain('value={selEppCodgrp} onChange={e=>setSelEppCodgrp(e.target.value)} onBlur={consultarCatalogEppConCodgrpValidado}');
    expect(b).toContain("if(e.key==='Enter')consultarCatalogEppConCodgrpValidado();");
    expect(b).toContain('placeholder="Ej. EP001"');
  });

  it('antes de buscar muestra el mensaje informativo y NO el "sin resultados"; este último exige haber buscado', () => {
    const b = MODAL();
    expect(b).toContain('{!selEppBuscado&&!selEppCarg&&(');
    expect(b).toContain('Busca un producto para ver el catálogo');
    expect(b).toContain('<b>código del grupo</b> (ej. EP001)');
    expect(b).toContain('{selEppBuscado&&selEppCatalog.length===0&&!selEppCarg&&!selEppErr&&(');
    expect(b.indexOf('{!selEppBuscado&&!selEppCarg&&(')).toBeLessThan(b.indexOf('{selEppBuscado&&selEppCatalog.length===0'));
  });

  it('el pie dice "Sin búsqueda" antes de buscar y nombra el grupo cuando se filtró por uno; conserva el contador de seleccionados', () => {
    const b = MODAL();
    expect(b).toContain("{selEppBuscado?(selEppCodgrp.trim()?<>{selEppTotal} producto");
    expect(b).toContain('del grupo {selEppCodgrp.trim().toUpperCase()}');
    expect(b).toContain(":'Sin búsqueda'}");
    expect(b).toContain('{selEppSeleccion.size} seleccionado');
  });

  it('el buscador de texto conserva su placeholder original (el grupo tiene su propio campo)', () => {
    expect(MODAL()).toContain('placeholder="Buscar por código o nombre del producto"');
  });
});

describe('estado — se reinicia al abrir, cerrar y agregar', () => {
  it('cerrar el modal y agregar la selección limpian código de grupo y "buscado"', () => {
    const cerrar = MODAL().slice(MODAL().indexOf('const cerrar=()=>{'));
    expect(cerrar.slice(0, 400)).toContain("setSelEppCodgrp('');setSelEppBuscado(false)");
    const agregar = bloque('const agregarSeleccionadosEpp=', '\n    const IVA_DOTACION');
    expect(agregar).toContain("setSelEppCodgrp('');setSelEppBuscado(false)");
  });

  it('los DOS puntos de apertura (cargo y servicio no continuo) parten de "sin búsqueda"', () => {
    const aperturas = PAGE_TSX.split("setSelEppQ('');setSelEppCodgrp('');setSelEppBuscado(false);\n    setShowSelEpp(true);").length - 1;
    expect(aperturas).toBe(2);
  });

  it('"Limpiar filtros" limpia también el código de grupo', () => {
    const b = bloque('const limpiarFiltrosCatalogoEpp=async()=>{', '\n  };');
    expect(b).toContain('setSelEppCodgrp(filtrosLimpios.codgrp)');
  });
});

describe('aislamiento — EPP no comparte estado con Dotación', () => {
  it('ni la consulta ni el modal de EPP leen selDotCodgrp/selDotBuscado', () => {
    expect(CONSULTA()).not.toMatch(/selDot(Codgrp|Buscado)/);
    expect(MODAL()).not.toMatch(/selDot(Codgrp|Buscado)/);
  });
});
