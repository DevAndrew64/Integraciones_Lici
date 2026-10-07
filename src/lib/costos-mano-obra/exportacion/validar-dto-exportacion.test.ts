import { describe, expect, it } from 'vitest';
import { validarDtoExportacion, sanearTextoExcel } from './validar-dto-exportacion';
import type { ExportacionManoObraDto, FichaManoObraExportDto, DetalleUnitarioExportDto } from './tipos-exportacion';

function detalle(overrides: Partial<DetalleUnitarioExportDto> = {}): DetalleUnitarioExportDto {
  return {
    salarioBasico: 1750905, bonoPrestacional: 0,
    recargoNocturno: 50000, horaExtraDiurna: 20000, horaExtraNocturna: 15000, dominicalesFestivos: 300000,
    horaExtraFestiva: 10000, horaExtraFestivaNocturna: 5000, recargoNocturnoFestivo: 8000, totalRecargos: 408000,
    auxilioTransporte: 249095, subtotalSalarial: 2408000,
    cesantias: 100000, prima: 100000, vacaciones: 60000, interesesCesantias: 12000, totalPrestaciones: 272000,
    salud: 0, pension: 150000, arl: 30000, totalSeguridadSocial: 180000,
    cajaCompensacion: 80000, sena: 0, icbf: 0, totalParafiscales: 80000,
    dotacion: 40000, epp: 30000, examenes: 5000, cursos: 3000, vacunas: 2000, totalOtrosCostos: 80000,
    bonosNoPrestacionales: 15000, costoLaboralUnitario: 3035000,
    porcentajeCesantias: 0.0833, porcentajePrima: 0.0833, porcentajeVacaciones: 0.05, porcentajeInteresesCesantias: 0.01,
    porcentajeSalud: 0, porcentajePension: 0.12, porcentajeArl: 0.00522,
    porcentajeCaja: 0.04, porcentajeSena: 0, porcentajeIcbf: 0,
    horasRecargoNocturno: 10, horasExtraDiurna: 4, horasExtraNocturna: 3,
    horasDominicalesFestivos: 8, horasExtraFestiva: 1.5, horasExtraFestivaNocturna: 2, horasRecargoNocturnoFestivo: 1,
    esMetodologiaSemanal: 0, horasSemanalesExtraDiurna: 0, horasSemanalesExtraNocturna: 0,
    ...overrides,
  };
}

function ficha(overrides: Partial<FichaManoObraExportDto> = {}): FichaManoObraExportDto {
  return {
    fichaId: 'f1', tipo: 'CARGO', orden: 0,
    cargo: 'ASEADOR', horario: 'Lunes a Domingo · 06:00-14:00',
    cantidadTrabajadores: 4, horasSemanales: 56,
    detalleUnitario: detalle(),
    totalCargo: 3035000 * 4,
    ...overrides,
  };
}

function dto(overrides: Partial<ExportacionManoObraDto> = {}): ExportacionManoObraDto {
  return {
    estructuraCostoId: 1, procesoId: 1, numeroProceso: 'SED-LP-2026-0091',
    ultimaActualizacionManoObra: '2026-08-06T12:00:00.000Z',
    fichas: [ficha()],
    ...overrides,
  };
}

describe('validarDtoExportacion — DTO válido', () => {
  it('un DTO correctamente reconciliado pasa la validación', () => {
    const r = validarDtoExportacion(dto());
    expect(r.ok).toBe(true);
    expect(r.errores).toEqual([]);
  });
});

describe('§5-B — tipos y límites', () => {
  it('6) valores NaN son rechazados', () => {
    const r = validarDtoExportacion(dto({ fichas: [ficha({ detalleUnitario: detalle({ salarioBasico: NaN }) })] }));
    expect(r.ok).toBe(false);
    expect(r.errores.some(e => e.campo === 'salarioBasico')).toBe(true);
  });
  it('6) valores Infinity son rechazados', () => {
    const r = validarDtoExportacion(dto({ fichas: [ficha({ detalleUnitario: detalle({ salarioBasico: Infinity }) })] }));
    expect(r.ok).toBe(false);
  });
  it('cantidades negativas son rechazadas', () => {
    const r = validarDtoExportacion(dto({ fichas: [ficha({ detalleUnitario: detalle({ auxilioTransporte: -1 }) })] }));
    expect(r.ok).toBe(false);
  });
  it('cantidadTrabajadores no entero es rechazada', () => {
    const r = validarDtoExportacion(dto({ fichas: [ficha({ cantidadTrabajadores: 2.5 })] }));
    expect(r.ok).toBe(false);
    expect(r.errores.some(e => e.campo === 'cantidadTrabajadores')).toBe(true);
  });
  it('un DTO sin fichas es rechazado', () => {
    const r = validarDtoExportacion(dto({ fichas: [] }));
    expect(r.ok).toBe(false);
  });
  it('fichaId duplicado es rechazado', () => {
    const r = validarDtoExportacion(dto({ fichas: [ficha({ fichaId: 'x' }), ficha({ fichaId: 'x' })] }));
    expect(r.ok).toBe(false);
    expect(r.errores.some(e => e.campo === 'fichaId')).toBe(true);
  });
});

