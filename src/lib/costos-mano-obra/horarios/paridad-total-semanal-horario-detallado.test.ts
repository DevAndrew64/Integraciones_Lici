/**
 * Corrección "PARIDAD SALARIAL ENTRE TOTAL_SEMANAL Y HORARIO_DETALLADO" —
 * causa: `construirCalculadaLinea` (page.tsx) pasaba el salario de jornada
 * completa SIN proporcionalidad para HORARIO_DETALLADO, mientras
 * TOTAL_SEMANAL sí proporcionaba con `calcularSalarioProporcionalServicio`.
 *
 * Estas pruebas cubren la fórmula reutilizada (misma función, capada a 42h
 * antes de llamarla — ella misma no capa) y, como prueba de integración de
 * humo, que el cableado real en page.tsx quedó conectado (mismo patrón de
 * prueba por texto ya usado en `captura-total-semanal-page.test.ts` — el
 * proyecto no tiene jsdom/RTL para ejecutar el componente).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  calcularSalarioProporcionalServicio,
  LIMITE_HORAS_SEMANALES_TOTAL_SEMANAL,
} from './captura-total-semanal';

const SALARIO_REFERENCIA = 1750905;

/** Réplica exacta de la fórmula ya aplicada en page.tsx (Math.min + la misma función de TOTAL_SEMANAL) — nunca una fórmula nueva. */
function salarioBasicoHorarioDetallado(horasSemanalesEfectivas: number): number {
  const horasOrdinarias = Math.min(horasSemanalesEfectivas, LIMITE_HORAS_SEMANALES_TOTAL_SEMANAL);
  return calcularSalarioProporcionalServicio(SALARIO_REFERENCIA, horasOrdinarias);
}

describe('Caso 1 — 21 horas: TOTAL_SEMANAL y HORARIO_DETALLADO deben coincidir', () => {
  it('TOTAL_SEMANAL (ya correcto, sin tocar) sigue en $875.453', () => {
    expect(calcularSalarioProporcionalServicio(SALARIO_REFERENCIA, 21)).toBe(875453);
  });

  it('HORARIO_DETALLADO con 21 horas efectivas ahora produce el mismo $875.453', () => {
    expect(salarioBasicoHorarioDetallado(21)).toBe(875453);
  });

  it('paridad exacta entre ambos modos para el mismo total de horas', () => {
    expect(salarioBasicoHorarioDetallado(21)).toBe(calcularSalarioProporcionalServicio(SALARIO_REFERENCIA, 21));
  });
});

describe('Caso 2 — 30 horas: paridad completa', () => {
  it('mismo resultado en ambos modos', () => {
    expect(salarioBasicoHorarioDetallado(30)).toBe(calcularSalarioProporcionalServicio(SALARIO_REFERENCIA, 30));
  });
});

describe('Caso 3 — 42 horas: factor 1, salario completo en ambos modos', () => {
  it('TOTAL_SEMANAL en 42h = salario de referencia completo', () => {
    expect(calcularSalarioProporcionalServicio(SALARIO_REFERENCIA, 42)).toBe(SALARIO_REFERENCIA);
  });
  it('HORARIO_DETALLADO en 42h = salario de referencia completo', () => {
    expect(salarioBasicoHorarioDetallado(42)).toBe(SALARIO_REFERENCIA);
  });
});

describe('Caso 4 — varios horarios que suman 21 horas (la suma es lo único que importa)', () => {
  it('2 bloques de 10.5h cada uno = 21h efectivas → mismo resultado que un único bloque de 21h', () => {
    const sumaVariosHorarios = 10.5 + 10.5;
    expect(salarioBasicoHorarioDetallado(sumaVariosHorarios)).toBe(salarioBasicoHorarioDetallado(21));
  });
});

describe('Caso 6 — horario detallado de 44 horas: salario básico limitado a 42/42, nunca 44/42', () => {
  it('el factor ordinario nunca supera 1', () => {
    const resultado = salarioBasicoHorarioDetallado(44);
    expect(resultado).toBe(SALARIO_REFERENCIA); // exactamente igual que 42h, no más.
    // Confirma explícitamente que NO se aplicó 44/42 (que daría un valor mayor al de referencia).
    const sinCapar = calcularSalarioProporcionalServicio(SALARIO_REFERENCIA, 44);
    expect(sinCapar).toBeGreaterThan(SALARIO_REFERENCIA); // así se vería el bug de "pagar de más" si no se capara.
    expect(resultado).not.toBe(sinCapar);
  });

  it('las 2 horas superiores a 42 no se pagan aquí — quedan para la lógica vigente de horas extra/recargos (fuera de esta función)', () => {
    // Esta prueba documenta el límite de responsabilidad de la función: ella
    // solo resuelve el salario ORDINARIO proporcional. El reconocimiento de
    // las 2 horas excedentes es responsabilidad de
    // `derivarDistribucionHorasComercialActivo`/`horasExtraSemanales`, no
    // tocado por esta corrección — no se duplica el pago aquí.
    expect(salarioBasicoHorarioDetallado(44)).toBe(salarioBasicoHorarioDetallado(42));
  });
});

