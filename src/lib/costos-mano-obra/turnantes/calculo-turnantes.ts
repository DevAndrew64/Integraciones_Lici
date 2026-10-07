/**
 * Cálculo automático de la necesidad de turnantes — personal de relevo que
 * cubre el descanso semanal obligatorio de posiciones cuyo servicio se
 * presta los 7 días de la semana.
 *
 * Deliberadamente NO reutiliza `interpretarOperacionTurno`
 * (`motor-distribuido/interprete-turnos.ts`): ese intérprete resuelve un
 * problema distinto — patrones de TURNO de 12 horas (vigilancia 24/7) — y
 * solo marca `requiereTurnantes:true` para bloques de exactamente 12h. El
 * caso de referencia de este módulo (aseo/cafetería, bloques de 8h,
 * lunes a domingo) NUNCA activaría ese intérprete. La regla aquí es más
 * general y depende únicamente de si el patrón semanal (`diasSemana`, ya
 * estructurado — nunca texto libre) cubre los 7 días, sin importar la
 * duración del bloque.
 *
 * MODELO DE COSTEO — "costeo comercial por posición" (se conserva, no se
 * migra a un modelo nominal trabajador por trabajador en esta fase):
 * - COBERTURA DEL SERVICIO (`distribucionesHorario`, ej. 7 días × 7h =
 *   49h/semana) NUNCA se edita/recorta para ningún propósito (ni motor ni
 *   UI) — un día "quitado" a nivel de LÍNEA equivaldría a aplicar el mismo
 *   descanso a las N posiciones simultáneamente, operativamente falso (el
 *   descanso rota entre las personas de la plantilla, nunca es un día común
 *   a todas). El salario básico de cada titular se limita a la jornada
 *   ordinaria mediante un ESCALAR (`Math.min`, en `construirCalculadaLinea`,
 *   page.tsx) — nunca editando qué días están programados.
 * - RECARGOS DEL SERVICIO (nocturno/dominical/festivo) se derivan de la
 *   cobertura ORIGINAL COMPLETA, sin recortar — el motor
 *   (`derivarDistribucionHorasComercialActivo`) ya separa correctamente el
 *   día de descanso obligatorio del acumulador semanal genérico (nunca
 *   entra a él) y lo clasifica aparte como día especial (dominical/
 *   festivo), así que alimentarlo con la cobertura completa ya produce las
 *   horas ordinarias capadas (sin costo adicional) + las horas
 *   dominicales/festivas reales (si costo), sin necesidad de recortar nada.
 * - La línea TURNANTE representa exclusivamente la capacidad laboral
 *   ADICIONAL necesaria para cubrir los descansos — sus horas nunca se
 *   vuelven a sumar a las posiciones principales ni sus recargos se
 *   recalculan aquí (los turnantes se liquidan con el mismo motor de mano
 *   de obra que cualquier otro cargo, en TOTAL_SEMANAL sin recargos —
 *   ver `construirCalculadaLinea` en page.tsx) — los recargos del servicio
 *   quedan costeados exactamente una vez, en la línea de titulares.
 *
 * Este módulo dimensiona, POR GRUPO de configuración laboral compatible
 * (ver §2, `construirGruposNecesidadTurnantes`), DOS cosas explícitamente
 * separadas:
 *  1. Cuántos turnantes FÍSICOS existen (regla de 6 días, sin cambios).
 *  2. Cuántas horas de relevo semanal se necesitan realmente, y si la
 *     capacidad ordinaria de esos turnantes físicos (jornada TOTAL_SEMANAL,
 *     sin recargos/horas extra) alcanza a cubrirlas. Si no alcanza, el
 *     residuo se reporta explícitamente — nunca se inventa una
 *     programación ficticia ni se estima un costo externo para taparlo.
 *
 * Módulo puro — sin fetch, sin Prisma, sin React. El llamador decide qué
 * hacer con el resultado (crear/actualizar/eliminar las líneas de turnante
 * correspondientes).
 */
import type { DiaSemanaHorario, DistribucionHorarioConfigurada, DiasJornada } from '../horarios/tipos';
import { calcularHorario } from '../horarios/normalizador-horario';
import { LIMITE_HORAS_SEMANALES_TOTAL_SEMANAL } from '../horarios/captura-total-semanal';
import { NOCTURNO_INICIO_HORA, NOCTURNO_FIN_HORA } from '../motor-distribuido/tipos';

// ─── Configuración central — nunca hardcodear estos números en componentes de interfaz ──

/** Días que debe cubrir el servicio para que exista necesidad de relevo (7 = todos los días de la semana). */
export const DIAS_COBERTURA_SEMANAL_ESTANDAR = 7;
/** Días que trabaja el titular de una posición elegible antes de su descanso obligatorio (6 → 1 día de descanso/semana). */
export const DIAS_TRABAJADOS_POR_EMPLEADO_ESTANDAR = 6;
/** Ajuste "AJUSTAR INTEGRALMENTE EL MOTOR Y LAS FICHAS DE TURNANTES" — YA
 * NO participa del cálculo de `cantidadTurnantesFisicos` (antes: "un solo
 * turnante puede cubrir el descanso de hasta 6 posiciones distintas,
 * compartiendo capacidad" — reemplazado por el cálculo por posición, ver
 * `calcularNecesidadTurnantes`). Se conserva únicamente por compatibilidad
 * de forma de `ConfiguracionCalculoTurnantes`. */
export const DIAS_TRABAJADOS_POR_TURNANTE_ESTANDAR = 6;
/** Corrección "REGLA DE NEGOCIO — HORAS DEL TURNANTE" — cada descanso
 * cubierto por un turnante equivale SIEMPRE a esta cantidad fija de horas
 * efectivas, sin importar la duración real programada del día que cubre
 * (una programación de 06:00-14:00, de 12h de amplitud, o cualquier otra,
 * NUNCA sustituye este valor). Única fuente de verdad — nunca hardcodear
 * "7" en page.tsx ni en ningún otro punto del cálculo. */
export const HORAS_EFECTIVAS_DESCANSO_TURNANTE = 7;

export interface ConfiguracionCalculoTurnantes {
  diasCoberturaSemanal: number;
  diasTrabajadosPorEmpleado: number;
  diasTrabajadosPorTurnante: number;
  /** Jornada semanal ordinaria (horas) con la que se costea cada turnante
   * físico — la misma jornada TOTAL_SEMANAL ya usada al crear la línea
   * automática (LIMITE_HORAS_SEMANALES_TOTAL_SEMANAL, nunca 44
   * hardcodeado). Determina la CAPACIDAD ordinaria costeable, no la
   * cantidad física de turnantes. */
  jornadaTurnanteHoras: number;
  /** Corrección "REGLA DE NEGOCIO — HORAS DEL TURNANTE" — horas efectivas
   * que la empresa reconoce por CADA descanso cubierto (default
   * HORAS_EFECTIVAS_DESCANSO_TURNANTE=7). Se usa TAL CUAL, siempre —
   * nunca se deriva de `minutosPorDia` (la duración real programada del
   * día sigue usándose para cobertura del servicio/recargos/horas extra
   * del cargo principal, pero NUNCA sustituye este valor para el
   * relevo del turnante), salvo que una excepción empresarial
   * expresamente configurada (fuera de alcance de esta corrección) lo
   * anule para un caso puntual. */
  horasEfectivasDescansoTurnante: number;
}

export const CONFIGURACION_TURNANTES_DEFAULT: ConfiguracionCalculoTurnantes = {
  diasCoberturaSemanal: DIAS_COBERTURA_SEMANAL_ESTANDAR,
  diasTrabajadosPorEmpleado: DIAS_TRABAJADOS_POR_EMPLEADO_ESTANDAR,
  diasTrabajadosPorTurnante: DIAS_TRABAJADOS_POR_TURNANTE_ESTANDAR,
  jornadaTurnanteHoras: LIMITE_HORAS_SEMANALES_TOTAL_SEMANAL,
  horasEfectivasDescansoTurnante: HORAS_EFECTIVAS_DESCANSO_TURNANTE,
};

const TODOS_LOS_DIAS: readonly DiaSemanaHorario[] = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

/**
 * true si la unión de días de todas las distribuciones de un cargo cubre
 * los 7 días de la semana — la única señal estructural de "el servicio no
 * puede quedar descubierto". Nunca examina texto libre.
 */
export function cubreSieteDiasSemana(diasSemanaUnion: readonly DiaSemanaHorario[]): boolean {
  const presentes = new Set(diasSemanaUnion);
  return TODOS_LOS_DIAS.every((d) => presentes.has(d));
}

/**
 * Resuelve si una posición requiere cobertura de descanso: el override
 * manual del usuario (checkbox "Requiere cobertura de descanso") siempre
 * gana sobre la detección automática cuando está definido — nunca se
 * ignora una corrección explícita del usuario.
 */
export function resolverRequiereCoberturaDescanso(
  deteccionAutomatica: boolean,
  overrideManual: boolean | null | undefined,
): boolean {
  return overrideManual ?? deteccionAutomatica;
}

// ─── §3 Horarios no homogéneos — minutos por día, nunca un promedio disfrazado de dato exacto ──

const DIAS_JORNADA_DUMMY: DiasJornada = { lun: false, mar: false, mie: false, jue: false, vie: false, sab: false, dom: false, fes: false };

/**
 * Minutos programados de UNA posición, por cada día de la semana (L..D).
 * Fuente estructural única para derivar la duración diaria del relevo —
 * nunca un valor digitado aparte.
 *
 * - HORARIO_DETALLADO: usa los bloques reales de cada distribución
 *   (`calcularHorario`, ya existente), sumados por día — puede producir
 *   duraciones DISTINTAS entre días (ej. L-V 8h, Sáb 6h, Dom 4h).
 * - TOTAL_SEMANAL: no tiene desglose diario real (el usuario solo captura
 *   un total semanal) — se reparte uniformemente entre los días
 *   seleccionados, que por construcción produce un resultado homogéneo
 *   (ver `esHorarioHomogeneo`).
 */
export function calcularMinutosPorDiaSemana(
  distribuciones: readonly DistribucionHorarioConfigurada[],
): Record<DiaSemanaHorario, number> {
  const minutosPorDia: Record<DiaSemanaHorario, number> = { L: 0, M: 0, X: 0, J: 0, V: 0, S: 0, D: 0 };
  for (const d of distribuciones) {
    if (d.tipoCapturaHorario === 'TOTAL_SEMANAL') {
      const totalMin = Math.round((d.horasSemanalesManual || 0) * 60);
      const dias = d.diasSemana;
      if (dias.length === 0) continue;
      const minPorDia = totalMin / dias.length;
      for (const dia of dias) minutosPorDia[dia] += minPorDia;
      continue;
    }
    if (d.bloques.length === 0) continue;
    const minutosDia = calcularHorario(d.bloques, DIAS_JORNADA_DUMMY).minutosDiarios;
    for (const dia of d.diasSemana) minutosPorDia[dia] += minutosDia;
  }
  return minutosPorDia;
}

/** true únicamente si los 7 días tienen exactamente la misma duración —
 * es la única condición bajo la cual `minutosSemana/7` es un dato EXACTO
 * de la duración diaria del relevo, no una aproximación. */
export function esHorarioHomogeneo(minutosPorDia: Record<DiaSemanaHorario, number>): boolean {
  const valores = TODOS_LOS_DIAS.map((d) => minutosPorDia[d]);
  return valores.every((v) => v === valores[0]);
}

/** Corrección "REGLA DE NEGOCIO — HORAS DEL TURNANTE" — la duración
 * diaria del relevo es SIEMPRE `horasEfectivasDescansoMin` (fija, por
 * defecto HORAS_EFECTIVAS_DESCANSO_TURNANTE=7h=420min) — deliberadamente
 * NUNCA se deriva de `minutosPorDia` (la programación real del día): una
 * programación de 06:00-14:00 (8h) o de 12h de amplitud NUNCA cambia este
 * valor. `minutosPorDia` sigue existiendo y usándose para otros fines
 * (cobertura del servicio, recargos, horas extra del cargo principal,
 * agrupación por compatibilidad) — solo deja de intervenir en ESTE
 * cálculo específico. */
function duracionDiariaRelevo(horasEfectivasDescansoMin: number): number {
  return horasEfectivasDescansoMin;
}

export type MetodoCalculoRelevo = 'EXACTO' | 'PROMEDIO_PENDIENTE_ASIGNACION_DESCANSOS';

export interface PosicionParaTurnante {
  id: string;
  /** Cantidad de posiciones/puestos simultáneos de esta línea (nunca personas físicas per se — mismo criterio que el resto del motor). */
  cantidad: number;
  requiereCoberturaDescanso: boolean;
  /** Minutos programados por cada día de la semana (§3) — fuente de la
   * duración diaria del relevo, nunca un total semanal ciego. */
  minutosPorDia: Record<DiaSemanaHorario, number>;
}

