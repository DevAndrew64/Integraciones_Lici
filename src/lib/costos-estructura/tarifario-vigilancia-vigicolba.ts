/**
 * Ajuste "UNIFICACIÓN SNC — TARIFARIO PROPIO DE VIGICOLBA" — módulo puro
 * (sin React, sin `fetch`), EXCLUSIVO de Vigicolba. Mismo patrón
 * arquitectónico que `tarifario-especiales-aseocolba.ts` (catálogo estático
 * + funciones de cálculo puras), pero un archivo COMPLETAMENTE
 * independiente — nunca se mezcla con ese archivo ni con sus tipos/datos.
 *
 * FUENTE — valores reales verificados directamente de la hoja "Tarifas
 * vigilancia 2026" del archivo local `data/importaciones/tarifa/tar.xlsx`
 * (no versionado, no se sube a git — ver ese archivo para la fuente
 * original). Vigencia confirmada en la hoja: 2026-07-15 a 2026-12-31.
 * Identificado explícitamente como `fuente:'EXCEL_TARIFAS_VIGILANCIA_2026'`.
 *
 * ALCANCE CONFIRMADO — la hoja trae DOS tablas de tarifa de vigilancia
 * (Servicio Comercial y Servicio Residencial estratos 4/5/6), cada una con
 * 3 modalidades (Sin Arma/Con Arma/Con Canino) × 3 turnos (Turno 1: 06:00
 * a 19:00 diurno 13h; Turno 2: 19:00 a 06:00 nocturno 11h; Servicio 24
 * Horas = Turno 1 + Turno 2), más su propia tabla de proporcionalidad por
 * días de servicio. NINGÚN valor fue inventado ni copiado de
 * `tarifario-especiales-aseocolba.ts` — son cifras propias de Vigicolba.
 *
 * FÓRMULA BASE (verificada numéricamente contra la hoja, fila por fila):
 *  Total = (Valor por Posición + Prima Seguro de Vida) × (1 + %Administración)
 *  donde %Administración ("Administración y Supervisión", equivalente al
 *  AIU de Aseocolba pero con ese nombre en esta hoja) es:
 *   - Comercial:   Sin Arma 8%, Con Arma 10%, Con Canino 11%.
 *   - Residencial: Sin Arma 10%, Con Arma 10%, Con Canino 11%.
 *  Servicio 24 Horas = Total Turno 1 + Total Turno 2 (confirmado exacto).
 *
 * PROPORCIONALIDAD POR DÍAS (verificada numéricamente, fórmula exacta):
 *  valorProporcional = (valorTotalMensual30Dias / 30) × díasDelPatrón
 *  Patrones confirmados en la hoja: Lunes a Viernes sin/con Festivos (20/22
 *  días), Lunes a Sábados sin/con Festivos (24/26 días), Festivos (2 días),
 *  Sábados y Domingos (8 días), Sábados/Domingos y Festivos (10 días).
 *
 * SIN REGLA DE REDONDEO EN LA FUENTE — todos los valores de la hoja traen
 * muchos decimales, sin ninguna instrucción de redondeo explícita. Este
 * módulo NO redondea (devuelve los mismos decimales que la hoja); la
 * decisión de redondeo, si se necesita, es de la UI que consuma esto —
 * nunca se decide aquí en silencio.
 *
 * LOS 3 SERVICIOS SNC DE VIGICOLBA (Estudio de seguridad con poligrafía /
 * Curso persona autorizada T.S.A. / Examen médico trabajo en altura) NO
 * TIENEN, HOY, UNA TARIFA ESPECÍFICA DEMOSTRABLE EN LA FUENTE — no
 * aparecen en ninguna hoja del Excel (lo más cercano por nombre, la hoja
 * "Exm Med", es el esquema de exámenes/cursos INTERNOS de empleados de
 * Aseocolba, no una tarifa de venta de Vigicolba). Por eso este módulo
 * expone ÚNICAMENTE el tarifario GENERAL de puestos de vigilancia
 * (Comercial/Residencial), sin ningún mapeo automático hacia esos 3
 * servicios — conectar esto a la UI (page.tsx) queda pendiente de
 * confirmación explícita del usuario sobre qué debe pasar con esos 3
 * servicios mientras no exista esa tarifa específica.
 */

