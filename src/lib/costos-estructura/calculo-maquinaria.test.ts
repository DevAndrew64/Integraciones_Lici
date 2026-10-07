import { describe, expect, it } from 'vitest';
import {
  calcularCostoMensualMaquinariaEquipo,
  calcularValorConIvaMaquinaria,
  calcularValorAntesIvaMaquinaria,
  calcularIvaCalculadoMaquinaria,
  calcularValorMesRequeridoMaquinaria,
  calcularCantidadComprarMaquinaria,
  calcularValorMesComprarMaquinaria,
  calcularValorMesMantenimientoMaquinaria,
  calcularCamposMaquinariaEquipo,
  calcularSubtotalAdquisicionMaquinaria,
  calcularSubtotalMantenimientoMaquinaria,
  calcularTotalMensualMaquinariaEquipos,
  normalizarMaquinariaHistorico,
} from './calculo-maquinaria';

describe('calcularCostoMensualMaquinariaEquipo — fórmula del modelo ANTERIOR, conservada solo para migración', () => {
  it('cantidad 2, valor mensual $100.000 → $200.000', () => {
    expect(calcularCostoMensualMaquinariaEquipo({ cantidad: 2, valorMensual: 100000 })).toBe(200000);
  });
});

describe('1/2) calcularValorConIvaMaquinaria — multiplica por 1.19 solo cuando el valor NO incluye IVA', () => {
  it('valor sin IVA se multiplica por 1.19', () => {
    expect(calcularValorConIvaMaquinaria(2850000, false)).toBeCloseTo(2850000 * 1.19, 6);
  });

  it('valor que YA incluye IVA se conserva tal cual (nunca doble IVA)', () => {
    expect(calcularValorConIvaMaquinaria(3391500, true)).toBe(3391500);
  });
});

// Ajuste "AGREGAR EL CAMPO VISIBLE 'IVA CALCULADO'" — desglose de
// presentación (valorAntesIva/ivaCalculado), sin tocar valorConIva ni el
// resto del subtotal; misma semántica ya confirmada de incluyeIva.
describe('calcularValorAntesIvaMaquinaria / calcularIvaCalculadoMaquinaria — desglose de presentación', () => {
  it('$900.000 sin IVA → antes de IVA = $900.000, IVA calculado = $171.000, total = $1.071.000', () => {
    const valorUnitario = 900000;
    const incluyeIva = false;
    const valorConIva = calcularValorConIvaMaquinaria(valorUnitario, incluyeIva);
    const valorAntesIva = calcularValorAntesIvaMaquinaria(valorUnitario, incluyeIva);
    const ivaCalculado = calcularIvaCalculadoMaquinaria(valorConIva, valorAntesIva);
    expect(valorAntesIva).toBe(900000);
    expect(ivaCalculado).toBeCloseTo(171000, 0);
    expect(valorConIva).toBeCloseTo(1071000, 0);
  });

  it('$900.000 con IVA ya incluido → total se conserva en $900.000, IVA se separa del total (nunca se multiplica de nuevo)', () => {
    const valorUnitario = 900000;
    const incluyeIva = true;
    const valorConIva = calcularValorConIvaMaquinaria(valorUnitario, incluyeIva);
    const valorAntesIva = calcularValorAntesIvaMaquinaria(valorUnitario, incluyeIva);
    const ivaCalculado = calcularIvaCalculadoMaquinaria(valorConIva, valorAntesIva);
    expect(valorConIva).toBe(900000);
    expect(valorAntesIva).toBeCloseTo(756302.52, 1);
    expect(ivaCalculado).toBeCloseTo(143697.48, 1);
    expect(valorAntesIva + ivaCalculado).toBeCloseTo(valorConIva, 6);
  });
});

describe('3) calcularValorMesRequeridoMaquinaria — usa la cantidad REQUERIDA, nunca la cantidad a comprar', () => {
  it('brilladora: 3391500 × 2 / 48 = 141312.5', () => {
    expect(calcularValorMesRequeridoMaquinaria(3391500, 2, 48)).toBeCloseTo(141312.5, 4);
  });

  it('mesesDepreciacion=0 no divide por cero, resultado 0', () => {
    expect(calcularValorMesRequeridoMaquinaria(3391500, 2, 0)).toBe(0);
  });
});

