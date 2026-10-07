/**
 * Metodología comercial parametrizada de 30 días — derivación AUTOMÁTICA
 * de `DistribucionHorasMetodoComercial` desde el horario estructurado
 * (días, bloques, descansos) que ya captura el cargo. El usuario NUNCA
 * digita horas por concepto — este módulo es la ÚNICA fuente de esas 8
 * cantidades quien las produce, siempre a partir de la programación real.
 *
 * Aislado del motor legal anualizado: no importa calendario, festivos
 * reales, materialización anual ni clasificar-segmentos.ts (ese archivo
 * mezcla domingo/festivo con el calendario real, que este método no usa).
 * Solo reutiliza `NOCTURNO_INICIO_HORA`/`NOCTURNO_FIN_HORA` (constantes
 * numéricas puras, sin dependencia de fecha ni año) y el tipo
 * `BloqueHorario`/`DistribucionHorarioConfigurada` ya existentes.
 */
import type { BloqueHorario, DiaSemanaHorario, DistribucionHorarioConfigurada } from '../horarios/tipos';
import { NOCTURNO_INICIO_HORA, NOCTURNO_FIN_HORA, JORNADA_SEMANAL_MINUTOS_GENERAL_2026 } from './tipos';
import type { DistribucionHorasMetodoComercial, HorasExtraSemanalesComercial } from './motor-comercial-30-dias';
import { PARAMETROS_METODO_COMERCIAL_30_DIAS_DEFAULT, FACTOR_SEMANAS_MES } from './motor-comercial-30-dias';
import { normalizarBloques24Horas, validarBloquesTurno } from './normalizar-bloques-turno';
import { interpretarOperacionTurno, clasificarPatronBloquesDia, TURNOS_SEMANALES_12_HORAS } from './interprete-turnos';
import type { ResultadoInterpretacionTurno } from './interprete-turnos';
import { resolverAnioCalculo, calcularFestivosPromedioMesPorDiaSemana } from './festivos-dia-semana';

const NOMBRE_DIA: Record<DiaSemanaHorario, string> = {
  L: 'lunes', M: 'martes', X: 'miércoles', J: 'jueves', V: 'viernes', S: 'sábado', D: 'domingo',
};


/** Cuota fija de un turno de 12h — 42÷4 = 10,5h ordinarias por turno (§5
 * del cierre), calculada, nunca literal duplicado. */
const CUOTA_TURNO_12_HORAS_MIN = Math.round(((JORNADA_SEMANAL_MINUTOS_GENERAL_2026 / 60) / TURNOS_SEMANALES_12_HORAS) * 60);

/** Días ordinarios posibles de la semana comercial (lunes a sábado) — el
 * denominador fijo de la mensualización por día-de-semana (ajuste
 * "MENSUALIZACIÓN DE DÍAS ORDINARIOS SELECCIONADOS"): cada día ordinario
 * seleccionado (es decir, cualquier día programado que NO sea el día de
 * descanso obligatorio del cargo — normalmente, pero no siempre,
 * domingo) pesa `diasOrdinariosPromedioMes ÷ 6` del mes, sin importar
 * cuántos días distintos estén realmente programados. Es un conteo de
 * días (entero, nunca un valor decimal redondeado) — el peso 24,08÷6
 * nunca se calcula ni se guarda aquí; se compone en tiempo de ejecución
 * dividiendo por esta constante y dejando que
 * `calcularResultadoTarifaMensualComercial30Dias` (motor-comercial-30-
 * dias.ts, única fuente de 24,08) haga la multiplicación, sin duplicar el
 * literal en ningún punto. */
const DIAS_ORDINARIOS_SEMANA_COMERCIAL = 6;

/** Día de descanso obligatorio por defecto — ajuste "DÍA DE DESCANSO":
 * si el cargo no lo especifica, se resuelve como domingo, igual que el
 * comportamiento histórico. */
const DIA_DESCANSO_OBLIGATORIO_DEFAULT: DiaSemanaHorario = 'D';

/** Clave canónica de un conjunto de bloques (ya normalizado y ordenado) —
 * usada solo para comparar si dos distribuciones asignan el MISMO
 * horario a un día compartido (nunca para decidir clasificación). */
function claveBloques(bloques: BloqueHorario[]): string {
  return [...bloques].sort((a, b) => a.orden - b.orden).map(b => `${b.inicio}-${b.fin}`).join('|');
}

/** Jornada ordinaria semanal comercial — parámetro interno (nunca editable
 * por el usuario). 42 es el valor por defecto de referencia y es el TOPE
 * SEMANAL de horas ordinarias del patrón genérico (ver
 * `clasificarDiaConTopes`); también deriva la cuota del día de descanso
 * obligatorio (`jornadaSemanal ÷ díasOrdinariosProgramados`). Este
 * parámetro es exclusivamente comercial — nunca se deriva de
 * `resolverParametrosVigentesFecha` ni de ninguna vigencia legal. */
export const JORNADA_ORDINARIA_SEMANAL_COMERCIAL_DEFAULT = 42;

/** Ajuste "HORAS EXTRAS POR JORNADA SEMANAL, NO POR DÍA" — jornada ordinaria
 * diaria del patrón genérico (JORNADA_INDIVIDUAL/PARCIAL, nunca turno fijo
 * de 12h) cuando el cargo NO es de jornada flexible: lo que un día exceda
 * de 8h es extra, sin importar cuántos días tenga la programación. Reemplaza
 * la antigua cuota fija de 7h por día (42÷6), que generaba extras en un
 * trabajador que cumplía exactamente las 42h de la semana. */
export const JORNADA_DIARIA_ORDINARIA_HORAS_DEFAULT = 8;

/** Tope diario de un cargo con jornada flexible pactada (art. 161 CST): hasta
 * 9h en un día no son suplementarias SIEMPRE QUE la semana no supere la
 * jornada semanal. El exceso diario sobre este tope es extra aunque la
 * semana no llegue a 42h; el exceso semanal sobre 42h también lo es. */
export const JORNADA_DIARIA_MAXIMA_FLEXIBLE_HORAS = 9;

