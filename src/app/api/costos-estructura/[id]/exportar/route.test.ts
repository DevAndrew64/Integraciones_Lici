/**
 * Ajuste "EXPORTAR COSTOS — EXCEL GENERAL CON TODAS LAS PESTAÑAS" —
 * integración real de POST /api/costos-estructura/[id]/exportar: valida
 * la regla obligatoria (dotacionEpp/examenesMedicos/insumos/
 * maquinariaEquipos deben estar COMPLETADO o NO_APLICA, fuente de verdad
 * server-side sobre datos persistidos), genera un único workbook con
 * todas las pestañas, y nunca crea/actualiza registros (es de solo
 * lectura/exportación).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import type { FichaManoObraExportDto, DetalleUnitarioExportDto } from '@/lib/costos-mano-obra/exportacion/tipos-exportacion';
import type { CostosPantallaDto } from '@/lib/costos-estructura/exportacion/costos-pantalla';

let sesionActual: { id: number; usuario: string; email: string; rol: string } | null = {
  id: 1, usuario: 'ana.perez', email: 'ana.perez@grupocolba.com', rol: 'Analista Costos',
};
let permisoConcedido = true;

vi.mock('@/lib/session', () => ({ getSession: async () => sesionActual }));
vi.mock('@/lib/authz', () => ({
  requireSession: (session: unknown) => (session ? null : { status: 401 }),
  hasPermiso: async () => permisoConcedido,
}));

const createSpy = vi.fn();
let registro: { id: number; procesoCodigo: string | null; procesoNombre: string | null; cargo: string | null; nTrabajadores: number; costoMO: number; datos: Record<string, unknown> } | null = null;

const fakePrisma = {
  costoEstructura: {
    async findUnique({ where }: { where: { id: number } }) {
      return registro && where.id === registro.id ? { ...registro } : null;
    },
    async create(args: unknown) { createSpy(args); return { id: 999 }; },
  },
};
vi.mock('@/lib/prisma', () => ({ default: fakePrisma }));

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

function moduloCompletado(datosModulo: unknown) {
  return { estado: 'COMPLETADO' as const, datos: datosModulo, ultimaActualizacion: 't0', actualizadoPor: 'ana' };
}
function estructuraBase(overridesModulos: Record<string, unknown> = {}) {
  return {
    version: 2 as const,
    modulos: {
      manoObra: moduloCompletado({ datosEntrada: { lineasExtra: [{ id: 1 }] } }),
      dotacionEpp: moduloCompletado({ dotGroups: [] }),
      examenesMedicos: { estado: 'NO_APLICA', datos: {}, ultimaActualizacion: 't0', actualizadoPor: 'ana' },
      insumos: moduloCompletado({ insumosRows: [] }),
      maquinariaEquipos: { estado: 'NO_APLICA', datos: {}, ultimaActualizacion: 't0', actualizadoPor: 'ana' },
      costosAdministrativos: moduloCompletado({}),
      ...overridesModulos,
    },
  };
}

function req(body: unknown) {
  return new NextRequest('http://localhost/api/costos-estructura/1/exportar', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
function ctx() { return { params: Promise.resolve({ id: '1' }) }; }
/** JSON que arma la pantalla: Mano de Obra 12.140.000 + Papelería $5.000 de Administrativos = TOTAL 12.145.000. */
function costosDto(overrides: Partial<CostosPantallaDto> = {}): CostosPantallaDto {
  return {
    nTrabajadores: 4,
    cargos: ['ASEADOR'],
    totales: {
      manoObra: 12140000, otrosCostosEnManoObra: 320000, insumos: 0, maquinaria: 0,
      serviciosNoContinuos: 0, valorAgregado: 0, administrativos: 5000, total: 12145000,
    },
    administrativos: {
      variables: [{ concepto: 'Papelería', cantidad: 1, valorUnitario: 5000, valorMensual: 5000 }],
      totalVariables: 5000, valorMensualPolizas: 0, valorMensualImpuestos: 0,
    },
    dotacionEpp: { total: 0, cargos: [] },
    examenes: { total: 0, cargos: [] },
    insumos: { filas: [], total: 0 },
    maquinaria: { filas: [], subtotalAdquisicion: 0, subtotalMantenimiento: 0 },
    ...overrides,
  };
}
function dtoValido() {
  return {
    manoObraDto: { estructuraCostoId: 1, procesoId: 1, numeroProceso: 'SED-LP-2026-0091', ultimaActualizacionManoObra: 't0', fichas: [ficha()] },
    costosDto: costosDto(),
  };
}

