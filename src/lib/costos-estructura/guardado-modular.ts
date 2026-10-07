/**
 * Contrato de guardado modular por etapas de la Estructura de Costos —
 * cada pestaña (Mano de Obra, Turnantes, EPP y Dotación, Exámenes
 * Médicos, Maquinaria y Equipos, Costos Administrativos) guarda su propio
 * avance sin exigir que las demás estén terminadas, dentro del mismo
 * registro `CostoEstructura` (campo `datos: Json`, sin migración).
 *
 * Puro — sin Prisma, sin React, sin `fetch`. Reutilizable por cualquier
 * módulo futuro (§9): esta fase implementa completamente Mano de Obra;
 * los demás módulos usan el mismo contrato cuando se conecten.
 */

/**
 * Ajuste "NO_APLICA EN 4 MÓDULOS" (confirmado explícitamente) — fuente de
 * verdad ÚNICA (runtime, no solo un tipo) de los estados válidos de un
 * módulo. `esEstadoModuloResultadoValido` (abajo) se apoya en este mismo
 * arreglo — nunca una segunda lista hardcodeada en el backend.
 */
export const ESTADOS_MODULO_RESULTADO = ['NO_INICIADO', 'EN_PROGRESO', 'COMPLETADO', 'NO_APLICA'] as const;
export type EstadoModuloResultado = (typeof ESTADOS_MODULO_RESULTADO)[number];
/** Estados "en curso" — excluye `NO_APLICA`, que es una decisión explícita
 * de que el módulo no aplica, nunca un estado de avance. */
export type EstadoModulo = Exclude<EstadoModuloResultado, 'NO_APLICA'>;

/** Valida en runtime (nunca solo un cast de TypeScript) si un valor
 * recibido de un cliente HTTP es un estado real del dominio — usado por
 * el backend (`PUT /api/costos-estructura/[id]`) para rechazar con 400
 * cualquier valor arbitrario. */
export function esEstadoModuloResultadoValido(valor: unknown): valor is EstadoModuloResultado {
  return typeof valor === 'string' && (ESTADOS_MODULO_RESULTADO as readonly string[]).includes(valor);
}

export const CLAVES_MODULO = [
  'manoObra',
  'turnantes',
  'dotacionEpp',
  'examenesMedicos',
  'maquinariaEquipos',
  'insumos',
  'costosAdministrativos',
  // Ajuste "SERVICIOS NO CONTINUOS — CONTENEDOR DE SERVICIOS
  // INDEPENDIENTES": módulo propio, persistido en el mismo JSON modular
  // (sin migración Prisma). Deliberadamente NO en CLAVES_MODULO_NO_APLICA
  // todavía — la regla de completitud/obligatoriedad de este módulo se
  // define en una ronda posterior, una vez validado el módulo completo.
  'serviciosNoContinuos',
  // Ajuste "necesito que en resultado colocar el guardar tambien" — la
  // pestaña Resultado (tarifa final del servicio) pasa a tener guardado
  // modular propio, mismo contrato que el resto: guarda un snapshot de los
  // totales finales (subtotalAntesIva/iva/valorMensual/valorTotalVigencia),
  // nunca datos editables (Resultado sigue siendo puramente un cálculo
  // derivado de los demás módulos). Deliberadamente NO en
  // CLAVES_MODULO_NO_APLICA — no participa de esa regla de completitud.
  'resultado',
  // Ajuste "lo mismo que tiene servicios no continuos vaya en la pestaña
  // de valor agregado" — réplica completa del mismo contenedor
  // (ServicioNoContinuo, mismos 5 bloques + tarifa Aseocolba), como
  // módulo propio independiente. Deliberadamente NO en
  // CLAVES_MODULO_NO_APLICA todavía, mismo criterio que
  // 'serviciosNoContinuos'.
  'valorAgregado',
  // Ajuste "TARIFA REGULADA VIGICOLBA — PESTAÑA PROPIA" — módulo propio,
  // visible ÚNICAMENTE para procesos de Vigicolba (page.tsx decide la
  // visibilidad de la pestaña; este archivo es agnóstico de empresa).
  // Representa el VALOR A PRESENTAR EN LA OFERTA según el tarifario
  // regulado por Supervigilancia — conceptualmente independiente del
  // costo interno (Mano de Obra/Turnantes/SNC/etc.). Deliberadamente NO
  // en CLAVES_MODULO_NO_APLICA, mismo criterio que 'serviciosNoContinuos'/
  // 'valorAgregado'.
  'tarifaRegulada',
] as const;