export type EstadoCoberturaTurnantes =
  | 'SIN_NECESIDAD'
  | 'COBERTURA_COMPLETA'
  | 'COBERTURA_PARCIAL_PENDIENTE_PROGRAMACION';

/** §4 — el costo mensual ya calculado con el motor real SOLO cubre la
 * capacidad ordinaria; mientras exista un residuo de horas sin programar,
 * ese costo es preliminar/incompleto y NUNCA debe presentarse como el
 * costo contractual completo. */
export type EstadoCostoTurnantes = 'COSTO_COMPLETO' | 'COSTO_PRELIMINAR_COBERTURA_INCOMPLETA';

export interface ResultadoNecesidadTurnantes {
  posicionesElegibles: number;
  diasDescansoPorPosicion: number;
  descansosSemanalesACubrir: number;
  /** Horas de relevo semanales necesarias, en minutos — Σ(cantidad ×
   * diasDescansoPorPosicion × duración diaria del turno de esa posición). */
  minutosRelevoSemanales: number;
  horasRelevoSemanales: number;
  /** 'EXACTO' solo si TODAS las posiciones que aportan a este resultado
   * tienen horario homogéneo (§3) — si alguna no lo es, 'PROMEDIO_
   * PENDIENTE_ASIGNACION_DESCANSOS' y `minutosRelevoSemanales` es una
   * ESTIMACIÓN, nunca un dato exacto. */
  metodoCalculoRelevo: MetodoCalculoRelevo;
  /** Cantidad física derivada EXCLUSIVAMENTE de la restricción de 6 días
   * (regla de dimensionamiento física, sin cambios, nunca reemplazada).
   * Calculada DENTRO de este grupo — nunca globalmente (§1). */
  cantidadTurnantesPorDias: number;
  /** En esta fase, igual a cantidadTurnantesPorDias — se conserva como
   * campo propio para no acoplar el dimensionamiento físico futuro (p.ej.
   * si se decide escalar por horas) a este nombre. */
  cantidadTurnantesFisicos: number;
  /** Capacidad ordinaria costeable con los turnantes físicos, en minutos
   * (cantidadTurnantesFisicos × jornadaTurnanteHoras × 60) — SIN recargos
   * ni horas extra, porque la línea automática se liquida en TOTAL_SEMANAL. */
  capacidadOrdinariaMinutos: number;
  /** min(minutosRelevoSemanales, capacidadOrdinariaMinutos) — horas de
   * relevo REALMENTE cubiertas por la capacidad ordinaria contratada de
   * los turnantes físicos (Modelo A — turno completo, sin costeo
   * proporcional). Nunca mayor que la necesidad ni que la capacidad. */
  capacidadUtilizadaMinutos: number;
  horasCapacidadUtilizada: number;
  /** max(0, capacidadOrdinariaMinutos - capacidadUtilizadaMinutos) —
   * capacidad OCIOSA de los turnantes físicos ya contratados: horas que
   * se están pagando (Modelo A cobra el turnante completo) pero que la
   * necesidad actual no ocupa. Distinto de `horasResiduales` (déficit,
   * abajo) — nunca deben confundirse: uno es sobra de capacidad pagada,
   * el otro es demanda sin cubrir. */
  capacidadDisponibleMinutos: number;
  horasCapacidadDisponible: number;
  /** capacidadUtilizadaMinutos / capacidadOrdinariaMinutos × 100,
   * redondeado a 2 decimales — 0 si no hay capacidad contratada
   * (cantidadTurnantesFisicos=0). Referencia de eficiencia del Modelo A
   * (turno completo): cuánto de lo que se está pagando realmente se usa. */
  porcentajeUtilizacion: number;
  /** max(0, minutosRelevoSemanales - capacidadOrdinariaMinutos) — DÉFICIT:
   * horas de relevo que EXCEDEN la capacidad ordinaria física contratada
   * y que, por tanto, NO quedan costeadas. Representa únicamente demanda
   * sin cubrir — NUNCA "capacidad disponible" (ver `capacidadDisponibleMinutos`
   * arriba para ese concepto, que es el inverso). Nunca se estima ni se
   * costea automáticamente: requiere programación y/o definición
   * adicional por parte del usuario. */
  minutosResiduales: number;
  horasResiduales: number;
  /** true únicamente cuando minutosResiduales === 0 (sin déficit sobre la
   * capacidad contratada — no implica que la capacidad esté totalmente
   * utilizada, ver `porcentajeUtilizacion`). */
  coberturaCompleta: boolean;
  estadoCobertura: EstadoCoberturaTurnantes;
  /** §4 — estado del COSTO ya calculado (no de la cobertura de horas en sí
   * misma): 'COSTO_PRELIMINAR_COBERTURA_INCOMPLETA' en cuanto
   * `coberturaCompleta` sea false y existan posiciones elegibles —
   * nunca se declara 'COSTO_COMPLETO' mientras haya una brecha. */
  estadoCosto: EstadoCostoTurnantes;
  advertencias: string[];
  /** Ajuste "DETECCIÓN AUTOMÁTICA 21H/42H" — un bloque por LÍNEA de
   * turnante automática a generar (page.tsx), cada uno con su propia
   * jornada contratada (21h o 42h) resuelta por `resolverConfiguracionTurnantes`
   * sobre `horasRelevoSemanales`, capado a `cantidadTurnantesFisicos` (la
   * restricción física de 6 días nunca se excede generando más líneas de
   * las que esa regla permite — ver `calculo-turnantes.test.ts`, casos de
   * excepción empresarial). Longitud típica === cantidadTurnantesFisicos
   * cuando toda la demanda proviene de descansos de 7h fijas (caso
   * estándar); puede ser MENOR únicamente bajo una excepción de
   * `horasEfectivasDescansoTurnante` atípica, donde el remanente de horas
   * no cubierto por el tope físico se refleja en `horasResiduales`. */
  bloquesTurnantesContratados: BloqueTurnanteContratado[];
  /** Σ horasContratadas de `bloquesTurnantesContratados` — nunca sustituye
   * `capacidadOrdinariaMinutos`/60 (que sigue siendo
   * cantidadTurnantesFisicos×jornadaTurnanteHoras, la referencia histórica
   * de cobertura/déficit, sin cambios). */
  horasContratadasTotal: number;
  /** Jornada de referencia de tiempo completo (42h) — informativa,
   * documentada aquí para que page.tsx nunca la confunda con las horas
   * realmente contratadas de cada bloque. */
  capacidadReferenciaTiempoCompleto: number;
  /** Ajuste "AJUSTAR TURNANTES POR BLOQUES DE 21 Y 42 HORAS" —
   * `Math.floor(cantidadTurnantesFisicos/2)`: cuántos bloques INTEGRADOS
   * de 42h (2 turnantes de 21h emparejados) resultan de la cantidad física
   * real. Única fuente de esta cuenta — page.tsx la usa para dimensionar
   * `cantOpeFijos` de la línea automática de 42h, nunca recalculada ahí. */
  cantidadBloques42Turnantes: number;
  /** `cantidadTurnantesFisicos % 2` (0 o 1) — turnante individual que NO
   * alcanza a emparejarse en un bloque de 42h y debe liquidarse con el
   * motor ordinario de 21h (nunca con el 50% lineal del bloque de 42h,
   * ver `resolverComposicionTurnantes`). */
  cantidadRemanentes21Turnantes: number;
}

/** Ajuste "AJUSTAR TURNANTES POR BLOQUES DE 21 Y 42 HORAS" §2 — descompone
 * la cantidad FÍSICA de turnantes (ya calculada por `calcularNecesidadTurnantes`,
 * sin cambios) en bloques integrados de 42h (pares) y, a lo sumo, un
 * remanente individual de 21h. Pura aritmética entera — reutilizada tanto
 * por `calcularNecesidadTurnantes` (para exponer el conteo en el
 * resultado) como por `sincronizarLineasTurnantesAutomaticas` (para
 * dimensionar `cantOpeFijos` de cada línea automática), nunca duplicada. */
export function resolverConteoBloquesTurnantes(cantidadTurnantesFisicos: number): {
  cantidadBloques42: number;
  cantidadRemanentes21: number;
  horasContratadasTotales: number;
} {
  const n = Math.max(0, Math.trunc(cantidadTurnantesFisicos));
  const cantidadBloques42 = Math.floor(n / 2);
  const cantidadRemanentes21 = n % 2;
  const horasContratadasTotales = cantidadBloques42 * CAPACIDAD_REFERENCIA_TIEMPO_COMPLETO + cantidadRemanentes21 * JORNADA_MEDIO_TIEMPO;
  return { cantidadBloques42, cantidadRemanentes21, horasContratadasTotales };
}

export interface ComposicionTurnantes {
  cantidadTurnantesFisicos: number;
  cantidadBloques42: number;
  cantidadRemanentes21: number;
  horasContratadasTotales: number;
  costoBloques42: number;
  costoRemanentes21: number;
  costoTotal: number;
}

/**
 * Ajuste "AJUSTAR TURNANTES POR BLOQUES DE 21 Y 42 HORAS" §6 — composición
 * ECONÓMICA final de un grupo de turnantes, a partir de costos YA
 * calculados por los motores reales (nunca una fórmula manual de salario/
 * prestaciones/seguridad social/parafiscales aquí):
 *  - `costoBloques42`: costo YA correcto de TODOS los bloques integrados
 *    (la línea automática de 42h liquidada con `cantOpeFijos=cantidadBloques42`
 *    — el motor ordinario, sin escalar).
 *  - `costoRemanentes21`: costo YA correcto del remanente individual (la
 *    línea automática de 21h liquidada con `cantOpeFijos=cantidadRemanentes21`
 *    (0 o 1) — el motor ordinario de 21h, sin escalar, nunca la mitad
 *    lineal del bloque de 42h).
 * Esta función SOLO suma — nunca multiplica por un factor de jornada ni
 * reconstruye un costo unitario: como cada línea ya trae su propio
 * `cantOpeFijos` correctamente dimensionado (ver `sincronizarLineasTurnantesAutomaticas`),
 * `costoBloques42`/`costoRemanentes21` son SIEMPRE el costo total de esa
 * porción, no un costo "por bloque" que haya que multiplicar de nuevo.
 */
export function resolverComposicionTurnantes(params: {
  cantidadTurnantesFisicos: number;
  costoBloques42: number;
  costoRemanentes21: number;
}): ComposicionTurnantes {
  const { cantidadTurnantesFisicos, costoBloques42, costoRemanentes21 } = params;
  const { cantidadBloques42, cantidadRemanentes21, horasContratadasTotales } = resolverConteoBloquesTurnantes(cantidadTurnantesFisicos);
  return {
    cantidadTurnantesFisicos, cantidadBloques42, cantidadRemanentes21, horasContratadasTotales,
    costoBloques42, costoRemanentes21, costoTotal: costoBloques42 + costoRemanentes21,
  };
}

function resolverEstadoCosto(coberturaCompleta: boolean): EstadoCostoTurnantes {
  return coberturaCompleta ? 'COSTO_COMPLETO' : 'COSTO_PRELIMINAR_COBERTURA_INCOMPLETA';
}

// ─── Ajuste "EL MOTOR DEBE DETECTAR AUTOMÁTICAMENTE SI EL TURNANTE ES DE 21
//      O 42 HORAS" — política central de jornada CONTRATADA por turnante,
//      derivada ÚNICAMENTE de la demanda de horas de relevo (nunca de un
//      campo manual "medio tiempo"). Aditiva: no reemplaza
//      `capacidadOrdinariaMinutos`/`cantidadTurnantesFisicos` (regla de 6
//      días, documentada como "SIN CAMBIOS, nunca reemplazada" — casos de
//      excepción empresarial con `horasEfectivasDescansoTurnante` atípico
//      siguen limitados por esa restricción física, ver
//      calculo-turnantes.test.ts). Estos campos solo alimentan la
//      GENERACIÓN de líneas automáticas en page.tsx (una línea por bloque,
//      cada una con su propia jornada contratada 21h/42h), nunca el
//      cálculo de cobertura/déficit existente. ──

/** Un turnante físico y las horas que tiene REALMENTE contratadas (21 o 42
 * — nunca un valor intermedio: son las únicas dos jornadas de referencia
 * que reconoce la política). */
export interface BloqueTurnanteContratado {
  /** Ajuste "CERRAR DEFINITIVAMENTE LA LÓGICA DE TURNANTES" §4/§6 — ya NO
   * limitado a 21|42: la modalidad HORAS_REALES puede contratar cualquier
   * cantidad de horas reales de cobertura (7, 14, 28, etc.), nunca
   * redondeada a un bloque de 21/42h. Los bloques de la excepción de 12h
   * SIGUEN siendo siempre 21 o 42 (ver `resolverConteoBloquesTurnantes`),
   * pero el tipo ya no lo exige a nivel de compilador. */
  horasContratadas: number;
}

/** Jornada de referencia de tiempo completo — informativa, NUNCA sustituye
 * las horas realmente contratadas de cada bloque (§3 del ajuste). */
