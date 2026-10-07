import { describe, expect, it } from 'vitest';
import {
  esRecursoValorAgregado, particionarPorValorAgregado, validarFrecuenciaValorAgregado,
  crearReinversionVacia, validarReinversion, calcularValorMensualReinversion, calcularTotalReinversiones,
  calcularTotalValorAgregado, etiquetaFrecuenciaValorAgregado, resolverFactorPeriodicidadValorAgregado,
  type FilaConsolidadaValorAgregado, type ReinversionValorAgregado, type RecursoConValorAgregado,
  type FrecuenciaValorAgregado,
} from './valor-agregado';

describe('esRecursoValorAgregado — histórico sin el campo -> false', () => {
  it('esValorAgregado ausente (histórico) -> false', () => {
    expect(esRecursoValorAgregado({})).toBe(false);
  });
  it('esValorAgregado=false explícito -> false', () => {
    expect(esRecursoValorAgregado({ esValorAgregado: false })).toBe(false);
  });
  it('esValorAgregado=true -> true', () => {
    expect(esRecursoValorAgregado({ esValorAgregado: true })).toBe(true);
  });
  it('null/undefined -> false, nunca lanza', () => {
    expect(esRecursoValorAgregado(null)).toBe(false);
    expect(esRecursoValorAgregado(undefined)).toBe(false);
  });
});

describe('validarFrecuenciaValorAgregado — obligatoria SOLO si esValorAgregado=true', () => {
  it('esValorAgregado=true sin frecuencia -> mensaje de error', () => {
    expect(validarFrecuenciaValorAgregado({ esValorAgregado: true })).toBe('Selecciona la frecuencia del Valor Agregado.');
  });
  it('esValorAgregado=true con frecuencia -> null (válido)', () => {
    expect(validarFrecuenciaValorAgregado({ esValorAgregado: true, frecuenciaValorAgregado: 1 })).toBeNull();
  });
  it('esValorAgregado=false nunca exige frecuencia, aunque no la tenga', () => {
    expect(validarFrecuenciaValorAgregado({ esValorAgregado: false })).toBeNull();
  });
  it('esValorAgregado ausente (histórico) nunca exige frecuencia', () => {
    expect(validarFrecuenciaValorAgregado({})).toBeNull();
  });
});

// Regla crítica de "no doble conteo" — Mano de Obra/Insumos/Maquinaria/SNC
// comparten la MISMA partición pura (nunca una función distinta por
// módulo, ver docblock de valor-agregado.ts).
describe('particionarPorValorAgregado — regla de no doble conteo, misma función para los 4 tipos derivados', () => {
  function fila(id: number, esValorAgregado?: boolean): RecursoConValorAgregado & { id: number } {
    return { id, esValorAgregado };
  }

  it('recurso normal (sin flag) cae en "normales", nunca en "valorAgregado"', () => {
    const { normales, valorAgregado } = particionarPorValorAgregado([fila(1)]);
    expect(normales).toHaveLength(1);
    expect(valorAgregado).toHaveLength(0);
  });

  it('recurso marcado VA cae en "valorAgregado", deja de estar en "normales" — nunca en ambos', () => {
    const { normales, valorAgregado } = particionarPorValorAgregado([fila(1, true)]);
    expect(normales).toHaveLength(0);
    expect(valorAgregado).toHaveLength(1);
    expect(valorAgregado[0].id).toBe(1);
  });

  it('mezcla de normales y VA se particiona correctamente, sin perder ninguno y sin duplicar ninguno', () => {
    const filas = [fila(1), fila(2, true), fila(3), fila(4, true)];
    const { normales, valorAgregado } = particionarPorValorAgregado(filas);
    expect(normales.map(f => f.id)).toEqual([1, 3]);
    expect(valorAgregado.map(f => f.id)).toEqual([2, 4]);
    // Ningún id aparece en ambos grupos — no doble conteo.
    const idsNormales = new Set(normales.map(f => f.id));
    const idsVA = new Set(valorAgregado.map(f => f.id));
    expect([...idsNormales].some(id => idsVA.has(id))).toBe(false);
  });

  it('esValorAgregado=false explícito (cambiar Sí→No) vuelve a caer en "normales"', () => {
    const { normales, valorAgregado } = particionarPorValorAgregado([fila(1, false)]);
    expect(normales.map(f => f.id)).toEqual([1]);
    expect(valorAgregado).toHaveLength(0);
  });

  it('arreglo vacío no lanza, devuelve ambos grupos vacíos', () => {
    const { normales, valorAgregado } = particionarPorValorAgregado([]);
    expect(normales).toEqual([]);
    expect(valorAgregado).toEqual([]);
  });
});

