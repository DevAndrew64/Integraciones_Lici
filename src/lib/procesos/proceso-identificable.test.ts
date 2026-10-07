/**
 * Ajuste "PROCESOS SIN IDENTIFICADOR — FILTRO DE LISTADOS" — la Data API
 * entrega desde el 2026-09-16 procesos sin `codigoProceso` ni `nombre` (232
 * medidos en dos días). Se ocultan en lectura, nunca en la ingesta.
 */
import { describe, it, expect } from 'vitest';
import { whereProcesoIdentificable, procesoEsIdentificable } from './proceso-identificable';

type Fila = { codigoProceso: string | null; nombre: string | null };

/** Evalúa el fragmento Prisma con la MISMA semántica de tres valores de SQL. */
function evalWhere(cond: Record<string, unknown>, fila: Fila): boolean {
  const ramas = (cond.OR ?? []) as Record<string, unknown>[];
  return ramas.some((rama) => {
    const ands = (rama.AND ?? []) as Record<string, Record<string, unknown>>[];
    return ands.every((c) => {
      const [campo, test] = Object.entries(c)[0] as [keyof Fila, { not: unknown }];
      const valor = fila[campo];
      // `IS NOT NULL` y `<> ''`; un NULL comparado con '' es UNKNOWN ⇒ falso.
      if (test.not === null) return valor !== null;
      if (valor === null) return false;
      return valor !== test.not;
    });
  });
}

const CON_AMBOS: Fila   = { codigoProceso: 'LP-004-2026', nombre: 'Licitación' };
const SOLO_CODIGO: Fila = { codigoProceso: 'LP-004-2026', nombre: null };
const SOLO_NOMBRE: Fila = { codigoProceso: null, nombre: 'RFP2026-08 Aseo' };
const VACIO_NULL: Fila  = { codigoProceso: null, nombre: null };
const VACIO_STR: Fila   = { codigoProceso: '', nombre: '' };
const MIXTO: Fila       = { codigoProceso: '', nombre: null };

describe('whereProcesoIdentificable — basta UNO de los dos identificadores', () => {
  it('conserva un proceso con código y nombre', () => {
    expect(evalWhere(whereProcesoIdentificable(), CON_AMBOS)).toBe(true);
  });

  it('conserva un proceso con SOLO código (nombre null) — caso normal de SECOP', () => {
    expect(evalWhere(whereProcesoIdentificable(), SOLO_CODIGO)).toBe(true);
  });

  it('conserva un proceso con SOLO nombre (código null) — caso de los privados migrados', () => {
    expect(evalWhere(whereProcesoIdentificable(), SOLO_NOMBRE)).toBe(true);
  });

  it('descarta el proceso vacío de la Data API (ambos null)', () => {
    expect(evalWhere(whereProcesoIdentificable(), VACIO_NULL)).toBe(false);
  });

  it('descarta también cuando llegan como cadena vacía en vez de null', () => {
    expect(evalWhere(whereProcesoIdentificable(), VACIO_STR)).toBe(false);
  });

  it('descarta la mezcla de cadena vacía y null', () => {
    expect(evalWhere(whereProcesoIdentificable(), MIXTO)).toBe(false);
  });

  it('cada rama exige IS NOT NULL antes de comparar contra vacío (guard de tres valores)', () => {
    // Sin el guard, `"nombre" <> ''` sobre NULL sería UNKNOWN y tumbaría la
    // fila aunque tuviera código — el fallo que ya corrigieron D11/D12.
    const cond = whereProcesoIdentificable();
    for (const rama of cond.OR as Record<string, unknown>[]) {
      const ands = rama.AND as Record<string, { not: unknown }>[];
      expect(ands).toHaveLength(2);
      expect(Object.values(ands[0])[0].not).toBeNull();
      expect(Object.values(ands[1])[0].not).toBe('');
    }
  });
});

describe('procesoEsIdentificable — equivalente en memoria', () => {
  it('coincide con el fragmento Prisma en todos los casos', () => {
    for (const fila of [CON_AMBOS, SOLO_CODIGO, SOLO_NOMBRE, VACIO_NULL, VACIO_STR, MIXTO]) {
      expect(procesoEsIdentificable(fila)).toBe(evalWhere(whereProcesoIdentificable(), fila));
    }
  });

  it('trata los espacios en blanco como ausencia de identificador', () => {
    expect(procesoEsIdentificable({ codigoProceso: '   ', nombre: null })).toBe(false);
  });
});
