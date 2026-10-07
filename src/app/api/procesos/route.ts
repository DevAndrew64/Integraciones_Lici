/**
 * src/app/api/procesos/route.ts
 *
 * CAMBIOS v2 (corrección visualización cronograma con cambios):
 * - Los campos tieneCambioFechaCierre, fechaVencimientoAnterior y
 *   fechaCambioFechaCierre ahora se incluyen en el SELECT de la consulta.
 * - La lógica de cronogramas usa fechaVencimientoAnterior (guardada en BD)
 *   para determinar si la fecha del evento "Presentación de Ofertas" cambió,
 *   en lugar de comparar BD vs rawJson (que ya tiene los datos nuevos).
 * - El campo fechaModificada en los items de cronograma es true solo cuando
 *   el proceso tiene tieneCambioFechaCierre=true Y el evento es de cierre.
 * - Se exportan los campos extras al frontend: tieneCambioFechaCierre,
 *   fechaVencimientoAnterior, fechaCambioFechaCierre.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { requireSession } from '@/lib/authz';
import { fachadaSync } from '@/lib/data-api/sync/fachadaSync';
import { whereProcesoIdentificable } from '@/lib/procesos/proceso-identificable';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function parseIntSafe(v: string | null, fallback: number) {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isNaN(n) ? fallback : n;
}

function normalizarTexto(valor: string) {
  return String(valor || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function toArr(raw: string | null | undefined): string[] {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s !== 'all');
}

function modalidadCondition(mod: string) {
  const m = normalizarTexto(mod);

  if (m.includes('minima')) {
    return {
      OR: [
        { modalidad: { contains: mod, mode: 'insensitive' } },
        { nombre: { contains: 'cuant', mode: 'insensitive' } },
      ],
    };
  }
  if (m.includes('licitaci')) {
    return {
      OR: [
        { modalidad: { contains: mod, mode: 'insensitive' } },
        { nombre: { startsWith: 'Licitaci', mode: 'insensitive' } },
      ],
    };
  }
  if (m.includes('seleccion')) {
    return {
      OR: [
        { modalidad: { contains: mod, mode: 'insensitive' } },
        { nombre: { startsWith: 'Selecci', mode: 'insensitive' } },
      ],
    };
  }
  if (m.includes('directa')) {
    return {
      OR: [
        { modalidad: { contains: mod, mode: 'insensitive' } },
        { nombre: { startsWith: 'Contratación Directa', mode: 'insensitive' } },
        { nombre: { contains: 'CONTRATACION DIRECTA', mode: 'insensitive' } },
      ],
    };
  }
  if (m.includes('meritos')) {
    return {
      OR: [
        { modalidad: { contains: mod, mode: 'insensitive' } },
        { nombre: { startsWith: 'Concurso', mode: 'insensitive' } },
      ],
    };
  }
  if (m.includes('subasta')) {
    return {
      OR: [
        { modalidad: { contains: mod, mode: 'insensitive' } },
        { nombre: { startsWith: 'Subasta', mode: 'insensitive' } },
      ],
    };
  }
  if (m.includes('especial')) {
    return {
      OR: [
        { modalidad: { contains: mod, mode: 'insensitive' } },
        { nombre: { startsWith: 'Régimen', mode: 'insensitive' } },
      ],
    };
  }

  return {
    OR: [
      { modalidad: { contains: mod, mode: 'insensitive' } },
      { nombre: { contains: mod, mode: 'insensitive' } },
    ],
  };
}

/**
 * Ajuste "PARIDAD DATA API — FUENTE" — `Proceso.aliasFuente` nunca se
 * escribe para filas creadas por la Data API (contrato canónico, ver
 * `mapeoCanonico.ts`), así que quedan con `aliasFuente = null`. El criterio
 * "público" tiene que reconocer también el equivalente canónico
 * (`origenFuncional`), y el bucket "privado" tiene que ser el COMPLEMENTO
 * exacto de "público" — nunca `{ not: 'S1' }, { not: 'S2' }` a secas, que en
 * Prisma incluye las filas NULL y por eso todo proceso Data-API caía en
 * "privado" sin importar su origen real (caso real: CP-019-JNCI-2026).
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

function parseRawJson(rawJson: unknown): Record<string, unknown> {
  try {
    if (!rawJson) return {};
    if (typeof rawJson === 'object') return rawJson as Record<string, unknown>;
    return JSON.parse(String(rawJson)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS DE SALIDA
// ─────────────────────────────────────────────────────────────────────────────

type DocumentoSalida = {
  nombre: string;
  ruta: string;
  url: string;
};

type CronogramaSalida = {
  nombre: string;
  fecha: string;
  fechaAnterior?: string;
  fechaModificada: boolean;
  esCierre?: boolean;
  origen?: 'bd' | 'rawJson';
};

// ─────────────────────────────────────────────────────────────────────────────
// Detectar si un evento de cronograma corresponde a "cierre para ofertar"
// (misma lógica que en procesos-sync.ts, pero sin importar desde allí
//  para evitar dependencias de módulo servidor en el API route)
// ─────────────────────────────────────────────────────────────────────────────

// Alineado con PRIORIDAD_CIERRE/EXCLUSION_CIERRE de src/lib/procesos-sync.ts —
// aquí solo se usa para resaltado visual (esCierre) en la pestaña Cronograma,
// no decide qué fecha se guarda como Fecha de Cierre del proceso.
const PATRONES_CIERRE = [
  'fecha limite de presentacion de ofertas',
  'fecha limite presentacion de ofertas',
  'fecha limite para presentar ofertas',
  'fecha limite para la presentacion de propuestas',
  'cierre de presentacion de ofertas',
  'entrega de ofertas',
  'recepcion de ofertas',
  'entrega de propuestas',
  'recepcion de propuestas',
  'presentacion de ofertas',
];

const PATRONES_EXCLUIDOS = [
  'informe de presentacion',
  'publicacion del informe',
  'publicacion informe',
  'informe de evaluacion',
  'informe evaluacion',
  'evaluacion',
  'calificacion',
  'adjudicacion',
  'audiencia de adjudicacion',
  'audiencia adjudicacion',
  'firma del contrato',
  'firma contrato',
  'suscripcion del contrato',
  'suscripcion contrato',
  'garantias',
  'poliza',
  'legalizacion',
  'apertura de ofertas',
  'inicio de ejecucion',
  'ejecucion del contrato',
  'publicacion del procedimiento',
];

function esEventoCierre(nombreEvento: string): boolean {
  const key = normalizarTexto(nombreEvento);
  const esExcluido = PATRONES_EXCLUIDOS.some((p) => key.includes(normalizarTexto(p)));
  if (esExcluido) return false;
  return PATRONES_CIERRE.some((p) => key.includes(normalizarTexto(p)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Extraer documentos desde rawJson (fallback)
// ─────────────────────────────────────────────────────────────────────────────

function extraerDocumentosDesdeRaw(raw: Record<string, unknown>): DocumentoSalida[] {
  const rawDocs =
    Array.isArray(raw['documentos_proceso'])
      ? (raw['documentos_proceso'] as Record<string, unknown>[])
      : Array.isArray(raw['Documentos'])
        ? (raw['Documentos'] as Record<string, unknown>[])
        : Array.isArray(raw['documentos'])
          ? (raw['documentos'] as Record<string, unknown>[])
          : [];

  const documentosMap = new Map<string, DocumentoSalida>();

  for (const d of rawDocs) {
    const nombre = String(d['nombre'] ?? d['Nombre'] ?? '').trim();
    const ruta = String(d['ruta'] ?? d['Ruta'] ?? d['url'] ?? d['Url'] ?? '').trim();

    if (!nombre && !ruta) continue;

    const key = nombre ? normalizarTexto(nombre) : ruta.toLowerCase();

    if (!documentosMap.has(key)) {
      documentosMap.set(key, {
        nombre: nombre || 'Sin nombre',
        ruta,
        url: ruta,
      });
    }
  }

  return Array.from(documentosMap.values());
}

// ─────────────────────────────────────────────────────────────────────────────
// formatearFechaSalida
// ─────────────────────────────────────────────────────────────────────────────

function formatearFechaSalida(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString().replace('T', ' ').slice(0, 19);
  }
  if (typeof value === 'string') return value;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/procesos
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;
  try {
    const { searchParams } = new URL(req.url);

    const page = Math.max(1, parseIntSafe(searchParams.get('page'), 1));
    const limit = Math.min(100, Math.max(1, parseIntSafe(searchParams.get('limit'), 30)));

    const query =
      searchParams.get('query')?.trim() ||
      searchParams.get('q')?.trim() ||
      searchParams.get('busqueda')?.trim() ||
      '';

    // Lookup puntual por Proceso.id — usado para VALIDAR un procesoId ya
    // conocido (ver resolverProcesoIdParaFicha) sin depender de que el
    // código de texto coincida con la búsqueda.
    const idParam = parseIntSafe(searchParams.get('id'), 0);

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
    const fuentesArr = toArr(fuenteParam);
    const estadosArr = toArr(estadoParam);
    const modalsArr = toArr(modalidadParam);
    const dptosArr = toArr(departamentoParam);

    const andConditions: Record<string, unknown>[] = [];

    if (idParam > 0) {
      andConditions.push({ id: idParam });
    }

    if (query) {
      andConditions.push({
        OR: [
          { entidad: { contains: query, mode: 'insensitive' } },
          { objeto: { contains: query, mode: 'insensitive' } },
          { codigoProceso: { contains: query, mode: 'insensitive' } },
          { nombre: { contains: query, mode: 'insensitive' } },
          { departamento: { contains: query, mode: 'insensitive' } },
          { perfil: { contains: query, mode: 'insensitive' } },
        ],
      });
    }

    if (perfilesArr.length > 0) {
      andConditions.push({
        OR: perfilesArr.map((p) => ({
          perfil: { contains: p, mode: 'insensitive' },
        })),
      });
    }

    if (fuentesArr.length > 0) {
      const fuentesMapeadas = fuentesArr.map((f) => {
        const fl = normalizarTexto(f).trim();
        if (fl === 'nc' || fl === 'cp' || fl.includes('no centralizado') || fl.includes('contrato privado')) return 'NC';
        if (fl === 's2' || fl.includes('secop ii')) return 'S2';
        if (fl === 's1' || fl.includes('secop i')) return 'S1';
        return f;
      });

      andConditions.push({
        OR: fuentesMapeadas.map((f) => fuenteCondition(f)),
      });
    }

    if (dptosArr.length > 0) {
      andConditions.push({
        OR: dptosArr.map((d) => ({
          departamento: { contains: d, mode: 'insensitive' },
        })),
      });
    }

    if (estadosArr.length > 0) {
      andConditions.push({
        OR: estadosArr.map((e) => ({
          estadoFuente: { contains: e, mode: 'insensitive' },
        })),
      });
    }

    if (modalsArr.length > 0) {
      andConditions.push({
        OR: modalsArr.map((m) => modalidadCondition(m)),
      });
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

    andConditions.push({ NOT: { oculto: true } });
    andConditions.push(whereProcesoIdentificable());

    const where: Record<string, unknown> = {
      AND: andConditions,
    };

    const [total, registros] = await Promise.all([
      prisma.proceso.count({ where }),
      prisma.proceso.findMany({
        where,
        orderBy: { fechaPublicacion: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          externalId: true,
          sourceKey: true,
          codigoProceso: true,
          nombre: true,
          entidad: true,
          objeto: true,
          fuente: true,
          aliasFuente: true,
          origenFuncional: true,
          modalidad: true,
          perfil: true,
          departamento: true,
          estadoFuente: true,
          fechaPublicacion: true,
          fechaVencimiento: true,
          // ── NUEVOS campos para mostrar cambio de fecha ──
          fechaVencimientoAnterior: true,
          tieneCambioFechaCierre: true,
          fechaCambioFechaCierre: true,
          // ────────────────────────────────────────────────
          valor: true,
          linkDetalle: true,
          linkSecop: true,
          linkSecopReg: true,
          totalCronogramas: true,
          totalDocumentos: true,
          lastSyncedAt: true,
          duracion: true,
          oculto: true,
          rawJson: true,
        },
      }),
    ]);

    // Resolución de linkDetalle BAJO DEMANDA (corrección D7/D16) — SOLO
    // cuando el cliente consulta UN proceso puntual por id (idParam>0,
    // nunca en un listado/búsqueda general) y ese proceso todavía no tiene
    // link. Se resuelve UNA fila a la vez, en la propia respuesta — nunca
    // en lote/backlog masivo (eso lo cubre el bucle de `/api/procesos/sync`
    // y el endpoint N8N `/api/procesos/resolver-link-detalle`). Si el sync
    // está deshabilitado (`fachadaSync` → `estado:'deshabilitado'`) o la
    // Data API falla, no interrumpe la respuesta: la fila sigue mostrando
    // lo que ya tenía en BD.
    if (idParam > 0 && registros.length === 1) {
      const unico = registros[0] as {
        id: number;
        linkDetalle: string | null;
        sourceKey?: string | null;
        origenFuncional?: string | null;
      };
      const sinLink = !unico.linkDetalle || unico.linkDetalle.trim() === '';
      const tieneSourceKey = typeof unico.sourceKey === 'string' && unico.sourceKey.trim() !== '';
      if (sinLink && tieneSourceKey) {
        try {
          const r = await fachadaSync.resolverLinkProceso(unico.id);
          if (r.estado === 'ejecutado' && r.datos.ok && r.datos.linkDetalle) {
            unico.linkDetalle = r.datos.linkDetalle;
          }
        } catch (e) {
          console.warn('[GET /api/procesos] resolución de link bajo demanda falló', unico.id, e instanceof Error ? e.message : e);
        }
      }
    }

    const idsBD = registros.map((r) => r.id);

    // ── Cargar documentos y cronogramas en paralelo
    const [documentosBD, cronogramasBD] = await Promise.all([
      prisma.procesoDocumentoSecop.findMany({
        where: { procesoId: { in: idsBD } },
        orderBy: [{ procesoId: 'asc' }, { id: 'asc' }],
        select: { procesoId: true, nombre: true, urlDocumento: true, extension: true, tipoDocumento: true },
      }),
      prisma.procesoCronogramaSecop.findMany({
        where: { procesoId: { in: idsBD } },
        orderBy: [{ procesoId: 'asc' }, { orden: 'asc' }, { id: 'asc' }],
        select: { id: true, procesoId: true, evento: true, valorTexto: true, valorTextoAnterior: true, tieneCambioFecha: true, orden: true },
      }),
    ]);

    const documentosPorProceso = new Map<number, { nombre: string; urlDocumento: string | null; extension: string | null; tipoDocumento: string | null }[]>();
    for (const d of documentosBD) {
      const arr = documentosPorProceso.get(d.procesoId) ?? [];
      arr.push({ nombre: d.nombre, urlDocumento: d.urlDocumento ?? null, extension: d.extension ?? null, tipoDocumento: d.tipoDocumento ?? null });
      documentosPorProceso.set(d.procesoId, arr);
    }

    // Agrupar por procesoId
    const cronogramasPorProceso = new Map<
      number,
      { evento: string; valorTexto: string | null; valorTextoAnterior: string | null; tieneCambioFecha: boolean }[]
    >();

    for (const cr of cronogramasBD) {
      const arr = cronogramasPorProceso.get(cr.procesoId) ?? [];
      arr.push({
        evento: cr.evento,
        valorTexto: cr.valorTexto,
        valorTextoAnterior: cr.valorTextoAnterior ?? null,
        tieneCambioFecha: Boolean(cr.tieneCambioFecha),
      });
      cronogramasPorProceso.set(cr.procesoId, arr);
    }

    // ── Construir respuesta
    const procesos = registros.map((r) => {
      const row = r as Record<string, unknown>;

      const raw = parseRawJson(row.rawJson);

      const nombreProceso = String(row.nombre ?? '').trim();
      const codigoProcesoOriginal = String(row.codigoProceso ?? '').trim();
      const codigoProcesoFinal =
        codigoProcesoOriginal ||
        nombreProceso ||
        `PROCESO-${String(row.id ?? '').trim()}`;

      const dbId = Number(row.id);

      // ── Campos de cambio de fecha (desde BD, fuente de verdad)
      const tieneCambioFechaCierre = Boolean(row.tieneCambioFechaCierre);
      const fechaVencimientoAnterior = row.fechaVencimientoAnterior
        ? formatearFechaSalida(row.fechaVencimientoAnterior as Date)
        : null;
      const fechaCambioFechaCierre = row.fechaCambioFechaCierre
        ? formatearFechaSalida(row.fechaCambioFechaCierre as Date)
        : null;

      // ── Documentos: preferir tabla BD, caer en rawJson si no hay
      const documentosDesdeTabla = documentosPorProceso.get(dbId);
      const documentos: DocumentoSalida[] = documentosDesdeTabla && documentosDesdeTabla.length > 0
        ? documentosDesdeTabla
            .filter((d) => d.tipoDocumento !== 'adenda')
            .map((d) => ({
              nombre: d.nombre,
              ruta: d.urlDocumento ?? '',
              url: d.urlDocumento ?? '',
            }))
        : extraerDocumentosDesdeRaw(raw);

      // ── Cronogramas desde BD (fuente canónica)
      const cronogramasDesdeBD = cronogramasPorProceso.get(dbId) ?? [];

      let cronogramas: CronogramaSalida[];

      if (cronogramasDesdeBD.length > 0) {
  // Agrupar por nombre normalizado
  const grupos = new Map<string, {
    evento: string;
    fechas: string[];
    tieneCambio: boolean;
    valorAnterior: string | null;
  }>();
  for (const cr of cronogramasDesdeBD) {
    const key = normalizarTexto(cr.evento);
    if (!grupos.has(key)) {
      grupos.set(key, { evento: cr.evento, fechas: [], tieneCambio: false, valorAnterior: null });
    }
    const g = grupos.get(key)!;
    g.fechas.push(cr.valorTexto || '—');
    // tieneCambioFecha = guardado por actualizar-cronograma (1 sola fila con historial)
    if (cr.tieneCambioFecha) {
      g.tieneCambio = true;
      if (!g.valorAnterior && cr.valorTextoAnterior) g.valorAnterior = cr.valorTextoAnterior;
    }
  }
  cronogramas = Array.from(grupos.values()).map((grupo) => {
    const esCierre = esEventoCierre(grupo.evento);
    // Cambio detectado via tieneCambioFecha (endpoint actualizar-cronograma)
    if (grupo.tieneCambio && grupo.valorAnterior) {
      return {
        nombre: grupo.evento,
        fecha: grupo.fechas[0] || '—',
        fechaAnterior: grupo.valorAnterior,
        fechaModificada: true,
        esCierre,
        origen: 'bd' as const,
      };
    }
    // Legado: dos filas con mismo evento (sync automático anterior)
    if (grupo.fechas.length >= 2) {
      const fechaNueva    = grupo.fechas[0];
      const fechaAnterior = grupo.fechas[1];
      const sonDistintas  = normalizarTexto(fechaNueva) !== normalizarTexto(fechaAnterior);
      return {
        nombre: grupo.evento,
        fecha: fechaNueva,
        fechaAnterior: sonDistintas ? fechaAnterior : undefined,
        fechaModificada: sonDistintas,
        esCierre,
        origen: 'bd' as const,
      };
    }
    return {
      nombre: grupo.evento,
      fecha: grupo.fechas[0] || '—',
      fechaModificada: false,
      esCierre,
      origen: 'bd' as const,
    };
  });
} else {
  // ── Fallback: cronograma desde rawJson (procesos sin datos en BD)
  const CRON_FIELDS = ['cronogramas', 'Cronograma', 'cronograma', 'etapas', 'fases', 'eventos', 'fechas', 'items', 'schedule', 'timeline', 'fechas_clave', 'stages'];
  let rawCron: Record<string, unknown>[] = [];
  for (const f of CRON_FIELDS) {
    if (Array.isArray(raw[f]) && (raw[f] as unknown[]).length > 0) {
      rawCron = raw[f] as Record<string, unknown>[];
      break;
    }
  }

  cronogramas = rawCron.reduce<CronogramaSalida[]>((acc, cr) => {
    const nombre = String(
      cr['label'] ?? cr['nombre'] ?? cr['Nombre'] ?? cr['actividad'] ?? cr['Actividad'] ??
      cr['titulo'] ?? cr['Titulo'] ?? cr['title'] ?? cr['description'] ?? cr['descripcion'] ??
      cr['tipo'] ?? cr['Tipo'] ?? cr['evento'] ?? cr['Evento'] ?? cr['name'] ?? ''
    ).trim();
    const fecha = String(
      cr['fecha'] ?? cr['Fecha'] ??
      cr['FechaInicio'] ?? cr['fechaInicio'] ?? cr['fecha_inicio'] ??
      cr['FechaFin'] ?? cr['fechaFin'] ?? cr['fecha_fin'] ??
      cr['FechaLimite'] ?? cr['fechaLimite'] ?? cr['fecha_limite'] ??
      cr['hasta'] ?? cr['Hasta'] ?? cr['date'] ?? cr['Date'] ?? ''
    ).trim();
    if (!nombre) return acc;
    acc.push({
      nombre,
      fecha: fecha || '—',
      fechaModificada: false,
      esCierre: esEventoCierre(nombre),
      origen: 'rawJson',
    });
    return acc;
  }, []);
}

      return {
        id: row.externalId ? Number(row.externalId) : row.id,
        nombre: nombreProceso,
        codigoProceso: codigoProcesoFinal,
        fuente: row.fuente ?? '',
        aliasFuente: row.aliasFuente ?? '',
        origenFuncional: row.origenFuncional ?? null,
        modalidad: row.modalidad ?? '',
        fechaPublicacion: formatearFechaSalida(row.fechaPublicacion as Date | null),
        fechaVencimiento: formatearFechaSalida(row.fechaVencimiento as Date | null),
        // ── Campos de cambio de fecha de cierre (para frontend)
        fechaVencimientoAnterior,
        tieneCambioFechaCierre,
        fechaCambioFechaCierre,
        // ────────────────────────────────────────────────────────
        entidad: row.entidad ?? '',
        objeto: row.objeto ?? '',
        valor: row.valor != null ? Number(row.valor) : null,
        departamento: row.departamento ?? '',
        estado: row.estadoFuente ?? '',
        perfil: row.perfil ?? '',
        linkDetalle: row.linkDetalle ?? '',
        linkSecop: row.linkSecop ?? '',
        linkSecopReg: row.linkSecopReg ?? '',
        fuentes: [],
        totalCronogramas: cronogramas.length,
        totalDocumentos: row.totalDocumentos ?? 0,
        cronogramas,
        documentos,
        _dbId: row.id,
        // Campos explícitos (Fase 1.4) — "id" arriba contiene externalId por
        // compatibilidad histórica, NO el Proceso.id interno.
        procesoId: row.id,
        externalId: row.externalId ?? null,
        sourceKey: row.sourceKey ?? null,
        lastSyncedAt: row.lastSyncedAt ?? null,
        duracionContrato: row.duracion ?? null,
      };
    });

    return NextResponse.json({
      ok: true,
      page,
      limit,
      total_resultados_api: total,
      total_resultados_filtrados: procesos.length,
      total_resultados_entregados: procesos.length,
      totalPages: Math.ceil(total / limit),
      procesos,
    });
  } catch (error) {
    console.error('[GET /api/procesos]', error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Error al consultar procesos.',
      },
      { status: 500 }
    );
  }
}