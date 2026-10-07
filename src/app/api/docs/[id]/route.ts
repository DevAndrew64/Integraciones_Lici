import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireSession, requireAdmin, requireEditarMaestroDocs } from '@/lib/authz';
import { auditFromRequest } from '@/lib/audit';
import prisma from '@/lib/prisma';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const doc = await prisma.documento.findUnique({
      where: { id: Number(id) },
      include: { versiones: { orderBy: { version: 'desc' } } },
    });
    if (!doc) return NextResponse.json({ ok: false, error: 'No encontrado' }, { status: 404 });
    return NextResponse.json(doc);
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

// PATCH exige Administrador, con una excepción puntual explícita (ver
// requireEditarMaestroDocs en authz.ts) — no existe todavía un permiso
// funcional de edición documental en PerfilRol. Solo existe 'ver_maestro_docs'
// (vista). Para abrir a más usuarios/roles, definir 'maestro_editar_doc'.
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const sessionP = await getSession(req);
  const deniedP = requireEditarMaestroDocs(sessionP);
  if (deniedP) return deniedP;
  try {
    const { id } = await context.params;
    const docId = Number(id);
    const body = await req.json();
    const data: Record<string, unknown> = {};
    if (body.nombre !== undefined)        data.nombre = body.nombre;
    if (body.codigo !== undefined)        data.codigo = body.codigo || null;
    if (body.empresa !== undefined)       data.empresa = body.empresa || null;
    if (body.proceso !== undefined)       data.proceso = body.proceso || null;
    if (body.subcarpetaId !== undefined)  data.subcarpetaId = body.subcarpetaId || null;
    if (body.fechaEmision !== undefined)  data.fechaEmision = body.fechaEmision ? new Date(body.fechaEmision) : null;
    if (body.frecuenciaDias !== undefined) data.frecuenciaDias = body.frecuenciaDias ? Number(body.frecuenciaDias) : null;
    if (body.diasTramite !== undefined)   data.diasTramite = body.diasTramite ? Number(body.diasTramite) : null;
    if (body.notas !== undefined)         data.notas = body.notas || null;
    if (body.correoContacto !== undefined) data.correoContacto = body.correoContacto || null;
    const doc = await prisma.documento.update({
      where: { id: docId },
      data,
      include: { versiones: { orderBy: { version: 'desc' } } },
    });

    // Sincronizar fechas en la versión más reciente
    if (body.fechaVencimiento !== undefined || body.fechaEmision !== undefined) {
      const latestVersion = await prisma.documentoVersion.findFirst({
        where: { documentoId: docId },
        orderBy: { version: 'desc' },
      });
      if (latestVersion) {
        const versionData: Record<string, Date | null> = {};
        if (body.fechaVencimiento !== undefined)
          versionData.fechaVencimiento = body.fechaVencimiento ? new Date(body.fechaVencimiento) : null;
        if (body.fechaEmision !== undefined)
          versionData.fechaEmision = body.fechaEmision ? new Date(body.fechaEmision) : null;
        await prisma.documentoVersion.update({
          where: { id: latestVersion.id },
          data: versionData,
        });
      } else {
        // No hay versiones aún: crear una versión sin archivo para guardar las fechas
        await prisma.documentoVersion.create({
          data: {
            documentoId: docId,
            version: 1,
            nombreArchivo: 'sin-archivo.pdf',
            fechaVencimiento: body.fechaVencimiento ? new Date(body.fechaVencimiento) : null,
            fechaEmision: body.fechaEmision ? new Date(body.fechaEmision) : null,
          },
        });
      }
    }

    return NextResponse.json({ ok: true, doc });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const sessionD = await getSession(req);
  const deniedD = requireAdmin(sessionD);
  if (deniedD) return deniedD;
  try {
    const { id } = await context.params;
    const docId = Number(id);
    await prisma.documento.delete({ where: { id: docId } });
    void auditFromRequest(req, sessionD, { accion: 'doc_delete', recurso: 'documento', recursoId: String(docId) });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}