/**
 * DIAGNÓSTICO FINAL DEL ESTADO ACTUAL — "Cuando intento exportar varias
 * fichas aparece DTO_INVALIDO". Reproduce el flujo COMPLETO end-to-end
 * (motor financiero real → DTO construido con las MISMAS fórmulas de
 * page.tsx → validarDtoExportacion → generarExcelManoObra) con 1, 2 y 3
 * fichas — nunca con números de fixture "limpios" (los de generar-excel-
 * mano-obra.test.ts), precisamente para exponer cualquier problema de
 * redondeo/reconciliación que solo aparezca con datos reales (porcentajes
 * con decimales — 8.33/12/0.522/6.96 — y varios trabajadores por ficha).
 *
 * Conclusión de la auditoría (documentada aquí para que no se repita la
 * pregunta): el motor financiero (resultado-financiero-mensual-linea.ts,
 * motor-comercial-30-dias.ts, otros-costos-por-linea.ts) redondea CADA
 * concepto monetario a pesos ENTEROS antes de que page.tsx lo use para
 * construir el DTO — nunca se suman floats sin redondear. Por construcción,
 * `costoLaboralUnitario` es SIEMPRE la suma exacta de sus componentes
 * (enteros) y `totalCargo = costoLaboralUnitario × cantidadTrabajadores`
 * es una multiplicación entero×entero exacta — no hay margen para que la
 * reconciliación falle por acumulación de redondeo, sin importar cuántas
 * fichas ni cuántos trabajadores tenga cada una. Estas pruebas lo
 * demuestran con el motor real, no con una suposición.
 */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { derivarDistribucionHorasComercialActivo } from '../motor-distribuido/derivar-distribucion-comercial';
import { calcularResultadoTarifaMensualComercial30Dias } from '../motor-distribuido/motor-comercial-30-dias';
import { construirResultadoFinancieroMensualLinea } from '../motor-distribuido/resultado-financiero-mensual-linea';
import type { ResultadoFinancieroMensualLinea } from '../motor-distribuido/resultado-financiero-mensual-linea';
import { resolverParametrosFinancierosManoObra } from '../motor-distribuido/parametros-financieros-mano-obra';
import { validarDtoExportacion } from './validar-dto-exportacion';
import { generarExcelManoObra } from './generar-excel-mano-obra';
import type { DetalleUnitarioExportDto, FichaManoObraExportDto, ExportacionManoObraDto } from './tipos-exportacion';
import type { DistribucionHorarioConfigurada } from '../horarios/tipos';

const RUTA_PLANTILLA = path.join(process.cwd(), 'data', 'importaciones', 'Mano de obra', 'Mano de obra.xlsx');

function distribucion(dias: DistribucionHorarioConfigurada['diasSemana'], bloques: { inicio: string; fin: string; orden: number }[]): DistribucionHorarioConfigurada {
  return { idCliente: 'd1', empresa: '', codigo: '', horario: '', jornada: '', turno: '', diasSemana: dias, bloques, excepcionesFecha: [], sincronizadoExterno: false };
}

// Configuración financiera REAL (page.tsx la resuelve así cuando el
// usuario no personaliza porcentajes) — decimales genuinos (8.33/12/
// 0.522/6.96), nunca números redondos "de prueba".
const parametrosFinancieros = resolverParametrosFinancierosManoObra(null);

interface EscenarioCargo {
  nombre: string;
  horario: string;
  horasSemanales: number;
  diasSemana: readonly ('L' | 'M' | 'X' | 'J' | 'V' | 'S' | 'D')[];
  bloques: { inicio: string; fin: string; orden: number }[];
  salarioMensual: number;
  cantidadTrabajadores: number;
  claseArl: 'I' | 'II' | 'III' | 'IV' | 'V';
  dotacionPorTrabajador: number;
  eppPorTrabajador: number;
}

