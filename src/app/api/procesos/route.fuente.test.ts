/**
 * Ajuste "PARIDAD DATA API — FUENTE" en `procesos/route.ts` (Búsqueda) —
 * caso real CP-019-JNCI-2026 (externalId 12055133): `aliasFuente` nunca
 * llega por Data API, así que "público" debe reconocer también
 * `origenFuncional`, y "privado" debe ser el complemento EXACTO con lógica
 * de 3 valores segura (cada rama guardada con `{ not: null }` — sin eso,
 * una fila con ambos campos null desaparece de público Y de privado).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  solicitud: { findMany: vi.fn() },
  proceso: { count: vi.fn(), findMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ default: prismaMock }));
vi.mock('@/lib/session', () => ({ getSession: vi.fn().mockResolvedValue({ id: 1, usuario: 'test', rol: 'Analista Comercial' }) }));

import { GET } from './route';
import { NextRequest } from 'next/server';

const req = (qs = '') => new NextRequest(`http://localhost/api/procesos${qs}`);

const base = {
  entidad: 'Municipio', objeto: 'Obj', fuente: null, modalidad: 'MC',
  perfil: null, departamento: 'Arauca', estadoFuente: 'Convocatoria',
  fechaPublicacion: new Date('2026-09-09T00:00:00Z'),
  fechaVencimiento: new Date('2027-01-01T00:00:00Z'),
  fechaVencimientoAnterior: null, tieneCambioFechaCierre: false, fechaCambioFechaCierre: null,
  valor: 1000, linkDetalle: '', linkSecop: '', linkSecopReg: '',
  totalCronogramas: 0, totalDocumentos: 0, lastSyncedAt: null, rawJson: null,
  oculto: false,
};

// CP-019-JNCI-2026: su origenFuncional REAL en base es PUBLICO_REGISTRADO (= Secop II).
const PUBLICO_REGISTRADO_SIN_ALIAS = { ...base, id: 9064, externalId: '12055133', codigoProceso: 'CP-019-JNCI-2026', nombre: 'CP-019-JNCI-2026', aliasFuente: null, origenFuncional: 'PUBLICO_REGISTRADO' };
const PUBLICO_ABIERTO_SIN_ALIAS = { ...base, id: 9065, externalId: '12055134', codigoProceso: 'ABIERTO-001-2026', nombre: 'ABIERTO-001-2026', aliasFuente: null, origenFuncional: 'PUBLICO_ABIERTO' };
const PRIVADO_DATA_API = { ...base, id: 9066, externalId: '12055135', codigoProceso: 'PRIV-001-2026', nombre: 'PRIV-001-2026', aliasFuente: null, origenFuncional: 'PRIVADO' };
const S2_LEGACY = { ...base, id: 100, externalId: '999', codigoProceso: 'S2-LEGACY-2026', nombre: 'S2-LEGACY-2026', aliasFuente: 'S2', origenFuncional: null };
const NC_LEGACY = { ...base, id: 101, externalId: null, codigoProceso: 'NC-LEGACY-2026', nombre: 'NC-LEGACY-2026', aliasFuente: 'NC', origenFuncional: null };

const OCULTO = { ...base, id: 999, externalId: '12055136', codigoProceso: 'OCULTO-001-2026', nombre: 'Oculto', aliasFuente: null, origenFuncional: 'PRIVADO', oculto: true };
const PROCESOS = [PUBLICO_ABIERTO_SIN_ALIAS, PUBLICO_REGISTRADO_SIN_ALIAS, PRIVADO_DATA_API, S2_LEGACY, NC_LEGACY, OCULTO];

type TV = boolean | null;
function evalCond(cond: Record<string, unknown>, row: Record<string, unknown>): TV {
  if ('AND' in cond) {
    let unk = false;
    for (const c of cond.AND as Record<string, unknown>[]) {
      const v = evalCond(c, row);
      if (v === false) return false;
      if (v === null) unk = true;
    }
    return unk ? null : true;
  }
  if ('OR' in cond) {
    let unk = false;
    for (const c of cond.OR as Record<string, unknown>[]) {
      const v = evalCond(c, row);
      if (v === true) return true;
      if (v === null) unk = true;
    }
    return unk ? null : false;
  }
  if ('NOT' in cond) {
    const v = evalCond(cond.NOT as Record<string, unknown>, row);
    return v === null ? null : !v;
  }
  const keys = Object.keys(cond);
  if (keys.length !== 1) throw new Error(`leaf con ${keys.length} claves: ${JSON.stringify(cond)}`);
  const field = keys[0];
  const spec = cond[field] as unknown;
  const val = (row[field] ?? null) as unknown;
  if (spec === null) return val === null;
  if (typeof spec !== 'object') return val === null ? null : val === spec;
  const s = spec as Record<string, unknown>;
  if ('in' in s) return val === null ? null : (s.in as unknown[]).includes(val);
  if ('equals' in s) return val === null ? null : val === s.equals;
  if ('not' in s && s.not === null) return val !== null;
  throw new Error(`spec no soportado: ${JSON.stringify(spec)}`);
}

let whereMain: Record<string, unknown> | null = null;

function condicionDeFuente(where: Record<string, unknown>): Record<string, unknown> {
  const and = (where as { AND: Record<string, unknown>[] }).AND;
  const c = and.find((cond) => {
    const or = (cond as { OR?: Record<string, unknown>[] }).OR;
    return Array.isArray(or) && or.some((r) => JSON.stringify(r).includes('aliasFuente') || JSON.stringify(r).includes('origenFuncional'));
  });
  if (!c) throw new Error('no se encontró la condición de fuente en el where');
  return c;
}

beforeEach(() => {
  whereMain = null;
  prismaMock.proceso.count.mockReset().mockResolvedValue(PROCESOS.length);
  prismaMock.proceso.findMany.mockReset().mockImplementation(async ({ where }) => {
    whereMain = where;
    return PROCESOS;
  });
});

describe('procesos (Búsqueda) — filtro de fuente reconoce origenFuncional cuando aliasFuente es null', () => {
  it('fuente=secop ii incluye un Proceso Data API con origenFuncional=PUBLICO_REGISTRADO y aliasFuente=null', async () => {
    await GET(req('?fuente=secop ii'));
    const cond = condicionDeFuente(whereMain!);
    expect(PROCESOS.filter((p) => evalCond(cond, p) === true).map((p) => p.id)).toContain(9064);
  });

  it('fuente=secop i incluye un Proceso Data API con origenFuncional=PUBLICO_ABIERTO', async () => {
    await GET(req('?fuente=secop i'));
    const cond = condicionDeFuente(whereMain!);
    expect(PROCESOS.filter((p) => evalCond(cond, p) === true).map((p) => p.id)).toContain(9065);
  });

  it('fuente=privado EXCLUYE los Procesos Data API públicos (aliasFuente=null + origenFuncional público)', async () => {
    await GET(req('?fuente=privado'));
    const cond = condicionDeFuente(whereMain!);
    const ids = PROCESOS.filter((p) => evalCond(cond, p) === true).map((p) => p.id);
    expect(ids).not.toContain(9064);
    expect(ids).not.toContain(9065);
  });

  it('fuente=privado SÍ incluye un Proceso Data API con origenFuncional=PRIVADO (no desaparece por 3 valores)', async () => {
    await GET(req('?fuente=privado'));
    const cond = condicionDeFuente(whereMain!);
    expect(PROCESOS.filter((p) => evalCond(cond, p) === true).map((p) => p.id)).toContain(9066);
  });

  it('el listado de todos los procesos excluye procesos con oculto=true', async () => {
    await GET(req());
    const and = (whereMain as { AND: Record<string, unknown>[] }).AND;
    expect(and).toContainEqual({ NOT: { oculto: true } });
    expect(evalCond({ NOT: { oculto: true } }, { oculto: true })).toBe(false);
    expect(evalCond({ NOT: { oculto: true } }, { oculto: false })).toBe(true);
  });

  it('legacy S2/NC (con aliasFuente ya presente, origenFuncional=null) no se ve afectado por el fix', async () => {
    await GET(req('?fuente=secop ii'));
    const cond = condicionDeFuente(whereMain!);
    expect(PROCESOS.filter((p) => evalCond(cond, p) === true).map((p) => p.id)).toContain(100);
    await GET(req('?fuente=privado'));
    const condPriv = condicionDeFuente(whereMain!);
    expect(PROCESOS.filter((p) => evalCond(condPriv, p) === true).map((p) => p.id)).toContain(101);
  });
});