describe('Reinversión — por valor', () => {
  it('crearReinversionVacia arranca en tipo VALOR, sin valor/porcentaje/frecuencia', () => {
    const r = crearReinversionVacia(1);
    expect(r).toEqual({ id: 1, descripcion: '', tipoReinversion: 'VALOR', valorMensual: undefined, porcentaje: undefined, frecuenciaReinversion: undefined });
  });

  it('tipo VALOR sin valorMensual -> inválido, exige el valor mensual', () => {
    const r: ReinversionValorAgregado = { id: 1, tipoReinversion: 'VALOR', frecuenciaReinversion: 1 };
    expect(validarReinversion(r)).toBe('El valor de reinversión mensual es obligatorio.');
  });

  it('tipo VALOR con valorMensual y frecuencia -> válido', () => {
    const r: ReinversionValorAgregado = { id: 1, tipoReinversion: 'VALOR', valorMensual: 1000000, frecuenciaReinversion: 1 };
    expect(validarReinversion(r)).toBeNull();
    expect(calcularValorMensualReinversion(r)).toBe(1000000);
  });

  it('tipo VALOR con valorMensual pero SIN frecuencia -> inválido (frecuencia obligatoria para ambos tipos)', () => {
    const r: ReinversionValorAgregado = { id: 1, tipoReinversion: 'VALOR', valorMensual: 1000000 };
    expect(validarReinversion(r)).toBe('Selecciona la frecuencia de reinversión.');
  });

  it('valorMensual=0 o negativo se trata como ausente (obligatorio > 0)', () => {
    const r: ReinversionValorAgregado = { id: 1, tipoReinversion: 'VALOR', valorMensual: 0, frecuenciaReinversion: 1 };
    expect(validarReinversion(r)).toBe('El valor de reinversión mensual es obligatorio.');
  });
});

describe('Reinversión — por porcentaje (base: VALOR TOTAL DE OFERTA de Tarifa Regulada)', () => {
  it('tipo PORCENTAJE sin porcentaje -> inválido, exige el porcentaje', () => {
    const r: ReinversionValorAgregado = { id: 1, tipoReinversion: 'PORCENTAJE', frecuenciaReinversion: 1 };
    expect(validarReinversion(r)).toBe('El porcentaje de reinversión es obligatorio.');
  });

  it('tipo PORCENTAJE con porcentaje y frecuencia -> válido', () => {
    const r: ReinversionValorAgregado = { id: 1, tipoReinversion: 'PORCENTAJE', porcentaje: 10, frecuenciaReinversion: 1 };
    expect(validarReinversion(r)).toBeNull();
  });

  it('no exige AMBOS campos — con porcentaje presente, valorMensual ausente no bloquea', () => {
    const r: ReinversionValorAgregado = { id: 1, tipoReinversion: 'PORCENTAJE', porcentaje: 15, frecuenciaReinversion: 3 };
    expect(validarReinversion(r)).toBeNull();
  });

  it('ejemplo del requerimiento: $6.126.509 × 10% = $612.650,90', () => {
    const r: ReinversionValorAgregado = { id: 1, tipoReinversion: 'PORCENTAJE', porcentaje: 10, frecuenciaReinversion: 1 };
    expect(calcularValorMensualReinversion(r, 6126509)).toBeCloseTo(612650.9, 5);
  });

  it('sin totalTarifaRegulada (default 0, p. ej. proceso sin pestaña Tarifa Regulada) -> 0, nunca NaN', () => {
    const r: ReinversionValorAgregado = { id: 1, tipoReinversion: 'PORCENTAJE', porcentaje: 10, frecuenciaReinversion: 1 };
    expect(calcularValorMensualReinversion(r)).toBe(0);
  });

  it('porcentaje ausente con totalTarifaRegulada presente -> 0, nunca NaN', () => {
    const r: ReinversionValorAgregado = { id: 1, tipoReinversion: 'PORCENTAJE', frecuenciaReinversion: 1 };
    expect(calcularValorMensualReinversion(r, 6126509)).toBe(0);
  });

  it('usa SIEMPRE el total general (nunca por posición) — mismo total, mismo monto sin importar cuántas posiciones lo componen', () => {
    const r: ReinversionValorAgregado = { id: 1, tipoReinversion: 'PORCENTAJE', porcentaje: 10, frecuenciaReinversion: 1 };
    // El total ya viene consolidado (calcularTotalValorOfertaReguladaProceso) — la función de Reinversión nunca vuelve a multiplicar por cantidad de posiciones.
    expect(calcularValorMensualReinversion(r, 1000000)).toBe(100000);
  });
});

