/**
 * Ajuste "BLOQUE 1B — CONTRATO ÚNICO DE DATOS PARA LAS FICHAS" — módulo puro,
 * sin fetch, único punto de construcción de la información CONTRACTUAL (no
 * de negocio de Solicitudes) mostrada por las 3 fichas: Búsqueda, Procesos y
 * Solicitudes.
 *
 * Origen: las fichas de Búsqueda y Procesos construían, cada una por
 * separado, un objeto sintético casi idéntico a partir de `LiciProceso`
 * (`page.tsx`, dos copias literales del mismo mapeo campo por campo) — mismo
 * patrón de duplicación que ya se corrigió en backend para
 * `calcularYValidarEstadoFinal` (ver diagnóstico del módulo Solicitudes,
 * Fase 1). Este módulo reemplaza esas dos copias por una única fuente.
 *
 * Ajuste "BLOQUE 1B.1 — PARIDAD CONTRACTUAL Y FUENTE CANÓNICA" — se midió
 * (solo lectura, las 122 Solicitudes activas con procesoId contra su
 * Proceso real) que "Solicitud es la fuente autoritativa una vez existe" es
 * **falso en general** y **peligroso para 3 registros concretos** (ids 140,
 * 11, 173): su `procesoId` apunta a un `Proceso` de OTRA entidad que
 * comparte el mismo `codigoProceso` — el mismo patrón de bug ya documentado
 * en `resolver-proceso-ficha.ts` (identidad no validada). Si este módulo
 * hubiera preferido "Proceso vigente" para entidad/objeto/externalId sin
 * validar coherencia, habría mostrado la entidad equivocada. Por eso la
 * fuente canónica por campo se decide así:
 *
 * - Campos de IDENTIDAD (entidad, numeroProceso, objeto): se usa el Proceso
 *   vigente SOLO si su identidad es COHERENTE con la Solicitud (mismo
 *   externalId, o misma llave de negocio código+entidad — reutilizando
 *   `construirLlaveNegocio`, el mismo helper que ya usa
 *   `resolver-proceso-ficha.ts` para este problema). Si es incoherente,
 *   NUNCA se usa ese Proceso para estos campos — se usa la Solicitud (lo
 *   que realmente se gestionó) y no se oculta el desacuerdo:
 *   `origenContrato` queda en `SOLICITUD_SIN_PROCESO`.
 * - Campos SINCRONIZABLES (modalidad, departamento, ciudad, presupuesto,
 *   fechaPublicacion, fechaVencimiento, estadoExterno, linkDetalle,
 *   cronograma, documentos): se prefiere Proceso vigente cuando existe y es
 *   coherente, con reserva a Solicitud si el Proceso tiene el campo en
 *   `null` — medido: 19 de 122 Solicitudes vinculadas son de origen NC
 *   (`aliasFuente:'NC'`, `fuente:'Manual'`) cuyo `Proceso` es un registro
 *   mínimo creado al vuelo (`buscarOCrearProceso`) sin estos campos —
 *   confiar ciegamente en "Proceso vigente" habría vaciado la ficha para
 *   esos 19 casos reales.
 * - Campos INTERNOS DE SOLICITUD (perfil comercial, plataforma de recepción,
 *   fechaCierreOriginal, procesoSourceKey): SIEMPRE de la Solicitud —
 *   `Proceso` no tiene un campo equivalente real (`Solicitud.plataforma`,
 *   p.ej., describe el canal de recepción — "Línea telefónica", "WhatsApp"
 *   — no existe en `Proceso` en absoluto; compararlo contra
 *   `Proceso.aliasFuente` en la medición inicial de este bloque fue un error
 *   de comparación, corregido aquí, no una divergencia real de datos).
 *
 * Alcance deliberadamente NO incluido aquí (pertenece a la capa de
 * Solicitudes, nunca a la ficha contractual base): estadoSolicitud,
 * estadoRevision, asignaciones, responsables, observaciones, evidencias,
 * auditoría, resultado de cierre, permisos, botones.
 */

