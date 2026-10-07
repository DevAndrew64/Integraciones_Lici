import { describe, expect, it } from 'vitest';
import { construirLlaveNegocio, resolverConflictosLlave, agruparVariacionesEntreContratos, type FilaTarifaNormalizada } from './normalizar-tarifas';

function fila(overrides: Partial<FilaTarifaNormalizada>): FilaTarifaNormalizada {
  const base: FilaTarifaNormalizada = {
    empresaPrestadora: 'ASEOCOLBA', uen: 'BAQ',
    clienteRazonSocial: 'CLIENTE X', contrato: 'C1', consecutivoTarifa: 1,
    puntoEntrega: 'P1', grupoActivo: '004', tipoActivo: '005', subtipoActivo: '051',
    descripcionEquipo: 'AUTOSCRUBBER', valorMesMantenimiento: 250000,
    fuenteHoja: 'PLANTILLA UEN BAQ', fuenteFila: 10,
    llaveNegocio: '',
  };
  const f = { ...base, ...overrides };
  f.llaveNegocio = construirLlaveNegocio(f);
  return f;
}

describe('resolverConflictosLlave', () => {
  it('7) dos tarifas contractuales distintas (mismo subtipo, distinto contrato) permanecen separadas, ambas aceptadas', () => {
    const a = fila({ contrato: 'C1', valorMesMantenimiento: 100000 });
    const b = fila({ contrato: 'C2', valorMesMantenimiento: 200000 });
    const { aceptadas, rechazadas } = resolverConflictosLlave([a, b]);
    expect(aceptadas).toHaveLength(2);
    expect(rechazadas).toHaveLength(0);
  });

  it('2) dos puntos de entrega del mismo contrato permanecen separados', () => {
    const a = fila({ puntoEntrega: 'P1' });
    const b = fila({ puntoEntrega: 'P2' });
    const { aceptadas } = resolverConflictosLlave([a, b]);
    expect(aceptadas).toHaveLength(2);
  });

  it('5) el conflicto de llave (mismo subtipo, mismo contrato+sitio+consecutivo, equipos distintos) rechaza TODO el grupo, nunca elige una', () => {
    const a = fila({ descripcionEquipo: 'BRILLADORA' });
    const b = fila({ descripcionEquipo: 'PLATAFORMA RODANTE' });
    const { aceptadas, rechazadas } = resolverConflictosLlave([a, b]);
    expect(aceptadas).toHaveLength(0);
    expect(rechazadas).toHaveLength(2);
    expect(rechazadas[0].motivo).toContain('Conflicto de llave');
    expect(rechazadas[0].motivo).not.toContain('promedio');
  });

  it('3) ceros iniciales en códigos de subtipo se conservan (nunca se convierten a number)', () => {
    const a = fila({ subtipoActivo: '008' });
    const b = fila({ subtipoActivo: '8' }); // distinto código de texto — nunca colapsan por conversión numérica
    const { aceptadas } = resolverConflictosLlave([a, b]);
    expect(aceptadas).toHaveLength(2);
  });
});

describe('agruparVariacionesEntreContratos', () => {
  it('6) agrupa SOLO por empresaPrestadora+uen+grupo+tipo+subtipo — nunca incluye contrato/puntoEntrega en la agrupación', () => {
    const a = fila({ contrato: 'C1', puntoEntrega: 'P1', valorMesMantenimiento: 100000 });
    const b = fila({ contrato: 'C2', puntoEntrega: 'P2', valorMesMantenimiento: 200000 });
    const grupos = agruparVariacionesEntreContratos([a, b]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].filas).toHaveLength(2);
    expect(grupos[0].valoresDistintos.size).toBe(2);
  });

  it('no reporta un grupo cuando todos los contratos tienen el mismo valor', () => {
    const a = fila({ contrato: 'C1', valorMesMantenimiento: 100000 });
    const b = fila({ contrato: 'C2', valorMesMantenimiento: 100000 });
    expect(agruparVariacionesEntreContratos([a, b])).toHaveLength(0);
  });

  it('nunca fusiona, promedia ni elige un valor — conserva las filas originales completas', () => {
    const a = fila({ contrato: 'C1', valorMesMantenimiento: 100000 });
    const b = fila({ contrato: 'C2', valorMesMantenimiento: 300000 });
    const grupos = agruparVariacionesEntreContratos([a, b]);
    expect(grupos[0].filas.map(f => f.valorMesMantenimiento).sort()).toEqual([100000, 300000]);
  });

  it('la descripción libre (redacción distinta del mismo equipo) no impide detectar la variación — no se agrupa por descripción', () => {
    const a = fila({ contrato: 'C1', descripcionEquipo: 'AUTOSCRUBBER', valorMesMantenimiento: 100000 });
    const b = fila({ contrato: 'C2', descripcionEquipo: 'MAQUINA AUTOMATICA PARA LAVAR PISOS AUTOSCRUBER', valorMesMantenimiento: 200000 });
    expect(agruparVariacionesEntreContratos([a, b])).toHaveLength(1);
  });
});
