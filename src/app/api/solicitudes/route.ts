import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { normalizarPerfil } from '@/lib/normalizar-perfil';
import { getSession } from '@/lib/session';
import type { SessionUser } from '@/lib/session';
import { requireSession, requireAdministradorProcesos, canAccessSolicitud, hasPermiso, esAdministradorProcesos, matchesIdentity } from '@/lib/authz';
import { puedeConBD } from '@/lib/licycolba/permisos';
import { auditFromRequest } from '@/lib/audit';
import { crearSolicitudConIdentidad, SolicitudIdentidadError } from '@/lib/solicitudes/crear-solicitud';
import { completarNitEntidad } from '@/lib/solicitudes/nit-entidad';
import { resolverResponsableElegible } from '@/lib/solicitudes/validar-responsable';
import { puedeReasignarSolicitud } from '@/lib/solicitudes/autorizacion-asignacion';
import { ESTADOS_QUE_EXIGEN_RESPONSABLE } from '@/lib/solicitudes/validar-estado-asignacion';
import { ESTADOS_SOLICITUD_TERMINALES } from '@/lib/solicitudes/estados-solicitud';
import { detectarCambioDeFlujoNoAutorizado } from '@/lib/solicitudes/deteccion-cambio-flujo';
import { validarMotivo } from '@/lib/solicitudes/validar-motivo';
import { determinarOrigenProceso } from '@/lib/procesos/origen-proceso';
import type { OrigenProceso } from '@/lib/procesos/origen-proceso';
import { ESTADOS_CANONICOS_CUBIERTOS, estadosCanonicosDeBandeja, sqlListaComillas, SQL_NO_TERMINAL } from '@/lib/solicitudes/bandeja-canonico';

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function parseIntSafe(v: string | null, fb: number) {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isNaN(n) ? fb : n;
}

function str(v: unknown, fb = '') {
  return v != null ? String(v) : fb;
}

function toDate(v: unknown): Date | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T12:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizarOrigenSolicitud(v: unknown): 'Comercial' | 'Especializada' {
  const valor = str(v).trim().toLowerCase();
  if (valor.includes('especial')) return 'Especializada';
  return 'Comercial';
}

// Fragmentos SQL + serialización movidos a un módulo propio — un `route.ts`
// de Next.js solo puede exportar los nombres reservados de la App Router
// (GET/POST/etc.), así que estas constantes/función no pueden vivir (ni
// exportarse para pruebas) directamente aquí.
import {
  SQL_ASIG_LAST, SQL_ASIG_RESUMEN, SQL_RESPONSABLES_RESUMEN, SQL_CANTIDAD_RESPONSABLES,
  trimAsignaciones, serializeSolicitud,
} from '@/lib/solicitudes/serializar-solicitud';

function normalizarModalidad(modalidad: string | null): string {
  const valor = str(modalidad).trim();
  const mapa: Record<string, string> = {
    '1': 'Contratación directa',
    '2': 'Licitación pública',
    '3': 'Selección abreviada',
    '4': 'Concurso de méritos',
    '5': 'Mínima cuantía',
    '6': 'Régimen especial',
  };
  if (valor.includes(' — ')) {
    return valor.split(' — ').slice(1).join(' — ').trim() || valor;
  }
  return mapa[valor] ?? (valor || 'No informada');
}

function buildSqrDescripcion(solicitud: {
  entidad: string | null;
  codigoProceso: string | null;
  objeto: string | null;
  fuente: string | null;
  modalidad: string | null;
  perfil: string | null;
  departamento: string | null;
  linkDetalle: string | null;
  usuarioRegistro: string | null;
}) {
  const modalidadLegible = normalizarModalidad(solicitud.modalidad);
  const perfil = str(solicitud.perfil, 'No informada');
  const entidad = str(solicitud.entidad, 'No informada');
  const codigo = str(solicitud.codigoProceso, 'No informado');
  const objeto = str(solicitud.objeto, 'No informado');
  const fuente = str(solicitud.fuente, 'No informada');
  const departamento = str(solicitud.departamento, 'No informada');
  const usuario = str(solicitud.usuarioRegistro, 'No informado');
  const enlace = str(solicitud.linkDetalle);
  return (
    `Se abre la presente solicitud de revisión comercial para el siguiente proceso licitatorio, ` +
    `identificado con el número ${codigo}, correspondiente a la entidad contratante "${entidad}", ` +
    `bajo la modalidad de contratación "${modalidadLegible}"` +
    `${fuente && fuente.toLowerCase() !== 'manual' ? `, gestionado a través de la plataforma ${fuente}` : ''}.\n\n` +
    `La empresa ${perfil}, perteneciente al Grupo Colba, es la responsable de la gestión de este proceso, ` +
    `el cual se desarrolla en la ubicación: ${departamento}.\n\n` +
    `DESCRIPCIÓN DEL REQUERIMIENTO:\n${objeto}\n\n` +
    `${enlace ? `Para consultar el detalle completo del proceso, acceda al siguiente enlace:\n${enlace}\n\n` : ''}` +
    `Esta solicitud fue generada automáticamente desde el sistema LICYCOLBA ` +
    `por el usuario ${usuario}, para su gestión, seguimiento y trazabilidad en el sistema SQR.`
  );
}

function extraerNumeroSqrDesdeUnknown(parsed: unknown): string | null {
  if (typeof parsed === 'number') return String(parsed).trim();
  if (typeof parsed === 'string') {
    const limpio = parsed.trim();
    if (/^\d+$/.test(limpio)) return limpio;
    const match = limpio.match(/\d+/);
    if (match) return match[0];
    return null;
  }
  if (parsed && typeof parsed === 'object') {
    const p = parsed as Record<string, unknown>;
    const candidatoDirecto =
      p.novedad_id ?? p.sqr ?? p.numero ?? p.id ?? p.consecutivo ??
      p.novedad ?? p.result ?? p.codigo ?? p.message ?? p.mensaje;
    const directo = extraerNumeroSqrDesdeUnknown(candidatoDirecto);
    if (directo) return directo;
    if (p.data != null) {
      const desdeData = extraerNumeroSqrDesdeUnknown(p.data);
      if (desdeData) return desdeData;
    }
    if (p.payload != null) {
      const desdePayload = extraerNumeroSqrDesdeUnknown(p.payload);
      if (desdePayload) return desdePayload;
    }
  }
  return null;
}

async function abrirSqr(objeto: string): Promise<string> {
  const resp = await fetch('https://grupocolba.com/service/public/api/sqr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ objeto }),
    cache: 'no-store',
  });
  const rawText = await resp.text();
  if (!resp.ok) throw new Error(rawText || `Error HTTP ${resp.status} al crear SQR`);
  let parsed: unknown = rawText;
  try { parsed = JSON.parse(rawText); } catch { parsed = rawText; }
  const sqrNumero = extraerNumeroSqrDesdeUnknown(parsed);
  if (sqrNumero) return sqrNumero;
  throw new Error(`La API SQR respondió sin un número de SQR reconocible. Respuesta: ${rawText}`);
}