export type ClaveModulo = (typeof CLAVES_MODULO)[number];

/**
 * Ajuste "NO_APLICA EN 4 MÓDULOS" — subconjunto exacto de módulos que
 * participan en la regla de completitud de "NO aplica" (Dotación/EPP,
 * Exámenes Médicos, Insumos, Maquinaria y Equipos). Mano de Obra,
 * Turnantes y Costos Administrativos NUNCA participan de esta regla —
 * fuente de verdad única, para que page.tsx nunca tenga que repetir este
 * arreglo literal en más de un lugar.
 */
export const CLAVES_MODULO_NO_APLICA = ['dotacionEpp', 'examenesMedicos', 'insumos', 'maquinariaEquipos'] as const satisfies readonly ClaveModulo[];

export type ClaveModuloNoAplica = (typeof CLAVES_MODULO_NO_APLICA)[number];

/**
 * Ajuste "IMPEDIR COMPLETADO FALSO" (confirmado explícitamente) — regla
 * ÚNICA (frontend Y backend) de qué significa "información mínima real"
 * para cada uno de los 4 módulos con NO_APLICA. Reutiliza EXACTAMENTE la
 * misma condición que ya usaban `tieneDatosDotacionEpp`/
 * `tieneDatosExamenesMedicos`/`tieneDatosInsumos`/`tieneDatosMaquinaria`
 * en page.tsx — nunca una regla nueva inventada aquí. Puro (sin Prisma,
 * sin React): recibe el mismo `datos` que ya viaja en el body de
 * `PUT /api/costos-estructura/[id]` o en `construirDatosEntradaX()` del
 * frontend.
 *
 * Deliberadamente NO evalúa granularidad por cargo/sub-bloque (Dotación
 * masculina/femenina/EPP por cargo, o Exámenes/Cursos/Vacunas por cargo)
 * — esa decisión está fuera de alcance de esta ronda (autorizado
 * explícitamente a nivel de módulo completo, no por cargo).
 */
export function moduloTieneDatosValidos(clave: ClaveModuloNoAplica, datos: unknown): boolean {
  if (!datos || typeof datos !== 'object') return false;
  const d = datos as Record<string, unknown>;
  const filas = (valor: unknown): unknown[] => (Array.isArray(valor) ? valor : []);
  switch (clave) {
    case 'dotacionEpp':
      return filas(d.dotGroups).some((g) => Array.isArray((g as { rows?: unknown[] })?.rows) && (g as { rows: unknown[] }).rows.length > 0);
    case 'examenesMedicos': {
      const tieneFilaValida = (valor: unknown) => filas(valor).some((r) => Number((r as { cant?: unknown })?.cant) > 0 && Number((r as { valor?: unknown })?.valor) > 0);
      return tieneFilaValida(d.examRows) || tieneFilaValida(d.cursosRows) || tieneFilaValida(d.vacunasRows);
    }
    case 'insumos':
      return filas(d.insumosRows).length > 0;
    case 'maquinariaEquipos':
      return filas(d.maqRows).length > 0;
  }
}

