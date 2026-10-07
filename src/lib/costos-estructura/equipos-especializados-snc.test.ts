/**
 * Ajuste "MAQUINARIA Y EQUIPOS SNC — MODELO SERVICIOS ESPECIALIZADOS" —
 * tests puros contra la fuente REAL (`GET equipos/obtener_espec`, 45
 * registros, re-verificada en vivo el 2026-08-21 TRAS un ajuste del
 * backend anunciado por el usuario): ahora trae `codigo` (number, único)
 * y ya NO trae `marca`/`referencia` (retirados de la fuente). Nunca
 * contra el mock/campo `codigo` inventado (`'41'`/`'42'`/`'43'` como
 * string) de una ronda muy anterior — ese era ficticio; el `codigo`
 * (number) de esta ronda es el real, confirmado contra la API en vivo.
 */
import { describe, expect, it } from 'vitest';
import {
  claveEquipoEspecializado,
  crearEquipoEspecializadoDesdeCatalogo, crearEquipoEspecializadoManual, calcularValorTotalEquipoEspecializado,
  calcularTotalEquiposEspecializadosServicio, buscarEquiposEspecializados,
  type EquipoEspecializadoCatalogoSNC, type EquipoEspecializadoServicioNoContinuo,
} from './equipos-especializados-snc';

// Muestra real (subconjunto verificado contra la API en vivo el
// 2026-08-21, tras el ajuste del backend que agregó `codigo`) — incluye
// los 2 casos con colisión de codigoTipo+codigoSubtipo (códigos reales
// distintos) y un caso real con vlr_dia:0.
const ASPIRADORA: EquipoEspecializadoCatalogoSNC = { codigo: 41, descripcion: 'ASPIRADORA INDUSTRIAL', subTipo: 'ASPIRADORA INDUSTRIAL 1 MOTOR', valorDia: 14227, codigoTipo: '004', codigoSubtipo: '048' };
const TRIPODE: EquipoEspecializadoCatalogoSNC = { codigo: 44, descripcion: 'TRIPODE ASCENSO Y DESCENSO', subTipo: 'EQUIPO DE TRABAJO EN ALTURA', valorDia: 12000, codigoTipo: '005', codigoSubtipo: '007' };
const ARNES: EquipoEspecializadoCatalogoSNC = { codigo: 45, descripcion: 'ARNEZ 4 ARGOLLAS RECUBIERTO EN POLIURETANO', subTipo: 'EQUIPO DE TRABAJO EN ALTURA', valorDia: 8000, codigoTipo: '005', codigoSubtipo: '007' };
const BOMBA_SIN_TARIFA: EquipoEspecializadoCatalogoSNC = { codigo: 46, descripcion: 'BOMBA SUMERGIBLE DE 3 PULG. MONOFASICA AUTOREFRIGERANTE MAS EXTENSIONES', subTipo: 'BOMBA SUMERGIBLE 3 IHM  - 2.0 HP', valorDia: 0, codigoTipo: '004', codigoSubtipo: '054' };
const CATALOGO_MUESTRA: readonly EquipoEspecializadoCatalogoSNC[] = [ASPIRADORA, TRIPODE, ARNES, BOMBA_SIN_TARIFA];

