import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireAdminOrN8N } from '@/lib/authz';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

type DocEntrada = { nombre: string; url: string; extension?: string };

const adendaRe = /^adend[ao]\b/i;

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireAdminOrN8N(req, session);
  if (denied) return denied;
  try {
    const body = await req.json();
    const { codigoProceso, documentos: docsEntrada, forzar, procesoId } = body as {
      codigoProceso?: string;
      documentos?: DocEntrada[];
      forzar?: boolean;
      procesoId?: number;
    };

    if (!codigoProceso) {
      return NextResponse.json({ ok: false, error: 'codigoProceso requerido' }, { status: 400 });
    }
    if (!Array.isArray(docsEntrada) || docsEntrada.length === 0) {
      return NextResponse.json({ ok: false, error: 'documentos requerido (array no vacío)' }, { status: 400 });
    }

    // codigoProceso NO es único en SECOP — si no viene procesoId y hay más de una entidad
    // con el mismo código, se aborta en vez de actualizar los documentos de una arbitraria.
    let proceso: { id: number; codigoProceso: string | null; entidad: string | null; perfil: string | null } | null;
    if (procesoId) {
      proceso = await prisma.proceso.findUnique({
        where: { id: Number(procesoId) },
        select: { id: true, codigoProceso: true, entidad: true, perfil: true },
      });
    } else {
      const candidatos = await prisma.proceso.findMany({ where: { codigoProceso }, select: { id: true, entidad: true } });
      if (candidatos.length > 1) {
        return NextResponse.json({
          ok: false,
          error: `codigoProceso "${codigoProceso}" es ambiguo: pertenece a ${candidatos.length} entidades distintas. Se requiere procesoId.`,
          candidatos: candidatos.map(c => ({ id: c.id, entidad: c.entidad })),
        }, { status: 409 });
      }
      proceso = candidatos.length === 1
        ? await prisma.proceso.findUnique({ where: { id: candidatos[0].id }, select: { id: true, codigoProceso: true, entidad: true, perfil: true } })
        : null;
    }

    if (!proceso) {
      return NextResponse.json({ ok: false, error: `Proceso ${codigoProceso} no encontrado` }, { status: 404 });
    }

    // Cargar adendas existentes antes de borrar (para detectar cambios)
    const adendasAntes = await prisma.procesoDocumentoSecop.findMany({
      where: { procesoId: proceso.id, tipoDocumento: 'adenda' },
      select: { nombre: true },
    });
    const nombresAntes = new Set(adendasAntes.map(a => a.nombre.trim().toLowerCase()));

    await prisma.procesoDocumentoSecop.deleteMany({ where: { procesoId: proceso.id } });

    await prisma.procesoDocumentoSecop.createMany({
      data: docsEntrada.map((d) => {
        const nombre = d.nombre.trim();
        const esAdenda = adendaRe.test(nombre);
        const ext = d.extension?.toLowerCase().trim() || null;
        return {
          procesoId: proceso.id,
          nombre,
          urlDocumento: d.url.trim() || null,
          extension: ext,
          tipoDocumento: esAdenda ? 'adenda' : ext,
          descargado: false,
          procesado: false,
        };
      }),
    });

    const totalNoAdendas = docsEntrada.filter((d) => !adendaRe.test(d.nombre.trim())).length;

    await prisma.proceso.update({
      where: { id: proceso.id },
      data: { totalDocumentos: totalNoAdendas, lastSyncedAt: new Date() },
    });

    // Detectar adendas nuevas (no estaban antes); forzar=true notifica aunque ya existieran
    const todasLasAdendas = docsEntrada.filter(d => adendaRe.test(d.nombre.trim()));
    const adendasNuevas = forzar
      ? todasLasAdendas
      : todasLasAdendas.filter(d => !nombresAntes.has(d.nombre.trim().toLowerCase()));

    if (adendasNuevas.length > 0) {
      // Reemplazar notificación anterior de adendas del mismo proceso
      await prisma.notificacion.deleteMany({
        where: { tipo: 'documento_nuevo', procesoId: proceso.id },
      });
      await prisma.notificacion.create({
        data: {
          tipo: 'documento_nuevo',
          titulo: adendasNuevas.length > 1
            ? `${adendasNuevas.length} adendas nuevas: ${proceso.entidad ?? '—'}`
            : `Adenda nueva: ${proceso.entidad ?? '—'}`,
          descripcion: adendasNuevas.length > 1
            ? `Se publicaron ${adendasNuevas.length} adendas en el proceso ${codigoProceso}`
            : `Se publicó "${adendasNuevas[0].nombre}" en el proceso ${codigoProceso}`,
          codigoProceso,
          procesoId: proceso.id,
          entidad: proceso.entidad ?? null,
          perfil: proceso.perfil ?? null,
          datos: {
            totalAdendas: adendasNuevas.length,
            primerAdenda: adendasNuevas[0].nombre,
            adendas: adendasNuevas.map(a => a.nombre),
          },
        },
      });
    }

    return NextResponse.json({
      ok: true,
      codigoProceso,
      documentosGuardados: docsEntrada.length,
      adendasNuevas: adendasNuevas.length,
    });
  } catch (error) {
    console.error('[POST /api/procesos/actualizar-documentos]', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Error interno' },
      { status: 500 }
    );
  }
}
