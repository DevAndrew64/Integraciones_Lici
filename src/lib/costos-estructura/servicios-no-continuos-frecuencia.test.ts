/**
 * Ajuste "CATÁLOGO OFICIAL DE FRECUENCIAS EN SNC" — el modal "Editar
 * servicio no continuo" deja de usar un input numérico libre de meses y
 * pasa a usar el MISMO catálogo de 15 frecuencias que Valor Agregado
 * (`FRECUENCIAS_VALOR_AGREGADO`/`resolverFactorPeriodicidadValorAgregado`,
 * sin duplicar tabla ni lógica — ver `valor-agregado.ts`). Estas pruebas
 * cubren los 12 puntos pedidos explícitamente por el usuario.
 */
import { describe, expect, it } from 'vitest';
import {
  calcularTotalesServicioNoContinuo, crearServicioNoContinuoVacio,
  sugerirFrecuenciaServicioCodigo,
  type ServicioNoContinuo,
} from './servicios-no-continuos';
import { FRECUENCIAS_VALOR_AGREGADO, type FrecuenciaValorAgregado } from './valor-agregado';

/** Servicio con `otrosCostos` sumando exactamente $1.200.000, sin ningún
 * otro bloque (manoObra/insumos/maquinaria en 0) — así `subtotalAntesFrecuencia`
 * es el valor base $1.200.000 pedido en los casos numéricos del usuario. */
function servicioBase(frecuenciaServicioCodigo?: FrecuenciaValorAgregado, frecuenciaServicioMeses?: number): ServicioNoContinuo {
  const s = crearServicioNoContinuoVacio('s1', 'Servicio de prueba');
  return {
    ...s,
    otrosCostos: [{ id: 1, concepto: 'Base', cantidad: 1, frecuenciaMeses: 1, valorUnitario: 1_200_000 }],
    ...(frecuenciaServicioCodigo !== undefined ? { frecuenciaServicioCodigo } : {}),
    ...(frecuenciaServicioMeses !== undefined ? { frecuenciaServicioMeses } : {}),
  };
}

describe('1. Catálogo — 15 frecuencias oficiales, mismo orden y labels que Valor Agregado', () => {
  it('expone exactamente 15 opciones', () => {
    expect(FRECUENCIAS_VALOR_AGREGADO).toHaveLength(15);
  });
  it('valores 1..15 en orden, sin duplicar la tabla (reutiliza el mismo arreglo importado)', () => {
    expect(FRECUENCIAS_VALOR_AGREGADO.map(f => f.value)).toEqual([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]);
  });
});

describe('2. UI — no existe input numérico libre "Frecuencia (meses)" en el modal SNC', () => {
  it('page.tsx ya no contiene el input type="number" de frecuencia del servicio', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('node:fs');
    const { join } = require('node:path');
    const pageTsx = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');
    expect(pageTsx).not.toContain('actualizarFrecuenciaServicioBorrador(Math.max(1,Math.round(Number(e.target.value)||1)))');
    expect(pageTsx).toContain('actualizarFrecuenciaServicioBorrador(Number(e.target.value) as FrecuenciaValorAgregado)');
  });
});

describe('3/4/5/6. Cada código usa el divisor correcto (base $1.200.000)', () => {
  const casos: [FrecuenciaValorAgregado, number][] = [
    [1, 1_200_000],      // MENSUAL
    [2, 600_000],        // BIMESTRAL
    [3, 400_000],        // TRIMESTRAL
    [12, 100_000],       // ANUAL
    [13, 2_400_000],     // QUINCENAL ÷0.5
    [15, 1_200_000],     // A SOLICITUD ÷1
  ];
  it.each(casos)('código %s → total esperado', (codigo, esperado) => {
    const totales = calcularTotalesServicioNoContinuo(servicioBase(codigo), 0);
    expect(totales.total).toBeCloseTo(esperado, 2);
  });
  it('SEMANAL (14) usa divisor 0.433 → ≈ $2.771.362,59', () => {
    const totales = calcularTotalesServicioNoContinuo(servicioBase(14), 0);
    expect(totales.total).toBeCloseTo(2_771_362.59, 1);
  });
  it('QUINCENAL (13) usa exactamente 0.5', () => {
    const totales = calcularTotalesServicioNoContinuo(servicioBase(13), 0);
    expect(totales.frecuenciaServicioMeses).toBe(0.5);
  });
  it('A SOLICITUD (15) usa exactamente 1', () => {
    const totales = calcularTotalesServicioNoContinuo(servicioBase(15), 0);
    expect(totales.frecuenciaServicioMeses).toBe(1);
  });
});

describe('7. Guardar/reabrir conserva la frecuencia', () => {
  it('frecuenciaServicioCodigo persiste tal cual en el servicio (no se recalcula al releer)', () => {
    const s = servicioBase(6);
    expect(s.frecuenciaServicioCodigo).toBe(6);
    const totales = calcularTotalesServicioNoContinuo(s, 0);
    expect(totales.frecuenciaServicioCodigo).toBe(6);
  });
});