describe('4/5) calcularCantidadComprarMaquinaria — resta disponible, nunca negativa', () => {
  it('cantidad requerida menos disponible', () => {
    expect(calcularCantidadComprarMaquinaria(2, 1)).toBe(1);
  });

  it('disponible mayor que lo requerido nunca produce cantidad negativa', () => {
    expect(calcularCantidadComprarMaquinaria(2, 5)).toBe(0);
  });
});

describe('6/7) calcularValorMesComprarMaquinaria — usa cantidadComprar; el disponible SÍ reduce la adquisición', () => {
  it('brilladora sin disponible: 3391500 × 2 / 48 = 141312.5', () => {
    expect(calcularValorMesComprarMaquinaria(3391500, 2, 48)).toBeCloseTo(141312.5, 4);
  });

  it('brilladora con 1 disponible (cantidadComprar=1): 3391500 × 1 / 48 = 70656.25', () => {
    expect(calcularValorMesComprarMaquinaria(3391500, 1, 48)).toBeCloseTo(70656.25, 4);
  });
});

describe('8/9) calcularValorMesMantenimientoMaquinaria — usa cantidad REQUERIDA, el disponible NUNCA reduce el mantenimiento', () => {
  it('brilladora: 40000 × 2 = 80000, sin importar cuántos estén disponibles', () => {
    expect(calcularValorMesMantenimientoMaquinaria(40000, 2)).toBe(80000);
  });

  it('el mantenimiento no recibe cantidadComprar como parámetro — misma cantidadRequerida con o sin disponibles', () => {
    const conDisponible = calcularValorMesMantenimientoMaquinaria(40000, 2);
    const sinDisponible = calcularValorMesMantenimientoMaquinaria(40000, 2);
    expect(conDisponible).toBe(sinDisponible);
  });
});

describe('10) calcularCamposMaquinariaEquipo — valorMesRequerido es informativo, no participa en valorMesComprar/valorMesMantenimiento', () => {
  it('brilladora completa (cantidadDisponible=0)', () => {
    const r = calcularCamposMaquinariaEquipo({
      cantidadRequerida: 2, mesesDepreciacion: 48, valorUnitario: 2850000, incluyeIva: false,
      cantidadDisponible: 0, valorMantenimientoMensualUnitario: 40000,
    });
    expect(r.valorConIva).toBeCloseTo(3391500, 0);
    expect(r.valorMesRequerido).toBeCloseTo(141312.5, 4);
    expect(r.cantidadComprar).toBe(2);
    expect(r.valorMesComprar).toBeCloseTo(141312.5, 4);
    expect(r.valorMesMantenimiento).toBe(80000);
  });

  it('brilladora con 1 disponible: valorMesRequerido NO cambia, valorMesComprar sí se reduce', () => {
    const r = calcularCamposMaquinariaEquipo({
      cantidadRequerida: 2, mesesDepreciacion: 48, valorUnitario: 2850000, incluyeIva: false,
      cantidadDisponible: 1, valorMantenimientoMensualUnitario: 40000,
    });
    expect(r.valorMesRequerido).toBeCloseTo(141312.5, 4);
    expect(r.cantidadComprar).toBe(1);
    expect(r.valorMesComprar).toBeCloseTo(70656.25, 4);
    expect(r.valorMesMantenimiento).toBe(80000);
  });
});

describe('11/12/13) subtotales y total — nunca incluyen valorMesRequerido', () => {
  const filas = [
    { valorMesComprar: 141312.5, valorMesMantenimiento: 80000 },
    { valorMesComprar: 162038.3333, valorMesMantenimiento: 75000 },
  ];

  it('subtotal de adquisición suma exactamente valorMesComprar', () => {
    expect(calcularSubtotalAdquisicionMaquinaria(filas)).toBeCloseTo(141312.5 + 162038.3333, 4);
  });

  it('subtotal de mantenimiento suma exactamente valorMesMantenimiento', () => {
    expect(calcularSubtotalMantenimientoMaquinaria(filas)).toBe(80000 + 75000);
  });

  it('el total mensual es la suma de ambos subtotales, nunca incluye valorMesRequerido', () => {
    const total = calcularTotalMensualMaquinariaEquipos(filas);
    expect(total).toBeCloseTo(141312.5 + 80000 + 162038.3333 + 75000, 3);
  });
});

