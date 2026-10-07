import { describe, it, expect } from 'vitest';
import {
  normalizarMunicipio,
  buscarTarifaIca,
  municipiosPorEmpresa,
  formatearPorcentajeDecimal,
  calcularImpuestosMatrizIca,
  calcularValorMensualImpuestos,
  filasImpuestosIniciales,
  migrarFilasImpuestosAMatrizIca,
  type TarifaIcaMunicipio,
  type ImpuestoRow,
} from './calculo-costos-administrativos';
import matrizIcaData from '@/data/costos-estructura/matriz-ica-por-empresa-municipio.json';

const registros = (matrizIcaData as { registros: TarifaIcaMunicipio[] }).registros;

function cercaDe(actual: number, esperado: number, tolerancia: number) {
  expect(Math.abs(actual - esperado)).toBeLessThanOrEqual(tolerancia);
}

describe('Matriz ICA por empresa y municipio — importación y conteos (§16 A-D)', () => {
  it('1. ASEOCOLBA carga con 85 municipios', () => {
    expect(municipiosPorEmpresa(registros, 'ASEOCOLBA')).toHaveLength(85);
  });

  it('2. TEMPOCOLBA carga con 26 municipios', () => {
    expect(municipiosPorEmpresa(registros, 'TEMPOCOLBA')).toHaveLength(26);
  });

  it('3. TRANSCOLBA carga con 5 municipios', () => {
    expect(municipiosPorEmpresa(registros, 'TRANSCOLBA')).toHaveLength(5);
  });

  it('4. VIGICOLBA carga con 9 municipios', () => {
    expect(municipiosPorEmpresa(registros, 'VIGICOLBA')).toHaveLength(9);
  });

  it('5. municipiosPorEmpresa nunca mezcla registros de otra empresa', () => {
    const soloVigicolba = municipiosPorEmpresa(registros, 'VIGICOLBA');
    expect(soloVigicolba.every((r) => r.empresa === 'VIGICOLBA')).toBe(true);
  });
});

describe('Matriz ICA — tarifas por empresa+municipio y casos límite (§16 E-J)', () => {
  it('6. Bogotá/ASEOCOLBA tiene tarifa ICA 0,966% (0.00966)', () => {
    const r = buscarTarifaIca(registros, 'ASEOCOLBA', 'BOGOTA (DISTRITO CAPITAL)');
    expect(r?.tarifaIca).toBeCloseTo(0.00966, 6);
  });

  it('7. Bogotá/VIGICOLBA tiene tarifa ICA 1,38% (0.0138) — DISTINTA de ASEOCOLBA para el mismo municipio', () => {
    const rAseo = buscarTarifaIca(registros, 'ASEOCOLBA', 'BOGOTA');
    const rVigi = buscarTarifaIca(registros, 'VIGICOLBA', 'BOGOTA');
    expect(rVigi?.tarifaIca).toBeCloseTo(0.0138, 6);
    expect(rVigi?.tarifaIca).not.toBeCloseTo(rAseo?.tarifaIca ?? -1, 6);
  });

  it('8. buscarTarifaIca encuentra por el nombre truncado del Excel (TEMPOCOLBA Barranquilla) igual que el nombre completo (ASEOCOLBA)', () => {
    const truncado = buscarTarifaIca(registros, 'TEMPOCOLBA', 'BARRANQUILLA  (DEIP) (Atlantic');
    const completo = buscarTarifaIca(registros, 'ASEOCOLBA', 'BARRANQUILLA  (DEIP) (Atlantico)');
    expect(truncado).toBeDefined();
    expect(completo).toBeDefined();
    expect(truncado?.municipioNormalizado).toBe(completo?.municipioNormalizado);
  });

  it('9. Los códigos DANE se preservan como string con ceros a la izquierda (ej. "08001")', () => {
    const r = buscarTarifaIca(registros, 'ASEOCOLBA', 'BARRANQUILLA (DEIP) (Atlantico)');
    expect(typeof r?.codigoDane).toBe('string');
    expect(r?.codigoDane).toBe('08001');
  });

  it('10. Un registro sin código DANE sigue siendo consultable por empresa+municipio', () => {
    const r = buscarTarifaIca(registros, 'ASEOCOLBA', 'IPIALES');
    expect(r).toBeDefined();
    expect(r?.codigoDane).toBeUndefined();
  });

  it('11. TEMPOCOLBA-NEIVA queda marcado con requiereValidacion (tarifa 4% muy por encima del resto)', () => {
    const r = buscarTarifaIca(registros, 'TEMPOCOLBA', 'NEIVA (Huila)');
    expect(r?.tarifaIca).toBeCloseTo(0.04, 6);
    expect(r?.requiereValidacion).toBe(true);
  });

  it('12. ASEOCOLBA-BARRANQUILLA queda marcado con requiereValidacion y conserva la observación de tarifas por actividad', () => {
    const r = buscarTarifaIca(registros, 'ASEOCOLBA', 'BARRANQUILLA (DEIP) (Atlantico)');
    expect(r?.requiereValidacion).toBe(true);
    expect(r?.observacion).toMatch(/Aseo/i);
  });
});

