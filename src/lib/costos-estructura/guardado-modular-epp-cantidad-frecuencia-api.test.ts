/**
 * Ajuste "CANTIDAD Y FRECUENCIA DE EPP DESDE LA API" — cableado en page.tsx
 * (mismo estilo de guardia por código fuente que el resto de
 * guardado-modular-*.test.ts). La regla de negocio en sí está probada en
 * `catalogo-epp-cantidad-frecuencia.test.ts` y la ruta en `epp-ext/route.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');

function bloque(inicio: string, fin: string): string {
  const i = PAGE_TSX.indexOf(inicio);
  expect(i, `no se encontró "${inicio}"`).toBeGreaterThanOrEqual(0);
  const j = PAGE_TSX.indexOf(fin, i);
  expect(j, `no se encontró "${fin}" después de "${inicio}"`).toBeGreaterThan(i);
  return PAGE_TSX.slice(i, j);
}

describe('selector de EPP', () => {
  it('pide al servidor la resolución de cantidad/frecuencia (solo el selector, no la tabla genérica de Equipos)', () => {
    const b = bloque('const consultarCatalogEpp=', 'const toggleSelEpp=');
    expect(b).toContain('resolverCantidadFrecuencia:true');
    // La pestaña Equipos > EPP sigue pidiendo lo de siempre.
    expect(PAGE_TSX).toContain("body:JSON.stringify({empresa:epEmpresa,uen:epUen})");
  });

  it('agregarSeleccionadosEpp toma cant/frec de cantidadFrecuenciaInicialEpp — ya no las fija en 1/1', () => {
    const b = bloque('const agregarSeleccionadosEpp=', '\n    const IVA_DOTACION');
    expect(b).toContain('...cantidadFrecuenciaInicialEpp(r)');
    expect(b).not.toContain('cant:1,frec:1');
  });

  it('Dotación NO cambia: sus filas de catálogo siguen naciendo con cant:1,frec:1', () => {
    expect(PAGE_TSX.split("cant:1,frec:1,vUnit,section:'dot' as const,origen:'catalogo'").length - 1).toBeGreaterThanOrEqual(2);
  });
});

describe('fila del modal Dotación y EPP (filaSoloLectura)', () => {
  const fila = () => bloque('const filaSoloLectura=', '\n    // Mini-tarjeta de UNA categoría');

  it('deshabilita Cantidad y Frecuencia solo cuando el campo vino de la API', () => {
    const b = fila();
    expect(b).toContain("const cantBloqueada=campoBloqueadoPorApi(r,'cant');");
    expect(b).toContain("const frecBloqueada=campoBloqueadoPorApi(r,'frec');");
    expect(b).toContain('disabled={cantBloqueada}');
    expect(b).toContain('disabled={frecBloqueada}');
  });

  it('muestra el aviso "no definido / varía" solo a quien puede editar, con el texto del módulo', () => {
    const b = fila();
    expect(b).toContain('const avisoManualApi=mensajeCantidadFrecuenciaManual(r);');
    expect(b).toContain('puedeEditarCostosUI&&avisoManualApi&&');
    expect(b).toContain('{avisoManualApi}');
  });

  it('el tooltip del campo bloqueado nombra el grupo de EPP del que salió el valor', () => {
    const b = fila();
    expect(b).toContain("const tituloBloqueadoApi=`Valor del catálogo${r.codigoGrupo?` para el grupo ${r.codigoGrupo}`:''}: no se puede modificar`;");
    expect(b).toContain('title={cantBloqueada?tituloBloqueadoApi:undefined}');
    expect(b).toContain('title={frecBloqueada?tituloBloqueadoApi:undefined}');
  });

  it('los campos no bloqueados siguen editando con updCargoRow como siempre', () => {
    const b = fila();
    expect(b).toContain("r.id,'cant',e.target.value)");
    expect(b).toContain("r.id,'frec',e.target.value)");
  });
});

describe('updCargoRow', () => {
  it('nunca sobrescribe un campo que vino de la API (defensa además del input deshabilitado)', () => {
    const b = bloque('const updCargoRow=', 'const updCargoNombre=');
    expect(b).toContain('r.id===rid&&!campoBloqueadoPorApi(r,k)');
  });
});

describe('traer EPP por código de grupo (mismo patrón que Dotación)', () => {
  const fn = () => bloque('const traerProductosPorGrupoEpp=async(', '\n  };');

  it('sin empresa reconocible no consulta el catálogo (igual que Dotación)', () => {
    expect(fn()).toContain("if(!selEppEmpresa){alert('Este proceso no tiene una empresa/perfil asociado. No es posible consultar el catálogo de EPP.');return;}");
  });

  it('valida el formato del código antes de consultar', () => {
    const b = fn();
    expect(b).toContain('validarCodigoGrupoEpp(codigoGrupoEscrito)');
    expect(b.indexOf('validarCodigoGrupoEpp(')).toBeLessThan(b.indexOf("fetch('/api/epp-ext'"));
  });

  it('consulta /api/epp-ext (misma fuente que "Seleccionar EPP") por codgrp y pide la resolución de cantidad/frecuencia', () => {
    const b = fn();
    expect(b).toContain("fetch('/api/epp-ext'");
    expect(b).toContain('codgrp:codigoGrupo');
    expect(b).toContain('resolverCantidadFrecuencia:true');
  });

  it('arma las filas con filasEppDesdeGrupo y no duplica los productos que la línea ya tenía', () => {
    const b = fn();
    expect(b).toContain('filasEppDesdeGrupo(items,codigoGrupo,existentes)');
    expect(b).toContain("g.tipo==='epp'&&g.lineaManoObraId===lineaId");
  });

  it("el bloque de EPP recibe categoriaGrupo 'epp' y su campo llama a traerProductosPorGrupoEpp", () => {
    const tarjeta = bloque('const tarjetaCargo=', '\n    return(\n      <div style={{position:\'fixed\'');
    expect(tarjeta).toContain("()=>abrirModalManualDot(linea.id,'EPP'),undefined,'epp',");
    const b = bloque('const bloqueCategoria=', '\n    const tarjetaCargo=');
    expect(b).toContain("if(categoriaGrupo==='epp')traerProductosPorGrupoEpp(lineaId,codigo);");
    expect(b).toContain('else if(categoriaGrupo)traerProductosPorGrupoDot(lineaId,categoriaGrupo,codigo);');
    expect(b).toContain("categoriaGrupo==='epp'?'Ej. EP001'");
  });

  it('la columna Grupo se muestra también en EPP, en solo lectura (sin onEditarGrupo); Dotación sigue editable', () => {
    const b = bloque('const bloqueCategoria=', '\n    const tarjetaCargo=');
    expect(b).toContain('const mostrarGrupo=true;');
    const f = bloque('const filaSoloLectura=', '\n    // Mini-tarjeta de UNA categoría');
    expect(f).toContain('puedeEditarCostosUI&&onEditarGrupo?(');
    // Dotación pasa su handler de renombrado; EPP pasa undefined.
    const tarjeta = bloque('const tarjetaCargo=', '\n    return(\n      <div style={{position:\'fixed\'');
    expect(tarjeta).toContain("renombrarGrupoDot(linea.id,'masculina',codigoAnterior,codigoNuevo)");
  });
});