describe('claveEquipoEspecializado — codigo único cuando está presente; respaldo tipo+subtipo+descripcion para filas manuales', () => {
  it('adapta correctamente los 6 campos reales de la fuente (sin marca/referencia, ya retirados de la API)', () => {
    const item = crearEquipoEspecializadoDesdeCatalogo(ASPIRADORA, 1);
    expect(item).toEqual({
      id: 1, codigo: 41, descripcion: 'ASPIRADORA INDUSTRIAL', subTipo: 'ASPIRADORA INDUSTRIAL 1 MOTOR',
      valorDia: 14227, codigoTipo: '004', codigoSubtipo: '048',
      cantidad: 1, numeroDias: 1, origen: 'CATALOGO',
    });
    expect((item as unknown as Record<string, unknown>).marca).toBeUndefined();
    expect((item as unknown as Record<string, unknown>).referencia).toBeUndefined();
  });

  it('dos equipos con el MISMO codigoTipo+codigoSubtipo (colisión real confirmada: 005:007) tienen `codigo` distinto y por tanto clave distinta', () => {
    expect(TRIPODE.codigoTipo).toBe(ARNES.codigoTipo);
    expect(TRIPODE.codigoSubtipo).toBe(ARNES.codigoSubtipo);
    expect(TRIPODE.codigo).not.toBe(ARNES.codigo);
    expect(claveEquipoEspecializado(TRIPODE)).not.toBe(claveEquipoEspecializado(ARNES));
  });

  it('nunca se debe usar codigoTipo+codigoSubtipo solo como clave — no es único (documentado, no una regresión)', () => {
    const claveSoloTipoSubtipo = (i: { codigoTipo: string; codigoSubtipo: string }) => `${i.codigoTipo}:${i.codigoSubtipo}`;
    expect(claveSoloTipoSubtipo(TRIPODE)).toBe(claveSoloTipoSubtipo(ARNES));
  });

  it('una fila MANUAL (sin `codigo`) usa el respaldo codigoTipo:codigoSubtipo:descripcion (vacíos, pero sigue siendo una clave válida)', () => {
    const manual = crearEquipoEspecializadoManual(99);
    expect(manual.codigo).toBeUndefined();
    expect(claveEquipoEspecializado(manual)).toBe('::');
  });
});

describe('crearEquipoEspecializadoManual — fila en blanco, sin catálogo', () => {
  it('nace sin código, con descripción/subtipo vacíos, valorDia 0, cantidad/numeroDias en 1', () => {
    const m = crearEquipoEspecializadoManual(5);
    expect(m).toEqual({ id: 5, descripcion: '', subTipo: '', valorDia: 0, codigoTipo: '', codigoSubtipo: '', cantidad: 1, numeroDias: 1, origen: 'MANUAL' });
  });
});

// Ajuste (feedback en vivo) "si la API devuelve vlr_dia=0, el equipo sí
// debe poder agregarse" — se retiró el predicado de bloqueo
// (`equipoEspecializadoTieneTarifaVigente`, ya eliminado del módulo);
// estos tests cubren que un equipo con `valorDia:0` se adapta y se agrega
// igual que cualquier otro, sin inventar/reemplazar/convertir a `null` el
// valor recibido.
describe('valorDia=0 (API real, "sin tarifa vigente" ya NO bloquea nada) — se agrega igual, con $0 exacto', () => {
  it('crearEquipoEspecializadoDesdeCatalogo con valorDia=0 conserva el 0 exacto (nunca null, nunca inventado)', () => {
    const item = crearEquipoEspecializadoDesdeCatalogo(BOMBA_SIN_TARIFA, 1);
    expect(item.valorDia).toBe(0);
    expect(item.valorDia).not.toBeNull();
    expect(item).toEqual({
      id: 1, codigo: 46, descripcion: BOMBA_SIN_TARIFA.descripcion, subTipo: BOMBA_SIN_TARIFA.subTipo,
      valorDia: 0, codigoTipo: '004', codigoSubtipo: '054', cantidad: 1, numeroDias: 1, origen: 'CATALOGO',
    });
  });

  it('cantidad/numeroDias default 1/1 igual que cualquier otro equipo de catálogo', () => {
    const item = crearEquipoEspecializadoDesdeCatalogo(BOMBA_SIN_TARIFA, 2);
    expect(item.cantidad).toBe(1);
    expect(item.numeroDias).toBe(1);
  });

  it('total inicial es $0 (fórmula sin excepciones: cantidad × numeroDias × 0 = 0)', () => {
    const item = crearEquipoEspecializadoDesdeCatalogo(BOMBA_SIN_TARIFA, 3);
    expect(calcularValorTotalEquipoEspecializado(item)).toBe(0);
  });
});

