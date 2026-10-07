/**
 * GET  /api/costos/mano-obra/[id]  — Carga solicitud completa para revisión
 * PATCH /api/costos/mano-obra/[id] — Guarda cambios manuales en cargo/turno
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireSession } from '@/lib/authz';
import prisma from '@/lib/prisma';
import type { RevisionMOData, EscenarioView, CargoView, AlertaView, PreguntaView } from '@/components/mano-obra/types';

export const dynamic = 'force-dynamic';

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;
  const { id: idStr } = await context.params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 });

  const sol = await prisma.solicitudManoObra.findUnique({
    where: { id },
    include: {
      escenarios: {
        orderBy: { orden: 'asc' },
        include: {
          cargos: {
            include: {
              turnos:  { orderBy: { id: 'asc' } },
              alertas: { orderBy: { severidad: 'asc' } },
            },
          },
          alertas:  { orderBy: { severidad: 'asc' } },
          preguntas: { orderBy: { prioridad: 'asc' } },
        },
      },
      alertas:  { orderBy: [{ severidad: 'asc' }, { id: 'asc' }] },
      preguntas: { orderBy: [{ prioridad: 'asc' }, { id: 'asc' }] },
    },
  });

  if (!sol) return NextResponse.json({ error: 'Solicitud no encontrada' }, { status: 404 });

  // Extraer valoresAgregados y condicionInsumos del geminiExtraccionRaw
  const geminiRaw = sol.geminiExtraccionRaw as Record<string, unknown> | null;
  const valoresAgregados: string[] = Array.isArray(geminiRaw?.valoresAgregados)
    ? (geminiRaw!.valoresAgregados as string[])
    : [];
  const condicionInsumos = (geminiRaw?.condicionInsumos as string | null) ?? null;
  const observacionesGenerales = (geminiRaw?.observacionesGenerales as string | null) ?? null;

  // Índices para resolver nombres de contexto en alertas y preguntas
  const escNombreById = new Map(sol.escenarios.map(e => [e.id, e.nombre]));
  const cargoNombreById = new Map(
    sol.escenarios.flatMap(e => e.cargos.map(c => [c.id, c.cargoNormalizado])),
  );

  // Construir alertas globales con contexto
  const alertasGlobales: AlertaView[] = sol.alertas.map(a => ({
    id:                  a.id,
    severidad:           a.severidad as AlertaView['severidad'],
    codigo:              a.codigo,
    mensaje:             a.mensaje,
    fuenteNormativa:     a.fuenteNormativa,
    campoAfectado:       a.campoAfectado,
    revisada:            a.revisada,
    comentarioValidacion: a.comentarioValidacion ?? null,
    escenarioId:         a.escenarioId,
    cargoId:             a.cargoId,
    escenarioNombre:     a.escenarioId != null ? (escNombreById.get(a.escenarioId) ?? null) : null,
    cargoNombre:         a.cargoId != null ? (cargoNombreById.get(a.cargoId) ?? null) : null,
  }));

  // Construir preguntas globales
  const preguntasGlobales: PreguntaView[] = sol.preguntas.map(p => ({
    id:             p.id,
    pregunta:       p.pregunta,
    prioridad:      p.prioridad as PreguntaView['prioridad'],
    contexto:       p.contexto,
    respondida:     p.respondida,
    respuesta:      p.respuesta,
    escenarioId:    p.escenarioId,
    cargoId:        p.cargoId,
    escenarioNombre: p.escenarioId != null ? (escNombreById.get(p.escenarioId) ?? null) : null,
    cargoNombre:     p.cargoId != null ? (cargoNombreById.get(p.cargoId) ?? null) : null,
  }));

  // Construir escenarios con cargos y turnos
  const escenarios: EscenarioView[] = sol.escenarios.map(esc => {
    const cargos: CargoView[] = esc.cargos.map(cg => {
      const inputs = cg.inputsMensuales as Record<string, unknown> | null;
      const exportable = (inputs?.exportableAlTabActual as boolean) ?? false;
      const motivoNoExportable = (inputs?.motivoNoExportable as string | null) ?? null;

      const alertasCargo: AlertaView[] = cg.alertas.map(a => ({
        id:                  a.id,
        severidad:           a.severidad as AlertaView['severidad'],
        codigo:              a.codigo,
        mensaje:             a.mensaje,
        fuenteNormativa:     a.fuenteNormativa,
        campoAfectado:       a.campoAfectado,
        revisada:            a.revisada,
        comentarioValidacion: a.comentarioValidacion ?? null,
        escenarioId:         a.escenarioId,
        cargoId:             a.cargoId,
        escenarioNombre:     esc.nombre,
        cargoNombre:         cg.cargoNormalizado,
      }));

      return {
        id:                          cg.id,
        escenarioId:                 cg.escenarioId,
        cargoOriginal:               cg.cargoOriginal,
        cargoNormalizado:            cg.cargoNormalizado,
        cantidadSolicitada:          cg.cantidadSolicitada,
        cantidadPuestosPorTurno:     cg.cantidadPuestosPorTurno,
        cantidadPersonasCalculadas:  cg.cantidadPersonasCalculadas,
        fteTeorico:                  cg.fteTeorico,
        personasSinHorasExtra:       (cg as Record<string, unknown>).personasSinHorasExtra as number | null ?? null,
        personasConHorasExtra:       (cg as Record<string, unknown>).personasConHorasExtra as number | null ?? null,
        requiereValidacionHorasExtra:(cg as Record<string, unknown>).requiereValidacionHorasExtra as boolean | null ?? null,
        requiereTurnante:            cg.requiereTurnante,
        tipoCobertura:               cg.tipoCobertura,
        diaDescansoObligatorio:      cg.diaDescansoObligatorio,
        jornadaSemanalDeclarada:     cg.jornadaSemanalDeclarada,
        jornadaSemanalCalculada:     cg.jornadaSemanalCalculada,
        coincideJornada:             cg.coincideJornada,
        diferenciaHoras:             cg.diferenciaHoras,
        claseRiesgoArl:              cg.claseRiesgoArl,
        porcentajeArl:               cg.porcentajeArl,
        requiereValidacionArl:       cg.requiereValidacionArl,
        requiereDotacion:            cg.requiereDotacion,
        requiereEpp:                 cg.requiereEpp,
        requiereExamenMedico:        cg.requiereExamenMedico,
        requiereAlturas:             (cg as Record<string, unknown>).requiereAlturas as boolean | null ?? null,
        editadoManualmente:          cg.editadoManualmente,
        observaciones:               cg.observaciones,
        sedeNombre:                  null,
        inputsMensuales:             inputs as CargoView['inputsMensuales'],
        alertas:                     alertasCargo,
        turnos: cg.turnos.map(t => ({
          id:                         t.id,
          dias:                       t.dias,
          horaInicio:                 t.horaInicio,
          horaFin:                    t.horaFin,
          cruzaMedianoche:            t.cruzaMedianoche,
          descansoMinutos:            t.descansoMinutos,
          descansoComputable:         t.descansoComputable,
          descansoHoraInicio:         (t as Record<string, unknown>).descansoHoraInicio as string | null ?? null,
          descansoHoraFin:            (t as Record<string, unknown>).descansoHoraFin as string | null ?? null,
          metodoDistribucionDescanso: (t as Record<string, unknown>).metodoDistribucionDescanso as string | null ?? null,
          tipoDiaGemini:              t.tipoDiaGemini,
          tipoDiaCalculado:           t.tipoDiaCalculado,
          horasBrutasDia:             t.horasBrutasDia,
          horasNetasDia:              t.horasNetasDia,
          horasDiurnas:               t.horasDiurnas,
          horasNocturnas:             t.horasNocturnas,
        })),
      } as CargoView;
    });

    const cargosExportables = cargos.filter(c => c.inputsMensuales?.exportableAlTabActual === true);
    const cargosBloqueados  = cargos.filter(c => !c.inputsMensuales?.exportableAlTabActual);
    const todosExp = cargos.length > 0 && cargosBloqueados.length === 0;
    const algunoExp = cargosExportables.length > 0;
    const exportable: EscenarioView['exportable'] =
      todosExp ? 'completo' : algunoExp ? 'parcial' : 'no_exportable';
    const motivoNoExp = [...new Set(
      cargosBloqueados
        .map(c => c.inputsMensuales?.motivoNoExportable)
        .filter((m): m is string => !!m),
    )].join('; ') || null;

    return {
      id:               esc.id,
      nombre:           esc.nombre,
      empresaGrupo:     esc.empresaGrupo,
      tipoServicio:     esc.tipoServicio,
      esPrincipal:      esc.esPrincipal,
      orden:            esc.orden,
      sedeNombre:       esc.sede ?? null,
      tieneInsumos:     (esc as Record<string, unknown>).tieneInsumos as boolean | null ?? null,
      cargos,
      exportable,
      motivoNoExportable: motivoNoExp,
      cargosExportables,
      cargosBloqueados,
    } as EscenarioView;
  });

  const data: RevisionMOData = {
    solicitud: {
      id:                    sol.id,
      cliente:               sol.cliente,
      empresaGrupo:          sol.empresaGrupo,
      estado:                sol.estado as SolicitudView['estado'],
      textoOriginal:         sol.textoOriginal,
      servicioDetectado:     sol.servicioDetectado,
      duracionMeses:         sol.duracionMeses,
      requiereInsumos:       sol.requiereInsumos,
      requiereDotacionEspecial: sol.requiereDotacionEspecial,
      requiereEppEspecial:   sol.requiereEppEspecial,
      requiereAlturas:       sol.requiereAlturas,
      multisede:             sol.multisede,
      geminiVersion:         sol.geminiVersion,
      creadoEn:              sol.creadoEn.toISOString(),
      aprobadoEn:            sol.aprobadoEn?.toISOString() ?? null,
      condicionInsumos,
      valoresAgregados,
      observacionesGenerales,
    },
    escenarios,
    alertas:   alertasGlobales,
    preguntas: preguntasGlobales,
    geminiExtraccion: geminiRaw,
    guardadoEnBD: true,
  };

  return NextResponse.json(data);
}

// ─── PATCH — guardar cambios manuales ────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const sessionP = await getSession(req);
  const deniedP = requireSession(sessionP);
  if (deniedP) return deniedP;
  const { id: idStr } = await context.params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 });

  const body = await req.json();
  const { cargoId, cambios } = body as { cargoId: number; cambios: Record<string, unknown> };

  if (!cargoId || !cambios) return NextResponse.json({ error: 'Faltan cargoId o cambios' }, { status: 400 });

  // Verificar que cargoId pertenezca a la solicitud (protección IDOR)
  const cargoCheck = await prisma.cargoManoObra.findFirst({
    where: { id: cargoId },
    select: { escenario: { select: { solicitudId: true } } },
  });
  if (!cargoCheck || cargoCheck.escenario.solicitudId !== id) {
    return NextResponse.json({ error: 'Cargo no pertenece a esta solicitud' }, { status: 403 });
  }

  const cargo = await prisma.cargoManoObra.update({
    where: { id: cargoId },
    data: {
      ...Object.fromEntries(
        Object.entries(cambios).filter(([k]) =>
          ['cargoNormalizado','cantidadSolicitada','tipoCobertura','jornadaSemanalDeclarada',
           'claseRiesgoArl','requiereDotacion','requiereEpp','requiereExamenMedico','observaciones']
          .includes(k),
        ),
      ),
      editadoManualmente: true,
    },
  });

  await prisma.solicitudManoObra.update({
    where: { id },
    data: { actualizadoEn: new Date() },
  });

  return NextResponse.json({ ok: true, cargoId: cargo.id, editadoManualmente: true });
}

// local import fix
import type { SolicitudView } from '@/components/mano-obra/types';