export const CAPACIDAD_REFERENCIA_TIEMPO_COMPLETO = 42;
export const JORNADA_MEDIO_TIEMPO = 21;

// ─── Ajuste "CORREGIR DEFINITIVAMENTE EL CÁLCULO PROPORCIONAL DE
//      TURNANTES" ───────────────────────────────────────────────────────
// §1 — el costo de la modalidad HORAS_REALES (horario que NO es la
// excepción de 12h) NUNCA construye una posición laboral nueva vía el
// motor ordinario (eso reintroduce bases mínimas/auxilios completos que no
// corresponden a una fracción de jornada) — se deriva PROPORCIONALMENTE
// del costo laboral total de una posición de referencia de 42h del MISMO
// cargo/configuración, dividido entre el máximo de días laborales (6):
// una posición de 42h equivale a 6 días × 7h/día.
export const DIAS_MAXIMOS_REFERENCIA_TURNANTE = DIAS_TRABAJADOS_POR_EMPLEADO_ESTANDAR;
export const HORAS_POR_DIA_REFERENCIA_TURNANTE = CAPACIDAD_REFERENCIA_TIEMPO_COMPLETO / DIAS_MAXIMOS_REFERENCIA_TURNANTE;

/** Días equivalentes de relevo — horasCobertura÷7 (nunca fracciones de día
 * inventadas: es simplemente la misma cobertura expresada en unidades de
 * "días de referencia" en vez de horas). */
export function calcularDiasEquivalentesTurnante(horasCobertura: number): number {
  return horasCobertura / HORAS_POR_DIA_REFERENCIA_TURNANTE;
}

/** Fracción de la ficha de 42h que corresponde a `horasCobertura` —
 * equivalente a `diasEquivalentes/6` y a `horasCobertura/42` (misma
 * fórmula, dos formas de leerla, NUNCA dos cálculos distintos). */
export function calcularFactorProporcionalTurnante(horasCobertura: number): number {
  return calcularDiasEquivalentesTurnante(horasCobertura) / DIAS_MAXIMOS_REFERENCIA_TURNANTE;
}

/** Costo proporcional canónico — SIEMPRE a partir del costo YA calculado
 * de la ficha de referencia de 42h (motor real, nunca reconstruido aquí),
 * multiplicado por el factor proporcional. Redondeo HALF_UP final único
 * (nunca se sume conceptos ya redondeados por separado para obtener este
 * total). */
export function calcularCostoProporcionalTurnante(costoLaboralTotalReferencia42h: number, horasCobertura: number): number {
  return Math.round(costoLaboralTotalReferencia42h * calcularFactorProporcionalTurnante(horasCobertura));
}

/**
 * §1/§2 — clasifica la demanda total de relevo (Σ horas de TODAS las
 * programaciones del grupo, nunca una sola fila) en la jornada contratada
 * que corresponde, generando tantos bloques de 42h como haga falta y
 * resolviendo el remanente con un único bloque final (21h o 42h):
 *   0h                  → sin turnante (arreglo vacío)
 *   (0h, 21h]           → [21h]
 *   (21h, 42h]          → [42h]
 *   (42h, ∞)            → N bloques de 42h + resolución del remanente
 *
 * Ejemplo: 63h → [42h, 21h] (42h agotan el primer bloque, el remanente de
 * 21h resuelve como medio tiempo — nunca como un tercer bloque ni como un
 * bloque de 42h con capacidad ociosa de 21h).
 */
export function resolverConfiguracionTurnantes(horasRelevoRequeridas: number): BloqueTurnanteContratado[] {
  if (!(horasRelevoRequeridas > 0)) return [];
  const bloques: BloqueTurnanteContratado[] = [];
  let restante = horasRelevoRequeridas;
  while (restante > CAPACIDAD_REFERENCIA_TIEMPO_COMPLETO) {
    bloques.push({ horasContratadas: CAPACIDAD_REFERENCIA_TIEMPO_COMPLETO });
    restante -= CAPACIDAD_REFERENCIA_TIEMPO_COMPLETO;
  }
  bloques.push({ horasContratadas: restante > JORNADA_MEDIO_TIEMPO ? CAPACIDAD_REFERENCIA_TIEMPO_COMPLETO : JORNADA_MEDIO_TIEMPO });
  return bloques;
}

/**
 * Única fuente de cálculo de la necesidad de turnantes (cantidad física Y
 * validación de horas) para un conjunto de posiciones YA homogéneo en
 * CONFIGURACIÓN LABORAL (ver `construirGruposNecesidadTurnantes` para el
 * agrupamiento por configuración compatible) — el resultado de esta
 * función es SIEMPRE el de UN grupo, nunca un cálculo global mezclando
 * grupos incompatibles (§1). Para combinar varios grupos en un resumen
 * visual, usar `agregarNecesidadesTurnantes`.
 *
 * Regla de dimensionamiento físico (Ajuste "AJUSTAR INTEGRALMENTE EL MOTOR
 * Y LAS FICHAS DE TURNANTES" — reemplaza la antigua "regla de 6 días", que
 * fusionaba varias posiciones en un solo turnante de tiempo completo,
 * perdiendo la cantidad real de personas/contratos):
 *   posicionesElegibles = Σ cantidad de posiciones con requiereCoberturaDescanso
 *   diasDescansoPorPosicion = diasCoberturaSemanal - diasTrabajadosPorEmpleado
 *   coberturaPorPosicionHoras = diasDescansoPorPosicion × horasEfectivasDescansoTurnante
 *   contratosPorUnaPosicion = resolverConfiguracionTurnantes(coberturaPorPosicionHoras)
 *     (típicamente 1 contrato de 21h — la MISMA función pura ya usada para
 *     descomponer horas de relevo en bloques de 21h/42h, nunca una fórmula
 *     nueva)
 *   cantidadTurnantesFisicos = contratosPorUnaPosicion.length × posicionesElegibles
 * Cada posición elegible es INDEPENDIENTE — nunca se combinan primero
 * todas las horas del grupo para "convertirlas" en un solo equivalente de
 * tiempo completo. Caso reportado: 2 posiciones de 7h cada una son 2
 * turnantes de 21h (nunca 1 turnante de 42h) — la suma de horas (42h)
 * coincide, pero la cantidad FÍSICA de personas/contratos es distinta.
 *
 * Regla de horas del relevo (Corrección "REGLA DE NEGOCIO — HORAS DEL
 * TURNANTE", sin cambios): cada descanso cubierto equivale SIEMPRE a
 * `config.horasEfectivasDescansoTurnante` horas fijas (default
 * HORAS_EFECTIVAS_DESCANSO_TURNANTE=7) — la duración real programada del
 * día (`p.minutosPorDia`) NUNCA sustituye este valor para el relevo, sea
 * cual sea la amplitud del horario (06:00-14:00, un turno de 12h, etc.).
 * Por eso `metodoCalculoRelevo` es SIEMPRE 'EXACTO' — nunca un promedio
 * pendiente de definición:
 *   minutosRelevoSemanales = Σ (cantidad × diasDescansoPorPosicion × horasEfectivasDescansoTurnante × 60)
 *   capacidadOrdinariaMinutos = horasContratadasTotal × 60 (suma de los
 *     contratos individuales, cada uno a su propia jornada — nunca
 *     cantidadTurnantesFisicos×42h, que asumía a todos a tiempo completo)
 *   minutosResiduales = max(0, minutosRelevoSemanales - capacidadOrdinariaMinutos)
 *     — SIEMPRE 0 en este modelo: cada contrato, por construcción de
 *     `resolverConfiguracionTurnantes`, cubre POR COMPLETO su propia
 *     posición (nunca queda un déficit de capacidad compartida).
 */
export function calcularNecesidadTurnantes(
  posiciones: readonly PosicionParaTurnante[],
  config: ConfiguracionCalculoTurnantes = CONFIGURACION_TURNANTES_DEFAULT,
): ResultadoNecesidadTurnantes {
  const elegibles = posiciones.filter((p) => p.requiereCoberturaDescanso && p.cantidad > 0);

  const posicionesElegibles = elegibles.reduce((total, p) => total + Math.max(0, p.cantidad), 0);

  const diasDescansoPorPosicion = Math.max(0, config.diasCoberturaSemanal - config.diasTrabajadosPorEmpleado);
  const descansosSemanalesACubrir = posicionesElegibles * diasDescansoPorPosicion;

  // Corrección "REGLA DE NEGOCIO — HORAS DEL TURNANTE" — duración diaria
  // del relevo SIEMPRE fija (horasEfectivasDescansoTurnante), nunca
  // derivada de `p.minutosPorDia` — por tanto el cálculo es SIEMPRE
  // 'EXACTO', nunca un promedio pendiente de definición.
  const horasEfectivasDescansoMin = Math.round(config.horasEfectivasDescansoTurnante * 60);
  const metodoCalculoRelevo: MetodoCalculoRelevo = 'EXACTO';
  const minutosRelevoSemanalesExacto = elegibles.reduce((total, p) => {
    const duracionDiaria = duracionDiariaRelevo(horasEfectivasDescansoMin);
    return total + Math.max(0, p.cantidad) * diasDescansoPorPosicion * duracionDiaria;
  }, 0);
  const minutosRelevoSemanales = Math.round(minutosRelevoSemanalesExacto);
  const horasRelevoSemanales = minutosRelevoSemanales / 60;

  // Ajuste "AJUSTAR INTEGRALMENTE EL MOTOR Y LAS FICHAS DE TURNANTES"
  // (reemplaza la "regla de 6 días" como fuente de `cantidadTurnantesFisicos`
  // — SIN reemplazar `resolverConfiguracionTurnantes`, que se REUTILIZA sin
  // cambios) — la necesidad se calcula PRIMERO por posición, nunca
  // combinando primero todas las horas del grupo en un solo "equivalente
  // de tiempo completo": cada posición elegible, con su propia cobertura
  // (`coberturaPorPosicionHoras=diasDescansoPorPosicion×horasEfectivasDescansoTurnante`,
  // SIEMPRE la misma para todas las posiciones de un grupo — mismo config),
  // requiere `resolverConfiguracionTurnantes(coberturaPorPosicionHoras)`
  // contratos (típicamente 1 contrato de 21h). La cantidad física del
  // grupo es ese número de contratos × `posicionesElegibles` — NUNCA
  // `ceil(descansosSemanalesACubrir/6)` (esa fórmula fusionaba varias
  // posiciones en un solo turnante de tiempo completo, perdiendo la
  // multiplicidad real de personas/contratos — caso reportado: 2
  // posiciones de 7h cada una NO son "1 turnante de 42h", son "2
  // turnantes de 21h").
  const coberturaPorPosicionHoras = diasDescansoPorPosicion * config.horasEfectivasDescansoTurnante;
  const contratosPorUnaPosicion = resolverConfiguracionTurnantes(coberturaPorPosicionHoras);
  const cantidadTurnantesFisicos = contratosPorUnaPosicion.length * posicionesElegibles;
  // `cantidadTurnantesPorDias` se conserva por compatibilidad de forma
  // (mismo campo, mismo significado histórico "cantidad física") — ya no
  // es una fórmula de capacidad compartida independiente, es la MISMA
  // cantidad física recién calculada (nunca dos fuentes de verdad para
  // "cuántos turnantes físicos hay").
  const cantidadTurnantesPorDias = cantidadTurnantesFisicos;

  // Cada contrato garantiza, por construcción de `resolverConfiguracionTurnantes`,
  // cubrir POR COMPLETO la cobertura de su propia posición — la necesidad
  // YA NO puede quedar parcialmente sin cubrir por un tope de capacidad
  // compartida (ese tope, la "regla de 6 días", queda retirado del cálculo
  // de costo/cantidad). `capacidadOrdinariaMinutos` pasa a representar la
  // capacidad REAL contratada (suma de los contratos individuales, cada
  // uno a su propia jornada 21h/42h), nunca `cantidadTurnantesFisicos×42h`
  // (que asumía TODOS los turnantes a tiempo completo).
  const bloquesTurnantesContratados: BloqueTurnanteContratado[] = Array.from(
    { length: posicionesElegibles },
    () => contratosPorUnaPosicion,
  ).flat();
  const horasContratadasTotal = bloquesTurnantesContratados.reduce((s, b) => s + b.horasContratadas, 0);
  const capacidadOrdinariaMinutos = Math.round(horasContratadasTotal * 60);
  const capacidadUtilizadaMinutos = Math.min(minutosRelevoSemanales, capacidadOrdinariaMinutos);
  const capacidadDisponibleMinutos = Math.max(0, capacidadOrdinariaMinutos - capacidadUtilizadaMinutos);
  const porcentajeUtilizacion = capacidadOrdinariaMinutos > 0
    ? Math.round((capacidadUtilizadaMinutos / capacidadOrdinariaMinutos) * 10000) / 100
    : 0;
  const minutosResiduales = Math.max(0, minutosRelevoSemanales - capacidadOrdinariaMinutos);
  const horasResiduales = minutosResiduales / 60;
  const coberturaCompleta = minutosResiduales === 0;

  const estadoCobertura: EstadoCoberturaTurnantes = posicionesElegibles === 0
    ? 'SIN_NECESIDAD'
    : (coberturaCompleta ? 'COBERTURA_COMPLETA' : 'COBERTURA_PARCIAL_PENDIENTE_PROGRAMACION');

  const advertencias: string[] = [];
  if (posicionesElegibles > 0 && !coberturaCompleta) {
    advertencias.push(
      `Quedan ${horasResiduales}h semanales de relevo sin programar: la capacidad ordinaria de ${cantidadTurnantesFisicos} turnante(s) físico(s) (${capacidadOrdinariaMinutos / 60}h) no cubre las ${horasRelevoSemanales}h de relevo requeridas. El costo mostrado es PRELIMINAR (COSTO_PRELIMINAR_COBERTURA_INCOMPLETA) — estas horas requieren programación/horario adicional y pasarán por el mismo motor una vez definidas; no se estiman ni se costean automáticamente.`,
    );
  }

  // Ajuste "AJUSTAR TURNANTES POR BLOQUES DE 21 Y 42 HORAS" §2 — descompone
  // la cantidad física en bloques integrados de 42h (pares) + a lo sumo un
  // remanente individual de 21h; NUNCA sustituye `cantidadTurnantesFisicos`
  // (la cantidad física sigue siendo la misma), solo informa cómo debe
  // FACTURARSE cada turnante.
  const { cantidadBloques42, cantidadRemanentes21 } = resolverConteoBloquesTurnantes(cantidadTurnantesFisicos);

  return {
    posicionesElegibles, diasDescansoPorPosicion, descansosSemanalesACubrir,
    minutosRelevoSemanales, horasRelevoSemanales, metodoCalculoRelevo,
    cantidadTurnantesPorDias, cantidadTurnantesFisicos,
    capacidadOrdinariaMinutos,
    capacidadUtilizadaMinutos, horasCapacidadUtilizada: capacidadUtilizadaMinutos / 60,
    capacidadDisponibleMinutos, horasCapacidadDisponible: capacidadDisponibleMinutos / 60,
    porcentajeUtilizacion,
    minutosResiduales, horasResiduales,
    coberturaCompleta, estadoCobertura, estadoCosto: resolverEstadoCosto(coberturaCompleta),
    advertencias,
    bloquesTurnantesContratados, horasContratadasTotal,
    capacidadReferenciaTiempoCompleto: CAPACIDAD_REFERENCIA_TIEMPO_COMPLETO,
    cantidadBloques42Turnantes: cantidadBloques42, cantidadRemanentes21Turnantes: cantidadRemanentes21,
  };
}

