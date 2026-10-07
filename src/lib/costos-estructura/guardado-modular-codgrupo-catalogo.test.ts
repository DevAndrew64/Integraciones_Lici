/**
 * Ajuste "TABLA — MOSTRAR CÓD. GRUPO COMO COLUMNA PRINCIPAL" — verificación
 * de cableado en page.tsx (texto fuente, mismo patrón que el resto de
 * guardado-modular-*.test.ts). El comportamiento del pipeline server-side
 * (filtro/dedup/consolidación/paginación reales) ya está cubierto por
 * src/app/api/dotacion-ext/route.test.ts y src/app/api/epp-ext/route.test.ts
 * — `codgrp`/`codgrps` es un campo más de la fila y viaja intacto por ese
 * pipeline sin necesitar lógica nueva (nunca se reconstruyen los objetos
 * campo por campo en NIVEL 1/NIVEL 2, ver catalogo-dotacion-dedup.ts/
 * normalizador-catalogo.ts).
 *
 * Diagnóstico real (2026-08-02, 12.645 filas Dotación aseo/BAQ): el campo
 * real es `codgrp` (100% de las filas de Dotación lo traen), y es una
 * clasificación ADMINISTRATIVA de orden de compra, NO parte de la
 * identidad comercial: 487/693 códigos únicos (NIVEL 1) tienen más de un
 * `codgrp` distinto entre sus filas históricas (un mismo código de
 * producto aparece bajo decenas de códigos de grupo distintos según en
 * qué compra se registró) — por eso el CÓD. GRUPO mostrado debe ser
 * SIEMPRE el de la fila ganadora ya resuelta (NIVEL 1 → NIVEL 2), y el
 * filtro por código de grupo debe aplicarse ANTES de esa consolidación
 * (§3 del ajuste, ya era el orden existente en route.ts).
 *
 * Corrección de seguimiento (2026-08-03) — EPP SÍ tiene un campo
 * equivalente, `codgrps` (plural, en la fuente real de la API externa),
 * inicialmente descartado por medirse vacío (`codgrps:[]`) en 72/72 filas
 * de una sola combinación empresa/UEN; una verificación en vivo contra
 * TODAS las combinaciones empresa/UEN confirma que el campo SÍ puede
 * traer valores (ej. aseo/BAQ tiene productos con `codgrps:["F224"]") —
 * la columna y su captura (`codGrupoTextoEpp`) se restauran en la tabla de
 * EPP, leyendo `codgrps` (además de los alias de Dotación, por si la
 * fuente alguna vez unifica el nombre del campo).
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

describe('1/2) CÓD. GRUPO aparece después del checkbox y antes de CÓDIGO — en Dotación (masculina/femenina) y en EPP', () => {
  it('tabla de Dotación (masculina/femenina, mismo modal parametrizado por categoría)', () => {
    const b = bloque("<th style={{width:36,padding:'8px 10px',textAlign:'center' as const}}><input type=\"checkbox\" checked={allChk} onChange={toggleAllSelDotPagina}", 'ÚLT. COMPRA');
    const idxCodGrupo = b.indexOf('CÓD. GRUPO');
    const idxCodigo = b.indexOf('>CÓDIGO<');
    expect(idxCodGrupo).toBeGreaterThan(-1);
    expect(idxCodigo).toBeGreaterThan(idxCodGrupo);
  });

  it('tabla de EPP (restaurada 2026-08-03 — la fuente SÍ trae el campo, `codgrps`)', () => {
    const b = bloque("<th style={{width:36,padding:'8px 10px',textAlign:'center' as const}}><input type=\"checkbox\" checked={allChk} onChange={toggleAllSelEppPagina}", 'MEDIDA');
    const idxCodGrupo = b.indexOf('CÓD. GRUPO');
    const idxCodigo = b.indexOf('>CÓDIGO<');
    expect(idxCodGrupo).toBeGreaterThan(-1);
    expect(idxCodigo).toBeGreaterThan(idxCodGrupo);
  });
});

describe('1) el origen del dato es el campo real de la API (codgrp/codgrps), nunca un valor fijo', () => {
  it('Dotación usa pickEpp con los alias reales, nunca escribe "F001" fijo en el JSX', () => {
    const ocurrencias = (PAGE_TSX.match(/pickEpp\(r,'codgrp','codigogrupo','codgrupo','grupo','grupocodigo','coddot'\)/g) ?? []).length;
    expect(ocurrencias).toBeGreaterThanOrEqual(1); // tabla Dotación (+ agregarSeleccionadosDot)
    expect(PAGE_TSX).not.toContain("codGrupoTexto??'F001'");
  });

  it('EPP usa pickEpp con `codgrps` primero en la lista de alias (campo real confirmado en vivo), y `coddot` como último alias (campo real observado en la API de EPP)', () => {
    const ocurrencias = (PAGE_TSX.match(/pickEpp\(r,'codgrps','codgrp','codigogrupo','codgrupo','grupo','grupocodigo','coddot'\)/g) ?? []).length;
    expect(ocurrencias).toBe(2); // tabla EPP + agregarSeleccionadosEpp
    expect(PAGE_TSX).not.toContain("codGrupoTextoEpp??'F001'");
  });
});

describe('6/8) valores faltantes muestran "Sin grupo" (nunca vacío ni inventado) y el producto seleccionado conserva codigoGrupo', () => {
  it('la celda de CÓD. GRUPO de Dotación cae a "Sin grupo" cuando el campo no existe', () => {
    const ocurrencias = (PAGE_TSX.match(/codGrupoTexto\?String\(codGrupoTexto\):'Sin grupo'/g) ?? []).length;
    expect(ocurrencias).toBe(1);
  });

  it('la celda de CÓD. GRUPO de EPP cae a "Sin grupo" cuando el array `codgrps` viene vacío', () => {
    const ocurrencias = (PAGE_TSX.match(/codGrupoTextoEpp\?String\(codGrupoTextoEpp\):'Sin grupo'/g) ?? []).length;
    expect(ocurrencias).toBe(1);
  });

  it('DotItemRow tiene codigoGrupo opcional y ambas funciones de agregar selección lo capturan desde la fila ganadora', () => {
    // Ajuste "SERVICIOS NO CONTINUOS — REUTILIZACIÓN REAL DE CATÁLOGOS" —
    // `DotItemRow` ya no se declara en page.tsx: se movió (fuente única)
    // a dotacion-epp-tipo.ts, importado desde ahí por page.tsx.
    const tiposLib = readFileSync(join(__dirname, '../costos-mano-obra/motor-distribuido/dotacion-epp-tipo.ts'), 'utf-8');
    expect(tiposLib).toContain('codigoGrupo?: string;');
    expect(tiposLib).toContain('fechaUltimaCompra?: string;');
    const ocurrencias = (PAGE_TSX.match(/codigoGrupo:codigoGrupo!==undefined\?String\(codigoGrupo\):undefined/g) ?? []).length;
    expect(ocurrencias).toBe(2); // agregarSeleccionadosDot + agregarSeleccionadosEpp — ambos capturan el valor real, incluida EPP ahora
  });
});

describe('4) diseño compacto — ancho 110px para CÓD. GRUPO y CÓDIGO, tipografía monoespaciada', () => {
  it('la columna usa 110px en Dotación y en EPP, con fontFamily monospace en ambas celdas', () => {
    const ocurrenciasHeader = (PAGE_TSX.match(/width:110,padding:'8px 12px',textAlign:'left' as const,fontWeight:700,fontSize:11,letterSpacing:'\.05em',color:'#53657f'\}\}>CÓD\. GRUPO<\/th>/g) ?? []).length;
    // Ajuste "QUITAR COLUMNA SIN DATOS" — Insumos SÍ traía el campo en la
    // fuente (coddot), pero en la práctica todas las filas mostraban "Sin
    // grupo" (columna sin valor real para el usuario) — retirada solo de
    // Insumos, a pedido explícito, sin tocar Dotación/EPP.
    expect(ocurrenciasHeader).toBe(2); // Dotación + EPP
    const ocurrenciasFontMonoDot = (PAGE_TSX.match(/fontFamily:'monospace',color:codGrupoTexto\?'#374151':'#9ca3af'/g) ?? []).length;
    expect(ocurrenciasFontMonoDot).toBe(1);
    const ocurrenciasFontMonoEpp = (PAGE_TSX.match(/fontFamily:'monospace',color:codGrupoTextoEpp\?'#374151':'#9ca3af'/g) ?? []).length;
    expect(ocurrenciasFontMonoEpp).toBe(1);
  });
});