describe('§5-C — reconciliaciones aritméticas (7-14 del pliego)', () => {
  it('7) totalRecargos debe reconciliar con la suma de sus 7 conceptos', () => {
    const r = validarDtoExportacion(dto({ fichas: [ficha({ detalleUnitario: detalle({ totalRecargos: 999999 }) })] }));
    expect(r.ok).toBe(false);
    expect(r.errores.some(e => e.campo === 'totalRecargos')).toBe(true);
  });
  it('8) subtotalSalarial debe reconciliar', () => {
    const r = validarDtoExportacion(dto({ fichas: [ficha({ detalleUnitario: detalle({ subtotalSalarial: 1 }) })] }));
    expect(r.ok).toBe(false);
    expect(r.errores.some(e => e.campo === 'subtotalSalarial')).toBe(true);
  });
  it('9) totalPrestaciones debe reconciliar', () => {
    const r = validarDtoExportacion(dto({ fichas: [ficha({ detalleUnitario: detalle({ totalPrestaciones: 1 }) })] }));
    expect(r.ok).toBe(false);
  });
  it('10) totalSeguridadSocial debe reconciliar', () => {
    const r = validarDtoExportacion(dto({ fichas: [ficha({ detalleUnitario: detalle({ totalSeguridadSocial: 1 }) })] }));
    expect(r.ok).toBe(false);
  });
  it('11) totalParafiscales debe reconciliar', () => {
    const r = validarDtoExportacion(dto({ fichas: [ficha({ detalleUnitario: detalle({ totalParafiscales: 1 }) })] }));
    expect(r.ok).toBe(false);
  });
  it('12) totalOtrosCostos debe reconciliar', () => {
    const r = validarDtoExportacion(dto({ fichas: [ficha({ detalleUnitario: detalle({ totalOtrosCostos: 1 }) })] }));
    expect(r.ok).toBe(false);
  });
  it('13) costoLaboralUnitario debe reconciliar', () => {
    const r = validarDtoExportacion(dto({ fichas: [ficha({ detalleUnitario: detalle({ costoLaboralUnitario: 1 }) })] }));
    expect(r.ok).toBe(false);
  });
  it('14) totalCargo debe reconciliar (costoLaboralUnitario × cantidadTrabajadores)', () => {
    const r = validarDtoExportacion(dto({ fichas: [ficha({ totalCargo: 1 })] }));
    expect(r.ok).toBe(false);
    expect(r.errores.some(e => e.campo === 'totalCargo')).toBe(true);
  });
  it('una tolerancia de redondeo de hasta 1 peso no se rechaza', () => {
    const r = validarDtoExportacion(dto({ fichas: [ficha({ totalCargo: 3035000 * 4 + 1 })] }));
    expect(r.ok).toBe(true);
  });
});

describe('§5-D — turnantes proporcionales', () => {
  it('15) totalCargo = costoLaboralUnitario(referencia completa 42h) × cantidadTrabajadores × factorNumerador/factorDenominador — factor aplicado SOLO al final', () => {
    const d = detalle({ salarioBasico: 0, bonoPrestacional: 0, recargoNocturno: 2846255, horaExtraDiurna: 0, horaExtraNocturna: 0, dominicalesFestivos: 0, horaExtraFestiva: 0, horaExtraFestivaNocturna: 0, recargoNocturnoFestivo: 0, totalRecargos: 2846255, auxilioTransporte: 0, subtotalSalarial: 2846255, cesantias: 0, prima: 0, vacaciones: 0, interesesCesantias: 0, totalPrestaciones: 0, salud: 0, pension: 0, arl: 0, totalSeguridadSocial: 0, cajaCompensacion: 0, sena: 0, icbf: 0, totalParafiscales: 0, dotacion: 0, epp: 0, examenes: 0, cursos: 0, vacunas: 0, totalOtrosCostos: 0, bonosNoPrestacionales: 0, costoLaboralUnitario: 2846255 });
    const t = ficha({
      fichaId: 't1', tipo: 'TURNANTE', cargo: 'TURNANTE DE ASEADOR', cantidadTrabajadores: 1,
      detalleUnitario: d, totalCargo: Math.round(2846255 / 6),
      turnante: { coberturaHoras: 7, diasEquivalentes: 1, factorNumerador: 1, factorDenominador: 6, costoReferencia42Horas: 2846255, cantidadTurnantesFisicos: 1 },
    });
    const r = validarDtoExportacion(dto({ fichas: [t] }));
    expect(r.ok).toBe(true);
  });
  it('una ficha TURNANTE sin bloque turnante es rechazada', () => {
    const r = validarDtoExportacion(dto({ fichas: [ficha({ tipo: 'TURNANTE', turnante: undefined })] }));
    expect(r.ok).toBe(false);
    expect(r.errores.some(e => e.campo === 'turnante')).toBe(true);
  });
});