function esc(v: string): string {
  return v.replace(/'/g, "''");
}

/* ── GET /api/solicitudes ─────────────────────────────────────────────────── */

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;
  try {
    const { searchParams } = new URL(req.url);

    const estado  = searchParams.get('estado')?.trim() ?? '';
    const origen  = searchParams.get('origen')?.trim() ?? '';
    const page    = Math.max(1, parseIntSafe(searchParams.get('page'), 1));
    const limit   = Math.min(500, Math.max(1, parseIntSafe(searchParams.get('limit'), 50)));
    const q       = searchParams.get('q')?.trim() ?? '';

    const excluirCerradas    = searchParams.get('excluirCerradas') === 'true';
    const sinProcData        = searchParams.get('sinProcData') === 'true';

    const entidadParam       = searchParams.get('entidad')?.trim() ?? '';
    const modalidadParam     = searchParams.get('modalidad')?.trim() ?? '';
    const fuenteParam        = searchParams.get('fuente')?.trim() ?? '';
    const codigoParam        = searchParams.get('codigo')?.trim() ?? '';
    const ciudadParam        = searchParams.get('ciudad')?.trim() ?? '';
    const desdeParam         = searchParams.get('desde')?.trim() ?? '';
    const hastaParam         = searchParams.get('hasta')?.trim() ?? '';
    const aliasFuenteParam   = searchParams.get('aliasFuente')?.trim() ?? '';
    const soloParaValidar    = searchParams.get('soloParaValidar')    === 'true';
    const soloEnEjecucion    = searchParams.get('soloEnEjecucion')   === 'true';
    const soloEnObservacion  = searchParams.get('soloEnObservacion') === 'true';
    const soloEnEvaluacion   = searchParams.get('soloEnEvaluacion')  === 'true';
    const soloCerradas          = searchParams.get('soloCerradas')          === 'true';
    const filtroEstadoCerrado   = searchParams.get('filtroEstadoCerrado')?.trim() ?? '';
    const aliasFuentePublico    = searchParams.get('aliasFuentePublico')    === 'true';
    const aliasFuentePrivado = searchParams.get('aliasFuentePrivado') === 'true';
    // Ajuste "MÓDULO SQR" — visibilidad de todas las SQR asociadas, sin
    // importar el estado del proceso (proceso y SQR son estados
    // independientes). `filtroSqr` nunca cambia el criterio base
    // `sqrNumero IS NOT NULL` — solo lo restringe más.
    const soloSqr   = searchParams.get('soloSqr') === 'true';
    const filtroSqr = searchParams.get('filtroSqr')?.trim() ?? 'todas';
    // Ajuste "ESTADO FINAL SQR — EN PROCESO" — dimensión de filtro
    // INDEPENDIENTE de `filtroSqr` (Abierta/Cerrada, sobre `sqrCerrada`).
    // Esta filtra por `estadoFinalSqr` (En proceso=null / Presentados=true
    // / No presentados=false) — nunca se combinan como si fueran lo mismo.
    const filtroFinal = searchParams.get('filtroFinal')?.trim() ?? 'todos';

    // Mapeo inverso: texto visible → código numérico guardado en DB
    const MODALIDAD_A_CODIGO: Record<string, string> = {
      'licitacion publica': '2', 'licitacion': '2',
      'seleccion abreviada': '3',
      'contratacion directa': '1',
      'concurso de meritos': '4',
      'minima cuantia': '5',
      'regimen especial': '6',
    };
    const sinAcentos = (s: string) => s.toLowerCase()
      .replace(/[áàäâ]/g,'a').replace(/[éèëê]/g,'e').replace(/[íìïî]/g,'i')
      .replace(/[óòöô]/g,'o').replace(/[úùüû]/g,'u').replace(/[ñ]/g,'n').replace(/[ç]/g,'c');
    const modalidadCodigo = modalidadParam ? (MODALIDAD_A_CODIGO[sinAcentos(modalidadParam)] ?? null) : null;
    // Regex por modalidad: SA cubre SAMC/SAMCA; CM[^C] excluye CMC; MC|CMC cubre mínima cuantía
    const MODALIDAD_REGEX: Record<string, string> = {
      'seleccion abreviada': '^SA',
      'licitacion publica': '^LP', 'licitacion': '^LP',
      'contratacion directa': '^CD',
      'minima cuantia': '^(MC|CMC)',
      'concurso de meritos': '^CM[^C]',
      'regimen especial': '^RE',
    };
    const modalidadRegex = modalidadParam ? (MODALIDAD_REGEX[sinAcentos(modalidadParam)] ?? null) : null;
    // REPLACE anidados para quitar acentos en SQL
    const normSQL = (col: string) =>
      `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(lower(${col}),'á','a'),'é','e'),'í','i'),'ó','o'),'ú','u')`;
    const modalidadSQL = (_e: string) => {
      const sinTilde = sinAcentos(modalidadParam);
      const parts: string[] = [`${normSQL('COALESCE("modalidad",\'\')')} LIKE '%${sinTilde}%'`];
      if (modalidadCodigo) parts.push(`"modalidad" = '${modalidadCodigo}'`);
      if (modalidadRegex) parts.push(`"codigoProceso" ~* '${modalidadRegex}'`);
      return `(${parts.join(' OR ')})`;
    };
    // Si fuenteParam es 'S1' o 'S2', filtrar por aliasFuente (confiable)
    const fuenteEsAlias = fuenteParam === 'S1' || fuenteParam === 'S2';
    const fuenteSQL = (e: string) => fuenteEsAlias
      ? `"aliasFuente" = '${esc(fuenteParam)}'`
      : `"fuente" ILIKE '%${e}%'`;

    // ── Rama soloSqr: SQL raw, SELECT reducido — solo columnas usadas por
    // el módulo SQR. Nunca cruza con el estado del proceso (por diseño,
    // ver ajuste "SQR DESACOPLADA DEL CIERRE DEL PROCESO") ──────────────
    if (soloSqr) {
      const conds: string[] = [`"sqrNumero" IS NOT NULL`];
      if (filtroSqr === 'abiertas') conds.push(`"sqrCerrada" = false`);
      else if (filtroSqr === 'cerradas') conds.push(`"sqrCerrada" = true`);
      if (filtroFinal === 'enProceso') conds.push(`"estadoFinalSqr" IS NULL`);
      else if (filtroFinal === 'presentados') conds.push(`"estadoFinalSqr" = true`);
      else if (filtroFinal === 'noPresentados') conds.push(`"estadoFinalSqr" = false`);
      if (q) {
        const eq = esc(q);
        conds.push(`("sqrNumero" ILIKE '%${eq}%' OR "codigoProceso" ILIKE '%${eq}%' OR "entidad" ILIKE '%${eq}%' OR "objeto" ILIKE '%${eq}%')`);
      }
      const whereSQL = `WHERE ${conds.join(' AND ')}`;
      const offset = (page - 1) * limit;

      const countRes = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*) AS count FROM "Solicitud" ${whereSQL}`
      );
      const total = Number(countRes[0].count);

      const registros = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT id,"codigoProceso",entidad,objeto,"sqrNumero","sqrCreada","sqrCerrada",
         "sqrError","sqrCierreEstado","estadoFinalSqr","fechaAperturaSqr","fechaCierreSqr"
         FROM "Solicitud" ${whereSQL}
         ORDER BY "fechaAperturaSqr" DESC NULLS LAST, "createdAt" DESC
         LIMIT ${limit} OFFSET ${offset}`
      );

      return NextResponse.json({
        ok: true,
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        solicitudes: registros.map(s => serializeSolicitud(s)),
      });
    }

    // ── Rama soloParaValidar: usa SQL raw ─────────────────────────────────
    if (soloParaValidar) {
      const BLOQUEADOS = [
        'LISTO_PARA_VALIDAR','CON_OBSERVACIONES','APROBADO_ELABORACION',
        'SIN_OBSERVACIONES','EN_ELABORACION','PRESENTADO','RECHAZADO',
        'CERRADO_ADJUDICADO','CERRADO_NO_ADJUDICADO','CERRADO_NO_CUMPLIMIENTO',
        'CANCELADO',
      ];
      const bloqueadosSQL = BLOQUEADOS.map(e => `'${e}'`).join(',');
      const canonPorValidarSQL = sqlListaComillas(estadosCanonicosDeBandeja('POR_VALIDAR'));
      const canonTodosSQL = sqlListaComillas(ESTADOS_CANONICOS_CUBIERTOS);

      const conds: string[] = [
        // P0 — compatibilidad canónico/legado (ver bandeja-canonico.ts):
        // si estadoSolicitud es un canónico cubierto, decide él solo, sin
        // mirar el arreglo. Si no lo es, se conserva la heurística legada
        // exactamente igual que antes — cero cambio para esos registros.
        `(
          "estadoSolicitud" IN (${canonPorValidarSQL})
          OR (
            "estadoSolicitud" NOT IN (${canonTodosSQL})
            AND jsonb_array_length(asignaciones) > 0
            AND (
              asignaciones -> -1 ->> 'estadoRevision' NOT IN (${bloqueadosSQL})
              OR asignaciones -> -1 ->> 'estadoRevision' IS NULL
              OR asignaciones -> -1 ->> 'estadoRevision' = ''
            )
          )
        )`,
        // Red de seguridad P0 §7: ningún estado terminal en bandeja activa
        // (corrige el caso Solicitud 24 / SQR 134 sin tocar su arreglo).
        SQL_NO_TERMINAL,
      ];

      // Filtro público/privado correcto usando los valores reales de aliasFuente
      if (aliasFuentePublico) conds.push(`"aliasFuente" IN ('S1','S2')`);
      if (aliasFuentePrivado) conds.push(`"aliasFuente" NOT IN ('S1','S2')`);

      if (estado)           conds.push(`"estadoSolicitud" = '${esc(estado)}'`);
      if (origen)           conds.push(`"origenSolicitud" = '${esc(normalizarOrigenSolicitud(origen))}'`);
      if (entidadParam)     conds.push(`"perfil" ILIKE '%${esc(entidadParam)}%'`);
      if (modalidadParam)   conds.push(modalidadSQL(esc(modalidadParam)));
      if (fuenteParam)      conds.push(fuenteSQL(esc(fuenteParam)));
      if (codigoParam)      conds.push(`"codigoProceso" ILIKE '%${esc(codigoParam)}%'`);
      if (aliasFuenteParam) conds.push(`"aliasFuente" ILIKE '%${esc(aliasFuenteParam)}%'`);
      if (ciudadParam)      conds.push(`("ciudad" ILIKE '%${esc(ciudadParam)}%' OR "departamento" ILIKE '%${esc(ciudadParam)}%')`);
      if (desdeParam)       conds.push(`"createdAt" >= '${esc(desdeParam)}'`);
      if (hastaParam)       conds.push(`"createdAt" <= '${esc(hastaParam)}T23:59:59'`);
      if (q) {
        const eq = esc(q);
        conds.push(`("codigoProceso" ILIKE '%${eq}%' OR "entidad" ILIKE '%${eq}%' OR "objeto" ILIKE '%${eq}%' OR "perfil" ILIKE '%${eq}%' OR "sqrNumero" ILIKE '%${eq}%' OR "personaContacto" ILIKE '%${eq}%')`);
      }

      const whereSQL = `WHERE ${conds.join(' AND ')}`;
      const offset   = (page - 1) * limit;

      const countRes = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*) AS count FROM "Solicitud" ${whereSQL}`
      );
      const total = Number(countRes[0].count);

      const registros = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT id,"procesoId","procesoSourceKey","externalId","codigoProceso","nombreProceso",
         entidad,objeto,fuente,"aliasFuente",modalidad,perfil,departamento,ciudad,sede,plataforma,
         "estadoSolicitud","estadoFuente","origenSolicitud","fechaPublicacion","fechaVencimiento",
         "fechaCierre",valor,"linkDetalle","linkSecop","linkSecopReg","sqrNumero","sqrCreada",
         "sqrCerrada","sqrError","fechaAperturaSqr","fechaCierreSqr","fechaEntregaInfo",
         ${SQL_ASIG_LAST},${SQL_ASIG_RESUMEN},${SQL_RESPONSABLES_RESUMEN},${SQL_CANTIDAD_RESPONSABLES},revisor,aprobador,observacion,"resultadoFinal","causalCierre",
         "usuarioRegistro","emailRegistro","cargoRegistro","entidadRegistro",
         "nitContacto","personaContacto","telefonoContacto","direccionContacto","correoContacto",
         "procStep","createdAt","updatedAt"
         FROM "Solicitud" ${whereSQL}
         ORDER BY "createdAt" DESC
         LIMIT ${limit} OFFSET ${offset}`
      );

      return NextResponse.json({
        ok: true,
        total,
        page,
        limit,
        solicitudes: registros.map(s => serializeSolicitud(s)),
      });
    }

    // ── Rama soloEnEjecucion: SQL raw, sin procData ───────────────────────
    if (soloEnEjecucion) {
      // Condición principal: estadoSolicitud coincide con los patrones de ejecución
      // Y el último estadoRevision del array asignaciones NO bloquea (igual que lógica cliente)
      const canonEjecucionSQL = sqlListaComillas(estadosCanonicosDeBandeja('EN_EJECUCION'));
      const canonTodosEjecSQL = sqlListaComillas(ESTADOS_CANONICOS_CUBIERTOS);
      const conds: string[] = [
        // P0 — mismo patrón de compatibilidad que soloParaValidar: los 11
        // registros APROBADO_ELABORACION/EN_ELABORACION escritos por el
        // motor canónico (001a496) entran por aquí; los legados en texto
        // español siguen exactamente el camino de siempre, sin cambios.
        // asignaciones IS NULL cubre filas antiguas donde la columna pudo
        // quedar nula; coincide con safeArray(null) → [] → sin bloqueo en
        // el filtro del frontend.
        //
        // P0.1 (revisado) — LISTO_PARA_VALIDAR (fila) / REVISION_FINALIZADA
        // (estadoSolicitud canónico) YA NO tienen aprobación posterior de
        // Coordinador/Director — el flujo vigente es Observación → Ejecución
        // directo. Se tratan como equivalentes históricos de "En ejecución"
        // (ver bandeja-canonico.ts) SOLO para lectura/clasificación — no se
        // migran los 8 registros con UPDATE, solo se vuelven visibles aquí.
        `(
          "estadoSolicitud" IN (${canonEjecucionSQL})
          OR (
            "estadoSolicitud" NOT IN (${canonTodosEjecSQL})
            AND (
              (
                ("estadoSolicitud" ILIKE '%asignado para elaboraci%'
                  OR "estadoSolicitud" ILIKE '%presentado%'
                  OR "estadoSolicitud" ILIKE '%listo para presentar%')
                AND (asignaciones IS NULL
                  OR jsonb_array_length(asignaciones) = 0
                  OR asignaciones -> -1 ->> 'estadoRevision' NOT IN ('EN_ELABORACION','PRESENTADO','CANCELADO'))
              )
              OR (
                asignaciones IS NOT NULL AND jsonb_array_length(asignaciones) > 0
                AND asignaciones -> -1 ->> 'estadoRevision' = 'LISTO_PARA_VALIDAR'
              )
              -- Corrección clasificación de bandejas — "En elaboración"
              -- (texto legado, equivalente de EN_ELABORACION) pertenece SIEMPRE a
              -- Ejecución. Condición independiente (no se envuelve en la
              -- exclusión de arriba, que descarta EN_ELABORACION a
              -- propósito para el patrón "asignado para elaboraci" —
              -- aquí es justo lo contrario: EN_ELABORACION es el caso
              -- normal y esperado).
              OR "estadoSolicitud" ILIKE '%en elaboraci%'
            )
          )
        )`,
        SQL_NO_TERMINAL,
      ];

      if (aliasFuentePublico) conds.push(`"aliasFuente" IN ('S1','S2')`);
      if (aliasFuentePrivado) conds.push(`"aliasFuente" NOT IN ('S1','S2')`);
      if (estado)           conds.push(`"estadoSolicitud" = '${esc(estado)}'`);
      if (origen)           conds.push(`"origenSolicitud" = '${esc(normalizarOrigenSolicitud(origen))}'`);
      if (entidadParam)     conds.push(`"perfil" ILIKE '%${esc(entidadParam)}%'`);
      if (modalidadParam)   conds.push(modalidadSQL(esc(modalidadParam)));
      if (fuenteParam)      conds.push(fuenteSQL(esc(fuenteParam)));
      if (codigoParam)      conds.push(`"codigoProceso" ILIKE '%${esc(codigoParam)}%'`);
      if (aliasFuenteParam) conds.push(`"aliasFuente" ILIKE '%${esc(aliasFuenteParam)}%'`);
      if (ciudadParam)      conds.push(`("ciudad" ILIKE '%${esc(ciudadParam)}%' OR "departamento" ILIKE '%${esc(ciudadParam)}%')`);
      if (desdeParam)       conds.push(`"createdAt" >= '${esc(desdeParam)}'`);
      if (hastaParam)       conds.push(`"createdAt" <= '${esc(hastaParam)}T23:59:59'`);
      if (q) {
        const eq = esc(q);
        conds.push(`("codigoProceso" ILIKE '%${eq}%' OR "entidad" ILIKE '%${eq}%' OR "objeto" ILIKE '%${eq}%' OR "perfil" ILIKE '%${eq}%' OR "sqrNumero" ILIKE '%${eq}%' OR "personaContacto" ILIKE '%${eq}%')`);
      }

      const whereSQL = `WHERE ${conds.join(' AND ')}`;
      const offset   = (page - 1) * limit;

      const countRes = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*) AS count FROM "Solicitud" ${whereSQL}`
      );
      const total = Number(countRes[0].count);

      // SELECT idéntico a soloParaValidar pero SIN procData ni obsData ni docData
      const registros = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT id,"procesoId","procesoSourceKey","externalId","codigoProceso","nombreProceso",
         entidad,objeto,fuente,"aliasFuente",modalidad,perfil,departamento,ciudad,sede,plataforma,
         "estadoSolicitud","estadoFuente","origenSolicitud","fechaPublicacion","fechaVencimiento",
         "fechaCierre",valor,"linkDetalle","linkSecop","linkSecopReg","sqrNumero","sqrCreada",
         "sqrCerrada","sqrError","fechaAperturaSqr","fechaCierreSqr","fechaEntregaInfo",
         ${SQL_ASIG_LAST},${SQL_ASIG_RESUMEN},${SQL_RESPONSABLES_RESUMEN},${SQL_CANTIDAD_RESPONSABLES},revisor,aprobador,observacion,"resultadoFinal","causalCierre",
         "usuarioRegistro","emailRegistro","cargoRegistro","entidadRegistro",
         "nitContacto","personaContacto","telefonoContacto","direccionContacto","correoContacto",
         "procStep","createdAt","updatedAt"
         FROM "Solicitud" ${whereSQL}
         ORDER BY "createdAt" DESC
         LIMIT ${limit} OFFSET ${offset}`
      );

      return NextResponse.json({
        ok: true,
        total,
        page,
        limit,
        solicitudes: registros.map(s => serializeSolicitud(s)),
      });
    }

    // ── Rama soloEnObservacion: SQL raw, sin procData ────────────────────
    if (soloEnObservacion) {
      const canonObsSQL = sqlListaComillas(estadosCanonicosDeBandeja('EN_OBSERVACION'));
      const canonTodosObsSQL = sqlListaComillas(ESTADOS_CANONICOS_CUBIERTOS);
      const conds: string[] = [
        // P0 — compatibilidad canónico/legado, ver bandeja-canonico.ts.
        `(
          "estadoSolicitud" IN (${canonObsSQL})
          OR (
            "estadoSolicitud" NOT IN (${canonTodosObsSQL})
            AND asignaciones IS NOT NULL
            AND jsonb_array_length(asignaciones) > 0
            AND asignaciones -> -1 ->> 'estadoRevision' = 'CON_OBSERVACIONES'
          )
        )`,
        SQL_NO_TERMINAL,
      ];

      if (aliasFuentePublico) conds.push(`"aliasFuente" IN ('S1','S2')`);
      if (aliasFuentePrivado) conds.push(`"aliasFuente" NOT IN ('S1','S2')`);
      if (estado)           conds.push(`"estadoSolicitud" = '${esc(estado)}'`);
      if (origen)           conds.push(`"origenSolicitud" = '${esc(normalizarOrigenSolicitud(origen))}'`);
      if (entidadParam)     conds.push(`"perfil" ILIKE '%${esc(entidadParam)}%'`);
      if (modalidadParam)   conds.push(modalidadSQL(esc(modalidadParam)));
      if (fuenteParam)      conds.push(fuenteSQL(esc(fuenteParam)));
      if (codigoParam)      conds.push(`"codigoProceso" ILIKE '%${esc(codigoParam)}%'`);
      if (aliasFuenteParam) conds.push(`"aliasFuente" ILIKE '%${esc(aliasFuenteParam)}%'`);
      if (ciudadParam)      conds.push(`("ciudad" ILIKE '%${esc(ciudadParam)}%' OR "departamento" ILIKE '%${esc(ciudadParam)}%')`);
      if (desdeParam)       conds.push(`"createdAt" >= '${esc(desdeParam)}'`);
      if (hastaParam)       conds.push(`"createdAt" <= '${esc(hastaParam)}T23:59:59'`);
      if (q) {
        const eq = esc(q);
        conds.push(`("codigoProceso" ILIKE '%${eq}%' OR "entidad" ILIKE '%${eq}%' OR "objeto" ILIKE '%${eq}%' OR "perfil" ILIKE '%${eq}%' OR "sqrNumero" ILIKE '%${eq}%' OR "personaContacto" ILIKE '%${eq}%')`);
      }

      const whereSQL = `WHERE ${conds.join(' AND ')}`;
      const offset   = (page - 1) * limit;

      const countRes = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*) AS count FROM "Solicitud" ${whereSQL}`
      );
      const total = Number(countRes[0].count);

      const registros = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT id,"procesoId","procesoSourceKey","externalId","codigoProceso","nombreProceso",
         entidad,objeto,fuente,"aliasFuente",modalidad,perfil,departamento,ciudad,sede,plataforma,
         "estadoSolicitud","estadoFuente","origenSolicitud","fechaPublicacion","fechaVencimiento",
         "fechaCierre",valor,"linkDetalle","linkSecop","linkSecopReg","sqrNumero","sqrCreada",
         "sqrCerrada","sqrError","fechaAperturaSqr","fechaCierreSqr","fechaEntregaInfo",
         ${SQL_ASIG_LAST},${SQL_ASIG_RESUMEN},${SQL_RESPONSABLES_RESUMEN},${SQL_CANTIDAD_RESPONSABLES},revisor,aprobador,observacion,"resultadoFinal","causalCierre",
         "usuarioRegistro","emailRegistro","cargoRegistro","entidadRegistro",
         "nitContacto","personaContacto","telefonoContacto","direccionContacto","correoContacto",
         "procStep","createdAt","updatedAt"
         FROM "Solicitud" ${whereSQL}
         ORDER BY "createdAt" DESC
         LIMIT ${limit} OFFSET ${offset}`
      );

      return NextResponse.json({
        ok: true,
        total,
        page,
        limit,
        solicitudes: registros.map(s => serializeSolicitud(s)),
      });
    }

    // ── Rama soloEnEvaluacion: SQL raw, sin procData ──────────────────────
    if (soloEnEvaluacion) {
      const canonEvalSQL = sqlListaComillas(estadosCanonicosDeBandeja('EN_EVALUACION'));
      const canonTodosEvalSQL = sqlListaComillas(ESTADOS_CANONICOS_CUBIERTOS);
      const conds: string[] = [
        // Corrección clasificación de bandejas (regla general —
        // EN_ELABORACION nunca pertenece a Evaluación): antes esta rama incluía
        // `asignaciones[-1].estadoRevision = 'EN_ELABORACION'` Y
        // `estadoSolicitud ILIKE '%en elaboraci%'` — ambas condiciones
        // atrapaban procesos en elaboración (canónicos O en texto legado
        // "En elaboración") dentro de "En evaluación". Evaluación es
        // EXCLUSIVAMENTE PRESENTADO/"en evaluación" — elaboración (en
        // cualquiera de sus formas) pertenece siempre a Ejecución
        // (ver soloEnEjecucion, misma corrección).
        `(
          "estadoSolicitud" IN (${canonEvalSQL})
          OR (
            "estadoSolicitud" NOT IN (${canonTodosEvalSQL})
            AND (
              (asignaciones IS NOT NULL
                AND jsonb_array_length(asignaciones) > 0
                AND asignaciones -> -1 ->> 'estadoRevision' = 'PRESENTADO')
              OR "estadoSolicitud" ILIKE '%en evaluaci%'
            )
          )
        )`,
        SQL_NO_TERMINAL,
      ];

      if (aliasFuentePublico) conds.push(`"aliasFuente" IN ('S1','S2')`);
      if (aliasFuentePrivado) conds.push(`"aliasFuente" NOT IN ('S1','S2')`);
      if (estado)           conds.push(`"estadoSolicitud" = '${esc(estado)}'`);
      if (origen)           conds.push(`"origenSolicitud" = '${esc(normalizarOrigenSolicitud(origen))}'`);
      if (entidadParam)     conds.push(`"perfil" ILIKE '%${esc(entidadParam)}%'`);
      if (modalidadParam)   conds.push(modalidadSQL(esc(modalidadParam)));
      if (fuenteParam)      conds.push(fuenteSQL(esc(fuenteParam)));
      if (codigoParam)      conds.push(`"codigoProceso" ILIKE '%${esc(codigoParam)}%'`);
      if (aliasFuenteParam) conds.push(`"aliasFuente" ILIKE '%${esc(aliasFuenteParam)}%'`);
      if (ciudadParam)      conds.push(`("ciudad" ILIKE '%${esc(ciudadParam)}%' OR "departamento" ILIKE '%${esc(ciudadParam)}%')`);
      if (desdeParam)       conds.push(`"createdAt" >= '${esc(desdeParam)}'`);
      if (hastaParam)       conds.push(`"createdAt" <= '${esc(hastaParam)}T23:59:59'`);
      if (q) {
        const eq = esc(q);
        conds.push(`("codigoProceso" ILIKE '%${eq}%' OR "entidad" ILIKE '%${eq}%' OR "objeto" ILIKE '%${eq}%' OR "perfil" ILIKE '%${eq}%' OR "sqrNumero" ILIKE '%${eq}%' OR "personaContacto" ILIKE '%${eq}%')`);
      }

      const whereSQL = `WHERE ${conds.join(' AND ')}`;
      const offset   = (page - 1) * limit;

      const countRes = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*) AS count FROM "Solicitud" ${whereSQL}`
      );
      const total = Number(countRes[0].count);

      const registros = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT id,"procesoId","procesoSourceKey","externalId","codigoProceso","nombreProceso",
         entidad,objeto,fuente,"aliasFuente",modalidad,perfil,departamento,ciudad,sede,plataforma,
         "estadoSolicitud","estadoFuente","origenSolicitud","fechaPublicacion","fechaVencimiento",
         "fechaCierre",valor,"linkDetalle","linkSecop","linkSecopReg","sqrNumero","sqrCreada",
         "sqrCerrada","sqrError","fechaAperturaSqr","fechaCierreSqr","fechaEntregaInfo",
         ${SQL_ASIG_LAST},${SQL_ASIG_RESUMEN},${SQL_RESPONSABLES_RESUMEN},${SQL_CANTIDAD_RESPONSABLES},revisor,aprobador,observacion,"resultadoFinal","causalCierre",
         "usuarioRegistro","emailRegistro","cargoRegistro","entidadRegistro",
         "nitContacto","personaContacto","telefonoContacto","direccionContacto","correoContacto",
         "procStep","createdAt","updatedAt"
         FROM "Solicitud" ${whereSQL}
         ORDER BY "createdAt" DESC
         LIMIT ${limit} OFFSET ${offset}`
      );

      return NextResponse.json({
        ok: true,
        total,
        page,
        limit,
        solicitudes: registros.map(s => serializeSolicitud(s)),
      });
    }

    // ── Rama soloCerradas: SQL raw, sin procData ──────────────────────────
    if (soloCerradas) {
      const conds: string[] = [
        // P0: se agregan los equivalentes canónicos CERRADA/CANCELADA —
        // aditivo, los legados 'Cerrada'/'Cancelada'/'Rechazada' siguen igual.
        `"estadoSolicitud" IN ('Cerrada','Cancelada','Rechazada','CERRADA','CANCELADA')`,
      ];
      // Filtro server-side por categoria de cierre (reduce payload vs filtro client-side)
      if (filtroEstadoCerrado === 'adjudicado') {
        conds.push(`(asignaciones IS NOT NULL AND jsonb_array_length(asignaciones) > 0 AND asignaciones -> -1 ->> 'estadoRevision' = 'CERRADO_ADJUDICADO')`);
      } else if (filtroEstadoCerrado === 'noAdjudicado') {
        conds.push(`(asignaciones IS NOT NULL AND jsonb_array_length(asignaciones) > 0 AND asignaciones -> -1 ->> 'estadoRevision' = 'CERRADO_NO_ADJUDICADO')`);
      } else if (filtroEstadoCerrado === 'noPresentado') {
        conds.push(`(asignaciones IS NOT NULL AND jsonb_array_length(asignaciones) > 0 AND asignaciones -> -1 ->> 'estadoRevision' IN ('CERRADO_NO_CUMPLIMIENTO', 'RECHAZADO'))`);
      } else if (filtroEstadoCerrado === 'cancelado') {
        conds.push(`("estadoSolicitud" ILIKE '%cancelad%' OR (asignaciones IS NOT NULL AND jsonb_array_length(asignaciones) > 0 AND asignaciones -> -1 ->> 'estadoRevision' = 'CANCELADO'))`);
      }

      if (aliasFuentePublico) conds.push(`"aliasFuente" IN ('S1','S2')`);
      if (aliasFuentePrivado) conds.push(`"aliasFuente" NOT IN ('S1','S2')`);
      if (origen)           conds.push(`"origenSolicitud" = '${esc(normalizarOrigenSolicitud(origen))}'`);
      if (entidadParam)     conds.push(`"perfil" ILIKE '%${esc(entidadParam)}%'`);
      if (modalidadParam)   conds.push(modalidadSQL(esc(modalidadParam)));
      if (fuenteParam)      conds.push(fuenteSQL(esc(fuenteParam)));
      if (codigoParam)      conds.push(`"codigoProceso" ILIKE '%${esc(codigoParam)}%'`);
      if (aliasFuenteParam) conds.push(`"aliasFuente" ILIKE '%${esc(aliasFuenteParam)}%'`);
      if (ciudadParam)      conds.push(`("ciudad" ILIKE '%${esc(ciudadParam)}%' OR "departamento" ILIKE '%${esc(ciudadParam)}%')`);
      if (desdeParam)       conds.push(`"createdAt" >= '${esc(desdeParam)}'`);
      if (hastaParam)       conds.push(`"createdAt" <= '${esc(hastaParam)}T23:59:59'`);
      if (q) {
        const eq = esc(q);
        conds.push(`("codigoProceso" ILIKE '%${eq}%' OR "entidad" ILIKE '%${eq}%' OR "objeto" ILIKE '%${eq}%' OR "perfil" ILIKE '%${eq}%' OR "sqrNumero" ILIKE '%${eq}%' OR "personaContacto" ILIKE '%${eq}%')`);
      }

      const whereSQL = `WHERE ${conds.join(' AND ')}`;
      const offset   = (page - 1) * limit;

      const countRes = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*) AS count FROM "Solicitud" ${whereSQL}`
      );
      const total = Number(countRes[0].count);

      const registros = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT id,"procesoId","procesoSourceKey","externalId","codigoProceso","nombreProceso",
         entidad,objeto,fuente,"aliasFuente",modalidad,perfil,departamento,ciudad,sede,plataforma,
         "estadoSolicitud","estadoFuente","origenSolicitud","fechaPublicacion","fechaVencimiento",
         "fechaCierre",valor,"linkDetalle","linkSecop","linkSecopReg","sqrNumero","sqrCreada",
         "sqrCerrada","sqrError","fechaAperturaSqr","fechaCierreSqr","fechaEntregaInfo",
         ${SQL_ASIG_LAST},${SQL_ASIG_RESUMEN},${SQL_RESPONSABLES_RESUMEN},${SQL_CANTIDAD_RESPONSABLES},revisor,aprobador,observacion,"resultadoFinal","causalCierre",
         "usuarioRegistro","emailRegistro","cargoRegistro","entidadRegistro",
         "nitContacto","personaContacto","telefonoContacto","direccionContacto","correoContacto",
         "procStep","createdAt","updatedAt"
         FROM "Solicitud" ${whereSQL}
         ORDER BY "createdAt" DESC
         LIMIT ${limit} OFFSET ${offset}`
      );

      return NextResponse.json({
        ok: true,
        total,
        page,
        limit,
        solicitudes: registros.map(s => serializeSolicitud(s)),
      });
    }

    // ── Rama normal: usa Prisma ────────────────────────────────────────────
    const where: Record<string, unknown> = {};
    if (estado) where.estadoSolicitud = estado;
    else if (excluirCerradas) where.estadoSolicitud = { notIn: ['Cerrada', 'Cancelada', 'Rechazada'] };
    if (origen) where.origenSolicitud = normalizarOrigenSolicitud(origen);
    if (entidadParam)     where.perfil        = { contains: entidadParam,     mode: 'insensitive' };
    if (modalidadParam)   where.modalidad     = { contains: modalidadParam,   mode: 'insensitive' };
    if (fuenteParam)      where.fuente        = { contains: fuenteParam,      mode: 'insensitive' };
    if (codigoParam)      where.codigoProceso = { contains: codigoParam,      mode: 'insensitive' };
    if (aliasFuenteParam) where.aliasFuente   = { contains: aliasFuenteParam, mode: 'insensitive' };
    if (aliasFuentePublico) where.aliasFuente = { in: ['S1','S2'] };
    if (aliasFuentePrivado) where.aliasFuente = { notIn: ['S1','S2'] };
    if (ciudadParam) {
      where.OR = [
        { ciudad:       { contains: ciudadParam, mode: 'insensitive' } },
        { departamento: { contains: ciudadParam, mode: 'insensitive' } },
      ];
    }
    if (desdeParam) where.createdAt = { ...(where.createdAt as object ?? {}), gte: new Date(desdeParam) };
    if (hastaParam) where.createdAt = { ...(where.createdAt as object ?? {}), lte: new Date(`${hastaParam}T23:59:59`) };
    if (q) {
      where.OR = [
        { codigoProceso:    { contains: q, mode: 'insensitive' } },
        { entidad:          { contains: q, mode: 'insensitive' } },
        { objeto:           { contains: q, mode: 'insensitive' } },
        { perfil:           { contains: q, mode: 'insensitive' } },
        { departamento:     { contains: q, mode: 'insensitive' } },
        { usuarioRegistro:  { contains: q, mode: 'insensitive' } },
        { sqrNumero:        { contains: q, mode: 'insensitive' } },
        { origenSolicitud:  { contains: q, mode: 'insensitive' } },
        { nitContacto:      { contains: q, mode: 'insensitive' } },
        { personaContacto:  { contains: q, mode: 'insensitive' } },
        { telefonoContacto: { contains: q, mode: 'insensitive' } },
        { correoContacto:   { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, registros] = await Promise.all([
      prisma.solicitud.count({ where }),
      prisma.solicitud.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id:               true,
          procesoId:        true,
          procesoSourceKey: true,
          externalId:       true,
          codigoProceso:    true,
          nombreProceso:    true,
          entidad:          true,
          objeto:           true,
          fuente:           true,
          aliasFuente:      true,
          modalidad:        true,
          perfil:           true,
          departamento:     true,
          ciudad:           true,
          sede:             true,
          plataforma:       true,
          estadoSolicitud:  true,
          estadoFuente:     true,
          origenSolicitud:  true,
          fechaPublicacion: true,
          fechaVencimiento: true,
          fechaCierre:      true,
          valor:            true,
          linkDetalle:      true,
          linkSecop:        true,
          linkSecopReg:     true,
          sqrNumero:        true,
          sqrCreada:        true,
          sqrCerrada:       true,
          sqrError:         true,
          fechaAperturaSqr: true,
          fechaCierreSqr:   true,
          fechaEntregaInfo: true,
          asignaciones:     true,
          revisor:          true,
          aprobador:        true,
          observacion:      true,
          resultadoFinal:   true,
          causalCierre:     true,
          usuarioRegistro:  true,
          emailRegistro:    true,
          cargoRegistro:    true,
          entidadRegistro:  true,
          nitContacto:      true,
          personaContacto:  true,
          telefonoContacto: true,
          direccionContacto:true,
          correoContacto:   true,
          procStep:         true,
          procData:         !sinProcData,
          createdAt:        true,
          updatedAt:        true,
        },
      }),
    ]);

    return NextResponse.json({
      ok: true,
      total,
      page,
      limit,
      solicitudes: registros.map((s: unknown) =>
        serializeSolicitud(trimAsignaciones(s as Record<string, unknown>))
      ),
    });
  } catch (err) {
    console.error('[GET /api/solicitudes]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Error interno' },
      { status: 500 }
    );
  }
}