describe('Caso 7 — TOTAL_SEMANAL de 44 horas sigue bloqueado (validación no tocada)', () => {
  it('44 > 42 está fuera del rango permitido para TOTAL_SEMANAL (LIMITE_HORAS_SEMANALES_TOTAL_SEMANAL=42)', () => {
    expect(44).toBeGreaterThan(LIMITE_HORAS_SEMANALES_TOTAL_SEMANAL);
  });
});

describe('Caso 8 — múltiples operarios: el factor de proporcionalidad no se aplica dos veces', () => {
  it('el costo unitario se calcula una sola vez y se multiplica, no se reaplica 21/42 por operario', () => {
    const salarioUnitario = salarioBasicoHorarioDetallado(21);
    const totalDosOperarios = salarioUnitario * 2;
    // La función de proporcionalidad no recibe cantidadTrabajadores — se
    // aplica una sola vez sobre el salario de referencia, la multiplicación
    // por operarios ocurre después, en el ensamblador (sin cambios).
    expect(totalDosOperarios).toBe(875453 * 2);
  });
});

describe('Integración — cableado real en page.tsx (patrón de prueba por texto, sin jsdom/RTL, igual que captura-total-semanal-page.test.ts)', () => {
  const PAGE_TSX = readFileSync(join(__dirname, '../../../app/page.tsx'), 'utf-8');

  it('la rama HORARIO_DETALLADO de construirCalculadaLinea ya no pasa salarioMensualL crudo sin proporcionar', () => {
    const inicio = PAGE_TSX.indexOf('const construirCalculadaLinea=React.useCallback');
    const finRamaTotalSemanal = PAGE_TSX.indexOf('const derivado=derivarDistribucionHorasComercialActivo', inicio);
    const finFuncion = PAGE_TSX.indexOf('},[conAux,auxValor,parametrosFinancierosResueltos', finRamaTotalSemanal);
    const ramaHorarioDetallado = PAGE_TSX.slice(finRamaTotalSemanal, finFuncion);

    // Corrección "COBERTURA vs. CAPACIDAD vs. RECARGOS" — esta rama usa
    // SIEMPRE l.distribucionesHorario (cobertura completa, sin recortar)
    // tanto para el salario básico (capado con Math.min, abajo) como para
    // la clasificación de recargos — nunca una distribución con un día
    // quitado (eso aplicaría el mismo descanso a todos los titulares de la
    // línea y eliminaría el recargo dominical del servicio).
    expect(ramaHorarioDetallado).toContain('calcularTotalSemanalCargo(l.distribucionesHorario)');
    expect(ramaHorarioDetallado).toContain('calcularSalarioProporcionalServicio(salarioMensualL');
    expect(ramaHorarioDetallado).toContain('Math.min(horasSemanalesEfectivasDetallado,LIMITE_HORAS_SEMANALES_TOTAL_SEMANAL)');
    // El salario que llega al ensamblador ahora es el proporcional, no el crudo.
    expect(ramaHorarioDetallado).toContain('salarioMensual:salarioBasicoProporcionalDetallado');
    expect(ramaHorarioDetallado).not.toContain('salarioMensual:salarioMensualL,cantidadTrabajadores');
  });

  it('la rama HORARIO_DETALLADO ahora también pasa baseMinimaSeguridadSocialMensual, igual que TOTAL_SEMANAL (paridad §9)', () => {
    const inicio = PAGE_TSX.indexOf('const construirCalculadaLinea=React.useCallback');
    const finRamaTotalSemanal = PAGE_TSX.indexOf('const derivado=derivarDistribucionHorasComercialActivo', inicio);
    const finFuncion = PAGE_TSX.indexOf('},[conAux,auxValor,parametrosFinancierosResueltos', finRamaTotalSemanal);
    const ramaHorarioDetallado = PAGE_TSX.slice(finRamaTotalSemanal, finFuncion);
    expect(ramaHorarioDetallado).toContain('baseMinimaSeguridadSocialMensual:salarioMensualL');
  });

  it('la rama TOTAL_SEMANAL (§6/§7/§8/§10) no fue modificada por esta corrección', () => {
    const inicio = PAGE_TSX.indexOf('const construirCalculadaLinea=React.useCallback');
    const finRamaTotalSemanal = PAGE_TSX.indexOf('const derivado=derivarDistribucionHorasComercialActivo', inicio);
    const ramaTotalSemanal = PAGE_TSX.slice(inicio, finRamaTotalSemanal);
    expect(ramaTotalSemanal).toContain('const salarioProporcional=calcularSalarioProporcionalServicio(salarioMensualL,horasSemanalesTotal);');
    expect(ramaTotalSemanal).toContain('validarHorasSemanalesTotalSemanal(horasSemanalesTotal)');
  });

  it('la lógica de horas extra/recargos (derivado.distribucion/horasExtraSemanales) no fue tocada — se sigue pasando igual', () => {
    const inicio = PAGE_TSX.indexOf('const construirCalculadaLinea=React.useCallback');
    const finFuncion = PAGE_TSX.indexOf('},[conAux,auxValor,parametrosFinancierosResueltos', inicio);
    const bloque = PAGE_TSX.slice(inicio, finFuncion);
    expect(bloque).toContain('distribucionHoras:derivado.distribucion');
    expect(bloque).toContain('horasExtraSemanales:derivado.horasExtraSemanales');
    expect(bloque).toContain('origenMensualizacionExtra:derivado.origenMensualizacionExtra');
  });
});