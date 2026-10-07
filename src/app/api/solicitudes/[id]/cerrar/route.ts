/**
 * POST /api/solicitudes/[id]/cerrar — cierre concurrente-seguro.
 *
 * Cualquier responsable ACTIVO de la Solicitud (su propia fila, sin
 * importar la posición en `asignaciones[]`) puede cerrarla, igual que un
 * administrador — nunca solo "el último responsable del arreglo".
 *
 * Protección contra doble cierre: transición condicional
 * (`updateMany` con `estadoSolicitud NOT IN (terminales)` en el WHERE) —
 * si otro responsable ya cerró la solicitud entre la verificación y este
 * intento, `count` da 0 y se responde 409 sin escribir nada.
 *
 * Ajuste "SQR DESACOPLADA DEL CIERRE DEL PROCESO" — esta ruta SÍ intenta
 * cerrar la SQR asociada (si existe una abierta) antes de completar el
 * cierre del proceso, reutilizando el mismo motor que usa `PRESENTAR`
 * (`intentarCerrarSqrSiCorresponde`, en `cierre-sqr-al-presentar.ts`).
 * Pero el resultado de ese intento NUNCA bloquea ni condiciona el cierre
 * del proceso: si GrupoColba falla, el error queda persistido internamente
 * (`sqrError`/`sqrCierreEstado='ERROR'`) para diagnóstico/reintento
 * posterior — el proceso se cierra igual, y la SQR sigue apareciendo como
 * abierta (nunca se le muestra un error técnico al usuario en este flujo).
 *
 * ÚNICO endpoint que puede llevar `Solicitud.estadoSolicitud` a un estado
 * terminal (Cerrada/Cancelada) — el PATCH genérico (`/api/solicitudes`)
 * rechaza explícitamente cualquier intento de hacerlo (ver ese archivo).
 *
 * SEGURIDAD DEL PAYLOAD (auditoría, dos rondas) — `filaExtra` es un objeto
 * que envía el navegador y NUNCA se copia verbatim sobre la fila. Existe
 * una allowlist TOP-LEVEL del body (`idAsignacion`/`filaExtra`/
 * `resultadoEstado` — cualquier otra clave, ej. `sqrCerrada`, `fechaCierre`,
 * `sqrNumero`, `procesoId`, `asignaciones`, rechaza la petición con 400,
 * nunca se ignora en silencio) y una allowlist por `estadoRevision` dentro
 * de `filaExtra`, derivada de los flujos reales que existen en `page.tsx`
 * (ver `MATRIZ_CIERRE`+validadores). Los campos de autoría/tiempo
 * (`cerradoPor`, `validadoPor`, `fechaValidacion`, `fechaCierre` de fila,
 * `ultimaActualizacion`, `gestionadoPor`) se aceptan como presentes pero su
 * VALOR siempre se descarta y se reconstruye en servidor.
 *
 * INVENTARIO DE ORIGEN (los 5 flujos reales que llegan aquí, verificados
 * exhaustivamente contra `page.tsx` — no se inventa ningún valor):
 *  1. RECHAZADO (motivo simple)   → GestionAsignacionInline, ~17331/17491
 *  2. RECHAZADO (causal + evidencia) → ModalEditarAsignacion.handleRechazar, ~11664
 *  3. CERRADO_ADJUDICADO          → GestionAsignacionInline, ~17382
 *  4. CERRADO_NO_ADJUDICADO (resultado) → GestionAsignacionInline, ~17382
 *  4b. CERRADO_NO_ADJUDICADO (gerencial) → ModuloProcesosEnEjecucion.cerrarGerencial, ~20003
 *  5. CANCELADO / CERRADO_NO_CUMPLIMIENTO → VistFichaAsignacion.guardarCierreDirecto, ~17750
 *
 * Ajuste "RECHAZO PRIVADO — DIRECTOR/COORDINADOR COMERCIAL" — la
 * autorización YA NO es un único `puedeCerrarSolicitud` para las 5 ramas:
 * cuando `filaExtra.estadoRevision === 'RECHAZADO'` (flujos 1 y 2, los
 * ÚNICOS que ganan el permiso ampliado) se evalúa `puedeRechazarSolicitud`;
 * las ramas 3/4/4b/5 siguen evaluando `puedeCerrarSolicitud` sin cambios.
 */
import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { getSession } from '@/lib/session';
import { requireSession, esAdministradorProcesos, esMercadeo } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { resolverUsuarioSesionActivo, puedeCerrarSolicitud, puedeRechazarSolicitud, puedeNoAceptarObservacion, encontrarAsignacionPropia, esProcesoPrivado } from '@/lib/solicitudes/autorizacion-asignacion';
import { intentarCerrarSqrSiCorresponde, type DbCierreSqr } from '@/lib/solicitudes/cierre-sqr-al-presentar';
import { construirRespuestaCierreSqrTerminal } from '@/lib/solicitudes/respuesta-cierre-sqr';
import { obtenerObservacionCierreTerminal, ESTADOS_REVISION_NO_PRESENTADO } from '@/lib/solicitudes/observacion-cierre-terminal';
import { ESTADOS_SOLICITUD_TERMINALES } from '@/lib/solicitudes/estados-solicitud';

const RESULTADOS_VALIDOS = new Set(['Cerrada', 'Cancelada']);