/* ── POST /api/solicitudes ────────────────────────────────────────────────── */

/**
 * Lote F1 — autorización de creación. El endpoint no exigía sesión en
 * absoluto (cualquier request podía crear una Solicitud y disparar la
 * apertura de SQR). Se exige ahora sesión válida + uno de los permisos que
 * el frontend ya usa para mostrar "Gestionar proceso" (busqueda.gestionar)
 * o "Crear solicitud" manual (solicitudesComercial.crear /
 * solicitudesEspecializadas.crear), más su equivalente dinámico en
 * PerfilRol (BD) — igual que ya hace el PATCH para agregarResponsables. No
 * se retira ningún permiso histórico: se preservan ambos caminos (Búsqueda
 * y creación manual) para cualquier rol que hoy tenga alguno de los dos.
 */
async function puedeCrearSolicitud(session: SessionUser): Promise<boolean> {
  if (esAdministradorProcesos(session.rol)) return true;
  if (puedeConBD(session.rol, 'busqueda', 'gestionar')) return true;
  if (puedeConBD(session.rol, 'solicitudesComercial', 'crear')) return true;
  if (puedeConBD(session.rol, 'solicitudesEspecializadas', 'crear')) return true;
  if (await hasPermiso(session, 'busqueda_gestionar')) return true;
  if (await hasPermiso(session, 'sol_crear_comercial')) return true;
  if (await hasPermiso(session, 'sol_crear_especializada')) return true;
  return false;
}

