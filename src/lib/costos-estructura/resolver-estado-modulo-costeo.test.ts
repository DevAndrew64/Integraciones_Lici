/**
 * Ajuste "NORMALIZAR SEMÁNTICA DE ESTADOS EN TODO EL STEPPER DE COSTOS" —
 * tests puros de `resolverEstadoModuloCosteo`/`resolverEstadoVisibleModuloCosteo`
 * (guardado-modular.ts). Cubre exclusivamente la función centralizada de
 * mapeo tieneDatos/esValido → EstadoModulo — la definición de QUÉ significa
 * tieneDatos/esValido para cada módulo real (EPP, Exámenes, Insumos,
 * Maquinaria, Valor Agregado, etc.) se prueba en sus propios *-page.test.ts
 * de wiring, no aquí.
 */
import { describe, expect, it } from 'vitest';
import { resolverEstadoModuloCosteo, resolverEstadoVisibleModuloCosteo } from './guardado-modular';

describe('resolverEstadoModuloCosteo — regla transversal de los 3 estados de captura', () => {
  it('vacío (tieneDatos:false) → NO_INICIADO, sin importar esValido', () => {
    expect(resolverEstadoModuloCosteo({ tieneDatos: false, esValido: false })).toBe('NO_INICIADO');
    expect(resolverEstadoModuloCosteo({ tieneDatos: false, esValido: true })).toBe('NO_INICIADO');
  });

  it('con datos pero incompleto/inválido (tieneDatos:true, esValido:false) → EN_PROGRESO', () => {
    expect(resolverEstadoModuloCosteo({ tieneDatos: true, esValido: false })).toBe('EN_PROGRESO');
  });

  it('con datos válidos (tieneDatos:true, esValido:true) → COMPLETADO', () => {
    expect(resolverEstadoModuloCosteo({ tieneDatos: true, esValido: true })).toBe('COMPLETADO');
  });

  it('módulo sin validador real de completitud (esValido=tieneDatos, provisional) — nunca EN_PROGRESO, solo NO_INICIADO/COMPLETADO', () => {
    const sinValidador = (tieneDatos: boolean) => resolverEstadoModuloCosteo({ tieneDatos, esValido: tieneDatos });
    expect(sinValidador(false)).toBe('NO_INICIADO');
    expect(sinValidador(true)).toBe('COMPLETADO');
  });

  it('eliminar el último registro (tieneDatos pasa de true a false) recalcula a NO_INICIADO — nunca queda en COMPLETADO/EN_PROGRESO', () => {
    let estado = resolverEstadoModuloCosteo({ tieneDatos: true, esValido: true });
    expect(estado).toBe('COMPLETADO');
    estado = resolverEstadoModuloCosteo({ tieneDatos: false, esValido: true });
    expect(estado).toBe('NO_INICIADO');
  });
});

describe('resolverEstadoVisibleModuloCosteo — corrige un histórico incoherente sin migración, respeta NO_APLICA', () => {
  it('NO_APLICA persistido se respeta siempre, nunca se sobrescribe por la regla de datos', () => {
    expect(resolverEstadoVisibleModuloCosteo('NO_APLICA', { tieneDatos: false, esValido: false })).toBe('NO_APLICA');
    expect(resolverEstadoVisibleModuloCosteo('NO_APLICA', { tieneDatos: true, esValido: true })).toBe('NO_APLICA');
  });

  it('histórico incoherente: estado persistido COMPLETADO con 0 datos reales se muestra como NO_INICIADO (sin migración, solo lectura reactiva)', () => {
    expect(resolverEstadoVisibleModuloCosteo('COMPLETADO', { tieneDatos: false, esValido: false })).toBe('NO_INICIADO');
  });

  it('histórico incoherente: estado persistido EN_PROGRESO con 0 datos reales también se corrige a NO_INICIADO', () => {
    expect(resolverEstadoVisibleModuloCosteo('EN_PROGRESO', { tieneDatos: false, esValido: false })).toBe('NO_INICIADO');
  });

  it('estado persistido NO_INICIADO con datos reales ya presentes en memoria (aún sin guardar) refleja el estado en vivo, no el persistido', () => {
    expect(resolverEstadoVisibleModuloCosteo('NO_INICIADO', { tieneDatos: true, esValido: false })).toBe('EN_PROGRESO');
    expect(resolverEstadoVisibleModuloCosteo('NO_INICIADO', { tieneDatos: true, esValido: true })).toBe('COMPLETADO');
  });

  it('estado persistido ausente (undefined, módulo nunca guardado) se comporta igual que NO_INICIADO', () => {
    expect(resolverEstadoVisibleModuloCosteo(undefined, { tieneDatos: false, esValido: false })).toBe('NO_INICIADO');
    expect(resolverEstadoVisibleModuloCosteo(undefined, { tieneDatos: true, esValido: true })).toBe('COMPLETADO');
  });
});