/**
 * Cierre correctivo §3 — PROPIEDAD CANÓNICA DE DATOS.
 *
 * Cada dato de la Estructura de Costos tiene UN SOLO módulo dueño. Otro
 * módulo puede referenciarlo (ID, asociación, total derivado), pero
 * NUNCA guardar una segunda copia completa. Mano de Obra en particular no
 * debe volver a guardar `dotGroups`/`examRows`/`cursosRows`/`vacunasRows`
 * completos dentro de `modulos.manoObra.datos` — esos arreglos viven en
 * page.tsx (estado compartido, todavía sin módulo propio conectado) pero
 * su DUEÑO conceptual son los módulos de la tabla, no Mano de Obra.
 *
 * | Dato                                    | Módulo propietario     | Referencias permitidas en otros módulos          |
 * |------------------------------------------|-------------------------|---------------------------------------------------|
 * | cargos, cantidades, salarios, ARL         | manoObra                 | `lineaManoObraId` en otros módulos                 |
 * | horarios/distribuciones/bloques/descansos | manoObra                 | ninguna — exclusivo de manoObra                    |
 * | incluyeFestivos, bonificaciones           | manoObra                 | ninguna — exclusivo de manoObra                    |
 * | parámetros financieros configurados       | manoObra                 | ninguna — exclusivo de manoObra                    |
 * | líneas propias de Turnantes               | turnantes                | `lineaManoObraId` (si aplica a un cargo de manoObra) |
 * | dotGroups y filas completas                | dotacionEpp              | `lineaManoObraId`, IDs, total derivado             |
 * | examRows, cursosRows, vacunasRows          | examenesMedicos          | `lineaManoObraId`, IDs, total derivado             |
 * | datos propios de maquinaria                | maquinariaEquipos        | ninguna                                            |
 * | datos propios de insumos                   | insumos                  | ninguna                                            |
 * | datos propios administrativos              | costosAdministrativos    | ninguna                                            |
 *
 * Decisión "CURSOS/VACUNAS NO SON UNA PESTAÑA APARTE" — la UI real no
 * tiene una pestaña "Cursos y Vacunas" independiente: `cursosRows`/
 * `vacunasRows` se capturan y muestran dentro de la MISMA pestaña visible
 * "Exámenes Médicos" (page.tsx, bloque `tab==='examenes'`, justo debajo
 * de `examRows`). Por eso su módulo dueño es `examenesMedicos` (clave ya
 * existente, la misma de la pestaña real) — nunca una clave `cursosVacunas`
 * que no correspondería a ninguna pestaña visible del sistema. Cuando se
 * conecte el guardado de Exámenes Médicos, su `datos` debe contener los
 * tres arreglos juntos: `{examRows, cursosRows, vacunasRows}`.
 *
 * Mano de Obra SÍ puede conservar, dentro de su propio módulo: IDs,
 * referencias/asociaciones (`lineaManoObraId`) y totales YA derivados
 * (nunca el arreglo fuente completo) — ver `ReferenciaOtroModulo` abajo.
 *
 * Compatibilidad: los JSON ya guardados en fases anteriores (`dotGroups`/
 * `examRows`/`cursosRows`/`vacunasRows` completos dentro de
 * `manoObra.datos`) siguen siendo válidos para RESTAURAR — la restricción
 * aplica hacia adelante, a partir de esta corrección, sobre lo que se
 * vuelve a GUARDAR.
 */
export interface ReferenciaOtroModulo {
  lineaManoObraId: number;
  totalDerivado: number;
}

/** Ajuste "NO_APLICA EN 4 MÓDULOS" — `estado` ahora acepta
 * `EstadoModuloResultado` (incluye `NO_APLICA`), no solo `EstadoModulo`:
 * un módulo persistido/restaurado SÍ puede estar en `NO_APLICA`, distinto
 * de "todavía sin implementar", que se representa con el valor ausente
 * (`undefined`) en el mapa de estados de nivel superior. */
export interface ModuloGuardado<T> {
  estado: EstadoModuloResultado;
  datos: T;
  /** ISO 8601 — también sirve como token de concurrencia (§12). */
  ultimaActualizacion: string;
  actualizadoPor: string | null;
}

export type EstadoResultadoGeneral = 'PROVISIONAL' | 'FINAL';

/** Único predicado de "módulo resuelto" — reutilizado por
 * `resolverEstadoResultadoGeneral` y `resolverPendientesModulos`, nunca
 * reimplementado por separado en cada una. Un estado ausente
 * (`undefined`, módulo todavía sin guardado modular) NUNCA se considera
 * resuelto. */
function moduloEstaResuelto(estado: EstadoModuloResultado | undefined): boolean {
  return estado === 'COMPLETADO' || estado === 'NO_APLICA';
}

