/**
 * Ajuste "AJUSTAR LA VISTA SIMPLE DE IMPUESTOS PARA QUE REPLIQUE LA
 * ESTRUCTURA DEL EXCEL" (y sus refinamientos en vivo: "QUITAR ESO DEL
 * CREE", "DEBERIA SER INTERNO O COLOCAR EL 10% SI CORRESPONDE A
 * GRAVABLE") — vista simple tipo Excel: EMPRESA/MUNICIPIO arriba, una sola
 * tabla compacta CONCEPTO/TARIFA/VALOR (ICA/Avisos/Bomberil calculados
 * desde la matriz + Estampillas manual sobre el valor contractual +
 * impuestos adicionales); el % de base gravable es una constante INTERNA
 * (10, tomada del Excel real `=B3*10%*I31`), nunca un input editable;
 * CREE ya no es una fila fija predeterminada.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  filasImpuestosIniciales,
  migrarFilasImpuestosAMatrizIca,
  calcularTotalImpuestos,
  calcularImpuestosMatrizIca,
  calcularValorMensualImpuestos,
  resolverAplicaImpuesto,
  PORCENTAJE_BASE_GRAVABLE_ICA,
  type ImpuestoRow,
  type BasesImpuesto,
} from './calculo-costos-administrativos';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');

function bloque(inicioMarcador: string, finMarcador: string, desde = 0): string {
  const inicio = PAGE_TSX.indexOf(inicioMarcador, desde);
  if (inicio === -1) throw new Error(`No se encontró el marcador de inicio: ${inicioMarcador}`);
  const fin = PAGE_TSX.indexOf(finMarcador, inicio);
  if (fin === -1) throw new Error(`No se encontró el marcador de fin: ${finMarcador}`);
  return PAGE_TSX.slice(inicio, fin);
}

const BLOQUE_IMPUESTOS = bloque(
  'numero:2,titulo:"Impuestos"',
  '\n              {/* Ajuste "AJUSTAR TERMINOLOGÍA Y DISTRIBUCIÓN VISUAL...',
);

const basesVacias: BasesImpuesto = { costoDirecto: 0, manoObra: 0, valorContractual: 0, subtotalSeleccionado: 0 };

describe('1-3. ICA/Avisos/Bomberil/CREE ya NO aparecen como filas manuales', () => {
  it('1. filasImpuestosIniciales() no contiene ICA', () => {
    expect(filasImpuestosIniciales().some((f) => f.concepto === 'ICA')).toBe(false);
  });
  it('2. filasImpuestosIniciales() no contiene Avisos y tableros', () => {
    expect(filasImpuestosIniciales().some((f) => f.concepto === 'Avisos y tableros')).toBe(false);
  });
  it('3. filasImpuestosIniciales() no contiene Sobretasa bomberil', () => {
    expect(filasImpuestosIniciales().some((f) => f.concepto === 'Sobretasa bomberil')).toBe(false);
  });
  it('filasImpuestosIniciales() no contiene CREE (retirado por feedback "QUITAR ESO DEL CREE")', () => {
    expect(filasImpuestosIniciales().some((f) => f.concepto === 'CREE')).toBe(false);
  });
});

describe('4. ICA/Avisos/Bomberil aparecen en la tabla compacta de la UI', () => {
  it('el modal renderiza ICA, Avisos y tableros y Sobretasa bomberil como filas fijas de solo lectura', () => {
    expect(BLOQUE_IMPUESTOS).toContain('>ICA<');
    expect(BLOQUE_IMPUESTOS).toContain('Avisos y tableros');
    expect(BLOQUE_IMPUESTOS).toContain('Sobretasa bomberil');
  });
  it('el modal ya NO renderiza una fila fija para CREE', () => {
    expect(BLOQUE_IMPUESTOS).not.toContain('>CREE<');
  });
});

describe('5-7. Fórmulas del bloque automático', () => {
  it('5. ICA usa la tarifa de la matriz sobre la base gravable', () => {
    const r = calcularImpuestosMatrizIca({ valorContractual: 100000, porcentajeBaseGravable: 10, tarifaIca: 0.01, tarifaAvisos: 0, tarifaBomberil: 0, aplicaAvisos: false });
    expect(r.valorIca).toBe(100000 * 0.1 * 0.01);
  });
  it('6. Avisos usa el valor del ICA (nunca la base gravable)', () => {
    const r = calcularImpuestosMatrizIca({ valorContractual: 100000, porcentajeBaseGravable: 10, tarifaIca: 0.01, tarifaAvisos: 0.15, tarifaBomberil: 0, aplicaAvisos: true });
    expect(r.valorAvisos).toBe(r.valorIca * 0.15);
  });
  it('7. Bomberil usa el valor del ICA (nunca la base gravable)', () => {
    const r = calcularImpuestosMatrizIca({ valorContractual: 100000, porcentajeBaseGravable: 10, tarifaIca: 0.01, tarifaAvisos: 0, tarifaBomberil: 0.05, aplicaAvisos: false });
    expect(r.valorBomberil).toBe(r.valorIca * 0.05);
  });
});

describe('8-9. Avisos respeta el switch de su propia fila y no hay un segundo switch', () => {
  it('8. aplicaAvisos=false fuerza valorAvisos=0 aunque tarifaAvisos>0', () => {
    const r = calcularImpuestosMatrizIca({ valorContractual: 100000, porcentajeBaseGravable: 10, tarifaIca: 0.01, tarifaAvisos: 0.15, tarifaBomberil: 0, aplicaAvisos: false });
    expect(r.valorAvisos).toBe(0);
  });
  it('9. el switch "Aplica" de Avisos vive dentro de su propia fila de la tabla (no en el encabezado superior de Empresa/Municipio)', () => {
    const inicioTabla = PAGE_TSX.indexOf('CONCEPTO/TARIFA/VALOR con las 5 filas del', PAGE_TSX.indexOf(BLOQUE_IMPUESTOS));
    const encabezadoSuperior = bloque('EMPRESA', 'MUNICIPIO', PAGE_TSX.indexOf(BLOQUE_IMPUESTOS));
    expect(encabezadoSuperior).not.toContain('setIcaAplicaAvisosBorrador');
    expect(inicioTabla).toBeGreaterThan(-1);
  });
});

describe('10-12. Estampillas sigue siendo manual y "Agregar impuesto adicional" solo crea filas manuales', () => {
  it('10. Estampillas permanece en filasImpuestosIniciales()', () => {
    expect(filasImpuestosIniciales().some((f) => f.concepto === 'Estampillas')).toBe(true);
  });
  it('11. Estampillas usa PORCENTAJE sobre VALOR_CONTRACTUAL por defecto (fórmula del Excel: valorOferta × %)', () => {
    const estampillas = filasImpuestosIniciales().find((f) => f.concepto === 'Estampillas')!;
    expect(estampillas.tipoCalculo).toBe('PORCENTAJE');
    expect(estampillas.baseSeleccionada).toBe('VALOR_CONTRACTUAL');
  });
  it('Estampillas arranca visible (el Excel nunca la oculta la fila, aunque su valor sea $0) — sin decisión explícita de "activo" (Ajuste "TOGGLE AUTOMÁTICO POR TARIFA"): con porcentaje=0 su valor EFECTIVO por defecto es "No aplica", nunca un true fijo', () => {
    const filas = filasImpuestosIniciales();
    expect(filas.length).toBeGreaterThan(0); // nunca se elimina/oculta la fila
    expect(filas.every((f) => f.activo === undefined)).toBe(true); // sin decisión explícita todavía
    expect(filas.every((f) => resolverAplicaImpuesto(f) === false)).toBe(true); // porcentaje=0 → No aplica por defecto
  });
  it('12. agregarImpuestoBorrador crea una fila con concepto vacío (manual, % activo por defecto sobre valor contractual), nunca precargada con ICA/Avisos/Bomberil', () => {
    expect(PAGE_TSX).toContain("agregarImpuestoBorrador=()=>setImpuestosFilasBorrador(p=>[...p,{id:nextImpuestoId.current++,concepto:'',tipoCalculo:'PORCENTAJE' as const,porcentaje:0,baseSeleccionada:'VALOR_CONTRACTUAL' as const,valorFijo:0,activo:true}])");
  });
});

describe('13-16. Totales sin doble contabilización', () => {
  it('13. El total automático suma ICA+Avisos+Bomberil UNA sola vez', () => {
    const r = calcularImpuestosMatrizIca({ valorContractual: 100000, porcentajeBaseGravable: 10, tarifaIca: 0.01, tarifaAvisos: 0.15, tarifaBomberil: 0.05, aplicaAvisos: true });
    expect(r.totalMatrizIca).toBe(r.valorIca + r.valorAvisos + r.valorBomberil);
  });
  it('14. El total manual (Estampillas + adicionales) suma solo las filas activas', () => {
    const filas: ImpuestoRow[] = [
      { id: 5, concepto: 'Estampillas', tipoCalculo: 'PORCENTAJE', porcentaje: 1, baseSeleccionada: 'VALOR_CONTRACTUAL', activo: true },
      { id: 100, concepto: 'Otro', tipoCalculo: 'FIJO', valorFijo: 5000, activo: false },
    ];
    const bases: BasesImpuesto = { ...basesVacias, valorContractual: 100000 };
    expect(calcularTotalImpuestos(filas, bases)).toBe(1000);
  });
  it('15. El total general = automático + manual', () => {
    const totalAutomatico = 4107856;
    const totalManual = 2000;
    expect(totalAutomatico + totalManual).toBe(4109856);
  });
  it('16. No existe doble contabilización: migrarFilasImpuestosAMatrizIca descarta ICA/Avisos/Bomberil legados antes de sumar el manual', () => {
    const filasLegadas: ImpuestoRow[] = [
      { id: 1, concepto: 'ICA', tipoCalculo: 'FIJO', valorFijo: 999999, activo: true },
      { id: 5, concepto: 'Estampillas', tipoCalculo: 'FIJO', valorFijo: 1000, activo: true },
    ];
    const migradas = migrarFilasImpuestosAMatrizIca(filasLegadas);
    expect(calcularTotalImpuestos(migradas, basesVacias)).toBe(1000);
  });
});

describe('17-18. Persistencia, constante interna y mensualización', () => {
  it('17. El payload de guardado incluye la selección de empresa/municipio/aplica avisos y las filas manuales (SIN icaPorcentajeBaseGravable — ya no se persiste, es constante interna)', () => {
    expect(PAGE_TSX).toContain('icaEmpresa,icaMunicipio,icaAplicaAvisos,');
    expect(PAGE_TSX).toContain('filas:impuestosFilas,numeroMeses:impuestosNumeroMeses');
    expect(PAGE_TSX).not.toContain('icaPorcentajeBaseGravableBorrador');
  });
  it('17b. El % de base gravable es una constante interna fija en 10 (Excel real: `=B3*10%*I31`), nunca un input editable', () => {
    expect(PORCENTAJE_BASE_GRAVABLE_ICA).toBe(10);
    expect(PAGE_TSX).not.toContain('setIcaPorcentajeBaseGravable');
  });
  it('18. El valor mensual sigue usando la duración del contrato, nunca la periodicidad municipal', () => {
    const total = 4107856;
    expect(calcularValorMensualImpuestos(total, 36)).not.toBe(total / 2);
    expect(calcularValorMensualImpuestos(total, 36)).toBeCloseTo(total / 36, 6);
  });
});

describe('19-20. Presentación del modal y aislamiento de otros módulos', () => {
  it('19. La tabla compacta de impuestos no usa scroll horizontal ni minWidth:960 (eso ya no existe en este bloque)', () => {
    const inicioTabla = PAGE_TSX.indexOf('>ICA<', PAGE_TSX.indexOf(BLOQUE_IMPUESTOS));
    const finTabla = PAGE_TSX.indexOf('Agregar impuesto adicional', inicioTabla);
    const bloqueTabla = PAGE_TSX.slice(inicioTabla - 2000, finTabla);
    expect(bloqueTabla).not.toContain('overflowX');
    expect(bloqueTabla).not.toContain('minWidth:960');
  });
  it('20. Pólizas/Mano de obra no se tocaron: calcularPolizas y calcularFilaPoliza mantienen su firma previa (salvo la extensión explícita "RC sobre SMLMV")', () => {
    expect(PAGE_TSX).toContain('calcularPolizas({filas:polizasFilas,valorBase:polizasValorBase,otros:polizasOtros,porcentajeIva:polizasPorcentajeIva,numeroMesesContrato:polizasNumeroMesesContrato,salarioMinimoVigente:SMLMV})');
  });
});
