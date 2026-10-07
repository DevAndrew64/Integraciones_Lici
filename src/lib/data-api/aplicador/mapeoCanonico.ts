/**
 * FASE B.3A — mapeo puro (sin efectos) de canónico → forma de escritura
 * Prisma. Reutiliza al máximo las columnas EXISTENTES de `Proceso` (ver
 * propuesta de delta de schema en el Postcheck de B.3A) — nunca inventa
 * columnas nuevas fuera de las explícitamente propuestas.
 *
 * Nunca mapea: externalId, aliasFuente, fuente, rawJson — estos campos NO
 * existen en el contrato canónico (rawJson explícitamente prohibido de
 * cruzar la frontera) y por lo tanto nunca aparecen aquí.
 */
import type { ProcesoCanonico, DocumentoCanonico, EventoCronogramaCanonico } from '../tipos';

const PREFIJO_MANUAL = 'local:';

export function esSourceKeyManual(sourceKey: string): boolean {
  return sourceKey.startsWith(PREFIJO_MANUAL);
}

/**
 * Datos de creación para un Proceso nuevo proveniente de la Data API. Nunca
 * incluye `oculto` (queda en su default de schema). `disponibleDataApi` se
 * fija explícitamente en `true` aquí — el default de schema es `false`
 * (un proceso nunca visto por la Data API nunca debe aparecer como
 * "disponible en la Data API" solo por existir; ver nota en el delta de
 * schema de B.3).
 */
export function datosCreacionProceso(proceso: ProcesoCanonico, snapshotId: string | null): Record<string, unknown> {
  return {
    sourceKey: proceso.id,
    codigoProceso: proceso.codigoProceso,
    nombre: proceso.nombre,
    entidad: proceso.entidad,
    objeto: proceso.objeto,
    modalidad: proceso.modalidad,
    perfil: proceso.perfil,
    departamento: proceso.departamento,
    fechaPublicacion: proceso.fechaPublicacion ? new Date(proceso.fechaPublicacion) : null,
    // El contrato canónico llama a este dato `fechaCierre`; la columna
    // existente de `Proceso` en este proyecto es `fechaVencimiento` (mismo
    // concepto — fecha límite de presentación). Se mapea sin inventar
    // columnas nuevas (regla de B.3A).
    fechaVencimiento: proceso.fechaCierre ? new Date(proceso.fechaCierre) : null,
    fechaVencimientoAnterior: proceso.fechaCierreAnterior ? new Date(proceso.fechaCierreAnterior) : null,
    tieneCambioFechaCierre: proceso.tieneCambioFechaCierre,
    valor: proceso.valor,
    duracion: proceso.duracion,
    linkDetalle: proceso.linkDetalle,
    estadoFuente: proceso.estado,
    totalDocumentos: proceso.totalDocumentos,
    totalCronogramas: proceso.totalCronogramas,
    hashContenido: proceso.aggregateVersion,
    lastSyncedAt: new Date(),
    disponibleDataApi: true,
    retiradoDataApiEn: null,
    ultimoSnapshotId: snapshotId,
    // Solo el concepto canónico — nunca un nombre de proveedor. `OrigenFuncional`
    // ya viene resuelto server-side (Data API) por NATURALEZA del origen.
    origenFuncional: proceso.origenFuncional,
  };
}

/**
 * `true` si el texto trae contenido real (no null/undefined ni solo espacios).
 * Un `''` cuenta como AUSENCIA, no como valor: `normalizarPerfil()` escribe
 * cadena vacía cuando no hay perfil, así que un `perfil: ''` entrante nunca
 * debe considerarse un dato que valga la pena persistir.
 */
function textoPresente(valor: string | null | undefined): boolean {
  return typeof valor === 'string' && valor.trim() !== '';
}

