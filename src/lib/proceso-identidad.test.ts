import { describe, it, expect, beforeEach } from 'vitest';
import {
  normalizarCodigoProceso, normalizarEntidad, construirLlaveNegocio, llaveNegocioValida,
  resolverProcesoPorLlaveNegocio, resolverProcesoPorExternalId, resolverIdentidadProceso,
  buscarOCrearProceso, resolverProcesoIdParaLinkDetalle, puedeActualizarProcesoDesdeFuenteExterna,
  puedeRevalidarLinkExistente, resolverProcesoIdParaRevalidacionLink,
  type ProcesoIdentidad, type PrismaTx,
} from './proceso-identidad';

/**
 * Fake in-memory de la parte de Prisma que usa proceso-identidad.ts — no es
 * un mock de Prisma completo, solo implementa exactamente las formas de
 * consulta que el módulo genera (findUnique por id, findMany por codigoProceso
 * insensitive, findFirst por externalId/sourceKey, create). Suficiente para
 * probar el ALGORITMO de resolución de identidad sin una base de datos real.
 */
function crearFakeTx(seed: ProcesoIdentidad[] = []): { tx: PrismaTx; datos: ProcesoIdentidad[] } {
  const datos = [...seed];
  let nextId = (datos.reduce((m, p) => Math.max(m, p.id), 0) || 0) + 1;

  const tx = {
    proceso: {
      async findUnique({ where }: { where: { id: number } }) {
        return datos.find((p) => p.id === where.id) ?? null;
      },
      async findFirst({ where }: { where: { OR: Array<{ externalId?: string; sourceKey?: string }> } }) {
        return datos.find((p) =>
          where.OR.some((cond) =>
            (cond.externalId !== undefined && p.externalId === cond.externalId) ||
            (cond.sourceKey !== undefined && p.sourceKey === cond.sourceKey)
          )
        ) ?? null;
      },
      async findMany({ where }: { where: { OR: Array<{ codigoProceso: { contains: string } }> } }) {
        const variantes = where.OR.map((c) => c.codigoProceso.contains.toLowerCase());
        return datos.filter((p) => {
          const cod = (p.codigoProceso ?? '').toLowerCase();
          return variantes.some((v) => cod.includes(v));
        });
      },
      async create({ data }: { data: Omit<ProcesoIdentidad, 'id'> }) {
        const nuevo: ProcesoIdentidad = { id: nextId++, ...data };
        datos.push(nuevo);
        return nuevo;
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as PrismaTx;

  return { tx, datos };
}

describe('normalizarCodigoProceso', () => {
  it('trata como equivalentes las variantes de formato del mismo número', () => {
    const variantes = ['No. 001-2026', 'No 001-2026', '001-2026', '001 / 2026', 'NO. 001-2026'];
    const normalizados = variantes.map(normalizarCodigoProceso);
    for (const n of normalizados) expect(n).toBe('001-2026');
  });

  it('no elimina información sustancial del número', () => {
    expect(normalizarCodigoProceso('SAMC-CMC-CIDE-0001-2026')).toBe('samc-cmc-cide-0001-2026');
  });

  it('vacío/null da string vacío', () => {
    expect(normalizarCodigoProceso(null)).toBe('');
    expect(normalizarCodigoProceso('')).toBe('');
  });
});

describe('normalizarEntidad', () => {
  it('aplica trim, minúsculas y colapsa espacios repetidos', () => {
    expect(normalizarEntidad('  Concejo   Municipal   de Fortul  ')).toBe('concejo municipal de fortul');
  });

  it('quita acentos', () => {
    expect(normalizarEntidad('Bogotá D.C.')).toBe('bogota d.c.');
  });

  it('NO aplica equivalencias semánticas (Concejo Mpal. != Concejo Municipal)', () => {
    expect(normalizarEntidad('Concejo Mpal. de Fortul')).not.toBe(normalizarEntidad('Concejo Municipal de Fortul'));
  });

  // Ronda 2 (verificación 32 procesos): ruido final de captura/sincronización.
  it('recorta asteriscos finales (Superintendencia de Transporte**)', () => {
    expect(normalizarEntidad('Superintendencia de Transporte**')).toBe('superintendencia de transporte');
  });

  it('recorta combinaciones finales asterisco+barra (MINTRABAJO NIVEL CENTRAL*/)', () => {
    expect(normalizarEntidad('MINTRABAJO NIVEL CENTRAL*/')).toBe('mintrabajo nivel central');
  });

  it('recorta un solo asterisco final (MUNICIPIO DE ENVIGADO*)', () => {
    expect(normalizarEntidad('MUNICIPIO DE ENVIGADO*')).toBe('municipio de envigado');
  });

  it('NO elimina puntos finales (no es parte del ruido solicitado — ej. "MUNICIPIO DE SOACHA..")', () => {
    expect(normalizarEntidad('MUNICIPIO DE SOACHA..')).toBe('municipio de soacha..');
  });

  it('NO elimina asteriscos o barras internos, solo los finales', () => {
    expect(normalizarEntidad('Concejo * Municipal')).toBe('concejo * municipal');
  });

  it('dos entidades que solo difieren por ruido final normalizan igual', () => {
    expect(normalizarEntidad('Superintendencia de Transporte**'))
      .toBe(normalizarEntidad('Superintendencia de Transporte'));
  });
});

describe('construirLlaveNegocio', () => {
  it('combina código y entidad normalizados', () => {
    expect(construirLlaveNegocio('No. 001-2026', 'Concejo Municipal de Fortul'))
      .toBe('001-2026|concejo municipal de fortul');
  });

  it('llaves de la misma entidad y variantes de formato de código son iguales', () => {
    const a = construirLlaveNegocio('No. 001-2026', 'El Grupo Honor & Laurel');
    const b = construirLlaveNegocio('001-2026', 'el grupo honor & laurel');
    expect(a).toBe(b);
  });
});

describe('llaveNegocioValida', () => {
  it('false si falta código o entidad', () => {
    expect(llaveNegocioValida('', 'X')).toBe(false);
    expect(llaveNegocioValida('001-2026', '')).toBe(false);
    expect(llaveNegocioValida(null, null)).toBe(false);
  });
  it('true si ambos están presentes', () => {
    expect(llaveNegocioValida('001-2026', 'X')).toBe(true);
  });
});

// ── Caso 1: mismo número, entidades diferentes ─────────────────────────────
describe('Caso 1 — mismo número de proceso, entidades diferentes (Fortul vs. Honor & Laurel)', () => {
  const FORTUL: ProcesoIdentidad = {
    id: 7050, externalId: '11786506', sourceKey: 'ext:11786506',
    codigoProceso: 'No. 001-2026', entidad: 'CONCEJO MUNICIPAL DE FORTUL',
  };
  const HONOR_LAUREL: ProcesoIdentidad = {
    id: 9001, externalId: null, sourceKey: 'manual:550e8400-e29b-41d4-a716-446655440000',
    codigoProceso: 'No. 001-2026', entidad: 'El Grupo Honor & Laurel',
  };

  let tx: PrismaTx;
  beforeEach(() => { ({ tx } = crearFakeTx([FORTUL, HONOR_LAUREL])); });

  it('cada entidad resuelve a su propio Proceso.id — nunca se mezclan', async () => {
    const resFortul = await resolverProcesoPorLlaveNegocio(tx, 'No. 001-2026', 'CONCEJO MUNICIPAL DE FORTUL');
    const resHonor  = await resolverProcesoPorLlaveNegocio(tx, 'No. 001-2026', 'El Grupo Honor & Laurel');

    expect(resFortul.proceso?.id).toBe(7050);
    expect(resHonor.proceso?.id).toBe(9001);
    expect(resFortul.proceso?.id).not.toBe(resHonor.proceso?.id);
    expect(resFortul.ambiguo).toBe(false);
    expect(resHonor.ambiguo).toBe(false);
  });

  it('resolverIdentidadProceso nunca cruza por compartir solo el código', async () => {
    // Se pide resolver "el proceso de Honor & Laurel" — no debe devolver Fortul
    // aunque comparta codigoProceso, ni al revés.
    const resultado = await resolverIdentidadProceso(tx, {
      codigoProceso: 'No. 001-2026', entidad: 'El Grupo Honor & Laurel',
    });
    expect(resultado.proceso?.id).toBe(9001);
    expect(resultado.metodo).toBe('llaveNegocio');
  });

  it('externalId de Fortul nunca resuelve a Honor & Laurel', async () => {
    const proceso = await resolverProcesoPorExternalId(tx, '11786506');
    expect(proceso?.id).toBe(7050);
  });
});

// ── Caso 2: mismo número y misma entidad ───────────────────────────────────
describe('Caso 2 — registrar manualmente dos veces el mismo proceso (mismo código+entidad)', () => {
  it('la segunda vez reutiliza el Proceso.id existente, no crea uno nuevo', async () => {
    const { tx, datos } = crearFakeTx();

    const primera = await buscarOCrearProceso(tx, {
      codigoProceso: 'No. 001-2026', entidad: 'El Grupo Honor & Laurel', aliasFuente: 'NC',
    });
    expect(primera.creado).toBe(true);
    expect(datos).toHaveLength(1);

    const segunda = await buscarOCrearProceso(tx, {
      codigoProceso: '001-2026', entidad: 'el grupo honor & laurel', aliasFuente: 'NC',
    });
    expect(segunda.creado).toBe(false);
    expect(segunda.proceso.id).toBe(primera.proceso.id);
    expect(datos).toHaveLength(1); // no se duplicó
  });

  it('el Proceso manual creado tiene sourceKey único con formato manual:<uuid>', async () => {
    const { tx } = crearFakeTx();
    const uuidFijo = '550e8400-e29b-41d4-a716-446655440000';
    const { proceso } = await buscarOCrearProceso(tx, {
      codigoProceso: '001-2026', entidad: 'El Grupo Honor & Laurel', aliasFuente: 'NC',
      generarUuid: () => uuidFijo,
    });
    expect(proceso.sourceKey).toBe(`manual:${uuidFijo}`);
    expect(proceso.externalId).toBeNull();
  });
});

// ── Caso 3: importado con procesoId ────────────────────────────────────────
describe('Caso 3 — proceso importado, se envía procesoId', () => {
  it('se resuelve directo por procesoId, sin tocar codigoProceso', async () => {
    const { tx } = crearFakeTx([
      { id: 7050, externalId: '11786506', sourceKey: 'ext:11786506', codigoProceso: 'No. 001-2026', entidad: 'CONCEJO MUNICIPAL DE FORTUL' },
    ]);
    const resultado = await resolverIdentidadProceso(tx, { procesoId: 7050 });
    expect(resultado.metodo).toBe('procesoId');
    expect(resultado.proceso?.id).toBe(7050);
  });
});

// ── Caso 4: importado sin procesoId, con externalId ────────────────────────
describe('Caso 4 — proceso importado sin procesoId, con externalId', () => {
  it('se resuelve por externalId/sourceKey', async () => {
    const { tx } = crearFakeTx([
      { id: 7050, externalId: '11786506', sourceKey: 'ext:11786506', codigoProceso: 'No. 001-2026', entidad: 'CONCEJO MUNICIPAL DE FORTUL' },
    ]);
    const resultado = await resolverIdentidadProceso(tx, { externalId: '11786506' });
    expect(resultado.metodo).toBe('externalId');
    expect(resultado.proceso?.id).toBe(7050);
  });
});

// ── Caso 5: mismo código, entidad diferente — no debe marcar como gestionado ──
describe('Caso 5 — una Solicitud de la Entidad A no debe resolver al Proceso de la Entidad B', () => {
  it('llave de negocio de A nunca hace match con Proceso de B', async () => {
    const { tx } = crearFakeTx([
      { id: 7050, externalId: '11786506', sourceKey: 'ext:11786506', codigoProceso: 'No. 001-2026', entidad: 'CONCEJO MUNICIPAL DE FORTUL' },
    ]);
    const resultado = await resolverProcesoPorLlaveNegocio(tx, 'No. 001-2026', 'El Grupo Honor & Laurel');
    expect(resultado.proceso).toBeNull();
    expect(resultado.ambiguo).toBe(false);
  });
});

// ── Ambigüedad: dos Proceso con la misma llave de negocio (dato corrupto) ──
describe('Ambigüedad — más de un Proceso con la misma llave de negocio', () => {
  it('no elige silenciosamente el primero ni el último: devuelve ambiguo=true', async () => {
    const { tx } = crearFakeTx([
      { id: 1, externalId: null, sourceKey: 'manual:aaa', codigoProceso: '001-2026', entidad: 'Duplicado S.A.S' },
      { id: 2, externalId: null, sourceKey: 'manual:bbb', codigoProceso: '001-2026', entidad: 'Duplicado S.A.S' },
    ]);
    const resultado = await resolverProcesoPorLlaveNegocio(tx, '001-2026', 'Duplicado S.A.S');
    expect(resultado.proceso).toBeNull();
    expect(resultado.ambiguo).toBe(true);
  });

  it('buscarOCrearProceso lanza error en vez de crear un tercer duplicado', async () => {
    const { tx } = crearFakeTx([
      { id: 1, externalId: null, sourceKey: 'manual:aaa', codigoProceso: '001-2026', entidad: 'Duplicado S.A.S' },
      { id: 2, externalId: null, sourceKey: 'manual:bbb', codigoProceso: '001-2026', entidad: 'Duplicado S.A.S' },
    ]);
    await expect(buscarOCrearProceso(tx, { codigoProceso: '001-2026', entidad: 'Duplicado S.A.S' }))
      .rejects.toThrow(/ambigua|más de un proceso/i);
  });
});

// ── Riesgo de coincidencia parcial de `contains` (auditoría) ──────────────
// El fetch de candidatos en SQL usa `contains` (sobre-búsqueda deliberada);
// estas pruebas confirman que, aunque `contains` traiga falsos positivos por
// substring, la decisión FINAL de resolverProcesoPorLlaveNegocio nunca los
// acepta — solo pasa lo que coincide con la llave de negocio EXACTA normalizada.
describe('Riesgo de contains — coincidencias parciales no deben considerarse el mismo proceso', () => {
  it('Caso A: "001-2026" no es el mismo proceso que "1001-2026" (misma entidad)', async () => {
    const { tx } = crearFakeTx([
      { id: 1, externalId: null, sourceKey: 'manual:a', codigoProceso: '1001-2026', entidad: 'Empresa X' },
    ]);
    const resultado = await resolverProcesoPorLlaveNegocio(tx, '001-2026', 'Empresa X');
    expect(resultado.proceso).toBeNull(); // "1001-2026" contiene "001-2026" pero NO es el mismo código
    expect(resultado.ambiguo).toBe(false);
  });

  it('Caso B: "001-2026" no es el mismo proceso que "MC-001-2026" (misma entidad)', async () => {
    const { tx } = crearFakeTx([
      { id: 1, externalId: null, sourceKey: 'manual:a', codigoProceso: 'MC-001-2026', entidad: 'Empresa X' },
    ]);
    const resultado = await resolverProcesoPorLlaveNegocio(tx, '001-2026', 'Empresa X');
    expect(resultado.proceso).toBeNull();
    expect(resultado.ambiguo).toBe(false);
  });

  it('Caso C: "No. 001-2026" SÍ equivale a "001-2026" (misma entidad)', async () => {
    const { tx } = crearFakeTx([
      { id: 1, externalId: null, sourceKey: 'manual:a', codigoProceso: '001-2026', entidad: 'Empresa X' },
    ]);
    const resultado = await resolverProcesoPorLlaveNegocio(tx, 'No. 001-2026', 'Empresa X');
    expect(resultado.proceso?.id).toBe(1);
  });

  it('Caso D: "001 / 2026" SÍ equivale a "No 001-2026" (misma entidad)', async () => {
    const { tx } = crearFakeTx([
      { id: 1, externalId: null, sourceKey: 'manual:a', codigoProceso: 'No 001-2026', entidad: 'Empresa X' },
    ]);
    const resultado = await resolverProcesoPorLlaveNegocio(tx, '001 / 2026', 'Empresa X');
    expect(resultado.proceso?.id).toBe(1);
  });

  it('un candidato con código "001-20260" (número distinto con sufijo) tampoco se confunde', async () => {
    const { tx } = crearFakeTx([
      { id: 1, externalId: null, sourceKey: 'manual:a', codigoProceso: '001-20260', entidad: 'Empresa X' },
    ]);
    const resultado = await resolverProcesoPorLlaveNegocio(tx, '001-2026', 'Empresa X');
    expect(resultado.proceso).toBeNull();
  });

  it('AMC-001-2026 tampoco se confunde con 001-2026', async () => {
    const { tx } = crearFakeTx([
      { id: 1, externalId: null, sourceKey: 'manual:a', codigoProceso: 'AMC-001-2026', entidad: 'Empresa X' },
    ]);
    const resultado = await resolverProcesoPorLlaveNegocio(tx, '001-2026', 'Empresa X');
    expect(resultado.proceso).toBeNull();
  });

  it('cuatro códigos "parecidos" con la MISMA entidad conservan llaves de negocio distintas', () => {
    const entidad = 'Empresa X';
    const llaves = ['001-2026', '1001-2026', 'MC-001-2026', '001-20260'].map((c) => construirLlaveNegocio(c, entidad));
    expect(new Set(llaves).size).toBe(4); // las 4 son distintas entre sí
  });
});

// ── Normalización de entidad — espacios y mayúsculas (auditoría) ─────────
describe('normalizarEntidad / construirLlaveNegocio — variantes de espacio y mayúsculas', () => {
  const variantes = [
    'CONCEJO MUNICIPAL DE FORTUL',
    'CONCEJO  MUNICIPAL DE FORTUL',   // espacio interno doble
    'CONCEJO MUNICIPAL DE FORTUL ',   // espacio final
    ' CONCEJO MUNICIPAL DE FORTUL',   // espacio inicial
    'concejo municipal de fortul',    // minúsculas
  ];

  it('todas las variantes normalizan al mismo valor', () => {
    const normalizados = variantes.map(normalizarEntidad);
    for (const n of normalizados) expect(n).toBe('concejo municipal de fortul');
  });

  it('todas producen la misma llave de negocio combinadas con variantes de código', () => {
    const llaves = variantes.map((e) => construirLlaveNegocio('No. 001-2026', e));
    expect(new Set(llaves).size).toBe(1);
    expect(llaves[0]).toBe('001-2026|concejo municipal de fortul');
  });

  it('resolverProcesoPorLlaveNegocio encuentra el proceso pese a espacios distintos en la entidad guardada', async () => {
    const { tx } = crearFakeTx([
      { id: 1, externalId: null, sourceKey: 'manual:a', codigoProceso: 'No. 001-2026', entidad: 'CONCEJO  MUNICIPAL DE FORTUL ' },
    ]);
    const resultado = await resolverProcesoPorLlaveNegocio(tx, '001-2026', 'concejo municipal de fortul');
    expect(resultado.proceso?.id).toBe(1);
  });
});

// ── Salida de normalizarCodigoProceso / construirLlaveNegocio para inspección ──
describe('Salida exacta de normalización (para inspección de la auditoría)', () => {
  it.each([
    ['001-2026', '001-2026'],
    ['1001-2026', '1001-2026'],
    ['MC-001-2026', 'mc-001-2026'],
    ['001-20260', '001-20260'],
    ['No. 001-2026', '001-2026'],
    ['001 / 2026', '001-2026'],
    ['No 001-2026', '001-2026'],
  ])('normalizarCodigoProceso(%s) === %s', (entrada, esperado) => {
    expect(normalizarCodigoProceso(entrada)).toBe(esperado);
  });

  it('construirLlaveNegocio para los pares de la auditoría', () => {
    const salida = {
      '001-2026|EmpresaX': construirLlaveNegocio('001-2026', 'EmpresaX'),
      '1001-2026|EmpresaX': construirLlaveNegocio('1001-2026', 'EmpresaX'),
      'MC-001-2026|EmpresaX': construirLlaveNegocio('MC-001-2026', 'EmpresaX'),
      'No. 001-2026|EmpresaX': construirLlaveNegocio('No. 001-2026', 'EmpresaX'),
      '001 / 2026|EmpresaX': construirLlaveNegocio('001 / 2026', 'EmpresaX'),
    };
    expect(salida).toEqual({
      '001-2026|EmpresaX': '001-2026|empresax',
      '1001-2026|EmpresaX': '1001-2026|empresax',
      'MC-001-2026|EmpresaX': 'mc-001-2026|empresax',
      'No. 001-2026|EmpresaX': '001-2026|empresax',
      '001 / 2026|EmpresaX': '001-2026|empresax',
    });
  });
});

describe('resolverIdentidadProceso — rechazo por datos insuficientes', () => {
  it('sin procesoId, externalId ni codigoProceso+entidad válidos, no resuelve nada', async () => {
    const { tx } = crearFakeTx();
    const resultado = await resolverIdentidadProceso(tx, {});
    expect(resultado.proceso).toBeNull();
    expect(resultado.metodo).toBe('ninguno');
  });
});

describe('resolverProcesoIdParaLinkDetalle — resolver-link-detalle sin codigoProceso solo', () => {
  const MC002_CALI: ProcesoIdentidad = {
    id: 4289, externalId: '11628835', sourceKey: 'ext:11628835',
    codigoProceso: 'MC-002-2026', entidad: 'CONCEJO DISTRITAL DE SANTIAGO DE CALI',
  };
  const MC002_CONTADERO: ProcesoIdentidad = {
    id: 3762, externalId: '11608868', sourceKey: 'ext:11608868',
    codigoProceso: 'MC-002-2026', entidad: 'NARIÑO - CONCEJO MUNICIPAL DE CONTADERO',
  };

  it('resuelve directo por id, sin necesidad de código ni entidad', async () => {
    const { tx } = crearFakeTx([MC002_CALI, MC002_CONTADERO]);
    const resultado = await resolverProcesoIdParaLinkDetalle(tx, { id: 4289 });
    expect(resultado).toEqual({ ok: true, procesoId: 4289 });
  });

  it('id inexistente → no_encontrado (nunca cae a buscar por código)', async () => {
    const { tx } = crearFakeTx([MC002_CALI]);
    const resultado = await resolverProcesoIdParaLinkDetalle(tx, { id: 999999, codigoProceso: 'MC-002-2026', entidad: 'CONCEJO DISTRITAL DE SANTIAGO DE CALI' });
    expect(resultado).toEqual({ ok: false, motivo: 'no_encontrado' });
  });

  it('resuelve por externalId cuando no hay id', async () => {
    const { tx } = crearFakeTx([MC002_CALI, MC002_CONTADERO]);
    const resultado = await resolverProcesoIdParaLinkDetalle(tx, { externalId: '11628835' });
    expect(resultado).toEqual({ ok: true, procesoId: 4289 });
  });

  it('resuelve por sourceKey ext: cuando no hay id ni externalId', async () => {
    const { tx } = crearFakeTx([MC002_CALI, MC002_CONTADERO]);
    const resultado = await resolverProcesoIdParaLinkDetalle(tx, { sourceKey: 'ext:11628835' });
    expect(resultado).toEqual({ ok: true, procesoId: 4289 });
  });

  // CASO E — código repetido y sin entidad: debe rechazarse, no findFirst.
  it('CASO E — codigoProceso repetido entre entidades y SIN entidad → entidad_requerida', async () => {
    const { tx } = crearFakeTx([MC002_CALI, MC002_CONTADERO]);
    const resultado = await resolverProcesoIdParaLinkDetalle(tx, { codigoProceso: 'MC-002-2026' });
    expect(resultado).toEqual({ ok: false, motivo: 'entidad_requerida' });
  });

  it('codigoProceso ÚNICO pero sin entidad → igual se rechaza (regla es "sin entidad = ambiguo", no solo cuando hay colisión real)', async () => {
    const { tx } = crearFakeTx([MC002_CALI]);
    const resultado = await resolverProcesoIdParaLinkDetalle(tx, { codigoProceso: 'FDLSF-LP-001-2026' });
    expect(resultado).toEqual({ ok: false, motivo: 'entidad_requerida' });
  });

  // CASO F — código repetido CON entidad: debe resolver la entidad correcta.
  it('CASO F — codigoProceso repetido CON entidad → resuelve el proceso correcto, nunca el otro', async () => {
    const { tx } = crearFakeTx([MC002_CALI, MC002_CONTADERO]);
    const resultado = await resolverProcesoIdParaLinkDetalle(tx, { codigoProceso: 'MC-002-2026', entidad: 'CONCEJO DISTRITAL DE SANTIAGO DE CALI' });
    expect(resultado).toEqual({ ok: true, procesoId: 4289 });
  });

  it('CASO F — la misma búsqueda con la otra entidad resuelve al otro proceso', async () => {
    const { tx } = crearFakeTx([MC002_CALI, MC002_CONTADERO]);
    const resultado = await resolverProcesoIdParaLinkDetalle(tx, { codigoProceso: 'MC-002-2026', entidad: 'NARIÑO - CONCEJO MUNICIPAL DE CONTADERO' });
    expect(resultado).toEqual({ ok: true, procesoId: 3762 });
  });

  // CASO G — entidad con caracteres finales de ruido: deben considerarse equivalentes.
  it('CASO G — entidad con asteriscos finales resuelve igual que sin ellos', async () => {
    const SAMC002_TRANSPORTE: ProcesoIdentidad = {
      id: 5514, externalId: '11700000', sourceKey: 'ext:11700000',
      codigoProceso: 'SAMC-002-2026', entidad: 'Superintendencia de Transporte**',
    };
    const { tx } = crearFakeTx([SAMC002_TRANSPORTE]);
    const resultado = await resolverProcesoIdParaLinkDetalle(tx, { codigoProceso: 'SAMC-002-2026', entidad: 'Superintendencia de Transporte' });
    expect(resultado).toEqual({ ok: true, procesoId: 5514 });
  });

  it('CASO G — pero entidades REALMENTE distintas no se confunden por tener ruido similar', async () => {
    const SAMC002_TRANSPORTE: ProcesoIdentidad = {
      id: 5514, externalId: '11700000', sourceKey: 'ext:11700000',
      codigoProceso: 'SAMC-002-2026', entidad: 'Superintendencia de Transporte**',
    };
    const SAMC002_ARCHIVO: ProcesoIdentidad = {
      id: 6428, externalId: '11700001', sourceKey: 'ext:11700001',
      codigoProceso: 'SAMC-002-2026', entidad: 'ARCHIVO GENERAL DE LA NACION',
    };
    const { tx } = crearFakeTx([SAMC002_TRANSPORTE, SAMC002_ARCHIVO]);
    const resultado = await resolverProcesoIdParaLinkDetalle(tx, { codigoProceso: 'SAMC-002-2026', entidad: 'ARCHIVO GENERAL DE LA NACION' });
    expect(resultado).toEqual({ ok: true, procesoId: 6428 });
  });

  it('sin id, externalId, sourceKey ni codigoProceso → no_encontrado', async () => {
    const { tx } = crearFakeTx([MC002_CALI]);
    const resultado = await resolverProcesoIdParaLinkDetalle(tx, {});
    expect(resultado).toEqual({ ok: false, motivo: 'no_encontrado' });
  });
});

describe('puedeActualizarProcesoDesdeFuenteExterna — botón/endpoint "Actualizar ficha"', () => {
  // CASO 1 — manual normal
  it('CASO 1 — sourceKey manual: y sin externalId → false', () => {
    expect(puedeActualizarProcesoDesdeFuenteExterna({ sourceKey: 'manual:550e8400-e29b-41d4-a716-446655440000', externalId: null })).toBe(false);
  });

  // CASO 2 — manual con externalId accidentalmente informado
  it('CASO 2 — sourceKey manual: aunque externalId venga informado → false', () => {
    expect(puedeActualizarProcesoDesdeFuenteExterna({ sourceKey: 'manual:550e8400-e29b-41d4-a716-446655440000', externalId: '11786506' })).toBe(false);
  });

  // CASO 3 — externo correcto (ej. Fortul, Proceso.id=7050)
  it('CASO 3 — sourceKey ext: con externalId coherente → true', () => {
    expect(puedeActualizarProcesoDesdeFuenteExterna({ sourceKey: 'ext:11786506', externalId: '11786506' })).toBe(true);
  });

  // CASO 4 — externalId sin sourceKey
  it('CASO 4 — externalId presente pero sin sourceKey → false', () => {
    expect(puedeActualizarProcesoDesdeFuenteExterna({ sourceKey: null, externalId: '11786506' })).toBe(false);
  });

  // CASO 5 — sourceKey externo sin externalId
  it('CASO 5 — sourceKey ext: pero sin externalId → false', () => {
    expect(puedeActualizarProcesoDesdeFuenteExterna({ sourceKey: 'ext:11786506', externalId: null })).toBe(false);
  });

  // CASO 6 — sourceKey vacío
  it('CASO 6 — sourceKey vacío → false', () => {
    expect(puedeActualizarProcesoDesdeFuenteExterna({ sourceKey: '', externalId: '11786506' })).toBe(false);
  });

  // CASO 7 — la fuente textual (NC/Manual) no debe hacerlo actualizable
  it('CASO 7 — la regla no depende del texto de "fuente"/aliasFuente, solo de externalId+sourceKey', () => {
    // Un proceso con sourceKey/externalId externos válidos es actualizable
    // sin importar qué diga el campo "fuente" — y viceversa, nada de lo que
    // diga "fuente" puede volver actualizable a uno manual.
    expect(puedeActualizarProcesoDesdeFuenteExterna({ sourceKey: 'manual:x', externalId: null })).toBe(false);
  });

  // CASO 8 — privado importado con identidad externa válida → true (no depende de Público/Privado)
  it('CASO 8 — proceso Privado (NC) pero con externalId/sourceKey ext: reales → true', () => {
    // Ej.: un proceso privado (aliasFuente=NC) que SÍ fue importado con un
    // externalId proveniente de una fuente histórica sincronizada, no uno
    // creado a mano.
    expect(puedeActualizarProcesoDesdeFuenteExterna({ sourceKey: 'ext:99999999', externalId: '99999999' })).toBe(true);
  });

  it('acepta externalId numérico (no solo string)', () => {
    expect(puedeActualizarProcesoDesdeFuenteExterna({ sourceKey: 'ext:11786506', externalId: 11786506 })).toBe(true);
  });

  it('sourceKey con mayúsculas EXT: también se reconoce (comparación case-insensitive)', () => {
    expect(puedeActualizarProcesoDesdeFuenteExterna({ sourceKey: 'EXT:11786506', externalId: '11786506' })).toBe(true);
  });

  it('objeto vacío → false', () => {
    expect(puedeActualizarProcesoDesdeFuenteExterna({})).toBe(false);
  });
});

describe('puedeRevalidarLinkExistente — solo SECOP II', () => {
  it('S2 externo → true (Ministerio del Interior)', () => {
    expect(puedeRevalidarLinkExistente({
      sourceKey: 'ext:11579101', externalId: '11579101', aliasFuente: 'S2',
    })).toBe(true);
  });

  it('S1 externo → false (Alcaldía Municipio de Hato — enlace único, sin concepto de relacionados)', () => {
    expect(puedeRevalidarLinkExistente({
      sourceKey: 'ext:11606920', externalId: '11606920', aliasFuente: 'S1',
    })).toBe(false);
  });

  it('NC/manual → false, aunque aliasFuente diga S2 por error de captura', () => {
    expect(puedeRevalidarLinkExistente({
      sourceKey: 'manual:1b41a9a4-a106-4777-93e5-60014f58875c', externalId: null, aliasFuente: 'S2',
    })).toBe(false);
  });

  it('sourceKey manual con código como uuid y sin externalId → false aunque aliasFuente sea S2', () => {
    expect(puedeRevalidarLinkExistente({
      sourceKey: 'manual:SASI-CARDIQUE-011-2026', externalId: null, aliasFuente: 'S2',
    })).toBe(false);
  });

  it('S2 pero sin externalId → false (no es proceso externo actualizable)', () => {
    expect(puedeRevalidarLinkExistente({
      sourceKey: 'ext:', externalId: null, aliasFuente: 'S2',
    })).toBe(false);
  });

  it('aliasFuente en minúsculas "s2" → true (comparación case-insensitive)', () => {
    expect(puedeRevalidarLinkExistente({
      sourceKey: 'ext:11579101', externalId: '11579101', aliasFuente: 's2',
    })).toBe(true);
  });

  it('aliasFuente ausente → false', () => {
    expect(puedeRevalidarLinkExistente({
      sourceKey: 'ext:11579101', externalId: '11579101',
    })).toBe(false);
  });
});

describe('resolverProcesoIdParaRevalidacionLink — identidad segura para revalidación dirigida', () => {
  // Ministerio del Interior y Bomberos comparten codigoProceso (SAMC-001-2026),
  // como el caso real que motivó este endurecimiento.
  const MININTERIOR: ProcesoIdentidad = {
    id: 3176, externalId: '11579101', sourceKey: 'ext:11579101',
    codigoProceso: 'SAMC-001-2026', entidad: 'MINISTERIO DEL INTERIOR',
  };
  const BOMBEROS: ProcesoIdentidad = {
    id: 3764, externalId: '11609688', sourceKey: 'ext:11609688',
    codigoProceso: 'SAMC-001-2026', entidad: 'UNIDAD ADMINISTRATIVA ESPECIAL DIRECCION NACIONAL DE BOMBEROS',
  };

  it('CASO 1 — procesoId correcto + externalId correcto: permite revalidar', async () => {
    const { tx } = crearFakeTx([MININTERIOR, BOMBEROS]);
    const r = await resolverProcesoIdParaRevalidacionLink(tx, { procesoId: 3176, externalId: '11579101' });
    expect(r).toEqual({ ok: true, procesoId: 3176 });
  });

  it('CASO 2 — procesoId correcto + externalId de OTRO proceso: rechaza (nunca confía ciegamente en procesoId)', async () => {
    const { tx } = crearFakeTx([MININTERIOR, BOMBEROS]);
    const r = await resolverProcesoIdParaRevalidacionLink(tx, { procesoId: 3176, externalId: '11609688' });
    expect(r).toEqual({ ok: false, motivo: 'externalId_no_coincide' });
  });

  it('CASO 3 — código repetido, sin procesoId ni externalId, sin entidad: no revalida (entidad_requerida)', async () => {
    const { tx } = crearFakeTx([MININTERIOR, BOMBEROS]);
    const r = await resolverProcesoIdParaRevalidacionLink(tx, { codigoProceso: 'SAMC-001-2026' });
    expect(r).toEqual({ ok: false, motivo: 'entidad_requerida' });
  });

  it('CASO 4 — código + entidad exactos como fallback: resuelve solo porque la coincidencia es única', async () => {
    const { tx } = crearFakeTx([MININTERIOR, BOMBEROS]);
    const r = await resolverProcesoIdParaRevalidacionLink(tx, {
      codigoProceso: 'SAMC-001-2026', entidad: 'MINISTERIO DEL INTERIOR',
    });
    expect(r).toEqual({ ok: true, procesoId: 3176 });
  });

  it('CASO 5 — Ministerio y Bomberos con el mismo código permanecen separados en ambas direcciones', async () => {
    const { tx } = crearFakeTx([MININTERIOR, BOMBEROS]);
    const rMin = await resolverProcesoIdParaRevalidacionLink(tx, { procesoId: 3176 });
    const rBomberos = await resolverProcesoIdParaRevalidacionLink(tx, { procesoId: 3764 });
    expect(rMin).toEqual({ ok: true, procesoId: 3176 });
    expect(rBomberos).toEqual({ ok: true, procesoId: 3764 });
    expect((rMin as { procesoId: number }).procesoId).not.toBe((rBomberos as { procesoId: number }).procesoId);
  });

  it('solo externalId (sin procesoId): resuelve por externalId/sourceKey sin tocar codigoProceso', async () => {
    const { tx } = crearFakeTx([MININTERIOR, BOMBEROS]);
    const r = await resolverProcesoIdParaRevalidacionLink(tx, { externalId: '11609688' });
    expect(r).toEqual({ ok: true, procesoId: 3764 });
  });

  it('procesoId inexistente: no_encontrado', async () => {
    const { tx } = crearFakeTx([MININTERIOR, BOMBEROS]);
    const r = await resolverProcesoIdParaRevalidacionLink(tx, { procesoId: 999999 });
    expect(r).toEqual({ ok: false, motivo: 'no_encontrado' });
  });

  it('sin procesoId, externalId, codigoProceso ni entidad: no_encontrado', async () => {
    const { tx } = crearFakeTx([MININTERIOR, BOMBEROS]);
    const r = await resolverProcesoIdParaRevalidacionLink(tx, {});
    expect(r).toEqual({ ok: false, motivo: 'no_encontrado' });
  });
});