describe('14/15/16) ejemplo de control — BRILLADORA', () => {
  const base = { cantidadRequerida: 2, mesesDepreciacion: 48, valorUnitario: 2850000, incluyeIva: false, valorMantenimientoMensualUnitario: 40000 };

  it('valorConIva = 2850000 × 1.19 = 3391500', () => {
    expect(calcularValorConIvaMaquinaria(base.valorUnitario, base.incluyeIva)).toBeCloseTo(3391500, 0);
  });

  it('cantidadDisponible=0 → valorMesRequerido ≈ $141.313 (141312.50 exacto)', () => {
    const r = calcularCamposMaquinariaEquipo({ ...base, cantidadDisponible: 0 });
    expect(r.valorMesRequerido).toBeCloseTo(141312.5, 4);
    expect(Math.round(r.valorMesRequerido)).toBe(141313);
  });

  it('cantidadDisponible=1 → valorMesComprar ≈ $70.656 (70656.25 exacto)', () => {
    const r = calcularCamposMaquinariaEquipo({ ...base, cantidadDisponible: 1 });
    expect(r.valorMesComprar).toBeCloseTo(70656.25, 4);
    expect(Math.round(r.valorMesComprar)).toBe(70656);
  });

  it('mantenimiento = $80.000 para cantidadRequerida=2, sin importar cuántos estén disponibles', () => {
    const conCero = calcularCamposMaquinariaEquipo({ ...base, cantidadDisponible: 0 });
    const conUno = calcularCamposMaquinariaEquipo({ ...base, cantidadDisponible: 1 });
    expect(conCero.valorMesMantenimiento).toBe(80000);
    expect(conUno.valorMesMantenimiento).toBe(80000);
  });
});

describe('17/18) ejemplo de control — ASPIRADORA', () => {
  const base = { cantidadRequerida: 3, mesesDepreciacion: 36, valorUnitario: 1634000, incluyeIva: false, cantidadDisponible: 0, valorMantenimientoMensualUnitario: 25000 };

  it('valorConIva = 1634000 × 1.19 ≈ 1944460', () => {
    expect(calcularValorConIvaMaquinaria(base.valorUnitario, base.incluyeIva)).toBeCloseTo(1944460, 0);
  });

  it('valorMesRequerido ≈ $162.038 (162038.33 exacto)', () => {
    const r = calcularCamposMaquinariaEquipo(base);
    expect(r.valorMesRequerido).toBeCloseTo(162038.3333, 2);
    expect(Math.round(r.valorMesRequerido)).toBe(162038);
  });

  it('mantenimiento = 25000 × 3 = $75.000', () => {
    const r = calcularCamposMaquinariaEquipo(base);
    expect(r.valorMesMantenimiento).toBe(75000);
  });
});

describe('19) precisión interna — los valores exactos se conservan sin redondear antes de totalizar', () => {
  it('valorMesRequerido de la aspiradora conserva decimales (162038.333...), nunca 162038 exacto internamente', () => {
    const r = calcularCamposMaquinariaEquipo({ cantidadRequerida: 3, mesesDepreciacion: 36, valorUnitario: 1634000, incluyeIva: false, cantidadDisponible: 0, valorMantenimientoMensualUnitario: 25000 });
    expect(r.valorMesRequerido).not.toBe(162038);
    expect(r.valorMesRequerido).toBeCloseTo(162038.3333, 2);
  });
});