// Límites nuevos, documentados explícitamente (no existían antes porque el
// PATCH genérico no validaba nada de esto).
const MAX_LONGITUD_MOTIVO_RECHAZO = 2000;
const MAX_LONGITUD_DETALLE_CIERRE = 4000;
const MAX_LONGITUD_EVIDENCIA_NOMBRE = 255;
const MAX_LONGITUD_EVIDENCIA_TIPO = 100;
const MAX_LONGITUD_EVIDENCIA_BASE64 = 8_000_000; // ~6MB binario
const MAX_LONGITUD_OBSERVACION_RECHAZO = 2000;
const MAX_LONGITUD_URL_EVIDENCIA = 2000;
// Ajuste "OBSERVACIÓN OBLIGATORIA AL ADJUDICAR/NO ADJUDICAR" — justificación
// del resultado, exigida por GestionAsignacionInline (page.tsx) antes de
// habilitar "Finalizar proceso". Mismo patrón de validación que
// `MAX_LONGITUD_MOTIVO_RECHAZO`/`observacionRechazo` — nunca opcional aquí
// (a diferencia de `observacionRechazo`, que sí es opcional).
const MAX_LONGITUD_OBSERVACION_RESULTADO = 2000;
const MAX_LONGITUD_CAUSA_ESPECIFICA_GERENCIAL = 2000;

const CAUSAS_CIERRE_DIRECTO = new Set([
  'Proceso limitado a Mipyme', 'Presupuesto insuficiente', 'Determinación gerencial',
  'Cancelación por la entidad', 'Otros',
]);
// Causales del flujo `ModalEditarAsignacion.handleRechazar` (page.tsx, const CAUSALES).
// Ajuste "OTRA CAUSA — RECHAZO" — 'OTRA_CAUSA' se agrega aquí, en
// `CAUSALES` (page.tsx) y en `ETIQUETA_CAUSAL_RECHAZO`
// (observacion-cierre-terminal.ts) — las 3 listas deben mantenerse en
// paridad, nunca divergir.
const CAUSALES_RECHAZO = new Set([
  'ESTUDIO_MERCADO', 'PROCESO_DUPLICADO', 'NO_OBJETO_SOCIAL', 'SERVICIOS_ESPECIALIZADOS', 'DECISION_GERENCIAL', 'OTRA_CAUSA',
]);

// Claves que el cliente puede incluir en `filaExtra` sin que se rechace la
// petición, pero cuyo VALOR nunca se usa — siempre se reconstruyen en
// servidor.
const CAMPOS_SIEMPRE_SERVIDOR = new Set(['cerradoPor', 'validadoPor', 'fechaValidacion', 'fechaCierre', 'ultimaActualizacion', 'gestionadoPor']);

// Body top-level: SOLO estas 3 claves están permitidas. Cualquier otra
// (incluidos los campos protegidos que un cliente manipulado podría
// intentar colar: sqrCerrada, fechaCierre, sqrNumero, procesoId,
// asignaciones, responsables, etc.) rechaza la petición completa con 400 —
// nunca se ignora en silencio, para poder detectar un cliente desactualizado
// o manipulado en vez de aparentar que el payload se procesó correctamente.
const CLAVES_BODY_PERMITIDAS = new Set(['idAsignacion', 'filaExtra', 'resultadoEstado']);

const RESULTADO_ESTADO_POR_ESTADO_REVISION: Record<string, 'Cerrada' | 'Cancelada'> = {
  RECHAZADO: 'Cerrada',
  CERRADO_ADJUDICADO: 'Cerrada',
  CERRADO_NO_ADJUDICADO: 'Cerrada',
  CERRADO_NO_CUMPLIMIENTO: 'Cerrada',
  CANCELADO: 'Cancelada',
};

type ResultadoValidacionFila = { ok: true; fila: Record<string, unknown> } | { ok: false; error: string };

function esTexto(v: unknown): v is string {
  return typeof v === 'string';
}

function verificarClavesPermitidas(f: Record<string, unknown>, extra: readonly string[]): string | null {
  const permitidas = new Set(['estadoRevision', ...extra, ...CAMPOS_SIEMPRE_SERVIDOR]);
  for (const clave of Object.keys(f)) {
    if (!permitidas.has(clave)) return clave;
  }
  return null;
}