/**
 * Cierre correctivo §2 — "Resultado final" únicamente cuando TODOS los
 * módulos evaluados están COMPLETADO o NO_APLICA. Un módulo ausente del
 * mapa (todavía sin guardado modular implementado) NUNCA se trata como
 * completo — mantiene el resultado en PROVISIONAL automáticamente, sin
 * necesidad de hardcodear nada por fuera de esta función a medida que se
 * conectan los demás módulos.
 *
 * Ajuste "NO_APLICA EN 4 MÓDULOS" — `clavesAEvaluar` es OPCIONAL,
 * predeterminado a `CLAVES_MODULO` (las 7, comportamiento IDÉNTICO al de
 * antes de este ajuste para cualquier llamador que no lo use). Permite
 * evaluar un subconjunto explícito (ej. `CLAVES_MODULO_NO_APLICA`, solo
 * Dotación/EPP + Exámenes + Insumos + Maquinaria) SIN reimplementar el
 * `every(...)` en un segundo lugar.
 */
export function resolverEstadoResultadoGeneral(
  estadosModulos: Partial<Record<ClaveModulo, EstadoModuloResultado>>,
  clavesAEvaluar: readonly ClaveModulo[] = CLAVES_MODULO,
): EstadoResultadoGeneral {
  const todosListos = clavesAEvaluar.every(clave => moduloEstaResuelto(estadosModulos[clave]));
  return todosListos ? 'FINAL' : 'PROVISIONAL';
}

/** Detalle por-módulo de la misma regla que `resolverEstadoResultadoGeneral`
 * — nunca una segunda implementación: `completo` es literalmente
 * `resolverEstadoResultadoGeneral(...)==='FINAL'` sobre las mismas
 * `clavesAEvaluar`, y `pendientes` reutiliza el mismo predicado
 * `moduloEstaResuelto`. Pensado para la alerta/resumen de la UI (§9 del
 * ajuste), donde se necesita saber CUÁLES módulos faltan, no solo si todo
 * está listo. */
export interface ResultadoPendientesModulos {
  completo: boolean;
  pendientes: ClaveModulo[];
}

export function resolverPendientesModulos(
  estadosModulos: Partial<Record<ClaveModulo, EstadoModuloResultado>>,
  clavesAEvaluar: readonly ClaveModulo[] = CLAVES_MODULO,
): ResultadoPendientesModulos {
  const pendientes = clavesAEvaluar.filter(clave => !moduloEstaResuelto(estadosModulos[clave]));
  return { completo: pendientes.length === 0, pendientes };
}

/**
 * Ajuste "ASENTAMIENTO TRAS RESTAURAR UN COSTEO" — al abrir un costeo guardado
 * el cliente toma la copia base ("baseline") de cada módulo en UN render, pero
 * varios efectos derivados siguen recalculando datos 1-2 s después (medido en
 * vivo: las cantidades automáticas de Costos Administrativos suben 0 → 1 → 2
 * según terminan de asentarse Mano de Obra y Turnantes; el régimen de IVA se
 * deriva de la empresa del proceso, que llega asíncrona). Cada uno de esos
 * cambios se leía como "cambios sin guardar" y le quitaba el chulo al módulo
 * en el stepper, de forma intermitente según la velocidad de la red.
 *
 * Mientras el usuario NO haya interactuado desde la restauración, y dentro de
 * un tope de tiempo, un dato que cambia es por construcción una consecuencia
 * de la carga y no una edición: se adopta como nueva base. Puro (sin React ni
 * reloj propio): recibe `ahora` para poder probarse.
 */
export const VENTANA_ASENTAMIENTO_TRAS_RESTAURAR_MS = 10_000;

export function restauracionAsentandose(entrada: {
  ahora: number;
  /** Instante (ms epoch) en que vence la ventana; 0 = nunca se restauró. */
  hasta: number;
  usuarioInteractuo: boolean;
}): boolean {
  return !entrada.usuarioInteractuo && entrada.ahora < entrada.hasta;
}

export interface DatosEstructuraModular {
  version: 2;
  modulos: Partial<Record<ClaveModulo, ModuloGuardado<unknown>>>;
}