describe('Reinversión — por valor (100% manual, nunca deriva de Tarifa Regulada)', () => {
  it('el monto manual se conserva tal cual aunque se pase un totalTarifaRegulada', () => {
    const r: ReinversionValorAgregado = { id: 1, tipoReinversion: 'VALOR', valorMensual: 500000, frecuenciaReinversion: 1 };
    expect(calcularValorMensualReinversion(r, 6126509)).toBe(500000);
  });
});

describe('calcularTotalReinversiones — VALOR suma tal cual, PORCENTAJE deriva de totalTarifaRegulada', () => {
  it('suma varias reinversiones tipo VALOR', () => {
    const rs: ReinversionValorAgregado[] = [
      { id: 1, tipoReinversion: 'VALOR', valorMensual: 500000, frecuenciaReinversion: 1 },
      { id: 2, tipoReinversion: 'VALOR', valorMensual: 300000, frecuenciaReinversion: 2 },
    ];
    expect(calcularTotalReinversiones(rs)).toBe(800000);
  });

  it('una reinversión PORCENTAJE mezclada con VALOR suma ambas partes cuando se pasa el total de Tarifa Regulada', () => {
    const rs: ReinversionValorAgregado[] = [
      { id: 1, tipoReinversion: 'VALOR', valorMensual: 500000, frecuenciaReinversion: 1 },
      { id: 2, tipoReinversion: 'PORCENTAJE', porcentaje: 20, frecuenciaReinversion: 1 },
    ];
    expect(calcularTotalReinversiones(rs, 1000000)).toBe(700000);
  });

  it('sin totalTarifaRegulada, PORCENTAJE aporta 0 (nunca NaN)', () => {
    const rs: ReinversionValorAgregado[] = [
      { id: 1, tipoReinversion: 'VALOR', valorMensual: 500000, frecuenciaReinversion: 1 },
      { id: 2, tipoReinversion: 'PORCENTAJE', porcentaje: 20, frecuenciaReinversion: 1 },
    ];
    expect(calcularTotalReinversiones(rs)).toBe(500000);
  });

  it('arreglo vacío -> 0', () => {
    expect(calcularTotalReinversiones([])).toBe(0);
  });
});

describe('etiquetaFrecuenciaValorAgregado — catálogo oficial de 15 códigos (Grupo Colba)', () => {
  it('mapea cada código 1-15 a su etiqueta legible', () => {
    expect(etiquetaFrecuenciaValorAgregado(1)).toBe('Mensual');
    expect(etiquetaFrecuenciaValorAgregado(2)).toBe('Bimestral');
    expect(etiquetaFrecuenciaValorAgregado(3)).toBe('Trimestral');
    expect(etiquetaFrecuenciaValorAgregado(4)).toBe('Cuatrimestral');
    expect(etiquetaFrecuenciaValorAgregado(5)).toBe('Cada 5 meses');
    expect(etiquetaFrecuenciaValorAgregado(6)).toBe('Semestral');
    expect(etiquetaFrecuenciaValorAgregado(7)).toBe('Cada 7 meses');
    expect(etiquetaFrecuenciaValorAgregado(8)).toBe('Cada 8 meses');
    expect(etiquetaFrecuenciaValorAgregado(9)).toBe('Cada 9 meses');
    expect(etiquetaFrecuenciaValorAgregado(10)).toBe('Cada 10 meses');
    expect(etiquetaFrecuenciaValorAgregado(11)).toBe('Cada 11 meses');
    expect(etiquetaFrecuenciaValorAgregado(12)).toBe('Anual');
    expect(etiquetaFrecuenciaValorAgregado(13)).toBe('Quincenal');
    expect(etiquetaFrecuenciaValorAgregado(14)).toBe('Semanal');
    expect(etiquetaFrecuenciaValorAgregado(15)).toBe('A solicitud');
  });
  it('ausente (undefined/null) -> "—", nunca lanza', () => {
    expect(etiquetaFrecuenciaValorAgregado(undefined)).toBe('—');
    expect(etiquetaFrecuenciaValorAgregado(null)).toBe('—');
  });
});

