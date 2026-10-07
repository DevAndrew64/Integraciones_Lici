import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireAdminOrN8N } from '@/lib/authz';
import { sincronizarCatalogoEquipos } from '@/lib/equipos-activos-sync';
import prisma from '@/lib/prisma';

/**
 * Ajuste "RÉPLICA LOCAL PERSISTENTE DEL CATÁLOGO DE EQUIPOS" — dispara una
 * sincronización completa (grupo_activo → subtipo_activo → equipos/obtener,
 * mismos límites de concurrencia/reintentos ya aprobados) y la persiste en
 * la réplica (`EquipoActivoCatalogoSync`/`EquipoActivoCatalogo`), publicando
 * la nueva versión solo si es aceptable (nunca sustituye una réplica activa
 * buena por una peor — ver `equipos-activos-sync.ts`).
 *
 * Mismo patrón de protección ya usado en `/api/procesos/sync`
 * (`requireAdminOrN8N`): acepta automatizaciones externas (N8N, header
 * `Authorization: Bearer <N8N_SYNC_TOKEN>` — así se programa la
 * actualización periódica cada 10 días, ver README/reporte) o un usuario
 * humano con sesión de administrador (sincronización manual).
 *
 * El recorrido real tarda varios minutos (concurrencia baja intencional,
 * nunca se sube por esto) — la petición HTTP NUNCA espera a que termine
 * (evita timeouts de proxy/N8N): dispara la sincronización en segundo
 * plano dentro del mismo proceso Node y responde de inmediato con el id
 * de la sincronización en curso. Usa GET para consultar su estado/avance.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireAdminOrN8N(req, session);
  if (denied) return denied;

  try {
    const body = await req.json().catch(() => ({}));
    const empresa = String(body.empresa ?? '').trim();
    if (!empresa) return NextResponse.json({ ok: false, error: 'Se requiere empresa' }, { status: 400 });

    const disparadaPor = session ? `manual:${session.usuario}` : 'cron';
    // Fire-and-forget deliberado — ver docblock. Los errores quedan
    // registrados en `EquipoActivoCatalogoSync.estado='FALLIDO'` (nunca se
    // pierden en silencio), consultables vía GET.
    sincronizarCatalogoEquipos(empresa, disparadaPor).catch(() => {});

    return NextResponse.json({
      ok: true,
      mensaje: 'Sincronización iniciada en segundo plano. Consulta el estado con GET.',
      empresa,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Error al iniciar la sincronización.' },
      { status: 500 }
    );
  }
}

/** Estado de la última sincronización (activa y/o más reciente) por empresa — para verificar avance/resultado sin adivinar. */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireAdminOrN8N(req, session);
  if (denied) return denied;

  const empresa = String(req.nextUrl.searchParams.get('empresa') ?? '').trim().toLowerCase();
  if (!empresa) return NextResponse.json({ ok: false, error: 'Se requiere empresa' }, { status: 400 });

  const [activa, masReciente] = await Promise.all([
    prisma.equipoActivoCatalogoSync.findFirst({ where: { empresa, activa: true } }),
    prisma.equipoActivoCatalogoSync.findFirst({ where: { empresa }, orderBy: { iniciadaEn: 'desc' } }),
  ]);

  return NextResponse.json({ ok: true, activa, masReciente });
}