describe('Matriz ICA — formato humano de porcentajes (§16 formato)', () => {
  it('13. 0,00966 se muestra como "0,966 %" (nunca "0,00966 %")', () => {
    expect(formatearPorcentajeDecimal(0.00966)).toBe('0,966 %');
  });

  it('14. 0,15 se muestra como "15 %"', () => {
    expect(formatearPorcentajeDecimal(0.15)).toBe('15 %');
  });

  it('15. 0,03 se muestra como "3 %"', () => {
    expect(formatearPorcentajeDecimal(0.03)).toBe('3 %');
  });
});

describe('normalizarMunicipio — clave de búsqueda estable entre bloques del Excel', () => {
  it('16. Quita tildes y descarta el departamento entre paréntesis', () => {
    expect(normalizarMunicipio('BOGOTA (DISTRITO CAPITAL)')).toBe('BOGOTA');
    expect(normalizarMunicipio('MONTERIA (Córdoba)')).toBe('MONTERIA');
  });

  it('17. Unifica el nombre truncado real del Excel con el nombre completo', () => {
    expect(normalizarMunicipio('BARRANQUILLA  (DEIP) (Atlantic')).toBe(
      normalizarMunicipio('BARRANQUILLA  (DEIP) (Atlantico)'),
    );
  });
});

describe('calcularImpuestosMatrizIca — fórmula canónica (§16 fórmulas)', () => {
  it('18. baseGravable = valorContractual × porcentajeBaseGravable / 100', () => {
    const r = calcularImpuestosMatrizIca({
      valorContractual: 1000000, porcentajeBaseGravable: 10,
      tarifaIca: 0, tarifaAvisos: 0, tarifaBomberil: 0, aplicaAvisos: false,
    });
    expect(r.baseGravable).toBe(100000);
  });

  it('19. valorIca = baseGravable × tarifaIca', () => {
    const r = calcularImpuestosMatrizIca({
      valorContractual: 1000000, porcentajeBaseGravable: 10,
      tarifaIca: 0.01, tarifaAvisos: 0, tarifaBomberil: 0, aplicaAvisos: false,
    });
    expect(r.valorIca).toBe(1000);
  });

  it('20. valorAvisos se calcula SOBRE valorIca (nunca sobre baseGravable) cuando aplicaAvisos=true', () => {
    const r = calcularImpuestosMatrizIca({
      valorContractual: 1000000, porcentajeBaseGravable: 10,
      tarifaIca: 0.01, tarifaAvisos: 0.15, tarifaBomberil: 0, aplicaAvisos: true,
    });
    // valorIca=1000 → valorAvisos=150 (15% de 1000); si fuera sobre baseGravable (100000) sería 15000.
    expect(r.valorAvisos).toBe(150);
  });

  it('21. valorAvisos es 0 si aplicaAvisos=false, aunque la matriz tenga tarifaAvisos>0', () => {
    const r = calcularImpuestosMatrizIca({
      valorContractual: 1000000, porcentajeBaseGravable: 10,
      tarifaIca: 0.01, tarifaAvisos: 0.15, tarifaBomberil: 0, aplicaAvisos: false,
    });
    expect(r.valorAvisos).toBe(0);
  });

  it('22. valorBomberil se calcula sobre valorIca (mismo patrón que Avisos)', () => {
    const r = calcularImpuestosMatrizIca({
      valorContractual: 1000000, porcentajeBaseGravable: 10,
      tarifaIca: 0.01, tarifaAvisos: 0, tarifaBomberil: 0.05, aplicaAvisos: false,
    });
    expect(r.valorBomberil).toBe(50);
  });
});