import { resolverFechaLimiteContractual, type FuenteFechaLimiteContractual } from '@/lib/fechas';
import { construirLlaveNegocio, llaveNegocioValida } from '@/lib/proceso-identidad';

/**
 * Ajuste "PARIDAD DATA API — FUENTE" — `Proceso.aliasFuente` NUNCA se
 * escribe para filas creadas por la Data API (`mapeoCanonico.ts`: "Nunca
 * mapea: externalId, aliasFuente, fuente, rawJson" — el contrato canónico
 * deliberadamente no expone ese concepto de proveedor). Sin este fallback,
 * todo Proceso Data-API con `aliasFuente = null` caía en "Contrato privado"
 * aunque `origenFuncional` diga PUBLICO_ABIERTO/PUBLICO_REGISTRADO — caso
 * real: CP-019-JNCI-2026 (externalId 12055133, Secop II en el origen,
 * mostrado como "Contrato privado" en Búsqueda).
 *
 * Mapeo (nomenclatura SECOP): PUBLICO_REGISTRADO = exige registro previo del
 * proveedor para participar (Secop II, plataforma transaccional) → 'S2';
 * PUBLICO_ABIERTO = publicación de consulta abierta (Secop I,
 * contratos.gov.co) → 'S1'. PRIVADO/MANUAL/DESCONOCIDO no tienen equivalente
 * de alias SECOP — se dejan sin alias (la ficha sigue mostrando "Contrato
 * privado"/genérico, que sí es correcto para esos orígenes).
 *
 * Este mapeo estuvo INVERTIDO hasta que se verificó contra la base: los dos
 * procesos Secop II de referencia (CP-019-JNCI-2026 y LP-004-2026) tienen
 * ambos `origenFuncional = PUBLICO_REGISTRADO`. Nunca se cambie sin
 * contrastar `origenFuncional` contra el dominio real de `linkDetalle`
 * (contratos.gov.co = Secop I, secop.gov.co = Secop II).
 */
export function aliasFuenteDesdeOrigenFuncional(origenFuncional: string | null | undefined): string | null {
  if (origenFuncional === 'PUBLICO_REGISTRADO') return 'S2';
  if (origenFuncional === 'PUBLICO_ABIERTO') return 'S1';
  return null;
}

// ─── Tipos del contrato ─────────────────────────────────────────────────────

export type OrigenFechaLimite = 'FECHA_CIERRE' | 'FECHA_VENCIMIENTO' | 'SIN_FECHA';

export type ContextoFicha = 'BUSQUEDA' | 'PROCESOS' | 'SOLICITUDES';

/**
 * Trazabilidad de alto nivel de dónde salió la ficha contractual completa.
 * `SOLICITUD_SIN_PROCESO` cubre tanto "no hay procesoId" (Solicitud manual)
 * como "hay procesoId pero el Proceso no llegó, o llegó pero es incoherente
 * con la identidad de la Solicitud" — en los tres casos la regla es la
 * misma: no hay un Proceso en el que se pueda confiar para esta ficha.
 */
export type OrigenContrato = 'PROCESO_VIGENTE' | 'SOLICITUD_MANUAL' | 'SOLICITUD_SIN_PROCESO';

/**
 * Disponibilidad de una sección que este módulo NUNCA resuelve por su
 * cuenta (cronograma/documentos/adendas/ganador) — distingue "no venía en
 * el input" de "vino explícitamente vacío", sin inferir "no encontrado"
 * (este constructor síncrono no tiene forma de saber si alguien ya intentó
 * cargarlo y falló — eso pertenece a la capa que sí hace fetch).
 */
export type EstadoDatoFicha = 'DISPONIBLE' | 'NO_CARGADO' | 'NO_ENCONTRADO' | 'NO_APLICA';

/**
 * Un cronograma/documento se transporta tal cual llega de la fuente que ya
 * los tenía cargados (nunca se resuelven aquí) — se tipa como `unknown[]`
 * deliberadamente: este módulo no interpreta su contenido.
 */