/** Construye el `ResultadoFinancieroMensualLinea` REAL de un cargo — mismo
 * camino que page.tsx: derivar horario → motor comercial → ensamblador
 * financiero compartido. Nunca un objeto fabricado a mano. */
function calcularFinancieroReal(esc: EscenarioCargo): ResultadoFinancieroMensualLinea {
  const derivacion = derivarDistribucionHorasComercialActivo({
    distribucionesHorario: [distribucion(esc.diasSemana as ('L' | 'M' | 'X' | 'J' | 'V' | 'S' | 'D')[], esc.bloques)],
    incluyeFestivos: true,
    metodologiaCosteo: 'SEMANAL_4_33',
  });
  if (!derivacion.ok) throw new Error(derivacion.motivo);
  const resultadoTarifa = calcularResultadoTarifaMensualComercial30Dias({
    distribucionHoras: derivacion.distribucion,
    salarioMensual: esc.salarioMensual,
    auxilioTransporteMensual: 249095,
    cantidadTrabajadores: esc.cantidadTrabajadores,
    horasExtraSemanales: derivacion.horasExtraSemanales,
  });
  return construirResultadoFinancieroMensualLinea({
    resultadoTarifaMensual: resultadoTarifa,
    claseArl: esc.claseArl,
    parametrosFinancieros,
    otrosCostosMensualesPorTrabajador: esc.dotacionPorTrabajador + esc.eppPorTrabajador,
  });
}

/** Construye la ficha de exportación EXACTAMENTE con las mismas fórmulas
 * que `fichasExportacionManoObra` (page.tsx, rama CARGO) — nunca una
 * fórmula paralela. Ver page.tsx ~línea 12057 en adelante. */
