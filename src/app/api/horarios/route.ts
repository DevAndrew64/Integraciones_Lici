import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { requireSession, requireAdmin } from '@/lib/authz';
import {
  validarYCalcularHorario,
  construirPayloadCreacionExterna,
  validarRespuestaCrearTurnoExterno,
  normalizarCodigoExterno,
  decidirAccionPersistencia,
} from '@/lib/costos-mano-obra/horarios/validador-creacion-horario';
import type { DiasJornada, HorarioCatalogoExistente } from '@/lib/costos-mano-obra/horarios/tipos';
import { normalizarHorarioLegacy } from '@/lib/costos-mano-obra/horarios/normalizador-horario-legacy';
import { ESTADO_LEGIBLE } from '@/lib/costos-mano-obra/horarios/tipos-normalizacion';

// Integración con el catálogo de horarios/turnos de Grupo Colba (Midasoft),
// documentada por el usuario. Si el servicio externo no responde (red,
// timeout, etc.) se cae a un catálogo propio (HorarioCatalogo) para no dejar
// al usuario sin poder trabajar — cada horario queda marcado con
// `sincronizadoExterno` para poder diferenciar "datos de la API" de
// "datos guardados solo aquí" en el listado.

const BASE_URL = 'https://grupocolba.com/service/public/api/turnos';
// Si el host externo no responde (DNS/red), fetch() puede quedarse colgado
// mucho tiempo sin timeout propio — eso hace que el propio Next.js corte la
// petición y devuelva su página de error genérica (no JSON). Con esto se
// falla rápido y siempre se responde JSON (cayendo al catálogo local).
const TIMEOUT_MS = 6000;
function fetchConTimeout(url: string, init: RequestInit) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

function hmsToHm(hms: string | null | undefined): string | null {
  if (!hms) return null;
  return hms.slice(0, 5); // "08:00:00" -> "08:00"
}

function hmToHms(hm: string | null | undefined): string {
  if (!hm) return '00:00:00';
  return hm.length === 5 ? hm + ':00' : hm;
}

function boolFromExterno(v: unknown): boolean {
  return v === true || v === 1 || v === '1';
}

interface HorarioExternoListado {
  codigo: string;
  horario: string;
  turno: string;
  jornada: string;
  horas_sem: number | string;
  snactivo?: unknown;
}

interface HorarioExternoDetalle extends HorarioExternoListado {
  horas_jor?: number | string;
  h_inicial?: string;
  h_final?: string;
  cod_midasoft?: string;
  porvar?: number | string;
  sn_jorn_lun?: unknown; sn_jorn_mar?: unknown; sn_jorn_mie?: unknown; sn_jorn_jue?: unknown;
  sn_jorn_vie?: unknown; sn_jorn_sab?: unknown; sn_jorn_dom?: unknown; sn_jorn_fes?: unknown;
  snbono_lunes?: unknown; snbono_martes?: unknown; snbono_miercoles?: unknown; snbono_jueves?: unknown;
  snbono_viernes?: unknown; snbono_sabado?: unknown; snbono_domingo?: unknown; snbono_festivos?: unknown;
  sndiasdescanso_fijo?: unknown;
}

