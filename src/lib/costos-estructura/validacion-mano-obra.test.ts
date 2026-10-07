import { describe, expect, it } from 'vitest';
import { validarManoObraParaFinalizar, MENSAJE_ENCABEZADO_ERRORES_FINALIZAR, type LineaValidable } from './validacion-mano-obra';

function linea(over: Partial<LineaValidable> = {}): LineaValidable {
  return {
    id: 1, nombreCargo: 'Aseador', cantOpeFijos: '2', salarioBase: '1750905',
    arlKey: 'II', distribucionesHorario: [{}],
    ...over,
  };
}

function base(over: Partial<Parameters<typeof validarManoObraParaFinalizar>[0]> = {}) {
  return {
    lineas: [linea()],
    cargosTurnantes: [],
    cantidadLineasBloqueadas: 0,
    cantidadTurnantesBloqueados: 0,
    costosOtrosPendientesDeAsignacion: 0,
    ...over,
  };
}

describe('validarManoObraParaFinalizar — bloqueo de datos incompletos (§6, pruebas #5/#6)', () => {
  it('5/6) un módulo completamente válido no produce problemas', () => {
    const r = validarManoObraParaFinalizar(base());
    expect(r.valido).toBe(true);
    expect(r.problemas).toEqual([]);
  });

  it('bloquea cuando no existen cargos', () => {
    const r = validarManoObraParaFinalizar(base({ lineas: [] }));
    expect(r.valido).toBe(false);
    expect(r.problemas).toContain('No hay ningún cargo de Mano de Obra registrado.');
  });

  it('bloquea 1 cargo sin programación (mensaje comercial exacto)', () => {
    const r = validarManoObraParaFinalizar(base({ lineas: [linea({ distribucionesHorario: [] })] }));
    expect(r.valido).toBe(false);
    expect(r.problemas).toContain('1 cargo sin programación.');
  });

  it('bloquea cantidad de trabajadores <= 0', () => {
    const r = validarManoObraParaFinalizar(base({ lineas: [linea({ cantOpeFijos: '0' })] }));
    expect(r.valido).toBe(false);
    expect(r.problemas.some(p => p.includes('sin cantidad válida'))).toBe(true);
  });

  it('bloquea salario <= 0', () => {
    const r = validarManoObraParaFinalizar(base({ lineas: [linea({ salarioBase: '0' })] }));
    expect(r.valido).toBe(false);
    expect(r.problemas.some(p => p.includes('sin salario válido'))).toBe(true);
  });

  it('bloquea ARL faltante', () => {
    const r = validarManoObraParaFinalizar(base({ lineas: [linea({ arlKey: '' })] }));
    expect(r.valido).toBe(false);
    expect(r.problemas.some(p => p.includes('sin clase de riesgo ARL'))).toBe(true);
  });

  it('bloquea 2 costos pendientes de asignación (mensaje comercial exacto, sin códigos internos)', () => {
    const r = validarManoObraParaFinalizar(base({ costosOtrosPendientesDeAsignacion: 2 }));
    expect(r.valido).toBe(false);
    expect(r.problemas).toContain('2 costos pendientes de asignación.');
  });

  it('bloquea líneas que no pudieron calcularse (Mano de Obra + Turnantes bloqueados)', () => {
    const r = validarManoObraParaFinalizar(base({ cantidadLineasBloqueadas: 1, cantidadTurnantesBloqueados: 1 }));
    expect(r.valido).toBe(false);
    expect(r.problemas.some(p => p.includes('no pudo') || p.includes('no pudieron'))).toBe(true);
  });

  it('bloquea IDs huérfanos/duplicados', () => {
    const r = validarManoObraParaFinalizar(base({ lineas: [linea({ id: 1 }), linea({ id: 1 })] }));
    expect(r.valido).toBe(false);
    expect(r.problemas.some(p => p.toLowerCase().includes('identificadores'))).toBe(true);
  });

  it('bloquea turnantes obligatorios sin cubrir cuando se declara la necesidad', () => {
    const r = validarManoObraParaFinalizar(base({ turnantesObligatoriosSinCubrir: 1 }));
    expect(r.valido).toBe(false);
    expect(r.problemas.some(p => p.includes('turnante obligatorio sin cubrir'))).toBe(true);
  });

  it('turnantesObligatoriosSinCubrir ausente no bloquea (contrato preparado, sin fuente real todavía)', () => {
    const r = validarManoObraParaFinalizar(base());
    expect(r.valido).toBe(true);
  });

  it('acumula varios problemas a la vez, cada uno en texto comercial sin códigos internos', () => {
    const r = validarManoObraParaFinalizar(base({
      lineas: [linea({ cantOpeFijos: '0', arlKey: '' })],
      costosOtrosPendientesDeAsignacion: 3,
    }));
    expect(r.valido).toBe(false);
    expect(r.problemas.length).toBeGreaterThanOrEqual(3);
    for (const p of r.problemas) {
      expect(p).not.toMatch(/PROGRAMACION_INCOMPLETA|ERROR_DE_CALCULO|estadoUI/);
    }
  });

  it('las líneas de Turnantes se validan con las mismas reglas que Mano de Obra', () => {
    const r = validarManoObraParaFinalizar(base({ lineas: [], cargosTurnantes: [linea({ salarioBase: '0' })] }));
    expect(r.valido).toBe(false);
    expect(r.problemas.some(p => p.includes('sin salario válido'))).toBe(true);
  });
});

describe('MENSAJE_ENCABEZADO_ERRORES_FINALIZAR', () => {
  it('es el texto comercial exacto pedido', () => {
    expect(MENSAJE_ENCABEZADO_ERRORES_FINALIZAR).toBe('No es posible finalizar Mano de Obra. Revisa los siguientes puntos:');
  });
});