describe('Ajuste "DTO_INVALIDO EN MULTIFICHA" — ruta fichas[N].campo y fichas independientes', () => {
  it('el error de un campo trae ruta en formato fichas[N].campo', () => {
    const r = validarDtoExportacion(dto({ fichas: [ficha({ detalleUnitario: detalle({ salarioBasico: NaN }) })] }));
    expect(r.ok).toBe(false);
    expect(r.errores.some(e => e.ruta === 'fichas[0].detalleUnitario.salarioBasico')).toBe(true);
  });

  it('un fichaId duplicado reporta la ruta del índice en conflicto, no solo "DTO"', () => {
    const r = validarDtoExportacion(dto({ fichas: [ficha({ fichaId: 'x' }), ficha({ fichaId: 'x' })] }));
    expect(r.ok).toBe(false);
    const err = r.errores.find(e => e.campo === 'fichaId');
    expect(err?.ruta).toBe('fichas[1].fichaId');
    expect(err?.indice).toBe(1);
  });

  it('B) 2 fichas con datos totalmente distintos (cargo/horario/cantidad/costo) validan OK independientemente', () => {
    const f1 = ficha({ fichaId: 'ASEADOR|06-14', cargo: 'ASEADOR', horario: '06:00-14:00', cantidadTrabajadores: 4 });
    const f2 = ficha({
      fichaId: 'TODERO|42H', cargo: 'TODERO', horario: 'Servicio de 42 horas semanales', cantidadTrabajadores: 1,
      detalleUnitario: detalle({ salarioBasico: 1300000, recargoNocturno: 0, horaExtraDiurna: 0, horaExtraNocturna: 0, dominicalesFestivos: 0, horaExtraFestiva: 0, horaExtraFestivaNocturna: 0, recargoNocturnoFestivo: 0, totalRecargos: 0, subtotalSalarial: 1549095, cesantias: 20000, prima: 20000, vacaciones: 12000, interesesCesantias: 2000, totalPrestaciones: 54000, pension: 60000, arl: 6000, totalSeguridadSocial: 66000, cajaCompensacion: 20000, totalParafiscales: 20000, dotacion: 10000, epp: 8000, examenes: 2000, cursos: 1000, vacunas: 1000, totalOtrosCostos: 22000, bonosNoPrestacionales: 0, costoLaboralUnitario: 1549095 + 54000 + 66000 + 20000 + 22000 }),
      totalCargo: (1549095 + 54000 + 66000 + 20000 + 22000) * 1,
    });
    const r = validarDtoExportacion(dto({ fichas: [f1, f2] }));
    if (!r.ok) console.log(JSON.stringify(r.errores));
    expect(r.ok).toBe(true);
  });

  it('D) mismo cargo, horarios distintos (dos fichas ASEADOR con horario diferente) validan OK', () => {
    const f1 = ficha({ fichaId: 'ASEADOR|06-14', cargo: 'ASEADOR', horario: '06:00-14:00', cantidadTrabajadores: 4 });
    const f2 = ficha({ fichaId: 'ASEADOR|14-22', cargo: 'ASEADOR', horario: '14:00-22:00', cantidadTrabajadores: 4 });
    const r = validarDtoExportacion(dto({ fichas: [f1, f2] }));
    expect(r.ok).toBe(true);
  });

  it('un dato inválido en la ficha[2] no bloquea reportar también errores válidos en otras fichas, cada ficha se valida por separado', () => {
    const f0 = ficha({ fichaId: 'f0' });
    const f1 = ficha({ fichaId: 'f1' });
    const f2 = ficha({ fichaId: 'f2', detalleUnitario: detalle({ porcentajeArl: NaN }) });
    const r = validarDtoExportacion(dto({ fichas: [f0, f1, f2] }));
    expect(r.ok).toBe(false);
    expect(r.errores.some(e => e.ruta === 'fichas[2].detalleUnitario.porcentajeArl')).toBe(true);
    expect(r.errores.some(e => e.indice === 0)).toBe(false);
    expect(r.errores.some(e => e.indice === 1)).toBe(false);
  });
});

describe('§7 — sanitización contra inyección de fórmulas', () => {
  it('un texto que empieza por = se antepone con apóstrofe', () => {
    expect(sanearTextoExcel('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
  });
  it('un texto que empieza por + se antepone con apóstrofe', () => {
    expect(sanearTextoExcel('+1+1')).toBe("'+1+1");
  });
  it('un texto que empieza por - se antepone con apóstrofe', () => {
    expect(sanearTextoExcel('-1')).toBe("'-1");
  });
  it('un texto que empieza por @ se antepone con apóstrofe', () => {
    expect(sanearTextoExcel('@SUM')).toBe("'@SUM");
  });
  it('un texto normal (nombre de cargo) no se modifica', () => {
    expect(sanearTextoExcel('ASEADOR')).toBe('ASEADOR');
  });
});