function construirFichaCargo(fichaId: string, orden: number, esc: EscenarioCargo, fu: ResultadoFinancieroMensualLinea): FichaManoObraExportDto {
  const totalRecargos = fu.desgloseRecargos.valorRecargoNocturnoMensual + fu.desgloseRecargos.valorExtraDiurnaMensual
    + fu.desgloseRecargos.valorExtraNocturnaMensual + fu.desgloseRecargos.valorDominicalFestivoMensual
    + fu.desgloseRecargos.valorExtraFestivaDiurnaMensual + fu.desgloseRecargos.valorExtraFestivaNocturnaMensual
    + fu.desgloseRecargos.valorRecargoNocturnoFestivoMensual;
  const subtotalSalarial = fu.salarioBaseMensual + fu.bonoPrestacionalMensual + totalRecargos + fu.auxilioTransporteMensual;
  const totalPrestaciones = fu.desglosePrestaciones.cesantiasMensuales + fu.desglosePrestaciones.primaMensual
    + fu.desglosePrestaciones.vacacionesMensuales + fu.desglosePrestaciones.interesesCesantiasMensuales;
  const totalSeguridadSocial = fu.desgloseSeguridadSocial.saludMensual + fu.desgloseSeguridadSocial.pensionMensual + fu.desgloseSeguridadSocial.arlMensual;
  const totalParafiscales = fu.desgloseParafiscales.cajaCompensacionMensual + fu.desgloseParafiscales.senaMensual + fu.desgloseParafiscales.icbfMensual;
  const totalOtrosCostos = esc.dotacionPorTrabajador + esc.eppPorTrabajador;
  const bonosNoPrestacionales = 0;
  const costoLaboralUnitario = subtotalSalarial + totalPrestaciones + totalSeguridadSocial + totalParafiscales + totalOtrosCostos + bonosNoPrestacionales;
  const horasPorConcepto = (concepto: string) => fu.horasPromedioMensuales.find(h => h.concepto === concepto)?.horas ?? 0;
  const detalleUnitario: DetalleUnitarioExportDto = {
    salarioBasico: fu.salarioBaseMensual, bonoPrestacional: fu.bonoPrestacionalMensual,
    recargoNocturno: fu.desgloseRecargos.valorRecargoNocturnoMensual, horaExtraDiurna: fu.desgloseRecargos.valorExtraDiurnaMensual,
    horaExtraNocturna: fu.desgloseRecargos.valorExtraNocturnaMensual, dominicalesFestivos: fu.desgloseRecargos.valorDominicalFestivoMensual,
    horaExtraFestiva: fu.desgloseRecargos.valorExtraFestivaDiurnaMensual, horaExtraFestivaNocturna: fu.desgloseRecargos.valorExtraFestivaNocturnaMensual,
    recargoNocturnoFestivo: fu.desgloseRecargos.valorRecargoNocturnoFestivoMensual, totalRecargos,
    auxilioTransporte: fu.auxilioTransporteMensual, subtotalSalarial,
    cesantias: fu.desglosePrestaciones.cesantiasMensuales, prima: fu.desglosePrestaciones.primaMensual,
    vacaciones: fu.desglosePrestaciones.vacacionesMensuales, interesesCesantias: fu.desglosePrestaciones.interesesCesantiasMensuales, totalPrestaciones,
    salud: fu.desgloseSeguridadSocial.saludMensual, pension: fu.desgloseSeguridadSocial.pensionMensual,
    arl: fu.desgloseSeguridadSocial.arlMensual, totalSeguridadSocial,
    cajaCompensacion: fu.desgloseParafiscales.cajaCompensacionMensual, sena: fu.desgloseParafiscales.senaMensual,
    icbf: fu.desgloseParafiscales.icbfMensual, totalParafiscales,
    dotacion: esc.dotacionPorTrabajador, epp: esc.eppPorTrabajador, examenes: 0, cursos: 0, vacunas: 0, totalOtrosCostos,
    bonosNoPrestacionales, costoLaboralUnitario,
    porcentajeCesantias: fu.desglosePrestaciones.porcentajeCesantias / 100, porcentajePrima: fu.desglosePrestaciones.porcentajePrima / 100,
    porcentajeVacaciones: fu.desglosePrestaciones.porcentajeVacaciones / 100, porcentajeInteresesCesantias: fu.desglosePrestaciones.porcentajeInteresesCesantias / 100,
    porcentajeSalud: fu.desgloseSeguridadSocial.porcentajeSalud / 100, porcentajePension: fu.desgloseSeguridadSocial.porcentajePension / 100,
    porcentajeArl: fu.desgloseSeguridadSocial.porcentajeArl / 100,
    porcentajeCaja: fu.desgloseParafiscales.porcentajeCaja / 100, porcentajeSena: fu.desgloseParafiscales.porcentajeSena / 100, porcentajeIcbf: fu.desgloseParafiscales.porcentajeIcbf / 100,
    horasRecargoNocturno: horasPorConcepto('recargoNocturno'), horasExtraDiurna: horasPorConcepto('extraDiurna'),
    horasExtraNocturna: horasPorConcepto('extraNocturna'), horasDominicalesFestivos: horasPorConcepto('ordinariaDominical'),
    horasExtraFestiva: horasPorConcepto('extraDiurnaFestiva'),
    horasExtraFestivaNocturna: horasPorConcepto('extraNocturnaFestiva'), horasRecargoNocturnoFestivo: horasPorConcepto('recargoNocturnoDominical'),
    esMetodologiaSemanal: 1, horasSemanalesExtraDiurna: 6, horasSemanalesExtraNocturna: 0,
  };
  return {
    fichaId, tipo: 'CARGO', orden,
    cargo: esc.nombre, horario: esc.horario,
    cantidadTrabajadores: esc.cantidadTrabajadores, horasSemanales: esc.horasSemanales,
    detalleUnitario,
    totalCargo: costoLaboralUnitario * esc.cantidadTrabajadores,
  };
}

