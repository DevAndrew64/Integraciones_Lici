import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireSession, puedeVerConsolidadoSimulaciones, normalizarEmpresa } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { auditLog } from '@/lib/audit';
import { FORMULA_KEYS } from '@/lib/ponderacion-economica/formulas';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ESTADOS_REVISION_VALIDOS = ['pendiente_revision', 'revisado', 'aprobado', 'descartado'] as const;
const TIPOS_FORMULA_VALIDOS = [
  'mediana', 'media_geometrica', 'media_geometrica_presupuesto',
  'media_aritmetica', 'media_aritmetica_baja', 'media_aritmetica_alta',
  'menor_valor', 'desconocida', 'personalizada',
] as const;
const BASES_ECONOMICAS_VALIDAS = ['TOTAL_OFERTA', 'COMPONENTE_ESPECIFICO', 'OTRA'] as const;
const EQUIVALENCIA_ESTADOS_VALIDOS = ['NO_EVALUADA', 'EQUIVALENTE_CONFIRMADA', 'NO_EQUIVALENTE', 'DESCONOCIDA'] as const;

// ── Microauditoría §1 — invalidación tras edición ──────────────────────────
// A: cambiar el CONTENIDO evaluado por un humano invalida cualquier revisión
//    previa (estadoRevision vuelve a pendiente_revision) — no puede quedar
//    una aprobación vieja sobre contenido nuevo.
// `formulaTexto` está SOLO en Grupo A (nunca en B): auditoría de sus
// consumidores (criterios-pliego.ts, gate-conjunto.ts) confirmó que es un
// campo LEGACY de puro traslado/trazabilidad — se copia a `CriterioResuelto.
// formulaTexto` pero NUNCA se lee para decidir `formulaKey`, nunca entra a
// `validarConfiguracionCriterios` ni a `calcularPuntajes` (el motor
// matemático real). Desde FASE A.1 la equivalencia con el motor se decide
// EXCLUSIVAMENTE por `formulaKeyMotor` + `equivalenciaMotorEstado`
// (§6) — `formulaTexto` no participa en absoluto. Si en el futuro algún
// código empezara a leerlo para una decisión productiva, debe moverse a B.
const CAMPOS_INVALIDAN_REVISION = new Set([
  'tipoFormula', 'rangoTrmDesde', 'rangoTrmHasta', 'puntajeMaximo', 'presupuestoOficial', 'formulaTexto',
  'condicionTrmTexto', 'baseEconomicaEvaluada', 'descripcionBaseEconomica', 'baseEconomicaTextoFuente', 'baseEconomicaPaginaReferencia',
  'formulaReferenciaTexto', 'reglaPuntuacionTexto', 'formulaKeyMotor',
]);
// B: cambiar lo que DEFINE la semántica matemática (cómo se calcula el valor
//    de referencia + cómo se otorga el puntaje) invalida además cualquier
//    equivalencia con el motor ya confirmada — una equivalencia declarada
//    sobre un texto viejo no puede seguir vigente sobre un texto nuevo.
const CAMPOS_INVALIDAN_EQUIVALENCIA = new Set(['tipoFormula', 'formulaReferenciaTexto', 'reglaPuntuacionTexto']);
// Campos que NUNCA invalidan nada por sí solos: notasFormula, equivalenciaMotorNota
// (anotaciones, no contenido evaluado) y estadoRevision/equivalenciaMotorEstado
// en sí mismos (son el DESTINO de la invalidación, no un disparador).

function valorPlano(v: unknown): unknown {
  if (v != null && typeof v === 'object' && typeof (v as { toNumber?: () => number }).toNumber === 'function') {
    return (v as { toNumber: () => number }).toNumber();
  }
  return v;
}

// ── GET /api/ponderacion/metodos/[id] ─────────────────────────────────────────
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!id || isNaN(id))
    return NextResponse.json({ ok: false, error: 'ID inválido' }, { status: 400 });

  const metodo = await prisma.metodoPonderacionProceso.findUnique({
    where: { id },
    include: { revisadoPor: { select: { id: true, usuario: true } } },
  });

  if (!metodo)
    return NextResponse.json({ ok: false, error: 'Método no encontrado' }, { status: 404 });

  // Verificar acceso por empresa
  const consolidado = await puedeVerConsolidadoSimulaciones(session!);
  if (!consolidado) {
    const userDb = await prisma.user.findUnique({
      where: { id: session!.id },
      select: { entidadGrupo: true },
    });
    const eu = normalizarEmpresa(userDb?.entidadGrupo);
    const emEmpresa = normalizarEmpresa(metodo.empresaGrupo);
    const emRazon   = normalizarEmpresa(metodo.razonSocial);
    if (eu && eu !== emEmpresa && eu !== emRazon) {
      return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 403 });
    }
    if (!eu) {
      return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 403 });
    }
  }

  return NextResponse.json({
    ok: true,
    metodo: {
      ...metodo,
      presupuestoOficial: metodo.presupuestoOficial != null ? Number(metodo.presupuestoOficial) : null,
      puntajeMaximo: metodo.puntajeMaximo != null ? Number(metodo.puntajeMaximo) : null,
      confianzaExtraccion: metodo.confianzaExtraccion != null ? Number(metodo.confianzaExtraccion) : null,
    },
  });
}

