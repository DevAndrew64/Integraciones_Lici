/**
 * Ajuste "TARIFA REGULADA VIGICOLBA — PESTAÑA PROPIA" — corrige la ronda
 * anterior, que había acoplado la tarifa regulada por Supervigilancia
 * DENTRO del modal de Servicio No Continuo. Son conceptos separados:
 *  - **Servicios No Continuos** (`servicios-no-continuos.ts`) — el COSTO
 *    INTERNO de prestar un servicio (cuánto le cuesta a COLBA). Nunca
 *    vuelve a mezclarse con tarifa regulada.
 *  - **Tarifa Regulada** (este archivo) — el VALOR A PRESENTAR EN LA
 *    OFERTA según el tarifario regulado por Supervigilancia
 *    (`tarifario-vigilancia-vigicolba.ts`, fuente canónica única, sin
 *    cambios). Módulo propio, pestaña propia, visible SOLO para procesos
 *    de Vigicolba (page.tsx decide la visibilidad; este archivo es puro).
 *
 * Una "posición" aquí es una fila a cotizar bajo tarifa regulada — no es
 * un cargo de Mano de Obra ni un cargo de SNC; es su propio concepto,
 * identificado por descripción libre + los 4 parámetros regulatorios +
 * cantidad de posiciones.
 */
import {
  buscarTarifaCatalogoVigilanciaVigicolba, calcularValorProporcionalVigilanciaVigicolba,
  HORAS_JORNADA_TURNO_VIGILANCIA_VIGICOLBA,
  type TipoServicioVigilanciaVigicolba, type ModalidadVigilanciaVigicolba,
  type TurnoVigilanciaVigicolba, type PatronDiasVigilanciaVigicolba,
} from './tarifario-vigilancia-vigicolba';
export type {
  TipoServicioVigilanciaVigicolba, ModalidadVigilanciaVigicolba,
  TurnoVigilanciaVigicolba, PatronDiasVigilanciaVigicolba,
} from './tarifario-vigilancia-vigicolba';
export { DIAS_POR_PATRON_VIGILANCIA_VIGICOLBA, HORAS_JORNADA_TURNO_VIGILANCIA_VIGICOLBA } from './tarifario-vigilancia-vigicolba';

export interface PosicionTarifaReguladaVigicolba {
  id: number;
  descripcion: string;
  cantidad: number;
  tipoServicio?: TipoServicioVigilanciaVigicolba;
  modalidad?: ModalidadVigilanciaVigicolba;
  turno?: TurnoVigilanciaVigicolba;
  patronDias?: PatronDiasVigilanciaVigicolba;
  /** Ajuste "TARIFA REGULADA — HORAS DE SERVICIO POR TURNO" (decisión
   * explícita del usuario) — SOLO tiene sentido para `turno==='TURNO_1'`
   * o `'TURNO_2'` (Servicio 24 Horas nunca prorratea por horas, ver
   * `resolverFactorHorasServicioTurno`). Ausente/`undefined` ⇒ jornada
   * completa (13h Turno 1, 11h Turno 2) — mismo resultado que el cálculo
   * histórico, retrocompatible con cualquier posición guardada antes de
   * este ajuste. La UI normaliza este campo a `undefined` cuando el turno
   * cambia a `SERVICIO_24H` (nunca deja un prorrateo fraccionado
   * "fantasma" activo) y lo precarga con la jornada completa al elegir
   * Turno 1/Turno 2 por primera vez — ver `page.tsx`. */
  horasServicio?: number;
}

export function crearPosicionTarifaReguladaVacia(id: number): PosicionTarifaReguladaVigicolba {
  return { id, descripcion: '', cantidad: 1 };
}

/** Resultado explícito de resolver la tarifa de una posición — nunca un
 * número plano, para que la UI distinga "falta un selector" de "la
 * combinación no existe" de "ya resuelta".
 *
 * Ajuste "TARIFA REGULADA — PRIMA SEGURO DE VIDA VISIBLE" (diagnóstico
 * confirmado: la prima YA está embebida dentro de `valorTotalMensual30Dias`
 * — `Total = (valorPorPosición + primaSeguroVida) × (1+%Administración)`,
 * ver `tarifario-vigilancia-vigicolba.ts`) — `valorPrimaSeguroVida` aquí es
 * PURAMENTE INFORMATIVO (el valor mensual completo de la combinación ya
 * resuelta — $1.500 para Turno 1/Turno 2, $3.000 para Servicio 24 Horas,
 * el mismo dato que ya trae `TarifaVigilanciaVigicolba.valorPrimaSeguroVida`
 * del catálogo), NUNCA se vuelve a sumar a `tarifaPorPosicion` (que sigue
 * siendo exactamente el mismo cálculo de siempre, sin este campo). */
export type ResolucionTarifaPosicionRegulada =
  | { estado: 'FALTAN_PARAMETROS' }
  | { estado: 'SIN_TARIFA_PARA_COMBINACION' }
  | { estado: 'RESUELTA'; tarifaPorPosicion: number; valorPrimaSeguroVida: number };