/**
 * Cierre correctivo §4 — separación datosEntrada/resultadoSnapshot.
 * `datosEntrada` es la fuente canónica (lo único que se restaura y se
 * vuelve a editar); `resultadoSnapshot` es exclusivamente de auditoría —
 * al abrir un costeo, el valor visible SIEMPRE se recalcula en vivo con
 * el motor comercial vigente, nunca se lee el snapshot como fuente del
 * total mostrado.
 */
export interface ResultadoSnapshotManoObra {
  fechaCalculo: string;
  versionMotor: 'COMERCIAL_30_DIAS';
  totales: {
    tarifaMensualTotalManoObra: number;
    tarifaMensualTotalTurnantes: number;
    prestacionesSocialesMensualesTotal: number;
    seguridadSocialMensualTotal: number;
    parafiscalesMensualesTotal: number;
  };
}

export interface DatosManoObraModular {
  datosEntrada: Record<string, unknown>;
  resultadoSnapshot: ResultadoSnapshotManoObra;
}

/**
 * Único punto de lectura de `datosEntrada` — normaliza las 2 formas que
 * puede tener `modulos.manoObra.datos` según cuándo se guardó:
 *  - post-corrección (§4): `{datosEntrada, resultadoSnapshot}`;
 *  - pre-corrección o histórico adaptado (fases anteriores): el objeto
 *    plano completo directamente en `.datos`, sin envoltorio.
 * Nunca lee `resultadoSnapshot` como fuente de datos editables.
 */
export function resolverDatosEntradaManoObra(moduloManoObra: ModuloGuardado<unknown> | null): Record<string, unknown> {
  if (!moduloManoObra) return {};
  const datos = moduloManoObra.datos;
  if (datos !== null && typeof datos === 'object' && 'datosEntrada' in (datos as Record<string, unknown>)) {
    return ((datos as DatosManoObraModular).datosEntrada ?? {}) as Record<string, unknown>;
  }
  return (datos ?? {}) as Record<string, unknown>;
}

export function crearModuloVacio<T>(datosVacios: T): ModuloGuardado<T> {
  return { estado: 'NO_INICIADO', datos: datosVacios, ultimaActualizacion: '', actualizadoPor: null };
}

export function esEstructuraModular(datos: unknown): datos is DatosEstructuraModular {
  return (
    typeof datos === 'object' && datos !== null &&
    (datos as Record<string, unknown>).version === 2 &&
    typeof (datos as Record<string, unknown>).modulos === 'object' &&
    (datos as Record<string, unknown>).modulos !== null
  );
}

/**
 * Fusión segura (§4) — conserva TODAS las demás propiedades de nivel raíz
 * (compatibilidad con cualquier campo adicional que ya viva en `datos`) y
 * TODOS los demás módulos; reemplaza únicamente `modulos[clave]`. Nunca
 * hace `datos = nuevaSeccion`, que borraría las demás etapas.
 */
export function fusionarModulo(
  datosExistentes: unknown,
  clave: ClaveModulo,
  nuevoModulo: ModuloGuardado<unknown>,
): DatosEstructuraModular {
  const base: DatosEstructuraModular = esEstructuraModular(datosExistentes)
    ? datosExistentes
    : { version: 2, modulos: {} };
  return {
    ...base,
    version: 2,
    modulos: {
      ...base.modulos,
      [clave]: nuevoModulo,
    },
  };
}

export function obtenerModulo<T = unknown>(
  datos: unknown,
  clave: ClaveModulo,
): ModuloGuardado<T> | null {
  if (!esEstructuraModular(datos)) return null;
  const modulo = datos.modulos[clave];
  return (modulo as ModuloGuardado<T> | undefined) ?? null;
}

/**
 * Compatibilidad histórica (§7) — si el JSON no tiene `modulos` (formato
 * anterior a esta fase, estructura plana con `lineasExtra`/`cargosTurnantes`/
 * etc. directamente en `datos`), se adapta EN MEMORIA como si fuera el
 * `datos` del módulo Mano de Obra, sin modificar el registro hasta que el
 * usuario vuelva a guardar. Nunca pierde datos históricos: retorna el
 * mismo objeto recibido, solo reetiquetado como `datos` de un módulo.
 */