// Ajuste "PERIODICIDAD AFECTA EL VALOR MENSUAL DE VALOR AGREGADO" — único
// punto central de la fórmula valorMensual = valorBase / divisor. Tabla
// oficial Grupo Colba, divisores exactos (13 y 14 sin aproximar).
describe('resolverFactorPeriodicidadValorAgregado — divisor oficial exacto por código, fallback seguro', () => {
  it('devuelve el divisor exacto de cada uno de los 15 códigos oficiales', () => {
    expect(resolverFactorPeriodicidadValorAgregado(1)).toBe(1);
    expect(resolverFactorPeriodicidadValorAgregado(2)).toBe(2);
    expect(resolverFactorPeriodicidadValorAgregado(3)).toBe(3);
    expect(resolverFactorPeriodicidadValorAgregado(4)).toBe(4);
    expect(resolverFactorPeriodicidadValorAgregado(5)).toBe(5);
    expect(resolverFactorPeriodicidadValorAgregado(6)).toBe(6);
    expect(resolverFactorPeriodicidadValorAgregado(7)).toBe(7);
    expect(resolverFactorPeriodicidadValorAgregado(8)).toBe(8);
    expect(resolverFactorPeriodicidadValorAgregado(9)).toBe(9);
    expect(resolverFactorPeriodicidadValorAgregado(10)).toBe(10);
    expect(resolverFactorPeriodicidadValorAgregado(11)).toBe(11);
    expect(resolverFactorPeriodicidadValorAgregado(12)).toBe(12);
    expect(resolverFactorPeriodicidadValorAgregado(13)).toBe(0.5);
    expect(resolverFactorPeriodicidadValorAgregado(14)).toBe(0.433);
    expect(resolverFactorPeriodicidadValorAgregado(15)).toBe(1);
  });

  it('sin frecuencia (undefined/null) -> fallback divisor 1 (MENSUAL) — nunca lanza ni deja NaN', () => {
    expect(resolverFactorPeriodicidadValorAgregado(undefined)).toBe(1);
    expect(resolverFactorPeriodicidadValorAgregado(null)).toBe(1);
  });

  it('valor fuera de 1-15 (ej. esquema histórico de días, ya retirado) -> fallback seguro divisor 1, NUNCA se reinterpreta como un código específico', () => {
    // Confirmado contra los 11 registros reales de CostoEstructura: cero
    // uso histórico del esquema de días — este test cubre el caso
    // defensivo (dato corrupto/inesperado), no una migración real.
    expect(resolverFactorPeriodicidadValorAgregado(30 as unknown as FrecuenciaValorAgregado)).toBe(1);
    expect(resolverFactorPeriodicidadValorAgregado(360 as unknown as FrecuenciaValorAgregado)).toBe(1);
    expect(resolverFactorPeriodicidadValorAgregado(0 as unknown as FrecuenciaValorAgregado)).toBe(1);
    expect(resolverFactorPeriodicidadValorAgregado(-1 as unknown as FrecuenciaValorAgregado)).toBe(1);
    expect(resolverFactorPeriodicidadValorAgregado(999 as unknown as FrecuenciaValorAgregado)).toBe(1);
  });

  it('validación numérica obligatoria — $1.200.000 con cada frecuencia del enunciado', () => {
    const base = 1200000;
    expect(base / resolverFactorPeriodicidadValorAgregado(1)).toBe(1200000);   // MENSUAL
    expect(base / resolverFactorPeriodicidadValorAgregado(3)).toBeCloseTo(400000, 5);      // TRIMESTRAL
    expect(base / resolverFactorPeriodicidadValorAgregado(12)).toBe(100000);   // ANUAL
    expect(base / resolverFactorPeriodicidadValorAgregado(13)).toBe(2400000); // QUINCENAL
    expect(base / resolverFactorPeriodicidadValorAgregado(14)).toBeCloseTo(2771362.6, 0); // SEMANAL ≈ 2.771.363
    expect(base / resolverFactorPeriodicidadValorAgregado(15)).toBe(1200000); // A SOLICITUD
  });
});

// Total consolidado — Reinversión + los 4 tipos derivados, reconciliado
// (cada recurso aparece exactamente una vez, ver particionarPorValorAgregado).
describe('calcularTotalValorAgregado — total reconciliado de los 5 tipos', () => {
  function filaVA(tipo: FilaConsolidadaValorAgregado['tipo'], valorMensual: number): FilaConsolidadaValorAgregado {
    return { tipo, claveFila: `${tipo}-${valorMensual}`, descripcion: 'x', valorMensual, origen: tipo };
  }

  it('suma las 5 filas de los 5 tipos exactamente una vez cada una', () => {
    const filas = [
      filaVA('REINVERSION', 1000000),
      filaVA('MANO_DE_OBRA', 2000000),
      filaVA('INSUMOS', 150000),
      filaVA('MAQUINARIA', 300000),
      filaVA('SNC', 500000),
    ];
    expect(calcularTotalValorAgregado(filas)).toBe(3950000);
  });

  it('sin filas -> 0', () => {
    expect(calcularTotalValorAgregado([])).toBe(0);
  });
});