// 3 escenarios REALES y deliberadamente distintos (salario, cantidad de
// trabajadores, clase ARL, horario) para forzar que la reconciliación se
// ejecute sobre números "sucios" de verdad, no sobre múltiplos redondos.
const ESCENARIOS: EscenarioCargo[] = [
  {
    nombre: 'ASEADOR', horario: 'Lunes a Domingo · 06:00-14:00', horasSemanales: 56,
    diasSemana: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], bloques: [{ inicio: '06:00', fin: '14:00', orden: 1 }],
    salarioMensual: 1750905, cantidadTrabajadores: 4, claseArl: 'I',
    dotacionPorTrabajador: 41667, eppPorTrabajador: 18333,
  },
  {
    nombre: 'SUPERVISOR', horario: 'Lunes a Sábado · 07:00-16:00', horasSemanales: 48,
    diasSemana: ['L', 'M', 'X', 'J', 'V', 'S'], bloques: [{ inicio: '07:00', fin: '16:00', orden: 1 }],
    salarioMensual: 2450378, cantidadTrabajadores: 1, claseArl: 'III',
    dotacionPorTrabajador: 55000, eppPorTrabajador: 27500,
  },
  {
    nombre: 'VIGILANTE', horario: 'Lunes a Domingo · 18:00-06:00', horasSemanales: 84,
    diasSemana: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], bloques: [{ inicio: '18:00', fin: '06:00', orden: 1 }],
    salarioMensual: 1950000, cantidadTrabajadores: 7, claseArl: 'V',
    dotacionPorTrabajador: 38000, eppPorTrabajador: 22000,
  },
];

function construirDto(cantidadFichas: 1 | 2 | 3): ExportacionManoObraDto {
  const fichas = ESCENARIOS.slice(0, cantidadFichas).map((esc, i) => {
    const fu = calcularFinancieroReal(esc);
    return construirFichaCargo(`f${i + 1}`, i, esc, fu);
  });
  return {
    estructuraCostoId: 1, procesoId: 1, numeroProceso: 'DIAG-2026-0001',
    ultimaActualizacionManoObra: '2026-08-08T00:00:00.000Z',
    fichas,
  };
}

