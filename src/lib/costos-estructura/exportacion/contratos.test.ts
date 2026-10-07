import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { camposFormularioContratos, elegirSolicitud, escribirHojaContratos, esAdjudicada, porcentajeAIU, type SolicitudContratos } from './contratos';
import type { TotalesPantallaDto } from './costos-pantalla';

const totales: TotalesPantallaDto = {
  manoObra: 1000, otrosCostosEnManoObra: 100, insumos: 200, maquinaria: 300, serviciosNoContinuos: 40, valorAgregado: 50, administrativos: 60, total: 1650,
};
const solicitud = (o: Partial<SolicitudContratos> = {}): SolicitudContratos => ({
  id: 1, codigoProceso: 'P-1', entidad: ' Cliente SAS ', objeto: 'Aseo', nitContacto: '900123456', direccionContacto: 'Calle 1', estadoSolicitud: 'Cerrada', asignaciones: [], ...o,
});
const adjudicada = (o: Partial<SolicitudContratos> = {}) => solicitud({ asignaciones: [{ estadoRevision: 'PRESENTADO' }, { estadoRevision: 'CERRADO_ADJUDICADO' }], ...o });
const valorDe = (campos: ReturnType<typeof camposFormularioContratos>, campo: string) => campos.find((c) => c.campo === campo)?.valor;

describe('porcentajeAIU (administración + imprevistos + utilidad sobre costos directos)', () => {
  it('suma la «A» (costos administrativos) al I.U., que se aplica sobre directos + administrativos', () => {
    // directos = 1000 + 200 + 300 = 1500 · I.U. 8 % de (1500 + 60) = 124,8 · A.I.U. = (60 + 124,8) / 1500 = 12,32 %
    expect(porcentajeAIU(totales, 8)).toBe(12.32);
  });
  it('sin costos administrativos el A.I.U. es el propio I.U.', () => {
    expect(porcentajeAIU({ ...totales, administrativos: 0 }, 10)).toBe(10);
  });
  it('con I.U. 0 % queda solo la «A»', () => {
    expect(porcentajeAIU(totales, 0)).toBe(4);
  });
  it('sin I.U. configurado o sin costos directos no inventa un valor', () => {
    expect(porcentajeAIU(totales, null)).toBeNull();
    expect(porcentajeAIU(totales, undefined)).toBeNull();
    expect(porcentajeAIU(totales, Number.NaN)).toBeNull();
    expect(porcentajeAIU({ ...totales, manoObra: 0, insumos: 0, maquinaria: 0 }, 8)).toBeNull();
  });
});

describe('camposFormularioContratos', () => {
  const resultado = { subtotalAntesIva: 4800, valorMesIncluidoIva: 5000, porcentajeIU: 8, vigenciaMeses: 12 };

  it('rellena los campos del formulario desde la solicitud, el resultado guardado y los totales de la pantalla', () => {
    const c = camposFormularioContratos({ solicitud: solicitud(), totales, resultado });
    expect(valorDe(c, 'Nombre o Razón Social Cliente')).toBe('Cliente SAS');
    expect(valorDe(c, 'Nit')).toBe('900123456');
    expect(valorDe(c, 'Dirección')).toBe('Calle 1');
    expect(valorDe(c, 'Descripción')).toBe('Aseo');
    expect(valorDe(c, 'Objeto')).toBe('Aseo');
    expect(valorDe(c, '% A.I.U.')).toBe(12.32);
    expect(valorDe(c, '% AIU')).toBe(12.32); // el mismo valor en «Operación del Contrato»
    expect(valorDe(c, 'Vr. Mano Obra')).toBe(1000);
    expect(valorDe(c, 'Servs. No Conts.')).toBe(40);
  });

  it('el Valor Contrato es MENSUAL: el valor comercial mensual con IVA, más el valor antes de IVA como referencia', () => {
    const c = camposFormularioContratos({ solicitud: solicitud(), totales, resultado });
    expect(valorDe(c, 'Valor Contrato (mensual, incluye IVA)')).toBe(5000);
    expect(valorDe(c, 'Valor mensual antes de IVA (referencia)')).toBe(4800);
    expect(valorDe(c, 'Plazo de ejecución (meses) — para calcular «Fecha Final»')).toBe(12);
    expect(c.some((f) => /vigencia/i.test(f.campo) && f.formato === 'moneda')).toBe(false); // ya no se ofrece el total de la vigencia
  });

  it('lo que no existe queda en null (nunca se inventa): sin solicitud, sin resultado, texto vacío o número inválido', () => {
    const c = camposFormularioContratos({
      solicitud: null, totales, resultado: { porcentajeIU: Number.NaN, valorMesIncluidoIva: '5000', vigenciaMeses: undefined },
    });
    for (const campo of ['Nombre o Razón Social Cliente', 'Nit', 'Dirección', 'Descripción', '% A.I.U.', 'Valor Contrato (mensual, incluye IVA)']) {
      expect(valorDe(c, campo)).toBeNull();
    }
    expect(valorDe(camposFormularioContratos({ solicitud: solicitud({ nitContacto: '   ' }), totales, resultado: null }), 'Nit')).toBeNull();
    expect(valorDe(c, 'Vr. Insumos')).toBe(200); // los totales vienen de la pantalla y siempre existen
  });
});

