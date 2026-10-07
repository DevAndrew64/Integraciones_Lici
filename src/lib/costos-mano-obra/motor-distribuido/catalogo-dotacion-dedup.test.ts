import { describe, expect, it } from 'vitest';
import { seleccionarUltimaCompraPorProducto, paginar } from './catalogo-dotacion-dedup';

describe('seleccionarUltimaCompraPorProducto', () => {
  it('1) selecciona una sola fila por código de producto', () => {
    const registros = [
      { codigo: '06005', valor: 20000, fecha_ultima_compra: '2026-01-15' },
      { codigo: '06005', valor: 29750, fecha_ultima_compra: '2026-04-19' },
      { codigo: '06005', valor: 35000, fecha_ultima_compra: null },
    ];
    const r = seleccionarUltimaCompraPorProducto(registros);
    expect(r.totalProductosUnicos).toBe(1);
  });

  it('2) elige la fila COMPLETA de la fecha más reciente — nunca combina MAX(fecha) con MAX(valor) de filas distintas', () => {
    const registros = [
      { codigo: '06005', valor: 20000, fecha_ultima_compra: '2026-01-15' },
      { codigo: '06005', valor: 29750, fecha_ultima_compra: '2026-04-19' },
      { codigo: '06005', valor: 35000, fecha_ultima_compra: null },
    ];
    const r = seleccionarUltimaCompraPorProducto(registros);
    expect(r.productos[0].valor).toBe(29750);
    expect(r.productos[0].fecha_ultima_compra).toBe('2026-04-19');
  });

  it('fecha válida siempre gana sobre fecha nula, sin importar el valor', () => {
    const registros = [
      { codigo: 'X', valor: 100, fecha_ultima_compra: null },
      { codigo: 'X', valor: 50, fecha_ultima_compra: '2020-01-01' },
    ];
    const r = seleccionarUltimaCompraPorProducto(registros);
    expect(r.productos[0].valor).toBe(50);
  });

  it('3) desempate: misma fecha exacta, prefiere el registro con valor válido', () => {
    const registros = [
      { codigo: 'Y', valor: 0, fecha_ultima_compra: '2026-01-01' },
      { codigo: 'Y', valor: 15000, fecha_ultima_compra: '2026-01-01' },
    ];
    const r = seleccionarUltimaCompraPorProducto(registros);
    expect(r.productos[0].valor).toBe(15000);
  });

  it('4) sin fecha en ningún registro: selecciona uno solo, prefiriendo valor válido', () => {
    const registros = [
      { codigo: 'Z', valor: 0, fecha_ultima_compra: null },
      { codigo: 'Z', valor: 8000, fecha_ultima_compra: null },
    ];
    const r = seleccionarUltimaCompraPorProducto(registros);
    expect(r.totalProductosUnicos).toBe(1);
    expect(r.productos[0].valor).toBe(8000);
  });

  it('desempate final estable: sin fecha y ambos con/sin valor igual, conserva el primero visto (determinístico)', () => {
    const registros = [
      { codigo: 'W', valor: 100, fecha_ultima_compra: null, marca: 'primero' },
      { codigo: 'W', valor: 200, fecha_ultima_compra: null, marca: 'segundo' },
    ];
    const r1 = seleccionarUltimaCompraPorProducto(registros);
    const r2 = seleccionarUltimaCompraPorProducto(registros);
    expect(r1.productos[0].marca).toBe(r2.productos[0].marca);
    expect(r1.productos[0].marca).toBe('primero');
  });

  it('codgrp NO forma parte de la identidad — el mismo código con distinto codgrp se deduplica a un solo producto (caso real medido: 06009 con codgrp F001/F002/F004/...)', () => {
    const registros = [
      { codigo: '06009', codgrp: 'F001', valor: 7017.43, fecha_ultima_compra: '2026-07-30' },
      { codigo: '06009', codgrp: 'F002', valor: 7017.43, fecha_ultima_compra: '2026-07-30' },
      { codigo: '06009', codgrp: 'F004', valor: 7017.43, fecha_ultima_compra: '2026-07-30' },
    ];
    const r = seleccionarUltimaCompraPorProducto(registros);
    expect(r.totalProductosUnicos).toBe(1);
  });

  it('productos distintos (código distinto) nunca se fusionan entre sí', () => {
    const registros = [
      { codigo: 'A', valor: 100, fecha_ultima_compra: '2026-01-01' },
      { codigo: 'B', valor: 200, fecha_ultima_compra: '2026-01-01' },
    ];
    const r = seleccionarUltimaCompraPorProducto(registros);
    expect(r.totalProductosUnicos).toBe(2);
  });

  it('sin código confiable, usa nombre normalizado como respaldo y lo reporta aparte', () => {
    const registros = [
      { nombre: 'Producto Sin Código', valor: 100, fecha_ultima_compra: '2026-01-01' },
      { nombre: 'producto sin código', valor: 200, fecha_ultima_compra: '2026-02-01' },
    ];
    const r = seleccionarUltimaCompraPorProducto(registros);
    expect(r.totalProductosUnicos).toBe(1);
    expect(r.productosSinCodigoConfiable).toBe(1);
    expect(r.productosConCodigoConfiable).toBe(0);
  });
});

describe('paginar', () => {
  it('16/17) pagina un arreglo YA deduplicado/filtrado — nunca antes', () => {
    const items = Array.from({ length: 123 }, (_, i) => ({ id: i }));
    const p1 = paginar(items, 1, 50);
    expect(p1.items).toHaveLength(50);
    expect(p1.total).toBe(123);
    expect(p1.totalPages).toBe(3);
    expect(p1.items[0].id).toBe(0);
  });

  it('10) cambiar de página solicita solo esa página (slice correcto, sin duplicar productos entre páginas)', () => {
    const items = Array.from({ length: 123 }, (_, i) => ({ id: i }));
    const p2 = paginar(items, 2, 50);
    expect(p2.items[0].id).toBe(50);
    expect(p2.items).toHaveLength(50);
    const p3 = paginar(items, 3, 50);
    expect(p3.items).toHaveLength(23);
    // Ningún id se repite entre páginas.
    const idsP1 = new Set(paginar(items, 1, 50).items.map(i => i.id));
    const idsP2 = new Set(p2.items.map(i => i.id));
    expect([...idsP1].some(id => idsP2.has(id))).toBe(false);
  });

  it('página fuera de rango se ajusta al límite válido (nunca un arreglo vacío por página inexistente)', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    const p = paginar(items, 99, 50);
    expect(p.page).toBe(1);
    expect(p.items).toHaveLength(10);
  });
});