export interface CoberturaPosicionTurnante {
  id: string;
  /** Demanda de relevo de ESTA posición sola — cantidad × diasDescansoPorPosicion × duración diaria del relevo. */
  minutosRelevoPosicion: number;
  /** Porción de esa demanda que efectivamente cae DENTRO de la capacidad
   * ordinaria contratada del grupo, siguiendo el orden determinístico de
   * `posiciones` (asignación "primero en la lista, primero cubierto" —
   * NUNCA aleatoria, NUNCA por tamaño). */
  minutosCubiertos: number;
  /** true ÚNICAMENTE cuando TODA la demanda de esta posición cae dentro de
   * la capacidad ya asignada en el orden determinístico — una posición
   * con cobertura PARCIAL (parte sí, parte no) se reporta como false: el
   * negocio pidió una etiqueta por línea, nunca "parcialmente cubierta"
   * mostrada como si fuera completa. */
  cubiertaCompleta: boolean;
}

/**
 * Corrección "VALIDAR LINEACUBIERTAPORTURNANTE" — reparte, en el orden
 * determinístico de `posiciones` (el mismo orden en que el caller las
 * pasa — en page.tsx, el orden de `lineasExtra`, estable entre renders),
 * la capacidad ordinaria YA calculada del grupo (misma fórmula de
 * `calcularNecesidadTurnantes`, sin cambios) entre las posiciones
 * elegibles, "primero en la lista, primero cubierto". Nunca reduce
 * proporcionalmente ni asigna por tamaño — asignación acumulativa simple.
 *
 * Uso: reemplaza la condición grupal booleana `cantidadTurnantesFisicos>0`
 * (que declaraba CUALQUIER línea del grupo como "cubierta" con solo que
 * el grupo tuviera algún turnante físico, sin importar si la capacidad
 * alcanzaba para TODAS) por una decisión POR POSICIÓN: una posición solo
 * se considera cubierta si, sumando las demandas de las posiciones que la
 * preceden en la lista, la capacidad restante todavía alcanza para toda
 * su propia demanda.
 */
/** Extraído para que la regla de compensación L-D/L-S (§14 del ajuste
 * "IMPLEMENTAR REGLA DE COMPENSACIÓN...") pueda repartir la cobertura entre
 * las posiciones L-D REALES usando una capacidad YA COMPENSADA (calculada
 * sobre `cantidadPosicionesQueRequierenTurnante`, nunca sobre la demanda
 * bruta de las posiciones L-D) — sin duplicar esta lógica de reparto. */
function distribuirCoberturaPorPosicion(
  posiciones: readonly PosicionParaTurnante[],
  capacidadOrdinariaMinutos: number,
  diasDescansoPorPosicion: number,
  horasEfectivasDescansoMin: number,
): CoberturaPosicionTurnante[] {
  let acumuladoMin = 0;
  const resultado: CoberturaPosicionTurnante[] = [];
  for (const p of posiciones) {
    if (!p.requiereCoberturaDescanso || p.cantidad <= 0) continue;
    const duracionDiaria = duracionDiariaRelevo(horasEfectivasDescansoMin);
    const minutosRelevoPosicion = Math.round(Math.max(0, p.cantidad) * diasDescansoPorPosicion * duracionDiaria);
    const disponibleAntes = Math.max(0, capacidadOrdinariaMinutos - acumuladoMin);
    const minutosCubiertos = Math.min(minutosRelevoPosicion, disponibleAntes);
    resultado.push({
      id: p.id,
      minutosRelevoPosicion,
      minutosCubiertos,
      cubiertaCompleta: minutosRelevoPosicion > 0 && minutosCubiertos === minutosRelevoPosicion,
    });
    acumuladoMin += minutosRelevoPosicion;
  }
  return resultado;
}

export function calcularCoberturaPorPosicion(
  posiciones: readonly PosicionParaTurnante[],
  config: ConfiguracionCalculoTurnantes = CONFIGURACION_TURNANTES_DEFAULT,
): CoberturaPosicionTurnante[] {
  const necesidad = calcularNecesidadTurnantes(posiciones, config);
  const horasEfectivasDescansoMin = Math.round(config.horasEfectivasDescansoTurnante * 60);
  return distribuirCoberturaPorPosicion(posiciones, necesidad.capacidadOrdinariaMinutos, necesidad.diasDescansoPorPosicion, horasEfectivasDescansoMin);
}

// ─── Ajuste "IMPLEMENTAR REGLA DE COMPENSACIÓN ENTRE POSICIONES DE LUNES A
//      DOMINGO Y POSICIONES EQUIVALENTES DE LUNES A SÁBADO" ────────────────
// Clasificación de patrón de días PURAMENTE por `minutosPorDia` (nunca por
// texto visible "Lunes a Domingo"/"Lunes a Sábado") — reutiliza el mismo
// dato ya calculado por `calcularMinutosPorDiaSemana` (§3), sin volver a
// leer `diasSemana` de las distribuciones crudas.

/** true únicamente si TODOS los 7 días tienen minutos programados (>0) —
 * un día "vacío" (0 min) rompe la clasificación, nunca se asume trabajado. */
export function esProgramacionLunesADomingo(minutosPorDia: Record<DiaSemanaHorario, number>): boolean {
  return TODOS_LOS_DIAS.every((d) => minutosPorDia[d] > 0);
}

/** true únicamente si L-M-X-J-V-S tienen minutos (>0) Y domingo es
 * EXACTAMENTE 0 — una programación L-V (sin sábado) NUNCA se clasifica
 * como L-S: el sábado debe estar efectivamente trabajado. */
export function esProgramacionLunesASabado(minutosPorDia: Record<DiaSemanaHorario, number>): boolean {
  const diasLunesASabado: readonly DiaSemanaHorario[] = ['L', 'M', 'X', 'J', 'V', 'S'];
  return diasLunesASabado.every((d) => minutosPorDia[d] > 0) && minutosPorDia.D === 0;
}

/** Resultado de la compensación de UN grupo equivalente (§9 del ajuste) —
 * conserva trazabilidad completa (ids + totales antes/después de
 * compensar), nunca solo el número final. */
export interface CompensacionTurnantePorGrupo {
  claveGrupo: string;
  distribucionesLunesDomingo: string[];
  distribucionesLunesSabado: string[];
  totalPosicionesLunesDomingo: number;
  totalPosicionesLunesSabado: number;
  cantidadPosicionesQueRequierenTurnante: number;
}

/**
 * §1/§4 — agrupa y SUMA antes de restar (nunca resta fila por fila):
 *   totalPosicionesLunesDomingo = Σ cantidad de posicionesLunesDomingo
 *   totalPosicionesLunesSabado = Σ cantidad de posicionesLunesSabado
 *   cantidadPosicionesQueRequierenTurnante = max(totalLD - totalLS, 0)
 * Los arreglos de entrada YA deben venir filtrados/agrupados por el
 * llamador (`construirGruposNecesidadTurnantes`) a un único grupo
 * equivalente (mismo cargo, horario, salario, ARL, bonos, otros costos —
 * TODO igual salvo el patrón de días) — esta función nunca decide
 * equivalencia, solo suma y resta.
 */
export function calcularCompensacionLunesDomingoLunesSabado(
  claveGrupo: string,
  posicionesLunesDomingo: readonly PosicionParaTurnante[],
  posicionesLunesSabado: readonly PosicionParaTurnante[],
): CompensacionTurnantePorGrupo {
  const totalPosicionesLunesDomingo = posicionesLunesDomingo.reduce((s, p) => s + Math.max(0, p.cantidad), 0);
  const totalPosicionesLunesSabado = posicionesLunesSabado.reduce((s, p) => s + Math.max(0, p.cantidad), 0);
  return {
    claveGrupo,
    distribucionesLunesDomingo: posicionesLunesDomingo.map((p) => p.id),
    distribucionesLunesSabado: posicionesLunesSabado.map((p) => p.id),
    totalPosicionesLunesDomingo,
    totalPosicionesLunesSabado,
    cantidadPosicionesQueRequierenTurnante: Math.max(totalPosicionesLunesDomingo - totalPosicionesLunesSabado, 0),
  };
}

// ─── Ajuste "CERRAR DEFINITIVAMENTE LA LÓGICA DE TURNANTES" ────────────────
// §9 — la decisión de CÓMO facturar la cantidad ya compensada (L-D − L-S)
// NUNCA depende solo de si esa cantidad es 1 o ≥2: depende de si el
// horario es la excepción de negocio de 12h/día (única modalidad que sigue
// usando el paradigma de bloques 21/42h) o cualquier otra duración (motor
// ordinario a horas reales, nunca redondeado a 21h).
export type ModalidadCoberturaTurnante = 'HORAS_REALES' | 'INDIVIDUAL_ESPECIAL_21H' | 'INTEGRADO_42H';

/** §7 — condición ESTRUCTURAL (nunca por texto) de la excepción de negocio:
 * EXACTAMENTE 12h/día, los 7 días de la semana. Cualquier otra duración
 * (7h, 8h, 10h, etc.) sigue el caso general de horas reales. */
export function esHorarioDoceHorasLunesADomingo(minutosPorDia: Record<DiaSemanaHorario, number>): boolean {
  return TODOS_LOS_DIAS.every((d) => minutosPorDia[d] === 720);
}

/** §9/§11 — misma clave que `construirClaveCompatibilidadTurnante`, pero
 * SIN `horaInicioReferencia`: permite encontrar el horario COMPLEMENTARIO
 * (diurno↔nocturno) de la excepción de 12h para integrarlo en un único
 * bloque de 42h — la única situación donde dos horarios de reloj distintos
 * deben tratarse como una sola necesidad económica. Nunca se usa para
 * ninguna otra modalidad (HORAS_REALES nunca integra entre horarios). */
export function construirClaveIntegracion12Horas(p: PosicionElegibleTurnante): string {
  return [
    normalizarTextoParaClave(p.perfilCargo),
    normalizarSalarioParaClave(p.salarioBase),
    p.arlKey,
    normalizarMinutosSemanaParaClave(p.minutosPorDia),
    normalizarBonoParaClave(p.conBonoPrestacional, p.bonoPrestacionalValor),
    normalizarBonoParaClave(p.conBonoAlimentacion, p.bonoAlimentacionValor),
    normalizarBonoParaClave(p.conBonoTransporte, p.bonoTransporteValor),
    normalizarBonoParaClave(p.conBonoProductividad, p.bonoProductividadValor),
    normalizarBonoParaClave(p.conBonoOcasional, p.bonoOcasionalValor),
    String(Math.round(p.otrosCostosPorTrabajadorFirma)),
  ].join('|');
}