describe('elegirSolicitud', () => {
  it('prefiere la adjudicada aunque no sea la más reciente y avisa si había más de una', () => {
    const elegida = elegirSolicitud([solicitud({ id: 3 }), adjudicada({ id: 2 }), solicitud({ id: 1 })]);
    expect(elegida?.solicitud.id).toBe(2);
    expect(elegida?.ambigua).toBe(true);
  });
  it('sin adjudicada toma la primera (la más reciente); con una sola no es ambigua; sin ninguna, null', () => {
    expect(elegirSolicitud([solicitud({ id: 3 }), solicitud({ id: 1 })])?.solicitud.id).toBe(3);
    expect(elegirSolicitud([solicitud()])?.ambigua).toBe(false);
    expect(elegirSolicitud([])).toBeNull();
  });
  it('esAdjudicada mira solo la ÚLTIMA asignación', () => {
    expect(esAdjudicada(adjudicada())).toBe(true);
    expect(esAdjudicada(solicitud({ asignaciones: [{ estadoRevision: 'CERRADO_ADJUDICADO' }, { estadoRevision: 'RECHAZADO' }] }))).toBe(false);
    expect(esAdjudicada(solicitud({ asignaciones: 'no es un arreglo' }))).toBe(false);
  });
});

describe('escribirHojaContratos', () => {
  it('crea la hoja «Contratos» con el origen de los datos, formato moneda y «Completar en Contratos» donde falta', async () => {
    const wb = new ExcelJS.Workbook();
    escribirHojaContratos(wb, {
      procesoCodigo: 'P-1', procesoNombre: 'Aseo integral', solicitud: elegirSolicitud([adjudicada({ nitContacto: null }), solicitud({ id: 9 })]), totales,
      resultado: { valorMesIncluidoIva: 5000 },
    });
    const ws = wb.getWorksheet('Contratos')!;
    const filas = new Map<string, ExcelJS.Cell>();
    ws.eachRow((r) => filas.set(String(r.getCell(2).value), r.getCell(3)));
    expect(filas.get('Nit')?.value).toBe('Completar en Contratos');
    expect(filas.get('Vr. Mano Obra')?.value).toBe(1000);
    expect(filas.get('Vr. Mano Obra')?.numFmt).toBe('$#,##0');
    expect(filas.get('Valor Contrato (mensual, incluye IVA)')?.value).toBe(5000);
    expect(filas.get('% A.I.U.')?.value).toBe('Completar en Contratos'); // sin % de I.U. guardado no se calcula
    expect(String(ws.getCell('B5').value)).toContain('Solicitud #1 — Adjudicada');
    expect(String(ws.getCell('B5').value)).toContain('más de una solicitud');
  });
  it('sin solicitud lo dice en el origen', () => {
    const wb = new ExcelJS.Workbook();
    escribirHojaContratos(wb, { procesoCodigo: null, procesoNombre: null, solicitud: null, totales, resultado: null });
    expect(String(wb.getWorksheet('Contratos')!.getCell('B4').value)).toContain('Sin solicitud');
  });
});
