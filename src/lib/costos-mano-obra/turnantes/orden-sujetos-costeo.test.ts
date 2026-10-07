import { describe, expect, it } from 'vitest';
import { ordenarSujetosCosteoPorCargo } from './orden-sujetos-costeo';

describe('ordenarSujetosCosteoPorCargo — caso real ASEADOR (2 líneas) / SUPERVISOR / turnante de ASEADOR', () => {
  const lineasManoObra = [
    { id: 1, nombreCargo: 'ASEADOR' }, // diurno
    { id: 2, nombreCargo: 'SUPERVISOR' },
    { id: 3, nombreCargo: 'ASEADOR' }, // nocturno
  ];
  const turnantes = [
    { id: 4, idsLineasOrigen: [1, 3] }, // cubre ambas líneas de ASEADOR
  ];

  it('4/11) el turnante de ASEADOR pasa a ser el número 3 (después de ambas líneas ASEADOR, antes de SUPERVISOR)', () => {
    const r = ordenarSujetosCosteoPorCargo({ lineasManoObra, turnantes });
    expect(r.orden.map(o => o.id)).toEqual([1, 3, 4, 2]);
  });

  it('1) dos ASEADOR separados por un SUPERVISOR quedan juntos', () => {
    const r = ordenarSujetosCosteoPorCargo({ lineasManoObra, turnantes });
    const idxAseador1 = r.orden.findIndex(o => o.id === 1);
    const idxAseador3 = r.orden.findIndex(o => o.id === 3);
    expect(Math.abs(idxAseador1 - idxAseador3)).toBe(1);
  });

  it('2) se conserva el orden interno de creación de las líneas ASEADOR (diurno antes que nocturno)', () => {
    const r = ordenarSujetosCosteoPorCargo({ lineasManoObra, turnantes });
    const idxDiurno = r.orden.findIndex(o => o.id === 1);
    const idxNocturno = r.orden.findIndex(o => o.id === 3);
    expect(idxDiurno).toBeLessThan(idxNocturno);
  });

  it('3) el turnante de ASEADOR aparece después de TODAS las líneas ASEADOR', () => {
    const r = ordenarSujetosCosteoPorCargo({ lineasManoObra, turnantes });
    const idxTurnante = r.orden.findIndex(o => o.id === 4);
    const idxAseador1 = r.orden.findIndex(o => o.id === 1);
    const idxAseador3 = r.orden.findIndex(o => o.id === 3);
    expect(idxTurnante).toBeGreaterThan(idxAseador1);
    expect(idxTurnante).toBeGreaterThan(idxAseador3);
  });

  it('5) SUPERVISOR queda después de todo el bloque ASEADOR (líneas + turnante)', () => {
    const r = ordenarSujetosCosteoPorCargo({ lineasManoObra, turnantes });
    const idxSupervisor = r.orden.findIndex(o => o.id === 2);
    const idxTurnante = r.orden.findIndex(o => o.id === 4);
    expect(idxSupervisor).toBeGreaterThan(idxTurnante);
  });

  it('10) el orden no modifica los arreglos originales', () => {
    const copiaLineas = JSON.parse(JSON.stringify(lineasManoObra));
    const copiaTurnantes = JSON.parse(JSON.stringify(turnantes));
    ordenarSujetosCosteoPorCargo({ lineasManoObra, turnantes });
    expect(lineasManoObra).toEqual(copiaLineas);
    expect(turnantes).toEqual(copiaTurnantes);
  });

  it('12) el resultado es estable aunque se recalcule varias veces (nuevo render)', () => {
    const r1 = ordenarSujetosCosteoPorCargo({ lineasManoObra, turnantes });
    const r2 = ordenarSujetosCosteoPorCargo({ lineasManoObra, turnantes });
    expect(r1.orden).toEqual(r2.orden);
  });

  it('11) la numeración visual (índice+1 tras el orden) nunca requiere modificar los ids persistentes', () => {
    const r = ordenarSujetosCosteoPorCargo({ lineasManoObra, turnantes });
    const numeracionVisual = r.orden.map((o, i) => ({ numero: i + 1, id: o.id }));
    expect(numeracionVisual).toEqual([{ numero: 1, id: 1 }, { numero: 2, id: 3 }, { numero: 3, id: 4 }, { numero: 4, id: 2 }]);
    // los ids reales (1,2,3,4) permanecen intactos, solo cambia su posición
    expect(new Set(r.orden.map(o => o.id))).toEqual(new Set([1, 2, 3, 4]));
  });
});

describe('ordenarSujetosCosteoPorCargo — otras propiedades', () => {
  it('6) dos cargos con el mismo nombre pero ids diferentes no se fusionan (siguen siendo 2 entradas independientes)', () => {
    const r = ordenarSujetosCosteoPorCargo({
      lineasManoObra: [{ id: 1, nombreCargo: 'ASEADOR' }, { id: 2, nombreCargo: 'ASEADOR' }],
      turnantes: [],
    });
    expect(r.orden).toHaveLength(2);
    expect(r.orden.map(o => o.id)).toEqual([1, 2]);
  });

  it('8) un turnante de SUPERVISOR (idsLineasOrigen apunta a la línea de SUPERVISOR) queda después de SUPERVISOR', () => {
    const r = ordenarSujetosCosteoPorCargo({
      lineasManoObra: [{ id: 1, nombreCargo: 'ASEADOR' }, { id: 2, nombreCargo: 'SUPERVISOR' }],
      turnantes: [{ id: 3, idsLineasOrigen: [2] }],
    });
    expect(r.orden.map(o => o.id)).toEqual([1, 2, 3]);
  });

  it('9) un turnante huérfano (sin idsLineasOrigen o sin intersección) no se pierde y queda marcado para revisión al final', () => {
    const r = ordenarSujetosCosteoPorCargo({
      lineasManoObra: [{ id: 1, nombreCargo: 'ASEADOR' }],
      turnantes: [{ id: 2, idsLineasOrigen: [] }, { id: 3, idsLineasOrigen: [999] }],
    });
    expect(r.orden.map(o => o.id)).toEqual([1, 2, 3]);
    expect(r.huerfanoIds.sort()).toEqual([2, 3]);
  });

  it('preserva el orden de primera aparición de las familias (no alfabético)', () => {
    const r = ordenarSujetosCosteoPorCargo({
      lineasManoObra: [{ id: 1, nombreCargo: 'ZAPATERO' }, { id: 2, nombreCargo: 'ASEADOR' }],
      turnantes: [],
    });
    expect(r.orden.map(o => o.id)).toEqual([1, 2]);
  });

  it('un turnante que cubre varias familias se ubica una sola vez, tras la primera familia en orden de aparición', () => {
    const r = ordenarSujetosCosteoPorCargo({
      lineasManoObra: [{ id: 1, nombreCargo: 'ASEADOR' }, { id: 2, nombreCargo: 'SUPERVISOR' }],
      turnantes: [{ id: 3, idsLineasOrigen: [1, 2] }],
    });
    expect(r.orden.map(o => o.id)).toEqual([1, 3, 2]);
    expect(r.orden.filter(o => o.id === 3)).toHaveLength(1);
  });

  it('sin líneas ni turnantes devuelve un orden vacío', () => {
    const r = ordenarSujetosCosteoPorCargo({ lineasManoObra: [], turnantes: [] });
    expect(r.orden).toEqual([]);
    expect(r.huerfanoIds).toEqual([]);
  });
});