export interface FichaContractualBase {
  id: number | string;
  procesoId: number | null;
  externalId: string | null;
  procesoSourceKey: string | null;

  origenContrato: OrigenContrato;

  entidad: string | null;
  numeroProceso: string | null;
  nombre: string | null;
  objeto: string | null;

  empresaPerfil: string | null;
  fuente: string | null;
  aliasFuente: string | null;
  modalidad: string | null;
  plataforma: string | null;

  /** `number` — verificado empíricamente (Bloque 1B.1): máximo real en BD ≈78.827.808.744, sin decimales, columna `Float` en Prisma (nunca Decimal/BigInt) — muy por debajo de `Number.MAX_SAFE_INTEGER`. Si una fuente externa futura entregara un string decimal no representable sin pérdida, este campo debe pasar a `number | string` — no es el caso hoy. */
  presupuesto: number | null;
  moneda: string | null;

  departamento: string | null;
  ciudad: string | null;
  ubicacion: string | null;

  fechaPublicacion: string | Date | null;
  /** Snapshot interno — fijado una sola vez al crear la Solicitud, nunca resincronizado (ver `crear-solicitud.ts:321`). `null` cuando no existe Solicitud. */
  fechaCierreOriginal: string | Date | null;
  /** Dato externo vigente — sincronizado continuamente desde SECOP (`procesos-sync.ts`). */
  fechaVencimientoVigente: string | Date | null;
  /** Valor único a mostrar en UI — nunca recalcular la prioridad fuera de este módulo. */
  fechaLimiteMostrada: string | Date | null;
  /** Cuál de los dos campos originales produjo `fechaLimiteMostrada`. */
  origenFechaLimite: OrigenFechaLimite;

  estadoExterno: string | null;

  cronograma: unknown[] | null;
  estadoCronograma: EstadoDatoFicha;
  documentos: unknown[] | null;
  estadoDocumentos: EstadoDatoFicha;
  adendas: unknown[] | null;
  estadoAdendas: EstadoDatoFicha;
  ganador: unknown;

  linkDetalle: string | null;
}

// ─── Normalización segura (sin pérdida de información original) ───────────

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * §15 — no aceptar como `linkDetalle` útil una URL absoluta que solo apunte a
 * un host sin ninguna ruta ni consulta (p.ej. el homepage de un portal): no
 * lleva al detalle de nada. Los enlaces con path/consulta (SECOP y demás) se
 * conservan intactos.
 */
function linkDetalleUtil(v: unknown): string | null {
  const s = strOrNull(v);
  if (!s) return null;
  try {
    const url = new URL(s);
    const soloHostSinRuta =
      (url.pathname === '' || url.pathname === '/') && !url.search && !url.hash;
    if (soloHostSinRuta) return null;
  } catch {
    // No es una URL absoluta parseable (p.ej. ruta relativa) — se conserva
    // tal cual, no es el caso que esta regla debe filtrar.
  }
  return s;
}

function resolverOrigenFechaLimite(entrada: FuenteFechaLimiteContractual): OrigenFechaLimite {
  if (entrada.fechaCierre) return 'FECHA_CIERRE';
  if (entrada.fechaVencimiento) return 'FECHA_VENCIMIENTO';
  return 'SIN_FECHA';
}

/** `undefined` (la clave nunca llegó en el input) → NO_CARGADO. `null`/arreglo (incluido vacío) → DISPONIBLE. Nunca produce NO_ENCONTRADO desde aquí — ver docstring de `EstadoDatoFicha`. */
function estadoDeSeccion(v: unknown[] | null | undefined): EstadoDatoFicha {
  return v === undefined ? 'NO_CARGADO' : 'DISPONIBLE';
}

// ─── Entradas mínimas aceptadas por cada constructor ───────────────────────