export function adaptarHistoricoAManoObra(datosAntiguos: unknown): ModuloGuardado<unknown> | null {
  if (datosAntiguos === null || typeof datosAntiguos !== 'object') return null;
  if (esEstructuraModular(datosAntiguos)) return null; // ya es v2, no requiere adaptación
  return {
    estado: 'EN_PROGRESO',
    datos: datosAntiguos,
    ultimaActualizacion: '',
    actualizadoPor: null,
  };
}

/**
 * Único punto de lectura para restaurar el módulo Mano de Obra (§7),
 * cubriendo v2 (`modulos.manoObra`) y el histórico plano adaptado en
 * memoria — page.tsx nunca debe inspeccionar `datos.modulos` a mano.
 */
export function resolverModuloManoObraParaRestaurar(datos: unknown): ModuloGuardado<unknown> | null {
  const v2 = obtenerModulo(datos, 'manoObra');
  if (v2) return v2;
  return adaptarHistoricoAManoObra(datos);
}

/**
 * Ajuste "NORMALIZAR SEMÁNTICA DE ESTADOS EN TODO EL STEPPER DE COSTOS" —
 * regla transversal ÚNICA para los 3 estados "de captura" de cualquier
 * módulo (`NO_APLICA` queda deliberadamente FUERA: es una decisión
 * explícita del usuario, nunca derivada de datos — nunca se infiere aquí,
 * el llamador decide NO_APLICA por su cuenta antes o después de consultar
 * esta función).
 *
 *  - `tieneDatos:false` → `NO_INICIADO` (no hay nada capturado todavía).
 *  - `tieneDatos:true, esValido:false` → `EN_PROGRESO` (hay algo, pero no
 *    cumple la validación mínima de ese módulo para considerarse
 *    terminado).
 *  - `tieneDatos:true, esValido:true` → `COMPLETADO`.
 *
 * Cada módulo decide QUÉ significa `tieneDatos`/`esValido` para sus
 * propios datos (page.tsx sigue teniendo sus `tieneDatosX()` — esta
 * función NO los reemplaza, solo centraliza el mapeo final a un
 * `EstadoModulo`, para no repetir el mismo `if(!tieneDatos)return...`
 * ternario en cada módulo). Cuando un módulo hoy solo puede demostrar
 * "vacío/no vacío" (sin una validación real de completitud de fila), su
 * llamador debe pasar `esValido:tieneDatos` explícitamente — nunca se
 * inventa aquí una regla de validez que el módulo no tiene.
 */
export interface EntradaResolucionEstadoModuloCosteo {
  tieneDatos: boolean;
  esValido: boolean;
}

export function resolverEstadoModuloCosteo(entrada: EntradaResolucionEstadoModuloCosteo): EstadoModulo {
  if (!entrada.tieneDatos) return 'NO_INICIADO';
  return entrada.esValido ? 'COMPLETADO' : 'EN_PROGRESO';
}

/**
 * Mismo criterio que `resolverEstadoModuloCosteo`, pero para el TEXTO
 * visible/chulo del stepper cuando ya existe un `estado` persistido (que
 * puede ser un histórico incoherente, p.ej. `COMPLETADO` guardado antes de
 * esta validación, con 0 datos reales) — nunca confía ciegamente en el
 * `estado` de BD por sí solo: si los datos EN VIVO dicen que el módulo
 * está vacío o incompleto, la UI se corrige de inmediato (reactivo, sin
 * esperar a que el usuario vuelva a guardar); `NO_APLICA` persistido SÍ se
 * respeta siempre (es una decisión explícita, nunca se sobrescribe por
 * esta regla).
 */
export function resolverEstadoVisibleModuloCosteo(
  estadoPersistido: EstadoModuloResultado | undefined,
  entrada: EntradaResolucionEstadoModuloCosteo,
): EstadoModuloResultado {
  if (estadoPersistido === 'NO_APLICA') return 'NO_APLICA';
  return resolverEstadoModuloCosteo(entrada);
}