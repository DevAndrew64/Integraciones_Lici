import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireAdministradorProcesos } from '@/lib/authz';
import crypto from 'crypto';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireAdministradorProcesos(session);
  if (denied) return denied;
  try {
    const body = await req.json();

    const codigoProceso = String(body.codigoProceso ?? '').trim();
    if (!codigoProceso) {
      return NextResponse.json({ ok: false, error: 'codigoProceso requerido' }, { status: 400 });
    }

    const sourceKey = `manual:${codigoProceso}`;

    const data = {
      sourceKey,
      externalId: body.externalId ? String(body.externalId) : null,
      codigoProceso,
      nombre: String(body.nombre ?? '').trim() || null,
      entidad: String(body.entidad ?? '').trim() || null,
      objeto: String(body.objeto ?? '').trim() || null,
      fuente: String(body.fuente ?? '').trim() || null,
      aliasFuente: String(body.aliasFuente ?? '').trim().toUpperCase() || null,
      modalidad: String(body.modalidad ?? '').trim() || null,
      perfil: String(body.perfil ?? '').trim() || null,
      departamento: String(body.departamento ?? '').trim() || null,
      estadoFuente: String(body.estadoFuente ?? '').trim() || null,
      fechaPublicacion: body.fechaPublicacion ? new Date(String(body.fechaPublicacion).replace(' ', 'T')) : null,
      fechaVencimiento: body.fechaVencimiento ? new Date(String(body.fechaVencimiento).replace(' ', 'T')) : null,
      valor: body.valor != null ? Number(body.valor) : null,
      linkDetalle: String(body.linkDetalle ?? '').trim() || null,
      linkSecop: null,
      linkSecopReg: null,
      rawJson: JSON.stringify(body),
      hashContenido: crypto.createHash('md5').update(codigoProceso + Date.now()).digest('hex'),
      totalDocumentos: 0,
      totalCronogramas: 0,
      lastSyncedAt: new Date(),
    };

    const proceso = await prisma.proceso.upsert({
      where: { sourceKey },
      update: data,
      create: data,
    });

    // Insertar cronogramas
    const cronogramas: { nombre: string; fecha: string }[] = Array.isArray(body.cronogramas) ? body.cronogramas : [];

    if (cronogramas.length > 0) {
      await prisma.procesoCronogramaSecop.deleteMany({ where: { procesoId: proceso.id } });
      await prisma.procesoCronogramaSecop.createMany({
        data: cronogramas.map((cr, i) => ({
          procesoId: proceso.id,
          evento: String(cr.nombre ?? '').trim() || `Etapa ${i + 1}`,
          valorTexto: String(cr.fecha ?? '').trim() || null,
          orden: i,
        })),
      });
      await prisma.proceso.update({
        where: { id: proceso.id },
        data: { totalCronogramas: cronogramas.length },
      });
    }

    // Insertar documentos
    const documentos: { nombre: string; url: string }[] = Array.isArray(body.documentos) ? body.documentos : [];

    if (documentos.length > 0) {
      await prisma.procesoDocumentoSecop.deleteMany({ where: { procesoId: proceso.id } });
      await prisma.procesoDocumentoSecop.createMany({
        data: documentos.map((doc) => ({
          procesoId: proceso.id,
          nombre: String(doc.nombre ?? '').trim() || 'Sin nombre',
          urlDocumento: String(doc.url ?? '').trim() || null,
          tipoDocumento: 'base',
          fechaDetectado: new Date(),
        })),
      });
      await prisma.proceso.update({
        where: { id: proceso.id },
        data: { totalDocumentos: documentos.length },
      });
    }

    return NextResponse.json({
      ok: true,
      id: proceso.id,
      codigoProceso,
      cronogramasInsertados: cronogramas.length,
      documentosInsertados: documentos.length,
    });
  } catch (error) {
    console.error('[POST /api/procesos/insertar]', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Error' },
      { status: 500 }
    );
  }
}