/** §6 — construye un `ResultadoNecesidadTurnantes` para la modalidad
 * HORAS_REALES directamente (nunca vía `calcularNecesidadTurnantes`, que
 * está atado al paradigma de bloques 21/42h y no puede representar horas
 * arbitrarias como 7 o 14). `cantidad` es la física YA compensada
 * (L-D − L-S); `horasCobertura` ya viene validado > 0 por el llamador. */
function construirNecesidadHorasReales(cantidad: number, horasCobertura: number): ResultadoNecesidadTurnantes {
  const horasContratadasTotal = cantidad * horasCobertura;
  const capacidadOrdinariaMinutos = Math.round(horasContratadasTotal * 60);
  return {
    posicionesElegibles: cantidad,
    diasDescansoPorPosicion: 0,
    descansosSemanalesACubrir: 0,
    minutosRelevoSemanales: capacidadOrdinariaMinutos,
    horasRelevoSemanales: horasContratadasTotal,
    metodoCalculoRelevo: 'EXACTO',
    cantidadTurnantesPorDias: cantidad,
    cantidadTurnantesFisicos: cantidad,
    capacidadOrdinariaMinutos,
    capacidadUtilizadaMinutos: capacidadOrdinariaMinutos,
    horasCapacidadUtilizada: horasContratadasTotal,
    capacidadDisponibleMinutos: 0,
    horasCapacidadDisponible: 0,
    porcentajeUtilizacion: 100,
    minutosResiduales: 0,
    horasResiduales: 0,
    coberturaCompleta: true,
    estadoCobertura: 'COBERTURA_COMPLETA',
    estadoCosto: 'COSTO_COMPLETO',
    advertencias: [],
    bloquesTurnantesContratados: Array.from({ length: cantidad }, () => ({ horasContratadas: horasCobertura })),
    horasContratadasTotal,
    capacidadReferenciaTiempoCompleto: CAPACIDAD_REFERENCIA_TIEMPO_COMPLETO,
    cantidadBloques42Turnantes: 0,
    cantidadRemanentes21Turnantes: 0,
  };
}

/** Reparto proporcional simple (mismo patrón "primero en la lista, primero
 * cubierto" que `distribuirCoberturaPorPosicion`, pero con demanda por
 * unidad FIJA — `minutosPorUnidad` — en vez de derivada de días de
 * descanso; usado por la modalidad HORAS_REALES). */
function distribuirCoberturaPorPosicionUnidadFija(
  posiciones: readonly PosicionParaTurnante[],
  capacidadOrdinariaMinutos: number,
  minutosPorUnidad: number,
): CoberturaPosicionTurnante[] {
  let acumuladoMin = 0;
  const resultado: CoberturaPosicionTurnante[] = [];
  for (const p of posiciones) {
    if (p.cantidad <= 0) continue;
    const minutosRelevoPosicion = Math.round(Math.max(0, p.cantidad) * minutosPorUnidad);
    const disponibleAntes = Math.max(0, capacidadOrdinariaMinutos - acumuladoMin);
    const minutosCubiertos = Math.min(minutosRelevoPosicion, disponibleAntes);
    resultado.push({
      id: p.id,
      minutosRelevoPosicion,
      minutosCubiertos,
      cubiertaCompleta: minutosRelevoPosicion > 0 && minutosCubiertos === minutosRelevoPosicion,
    });
    acumuladoMin += minutosRelevoPosicion;
  }
  return resultado;
}

// ─── §2 Agrupación por configuración laboral compatible ───────────────────

/** Todos los campos que cambian el costo mensual de la línea (o su
 * identidad funcional) — dos posiciones solo comparten un turnante cuando
 * TODOS coinciden. Si cualquiera difiere, se generan grupos separados
 * (nunca se mezclan en una sola línea). */
export interface PosicionElegibleTurnante extends PosicionParaTurnante {
  /** Salario de referencia de la posición que origina la cobertura. <=0 o
   * NaN se trata como "sin referencia válida" (el grupo hereda SMLMV). */
  salarioBase: number;
  arlKey: string;
  conBonoPrestacional: boolean;
  bonoPrestacionalValor: number;
  conBonoAlimentacion: boolean;
  bonoAlimentacionValor: number;
  conBonoTransporte: boolean;
  bonoTransporteValor: number;
  conBonoProductividad: boolean;
  bonoProductividadValor: number;
  conBonoOcasional: boolean;
  bonoOcasionalValor: number;
  /** Monto mensual POR TRABAJADOR de "otros costos" (dotación + EPP +
   * exámenes + cursos POR_TRABAJADOR + vacunas) ya asociados a esta
   * posición — calculado FUERA de este módulo (page.tsx, reutilizando
   * `construirDesgloseOtrosCostosLinea`, nunca una fórmula nueva).
   * Únicamente se usa aquí para comparar compatibilidad y para informar
   * el monto heredable — este módulo nunca lo suma al costo (el costo
   * real sigue viniendo exclusivamente del motor vía
   * `resultadosTurnantesConOtrosCostos`). */
  otrosCostosPorTrabajadorFirma: number;
  /** Ajuste "NO COMPARTIR TURNANTE ENTRE CARGOS DISTINTOS" (revierte
   * "BOLSA CONSOLIDADA DE CAPACIDAD", a pedido explícito del usuario) —
   * identificador normalizado del cargo/rol funcional que origina la
   * cobertura; SÍ forma parte de la clave de compatibilidad
   * (`construirClaveCompatibilidadTurnante`, abajo): dos posiciones de
   * cargos DISTINTOS NUNCA comparten turnante físico, aunque su
   * salario/ARL/bonos/horario sean idénticos — cada cargo tiene su propio
   * turnante dedicado, dimensionado únicamente por sus propias posiciones. */
  perfilCargo: string;
  /** Ajuste "IMPLEMENTAR REGLA DE COMPENSACIÓN..." §3/§7 — hora de inicio
   * del primer bloque de la posición (ej. "06:00"), o `''` si no aplica
   * (TOTAL_SEMANAL/sin bloques). `minutosPorDia` SOLO registra duración
   * diaria — sin este campo, dos turnos de igual duración a horas
   * distintas (diurno vs. nocturno) serían indistinguibles.
   * Participa en `construirClaveCompatibilidadTurnante` TAL CUAL (hora
   * exacta — regla económica de costeo, sin cambios). Ajuste
   * "COMPENSACIÓN POR MODALIDAD DIURNO/NOCTURNO": en
   * `construirClaveCompensacionTurnante` YA NO se compara como texto
   * exacto — se clasifica primero por MODALIDAD
   * (`clasificarModalidadTurnoParaCompensacion`, diurno/nocturno según la
   * ventana legal ya definida en `motor-distribuido/tipos.ts`), para que
   * dos turnos diurnos con horas de inicio distintas (ej. 07:00 y 11:00)
   * sí puedan compensarse, mientras que un diurno y un nocturno NUNCA lo
   * hacen, sin importar cuán cercanas parezcan sus horas de inicio. */
  horaInicioReferencia: string;
}

export interface GrupoNecesidadTurnantes {
  /** Clave estable — combina TODOS los campos de `PosicionElegibleTurnante`
   * relevantes para el costo (ver documentación de la función), normalizados
   * — usada para identificar el mismo grupo automático entre
   * resincronizaciones (nunca el índice del arreglo). */
  claveGrupo: string;
  /** Salario heredado del grupo de posiciones que origina la cobertura
   * cuando todas comparten salario válido; SMLMV (parámetro recibido) solo
   * cuando ninguna posición del grupo tiene una referencia salarial válida. */
  salarioBaseHeredado: number;
  huboReferenciaSalarialValida: boolean;
  arlKey: string;
  // Perfil heredado — mismo valor en todas las posiciones del grupo (por
  // construcción de la clave), tomado de la primera posición como
  // representante.
  conBonoPrestacional: boolean;
  bonoPrestacionalValor: number;
  conBonoAlimentacion: boolean;
  bonoAlimentacionValor: number;
  conBonoTransporte: boolean;
  bonoTransporteValor: number;
  conBonoProductividad: boolean;
  bonoProductividadValor: number;
  conBonoOcasional: boolean;
  bonoOcasionalValor: number;
  /** Monto mensual por trabajador de otros costos YA asociados a las
   * posiciones de este grupo — puramente informativo/heredable; page.tsx
   * decide si lo asigna realmente (clonando los ítems reales de
   * dotación/EPP/exámenes/cursos/vacunas) o si solo lo muestra como aviso
   * de "otros costos no incluidos automáticamente". Nunca se suma aquí. */
  otrosCostosPorTrabajadorHeredado: number;
  /** Cargo de la PRIMERA (y, desde el ajuste "NO COMPARTIR TURNANTE ENTRE
   * CARGOS DISTINTOS", ÚNICA) posición del grupo — `perfilCargo` forma
   * parte de la clave de compatibilidad, así que un grupo nunca mezcla
   * posiciones de cargos distintos. */
  perfilCargo: string;
  /** Lista única y ordenada de cargos (`perfilCargo` normalizado) cuyas
   * posiciones caen en este grupo — SIEMPRE longitud 1 desde el ajuste "NO
   * COMPARTIR TURNANTE ENTRE CARGOS DISTINTOS" (un grupo = un único
   * cargo); se conserva como arreglo por compatibilidad de forma con el
   * código que ya lo consume. */
  perfilesCargoIncluidos: string[];
  necesidad: ResultadoNecesidadTurnantes;
  /** Corrección "VALIDAR LINEACUBIERTAPORTURNANTE" — cobertura POR
   * POSICIÓN dentro de este grupo (`calcularCoberturaPorPosicion`, mismo
   * orden determinístico de entrada) — nunca una condición grupal única:
   * cuando la demanda del grupo excede su capacidad contratada
   * (`!necesidad.coberturaCompleta`), algunas posiciones sí quedan
   * cubiertas y otras no, en el orden en que se recibieron. */
  coberturaPorPosicion: CoberturaPosicionTurnante[];
  /** Ajuste "IMPLEMENTAR REGLA DE COMPENSACIÓN ENTRE POSICIONES DE LUNES A
   * DOMINGO Y POSICIONES EQUIVALENTES DE LUNES A SÁBADO" — trazabilidad
   * completa de la compensación que determinó la cantidad física de este
   * grupo (nunca perdida): totales L-D/L-S antes de restar, ids de origen,
   * y la diferencia final ya usada para dimensionar `necesidad`. */
  compensacion: CompensacionTurnantePorGrupo;
  /** Ajuste "CERRAR DEFINITIVAMENTE LA LÓGICA DE TURNANTES" §9/§12 —
   * modalidad de facturación de ESTE grupo (nunca "cualquier cobertura
   * positiva se convierte en 21h"):
   *  - 'HORAS_REALES': horario NO de 12h/día — el motor ordinario se
   *    invoca con `horasCoberturaPorPosicion` reales (7h, 14h, etc.).
   *  - 'INDIVIDUAL_ESPECIAL_21H'/'INTEGRADO_42H': excepción de negocio
   *    para horarios de EXACTAMENTE 12h/día L-D (`bloquesTurnantesContratados`
   *    sigue siendo 21/42h, igual que antes de este ajuste). */
  modalidadCobertura: ModalidadCoberturaTurnante;
  /** Horas reales de cobertura POR CADA turnante físico de este grupo —
   * SIEMPRE `horasContratadasTotal/cantidadTurnantesFisicos` (informativo,
   * consistente con `bloquesTurnantesContratados`). */
  horasCoberturaPorPosicion: number;
}

function normalizarSalarioParaClave(salarioBase: number): string {
  return salarioBase > 0 ? String(Math.round(salarioBase)) : 'SIN_REFERENCIA';
}
function normalizarBonoParaClave(activo: boolean, valor: number): string {
  return activo ? String(Math.round(valor)) : '0';
}
function normalizarTextoParaClave(s: string): string {
  return s.trim().toUpperCase() || 'SIN_PERFIL';
}
function normalizarMinutosSemanaParaClave(minutosPorDia: Record<DiaSemanaHorario, number>): string {
  return TODOS_LOS_DIAS.map((d) => Math.round(minutosPorDia[d])).join(',');
}
/** Ajuste "IMPLEMENTAR REGLA DE COMPENSACIÓN..." §4 — misma normalización
 * que `normalizarMinutosSemanaParaClave`, pero SIN domingo: es justamente
 * la diferencia de domingo lo que se necesita comparar (L-D vs L-S), así
 * que nunca puede formar parte de esta clave de equivalencia. */
function normalizarMinutosLunesASabadoParaClave(minutosPorDia: Record<DiaSemanaHorario, number>): string {
  const diasLunesASabado: readonly DiaSemanaHorario[] = ['L', 'M', 'X', 'J', 'V', 'S'];
  return diasLunesASabado.map((d) => Math.round(minutosPorDia[d])).join(',');
}