// Campos que expone el normalizador para cada horario del catálogo (§4 del
// bloque de corrección) — la UI consume el ESTADO CRUDO (13 valores
// posibles, tal como los produce el normalizador) y nunca lo recalcula a
// partir de horas_sem/jornada/turno ni de un umbral frente a 42h: esa
// comparación (estado FRENTE A LA JORNADA del cargo) es un concepto
// distinto, que ocurre después de aplicar el horario a un cargo — no aquí.
function construirCamposNormalizacion(horario: string, jornada: string | null, turno: string | null, horasSemana: number) {
  const r = normalizarHorarioLegacy(horario, {
    jornadaTexto: jornada,
    turnoTexto: turno,
    horasSemanaDeclaradas: horasSemana || null,
  });
  return {
    estadoNormalizacion: r.estado,
    estadoNormalizacionLegible: ESTADO_LEGIBLE[r.estado],
    nivelConfianza: r.nivelConfianza,
    horarioOriginal: r.textoOriginal,
    horarioCanonico: r.textoCanonico,
    distribucionesNormalizadas: r.distribuciones.map(d => ({
      idTemporal: d.idTemporal,
      diasSemana: d.diasSemana,
      tipoAplicacion: d.tipoAplicacion,
      bloques: d.bloques,
      descansoDeclaradoMinutos: d.descansoDeclaradoMinutos,
      descansoUbicado: d.descansoUbicado,
      minutosTrabajoCalculados: d.minutosTrabajoCalculados,
      alias: d.alias,
      advertencias: d.advertencias,
    })),
    horasSemanaDeclaradas: r.horasSemanaDeclaradas,
    minutosSemanaCalculados: r.minutosSemanaCalculados,
    advertenciasNormalizacion: r.advertencias.map(a => a.mensaje),
    camposPendientes: r.camposPendientes,
    puedeAplicarse: r.puedeAplicarse,
    requiereConfirmacion: r.requiereConfirmacion,
  };
}

function mapListado(item: HorarioExternoListado) {
  const horasSemana = Number(item.horas_sem) || 0;
  return {
    id: item.codigo,
    codigo: item.codigo,
    horario: item.horario,
    turno: item.turno || null,
    jornada: item.jornada || null,
    horasSemana,
    horasJornada: null as number | null,
    horaInicio: null as string | null,
    horaFin: null as string | null,
    porvar: 0,
    jornLun: false, jornMar: false, jornMie: false, jornJue: false, jornVie: false, jornSab: false, jornDom: false, jornFes: false,
    bonoLun: false, bonoMar: false, bonoMie: false, bonoJue: false, bonoVie: false, bonoSab: false, bonoDom: false, bonoFes: false,
    diaDescansoFijo: false,
    origen: 'api' as const,
    ...construirCamposNormalizacion(item.horario, item.jornada || null, item.turno || null, horasSemana),
  };
}

function mapDetalle(d: HorarioExternoDetalle) {
  const horasSemana = Number(d.horas_sem) || 0;
  return {
    id: d.codigo,
    codigo: d.codigo,
    horario: d.horario,
    turno: d.turno || null,
    jornada: d.jornada || null,
    horasSemana,
    horasJornada: Number(d.horas_jor) || 0,
    horaInicio: hmsToHm(d.h_inicial),
    horaFin: hmsToHm(d.h_final),
    porvar: Number(d.porvar) || 0,
    jornLun: boolFromExterno(d.sn_jorn_lun), jornMar: boolFromExterno(d.sn_jorn_mar), jornMie: boolFromExterno(d.sn_jorn_mie),
    jornJue: boolFromExterno(d.sn_jorn_jue), jornVie: boolFromExterno(d.sn_jorn_vie), jornSab: boolFromExterno(d.sn_jorn_sab),
    jornDom: boolFromExterno(d.sn_jorn_dom), jornFes: boolFromExterno(d.sn_jorn_fes),
    bonoLun: boolFromExterno(d.snbono_lunes), bonoMar: boolFromExterno(d.snbono_martes), bonoMie: boolFromExterno(d.snbono_miercoles),
    bonoJue: boolFromExterno(d.snbono_jueves), bonoVie: boolFromExterno(d.snbono_viernes), bonoSab: boolFromExterno(d.snbono_sabado),
    bonoDom: boolFromExterno(d.snbono_domingo), bonoFes: boolFromExterno(d.snbono_festivos),
    diaDescansoFijo: boolFromExterno(d.sndiasdescanso_fijo),
    origen: 'api' as const,
    ...construirCamposNormalizacion(d.horario, d.jornada || null, d.turno || null, horasSemana),
  };
}

