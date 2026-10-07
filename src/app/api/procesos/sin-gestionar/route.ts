import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { construirLlaveNegocio, variantesCodigoProceso } from '@/lib/proceso-identidad';
import { whereProcesoIdentificable } from '@/lib/procesos/proceso-identificable';

function parseIntSafe(v: string | null, fallback: number) {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isNaN(n) ? fallback : n;
}

function normalizarTexto(valor: string) {
  return String(valor || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function toArr(raw: string | null | undefined): string[] {
  return String(raw || '').split(',').map((s) => s.trim()).filter((s) => s && s !== 'all');
}

function modalidadCondition(mod: string) {
  const m = normalizarTexto(mod);
  if (m.includes('minima')) return { OR: [{ modalidad: { contains: mod, mode: 'insensitive' } }, { nombre: { contains: 'cuant', mode: 'insensitive' } }] };
  if (m.includes('licitaci')) return { OR: [{ modalidad: { contains: mod, mode: 'insensitive' } }, { nombre: { startsWith: 'Licitaci', mode: 'insensitive' } }] };
  if (m.includes('seleccion')) return { OR: [{ modalidad: { contains: mod, mode: 'insensitive' } }, { nombre: { startsWith: 'Selecci', mode: 'insensitive' } }] };
  if (m.includes('directa')) return { OR: [{ modalidad: { contains: mod, mode: 'insensitive' } }, { nombre: { startsWith: 'Contratación Directa', mode: 'insensitive' } }, { nombre: { contains: 'CONTRATACION DIRECTA', mode: 'insensitive' } }] };
  if (m.includes('meritos')) return { OR: [{ modalidad: { contains: mod, mode: 'insensitive' } }, { nombre: { startsWith: 'Concurso', mode: 'insensitive' } }] };
  if (m.includes('subasta')) return { OR: [{ modalidad: { contains: mod, mode: 'insensitive' } }, { nombre: { startsWith: 'Subasta', mode: 'insensitive' } }] };
  if (m.includes('especial')) return { OR: [{ modalidad: { contains: mod, mode: 'insensitive' } }, { nombre: { startsWith: 'Régimen', mode: 'insensitive' } }] };
  return { OR: [{ modalidad: { contains: mod, mode: 'insensitive' } }, { nombre: { contains: mod, mode: 'insensitive' } }] };
}

/**
 * Ajuste "PARIDAD DATA API — FUENTE" — `Proceso.aliasFuente` nunca se
 * escribe para filas creadas por la Data API (contrato canónico, ver
 * `mapeoCanonico.ts`), así que quedan con `aliasFuente = null`. El criterio
 * "público" también reconoce el equivalente canónico (`origenFuncional`),
 * y "privado" es el complemento EXACTO — nunca `{ not: 'S1' }, { not: 'S2' }`
 * a secas, que en Prisma incluye las filas NULL (ver `procesos/route.ts`,
 * mismo fix, caso real CP-019-JNCI-2026).
 */
function condicionPublico() {
  // Cada rama va envuelta en un AND con `{ campo: { not: null } }` — sin
  // esto, para una fila con `aliasFuente=null` (Data API) la rama de
  // aliasFuente evalúa UNKNOWN (no FALSE), y `UNKNOWN OR FALSE = UNKNOWN`:
  // el OR completo queda UNKNOWN y `NOT(UNKNOWN)` también, así que la fila
  // desaparece TANTO de público COMO de privado. Con el guard, cada rama es
  // estrictamente TRUE/FALSE (nunca UNKNOWN) y el NOT() del complemento
  // "privado" funciona para cualquier combinación de nulls.
  return {
    OR: [
      { AND: [{ aliasFuente: { not: null } }, { aliasFuente: { in: ['S1', 'S2'] } }] },
      { AND: [{ origenFuncional: { not: null } }, { origenFuncional: { in: ['PUBLICO_ABIERTO', 'PUBLICO_REGISTRADO'] } }] },
    ],
  };
}

function fuenteCondition(f: string) {
  const fl = normalizarTexto(f).trim();
  if (fl === 's2' || fl.includes('secop ii')) {
    return { OR: [{ aliasFuente: { equals: 'S2' } }, { AND: [{ aliasFuente: null }, { origenFuncional: 'PUBLICO_REGISTRADO' }] }] };
  }
  if (fl === 's1' || fl.includes('secop i')) {
    return { OR: [{ aliasFuente: { equals: 'S1' } }, { AND: [{ aliasFuente: null }, { origenFuncional: 'PUBLICO_ABIERTO' }] }] };
  }
  return { NOT: condicionPublico() };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const page  = Math.max(1, parseIntSafe(searchParams.get('page'), 1));
    const limit = Math.min(100, Math.max(1, parseIntSafe(searchParams.get('limit'), 30)));

    const query =
      searchParams.get('query')?.trim() ||
      searchParams.get('q')?.trim() ||
      searchParams.get('busqueda')?.trim() ||
      '';

    const fechaDesde = searchParams.get('fechaDesde')?.trim() ?? '';
    const fechaHasta = searchParams.get('fechaHasta')?.trim() ?? '';
    const cuantiaDesde = searchParams.get('cuantiaDesde')?.trim() ?? '';
    const cuantiaHasta = searchParams.get('cuantiaHasta')?.trim() ?? '';

    const perfilParam = searchParams.get('perfiles') || searchParams.get('perfil') || searchParams.get('entidadGrupo') || '';
    const fuenteParam = searchParams.get('fuentes') || searchParams.get('fuente') || searchParams.get('portal') || '';
    const estadoParam = searchParams.get('estados') || searchParams.get('estado') || '';
    const modalidadParam = searchParams.get('modalidades') || searchParams.get('modalidad') || '';
    const departamentoParam = searchParams.get('departamentos') || searchParams.get('departamento') || searchParams.get('dptos') || searchParams.get('dpto') || '';

    const perfilesArr = toArr(perfilParam);
    const fuentesArr  = toArr(fuenteParam);
    const estadosArr  = toArr(estadoParam);
    const modalsArr   = toArr(modalidadParam);
    const dptosArr    = toArr(departamentoParam);

    const noViableParam = searchParams.get('noViable');
    const soloNoViables = noViableParam === 'true';

    // Obtener solicitudes existentes para excluir procesos ya gestionados.
    // Se trae "entidad" — un proceso NO debe ocultarse del listado "sin
    // gestionar" solo porque OTRA entidad ya tenga una Solicitud con el mismo
    // codigoProceso (ver diagnóstico Fortul/Honor & Laurel).
    const solicitudes = await prisma.solicitud.findMany({
      select: { procesoId: true, codigoProceso: true, entidad: true, externalId: true, nombreProceso: true },
      where: { OR: [{ procesoId: { not: null } }, { codigoProceso: { not: null } }, { externalId: { not: null } }] },
    });

    const procesoIds  = [...new Set(solicitudes.map(s => s.procesoId).filter(Boolean))] as number[];
    const externalIds = [...new Set(solicitudes.map(s => s.externalId).filter(Boolean))] as string[];
    const nombres      = [...new Set(solicitudes.map(s => s.nombreProceso).filter(Boolean))] as string[];
    // Pares código+entidad válidos (llave de negocio) para exclusión precisa.
    const paresCodigoEntidad = [...new Map(
      solicitudes.filter(s => s.codigoProceso && s.entidad).map(s => [`${s.codigoProceso} ${s.entidad}`, s])
    ).values()];

    // ── Resolución en dos fases para la exclusión por código+entidad ──
    // Fase 1 (SQL): `contains` con variantes de separador es una sobre-búsqueda
    // deliberadamente amplia — por diseño puede traer falsos positivos por
    // coincidencia parcial (ej. "1001-2026" o "MC-001-2026" contienen
    // "001-2026" como substring). Si se usara ese resultado directo para
    // excluir, un Proceso NO gestionado podría desaparecer del listado
    // "sin gestionar" por error (falso "ya gestionado").
    // Fase 2 (JS): solo se excluyen los candidatos cuya llave de negocio
    // EXACTA normalizada (construirLlaveNegocio) coincide con una Solicitud
    // real — nunca se excluye solo porque `contains` encontró algo.
    let idsPorLlaveNegocio: number[] = [];
    if (paresCodigoEntidad.length > 0) {
      // Sin filtro de entidad en SQL: "equals" (aunque insensitive) no tolera
      // espacios dobles/finales distintos — la comparación de entidad se hace
      // exclusivamente en JS más abajo, dentro de construirLlaveNegocio().
      const candidatosLlave = await prisma.proceso.findMany({
        where: {
          OR: paresCodigoEntidad.flatMap(s => variantesCodigoProceso(s.codigoProceso))
            .map((variante) => ({ codigoProceso: { contains: variante, mode: 'insensitive' as const } })),
        },
        select: { id: true, codigoProceso: true, entidad: true },
      });
      const llavesValidas = new Set(
        paresCodigoEntidad.map(s => construirLlaveNegocio(s.codigoProceso as string, s.entidad as string))
      );
      idsPorLlaveNegocio = candidatosLlave
        .filter(p => llavesValidas.has(construirLlaveNegocio(p.codigoProceso, p.entidad)))
        .map(p => p.id);
    }

    const andConditions: Record<string, unknown>[] = [];

    if (soloNoViables) {
      andConditions.push({ noViable: true });
    } else {
      andConditions.push({ noViable: false });
      // La exclusión final es siempre por `id IN (...)` — ya verificado con
      // llave de negocio exacta arriba. Nunca por codigoProceso/`contains`
      // directo. Para nombres (fallback histórico no relacionado con la
      // identidad canónica) se mantiene el comportamiento previo.
      // NULL-safe: las exclusiones se aplican como condiciones AND
      // independientes (De Morgan), nunca como un `NOT { OR: [...] }` global.
      // En Postgres, un `OR` con ramas que evalúan sobre columnas NULL
      // (p. ej. `externalId IN (...)` cuando `externalId IS NULL`) produce
      // UNKNOWN; `NOT(UNKNOWN)` es UNKNOWN y la fila se descarta aunque NO
      // deba excluirse. Al separar las exclusiones y añadir la rama
      // `{ campo: null }` explícita, un candidato con
      // `externalId`/`nombre`/`codigoProceso` NULL se conserva salvo que
      // coincida de verdad con una Solicitud.
      const idsExcluir = [...new Set([...procesoIds, ...idsPorLlaveNegocio])];
      if (idsExcluir.length > 0) {
        andConditions.push({ id: { notIn: idsExcluir } });
      }
      if (externalIds.length > 0) {
        andConditions.push({ OR: [{ externalId: null }, { externalId: { notIn: externalIds } }] });
      }
      if (nombres.length > 0) {
        andConditions.push({ OR: [{ nombre: null }, { nombre: { notIn: nombres } }] });
        andConditions.push({ OR: [{ codigoProceso: null }, { codigoProceso: { notIn: nombres } }] });
      }
      // Excluir procesos con estado terminal (vencido, adjudicado, cerrado, etc.).
      // NULL-safe: `NOT { OR: [ ...contains... ] }` a secas descarta también las
      // filas con `estadoFuente = NULL` (en Postgres cada `contains` sobre NULL
      // es UNKNOWN → `OR` UNKNOWN → `NOT(UNKNOWN)` UNKNOWN → fila fuera), aunque
      // un estado desconocido NO es un estado terminal. La rama
      // `{ estadoFuente: null }` explícita las conserva; se mantiene EXACTAMENTE
      // la semántica `contains` para todo texto no nulo ("Vencido 2024",
      // "Proceso cerrado", etc. siguen excluidos).
      andConditions.push({
        OR: [
          { estadoFuente: null },
          {
            NOT: {
              OR: [
                { estadoFuente: { contains: 'vencido',    mode: 'insensitive' } },
                { estadoFuente: { contains: 'adjudicado', mode: 'insensitive' } },
                { estadoFuente: { contains: 'celebrado',  mode: 'insensitive' } },
                { estadoFuente: { contains: 'terminado',  mode: 'insensitive' } },
                { estadoFuente: { contains: 'finalizado', mode: 'insensitive' } },
                { estadoFuente: { contains: 'liquidado',  mode: 'insensitive' } },
                { estadoFuente: { contains: 'desierto',   mode: 'insensitive' } },
                { estadoFuente: { contains: 'cancelado',  mode: 'insensitive' } },
                { estadoFuente: { contains: 'cerrado',    mode: 'insensitive' } },
              ],
            },
          },
        ],
      });
      // Excluir procesos con fecha de cierre ya pasada (evita mostrar "Vencido" por fecha aunque estadoFuente no esté actualizado)
      andConditions.push({
        OR: [
          { fechaVencimiento: null },
          { fechaVencimiento: { gt: new Date() } },
        ],
      });
    }

    if (query) {
      andConditions.push({
        OR: [
          { entidad:       { contains: query, mode: 'insensitive' } },
          { objeto:        { contains: query, mode: 'insensitive' } },
          { codigoProceso: { contains: query, mode: 'insensitive' } },
          { nombre:        { contains: query, mode: 'insensitive' } },
          { departamento:  { contains: query, mode: 'insensitive' } },
          { perfil:        { contains: query, mode: 'insensitive' } },
        ],
      });
    }

    if (perfilesArr.length > 0) {
      andConditions.push({ OR: perfilesArr.map((p) => ({ perfil: { contains: p, mode: 'insensitive' } })) });
    }

    if (fuentesArr.length > 0) {
      const fuentesMapeadas = fuentesArr.map(f => {
        const fl = normalizarTexto(f).trim();
        if (fl === 'nc' || fl === 'cp' || fl.includes('no centralizado') || fl.includes('contrato privado')) return 'NC';
        if (fl === 's2' || fl.includes('secop ii')) return 'S2';
        if (fl === 's1' || fl.includes('secop i'))  return 'S1';
        return f;
      });
      andConditions.push({ OR: fuentesMapeadas.map((f) => fuenteCondition(f)) });
    }

    if (dptosArr.length > 0) {
      andConditions.push({ OR: dptosArr.map((d) => ({ departamento: { contains: d, mode: 'insensitive' } })) });
    }

    if (estadosArr.length > 0) {
      andConditions.push({ OR: estadosArr.map((e) => ({ estadoFuente: { contains: e, mode: 'insensitive' } })) });
    }

    if (modalsArr.length > 0) {
      andConditions.push({ OR: modalsArr.map((m) => modalidadCondition(m)) });
    }

    if (fechaDesde || fechaHasta) {
      andConditions.push({
        fechaPublicacion: {
          ...(fechaDesde ? { gte: new Date(`${fechaDesde}T00:00:00`) } : {}),
          ...(fechaHasta ? { lte: new Date(`${fechaHasta}T23:59:59`) } : {}),
        },
      });
    }

    if (cuantiaDesde || cuantiaHasta) {
      andConditions.push({
        valor: {
          ...(cuantiaDesde ? { gte: Number(cuantiaDesde) } : {}),
          ...(cuantiaHasta ? { lte: Number(cuantiaHasta) } : {}),
        },
      });
    }

    // Los procesos ocultos no deben aparecer en el módulo de búsqueda de
    // procesos sin gestionar. Se mantiene la rama `null` explícita para no
    // romper la semántica NULL-safe del resto del filtro.
    andConditions.push({ OR: [{ oculto: null }, { oculto: false }] });
    andConditions.push(whereProcesoIdentificable());

    const where: Record<string, unknown> = andConditions.length > 0 ? { AND: andConditions } : {};

    const [total, registros] = await Promise.all([
      prisma.proceso.count({ where }),
      prisma.proceso.findMany({
        where,
        orderBy: { fechaPublicacion: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, externalId: true, codigoProceso: true, nombre: true,
          entidad: true, objeto: true, fuente: true, aliasFuente: true, origenFuncional: true,
          modalidad: true, perfil: true, departamento: true, estadoFuente: true,
          fechaPublicacion: true, fechaVencimiento: true, valor: true,
          linkDetalle: true, linkSecop: true, linkSecopReg: true,
          totalCronogramas: true, totalDocumentos: true, lastSyncedAt: true, rawJson: true,
          noViable: true, observacionNoViable: true, noViableRegistradoPor: true, noViableFecha: true,
        },
      }),
    ]);

    const procesos = registros.map((r: unknown) => {
      const row = r as Record<string, unknown>;
      let raw: Record<string, unknown> = {};
      try { raw = row.rawJson ? (JSON.parse(String(row.rawJson)) as Record<string, unknown>) : {}; } catch { raw = {}; }

      const nombreProceso         = String(row.nombre ?? '').trim();
      const codigoProcesoOriginal = String(row.codigoProceso ?? '').trim();
      const codigoProcesoFinal    = codigoProcesoOriginal || nombreProceso || `PROCESO-${String(row.id ?? '').trim()}`;

      const rawDocs =
        Array.isArray(raw['documentos_proceso']) ? (raw['documentos_proceso'] as Record<string, unknown>[])
        : Array.isArray(raw['Documentos'])        ? (raw['Documentos']        as Record<string, unknown>[])
        : Array.isArray(raw['documentos'])         ? (raw['documentos']        as Record<string, unknown>[])
        : [];

      const documentosMap = new Map<string, { nombre: string; ruta: string; url: string }>();
      for (const d of rawDocs) {
        const nombre = String(d['nombre'] ?? d['Nombre'] ?? '').trim();
        const ruta   = String(d['ruta'] ?? d['Ruta'] ?? d['url'] ?? d['Url'] ?? '').trim();
        if (!nombre && !ruta) continue;
        const key = nombre ? nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') : ruta.toLowerCase();
        if (!documentosMap.has(key)) {
          documentosMap.set(key, { nombre: nombre || 'Sin nombre', ruta, url: ruta });
        }
      }
      const documentos = Array.from(documentosMap.values());

      const rawCron =
        Array.isArray(raw['cronogramas']) ? (raw['cronogramas'] as Record<string, unknown>[])
        : Array.isArray(raw['Cronograma']) ? (raw['Cronograma'] as Record<string, unknown>[])
        : [];

      const cronogramasMap = new Map<string, { nombre: string; fecha: string; fechaAnterior?: string; fechaModificada: boolean }>();
      for (const cr of rawCron) {
        const nombre = String(cr['label'] ?? cr['nombre'] ?? cr['Nombre'] ?? '').trim();
        const fecha  = String(cr['fecha'] ?? cr['Fecha'] ?? '').trim();
        if (!nombre) continue;
        const key = nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (cronogramasMap.has(key)) {
          const existente = cronogramasMap.get(key)!;
          if (existente.fecha !== fecha && fecha) {
            cronogramasMap.set(key, { nombre, fecha, fechaAnterior: existente.fecha, fechaModificada: true });
          }
        } else {
          cronogramasMap.set(key, { nombre, fecha, fechaModificada: false });
        }
      }
      const cronogramas = Array.from(cronogramasMap.values());

      return {
        id:               row.externalId ? Number(row.externalId) : row.id,
        nombre:           nombreProceso,
        codigoProceso:    codigoProcesoFinal,
        fuente:           row.fuente           ?? '',
        aliasFuente:      row.aliasFuente      ?? '',
        origenFuncional:  row.origenFuncional  ?? null,
        modalidad:        row.modalidad        ?? '',
        fechaPublicacion: row.fechaPublicacion instanceof Date ? row.fechaPublicacion.toISOString().replace('T', ' ').slice(0, 19) : row.fechaPublicacion ?? null,
        fechaVencimiento: row.fechaVencimiento instanceof Date ? row.fechaVencimiento.toISOString().replace('T', ' ').slice(0, 19) : row.fechaVencimiento ?? null,
        entidad:          row.entidad          ?? '',
        objeto:           row.objeto           ?? '',
        valor:            row.valor != null ? Number(row.valor) : null,
        departamento:     row.departamento     ?? '',
        estado:           row.estadoFuente     ?? '',
        perfil:           row.perfil           ?? '',
        linkDetalle:      row.linkDetalle      ?? '',
        linkSecop:        row.linkSecop        ?? '',
        linkSecopReg:     row.linkSecopReg     ?? '',
        fuentes:          [],
        totalCronogramas: row.totalCronogramas ?? 0,
        totalDocumentos:  row.totalDocumentos  ?? 0,
        cronogramas,
        documentos,
        _dbId:            row.id,
        procesoId:        row.id,
        externalId:       row.externalId ?? null,
        lastSyncedAt:     row.lastSyncedAt     ?? null,
        duracionContrato: raw['duracion_contrato'] ?? raw['duracionContrato'] ?? raw['Duracion_Contrato'] ?? null,
        noViable:              row.noViable              ?? false,
        observacionNoViable:   row.observacionNoViable   ?? null,
        noViableRegistradoPor: row.noViableRegistradoPor ?? null,
        noViableFecha:         row.noViableFecha instanceof Date ? row.noViableFecha.toISOString() : row.noViableFecha ?? null,
      };
    });

    return NextResponse.json({
      ok: true, page, limit,
      total_resultados_api:        total,
      total_resultados_filtrados:  procesos.length,
      total_resultados_entregados: procesos.length,
      totalPages: Math.ceil(total / limit),
      procesos,
    });

  } catch (error) {
    console.error('[GET /api/procesos/sin-gestionar]', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Error al consultar procesos sin gestionar.' },
      { status: 500 }
    );
  }
}