/** Flujo 1 (motivo simple, GestionAsignacionInline) y flujo 2 (causal + evidencia, ModalEditarAsignacion.handleRechazar) — mutuamente excluyentes. */
function validarRechazado(f: Record<string, unknown>): ResultadoValidacionFila {
  const clavesExtra = ['decisionObservaciones', 'motivoRechazo', 'causalRechazo', 'observacionRechazo', 'urlEvidenciaRechazo'] as const;
  const clavaNoPermitida = verificarClavesPermitidas(f, clavesExtra);
  if (clavaNoPermitida) return { ok: false, error: `Campo no permitido en el cierre: "${clavaNoPermitida}".` };

  const tieneMotivoSimple = f.motivoRechazo !== undefined;
  const tieneCausal = f.causalRechazo !== undefined;
  if (tieneMotivoSimple === tieneCausal) {
    return { ok: false, error: 'Debe enviarse exactamente uno de: motivoRechazo (rechazo simple) o causalRechazo (rechazo con causal).' };
  }

  const fila: Record<string, unknown> = { estadoRevision: 'RECHAZADO' };

  if (f.decisionObservaciones !== undefined) {
    // Único valor alcanzable por un cierre real: 'aceptada' lleva a un
    // estado NO terminal (nunca llega a este endpoint).
    if (f.decisionObservaciones !== 'no_aceptada') return { ok: false, error: 'decisionObservaciones inválido para un cierre.' };
    fila.decisionObservaciones = 'no_aceptada';
  }

  if (tieneMotivoSimple) {
    if (!esTexto(f.motivoRechazo)) return { ok: false, error: 'motivoRechazo debe ser texto.' };
    const v = f.motivoRechazo.trim();
    if (!v) return { ok: false, error: 'motivoRechazo no puede estar vacío.' };
    if (v.length > MAX_LONGITUD_MOTIVO_RECHAZO) return { ok: false, error: `motivoRechazo excede el máximo de ${MAX_LONGITUD_MOTIVO_RECHAZO} caracteres.` };
    fila.motivoRechazo = v;
    return { ok: true, fila };
  }

  // Rama causal (ModalEditarAsignacion.handleRechazar).
  if (!esTexto(f.causalRechazo) || !CAUSALES_RECHAZO.has(f.causalRechazo)) {
    return { ok: false, error: 'causalRechazo no es un valor permitido.' };
  }
  fila.causalRechazo = f.causalRechazo;

  if (f.observacionRechazo !== undefined && f.observacionRechazo !== null) {
    if (!esTexto(f.observacionRechazo)) return { ok: false, error: 'observacionRechazo debe ser texto.' };
    if (f.observacionRechazo.length > MAX_LONGITUD_OBSERVACION_RECHAZO) return { ok: false, error: `observacionRechazo excede el máximo de ${MAX_LONGITUD_OBSERVACION_RECHAZO} caracteres.` };
    fila.observacionRechazo = f.observacionRechazo.trim() || null;
  } else {
    fila.observacionRechazo = null;
  }

  if (f.urlEvidenciaRechazo !== undefined && f.urlEvidenciaRechazo !== null) {
    if (!esTexto(f.urlEvidenciaRechazo) || f.urlEvidenciaRechazo.length > MAX_LONGITUD_URL_EVIDENCIA) {
      return { ok: false, error: 'urlEvidenciaRechazo inválido.' };
    }
    fila.urlEvidenciaRechazo = f.urlEvidenciaRechazo;
  } else {
    fila.urlEvidenciaRechazo = null;
  }

  // Coherencia (mismo requisito que ya exige el frontend: `esDecisionGerencial && !archivo` bloquea el botón).
  if (f.causalRechazo === 'DECISION_GERENCIAL' && !fila.urlEvidenciaRechazo) {
    return { ok: false, error: 'urlEvidenciaRechazo es requerido cuando causalRechazo="DECISION_GERENCIAL".' };
  }

  // Ajuste "OTRA CAUSA — RECHAZO" — mismo patrón de coherencia que la
  // validación de `DECISION_GERENCIAL` justo arriba: para las OTRAS 5
  // causales `observacionRechazo` sigue siendo opcional (comportamiento sin
  // cambios), pero "Otra causa" no tiene una etiqueta descriptiva por sí
  // sola — sin detalle, `obtenerObservacionCierreTerminal` no tendría nada
  // legible que mostrar. Se valida aquí (nunca solo en el frontend): un
  // cliente que llame directamente al endpoint debe recibir el mismo 400.
  if (f.causalRechazo === 'OTRA_CAUSA' && !fila.observacionRechazo) {
    return { ok: false, error: 'Debes indicar el detalle cuando seleccionas Otra causa.' };
  }

  // Paridad con el comportamiento anterior de `handleRechazar`, que
  // también fijaba `estadoAsignacion` de la fila (a diferencia del flujo de
  // motivo simple, que nunca tocaba ese campo) — se preserva solo en esta rama.
  fila.estadoAsignacion = 'RECHAZADO';

  return { ok: true, fila };
}

/** `observacionResultado` es OBLIGATORIA en ambas ramas (Adjudicado/No
 * adjudicado, GestionAsignacionInline) — a diferencia de `observacionRechazo`
 * (opcional). Reutilizada por `validarCerradoAdjudicado` y la rama
 * `tieneResultado` de `validarCerradoNoAdjudicado`. */
function validarObservacionResultado(f: Record<string, unknown>): { ok: true; valor: string } | { ok: false; error: string } {
  if (!esTexto(f.observacionResultado)) return { ok: false, error: 'observacionResultado es obligatorio.' };
  const valor = f.observacionResultado.trim();
  if (!valor) return { ok: false, error: 'observacionResultado no puede estar vacío.' };
  if (valor.length > MAX_LONGITUD_OBSERVACION_RESULTADO) return { ok: false, error: `observacionResultado excede el máximo de ${MAX_LONGITUD_OBSERVACION_RESULTADO} caracteres.` };
  return { ok: true, valor };
}

