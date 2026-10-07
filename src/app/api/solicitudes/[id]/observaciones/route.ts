/**
 * POST /api/solicitudes/[id]/observaciones — agregar UNA observación a UNA
 * fila concreta de `asignaciones[]`.
 *
 * Corrige el defecto de origen (frontend elegía `asignaciones[length-1]`
 * como "el" responsable): aquí el servidor SIEMPRE relee la Solicitud
 * fresca desde PostgreSQL, identifica la fila autorizada mediante la
 * sesión real (nunca confía en el arreglo completo que mande el
 * navegador), modifica exclusivamente esa fila, y persiste el arreglo
 * reconstruido por el propio backend — nunca sustituye el arreglo con lo
 * que llegó del cliente.
 *
 * Concurrencia: se toma un lock de fila (`SELECT ... FOR UPDATE`) dentro de
 * una transacción antes de leer `asignaciones`, así dos responsables
 * agregando observaciones casi al mismo tiempo se serializan — ninguna de
 * las dos observaciones se pierde.
 */
import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { getSession } from '@/lib/session';
import { requireSession } from '@/lib/authz';
import prisma from '@/lib/prisma';
import {
  resolverUsuarioSesionActivo, puedeAgregarObservacion,
} from '@/lib/solicitudes/autorizacion-asignacion';