/** Construye la clave de compatibilidad de UNA posición — exportada para
 * que page.tsx (y las pruebas) puedan verificar/mostrar exactamente qué
 * campos la componen, sin duplicar la lógica de armado.
 *
 * Ajuste "NO COMPARTIR TURNANTE ENTRE CARGOS DISTINTOS" (revierte
 * "BOLSA CONSOLIDADA DE CAPACIDAD", a pedido explícito del usuario tras
 * observar que un cargo con menos posiciones terminaba mostrando un costo
 * de turnante distinto al que le correspondería solo — confuso e
 * indeseado) — `perfilCargo` (nombre del cargo) SÍ participa de esta
 * clave, primero en la lista: dos posiciones de cargos DISTINTOS NUNCA
 * comparten turnante físico, aunque su salario/ARL/bonos/otros
 * costos/horario sean IDÉNTICOS. Cada cargo se dimensiona (físicos,
 * jornada 21h/42h, costo) únicamente con sus propias posiciones. */
export function construirClaveCompatibilidadTurnante(p: PosicionElegibleTurnante): string {
  return [
    normalizarTextoParaClave(p.perfilCargo),
    normalizarSalarioParaClave(p.salarioBase),
    p.arlKey,
    normalizarMinutosSemanaParaClave(p.minutosPorDia),
    p.horaInicioReferencia || 'SIN_HORA',
    normalizarBonoParaClave(p.conBonoPrestacional, p.bonoPrestacionalValor),
    normalizarBonoParaClave(p.conBonoAlimentacion, p.bonoAlimentacionValor),
    normalizarBonoParaClave(p.conBonoTransporte, p.bonoTransporteValor),
    normalizarBonoParaClave(p.conBonoProductividad, p.bonoProductividadValor),
    normalizarBonoParaClave(p.conBonoOcasional, p.bonoOcasionalValor),
    String(Math.round(p.otrosCostosPorTrabajadorFirma)),
  ].join('|');
}

/**
 * Ajuste "COMPENSACIÓN POR MODALIDAD DIURNO/NOCTURNO" (confirmado
 * explícitamente, caso real TODERO-ALTURA: L-D 11:00-19:00 vs L-S
 * 07:00-15:00, ambos 7h efectivas, NUNCA compensaban por exigir
 * `horaInicioReferencia` idéntica) — reemplaza, EXCLUSIVAMENTE dentro de
 * `construirClaveCompensacionTurnante`, la igualdad exacta de hora de
 * inicio por una igualdad de MODALIDAD (diurno/nocturno). Nunca se toca
 * `construirClaveCompatibilidadTurnante` (esa clave sigue exigiendo la
 * hora exacta, es la que determina si dos posiciones comparten UNA
 * misma línea/costo — regla económica, sin cambios) ni ninguna otra regla
 * de costeo, recargos o la excepción de 12h.
 *
 * Reutiliza la ÚNICA definición legal de "nocturno" que ya existe en el
 * proyecto (`NOCTURNO_INICIO_HORA`/`NOCTURNO_FIN_HORA`,
 * `motor-distribuido/tipos.ts` — régimen general, ventana 19:00-06:00),
 * en vez de inventar una ventana "diurna" arbitraria.
 *
 * Ajuste "DIURNO ESTRICTO — 0 MINUTOS NOCTURNOS" (confirmado
 * explícitamente) — un turno es NOCTURNO si tiene CUALQUIER minuto
 * programado dentro de esa ventana (1 o más); DIURNO ÚNICAMENTE si tiene
 * CERO minutos dentro de ella. NUNCA se clasifica DIURNO un turno que
 * "mayoritariamente" cae fuera de la ventana pero la toca aunque sea
 * parcialmente (ver ejemplos abajo: 14:00-22:00 toca 19:00-22:00 y por
 * eso es NOCTURNO, aunque solo sean 3 de sus 8 horas). Dos posiciones solo
 * pueden compensarse (L-D con su L-S) cuando ambas caen en la MISMA
 * modalidad — diurno con diurno, nocturno con nocturno — nunca cruzadas.
 * Esta clasificación decide ÚNICAMENTE elegibilidad de compensación —
 * nunca cambia cómo se liquida el recargo nocturno/dominical/festivo real
 * (ese cálculo vive en otro motor, sin cambios).
 *
 * Ejemplos verificados (ver `calculo-turnantes.test.ts`):
 *   11:00-19:00 (7h) vs 07:00-15:00 (7h) → ambos DIURNO (0 min nocturnos
 *     cada uno) → SÍ compensan.
 *   06:00-14:00 vs 07:00-15:00 → ambos DIURNO → SÍ compensan.
 *   14:00-22:00 (8h) vs 07:00-15:00 (8h) → 14:00-22:00 tiene 180 minutos
 *     dentro de 19:00-06:00 (19:00-22:00) → NOCTURNO; 07:00-15:00 → DIURNO
 *     → NUNCA compensan, aunque la mayoría de 14:00-22:00 sea diurna.
 *   18:00-02:00 vs 20:00-04:00 → ambos NOCTURNO (cruzan medianoche, con
 *     minutos dentro de la ventana) → SÍ compensan entre sí.
 *   06:00-18:00 (12h) vs 18:00-06:00 (12h) → DIURNO vs NOCTURNO → NUNCA
 *     compensan — preserva exactamente el caso protegido de la excepción
 *     de 12h (diurno/nocturno).
 */
export type ModalidadTurnoDiurnoNocturno = 'DIURNO' | 'NOCTURNO' | 'INDETERMINADO';

const MINUTOS_POR_DIA_RELOJ = 24 * 60;
const NOCTURNO_INICIO_MIN = NOCTURNO_INICIO_HORA * 60;
const NOCTURNO_FIN_MIN = NOCTURNO_FIN_HORA * 60;

/** "HH:MM" → minutos desde 00:00, o `null` si no es un formato de hora
 * reconocible (nunca lanza, nunca asume medianoche por defecto). */
function parsearHoraAMinutos(hora: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hora.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!(h >= 0 && h <= 23) || !(min >= 0 && min <= 59)) return null;
  return h * 60 + min;
}

function solapeMinutos(aIni: number, aFin: number, bIni: number, bFin: number): number {
  return Math.max(0, Math.min(aFin, bFin) - Math.max(aIni, bIni));
}

/**
 * Clasifica un turno (hora de inicio + duración diaria en minutos) como
 * DIURNO o NOCTURNO según si TIENE O NO al menos un minuto dentro de la
 * ventana nocturna legal ya definida en el proyecto — NUNCA por la hora
 * de inicio aislada (un turno de 18:00 con 12h de duración toca la
 * ventana nocturna, aunque 18 < 19; ver ejemplos arriba) ni por
 * proporción/mayoría (un turno de 14:00-22:00 es NOCTURNO por tocar
 * 19:00-22:00, aunque esas sean solo 3 de sus 8 horas — DIURNO exige
 * CERO minutos dentro de la ventana, sin excepción). `INDETERMINADO`
 * cuando falta información suficiente (hora no parseable o duración ≤ 0)
 * — dos posiciones INDETERMINADAS entre sí siguen pudiendo compensar
 * (mismo comportamiento que la clave anterior cuando ninguna tenía
 * `horaInicioReferencia`), pero una INDETERMINADA nunca compensa con una
 * DIURNA o NOCTURNA conocida.
 */
export function clasificarModalidadTurnoParaCompensacion(
  horaInicioReferencia: string,
  duracionMinutosDia: number,
): ModalidadTurnoDiurnoNocturno {
  const inicioMin = parsearHoraAMinutos(horaInicioReferencia || '');
  if (inicioMin === null || !(duracionMinutosDia > 0)) return 'INDETERMINADO';
  const finMin = inicioMin + duracionMinutosDia; // puede superar 1440 si cruza medianoche
  let nocturnoMin = 0;
  for (const offset of [0, MINUTOS_POR_DIA_RELOJ]) {
    nocturnoMin += solapeMinutos(inicioMin, finMin, NOCTURNO_INICIO_MIN + offset, MINUTOS_POR_DIA_RELOJ + offset);
    nocturnoMin += solapeMinutos(inicioMin, finMin, 0 + offset, NOCTURNO_FIN_MIN + offset);
  }
  return nocturnoMin > 0 ? 'NOCTURNO' : 'DIURNO';
}

/** Ajuste "IMPLEMENTAR REGLA DE COMPENSACIÓN..." §4 — misma clave que
 * `construirClaveCompatibilidadTurnante`, pero usando
 * `normalizarMinutosLunesASabadoParaClave` (SIN domingo) en vez de
 * `normalizarMinutosSemanaParaClave` — así una posición L-D y su
 * equivalente L-S (mismo cargo/horario/salario/ARL/bonos/otros costos,
 * solo difieren en si trabajan domingo) caen en el MISMO grupo, nunca en
 * grupos separados como con la clave de compatibilidad económica.
 *
 * Ajuste "COMPENSACIÓN POR MODALIDAD DIURNO/NOCTURNO" — a diferencia de
 * `construirClaveCompatibilidadTurnante`, aquí la hora de inicio exacta
 * se reemplaza por su MODALIDAD (`clasificarModalidadTurnoParaCompensacion`,
 * arriba): dos posiciones diurnas con horas de inicio distintas SÍ
 * comparten esta clave (pueden compensarse); una diurna y una nocturna,
 * NUNCA — sin importar si sus horas de inicio parecen cercanas en el
 * reloj. La duración usada para clasificar es `minutosPorDia.L` (lunes),
 * siempre poblado tanto para posiciones L-D como L-S, y ya debe coincidir
 * entre ambas posiciones para llegar aquí (ver
 * `normalizarMinutosLunesASabadoParaClave`, que exige igual duración por
 * día L-S) — nunca una fuente de duración distinta o inventada. */
export function construirClaveCompensacionTurnante(p: PosicionElegibleTurnante): string {
  const modalidad = clasificarModalidadTurnoParaCompensacion(p.horaInicioReferencia, p.minutosPorDia.L);
  return [
    normalizarTextoParaClave(p.perfilCargo),
    normalizarSalarioParaClave(p.salarioBase),
    p.arlKey,
    normalizarMinutosLunesASabadoParaClave(p.minutosPorDia),
    modalidad,
    normalizarBonoParaClave(p.conBonoPrestacional, p.bonoPrestacionalValor),
    normalizarBonoParaClave(p.conBonoAlimentacion, p.bonoAlimentacionValor),
    normalizarBonoParaClave(p.conBonoTransporte, p.bonoTransporteValor),
    normalizarBonoParaClave(p.conBonoProductividad, p.bonoProductividadValor),
    normalizarBonoParaClave(p.conBonoOcasional, p.bonoOcasionalValor),
    String(Math.round(p.otrosCostosPorTrabajadorFirma)),
  ].join('|');
}

/**
 * Agrupa las posiciones elegibles por configuración laboral EQUIVALENTE
 * IGNORANDO el patrón de días (§2/§4 del ajuste "IMPLEMENTAR REGLA DE
 * COMPENSACIÓN..." — ver `construirClaveCompensacionTurnante`) y, DENTRO de
 * cada grupo, compensa las posiciones L-D contra sus equivalentes L-S
 * (`calcularCompensacionLunesDomingoLunesSabado`) ANTES de calcular la
 * necesidad de turnantes — la cantidad física ya NO se deriva de la
 * cantidad L-D bruta, sino de `cantidadPosicionesQueRequierenTurnante`
 * (nunca ambas a la vez, evita doble contabilización). Grupos cuya
 * compensación resulte en 0 se omiten (no generan línea ni ficha).
 */
function construirResultadoGrupo(
  claveGrupo: string,
  rep: PosicionElegibleTurnante,
  posicionesGrupo: readonly PosicionElegibleTurnante[],
  necesidad: ResultadoNecesidadTurnantes,
  coberturaPorPosicion: CoberturaPosicionTurnante[],
  compensacion: CompensacionTurnantePorGrupo,
  salarioReferenciaSinCatalogo: number,
  modalidadCobertura: ModalidadCoberturaTurnante,
): GrupoNecesidadTurnantes {
  const salarioValido = rep.salarioBase > 0 ? rep.salarioBase : null;
  return {
    claveGrupo,
    salarioBaseHeredado: salarioValido ?? salarioReferenciaSinCatalogo,
    huboReferenciaSalarialValida: salarioValido != null,
    arlKey: rep.arlKey,
    conBonoPrestacional: rep.conBonoPrestacional, bonoPrestacionalValor: rep.bonoPrestacionalValor,
    conBonoAlimentacion: rep.conBonoAlimentacion, bonoAlimentacionValor: rep.bonoAlimentacionValor,
    conBonoTransporte: rep.conBonoTransporte, bonoTransporteValor: rep.bonoTransporteValor,
    conBonoProductividad: rep.conBonoProductividad, bonoProductividadValor: rep.bonoProductividadValor,
    conBonoOcasional: rep.conBonoOcasional, bonoOcasionalValor: rep.bonoOcasionalValor,
    otrosCostosPorTrabajadorHeredado: rep.otrosCostosPorTrabajadorFirma,
    perfilCargo: rep.perfilCargo,
    perfilesCargoIncluidos: [...new Set(posicionesGrupo.map((p) => normalizarTextoParaClave(p.perfilCargo)))].sort(),
    necesidad,
    coberturaPorPosicion,
    compensacion,
    modalidadCobertura,
    horasCoberturaPorPosicion: necesidad.cantidadTurnantesFisicos > 0 ? necesidad.horasContratadasTotal / necesidad.cantidadTurnantesFisicos : 0,
  };
}

