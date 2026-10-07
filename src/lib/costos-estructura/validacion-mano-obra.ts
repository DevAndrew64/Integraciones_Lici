/**
 * Validaciones para "Finalizar Mano de Obra" (§6) — puro, sin React, sin
 * fetch. "Guardar avance" nunca llama estas funciones (permite datos
 * incompletos por diseño); solo "Finalizar" las ejecuta antes de
 * persistir con estado COMPLETADO.
 *
 * Los mensajes son texto comercial explícito (§6): nunca códigos ni
 * nombres internos de campo.
 */

export interface LineaValidable {
  id: number;
  nombreCargo: string;
  cantOpeFijos: string;
  salarioBase: string;
  arlKey: string;
  distribucionesHorario: unknown[];
}

export interface EntradaValidacionManoObra {
  lineas: LineaValidable[];
  cargosTurnantes: LineaValidable[];
  cantidadLineasBloqueadas: number;
  cantidadTurnantesBloqueados: number;
  costosOtrosPendientesDeAsignacion: number;
  /** Turnantes obligatorios sin cubrir para una cobertura configurada — el
   * cálculo real de "cobertura requerida" no existe todavía en el motor
   * comercial (no hay `ConfiguracionCoberturaDescanso`, ver auditoría de
   * `politica-descanso.ts`); se deja el contrato preparado, con 0 por
   * defecto hasta que exista esa fuente. */
  turnantesObligatoriosSinCubrir?: number;
  /** Corrección "COSTO PRELIMINAR DEL TURNANTE" §5 — horas semanales de
   * relevo que la capacidad ordinaria de los turnantes físicos calculados
   * NO alcanza a cubrir (necesidadTurnantes.horasResiduales, agregado de
   * todos los grupos). Mientras sea mayor que 0 el costo de Mano de Obra es
   * preliminar y "Finalizar Mano de Obra" debe bloquearse — nunca se
   * aprueba/exporta como definitivo con una brecha de relevo sin programar. */
  horasRelevoPendientesProgramacion?: number;
}

export interface ResultadoValidacionManoObra {
  valido: boolean;
  problemas: string[];
}

function idsHuerfanos(lineas: LineaValidable[]): number[] {
  const vistos = new Set<number>();
  const huerfanos: number[] = [];
  for (const l of lineas) {
    if (l.id === undefined || l.id === null || Number.isNaN(l.id)) { huerfanos.push(l.id); continue; }
    if (vistos.has(l.id)) huerfanos.push(l.id);
    vistos.add(l.id);
  }
  return huerfanos;
}

export function validarManoObraParaFinalizar(entrada: EntradaValidacionManoObra): ResultadoValidacionManoObra {
  const problemas: string[] = [];
  const todasLasLineas = [...entrada.lineas, ...entrada.cargosTurnantes];

  if (entrada.lineas.length === 0) {
    problemas.push('No hay ningún cargo de Mano de Obra registrado.');
  }

  const sinProgramacion = todasLasLineas.filter(l => l.distribucionesHorario.length === 0).length;
  if (sinProgramacion > 0) {
    problemas.push(`${sinProgramacion} cargo${sinProgramacion > 1 ? 's' : ''} sin programación.`);
  }

  const sinCantidadValida = todasLasLineas.filter(l => !(Number(l.cantOpeFijos) > 0)).length;
  if (sinCantidadValida > 0) {
    problemas.push(`${sinCantidadValida} línea${sinCantidadValida > 1 ? 's' : ''} sin cantidad válida.`);
  }

  const sinSalarioValido = todasLasLineas.filter(l => !(Number(l.salarioBase) > 0)).length;
  if (sinSalarioValido > 0) {
    problemas.push(`${sinSalarioValido} línea${sinSalarioValido > 1 ? 's' : ''} sin salario válido.`);
  }

  const sinArl = todasLasLineas.filter(l => !l.arlKey).length;
  if (sinArl > 0) {
    problemas.push(`${sinArl} línea${sinArl > 1 ? 's' : ''} sin clase de riesgo ARL.`);
  }

  if (entrada.costosOtrosPendientesDeAsignacion > 0) {
    problemas.push(`${entrada.costosOtrosPendientesDeAsignacion} costo${entrada.costosOtrosPendientesDeAsignacion > 1 ? 's' : ''} pendiente${entrada.costosOtrosPendientesDeAsignacion > 1 ? 's' : ''} de asignación.`);
  }

  const bloqueadas = entrada.cantidadLineasBloqueadas + entrada.cantidadTurnantesBloqueados;
  if (bloqueadas > 0) {
    problemas.push(`${bloqueadas} línea${bloqueadas > 1 ? 's' : ''} que no pudo${bloqueadas > 1 ? 'ieron' : ''} calcularse.`);
  }

  const huerfanos = idsHuerfanos(todasLasLineas);
  if (huerfanos.length > 0) {
    problemas.push('Existen líneas con identificadores duplicados o inválidos — vuelva a abrir el módulo.');
  }

  const turnantesFaltantes = entrada.turnantesObligatoriosSinCubrir ?? 0;
  if (turnantesFaltantes > 0) {
    problemas.push(`${turnantesFaltantes} turnante${turnantesFaltantes > 1 ? 's' : ''} obligatorio${turnantesFaltantes > 1 ? 's' : ''} sin cubrir para la cobertura configurada.`);
  }

  const horasRelevoPendientes = entrada.horasRelevoPendientesProgramacion ?? 0;
  if (horasRelevoPendientes > 0) {
    problemas.push(`${horasRelevoPendientes} horas semanales de relevo sin programar — el costo del turnante es preliminar y no puede aprobarse como definitivo todavía.`);
  }

  return { valido: problemas.length === 0, problemas };
}

export const MENSAJE_ENCABEZADO_ERRORES_FINALIZAR =
  'No es posible finalizar Mano de Obra. Revisa los siguientes puntos:';