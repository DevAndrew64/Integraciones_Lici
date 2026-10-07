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

    const perfilParam =
      searchParams.get('perfiles') ||
      searchParams.get('perfil') ||
      searchParams.get('entidadGrupo') ||
      '';

    const fuenteParam =
      searchParams.get('fuentes') ||
      searchParams.get('fuente') ||
      searchParams.get('portal') ||
      '';

    const estadoParam =
      searchParams.get('estados') ||
      searchParams.get('estado') ||
      '';

    const modalidadParam =
      searchParams.get('modalidades') ||
      searchParams.get('modalidad') ||
      '';

    const departamentoParam =
      searchParams.get('departamentos') ||
      searchParams.get('departamento') ||
      searchParams.get('dptos') ||
      searchParams.get('dpto') ||
      '';

    const perfilesArr = toArr(perfilParam);
    const fuentesArr  = toArr(fuenteParam);
    const estadosArr  = toArr(estadoParam);
    const modalsArr   = toArr(modalidadParam);
    const dptosArr    = toArr(departamentoParam);

    const conResponsable = searchParams.get('conResponsable') === '1';

    // ── Obtener procesos que tienen solicitud ──
    // SQL directo: excluye asignaciones (JSON grande), filtra conResponsable en BD.
    // Se trae también "entidad" — imprescindible para no cruzar Proceso/Solicitud
    // de entidades distintas que comparten el mismo codigoProceso (ver diagnóstico
    // Fortul/Honor & Laurel: mismo "No. 001-2026", entidades distintas).
    const rawSols = await prisma.$queryRawUnsafe<
      { id: bigint; procesoId: bigint | null; codigoProceso: string | null; entidad: string | null; externalId: string | null; estadoSolicitud: string | null }[]
    >(`SELECT id,"procesoId","codigoProceso",entidad,"externalId","estadoSolicitud"
       FROM "Solicitud"
       WHERE ("procesoId" IS NOT NULL OR "codigoProceso" IS NOT NULL OR "externalId" IS NOT NULL)
       ${conResponsable ? 'AND asignaciones IS NOT NULL AND jsonb_array_length(asignaciones) > 0' : ''}`);

    const solicitudes = rawSols.map(s => ({
      id: Number(s.id),
      procesoId: s.procesoId ? Number(s.procesoId) : null,
      codigoProceso: s.codigoProceso,
      entidad: s.entidad,
      externalId: s.externalId,
      estadoSolicitud: s.estadoSolicitud,
    }));

    const procesoIds  = [...new Set(solicitudes.map(s => s.procesoId).filter(Boolean))] as number[];
    const externalIds = [...new Set(solicitudes.map(s => s.externalId).filter(Boolean))] as string[];

    // ── Mapas de resolución de identidad — SEPARADOS por nivel, nunca un solo
    // Map keyeado por codigoProceso. Orden de resolución obligatorio al usarlos
    // más abajo: procesoId → externalId → llave de negocio (código+entidad).
    const solPorProcesoId = new Map(solicitudes.filter(s => s.procesoId).map(s => [s.procesoId as number, s]));
    const solPorExternalId = new Map(solicitudes.filter(s => s.externalId).map(s => [s.externalId as string, s]));
    // Si la misma llave de negocio aparece en más de una Solicitud, se marca
    // como 'AMBIGUO' — nunca se elige silenciosamente la primera ni la última.
    const solPorLlaveNegocio = new Map<string, typeof solicitudes[number] | 'AMBIGUO'>();
    for (const s of solicitudes) {
      if (!s.codigoProceso || !s.entidad) continue;
      const llave = construirLlaveNegocio(s.codigoProceso, s.entidad);
      if (solPorLlaveNegocio.has(llave)) {
        solPorLlaveNegocio.set(llave, 'AMBIGUO');
        console.warn('[GET /api/procesos/gestionados] llave de negocio ambigua entre solicitudes:', llave);
      } else {
        solPorLlaveNegocio.set(llave, s);
      }
    }

    // Pares codigoProceso+entidad válidos, para la inclusión por llave de negocio.
    const paresCodigoEntidad = [...new Map(
      solicitudes.filter(s => s.codigoProceso && s.entidad).map(s => [`${s.codigoProceso} ${s.entidad}`, s])
    ).values()];

    if (procesoIds.length === 0 && externalIds.length === 0 && paresCodigoEntidad.length === 0) {
      return NextResponse.json({
        ok: true, page, limit,
        total_resultados_api: 0,
        total_resultados_filtrados: 0,
        total_resultados_entregados: 0,
        totalPages: 0,
        procesos: [],
      });
    }

    // ── Resolución en dos fases para la inclusión por código+entidad ──
    // Fase 1 (SQL): `contains` con variantes de separador es una sobre-búsqueda
    // deliberadamente amplia — por diseño puede traer falsos positivos por
    // coincidencia parcial (ej. "1001-2026" o "MC-001-2026" contienen
    // "001-2026" como substring, sin ser el mismo proceso).
    // Fase 2 (JS): de esos candidatos, solo se aceptan los que tengan la llave
    // de negocio EXACTA normalizada (construirLlaveNegocio) igual a alguna
    // Solicitud real. Solo esos ids entran a la condición final — nunca se usa
    // el resultado de `contains` directamente como membresía del listado.
    let idsPorLlaveNegocio: number[] = [];
    if (paresCodigoEntidad.length > 0) {
      // Sin filtro de entidad en SQL: "equals" (aunque insensitive) no tolera
      // espacios dobles/finales distintos entre Proceso.entidad y
      // Solicitud.entidad — la comparación de entidad se hace exclusivamente
      // en JS más abajo, con normalizarEntidad() (trim + colapso de espacios +
      // sin acentos), dentro de construirLlaveNegocio().
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

    // Condición base: solo procesos gestionados. La inclusión por código+entidad
    // ahora es un `id IN (...)` de ids YA verificados con llave de negocio exacta
    // en la Fase 2 de arriba — nunca "codigoProceso IN (...)"/`contains` a secas,
    // que traería procesos de OTRA entidad o coincidencias parciales de número.
    const baseCondition = {
      OR: [
        { id: { in: procesoIds } },
        ...(externalIds.length > 0 ? [{ externalId: { in: externalIds } }] : []),
        ...(idsPorLlaveNegocio.length > 0 ? [{ id: { in: idsPorLlaveNegocio } }] : []),
      ],
    };

    const andConditions: Record<string, unknown>[] = [baseCondition];

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
      andConditions.push({
        OR: perfilesArr.map((p) => ({ perfil: { contains: p, mode: 'insensitive' } })),
      });
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
      andConditions.push({
        OR: dptosArr.map((d) => ({ departamento: { contains: d, mode: 'insensitive' } })),
      });
    }

    if (estadosArr.length > 0) {
      andConditions.push({
        OR: estadosArr.map((e) => ({ estadoFuente: { contains: e, mode: 'insensitive' } })),
      });
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

    andConditions.push(whereProcesoIdentificable());

    const where: Record<string, unknown> = { AND: andConditions };

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
          totalCronogramas: true, totalDocumentos: true, lastSyncedAt: true, duracion: true,
          documentosSecop: {
            select: { nombre: true, urlDocumento: true, tipoDocumento: true, extension: true },
          },
          cronogramasSecop: {
            select: { evento: true, fechaFin: true, tieneCambioFecha: true },
            orderBy: { orden: 'asc' as const },
          },
        },
      }),
    ]);

    const procesos = registros.map((r: unknown) => {
      const row = r as Record<string, unknown>;
      // Orden obligatorio de resolución: procesoId → externalId → llave de
      // negocio (código+entidad normalizados). Si la llave de negocio resultó
      // ambigua (más de una Solicitud comparte código+entidad), NO se asigna
      // — se deja el proceso en estado "Selección de proceso" en vez de
      // adivinar. Nunca se cruza únicamente por codigoProceso.
      const rowExternalId = row.externalId != null ? String(row.externalId) : '';
      const rowCodigoProceso = row.codigoProceso != null ? String(row.codigoProceso) : '';
      const rowEntidad = row.entidad != null ? String(row.entidad) : '';
      const solPorLlave = rowCodigoProceso && rowEntidad
        ? solPorLlaveNegocio.get(construirLlaveNegocio(rowCodigoProceso, rowEntidad))
        : undefined;
      const sol =
        solPorProcesoId.get(Number(row.id))
        ?? (rowExternalId ? solPorExternalId.get(rowExternalId) : undefined)
        ?? (solPorLlave === 'AMBIGUO' ? undefined : solPorLlave);

      const nombreProceso         = String(row.nombre ?? '').trim();
      const codigoProcesoOriginal = String(row.codigoProceso ?? '').trim();
      const codigoProcesoFinal    = codigoProcesoOriginal || nombreProceso || `PROCESO-${String(row.id ?? '').trim()}`;

      type DocSecop = { nombre: string; urlDocumento: string | null };
      const documentos = ((row.documentosSecop ?? []) as DocSecop[]).map(d => ({
        nombre: d.nombre || 'Sin nombre',
        ruta:   d.urlDocumento ?? '',
        url:    d.urlDocumento ?? '',
      }));

      type CronSecop = { evento: string; fechaFin: Date | string | null; tieneCambioFecha: boolean };
      const cronogramas = ((row.cronogramasSecop ?? []) as CronSecop[]).map(cr => ({
        nombre:          cr.evento || '',
        fecha:           cr.fechaFin instanceof Date ? cr.fechaFin.toISOString() : (cr.fechaFin ?? ''),
        fechaModificada: cr.tieneCambioFecha,
      }));

      return {
        id:               row.externalId ? Number(row.externalId) : row.id,
        nombre:           nombreProceso,
        codigoProceso:    codigoProcesoFinal,
        fuente:           row.fuente           ?? '',
        aliasFuente:      row.aliasFuente      ?? '',
        origenFuncional:  row.origenFuncional  ?? null,
        modalidad:        row.modalidad        ?? '',
        fechaPublicacion: row.fechaPublicacion instanceof Date
          ? row.fechaPublicacion.toISOString().replace('T', ' ').slice(0, 19)
          : row.fechaPublicacion ?? null,
        fechaVencimiento: row.fechaVencimiento instanceof Date
          ? row.fechaVencimiento.toISOString().replace('T', ' ').slice(0, 19)
          : row.fechaVencimiento ?? null,
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
        // Campos explícitos (Fase 1.4) — no confundir con "id" arriba, que por
        // compatibilidad histórica del frontend contiene el externalId (SECOP)
        // cuando existe, no el Proceso.id interno.
        procesoId:        row.id,
        externalId:       row.externalId ?? null,
        lastSyncedAt:     row.lastSyncedAt     ?? null,
        duracionContrato: row.duracion         ?? null,
        estadoSolicitud:  sol?.estadoSolicitud ?? 'Selección de proceso',
        solicitudId:      sol?.id              ?? null,
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
    console.error('[GET /api/procesos/gestionados]', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Error al consultar procesos gestionados.' },
      { status: 500 }
    );
  }
}