export interface EntradaDerivacionComercial {
  distribucionesHorario: DistribucionHorarioConfigurada[];
  incluyeFestivos: boolean;
  /** Default JORNADA_ORDINARIA_SEMANAL_COMERCIAL_DEFAULT (42). */
  jornadaOrdinariaSemanalComercial?: number;
  /** Jornada ordinaria diaria del patrón genérico, en horas. Default
   * JORNADA_DIARIA_ORDINARIA_HORAS_DEFAULT (8). Ignorada si
   * `jornadaFlexible` es true (el tope diario pasa a ser
   * JORNADA_DIARIA_MAXIMA_FLEXIBLE_HORAS). */
  jornadaDiariaOrdinariaHoras?: number;
  /** El cargo tiene jornada flexible PACTADA: el tope diario sube a 9h y lo
   * que decide si hay extras es el total semanal (42h). Condición laboral
   * previamente acordada, nunca una forma de evitar extras — default false
   * (jornada fija de 8h diarias) para todo caller que no lo pase. */
  jornadaFlexible?: boolean;
  /** Cantidad capturada por el usuario ("cantidad" del cargo) — se usa
   * ÚNICAMENTE para poblar `interpretacion.cantidadPosiciones`/
   * `coberturaSemanalTotal` (intérprete automático de turnos, §6/§7 del
   * cierre). Nunca cambia la distribución de horas por trabajador, que
   * sigue siendo por-persona (la multiplicación por cantidad ocurre en
   * motor-comercial-30-dias.ts, sin cambios). Default 1. */
  cantidadTrabajadores?: number;
  /** Año de cálculo para resolver los festivos reales de Colombia que
   * coinciden con días ordinarios seleccionados (ajuste "FESTIVOS SEGÚN
   * LOS DÍAS REALMENTE PROGRAMADOS", §5). Si se omite, se resuelve
   * determinísticamente al año actual del servidor — nunca se pregunta al
   * usuario (ver `resolverAnioCalculo`). */
  anioCalculo?: number | null;
  /** Día de descanso obligatorio del CARGO (ajuste "DÍA DE DESCANSO") —
   * propiedad del cargo completo, nunca de una distribución individual
   * (mismo criterio que `incluyeFestivos`). Default `'D'` (domingo) si se
   * omite — compatibilidad histórica total: un cargo guardado antes de
   * este ajuste, sin este campo, se comporta exactamente igual que antes. */
  diaDescansoObligatorio?: DiaSemanaHorario;
  /** Corrección "COBERTURA vs. CAPACIDAD vs. RECARGOS — TURNANTES" — true
   * ÚNICAMENTE cuando esta línea tiene cobertura de descanso activa y un
   * turnante físico realmente la cubre (`gruposNecesidadTurnantes`,
   * `cantidadTurnantesFisicos>0` en page.tsx). Afecta EXCLUSIVAMENTE
   * `horasEfectivasSemanaTotal` (informativo, "horas trabajadas" — nunca
   * consumido por `distribucion`/el motor financiero): excluye la
   * contribución del día de descanso obligatorio (`especial`) de ese
   * total, porque ese día lo cubre físicamente el turnante, no el
   * titular. `distribucion` (recargos/extras monetarios, incluido el
   * recargo dominical/festivo del día especial) NUNCA cambia con esta
   * bandera — el recargo del servicio permanece en el cargo principal,
   * una sola vez, exactamente como antes (regla de negocio confirmada).
   * Default false — comportamiento histórico sin cambios para todo caller
   * que no pase este campo explícitamente. */
  excluirDiaDescansoDeHorasEfectivas?: boolean;
  /** Ajuste "USAR 4,33 COMO PROYECCIÓN PRINCIPAL DE SOBRETIEMPO EN
   * COSTEOS NUEVOS" — metodología aplicable a TODO el costeo (nunca por
   * cargo individual, §1.C). Decide cómo se clasifica/mensualiza el
   * HED/HEN de patrón genérico L-S (nunca afecta domingo/festivo/día de
   * descanso, que permanecen aislados con 5,92 — deuda técnica registrada
   * aparte, §7):
   * - `SEMANAL_4_33` (todo costeo nuevo): recorrido cronológico L-S con
   *   acumulador semanal COMPARTIDO de 42h, sin importar si el patrón es
   *   uniforme o irregular — el exceso semanal siempre se mensualiza con
   *   `factorSemanasPromedioMes` (4,33).
   * - `LEGADO_COMERCIAL_30_DIAS`: cuota diaria rígida independiente por
   *   día (sin acumulador compartido, mensualizado con 24,08) —
   *   reproduce exactamente los resultados de un costeo guardado antes de
   *   esta corrección. Nunca se infiere automáticamente hacia 4,33; solo
   *   se resuelve así cuando el costeo/borrador ya existía (§9).
   *
   * Ajuste "METODOLOGÍA EXPLÍCITA EN EL MOTOR" — campo OBLIGATORIO, sin
   * default silencioso: quien llama a este núcleo puro (page.tsx, u otro
   * caller futuro) debe resolver la compatibilidad histórica (§9) ANTES
   * de invocar el derivador, nunca dentro de él. Si se omite, la función
   * lanza un error controlado (ver más abajo) en vez de asumir un valor. */
  metodologiaCosteo: 'SEMANAL_4_33' | 'LEGADO_COMERCIAL_30_DIAS';
}

/** Origen de la mensualización aplicable al sobretiempo de días de patrón
 * genérico (JORNADA_INDIVIDUAL/PARCIAL) — trazabilidad interna (auditoría
 * "AJUSTE DE METODOLOGÍA — FACTOR 4,33"), nunca se muestra al usuario con
 * este nombre técnico. `SEMANAL_4_33`: hubo exceso real sobre la jornada
 * semanal (42h por defecto) en al menos un día de patrón genérico — el
 * sobretiempo (HED/HEN/HEDF/HENF semanales) debe mensualizarse con
 * `factorSemanasPromedioMes` (4,33), nunca con 24,08÷6 ni con 5,92.
 * `DIARIO_24_08`: sin exceso semanal genérico — comportamiento vigente sin
 * cambios (incluye turnos de 12h fijo, coberturas 12/7 y 24/7, Avianca). */
export type OrigenMensualizacionExtra = 'SEMANAL_4_33' | 'DIARIO_24_08';

export type ResultadoDerivacionComercial =
  | {
      ok: true;
      distribucion: DistribucionHorasMetodoComercial;
      cuotaOrdinariaDiariaComercialHoras: number;
      diasOrdinariosProgramadosSemana: number;
      /** Intérprete automático de turnos (§ cierre "INTÉRPRETE AUTOMÁTICO
       * DE TURNOS") — metadata de solo lectura, nunca bloquea ni pregunta.
       * `distribucion` arriba ya refleja la cuota fija de 10,5h/turno
       * cuando `interpretacion.tipoOperacionInterpretada` es
       * TURNO_12_HORAS_INDIVIDUAL, COBERTURA_12_7 o COBERTURA_24_7. */
      interpretacion: ResultadoInterpretacionTurno;
      /** Total semanal EFECTIVO (bruto, sin ponderar ÷6) — L-D, descansos
       * ya descontados. Usado para el resumen visual y para detectar
       * exceso sobre la jornada semanal (corrección CT 172). */
      horasEfectivasSemanaTotal: number;
      /** Exceso sobre la jornada semanal configurada (42h por defecto),
       * `max(0, horasEfectivasSemanaTotal − jornadaOrdinariaSemanalComercial)` —
       * SOLO de días de patrón genérico (nunca de turnos de 12h fijo). */
      horasExtraSemanalGenerica: number;
      /** Sobretiempo semanal (bruto, sin ponderar ÷6) originado ÚNICAMENTE
       * en días de patrón genérico tras acumular la jornada semanal
       * (incluye el día de descanso obligatorio cuando está programado y
       * el propio recorrido cronológico lo deja después de las 42h) — se
       * mensualiza con `factorSemanasPromedioMes` (4,33), nunca con
       * 24,08÷6 ni con 5,92 (ver `origenMensualizacionExtra`). En turnos
       * de 12h fijo/coberturas siempre quedan en 0 — esos casos no
       * cambian. */
      horasExtraSemanales: HorasExtraSemanalesComercial;
      origenMensualizacionExtra: OrigenMensualizacionExtra;
      /** Advertencia no bloqueante (ajuste "PROGRAMACIÓN DE SIETE DÍAS"):
       * `null` salvo que un cargo de patrón genérico (JORNADA_INDIVIDUAL/
       * PARCIAL — nunca COBERTURA_12_7/24_7) programe los 7 días de la
       * semana sin excluir el día de descanso obligatorio. Nunca bloquea
       * el cálculo — page.tsx debe mostrarla tal cual, sin nombres
       * técnicos de estado. */
      advertenciaProgramacion: string | null;
    }
  | { ok: false; motivo: string };

