/**
 * /api/notificaciones/alertas-manifestacion/route.ts
 *
 * Detecta etapas de manifestación de interés próximas a vencer
 * y genera notificaciones de alerta con N días de anticipación.
 *
 * GET  → retorna cuántas alertas nuevas se generaron
 * POST → fuerza la revisión (misma lógica)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireSession } from '@/lib/authz';
import prisma from '@/lib/prisma';

const DIAS_ANTICIPACION = 5;

// Caché en memoria: no re-ejecutar si corrió hace menos de 1 hora
let ultimaEjecucion: Date | null = null;
const CACHE_MS = 60 * 60 * 1000; // 1 hora

const PALABRAS_MANIFESTACION = [
  'manifestacion de interes',
  'manifestar interes',
  'manifestacion interes',
  'expresion de interes',
  'presentacion de manifestaciones',
  'manifestaciones de interes',
  'manifestación de interés',
  'manifestar interés',
  'expresión de interés',
];

function normalizarTexto(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Intenta parsear fechas en múltiples formatos usados por el portal externo de importación:
 * - "21/04/2026 - 05:00 PM"
 * - "21/04/2026 05:00 PM"
 * - "2026-04-21T17:00:00"
 * - "21/04/2026"
 * - "2026-04-21"
 */
function parsearFechaTexto(texto: string | null | undefined): Date | null {
  if (!texto) return null;

  const t = String(texto).trim();

  // Formato: DD/MM/YYYY - HH:MM AM/PM  o  DD/MM/YYYY HH:MM AM/PM
  const matchDMY = t.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:\s*[-–]\s*|\s+)(\d{1,2}):(\d{2})\s*(AM|PM)?/i
  );
  if (matchDMY) {
    const [, d, m, y, hh, mm, ampm] = matchDMY;
    let hora = parseInt(hh, 10);
    if (ampm) {
      if (ampm.toUpperCase() === 'PM' && hora < 12) hora += 12;
      if (ampm.toUpperCase() === 'AM' && hora === 12) hora = 0;
    }
    const fecha = new Date(
      Date.UTC(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), hora, parseInt(mm, 10))
    );
    if (!isNaN(fecha.getTime())) return fecha;
  }

  // Formato: DD/MM/YYYY
  const matchSoloFecha = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (matchSoloFecha) {
    const [, d, m, y] = matchSoloFecha;
    const fecha = new Date(Date.UTC(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10)));
    if (!isNaN(fecha.getTime())) return fecha;
  }

  // Formato ISO: YYYY-MM-DDTHH:MM:SS o YYYY-MM-DD
  const iso = new Date(t.replace(' ', 'T'));
  if (!isNaN(iso.getTime())) return iso;

  return null;
}

function esManifestacionInteres(evento: string): boolean {
  const norm = normalizarTexto(evento);
  return PALABRAS_MANIFESTACION.some(p => norm.includes(normalizarTexto(p)));
}

async function generarAlertas(): Promise<{
  revisados: number;
  alertasCreadas: number;
  errores: string[];
}> {
  const ahora = new Date();
  const limite = new Date(ahora.getTime() + DIAS_ANTICIPACION * 24 * 60 * 60 * 1000);

  const resultado = { revisados: 0, alertasCreadas: 0, errores: [] as string[] };

  const cronogramas = await prisma.procesoCronogramaSecop.findMany({
    where: { evento: { contains: 'interes', mode: 'insensitive' } },
    include: {
      proceso: {
        select: { id: true, codigoProceso: true, entidad: true, perfil: true, estadoFuente: true },
      },
    },
  });

  // Batch: cargar todas las alertas existentes de una sola vez (evita N queries en loop)
  const procesoIds = [...new Set(cronogramas.map(c => c.procesoId))];
  const alertasExistentes = procesoIds.length > 0
    ? await prisma.notificacion.findMany({
        where: { tipo: 'alerta_manifestacion', procesoId: { in: procesoIds } },
        select: { procesoId: true, datos: true },
      })
    : [];
  const setExistentes = new Set(
    alertasExistentes.map(n => `${n.procesoId}::${(n.datos as Record<string, unknown>)?.etapa ?? ''}`)
  );

  for (const cron of cronogramas) {
    resultado.revisados++;

    if (!esManifestacionInteres(cron.evento)) continue;

    const fecha = parsearFechaTexto(cron.valorTexto);
    if (!fecha) continue;

    if (fecha < ahora || fecha > limite) continue;

    const estadoFuente = normalizarTexto(cron.proceso.estadoFuente);
    if (
      estadoFuente.includes('cerrad') ||
      estadoFuente.includes('cancelad') ||
      estadoFuente.includes('desierto') ||
      estadoFuente.includes('adjudic')
    ) continue;

    // Verificar con el set en memoria (sin query adicional)
    if (setExistentes.has(`${cron.procesoId}::${cron.evento}`)) continue;

    // Calcular días restantes
    const diasRestantes = Math.ceil((fecha.getTime() - ahora.getTime()) / (1000 * 60 * 60 * 24));
    const fechaFormateada = fecha.toLocaleDateString('es-CO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    try {
      await prisma.notificacion.create({
        data: {
          tipo: 'alerta_manifestacion',
          titulo: `⚠️ Manifestación de interés próxima a vencer`,
          descripcion: `El proceso ${cron.proceso.codigoProceso ?? '—'} (${cron.proceso.entidad ?? '—'}) tiene una etapa de manifestación de interés que vence ${diasRestantes === 0 ? 'hoy' : diasRestantes === 1 ? 'mañana' : `en ${diasRestantes} días`}: ${cron.evento} — ${fechaFormateada}.`,
          codigoProceso: cron.proceso.codigoProceso,
          procesoId: cron.procesoId,
          entidad: cron.proceso.entidad,
          perfil: cron.proceso.perfil,
          datos: {
            etapa: cron.evento,
            fechaEtapa: fecha.toISOString(),
            diasRestantes,
            valorTextoOriginal: cron.valorTexto,
          },
        },
      });

      resultado.alertasCreadas++;

      console.log(
        '[alertas-manifestacion] alerta creada',
        cron.proceso.codigoProceso,
        cron.evento,
        `${diasRestantes}d restantes`
      );
    } catch (err) {
      const msg = `Error creando alerta para ${cron.proceso.codigoProceso}: ${
        err instanceof Error ? err.message : String(err)
      }`;
      resultado.errores.push(msg);
      console.warn('[alertas-manifestacion]', msg);
    }
  }

  return resultado;
}

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  const ahora = new Date();
  if (ultimaEjecucion && ahora.getTime() - ultimaEjecucion.getTime() < CACHE_MS) {
    return NextResponse.json({ ok: true, skipped: true, motivo: 'cache', ejecutadoHace: Math.round((ahora.getTime() - ultimaEjecucion.getTime()) / 60000) + ' min' });
  }
  try {
    ultimaEjecucion = ahora;
    const resultado = await generarAlertas();
    return NextResponse.json({ ok: true, ...resultado });
  } catch (err) {
    ultimaEjecucion = null; // resetear para que el próximo intento sí corra
    console.error('[alertas-manifestacion GET]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Error interno' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  try {
    const resultado = await generarAlertas();
    return NextResponse.json({ ok: true, ...resultado });
  } catch (err) {
    console.error('[alertas-manifestacion POST]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Error interno' },
      { status: 500 }
    );
  }
}