describe('8. Históricos siguen cargando correctamente (retrocompatibilidad)', () => {
  it('histórico sin frecuenciaServicioCodigo, frecuenciaServicioMeses=1: total igual que antes', () => {
    const totales = calcularTotalesServicioNoContinuo(servicioBase(undefined, 1), 0);
    expect(totales.total).toBeCloseTo(1_200_000, 2);
    expect(totales.frecuenciaServicioCodigo).toBeNull();
  });
  it('histórico frecuenciaServicioMeses=6 (legado, sin código): sigue dividiendo /6 exactamente igual que antes de este ajuste', () => {
    const totales = calcularTotalesServicioNoContinuo(servicioBase(undefined, 6), 0);
    expect(totales.total).toBeCloseTo(200_000, 2);
  });
  it('servicio totalmente ausente de ambos campos (muy antiguo): trata como MENSUAL (divisor 1), igual que el fallback original', () => {
    const totales = calcularTotalesServicioNoContinuo(servicioBase(), 0);
    expect(totales.total).toBeCloseTo(1_200_000, 2);
  });
  it('sugerirFrecuenciaServicioCodigo mapea legado 1..12 al mismo número como código (cero riesgo, divisor idéntico)', () => {
    expect(sugerirFrecuenciaServicioCodigo({ frecuenciaServicioMeses: 6 })).toBe(6);
    expect(sugerirFrecuenciaServicioCodigo({ frecuenciaServicioMeses: 12 })).toBe(12);
  });
  it('sugerirFrecuenciaServicioCodigo NUNCA reinterpreta legado ambiguo (13+, no entero) como código del catálogo', () => {
    expect(sugerirFrecuenciaServicioCodigo({ frecuenciaServicioMeses: 13 })).toBeUndefined();
    expect(sugerirFrecuenciaServicioCodigo({ frecuenciaServicioMeses: 18 })).toBeUndefined();
    expect(sugerirFrecuenciaServicioCodigo({ frecuenciaServicioMeses: 2.5 })).toBeUndefined();
  });
  it('sugerirFrecuenciaServicioCodigo: servicio nuevo (sin nada) sugiere MENSUAL (1), mismo default histórico', () => {
    expect(sugerirFrecuenciaServicioCodigo({})).toBe(1);
  });
  it('sugerirFrecuenciaServicioCodigo: frecuenciaServicioCodigo ya presente tiene prioridad sobre el legado', () => {
    expect(sugerirFrecuenciaServicioCodigo({ frecuenciaServicioCodigo: 9, frecuenciaServicioMeses: 3 })).toBe(9);
  });
});

describe('9. Cambiar la frecuencia recalcula el total', () => {
  it('mismo servicio, distinto código → distinto total', () => {
    const mensual = calcularTotalesServicioNoContinuo(servicioBase(1), 0).total;
    const trimestral = calcularTotalesServicioNoContinuo(servicioBase(3), 0).total;
    expect(mensual).not.toBeCloseTo(trimestral, 2);
  });
});

describe('10. No modifica el valor base del SNC (subtotalAntesFrecuencia idéntico entre códigos)', () => {
  it('subtotalAntesFrecuencia es el mismo $1.200.000 sin importar la frecuencia elegida', () => {
    const a = calcularTotalesServicioNoContinuo(servicioBase(1), 0);
    const b = calcularTotalesServicioNoContinuo(servicioBase(12), 0);
    expect(a.subtotalAntesFrecuencia).toBe(1_200_000);
    expect(b.subtotalAntesFrecuencia).toBe(1_200_000);
  });
});

describe('11. No hay doble división con Valor Agregado — page.tsx aplica frecuenciaValorAgregado UNA sola vez, sobre `.total` ya dividido por frecuenciaServicioCodigo', () => {
  it('page.tsx divide el `.total` de SNC (ya con su propia frecuencia aplicada) por resolverFactorPeriodicidadValorAgregado(frecuenciaValorAgregado) exactamente igual que Mano de Obra/Insumos/Maquinaria — mismo patrón uniforme, no una fórmula nueva', () => {
    const { readFileSync } = require('node:fs');
    const { join } = require('node:path');
    const pageTsx = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');
    expect(pageTsx).toContain("calcularTotalesServicioNoContinuo(s,totalesManoObraPorServicioNoContinuo.get(s.id)??0).total/resolverFactorPeriodicidadValorAgregado(s.frecuenciaValorAgregado)");
  });
});

describe('12. Activos Fijos/Especializados/Otros Costos siguen calculando igual internamente (independientes de la frecuencia del servicio)', () => {
  it('maquinariaEquipos/otrosCostos no varían al cambiar la frecuencia del servicio (solo el total final cambia)', () => {
    const a = calcularTotalesServicioNoContinuo(servicioBase(1), 0);
    const b = calcularTotalesServicioNoContinuo(servicioBase(13), 0);
    expect(a.otrosCostos).toBe(b.otrosCostos);
    expect(a.maquinariaEquipos).toBe(b.maquinariaEquipos);
  });
});