export interface ProcesoParaFicha {
  id: number | string;
  _dbId?: number | string | null;
  procesoId?: number | string | null;
  externalId?: string | null;
  codigoProceso?: string | null;
  nombre?: string | null;
  entidad?: string | null;
  objeto?: string | null;
  perfil?: string | null;
  fuente?: string | null;
  aliasFuente?: string | null;
  /** Concepto canónico Data API — ver `aliasFuenteDesdeOrigenFuncional`. */
  origenFuncional?: string | null;
  modalidad?: string | null;
  plataforma?: string | null;
  valor?: number | null;
  departamento?: string | null;
  ciudad?: string | null;
  estado?: string | null;
  fechaPublicacion?: string | Date | null;
  fechaVencimiento?: string | Date | null;
  linkDetalle?: string | null;
  cronogramas?: unknown[] | null;
  documentos?: unknown[] | null;
}

export interface SolicitudParaFicha {
  id: number | string;
  procesoId?: number | string | null;
  externalId?: string | null;
  procesoSourceKey?: string | null;
  codigoProceso?: string | null;
  nombreProceso?: string | null;
  entidad?: string | null;
  objeto?: string | null;
  perfil?: string | null;
  fuente?: string | null;
  aliasFuente?: string | null;
  modalidad?: string | null;
  plataforma?: string | null;
  valor?: number | null;
  departamento?: string | null;
  ciudad?: string | null;
  estadoFuente?: string | null;
  fechaPublicacion?: string | Date | null;
  fechaCierre?: string | Date | null;
  fechaVencimiento?: string | Date | null;
  linkDetalle?: string | null;
  /** Solo se transporta si ya llegó cargado — nunca se dispara un fetch para completarlo. */
  docData?: unknown[] | null;
}

