/**
 * Servicio de creación de Solicitud + resolución/creación del Proceso
 * canónico asociado (Fase 1 — contención inmediata; Fase 2 — asignación
 * automática centralizada en el backend, ver cierre "IP 026 2026").
 *
 * Extraído de `POST /api/solicitudes` para poder probarlo con un cliente
 * Prisma inyectado (real o mock) sin depender de NextRequest ni de una base
 * de datos real — ver src/lib/solicitudes/crear-solicitud.test.ts.
 *
 * El endpoint (`src/app/api/solicitudes/route.ts`) es un wrapper delgado:
 * parsea el body, RECHAZA explícitamente `asignaciones`/`estadoSolicitud`
 * si el cliente los manda (ya no son parte del contrato de entrada — la
 * decisión de responsable y estado es responsabilidad EXCLUSIVA de este
 * servicio, nunca del frontend), llama a `crearSolicitudConIdentidad`, y
 * traduce `SolicitudIdentidadError` a un 400 HTTP. Toda la lógica vive
 * acá — no debe duplicarse entre el servicio y el endpoint.
 *
 * Todo — resolución de identidad, comprobación de idempotencia, resolución
 * y validación del responsable, creación de Solicitud, construcción de la
 * asignación, fijación del estado, y registro de auditoría — ocurre dentro
 * de UNA sola transacción: si cualquier paso falla, nada queda escrito.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import { normalizarPerfil } from '@/lib/normalizar-perfil';
import {
  resolverIdentidadProceso, buscarOCrearProceso, normalizarEntidad, normalizarCodigoProceso, llaveNegocioValida,
} from '@/lib/proceso-identidad';
import { decidirBackfillLinkProceso } from '@/lib/procesos/decidir-backfill-link-proceso';
import { aliasFuenteDesdeOrigenFuncional } from '@/lib/procesos/ficha-contractual';
import { resolverResponsableInicialPorPerfil } from './responsable-inicial';
import { resolverResponsableElegible } from './validar-responsable';

export type PrismaDb = PrismaClient | Prisma.TransactionClient;

/** Rechazo explícito de identidad — nunca se resuelve "a ciegas" ni se corrige
 * silenciosamente una entidad/proceso contradictorio. El endpoint la traduce a 400. */
export class SolicitudIdentidadError extends Error {}

function str(v: unknown, fb = '') {
  return v != null ? String(v) : fb;
}

function toDate(v: unknown): Date | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T12:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toDecimal(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isNaN(v) ? null : v;
  const limpio = String(v).replace(/[^0-9.-]/g, '');
  const n = Number(limpio);
  return Number.isNaN(n) ? null : n;
}

function normalizarOrigenSolicitud(v: unknown): 'Comercial' | 'Especializada' {
  return str(v).trim() === 'Especializada' ? 'Especializada' : 'Comercial';
}