function minutosDesdeMedianoche(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

function esMinutoNocturno(minutoDelDia: number): boolean {
  const nocIni = NOCTURNO_INICIO_HORA * 60;
  const nocFin = NOCTURNO_FIN_HORA * 60;
  return minutoDelDia >= nocIni || minutoDelDia < nocFin;
}

interface MinutosClasificadosDia {
  ordinariaMin: number;
  recargoNocturnoMin: number;
  extraDiurnaMin: number;
  extraNocturnaMin: number;
}

/** Recorre los bloques de UN día en orden cronológico (§6), excluyendo el
 * hueco entre bloques (descanso, nunca contado — §9). Hasta agotar la
 * cuota ordinaria diaria comercial, cada minuto es ordinaria (diurno) o
 * recargo nocturno (nocturno); después de agotarla, extra diurna o extra
 * nocturna. Cada minuto queda en un único concepto — nunca se duplica.
 *
 * `reiniciarCuotaPorBloque` (intérprete automático de turnos): cuando el
 * día tiene 2 bloques complementarios de 12h (patrón COBERTURA_24_7,
 * ej. 06:00-18:00 + 18:00-06:00), cada bloque es un TURNO independiente
 * con su propia cuota — nunca se acumulan como si fueran las horas de
 * una sola persona trabajando 24h seguidas (eso duplicaría/inflaría la
 * clasificación). Con la cuota jornada/días normal (false, default), el
 * comportamiento es idéntico al de siempre: cuota única acumulada a
 * través de todos los bloques del día.
 *
 * `acumuladoInicialMin` (ajuste "ACUMULADOR SEMANAL UNIFICADO"): permite
 * encadenar el acumulado de días anteriores de la MISMA semana — así la
 * cuota (`cuotaOrdinariaMin`) puede representar la jornada semanal
 * completa (42h) en vez de una cuota por día, y el acumulado real
 * atraviesa el recorrido cronológico L→D sin reiniciarse cada día. */
function clasificarDiaComercial(bloques: BloqueHorario[], cuotaOrdinariaMin: number, reiniciarCuotaPorBloque = false, acumuladoInicialMin = 0): MinutosClasificadosDia {
  const ordenados = [...bloques].sort((a, b) => a.orden - b.orden);
  let acumuladoMin = acumuladoInicialMin;
  let ordinariaMin = 0, recargoNocturnoMin = 0, extraDiurnaMin = 0, extraNocturnaMin = 0;
  for (const b of ordenados) {
    if (reiniciarCuotaPorBloque) acumuladoMin = 0;
    const inicioMin = minutosDesdeMedianoche(b.inicio);
    const finMin = minutosDesdeMedianoche(b.fin);
    const duracion = finMin > inicioMin ? finMin - inicioMin : (1440 - inicioMin) + finMin; // cruce de medianoche
    for (let k = 0; k < duracion; k++) {
      const minutoDelDia = (inicioMin + k) % 1440;
      const nocturno = esMinutoNocturno(minutoDelDia);
      const dentroCuota = acumuladoMin < cuotaOrdinariaMin;
      if (dentroCuota) { if (nocturno) recargoNocturnoMin++; else ordinariaMin++; }
      else { if (nocturno) extraNocturnaMin++; else extraDiurnaMin++; }
      acumuladoMin++;
    }
  }
  return { ordinariaMin, recargoNocturnoMin, extraDiurnaMin, extraNocturnaMin };
}

/** Ciclo semanal L→M→X→J→V→S→D→L (Opción C, rollover de día de semana en
 * cruce de medianoche) — usado ÚNICAMENTE para saber si el día siguiente
 * de `dia` es el día de descanso obligatorio (hoy siempre 'D', pero
 * calculado de forma genérica, nunca hardcodeado a 'S'/'D' en el punto de
 * uso). */
const SIGUIENTE_DIA_SEMANA: Record<DiaSemanaHorario, DiaSemanaHorario> = {
  L: 'M', M: 'X', X: 'J', J: 'V', V: 'S', S: 'D', D: 'L',
};

/** true si ALGÚN bloque, tomado de forma aislada, envuelve medianoche
 * (fin<=inicio) — única señal que activa el corte de rollover, nunca una
 * heurística sobre la duración total del día. */
function bloqueEnvuelveMedianoche(bloques: BloqueHorario[]): boolean {
  return bloques.some(b => minutosDesdeMedianoche(b.fin) <= minutosDesdeMedianoche(b.inicio));
}

/**
 * Corrección "OPCIÓN C — ROLLOVER DE DÍA DE SEMANA EN CRUCE DE
 * MEDIANOCHE" (diagnóstico Aseocolba, decisión de negocio: la cuota
 * ordinaria NUNCA se reinicia a medianoche, pero la clasificación
 * dominical/festiva SÍ debe respetar el día real en que se trabaja cada
 * minuto). Variante de `clasificarDiaComercial` que separa su salida en
 * dos mitades — los minutos cuya posición absoluta dentro del recorrido
 * de bloques es `< 1440` ("antesMedianoche", pertenecen a ESTE día) y los
 * que caen en `>= 1440` ("despuesMedianoche", pertenecen al día calendario
 * siguiente en el ciclo `SIGUIENTE_DIA_SEMANA`). El acumulador de cuota
 * (`acumuladoMin`) es EXACTAMENTE el mismo recorrido continuo de
 * `clasificarDiaComercial` — la cuota nunca se reinicia al cruzar
 * medianoche, solo cambia a cuál de las dos salidas se enruta cada minuto
 * ya clasificado. El caller decide qué hacer con cada mitad (sumarla al
 * bucket ordinario o al especial) — esta función nunca lo decide.
 *
 * Usada ÚNICAMENTE para el día inmediatamente anterior al día de descanso
 * obligatorio (hoy siempre sábado→domingo) y para el propio día de
 * descanso obligatorio cuando su bloque envuelve hacia el día siguiente
 * (domingo→lunes) — NUNCA para transiciones ordinario↔ordinario (L→M,
 * M→X, X→J, J→V, V→S), que no requieren este corte: ambos lados ya se
 * agrupan en el mismo bucket agregado (`acumulado`/`extraSemanaGenericaMin`),
 * así que da igual si un minuto "pertenece" a un día ordinario o al
 * siguiente — el total agregado es idéntico sin necesidad de dividir
 * nada (ver reporte de diseño de Opción C). Tampoco se usa para turnos de
 * 12h fijo (`esTurnoFijoEfectivo`) — ver nota en el punto de uso.
 */
function clasificarDiaComercialConCorteMedianoche(
  bloques: BloqueHorario[], cuotaOrdinariaMin: number, acumuladoInicialMin: number,
): { antesMedianoche: MinutosClasificadosDia; despuesMedianoche: MinutosClasificadosDia } {
  const ordenados = [...bloques].sort((a, b) => a.orden - b.orden);
  let acumuladoMin = acumuladoInicialMin;
  const antesMedianoche: MinutosClasificadosDia = { ordinariaMin: 0, recargoNocturnoMin: 0, extraDiurnaMin: 0, extraNocturnaMin: 0 };
  const despuesMedianoche: MinutosClasificadosDia = { ordinariaMin: 0, recargoNocturnoMin: 0, extraDiurnaMin: 0, extraNocturnaMin: 0 };
  for (const b of ordenados) {
    const inicioMin = minutosDesdeMedianoche(b.inicio);
    const finMin = minutosDesdeMedianoche(b.fin);
    const duracion = finMin > inicioMin ? finMin - inicioMin : (1440 - inicioMin) + finMin;
    for (let k = 0; k < duracion; k++) {
      const posicionAbsoluta = inicioMin + k; // puede superar 1440 si el bloque envuelve medianoche
      const minutoDelDia = posicionAbsoluta % 1440;
      const nocturno = esMinutoNocturno(minutoDelDia);
      const dentroCuota = acumuladoMin < cuotaOrdinariaMin;
      const destino = posicionAbsoluta < 1440 ? antesMedianoche : despuesMedianoche;
      if (dentroCuota) { if (nocturno) destino.recargoNocturnoMin++; else destino.ordinariaMin++; }
      else { if (nocturno) destino.extraNocturnaMin++; else destino.extraDiurnaMin++; }
      acumuladoMin++;
    }
  }
  return { antesMedianoche, despuesMedianoche };
}

function sumarClasificados(a: MinutosClasificadosDia, b: MinutosClasificadosDia): MinutosClasificadosDia {
  return {
    ordinariaMin: a.ordinariaMin + b.ordinariaMin,
    recargoNocturnoMin: a.recargoNocturnoMin + b.recargoNocturnoMin,
    extraDiurnaMin: a.extraDiurnaMin + b.extraDiurnaMin,
    extraNocturnaMin: a.extraNocturnaMin + b.extraNocturnaMin,
  };
}

/**
 * Ajuste "HORAS EXTRAS POR JORNADA SEMANAL, NO POR DÍA" — clasificación de UN
 * día de patrón genérico con DOS topes simultáneos. Cada minuto es ordinario
 * (diurno) o recargo nocturno (nocturno) solo si cabe en AMBOS:
 *   - el tope diario (`topeDiaMin`: 8h, o 9h con jornada flexible), contado
 *     sobre todos los minutos trabajados ese día (la cuota nunca se reinicia
 *     por bloque ni a medianoche), y
 *   - el tope semanal (`topeSemanaMin`: 42h), contado únicamente sobre los
 *     minutos ORDINARIOS ya acumulados en la semana
 *     (`ordinariaSemanaPrevMin`, de los días anteriores) — un minuto que ya
 *     salió como extra por exceder el día no vuelve a gastar jornada semanal.
 * Lo que no cabe en alguno de los dos es extra diurna/nocturna según la hora.
 * El caller recorre los días en orden cronológico (L→S) encadenando
 * `ordinariaSemanaMin`, así el exceso semanal cae en las últimas horas de la
 * semana, que son las que de verdad superan las 42h.
 *
 * Devuelve la salida partida en antes/después de medianoche (misma semántica
 * que `clasificarDiaComercialConCorteMedianoche`, para el rollover S→D); el
 * caller que no necesita el corte suma ambas mitades.
 */
function clasificarDiaConTopes(
  bloques: BloqueHorario[], topeDiaMin: number, topeSemanaMin: number, ordinariaSemanaPrevMin: number,
): { antesMedianoche: MinutosClasificadosDia; despuesMedianoche: MinutosClasificadosDia; ordinariaSemanaMin: number } {
  const ordenados = [...bloques].sort((a, b) => a.orden - b.orden);
  let acumuladoDiaMin = 0;
  let ordinariaSemanaMin = ordinariaSemanaPrevMin;
  const antesMedianoche: MinutosClasificadosDia = { ordinariaMin: 0, recargoNocturnoMin: 0, extraDiurnaMin: 0, extraNocturnaMin: 0 };
  const despuesMedianoche: MinutosClasificadosDia = { ordinariaMin: 0, recargoNocturnoMin: 0, extraDiurnaMin: 0, extraNocturnaMin: 0 };
  for (const b of ordenados) {
    const inicioMin = minutosDesdeMedianoche(b.inicio);
    const finMin = minutosDesdeMedianoche(b.fin);
    const duracion = finMin > inicioMin ? finMin - inicioMin : (1440 - inicioMin) + finMin;
    for (let k = 0; k < duracion; k++) {
      const posicionAbsoluta = inicioMin + k;
      const nocturno = esMinutoNocturno(posicionAbsoluta % 1440);
      const dentroTopes = acumuladoDiaMin < topeDiaMin && ordinariaSemanaMin < topeSemanaMin;
      const destino = posicionAbsoluta < 1440 ? antesMedianoche : despuesMedianoche;
      if (dentroTopes) { if (nocturno) destino.recargoNocturnoMin++; else destino.ordinariaMin++; ordinariaSemanaMin++; }
      else { if (nocturno) destino.extraNocturnaMin++; else destino.extraDiurnaMin++; }
      acumuladoDiaMin++;
    }
  }
  return { antesMedianoche, despuesMedianoche, ordinariaSemanaMin };
}

function minutosAHoras(min: number): number { return min / 60; }

/**
 * Ajuste "CIERRE FINAL DE AISLAMIENTO" — Alternativa A (menor impacto, sin
 * duplicar el motor): esta función ya NO se exporta bajo su nombre
 * ambiguo/histórico. Es el constructor interno compartido — soporta ambas
 * metodologías porque `derivarDistribucionHorasComercialActivo` (abajo, el
 * ÚNICO punto de entrada productivo) delega en ella tras filtrar
 * `LEGADO_COMERCIAL_30_DIAS`. La variante para pruebas/compatibilidad
 * histórica que SÍ necesita invocar la rama legada directamente se expone
 * más abajo bajo un nombre inequívoco
 * (`derivarDistribucionComercialHistoricoParaPruebas`) — nunca bajo este
 * nombre, para que ningún import productivo (page.tsx, rutas API) pueda
 * confundirla con el punto de entrada activo.
 */
function derivarDistribucionHorasComercialInterno(
  entrada: EntradaDerivacionComercial,
): ResultadoDerivacionComercial {
  const jornadaSemanal = entrada.jornadaOrdinariaSemanalComercial ?? JORNADA_ORDINARIA_SEMANAL_COMERCIAL_DEFAULT;
  // Corrección "RECARGO COMERCIAL DOMINICAL SIEMPRE" — `entrada.diaDescansoObligatorio`
  // (dato legal, pactado o no) YA NO decide qué día se aísla para el
  // recargo dominical/festivo: esta es una política COMERCIAL de la
  // empresa, siempre domingo, independiente de cualquier pacto de
  // descanso obligatorio legal. El parámetro se conserva en el tipo por
  // compatibilidad de firma con los llamadores existentes, pero se
  // IGNORA deliberadamente aquí — nunca vuelve el domingo trabajado en
  // un día ordinario sin recargo, sin importar su valor.
  const diaDescansoObligatorio = DIA_DESCANSO_OBLIGATORIO_DEFAULT;
  // Ajuste "METODOLOGÍA EXPLÍCITA EN EL MOTOR" — nunca un default
  // silencioso: TypeScript ya exige el campo en EntradaDerivacionComercial,
  // esta validación en runtime cubre callers JS/no tipados y evita que un
  // `undefined` se cuele hasta aquí sin que nadie lo note.
  if (entrada.metodologiaCosteo !== 'SEMANAL_4_33' && entrada.metodologiaCosteo !== 'LEGADO_COMERCIAL_30_DIAS') {
    throw new Error('derivarDistribucionHorasComercialDesdeHorario: metodologiaCosteo es obligatorio (\'SEMANAL_4_33\' | \'LEGADO_COMERCIAL_30_DIAS\') — resuélvalo antes de llamar al derivador (compatibilidad histórica, §9), nunca lo infiera este núcleo.');
  }
  // Corrección "CUOTA DIARIA FIJA DE 7H — SEPARACIÓN ACTIVO/HISTÓRICO"
  // (Fase 3, revisión tras contradicción CT 172): `metodologiaCosteo` se
  // sigue leyendo aquí, PERO exclusivamente para reproducir el camino
  // HISTÓRICO (`LEGADO_COMERCIAL_30_DIAS`) — nunca para decidir la regla
  // del camino ACTIVO. Esto no es una bandera ambigua: el único punto de
  // entrada productivo (`derivarDistribucionHorasComercialActivo`)
  // RECHAZA `LEGADO_COMERCIAL_30_DIAS` con un `throw` ANTES de llegar
  // aquí (ver más abajo) — estructuralmente, este núcleo compartido NUNCA
  // recibe `LEGADO_COMERCIAL_30_DIAS` desde el camino activo. Solo
  // `derivarDistribucionComercialHistoricoParaPruebas` (nombre
  // inequívoco, documentado como nunca importable desde producción) puede
  // invocar la rama histórica.
  const metodologiaCosteo = entrada.metodologiaCosteo;

  if (entrada.distribucionesHorario.length === 0) {
    return { ok: false, motivo: 'El cargo no tiene ninguna distribución horaria configurada.' };
  }
  if (entrada.distribucionesHorario.some(d => d.bloques.length === 0)) {
    return { ok: false, motivo: 'Una de las distribuciones no tiene bloques horarios válidos.' };
  }

  // §4 del cierre correctivo — CADA distribución se procesa de forma
  // independiente: se normaliza (24h→2×12h) y se valida (solapamientos,
  // duración inválida) ANTES de asignarla a sus días. Un mismo día nunca
  // se sobrescribe silenciosamente: si dos distribuciones asignan
  // horarios distintos al mismo día, se bloquea con un mensaje claro
  // (colisión) — nunca se escoge una de las dos en silencio.
  const bloquesPorDia = new Map<DiaSemanaHorario, BloqueHorario[]>();
  for (const dist of entrada.distribucionesHorario) {
    const bloquesNormalizados = normalizarBloques24Horas(dist.bloques);
    const validacion = validarBloquesTurno(bloquesNormalizados);
    if (!validacion.ok) {
      return { ok: false, motivo: validacion.motivo! };
    }
    for (const dia of dist.diasSemana) {
      const existente = bloquesPorDia.get(dia);
      if (existente && claveBloques(existente) !== claveBloques(bloquesNormalizados)) {
        return {
          ok: false,
          motivo: `El día ${NOMBRE_DIA[dia]} tiene dos programaciones distintas asignadas en distribuciones diferentes — corrige la colisión antes de calcular.`,
        };
      }
      bloquesPorDia.set(dia, bloquesNormalizados);
    }
  }

  // Ajuste "IMPLEMENTACIÓN CONTROLADA" — reversión provisional: el día de
  // descanso obligatorio (domingo, política comercial SIEMPRE — ver nota
  // arriba sobre `diaDescansoObligatorio`) deja de participar del
  // acumulador semanal compartido y de la reclasificación estadística de
  // festivos generalizada — se aísla, con cuota propia, mensualizado
  // íntegramente con 5,92.
  const diasOrdinarios: DiaSemanaHorario[] = (['L', 'M', 'X', 'J', 'V', 'S', 'D'] as DiaSemanaHorario[])
    .filter(d => d !== diaDescansoObligatorio && bloquesPorDia.has(d));
  const diasOrdinariosProgramadosSemana = diasOrdinarios.length;
  const diaDescansoProgramado = bloquesPorDia.has(diaDescansoObligatorio);
  if (diasOrdinariosProgramadosSemana === 0 && !diaDescansoProgramado) {
    return { ok: false, motivo: 'Debe programar al menos un día ordinario (lunes a sábado) para derivar la clasificación comercial.' };
  }

  // Ajuste "DIAGNOSTICAR Y CORREGIR HORAS EXTRAS SEMANALES Y MENSUALES" —
  // `clasificarPatronBloquesDia` clasifica CUALQUIER bloque de exactamente
  // 12h como "turno fijo" (UNICO_12H) mirando SOLO la duración, sin
  // importar si realmente es un turno rotativo/cobertura (Avianca,
  // COBERTURA_12_7/24_7 — los casos ya aprobados para la cuota fija de
  // 10,5h/día) o simplemente un horario ordinario que coincide en
  // duración con 12h (ej. L-V 06:00-18:00, un vigilante con jornada
  // individual normal). Un bloque UNICO_12H ahora SOLO se trata como
  // turno fijo cuando la programación cubre los 7 días de la semana
  // (`cubreSieteDiasProgramacion` — la misma condición ya usada más abajo
  // para `advertenciaProgramacion`, nunca una segunda regla nueva);
  // DOBLE_12H (dos bloques que rotan dentro del mismo día) sigue siendo
  // SIEMPRE turno fijo, sin cambios — ese patrón por definición nunca es
  // una jornada individual ordinaria. Un horario que NO cubre los 7 días
  // (L-V, L-S, etc.) participa del acumulador semanal de 42h como
  // cualquier jornada individual, aunque cada día dure exactamente 12h.
  const cubreSieteDiasProgramacion = diasOrdinariosProgramadosSemana + (diaDescansoProgramado ? 1 : 0) === 7;
  function esTurnoFijoEfectivo(bloques: BloqueHorario[]): boolean {
    const patron = clasificarPatronBloquesDia(bloques);
    if (patron === 'DOBLE_12H') return true;
    if (patron === 'UNICO_12H') return cubreSieteDiasProgramacion;
    return false;
  }

  // Ajuste "FESTIVOS SEGÚN LOS DÍAS REALMENTE PROGRAMADOS" (§1/§2): una
  // jornada L-V (u otra combinación sin domingo) con incluyeFestivos=true
  // YA NO se bloquea — "incluye festivos" significa "si un festivo real
  // coincide con un día seleccionado, esas horas se reclasifican", nunca
  // "agregar domingo obligatoriamente".

  // Cuota (corrección "distribución semanal irregular", caso CT 172): un
  // día con patrón de turno de 12h fijo (uno o dos bloques de 12h) sigue
  // usando SIEMPRE la cuota fija 42÷4=10,5h por turno, sin cambios (casos
  // ya aprobados: Avianca, coberturas 12/7 y 24/7).
  //
  // Un día con horario normal (patrón 'OTRO' — JORNADA_INDIVIDUAL/PARCIAL)
  // que NO es el día de descanso obligatorio participa del acumulador
  // semanal COMPARTIDO (L→S u otra combinación sin el día de descanso),
  // recorrido cronológicamente: las horas de cada día son ordinarias
  // mientras el acumulado semanal no supere `jornadaSemanal` (42h por
  // defecto); todo lo que exceda, sin importar en cuál día caiga, es hora
  // extra semanal (CT 172, sin domingo involucrado — sin cambios).
  //
  // El día de descanso obligatorio (reversión provisional): NUNCA entra a
  // este acumulador compartido — se procesa aparte, con su propia cuota
  // (`jornadaSemanal ÷ díasOrdinariosProgramados`), exactamente como el
  // mecanismo histórico de domingo.
  const cuotaGenericaMin = Math.round((jornadaSemanal / Math.max(1, diasOrdinariosProgramadosSemana)) * 60);

  // Festivos reales que coinciden con días ordinarios seleccionados (§2/
  // §6/§7 del ajuste "FESTIVOS SEGÚN LOS DÍAS REALMENTE PROGRAMADOS").
  // Solo aplica a días con patrón GENÉRICO (jornadas normales) — nunca a
  // días con patrón de turno de 12h fijo (COBERTURA_12_7/24_7/TURNO_12_
  // HORAS_INDIVIDUAL, §11): esos casos ya aprobados (Avianca, 12h) quedan
  // intocados, siguen usando exclusivamente 5,92 vía el día de descanso.
  // Reversión provisional: DESACTIVADA por completo cuando el día de
  // descanso obligatorio está programado (mismo gate histórico
  // `!domingoProgramado`, generalizado al día configurado) — protege los
  // 6 casos auditados hasta contar con Excel que confirme la
  // generalización. Cuando `incluyeFestivos` es false, el mapa de
  // promedios nunca se calcula ni se usa — comportamiento vigente sin
  // cambios (§12.8).
  const festivosPromedioMesPorDia = entrada.incluyeFestivos
    ? calcularFestivosPromedioMesPorDiaSemana(resolverAnioCalculo(entrada.anioCalculo))
    : null;
  const { diasOrdinariosPromedioMes, domingosFestivosPromedioMes } = PARAMETROS_METODO_COMERCIAL_30_DIAS_DEFAULT;

  // Ajuste "HORAS EXTRAS POR JORNADA SEMANAL, NO POR DÍA" (reemplaza la
  // antigua cuota fija de 7h por día, "SEPARACIÓN ACTIVO/HISTÓRICO" del
  // diagnóstico Aseocolba): la clasificación de un patrón genérico L-S del
  // CAMINO ACTIVO recorre la semana L→S con DOS topes (ver
  // `clasificarDiaConTopes`) — el diario (8h, o 9h con `jornadaFlexible`) y
  // el semanal (42h de horas ordinarias). Un día corto SÍ compensa a uno
  // largo mientras ninguno pase el tope diario y la semana no pase de 42h.
  // `esRutaHistoricaLegado` (más abajo) EXISTE únicamente para que el
  // camino HISTÓRICO
  // (`derivarDistribucionComercialHistoricoParaPruebas`, invocado con
  // `metodologiaCosteo:'LEGADO_COMERCIAL_30_DIAS'`) siga reproduciendo
  // EXACTAMENTE su cálculo original (cuota=jornadaSemanal÷díasProgramados,
  // mensualizado con 24,08 vía `horasExtraDiurnaDiaOrdinario`/
  // `horasExtraNocturnaDiaOrdinario`, nunca vía el bucket semanal) para
  // trazabilidad de costeos ya guardados — el camino ACTIVO nunca puede
  // tomar esta rama, porque `derivarDistribucionHorasComercialActivo`
  // rechaza `LEGADO_COMERCIAL_30_DIAS` con un `throw` antes de llegar
  // aquí (ver `MetodologiaLegadaNoEjecutableError` más abajo) — no es una
  // bandera que el camino activo pueda "elegir mal", es estructuralmente
  // inalcanzable desde ahí.
  const esRutaHistoricaLegado = metodologiaCosteo === 'LEGADO_COMERCIAL_30_DIAS';
  const topeDiaMin = Math.round((entrada.jornadaFlexible
    ? JORNADA_DIARIA_MAXIMA_FLEXIBLE_HORAS
    : (entrada.jornadaDiariaOrdinariaHoras ?? JORNADA_DIARIA_ORDINARIA_HORAS_DEFAULT)) * 60);
  const topeSemanaMin = Math.round(jornadaSemanal * 60);
  // Horas ordinarias de patrón genérico ya acumuladas en la semana (minutos),
  // encadenadas día a día contra `topeSemanaMin`.
  let ordinariaSemanaMin = 0;
  const acumulado = { ordinariaMin: 0, recargoNocturnoMin: 0, extraDiurnaMin: 0, extraNocturnaMin: 0 };
  // Horas/mes reclasificadas de ordinario a festivo por coincidencia real
  // de calendario — se resta de `horasXDiaOrdinario` (÷24,08) y se suma a
  // `horasXFestivaDiaEspecial` (÷5,92) — nunca crea horas nuevas.
  const reclasificadoHorasMes = { ordinaria: 0, recargoNocturno: 0, extraDiurna: 0, extraNocturna: 0 };
  // Sobretiempo semanal (minutos brutos, sin ÷6) — CAMINO ACTIVO: se
  // origina en las horas de patrón genérico que excedan el tope diario
  // (8h, o 9h flexible) o la jornada semanal de 42h, lo que ocurra primero
  // (uniforme o irregular, sin distinción); se
  // mensualiza con `factorSemanasPromedioMes` (4,33), nunca con 24,08÷6
  // ni con 5,92. CAMINO HISTÓRICO (`esRutaHistoricaLegado`): este bucket
  // permanece SIEMPRE en 0 — el sobretiempo de ese camino sale por
  // `acumulado.extraDiurnaMin`/`extraNocturnaMin` (÷24,08), exactamente
  // como reproducía el mecanismo original. El día de descanso obligatorio
  // NUNCA suma aquí en ningún camino — su sobretiempo sigue el mecanismo
  // histórico aislado (5,92), igual que los turnos de 12h fijo.
  const extraSemanaGenericaMin = { diurna: 0, nocturna: 0 };
  // Opción C (rollover S→D) — acumula la porción "después de medianoche"
  // que un día ordinario (hoy siempre sábado, el único cuyo día siguiente
  // en el ciclo es el día de descanso obligatorio) desborda hacia el día
  // de descanso obligatorio. Se suma a `especial` más abajo,
  // INDEPENDIENTEMENTE de si ese día fue programado explícitamente o no
  // (el desborde ocurre por el propio cruce de medianoche del bloque de
  // sábado, no por una configuración separada de domingo).
  const especialDesdeRolloverOrdinario = { ordinariaMin: 0, recargoNocturnoMin: 0, extraDiurnaMin: 0, extraNocturnaMin: 0 };
  for (const dia of diasOrdinarios) {
    const bloquesDia = bloquesPorDia.get(dia)!;
    const esTurnoFijo = esTurnoFijoEfectivo(bloquesDia);
    // Camino activo (patrón genérico): el día se clasifica con los topes
    // diario y semanal (`clasificarDiaConTopes`), encadenando
    // `ordinariaSemanaMin` de los días anteriores. El tope diario nunca se
    // reinicia por bloque dentro del día (un horario partido con descanso
    // sigue sumando su tiempo efectivo trabajado hacia el MISMO tope, nunca
    // dos topes separados). Turno de 12h fijo: cuota propia por bloque, sin
    // entrar al tope semanal. Camino histórico: cuota derivada de
    // `cuotaGenericaMin` (42÷díasProgramados), sin acumulador entre días —
    // igual que el mecanismo original.
    // Opción C (rollover S→D) — los topes NUNCA cambian por esto: solo se
    // activa un corte que enruta la porción posterior a medianoche hacia el
    // bucket especial en vez del ordinario. Nunca se activa para turnos de
    // 12h fijo (`esTurnoFijo` — ver informe de diseño: en una cobertura
    // simétrica de 7 días el rollover existe físicamente, pero
    // redistribuirlo entre días da un resultado semanal agregado
    // equivalente y arriesga romper casos históricos ya validados sin
    // cambiar nada real) ni en el camino histórico (invariante).
    const activaCorteRolloverSabado = !esTurnoFijo && !esRutaHistoricaLegado
      && SIGUIENTE_DIA_SEMANA[dia] === diaDescansoObligatorio
      && bloqueEnvuelveMedianoche(bloquesDia);
    let c: MinutosClasificadosDia;
    if (esTurnoFijo) {
      c = clasificarDiaComercial(bloquesDia, CUOTA_TURNO_12_HORAS_MIN, true);
    } else if (esRutaHistoricaLegado) {
      c = clasificarDiaComercial(bloquesDia, cuotaGenericaMin, false, 0);
    } else {
      const dividido = clasificarDiaConTopes(bloquesDia, topeDiaMin, topeSemanaMin, ordinariaSemanaMin);
      ordinariaSemanaMin = dividido.ordinariaSemanaMin;
      if (activaCorteRolloverSabado) {
        c = dividido.antesMedianoche;
        especialDesdeRolloverOrdinario.ordinariaMin += dividido.despuesMedianoche.ordinariaMin;
        especialDesdeRolloverOrdinario.recargoNocturnoMin += dividido.despuesMedianoche.recargoNocturnoMin;
        especialDesdeRolloverOrdinario.extraDiurnaMin += dividido.despuesMedianoche.extraDiurnaMin;
        especialDesdeRolloverOrdinario.extraNocturnaMin += dividido.despuesMedianoche.extraNocturnaMin;
      } else {
        c = sumarClasificados(dividido.antesMedianoche, dividido.despuesMedianoche);
      }
    }
    if (!esTurnoFijo && !esRutaHistoricaLegado) {
      extraSemanaGenericaMin.diurna += c.extraDiurnaMin;
      extraSemanaGenericaMin.nocturna += c.extraNocturnaMin;
    }
    acumulado.ordinariaMin += c.ordinariaMin;
    acumulado.recargoNocturnoMin += c.recargoNocturnoMin;
    acumulado.extraDiurnaMin += c.extraDiurnaMin;
    acumulado.extraNocturnaMin += c.extraNocturnaMin;

    // Reclasificación SOLO cuando el día de descanso obligatorio no está
    // programado (reversión provisional del ajuste "ACUMULADOR SEMANAL
    // UNIFICADO" — los casos que ya incluyen ese día siguen usando
    // exclusivamente el mecanismo ya aprobado de 5,92, sin cambio).
    // Aplica igual con patrón uniforme o irregular — nunca depende de la
    // selección DIARIO_24,08/SEMANAL_4,33.
    const festivosPromedioEsteDia = festivosPromedioMesPorDia && esTurnoFijo === false && !diaDescansoProgramado ? festivosPromedioMesPorDia[dia] : 0;
    if (festivosPromedioEsteDia > 0) {
      reclasificadoHorasMes.ordinaria += minutosAHoras(c.ordinariaMin) * festivosPromedioEsteDia;
      reclasificadoHorasMes.recargoNocturno += minutosAHoras(c.recargoNocturnoMin) * festivosPromedioEsteDia;
      reclasificadoHorasMes.extraDiurna += minutosAHoras(c.extraDiurnaMin) * festivosPromedioEsteDia;
      reclasificadoHorasMes.extraNocturna += minutosAHoras(c.extraNocturnaMin) * festivosPromedioEsteDia;
    }
  }

  let especial = { ordinariaMin: 0, recargoNocturnoMin: 0, extraDiurnaMin: 0, extraNocturnaMin: 0 };
  let cuotaOrdinariaDiariaComercialHoras = cuotaGenericaMin / 60;
  if (diaDescansoProgramado) {
    const bloquesDescanso = bloquesPorDia.get(diaDescansoObligatorio)!;
    // El día de descanso obligatorio NUNCA participa del acumulador
    // semanal genérico (reversión provisional) — es un día "especial" con
    // su propia clasificación independiente, exactamente como antes del
    // ajuste "ACUMULADOR SEMANAL UNIFICADO".
    const esTurnoFijoDescanso = esTurnoFijoEfectivo(bloquesDescanso);
    const cuotaMin = esTurnoFijoDescanso ? CUOTA_TURNO_12_HORAS_MIN : cuotaGenericaMin;
    const reiniciarPorBloque = esTurnoFijoDescanso;
    // Opción C (rollover D→L) — simétrico al rollover S→D del bucle
    // anterior: si el propio bloque del día de descanso obligatorio
    // envuelve medianoche, la porción posterior pertenece al día
    // siguiente (lunes) y debe salir del bucket ordinario, nunca del
    // especial — sin cambiar la cuota que gobierna el turno completo
    // (sigue siendo `cuotaMin`, decidida por el día en que el turno
    // empieza, domingo). Excluido para turno fijo e histórico, misma
    // razón que el rollover S→D.
    if (!esRutaHistoricaLegado && !esTurnoFijoDescanso && bloqueEnvuelveMedianoche(bloquesDescanso)) {
      const dividido = clasificarDiaComercialConCorteMedianoche(bloquesDescanso, cuotaMin, 0);
      especial = dividido.antesMedianoche;
      acumulado.ordinariaMin += dividido.despuesMedianoche.ordinariaMin;
      acumulado.recargoNocturnoMin += dividido.despuesMedianoche.recargoNocturnoMin;
      acumulado.extraDiurnaMin += dividido.despuesMedianoche.extraDiurnaMin;
      acumulado.extraNocturnaMin += dividido.despuesMedianoche.extraNocturnaMin;
      extraSemanaGenericaMin.diurna += dividido.despuesMedianoche.extraDiurnaMin;
      extraSemanaGenericaMin.nocturna += dividido.despuesMedianoche.extraNocturnaMin;
    } else {
      especial = clasificarDiaComercial(bloquesDescanso, cuotaMin, reiniciarPorBloque);
    }
    if (esTurnoFijoDescanso) {
      cuotaOrdinariaDiariaComercialHoras = cuotaMin / 60;
    }
  }
  // Opción C (rollover S→D) — suma la porción de después-de-medianoche
  // que algún día ordinario haya desbordado hacia el día de descanso
  // obligatorio (ver bucle anterior), sin importar si ese día fue
  // programado explícitamente o no.
  especial.ordinariaMin += especialDesdeRolloverOrdinario.ordinariaMin;
  especial.recargoNocturnoMin += especialDesdeRolloverOrdinario.recargoNocturnoMin;
  especial.extraDiurnaMin += especialDesdeRolloverOrdinario.extraDiurnaMin;
  especial.extraNocturnaMin += especialDesdeRolloverOrdinario.extraNocturnaMin;
  const domingoProgramado = diaDescansoProgramado;

  // Intérprete automático de turnos (§4/§7 del cierre) — metadata de solo
  // lectura. Ya no usa un "día representativo" fijo: evalúa el patrón de
  // TODOS los días ordinarios + domingo y solo declara una cobertura
  // permanente (12/7 o 24/7) cuando el patrón es uniforme en todos ellos;
  // si un cargo mezcla un turno de 12h con horarios distintos entre
  // distribuciones (caso no cubierto por los ejemplos obligatorios), se
  // declara TURNO_12_HORAS_INDIVIDUAL o JORNADA_INDIVIDUAL/PARCIAL según
  // corresponda — nunca se pregunta al usuario, nunca se bloquea por esto.
  const diasParaPatron = domingoProgramado ? [...diasOrdinarios, diaDescansoObligatorio] : diasOrdinarios;
  const patronesPorDia = diasParaPatron.map(d => clasificarPatronBloquesDia(bloquesPorDia.get(d)!));
  const patronUniforme = patronesPorDia.every(p => p === patronesPorDia[0]) ? patronesPorDia[0] : null;
  const diasSeleccionados: DiaSemanaHorario[] = [...bloquesPorDia.keys()];
  const bloquesParaInterpretar = patronUniforme && patronUniforme !== 'OTRO'
    ? bloquesPorDia.get(diasParaPatron[0])!
    : (bloquesPorDia.get(diasParaPatron.find(d => clasificarPatronBloquesDia(bloquesPorDia.get(d)!) !== 'OTRO') ?? diasOrdinarios[0])
      ?? bloquesPorDia.get(diasOrdinarios[0])!);
  const interpretacion = interpretarOperacionTurno({
    diasSemana: diasSeleccionados,
    bloques: bloquesParaInterpretar,
    incluyeFestivos: entrada.incluyeFestivos,
    cantidad: entrada.cantidadTrabajadores ?? 1,
  });

  // Mensualización por día-de-semana seleccionado (ajuste "MENSUALIZACIÓN
  // DE DÍAS ORDINARIOS SELECCIONADOS"): se divide SIEMPRE entre los 6
  // días ordinarios posibles, nunca entre `diasOrdinariosProgramadosSemana`
  // (el conteo real de días seleccionados). El sobretiempo de patrón
  // genérico (`extraSemanaGenericaMin`) se EXCLUYE aquí de
  // `horasExtraDiurnaDiaOrdinario`/`horasExtraNocturnaDiaOrdinario` — esos
  // dos campos quedan reservados exclusivamente para sobretiempo de
  // turnos de 12h fijo (mensualizado vía 24,08÷6, sin cambios). El
  // sobretiempo genérico se reporta aparte, en `horasExtraSemanales`
  // (bruto, semanal), para mensualizarse con 4,33 — nunca los dos a la vez
  // sobre las mismas horas.
  // Corrección "CONSERVACIÓN DE HORAS RECLASIFICADAS — FESTIVO ESTADÍSTICO
  // + SOBRETIEMPO GENÉRICO" (Fase 3B): `reclasificadoHorasMes.extraDiurna`/
  // `.extraNocturna` representa horas/mes que se MUEVEN desde su bucket de
  // origen hacia el bucket festivo (línea de abajo) — nunca se crean ni se
  // duplican. El bucket de origen depende del camino:
  //   - Camino HISTÓRICO (esRutaHistoricaLegado): el sobretiempo genérico
  //     vive en `acumulado.extraDiurnaMin`/`extraNocturnaMin` (mensualizado
  //     vía 24,08÷6 en `horasExtraDiurnaDiaOrdinario`/`...Nocturna...`) —
  //     ahí es donde se resta, exactamente como antes de Fase 3.
  //   - Camino ACTIVO: el sobretiempo genérico vive en
  //     `extraSemanaGenericaMin` (mensualizado vía 4,33 en
  //     `horasExtraSemanales`, más abajo) — `horasExtraDiurnaDiaOrdinario`/
  //     `...Nocturna...` YA es 0 para este sobretiempo (reservado
  //     exclusivamente a turnos de 12h fijo, que nunca participan de esta
  //     reclasificación), así que restar ahí produciría un bucket negativo
  //     sin quitarle nada al bucket real — la resta debe aplicarse en
  //     `horasExtraSemanales`, no aquí.
  const restarExtraDiaOrdinarioPorReclasificacion = esRutaHistoricaLegado;
  const distribucion: DistribucionHorasMetodoComercial = {
    horasOrdinariasDiaOrdinario: minutosAHoras(acumulado.ordinariaMin / DIAS_ORDINARIOS_SEMANA_COMERCIAL) - reclasificadoHorasMes.ordinaria / diasOrdinariosPromedioMes,
    horasRecargoNocturnoDiaOrdinario: minutosAHoras(acumulado.recargoNocturnoMin / DIAS_ORDINARIOS_SEMANA_COMERCIAL) - reclasificadoHorasMes.recargoNocturno / diasOrdinariosPromedioMes,
    horasExtraDiurnaDiaOrdinario: Math.max(0, minutosAHoras((acumulado.extraDiurnaMin - extraSemanaGenericaMin.diurna) / DIAS_ORDINARIOS_SEMANA_COMERCIAL) - (restarExtraDiaOrdinarioPorReclasificacion ? reclasificadoHorasMes.extraDiurna / diasOrdinariosPromedioMes : 0)),
    horasExtraNocturnaDiaOrdinario: Math.max(0, minutosAHoras((acumulado.extraNocturnaMin - extraSemanaGenericaMin.nocturna) / DIAS_ORDINARIOS_SEMANA_COMERCIAL) - (restarExtraDiaOrdinarioPorReclasificacion ? reclasificadoHorasMes.extraNocturna / diasOrdinariosPromedioMes : 0)),
    horasDominicalFestivaDiaEspecial: minutosAHoras(especial.ordinariaMin) + reclasificadoHorasMes.ordinaria / domingosFestivosPromedioMes,
    horasRecargoNocturnoFestivoDiaEspecial: minutosAHoras(especial.recargoNocturnoMin) + reclasificadoHorasMes.recargoNocturno / domingosFestivosPromedioMes,
    horasExtraDiurnaFestivaDiaEspecial: minutosAHoras(especial.extraDiurnaMin) + reclasificadoHorasMes.extraDiurna / domingosFestivosPromedioMes,
    horasExtraNocturnaFestivaDiaEspecial: minutosAHoras(especial.extraNocturnaMin) + reclasificadoHorasMes.extraNocturna / domingosFestivosPromedioMes,
  };

  // Corrección "COBERTURA vs. CAPACIDAD vs. RECARGOS — TURNANTES" —
  // `excluirDiaDescansoDeHorasEfectivas` (default false, sin cambio de
  // comportamiento) excluye ÚNICAMENTE la contribución del día especial
  // de este total informativo — `distribucion` (dinero, líneas arriba)
  // nunca se toca: el recargo dominical/festivo del día especial sigue
  // calculándose y permanece en el cargo, una sola vez, sin importar esta
  // bandera.
  const horasEfectivasSemanaTotal = minutosAHoras(
    acumulado.ordinariaMin + acumulado.recargoNocturnoMin + acumulado.extraDiurnaMin + acumulado.extraNocturnaMin
    + (entrada.excluirDiaDescansoDeHorasEfectivas
      ? 0
      : especial.ordinariaMin + especial.recargoNocturnoMin + especial.extraDiurnaMin + especial.extraNocturnaMin),
  );
  const horasExtraSemanalGenerica = minutosAHoras(extraSemanaGenericaMin.diurna + extraSemanaGenericaMin.nocturna);
  const origenMensualizacionExtra: OrigenMensualizacionExtra = horasExtraSemanalGenerica > 0 ? 'SEMANAL_4_33' : 'DIARIO_24_08';

  // Advertencia no bloqueante (ajuste "PROGRAMACIÓN DE SIETE DÍAS", §E):
  // un cargo de patrón genérico que cubre los 7 días de la semana sin
  // excluir su propio día de descanso obligatorio probablemente representa
  // una cobertura por turnantes mal configurada como jornada individual,
  // o un día de descanso faltante — nunca bloquea el cálculo. No aplica a
  // COBERTURA_12_7/24_7 (el día de descanso obligatorio solo es relevante
  // para patrón genérico; si ese mismo día es un turno de 12h fijo, el
  // cargo es una cobertura real, no una jornada individual sin descanso).
  const patronDiaDescanso = diaDescansoProgramado
    ? clasificarPatronBloquesDia(bloquesPorDia.get(diaDescansoObligatorio)!)
    : null;
  const cubreSieteDias = diasOrdinariosProgramadosSemana + (diaDescansoProgramado ? 1 : 0) === 7;
  // Ajuste "OCULTAR COMPLETAMENTE EL DÍA DE DESCANSO" (§4): el mensaje
  // nunca menciona "día de descanso obligatorio" ni el día específico —
  // es una alerta funcional simple, señal de que falta validar cobertura
  // de relevos/turnantes, nunca una instrucción para elegir un día.
  const advertenciaProgramacion = cubreSieteDias && patronDiaDescanso === 'OTRO'
    ? 'Esta programación requiere validar la cobertura de relevos o turnantes.'
    : null;

  return {
    ok: true, distribucion, cuotaOrdinariaDiariaComercialHoras, diasOrdinariosProgramadosSemana, interpretacion,
    horasEfectivasSemanaTotal, horasExtraSemanalGenerica, origenMensualizacionExtra, advertenciaProgramacion,
    // Corrección Fase 3B — la porción reclasificada a festivo (arriba,
    // `horasExtraDiurnaFestivaDiaEspecial`/`...NocturnaFestiva...`, en
    // horas/mes) debe SALIR de este bucket en el camino ACTIVO, para no
    // quedar contada dos veces (aquí ×4,33 Y en el bucket festivo ×5,92).
    // Se convierte de horas/mes a su equivalente semanal dividiendo entre
    // el mismo `FACTOR_SEMANAS_MES` (4,33) con el que este bucket se
    // mensualiza aguas abajo — así `(horasSemanales−equivalente)×4,33`
    // reproduce exactamente `horasMensualesOriginales−reclasificadoHorasMes`,
    // sin inventar un factor nuevo. En el camino histórico
    // (`esRutaHistoricaLegado`) este bucket ya es 0 siempre — la resta no
    // tiene efecto, la reclasificación de ese camino sigue saliendo de
    // `horasExtraDiurnaDiaOrdinario`/`...Nocturna...` arriba.
    horasExtraSemanales: {
      diurna: Math.max(0, minutosAHoras(extraSemanaGenericaMin.diurna) - (esRutaHistoricaLegado ? 0 : reclasificadoHorasMes.extraDiurna / FACTOR_SEMANAS_MES)),
      nocturna: Math.max(0, minutosAHoras(extraSemanaGenericaMin.nocturna) - (esRutaHistoricaLegado ? 0 : reclasificadoHorasMes.extraNocturna / FACTOR_SEMANAS_MES)),
      diurnaFestiva: 0,
      nocturnaFestiva: 0,
    },
  };
}

/**
 * Ajuste "ÚLTIMO ENDURECIMIENTO — IMPEDIR EJECUCIÓN ACTIVA DE 24,08" —
 * error explícito y controlado, nunca un `Error` genérico, para que un
 * caller pueda distinguirlo de un fallo de datos real. `LEGADO_COMERCIAL_
 * 30_DIAS` sigue existiendo como literal/tipo (trazabilidad histórica,
 * lectura de JSON antiguo) — esto solo bloquea su EJECUCIÓN.
 */
export class MetodologiaLegadaNoEjecutableError extends Error {
  constructor() {
    super(
      'LEGADO_COMERCIAL_30_DIAS ya no puede ejecutarse en un costeo activo — '
      + 'use SEMANAL_4_33. El valor legado solo se conserva para lectura y '
      + 'trazabilidad histórica, nunca como cálculo activo.',
    );
    this.name = 'MetodologiaLegadaNoEjecutableError';
  }
}

/**
 * Punto de entrada ACTIVO — el ÚNICO punto de entrada PRODUCTIVO para
 * derivar o recalcular una distribución (page.tsx, cualquier API o
 * servicio futuro). Fail-closed: rechaza explícitamente
 * `LEGADO_COMERCIAL_30_DIAS` con un error controlado ANTES de entrar a
 * cualquier lógica de clasificación — nunca ejecuta la rama de 24,08, sin
 * importar qué le haya pasado el caller.
 */
export function derivarDistribucionHorasComercialActivo(
  entrada: EntradaDerivacionComercial,
): ResultadoDerivacionComercial {
  if (entrada.metodologiaCosteo === 'LEGADO_COMERCIAL_30_DIAS') {
    throw new MetodologiaLegadaNoEjecutableError();
  }
  return derivarDistribucionHorasComercialInterno(entrada);
}

/**
 * SOLO PRUEBAS/COMPATIBILIDAD HISTÓRICA — NUNCA productivo. Único punto
 * por el que puede ejecutarse `LEGADO_COMERCIAL_30_DIAS` (soporta ambas
 * metodologías, igual que el constructor interno). Nombre deliberadamente
 * inequívoco: ningún import productivo (page.tsx, rutas API, servicios)
 * debe referenciar este símbolo — verificado por una prueba dedicada
 * (`ningún módulo productivo importa la variante histórica`). Los archivos
 * de prueba que solo necesitan SEMANAL_4_33 deben usar
 * `derivarDistribucionHorasComercialActivo`, no esta función.
 */
export function derivarDistribucionComercialHistoricoParaPruebas(
  entrada: EntradaDerivacionComercial,
): ResultadoDerivacionComercial {
  return derivarDistribucionHorasComercialInterno(entrada);
}