describe('DIAGNÓSTICO — DTO_INVALIDO en exportación multi-ficha (reproducción con motor real)', () => {
  it('1 ficha (ASEADOR, 4 trabajadores) reconcilia sin errores', () => {
    const r = validarDtoExportacion(construirDto(1));
    expect(r.errores).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('2 fichas (ASEADOR + SUPERVISOR, distinta cantidad de trabajadores/salario/clase ARL) reconcilian sin errores', () => {
    const r = validarDtoExportacion(construirDto(2));
    expect(r.errores).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('3 fichas (ASEADOR + SUPERVISOR + VIGILANTE 24/7, 7 trabajadores) reconcilian sin errores — el caso exacto reportado como DTO_INVALIDO', () => {
    const r = validarDtoExportacion(construirDto(3));
    expect(r.errores).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('la causa NO es acumulación de redondeo: costoLaboralUnitario de cada ficha ya es un entero (peso completo), por eso costoLaboralUnitario×cantidadTrabajadores es exacto sin importar cuántos trabajadores tenga la ficha', () => {
    const dto = construirDto(3);
    for (const f of dto.fichas) {
      expect(Number.isInteger(f.detalleUnitario.costoLaboralUnitario)).toBe(true);
      expect(f.totalCargo).toBe(f.detalleUnitario.costoLaboralUnitario * f.cantidadTrabajadores);
    }
  });

  it('CARGO + TURNANTE con factor proporcional fraccionario (1/6, no termina en binario) también reconcilia sin errores — el caso más sensible a redondeo', () => {
    const escCargo = ESCENARIOS[0];
    const fuCargo = calcularFinancieroReal(escCargo);
    const fichaCargo = construirFichaCargo('f1', 0, escCargo, fuCargo);

    // Turnante de cobertura parcial (7h de 42h, factor 1/6 — igual que el
    // caso real "TURNANTE DE ASEADOR") sobre la MISMA referencia de 42h
    // (ficha completa, sin escalar fila por fila — ver page.tsx
    // gruposTurnantesManoObra/fichasExportacionManoObra, ajuste "OJO EL
    // TURNANTE DEBE TENER LA MISMA FICHA DE LIQUIDACION DE 42H...").
    const fuTurnante = calcularFinancieroReal({ ...escCargo, cantidadTrabajadores: 1 });
    const totalRecargosT = fuTurnante.desgloseRecargos.valorRecargoNocturnoMensual + fuTurnante.desgloseRecargos.valorExtraDiurnaMensual
      + fuTurnante.desgloseRecargos.valorExtraNocturnaMensual + fuTurnante.desgloseRecargos.valorDominicalFestivoMensual
      + fuTurnante.desgloseRecargos.valorExtraFestivaDiurnaMensual + fuTurnante.desgloseRecargos.valorExtraFestivaNocturnaMensual
      + fuTurnante.desgloseRecargos.valorRecargoNocturnoFestivoMensual;
    const subtotalSalarialT = fuTurnante.salarioBaseMensual + fuTurnante.bonoPrestacionalMensual + totalRecargosT + fuTurnante.auxilioTransporteMensual;
    const totalPrestacionesT = fuTurnante.desglosePrestaciones.prestacionesSocialesMensuales;
    const totalSeguridadSocialT = fuTurnante.desgloseSeguridadSocial.seguridadSocialMensual;
    const totalParafiscalesT = fuTurnante.desgloseParafiscales.parafiscalesMensuales;
    const totalOtrosCostosT = escCargo.dotacionPorTrabajador + escCargo.eppPorTrabajador;
    const costoLaboralUnitarioT = subtotalSalarialT + totalPrestacionesT + totalSeguridadSocialT + totalParafiscalesT + totalOtrosCostosT;
    const factorNumerador = 1, factorDenominador = 6;
    const factorProporcional = factorNumerador / factorDenominador; // 0.1666... — no exacto en binario
    const fichaTurnante: FichaManoObraExportDto = {
      fichaId: 't1', tipo: 'TURNANTE', orden: 1,
      cargo: 'TURNANTE DE ASEADOR', horario: '06:00-14:00',
      cantidadTrabajadores: 1, horasSemanales: 7,
      detalleUnitario: {
        salarioBasico: fuTurnante.salarioBaseMensual, bonoPrestacional: fuTurnante.bonoPrestacionalMensual,
        recargoNocturno: fuTurnante.desgloseRecargos.valorRecargoNocturnoMensual, horaExtraDiurna: fuTurnante.desgloseRecargos.valorExtraDiurnaMensual,
        horaExtraNocturna: fuTurnante.desgloseRecargos.valorExtraNocturnaMensual, dominicalesFestivos: fuTurnante.desgloseRecargos.valorDominicalFestivoMensual,
        horaExtraFestiva: fuTurnante.desgloseRecargos.valorExtraFestivaDiurnaMensual, horaExtraFestivaNocturna: fuTurnante.desgloseRecargos.valorExtraFestivaNocturnaMensual,
        recargoNocturnoFestivo: fuTurnante.desgloseRecargos.valorRecargoNocturnoFestivoMensual, totalRecargos: totalRecargosT,
        auxilioTransporte: fuTurnante.auxilioTransporteMensual, subtotalSalarial: subtotalSalarialT,
        cesantias: fuTurnante.desglosePrestaciones.cesantiasMensuales, prima: fuTurnante.desglosePrestaciones.primaMensual,
        vacaciones: fuTurnante.desglosePrestaciones.vacacionesMensuales, interesesCesantias: fuTurnante.desglosePrestaciones.interesesCesantiasMensuales, totalPrestaciones: totalPrestacionesT,
        salud: fuTurnante.desgloseSeguridadSocial.saludMensual, pension: fuTurnante.desgloseSeguridadSocial.pensionMensual,
        arl: fuTurnante.desgloseSeguridadSocial.arlMensual, totalSeguridadSocial: totalSeguridadSocialT,
        cajaCompensacion: fuTurnante.desgloseParafiscales.cajaCompensacionMensual, sena: fuTurnante.desgloseParafiscales.senaMensual,
        icbf: fuTurnante.desgloseParafiscales.icbfMensual, totalParafiscales: totalParafiscalesT,
        dotacion: totalOtrosCostosT, epp: 0, examenes: 0, cursos: 0, vacunas: 0, totalOtrosCostos: totalOtrosCostosT,
        bonosNoPrestacionales: 0, costoLaboralUnitario: costoLaboralUnitarioT,
        porcentajeCesantias: fuTurnante.desglosePrestaciones.porcentajeCesantias / 100, porcentajePrima: fuTurnante.desglosePrestaciones.porcentajePrima / 100,
        porcentajeVacaciones: fuTurnante.desglosePrestaciones.porcentajeVacaciones / 100, porcentajeInteresesCesantias: fuTurnante.desglosePrestaciones.porcentajeInteresesCesantias / 100,
        porcentajeSalud: fuTurnante.desgloseSeguridadSocial.porcentajeSalud / 100, porcentajePension: fuTurnante.desgloseSeguridadSocial.porcentajePension / 100,
        porcentajeArl: fuTurnante.desgloseSeguridadSocial.porcentajeArl / 100,
        porcentajeCaja: fuTurnante.desgloseParafiscales.porcentajeCaja / 100, porcentajeSena: fuTurnante.desgloseParafiscales.porcentajeSena / 100, porcentajeIcbf: fuTurnante.desgloseParafiscales.porcentajeIcbf / 100,
        horasRecargoNocturno: 0, horasExtraDiurna: 0, horasExtraNocturna: 0, horasDominicalesFestivos: 0,
        horasExtraFestiva: 0, horasExtraFestivaNocturna: 0, horasRecargoNocturnoFestivo: 0,
        esMetodologiaSemanal: 0, horasSemanalesExtraDiurna: 0, horasSemanalesExtraNocturna: 0,
      },
      totalCargo: costoLaboralUnitarioT * 1 * factorProporcional,
      turnante: { coberturaHoras: 7, diasEquivalentes: 1, factorNumerador, factorDenominador, costoReferencia42Horas: costoLaboralUnitarioT, cantidadTurnantesFisicos: 1 },
    };
    const dto: ExportacionManoObraDto = {
      estructuraCostoId: 1, procesoId: 1, numeroProceso: 'DIAG-2026-0002',
      ultimaActualizacionManoObra: '2026-08-08T00:00:00.000Z',
      fichas: [fichaCargo, fichaTurnante],
    };
    const r = validarDtoExportacion(dto);
    expect(r.errores).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('generarExcelManoObra produce un archivo válido para las 3 fichas juntas, con las 3 filas de separación exigidas entre cada una', async () => {
    const bufferPlantilla = await readFile(RUTA_PLANTILLA);
    const dto = construirDto(3);
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: dto.fichas });
    expect(out.length).toBeGreaterThan(0);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet('Mano de Obra')!;
    // Ficha 1: filas 1-52. Separación: 53-55 (3 filas vacías). Ficha 2: 56-107.
    for (let fila = 53; fila <= 55; fila++) {
      expect(ws.getCell(`C${fila}`).value).toBeNull();
    }
    // Ficha 2 arranca en la fila 56 (r=56); el nombre del cargo se escribe
    // en A{r+1} = A57 (ver generar-excel-mano-obra.ts, escribirFicha).
    expect(ws.getCell('A57').value).toBe('SUPERVISOR');
  });
});
