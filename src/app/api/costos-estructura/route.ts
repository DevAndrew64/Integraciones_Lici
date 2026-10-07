import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { requireSession, requireEditarCostos } from '@/lib/authz';
import { esEstructuraModular, CLAVES_MODULO } from '@/lib/costos-estructura/guardado-modular';
import type { ClaveModulo } from '@/lib/costos-estructura/guardado-modular';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  try {
    const registros = await prisma.costoEstructura.findMany({
      orderBy: { creadoEn: 'desc' },
      select: {
        id: true, procesoCodigo: true, procesoNombre: true, cargo: true,
        nTrabajadores: true, costoMO: true, costoEpp: true, costoExamenes: true,
        costoMaquinaria: true, costoAdmin: true, costoTotal: true, creadoEn: true,
      },
    });
    return NextResponse.json({ ok: true, registros });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

// Ajuste "PERMISOS DE COSTOS — EQUIPO COMERCIAL" — reemplaza el gate
// anterior (`hasPermiso(session,'ver_estructura_costos')`, permiso de BD
// reutilizado de la navegación standalone) por `requireEditarCostos`:
// crear estructuras de costos exige Administrador o Equipo Comercial
// (`esEquipoComercial`, fuente única `@/lib/roles`) — Mercadeo y cualquier
// otro rol quedan en 403, sin depender de responsable asignado ni de
// solicitudId (Costos no tiene vínculo con Solicitud).
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;
  const deniedEditar = requireEditarCostos(session);
  if (deniedEditar) return deniedEditar;

  try {
    const body = await req.json();
    // Guardado modular (§5) — si `datos` ya viene en la forma v2
    // {version,modulos}, se estampan servidor: `ultimaActualizacion`
    // (ahora) y `actualizadoPor` (usuario autenticado), igual que hace PUT
    // en [id]/route.ts — el cliente nunca decide esos dos valores.
    let datos = body.datos ?? {};
    if (esEstructuraModular(datos)) {
      const actualizadoPor = session!.usuario ?? session!.email;
      const ahora = new Date().toISOString();
      const modulos = { ...datos.modulos };
      for (const clave of CLAVES_MODULO) {
        const m = modulos[clave as ClaveModulo];
        if (m) modulos[clave as ClaveModulo] = { ...m, ultimaActualizacion: ahora, actualizadoPor };
      }
      datos = { ...datos, modulos };
    }
    const registro = await prisma.costoEstructura.create({
      data: {
        procesoCodigo: body.procesoCodigo ?? null,
        procesoNombre: body.procesoNombre ?? null,
        cargo:         body.cargo ?? null,
        nTrabajadores: Number(body.nTrabajadores) || 1,
        costoMO:       Number(body.costoMO)        || 0,
        costoEpp:      Number(body.costoEpp)       || 0,
        costoExamenes: Number(body.costoExamenes)  || 0,
        costoMaquinaria: Number(body.costoMaquinaria) || 0,
        costoAdmin:    Number(body.costoAdmin)     || 0,
        costoTotal:    Number(body.costoTotal)     || 0,
        datos,
      },
    });
    return NextResponse.json({ ok: true, registro });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}