export type TipoServicioVigilanciaVigicolba = 'COMERCIAL' | 'RESIDENCIAL';
export type ModalidadVigilanciaVigicolba = 'SIN_ARMA' | 'CON_ARMA' | 'CON_CANINO';
export type TurnoVigilanciaVigicolba = 'TURNO_1' | 'TURNO_2' | 'SERVICIO_24H';
export type PatronDiasVigilanciaVigicolba =
  | 'LUNES_A_VIERNES_SIN_FESTIVOS'
  | 'LUNES_A_VIERNES_CON_FESTIVOS'
  | 'LUNES_A_SABADOS_SIN_FESTIVOS'
  | 'LUNES_A_SABADOS_CON_FESTIVOS'
  | 'FESTIVOS'
  | 'SABADOS_Y_DOMINGOS'
  | 'SABADOS_DOMINGOS_Y_FESTIVOS'
  | 'LUNES_A_DOMINGOS_Y_FESTIVOS';

export const FUENTE_TARIFARIO_VIGILANCIA_VIGICOLBA = 'EXCEL_TARIFAS_VIGILANCIA_2026' as const;
export const VIGENTE_DESDE_TARIFARIO_VIGILANCIA_VIGICOLBA = '2026-07-15' as const;
export const VIGENTE_HASTA_TARIFARIO_VIGILANCIA_VIGICOLBA = '2026-12-31' as const;

/** Ajuste "TARIFA REGULADA — HORAS DE SERVICIO POR TURNO" — jornada base
 * oficial de cada turno (Turno 1: 06:00-19:00, 13h diurnas; Turno 2:
 * 19:00-06:00, 11h nocturnas — mismos horarios ya documentados arriba,
 * nunca redefinidos). Sirve como divisor de la fórmula de prorrateo por
 * horas (`valorTurnoSegunDías/horasJornada×horasServicio`) y como tope
 * máximo de validación — Servicio 24 Horas no tiene entrada aquí a
 * propósito (no aplica prorrateo por horas, es la suma completa de
 * ambos turnos). */
export const HORAS_JORNADA_TURNO_VIGILANCIA_VIGICOLBA: Record<'TURNO_1' | 'TURNO_2', number> = {
  TURNO_1: 13,
  TURNO_2: 11,
};

/** Días del mes base sobre el que está calculado `valorTotalMensual30Dias`
 * — confirmado en la hoja ("TARIFA MÍNIMA VIGILANCIA... 30 días al Mes" /
 * tabla de proporcionalidad dividiendo siempre por 30). */
export const DIAS_BASE_MES_VIGILANCIA_VIGICOLBA = 30;

export const DIAS_POR_PATRON_VIGILANCIA_VIGICOLBA: Record<PatronDiasVigilanciaVigicolba, number> = {
  LUNES_A_VIERNES_SIN_FESTIVOS: 20,
  LUNES_A_VIERNES_CON_FESTIVOS: 22,
  LUNES_A_SABADOS_SIN_FESTIVOS: 24,
  LUNES_A_SABADOS_CON_FESTIVOS: 26,
  FESTIVOS: 2,
  SABADOS_Y_DOMINGOS: 8,
  SABADOS_DOMINGOS_Y_FESTIVOS: 10,
  // Ajuste "TARIFA REGULADA — LUNES A DOMINGOS Y FESTIVOS (30 DÍAS)" —
  // a diferencia de los 7 patrones de arriba (proporcionalidad real
  // verificada contra la tabla de proporcionalidad de la hoja), esta
  // alternativa NO viene de esa tabla: es directamente el mes completo
  // (`DIAS_BASE_MES_VIGILANCIA_VIGICOLBA`), el mismo "Totales" que la
  // hoja ya trae como `valorTotalMensual30Dias`. Se expresa aquí como
  // 30 para reutilizar EXACTAMENTE `calcularValorProporcionalVigilanciaVigicolba`
  // sin ninguna fórmula paralela — `(valorTotalMensual30Dias/30)*30` es
  // matemáticamente idéntico a `valorTotalMensual30Dias`, así que no hay
  // redondeo ni pérdida de precisión, y el catálogo sigue siendo la ÚNICA
  // fuente del número (nunca se hardcodea el resultado). Restricción de
  // negocio (solo válida para SERVICIO_24H, la fuente no demuestra un
  // valor independiente para Turno 1/Turno 2 con este patrón) aplicada en
  // `resolverTarifaPosicionRegulada` (tarifa-regulada-vigicolba.ts), NUNCA
  // aquí — este catálogo no conoce turnos.
  LUNES_A_DOMINGOS_Y_FESTIVOS: DIAS_BASE_MES_VIGILANCIA_VIGICOLBA,
};

