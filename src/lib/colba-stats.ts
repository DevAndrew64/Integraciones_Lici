import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { whereExcluirManual } from '@/lib/data-api/origenCanonico';

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface ColbaStats {
  porValidarPublico: number;
  porValidarPrivado: number;
  enObservacion: number;
  enEjecucion: number;
  enEvaluacion: number;
  cerradosTotal: number;
  sinAsignacion: number;
  totalActivos: number;
  procesosNuevosHoy: number;
  procesosNoViables: number;
  manifestacionesHoy: number;
  manifestacionesSemana: number;
  manifestacionesMes: number;
  solicitudesCreadasHoy: number;
  fecha: string;
}

// ── Constantes ────────────────────────────────────────────────────────────────

const BLOQUEADOS = [
  'LISTO_PARA_VALIDAR','CON_OBSERVACIONES','APROBADO_ELABORACION',
  'SIN_OBSERVACIONES','EN_ELABORACION','PRESENTADO','RECHAZADO',
  'CERRADO_ADJUDICADO','CERRADO_NO_ADJUDICADO','CERRADO_NO_CUMPLIMIENTO',
];
const BLOQUEADOS_SQL = BLOQUEADOS.map(e => `'${e}'`).join(',');

const ESTADO_REVISION_LABEL: Record<string, string> = {
  LISTO_PARA_VALIDAR:     'Listo para validar',
  CON_OBSERVACIONES:      'Con observaciones',
  APROBADO_ELABORACION:   'Aprobado para elaboración',
  SIN_OBSERVACIONES:      'Sin observaciones',
  EN_ELABORACION:         'En elaboración',
  PRESENTADO:             'Presentado',
  RECHAZADO:              'Rechazado',
  CERRADO_ADJUDICADO:     'Cerrado - Adjudicado',
  CERRADO_NO_ADJUDICADO:  'Cerrado - No adjudicado',
  CERRADO_NO_CUMPLIMIENTO:'Cerrado - No cumplimiento',
};

type CountRow = { count: bigint };

// ── Helpers ───────────────────────────────────────────────────────────────────

function s(v: unknown): string { return typeof v === 'string' ? v : ''; }