// Lote F1.1 — allowlist explícita del body de creación. Antes solo se
// rechazaban `asignaciones`/`estadoSolicitud`; cualquier otro campo
// "peligroso" (sqrNumero, estadoRevision, agregarResponsables, actor,
// registradoPor, etc.) simplemente no se leía en ningún lado — quedaba
// IGNORADO en silencio, no RECHAZADO. Esta lista hace explícito y auditable
// el contrato: cualquier clave fuera de esta lista responde 400 en vez de
// desaparecer sin explicación. Coincide 1:1 con los campos de
// `InputCrearSolicitud` (`crear-solicitud.ts`) que si realmente se leen —
// no se retira ningún campo legítimo de público manual/Cotización/Oferta.
const CAMPOS_POST_PERMITIDOS = new Set([
  'procesoId', 'externalId', 'codigoProceso', 'nombreProceso', 'entidad', 'objeto',
  'fuente', 'aliasFuente', 'origenFuncional', 'modalidad', 'perfil', 'departamento', 'estadoFuente',
  'fechaPublicacion', 'fechaVencimiento', 'valor', 'linkDetalle', 'linkSecop', 'linkSecopReg',
  'ciudad', 'sede', 'plataforma', 'origenSolicitud',
  'nitContacto', 'personaContacto', 'telefonoContacto', 'direccionContacto', 'correoContacto',
  'fechaCierre', 'procStep', 'procData', 'obsData', 'docData',
  'revisor', 'aprobador', 'observacion',
  // usuarioRegistro/emailRegistro se aceptan como claves pero su VALOR se
  // sobrescribe siempre desde la sesión (ver más abajo) — nunca controlan
  // la identidad real del actor. cargoRegistro/entidadRegistro son
  // metadatos informativos (no intervienen en autorización ni en
  // canAccessSolicitud), se conservan del body sin cambios de contrato.
  'usuarioRegistro', 'emailRegistro', 'cargoRegistro', 'entidadRegistro',
  // Enviados por ModalCrearSolicitud (creación manual: público/Cotización/
  // Oferta) pero NUNCA leídos por crearSolicitudConIdentidad — quedan
  // permitidos-e-ignorados para no romper ese formulario, no calculan nada.
  'tipoProceso', 'urlProceso', 'cronogramas', 'cronogramaData', 'totalCronogramas',
]);