beforeEach(() => {
  sesionActual = { id: 1, usuario: 'ana.perez', email: 'ana.perez@grupocolba.com', rol: 'Analista Costos' };
  permisoConcedido = true;
  createSpy.mockReset();
  registro = { id: 1, procesoCodigo: 'SED-LP-2026-0091', procesoNombre: 'Aseo y cafetería', cargo: 'ASEADOR', nTrabajadores: 4, costoMO: 12140000, datos: estructuraBase() };
});
afterEach(() => { vi.resetModules(); });

describe('POST /api/costos-estructura/[id]/exportar', () => {
  it('1) los 4 módulos resueltos (COMPLETADO/NO_APLICA) → 200, devuelve un XLSX con todas las pestañas, nunca crea registros', async () => {
    const { POST } = await import('./route');
    const res = await POST(req(dtoValido()), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('spreadsheet');
    const buf = Buffer.from(await res.arrayBuffer());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const nombres = wb.worksheets.map((ws) => ws.name);
    expect(nombres).toEqual(['Resumen', 'Mano de Obra', 'EPP y Dotación', 'Exámenes Médicos', 'Insumos', 'Maquinaria y Equipos', 'Costos Administrativos', 'Resultado']);
    expect(createSpy).not.toHaveBeenCalled();

    // Ajuste "REVISIÓN FUNCIONAL FINAL" §16/§20 — Mano de Obra conserva sus
    // fórmulas reales, y ninguna hoja del workbook contiene un error de Excel.
    const moWs = wb.getWorksheet('Mano de Obra')!;
    let formulas = 0;
    moWs.eachRow((row) => row.eachCell((cell) => { if (cell.formula) formulas++; }));
    expect(formulas).toBeGreaterThan(0);
    const erroresExcel: string[] = [];
    wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((cell) => {
      const v = String(cell.value);
      if (['#REF!', '#VALUE!', '#DIV/0!', '#NAME?', '#N/A'].some((e) => v.includes(e))) erroresExcel.push(`${ws.name}:${cell.address}=${v}`);
    })));
    expect(erroresExcel).toEqual([]);
  });

  it('12) el Excel muestra los valores de la pantalla y NO recalcula con lo guardado: costoMO viejo en la BD no cambia el Resumen', async () => {
    // Caso real (CostoEstructura 12): costoMO quedó guardado SIN los exámenes que se
    // agregaron después; la pantalla (recalcula en vivo) muestra 4.518.942 y Admin $5.000.
    registro!.costoMO = 4489275;
    const dto = dtoValido();
    dto.costosDto = costosDto({
      totales: { manoObra: 4518942, otrosCostosEnManoObra: 29667, insumos: 0, maquinaria: 0, serviciosNoContinuos: 0, valorAgregado: 0, administrativos: 5000, total: 4523942 },
    });
    const { POST } = await import('./route');
    const res = await POST(req(dto), ctx());
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ExcelJS.Buffer);
    const valores = new Map<string, unknown>();
    wb.getWorksheet('Resumen')!.eachRow((row) => valores.set(String(row.getCell(1).value), row.getCell(3).value));
    expect(valores.get('Mano de Obra (incl. Turnantes)')).toBe(4518942);
    expect(valores.get('Costos Administrativos')).toBe(5000);
    expect(valores.get('TOTAL')).toBe(4523942);
    const resultado = new Map<string, unknown>();
    wb.getWorksheet('Resultado')!.eachRow((row) => resultado.set(String(row.getCell(1).value), row.getCell(2).value));
    expect(resultado.get('COSTO MENSUAL GENERAL')).toBe(4523942);
    expect(resultado.get('Total mensual administrativo')).toBe(5000);
  });

  it('12b) el Resumen incluye los mismos rubros del panel (Servicios no continuos y Valor agregado entran al TOTAL) y no suma EPP/Exámenes otra vez', async () => {
    const dto = dtoValido();
    dto.costosDto = costosDto({
      totales: { manoObra: 1000000, otrosCostosEnManoObra: 50000, insumos: 200000, maquinaria: 300000, serviciosNoContinuos: 40000, valorAgregado: 60000, administrativos: 5000, total: 1605000 },
      insumos: { total: 200000, filas: [{ codigo: 'I1', nombre: 'JABON', unidad: 'GL', cantidad: 1, frecuenciaMeses: 1, valorUnitarioSinIva: 168067, valorUnitarioConIva: 200000, valorMensual: 200000, valorAgregado: false }] },
      maquinaria: { subtotalAdquisicion: 300000, subtotalMantenimiento: 0, filas: [{ codigo: 'M1', descripcion: 'ASPIRADORA', categoria: 'ASEO', cantidadRequerida: 1, cantidadComprar: 1, valorUnitario: 300000, valorMesComprar: 300000, valorMesMantenimiento: 0, valorAgregado: false }] },
    });
    const { POST } = await import('./route');
    const res = await POST(req(dto), ctx());
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ExcelJS.Buffer);
    const valores = new Map<string, unknown>();
    wb.getWorksheet('Resumen')!.eachRow((row) => valores.set(String(row.getCell(1).value), row.getCell(3).value));
    expect(valores.get('Servicios no continuos')).toBe(40000);
    expect(valores.get('Valor agregado')).toBe(60000);
    expect(valores.get('TOTAL')).toBe(1605000);
    expect(valores.get('EPP / Dotación')).toBe('Incluido en Mano de Obra');
  });

  it('12c) costosDto ausente → 400 COSTOS_DTO_INVALIDO, nunca genera archivo', async () => {
    const dto = dtoValido() as { manoObraDto: unknown; costosDto?: unknown };
    delete dto.costosDto;
    const { POST } = await import('./route');
    const res = await POST(req(dto), ctx());
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toBe('COSTOS_DTO_INVALIDO');
  });

  it('12d) costosDto cuyo TOTAL no cuadra con sus rubros → 400 COSTOS_DTO_INVALIDO', async () => {
    const dto = dtoValido();
    dto.costosDto.totales.total = 999;
    const { POST } = await import('./route');
    const res = await POST(req(dto), ctx());
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toBe('COSTOS_DTO_INVALIDO');
    expect(String(data.errores)).toContain('totales.total no reconcilia');
  });

  it('12e) un valor no finito en costosDto → 400 COSTOS_DTO_INVALIDO', async () => {
    const dto = dtoValido();
    // JSON.stringify convierte NaN en null → llega como null y se rechaza.
    (dto.costosDto.totales as { insumos: number | null }).insumos = null;
    const { POST } = await import('./route');
    const res = await POST(req(dto), ctx());
    expect(res.status).toBe(400);
  });

  it('2) un módulo en NO_INICIADO (insumos) → 409, pendientes incluye "insumos", nunca genera archivo', async () => {
    registro!.datos = estructuraBase({ insumos: { estado: 'NO_INICIADO', datos: {}, ultimaActualizacion: 't0', actualizadoPor: 'ana' } });
    const { POST } = await import('./route');
    const res = await POST(req(dtoValido()), ctx());
    const data = await res.json();
    expect(res.status).toBe(409);
    expect(data.ok).toBe(false);
    expect(data.pendientes).toEqual(['insumos']);
  });

  it('3) un módulo en EN_PROGRESO (maquinariaEquipos) → 409', async () => {
    registro!.datos = estructuraBase({ maquinariaEquipos: { estado: 'EN_PROGRESO', datos: {}, ultimaActualizacion: 't0', actualizadoPor: 'ana' } });
    const { POST } = await import('./route');
    const res = await POST(req(dtoValido()), ctx());
    const data = await res.json();
    expect(res.status).toBe(409);
    expect(data.pendientes).toEqual(['maquinariaEquipos']);
  });

  it('4) módulo ausente de los datos persistidos (dotacionEpp nunca guardado) → 409, pendientes lo incluye', async () => {
    const modulos = estructuraBase().modulos as Record<string, unknown>;
    delete modulos.dotacionEpp;
    registro!.datos = { version: 2, modulos };
    const { POST } = await import('./route');
    const res = await POST(req(dtoValido()), ctx());
    const data = await res.json();
    expect(res.status).toBe(409);
    expect(data.pendientes).toContain('dotacionEpp');
  });

  it('5) NO_APLICA se representa en su hoja como "NO APLICA" (Exámenes Médicos y Maquinaria, ambos NO_APLICA en el fixture base)', async () => {
    const { POST } = await import('./route');
    const res = await POST(req(dtoValido()), ctx());
    const buf = Buffer.from(await res.arrayBuffer());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const examenesWs = wb.getWorksheet('Exámenes Médicos')!;
    const maquinariaWs = wb.getWorksheet('Maquinaria y Equipos')!;
    let encontradoExamenes = false, encontradoMaquinaria = false;
    examenesWs.eachRow((row) => row.eachCell((cell) => { if (String(cell.value).includes('NO APLICA')) encontradoExamenes = true; }));
    maquinariaWs.eachRow((row) => row.eachCell((cell) => { if (String(cell.value).includes('NO APLICA')) encontradoMaquinaria = true; }));
    expect(encontradoExamenes).toBe(true);
    expect(encontradoMaquinaria).toBe(true);
  });

  it('6) la hoja Mano de Obra sigue usando el mecanismo existente — contiene el cargo real de la ficha enviada', async () => {
    const { POST } = await import('./route');
    const res = await POST(req(dtoValido()), ctx());
    const buf = Buffer.from(await res.arrayBuffer());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet('Mano de Obra')!;
    let encontrado = false;
    ws.eachRow((row) => row.eachCell((cell) => { if (String(cell.value).includes('ASEADOR')) encontrado = true; }));
    expect(encontrado).toBe(true);
  });

  it('7) estructura inexistente → 404', async () => {
    registro = null;
    const { POST } = await import('./route');
    const res = await POST(req(dtoValido()), ctx());
    expect(res.status).toBe(404);
  });

  it('8) sin sesión → 401', async () => {
    sesionActual = null;
    const { POST } = await import('./route');
    const res = await POST(req(dtoValido()), ctx());
    expect(res.status).toBe(401);
  });

  // Ajuste "PERMISOS DE COSTOS — EQUIPO COMERCIAL" — exportar es lectura,
  // sigue el mismo criterio que GET /api/costos-estructura/[id]: solo
  // sesión válida. Ya NO exige 'ver_estructura_costos' (permiso de BD que
  // Mercadeo nunca tuvo) — un rol sin ese permiso (p.ej. Analista
  // Mercadeo) ahora puede exportar igual que cualquier otro rol
  // autenticado.
  it('9) sesión de un rol sin el permiso de BD "ver_estructura_costos" (p.ej. Mercadeo) → 200, no 403', async () => {
    sesionActual = { id: 2, usuario: 'm.gomez', email: 'm.gomez@grupocolba.com', rol: 'Analista Mercadeo' };
    permisoConcedido = false;
    const { POST } = await import('./route');
    const res = await POST(req(dtoValido()), ctx());
    expect(res.status).toBe(200);
  });

  it('10) DTO de Mano de Obra inconsistente (reconciliación aritmética falla) → 400, DTO_INVALIDO, nunca genera archivo', async () => {
    const { POST } = await import('./route');
    const dto = dtoValido();
    dto.manoObraDto.fichas[0].totalCargo = 1; // rompe la reconciliación
    const res = await POST(req(dto), ctx());
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toBe('DTO_INVALIDO');
  });

  it('11) versión de Mano de Obra desactualizada (concurrencia) → 409 CONFLICTO_CONCURRENCIA', async () => {
    const { POST } = await import('./route');
    const dto = dtoValido();
    dto.manoObraDto.ultimaActualizacionManoObra = 't-vieja';
    const res = await POST(req(dto), ctx());
    const data = await res.json();
    expect(res.status).toBe(409);
    expect(data.error).toBe('CONFLICTO_CONCURRENCIA');
  });

  describe('Dotación/EPP, Exámenes y Administrativos: se escribe lo que calculó la pantalla', () => {
    async function exportar(dto: unknown) {
      const { POST } = await import('./route');
      const res = await POST(req(dto), ctx());
      expect(res.status).toBe(200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ExcelJS.Buffer);
      return wb;
    }
    const celdas = (wb: ExcelJS.Workbook, hoja: string) => {
      const textos: unknown[] = [];
      wb.getWorksheet(hoja)!.eachRow((row) => row.eachCell((c) => { textos.push(c.value); }));
      return textos;
    };

    it('13) EPP y Dotación: lista las filas y el "valor único por cargo" de la pantalla, sin sumar ni promediar de nuevo', async () => {
      registro!.datos = estructuraBase({ dotacionEpp: moduloCompletado({ dotGroups: [] }) });
      const dto = dtoValido();
      // Dotación masculina y femenina: la pantalla las PROMEDIA (valor único 7.239), el servidor no las suma.
      dto.costosDto = costosDto({
        dotacionEpp: {
          total: 7239,
          cargos: [{
            cargo: 'ASEADOR', cantidadTrabajadores: 4, totalUnitario: 7239,
            filas: [
              { grupo: 'Hombre', tipo: 'Dotación', codigo: '06058', descripcion: 'BOTAS CUERO', unidad: 'UND', cantidad: 1, frecuencia: 6, valorUnitario: 36500, valorMensual: 7239 },
              { grupo: 'Mujer', tipo: 'Dotación', codigo: '06059', descripcion: 'BOTAS DAMA', unidad: 'UND', cantidad: 1, frecuencia: 6, valorUnitario: 36500, valorMensual: 7239 },
            ],
          }],
        },
      });
      const wb = await exportar(dto);
      const textos = celdas(wb, 'EPP y Dotación');
      expect(textos).toContain('BOTAS CUERO');
      expect(textos).toContain('BOTAS DAMA');
      expect(textos).toContain('ASEADOR — 4 trabajador(es)');
      // Total de la hoja = el de la pantalla (7.239), no la suma de filas (14.478).
      expect(textos.filter((v) => v === 7239).length).toBeGreaterThanOrEqual(3);
      expect(textos).not.toContain(14478);
    });

    it('14) Exámenes, Cursos y Vacunas: escribe los valores mensuales de la pantalla y el total por cargo', async () => {
      registro!.datos = estructuraBase({ examenesMedicos: moduloCompletado({ examRows: [] }) });
      const dto = dtoValido();
      dto.costosDto = costosDto({
        examenes: {
          total: 29667,
          cargos: [{
            cargo: 'ASEO Y CAFETERIA', cantidadTrabajadores: 1, totalUnitario: 29667,
            examenes: [{ concepto: 'EXAMEN FÍSICO CON ÉNFASIS OSTEOMUSCULAR', detalle: 'ATENCION MEDICALIZADA · ALBANIA', cantidad: 1, valor: 28500, valorMensual: 9500 }],
            cursos: [{ concepto: 'PERSONA AUTORIZADA T.S.A.', detalle: 'SINCELEJO', cantidad: 1, valor: 242000, valorMensual: 20166.67 }],
            vacunas: [],
          }],
        },
      });
      const wb = await exportar(dto);
      const textos = celdas(wb, 'Exámenes Médicos');
      expect(textos).toContain('EXAMEN FÍSICO CON ÉNFASIS OSTEOMUSCULAR');
      expect(textos).toContain(9500);
      expect(textos).toContain(20166.67);
      expect(textos).toContain(29667);
    });

    it('15) Costos Administrativos: variables con su valor mensual y los valores mensuales de pólizas e impuestos de la pantalla', async () => {
      const dto = dtoValido();
      dto.costosDto = costosDto({
        totales: { manoObra: 12140000, otrosCostosEnManoObra: 0, insumos: 0, maquinaria: 0, serviciosNoContinuos: 0, valorAgregado: 0, administrativos: 3500000, total: 15640000 },
        administrativos: {
          variables: [{ concepto: 'Papelería', cantidad: 4, valorUnitario: 5000, valorMensual: 20000 }],
          totalVariables: 20000, valorMensualPolizas: 480000, valorMensualImpuestos: 3000000,
        },
      });
      const wb = await exportar(dto);
      const textos = celdas(wb, 'Costos Administrativos');
      expect(textos).toContain('Papelería');
      expect(textos).toContain(20000);
      expect(textos).toContain(480000);
      expect(textos).toContain(3000000);
      expect(textos).toContain(3500000);
    });

    it('16) Insumos: lista las filas y el total de la pantalla; las filas de Valor agregado se marcan y no suman', async () => {
      registro!.datos = estructuraBase({ insumos: moduloCompletado({ insumosRows: [] }) });
      const dto = dtoValido();
      dto.costosDto = costosDto({
        totales: { manoObra: 12140000, otrosCostosEnManoObra: 0, insumos: 90000, maquinaria: 0, serviciosNoContinuos: 0, valorAgregado: 0, administrativos: 5000, total: 12235000 },
        insumos: {
          total: 90000,
          filas: [
            { codigo: 'I1', nombre: 'JABON LIQUIDO', unidad: 'GL', cantidad: 2, frecuenciaMeses: 1, valorUnitarioSinIva: 30000, valorUnitarioConIva: 35700, valorMensual: 90000, valorAgregado: false },
            { codigo: 'I2', nombre: 'DISPENSADOR', unidad: 'UND', cantidad: 1, frecuenciaMeses: 12, valorUnitarioSinIva: 50000, valorUnitarioConIva: 59500, valorMensual: 5000, valorAgregado: true },
          ],
        },
      });
      const wb = await exportar(dto);
      const textos = celdas(wb, 'Insumos');
      expect(textos).toContain('JABON LIQUIDO');
      expect(textos).toContain('DISPENSADOR');
      expect(textos).toContain('Sí (no suma aquí)');
      // El total es el de la pantalla (90.000), no la suma de todas las filas listadas (95.000).
      expect(textos).toContain(90000);
      expect(textos).not.toContain(95000);
    });

    it('17) Maquinaria y Equipos: filas y subtotales de la pantalla, sin recalcular', async () => {
      registro!.datos = estructuraBase({ maquinariaEquipos: moduloCompletado({ maqRows: [] }) });
      const dto = dtoValido();
      dto.costosDto = costosDto({
        totales: { manoObra: 12140000, otrosCostosEnManoObra: 0, insumos: 0, maquinaria: 700000, serviciosNoContinuos: 0, valorAgregado: 0, administrativos: 5000, total: 12845000 },
        maquinaria: {
          subtotalAdquisicion: 500000, subtotalMantenimiento: 200000,
          filas: [{ codigo: 'M1', descripcion: 'ASPIRADORA INDUSTRIAL', categoria: 'ASEO', cantidadRequerida: 2, cantidadComprar: 2, valorUnitario: 1200000, valorMesComprar: 500000, valorMesMantenimiento: 200000, valorAgregado: false }],
        },
      });
      const wb = await exportar(dto);
      const textos = celdas(wb, 'Maquinaria y Equipos');
      expect(textos).toContain('ASPIRADORA INDUSTRIAL');
      expect(textos).toContain(500000);
      expect(textos).toContain(200000);
      expect(textos).toContain(700000); // TOTAL GENERAL = el de la pantalla
    });

    it('18) Resumen: el cargo sale de la pantalla (no de la columna guardada) y, si EPP/Exámenes están Completados pero aportan $0, lo dice en vez de "Incluido"', async () => {
      registro!.cargo = null;
      registro!.datos = estructuraBase({
        dotacionEpp: moduloCompletado({ dotGroups: [] }),
        examenesMedicos: moduloCompletado({ examRows: [] }),
      });
      const dto = dtoValido();
      dto.costosDto = costosDto({
        cargos: ['ASEO Y CAFETERIA'],
        totales: { manoObra: 4645496, otrosCostosEnManoObra: 0, insumos: 2090800, maquinaria: 0, serviciosNoContinuos: 0, valorAgregado: 0, administrativos: 16311, total: 6752607 },
        administrativos: { variables: [{ concepto: 'Papelería', cantidad: 2, valorUnitario: 8155.5, valorMensual: 16311 }], totalVariables: 16311, valorMensualPolizas: 0, valorMensualImpuestos: 0 },
        insumos: { total: 2090800, filas: [{ codigo: 'I1', nombre: 'X', unidad: 'UND', cantidad: 1, frecuenciaMeses: 1, valorUnitarioSinIva: 1757647, valorUnitarioConIva: 2090800, valorMensual: 2090800, valorAgregado: false }] },
      });
      const wb = await exportar(dto);
      const filas = new Map<string, unknown[]>();
      wb.getWorksheet('Resumen')!.eachRow((row) => filas.set(String(row.getCell(1).value), [row.getCell(2).value, row.getCell(3).value]));
      expect(filas.get('Cargo')).toEqual(['ASEO Y CAFETERIA', null]);
      expect(filas.get('EPP / Dotación')).toEqual(['Completado', 0]);
      expect(filas.get('Exámenes Médicos')).toEqual(['Completado', 0]);
      expect(filas.get('TOTAL')?.[1]).toBe(6752607);
      expect(celdas(wb, 'Resumen').some((t) => String(t).includes('no hay costos asignados a los cargos vigentes'))).toBe(true);
      expect(celdas(wb, 'Resumen')).not.toContain('Incluido en Mano de Obra');
    });
  });
});
