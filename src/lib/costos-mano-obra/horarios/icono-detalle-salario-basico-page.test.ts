/**
 * Corrección "botoncito faltante en Salario básico mensual para
 * HORARIO_DETALLADO" — el ícono de detalle solo se filtraba por
 * `tipoCapturaHorario==='TOTAL_SEMANAL'`. Desde la corrección de paridad
 * salarial, un HORARIO_DETALLADO de menos de 42h también produce un
 * salario básico proporcional (no el de jornada completa) — necesita la
 * misma explicación. Patrón de prueba por texto ya usado en el resto del
 * proyecto para lógica embebida en page.tsx (sin jsdom/RTL).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../../app/page.tsx'), 'utf-8');

describe('IconoDetalleCalculoSalarioBasico — ahora también cubre HORARIO_DETALLADO', () => {
  it('el componente ya no depende de dist.horasSemanalesManual (exclusivo de TOTAL_SEMANAL) — usa horasSemanalesEfectivas genérico', () => {
    const inicio = PAGE_TSX.indexOf('function IconoDetalleCalculoSalarioBasico');
    const fin = PAGE_TSX.indexOf('function ', inicio + 10);
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).toContain('horasSemanalesEfectivas');
    expect(bloque).not.toContain('dist.horasSemanalesManual');
  });

  it('los 2 call sites (grupo.filas y turnantes) incluyen filas HORARIO_DETALLADO con horas efectivas < 42, no solo TOTAL_SEMANAL', () => {
    const ocurrencias = PAGE_TSX.match(/const horasDet=calcularTotalSemanalCargo\(d\.distribucionesHorario\)\/60;return horasDet>0&&horasDet<LIMITE_HORAS_SEMANALES_TOTAL_SEMANAL;/g) || [];
    expect(ocurrencias).toHaveLength(2);
  });

  it('las filas TOTAL_SEMANAL siguen incluidas sin cambios (return true inmediato si existe distTS)', () => {
    const ocurrencias = PAGE_TSX.match(/const distTS=d\.distribucionesHorario\.find\(x=>x\.tipoCapturaHorario==='TOTAL_SEMANAL'\);if\(distTS\)return true;/g) || [];
    expect(ocurrencias).toHaveLength(2);
  });
});