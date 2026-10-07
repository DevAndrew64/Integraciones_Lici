/**
 * Ajuste "CATÁLOGO DE DOTACIÓN — FILTRO INTERNO POR CATEGORÍA" — contexto
 * de apertura explícito (sujetoKey/lineaManoObraId/cargo/cantidadTrabajadores/
 * categoriaSeleccionada), sin selector de Sexo visible, filtro defensivo
 * final sobre los registros ya devueltos por el catálogo externo. Mismo
 * patrón de verificación de TEXTO exacto del código fuente (sin
 * jsdom/RTL) ya usado en el resto de archivos de este módulo.
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

describe('1) Contexto explícito de apertura', () => {
  it('abrirCatalogoDotParaLinea fija categoriaSeleccionada=DOTACION_MASCULINA/FEMENINA según el sexo, explícitamente (nunca inferido después de abrir)', () => {
    const b = bloque('const abrirCatalogoDotParaLinea=', '\n  const abrirCatalogoEppParaLinea=');
    expect(b).toContain("categoriaSeleccionada:sexo==='F'?'DOTACION_FEMENINA':'DOTACION_MASCULINA',");
  });

  it('6) abrirCatalogoEppParaLinea fija categoriaSeleccionada=EPP explícitamente', () => {
    const b = bloque('const abrirCatalogoEppParaLinea=', '\n  // Ajuste "AJUSTAR TURNANTES POR BLOQUES DE 21 Y 42 HORAS" — cada grupo');
    expect(b).toContain("categoriaSeleccionada:'EPP',");
  });

  it('7/8) el contexto trae cargo/cantidadTrabajadores REALES de la línea de Mano de Obra, nunca de tipoServicio/cargo (variables globales — causa del bug "sin definir")', () => {
    const b = bloque('const abrirCatalogoDotParaLinea=', '\n  const abrirCatalogoEppParaLinea=');
    expect(b).toContain('cargo:linea.nombre,');
    expect(b).toContain('cantidadTrabajadores:linea.cantidadTrabajadores,');
  });

  it('8) el encabezado de ambos catálogos nunca muestra "(sin definir)" — usa catalogoDotEppContexto.cargo, con error controlado si no llega', () => {
    expect(PAGE_TSX).not.toContain("{tipoServicio||cargo||'(sin definir)'}");
    expect(PAGE_TSX).toContain('No se pudo determinar el cargo de origen.');
  });

  it('9) dos líneas distintas mantienen contextos separados — el contexto se recalcula en cada apertura, nunca se comparte entre sujetoKey', () => {
    const b = bloque('const abrirCatalogoDotParaLinea=', '\n  const abrirCatalogoEppParaLinea=');
    expect(b).toContain('sujetoKey:construirSujetoDotacionKey(linea.origen,linea.id),');
    expect(b).toContain('lineaManoObraId:linea.id,');
  });
});

describe('2) No aparece el selector de Sexo (§4)', () => {
  it('el catálogo de Dotación ya no tiene un <select> de Sexo — el sexo viene fijo por el contexto', () => {
    const b = bloque('{/* ══ MODAL CATÁLOGO DOTACIÓN', '{/* ══ MODAL CATÁLOGO EPP');
    expect(b).not.toContain('>Sexo<');
    expect(b).not.toContain('setSelDotSexo(e.target.value');
  });
});

describe('3/4/5/6) Filtro real desde la consulta + validación defensiva', () => {
  it('3/4) abrirCatalogoDotParaLinea fija selDotSexo (M/F) y siempre relanza la consulta con la categoría explícita (nunca reutiliza un catálogo cacheado de otro sexo/línea)', () => {
    const b = bloque('const abrirCatalogoDotParaLinea=', '\n  const abrirCatalogoEppParaLinea=');
    expect(b).toContain('setSelDotSexo(sexo);');
    expect(b).toContain('setSelDotCatalog([]);');
    expect(b).toContain("consultarCatalogDot(1,sexo==='F'?'DOTACION_FEMENINA':'DOTACION_MASCULINA',codgrpInicial?{codgrp:codgrpInicial}:undefined);");
  });

  // Ajuste "CHAPUZA DESAPARECE PARA VIGICOLBA" — la revalidación cliente
  // del catálogo de dotación pasó de `filtrarRegistrosPorCategoria` (por
  // nombre) a `filtrarPorPrefijoGrupoCategoria` (por codgrp): la regla
  // final de masculina/femenina es SOLO codgrp (M.../F.../vacío-en-ambas),
  // nunca el nombre — usar el filtro de nombre aquí excluiría de una
  // categoría filas sin codgrp que el nombre "sugiere" del otro sexo,
  // contradiciendo "codgrp vacío aparece en ambas, decide el usuario".
  it('el catálogo de dotación aplica filtrarPorPrefijoGrupoCategoria (por codgrp, nunca por nombre) como validación defensiva final sobre la página ya recibida, además del filtro que ya aplicó el servidor', () => {
    const b = bloque('{/* ══ MODAL CATÁLOGO DOTACIÓN', '{/* ══ MODAL CATÁLOGO EPP');
    expect(b).toContain('const filasPagina=filtrarPorPrefijoGrupoCategoria(selDotCatalog,categoria);');
  });

  it('el catálogo EPP aplica filtrarRegistrosPorCategoria con categoría EPP fija — nunca mezcla con dotación masculina/femenina', () => {
    const b = bloque('{/* ══ MODAL CATÁLOGO EPP', '{/* ══ FICHA EXTERIOR');
    expect(b).toContain("const filasPagina=filtrarRegistrosPorCategoria(selEppCatalog,'EPP');");
  });
});

describe('13) Los registros sin valor válido no pueden seleccionarse', () => {
  it('dotación: fila con sinValor deshabilita el checkbox y bloquea el click de selección', () => {
    const b = bloque('{/* ══ MODAL CATÁLOGO DOTACIÓN', '{/* ══ MODAL CATÁLOGO EPP');
    expect(b).toContain('const sinValor=!valorNum||isNaN(valorNum)||valorNum<=0;');
    expect(b).toContain('disabled={sinValor}');
    expect(b).toContain('cursor:sinValor?\'not-allowed\':\'pointer\'');
  });

  it('EPP: misma regla — sin valor vigente, no seleccionable', () => {
    const b = bloque('{/* ══ MODAL CATÁLOGO EPP', '{/* ══ FICHA EXTERIOR');
    expect(b).toContain('const sinValor=!valorNum||isNaN(valorNum)||valorNum<=0;');
    expect(b).toContain('disabled={sinValor}');
  });
});

describe('14) Los filtros (UEN/Grupo) conservan el filtro interno de categoría — Empresa ya no es un filtro editable (Ajuste "FILTRO DE EMPRESA... AUTOMÁTICO")', () => {
  it('cambiar UEN dispara una nueva consulta (página 1) pero nunca toca categoriaSeleccionada ni selDotSexo — son estados independientes; Empresa ya no tiene onChange (viene fija del proceso)', () => {
    const b = bloque('{/* ══ MODAL CATÁLOGO DOTACIÓN', '{/* ══ MODAL CATÁLOGO EPP');
    expect(b).toContain('onChange={e=>{const v=e.target.value;setSelDotUen(v);consultarCatalogDot(1,undefined,{uen:v});}}');
    expect(b).not.toContain('setSelDotSexo(e.target.value');
    expect(b).not.toContain('setSelDotEmpresa');
  });
});

describe('18) El botón "Agregar" muestra la cantidad seleccionada', () => {
  it('dotación: "Agregar N productos" o "Agregar selección" sin selección', () => {
    const b = bloque('{/* ══ MODAL CATÁLOGO DOTACIÓN', '{/* ══ MODAL CATÁLOGO EPP');
    expect(b).toContain("selDotSeleccion.size>0?`Agregar ${selDotSeleccion.size} producto${selDotSeleccion.size!==1?'s':''}`:'Agregar selección'");
  });
  it('EPP: mismo patrón', () => {
    const b = bloque('{/* ══ MODAL CATÁLOGO EPP', '{/* ══ FICHA EXTERIOR');
    expect(b).toContain("selEppSeleccion.size>0?`Agregar ${selEppSeleccion.size} producto${selEppSeleccion.size!==1?'s':''}`:'Agregar selección'");
  });
});

describe('10/11/12) La selección vuelve al grupo correcto (ya garantizado por categoria+sujetoKey en agregarSeleccionadosDot/Epp)', () => {
  it('masculina/femenina asignan categoria y sujetoKey al grupo, derivados de catalogoTargetLineaId — nunca por nombre', () => {
    const b = bloque('const agregarSeleccionadosDot=', '\n  const [duplicandoMujer');
    // Ajuste "SERVICIOS NO CONTINUOS — REUTILIZACIÓN REAL DE CATÁLOGOS" —
    // `lineasManoObraDisponiblesEfectivas` sustituye la lectura directa
    // de `lineasManoObraDisponibles` (== la lista global cuando el modal
    // NO está destinado a un servicio, comportamiento histórico intacto).
    expect(b).toContain('const lineaDestino=lineasManoObraDisponiblesEfectivas.find(l=>l.id===catalogoTargetLineaId);');
    expect(b).toContain('const sujetoKey=lineaDestino?construirSujetoDotacionKey(lineaDestino.origen,lineaDestino.id):undefined;');
  });
  it('EPP asigna categoria:\'EPP\' explícito, nunca masculino/femenino', () => {
    const b = bloque('const agregarSeleccionadosEpp=', '\n    const IVA_DOTACION');
    expect(b).toContain("categoria:'EPP',sujetoKey");
  });
});