export async function POST(req: NextRequest) {
  const sessionPost = await getSession(req);
  const deniedPost = requireSession(sessionPost);
  if (deniedPost) return deniedPost;

  if (!(await puedeCrearSolicitud(sessionPost!))) {
    return NextResponse.json({ ok: false, error: 'No tienes permiso para crear solicitudes.' }, { status: 403 });
  }

  try {
    const body = await req.json();

    if (!body.codigoProceso) {
      return NextResponse.json({ ok: false, error: 'codigoProceso es requerido' }, { status: 400 });
    }

    // `asignaciones`/`estadoSolicitud` YA NO son parte del contrato de
    // creación — la asignación inicial y el estado son responsabilidad
    // exclusiva del backend (crearSolicitudConIdentidad). Mensaje específico
    // (en vez del genérico de la allowlist) porque este cambio de contrato
    // ya rompía clientes desactualizados antes de F1.1 — se conserva el
    // mensaje explicativo original.
    if ('asignaciones' in body || 'estadoSolicitud' in body) {
      return NextResponse.json({
        ok: false,
        error: 'Los campos "asignaciones" y "estadoSolicitud" ya no se aceptan en la creación de una Solicitud — ' +
          'el backend resuelve el responsable y el estado inicial automáticamente según el perfil.',
      }, { status: 400 });
    }

    for (const clave of Object.keys(body)) {
      if (!CAMPOS_POST_PERMITIDOS.has(clave)) {
        return NextResponse.json({ ok: false, error: `Campo no permitido en la creación de una Solicitud: "${clave}".` }, { status: 400 });
      }
    }

    // Actor SIEMPRE de la sesión del servidor — nunca del body (antes se
    // aceptaba cualquier usuarioRegistro/emailRegistro que el cliente enviara).
    body.usuarioRegistro = sessionPost!.usuario ?? '';
    body.emailRegistro = sessionPost!.email ?? '';

    // Resolución de identidad + creación de Proceso/Solicitud en transacción
    // — lógica completa vive en crearSolicitudConIdentidad (Fase 1), reusada
    // tal cual por las pruebas con un cliente Prisma inyectado/mockeado.
    let solicitud;
    try {
      solicitud = await crearSolicitudConIdentidad(prisma, body);
    } catch (e) {
      if (e instanceof SolicitudIdentidadError) {
        console.error('[POST /api/solicitudes][identidad]', e.message);
        return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
      }
      throw e;
    }

    // NIT de la entidad desde los datos abiertos de SECOP, sin demorar la respuesta (la ficha lo vuelve a intentar si falta).
    if (!solicitud.nitContacto && process.env.NODE_ENV !== 'test') {
      void completarNitEntidad(prisma as unknown as Parameters<typeof completarNitEntidad>[0], solicitud.id).catch(() => {});
    }

    let sqrNumero: string | null = null;
    let sqrCreada = false;
    let sqrError: string | null = null;

    try {
      const descripcionSqr = buildSqrDescripcion({
        entidad: solicitud.entidad,
        codigoProceso: solicitud.codigoProceso,
        objeto: solicitud.objeto,
        fuente: solicitud.fuente,
        modalidad: solicitud.modalidad,
        perfil: solicitud.perfil,
        departamento: solicitud.departamento,
        linkDetalle: solicitud.linkDetalle,
        usuarioRegistro: solicitud.usuarioRegistro,
      });
      sqrNumero = await abrirSqr(descripcionSqr);
      sqrCreada = true;
      await prisma.solicitud.update({
        where: { id: solicitud.id },
        data: { sqrNumero, sqrCreada: true, sqrCerrada: false, sqrError: null, fechaAperturaSqr: new Date() },
      });
    } catch (e) {
      sqrError = e instanceof Error ? e.message : 'Error desconocido al crear la SQR';
      console.error('[POST /api/solicitudes][SQR]', sqrError);
      await prisma.solicitud.update({
        where: { id: solicitud.id },
        data: { sqrNumero: null, sqrCreada: false, sqrCerrada: false, sqrError, fechaAperturaSqr: null },
      });
    }

    const solicitudFinal = await prisma.solicitud.findUnique({ where: { id: solicitud.id } });

    return NextResponse.json(
      {
        ok: true,
        solicitud: serializeSolicitud((solicitudFinal ?? solicitud) as unknown as Record<string, unknown>),
        sqrNumero,
        sqrCreada,
        sqrError,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('[POST /api/solicitudes]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Error interno' },
      { status: 500 }
    );
  }
}

/**
 * Verifica que el patch de asignaciones solo haya modificado revisionesObs
 * en el último elemento. Bloquea cambios en cualquier otro campo de las asignaciones.
 */
function soloRevisionesObsModificadas(
  asigsBd: unknown[],
  asigsPatch: unknown[]
): boolean {
  if (asigsBd.length !== asigsPatch.length) return false;
  for (let i = 0; i < asigsBd.length; i++) {
    const bd    = asigsBd[i];
    const patch = asigsPatch[i];
    if (!bd || typeof bd !== 'object' || Array.isArray(bd))       return false;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return false;
    const bdObj    = bd    as Record<string, unknown>;
    const patchObj = patch as Record<string, unknown>;
    const isLast   = i === asigsBd.length - 1;
    const allKeys  = new Set([...Object.keys(bdObj), ...Object.keys(patchObj)]);
    for (const key of allKeys) {
      if (isLast && key === 'revisionesObs') continue; // solo este campo puede cambiar en el último
      if (JSON.stringify(bdObj[key]) !== JSON.stringify(patchObj[key])) return false;
    }
  }
  return true;
}

/** Identidad ESTABLE de una observación a través de una edición o de un
 * cambio de `decision` — `usuario` (quien la creó) + `fecha` (timestamp de
 * creación) nunca cambian cuando se edita el `detalle`/`indicadores` o se
 * marca Aceptada/No aceptada (ver los `.map(...)` de `page.tsx` que
 * preservan ambos campos) — solo cambian cuando la observación se elimina
 * (deja de existir esa combinación) o se agrega una nueva (combinación
 * inédita). Sin esta clave no hay forma de distinguir "editaron la 2ª
 * observación" de "eliminaron la 1ª y agregaron una nueva al final". */
function claveEstableObservacion(o: Record<string, unknown>): string {
  return `${String(o.usuario ?? '')}|${String(o.fecha ?? '')}`;
}

/**
 * Compara `obsBd` (arreglo `observaciones` en BD) contra `obsPatch`
 * (propuesto por el cliente), para UNA fila de `asignaciones` — ajuste
 * "editar/eliminar observaciones": Eliminar exige Administrador O ser quien
 * creó CADA observación eliminada; Editar contenido exige Administrador O
 * pertenecer al proceso comercial (`asig_editar`/matriz `asignaciones.
 * editar`) — dos autorizaciones DISTINTAS, por eso se devuelven por
 * separado. Marcar `decision` (Aceptada/No aceptada) o agregar una
 * observación nueva no requiere ninguna de las dos (comportamiento previo,
 * sin cambios).
 */
function clasificarCambiosObservaciones(
  obsBd: unknown[],
  obsPatch: unknown[],
): { eliminadas: Array<Record<string, unknown>>; hayEdicionDeContenido: boolean } {
  const patchPorClave = new Map<string, Record<string, unknown>>();
  for (const raw of obsPatch) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const o = raw as Record<string, unknown>;
    patchPorClave.set(claveEstableObservacion(o), o);
  }
  const eliminadas: Array<Record<string, unknown>> = [];
  let hayEdicionDeContenido = false;
  for (const raw of obsBd) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const bd = raw as Record<string, unknown>;
    const patch = patchPorClave.get(claveEstableObservacion(bd));
    if (!patch) { eliminadas.push(bd); continue; }
    const allKeys = new Set([...Object.keys(bd), ...Object.keys(patch)]);
    for (const key of allKeys) {
      if (key === 'decision') continue; // el responsable puede marcar Aceptada/No aceptada
      if (JSON.stringify(bd[key]) !== JSON.stringify(patch[key])) { hayEdicionDeContenido = true; break; }
    }
  }
  return { eliminadas, hayEdicionDeContenido };
}

/**
 * Analiza, fila por fila (emparejadas por POSICIÓN, igual que
 * `soloRevisionesObsModificadas`), qué cambió entre el arreglo `asignaciones`
 * en BD y el propuesto por el cliente — Lote F1.1. Distingue:
 *  - `identidadCambia`: se agregó/quitó una fila, o el `analistaAsignado` de
 *    alguna fila existente cambió — SIEMPRE es una reasignación real,
 *    exige `puedeReasignarSolicitud`/`asig_asignar_responsable` sin
 *    excepción (ni siquiera si el remitente es dueño de la solicitud).
 *  - `filasConCambioAjenoAOtroContenido`: filas donde el `analistaAsignado`
 *    NO cambió, pero sí cambió algún otro campo (estado, activo, fecha,
 *    tipo, observación, creador, o cualquier otra propiedad interna) más
 *    allá de `revisionesObs` en la última fila. Cada una de estas filas
 *    requiere que el remitente sea: (a) el propio `analistaAsignado` de esa
 *    fila (gestión legítima de su propio caso — ej. GestionAsignacionInline
 *    actualizando su propio estadoAsignacion/causaEspecifica/observación),
 *    (b) administrador funcional de Procesos, o (c) tenga el permiso
 *    `asig_gestionar` — exactamente la misma regla que ya aplicaba esta
 *    ruta para quien NO era dueño de la solicitud; aquí se aplica también
 *    a quien SÍ lo es, para que un registrante sin fila propia (ej.
 *    Mercadeo) no pueda tampoco alterar el contenido de una fila ajena
 *    aunque mantenga el mismo responsable.
 *  - `filasConEliminacionObservacion`/`filasConEdicionContenidoObservacion`:
 *    ajuste "editar/eliminar observaciones" — Eliminar exige Administrador
 *    O ser quien creó CADA observación eliminada (`eliminadas[].usuario`);
 *    Editar contenido exige Administrador O pertenecer al proceso
 *    comercial (`puedeConBD(rol,'asignaciones','editar')`). Ninguna de las
 *    dos depende de ser dueño de la fila (`analistaAsignado`) ni de
 *    `asig_gestionar`. Agregar una observación nueva o marcar Aceptada/No
 *    aceptada NO cae en ninguna de las dos (ver `clasificarCambiosObservaciones`).
 */
function analizarCambiosAsignaciones(
  asigsBd: unknown[],
  asigsPatch: unknown[],
): {
  identidadCambia: boolean;
  filasConOtroContenidoDistinto: Array<Record<string, unknown>>;
  filasConEliminacionObservacion: Array<{ fila: Record<string, unknown>; eliminadas: Array<Record<string, unknown>> }>;
  filasConEdicionContenidoObservacion: Array<Record<string, unknown>>;
} {
  const vacio = { identidadCambia: true, filasConOtroContenidoDistinto: [], filasConEliminacionObservacion: [], filasConEdicionContenidoObservacion: [] };
  if (asigsBd.length !== asigsPatch.length) {
    return vacio;
  }
  const filasConOtroContenidoDistinto: Array<Record<string, unknown>> = [];
  const filasConEliminacionObservacion: Array<{ fila: Record<string, unknown>; eliminadas: Array<Record<string, unknown>> }> = [];
  const filasConEdicionContenidoObservacion: Array<Record<string, unknown>> = [];
  for (let i = 0; i < asigsBd.length; i++) {
    const bd = asigsBd[i];
    const patch = asigsPatch[i];
    if (!bd || typeof bd !== 'object' || Array.isArray(bd) || !patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return vacio;
    }
    const bdObj = bd as Record<string, unknown>;
    const patchObj = patch as Record<string, unknown>;
    if (String(bdObj.analistaAsignado ?? '') !== String(patchObj.analistaAsignado ?? '')) {
      return vacio;
    }
    const isLast = i === asigsBd.length - 1;
    const allKeys = new Set([...Object.keys(bdObj), ...Object.keys(patchObj)]);
    let filaDistinta = false;
    for (const key of allKeys) {
      if (isLast && key === 'revisionesObs') continue;
      // `observaciones` tiene su PROPIA autorización (edicion/eliminacion,
      // ver abajo), independiente de la ownership de la fila — se excluye
      // aquí para que un cambio EXCLUSIVAMENTE de observaciones no caiga en
      // `filasConOtroContenidoDistinto` (que exige dueño de la fila o
      // `asig_gestionar`, una regla más restrictiva/distinta que ya no
      // aplica a observaciones desde este ajuste).
      if (key === 'observaciones') continue;
      if (JSON.stringify(bdObj[key]) !== JSON.stringify(patchObj[key])) { filaDistinta = true; break; }
    }
    if (filaDistinta) filasConOtroContenidoDistinto.push(patchObj);

    const obsBd = Array.isArray(bdObj.observaciones) ? bdObj.observaciones : [];
    const obsPatch = Array.isArray(patchObj.observaciones) ? patchObj.observaciones : [];
    if (JSON.stringify(obsBd) !== JSON.stringify(obsPatch)) {
      const { eliminadas, hayEdicionDeContenido } = clasificarCambiosObservaciones(obsBd, obsPatch);
      if (eliminadas.length > 0) filasConEliminacionObservacion.push({ fila: patchObj, eliminadas });
      if (hayEdicionDeContenido) filasConEdicionContenidoObservacion.push(patchObj);
    }
  }
  return { identidadCambia: false, filasConOtroContenidoDistinto, filasConEliminacionObservacion, filasConEdicionContenidoObservacion };
}
/* ── PATCH /api/solicitudes ───────────────────────────────────────────────── */