function fechaHoraLegible(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Contrato de entrada — `asignaciones` y `estadoSolicitud` NUNCA son parte
 * de este tipo: la asignación inicial y el estado son responsabilidad
 * exclusiva del backend (`resolverResponsableInicialPorPerfil` +
 * `resolverResponsableElegible`). Si un cliente los manda, el endpoint
 * (`route.ts`) los rechaza con 400 antes de llegar aquí — nunca se
 * aceptan-y-se-ignoran en silencio. */
export interface InputCrearSolicitud {
  procesoId?: number | string | null;
  externalId?: string | number | null;
  codigoProceso: string;
  nombreProceso?: string | null;
  entidad?: string | null;
  objeto?: string | null;
  fuente?: string | null;
  aliasFuente?: string | null;
  /**
   * Concepto canónico Data API — ver `aliasFuenteDesdeOrigenFuncional`
   * (`ficha-contractual.ts`). Un Proceso creado vía Data API NUNCA trae
   * `aliasFuente` (excluido a propósito del contrato canónico, ver
   * `mapeoCanonico.ts`), así que sin esta señal `aliasFuenteFinal` no tiene
   * forma de distinguir un público sin alias de un privado real.
   */
  origenFuncional?: string | null;
  modalidad?: string | null;
  perfil?: string | null;
  departamento?: string | null;
  estadoFuente?: string | null;
  fechaPublicacion?: unknown;
  fechaVencimiento?: unknown;
  valor?: unknown;
  linkDetalle?: string | null;
  linkSecop?: string | null;
  linkSecopReg?: string | null;
  ciudad?: string | null;
  sede?: string | null;
  plataforma?: string | null;
  origenSolicitud?: unknown;
  nitContacto?: string | null;
  personaContacto?: string | null;
  telefonoContacto?: string | null;
  direccionContacto?: string | null;
  correoContacto?: string | null;
  fechaCierre?: unknown;
  procStep?: number | string | null;
  procData?: unknown;
  obsData?: unknown;
  docData?: unknown;
  revisor?: string | null;
  aprobador?: string | null;
  observacion?: string | null;
  usuarioRegistro?: string | null;
  emailRegistro?: string | null;
  cargoRegistro?: string | null;
  entidadRegistro?: string | null;
}

/**
 * Backfill preventivo Solicitud → Proceso (ver `decidirBackfillLinkProceso`)
 * — evita el patrón detectado en los procesos 8009/7731: una Solicitud con
 * `linkDetalle` válido mientras su Proceso queda vacío para siempre, porque
 * `buscarOCrearProceso` nunca recibe ni persiste ese dato. La Solicitud solo
 * puede COMPLETAR un Proceso.linkDetalle vacío — nunca sobrescribe uno ya
 * existente; ante un link distinto, es CONFLICTO y no se modifica nada.
 *
 * La escritura real es SIEMPRE un `updateMany` condicionado (`WHERE
 * linkDetalle vacío`), nunca un `find → if vacío → update`: eso cierra la
 * ventana de carrera entre dos transacciones concurrentes sobre el mismo
 * Proceso — si `count === 0`, otra ya escribió primero y esta se abstiene
 * sin considerarlo un error. No filtra por prefijo de `sourceKey`
 * (`manual:`/`ext:`) — aplica por igual, la única condición relevante es
 * que el Proceso no tenga aún ningún link.
 */
async function aplicarBackfillLinkProceso(
  tx: PrismaDb,
  params: {
    procesoId: number;
    solicitudId: number;
    solicitudLinkDetalle: string | null | undefined;
    emailRegistro?: string | null;
  }
): Promise<void> {
  const procesoActual = (await tx.proceso.findUnique({
    where: { id: params.procesoId },
    select: { linkDetalle: true },
  })) as { linkDetalle?: string | null } | null;

  const decision = decidirBackfillLinkProceso({
    procesoLinkDetalle: procesoActual?.linkDetalle ?? null,
    solicitudLinkDetalle: params.solicitudLinkDetalle,
  });

  if (decision.accion === 'NO_HACER') return; // idempotente: sin escritura, sin AuditLog (evita ruido).

  if (decision.accion === 'CONFLICTO') {
    await tx.auditLog.create({
      data: {
        email: params.emailRegistro ? str(params.emailRegistro) : null,
        accion: 'backfill_link_manual_desde_solicitud',
        recurso: 'Proceso',
        recursoId: String(params.procesoId),
        detalle: {
          procesoId: params.procesoId,
          solicitudId: params.solicitudId,
          linkAnterior: procesoActual?.linkDetalle ?? null,
          linkNuevo: params.solicitudLinkDetalle,
          motivo: decision.razon,
          resultado: 'CONFLICTO_NO_MODIFICADO',
        },
      },
    });
    return;
  }

  // decision.accion === 'COPIAR' — escritura atómica condicionada, NUNCA un
  // UPDATE incondicional posterior a la lectura de arriba.
  const linkNuevo = String(params.solicitudLinkDetalle ?? '').trim();
  const { count } = await tx.proceso.updateMany({
    where: { id: params.procesoId, OR: [{ linkDetalle: null }, { linkDetalle: '' }] },
    data: { linkDetalle: linkNuevo },
  });

  if (count === 1) {
    await tx.auditLog.create({
      data: {
        email: params.emailRegistro ? str(params.emailRegistro) : null,
        accion: 'backfill_link_manual_desde_solicitud',
        recurso: 'Proceso',
        recursoId: String(params.procesoId),
        detalle: {
          procesoId: params.procesoId,
          solicitudId: params.solicitudId,
          linkAnterior: procesoActual?.linkDetalle ?? null,
          linkNuevo,
          motivo: decision.razon,
          resultado: 'COPIADO',
        },
      },
    });
  }
  // count === 0: otra transacción concurrente ya escribió el link primero
  // — carrera perdida, no un error; no se sobrescribe y no se audita aquí
  // (el ganador de la carrera ya deja su propia auditoría si aplicó).
}

/**
 * Backfill de `codigoProceso` — mismo patrón atómico que
 * `aplicarBackfillLinkProceso`. Cubre procesos privados/ONG sincronizados vía
 * Data API cuya fuente no trae un código de proceso formal (universidades,
 * ONGs, cámaras de comercio, etc. con `estadoFuente='No aplica'`): el Proceso
 * queda con `codigoProceso` NULL hasta que la fuente lo revela más tarde. Un
 * código NULL/vacío NUNCA es un conflicto de identidad — es la ausencia del
 * dato, y se completa. El llamador solo invoca esto cuando ya confirmó que
 * `procesoResuelto.codigoProceso` está vacío; si ya tuviera un código real y
 * distinto, sigue siendo un conflicto genuino y esta función ni se llama.
 *
 * La escritura es SIEMPRE un `updateMany` condicionado (`WHERE codigoProceso
 * vacío`), nunca un UPDATE incondicional: si otra transacción concurrente ya
 * escribió un código primero, esta se abstiene (carrera perdida, no error).
 */
async function aplicarBackfillCodigoProceso(
  tx: PrismaDb,
  params: {
    procesoId: number;
    codigoEntrante: string;
    emailRegistro?: string | null;
  }
): Promise<void> {
  const codigoNuevo = String(params.codigoEntrante).trim();
  if (!codigoNuevo) return;

  const { count } = await tx.proceso.updateMany({
    where: { id: params.procesoId, OR: [{ codigoProceso: null }, { codigoProceso: '' }] },
    data: { codigoProceso: codigoNuevo },
  });

  if (count === 1) {
    await tx.auditLog.create({
      data: {
        email: params.emailRegistro ? str(params.emailRegistro) : null,
        accion: 'backfill_codigo_proceso_desde_solicitud',
        recurso: 'Proceso',
        recursoId: String(params.procesoId),
        detalle: {
          procesoId: params.procesoId,
          codigoNuevo,
          resultado: 'COPIADO',
        },
      },
    });
  }
  // count === 0: otra transacción concurrente ya escribió el código primero
  // — carrera perdida, no un error; no se sobrescribe ni se audita aquí.
}

/**
 * Crea una Solicitud vinculada a un Proceso canónico, resolviendo identidad
 * en el orden obligatorio: procesoId → externalId/sourceKey → llave de
 * negocio (codigoProceso+entidad). Si no hay coincidencia, crea el Proceso
 * (manual o "importado sin sincronizar").
 *
 * Idempotencia: si YA existe una Solicitud para el Proceso resuelto
 * (cualquiera que sea el método de resolución — procesoId, externalId o
 * llave de negocio), se devuelve esa Solicitud existente tal cual, sin
 * crear un duplicado. Una Solicitud eliminada lógicamente (movida a
 * `DeletedSolicitud`) deja de existir en `Solicitud`, así que NO bloquea
 * una futura re-creación legítima del mismo proceso.
 *
 * Responsable: se resuelve con `resolverResponsableInicialPorPerfil()` (regla
 * de negocio pura) y se valida contra la base de datos con
 * `resolverResponsableElegible()` (existe, activo, rol elegible). Si no hay
 * responsable configurado para el perfil, o el configurado no es elegible,
 * la operación se RECHAZA completa — nunca se crea una Solicitud sin
 * responsable ni se inventa un estado intermedio.
 *
 * `db` puede ser el PrismaClient global o un TransactionClient — si se pasa
 * un TransactionClient, la función NO abre una transacción anidada (Prisma
 * no las soporta) y opera directamente sobre él.
 */
export async function crearSolicitudConIdentidad(db: PrismaDb, input: InputCrearSolicitud) {
  if (!input.codigoProceso) {
    throw new SolicitudIdentidadError('codigoProceso es requerido');
  }

  const { codigoProceso, entidad, procesoId } = input;
  // Ajuste "PARIDAD DATA API — FUENTE EN CREACIÓN" — un Proceso Data API
  // nunca trae `aliasFuente` (contrato canónico, ver `mapeoCanonico.ts`),
  // así que sin este fallback CUALQUIER caller que no lo normalice
  // explícitamente (confirmado: varios lugares de `page.tsx` envían
  // `proceso.aliasFuente` crudo, sin pasar por `construirFichaDesdeProceso`)
  // crea la Solicitud como "NC" (privado) aunque el origen real sea
  // público. Defensa en profundidad: esta función NUNCA depende
  // únicamente de que el caller venga bien normalizado — si `aliasFuente`
  // no llegó pero sí `origenFuncional`, se deriva aquí mismo, con la MISMA
  // función que ya usa la ficha de lectura (`aliasFuenteDesdeOrigenFuncional`).
  const aliasFuenteFinal = str(input.aliasFuente) || aliasFuenteDesdeOrigenFuncional(input.origenFuncional) || 'NC';
  const externalIdStr = input.externalId != null ? str(input.externalId).trim() : '';
  const entidadNormalizadaSourceKey = str(entidad).trim().toUpperCase().normalize('NFD').replace(/\p{Mn}/gu, '');
  const procesoSourceKey = externalIdStr
    ? `ext:${externalIdStr}`
    : `mix:${str(codigoProceso).trim()}||${aliasFuenteFinal.toUpperCase()}||${entidadNormalizadaSourceKey}`;
  const plataformaFinal =
    input.plataforma ||
    (aliasFuenteFinal.toUpperCase() === 'S2' ? 'SECOP II' :
     aliasFuenteFinal.toUpperCase() === 'S1' ? 'SECOP I' : '');
  const origenSolicitudFinal = normalizarOrigenSolicitud(input.origenSolicitud);
  const perfilNormalizado = normalizarPerfil(str(input.perfil));

  const ejecutar = async (tx: PrismaDb) => {
    // ── Orden obligatorio: procesoId → externalId/sourceKey → llave de
    // negocio. Nunca se resuelve solo por codigoProceso. Si nada alcanza, se
    // crea un Proceso canónico nuevo — nunca se deja la Solicitud con
    // procesoId=NULL.
    const resultado = await resolverIdentidadProceso(tx, {
      procesoId: procesoId ?? null,
      externalId: externalIdStr || null,
      codigoProceso,
      entidad,
    });

    if (resultado.ambiguo) {
      throw new SolicitudIdentidadError(
        'La llave de negocio (código de proceso + entidad) es ambigua: existe más de un proceso candidato. ' +
        'No se asigna automáticamente — requiere revisión manual antes de crear la Solicitud.'
      );
    }
    if (procesoId && !resultado.proceso) {
      throw new SolicitudIdentidadError(`El procesoId=${procesoId} indicado no existe.`);
    }

    let procesoResuelto = resultado.proceso;

    if (procesoResuelto) {
      // Nunca dejar que un dato de una entidad actualice/asocie el proceso de otra.
      if (entidad && normalizarEntidad(entidad) !== normalizarEntidad(procesoResuelto.entidad)) {
        throw new SolicitudIdentidadError(
          `Inconsistencia de identidad: el proceso resuelto (Proceso.id=${procesoResuelto.id}) pertenece a la entidad ` +
          `"${procesoResuelto.entidad}", pero la Solicitud reporta entidad "${entidad}". No se crea la Solicitud.`
        );
      }
      // Placeholder sintético que `/api/procesos` inventa en lectura
      // (`codigoProceso || nombre || 'PROCESO-<id>'`) cuando NI el código NI
      // el nombre existen — nunca es un dato real de ninguna fuente, así que
      // NUNCA se trata como código entrante (ni conflicto ni backfill): se
      // ignora exactamente como si `codigoProceso` no hubiera llegado.
      const esPlaceholderSinteticoDeEsteProceso = codigoProceso === `PROCESO-${procesoResuelto.id}`;
      // Idem para el código, cuando viene informado y difiere del resuelto.
      // Si el Proceso resuelto YA tiene un código real y distinto, es un
      // conflicto genuino — nunca se pisa. Pero si su código está en
      // NULL/vacío (frecuente en privados/ONG sincronizados vía Data API sin
      // código formal en la fuente, ver `aplicarBackfillCodigoProceso`), NO
      // es un conflicto: es un dato que nunca se capturó, y se completa en
      // vez de bloquear la creación de la Solicitud.
      if (
        codigoProceso && !esPlaceholderSinteticoDeEsteProceso && resultado.metodo !== 'llaveNegocio' &&
        normalizarCodigoProceso(codigoProceso) !== normalizarCodigoProceso(procesoResuelto.codigoProceso)
      ) {
        if (!procesoResuelto.codigoProceso) {
          await aplicarBackfillCodigoProceso(tx, {
            procesoId: procesoResuelto.id,
            codigoEntrante: str(codigoProceso),
            emailRegistro: input.emailRegistro,
          });
        } else {
          throw new SolicitudIdentidadError(
            `Inconsistencia de identidad: el proceso resuelto (Proceso.id=${procesoResuelto.id}) tiene código ` +
            `"${procesoResuelto.codigoProceso}", pero la Solicitud reporta código "${codigoProceso}". No se crea la Solicitud.`
          );
        }
      }
    } else {
      // No hubo coincidencia por procesoId, externalId ni llave de negocio
      // existente → crear el Proceso canónico (manual, o importado que
      // todavía no tenía fila propia en Proceso).
      if (!llaveNegocioValida(codigoProceso, entidad)) {
        throw new SolicitudIdentidadError(
          'No existen datos suficientes (codigoProceso + entidad) para identificar el proceso de forma segura.'
        );
      }
      const creado = await buscarOCrearProceso(tx, {
        codigoProceso: str(codigoProceso),
        entidad: str(entidad),
        objeto: str(input.objeto) || null,
        nombreProceso: str(input.nombreProceso) || null,
        aliasFuente: aliasFuenteFinal,
        externalId: externalIdStr || null,
      });
      procesoResuelto = creado.proceso;
    }

    // ── Idempotencia: si ya existe una Solicitud ACTIVA para este Proceso
    // (por su procesoId ya resuelto — nunca solo por codigoProceso), se
    // reutiliza tal cual, sin crear un duplicado. Una Solicitud eliminada
    // lógicamente ya no existe en esta tabla (fue movida a
    // DeletedSolicitud), así que nunca bloquea una re-creación legítima.
    const solicitudExistente = await tx.solicitud.findFirst({ where: { procesoId: procesoResuelto.id } });
    if (solicitudExistente) {
      // Ajuste "BACKFILL PREVENTIVO SOLICITUD → PROCESO": aunque esta
      // llamada no crea nada nuevo (reutiliza la Solicitud existente), el
      // Proceso puede seguir sin linkDetalle si esa Solicitud ya lo tenía
      // desde antes de que existiera este mecanismo — se corrige aquí,
      // ANTES del return temprano, para no dejarlo huérfano indefinidamente.
      await aplicarBackfillLinkProceso(tx, {
        procesoId: procesoResuelto.id,
        solicitudId: solicitudExistente.id as number,
        solicitudLinkDetalle: (solicitudExistente as { linkDetalle?: string | null }).linkDetalle,
        emailRegistro: input.emailRegistro,
      });
      await tx.auditLog.create({
        data: {
          email: input.emailRegistro ? str(input.emailRegistro) : null,
          accion: 'solicitud_create_idempotent_reuse',
          recurso: 'solicitud',
          recursoId: String(solicitudExistente.id),
          metodo: 'POST',
          detalle: {
            procesoId: procesoResuelto.id,
            motivo: 'Ya existía una Solicitud activa para este Proceso — no se crea un duplicado.',
          },
        },
      });
      return solicitudExistente;
    }

    // ── Resolución del responsable — EXCLUSIVA del backend. Si no hay
    // regla para el perfil, o el usuario configurado no es real/activo/
    // elegible, la creación se rechaza completa (rollback de todo lo
    // hecho arriba, incluido un Proceso manual recién creado).
    const usernamePropuesto = resolverResponsableInicialPorPerfil(perfilNormalizado);
    if (!usernamePropuesto) {
      throw new SolicitudIdentidadError(
        `No hay responsable configurado para el perfil "${perfilNormalizado || '(sin perfil)'}" — no se crea la Solicitud.`
      );
    }
    const responsable = await resolverResponsableElegible(tx, usernamePropuesto);
    if (!responsable) {
      throw new SolicitudIdentidadError(
        `El responsable configurado ("${usernamePropuesto}") para el perfil "${perfilNormalizado}" no existe, ` +
        'no está activo, o no tiene un rol habilitado para gestión comercial. No se crea la Solicitud.'
      );
    }

    const ahora = new Date();
    const fechaAsignacion = fechaHoraLegible(ahora);
    const asignacionInicial = {
      idAsignacion: 'ASG-01',
      solicitudId: 0,
      solicitudNum: 0,
      analistaAsignado: responsable.usuario,
      analistaCargo: responsable.cargo,
      analistaEntidad: responsable.entidadGrupo,
      asignadoPor: str(input.usuarioRegistro),
      asignadoPorCargo: str(input.cargoRegistro),
      fechaAsignacion,
      estadoAsignacion: 'Pendiente',
      estadoBandeja: 'pendiente',
      estadoRevision: 'ASIGNADO_REVISION',
      entidad: str(entidad),
      codigoProceso: str(codigoProceso),
      objeto: str(input.objeto),
      valor: toDecimal(input.valor),
      modalidad: str(input.modalidad),
      ciudad: str(input.ciudad) || str(input.departamento),
      perfil: perfilNormalizado,
      fechaVencimiento: toDate(input.fechaVencimiento),
      observacion: '',
    };

    const nuevaSolicitud = await tx.solicitud.create({
      data: {
        procesoId: procesoResuelto.id,
        procesoSourceKey,
        externalId: input.externalId != null ? str(input.externalId) : null,
        codigoProceso: str(codigoProceso),
        nombreProceso: str(input.nombreProceso),
        entidad: str(entidad),
        objeto: str(input.objeto),
        fuente: str(input.fuente),
        aliasFuente: aliasFuenteFinal,
        modalidad: str(input.modalidad),
        perfil: perfilNormalizado,
        departamento: str(input.departamento),
        estadoFuente: str(input.estadoFuente),
        fechaPublicacion: toDate(input.fechaPublicacion),
        fechaVencimiento: toDate(input.fechaVencimiento),
        valor: toDecimal(input.valor),
        linkDetalle: str(input.linkDetalle),
        linkSecop: str(input.linkSecop),
        linkSecopReg: str(input.linkSecopReg),
        ciudad: str(input.ciudad) || str(input.departamento).split(':').pop()?.trim() || '',
        sede: str(input.sede),
        plataforma: plataformaFinal,
        origenSolicitud: origenSolicitudFinal,
        nitContacto: str(input.nitContacto) || null,
        personaContacto: str(input.personaContacto) || null,
        telefonoContacto: str(input.telefonoContacto) || null,
        direccionContacto: str(input.direccionContacto) || null,
        correoContacto: str(input.correoContacto) || null,
        fechaCierre: toDate(input.fechaCierre),
        procStep: input.procStep != null ? Number(input.procStep) : 0,
        procData: input.procData ?? {},
        obsData: input.obsData ?? [],
        docData: input.docData ?? [],
        asignaciones: [asignacionInicial],
        revisor: str(input.revisor),
        aprobador: str(input.aprobador),
        estadoSolicitud: 'Asignado para revisión',
        observacion: input.observacion ? str(input.observacion) : null,
        usuarioRegistro: str(input.usuarioRegistro),
        emailRegistro: str(input.emailRegistro),
        cargoRegistro: str(input.cargoRegistro),
        entidadRegistro: str(input.entidadRegistro),
        sqrNumero: null,
        sqrCreada: false,
        sqrCerrada: false,
        sqrError: null,
        fechaAperturaSqr: null,
        fechaCierreSqr: null,
        resultadoFinal: null,
        causalCierre: null,
      },
    });

    // ── Auditoría — dentro de la misma transacción: si esto falla, la
    // Solicitud recién creada también se revierte (no queda un cambio
    // parcial sin trazabilidad).
    await tx.auditLog.create({
      data: {
        email: input.emailRegistro ? str(input.emailRegistro) : null,
        accion: 'solicitud_create',
        recurso: 'solicitud',
        recursoId: String(nuevaSolicitud.id),
        metodo: 'POST',
        detalle: {
          procesoId: procesoResuelto.id,
          estadoAnterior: null,
          estadoNuevo: 'Asignado para revisión',
          responsablesAnteriores: [],
          responsablesNuevos: [responsable.usuario],
          motivo: 'Creación de solicitud con asignación automática por perfil.',
        },
      },
    });

    // Ajuste "BACKFILL PREVENTIVO SOLICITUD → PROCESO" — ver
    // aplicarBackfillLinkProceso. Cubre tanto el Proceso recién creado
    // (rama buscarOCrearProceso, que nunca recibe linkDetalle) como un
    // Proceso ya existente que aún no tenía link.
    await aplicarBackfillLinkProceso(tx, {
      procesoId: procesoResuelto.id,
      solicitudId: nuevaSolicitud.id as number,
      solicitudLinkDetalle: input.linkDetalle,
      emailRegistro: input.emailRegistro,
    });

    return nuevaSolicitud;
  };

  // Si `db` ya es un TransactionClient (nos lo pasó un caller que ya está
  // dentro de una transacción, ej. las pruebas), no abrimos otra — Prisma no
  // soporta transacciones anidadas. Se detecta por la ausencia de `$transaction`.
  if ('$transaction' in db) {
    return db.$transaction(ejecutar);
  }
  return ejecutar(db);
}