/** Ajuste "TARIFA REGULADA — HORAS DE SERVICIO POR TURNO" — factor
 * multiplicativo (no un valor en pesos) que representa qué fracción de la
 * jornada completa del turno se está prorrateando:
 * `valorLiquidado = valorTurnoSegúnDías × (horasServicio/horasJornada)`,
 * exactamente equivalente a la fórmula pedida por el usuario
 * (`valorTurnoSegúnDías/horasJornada×horasServicio`). Servicio 24 Horas
 * SIEMPRE devuelve `1` (sin prorrateo, cálculo actual completo — nunca
 * aplica esta fórmula, ni siquiera con la nueva opción de 30 días, que ya
 * exige `SERVICIO_24H`). Para Turno 1/Turno 2: `horasServicio`
 * ausente/inválido (≤0 o mayor a la jornada del turno — nunca debería
 * ocurrir si la UI valida, pero esta función pura no confía en el
 * llamador) ⇒ factor `1` (jornada completa), IDÉNTICO al cálculo
 * histórico antes de este ajuste — nunca reduce el valor por un dato
 * corrupto o ausente. */
export function resolverFactorHorasServicioTurno(
  turno: TurnoVigilanciaVigicolba | undefined,
  horasServicio: number | undefined,
): number {
  if (turno !== 'TURNO_1' && turno !== 'TURNO_2') return 1;
  const horasJornada = HORAS_JORNADA_TURNO_VIGILANCIA_VIGICOLBA[turno];
  const horasValidas = horasServicio != null && horasServicio > 0 && horasServicio <= horasJornada ? horasServicio : horasJornada;
  return horasValidas / horasJornada;
}

export function resolverTarifaPosicionRegulada(posicion: PosicionTarifaReguladaVigicolba): ResolucionTarifaPosicionRegulada {
  if (!posicion.tipoServicio || !posicion.modalidad || !posicion.turno || !posicion.patronDias) {
    return { estado: 'FALTAN_PARAMETROS' };
  }
  // Ajuste "TARIFA REGULADA — LUNES A DOMINGOS Y FESTIVOS (30 DÍAS)"
  // (decisión explícita del usuario, confirmada vía AskUserQuestion) —
  // este patrón representa el TOTAL de "Servicio 24 Horas" (Turno 1 +
  // Turno 2, verificado exacto contra la tabla oficial). La fuente NO
  // demuestra un valor independiente para Turno 1 o Turno 2 solos con
  // este patrón — nunca se extrapola ni se inventa: se rechaza como
  // cualquier otra combinación sin respaldo en el tarifario (mismo
  // estado `SIN_TARIFA_PARA_COMBINACION` que ya usa la UI, "Sin tarifa
  // para esta combinación").
  if (posicion.patronDias === 'LUNES_A_DOMINGOS_Y_FESTIVOS' && posicion.turno !== 'SERVICIO_24H') {
    return { estado: 'SIN_TARIFA_PARA_COMBINACION' };
  }
  const tarifa = buscarTarifaCatalogoVigilanciaVigicolba(`${posicion.tipoServicio}:${posicion.turno}:${posicion.modalidad}`);
  if (!tarifa) return { estado: 'SIN_TARIFA_PARA_COMBINACION' };
  // Ajuste "TARIFA REGULADA — HORAS DE SERVICIO POR TURNO" — el motor
  // actual resuelve PRIMERO el valor del turno según días de prestación
  // (modalidad/turno/patronDías ya resueltos arriba, sin ningún cambio),
  // y SOLO DESPUÉS se aplica el prorrateo por horas sobre ese resultado
  // YA COMPLETO (prima de seguro de vida y % de administración incluidos,
  // sin descomponerlos aparte — el usuario confirmó que se prorratea el
  // VALOR FINAL del turno, no sus componentes por separado). Nunca se
  // invierte el orden.
  const valorTurnoSegunDias = calcularValorProporcionalVigilanciaVigicolba(tarifa, posicion.patronDias);
  const factorHoras = resolverFactorHorasServicioTurno(posicion.turno, posicion.horasServicio);
  return {
    estado: 'RESUELTA',
    tarifaPorPosicion: valorTurnoSegunDias * factorHoras,
    valorPrimaSeguroVida: tarifa.valorPrimaSeguroVida,
  };
}

/** Valor total de oferta de UNA posición — tarifa por posición ×
 * cantidad, o 0 si la tarifa no está resuelta (falta selector, o
 * combinación inexistente). */
export function calcularValorOfertaPosicionRegulada(posicion: PosicionTarifaReguladaVigicolba): number {
  const r = resolverTarifaPosicionRegulada(posicion);
  return r.estado === 'RESUELTA' ? r.tarifaPorPosicion * posicion.cantidad : 0;
}

export function calcularTotalValorOfertaReguladaProceso(posiciones: readonly PosicionTarifaReguladaVigicolba[]): number {
  return posiciones.reduce((s, p) => s + calcularValorOfertaPosicionRegulada(p), 0);
}

/** Diferencial entre el valor de oferta regulado y el costo interno —
 * NUNCA "rentabilidad sobre costo" (eso sería `diferencial/costoInterno`,
 * un indicador DISTINTO, no implementado aquí): este `diferencialPorcentaje`
 * es el diferencial como PORCENTAJE DEL VALOR DE OFERTA (decisión
 * explícita del usuario). `diferencialPorcentaje` es `null` (nunca 0
 * disfrazado) cuando `valorOfertaRegulado<=0` — la UI debe mostrar "—",
 * nunca dividir por cero. Un diferencial NEGATIVO se devuelve tal cual,
 * nunca recortado a 0. */
export interface DiferencialTarifaRegulada {
  diferencialPesos: number;
  diferencialPorcentaje: number | null;
}
export function calcularDiferencialTarifaRegulada(costoInterno: number, valorOfertaRegulado: number): DiferencialTarifaRegulada {
  const diferencialPesos = valorOfertaRegulado - costoInterno;
  return {
    diferencialPesos,
    diferencialPorcentaje: valorOfertaRegulado > 0 ? (diferencialPesos / valorOfertaRegulado) * 100 : null,
  };
}