export async function PATCH(req: NextRequest) {
  const sessionPatch = await getSession(req);
  const deniedPatch = requireSession(sessionPatch);
  if (deniedPatch) return deniedPatch;
  try {
    const body = await req.json();
    const {
      id, entidad, objeto, modalidad, perfil, ciudad, plataforma, fechaCierre,
      estadoSolicitud, origenSolicitud,
      nitContacto, personaContacto, telefonoContacto, direccionContacto, correoContacto,
      linkDetalle, urlProceso,
      procStep, procData, revisor, aprobador, asignaciones: asignacionesBody, obsData, docData,
      observacion, resultadoFinal, causalCierre, sqrCerrada, sqrError,
      fechaCierreSqr, fechaEntregaInfo,
      agregarResponsables, removerResponsables, revertirAObservaciones,
    } = body;

    if (!id) {
      return NextResponse.json({ ok: false, error: 'id es requerido' }, { status: 400 });
    }

    // Fase 2B-2.2.10 — `Solicitud.resultadoFinal`/`causalCierre` (campos
    // TOP-LEVEL, distintos de `asignaciones[].resultadoFinal`) son
    // exclusivos de `POST /api/solicitudes/[id]/cerrar`, que ya los deriva
    // de forma validada (nunca del body crudo del cliente — ver ese
    // archivo). Este PATCH genérico los tomaba directamente del body sin
    // ninguna protección, permitiendo escribirlos sin CAS/transacción
    // dedicada y, más grave, disparando el efecto secundario real de
    // `cerrarSqr()` (más abajo en este mismo archivo) sin pasar por esa
    // autoridad. Se rechaza por PRESENCIA de la clave en el body — incluida
    // explícitamente `null`/""/cualquier valor — nunca solo por su verdad,
    // para que ninguna variante del payload pueda colarse. Evaluado antes
    // de leer la Solicitud de BD: ni siquiera necesita su estado actual
    // para decidir el rechazo.
    if (Object.prototype.hasOwnProperty.call(body, 'resultadoFinal') || Object.prototype.hasOwnProperty.call(body, 'causalCierre')) {
      return NextResponse.json({
        ok: false,
        error: 'Los campos "resultadoFinal"/"causalCierre" no pueden modificarse mediante este endpoint. Usa POST /api/solicitudes/[id]/cerrar.',
      }, { status: 400 });
    }

    const solicitudActual = await prisma.solicitud.findUnique({ where: { id: Number(id) } });
    if (!solicitudActual) {
      return NextResponse.json({ ok: false, error: 'No encontrado' }, { status: 404 });
    }

    // Lote F2D — bloqueo de edición general para registros sincronizados.
    // Los datos de ORIGEN (entidad, objeto, modalidad, perfil, ciudad,
    // plataforma, fechaCierre, origenSolicitud, contacto, linkDetalle,
    // urlProceso — exactamente los campos que edita ModalEditarSolicitud)
    // de una Solicitud sincronizada (SECOP I/II, NC real de
    // la fuente externa) solo pueden cambiar por sincronización o por
    // "actualizar ficha" — nunca por este PATCH genérico. Clasificación
    // reutilizando el helper YA EXISTENTE `determinarOrigenProceso`
    // (`src/lib/procesos/origen-proceso.ts`) sobre el Proceso relacionado
    // — nunca `aliasFuente`/`fuente`/`plataforma`/URL de la propia
    // Solicitud como criterio único (una Oferta manual también usa
    // aliasFuente='NC'). Política conservadora: si no hay Proceso
    // relacionado, o el origen es DESCONOCIDO, se trata igual que
    // sincronizado (bloqueado) — nunca se asume manual sin evidencia.
    // Se evalúa ANTES de cualquier otro procesamiento (incluida la
    // reasignación) para que un payload mixto (origen + asignaciones) se
    // rechace completo, sin mutación parcial.
    const camposOrigenGeneral = { entidad, objeto, modalidad, perfil, ciudad, plataforma, fechaCierre, origenSolicitud, nitContacto, personaContacto, telefonoContacto, direccionContacto, correoContacto, linkDetalle, urlProceso };
    const tocaCamposDeOrigen = Object.values(camposOrigenGeneral).some((v) => v !== undefined);
    if (tocaCamposDeOrigen) {
      let origenProceso: OrigenProceso | null = null;
      if (solicitudActual.procesoId != null) {
        const procesoRelacionado = await prisma.proceso.findUnique({
          where: { id: solicitudActual.procesoId },
          select: { sourceKey: true, externalId: true, aliasFuente: true, fuente: true, rawJson: true, origenFuncional: true },
        });
        if (procesoRelacionado) {
          origenProceso = determinarOrigenProceso(procesoRelacionado);
        }
      }
      if (origenProceso !== 'MANUAL') {
        console.error('[PATCH /api/solicitudes] 409 edición de origen bloqueada', { userId: sessionPatch!.id, recursoId: id, origenProceso });
        void auditFromRequest(req, sessionPatch!, { accion: 'access_denied', recurso: 'solicitud', recursoId: String(id), detalle: { endpoint: 'PATCH /api/solicitudes', motivo: 'solicitud_sincronizada_solo_lectura', origenProceso: origenProceso ?? 'SIN_PROCESO' } });
        return NextResponse.json({
          ok: false,
          success: false,
          code: 'SOLICITUD_SINCRONIZADA_SOLO_LECTURA',
          error: 'La información de un proceso sincronizado solo puede actualizarse desde su fuente.',
        }, { status: 409 });
      }
    }

    // Lote F1/F1.1 — gate de reasignación SIEMPRE evaluado, sin importar
    // `canAccessSolicitud` (ser dueño/registrante de la solicitud NO otorga
    // la facultad de agregar/quitar/reemplazar responsables, ni de alterar
    // el contenido de una fila que no es la propia). Se distinguen 2 tipos
    // de cambio sobre `asignaciones` (vía `analizarCambiosAsignaciones`,
    // reutilizada también por el camino de agregarResponsables/
    // removerResponsables):
    //  1. Cambio de IDENTIDAD (se agrega/quita/reemplaza un analistaAsignado)
    //     — SIEMPRE exige `puedeReasignarSolicitud`/`asig_asignar_responsable`,
    //     sin excepción, sin importar ownership. Cierra F1 (brecha 2) y la
    //     brecha 3 (asignaciones en bruto).
    //  2. Cambio de CONTENIDO de una fila SIN cambiar quién es el responsable
    //     (estado, activo, fecha, tipo, observación, creador, o cualquier
    //     otro campo, más allá de revisionesObs en la última fila) — exige,
    //     PARA CADA fila modificada, que el remitente sea el propio
    //     `analistaAsignado` de esa fila (gestión legítima de su propio
    //     caso — ej. GestionAsignacionInline actualizando su propio
    //     estadoAsignacion/causaEspecifica/observación), administrador
    //     funcional, o tenga `asig_gestionar`. Antes de F1.1 esta
    //     validación solo se aplicaba a quien NO era dueño de la
    //     solicitud (Path 2, más abajo); un registrante sin fila propia
    //     (ej. Mercadeo) la evadía por completo si figuraba como dueño.
    const asignacionesBdActuales = Array.isArray(solicitudActual.asignaciones)
      ? (solicitudActual.asignaciones as Record<string, unknown>[])
      : [];
    const agregarORemoverPresente = Array.isArray(agregarResponsables) || Array.isArray(removerResponsables);
    const analisisAsignaciones = Array.isArray(asignacionesBody)
      ? analizarCambiosAsignaciones(asignacionesBdActuales, asignacionesBody)
      : null;

    if (agregarORemoverPresente || (analisisAsignaciones?.identidadCambia)) {
      const autorizadoParaReasignar =
        puedeReasignarSolicitud(sessionPatch!.rol)
        || (await hasPermiso(sessionPatch!, 'asig_asignar_responsable'));
      if (!autorizadoParaReasignar) {
        console.error('[PATCH /api/solicitudes] 403 reasignación no autorizada', { userId: sessionPatch!.id, email: sessionPatch!.email.slice(0, 60), rol: sessionPatch!.rol, recursoId: id });
        void auditFromRequest(req, sessionPatch!, { accion: 'access_denied', recurso: 'solicitud', recursoId: String(id), detalle: { endpoint: 'PATCH /api/solicitudes', motivo: 'reasignacion_no_autorizada', rol: sessionPatch!.rol } });
        return NextResponse.json({ ok: false, error: 'No tienes permiso para agregar, quitar o reemplazar responsables.' }, { status: 403 });
      }
    } else if (analisisAsignaciones && analisisAsignaciones.filasConOtroContenidoDistinto.length > 0) {
      const usuarioEsAdmin = esAdministradorProcesos(sessionPatch!.rol);
      const usuarioTieneGestionar = usuarioEsAdmin || (await hasPermiso(sessionPatch!, 'asig_gestionar'));
      const todasSonPropias = analisisAsignaciones.filasConOtroContenidoDistinto.every((fila) =>
        matchesIdentity(sessionPatch!.email, String(fila.analistaAsignado ?? ''), sessionPatch!.usuario),
      );
      if (!usuarioTieneGestionar && !todasSonPropias) {
        console.error('[PATCH /api/solicitudes] 403 edición de asignación ajena no autorizada', { userId: sessionPatch!.id, email: sessionPatch!.email.slice(0, 60), rol: sessionPatch!.rol, recursoId: id });
        void auditFromRequest(req, sessionPatch!, { accion: 'access_denied', recurso: 'solicitud', recursoId: String(id), detalle: { endpoint: 'PATCH /api/solicitudes', motivo: 'edicion_asignacion_ajena_no_autorizada', rol: sessionPatch!.rol } });
        return NextResponse.json({ ok: false, error: 'No tienes permiso para modificar la asignación de otro responsable.' }, { status: 403 });
      }
    }

    // Ajuste "editar/eliminar observaciones" — autorización INDEPENDIENTE de
    // la ownership de la fila de arriba (`observaciones` se excluyó
    // deliberadamente de `filasConOtroContenidoDistinto` en
    // `analizarCambiosAsignaciones`, ver comentario allí), con dos reglas
    // DISTINTAS:
    //  - Eliminar: Administrador de Procesos O quien creó CADA observación
    //    eliminada (`eliminadas[].usuario` === actor) — ni ser dueño de la
    //    fila ni pertenecer al proceso comercial bastan por sí solos.
    //  - Editar contenido: Administrador de Procesos O pertenece al
    //    "proceso comercial" (`puedeConBD(rol,'asignaciones','editar')` —
    //    misma fuente que `esComercial` en `page.tsx`, sin permisosRol de
    //    BD porque el JWT de sesión no lo trae, igual que el resto de usos
    //    de `puedeConBD` en este archivo).
    // Ambas quedan bloqueadas si la Solicitud ya está cerrada/cancelada
    // ("una vez cerrado no se debe cambiar nada") — agregar una observación
    // nueva o marcar Aceptada/No aceptada no cae en ninguna de las dos.
    if (analisisAsignaciones) {
      const tocaObservacionesExistentes = analisisAsignaciones.filasConEliminacionObservacion.length > 0
        || analisisAsignaciones.filasConEdicionContenidoObservacion.length > 0;
      if (tocaObservacionesExistentes) {
        const usuarioEsAdmin = esAdministradorProcesos(sessionPatch!.rol);
        if (ESTADOS_SOLICITUD_TERMINALES.has(String(solicitudActual.estadoSolicitud))) {
          console.error('[PATCH /api/solicitudes] 409 edición/eliminación de observación en solicitud cerrada', { userId: sessionPatch!.id, recursoId: id });
          void auditFromRequest(req, sessionPatch!, { accion: 'access_denied', recurso: 'solicitud', recursoId: String(id), detalle: { endpoint: 'PATCH /api/solicitudes', motivo: 'observacion_solicitud_cerrada', rol: sessionPatch!.rol } });
          return NextResponse.json({ ok: false, error: 'La solicitud ya está cerrada — no se pueden editar ni eliminar sus observaciones.' }, { status: 409 });
        }
        if (analisisAsignaciones.filasConEliminacionObservacion.length > 0 && !usuarioEsAdmin) {
          const todasPropias = analisisAsignaciones.filasConEliminacionObservacion.every(({ eliminadas }) =>
            eliminadas.every((obs) => matchesIdentity(sessionPatch!.email, String(obs.usuario ?? ''), sessionPatch!.usuario)),
          );
          if (!todasPropias) {
            console.error('[PATCH /api/solicitudes] 403 eliminación de observación no autorizada', { userId: sessionPatch!.id, email: sessionPatch!.email.slice(0, 60), rol: sessionPatch!.rol, recursoId: id });
            void auditFromRequest(req, sessionPatch!, { accion: 'access_denied', recurso: 'solicitud', recursoId: String(id), detalle: { endpoint: 'PATCH /api/solicitudes', motivo: 'eliminacion_observacion_no_autorizada', rol: sessionPatch!.rol } });
            return NextResponse.json({ ok: false, error: 'Solo un Administrador de Procesos o quien creó la observación puede eliminarla.' }, { status: 403 });
          }
        }
        if (analisisAsignaciones.filasConEdicionContenidoObservacion.length > 0) {
          const usuarioEsComercial = puedeConBD(sessionPatch!.rol, 'asignaciones', 'editar');
          if (!usuarioEsAdmin && !usuarioEsComercial) {
            console.error('[PATCH /api/solicitudes] 403 edición de observación no autorizada', { userId: sessionPatch!.id, email: sessionPatch!.email.slice(0, 60), rol: sessionPatch!.rol, recursoId: id });
            void auditFromRequest(req, sessionPatch!, { accion: 'access_denied', recurso: 'solicitud', recursoId: String(id), detalle: { endpoint: 'PATCH /api/solicitudes', motivo: 'edicion_observacion_no_autorizada', rol: sessionPatch!.rol } });
            return NextResponse.json({ ok: false, error: 'Solo un Administrador de Procesos o un usuario del proceso comercial puede editar una observación existente.' }, { status: 403 });
          }
        }
      }
    }

    // Gestión segura de responsables: se calcula sobre el estado ACTUAL en BD
    // (no sobre lo que envía el cliente, que puede venir recortado a la última
    // asignación en las vistas de lista) para no perder co-responsables ni
    // generar idAsignacion duplicados.
    let asignaciones = asignacionesBody;
    // Se pone en true cuando `asignaciones` ya fue recalculado a partir del
    // arreglo COMPLETO en BD (agregarResponsables/removerResponsables o
    // revertirAObservaciones) — en esos casos no hace falta reconciliar de nuevo.
    let asignacionesYaReconciliadas = false;
    // Declarado aquí (antes solo existía para revertirAObservaciones) para
    // que agregarResponsables también pueda fijar el estado coherente sin
    // depender de que el cliente lo mande explícitamente — nunca se confía
    // en que el frontend siempre envíe el campo correcto.
    let estadoSolicitudOverride: string | undefined;
    if (Array.isArray(agregarResponsables) || Array.isArray(removerResponsables)) {
      const actuales = Array.isArray(solicitudActual.asignaciones)
        ? (solicitudActual.asignaciones as Record<string, unknown>[])
        : [];
      const remover: string[] = Array.isArray(removerResponsables) ? removerResponsables : [];
      let nuevas = actuales.filter(a => !remover.includes(String(a.analistaAsignado ?? '')));
      const agregar: Array<{ usuario?: string; cargo?: string; entidadGrupo?: string }> =
        Array.isArray(agregarResponsables) ? agregarResponsables : [];
      const ahora = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const fechaStr = `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())} ${pad(ahora.getHours())}:${pad(ahora.getMinutes())}:${pad(ahora.getSeconds())}`;
      // Si el proceso ya venía avanzando de etapa (p.ej. En ejecución), el nuevo
      // responsable hereda ese mismo estadoRevision — así no retrocede el proceso
      // a una etapa anterior (Por validar) solo por sumar un co-responsable o por
      // reemplazar (Cambiar) al único responsable existente. Se lee de `actuales`
      // (antes del filtro de remoción): si se leyera de `nuevas` ya filtrado, el
      // caso "Cambiar" con un solo responsable dejaría `nuevas` vacío y el estado
      // heredado se perdería, haciendo retroceder el proceso a "Por validar".
      const estadoRevisionHeredado = actuales.length > 0 ? actuales[actuales.length - 1].estadoRevision : undefined;
      for (const r of agregar) {
        const usuario = (r?.usuario ?? '').trim();
        if (!usuario) continue;
        if (nuevas.some(a => String(a.analistaAsignado ?? '') === usuario)) continue; // ya asignado — evita duplicados
        // Nunca se confía en que el frontend mande un responsable real: se
        // valida contra la BD (existe, activo, rol elegible) antes de
        // agregarlo — si no es elegible, se rechaza el PATCH completo (ver
        // más abajo, no se agrega parcialmente ni se ignora en silencio).
        const elegible = await resolverResponsableElegible(prisma, usuario);
        if (!elegible) {
          return NextResponse.json({
            ok: false,
            error: `El usuario "${usuario}" no existe, no está activo, o no tiene un rol habilitado para gestión comercial. No se asigna.`,
          }, { status: 409 });
        }
        const idUnico = `ASG-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        nuevas = [...nuevas, {
          idAsignacion: idUnico,
          solicitudId: solicitudActual.id, solicitudNum: solicitudActual.id,
          analistaAsignado: elegible.usuario, analistaCargo: elegible.cargo,
          analistaEntidad: elegible.entidadGrupo, asignadoPor: sessionPatch!.usuario || '',
          asignadoPorCargo: '', fechaAsignacion: fechaStr,
          estadoAsignacion: 'Pendiente', estadoBandeja: 'pendiente',
          ...(estadoRevisionHeredado != null ? { estadoRevision: estadoRevisionHeredado } : {}),
          entidad: solicitudActual.entidad || '', codigoProceso: solicitudActual.codigoProceso || '',
          objeto: solicitudActual.objeto || '', valor: solicitudActual.valor != null ? Number(solicitudActual.valor) : null,
          modalidad: solicitudActual.modalidad || '', ciudad: solicitudActual.ciudad || '',
          perfil: solicitudActual.perfil || '', fechaVencimiento: solicitudActual.fechaVencimiento || null, observacion: '',
        }];
      }
      asignaciones = nuevas;
      asignacionesYaReconciliadas = true;
      // Primera asignación real del proceso (antes no tenía a nadie, ahora
      // sí) y el cliente no pidió explícitamente otro estado: el backend fija
      // "Asignado para revisión" de forma autoritativa, igual que en la
      // creación — nunca depende de que el botón que llamó a este PATCH se
      // haya acordado de mandarlo.
      if (actuales.length === 0 && nuevas.length > 0 && !estadoSolicitud) {
        estadoSolicitudOverride = 'Asignado para revisión';
      }
    }

    // Reversión de En ejecución a Observaciones: se calcula sobre el estado
    // ACTUAL en BD (última asignación) y queda log de quién y cuándo, dentro
    // del mismo historial de revisiones que ya se muestra en la ficha.
    if (revertirAObservaciones === true) {
      const actuales = Array.isArray(solicitudActual.asignaciones)
        ? (solicitudActual.asignaciones as Record<string, unknown>[])
        : [];
      if (actuales.length > 0) {
        const ahora = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const fechaStr = `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())} ${pad(ahora.getHours())}:${pad(ahora.getMinutes())}:${pad(ahora.getSeconds())}`;
        const nuevas = [...actuales];
        const last = { ...(nuevas[nuevas.length - 1] as Record<string, unknown>) };
        delete last.decisionObservaciones;
        delete last.validadoPor;
        delete last.fechaValidacion;
        delete last.evidencias;
        last.estadoRevision = 'CON_OBSERVACIONES';
        last.ultimaActualizacion = fechaStr;
        last.gestionadoPor = sessionPatch!.usuario || '';
        const revs = Array.isArray(last.revisionesObs) ? (last.revisionesObs as Record<string, unknown>[]) : [];
        last.revisionesObs = [...revs, {
          fecha: fechaStr,
          usuario: sessionPatch!.usuario || '',
          nota: 'Reversión: proceso devuelto de En ejecución a Observaciones',
        }];
        nuevas[nuevas.length - 1] = last;
        asignaciones = nuevas;
        asignacionesYaReconciliadas = true;
        estadoSolicitudOverride = 'En observación';
      }
    }

    let accesoViaGestionar = false;

    if (!canAccessSolicitud(sessionPatch!, solicitudActual)) {
      // Path 1: Director/Coordinador Comercial pueden reasignar responsables
      const puedeReasignar = puedeConBD(sessionPatch!.rol, 'asignaciones', 'asignar')
        || (await hasPermiso(sessionPatch!, 'asig_asignar_responsable'));
      const soloGestionResponsable =
        entidad == null && objeto == null && modalidad == null && perfil == null &&
        ciudad == null && plataforma == null && fechaCierre == null &&
        origenSolicitud == null &&
        nitContacto == null && personaContacto == null && telefonoContacto == null &&
        direccionContacto == null && correoContacto == null &&
        linkDetalle == null && urlProceso == null &&
        procStep == null && procData == null && revisor == null && aprobador == null &&
        obsData == null && docData == null && observacion == null &&
        resultadoFinal == null && causalCierre == null && sqrCerrada == null &&
        sqrError == null && fechaCierreSqr == null;

      if (puedeReasignar && soloGestionResponsable) {
        // Acceso permitido - solo pueden tocar asignaciones, estadoSolicitud, fechaEntregaInfo
      } else {
        // Path 2: Fallback asig_gestionar + solo-asignaciones + solo-revisionesObs
        const estadoSolicitudNoModifica =
          estadoSolicitud == null ||
          estadoSolicitud === solicitudActual.estadoSolicitud;
        const soloAsignaciones =
          asignaciones != null &&
          estadoSolicitudNoModifica &&
          entidad == null && objeto == null && modalidad == null && perfil == null &&
          ciudad == null && plataforma == null && fechaCierre == null &&
          origenSolicitud == null &&
          nitContacto == null && personaContacto == null && telefonoContacto == null &&
          direccionContacto == null && correoContacto == null &&
          linkDetalle == null && urlProceso == null &&
          procStep == null && procData == null && revisor == null && aprobador == null &&
          obsData == null && docData == null && observacion == null &&
          resultadoFinal == null && causalCierre == null && sqrCerrada == null &&
          sqrError == null && fechaCierreSqr == null && fechaEntregaInfo == null;

        if (!soloAsignaciones || !(await hasPermiso(sessionPatch!, 'asig_gestionar'))) {
          console.error('[PATCH /api/solicitudes] 403', { userId: sessionPatch!.id, email: sessionPatch!.email.slice(0, 60), rol: sessionPatch!.rol, recursoId: id, motivo: 'sin_relacion_solicitud' });
          void auditFromRequest(req, sessionPatch!, { accion: 'access_denied', recurso: 'solicitud', recursoId: String(id), detalle: { endpoint: 'PATCH /api/solicitudes', motivo: 'sin_relacion_solicitud', rol: sessionPatch!.rol } });
          return NextResponse.json({ ok: false, error: 'No tienes permiso para esta accion.', code: 'ACCESS_DENIED_OBSERVACION_REVISION' }, { status: 403 });
        }

        const asigsBd    = Array.isArray(solicitudActual.asignaciones) ? (solicitudActual.asignaciones as unknown[]) : [];
        const asigsPatch = Array.isArray(asignaciones) ? (asignaciones as unknown[]) : [];
        if (!soloRevisionesObsModificadas(asigsBd, asigsPatch)) {
          console.error('[PATCH /api/solicitudes] 403 asig_gestionar manipulation', { userId: sessionPatch!.id, email: sessionPatch!.email.slice(0, 60), recursoId: id });
          void auditFromRequest(req, sessionPatch!, { accion: 'access_denied', recurso: 'solicitud', recursoId: String(id), detalle: { endpoint: 'PATCH /api/solicitudes', motivo: 'manipulacion_asignaciones', rol: sessionPatch!.rol } });
          return NextResponse.json({ ok: false, error: 'No tienes permiso para esta accion.', code: 'ACCESS_DENIED_OBSERVACION_REVISION' }, { status: 403 });
        }

        accesoViaGestionar = true;
      }
    }

    // FASE 2B-1 — cierre PARCIAL del PATCH libre, con detección centralizada
    // (`detectarCambioDeFlujoNoAutorizado`, no solo comparar 3 strings):
    // cubre `estadoSolicitud` directo en cualquier formato (canónico,
    // legado, alias, mayúsculas/minúsculas) Y cualquier intento de colar el
    // mismo cambio dentro de `asignaciones[].estadoRevision` (incluido
    // mandar el arreglo completo con una sola fila modificada). Los valores
    // bloqueados son solo los que YA NO tienen ningún llamador activo fuera
    // de `POST .../transicion` (`ESTADOS_EXCLUSIVOS_TRANSICION_DEDICADA` en
    // `deteccion-cambio-flujo.ts`). Los demás valores de `estadoSolicitud`
    // (ej. "Asignado para elaboración", "En observación") SIGUEN
    // aceptándose porque `ENVIAR_A_OBSERVACION`/`PRESENTAR` todavía no están
    // migrados (Fase 2B-2, pendiente del almacenamiento global de
    // observaciones y evidencias) — bloquearlos ahora rompería esos flujos
    // activos. No dejar como compatibilidad indefinida: se amplía la lista
    // en cuanto cada llamador se migra.
    {
      const deteccion = detectarCambioDeFlujoNoAutorizado(
        { estadoSolicitud, asignaciones: asignacionesBody },
        solicitudActual.asignaciones,
      );
      if (deteccion.detectado) {
        return NextResponse.json({
          ok: false,
          error: 'Las transiciones de estado deben realizarse mediante el endpoint dedicado (POST /api/solicitudes/[id]/transicion).',
        }, { status: 400 });
      }
    }

    const data: Record<string, unknown> = { updatedAt: new Date() };

    if (entidad != null)         data.entidad         = str(entidad);
    if (objeto != null)          data.objeto          = str(objeto);
    if (modalidad != null)       data.modalidad       = str(modalidad);
    if (perfil != null)          data.perfil          = normalizarPerfil(str(perfil));
    if (ciudad != null)          data.ciudad          = str(ciudad);
    if (plataforma != null)      data.plataforma      = str(plataforma);
    if (fechaCierre != null)     data.fechaCierre     = toDate(fechaCierre);
    if (estadoSolicitud)         data.estadoSolicitud = str(estadoSolicitud);
    if (estadoSolicitudOverride) data.estadoSolicitud = estadoSolicitudOverride;

    // Este PATCH genérico NUNCA puede llevar una Solicitud a un estado
    // terminal (Cerrada/Cancelada) — el único camino autorizado es
    // `POST /api/solicitudes/[id]/cerrar` (transición condicional con CAS
    // contra doble cierre, allowlist estricta del payload, ownership de la
    // fila). Auditoría: se migraron todos los caminos activos de cierre a
    // ese endpoint; si esta transición se acepta aquí, un cliente
    // desactualizado o manipulado podría cerrar sin las protecciones de
    // concurrencia/autorización granular por fila. Se distingue 400 (dato
    // inválido para este endpoint) de 409 (ya estaba terminal, coincide con
    // el mensaje del endpoint dedicado) para que el cliente sepa cuál es la
    // causa real.
    if (typeof data.estadoSolicitud === 'string' && ESTADOS_SOLICITUD_TERMINALES.has(data.estadoSolicitud)) {
      const yaEstabaTerminal = ESTADOS_SOLICITUD_TERMINALES.has(solicitudActual.estadoSolicitud);
      return NextResponse.json(
        {
          ok: false,
          error: yaEstabaTerminal
            ? 'La solicitud ya fue cerrada por otro usuario.'
            : 'No se puede cerrar/cancelar una solicitud mediante este endpoint. Usa POST /api/solicitudes/[id]/cerrar.',
        },
        { status: yaEstabaTerminal ? 409 : 400 },
      );
    }

    if (origenSolicitud != null) data.origenSolicitud = normalizarOrigenSolicitud(origenSolicitud);

    if (nitContacto !== undefined)       data.nitContacto       = str(nitContacto) || null;
    if (personaContacto !== undefined)   data.personaContacto   = str(personaContacto) || null;
    if (telefonoContacto !== undefined)  data.telefonoContacto  = str(telefonoContacto) || null;
    if (direccionContacto !== undefined) data.direccionContacto = str(direccionContacto) || null;
    if (correoContacto !== undefined)    data.correoContacto    = str(correoContacto) || null;

    // URL manual del proceso: se guarda en linkDetalle (mismo campo que usa la
    // sincronizacion con SECOP), asi cualquier vista que lea linkDetalle la
    // muestra sin depender de un campo paralelo. "urlProceso" no es una columna
    // real de la BD (solo existe en el tipo del frontend); si el cliente lo manda
    // se acepta como alias de linkDetalle para no romper el formulario existente.
    if (linkDetalle !== undefined) data.linkDetalle = str(linkDetalle) || null;
    else if (urlProceso !== undefined) data.linkDetalle = str(urlProceso) || null;

    if (procStep != null)     data.procStep     = Number(procStep);
    if (procData != null)     data.procData     = procData;
    if (revisor != null)      data.revisor      = str(revisor);
    if (aprobador != null)    data.aprobador    = str(aprobador);

    // Reconciliación contra el arreglo COMPLETO en BD: las vistas de lista
    // (p.ej. "Por validar") consultan `asignaciones` recortado a solo el
    // último elemento y sin `evidencias` (ver SQL_ASIG_LAST). Si esa versión
    // recortada se reenvía tal cual en un PATCH, sobrescribiría el historial
    // completo de asignaciones y perdería evidencias ya guardadas. Por eso,
    // salvo que `asignaciones` ya haya sido recalculado desde la BD completa
    // arriba, se actualiza únicamente la(s) asignación(es) que vinieron en el
    // body (por idAsignacion), preservando el resto del historial y las
    // evidencias existentes cuando el payload del cliente no las trae.
    if (asignaciones != null && Array.isArray(asignaciones) && !asignacionesYaReconciliadas) {
      const asigsBdFull = Array.isArray(solicitudActual.asignaciones)
        ? (solicitudActual.asignaciones as Record<string, unknown>[])
        : [];
      const asigsClient = asignaciones as Record<string, unknown>[];
      if (asigsBdFull.length > 0) {
        const merged = asigsBdFull.map((bdItem) => {
          const match = asigsClient.find(
            (c) => c && c.idAsignacion != null && c.idAsignacion === bdItem.idAsignacion
          );
          if (!match) return bdItem;
          return {
            ...bdItem,
            ...match,
            evidencias: 'evidencias' in match ? match.evidencias : bdItem.evidencias,
          };
        });
        const idsBd = new Set(asigsBdFull.map((a) => a.idAsignacion));
        const nuevasNoExistentes = asigsClient.filter(
          (c) => c && (c.idAsignacion == null || !idsBd.has(c.idAsignacion))
        );
        asignaciones = [...merged, ...nuevasNoExistentes];
      }
    }
    if (asignaciones != null) data.asignaciones = asignaciones;

    // Blindaje centralizado: nunca se guarda "Asignado para revisión" (ni
    // etapas posteriores que asumen responsable) si al final no queda ningún
    // responsable real en asignaciones/revisor. A diferencia del guardia
    // anterior (que descartaba el cambio de estado EN SILENCIO), esto
    // RECHAZA el PATCH completo con 409 — el cliente se entera del error en
    // vez de que su cambio quede parcialmente aplicado sin explicación.
    if (typeof data.estadoSolicitud === 'string' && ESTADOS_QUE_EXIGEN_RESPONSABLE.has(data.estadoSolicitud)) {
      const asignacionesFinal = Array.isArray(data.asignaciones)
        ? data.asignaciones as unknown[]
        : (Array.isArray(solicitudActual.asignaciones) ? solicitudActual.asignaciones as unknown[] : []);
      const revisorFinal = typeof data.revisor === 'string' ? data.revisor : solicitudActual.revisor;
      if (asignacionesFinal.length === 0 && !revisorFinal) {
        console.error('[PATCH /api/solicitudes] Rechazado cambio de estado sin responsable real', { id, estadoSolicitud: data.estadoSolicitud });
        return NextResponse.json({
          ok: false,
          error: `No se puede guardar el estado "${data.estadoSolicitud}" sin al menos un responsable asignado (asignación o revisor).`,
        }, { status: 409 });
      }
    }
    if (obsData != null)      data.obsData      = obsData;
    if (docData != null)      data.docData      = docData;
    if (observacion != null)  data.observacion  = str(observacion);
    if (resultadoFinal != null)  data.resultadoFinal  = str(resultadoFinal);
    if (causalCierre != null)    data.causalCierre    = str(causalCierre);
    if (sqrCerrada != null)      data.sqrCerrada      = Boolean(sqrCerrada);
    if (sqrError != null)        data.sqrError        = str(sqrError);
    if (fechaCierreSqr != null)  data.fechaCierreSqr  = toDate(fechaCierreSqr);
    if (fechaEntregaInfo != null)data.fechaEntregaInfo = toDate(fechaEntregaInfo);

    // Actualización + auditoría en UNA sola transacción: si el AuditLog
    // falla, la actualización de estado/responsables también se revierte —
    // nunca queda un cambio a medias sin su rastro de auditoría.
    const estadoAnteriorParaAuditoria = solicitudActual.estadoSolicitud;
    const responsablesAnterioresParaAuditoria = Array.isArray(solicitudActual.asignaciones)
      ? (solicitudActual.asignaciones as Record<string, unknown>[]).map((a) => String(a.analistaAsignado ?? '')).filter(Boolean)
      : [];

    let updated;
    try {
      updated = await prisma.$transaction(async (tx) => {
        const u = await tx.solicitud.update({ where: { id: Number(id) }, data });
        const responsablesNuevosParaAuditoria = Array.isArray(u.asignaciones)
          ? (u.asignaciones as Record<string, unknown>[]).map((a) => String(a.analistaAsignado ?? '')).filter(Boolean)
          : [];
        await tx.auditLog.create({
          data: {
            usuarioId: sessionPatch!.id ?? null,
            email: sessionPatch!.email ?? null,
            rol: sessionPatch!.rol ?? null,
            accion: accesoViaGestionar ? 'revision_observacion_registrada' : 'solicitud_modify',
            recurso: 'solicitud',
            recursoId: String(u.id),
            metodo: 'PATCH',
            detalle: {
              solicitudId: u.id,
              procesoId: u.procesoId,
              estadoAnterior: estadoAnteriorParaAuditoria,
              estadoNuevo: u.estadoSolicitud,
              responsablesAnteriores: responsablesAnterioresParaAuditoria,
              responsablesNuevos: responsablesNuevosParaAuditoria,
              via: accesoViaGestionar ? 'asig_gestionar' : 'patch_directo',
              // Ajuste "BOTÓN CAMBIO DE FECHA DE CIERRE" §7 — mejora MÍNIMA y
              // aditiva de trazabilidad: solo cuando este PATCH efectivamente
              // tocó `fechaCierre` (`data.fechaCierre !== undefined`, la misma
              // condición que ya decide si se escribe el campo en el
              // `update`), se registran el valor anterior (de la Solicitud
              // leída ANTES del update) y el nuevo (del registro YA
              // actualizado) — nunca se agregan estas claves en un PATCH que
              // no tocó esa fecha, para no ensuciar el detalle de auditoría
              // de todos los demás cambios (reasignación, revisión, etc.).
              ...(data.fechaCierre !== undefined ? {
                fechaCierreAnterior: solicitudActual.fechaCierre ? solicitudActual.fechaCierre.toISOString() : null,
                fechaCierreNueva: u.fechaCierre ? u.fechaCierre.toISOString() : null,
              } : {}),
            },
          },
        });
        return u;
      });
    } catch (e) {
      console.error('[PATCH /api/solicitudes] transacción fallida — sin cambios parciales', e);
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : 'Error interno al guardar los cambios.' },
        { status: 500 },
      );
    }

    // Ajuste "CIERRE DE SQR AL PRESENTAR" §19 — se retira la rama que
    // intentaba cerrar la SQR al llegar a estados finales (Cerrada/En
    // observación con resultado no favorable): era inalcanzable (el
    // propio PATCH rechaza con 400 cualquier `resultadoFinal`/`causalCierre`
    // top-level, ver el guard más arriba en este archivo) y quedó
    // reemplazada por la regla vigente — el cierre de la SQR ya se
    // coordina en `ejecutarTransicionEstado` al ejecutar `PRESENTAR`
    // (`cierre-sqr-al-presentar.ts`), nunca aquí.

    return NextResponse.json({
      ok: true,
      solicitud: serializeSolicitud(updated as unknown as Record<string, unknown>),
    });
  } catch (err) {
    console.error('[PATCH /api/solicitudes]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Error interno' },
      { status: 500 }
    );
  }
}

/* ── DELETE /api/solicitudes ──────────────────────────────────────────────── */

export async function DELETE(req: NextRequest) {
  const sessionDel = await getSession(req);
  const deniedDel = requireAdministradorProcesos(sessionDel);
  if (deniedDel) return deniedDel;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Cuerpo de la petición inválido.' }, { status: 400 });
  }

  const { ids } = body as { ids?: unknown };
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ ok: false, error: 'ids es requerido' }, { status: 400 });
  }
  const idsNumericos = ids.map(Number).filter((n) => Number.isFinite(n));
  if (idsNumericos.length === 0) {
    return NextResponse.json({ ok: false, error: 'ids no contiene valores numéricos válidos' }, { status: 400 });
  }

  const motivoValidado = validarMotivo(body.motivo);
  if (!motivoValidado.ok) {
    return NextResponse.json({ ok: false, error: motivoValidado.error }, { status: 400 });
  }
  const motivo = motivoValidado.valor;

  // Actor SIEMPRE de la sesión del servidor — nunca del body (antes se
  // aceptaba `deletedByUsuario`/`deletedByEmail` del cliente, sin validar
  // contra quién realmente ejecutó la petición).
  const actorUsuario = sessionDel!.usuario ?? '';
  const actorEmail = sessionDel!.email ?? '';

  try {
    const resultado = await prisma.$transaction(async (tx) => {
      // Lock de las filas objetivo — evita que otra operación concurrente
      // (edición, otra eliminación) las modifique entre la lectura y el borrado.
      if (idsNumericos.length > 0) {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "Solicitud" WHERE id IN (${Prisma.join(idsNumericos)}) FOR UPDATE`);
      }

      const registros = await tx.solicitud.findMany({ where: { id: { in: idsNumericos } } });
      if (registros.length !== idsNumericos.length) {
        return { tipo: 'no_encontrado' as const };
      }

      await tx.deletedSolicitud.createMany({
        data: (registros as any[]).map((s) => ({
          originalId:        s.id,
          procesoId:         s.procesoId,
          procesoSourceKey:  s.procesoSourceKey,
          externalId:        s.externalId,
          codigoProceso:     s.codigoProceso,
          nombreProceso:     s.nombreProceso,
          entidad:           s.entidad,
          objeto:            s.objeto,
          fuente:            s.fuente,
          aliasFuente:       s.aliasFuente,
          modalidad:         s.modalidad,
          perfil:            s.perfil,
          departamento:      s.departamento,
          estadoFuente:      s.estadoFuente,
          fechaPublicacion:  s.fechaPublicacion,
          fechaVencimiento:  s.fechaVencimiento,
          valor:             s.valor,
          linkDetalle:       s.linkDetalle,
          linkSecop:         s.linkSecop,
          linkSecopReg:      s.linkSecopReg,
          estadoSolicitud:   s.estadoSolicitud,
          observacion:       s.observacion,
          ciudad:            s.ciudad,
          sede:              s.sede,
          plataforma:        s.plataforma,
          fechaCierre:       s.fechaCierre,
          origenSolicitud:   s.origenSolicitud ?? 'Comercial',
          nitContacto:       s.nitContacto,
          personaContacto:   s.personaContacto,
          telefonoContacto:  s.telefonoContacto,
          direccionContacto: s.direccionContacto,
          correoContacto:    s.correoContacto,
          duracion:          s.duracion,
          procStep:          s.procStep,
          procData:          s.procData,
          obsData:           s.obsData,
          docData:           s.docData,
          asignaciones:      s.asignaciones,
          revisor:           s.revisor,
          aprobador:         s.aprobador,
          usuarioRegistro:   s.usuarioRegistro,
          emailRegistro:     s.emailRegistro,
          cargoRegistro:     s.cargoRegistro,
          entidadRegistro:   s.entidadRegistro,
          sqrNumero:         s.sqrNumero,
          sqrCreada:         s.sqrCreada,
          sqrCerrada:        s.sqrCerrada,
          sqrError:          s.sqrError,
          fechaAperturaSqr:  s.fechaAperturaSqr,
          fechaCierreSqr:    s.fechaCierreSqr,
          resultadoFinal:    s.resultadoFinal,
          causalCierre:      s.causalCierre,
          fechaEntregaInfo:  s.fechaEntregaInfo,
          createdAt:         s.createdAt,
          updatedAt:         s.updatedAt,
          deletedByUsuario:  actorUsuario,
          deletedByEmail:    actorEmail,
        })),
      });

      await tx.auditLog.create({
        data: {
          usuarioId: sessionDel!.id,
          email: actorEmail,
          rol: sessionDel!.rol,
          accion: 'solicitud_eliminar_lote',
          recurso: 'solicitud',
          recursoId: idsNumericos.join(','),
          metodo: 'DELETE',
          detalle: {
            ids: idsNumericos,
            totalLote: idsNumericos.length,
            estrategia: 'TODO_O_NADA',
            motivo,
            deletedByUsuario: actorUsuario,
            deletedByEmail: actorEmail,
          },
        },
      });

      await tx.solicitud.deleteMany({ where: { id: { in: idsNumericos } } });

      return { tipo: 'ok' as const, deleted: registros.length };
    });

    if (resultado.tipo === 'no_encontrado') {
      return NextResponse.json({ ok: false, error: 'No se encontraron todos los registros solicitados' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, deleted: resultado.deleted });
  } catch (err) {
    console.error('[DELETE /api/solicitudes]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Error interno' },
      { status: 500 }
    );
  }
}