/**
 * Datos de actualización para un Proceso existente. Siempre marca
 * disponibleDataApi:true y retiradoDataApiEn:null (maneja reaparición).
 * El cambio de fecha de cierre viaja YA calculado en el propio bundle
 * canónico (`tieneCambioFechaCierre`/`fechaCierreAnterior`) — el aplicador
 * no reinventa esa detección, solo la traspone. NUNCA incluye `oculto`.
 *
 * `linkDetalleExistente` (D16): el bundle de una página puntual puede traer
 * `linkDetalle: null` cuando el servicio de datos todavía no lo ha resuelto
 * para esa página en particular — NO significa que el proceso haya perdido
 * su link. Sin este parámetro, esa actualización pisaba con `null` un link
 * que la fila ya tenía correctamente guardado de un sync anterior, y no
 * había forma de recuperarlo después (los mecanismos de resolución/reintento
 * de link son no-ops permanentes desde la migración a la Data API). Por eso
 * solo se sobreescribe cuando el bundle SÍ trae un valor; si no, se conserva
 * el existente.
 *
 * `perfilExistente` (D17): MISMO problema, campo distinto. El contrato
 * canónico expone `perfil` (la empresa del grupo a la que corresponde el
 * proceso: Aseocolba/Vigicolba/Tempocolba/Transcolba), pero hoy el servicio
 * de datos lo emite SIEMPRE `null` — la clasificación por empresa se perdió
 * al migrar del pipeline que buscaba perfil por perfil. Inventario de
 * producción: de 511 procesos sincronizados por la Data API, 511 tienen
 * `perfil` nulo; los únicos con perfil son los cargados a mano.
 *
 * Como este UPDATE corre en cada pasada del sync (cada 5 min), escribir
 * `perfil: proceso.perfil` sin protección BORRABA cualquier valor puesto a
 * mano. Se aplica exactamente la misma regla que a `linkDetalle`: el bundle
 * solo pisa el perfil cuando trae uno de verdad; si llega vacío/nulo, se
 * conserva el que la fila ya tenía. Así el sync deja de destruir la
 * clasificación manual y, el día que el servicio de datos empiece a poblar
 * el campo, ese valor se persiste sin ningún cambio adicional aquí.
 */
export function datosActualizacionProceso(
  proceso: ProcesoCanonico,
  snapshotId: string | null,
  linkDetalleExistente: string | null = null,
  perfilExistente: string | null = null,
): Record<string, unknown> {
  return {
    codigoProceso: proceso.codigoProceso,
    nombre: proceso.nombre,
    entidad: proceso.entidad,
    objeto: proceso.objeto,
    modalidad: proceso.modalidad,
    // D17 — nunca se pisa con null/vacío un perfil ya asignado (ver nota arriba).
    perfil: textoPresente(proceso.perfil) ? proceso.perfil : perfilExistente,
    departamento: proceso.departamento,
    fechaPublicacion: proceso.fechaPublicacion ? new Date(proceso.fechaPublicacion) : null,
    fechaVencimiento: proceso.fechaCierre ? new Date(proceso.fechaCierre) : null,
    fechaVencimientoAnterior: proceso.fechaCierreAnterior ? new Date(proceso.fechaCierreAnterior) : null,
    tieneCambioFechaCierre: proceso.tieneCambioFechaCierre,
    valor: proceso.valor,
    duracion: proceso.duracion,
    linkDetalle: proceso.linkDetalle ?? linkDetalleExistente,
    estadoFuente: proceso.estado,
    totalDocumentos: proceso.totalDocumentos,
    totalCronogramas: proceso.totalCronogramas,
    hashContenido: proceso.aggregateVersion,
    lastSyncedAt: new Date(),
    disponibleDataApi: true,
    retiradoDataApiEn: null,
    origenFuncional: proceso.origenFuncional,
    ...(snapshotId ? { ultimoSnapshotId: snapshotId } : {}),
  };
}

export function datosTombstone(): Record<string, unknown> {
  return { disponibleDataApi: false, retiradoDataApiEn: new Date() };
}

export function datosCreacionDocumento(procesoIdLocal: number, doc: DocumentoCanonico): Record<string, unknown> {
  return {
    procesoId: procesoIdLocal,
    dataApiDocId: doc.docId,
    nombre: doc.nombre,
    tipoDocumento: doc.tipoDocumento,
  };
}