export function construirGruposNecesidadTurnantes(
  posiciones: readonly PosicionElegibleTurnante[],
  salarioReferenciaSinCatalogo: number,
  config: ConfiguracionCalculoTurnantes = CONFIGURACION_TURNANTES_DEFAULT,
): GrupoNecesidadTurnantes[] {
  const elegibles = posiciones.filter((p) => p.requiereCoberturaDescanso && p.cantidad > 0);
  // §3/§14 — compensadoras L-S: NUNCA requieren cobertura propia
  // (`cubreSieteDiasSemana` ya las excluye de `elegibles` arriba, 6 días)
  // — solo participan restando de un grupo L-D equivalente, jamás generan
  // su propia línea/ficha.
  const compensadorasLunesSabado = posiciones.filter(
    (p) => !p.requiereCoberturaDescanso && p.cantidad > 0 && esProgramacionLunesASabado(p.minutosPorDia),
  );

  const grupos = new Map<string, PosicionElegibleTurnante[]>();
  for (const p of elegibles) {
    const clave = construirClaveCompatibilidadTurnante(p);
    const lista = grupos.get(clave);
    if (lista) lista.push(p); else grupos.set(clave, [p]);
  }
  const gruposCompensadoras = new Map<string, PosicionElegibleTurnante[]>();
  for (const p of compensadorasLunesSabado) {
    const clave = construirClaveCompensacionTurnante(p);
    const lista = gruposCompensadoras.get(clave);
    if (lista) lista.push(p); else gruposCompensadoras.set(clave, [p]);
  }

  interface CandidatoDoce {
    claveGrupo: string;
    rep: PosicionElegibleTurnante;
    posicionesGrupo: PosicionElegibleTurnante[];
    compensacion: CompensacionTurnantePorGrupo;
  }
  const candidatosDoce: CandidatoDoce[] = [];
  const resultado: GrupoNecesidadTurnantes[] = [];
  const horasEfectivasDescansoMin = Math.round(config.horasEfectivasDescansoTurnante * 60);

  for (const [claveGrupo, posicionesGrupo] of grupos) {
    const rep = posicionesGrupo[0];
    // §7/§14 — la compensación SOLO aplica cuando TODAS las posiciones del
    // grupo son un patrón L-D exacto — un grupo con patrón irregular/parcial
    // (ej. distinta jornada semanal por día) conserva la lógica vigente sin
    // ningún cambio, nunca se compensa "a medias".
    const esGrupoLunesDomingo = posicionesGrupo.every((p) => esProgramacionLunesADomingo(p.minutosPorDia));
    const posicionesLunesSabado = esGrupoLunesDomingo
      ? (gruposCompensadoras.get(construirClaveCompensacionTurnante(rep)) ?? [])
      : [];
    const compensacion = calcularCompensacionLunesDomingoLunesSabado(claveGrupo, posicionesGrupo, posicionesLunesSabado);

    if (!esGrupoLunesDomingo) {
      // Patrón no compensable — comportamiento vigente (bloques 21/42h),
      // sin ningún cambio.
      const necesidad = calcularNecesidadTurnantes(posicionesGrupo, config);
      if (necesidad.cantidadTurnantesFisicos <= 0) continue;
      const coberturaPorPosicion = calcularCoberturaPorPosicion(posicionesGrupo, config);
      const modalidad: ModalidadCoberturaTurnante = necesidad.cantidadBloques42Turnantes > 0 ? 'INTEGRADO_42H' : 'INDIVIDUAL_ESPECIAL_21H';
      resultado.push(construirResultadoGrupo(claveGrupo, rep, posicionesGrupo, necesidad, coberturaPorPosicion, compensacion, salarioReferenciaSinCatalogo, modalidad));
      continue;
    }

    // §11 — si la compensación anula toda la demanda, no se crea ficha.
    if (compensacion.cantidadPosicionesQueRequierenTurnante <= 0) continue;

    // §7 — la excepción de negocio (12h/día L-D) es la ÚNICA modalidad que
    // sigue usando el paradigma de bloques 21/42h; cualquier otra duración
    // usa horas REALES de cobertura (§4), nunca 21h por defecto.
    if (!esHorarioDoceHorasLunesADomingo(rep.minutosPorDia)) {
      // Corrección "RELEVO SIEMPRE 7H, INDEPENDIENTE DEL ESQUEMA DE
      // TURNOS" (regla de negocio confirmada, diagnóstico Aseocolba Fase
      // 2): el turnante de relevo SIEMPRE usa
      // `config.horasEfectivasDescansoTurnante` (7h por defecto) por cada
      // trabajador que requiere relevo — nunca `horasSemanales-42`, sin
      // importar cuántos grupos de compatibilidad distintos tenga el
      // mismo cargo, ni su duración diaria, ni su horario diurno/
      // nocturno, ni diferencias de salario/hora de inicio entre grupos.
      // La bifurcación anterior (`esEsquemaTurnos`, basada en contar
      // grupos de compatibilidad por cargo) mezclaba "personal adicional
      // por posible operación multi-turno" con "relevo de descanso
      // estándar" usando una señal débil (cantidad de grupos) que no
      // distinguía el origen real — quedó retirada. Si en el futuro se
      // confirma una necesidad de negocio genuina de "personal adicional
      // estructural para cobertura 24/7 real", debe modelarse como un
      // concepto propio, nunca reutilizando esta línea de turnante.
      const horasCobertura = config.horasEfectivasDescansoTurnante;
      if (horasCobertura <= 0) continue;
      const cantidad = compensacion.cantidadPosicionesQueRequierenTurnante;
      const necesidad = construirNecesidadHorasReales(cantidad, horasCobertura);
      const coberturaPorPosicion = distribuirCoberturaPorPosicionUnidadFija(posicionesGrupo, necesidad.capacidadOrdinariaMinutos, horasCobertura * 60);
      resultado.push(construirResultadoGrupo(claveGrupo, rep, posicionesGrupo, necesidad, coberturaPorPosicion, compensacion, salarioReferenciaSinCatalogo, 'HORAS_REALES'));
      continue;
    }

    // §8/§11 — se difiere a una segunda pasada: la excepción de 12h debe
    // buscar primero su horario complementario (diurno↔nocturno) antes de
    // decidir bloques/remanente — nunca se resuelve aislada si existe
    // pareja compatible.
    candidatosDoce.push({ claveGrupo, rep, posicionesGrupo, compensacion });
  }

  // Segunda pasada — agrupa los candidatos de 12h por la clave de
  // integración (§9, SIN horaInicioReferencia): un diurno y su nocturno
  // complementario caen en el MISMO cluster aquí, aunque sean grupos de
  // compatibilidad distintos (por diseño, para que la compensación L-D/L-S
  // nunca los confunda — ver `construirClaveIntegracion12Horas`). La
  // cantidad COMBINADA se resuelve con la MISMA lógica de bloques 21/42h
  // ya aprobada (`calcularNecesidadTurnantes`), nunca una fórmula nueva:
  // floor/mod ya produce el resultado correcto sin importar si los N
  // turnantes vienen de un solo horario o de la suma de dos complementarios.
  const clustersDoce = new Map<string, CandidatoDoce[]>();
  for (const c of candidatosDoce) {
    const claveIntegracion = construirClaveIntegracion12Horas(c.rep);
    const lista = clustersDoce.get(claveIntegracion);
    if (lista) lista.push(c); else clustersDoce.set(claveIntegracion, [c]);
  }
  for (const miembros of clustersDoce.values()) {
    const cantidadTotal = miembros.reduce((s, m) => s + m.compensacion.cantidadPosicionesQueRequierenTurnante, 0);
    if (cantidadTotal <= 0) continue;
    const rep = miembros[0].rep;
    const claveGrupo = miembros.map((m) => m.claveGrupo).sort().join('+');
    const posicionesGrupo = miembros.flatMap((m) => m.posicionesGrupo);
    const posicionCompensada: PosicionParaTurnante = {
      id: '__compensado__:' + claveGrupo,
      cantidad: cantidadTotal,
      requiereCoberturaDescanso: true,
      minutosPorDia: rep.minutosPorDia,
    };
    const necesidad = calcularNecesidadTurnantes([posicionCompensada], config);
    if (necesidad.cantidadTurnantesFisicos <= 0) continue;
    // §10 — atribución SOLO de las posiciones L-D reales de AMBOS
    // horarios (diurno + nocturno cuando hubo pareja), repartida contra la
    // capacidad YA COMPENSADA Y COMBINADA.
    const coberturaPorPosicion = distribuirCoberturaPorPosicion(posicionesGrupo, necesidad.capacidadOrdinariaMinutos, necesidad.diasDescansoPorPosicion, horasEfectivasDescansoMin);
    // Trazabilidad combinada — totales L-D/L-S de TODOS los horarios que
    // se integraron, nunca solo el primero.
    const compensacionCombinada: CompensacionTurnantePorGrupo = {
      claveGrupo,
      distribucionesLunesDomingo: miembros.flatMap((m) => m.compensacion.distribucionesLunesDomingo),
      distribucionesLunesSabado: miembros.flatMap((m) => m.compensacion.distribucionesLunesSabado),
      totalPosicionesLunesDomingo: miembros.reduce((s, m) => s + m.compensacion.totalPosicionesLunesDomingo, 0),
      totalPosicionesLunesSabado: miembros.reduce((s, m) => s + m.compensacion.totalPosicionesLunesSabado, 0),
      cantidadPosicionesQueRequierenTurnante: cantidadTotal,
    };
    const modalidad: ModalidadCoberturaTurnante = necesidad.cantidadBloques42Turnantes > 0 ? 'INTEGRADO_42H' : 'INDIVIDUAL_ESPECIAL_21H';
    resultado.push(construirResultadoGrupo(claveGrupo, rep, posicionesGrupo, necesidad, coberturaPorPosicion, compensacionCombinada, salarioReferenciaSinCatalogo, modalidad));
  }

  return resultado;
}

/**
 * Agrega varios `ResultadoNecesidadTurnantes` (uno por grupo) en un único
 * resumen — usado exclusivamente para la sección visual "Cobertura de
 * turnantes" (nunca para recalcular costo: el costo siempre se lee de
 * `resultadosTurnantesConOtrosCostos`, no de este agregado). El estado
 * combinado es COBERTURA_PARCIAL / COSTO_PRELIMINAR si CUALQUIER grupo
 * quedó así, y PROMEDIO_PENDIENTE si CUALQUIER grupo no fue exacto.
 */
