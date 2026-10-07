import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireSession, requireAdmin, requireEditarCostos } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { fusionarModulo, obtenerModulo, CLAVES_MODULO, CLAVES_MODULO_NO_APLICA, esEstadoModuloResultadoValido, moduloTieneDatosValidos } from '@/lib/costos-estructura/guardado-modular';
import type { ClaveModulo, EstadoModuloResultado } from '@/lib/costos-estructura/guardado-modular';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const registro = await prisma.costoEstructura.findUnique({ where: { id: Number(id) } });
    if (!registro) return NextResponse.json({ ok: false, error: 'No encontrado' }, { status: 404 });
    return NextResponse.json({ ok: true, registro });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

/**
 * Actualización parcial y segura de UN módulo (§4/§5/§12, guardado
 * modular por etapas).
 *
 * Ajuste "PERMISOS DE COSTOS — EQUIPO COMERCIAL" — guardar/editar un módulo
 * exige Administrador o Equipo Comercial (`requireEditarCostos`, fuente
 * única `@/lib/roles`), ya no basta el permiso de BD 'ver_estructura_costos'
 * (reutilizado de la navegación standalone) — mismo criterio que POST
 * (`route.ts`). Mercadeo recibe 403 aunque manipule el frontend. DELETE
 * sigue exigiendo admin — eliminar por completo una estructura de costos es
 * más destructivo que crear/guardar, y no formó parte de este ajuste.
 *
 * Body esperado: { modulo: ClaveModulo, estado, datos, versionConocida? }
 *
 * Concurrencia (§7, cierre correctivo): si el cliente envía
 * `versionConocida` y difiere de `modulos[modulo].ultimaActualizacion` ya
 * guardada en el servidor, se devuelve 409 sin sobrescribir — el cliente
 * debe recargar. Si el cliente no envía el campo (compatibilidad con el
 * primer guardado de un módulo recién creado), no hay nada que comparar y
 * se guarda. `ultimaActualizacion` SIEMPRE la genera el servidor
 * (`new Date().toISOString()`, abajo) — nunca una fecha del navegador.
 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // 401 — sin sesión válida.
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;
  // 403 — con sesión pero sin permiso de edición de Costos (Admin/Comercial).
  const deniedEditar = requireEditarCostos(session);
  if (deniedEditar) return deniedEditar;

  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const modulo = body.modulo as ClaveModulo;
    if (!CLAVES_MODULO.includes(modulo)) {
      return NextResponse.json({ ok: false, error: 'Módulo inválido' }, { status: 400 });
    }

    // 404 — el registro no existe (o ya fue eliminado).
    const registro = await prisma.costoEstructura.findUnique({ where: { id: Number(id) } });
    if (!registro) return NextResponse.json({ ok: false, error: 'No encontrado' }, { status: 404 });

    // 409 — conflicto de concurrencia (§7): otro usuario guardó una
    // versión más reciente de este módulo desde que el cliente la leyó.
    const moduloExistente = obtenerModulo(registro.datos, modulo);
    if (
      body.versionConocida &&
      moduloExistente?.ultimaActualizacion &&
      body.versionConocida !== moduloExistente.ultimaActualizacion
    ) {
      return NextResponse.json(
        { ok: false, error: 'CONFLICTO_CONCURRENCIA', mensaje: 'Mano de Obra fue actualizada por otro usuario. Recarga la información antes de guardar tus cambios.' },
        { status: 409 },
      );
    }

    // Ajuste "NO_APLICA EN 4 MÓDULOS" (confirmado explícitamente) — el
    // backend YA NO confía en un simple cast de TypeScript
    // (`body.estado as EstadoModulo`, sin ninguna comprobación real en
    // runtime); valida contra la MISMA fuente de verdad que usa
    // `guardado-modular.ts` (`esEstadoModuloResultadoValido`, apoyada en
    // `ESTADOS_MODULO_RESULTADO`) — nunca una segunda lista de estados
    // hardcodeada aquí. Ausente (`undefined`/`null`) conserva el default
    // histórico `'EN_PROGRESO'`; cualquier OTRO valor no reconocido se
    // rechaza con 400, nunca se persiste.
    let estadoValidado: EstadoModuloResultado;
    if (body.estado === undefined || body.estado === null) {
      estadoValidado = 'EN_PROGRESO';
    } else if (esEstadoModuloResultadoValido(body.estado)) {
      estadoValidado = body.estado;
    } else {
      return NextResponse.json({ ok: false, error: `Estado inválido: ${String(body.estado)}` }, { status: 400 });
    }

    // Ajuste "IMPEDIR COMPLETADO FALSO" (confirmado explícitamente) —
    // COMPLETADO exige información mínima real (misma regla pura que usa
    // el frontend, `moduloTieneDatosValidos`, nunca reimplementada aparte
    // aquí); NO_APLICA sigue permitiéndose sin datos (decisión explícita
    // del usuario, nunca inferida). Solo aplica a los 4 módulos con
    // NO_APLICA — Mano de Obra/Turnantes/Costos Administrativos nunca
    // pasan por esta validación (fuera de alcance de esta regla).
    if (
      estadoValidado === 'COMPLETADO' &&
      (CLAVES_MODULO_NO_APLICA as readonly string[]).includes(modulo) &&
      !moduloTieneDatosValidos(modulo as (typeof CLAVES_MODULO_NO_APLICA)[number], body.datos)
    ) {
      return NextResponse.json(
        { ok: false, error: 'No es posible marcar el módulo como completado porque no contiene información válida.' },
        { status: 400 },
      );
    }

    const actualizadoPor = session!.usuario ?? session!.email;
    const nuevoModulo = {
      estado: estadoValidado,
      datos: body.datos ?? {},
      ultimaActualizacion: new Date().toISOString(),
      actualizadoPor,
    };
    const datosActualizados = fusionarModulo(registro.datos, modulo, nuevoModulo);

    const data: Record<string, unknown> = { datos: datosActualizados };
    if (body.totales && typeof body.totales === 'object') {
      const t = body.totales as Record<string, unknown>;
      if (t.costoMO !== undefined) data.costoMO = Number(t.costoMO) || 0;
      if (t.costoEpp !== undefined) data.costoEpp = Number(t.costoEpp) || 0;
      if (t.costoExamenes !== undefined) data.costoExamenes = Number(t.costoExamenes) || 0;
      if (t.costoMaquinaria !== undefined) data.costoMaquinaria = Number(t.costoMaquinaria) || 0;
      if (t.costoAdmin !== undefined) data.costoAdmin = Number(t.costoAdmin) || 0;
      if (t.costoTotal !== undefined) data.costoTotal = Number(t.costoTotal) || 0;
    }

    const actualizado = await prisma.costoEstructura.update({ where: { id: Number(id) }, data });
    return NextResponse.json({ ok: true, registro: actualizado, modulo: nuevoModulo });
  } catch (e) {
    // §6 — no exponer detalles internos (stack, mensajes de Prisma, etc.)
    // en la respuesta al cliente; se registran solo en el servidor.
    console.error('[PUT /api/costos-estructura/[id]]', e);
    return NextResponse.json({ ok: false, error: 'No fue posible guardar el módulo.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const denied = requireAdmin(session);
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    await prisma.costoEstructura.delete({ where: { id: Number(id) } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