function ahoraLegible(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Límites nuevos, introducidos en esta ronda de auditoría — la interfaz
// actual (page.tsx) no impone ninguno (el <textarea> no tiene maxLength).
// Se documentan aquí explícitamente porque no existían antes:
//  - MAX_LONGITUD_DETALLE: generoso para una observación de gestión
//    comercial en texto libre, sin ser ilimitado (evita payloads abusivos).
//  - MAX_LONGITUD_CAUSA_ESPECIFICA: mismo orden de magnitud que el límite
//    ya usado en la app para truncar valores largos en AuditLog
//    (`src/lib/audit.ts`, 500 caracteres) — se reutiliza ese precedente.
const MAX_LONGITUD_DETALLE = 4000;
const MAX_LONGITUD_CAUSA_ESPECIFICA = 500;
const MAX_LONGITUD_TIPO_CAUSA = 100;
const MAX_INDICADORES = 30;
const MAX_LONGITUD_CAMPO_INDICADOR = 500;

interface IndicadorValidado { subcausa: string; valorRequerido: string; valorEvidenciado: string; cumple: string; obs: string; }

/** Estructura exacta que el frontend produce (ver `IndicadorAsignacion` en page.tsx) — todos los campos son string. */
function validarIndicador(raw: unknown): IndicadorValidado | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const campos = ['subcausa', 'valorRequerido', 'valorEvidenciado', 'cumple', 'obs'] as const;
  const out: Partial<IndicadorValidado> = {};
  for (const campo of campos) {
    const v = r[campo];
    if (typeof v !== 'string') return null; // tipo inesperado — se rechaza el objeto completo
    if (v.length > MAX_LONGITUD_CAMPO_INDICADOR) return null;
    out[campo] = v;
  }
  if (!out.subcausa || !out.subcausa.trim()) return null; // subcausa es la identidad del indicador — no puede ser solo espacios
  return out as IndicadorValidado;
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const noAuth = requireSession(session);
  if (noAuth) return noAuth;

  const { id } = await context.params;
  const dbId = Number(id);
  if (!Number.isFinite(dbId) || dbId <= 0) {
    return NextResponse.json({ ok: false, error: 'ID inválido.' }, { status: 400 });
  }

  let bodyRaw: unknown;
  try {
    bodyRaw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Cuerpo de la petición inválido.' }, { status: 400 });
  }
  if (bodyRaw == null || typeof bodyRaw !== 'object' || Array.isArray(bodyRaw)) {
    return NextResponse.json({ ok: false, error: 'Cuerpo de la petición inválido: se esperaba un objeto.' }, { status: 400 });
  }
  const body = bodyRaw as Record<string, unknown>;

  // idAsignacion — requerido, tipo estricto (no se acepta número/objeto
  // silenciosamente convertido a string, para no enmascarar errores del cliente).
  if (typeof body.idAsignacion !== 'string' || !body.idAsignacion.trim()) {
    return NextResponse.json({ ok: false, error: 'idAsignacion es requerido y debe ser texto.' }, { status: 400 });
  }
  const idAsignacion = body.idAsignacion.trim();

  // tipoCausa — requerido, tipo estricto, con límite de longitud.
  if (typeof body.tipoCausa !== 'string' || !body.tipoCausa.trim()) {
    return NextResponse.json({ ok: false, error: 'tipoCausa es requerido y debe ser texto.' }, { status: 400 });
  }
  const tipoCausa = body.tipoCausa.trim();
  if (tipoCausa.length > MAX_LONGITUD_TIPO_CAUSA) {
    return NextResponse.json({ ok: false, error: `tipoCausa excede el máximo de ${MAX_LONGITUD_TIPO_CAUSA} caracteres.` }, { status: 400 });
  }
  const esIndicador = tipoCausa === 'Indicador';

  // causaEspecifica — tipo estricto si viene; requerido cuando el tipo NO es
  // "Indicador" (misma regla que ya valida el frontend antes de habilitar
  // el botón de guardar — aquí se re-verifica en servidor).
  if (body.causaEspecifica !== undefined && typeof body.causaEspecifica !== 'string') {
    return NextResponse.json({ ok: false, error: 'causaEspecifica debe ser texto.' }, { status: 400 });
  }
  const causaEspecifica = typeof body.causaEspecifica === 'string' ? body.causaEspecifica.trim() : '';
  if (causaEspecifica.length > MAX_LONGITUD_CAUSA_ESPECIFICA) {
    return NextResponse.json({ ok: false, error: `causaEspecifica excede el máximo de ${MAX_LONGITUD_CAUSA_ESPECIFICA} caracteres.` }, { status: 400 });
  }
  if (!esIndicador && !causaEspecifica) {
    return NextResponse.json({ ok: false, error: 'causaEspecifica es requerido cuando tipoCausa no es "Indicador".' }, { status: 400 });
  }

  // indicadores — solo aplica/se exige cuando tipoCausa==='Indicador'; cada
  // elemento debe tener la forma exacta que produce el frontend (todos los
  // campos string) — un elemento con estructura ajena se rechaza completo.
  if (body.indicadores !== undefined && !Array.isArray(body.indicadores)) {
    return NextResponse.json({ ok: false, error: 'indicadores debe ser un arreglo.' }, { status: 400 });
  }
  const indicadoresRaw = Array.isArray(body.indicadores) ? body.indicadores : [];
  if (indicadoresRaw.length > MAX_INDICADORES) {
    return NextResponse.json({ ok: false, error: `Se permiten máximo ${MAX_INDICADORES} indicadores.` }, { status: 400 });
  }
  const indicadores: IndicadorValidado[] = [];
  for (const raw of indicadoresRaw) {
    const validado = validarIndicador(raw);
    if (!validado) {
      return NextResponse.json({ ok: false, error: 'Uno o más indicadores tienen estructura o tipo inválido.' }, { status: 400 });
    }
    indicadores.push(validado);
  }
  if (esIndicador && indicadores.length === 0) {
    return NextResponse.json({ ok: false, error: 'Se requiere al menos un indicador cuando tipoCausa es "Indicador".' }, { status: 400 });
  }

  // detalle — texto libre; obligatorio en el caso general (rechaza vacío y
  // contenido compuesto únicamente por espacios tras trim()). Excepción: si
  // tipoCausa==='Indicador' y ya se aportaron indicadores, la tabla de
  // indicadores es el contenido sustantivo y el detalle libre puede quedar
  // vacío — igual que ya lo permite el frontend histórico (nunca exigió
  // `detalleObs` no vacío para observaciones de tipo Indicador).
  if (body.detalle !== undefined && typeof body.detalle !== 'string') {
    return NextResponse.json({ ok: false, error: 'detalle debe ser texto.' }, { status: 400 });
  }
  const detalle = typeof body.detalle === 'string' ? body.detalle.trim() : '';
  if (detalle.length > MAX_LONGITUD_DETALLE) {
    return NextResponse.json({ ok: false, error: `detalle excede el máximo de ${MAX_LONGITUD_DETALLE} caracteres.` }, { status: 400 });
  }
  const detalleEximidoPorIndicadores = esIndicador && indicadores.length > 0;
  if (!detalle && !detalleEximidoPorIndicadores) {
    return NextResponse.json({ ok: false, error: 'detalle es requerido y no puede estar vacío ni contener solo espacios.' }, { status: 400 });
  }

  const usuario = await resolverUsuarioSesionActivo(prisma, session!);
  if (!usuario) {
    return NextResponse.json({ ok: false, error: 'Usuario no encontrado o inactivo.' }, { status: 403 });
  }

  try {
    const resultado = await prisma.$transaction(async (tx) => {
      // Lock de fila — serializa observaciones concurrentes sobre la misma
      // Solicitud (aunque sean de responsables/filas distintas), para que
      // el read-modify-write de `asignaciones` nunca pierda una escritura.
      await tx.$queryRaw`SELECT id FROM "Solicitud" WHERE id = ${dbId} FOR UPDATE`;

      const solicitud = await tx.solicitud.findUnique({ where: { id: dbId } });
      if (!solicitud) {
        return { tipo: 'no_encontrada' as const };
      }

      const auth = puedeAgregarObservacion(usuario, solicitud, idAsignacion);
      if (!auth.autorizado || !auth.asignacion) {
        return { tipo: 'no_autorizado' as const, motivo: auth.motivo ?? 'No autorizado.' };
      }

      const asignaciones = Array.isArray(solicitud.asignaciones)
        ? [...(solicitud.asignaciones as Record<string, unknown>[])]
        : [];
      const idx = asignaciones.findIndex((a) => String(a.idAsignacion ?? '') === idAsignacion);
      if (idx < 0) {
        return { tipo: 'no_encontrada' as const };
      }

      const fila = { ...asignaciones[idx] };
      const obsActuales = Array.isArray(fila.observaciones) ? (fila.observaciones as Record<string, unknown>[]) : [];

      // El autor NUNCA se toma del body — siempre de la sesión ya resuelta
      // y verificada contra la BD (nunca confiar en lo que mande el navegador).
      const nuevaObs = {
        autor: usuario.usuario,
        autorId: usuario.id,
        usuario: usuario.usuario, // compatibilidad con el render existente ("Por: {o.usuario}")
        fecha: ahoraLegible(),
        idAsignacion,
        solicitudId: dbId,
        tipoCausa,
        causaEspecifica,
        detalle,
        indicadores,
        decision: '',
      };

      fila.observaciones = [...obsActuales, nuevaObs];
      fila.estadoRevision = 'CON_OBSERVACIONES';
      fila.ultimaActualizacion = ahoraLegible();
      fila.gestionadoPor = usuario.usuario;
      asignaciones[idx] = fila;

      const actualizada = await tx.solicitud.update({
        where: { id: dbId },
        data: { asignaciones: asignaciones as unknown as Prisma.InputJsonValue, estadoSolicitud: 'En observación', updatedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          usuarioId: usuario.id,
          email: usuario.email,
          rol: usuario.rol,
          accion: 'solicitud_observacion_agregada',
          recurso: 'solicitud',
          recursoId: String(dbId),
          metodo: 'POST',
          detalle: {
            solicitudId: dbId,
            idAsignacion,
            autor: usuario.usuario,
            tipoCausa,
          },
        },
      });

      return { tipo: 'ok' as const, solicitud: actualizada };
    });

    if (resultado.tipo === 'no_encontrada') {
      return NextResponse.json({ ok: false, error: 'Solicitud o asignación no encontrada.' }, { status: 404 });
    }
    if (resultado.tipo === 'no_autorizado') {
      return NextResponse.json({ ok: false, error: resultado.motivo }, { status: 403 });
    }
    return NextResponse.json({ ok: true, solicitud: resultado.solicitud });
  } catch (err) {
    console.error('[POST /api/solicitudes/[id]/observaciones]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Error interno.' },
      { status: 500 },
    );
  }
}