/**
 * POST /api/costos/mano-obra/[id]/recalcular
 *
 * Recibe cargos/turnos editados, vuelve a ejecutar el motor determinístico
 * y actualiza la BD con los nuevos resultados.
 * El frontend NO calcula reglas laborales.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireSession } from '@/lib/authz';
import prisma from '@/lib/prisma';
import {
  procesarCargo,
  type CargoEntrada,
  type TurnoEntrada,
  type DiaSemana,
  type TipoDia,
} from '@/lib/costos-mano-obra/motor-mano-obra';
import { aplicarPoliticaDescanso } from '@/lib/costos-mano-obra/politica-descanso';

export const dynamic = 'force-dynamic';

const DIA_MAP: Record<string, DiaSemana> = {
  L:'L', M:'M', X:'X', J:'J', V:'V', S:'S', D:'D',
};

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;
  const { id: idStr } = await context.params;
  const solicitudId = parseInt(idStr, 10);
  if (isNaN(solicitudId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 });

  const body = await req.json();
  // body: { cargoId: number, cargo: CargoEditPayload, turnos: TurnoEditPayload[] }
  const { cargoId, cargo: cargoPayload, turnos: turnosPayload } = body as {
    cargoId: number;
    cargo: Record<string, unknown>;
    turnos: Array<Record<string, unknown>>;
  };

  if (!cargoId) return NextResponse.json({ error: 'cargoId requerido' }, { status: 400 });

  // Verificar que cargoId pertenezca a la solicitud (protección IDOR)
  const cargoCheck = await prisma.cargoManoObra.findFirst({
    where: { id: cargoId },
    select: { escenario: { select: { solicitudId: true } } },
  });
  if (!cargoCheck || cargoCheck.escenario.solicitudId !== solicitudId) {
    return NextResponse.json({ error: 'Cargo no pertenece a esta solicitud' }, { status: 403 });
  }

  // 1. Cargar parámetros de laborales y festivos desde BD
  const now = new Date();
  const anio = now.getFullYear();

  const params2 = await prisma.parametrosLaborales.findFirst({
    where: { anio },
    orderBy: { anio: 'desc' },
  });
  if (!params2) return NextResponse.json({ error: `No hay ParametrosLaborales para ${anio}` }, { status: 500 });

  const inicio = new Date(now.getFullYear(), 0, 1);
  const fin    = new Date(now.getFullYear(), 11, 31);
  const festivosBD = await prisma.calendarioFestivos.findMany({
    where: { fecha: { gte: inicio, lte: fin } },
    select: { fecha: true },
  });
  const festivosSet = new Set(festivosBD.map(f => f.fecha.toISOString().slice(0, 10)));

  const paramsMotor = {
    anio,
    jornadaMaxSemana:      params2.horasMaxSemanaActual,
    divisorHora:           params2.divisorHora,
    factorMensual:         params2.factorMensual,
    metodoPeriodo:         params2.metodoPeriodo as 'factor' | 'calendario' | 'dias_mes',
    horaInicioNocturna:    params2.horaInicioNocturna,
    horaFinNocturna:       params2.horaFinNocturna,
    recargoNocturno:       params2.recargoNocturno,
    recargoExtraDiurno:    params2.recargoExtraDiurno,
    recargoExtraNocturno:  params2.recargoExtraNocturno,
    recargoDominical:      params2.recargoDominical,
    recargoDominicalNoc:   params2.recargoDominicalNoc,
    recargoFestivoDiu:     params2.recargoFestivoDiu,
    recargoFestivoNoc:     params2.recargoFestivoNoc,
  };

  // 2. Aplicar política de descanso por defecto
  const politica = {
    politicaDescansoDefault:   params2.politicaDescansoDefault ?? true,
    minHorasTurnoParaDescanso: params2.minHorasTurnoParaDescanso ?? 6,
    descansoDefaultMinutos:    params2.descansoDefaultMinutos ?? 60,
    descansoComputableDefault: params2.descansoComputableDefault ?? false,
  };

  // 3. Construir CargoEntrada desde el payload editado
  const turnosEntrada: TurnoEntrada[] = (turnosPayload ?? []).map((t: Record<string, unknown>) => ({
    dias:               (t.dias as string[]).map(d => DIA_MAP[d] ?? d as DiaSemana),
    horaInicio:         t.horaInicio as string,
    horaFin:            t.horaFin as string,
    descansoMinutos:    Number(t.descansoMinutos ?? 0),
    descansoComputable: Boolean(t.descansoComputable),
    tipoDiaGemini:      (t.tipoDiaGemini as TipoDia | undefined) ?? undefined,
  }));

  const { turnos: turnosConPolitica, politicaAplicada } =
    aplicarPoliticaDescanso(turnosEntrada, politica);

  const cargoEntrada: CargoEntrada = {
    cargoNormalizado:        (cargoPayload.cargoNormalizado as string) ?? 'Sin cargo',
    cantidadSolicitada:      Number(cargoPayload.cantidadSolicitada ?? 1),
    tipoCobertura:           (cargoPayload.tipoCobertura as CargoEntrada['tipoCobertura']) ?? 'persona',
    jornadaSemanalDeclarada: cargoPayload.jornadaSemanalDeclarada != null
      ? Number(cargoPayload.jornadaSemanalDeclarada) : null,
    diaDescansoObligatorio:  (cargoPayload.diaDescansoObligatorio as DiaSemana | null) ?? null,
    claseRiesgoArl:          (cargoPayload.claseRiesgoArl as string | null) ?? null,
    requiereValidacionArl:   Boolean(cargoPayload.requiereValidacionArl ?? false),
    requiereAlturas:         cargoPayload.requiereAlturas != null
      ? Boolean(cargoPayload.requiereAlturas) : null,
    esJornadaParcialSinHoras: Boolean(cargoPayload.esJornadaParcialSinHoras ?? false),
    turnos:                  turnosConPolitica,
  };

  // 4. Ejecutar motor (puro, sin DB, sin Gemini)
  const resultado = procesarCargo(cargoEntrada, paramsMotor, festivosSet);

  // 5. Añadir alerta de política si aplica
  if (politicaAplicada) {
    resultado.alertas.push({
      severidad: 'MEDIA',
      codigo: 'DESCANSO_APLICADO_POR_POLITICA',
      mensaje: 'Se aplicó descanso por política interna en uno o más turnos sin descanso explícito.',
    });
  }

  // 6. Persistir nuevos resultados en BD
  await prisma.cargoManoObra.update({
    where: { id: cargoId },
    data: {
      cargoNormalizado:          cargoEntrada.cargoNormalizado,
      cantidadSolicitada:        cargoEntrada.cantidadSolicitada,
      tipoCobertura:             cargoEntrada.tipoCobertura,
      jornadaSemanalDeclarada:   cargoEntrada.jornadaSemanalDeclarada,
      claseRiesgoArl:            cargoEntrada.claseRiesgoArl,
      cantidadPersonasCalculadas: resultado.cantidadPersonasCalculadas,
      fteTeorico:                resultado.fteTeorico,
      requiereTurnante:          resultado.requiereTurnante,
      jornadaSemanalCalculada:   resultado.jornadaCalculada,
      coincideJornada:           resultado.coincideJornada,
      diferenciaHoras:           resultado.diferenciaHoras,
      inputsMensuales:           resultado.inputsMensuales as never,
      editadoManualmente:        true,
      observaciones:             (cargoPayload.observaciones as string | null) ?? null,
    },
  });

  // 7. Eliminar alertas anteriores del cargo y recrear
  await prisma.alertaManoObra.deleteMany({ where: { cargoId } });
  for (const alerta of resultado.alertas) {
    await prisma.alertaManoObra.create({
      data: {
        solicitudId,
        cargoId,
        severidad:       alerta.severidad,
        codigo:          alerta.codigo,
        mensaje:         alerta.mensaje,
        fuenteNormativa: alerta.fuenteNormativa ?? null,
        campoAfectado:   alerta.campoAfectado ?? null,
      },
    });
  }

  // 8. Eliminar preguntas anteriores del cargo y recrear
  await prisma.preguntaPendiente.deleteMany({ where: { cargoId } });
  for (const preg of resultado.preguntas) {
    await prisma.preguntaPendiente.create({
      data: {
        solicitudId,
        cargoId,
        pregunta:  preg.pregunta,
        prioridad: preg.prioridad,
        contexto:  preg.contexto,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    cargoId,
    resultado: {
      jornadaCalculada:           resultado.jornadaCalculada,
      fteTeorico:                 resultado.fteTeorico,
      cantidadPersonasCalculadas: resultado.cantidadPersonasCalculadas,
      personasSinHorasExtra:      resultado.personasSinHorasExtra,
      personasConHorasExtra:      resultado.personasConHorasExtra,
      requiereTurnante:           resultado.requiereTurnante,
      inputsMensuales:            resultado.inputsMensuales,
      alertas:                    resultado.alertas,
      preguntas:                  resultado.preguntas,
      politicaDescansoAplicada:   politicaAplicada,
    },
  });
}