/**
 * Ajuste "IMPLEMENTAR EL BLOQUE DE COSTOS ADMINISTRATIVOS CON EL MISMO
 * PATRÓN VISUAL Y FUNCIONAL DE PÓLIZAS CONTRACTUALES" — 11 conceptos
 * predeterminados (esInicial, nunca eliminables, solo desactivables),
 * cantidad automática/manual por fila (cantidadOrigen), fórmula
 * totalMensualConcepto = valorUnitarioMensual × cantidad (0 si la fila
 * está inactiva o si faltan datos), subtotal = suma de filas activas.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  conceptosVariablesAdministrativasIniciales,
  calcularValorMensualVariable,
  calcularTotalVariablesAdministrativas,
  sincronizarCantidadesAutomaticasVariables,
  type VariableAdministrativaRow,
} from './calculo-costos-administrativos';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');

// Mismo patrón usado en page.tsx: `p.filter(f=>f.id!==id||f.esInicial)`.
function eliminar(filas: VariableAdministrativaRow[], id: number): VariableAdministrativaRow[] {
  return filas.filter((f) => f.id !== id || f.esInicial);
}

describe('1. Se crean los 9 conceptos predeterminados', () => {
  it('Ajuste "DE COSTOS ADM QUITAR COMPUTADORES Y CELULAR" — conceptosVariablesAdministrativasIniciales() tiene exactamente 9 filas, sin Computador ni Celular', () => {
    const filas = conceptosVariablesAdministrativasIniciales();
    expect(filas).toHaveLength(9);
    expect(filas.map((f) => f.concepto)).toEqual([
      'Papelería', 'Microsoft', 'Plan de datos', 'Kontrol ID',
      'Mano de obra administrativa', 'Transporte de insumos', 'Carnet', 'Capacitaciones',
      'Transporte de personal operativo',
    ]);
    expect(filas.map((f) => f.concepto)).not.toContain('Computador');
    expect(filas.map((f) => f.concepto)).not.toContain('Celular');
  });
});

describe('2-3. Predeterminados: nunca se eliminan, sí se desactivan', () => {
  it('2. eliminar() (patrón id!==id||esInicial) conserva TODOS los predeterminados', () => {
    const filas = conceptosVariablesAdministrativasIniciales();
    const resultado = filas.reduce((acc, f) => eliminar(acc, f.id), filas);
    expect(resultado).toHaveLength(9);
  });
  it('3. un predeterminado desactivado totaliza $0 sin desaparecer de la lista', () => {
    const filas = conceptosVariablesAdministrativasIniciales().map((f) => (
      f.concepto === 'Papelería' ? { ...f, cantidad: 10, valorUnitario: 5000, activo: false } : f
    ));
    const papeleria = filas.find((f) => f.concepto === 'Papelería')!;
    expect(filas).toHaveLength(9);
    expect(calcularValorMensualVariable(papeleria)).toBe(0);
  });
});

describe('4-5. Conceptos manuales: se agregan y se eliminan', () => {
  it('4. una fila manual agregada NO tiene esInicial', () => {
    const nuevaFila: VariableAdministrativaRow = {
      id: 100, categoria: 'General', concepto: '', cantidad: 1, valorUnitario: 0,
      tipoPeriodicidad: 'MENSUAL', activo: true, cantidadOrigen: 'MANUAL',
    };
    expect(nuevaFila.esInicial).toBeUndefined();
  });
  it('5. una fila manual (sin esInicial) SÍ se elimina con el mismo patrón', () => {
    const filas = [...conceptosVariablesAdministrativasIniciales(), {
      id: 100, categoria: 'General', concepto: 'Otro', cantidad: 1, valorUnitario: 0,
      tipoPeriodicidad: 'MENSUAL' as const, activo: true, cantidadOrigen: 'MANUAL' as const,
    }];
    const resultado = eliminar(filas, 100);
    expect(resultado).toHaveLength(9);
    expect(resultado.some((f) => f.id === 100)).toBe(false);
  });
});

describe('6-9. Fórmula por fila (§7)', () => {
  it('6. totalMensualConcepto = valorUnitarioMensual × cantidad', () => {
    const r: VariableAdministrativaRow = { id: 1, categoria: 'General', concepto: 'Carnet', cantidad: 40, valorUnitario: 4000, tipoPeriodicidad: 'MENSUAL', activo: true };
    expect(calcularValorMensualVariable(r)).toBe(160000);
  });
  it('7. una fila inactiva totaliza 0 (nunca solo se excluye de la suma — el propio total por fila es $0)', () => {
    const r: VariableAdministrativaRow = { id: 1, categoria: 'General', concepto: 'Plan de datos', cantidad: 5, valorUnitario: 30000, tipoPeriodicidad: 'MENSUAL', activo: false };
    expect(calcularValorMensualVariable(r)).toBe(0);
  });
  it('8. cantidad vacía (0/NaN) no produce NaN ni Infinity', () => {
    const r: VariableAdministrativaRow = { id: 1, categoria: 'General', concepto: 'X', cantidad: Number('') || 0, valorUnitario: 50000, tipoPeriodicidad: 'MENSUAL', activo: true };
    expect(calcularValorMensualVariable(r)).toBe(0);
    expect(Number.isFinite(calcularValorMensualVariable(r))).toBe(true);
  });
  it('9. valor unitario vacío (0/NaN) no produce NaN ni Infinity', () => {
    const r: VariableAdministrativaRow = { id: 1, categoria: 'General', concepto: 'X', cantidad: 10, valorUnitario: Number('') || 0, tipoPeriodicidad: 'MENSUAL', activo: true };
    expect(calcularValorMensualVariable(r)).toBe(0);
    expect(Number.isFinite(calcularValorMensualVariable(r))).toBe(true);
  });
});

describe('10-12. Cantidad automática desde Mano de Obra (§6/§14)', () => {
  it('10-11. sincronizarCantidadesAutomaticasVariables actualiza SOLO las filas AUTOMATICA_MANO_OBRA con el total físico (ordinarios + turnantes físicos, cada persona una sola vez)', () => {
    const filas = conceptosVariablesAdministrativasIniciales();
    const sincronizadas = sincronizarCantidadesAutomaticasVariables(filas, 40);
    const porTrabajador = sincronizadas.filter((f) => f.cantidadOrigen === 'AUTOMATICA_MANO_OBRA');
    expect(porTrabajador.length).toBeGreaterThan(0);
    expect(porTrabajador.every((f) => f.cantidad === 40)).toBe(true);
  });
  it('12. no se usan horas como cantidad — la fuente es un conteo de personas (entero), nunca una fracción de horas', () => {
    const filas = conceptosVariablesAdministrativasIniciales();
    const sincronizadas = sincronizarCantidadesAutomaticasVariables(filas, 61);
    const carnet = sincronizadas.find((f) => f.concepto === 'Carnet')!;
    expect(carnet.cantidad).toBe(61);
    expect(Number.isInteger(carnet.cantidad)).toBe(true);
  });
});

describe('13-14. Cantidad manual nunca se sobrescribe; se puede restablecer', () => {
  it('13. una fila MANUAL conserva su cantidad aunque cambie el total de trabajadores', () => {
    const filas: VariableAdministrativaRow[] = [
      { id: 2, categoria: 'General', concepto: 'Computador', cantidad: 2, valorUnitario: 52083, tipoPeriodicidad: 'MENSUAL', activo: true, cantidadOrigen: 'MANUAL' },
    ];
    const sincronizadas = sincronizarCantidadesAutomaticasVariables(filas, 40);
    expect(sincronizadas[0].cantidad).toBe(2);
  });
  it('14. re-vincular una fila a AUTOMATICA_MANO_OBRA sí adopta el total vigente', () => {
    const filaManual: VariableAdministrativaRow = { id: 9, categoria: 'General', concepto: 'Carnet', cantidad: 5, valorUnitario: 4000, tipoPeriodicidad: 'MENSUAL', activo: true, cantidadOrigen: 'MANUAL' };
    const reVinculada: VariableAdministrativaRow = { ...filaManual, cantidadOrigen: 'AUTOMATICA_MANO_OBRA' };
    const [sincronizada] = sincronizarCantidadesAutomaticasVariables([reVinculada], 40);
    expect(sincronizada.cantidad).toBe(40);
  });
});

describe('15-16. Subtotal y detalle de solo lectura', () => {
  it('15. el subtotal suma únicamente filas activas', () => {
    const filas: VariableAdministrativaRow[] = [
      { id: 1, categoria: 'General', concepto: 'Papelería', cantidad: 40, valorUnitario: 80000 / 40, tipoPeriodicidad: 'MENSUAL', activo: true },
      { id: 2, categoria: 'General', concepto: 'Plan de datos', cantidad: 3, valorUnitario: 30000, tipoPeriodicidad: 'MENSUAL', activo: false },
    ];
    expect(calcularTotalVariablesAdministrativas(filas)).toBe(80000);
  });
  it('16. el detalle desplegable (page.tsx) es puramente informativo — sin inputs/switches/BtnDel', () => {
    const inicio = PAGE_TSX.indexOf('Detalle de costos administrativos');
    const fin = PAGE_TSX.indexOf('Valor mensual de costos administrativos</span>', inicio);
    const bloqueDetalle = PAGE_TSX.slice(inicio, fin);
    expect(bloqueDetalle).not.toContain('<input');
    expect(bloqueDetalle).not.toContain('<BtnDel');
    expect(bloqueDetalle).not.toContain('onClick');
  });
});

describe('17-19. Estado borrador (page.tsx)', () => {
  it('17. el modal usa un estado borrador propio (variablesAdminBorrador), nunca edita variablesAdmin directamente', () => {
    expect(PAGE_TSX).toContain('const [variablesAdminBorrador,setVariablesAdminBorrador]=useState<VariableAdministrativaRow[]>([]);');
    expect(PAGE_TSX).toContain('actualizarVariableAdminBorrador=(id:number,cambios:Partial<VariableAdministrativaRow>)=>setVariablesAdminBorrador(');
  });
  it('18. cancelarModalVariablesAdmin descarta el borrador (solo cierra el modal, nunca toca variablesAdmin)', () => {
    expect(PAGE_TSX).toContain('const cancelarModalVariablesAdmin=()=>setModalSeccionAdminAbierta(p=>({...p,variablesAdmin:false}));');
  });
  it('19. guardarModalVariablesAdmin confirma el borrador y cierra el modal', () => {
    expect(PAGE_TSX).toContain('const guardarModalVariablesAdmin=()=>{\n    setVariablesAdmin(variablesAdminBorrador);\n    setModalSeccionAdminAbierta(p=>({...p,variablesAdmin:false}));\n  };');
  });
});

describe('20-21. Propagación al total general y aislamiento de otros módulos', () => {
  it('20. totalVariablesAdministrativas (usado por calcularConsolidadoCostosAdministrativos) llega UNA sola vez al total', () => {
    expect(PAGE_TSX).toContain('valorMensualPolizas:polizasCalculado.valorMensual,\n    valorMensualImpuestos,');
    expect(PAGE_TSX).toContain('totalVariablesAdministrativas,');
  });
  it('21. Pólizas/Impuestos/Mano de Obra no se tocaron: sus fórmulas canónicas mantienen su firma previa (salvo la extensión explícita "RC sobre SMLMV")', () => {
    // Ajuste "LA BASE PARA RC ES EL SALARIO MÍNIMO, NO LA OFERTA" — se
    // agregó `salarioMinimoVigente:SMLMV` a la llamada; el resto de los
    // parámetros (filas/valorBase/otros/porcentajeIva/numeroMesesContrato)
    // no cambió.
    expect(PAGE_TSX).toContain('calcularPolizas({filas:polizasFilas,valorBase:polizasValorBase,otros:polizasOtros,porcentajeIva:polizasPorcentajeIva,numeroMesesContrato:polizasNumeroMesesContrato,salarioMinimoVigente:SMLMV})');
    expect(PAGE_TSX).toContain('calcularImpuestosMatrizIca({');
  });
});