function mapLocal(h: {
  id: number; codigo: string | null; horario: string; turno: string | null; jornada: string | null;
  horasSemana: number; horasJornada: number; horaInicio: string | null; horaFin: string | null; porvar: number;
  jornLun: boolean; jornMar: boolean; jornMie: boolean; jornJue: boolean; jornVie: boolean; jornSab: boolean; jornDom: boolean; jornFes: boolean;
  bonoLun: boolean; bonoMar: boolean; bonoMie: boolean; bonoJue: boolean; bonoVie: boolean; bonoSab: boolean; bonoDom: boolean; bonoFes: boolean;
  diaDescansoFijo: boolean; sincronizadoExterno: boolean;
}) {
  return {
    id: h.codigo || String(h.id),
    localId: h.id,
    codigo: h.codigo, horario: h.horario, turno: h.turno, jornada: h.jornada,
    horasSemana: h.horasSemana, horasJornada: h.horasJornada, horaInicio: h.horaInicio, horaFin: h.horaFin, porvar: h.porvar,
    jornLun: h.jornLun, jornMar: h.jornMar, jornMie: h.jornMie, jornJue: h.jornJue, jornVie: h.jornVie, jornSab: h.jornSab, jornDom: h.jornDom, jornFes: h.jornFes,
    bonoLun: h.bonoLun, bonoMar: h.bonoMar, bonoMie: h.bonoMie, bonoJue: h.bonoJue, bonoVie: h.bonoVie, bonoSab: h.bonoSab, bonoDom: h.bonoDom, bonoFes: h.bonoFes,
    diaDescansoFijo: h.diaDescansoFijo,
    origen: (h.sincronizadoExterno ? 'api' : 'local') as 'api' | 'local',
    ...construirCamposNormalizacion(h.horario, h.jornada, h.turno, h.horasSemana),
  };
}

/**
 * Único punto de conexión con POST /turnos/obtener — usado tanto por GET
 * (consulta de detalle) como por POST (reconsulta tras crear, Bloque
 * HORARIOS 1 §8) para no duplicar la lógica de conexión externa.
 */