/**
 * Mapea un evento de cronograma canónico a las columnas EXISTENTES de
 * `ProcesoCronogramaSecop` (no hay columna `fecha` — el crudo de la fuente
 * pública va en `valorTexto`, y la fecha ISO ya resuelta, si viene, en
 * `fechaInicio`). `cambioDetectado` viaja ya calculado en el bundle.
 */
export function datosCreacionCronograma(procesoIdLocal: number, evento: EventoCronogramaCanonico): Record<string, unknown> {
  return {
    procesoId: procesoIdLocal,
    evento: evento.evento,
    valorTexto: evento.fecha,
    fechaInicio: evento.fechaResuelta ? new Date(evento.fechaResuelta) : null,
    orden: evento.orden,
    tieneCambioFecha: evento.cambioDetectado,
    valorTextoAnterior: evento.valorAnterior,
  };
}

/**
 * Datos base de una notificación generada por el aplicador. `Notificacion`
 * exige `titulo` (NOT NULL, sin default) — el aplicador lo provee aquí, sin
 * tocar el schema. `codigoProceso`/`entidad`/`perfil`/`descripcion` se
 * rellenan desde el `ProcesoCanonico` (el aplicador SÍ los tiene disponibles
 * en cada callsite) — antes quedaban en NULL, produciendo notificaciones sin
 * contexto en la UI (compárese con el patrón real usado por las rutas
 * legacy `actualizar-documentos`/`actualizar-cronograma`, que sí los llenan).
 */
/**
 * B.4.5 — VOCABULARIO OFICIAL de `tipo` de notificación. Debe coincidir EXACTO
 * con el que ya consumen la UI (`LicyTopbar` tabs) y las APIs
 * (`/api/notificaciones*`, `/api/procesos/actualizar-*`). NUNCA introducir un
 * `tipo` nuevo que ningún consumidor conozca (p.ej. el histórico
 * `cronograma_cambio` / `adenda` del aplicador, que quedaban huérfanos).
 */
const TITULOS_NOTIFICACION: Record<string, string> = {
  proceso_nuevo: 'Nuevo proceso disponible',
  documento_nuevo: 'Nuevo documento en un proceso',
  cambio_estado: 'Cambio de estado en proceso',
  cambio_valor: 'Cambio de valor del proceso',
  cambio_fecha_cierre: 'Cambio de fecha de cierre',
  cambio_cronograma: 'Cambio en cronograma',
  manifestacion_interes: 'Manifestación de interés detectada',
};

export interface ContextoNotificacion {
  codigoProceso?: string | null;
  entidad?: string | null;
  perfil?: string | null;
  /** Título específico de esta instancia — si se omite, usa el genérico de `TITULOS_NOTIFICACION`. */
  titulo?: string;
  descripcion?: string | null;
}

export function datosNotificacion(tipo: string, procesoId: number, contexto: ContextoNotificacion = {}): Record<string, unknown> {
  return {
    tipo,
    titulo: contexto.titulo ?? TITULOS_NOTIFICACION[tipo] ?? 'Novedad en un proceso',
    procesoId,
    codigoProceso: contexto.codigoProceso ?? null,
    entidad: contexto.entidad ?? null,
    perfil: contexto.perfil ?? null,
    descripcion: contexto.descripcion ?? null,
  };
}

export function claveIdempotenciaProcesoNuevo(procesoId: string): string {
  return `proceso_nuevo:${procesoId}`;
}
export function claveIdempotenciaDocumentoNuevo(procesoId: string, docId: string): string {
  return `documento_nuevo:${procesoId}:${docId}`;
}
/**
 * Cambio de cronograma: legacy emite UNA notificación por proceso cuando alguna
 * fecha del cronograma cambió. La clave incluye `aggregateVersion` para que una
 * versión de contenido nueva pueda volver a notificar (igual que legacy), pero
 * la misma versión nunca duplica.
 */