describe('Valor día editable tras agregar — vlr_dia de la API es solo el valor inicial sugerido', () => {
  it('valor inicial desde API: ASPIRADORA INDUSTRIAL agregada trae valorDia=14.227 sin tocar', () => {
    const item = crearEquipoEspecializadoDesdeCatalogo(ASPIRADORA, 1);
    expect(item.valorDia).toBe(14227);
  });

  it('editar valorDia manualmente tras agregar (mismo mecanismo que cantidad/numeroDias) y recalcular el total', () => {
    const agregado = crearEquipoEspecializadoDesdeCatalogo(ASPIRADORA, 1);
    const conOverride: EquipoEspecializadoServicioNoContinuo = { ...agregado, valorDia: 20000 };
    expect(conOverride.valorDia).toBe(20000);
    expect(calcularValorTotalEquipoEspecializado(conOverride)).toBe(20000); // 1×1×20.000
  });

  it('override manual combinado con cantidad/numeroDias: 2×3×20.000 = 120.000 (caso exacto del usuario)', () => {
    const agregado = crearEquipoEspecializadoDesdeCatalogo(ASPIRADORA, 1);
    const editado: EquipoEspecializadoServicioNoContinuo = { ...agregado, valorDia: 20000, cantidad: 2, numeroDias: 3 };
    expect(calcularValorTotalEquipoEspecializado(editado)).toBe(120000);
  });

  it('el override manual no muta el catálogo/caché original (objetos independientes)', () => {
    const agregado = crearEquipoEspecializadoDesdeCatalogo(ASPIRADORA, 1);
    const editado: EquipoEspecializadoServicioNoContinuo = { ...agregado, valorDia: 20000 };
    expect(ASPIRADORA.valorDia).toBe(14227); // el catálogo original nunca cambia
    expect(editado.valorDia).toBe(20000);
  });

  it('volver a agregar el MISMO equipo desde catálogo crea una fila independiente con el valorDia ACTUAL de la API (nunca el override de una fila anterior)', () => {
    const primera: EquipoEspecializadoServicioNoContinuo = { ...crearEquipoEspecializadoDesdeCatalogo(ASPIRADORA, 1), valorDia: 20000 };
    const segunda = crearEquipoEspecializadoDesdeCatalogo(ASPIRADORA, 2); // simula "eliminar y volver a agregar"
    expect(primera.valorDia).toBe(20000);
    expect(segunda.valorDia).toBe(14227);
  });

  it('un equipo agregado con valorDia=0 permite que el usuario escriba manualmente el valor correcto', () => {
    const agregado = crearEquipoEspecializadoDesdeCatalogo(BOMBA_SIN_TARIFA, 1);
    expect(agregado.valorDia).toBe(0);
    const corregido: EquipoEspecializadoServicioNoContinuo = { ...agregado, valorDia: 50000 };
    expect(calcularValorTotalEquipoEspecializado(corregido)).toBe(50000);
  });
});

describe('buscarEquiposEspecializados — búsqueda local por código, descripción o subtipo', () => {
  it('por código (coincidencia exacta del número, ahora que la fuente lo confirma único)', () => {
    expect(buscarEquiposEspecializados(CATALOGO_MUESTRA, '41')).toEqual([ASPIRADORA]);
  });
  it('por código parcial no confunde dos códigos distintos que comparten dígitos', () => {
    // 44 y 45 comparten el dígito '4' — buscar '4' debe traer AMBOS, nunca
    // uno solo por coincidencia parcial ambigua.
    const r = buscarEquiposEspecializados(CATALOGO_MUESTRA, '4');
    expect(r).toEqual(expect.arrayContaining([ASPIRADORA, TRIPODE, ARNES, BOMBA_SIN_TARIFA]));
  });
  it('por descripción (case-insensitive, coincidencia parcial)', () => {
    expect(buscarEquiposEspecializados(CATALOGO_MUESTRA, 'aspiradora')).toEqual([ASPIRADORA]);
  });
  it('por subtipo', () => {
    const r = buscarEquiposEspecializados(CATALOGO_MUESTRA, 'equipo de trabajo en altura');
    expect(r).toEqual([TRIPODE, ARNES]);
  });
  it('query vacía devuelve el catálogo completo', () => {
    expect(buscarEquiposEspecializados(CATALOGO_MUESTRA, '')).toEqual(CATALOGO_MUESTRA);
  });
  it('sin coincidencias devuelve arreglo vacío', () => {
    expect(buscarEquiposEspecializados(CATALOGO_MUESTRA, 'inexistente-xyz')).toEqual([]);
  });
});

