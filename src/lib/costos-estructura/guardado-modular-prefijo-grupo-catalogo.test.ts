/**
 * Ajuste "CORREGIR FILTRO DE CÓDIGO DE GRUPO PARA DOTACIÓN MASCULINA" —
 * verificación de cableado en page.tsx (texto fuente, mismo patrón que el
 * resto de guardado-modular-*.test.ts). La lógica pura (prefijo M/F,
 * validación) ya está cubierta en catalogo-dotacion-filtro.test.ts y
 * src/app/api/dotacion-ext/route.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');

describe('Catálogo de Dotación — placeholder y validación por prefijo de grupo', () => {
  it('2) el placeholder del campo Cód. grupo es dinámico según la categoría (nunca F001 fijo)', () => {
    expect(PAGE_TSX).toContain("placeholder={`Ej. ${resolverPrefijoGrupoObligatorio(catalogoDotEppContexto?.categoriaSeleccionada??'EPP')??'M'}013`}");
    expect(PAGE_TSX).not.toContain('placeholder="F001"');
  });

  it('9) el onBlur/Enter del campo pasan por la validación central (nunca ejecutan la consulta directo)', () => {
    expect(PAGE_TSX).toContain('onBlur={consultarCatalogDotConCodgrpValidado}');
    expect(PAGE_TSX).toContain("onKeyDown={e=>{if(e.key==='Enter')consultarCatalogDotConCodgrpValidado();}}");
  });

  it('6) un código inválido para la categoría activa bloquea la consulta y muestra el mensaje, nunca la corrige en silencio', () => {
    expect(PAGE_TSX).toContain('const validacion=validarCodigoGrupoParaCategoria(selDotCodgrp,categoriaActiva);');
    expect(PAGE_TSX).toContain("if(!validacion.ok){setSelDotErr(validacion.mensaje??'Código de grupo inválido para esta categoría.');return;}");
  });

  it('importa las funciones puras del prefijo desde el módulo compartido (nunca reimplementa la regla en el JSX)', () => {
    expect(PAGE_TSX).toContain("import { filtrarRegistrosPorCategoria, validarCodigoGrupoParaCategoria, resolverPrefijoGrupoObligatorio } from '@/lib/costos-mano-obra/motor-distribuido/catalogo-dotacion-filtro';");
  });
});
