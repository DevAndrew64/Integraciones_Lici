/**
 * Bug NULL-safe en la exclusión de "ya gestionados" de
 * `/api/procesos/sin-gestionar`.
 *
 * ANTES: las 5 exclusiones (procesoId / externalId / llave de negocio /
 * nombre histórico / codigoProceso==nombre) se aplicaban como un único
 * `NOT { OR: [...] }`. En Postgres, si una rama del `OR` evalúa sobre una
 * columna NULL (p. ej. `externalId IN (...)` con `externalId IS NULL`), esa
 * rama es UNKNOWN; el `OR` completo queda UNKNOWN y `NOT(UNKNOWN)` también,
 * así que la fila NO se devuelve aunque NO deba excluirse. Con miles de
 * candidatos con `externalId = NULL`, el listado colapsaba a 0.
 *
 * AHORA: las exclusiones son condiciones AND independientes (De Morgan) y
 * cada campo nullable lleva su rama `{ campo: null }` explícita. La intención
 * funcional es idéntica; solo cambia la semántica NULL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { construirLlaveNegocio } from '@/lib/proceso-identidad';

const prismaMock = vi.hoisted(() => ({
  solicitud: { findMany: vi.fn() },
  proceso: { count: vi.fn(), findMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ default: prismaMock }));

import { GET } from './route';
import { NextRequest } from 'next/server';

const req = (qs = '') => new NextRequest(`http://localhost/api/procesos/sin-gestionar${qs}`);

// ── Solicitudes que definen los conjuntos de exclusión ────────────────────
const SOLICITUDES = [
  { procesoId: 10, codigoProceso: null, entidad: null, externalId: null, nombreProceso: null },
  { procesoId: null, codigoProceso: null, entidad: null, externalId: 'EXT-777', nombreProceso: null },
  { procesoId: null, codigoProceso: 'CP-001-2026', entidad: 'Alcaldía de Fortul', externalId: null, nombreProceso: null },
  { procesoId: null, codigoProceso: 'HIST-4', entidad: null, externalId: null, nombreProceso: 'Servicio de aseo histórico XYZ' },
];

// ── Universo de Proceso candidatos (todos "abiertos", vigentes, viables) ──
const base = {
  entidad: 'Municipio', objeto: 'Obj', fuente: 'NC', aliasFuente: 'NC', modalidad: 'MC',
  perfil: null, departamento: 'Arauca', estadoFuente: 'ABIERTO',
  fechaPublicacion: new Date('2026-08-01T00:00:00Z'),
  fechaVencimiento: new Date('2027-01-01T00:00:00Z'),
  valor: 1000, linkDetalle: '', linkSecop: '', linkSecopReg: '',
  totalCronogramas: 0, totalDocumentos: 0, lastSyncedAt: null, rawJson: null,
  noViable: false, observacionNoViable: null, noViableRegistradoPor: null, noViableFecha: null,
  oculto: false,
};
const PROCESOS = [
  { ...base, id: 1, externalId: null, codigoProceso: null, nombre: 'Candidato sin identidad 1' },          // KEEP (bug)
  { ...base, id: 10, externalId: null, codigoProceso: 'X-10', nombre: 'Gestionado por procesoId' },         // EXCLUDE id∈procesoIds
  { ...base, id: 3, externalId: 'EXT-777', codigoProceso: 'X-3', nombre: 'Gestionado por externalId' },     // EXCLUDE externalId
  { ...base, id: 4, externalId: null, codigoProceso: 'No. CP-001-2026', nombre: 'Gestionado por llave', entidad: 'ALCALDIA DE FORTUL' }, // EXCLUDE llave negocio
  { ...base, id: 5, externalId: null, codigoProceso: 'X-5', nombre: 'Servicio de aseo histórico XYZ' },     // EXCLUDE nombre histórico
  { ...base, id: 6, externalId: null, codigoProceso: null, nombre: 'Otro candidato, codigoProceso null' },  // KEEP (no cae por fallback nombres)
  { ...base, id: 7, externalId: null, codigoProceso: 'X-7', nombre: 'Oculto', oculto: true },               // EXCLUDE oculto
];

// ── Lógica de tres valores de Postgres (true | false | null=UNKNOWN) ──────
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
  if (spec === null) return val === null;                 // IS NULL → siempre booleano
  if (typeof spec !== 'object') return val === null ? null : val === spec;
  const s = spec as Record<string, unknown>;
  if ('notIn' in s) return val === null ? null : !(s.notIn as unknown[]).includes(val);
  if ('in' in s) return val === null ? null : (s.in as unknown[]).includes(val);
  if ('gt' in s) return val === null ? null : (val as number | Date) > (s.gt as number | Date);
  if ('contains' in s) {
    if (val === null) return null;
    const ci = s.mode === 'insensitive';
    const hay = ci ? String(val).toLowerCase() : String(val);
    const needle = ci ? String(s.contains).toLowerCase() : String(s.contains);
    return hay.includes(needle);
  }
  if ('not' in s) {
    // `{ not: null }` = `IS NOT NULL`: predicado total, nunca UNKNOWN.
    if (s.not === null) return val !== null;
    // `{ not: <valor> }` = `col <> valor`: sobre NULL es UNKNOWN, como en Postgres.
    return val === null ? null : val !== s.not;
  }
  throw new Error(`spec no soportado: ${JSON.stringify(spec)}`);
}
const filtra = (where: Record<string, unknown>) => PROCESOS.filter((p) => evalCond(where, p) === true);

let whereMain: Record<string, unknown> | null = null;

beforeEach(() => {
  whereMain = null;
  prismaMock.solicitud.findMany.mockReset().mockResolvedValue(SOLICITUDES);
  prismaMock.proceso.count.mockReset().mockImplementation(async ({ where }) => filtra(where).length);
  prismaMock.proceso.findMany.mockReset().mockImplementation(async ({ where }) => {
    // Sub-consulta de la fase 1 de llave de negocio: `where` es `{ OR: [contains...] }`.
    if (where && 'OR' in where && !('AND' in where)) {
      const ors = where.OR as { codigoProceso: { contains: string; mode: string } }[];
      return PROCESOS
        .filter((p) => p.codigoProceso != null &&
          ors.some((o) => String(p.codigoProceso).toLowerCase().includes(o.codigoProceso.contains.toLowerCase())))
        .map((p) => ({ id: p.id, codigoProceso: p.codigoProceso, entidad: p.entidad }));
    }
    // Consulta principal.
    whereMain = where;
    return filtra(where);
  });
});

describe('sin-gestionar — exclusión NULL-safe de ya gestionados', () => {
  it('el `where` ya NO usa `NOT { OR: [...] }` global; usa condiciones AND independientes con rama `{ campo: null }`', async () => {
    await GET(req());
    const and = (whereMain as { AND: Record<string, unknown>[] }).AND;

    // Ninguna condición mezcla las 5 exclusiones en un solo NOT/OR.
    const tieneNotOrExclusion = and.some((c) => {
      const not = (c as { NOT?: { OR?: Record<string, unknown>[] } }).NOT;
      if (!not?.OR) return false;
      return not.OR.some((r) => 'id' in r || 'externalId' in r || 'nombre' in r || 'codigoProceso' in r);
    });
    expect(tieneNotOrExclusion).toBe(false);

    // procesoId + llave de negocio → un único `id: { notIn: [...] }`.
    expect(and).toContainEqual({ id: { notIn: [10, 4] } });
    // externalId nullable → OR con rama null.
    expect(and).toContainEqual({ OR: [{ externalId: null }, { externalId: { notIn: ['EXT-777'] } }] });
    // nombre histórico + codigoProceso==nombre → cada uno con rama null.
    expect(and).toContainEqual({ OR: [{ nombre: null }, { nombre: { notIn: ['Servicio de aseo histórico XYZ'] } }] });
    expect(and).toContainEqual({ OR: [{ codigoProceso: null }, { codigoProceso: { notIn: ['Servicio de aseo histórico XYZ'] } }] });
  });

  it('los filtros no relacionados con la exclusión de identidad se conservan (noViable, fechaVencimiento) y el de estado terminal es NULL-safe', async () => {
    await GET(req());
    const and = (whereMain as { AND: Record<string, unknown>[] }).AND;
    expect(and).toContainEqual({ noViable: false });
    expect(and).toContainEqual({
      OR: [{ fechaVencimiento: null }, { fechaVencimiento: { gt: expect.any(Date) } }],
    });
    // Estado terminal: `{ OR: [ { estadoFuente: null }, { NOT: { OR: [ ...contains... ] } } ] }`
    const terminal = and.find((c) => {
      const or = (c as { OR?: Record<string, unknown>[] }).OR;
      return Array.isArray(or)
        && or.some((r) => JSON.stringify(r) === JSON.stringify({ estadoFuente: null }))
        && or.some((r) => {
          const inner = (r as { NOT?: { OR?: { estadoFuente?: unknown }[] } }).NOT?.OR;
          return Array.isArray(inner) && inner.every((x) => 'estadoFuente' in x && typeof (x.estadoFuente as { contains?: unknown }).contains === 'string');
        });
    });
    expect(terminal, 'el filtro de estado terminal debe llevar la rama { estadoFuente: null }').toBeTruthy();
  });

  it('un candidato con externalId=NULL que NO coincide con ninguna Solicitud NO desaparece', async () => {
    const body = await (await GET(req())).json();
    const ids = body.procesos.map((p: { procesoId: number }) => p.procesoId);
    expect(ids).toContain(1);
    expect(ids).toContain(6);
  });

  it('id ∈ procesoIds SÍ se excluye', async () => {
    const body = await (await GET(req())).json();
    expect(body.procesos.map((p: { procesoId: number }) => p.procesoId)).not.toContain(10);
  });

  it('externalId no-null coincidente SÍ se excluye', async () => {
    const body = await (await GET(req())).json();
    expect(body.procesos.map((p: { procesoId: number }) => p.procesoId)).not.toContain(3);
  });

  it('llave de negocio (codigoProceso+entidad) coincidente SÍ se excluye', async () => {
    // sanity: la llave normalizada del candidato 4 coincide con la de la Solicitud
    expect(construirLlaveNegocio('No. CP-001-2026', 'ALCALDIA DE FORTUL'))
      .toBe(construirLlaveNegocio('CP-001-2026', 'Alcaldía de Fortul'));
    const body = await (await GET(req())).json();
    expect(body.procesos.map((p: { procesoId: number }) => p.procesoId)).not.toContain(4);
  });

  it('nombre histórico coincidente SÍ se excluye', async () => {
    const body = await (await GET(req())).json();
    expect(body.procesos.map((p: { procesoId: number }) => p.procesoId)).not.toContain(5);
  });

  it('un candidato con codigoProceso=NULL NO desaparece por el fallback de nombres', async () => {
    const body = await (await GET(req())).json();
    expect(body.procesos.map((p: { procesoId: number }) => p.procesoId)).toContain(6);
  });

  it('los procesos con oculto=true no aparecen en el listado', async () => {
    const body = await (await GET(req())).json();
    expect(body.procesos.map((p: { procesoId: number }) => p.procesoId)).not.toContain(7);
    expect((whereMain as { AND: Record<string, unknown>[] }).AND).toContainEqual({ OR: [{ oculto: null }, { oculto: false }] });
  });

  it('el resultado final NO cae a 0 por semántica NULL: quedan exactamente los candidatos reales', async () => {
    const body = await (await GET(req())).json();
    expect(body.total_resultados_api).toBe(2);
    expect(body.procesos.map((p: { procesoId: number }) => p.procesoId).sort()).toEqual([1, 6]);
  });

  it('regresión: el `NOT { OR: [...] }` anterior SÍ colapsaba (UNKNOWN) sobre externalId NULL', () => {
    const shapeAnterior = {
      AND: [
        { noViable: false },
        {
          NOT: {
            OR: [
              { id: { in: [10, 4] } },
              { externalId: { in: ['EXT-777'] } },
              { nombre: { in: ['Servicio de aseo histórico XYZ'] } },
              { codigoProceso: { in: ['Servicio de aseo histórico XYZ'] } },
            ],
          },
        },
      ],
    };
    // El candidato 1 (externalId NULL, codigoProceso NULL) evalúa a UNKNOWN → se pierde.
    expect(evalCond(shapeAnterior, PROCESOS[0])).toBeNull();
    expect(PROCESOS.filter((p) => evalCond(shapeAnterior, p) === true).map((p) => p.id)).toEqual([]);

    // La forma NUEVA conserva 1 y 6.
    const shapeNueva = {
      AND: [
        { noViable: false },
        { id: { notIn: [10, 4] } },
        { OR: [{ externalId: null }, { externalId: { notIn: ['EXT-777'] } }] },
        { OR: [{ nombre: null }, { nombre: { notIn: ['Servicio de aseo histórico XYZ'] } }] },
        { OR: [{ codigoProceso: null }, { codigoProceso: { notIn: ['Servicio de aseo histórico XYZ'] } }] },
        { OR: [{ oculto: null }, { oculto: false }] },
      ],
    };
    expect(PROCESOS.filter((p) => evalCond(shapeNueva, p) === true).map((p) => p.id).sort()).toEqual([1, 6]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG-1: el filtro de ESTADO TERMINAL era `NOT { OR: [ ...contains... ] }` a
// secas → NULL-unsafe: una fila con `estadoFuente = NULL` (estado desconocido,
// que NO es terminal) se descartaba porque `NOT(UNKNOWN) = UNKNOWN`. Ahora es
// `{ OR: [ { estadoFuente: null }, { NOT: { OR: [ ...contains... ] } } ] }`,
// conservando EXACTAMENTE la semántica `contains` para todo texto no nulo.
// ─────────────────────────────────────────────────────────────────────────────
describe('sin-gestionar — filtro de estado terminal NULL-safe (BUG-1)', () => {
  const baseE = {
    entidad: 'Municipio', objeto: 'Obj', fuente: 'NC', aliasFuente: 'NC', modalidad: 'MC',
    perfil: null, departamento: 'Arauca',
    fechaPublicacion: new Date('2026-08-01T00:00:00Z'),
    fechaVencimiento: new Date('2027-01-01T00:00:00Z'), // vigente
    valor: 1000, linkDetalle: '', linkSecop: '', linkSecopReg: '',
    totalCronogramas: 0, totalDocumentos: 0, lastSyncedAt: null, rawJson: null,
    externalId: null, codigoProceso: null, nombre: 'X',
    noViable: false, observacionNoViable: null, noViableRegistradoPor: null, noViableFecha: null,
  };
  const PROCESOS_E = [
    { ...baseE, id: 100, estadoFuente: null,                              nombre: 'estado desconocido' }, // KEEP
    { ...baseE, id: 101, estadoFuente: 'Cerrado',                         nombre: 'cerrado exacto' },     // EXCLUDE
    { ...baseE, id: 102, estadoFuente: 'Vencido 2024',                    nombre: 'vencido con año' },    // EXCLUDE (contains 'vencido')
    { ...baseE, id: 103, estadoFuente: 'Convocatoria',                    nombre: 'convocatoria' },       // KEEP
    { ...baseE, id: 104, estadoFuente: 'No aplica',                       nombre: 'no aplica' },          // KEEP
    { ...baseE, id: 105, estadoFuente: 'Proceso terminado anormalmente',  nombre: 'terminado' },          // EXCLUDE (contains 'terminado')
    { ...baseE, id: 106, estadoFuente: 'Adjudicado el 2026',             nombre: 'adjudicado' },          // EXCLUDE (contains 'adjudicado')
  ];
  const filtraE = (where: Record<string, unknown>) => PROCESOS_E.filter((p) => evalCond(where, p) === true);
  let whereE: Record<string, unknown> | null = null;

  beforeEach(() => {
    whereE = null;
    // Sin solicitudes → aísla el filtro de estado (ninguna exclusión por identidad).
    prismaMock.solicitud.findMany.mockReset().mockResolvedValue([]);
    prismaMock.proceso.count.mockReset().mockImplementation(async ({ where }) => filtraE(where).length);
    prismaMock.proceso.findMany.mockReset().mockImplementation(async ({ where }) => {
      if (where && 'OR' in where && !('AND' in where)) return []; // sub-consulta llave (no aplica sin solicitudes)
      whereE = where;
      return filtraE(where);
    });
  });

  const idsVisibles = async () => {
    const body = await (await GET(req())).json();
    return (body.procesos as { procesoId: number }[]).map((p) => p.procesoId).sort((a, b) => a - b);
  };

  it('1) estadoFuente = null + vigente + no gestionado → INCLUIDO', async () => {
    expect(await idsVisibles()).toContain(100);
  });

  it('2) estadoFuente = "Cerrado" → EXCLUIDO', async () => {
    expect(await idsVisibles()).not.toContain(101);
  });

  it('3) estadoFuente = "Vencido 2024" → EXCLUIDO (se preserva la semántica `contains`)', async () => {
    expect(await idsVisibles()).not.toContain(102);
  });

  it('4) estadoFuente = "Convocatoria" → INCLUIDO', async () => {
    expect(await idsVisibles()).toContain(103);
  });

  it('5) estadoFuente = "No aplica" → INCLUIDO', async () => {
    expect(await idsVisibles()).toContain(104);
  });

  it('otros textos terminales por `contains` ("...terminado...", "Adjudicado...") siguen EXCLUIDOS', async () => {
    const ids = await idsVisibles();
    expect(ids).not.toContain(105);
    expect(ids).not.toContain(106);
  });

  it('resultado exacto: solo estados no terminales y el desconocido (null)', async () => {
    expect(await idsVisibles()).toEqual([100, 103, 104]);
  });

  it('la forma del `where` es `{ OR: [ { estadoFuente: null }, { NOT: { OR: [contains...] } } ] }` (no un NOT { OR } pelado)', async () => {
    await GET(req());
    const and = (whereE as { AND: Record<string, unknown>[] }).AND;
    // NO existe una condición de estado que sea un NOT { OR:[contains] } de nivel superior.
    const notOrPelado = and.some((c) => {
      const inner = (c as { NOT?: { OR?: { estadoFuente?: unknown }[] } }).NOT?.OR;
      return Array.isArray(inner) && inner.every((x) => 'estadoFuente' in x);
    });
    expect(notOrPelado).toBe(false);
    // SÍ existe el OR con rama `{ estadoFuente: null }`.
    const conRamaNull = and.some((c) => {
      const or = (c as { OR?: Record<string, unknown>[] }).OR;
      return Array.isArray(or) && or.some((r) => JSON.stringify(r) === JSON.stringify({ estadoFuente: null }));
    });
    expect(conRamaNull).toBe(true);
  });

  it('6) NO altera el bloque NULL-safe de identidad ya corregido', async () => {
    // Con solicitudes presentes, las condiciones de identidad NULL-safe siguen intactas.
    prismaMock.solicitud.findMany.mockResolvedValue([
      { procesoId: 101, codigoProceso: null, entidad: null, externalId: 'EXT-9', nombreProceso: 'N-9' },
    ]);
    prismaMock.proceso.findMany.mockImplementation(async ({ where }) => {
      if (where && 'OR' in where && !('AND' in where)) return [];
      whereE = where;
      return filtraE(where);
    });
    await GET(req());
    const and = (whereE as { AND: Record<string, unknown>[] }).AND;
    expect(and).toContainEqual({ id: { notIn: [101] } });
    expect(and).toContainEqual({ OR: [{ externalId: null }, { externalId: { notIn: ['EXT-9'] } }] });
    expect(and).toContainEqual({ OR: [{ nombre: null }, { nombre: { notIn: ['N-9'] } }] });
    expect(and).toContainEqual({ OR: [{ codigoProceso: null }, { codigoProceso: { notIn: ['N-9'] } }] });
  });
});