// ── PATCH /api/ponderacion/metodos/[id] ───────────────────────────────────────
// Permite revisar, aprobar o descartar un método extraído por IA.
// También permite corregir campos editables (tipoFormula, rangos, puntaje, notas).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!id || isNaN(id))
    return NextResponse.json({ ok: false, error: 'ID inválido' }, { status: 400 });

  let body: {
    estadoRevision?: string;
    tipoFormula?: string;
    rangoTrmDesde?: number | null;
    rangoTrmHasta?: number | null;
    puntajeMaximo?: number | null;
    presupuestoOficial?: number | null;
    formulaTexto?: string | null;
    notasFormula?: string | null;
    // FASE A.1 — solo tienen efecto en métodos ligados a un ConjuntoMetodosPonderacionProceso (§2/§4/§5/§6)
    condicionTrmTexto?: string | null;
    baseEconomicaEvaluada?: string | null;
    descripcionBaseEconomica?: string | null;
    baseEconomicaTextoFuente?: string | null;
    baseEconomicaPaginaReferencia?: number | null;
    formulaReferenciaTexto?: string | null;
    reglaPuntuacionTexto?: string | null;
    formulaKeyMotor?: string | null;
    equivalenciaMotorEstado?: string;
    equivalenciaMotorNota?: string | null;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 }); }

  const existing = await prisma.metodoPonderacionProceso.findUnique({
    where: { id },
    select: {
      id: true, estadoRevision: true, empresaGrupo: true, razonSocial: true,
      rangoTrmDesde: true, rangoTrmHasta: true,
      conjuntoMetodosId: true,
      tipoFormula: true, puntajeMaximo: true, presupuestoOficial: true, formulaTexto: true, notasFormula: true,
      condicionTrmTexto: true, baseEconomicaEvaluada: true, descripcionBaseEconomica: true,
      baseEconomicaTextoFuente: true, baseEconomicaPaginaReferencia: true,
      formulaReferenciaTexto: true, reglaPuntuacionTexto: true,
      formulaKeyMotor: true, equivalenciaMotorEstado: true, equivalenciaMotorNota: true,
    },
  });

  if (!existing)
    return NextResponse.json({ ok: false, error: 'Método no encontrado' }, { status: 404 });

  // §2 — INMUTABILIDAD: un método que pertenece a un CONJUNTO versionado
  // (flujo forward FASE A.1) solo se puede editar mientras ese conjunto está
  // CANDIDATA. Si ya es ACTIVA/SUPERSEDED/RECHAZADA es inmutable: la única
  // corrección legítima es un nuevo análisis → nueva versión CANDIDATA →
  // corregir allí → aprobar (supersede). Métodos legacy sin conjuntoMetodosId
  // (flujo anterior a A.1) NO están sujetos a este gate.
  if (existing.conjuntoMetodosId != null) {
    const conjunto = await prisma.conjuntoMetodosPonderacionProceso.findUnique({
      where: { id: existing.conjuntoMetodosId }, select: { estadoVersion: true },
    });
    if (conjunto && conjunto.estadoVersion !== 'CANDIDATA') {
      return NextResponse.json({
        ok: false,
        error: `No se puede editar: el conjunto de métodos está en estado ${conjunto.estadoVersion} (inmutable). Si necesita corrección, un nuevo análisis crea una nueva versión CANDIDATA para corregirla allí antes de aprobarla/supersederla.`,
      }, { status: 409 });
    }
  }

  // Verificar acceso por empresa
  const consolidado = await puedeVerConsolidadoSimulaciones(session!);
  if (!consolidado) {
    const userDb = await prisma.user.findUnique({
      where: { id: session!.id },
      select: { entidadGrupo: true },
    });
    const eu = normalizarEmpresa(userDb?.entidadGrupo);
    const emEmpresa = normalizarEmpresa(existing.empresaGrupo);
    const emRazon   = normalizarEmpresa(existing.razonSocial);
    if (!eu || (eu !== emEmpresa && eu !== emRazon)) {
      return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 403 });
    }
  }

  // No se puede re-activar un descartado
  if (existing.estadoRevision === 'descartado' && body.estadoRevision && body.estadoRevision !== 'descartado') {
    return NextResponse.json(
      { ok: false, error: 'Un método descartado no puede cambiar de estado. Extrae nuevamente si es necesario.' },
      { status: 409 },
    );
  }

  const data: Record<string, unknown> = {};

  if (body.estadoRevision !== undefined) {
    if (!(ESTADOS_REVISION_VALIDOS as readonly string[]).includes(body.estadoRevision))
      return NextResponse.json(
        { ok: false, error: `estadoRevision inválido. Válidos: ${ESTADOS_REVISION_VALIDOS.join(', ')}` },
        { status: 422 },
      );
    data.estadoRevision = body.estadoRevision;
    data.aprobado = body.estadoRevision === 'aprobado';
    data.revisadoPorId = session!.id;
    data.revisadoEn = new Date();
  }

  if (body.tipoFormula !== undefined) {
    if (!(TIPOS_FORMULA_VALIDOS as readonly string[]).includes(body.tipoFormula))
      return NextResponse.json(
        { ok: false, error: `tipoFormula inválido. Válidos: ${TIPOS_FORMULA_VALIDOS.join(', ')}` },
        { status: 422 },
      );
    data.tipoFormula = body.tipoFormula;
  }

  if (body.rangoTrmDesde !== undefined) {
    if (body.rangoTrmDesde !== null && (body.rangoTrmDesde < 0 || body.rangoTrmDesde > 99))
      return NextResponse.json({ ok: false, error: 'rangoTrmDesde debe estar entre 0 y 99' }, { status: 422 });
    data.rangoTrmDesde = body.rangoTrmDesde;
  }

  if (body.rangoTrmHasta !== undefined) {
    if (body.rangoTrmHasta !== null && (body.rangoTrmHasta < 0 || body.rangoTrmHasta > 99))
      return NextResponse.json({ ok: false, error: 'rangoTrmHasta debe estar entre 0 y 99' }, { status: 422 });
    data.rangoTrmHasta = body.rangoTrmHasta;
  }

  // Validar rango consistente post-edición
  const desdeActual = body.rangoTrmDesde !== undefined ? body.rangoTrmDesde : existing.rangoTrmDesde;
  const hastaActual = body.rangoTrmHasta !== undefined ? body.rangoTrmHasta : existing.rangoTrmHasta;
  if (desdeActual !== null && hastaActual !== null && desdeActual > hastaActual) {
    return NextResponse.json(
      { ok: false, error: 'rangoTrmDesde no puede ser mayor que rangoTrmHasta' },
      { status: 422 },
    );
  }

  if (body.puntajeMaximo !== undefined) {
    if (body.puntajeMaximo !== null && body.puntajeMaximo <= 0)
      return NextResponse.json({ ok: false, error: 'puntajeMaximo debe ser mayor a 0' }, { status: 422 });
    data.puntajeMaximo = body.puntajeMaximo;
  }

  if (body.presupuestoOficial !== undefined) {
    if (body.presupuestoOficial !== null && body.presupuestoOficial <= 0)
      return NextResponse.json({ ok: false, error: 'presupuestoOficial debe ser mayor a 0' }, { status: 422 });
    data.presupuestoOficial = body.presupuestoOficial;
  }

  if (body.formulaTexto !== undefined)  data.formulaTexto = body.formulaTexto;
  if (body.notasFormula !== undefined)  data.notasFormula = body.notasFormula;

  // §4/§5/§6 — campos semánticos del criterio (solo editables mientras el
  // conjunto es CANDIDATA, ya garantizado por el gate de arriba). Nunca se
  // asigna formulaKeyMotor sin que equivalenciaMotorEstado también se declare
  // explícitamente — evita dejar un formulaKeyMotor "huérfano" sin decisión.
  if (body.condicionTrmTexto !== undefined) data.condicionTrmTexto = body.condicionTrmTexto;
  if (body.baseEconomicaEvaluada !== undefined) {
    if (body.baseEconomicaEvaluada !== null && !(BASES_ECONOMICAS_VALIDAS as readonly string[]).includes(body.baseEconomicaEvaluada))
      return NextResponse.json({ ok: false, error: `baseEconomicaEvaluada inválida. Válidas: ${BASES_ECONOMICAS_VALIDAS.join(', ')}` }, { status: 422 });
    data.baseEconomicaEvaluada = body.baseEconomicaEvaluada;
  }
  if (body.descripcionBaseEconomica !== undefined) data.descripcionBaseEconomica = body.descripcionBaseEconomica;
  if (body.baseEconomicaTextoFuente !== undefined) data.baseEconomicaTextoFuente = body.baseEconomicaTextoFuente;
  if (body.baseEconomicaPaginaReferencia !== undefined) data.baseEconomicaPaginaReferencia = body.baseEconomicaPaginaReferencia;
  if (body.formulaReferenciaTexto !== undefined) data.formulaReferenciaTexto = body.formulaReferenciaTexto;
  if (body.reglaPuntuacionTexto !== undefined) data.reglaPuntuacionTexto = body.reglaPuntuacionTexto;
  if (body.equivalenciaMotorEstado !== undefined) {
    if (!(EQUIVALENCIA_ESTADOS_VALIDOS as readonly string[]).includes(body.equivalenciaMotorEstado))
      return NextResponse.json({ ok: false, error: `equivalenciaMotorEstado inválido. Válidos: ${EQUIVALENCIA_ESTADOS_VALIDOS.join(', ')}` }, { status: 422 });
    data.equivalenciaMotorEstado = body.equivalenciaMotorEstado;
  }
  if (body.formulaKeyMotor !== undefined) {
    // §6 — sin fuzzy matching: formulaKeyMotor solo puede ser una FormulaKey
    // real del motor, o null. NUNCA se infiere por el nombre del pliego.
    if (body.formulaKeyMotor !== null && !(FORMULA_KEYS as readonly string[]).includes(body.formulaKeyMotor))
      return NextResponse.json({ ok: false, error: `formulaKeyMotor inválido. Válidos: ${FORMULA_KEYS.join(', ')} (o null)` }, { status: 422 });
    // Microauditoría §1 — nunca se asigna formulaKeyMotor no-nulo sin que la
    // MISMA edición declare explícitamente equivalenciaMotorEstado (evita un
    // formulaKeyMotor "huérfano" sin una decisión de equivalencia asociada).
    if (body.formulaKeyMotor !== null && body.equivalenciaMotorEstado === undefined)
      return NextResponse.json({ ok: false, error: 'Para asignar formulaKeyMotor debes declarar equivalenciaMotorEstado en la misma edición (p.ej. EQUIVALENTE_CONFIRMADA).' }, { status: 422 });
    data.formulaKeyMotor = body.formulaKeyMotor;
  }
  if (body.equivalenciaMotorNota !== undefined) data.equivalenciaMotorNota = body.equivalenciaMotorNota;

  // ── Microauditoría §1 — invalidación tras edición ──────────────────────
  // Se compara contra el valor REAL ya guardado (no solo "el campo vino en
  // el body"): si el humano reenvía el mismo valor, no se invalida nada.
  const huboCambioSemantico = [...CAMPOS_INVALIDAN_REVISION].some(
    (k) => k in data && valorPlano((existing as Record<string, unknown>)[k]) !== data[k],
  );
  if (huboCambioSemantico && (existing.estadoRevision === 'aprobado' || existing.estadoRevision === 'revisado')) {
    // Si el humano, en la MISMA edición, también fija estadoRevision, se
    // respeta su decisión explícita (está re-certificando a propósito).
    if (body.estadoRevision === undefined) {
      data.estadoRevision = 'pendiente_revision';
      data.aprobado = false;
      data.revisadoPorId = null;
      data.revisadoEn = null;
    }
  }

  const huboCambioEquivalencia = [...CAMPOS_INVALIDAN_EQUIVALENCIA].some(
    (k) => k in data && valorPlano((existing as Record<string, unknown>)[k]) !== data[k],
  );
  if (huboCambioEquivalencia) {
    // Microauditoría (ronda 3) §2 — endurecimiento: si cambió algo del Grupo
    // B y la MISMA edición quiere dejar equivalenciaMotorEstado en
    // EQUIVALENTE_CONFIRMADA, esa edición debe declarar TAMBIÉN
    // explícitamente formulaKeyMotor. Nunca se hereda en silencio el
    // formulaKeyMotor anterior — toda reconfirmación matemática después de
    // cambiar la semántica exige re-certificar qué implementación del motor
    // se está confirmando.
    if (body.equivalenciaMotorEstado === 'EQUIVALENTE_CONFIRMADA' && body.formulaKeyMotor === undefined) {
      return NextResponse.json({
        ok: false,
        error: 'Cambiaste tipoFormula/formulaReferenciaTexto/reglaPuntuacionTexto: para reconfirmar equivalenciaMotorEstado=EQUIVALENTE_CONFIRMADA en la misma edición debes declarar también formulaKeyMotor explícitamente (no se hereda el anterior en silencio).',
      }, { status: 422 });
    }
    if (existing.equivalenciaMotorEstado === 'EQUIVALENTE_CONFIRMADA' && body.equivalenciaMotorEstado === undefined) {
      // Ya se había confirmado antes y esta edición no la vuelve a declarar
      // explícitamente: se invalida (no puede seguir "confirmada" sobre un
      // texto distinto al que se certificó).
      data.equivalenciaMotorEstado = 'NO_EVALUADA';
      data.formulaKeyMotor = null;
    }
  }

  if (Object.keys(data).length === 0)
    return NextResponse.json(
      {
        ok: false,
        error: 'Nada que actualizar. Campos permitidos: estadoRevision, tipoFormula, rangoTrmDesde, rangoTrmHasta, puntajeMaximo, presupuestoOficial, formulaTexto, notasFormula, condicionTrmTexto, baseEconomicaEvaluada, descripcionBaseEconomica, baseEconomicaTextoFuente, baseEconomicaPaginaReferencia, formulaReferenciaTexto, reglaPuntuacionTexto, formulaKeyMotor, equivalenciaMotorEstado, equivalenciaMotorNota',
      },
      { status: 422 },
    );

  // §3 — trazabilidad campo por campo: antes = valores leídos ANTES del
  // update, solo para los campos que realmente cambian.
  const antes: Record<string, unknown> = {};
  for (const k of Object.keys(data)) { if (k in existing) antes[k] = (existing as Record<string, unknown>)[k]; }

  // §2 — atomicidad: UPDATE + AuditLog (before/after) en la MISMA
  // transacción. Si el AuditLog falla, `auditLog(params, tx)` relanza (ver
  // src/lib/audit.ts) y `$transaction` revierte el UPDATE — nunca queda un
  // cambio aplicado sin su rastro de auditoría, ni un AuditLog de un cambio
  // que en realidad no se aplicó.
  type MetodoActualizado = {
    id: number; estadoRevision: string; aprobado: boolean;
    tipoFormula: string; rangoTrmDesde: number | null; rangoTrmHasta: number | null;
    puntajeMaximo: unknown; presupuestoOficial: unknown;
    formulaTexto: string | null; notasFormula: string | null;
    condicionTrmTexto: string | null; baseEconomicaEvaluada: string | null; descripcionBaseEconomica: string | null;
    baseEconomicaTextoFuente: string | null; baseEconomicaPaginaReferencia: number | null;
    formulaReferenciaTexto: string | null; reglaPuntuacionTexto: string | null;
    formulaKeyMotor: string | null; equivalenciaMotorEstado: string; equivalenciaMotorNota: string | null;
    revisadoEn: Date | null; updatedAt: Date;
  };
  let updated: MetodoActualizado;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const upd = await tx.metodoPonderacionProceso.update({
        where: { id },
        data,
        select: {
          id: true, estadoRevision: true, aprobado: true,
          tipoFormula: true, rangoTrmDesde: true, rangoTrmHasta: true,
          puntajeMaximo: true, presupuestoOficial: true,
          formulaTexto: true, notasFormula: true,
          condicionTrmTexto: true, baseEconomicaEvaluada: true, descripcionBaseEconomica: true,
          baseEconomicaTextoFuente: true, baseEconomicaPaginaReferencia: true,
          formulaReferenciaTexto: true, reglaPuntuacionTexto: true,
          formulaKeyMotor: true, equivalenciaMotorEstado: true, equivalenciaMotorNota: true,
          revisadoEn: true, updatedAt: true,
        },
      });
      await auditLog({
        accion: 'metodo_ponderacion_editado', recurso: `ponderacion/metodos/${id}`, recursoId: String(id),
        usuarioId: session!.id,
        detalle: { entidad: 'MetodoPonderacionProceso', entidadId: id, antes, despues: data },
      }, tx);
      return upd;
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'No se pudo guardar el cambio (falló el registro de auditoría; no se aplicó nada).' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    metodo: {
      ...updated,
      puntajeMaximo: updated.puntajeMaximo != null ? Number(updated.puntajeMaximo) : null,
      presupuestoOficial: updated.presupuestoOficial != null ? Number(updated.presupuestoOficial) : null,
    },
  });
}