function validarCerradoAdjudicado(f: Record<string, unknown>): ResultadoValidacionFila {
  const clavaNoPermitida = verificarClavesPermitidas(f, ['resultadoFinal', 'observacionResultado']);
  if (clavaNoPermitida) return { ok: false, error: `Campo no permitido en el cierre: "${clavaNoPermitida}".` };
  if (f.resultadoFinal !== 'Adjudicado') return { ok: false, error: 'resultadoFinal debe ser "Adjudicado" para estadoRevision "CERRADO_ADJUDICADO".' };
  const obs = validarObservacionResultado(f);
  if (!obs.ok) return obs;
  return { ok: true, fila: { estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Adjudicado', observacionResultado: obs.valor } };
}

/** Flujo "resultado" (GestionAsignacionInline) y flujo "gerencial" (ModuloProcesosEnEjecucion.cerrarGerencial) — mutuamente excluyentes. */
function validarCerradoNoAdjudicado(f: Record<string, unknown>): ResultadoValidacionFila {
  const clavaNoPermitida = verificarClavesPermitidas(f, ['resultadoFinal', 'tipoCausa', 'causaEspecifica', 'observacionResultado']);
  if (clavaNoPermitida) return { ok: false, error: `Campo no permitido en el cierre: "${clavaNoPermitida}".` };

  const tieneResultado = f.resultadoFinal !== undefined;
  const tieneGerencial = f.tipoCausa !== undefined;
  if (tieneResultado === tieneGerencial) {
    return { ok: false, error: 'Debe enviarse exactamente uno de: resultadoFinal (resultado del proceso) o tipoCausa (cierre gerencial).' };
  }

  if (tieneResultado) {
    if (f.resultadoFinal !== 'No adjudicado') return { ok: false, error: 'resultadoFinal debe ser "No adjudicado" para estadoRevision "CERRADO_NO_ADJUDICADO".' };
    const obs = validarObservacionResultado(f);
    if (!obs.ok) return obs;
    return { ok: true, fila: { estadoRevision: 'CERRADO_NO_ADJUDICADO', resultadoFinal: 'No adjudicado', observacionResultado: obs.valor } };
  }

  if (f.tipoCausa !== 'Determinación gerencial') return { ok: false, error: 'tipoCausa debe ser "Determinación gerencial".' };
  const fila: Record<string, unknown> = { estadoRevision: 'CERRADO_NO_ADJUDICADO', tipoCausa: 'Determinación gerencial' };
  if (f.causaEspecifica !== undefined && f.causaEspecifica !== null) {
    if (!esTexto(f.causaEspecifica)) return { ok: false, error: 'causaEspecifica debe ser texto.' };
    if (f.causaEspecifica.length > MAX_LONGITUD_CAUSA_ESPECIFICA_GERENCIAL) return { ok: false, error: `causaEspecifica excede el máximo de ${MAX_LONGITUD_CAUSA_ESPECIFICA_GERENCIAL} caracteres.` };
    fila.causaEspecifica = f.causaEspecifica.trim() || 'Cierre por determinación gerencial';
  } else {
    fila.causaEspecifica = 'Cierre por determinación gerencial';
  }
  return { ok: true, fila };
}

/** CANCELADO / CERRADO_NO_CUMPLIMIENTO — "Cerrar sin presentar" (VistFichaAsignacion.guardarCierreDirecto). */
function validarCierreDirecto(f: Record<string, unknown>, estadoRevision: 'CANCELADO' | 'CERRADO_NO_CUMPLIMIENTO'): ResultadoValidacionFila {
  const clavaNoPermitida = verificarClavesPermitidas(f, ['causaNoPresentacion', 'detalleCierreDirecto', 'evidenciaCierre']);
  if (clavaNoPermitida) return { ok: false, error: `Campo no permitido en el cierre: "${clavaNoPermitida}".` };

  if (!esTexto(f.causaNoPresentacion) || !CAUSAS_CIERRE_DIRECTO.has(f.causaNoPresentacion)) {
    return { ok: false, error: 'causaNoPresentacion no es un valor permitido.' };
  }
  const esCancelacionEntidad = f.causaNoPresentacion === 'Cancelación por la entidad';
  if (esCancelacionEntidad !== (estadoRevision === 'CANCELADO')) {
    return { ok: false, error: `causaNoPresentacion "${f.causaNoPresentacion}" no es coherente con estadoRevision "${estadoRevision}".` };
  }

  const fila: Record<string, unknown> = { estadoRevision, causaNoPresentacion: f.causaNoPresentacion };

  if (f.detalleCierreDirecto !== undefined && f.detalleCierreDirecto !== null) {
    if (!esTexto(f.detalleCierreDirecto)) return { ok: false, error: 'detalleCierreDirecto debe ser texto o null.' };
    const v = f.detalleCierreDirecto.trim();
    if (v.length > MAX_LONGITUD_DETALLE_CIERRE) return { ok: false, error: `detalleCierreDirecto excede el máximo de ${MAX_LONGITUD_DETALLE_CIERRE} caracteres.` };
    fila.detalleCierreDirecto = v || null;
  } else {
    fila.detalleCierreDirecto = null;
  }

  if (f.evidenciaCierre !== undefined && f.evidenciaCierre !== null) {
    const ev = f.evidenciaCierre;
    if (typeof ev !== 'object' || Array.isArray(ev)) return { ok: false, error: 'evidenciaCierre debe ser un objeto o null.' };
    const e = ev as Record<string, unknown>;
    if (!esTexto(e.nombre) || !esTexto(e.tipo) || !esTexto(e.base64)) {
      return { ok: false, error: 'evidenciaCierre tiene campos de tipo inválido.' };
    }
    if (e.nombre.length > MAX_LONGITUD_EVIDENCIA_NOMBRE || e.tipo.length > MAX_LONGITUD_EVIDENCIA_TIPO || e.base64.length > MAX_LONGITUD_EVIDENCIA_BASE64) {
      return { ok: false, error: 'evidenciaCierre excede algún límite de tamaño permitido.' };
    }
    fila.evidenciaCierre = { nombre: e.nombre, tipo: e.tipo, base64: e.base64 };
  } else {
    fila.evidenciaCierre = null;
  }

  return { ok: true, fila };
}

function validarFilaExtra(
  estadoRevision: string,
  filaExtraRaw: Record<string, unknown>,
  resultadoTargetBody: unknown,
  usuario: { usuario: string },
  ahoraLegible: string,
): { ok: true; fila: Record<string, unknown>; resultadoEstado: 'Cerrada' | 'Cancelada' } | { ok: false; error: string } {
  const resultadoEstadoEsperado = RESULTADO_ESTADO_POR_ESTADO_REVISION[estadoRevision];
  if (!resultadoEstadoEsperado) {
    return { ok: false, error: `estadoRevision "${estadoRevision}" no es un estado de cierre reconocido.` };
  }
  // Coherencia: el estado de Solicitud que pide el cliente debe coincidir
  // EXACTAMENTE con el que corresponde a este estadoRevision.
  if (resultadoTargetBody != null && String(resultadoTargetBody) !== resultadoEstadoEsperado) {
    return { ok: false, error: `resultadoEstado no es coherente con estadoRevision "${estadoRevision}" (se esperaba "${resultadoEstadoEsperado}").` };
  }

  let validacion: ResultadoValidacionFila;
  switch (estadoRevision) {
    case 'RECHAZADO': validacion = validarRechazado(filaExtraRaw); break;
    case 'CERRADO_ADJUDICADO': validacion = validarCerradoAdjudicado(filaExtraRaw); break;
    case 'CERRADO_NO_ADJUDICADO': validacion = validarCerradoNoAdjudicado(filaExtraRaw); break;
    case 'CANCELADO': validacion = validarCierreDirecto(filaExtraRaw, 'CANCELADO'); break;
    case 'CERRADO_NO_CUMPLIMIENTO': validacion = validarCierreDirecto(filaExtraRaw, 'CERRADO_NO_CUMPLIMIENTO'); break;
    default: return { ok: false, error: `estadoRevision "${estadoRevision}" no es un estado de cierre reconocido.` };
  }
  if (!validacion.ok) return validacion;

  const fila: Record<string, unknown> = { ...validacion.fila };
  // Autoría/tiempo — NUNCA del cliente, siempre reconstruidos en servidor.
  fila.cerradoPor = usuario.usuario;
  fila.gestionadoPor = usuario.usuario;
  fila.fechaCierre = ahoraLegible;
  fila.ultimaActualizacion = ahoraLegible;
  if (estadoRevision === 'RECHAZADO') {
    fila.validadoPor = usuario.usuario;
    fila.fechaValidacion = ahoraLegible;
  }

  return { ok: true, fila, resultadoEstado: resultadoEstadoEsperado };
}

function ahoraLegible(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
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

  let bodyRaw: unknown = {};
  try {
    bodyRaw = await req.json();
  } catch {
    // body vacío es válido — cierre sin motivo/resultado adicional
  }
  if (bodyRaw == null || typeof bodyRaw !== 'object' || Array.isArray(bodyRaw)) {
    return NextResponse.json({ ok: false, error: 'Cuerpo de la petición inválido: se esperaba un objeto.' }, { status: 400 });
  }
  const body = bodyRaw as Record<string, unknown>;

  // Allowlist TOP-LEVEL del body — un cliente desactualizado o manipulado
  // que intente colar `sqrCerrada`, `fechaCierre`, `sqrNumero`, `procesoId`,
  // `asignaciones`, etc. recibe 400 explícito, nunca un 200 que aparente
  // haber procesado esos campos.
  for (const clave of Object.keys(body)) {
    if (!CLAVES_BODY_PERMITIDAS.has(clave)) {
      return NextResponse.json({ ok: false, error: `Campo no permitido en el body: "${clave}".` }, { status: 400 });
    }
  }

  const idAsignacionFila = typeof body.idAsignacion === 'string' && body.idAsignacion.trim() ? body.idAsignacion.trim() : null;
  const filaExtraRaw = (body.filaExtra != null) ? body.filaExtra : null;

  // No se acepta uno sin el otro — un `filaExtra` sin `idAsignacion` no
  // tiene destino, y un `idAsignacion` sin `filaExtra` no trae el
  // `estadoRevision` requerido para validar la matriz de cierre.
  if ((idAsignacionFila == null) !== (filaExtraRaw == null)) {
    return NextResponse.json({ ok: false, error: 'idAsignacion y filaExtra deben enviarse juntos o no enviarse ninguno.' }, { status: 400 });
  }
  if (filaExtraRaw != null && (typeof filaExtraRaw !== 'object' || Array.isArray(filaExtraRaw))) {
    return NextResponse.json({ ok: false, error: 'filaExtra debe ser un objeto.' }, { status: 400 });
  }

  const usuario = await resolverUsuarioSesionActivo(prisma, session!);
  if (!usuario) {
    return NextResponse.json({ ok: false, error: 'Usuario no encontrado o inactivo.' }, { status: 403 });
  }

  const solicitudActual = await prisma.solicitud.findUnique({ where: { id: dbId } });
  if (!solicitudActual) {
    return NextResponse.json({ ok: false, error: 'Solicitud no encontrada.' }, { status: 404 });
  }

  // Ajuste "RECHAZO PRIVADO — DIRECTOR/COORDINADOR COMERCIAL" — la
  // autorización se bifurca EXCLUSIVAMENTE por la rama `estadoRevision`
  // solicitada: si el cliente pide RECHAZADO (rechazo simple o con causal
  // — ambos comparten esta misma lectura de `filaExtra.estadoRevision`,
  // ver `validarRechazado` más abajo), se evalúa `puedeRechazarSolicitud`;
  // para CUALQUIER otro cierre terminal (Adjudicado/No adjudicado/
  // Cancelado/Cerrar sin presentar/etc.) se sigue evaluando
  // `puedeCerrarSolicitud` exactamente como antes. Esto es solo una
  // LECTURA del campo, no una validación completa (esa sigue pasando más
  // abajo, sin cambios) — decidir el helper de autorización correcto es
  // el único propósito de este peek.
  const estadoRevisionPeek = (filaExtraRaw != null && typeof filaExtraRaw === 'object' && !Array.isArray(filaExtraRaw))
    ? (filaExtraRaw as Record<string, unknown>).estadoRevision
    : undefined;
  const esOperacionRechazo = estadoRevisionPeek === 'RECHAZADO';
  // Ajuste "DECISIÓN DE OBSERVACIONES — COMERCIAL RESPONSABLE EN PRIVADOS" —
  // "Observación no aceptada" es un rechazo con
  // `decisionObservaciones:'no_aceptada'`; usa `puedeNoAceptarObservacion`
  // (superconjunto de `puedeRechazarSolicitud`, acotado al responsable y a
  // revisión/observación). El ownership de la fila (más abajo) no cambia.
  const esNoAceptarObservacion = esOperacionRechazo
    && (filaExtraRaw as Record<string, unknown>).decisionObservaciones === 'no_aceptada';

  const auth = esNoAceptarObservacion
    ? puedeNoAceptarObservacion(usuario, solicitudActual)
    : esOperacionRechazo
    ? puedeRechazarSolicitud(usuario, solicitudActual)
    : puedeCerrarSolicitud(usuario, solicitudActual);
  if (!auth.autorizado) {
    const yaEstabaTerminal = ESTADOS_SOLICITUD_TERMINALES.has(solicitudActual.estadoSolicitud);
    return NextResponse.json(
      { ok: false, error: auth.motivo ?? 'No autorizado.' },
      { status: yaEstabaTerminal ? 409 : 403 },
    );
  }

  // Ownership de la fila objetivo: un responsable normal solo puede aplicar
  // `filaExtra` sobre SU PROPIA fila. Un administrador funcional de Procesos
  // (Administrador global, Director Comercial o Coordinador Comercial)
  // puede apuntar a cualquier fila existente (igual que en `/observaciones`).
  //
  // Ajuste "CIERRE DE PRIVADOS PARA MERCADEO — FILA AJENA" — Mercadeo NO es
  // ni pasa a ser `esAdministradorProcesos` (ese concepto sigue siendo
  // EXCLUSIVAMENTE Administrador/Director/Coordinador Comercial, sin
  // cambios: Mercadeo no gana permiso de reasignar, editar observaciones
  // ajenas, ni gestionar una fila ajena por fuera de este cierre). Pero SÍ
  // necesita poder escribir el resultado (Adjudicado/No adjudicado +
  // observación) sobre la fila PRESENTADA de otro responsable, porque el
  // modelo de datos no tiene un "resultado a nivel de Solicitud"
  // independiente de una fila — el diagnóstico previo confirmó que omitir
  // `idAsignacion`/`filaExtra` para Mercadeo perdería silenciosamente el
  // resultado y la observación (rama sin fila, más abajo, no llama a
  // `validarCerradoAdjudicado`/`validarCerradoNoAdjudicado` ni escribe
  // `resultadoFinal`/`causalCierre`).
  //
  // El permiso se acota a la INTERSECCIÓN exacta de 3 condiciones — nunca
  // "Mercadeo puede tocar cualquier fila ajena" en general:
  //  1. `auth.autorizado` ya en `true` (arriba, `puedeCerrarSolicitud`) —
  //     este bloque ni se evalúa si el cierre en sí no fue autorizado.
  //  2. `esProcesoPrivado(solicitudActual)` — para Mercadeo,
  //     `puedeCerrarSolicitud` SOLO autoriza en un Privado (en Público,
  //     Mercadeo queda explícitamente excluido incluso siendo responsable
  //     — ver ese archivo); se revalida aquí explícitamente, nunca se
  //     infiere solo de `esMercadeo(rol) && auth.autorizado`, para que
  //     quede acotado al MISMO caso exacto que ya aprobó el cierre.
  //  3. `esMercadeo(usuario.rol)` — el propio rol.
  if (idAsignacionFila) {
    const asignacionesActuales = Array.isArray(solicitudActual.asignaciones)
      ? (solicitudActual.asignaciones as Record<string, unknown>[])
      : [];
    const filaObjetivoExiste = asignacionesActuales.some((a) => String(a.idAsignacion ?? '') === idAsignacionFila);
    if (!filaObjetivoExiste) {
      return NextResponse.json({ ok: false, error: 'La asignación indicada no existe.' }, { status: 400 });
    }
    const puedeUsarFilaAjenaParaCierre = esAdministradorProcesos(usuario.rol)
      || (esMercadeo(usuario.rol) && auth.autorizado && esProcesoPrivado(solicitudActual));
    if (!puedeUsarFilaAjenaParaCierre) {
      const propia = encontrarAsignacionPropia(asignacionesActuales, usuario);
      if (!propia || String(propia.idAsignacion ?? '') !== idAsignacionFila) {
        return NextResponse.json({ ok: false, error: 'No puedes cerrar usando la asignación de otro responsable.' }, { status: 403 });
      }
    }
  }

  // Validación de la fila (allowlist + coherencia) ANTES de entrar a la
  // transacción — evita hacer el lock de fila si el payload ya es inválido.
  let filaValidada: Record<string, unknown> | null = null;
  let resultadoTarget: string;
  let estadoRevisionSolicitado = '';
  if (idAsignacionFila && filaExtraRaw) {
    estadoRevisionSolicitado = typeof (filaExtraRaw as Record<string, unknown>).estadoRevision === 'string'
      ? (filaExtraRaw as Record<string, unknown>).estadoRevision as string
      : '';
    if (!estadoRevisionSolicitado) {
      return NextResponse.json({ ok: false, error: 'filaExtra.estadoRevision es requerido.' }, { status: 400 });
    }
    const validacion = validarFilaExtra(
      estadoRevisionSolicitado,
      filaExtraRaw as Record<string, unknown>,
      body.resultadoEstado,
      usuario,
      ahoraLegible(),
    );
    if (!validacion.ok) {
      return NextResponse.json({ ok: false, error: validacion.error }, { status: 400 });
    }
    filaValidada = validacion.fila;
    resultadoTarget = validacion.resultadoEstado;
  } else {
    // Cierre sin actualizar ninguna fila (ej. cierre administrativo directo)
    // — el único allowlist que aplica es el de estados terminales.
    resultadoTarget = RESULTADOS_VALIDOS.has(String(body.resultadoEstado ?? '')) ? String(body.resultadoEstado) : 'Cerrada';
  }

  // Ajuste "ESTADO FINAL SQR (booleano)" (confirmado explícitamente) —
  // RECHAZADO/CERRADO_NO_CUMPLIMIENTO/CANCELADO ocurren SIEMPRE antes de
  // presentar → `estadoFinalSqr=false`. CERRADO_ADJUDICADO/
  // CERRADO_NO_ADJUDICADO ocurren DESPUÉS de `estadoFinalSqr=true` — nunca
  // se toca este campo ahí, para NUNCA degradar a `false` una
  // clasificación `true` ya asignada por `ejecutarTransicionEstado` al
  // presentar.
  const esNoPresentado = ESTADOS_REVISION_NO_PRESENTADO.has(estadoRevisionSolicitado);

  // Ajuste "SQR DESACOPLADA DEL CIERRE DEL PROCESO" (confirmado
  // explícitamente, reemplaza el diseño anterior que abortaba el cierre en
  // caso de error externo) — toda transición que termina definitivamente
  // el proceso (RECHAZADO, CERRADO_NO_CUMPLIMIENTO, CANCELADO,
  // CERRADO_ADJUDICADO, CERRADO_NO_ADJUDICADO) intenta dejar resuelta
  // también la SQR asociada SI existe una abierta — pero GrupoColba NUNCA
  // debe impedir que el proceso se cierre. El resultado (éxito, error
  // externo, o conflicto de concurrencia con otro cierre en curso) se
  // persiste igual dentro del motor (`intentarCerrarSqrSiCorresponde`,
  // mismo usado por `PRESENTAR` — nunca una segunda integración con
  // GrupoColba), pero deliberadamente se IGNORA aquí — el cierre del
  // proceso continúa sin importar qué devolvió. Si la SQR ya estaba
  // cerrada o nunca existió, es no-op (cubre también datos históricos/
  // inconsistentes). El error, si lo hay, queda en `sqrError`/
  // `sqrCierreEstado='ERROR'` para diagnóstico interno — nunca se propaga
  // como respuesta de error de esta ruta.
  //
  // Ajuste "TIPO DE CIERRE SQR" §3 — este flujo (NO_PRESENTADO, y también
  // el cierre administrativo directo sin fila) NUNCA exige ni envía
  // evidencia/soporte — a diferencia de `PRESENTAR`. La descripción usa
  // SIEMPRE la observación real que el usuario escribió al rechazar/
  // cancelar/cerrar sin presentar (`obtenerObservacionCierreTerminal`),
  // nunca el código interno del estado — solo si no hay ninguna
  // observación disponible (cierre administrativo sin fila) cae al texto
  // genérico ya existente.
  const gateSqr = await intentarCerrarSqrSiCorresponde({
    db: prisma as unknown as DbCierreSqr,
    solicitudId: dbId,
    actor: { id: usuario.id, usuario: usuario.usuario, email: usuario.email, rol: usuario.rol },
    requestId: req.headers.get('x-request-id') ?? crypto.randomUUID(),
    prepararCierre: (fresh) => {
      const codigoProceso = typeof fresh.codigoProceso === 'string' ? fresh.codigoProceso : null;
      const entidad = typeof fresh.entidad === 'string' ? fresh.entidad : null;
      const observacionUsuario = obtenerObservacionCierreTerminal(filaValidada);
      return {
        ok: true,
        // Ajuste "ESTADO FINAL SQR (booleano)" — señal explícita para el
        // motor: este flujo NUNCA es "presentación", así que NUNCA exige/
        // envía evidencia (ni siquiera en el caso defensivo de
        // CERRADO_ADJUDICADO/CERRADO_NO_ADJUDICADO con SQR legada todavía
        // abierta — la clasificación PERSISTIDA de la Solicitud, abajo, no
        // cambia por esto; es solo la señal para ESTA llamada puntual a
        // GrupoColba).
        estadoFinalSqr: false,
        observacion: observacionUsuario ?? construirRespuestaCierreSqrTerminal({ codigoProceso, entidad }),
      };
    },
  });
  // Solo para trazabilidad del propio AuditLog de este cierre — nunca
  // afecta el resultado HTTP ni el flujo (ver comentario arriba).
  const sqrCierreExternoTrazabilidad = gateSqr.ok ? 'ok_o_no_aplicaba' : 'error_o_conflicto';

  try {
    const estadoAnterior = solicitudActual.estadoSolicitud;

    const resultado = await prisma.$transaction(async (tx) => {
      // Lock de fila + relectura fresca — el `asignaciones` leído antes de
      // entrar a la transacción puede haber quedado desactualizado por una
      // observación concurrente (POST .../observaciones); nunca se arma el
      // arreglo final a partir de esa copia vieja.
      await tx.$queryRaw`SELECT id FROM "Solicitud" WHERE id = ${dbId} FOR UPDATE`;
      const freshSolicitud = await tx.solicitud.findUnique({ where: { id: dbId } });
      if (!freshSolicitud) return { tipo: 'ya_cerrada' as const }; // borrada entre medio — trato conservador

      // NUNCA se escribe `Solicitud.fechaCierre` aquí — ese campo representa
      // la fecha límite/cierre de la CONVOCATORIA externa (sincronizada
      // desde el cronograma del proceso, ver `procesos-sync.ts`), no el
      // cierre de nuestra gestión interna. `resultadoFinal`/`causalCierre`
      // a nivel de Solicitud tampoco se toman del body crudo del cliente —
      // solo se derivan de la fila ya validada contra la allowlist.
      const dataUpdate: Record<string, unknown> = {
        estadoSolicitud: resultadoTarget,
        resultadoFinal: (filaValidada?.resultadoFinal as string | undefined) ?? freshSolicitud.resultadoFinal,
        causalCierre: (filaValidada?.causaNoPresentacion as string | undefined)
          ?? (filaValidada?.motivoRechazo as string | undefined)
          ?? (filaValidada?.causalRechazo as string | undefined)
          ?? (filaValidada?.causaEspecifica as string | undefined)
          ?? freshSolicitud.causalCierre,
        // Ajuste "ESTADO FINAL SQR (booleano)" — solo se escribe para los
        // 3 estados que ocurren ANTES de presentar; CERRADO_ADJUDICADO/
        // CERRADO_NO_ADJUDICADO nunca tocan este campo (conservan lo que
        // ya haya, típicamente `true` escrito por `PRESENTAR`) — así se
        // garantiza que `true` nunca se degrada a `false`.
        ...(esNoPresentado ? { estadoFinalSqr: false } : {}),
        updatedAt: new Date(),
      };

      // Actualizar también la fila del responsable que cierra, dentro del
      // mismo CAS: si el CAS pierde, la fila tampoco se toca.
      if (idAsignacionFila && filaValidada) {
        const asignaciones = Array.isArray(freshSolicitud.asignaciones)
          ? [...(freshSolicitud.asignaciones as Record<string, unknown>[])]
          : [];
        const idx = asignaciones.findIndex((a) => String(a.idAsignacion ?? '') === idAsignacionFila);
        if (idx >= 0) {
          // Solo se copian los campos ya validados (`filaValidada`) sobre la
          // fila EXISTENTE — `idAsignacion`, `analistaAsignado`,
          // `asignadoPor`, `fechaAsignacion` y `observaciones` de esa fila
          // (y de cualquier otra) permanecen intactos porque nunca se
          // sobreescriben: `filaValidada` no contiene esas claves.
          asignaciones[idx] = { ...asignaciones[idx], ...filaValidada };
          dataUpdate.asignaciones = asignaciones as unknown as Prisma.InputJsonValue;
        }
      }

      const cas = await tx.solicitud.updateMany({
        where: { id: dbId, estadoSolicitud: { notIn: Array.from(ESTADOS_SOLICITUD_TERMINALES) } },
        data: dataUpdate,
      });

      if (cas.count === 0) {
        return { tipo: 'ya_cerrada' as const };
      }

      const actualizada = await tx.solicitud.findUnique({ where: { id: dbId } });

      // AuditLog solo se escribe cuando el CAS realmente ganó.
      await tx.auditLog.create({
        data: {
          usuarioId: usuario.id,
          email: usuario.email,
          rol: usuario.rol,
          accion: 'solicitud_cerrar',
          recurso: 'solicitud',
          recursoId: String(dbId),
          metodo: 'POST',
          detalle: {
            solicitudId: dbId,
            cerradoPor: usuario.usuario,
            estadoAnterior,
            estadoNuevo: resultadoTarget,
            fechaCierreGestion: new Date().toISOString(), // registro del cierre interno — NUNCA se escribe en Solicitud.fechaCierre
            sqrCierreExterno: sqrCierreExternoTrazabilidad,
          },
        },
      });

      return { tipo: 'ok' as const, solicitud: actualizada };
    });

    if (resultado.tipo === 'ya_cerrada') {
      return NextResponse.json(
        { ok: false, error: 'La solicitud ya fue cerrada por otro usuario.' },
        { status: 409 },
      );
    }

    return NextResponse.json({
      ok: true,
      solicitud: resultado.solicitud,
      sqrCierreExterno: sqrCierreExternoTrazabilidad,
    });
  } catch (err) {
    // Ajuste "NO EXPONER ERRORES INTERNOS AL USUARIO" (mismo criterio que
    // /api/upload) — `err` aquí puede ser una excepción de Prisma/base de
    // datos u otra interna nunca pensada para el cliente (a diferencia de
    // los `error:` de validación de este mismo archivo, que SÍ son texto
    // controlado y se siguen devolviendo tal cual). Se registra completo
    // solo en servidor; el cliente recibe únicamente un mensaje genérico.
    console.error('[POST /api/solicitudes/[id]/cerrar]', err);
    return NextResponse.json(
      { ok: false, error: 'No fue posible procesar el cierre en este momento. Intenta nuevamente o contacta al administrador.' },
      { status: 500 },
    );
  }
}