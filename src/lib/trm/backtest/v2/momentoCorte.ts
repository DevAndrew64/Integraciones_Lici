/**
 * Momento operativo de corte para USD/COP (Segunda Generación, Línea B —
 * entregable §1). Formaliza los 4 escenarios de `fechaHoraCorte` frente al
 * horario real del mercado SET-FX colombiano (spot 8:00–13:00 hora
 * Bogotá, fuente: set-icap-fx / SET-ICAP FX — el sistema electrónico cuyas
 * operaciones de un día hábil determinan la TRM que rige el día hábil
 * siguiente, certificada por la Superfinanciera). Solo diseño — no se
 * descarga ni se integra ningún dato aquí.
 */

export type EscenarioMomentoCorte = 'ANTES_JORNADA' | 'DURANTE_JORNADA' | 'DESPUES_CIERRE' | 'FIN_DIA_PRE_CERTIFICACION';

export interface AuditoriaEscenarioCorte {
  escenario: EscenarioMomentoCorte;
  descripcion: string;
  ventanaHoraBogota: string;
  usdCopDisponible: string[];
  usdCopNoDisponible: string[];
  trmOrigenDisponible: string;
  riesgoLeakage: 'NINGUNO' | 'BAJO' | 'MEDIO' | 'ALTO';
  notas: string;
}

/**
 * SET-FX spot (mercado a la vista): 08:00–13:00 hora Bogotá, días hábiles.
 * La TRM que la Superfinanciera certifica para el día D se calcula con las
 * operaciones de la sesión SET-FX del día hábil D-1 (mecanismo ya
 * modelado en `calendarioFuturo.ts`/`resolverSesionOrigenTrm`, harness v1).
 */
export const AUDITORIA_MOMENTO_CORTE: AuditoriaEscenarioCorte[] = [
  {
    escenario: 'ANTES_JORNADA',
    descripcion: 'A) Pronóstico antes de que abra SET-FX (ej. 06:00–07:59 Bogotá).',
    ventanaHoraBogota: '00:00–07:59',
    usdCopDisponible: [
      'Cotización de cierre del último día hábil SET-FX (open/high/low/close/volumen completos de la sesión anterior).',
      'Cotización spot del mercado FX global 24h (si se usa un proveedor internacional que sigue cotizando USD/COP fuera de SET-FX) — DISTINTA de SET-FX, con su propio riesgo de desalineación de calendario, ver §9.',
    ],
    usdCopNoDisponible: [
      'Cualquier dato de la sesión SET-FX del día en curso (todavía no ha abierto).',
    ],
    trmOrigenDisponible: 'TRM vigente hoy (certificada anoche/madrugada con la sesión SET-FX de ayer) — ya disponible completa.',
    riesgoLeakage: 'NINGUNO',
    notas: 'Escenario más seguro para features USD/COP: todo lo disponible es estrictamente pasado, sin ambigüedad de "sesión en curso".',
  },
  {
    escenario: 'DURANTE_JORNADA',
    descripcion: 'B) Pronóstico durante la sesión SET-FX en curso (08:00–13:00 Bogotá).',
    ventanaHoraBogota: '08:00–13:00',
    usdCopDisponible: [
      'Cotización de cierre de sesiones SET-FX anteriores (histórico completo).',
      'Spot PARCIAL del día en curso — únicamente el tramo ya transcurrido hasta `fechaHoraCorte` exacto (ej. si son las 10:00, solo 08:00–10:00), nunca el agregado de la sesión completa.',
    ],
    usdCopNoDisponible: [
      'Close/high/low/volumen FINAL de la sesión de HOY (la sesión todavía no terminó) — usar el cierre del día en curso aquí sería leakage directo.',
    ],
    trmOrigenDisponible: 'TRM vigente hoy (certificada con la sesión de ayer) — disponible completa.',
    riesgoLeakage: 'ALTO',
    notas: 'Riesgo ALTO si se usa cualquier estadístico "de la sesión completa de hoy" (close/high/low/volumen) en vez del tramo parcial real hasta el corte. Requiere que la feature "spot en corte" se calcule con datos de mercado con TIMESTAMP, no con el resumen diario del proveedor (que normalmente solo publica al cierre) — auditar esto por proveedor antes de usar.',
  },
  {
    escenario: 'DESPUES_CIERRE',
    descripcion: 'C) Pronóstico después del cierre de SET-FX pero el mismo día (13:01–23:59 Bogotá).',
    ventanaHoraBogota: '13:01–23:59',
    usdCopDisponible: [
      'Sesión SET-FX de HOY completa (open/high/low/close/volumen) — es justamente la sesión que la Superfinanciera usará para certificar la TRM de MAÑANA, así que ya es información legítimamente pasada respecto al target.',
    ],
    usdCopNoDisponible: [
      'Nada de la sesión de mañana (no existe todavía).',
    ],
    trmOrigenDisponible: 'TRM vigente hoy (certificada con la sesión de ayer, no la de hoy) — disponible completa.',
    riesgoLeakage: 'NINGUNO',
    notas: 'Mejor escenario para nowcast h=1: el close/high/low/volumen de HOY es la variable más directamente ligada al target (la TRM de mañana), y aquí SÍ está disponible sin leakage.',
  },
  {
    escenario: 'FIN_DIA_PRE_CERTIFICACION',
    descripcion: 'D) Pronóstico al final del día, después del cierre SET-FX, pero ANTES de que la Superfinanciera publique la TRM oficial de mañana.',
    ventanaHoraBogota: 'variable, típicamente tarde/noche — depende de la hora real de publicación de la Superfinanciera (pendiente de verificar exactamente)',
    usdCopDisponible: [
      'Igual que escenario C: sesión SET-FX de HOY completa.',
    ],
    usdCopNoDisponible: [
      'La TRM de mañana (el propio target) — aunque la sesión SET-FX que la determina ya cerró, la certificación oficial es un acto administrativo separado y posterior; nunca se debe asumir que el valor "ya se sabe" antes de la publicación.',
    ],
    trmOrigenDisponible: 'TRM vigente hoy (la de ayer) — la de mañana NO existe todavía como evento oficial, es exactamente lo que se pronostica.',
    riesgoLeakage: 'ALTO',
    notas: 'Riesgo NINGUNO si se respeta la distinción de abajo; ALTO si se confunde "sesión SET-FX cerrada" con "TRM ya certificada" — son 2 eventos distintos con 2 timestamps distintos, por eso se marca ALTO por defecto (exige disciplina explícita en la implementación). Distinción crítica para el nowcast h=1: el dataset causal (`datasetCausal.ts`, v1) ya usa `eventos[indiceOrigen].vigenciaDesde` como fechaCorte — nunca la fecha de publicación de USD/COP. Cualquier feature USD/COP debe alinearse contra ESE mismo corte, no contra un reloj propio.',
  },
];