describe('normalizarMaquinariaHistorico — migración defensiva del modelo anterior al nuevo', () => {
  it('fila del modelo NUEVO (ya tiene cantidadRequerida) se conserva tal cual, sin recalcular lo ya persistido', () => {
    const r = normalizarMaquinariaHistorico({
      descripcion: 'Brilladora', cantidadRequerida: 2, mesesDepreciacion: 48,
      valorUnitario: 2850000, incluyeIva: false, valorConIva: 3391500,
      valorMesRequerido: 141312.5, cantidadDisponible: 0, cantidadComprar: 2,
      valorMesComprar: 141312.5, valorMantenimientoMensualUnitario: 40000, valorMesMantenimiento: 80000,
    });
    expect(r.valorMesComprar).toBe(141312.5);
    expect(r.valorMesMantenimiento).toBe(80000);
  });

  it('fila del modelo ANTERIOR (cantidad/valorMensual/totalMensual) se traduce preservando EXACTAMENTE el mismo total mensual ya persistido', () => {
    const r = normalizarMaquinariaHistorico({ descripcion: 'Equipo viejo', cantidad: 2, valorMensual: 1000, totalMensual: 9999 });
    expect(r.cantidadRequerida).toBe(2);
    expect(r.mesesDepreciacion).toBe(1);
    expect(r.cantidadDisponible).toBe(0);
    expect(r.cantidadComprar).toBe(2);
    expect(r.valorMesComprar).toBe(9999);
    expect(r.valorMesRequerido).toBe(9999);
    expect(r.valorMesMantenimiento).toBe(0);
  });

  it('fila del modelo ANTERIOR sin totalMensual persistido reconstruye con cantidad×valorMensual antes de traducir', () => {
    const r = normalizarMaquinariaHistorico({ descripcion: 'X', cantidad: 2, valorMensual: 1000 });
    expect(r.valorMesComprar).toBe(2000);
  });

  it('cantidad ausente en el modelo anterior se completa en 1', () => {
    const r = normalizarMaquinariaHistorico({ descripcion: 'Aspiradora' });
    expect(r.cantidadRequerida).toBe(1);
  });

  it('origen ausente se completa en MANUAL', () => {
    const r = normalizarMaquinariaHistorico({ descripcion: 'X' });
    expect(r.origen).toBe('MANUAL');
  });

  it('descripcion ausente se completa en "—"', () => {
    const r = normalizarMaquinariaHistorico({});
    expect(r.descripcion).toBe('—');
  });

  it('1) conserva codigoGrupo tal cual (sin convertir a number, sin perder ceros iniciales)', () => {
    const r = normalizarMaquinariaHistorico({ descripcion: 'X', cantidadRequerida: 1, codigoGrupo: '004' });
    expect(r.codigoGrupo).toBe('004');
  });

  it('2) conserva codigoSubtipo tal cual', () => {
    const r = normalizarMaquinariaHistorico({ descripcion: 'X', cantidadRequerida: 1, codigoSubtipo: '096' });
    expect(r.codigoSubtipo).toBe('096');
  });

  it('3) los códigos mantienen ceros iniciales (nunca se convierten a number)', () => {
    const r = normalizarMaquinariaHistorico({ descripcion: 'X', cantidadRequerida: 1, codigoGrupo: '004', codigoSubtipo: '096', codigoCatalogoCompuesto: '004-096' });
    expect(typeof r.codigoGrupo).toBe('string');
    expect(typeof r.codigoSubtipo).toBe('string');
    expect(r.codigoCatalogoCompuesto).toBe('004-096');
  });

  it('valorMantenimientoMensualUnitario ausente en modelo nuevo se completa en null (nunca en cero) y origenMantenimiento en SIN_COINCIDENCIA', () => {
    const r = normalizarMaquinariaHistorico({ descripcion: 'AVISO PREVENTIVO', cantidadRequerida: 1 });
    expect(r.valorMantenimientoMensualUnitario).toBeNull();
    expect(r.origenMantenimiento).toBe('SIN_COINCIDENCIA');
    expect(r.valorMesMantenimiento).toBe(0);
  });

  it('valorMantenimientoMensualUnitario=0 en modelo nuevo se conserva como 0 (tarifa confirmada), nunca se convierte en null', () => {
    const r = normalizarMaquinariaHistorico({ descripcion: 'X', cantidadRequerida: 1, valorMantenimientoMensualUnitario: 0, origenMantenimiento: 'MANUAL' });
    expect(r.valorMantenimientoMensualUnitario).toBe(0);
  });

  it('fila del modelo ANTERIOR (histórico) siempre tiene mantenimiento null y origenMantenimiento SIN_COINCIDENCIA (el concepto no existía)', () => {
    const r = normalizarMaquinariaHistorico({ descripcion: 'X', cantidad: 2, valorMensual: 1000 });
    expect(r.valorMantenimientoMensualUnitario).toBeNull();
    expect(r.origenMantenimiento).toBe('SIN_COINCIDENCIA');
  });

  it('origenMantenimiento persistido se respeta tal cual (nunca se recalcula)', () => {
    const r = normalizarMaquinariaHistorico({ descripcion: 'X', cantidadRequerida: 1, valorMantenimientoMensualUnitario: 40000, origenMantenimiento: 'CATALOGO_MTTO_2025' });
    expect(r.origenMantenimiento).toBe('CATALOGO_MTTO_2025');
  });
});
