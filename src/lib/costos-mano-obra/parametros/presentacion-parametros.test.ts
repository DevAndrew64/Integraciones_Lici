import { describe, it, expect } from 'vitest';
import { ETIQUETA_GRUPO, ETIQUETA_ORIGEN, ETIQUETA_ESTADO_NORMATIVO, formatearValorParametro } from './presentacion-parametros';
import { CATALOGO_PARAMETROS } from './catalogo-parametros';

describe('presentacion-parametros', () => {
  it('trae etiqueta comercial para cada grupo del catálogo', () => {
    const grupos = new Set(CATALOGO_PARAMETROS.map((p) => p.grupo));
    grupos.forEach((g) => expect(ETIQUETA_GRUPO[g]).toBeTruthy());
  });

  it('trae etiqueta comercial para cada origen posible', () => {
    (['AJUSTE_PROCESO', 'EMPRESARIAL', 'NORMATIVO', 'TECNICO_RESPALDO', 'DERIVADO_AUTOMATICO'] as const).forEach((o) =>
      expect(ETIQUETA_ORIGEN[o]).toBeTruthy(),
    );
  });

  it('trae etiqueta comercial para cada estado normativo', () => {
    (['PENDIENTE', 'APROBADO', 'VIGENTE', 'DEROGADO'] as const).forEach((e) => expect(ETIQUETA_ESTADO_NORMATIVO[e]).toBeTruthy());
  });

  it('formatea porcentaje como fracción × 100', () => {
    expect(formatearValorParametro(0.35, 'PORCENTAJE')).toBe('35%');
    expect(formatearValorParametro(0.085, 'PORCENTAJE')).toBe('8,5%');
  });

  it('formatea horas y días con su unidad', () => {
    expect(formatearValorParametro(42, 'HORAS')).toBe('42 h');
    expect(formatearValorParametro(30, 'DIAS')).toBe('30 d');
  });
});