function fmtFecha(v: unknown): string {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(String(v));
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function safeArr(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v as Record<string, unknown>[];
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

// ── Estadísticas generales ────────────────────────────────────────────────────

export async function obtenerEstadisticas(): Promise<ColbaStats> {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const finSemana = new Date(hoy.getTime() + 7 * 86400000);

  const q = prisma.$queryRawUnsafe.bind(prisma);
  const n = (rows: CountRow[]) => Number(rows[0]?.count ?? 0);

  const [
    pvPub, pvPriv, enObs, enEjec, enEval, cerr, sinAsig,
    nuevosHoy, noViables, solicHoy,
  ] = await Promise.all([
    q<CountRow[]>(`SELECT COUNT(*) AS count FROM "Solicitud" WHERE jsonb_array_length(asignaciones) > 0 AND (asignaciones -> -1 ->> 'estadoRevision' NOT IN (${BLOQUEADOS_SQL}) OR asignaciones -> -1 ->> 'estadoRevision' IS NULL OR asignaciones -> -1 ->> 'estadoRevision' = '') AND "aliasFuente" IN ('S1','S2') AND LOWER("estadoSolicitud") NOT IN ('cerrada','cerrado')`),
    q<CountRow[]>(`SELECT COUNT(*) AS count FROM "Solicitud" WHERE jsonb_array_length(asignaciones) > 0 AND (asignaciones -> -1 ->> 'estadoRevision' NOT IN (${BLOQUEADOS_SQL}) OR asignaciones -> -1 ->> 'estadoRevision' IS NULL OR asignaciones -> -1 ->> 'estadoRevision' = '') AND "aliasFuente" NOT IN ('S1','S2') AND LOWER("estadoSolicitud") NOT IN ('cerrada','cerrado')`),
    q<CountRow[]>(`SELECT COUNT(*) AS count FROM "Solicitud" WHERE asignaciones -> -1 ->> 'estadoRevision' = 'CON_OBSERVACIONES' AND LOWER("estadoSolicitud") NOT IN ('cerrada','cerrado')`),
    q<CountRow[]>(`SELECT COUNT(*) AS count FROM "Solicitud" WHERE asignaciones -> -1 ->> 'estadoRevision' NOT IN ('EN_ELABORACION','PRESENTADO') AND (LOWER("estadoSolicitud") LIKE '%asignado para elaboraci%' OR LOWER("estadoSolicitud") LIKE '%presentado%' OR LOWER("estadoSolicitud") LIKE '%listo para presentar%') AND LOWER("estadoSolicitud") NOT IN ('cerrada','cerrado')`),
    q<CountRow[]>(`SELECT COUNT(*) AS count FROM "Solicitud" WHERE (asignaciones -> -1 ->> 'estadoRevision' IN ('EN_ELABORACION','PRESENTADO') OR LOWER("estadoSolicitud") LIKE '%en elaboraci%' OR LOWER("estadoSolicitud") LIKE '%en evaluaci%') AND LOWER("estadoSolicitud") NOT IN ('cerrada','cerrado')`),
    q<CountRow[]>(`SELECT COUNT(*) AS count FROM "Solicitud" WHERE LOWER("estadoSolicitud") IN ('cerrada','cerrado') OR asignaciones -> -1 ->> 'estadoRevision' IN ('CERRADO_NO_CUMPLIMIENTO','CERRADO_ADJUDICADO','CERRADO_NO_ADJUDICADO','RECHAZADO')`),
    q<CountRow[]>(`SELECT COUNT(*) AS count FROM "Solicitud" WHERE jsonb_array_length(asignaciones) = 0 AND LOWER("estadoSolicitud") NOT IN ('cerrada','cerrado')`),
    // B.4.5 — "procesos detectados hoy" desde `Proceso` (createdAt ≡ fechaDeteccion), sin altas manuales.
    // C2.2-d: exclusión por origenFuncional='MANUAL' (primaria) + prefijo
    // local:/manual: (compatibilidad) — ver `whereExcluirManual()`.
    prisma.proceso.count({ where: { createdAt: { gte: hoy }, ...whereExcluirManual() } }).catch(() => 0),
    prisma.proceso.count({ where: { noViable: true } }).catch(() => 0),
    prisma.solicitud.count({ where: { createdAt: { gte: hoy } } }).catch(() => 0),
  ]);

  // Manifestaciones: contar cronogramas con "interes" (proxy para fecha es complejo ya que valorTexto es texto)
  const [mHoy, mSemana, mMes] = await Promise.all([
    obtenerConteoManifestaciones(hoy, new Date(hoy.getTime() + 86400000)),
    obtenerConteoManifestaciones(hoy, finSemana),
    obtenerConteoManifestaciones(inicioMes, new Date(inicioMes.getFullYear(), inicioMes.getMonth() + 1, 1)),
  ]);

  const pVPub = n(pvPub), pVPriv = n(pvPriv), obs = n(enObs), ejec = n(enEjec), eval_ = n(enEval);

  return {
    porValidarPublico: pVPub,
    porValidarPrivado: pVPriv,
    enObservacion: obs,
    enEjecucion: ejec,
    enEvaluacion: eval_,
    cerradosTotal: n(cerr),
    sinAsignacion: n(sinAsig),
    totalActivos: pVPub + pVPriv + obs + ejec + eval_,
    procesosNuevosHoy: typeof nuevosHoy === 'number' ? nuevosHoy : 0,
    procesosNoViables: typeof noViables === 'number' ? noViables : 0,
    solicitudesCreadasHoy: typeof solicHoy === 'number' ? solicHoy : 0,
    manifestacionesHoy: mHoy,
    manifestacionesSemana: mSemana,
    manifestacionesMes: mMes,
    fecha: new Date().toLocaleDateString('es-CO', { weekday:'long', year:'numeric', month:'long', day:'numeric' }),
  };
}

// Contar manifestaciones de interés próximas en un rango de fechas
async function obtenerConteoManifestaciones(desde: Date, hasta: Date): Promise<number> {
  try {
    const cronogramas = await prisma.procesoCronogramaSecop.findMany({
      where: { evento: { contains: 'interes', mode: 'insensitive' } },
      select: { valorTexto: true },
    });
    let count = 0;
    for (const c of cronogramas) {
      const fecha = parseFechaTexto(c.valorTexto);
      if (fecha && fecha >= desde && fecha < hasta) count++;
    }
    return count;
  } catch { return 0; }
}

function parseFechaTexto(texto: string | null | undefined): Date | null {
  if (!texto) return null;
  const t = String(texto).trim();
  const matchDMY = t.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s*[-–]\s*|\s+)(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (matchDMY) {
    const [, d, m, y, hh, mm, ampm] = matchDMY;
    let hora = parseInt(hh, 10);
    if (ampm) { if (ampm.toUpperCase() === 'PM' && hora < 12) hora += 12; if (ampm.toUpperCase() === 'AM' && hora === 12) hora = 0; }
    const fecha = new Date(Date.UTC(parseInt(y), parseInt(m) - 1, parseInt(d), hora, parseInt(mm)));
    if (!isNaN(fecha.getTime())) return fecha;
  }
  const matchSolo = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (matchSolo) { const [, d, m, y] = matchSolo; const f = new Date(Date.UTC(parseInt(y), parseInt(m) - 1, parseInt(d))); if (!isNaN(f.getTime())) return f; }
  const iso = new Date(t.replace(' ', 'T'));
  return isNaN(iso.getTime()) ? null : iso;
}

export function formatearEstadisticas(stats: ColbaStats): string {
  return `DATOS EN TIEMPO REAL DEL APLICATIVO (actualizado ahora, ${stats.fecha}):
PIPELINE DE LICITACIONES:
- Por validar públicos (SECOP I/II): ${stats.porValidarPublico} proceso(s)
- Por validar privados: ${stats.porValidarPrivado} proceso(s)
- En observación: ${stats.enObservacion} proceso(s)
- En ejecución (elaborando propuesta): ${stats.enEjecucion} proceso(s)
- En evaluación: ${stats.enEvaluacion} proceso(s)
- Cerrados/Terminados: ${stats.cerradosTotal} proceso(s)
- Sin asignación todavía: ${stats.sinAsignacion} proceso(s)
- Total activos en pipeline: ${stats.totalActivos}
ACTIVIDAD DEL DÍA:
- Procesos nuevos detectados hoy: ${stats.procesosNuevosHoy}
- Solicitudes/registros creados hoy: ${stats.solicitudesCreadasHoy}
OTROS:
- Procesos marcados no viables: ${stats.procesosNoViables}
MANIFESTACIONES DE INTERÉS (SECOP II):
- Con fecha para hoy: ${stats.manifestacionesHoy}
- Con fecha esta semana: ${stats.manifestacionesSemana}
- Con fecha este mes: ${stats.manifestacionesMes}`;
}

// ── Detección: ¿la pregunta requiere detalle de procesos? ────────────────────

const KEYWORDS_DETALLE = [
  'proceso','procesos','cuáles','cuales','lista','listar','dame','mostrar',
  'quién','quien','tiene asignado','asignado','responsable','analista',
  'observaci','tiene obs','con obs','observaciones',
  'cierre','vencimiento','fecha','plazo',
  'secop','url','link','enlace',
  'estado','validar','elaboraci','presentado','ejecuci','evaluaci',
  'cerrado','cerrada','adjudicado','no adjudicado',
  'sqr','número sqr','ticket',
  'entidad','empresa','perfil','departamento','ciudad',
  'valor','cuantía','presupuesto',
];

const KEYWORDS_DOCS = [
  'documento','documentos','maestro','certificado','certificación','certificacion',
  'vigencia','vence','vencimiento','vencido','vigente','expira','expiracion',
  'licencia','permiso','poliza','póliza','renovar','renovacion','renovación',
  'hse','ruc','iso','oshas','ohsas','sgsst','sgc','archivo',
];

const KEYWORDS_MANIFEST = [
  'manifestaci','manifestacion','expresion de interes','expresión de interés',
  'interes','interés','manifestar','presenta manifestaci',
];

const KEYWORDS_NO_VIABLES = [
  'no viable','no viables','noviable','descartado','descartados',
  'causa no viable','porque no viable','no fue viable',
];

export function requiereDetalleProcesos(pregunta: string): boolean {
  const q = pregunta.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return KEYWORDS_DETALLE.some(kw => q.includes(kw));
}

export function requiereDetalleDocumentos(pregunta: string): boolean {
  const q = pregunta.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return KEYWORDS_DOCS.some(kw => q.includes(kw));
}

export function requiereDetalleManifestaciones(pregunta: string): boolean {
  const q = pregunta.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return KEYWORDS_MANIFEST.some(kw => q.includes(kw));
}

export function requiereDetalleNoViables(pregunta: string): boolean {
  const q = pregunta.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return KEYWORDS_NO_VIABLES.some(kw => q.includes(kw));
}

// ── Maestro de documentos ─────────────────────────────────────────────────────

export async function buscarDocumentosMaestro(pregunta: string): Promise<string> {
  try {
    const q = pregunta.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const buscarVencidos = q.includes('vencid') || q.includes('expir');
    const buscarVigentes = q.includes('vigent') || q.includes('activo');
    const buscarPorVencer = q.includes('por vencer') || q.includes('proxim') || q.includes('próxim');

    const hoy = new Date();
    const en30 = new Date(hoy); en30.setDate(hoy.getDate() + 30);
    const en60 = new Date(hoy); en60.setDate(hoy.getDate() + 60);

    const docs = await prisma.documento.findMany({
      include: {
        versiones: {
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
      orderBy: { nombre: 'asc' },
    });

    if (!docs.length) return 'No hay documentos registrados en el Maestro de Documentos.';

    const hoyMs = hoy.getTime();

    const lineas = docs.map(doc => {
      const version = doc.versiones[0];
      const fVenc = version?.fechaVencimiento;
      const diasRestantes = fVenc ? Math.ceil((fVenc.getTime() - hoyMs) / 86400000) : null;
      const estadoVig = !fVenc ? 'Sin fecha de vencimiento'
        : diasRestantes! < 0 ? `VENCIDO hace ${Math.abs(diasRestantes!)} día(s)`
        : diasRestantes! === 0 ? 'VENCE HOY'
        : diasRestantes! <= 30 ? `Vence pronto (en ${diasRestantes} días)`
        : `Vigente (vence en ${diasRestantes} días)`;

      // Filtros por estado
      if (buscarVencidos && fVenc && fVenc >= hoy) return null;
      if (buscarVigentes && fVenc && fVenc < hoy) return null;
      if (buscarPorVencer && fVenc && (fVenc < hoy || fVenc > en60)) return null;

      const partes: string[] = [
        `Documento: ${doc.nombre}`,
        doc.codigo ? `Código: ${doc.codigo}` : '',
        doc.empresa ? `Empresa: ${doc.empresa}` : '',
        doc.proceso ? `Proceso: ${doc.proceso}` : '',
        doc.fechaEmision ? `Fecha emisión: ${fmtFecha(doc.fechaEmision)}` : '',
        fVenc ? `Fecha vencimiento: ${fmtFecha(fVenc)} — ${estadoVig}` : `Estado: ${estadoVig}`,
        doc.frecuenciaDias ? `Frecuencia renovación: cada ${doc.frecuenciaDias} días` : '',
        doc.diasTramite ? `Días tramite: ${doc.diasTramite}` : '',
        version ? `Versión actual: v${version.version}, subido por ${version.subidoPor ?? 'desconocido'} el ${fmtFecha(version.createdAt)}` : 'Sin versión cargada',
        doc.notas ? `Notas: ${doc.notas}` : '',
      ];
      return partes.filter(Boolean).join('\n');
    }).filter(Boolean);

    const hoy30 = docs.filter(d => {
      const fv = d.versiones[0]?.fechaVencimiento;
      return fv && fv >= hoy && fv <= en30;
    }).length;
    const vencidos = docs.filter(d => {
      const fv = d.versiones[0]?.fechaVencimiento;
      return fv && fv < hoy;
    }).length;

    const resumen = `MAESTRO DE DOCUMENTOS (${docs.length} documento(s) total | ${vencidos} vencido(s) | ${hoy30} vence en los próximos 30 días):`;
    return `${resumen}\n\n${lineas.join('\n\n---\n\n')}`;
  } catch (err) {
    return `Error consultando documentos: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ── Manifestaciones de interés detalladas ────────────────────────────────────

export async function buscarManifestaciones(pregunta: string): Promise<string> {
  try {
    const q = pregunta.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const finSemana = new Date(hoy.getTime() + 7 * 86400000);
    const finMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1);

    const buscarHoy = q.includes('hoy') || q.includes('dia') || q.includes('día');
    const buscarSemana = q.includes('semana');
    const buscarMes = q.includes('mes');

    const cronogramas = await prisma.procesoCronogramaSecop.findMany({
      where: { evento: { contains: 'interes', mode: 'insensitive' } },
      include: {
        proceso: { select: { codigoProceso: true, entidad: true, perfil: true, estadoFuente: true, linkSecop: true, linkDetalle: true } },
      },
      orderBy: { id: 'asc' },
    });

    const items = cronogramas.map(c => {
      const fecha = parseFechaTexto(c.valorTexto);
      return { ...c, fechaObj: fecha };
    });

    let filtrados = items.filter(i => i.fechaObj !== null);
    if (buscarHoy) {
      filtrados = filtrados.filter(i => i.fechaObj! >= hoy && i.fechaObj! < new Date(hoy.getTime() + 86400000));
    } else if (buscarSemana) {
      filtrados = filtrados.filter(i => i.fechaObj! >= hoy && i.fechaObj! < finSemana);
    } else if (buscarMes) {
      filtrados = filtrados.filter(i => i.fechaObj! >= hoy && i.fechaObj! < finMes);
    } else {
      // Por defecto: próximas 30 días
      filtrados = filtrados.filter(i => i.fechaObj! >= hoy && i.fechaObj! < new Date(hoy.getTime() + 30 * 86400000));
    }

    filtrados.sort((a, b) => a.fechaObj!.getTime() - b.fechaObj!.getTime());

    if (!filtrados.length) return 'No hay manifestaciones de interés próximas para el período consultado.';

    const lineas = filtrados.slice(0, 30).map(c => {
      const diasRest = Math.ceil((c.fechaObj!.getTime() - Date.now()) / 86400000);
      const urgencia = diasRest <= 0 ? 'HOY/VENCIDA' : diasRest === 1 ? 'MAÑANA' : `en ${diasRest} día(s)`;
      return [
        `Proceso: ${c.proceso.codigoProceso ?? '—'}`,
        `Entidad: ${c.proceso.entidad ?? '—'}`,
        `Perfil empresa: ${c.proceso.perfil ?? '—'}`,
        `Etapa: ${c.evento}`,
        `Fecha: ${fmtFecha(c.fechaObj)} (${urgencia})`,
        c.proceso.estadoFuente ? `Estado SECOP: ${c.proceso.estadoFuente}` : '',
        c.proceso.linkSecop ? `URL SECOP: ${c.proceso.linkSecop}` : '',
      ].filter(Boolean).join('\n');
    });

    return `MANIFESTACIONES DE INTERÉS PRÓXIMAS (${filtrados.length} resultado(s)):\n\n${lineas.join('\n\n---\n\n')}`;
  } catch (err) {
    return `Error consultando manifestaciones: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ── Procesos no viables detallados ────────────────────────────────────────────

export async function buscarProcesosNoViables(pregunta: string): Promise<string> {
  try {
    const q = pregunta.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const buscarRecientes = q.includes('hoy') || q.includes('reciente') || q.includes('ultimo') || q.includes('último');

    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);

    const procesos = await prisma.proceso.findMany({
      where: {
        noViable: true,
        ...(buscarRecientes ? { noViableFecha: { gte: hoy } } : {}),
      },
      select: {
        codigoProceso: true, entidad: true, perfil: true, objeto: true,
        observacionNoViable: true, noViableRegistradoPor: true, noViableFecha: true,
        linkSecop: true, linkDetalle: true, estadoFuente: true, modalidad: true,
        fechaVencimiento: true, valor: true,
      },
      orderBy: { noViableFecha: 'desc' },
      take: 50,
    });

    if (!procesos.length) return 'No se encontraron procesos marcados como no viables.';

    const lineas = procesos.map(p => [
      `Código: ${p.codigoProceso ?? '—'}`,
      p.objeto ? `Objeto: ${p.objeto.slice(0, 150)}${p.objeto.length > 150 ? '…' : ''}` : '',
      p.entidad ? `Entidad: ${p.entidad}` : '',
      p.perfil ? `Empresa: ${p.perfil}` : '',
      p.modalidad ? `Modalidad: ${p.modalidad}` : '',
      p.observacionNoViable ? `Causa no viable: ${p.observacionNoViable}` : 'Causa: no registrada',
      p.noViableRegistradoPor ? `Registrado por: ${p.noViableRegistradoPor}` : '',
      p.noViableFecha ? `Fecha marcado: ${fmtFecha(p.noViableFecha)}` : '',
      p.fechaVencimiento ? `Fecha cierre proceso: ${fmtFecha(p.fechaVencimiento)}` : '',
      p.valor ? `Valor: ${new Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', minimumFractionDigits:0 }).format(p.valor)}` : '',
      p.estadoFuente ? `Estado SECOP: ${p.estadoFuente}` : '',
      p.linkSecop ? `URL SECOP: ${p.linkSecop}` : '',
    ].filter(Boolean).join('\n'));

    return `PROCESOS NO VIABLES (${procesos.length} resultado(s)):\n\n${lineas.join('\n\n---\n\n')}`;
  } catch (err) {
    return `Error consultando no viables: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ── Búsqueda de procesos detallada ────────────────────────────────────────────

interface SolicitudRow {
  id: number;
  codigoProceso: string | null;
  nombreProceso: string | null;
  objeto: string | null;
  entidad: string | null;
  perfil: string | null;
  estadoSolicitud: string;
  aliasFuente: string | null;
  departamento: string | null;
  ciudad: string | null;
  fechaCierre: Date | null;
  fechaVencimiento: Date | null;
  valor: number | null;
  linkSecop: string | null;
  linkDetalle: string | null;
  sqrNumero: string | null;
  asignaciones: unknown;
  observacion: string | null;
  modalidad: string | null;
  createdAt: Date;
}

export async function buscarProcesosDetallados(pregunta: string): Promise<string> {
  try {
    // Extraer posible código de proceso de la pregunta (letras+números con guiones, mayúsculas)
    const codigoMatch = pregunta.match(/\b([A-Z0-9]+-[A-Z0-9-]+)\b/);
    const codigoBuscar = codigoMatch?.[1] ?? null;

    const qNorm = pregunta.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const buscarObs    = qNorm.includes('observaci');
    const buscarEjec   = qNorm.includes('ejecuci');
    const buscarEval   = qNorm.includes('evaluaci');
    const buscarCerrad = qNorm.includes('cerrad') || qNorm.includes('adjudicad');
    const buscarValidar= qNorm.includes('validar') || qNorm.includes('por validar');

    const SELECT = Prisma.sql`
      SELECT id, "codigoProceso", "nombreProceso", objeto, entidad, perfil,
             "estadoSolicitud", "aliasFuente", departamento, ciudad,
             "fechaCierre", "fechaVencimiento", valor, "linkSecop", "linkDetalle",
             "sqrNumero", asignaciones, observacion, modalidad, "createdAt"
      FROM "Solicitud"
    `;
    const ORDER = Prisma.sql`ORDER BY "createdAt" DESC LIMIT 50`;

    let rows: SolicitudRow[];

    if (codigoBuscar) {
      // Único valor de usuario — parámetro seguro
      rows = await prisma.$queryRaw<SolicitudRow[]>(
        Prisma.sql`${SELECT} WHERE "codigoProceso" ILIKE ${`%${codigoBuscar}%`} ${ORDER}`
      );
    } else if (buscarObs) {
      rows = await prisma.$queryRawUnsafe<SolicitudRow[]>(`${SELECT.text} WHERE asignaciones -> -1 ->> 'estadoRevision' = 'CON_OBSERVACIONES' AND LOWER("estadoSolicitud") NOT IN ('cerrada','cerrado') ${ORDER.text}`);
    } else if (buscarEjec) {
      rows = await prisma.$queryRawUnsafe<SolicitudRow[]>(`${SELECT.text} WHERE asignaciones -> -1 ->> 'estadoRevision' NOT IN ('EN_ELABORACION','PRESENTADO') AND (LOWER("estadoSolicitud") LIKE '%asignado para elaboraci%' OR LOWER("estadoSolicitud") LIKE '%presentado%' OR LOWER("estadoSolicitud") LIKE '%listo para presentar%') AND LOWER("estadoSolicitud") NOT IN ('cerrada','cerrado') ${ORDER.text}`);
    } else if (buscarEval) {
      rows = await prisma.$queryRawUnsafe<SolicitudRow[]>(`${SELECT.text} WHERE (asignaciones -> -1 ->> 'estadoRevision' IN ('EN_ELABORACION','PRESENTADO') OR LOWER("estadoSolicitud") LIKE '%en elaboraci%' OR LOWER("estadoSolicitud") LIKE '%en evaluaci%') AND LOWER("estadoSolicitud") NOT IN ('cerrada','cerrado') ${ORDER.text}`);
    } else if (buscarCerrad) {
      rows = await prisma.$queryRawUnsafe<SolicitudRow[]>(`${SELECT.text} WHERE (LOWER("estadoSolicitud") IN ('cerrada','cerrado') OR asignaciones -> -1 ->> 'estadoRevision' IN ('CERRADO_NO_CUMPLIMIENTO','CERRADO_ADJUDICADO','CERRADO_NO_ADJUDICADO','RECHAZADO')) ${ORDER.text}`);
    } else if (buscarValidar) {
      rows = await prisma.$queryRawUnsafe<SolicitudRow[]>(`${SELECT.text} WHERE jsonb_array_length(asignaciones) > 0 AND (asignaciones -> -1 ->> 'estadoRevision' NOT IN (${BLOQUEADOS_SQL}) OR asignaciones -> -1 ->> 'estadoRevision' IS NULL OR asignaciones -> -1 ->> 'estadoRevision' = '') AND LOWER("estadoSolicitud") NOT IN ('cerrada','cerrado') ${ORDER.text}`);
    } else {
      rows = await prisma.$queryRawUnsafe<SolicitudRow[]>(`${SELECT.text} WHERE LOWER("estadoSolicitud") NOT IN ('cerrada','cerrado') ${ORDER.text}`);
    }

    if (!rows.length) return 'No se encontraron procesos con esos criterios.';

    const lineas = rows.map(sol => formatearSolicitud(sol));
    return `PROCESOS ENCONTRADOS EN LA BASE DE DATOS (${rows.length} resultados):\n\n${lineas.join('\n\n---\n\n')}`;
  } catch (err) {
    return `Error consultando procesos: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function formatearSolicitud(sol: SolicitudRow): string {
  const asigs = safeArr(sol.asignaciones);
  const ultima = asigs[asigs.length - 1] ?? {};

  const estadoRev = s(ultima.estadoRevision);
  const estadoRevLabel = estadoRev ? (ESTADO_REVISION_LABEL[estadoRev] ?? estadoRev) : '';
  const asignado = s(ultima.analistaAsignado) || s(ultima.responsable) || '';
  const responsableElab = s(ultima.responsableElaboracion) || '';
  const validadoPor = s(ultima.validadoPor) || '';

  // Observaciones
  const obsArr = safeArr(ultima.observaciones as unknown);
  let obsTexto = '';
  if (obsArr.length > 0) {
    obsTexto = obsArr.map(o => {
      const tipo = s(o.tipoCausa);
      const causa = s(o.causaEspecifica);
      const nota = s(o.nota) || s(o.texto);
      return [tipo && `Tipo: ${tipo}`, causa && `Causa: ${causa}`, nota && `Nota: ${nota}`].filter(Boolean).join(' | ');
    }).join('; ');
  } else if (s(ultima.tipoCausa)) {
    obsTexto = `Tipo: ${s(ultima.tipoCausa)}${s(ultima.causaEspecifica) ? ' | Causa: '+s(ultima.causaEspecifica) : ''}`;
  }
  if (!obsTexto && sol.observacion) obsTexto = sol.observacion;

  // Revisiones de observaciones
  const revisiones = safeArr(ultima.revisionesObs as unknown);
  const revTexto = revisiones.map(r => {
    const f = fmtFecha(r.fecha);
    const n = s(r.nota);
    return [f, n].filter(Boolean).join(': ');
  }).join(' | ');

  // Fuente / Portal
  const fuente = (sol.aliasFuente ?? '').toUpperCase();
  const portal = fuente === 'S2' ? 'SECOP II' : fuente === 'S1' ? 'SECOP I' : 'Privado/Otro';

  // Valor
  const valorFmt = sol.valor ? new Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', minimumFractionDigits:0 }).format(sol.valor) : '';

  const partes: string[] = [
    `Código: ${sol.codigoProceso || '(sin código)'}`,
    sol.nombreProceso && sol.nombreProceso !== sol.objeto ? `Nombre: ${sol.nombreProceso}` : '',
    sol.objeto ? `Objeto: ${sol.objeto.slice(0, 200)}${sol.objeto.length > 200 ? '…' : ''}` : '',
    sol.entidad ? `Entidad: ${sol.entidad}` : '',
    sol.perfil ? `Empresa asignada: ${sol.perfil}` : '',
    sol.modalidad ? `Modalidad: ${sol.modalidad}` : '',
    `Portal: ${portal}`,
    `Estado: ${sol.estadoSolicitud}${estadoRevLabel ? ' / '+estadoRevLabel : ''}`,
    asignado ? `Responsable revisión: ${asignado}` : '',
    responsableElab ? `Responsable elaboración: ${responsableElab}` : '',
    validadoPor ? `Validado por: ${validadoPor}` : '',
    sol.fechaCierre ? `Fecha cierre: ${fmtFecha(sol.fechaCierre)}` : '',
    sol.fechaVencimiento && !sol.fechaCierre ? `Fecha vencimiento: ${fmtFecha(sol.fechaVencimiento)}` : '',
    valorFmt ? `Valor: ${valorFmt}` : '',
    sol.departamento || sol.ciudad ? `Ubicación: ${[sol.ciudad, sol.departamento].filter(Boolean).join(', ')}` : '',
    sol.sqrNumero ? `SQR: ${sol.sqrNumero}` : '',
    sol.linkSecop ? `URL SECOP: ${sol.linkSecop}` : '',
    sol.linkDetalle ? `URL detalle: ${sol.linkDetalle}` : '',
    obsTexto ? `Observaciones: ${obsTexto}` : '',
    revTexto ? `Revisiones observaciones: ${revTexto}` : '',
    `Registrado: ${fmtFecha(sol.createdAt)}`,
  ];

  return partes.filter(Boolean).join('\n');
}