describe('Ejemplo real confirmado — Bogotá/ASEOCOLBA (§16 ejemplo)', () => {
  it('23. Oferta $3.697.772.552 × 10% base gravable × tarifas de Bogotá/ASEOCOLBA ≈ $4.107.856 de total', () => {
    const registro = buscarTarifaIca(registros, 'ASEOCOLBA', 'BOGOTA (DISTRITO CAPITAL)')!;
    const r = calcularImpuestosMatrizIca({
      valorContractual: 3697772552,
      porcentajeBaseGravable: 10,
      tarifaIca: registro.tarifaIca,
      tarifaAvisos: registro.tarifaAvisos,
      tarifaBomberil: registro.tarifaBomberil,
      aplicaAvisos: true,
    });
    cercaDe(r.baseGravable, 369777255.2, 1);
    cercaDe(r.valorIca, 3572048, 10);
    cercaDe(r.valorAvisos, 535807, 10);
    expect(r.valorBomberil).toBe(0);
    cercaDe(r.totalMatrizIca, 4107856, 20);
  });

  it('24. La duración del contrato (nunca la periodicidad) mensualiza el total: ÷36 meses ≈ $114.107/mes', () => {
    const registro = buscarTarifaIca(registros, 'ASEOCOLBA', 'BOGOTA (DISTRITO CAPITAL)')!;
    const r = calcularImpuestosMatrizIca({
      valorContractual: 3697772552, porcentajeBaseGravable: 10,
      tarifaIca: registro.tarifaIca, tarifaAvisos: registro.tarifaAvisos, tarifaBomberil: registro.tarifaBomberil,
      aplicaAvisos: true,
    });
    const mensual = calcularValorMensualImpuestos(r.totalMatrizIca, 36);
    cercaDe(mensual, 114107, 5);
  });

  it('25. La periodicidad (BIMESTRAL) NUNCA se usa para dividir — dividir por 2 daría un resultado distinto e incorrecto', () => {
    const registro = buscarTarifaIca(registros, 'ASEOCOLBA', 'BOGOTA (DISTRITO CAPITAL)')!;
    expect(registro.periodicidad).toBe('BIMESTRAL');
    const r = calcularImpuestosMatrizIca({
      valorContractual: 3697772552, porcentajeBaseGravable: 10,
      tarifaIca: registro.tarifaIca, tarifaAvisos: registro.tarifaAvisos, tarifaBomberil: registro.tarifaBomberil,
      aplicaAvisos: true,
    });
    const mensualPorDuracion = calcularValorMensualImpuestos(r.totalMatrizIca, 36);
    const divididoPorPeriodicidadIncorrecto = r.totalMatrizIca / 2;
    expect(mensualPorDuracion).not.toBeCloseTo(divididoPorPeriodicidadIncorrecto, 0);
  });

  it('26. Distintas duraciones de contrato producen distintos valores mensuales sobre el MISMO total (la periodicidad no interviene)', () => {
    const total = 4107856;
    const mensual12 = calcularValorMensualImpuestos(total, 12);
    const mensual36 = calcularValorMensualImpuestos(total, 36);
    expect(mensual12).toBeGreaterThan(mensual36);
    cercaDe(mensual12, total / 12, 1);
    cercaDe(mensual36, total / 36, 1);
  });
});

describe('Migración de filas manuales de Impuestos hacia la matriz ICA (§16 migración)', () => {
  it('27. filasImpuestosIniciales() ya NO incluye ICA/Avisos y tableros/Sobretasa bomberil/CREE como filas manuales (solo Estampillas)', () => {
    const filas = filasImpuestosIniciales();
    expect(filas.map((f) => f.concepto)).toEqual(['Estampillas']);
  });

  it('28. migrarFilasImpuestosAMatrizIca descarta las filas legadas (incluido CREE) por nombre EXACTO, pero conserva un concepto ya editado por el usuario', () => {
    const filasHistoricas: ImpuestoRow[] = [
      { id: 1, concepto: 'ICA', tipoCalculo: 'FIJO', valorFijo: 50000, activo: true },
      { id: 2, concepto: 'Avisos y tableros', tipoCalculo: 'FIJO', valorFijo: 8000, activo: true },
      { id: 3, concepto: 'Sobretasa bomberil', tipoCalculo: 'FIJO', valorFijo: 0, activo: true },
      { id: 4, concepto: 'CREE', tipoCalculo: 'FIJO', valorFijo: 0, activo: true },
      { id: 6, concepto: 'ICA Bogotá — ajuste manual histórico', tipoCalculo: 'FIJO', valorFijo: 12345, activo: true },
    ];
    const migradas = migrarFilasImpuestosAMatrizIca(filasHistoricas);
    expect(migradas.map((f) => f.concepto)).toEqual(['ICA Bogotá — ajuste manual histórico']);
  });
});