describe('calcularValorTotalEquipoEspecializado / calcularTotalEquiposEspecializadosServicio — total = cantidad × numeroDias × valorDia', () => {
  it('1 × 1 × 14.227 = 14.227 (ASPIRADORA INDUSTRIAL, caso de referencia del usuario)', () => {
    const item = crearEquipoEspecializadoDesdeCatalogo(ASPIRADORA, 1);
    expect(calcularValorTotalEquipoEspecializado(item)).toBe(14227);
  });

  it('cantidad múltiple: 2 × 1 × 14.227 = 28.454', () => {
    const item: EquipoEspecializadoServicioNoContinuo = { ...crearEquipoEspecializadoDesdeCatalogo(ASPIRADORA, 1), cantidad: 2 };
    expect(calcularValorTotalEquipoEspecializado(item)).toBe(28454);
  });

  it('múltiples días: 1 × 5 × 14.227 = 71.135', () => {
    const item: EquipoEspecializadoServicioNoContinuo = { ...crearEquipoEspecializadoDesdeCatalogo(ASPIRADORA, 1), numeroDias: 5 };
    expect(calcularValorTotalEquipoEspecializado(item)).toBe(71135);
  });

  it('cantidad y días combinados: 2 × 3 × 14.227 = 85.362 (caso exacto pedido por el usuario)', () => {
    const item: EquipoEspecializadoServicioNoContinuo = { ...crearEquipoEspecializadoDesdeCatalogo(ASPIRADORA, 1), cantidad: 2, numeroDias: 3 };
    expect(calcularValorTotalEquipoEspecializado(item)).toBe(85362);
  });

  it('un equipo con valorDia=0 aporta 0 al total (sí puede agregarse — ver describe "valorDia=0" más abajo)', () => {
    const item = crearEquipoEspecializadoDesdeCatalogo(BOMBA_SIN_TARIFA, 1);
    expect(calcularValorTotalEquipoEspecializado(item)).toBe(0);
  });

  it('múltiples equipos suman correctamente (sin duplicar ningún total individual)', () => {
    const items: EquipoEspecializadoServicioNoContinuo[] = [
      { ...crearEquipoEspecializadoDesdeCatalogo(ASPIRADORA, 1), cantidad: 2, numeroDias: 3 }, // 85.362
      { ...crearEquipoEspecializadoDesdeCatalogo(TRIPODE, 2), cantidad: 1, numeroDias: 1 }, // 12.000
    ];
    expect(calcularTotalEquiposEspecializadosServicio(items)).toBe(85362 + 12000);
  });

  it('eliminar un equipo del arreglo actualiza el subtotal (mismo predicado que usa la UI: filter + recalcular)', () => {
    const items: EquipoEspecializadoServicioNoContinuo[] = [
      { ...crearEquipoEspecializadoDesdeCatalogo(ASPIRADORA, 1), cantidad: 2, numeroDias: 3 },
      { ...crearEquipoEspecializadoDesdeCatalogo(TRIPODE, 2) },
    ];
    const totalConAmbos = calcularTotalEquiposEspecializadosServicio(items);
    const totalTrasEliminar = calcularTotalEquiposEspecializadosServicio(items.filter(i => i.id !== 1));
    expect(totalConAmbos).toBe(85362 + 12000);
    expect(totalTrasEliminar).toBe(12000);
  });

  it('una fila manual con valores digitados por el usuario calcula igual que una de catálogo', () => {
    const manual: EquipoEspecializadoServicioNoContinuo = { ...crearEquipoEspecializadoManual(7), descripcion: 'Andamio alquilado', valorDia: 20000, cantidad: 2, numeroDias: 4 };
    expect(calcularValorTotalEquipoEspecializado(manual)).toBe(160000);
  });

  it('arreglo vacío → total 0', () => {
    expect(calcularTotalEquiposEspecializadosServicio([])).toBe(0);
  });
});