export function agregarNecesidadesTurnantes(
  grupos: readonly ResultadoNecesidadTurnantes[],
  config: ConfiguracionCalculoTurnantes = CONFIGURACION_TURNANTES_DEFAULT,
): ResultadoNecesidadTurnantes {
  if (grupos.length === 0) return calcularNecesidadTurnantes([], config);

  const posicionesElegibles = grupos.reduce((t, g) => t + g.posicionesElegibles, 0);
  const descansosSemanalesACubrir = grupos.reduce((t, g) => t + g.descansosSemanalesACubrir, 0);
  const minutosRelevoSemanales = grupos.reduce((t, g) => t + g.minutosRelevoSemanales, 0);
  const cantidadTurnantesPorDias = grupos.reduce((t, g) => t + g.cantidadTurnantesPorDias, 0);
  const cantidadTurnantesFisicos = grupos.reduce((t, g) => t + g.cantidadTurnantesFisicos, 0);
  const capacidadOrdinariaMinutos = grupos.reduce((t, g) => t + g.capacidadOrdinariaMinutos, 0);
  const capacidadUtilizadaMinutos = grupos.reduce((t, g) => t + g.capacidadUtilizadaMinutos, 0);
  const capacidadDisponibleMinutos = grupos.reduce((t, g) => t + g.capacidadDisponibleMinutos, 0);
  const porcentajeUtilizacion = capacidadOrdinariaMinutos > 0
    ? Math.round((capacidadUtilizadaMinutos / capacidadOrdinariaMinutos) * 10000) / 100
    : 0;
  const minutosResiduales = grupos.reduce((t, g) => t + g.minutosResiduales, 0);
  const coberturaCompleta = minutosResiduales === 0;
  const estadoCobertura: EstadoCoberturaTurnantes = posicionesElegibles === 0
    ? 'SIN_NECESIDAD'
    : (coberturaCompleta ? 'COBERTURA_COMPLETA' : 'COBERTURA_PARCIAL_PENDIENTE_PROGRAMACION');
  const metodoCalculoRelevo: MetodoCalculoRelevo = grupos.some((g) => g.metodoCalculoRelevo === 'PROMEDIO_PENDIENTE_ASIGNACION_DESCANSOS')
    ? 'PROMEDIO_PENDIENTE_ASIGNACION_DESCANSOS' : 'EXACTO';
  const advertencias = grupos.flatMap((g) => g.advertencias);
  const bloquesTurnantesContratados = grupos.flatMap((g) => g.bloquesTurnantesContratados);
  const horasContratadasTotal = grupos.reduce((t, g) => t + g.horasContratadasTotal, 0);
  // Informativo — rollup de los conteos YA resueltos por grupo (nunca
  // floor(Σcantidadfísica/2): los turnantes de grupos distintos nunca se
  // emparejan entre sí, cada grupo resuelve sus propios bloques/remanente).
  const cantidadBloques42Turnantes = grupos.reduce((t, g) => t + g.cantidadBloques42Turnantes, 0);
  const cantidadRemanentes21Turnantes = grupos.reduce((t, g) => t + g.cantidadRemanentes21Turnantes, 0);

  return {
    posicionesElegibles,
    // Informativo — mismo diasDescansoPorPosicion en todos los grupos
    // porque todos comparten la misma configuración central (§ default).
    diasDescansoPorPosicion: grupos[0]?.diasDescansoPorPosicion ?? config.diasCoberturaSemanal - config.diasTrabajadosPorEmpleado,
    descansosSemanalesACubrir,
    minutosRelevoSemanales, horasRelevoSemanales: minutosRelevoSemanales / 60, metodoCalculoRelevo,
    cantidadTurnantesPorDias, cantidadTurnantesFisicos,
    capacidadOrdinariaMinutos,
    capacidadUtilizadaMinutos, horasCapacidadUtilizada: capacidadUtilizadaMinutos / 60,
    capacidadDisponibleMinutos, horasCapacidadDisponible: capacidadDisponibleMinutos / 60,
    porcentajeUtilizacion,
    minutosResiduales, horasResiduales: minutosResiduales / 60,
    coberturaCompleta, estadoCobertura, estadoCosto: resolverEstadoCosto(coberturaCompleta),
    advertencias,
    bloquesTurnantesContratados, horasContratadasTotal,
    capacidadReferenciaTiempoCompleto: CAPACIDAD_REFERENCIA_TIEMPO_COMPLETO,
    cantidadBloques42Turnantes, cantidadRemanentes21Turnantes,
  };
}

// ─── Sincronización de líneas automáticas (decisión pura, sin React) ──────

/** Forma mínima que una línea automática existente debe cumplir para poder
 * reconciliarse — deliberadamente no depende de `LineaMOExtra` (que vive
 * dentro de page.tsx) para que esta función sea importable/testeable sin
 * React. `page.tsx` la usa con su propio `LineaMOExtra`, que ya cumple esta
 * forma estructuralmente. */
export interface LineaAutomaticaExistente {
  claveGrupoTurnante?: string;
  esTurnanteAutomatico?: boolean;
  cantOpeFijos: string;
  salarioBase: string;
  arlKey: string;
  /** §5 — banderas INDEPENDIENTES: editar el salario congela solo el
   * salario; editar el ARL congela solo el ARL. Nunca una sola bandera
   * compartida. */
  salarioEditadoManualmente?: boolean;
  arlEditadoManualmente?: boolean;
  /** Ajuste "AJUSTAR TURNANTES POR BLOQUES DE 21 Y 42 HORAS" — true
   * ÚNICAMENTE en la línea-sonda del remanente individual de 21h (motor
   * ordinario, `cantOpeFijos` SIEMPRE '1'); false/ausente en la línea de
   * bloques integrados de 42h (`cantOpeFijos=cantidadBloques42`). Un mismo
   * `claveGrupoTurnante` puede tener HASTA DOS líneas automáticas
   * simultáneas — se distinguen exclusivamente por esta bandera, nunca por
   * el orden del arreglo. */
  remanenteTurnante21?: boolean;
  /** Ajuste "CERRAR DEFINITIVAMENTE LA LÓGICA DE TURNANTES" — jornada
   * semanal (TOTAL_SEMANAL) con la que se liquida ESTA línea (ej. '42',
   * '21', '14', '7'). Si la jornada esperada cambia (la demanda pasó de
   * HORAS_REALES a la excepción de 12h, o cambiaron las horas reales
   * programadas), la línea se RECONSTRUYE por completo — nunca se parchea
   * dejando `horasSemanal`/`distribucionesHorario` desactualizados
   * mientras solo `cantOpeFijos`/`salarioBase`/`arlKey` se resincronizan. */
  horasSemanal: string;
}

export interface ResultadoSincronizacionTurnantes<T extends LineaAutomaticaExistente> {
  /** Líneas automáticas resultantes, UNA por grupo vigente, en el mismo
   * orden que `grupos` — nunca más de una por `claveGrupo`. */
  siguientes: T[];
  /** true si el arreglo de salida difiere del de entrada (creación,
   * actualización o eliminación real) — el llamador debe usarlo para
   * evitar un `setState` sin cambios reales (bucle de render). */
  huboCambio: boolean;
}

/**
 * Única fuente de la decisión "crear/actualizar/eliminar/conservar" para
 * las líneas automáticas de turnante — usada por el `useEffect` de
 * sincronización en page.tsx, pero sin ninguna dependencia de React/JSX,
 * así que es directamente testeable con fixtures planos.
 *
 * Ajuste "AJUSTAR TURNANTES POR BLOQUES DE 21 Y 42 HORAS" — cada grupo
 * puede generar HASTA DOS líneas automáticas, cada una con su propio
 * `cantOpeFijos` ya correctamente dimensionado (nunca escalado después por
 * un factor de jornada — al motor real solo se le pide el tamaño exacto
 * que debe facturar):
 *  - Línea de BLOQUES de 42h — `cantOpeFijos=cantidadBloques42Turnantes`;
 *    solo existe mientras esa cantidad sea >0 (si toda la demanda es un
 *    único remanente, N=1, esta línea NO se crea).
 *  - Línea-sonda del REMANENTE de 21h — `cantOpeFijos` SIEMPRE '1' (motor
 *    ordinario real de un turnante individual); solo existe mientras
 *    `cantidadRemanentes21Turnantes===1` (nunca >1, por construcción de
 *    `resolverConteoBloquesTurnantes`).
 * Ambas líneas comparten `claveGrupoTurnante` pero se distinguen por
 * `remanenteTurnante21` — nunca por el orden del arreglo ni por índice.
 *
 * Reglas de reconciliación (igual que antes, ahora aplicadas
 * independientemente a cada una de las dos líneas):
 *  - Se busca en `automaticasPrevias` por (`claveGrupoTurnante`,
 *    `remanenteTurnante21`) — nunca por índice/posición.
 *  - Si no existe, se crea vía `construirNueva`.
 *  - `cantOpeFijos` SIEMPRE se resincroniza con la necesidad actual.
 *  - `salarioBase` SOLO se resincroniza mientras `salarioEditadoManualmente`
 *    sea falso; `arlKey` SOLO se resincroniza mientras
 *    `arlEditadoManualmente` sea falso — banderas INDEPENDIENTES (§5),
 *    por línea (la línea de bloques y la de remanente nunca comparten
 *    edición manual).
 *  - Una línea automática cuyo grupo ya no existe, o cuya porción
 *    (bloques/remanente) ya no aplica, desaparece del resultado (nunca
 *    queda huérfana).
 */
export function sincronizarLineasTurnantesAutomaticas<T extends LineaAutomaticaExistente>(
  automaticasPrevias: readonly T[],
  grupos: readonly GrupoNecesidadTurnantes[],
  construirNueva: (grupo: GrupoNecesidadTurnantes, cantidadTexto: string, remanente21: boolean) => T,
): ResultadoSincronizacionTurnantes<T> {
  const claveLinea = (claveGrupo: string, remanente21: boolean) => `${claveGrupo}::${remanente21 ? '21R' : '42'}`;
  const porClave = new Map(
    automaticasPrevias
      .filter((l) => l.claveGrupoTurnante)
      .map((l) => [claveLinea(l.claveGrupoTurnante as string, !!l.remanenteTurnante21), l] as const),
  );
  let huboCambio = false;

  // Ajuste "CORREGIR DEFINITIVAMENTE EL CÁLCULO PROPORCIONAL DE
  // TURNANTES" — HORAS_REALES ya NO construye una línea a horas reales
  // (7h/14h/etc.): usa la MISMA línea de referencia de 42h que la
  // excepción de 12h (`cantOpeFijos` SIEMPRE '1', jornada SIEMPRE 42h) —
  // el costo proporcional se deriva de esa referencia en page.tsx
  // (`calcularCostoProporcionalTurnante`), nunca de una posición laboral
  // nueva. Por eso `horasSemanal` esperado es SIEMPRE 42 (línea principal)
  // o 21 (remanente) — nunca depende de la modalidad.
  const resolverHorasSemanalEsperada = (remanente21: boolean): string =>
    String(remanente21 ? JORNADA_MEDIO_TIEMPO : CAPACIDAD_REFERENCIA_TIEMPO_COMPLETO);

  const resolverLinea = (grupo: GrupoNecesidadTurnantes, cantidadTexto: string, remanente21: boolean): T => {
    const existente = porClave.get(claveLinea(grupo.claveGrupo, remanente21));
    if (!existente) {
      huboCambio = true;
      return construirNueva(grupo, cantidadTexto, remanente21);
    }
    const horasSemanalEsperada = resolverHorasSemanalEsperada(remanente21);
    if (existente.horasSemanal !== horasSemanalEsperada) {
      // La jornada semanal de esta línea cambió (ej. la demanda pasó de la
      // excepción de 12h a HORAS_REALES, o cambiaron las horas reales
      // programadas) — se reconstruye por completo, nunca se parchea
      // dejando `horasSemanal`/`distribucionesHorario` obsoletos mientras
      // solo cantOpeFijos/salario/ARL se resincronizan.
      huboCambio = true;
      return construirNueva(grupo, cantidadTexto, remanente21);
    }
    const salarioResuelto = existente.salarioEditadoManualmente
      ? existente.salarioBase
      : String(Math.round(grupo.salarioBaseHeredado));
    const arlResuelto = existente.arlEditadoManualmente ? existente.arlKey : grupo.arlKey;
    if (existente.cantOpeFijos === cantidadTexto && existente.salarioBase === salarioResuelto && existente.arlKey === arlResuelto) {
      return existente; // sin cambio real — conserva la MISMA referencia (evita loop de render)
    }
    huboCambio = true;
    return { ...existente, cantOpeFijos: cantidadTexto, salarioBase: salarioResuelto, arlKey: arlResuelto };
  };

  const siguientes: T[] = [];
  // Ajuste "CORREGIR DEFINITIVAMENTE EL CÁLCULO PROPORCIONAL DE
  // TURNANTES" — HORAS_REALES genera UNA sola línea de REFERENCIA de 42h
  // (`cantOpeFijos` SIEMPRE '1', nunca escalado por cantidad de
  // turnantes): el costo real (proporcional, multiplicado por la
  // cantidad) se calcula en page.tsx a partir de esta única referencia.
  for (const grupo of grupos) {
    if (grupo.modalidadCobertura === 'HORAS_REALES') {
      if (grupo.necesidad.cantidadTurnantesFisicos > 0) {
        siguientes.push(resolverLinea(grupo, '1', false));
      }
      continue;
    }
    const { cantidadBloques42Turnantes, cantidadRemanentes21Turnantes } = grupo.necesidad;
    if (cantidadBloques42Turnantes > 0) {
      siguientes.push(resolverLinea(grupo, String(cantidadBloques42Turnantes), false));
    }
    if (cantidadRemanentes21Turnantes > 0) {
      siguientes.push(resolverLinea(grupo, '1', true));
    }
  }

  const clavesVigentes = new Set<string>();
  for (const grupo of grupos) {
    if (grupo.modalidadCobertura === 'HORAS_REALES') {
      if (grupo.necesidad.cantidadTurnantesFisicos > 0) clavesVigentes.add(claveLinea(grupo.claveGrupo, false));
      continue;
    }
    if (grupo.necesidad.cantidadBloques42Turnantes > 0) clavesVigentes.add(claveLinea(grupo.claveGrupo, false));
    if (grupo.necesidad.cantidadRemanentes21Turnantes > 0) clavesVigentes.add(claveLinea(grupo.claveGrupo, true));
  }
  const huboEliminacion = automaticasPrevias.some(
    (l) => l.claveGrupoTurnante && !clavesVigentes.has(claveLinea(l.claveGrupoTurnante, !!l.remanenteTurnante21)),
  );

  return { siguientes, huboCambio: huboCambio || huboEliminacion };
}