export function claveIdempotenciaCambioCronograma(sourceKey: string, aggregateVersion: string): string {
  return `cambio_cronograma:${sourceKey}:${aggregateVersion}`;
}
export function claveIdempotenciaCambioEstado(sourceKey: string, estadoNuevo: string): string {
  return `cambio_estado:${sourceKey}:${estadoNuevo}`;
}
export function claveIdempotenciaCambioValor(sourceKey: string, valorNuevo: number): string {
  return `cambio_valor:${sourceKey}:${valorNuevo}`;
}
export function claveIdempotenciaCambioFechaCierre(sourceKey: string, fechaNuevaIso: string): string {
  return `cambio_fecha_cierre:${sourceKey}:${fechaNuevaIso}`;
}
export function claveIdempotenciaManifestacionInteres(sourceKey: string, evento: string): string {
  return `manifestacion_interes:${sourceKey}:${evento}`;
}

/**
 * Normalización de clave de texto — equivalente a `normalizarTextoKey` de
 * legacy (`procesos-sync.ts`): minúsculas + NFD + strip de diacríticos.
 * Usada para comparar nombres de etapa de cronograma y (B.4.5) fechas-texto,
 * exactamente como legacy.
 */
export function normalizarClaveTexto(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Detección de etapa de "manifestación de interés" en el nombre de un evento
 * de cronograma. Mismos patrones que `detectarEtapasManifestacionInteres` del
 * pipeline legacy (`procesos-sync.ts`).
 */
export function esManifestacionInteres(evento: string | null | undefined): boolean {
  const t = normalizarClaveTexto(evento);
  return (
    t.includes('manifestacion de interes') ||
    t.includes('manifestacion interes') ||
    t.includes('presentacion de manifestaciones') ||
    t.includes('manifestaciones de interes')
  );
}

/**
 * B.4.5 · punto 2 — diff APPLIER-SIDE de cronograma, reproduce la regla
 * EXACTA de legacy (`sincronizarCronograma` en `procesos-sync.ts`) SIN la
 * "protección de fecha" (auditada y descartada — ver informe C2.2-b: es un
 * workaround específico de la mezcla de dos campos del proveedor legacy —
 * fecha de la API general vs fecha del cronograma —, que no existe en el
 * contrato canónico, y cero consumidores Data-API dependen de ella).
 *
 * `viejo` = cronograma PERSISTIDO (leído ANTES del reemplazo).
 * `nuevo` = cronograma del bundle canónico entrante.
 *
 *   fechasModificadas = etapas cuya clave (nombre normalizado) existe en
 *                        AMBOS y cuya fecha-texto normalizada difiere.
 *   eventosEliminados = claves del viejo que NO están en el nuevo.
 *   notificar = fechasModificadas > 0 || eventosEliminados > 0
 *               (una etapa AÑADIDA sola — presente solo en `nuevo` — NUNCA
 *               notifica, igual que legacy).
 */
export function calcularCambioCronograma(
  viejo: { evento: string; valorTexto: string | null }[],
  nuevo: { evento: string; fecha: string | null }[],
): { notificar: boolean; fechasModificadas: number; eventosEliminados: number } {
  const mapaViejo = new Map(viejo.map((e) => [normalizarClaveTexto(e.evento), normalizarClaveTexto(e.valorTexto)]));
  const mapaNuevo = new Map(nuevo.map((e) => [normalizarClaveTexto(e.evento), normalizarClaveTexto(e.fecha)]));

  let fechasModificadas = 0;
  for (const [key, fechaNueva] of mapaNuevo) {
    const fechaVieja = mapaViejo.get(key);
    if (fechaVieja !== undefined && fechaVieja !== fechaNueva) fechasModificadas++;
  }
  let eventosEliminados = 0;
  for (const key of mapaViejo.keys()) {
    if (!mapaNuevo.has(key)) eventosEliminados++;
  }

  return { notificar: fechasModificadas > 0 || eventosEliminados > 0, fechasModificadas, eventosEliminados };
}

/**
 * Campos ESPEJO que legacy propaga de `Proceso` a las `Solicitud` vinculadas
 * cuando el proceso cambia (`procesos-sync.ts`, bloque `solicitud.updateMany`).
 *
 * Forma condicional EXACTA de legacy:
 *   data = {
 *     ...(estadoFuente     ? { estadoFuente }     : {}),
 *     ...(hayCambioFecha   ? { fechaVencimiento } : {}),   // solo si la fecha cambió
 *     ...(linkDetalle      ? { linkDetalle }      : {}),
 *     ...(linkSecop        ? { linkSecop }        : {}),   // dataBase.linkSecop == null SIEMPRE en legacy → nunca propaga
 *     ...(linkSecopReg     ? { linkSecopReg }     : {}),   // legacy: p.linkSecopReg (payload crudo del proveedor)
 *   }
 *
 * ── DIVERGENCIA ACEPTADA DEL CUTOVER / B.6 (decisión (a), informe C2.2-b) ──
 * `ProcesoCanonico` NO expone `linkSecop` ni `linkSecopReg` (el contrato
 * canónico prohíbe campos que revelen el proveedor — `contrato-guardrail`).
 * Decisión tomada: se ACEPTA que, con el cutover activo,
 *   · `Solicitud.linkSecop`    NUNCA se propaga (idéntico al efecto real de
 *     legacy: `dataBase.linkSecop` era siempre `null`).
 *   · `Solicitud.linkSecopReg` DEJA de refrescarse (legacy sí lo propagaba
 *     cuando el payload crudo del proveedor lo traía) porque el contrato
 *     canónico deliberadamente no expone ese dato.
 * Explícitamente PROHIBIDO como solución: (i) extender el contrato de la Data
 * API con `linkSecopReg`; (ii) derivarlo de otra URL/dato específico del
 * proveedor; (iii) hacer fallback al pipeline legacy para obtenerlo; (iv)
 * copiar `Proceso.linkSecopReg` persistido como sustituto (también queda NULL
 * para filas Data API). Los valores HISTÓRICOS de `Solicitud.linkSecopReg`
 * pueden permanecer hasta B.6 — el pipeline canónico simplemente no los toca.
 * Por eso aquí `linkSecop`/`linkSecopReg` quedan CABLEADOS con la misma forma
 * condicional que legacy (para que la intención quede explícita en el código,
 * no "olvidada"), pero como `proceso` nunca trae esos campos, la rama nunca
 * se activa — es const y consciente, no un placeholder pendiente.
 *
 * `hayCambioFecha` lo decide el llamador (`aplicarUpsert`) comparando la
 * fecha PERSISTIDA (`existente.fechaVencimiento`) con `proceso.fechaCierre`
 * — misma comparación que legacy (`fechaAnteriorTime !== fechaNuevaTime`),
 * porque los flags canónicos de diff (`tieneCambioFechaCierre`) hoy no se
 * pueblan por el motor (ver informe C2.2-b · punto 2).
 */
export function datosPropagacionSolicitud(
  proceso: ProcesoCanonico,
  hayCambioFecha: boolean,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (proceso.estado) data.estadoFuente = proceso.estado;
  if (hayCambioFecha && proceso.fechaCierre) data.fechaVencimiento = new Date(proceso.fechaCierre);
  if (proceso.linkDetalle) data.linkDetalle = proceso.linkDetalle;
  // linkSecop / linkSecopReg: no existen en ProcesoCanonico — cableado inerte
  // (ver GAP DE CONTRATO arriba). Se listan explícitamente para no "olvidarlos"
  // silenciosamente:
  const conLinksProveedor = proceso as unknown as { linkSecop?: string | null; linkSecopReg?: string | null };
  if (conLinksProveedor.linkSecop) data.linkSecop = conLinksProveedor.linkSecop;
  if (conLinksProveedor.linkSecopReg) data.linkSecopReg = conLinksProveedor.linkSecopReg;
  return data;
}
