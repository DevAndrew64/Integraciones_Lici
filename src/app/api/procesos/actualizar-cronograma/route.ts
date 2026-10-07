import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireAdminOrN8N } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { parseFechaCronograma, detectarFechaPresentacionOfertas } from '@/lib/procesos/fechas-cronograma';

export const dynamic = 'force-dynamic';

type Entrada = { nombre: string; fecha: string };

function normKey(s: string) {
  return s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
}

function parsearTexto(texto: string): Entrada[] {
  const lineas = texto.split('\n').map(l => l.trim()).filter(Boolean);
  const resultado: Entrada[] = [];
  let nombrePendiente = '';

  for (const linea of lineas) {
    const esFecha = /^\d{1,2}[\/\-][\wáéíóúü]+[\/\-]\d{4}/i.test(linea);
    if (esFecha) {
      if (nombrePendiente) {
        resultado.push({ nombre: nombrePendiente.replace(/:$/, '').trim(), fecha: linea });
        nombrePendiente = '';
      }
    } else {
      nombrePendiente = linea;
    }
  }

  return resultado;
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireAdminOrN8N(req, session);
  if (denied) return denied;
  try {
    const body = await req.json();
    const { codigoProceso, texto, entradas: entradasDirectas, procesoId } = body as {
      codigoProceso?: string;
      texto?: string;
      entradas?: Entrada[];
      procesoId?: number;
    };

    if (!codigoProceso) {
      return NextResponse.json({ ok: false, error: 'codigoProceso requerido' }, { status: 400 });
    }

    const entradas: Entrada[] = entradasDirectas ?? (texto ? parsearTexto(texto) : []);

    if (entradas.length === 0) {
      return NextResponse.json({ ok: false, error: 'No se encontraron entradas de cronograma' }, { status: 400 });
    }

    // codigoProceso NO es único en SECOP — si no viene procesoId y hay más de una entidad
    // con el mismo código, se aborta en vez de actualizar el cronograma de una arbitraria.
    let proceso: { id: number; codigoProceso: string | null; fechaVencimiento: Date | null; entidad: string | null; perfil: string | null } | null;
    if (procesoId) {
      proceso = await prisma.proceso.findUnique({
        where: { id: Number(procesoId) },
        select: { id: true, codigoProceso: true, fechaVencimiento: true, entidad: true, perfil: true },
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
        ? await prisma.proceso.findUnique({ where: { id: candidatos[0].id }, select: { id: true, codigoProceso: true, fechaVencimiento: true, entidad: true, perfil: true } })
        : null;
    }

    if (!proceso) {
      return NextResponse.json({ ok: false, error: `Proceso ${codigoProceso} no encontrado en BD` }, { status: 404 });
    }

    // Cargar cronograma existente para preservar historial de cambios
    const existentes = await prisma.procesoCronogramaSecop.findMany({
      where: { procesoId: proceso.id },
      select: { id: true, evento: true, valorTexto: true, valorTextoAnterior: true, tieneCambioFecha: true, fechaActualizacion: true },
    });

    // Mapa: normKey(evento) → registro existente
    const mapaExistente = new Map(existentes.map(e => [normKey(e.evento), e]));

    let fechasModificadas = 0;

    const filas = entradas.map((e, i) => {
      const key = normKey(e.nombre);
      const existente = mapaExistente.get(key);
      const fechaAnteriorTexto = existente?.valorTexto ?? null;
      const fechaAnteriorValida = fechaAnteriorTexto !== null && fechaAnteriorTexto !== '';
      const cambioFecha = existente !== undefined && fechaAnteriorValida && fechaAnteriorTexto !== e.fecha;

      if (cambioFecha) fechasModificadas++;

      const valorAnteriorFinal = cambioFecha
        ? fechaAnteriorTexto
        : (existente?.valorTextoAnterior ?? null);

      const tieneCambio = cambioFecha
        ? true
        : (existente?.tieneCambioFecha ?? false);

      return {
        procesoId: proceso.id,
        evento: e.nombre,
        valorTexto: e.fecha || null,
        valorTextoAnterior: valorAnteriorFinal,
        tieneCambioFecha: tieneCambio,
        fechaActualizacion: cambioFecha ? new Date() : (existente?.fechaActualizacion ?? null),
        orden: i,
        fechaFin: parseFechaCronograma(e.fecha),
      };
    });

    // Atomic: si createMany falla, deleteMany se revierte
    await prisma.$transaction([
      prisma.procesoCronogramaSecop.deleteMany({ where: { procesoId: proceso.id } }),
      prisma.procesoCronogramaSecop.createMany({ data: filas }),
    ]);

    // Detectar fecha de cierre desde el cronograma entrante
    const { fecha: fechaCierre, nombreEvento } = detectarFechaPresentacionOfertas(entradas);
    const fechaAnterior = proceso.fechaVencimiento;
    const hayCambioFecha =
      fechaCierre !== null &&
      (fechaAnterior === null || fechaCierre.getTime() !== fechaAnterior.getTime());

    await prisma.proceso.update({
      where: { id: proceso.id },
      data: {
        totalCronogramas: entradas.length,
        lastSyncedAt: new Date(),
        ...(fechaCierre ? { fechaVencimiento: fechaCierre } : {}),
        ...(hayCambioFecha ? {
          fechaVencimientoAnterior: fechaAnterior,
          fechaCambioFechaCierre: new Date(),
          tieneCambioFechaCierre: true,
        } : {}),
      },
    });

    if (hayCambioFecha) {
      // Reemplazar notificación anterior del mismo proceso (upsert por procesoId+tipo)
      await prisma.notificacion.deleteMany({
        where: { tipo: 'cambio_fecha_cierre', procesoId: proceso.id },
      });
      await prisma.notificacion.create({
        data: {
          tipo: 'cambio_fecha_cierre',
          titulo: 'Cronograma actualizado',
          descripcion: `El proceso ${codigoProceso} actualizó su cronograma. Nueva fecha cierre: ${fechaCierre!.toLocaleDateString('es-CO')}.`,
          codigoProceso,
          procesoId: proceso.id,
          entidad: proceso.entidad ?? null,
          perfil: proceso.perfil ?? null,
          datos: {
            fechaAnterior: fechaAnterior?.toISOString() ?? null,
            fechaNueva: fechaCierre!.toISOString(),
            nombreEvento,
            entradasCount: entradas.length,
          },
        },
      });
    }

    return NextResponse.json({
      ok: true,
      codigoProceso,
      procesoId: proceso.id,
      entradasGuardadas: entradas.length,
      fechasModificadas,
      fechaCierre: fechaCierre?.toISOString() ?? null,
      nombreEventoCierre: nombreEvento,
      cambioFecha: hayCambioFecha,
      fechaAnterior: fechaAnterior?.toISOString() ?? null,
    });

  } catch (error) {
    console.error('[POST /api/procesos/actualizar-cronograma]', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Error interno' },
      { status: 500 }
    );
  }
}