async function consultarDetalleExterno(
  empresa: string, codigo: string,
): Promise<{ ok: true; data: HorarioExternoDetalle } | { ok: false; error: string }> {
  try {
    const r = await fetchConTimeout(BASE_URL + '/obtener', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo, empresa }),
    });
    const d = await r.json();
    if (r.ok && d.success) return { ok: true, data: d.data as HorarioExternoDetalle };
    return { ok: false, error: typeof d?.message === 'string' ? d.message : `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// GET /api/horarios?empresa=aseo — lista los turnos/horarios de la empresa
// (servicio externo; si no responde, cae al catálogo local). GET
// /api/horarios?empresa=aseo&codigo=00001 — detalle completo de uno solo.
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  const empresa = req.nextUrl.searchParams.get('empresa') || 'aseo';
  const codigo = req.nextUrl.searchParams.get('codigo');
  const q = req.nextUrl.searchParams.get('q')?.trim().toLowerCase();

  if (codigo) {
    const detalleExterno = await consultarDetalleExterno(empresa, codigo);
    if (detalleExterno.ok) return NextResponse.json({ ok: true, horario: mapDetalle(detalleExterno.data) });

    const local = await prisma.horarioCatalogo.findFirst({ where: { codigo, empresa } });
    if (local) return NextResponse.json({ ok: true, horario: mapLocal(local) });
    return NextResponse.json({ ok: false, error: 'Horario no encontrado.' }, { status: 404 });
  }

  try {
    const r = await fetchConTimeout(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empresa }),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    const listaCruda: HorarioExternoListado[] = Array.isArray(data) ? data : [];
    // Solo horarios activos — el servicio externo trae también los
    // inactivos/dados de baja. Si viniera undefined en algún registro
    // puntual, se conserva (nunca se oculta por un campo ausente).
    const lista = listaCruda.filter(h => h.snactivo === undefined || boolFromExterno(h.snactivo));
    const filtrada = q
      ? lista.filter(h =>
          (h.codigo || '').toLowerCase().includes(q) ||
          (h.horario || '').toLowerCase().includes(q) ||
          (h.turno || '').toLowerCase().includes(q) ||
          (h.jornada || '').toLowerCase().includes(q)
        )
      : lista;
    return NextResponse.json({ ok: true, horarios: filtrada.map(mapListado) });
  } catch (e) {
    // Servicio externo no disponible: se muestra el catálogo local (los
    // horarios guardados aquí mientras no había conexión), con aviso.
    try {
      const locales = await prisma.horarioCatalogo.findMany({
        where: {
          empresa,
          ...(q
            ? {
                OR: [
                  { codigo: { contains: q, mode: 'insensitive' } },
                  { horario: { contains: q, mode: 'insensitive' } },
                  { turno: { contains: q, mode: 'insensitive' } },
                  { jornada: { contains: q, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        orderBy: { id: 'asc' },
      });
      return NextResponse.json({
        ok: true,
        horarios: locales.map(mapLocal),
        warning: 'No se pudo conectar con el servicio de turnos — mostrando solo los guardados localmente. (' + String(e) + ')',
      });
    } catch (e2) {
      return NextResponse.json({ ok: false, error: 'Error de conexión con el servicio de turnos y con el catálogo local: ' + String(e2) }, { status: 502 });
    }
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * POST /api/horarios — crea un horario. Flujo (Bloque HORARIOS 1):
 * validar+recalcular en servidor (nunca confiar en horasSemana/horasJornada/
 * horaInicio/horaFin digitados) → POST /turnos/crear → validar respuesta →
 * reconsulta POST /turnos/obtener → upsert local por empresa+codigo →
 * devolver a la UI. Nunca interpreta h_inicial/h_final como el único bloque
 * trabajado — los bloques reales vienen del parser (parser-horario.ts).
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  try {
    const body = await req.json();
    const empresa = String(body.empresa || 'aseo');

    const dias: DiasJornada = {
      lun: !!body.jornLun, mar: !!body.jornMar, mie: !!body.jornMie, jue: !!body.jornJue,
      vie: !!body.jornVie, sab: !!body.jornSab, dom: !!body.jornDom, fes: !!body.jornFes,
    };
    const bonos: DiasJornada = {
      lun: !!body.bonoLun, mar: !!body.bonoMar, mie: !!body.bonoMie, jue: !!body.bonoJue,
      vie: !!body.bonoVie, sab: !!body.bonoSab, dom: !!body.bonoDom, fes: !!body.bonoFes,
    };

    // Paso 1 — validar y recalcular en servidor. Nunca confía en los campos
    // digitados horasSemana/horasJornada/horaInicio/horaFin.
    const resultado = validarYCalcularHorario({
      empresa,
      horario: String(body.horario ?? ''),
      dias,
      horasSemanaDeclarada: body.horasSemana !== undefined && body.horasSemana !== '' ? Number(body.horasSemana) : undefined,
      horasJornadaDeclarada: body.horasJornada !== undefined && body.horasJornada !== '' ? Number(body.horasJornada) : undefined,
    });
    if (!resultado.ok) {
      return NextResponse.json({ ok: false, error: resultado.errores.join(' ') }, { status: 400 });
    }
    const { bloques, calculo, advertencias } = resultado;
    const advertenciasAcumuladas: string[] = [...advertencias];

    const dias8: Record<string, boolean> = {
      jornLun: dias.lun, jornMar: dias.mar, jornMie: dias.mie, jornJue: dias.jue,
      jornVie: dias.vie, jornSab: dias.sab, jornDom: dias.dom, jornFes: dias.fes,
    };
    const bono8: Record<string, boolean> = {
      bonoLun: bonos.lun, bonoMar: bonos.mar, bonoMie: bonos.mie, bonoJue: bonos.jue,
      bonoVie: bonos.vie, bonoSab: bonos.sab, bonoDom: bonos.dom, bonoFes: bonos.fes,
    };

    // Paso 2 — payload hacia POST /turnos/crear, con valores CALCULADOS.
    const codMidasoft = typeof body.codigoMidasoft === 'string' && body.codigoMidasoft.trim() ? body.codigoMidasoft.trim() : undefined;
    const porvarNumero = body.porvar !== undefined && body.porvar !== '' && Number.isFinite(Number(body.porvar)) ? Number(body.porvar) : undefined;
    const payloadExterno = construirPayloadCreacionExterna({
      empresa,
      horario: String(body.horario),
      turno: body.turno || '',
      jornada: body.jornada || '',
      horasSemanalesDecimal: calculo.horasSemanalesDecimal,
      horasDiariasDecimal: calculo.horasDiariasDecimal,
      horaInicial: calculo.horaInicial,
      horaFinal: calculo.horaFinal,
      codMidasoft,
      porvar: porvarNumero,
      dias, bonos, diaDescansoFijo: !!body.diaDescansoFijo,
    });

    let codigoAsignado: string | null = null;
    let sincronizadoExterno = false;
    let verificadoExterno = false;
    let horarioConfirmadoExterno: string | null = null;

    // Paso 3 — POST /turnos/crear + validación explícita de la respuesta.
    try {
      const r = await fetchConTimeout(BASE_URL + '/crear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadExterno),
      });
      const dCruda = await r.json();
      const validacion = validarRespuestaCrearTurnoExterno(dCruda);
      if (r.ok && validacion.ok) {
        const { codigo, advertencia } = normalizarCodigoExterno(validacion.data.codigo);
        if (advertencia) advertenciasAcumuladas.push(advertencia);
        if (codigo) {
          codigoAsignado = codigo;
          sincronizadoExterno = true;
        }
        if (typeof validacion.data.horario === 'string') horarioConfirmadoExterno = validacion.data.horario;
      } else {
        const motivo = validacion.ok ? `HTTP ${r.status}` : validacion.motivo;
        advertenciasAcumuladas.push(`No se pudo crear en el sistema externo (${motivo}) — se guardó solo localmente.`);
      }
    } catch (e) {
      advertenciasAcumuladas.push(`No se pudo conectar con el sistema externo — se guardó solo localmente. (${String(e)})`);
    }

    // Paso 4 — reconsulta POST /turnos/obtener (reutiliza el helper de GET,
    // sin duplicar la lógica de conexión externa). Si falla, NO se borra el
    // horario ya creado — solo queda sin verificar.
    if (sincronizadoExterno && codigoAsignado) {
      const detalle = await consultarDetalleExterno(empresa, codigoAsignado);
      if (detalle.ok) {
        verificadoExterno = true;
        if (typeof detalle.data.horario === 'string' && detalle.data.horario !== String(body.horario)) {
          advertenciasAcumuladas.push('El horario confirmado por el servicio externo difiere del solicitado — revisar antes de continuar.');
        }
      } else {
        advertenciasAcumuladas.push('El horario se creó en el sistema externo pero no se pudo verificar releyéndolo — la sincronización no quedó completamente confirmada.');
      }
    }

    // Paso 5 — persistencia local: upsert controlado por empresa+codigo a
    // nivel de aplicación (Prisma no tiene @@unique([empresa,codigo]) todavía
    // — no autorizado en este bloque). Esto NO elimina una condición de
    // carrera real entre el "findFirst" y el "create"/"update" siguientes;
    // la garantía completa requerirá una migración futura con
    // @@unique([empresa, codigo]).
    const horarioAGuardar = horarioConfirmadoExterno ?? String(body.horario);
    const datosGuardar = {
      horario: horarioAGuardar,
      turno: body.turno || null,
      jornada: body.jornada || null,
      horasSemana: round2(calculo.horasSemanalesDecimal),
      horasJornada: round2(calculo.horasDiariasDecimal),
      horaInicio: calculo.horaInicial,
      horaFin: calculo.horaFinal,
      porvar: porvarNumero ?? 0,
      horasExtras: body.horasExtras ?? undefined,
      diaDescansoFijo: !!body.diaDescansoFijo,
      sincronizadoExterno,
      ...dias8,
      ...bono8,
    };

    let creado;
    if (codigoAsignado) {
      const existenteRaw = await prisma.horarioCatalogo.findFirst({ where: { empresa, codigo: codigoAsignado } });
      const existente: HorarioCatalogoExistente | null = existenteRaw
        ? { id: existenteRaw.id, empresa, codigo: codigoAsignado }
        : null;
      const accion = decidirAccionPersistencia(existente);
      if (accion === 'ACTUALIZAR' && existenteRaw) {
        creado = await prisma.horarioCatalogo.update({ where: { id: existenteRaw.id }, data: datosGuardar });
      } else {
        creado = await prisma.horarioCatalogo.create({
          data: { codigo: codigoAsignado, empresa, creadoPor: session?.usuario || null, ...datosGuardar },
        });
      }
    } else {
      // Sin código externo por falla de sincronización: correlativo local,
      // conserva el flujo previo — nunca colisiona con códigos externos
      // porque solo se genera cuando la sincronización externa falló.
      const ultimo = await prisma.horarioCatalogo.findFirst({ where: { empresa }, orderBy: { id: 'desc' }, select: { codigo: true } });
      const codigoLocal = String((Number(ultimo?.codigo) || 0) + 1);
      creado = await prisma.horarioCatalogo.create({
        data: { codigo: codigoLocal, empresa, creadoPor: session?.usuario || null, ...datosGuardar },
      });
      codigoAsignado = codigoLocal;
    }

    const warning = advertenciasAcumuladas.length > 0 ? advertenciasAcumuladas.join(' ') : undefined;

    return NextResponse.json({
      ok: true,
      horario: mapLocal(creado),
      bloques,
      minutosJornada: calculo.minutosDiarios,
      minutosSemana: calculo.minutosSemanales,
      horasJornada: calculo.horasDiariasDecimal,
      horasSemana: calculo.horasSemanalesDecimal,
      sincronizadoExterno,
      verificadoExterno,
      ...(warning ? { warning } : {}),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'Error al guardar el horario: ' + String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;
  const admin = requireAdmin(session);
  if (admin) return admin;
  try {
    const body = await req.json();
    const id = Number(body.id);
    if (!id) return NextResponse.json({ ok: false, error: 'Falta id del horario' }, { status: 400 });

    const dias = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom', 'Fes'] as const;
    const jorn: Record<string, boolean> = {};
    const bono: Record<string, boolean> = {};
    for (const dd of dias) {
      jorn[`jorn${dd}`] = !!body[`jorn${dd}`];
      bono[`bono${dd}`] = !!body[`bono${dd}`];
    }

    const actualizado = await prisma.horarioCatalogo.update({
      where: { id },
      data: {
        codigo: body.codigo,
        horario: body.horario,
        turno: body.turno,
        jornada: body.jornada,
        horasSemana: Number(body.horasSemana) || 0,
        horasJornada: Number(body.horasJornada) || 0,
        horaInicio: hmToHms(body.horaInicio),
        horaFin: hmToHms(body.horaFin),
        porvar: Number(body.porvar) || 0,
        horasExtras: body.horasExtras ?? undefined,
        diaDescansoFijo: !!body.diaDescansoFijo,
        ...jorn,
        ...bono,
      },
    });

    return NextResponse.json({ ok: true, horario: mapLocal(actualizado) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'Error al actualizar el horario: ' + String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;
  const admin = requireAdmin(session);
  if (admin) return admin;
  try {
    const body = await req.json();
    const id = Number(body.id);
    if (!id) return NextResponse.json({ ok: false, error: 'Falta id del horario' }, { status: 400 });

    await prisma.horarioCatalogo.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'Error al eliminar el horario: ' + String(e) }, { status: 500 });
  }
}