function aIdProceso(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * §5/Bloque 1B.1 — coherencia de identidad entre una Solicitud y el Proceso
 * al que apunta su `procesoId`, ANTES de confiar en ese Proceso para
 * cualquier campo. Mismo criterio que `resolverProcesoIdParaFicha`
 * (`resolver-proceso-ficha.ts`): externalId si ambos lo tienen, si no llave
 * de negocio código+entidad. Sin datos suficientes para comparar → se
 * considera coherente (no hay evidencia de contradicción; comportamiento
 * conservador, igual que el helper que ya usa la resolución de Proceso para
 * cronograma/documentos).
 */
function procesoEsCoherenteConSolicitud(
  solicitud: Pick<SolicitudParaFicha, 'externalId' | 'codigoProceso' | 'entidad'>,
  proceso: Pick<ProcesoParaFicha, 'externalId' | 'codigoProceso' | 'entidad'>,
): boolean {
  const extSol = strOrNull(solicitud.externalId);
  const extProc = strOrNull(proceso.externalId);
  if (extSol && extProc) return extSol === extProc;

  if (llaveNegocioValida(solicitud.codigoProceso, solicitud.entidad) && llaveNegocioValida(proceso.codigoProceso, proceso.entidad)) {
    return construirLlaveNegocio(solicitud.codigoProceso, solicitud.entidad) === construirLlaveNegocio(proceso.codigoProceso, proceso.entidad);
  }
  return true; // sin evidencia de contradicción.
}

// ─── Constructores explícitos (campo por campo, nunca spread) ─────────────

/**
 * Construye la ficha contractual desde un `Proceso` (contexto Búsqueda o
 * Procesos — antes de que exista una Solicitud). `id` se usa tal cual llega
 * (ver nota histórica en `LiciProceso._dbId` de `page.tsx`: el campo `id` de
 * ese tipo puede contener el `externalId`, no el `Proceso.id` real — este
 * constructor prioriza `_dbId`/`procesoId` para `procesoId`, nunca `id` a
 * ciegas).
 */
export function construirFichaDesdeProceso(proceso: ProcesoParaFicha): FichaContractualBase {
  const procesoId = aIdProceso(proceso._dbId ?? proceso.procesoId ?? null);
  const fechas: FuenteFechaLimiteContractual = {
    fechaCierre: null, // un Proceso sin Solicitud no tiene snapshot interno todavía.
    fechaVencimiento: proceso.fechaVencimiento ?? null,
  };

  return {
    id: proceso.id,
    procesoId,
    externalId: strOrNull(proceso.externalId),
    procesoSourceKey: null, // solo existe una vez que se crea la Solicitud.

    origenContrato: 'PROCESO_VIGENTE',

    entidad: strOrNull(proceso.entidad),
    numeroProceso: strOrNull(proceso.codigoProceso),
    nombre: strOrNull(proceso.nombre),
    objeto: strOrNull(proceso.objeto),

    empresaPerfil: strOrNull(proceso.perfil),
    fuente: strOrNull(proceso.fuente),
    aliasFuente: strOrNull(proceso.aliasFuente) ?? aliasFuenteDesdeOrigenFuncional(proceso.origenFuncional),
    modalidad: strOrNull(proceso.modalidad),
    plataforma: null, // "plataforma de recepción" es un concepto exclusivo de Solicitud — no existe todavía sin Solicitud.

    presupuesto: numOrNull(proceso.valor),
    moneda: null, // no existe un campo de moneda separado en el modelo actual — siempre COP implícito, no se inventa un valor.

    departamento: strOrNull(proceso.departamento),
    ciudad: strOrNull(proceso.ciudad),
    ubicacion: strOrNull(proceso.departamento), // única fuente de ubicación disponible en LiciProceso hoy.

    fechaPublicacion: proceso.fechaPublicacion ?? null,
    fechaCierreOriginal: fechas.fechaCierre ?? null,
    fechaVencimientoVigente: fechas.fechaVencimiento ?? null,
    fechaLimiteMostrada: resolverFechaLimiteContractual(fechas),
    origenFechaLimite: resolverOrigenFechaLimite(fechas),

    estadoExterno: strOrNull(proceso.estado),

    cronograma: proceso.cronogramas ?? null,
    estadoCronograma: estadoDeSeccion(proceso.cronogramas),
    documentos: proceso.documentos ?? null,
    estadoDocumentos: estadoDeSeccion(proceso.documentos),
    adendas: null,
    estadoAdendas: 'NO_CARGADO', // no viaja en LiciProceso — se carga aparte (`/api/procesos/{id}/adendas`), fuera de alcance de un constructor puro sin fetch.
    ganador: null,

    linkDetalle: linkDetalleUtil(proceso.linkDetalle),
  };
}

/**
 * Construye la ficha contractual desde una `Solicitud`. Ver la nota de
 * cabecera del módulo (Bloque 1B.1) para la regla completa de fuente
 * canónica por campo — resumen: identidad (entidad/objeto/numeroProceso/
 * externalId) nunca se toma de `procesoOpcional` salvo que su identidad sea
 * coherente con la propia Solicitud; campos sincronizables prefieren
 * `procesoOpcional` cuando es coherente y no es `null`, con reserva a la
 * Solicitud; campos internos (perfil, plataforma, fechaCierreOriginal,
 * procesoSourceKey) siempre vienen de la Solicitud.
 */
export function construirFichaDesdeSolicitud(
  solicitud: SolicitudParaFicha,
  procesoOpcional?: ProcesoParaFicha | null,
): FichaContractualBase {
  const procesoId = aIdProceso(solicitud.procesoId ?? procesoOpcional?._dbId ?? procesoOpcional?.procesoId ?? null);

  const hayProceso = !!procesoOpcional;
  const procesoConfiable = hayProceso && procesoEsCoherenteConSolicitud(solicitud, procesoOpcional!);

  let origenContrato: OrigenContrato;
  if (procesoConfiable) origenContrato = 'PROCESO_VIGENTE';
  else if (!procesoId) origenContrato = 'SOLICITUD_MANUAL';
  else origenContrato = 'SOLICITUD_SIN_PROCESO'; // procesoId existe pero el Proceso no llegó, o llegó incoherente.

  const p = procesoConfiable ? procesoOpcional! : null;

  const fechas: FuenteFechaLimiteContractual = {
    fechaCierre: solicitud.fechaCierre ?? null,
    fechaVencimiento: solicitud.fechaVencimiento ?? p?.fechaVencimiento ?? null,
  };

  return {
    id: solicitud.id,
    procesoId,
    // externalId: la Solicitud manda si lo tiene (el Proceso confiable ya
    // coincide con él por construcción — la coherencia se validó arriba —
    // así que el orden no cambia el resultado en el caso confiable; en el
    // caso incoherente `p` ya es `null`, así que nunca llega el externalId
    // del Proceso equivocado, ver casos 140/11/173).
    externalId: strOrNull(solicitud.externalId ?? p?.externalId),
    procesoSourceKey: strOrNull(solicitud.procesoSourceKey),

    origenContrato,

    // entidad/numeroProceso/objeto: PROCESO_VIGENTE cuando `p` es confiable
    // (ya validado arriba — nunca es el Proceso incoherente de los casos
    // 140/11/173), con reserva a la Solicitud si el Proceso no lo trae.
    // Cuando `p` es null (incoherente o inexistente) esto ya cae
    // íntegramente en la Solicitud, que es la protección real.
    entidad: strOrNull(p?.entidad ?? solicitud.entidad),
    numeroProceso: strOrNull(p?.codigoProceso ?? solicitud.codigoProceso),
    nombre: strOrNull(solicitud.nombreProceso ?? p?.nombre),
    objeto: strOrNull(p?.objeto ?? solicitud.objeto),

    // Interno de Solicitud — nunca del Proceso salvo que la Solicitud no lo tenga.
    empresaPerfil: strOrNull(solicitud.perfil ?? p?.perfil),
    // Sincronizable — Proceso confiable manda si trae valor, si no cae a Solicitud.
    fuente: strOrNull(p?.fuente ?? solicitud.fuente),
    aliasFuente:
      strOrNull(p?.aliasFuente ?? solicitud.aliasFuente) ??
      (p ? aliasFuenteDesdeOrigenFuncional(p.origenFuncional) : null),
    modalidad: strOrNull(p?.modalidad ?? solicitud.modalidad),
    // Plataforma de RECEPCIÓN (canal comercial) — concepto exclusivo de
    // Solicitud, Proceso no tiene equivalente real. Nunca se lee de `p`.
    plataforma: strOrNull(solicitud.plataforma),

    presupuesto: numOrNull(p?.valor ?? solicitud.valor),
    moneda: null,

    departamento: strOrNull(p?.departamento ?? solicitud.departamento),
    ciudad: strOrNull(solicitud.ciudad ?? p?.ciudad),
    ubicacion: strOrNull(solicitud.ciudad ?? p?.departamento ?? solicitud.departamento),

    fechaPublicacion: solicitud.fechaPublicacion ?? p?.fechaPublicacion ?? null,
    // Siempre de la Solicitud — es exactamente el snapshot que este campo representa.
    fechaCierreOriginal: fechas.fechaCierre ?? null,
    fechaVencimientoVigente: fechas.fechaVencimiento ?? null,
    fechaLimiteMostrada: resolverFechaLimiteContractual(fechas),
    origenFechaLimite: resolverOrigenFechaLimite(fechas),

    estadoExterno: strOrNull(p?.estado ?? solicitud.estadoFuente),

    cronograma: p?.cronogramas ?? null,
    estadoCronograma: estadoDeSeccion(p?.cronogramas),
    documentos: (solicitud.docData as unknown[] | undefined) ?? p?.documentos ?? null,
    estadoDocumentos: estadoDeSeccion((solicitud.docData as unknown[] | undefined) ?? p?.documentos),
    adendas: null,
    estadoAdendas: hayProceso ? 'NO_CARGADO' : 'NO_APLICA', // sin Proceso, el concepto de adendas no aplica todavía.
    ganador: null,

    linkDetalle: linkDetalleUtil(p?.linkDetalle ?? solicitud.linkDetalle),
  };
}