/** Entrada del catálogo — un turno+modalidad+tipoServicio ya resuelto a su
 * valor mensual de 30 días (el mismo "Totales" que trae la hoja,
 * verificado exacto, nunca recalculado con una fórmula distinta a la
 * documentada arriba). */
export interface TarifaVigilanciaVigicolba {
  tarifaKey: string;
  tipoServicio: TipoServicioVigilanciaVigicolba;
  turno: TurnoVigilanciaVigicolba;
  modalidad: ModalidadVigilanciaVigicolba;
  descripcionTarifa: string;
  valorPorPosicion: number;
  valorPrimaSeguroVida: number;
  porcentajeAdministracion: number;
  valorTotalMensual30Dias: number;
}

function construirTarifaVigilanciaVigicolba(
  tipoServicio: TipoServicioVigilanciaVigicolba,
  turno: TurnoVigilanciaVigicolba,
  modalidad: ModalidadVigilanciaVigicolba,
  descripcionTarifa: string,
  valorPorPosicion: number,
  valorPrimaSeguroVida: number,
  porcentajeAdministracion: number,
): TarifaVigilanciaVigicolba {
  const valorConSeguroVida = valorPorPosicion + valorPrimaSeguroVida;
  const valorTotalMensual30Dias = valorConSeguroVida * (1 + porcentajeAdministracion);
  return {
    tarifaKey: `${tipoServicio}:${turno}:${modalidad}`,
    tipoServicio, turno, modalidad, descripcionTarifa,
    valorPorPosicion, valorPrimaSeguroVida, porcentajeAdministracion,
    valorTotalMensual30Dias,
  };
}

const VALOR_POR_POSICION_TURNO_1 = 8507540.589795;
const VALOR_POR_POSICION_TURNO_2 = 9369199.460205;
const PRIMA_SEGURO_VIDA_VIGILANCIA_VIGICOLBA = 1500;

function construirServicio24hVigilanciaVigicolba(
  tipoServicio: TipoServicioVigilanciaVigicolba,
  modalidad: ModalidadVigilanciaVigicolba,
  descripcionTarifa: string,
  turno1: TarifaVigilanciaVigicolba,
  turno2: TarifaVigilanciaVigicolba,
): TarifaVigilanciaVigicolba {
  return {
    tarifaKey: `${tipoServicio}:SERVICIO_24H:${modalidad}`,
    tipoServicio, turno: 'SERVICIO_24H', modalidad, descripcionTarifa,
    valorPorPosicion: turno1.valorPorPosicion + turno2.valorPorPosicion,
    valorPrimaSeguroVida: turno1.valorPrimaSeguroVida + turno2.valorPrimaSeguroVida,
    porcentajeAdministracion: modalidad === 'CON_CANINO' ? 0.11 : turno1.porcentajeAdministracion,
    valorTotalMensual30Dias: turno1.valorTotalMensual30Dias + turno2.valorTotalMensual30Dias,
  };
}

function construirTipoServicioVigilanciaVigicolba(
  tipoServicio: TipoServicioVigilanciaVigicolba,
  porcentajeAdmin: { SIN_ARMA: number; CON_ARMA: number; CON_CANINO: number },
): TarifaVigilanciaVigicolba[] {
  const modalidades: ModalidadVigilanciaVigicolba[] = ['SIN_ARMA', 'CON_ARMA', 'CON_CANINO'];
  const etiquetaModalidad: Record<ModalidadVigilanciaVigicolba, string> = {
    SIN_ARMA: 'Sin Arma', CON_ARMA: 'Con Arma', CON_CANINO: 'Con Canino',
  };
  const etiquetaTipo = tipoServicio === 'COMERCIAL' ? 'Servicio Comercial' : 'Servicio Residencial (estratos 4/5/6)';
  const salida: TarifaVigilanciaVigicolba[] = [];
  for (const modalidad of modalidades) {
    const pctAdmin = porcentajeAdmin[modalidad];
    const turno1 = construirTarifaVigilanciaVigicolba(
      tipoServicio, 'TURNO_1', modalidad,
      `${etiquetaTipo} · ${etiquetaModalidad[modalidad]} · Turno 1 (06:00-19:00, diurno)`,
      VALOR_POR_POSICION_TURNO_1, PRIMA_SEGURO_VIDA_VIGILANCIA_VIGICOLBA, pctAdmin,
    );
    const turno2 = construirTarifaVigilanciaVigicolba(
      tipoServicio, 'TURNO_2', modalidad,
      `${etiquetaTipo} · ${etiquetaModalidad[modalidad]} · Turno 2 (19:00-06:00, nocturno)`,
      VALOR_POR_POSICION_TURNO_2, PRIMA_SEGURO_VIDA_VIGILANCIA_VIGICOLBA, pctAdmin,
    );
    const servicio24h = construirServicio24hVigilanciaVigicolba(
      tipoServicio, modalidad,
      `${etiquetaTipo} · ${etiquetaModalidad[modalidad]} · Servicio 24 Horas`,
      turno1, turno2,
    );
    salida.push(turno1, turno2, servicio24h);
  }
  return salida;
}

/** Catálogo completo — 2 tipos de servicio × 3 modalidades × 3 turnos = 18
 * entradas, todas derivadas de la fórmula documentada arriba a partir de
 * los valores base de la hoja (nunca copiadas fila por fila con riesgo de
 * transcripción — la fórmula SÍ fue verificada exacta contra cada
 * "Totales" real de la hoja antes de generalizarla). */
export const CATALOGO_VIGILANCIA_VIGICOLBA_2026: readonly TarifaVigilanciaVigicolba[] = [
  ...construirTipoServicioVigilanciaVigicolba('COMERCIAL', { SIN_ARMA: 0.08, CON_ARMA: 0.10, CON_CANINO: 0.11 }),
  ...construirTipoServicioVigilanciaVigicolba('RESIDENCIAL', { SIN_ARMA: 0.10, CON_ARMA: 0.10, CON_CANINO: 0.11 }),
];

export function buscarTarifaCatalogoVigilanciaVigicolba(tarifaKey: string): TarifaVigilanciaVigicolba | undefined {
  return CATALOGO_VIGILANCIA_VIGICOLBA_2026.find(t => t.tarifaKey === tarifaKey);
}

/** Aplica la proporcionalidad por días de servicio confirmada en la hoja
 * — nunca una fórmula distinta a `(total30Dias/30)*días`. `diasPersonalizados`
 * permite un valor de días fuera de los 7 patrones fijos de la hoja (mismo
 * criterio, sin inventar un patrón nuevo con nombre propio). */
export function calcularValorProporcionalVigilanciaVigicolba(
  tarifa: TarifaVigilanciaVigicolba,
  patronODias: PatronDiasVigilanciaVigicolba | number,
): number {
  const dias = typeof patronODias === 'number' ? patronODias : DIAS_POR_PATRON_VIGILANCIA_VIGICOLBA[patronODias];
  return (tarifa.valorTotalMensual30Dias / DIAS_BASE_MES_VIGILANCIA_VIGICOLBA) * dias;
}

/** Resultado explícito de intentar resolver una tarifa automática para un
 * servicio SNC — nunca un valor plano, para que sea imposible confundir
 * "no hay tarifa" con "la tarifa es 0" en el llamador. */
export type ResolucionTarifaAutomaticaSNCVigicolba =
  | { estado: 'SIN_TARIFA_AUTOMATICA' }
  | { estado: 'RESUELTA'; tarifa: TarifaVigilanciaVigicolba };

/** Único punto de entrada que un futuro adaptador de SNC Vigicolba debería
 * llamar para saber si un servicio ya tiene tarifa automática de este
 * tarifario general de vigilancia. HOY devuelve SIEMPRE
 * `{estado:'SIN_TARIFA_AUTOMATICA'}` — ningún servicio SNC de Vigicolba
 * (incluidos los 3 confirmados: Estudio de seguridad con poligrafía, Curso
 * persona autorizada T.S.A., Examen médico trabajo en altura) tiene, hoy,
 * una correspondencia demostrable contra la hoja "Tarifas vigilancia
 * 2026" (ver docblock del archivo) — nunca se asigna por defecto una
 * combinación como Sin Arma/Turno 1 solo porque exista en el catálogo.
 * Cuando exista una fuente que demuestre la relación real para algún
 * servicio, este es el ÚNICO lugar que debe cambiar (nunca el modal de
 * SNC en page.tsx). */
export function resolverTarifaAutomaticaSNCVigilanciaVigicolba(
  _descripcionServicioSNC: string,
): ResolucionTarifaAutomaticaSNCVigicolba {
  return { estado: 'SIN_TARIFA_AUTOMATICA' };
}
