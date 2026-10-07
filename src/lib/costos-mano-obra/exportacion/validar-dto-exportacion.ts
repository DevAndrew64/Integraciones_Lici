// src/lib/costos-mano-obra/exportacion/validar-dto-exportacion.ts
// Ajuste "IMPLEMENTAR EXPORTACIÓN DE MANO DE OBRA..." §5 — el servidor no
// reconstruye la liquidación laboral (eso vive en page.tsx), pero SÍ
// valida que el DTO recibido sea internamente consistente: tipos/límites
// razonables y las reconciliaciones aritméticas de cada bloque. Puro, sin
// Prisma/React/fetch — reutilizable por la ruta y por las pruebas.
import type { ExportacionManoObraDto, FichaManoObraExportDto, DetalleUnitarioExportDto } from './tipos-exportacion';

/** `ruta` — identifica el campo exacto en notación `fichas[N].campo`
 * (o `fichas[N].turnante.campo`/`fichas[N].detalleUnitario.campo` para
 * anidados), para que el mensaje de error sea localizable sin ambigüedad
 * aunque el DTO tenga decenas de fichas — nunca solo "DTO_INVALIDO". */
export interface ErrorValidacionDto { fichaId?: string; indice?: number; campo: string; mensaje: string; ruta: string }
export interface ResultadoValidacionDto { ok: boolean; errores: ErrorValidacionDto[] }

const TOLERANCIA_PESOS = 1; // §5-C — redondeo máximo tolerado, un peso.

function esFinitoNoNegativo(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

function cerca(a: number, b: number, tolerancia = TOLERANCIA_PESOS): boolean {
  return Math.abs(a - b) <= tolerancia;
}

const MAX_FICHAS = 500; // §5-B — límite razonable, evita payloads absurdos.

function rutaFicha(indice: number, campo: string): string {
  return `fichas[${indice}].${campo}`;
}

function validarDetalleUnitario(indice: number, fichaId: string, d: DetalleUnitarioExportDto, errores: ErrorValidacionDto[]) {
  const campos = Object.keys(d) as (keyof DetalleUnitarioExportDto)[];
  for (const campo of campos) {
    if (!esFinitoNoNegativo(d[campo])) errores.push({ fichaId, indice, campo, ruta: rutaFicha(indice, `detalleUnitario.${campo}`), mensaje: `${campo} debe ser un número finito no negativo.` });
  }
  if (errores.some(e => e.indice === indice)) return; // evita reconciliar sobre datos ya inválidos

  const totalRecargosCalc = d.recargoNocturno + d.horaExtraDiurna + d.horaExtraNocturna + d.dominicalesFestivos + d.horaExtraFestiva + d.horaExtraFestivaNocturna + d.recargoNocturnoFestivo;
  if (!cerca(totalRecargosCalc, d.totalRecargos)) errores.push({ fichaId, indice, campo: 'totalRecargos', ruta: rutaFicha(indice, 'detalleUnitario.totalRecargos'), mensaje: `No reconcilia: suma de conceptos=${totalRecargosCalc}, enviado=${d.totalRecargos}.` });

  const subtotalSalarialCalc = d.salarioBasico + d.bonoPrestacional + d.totalRecargos + d.auxilioTransporte;
  if (!cerca(subtotalSalarialCalc, d.subtotalSalarial)) errores.push({ fichaId, indice, campo: 'subtotalSalarial', ruta: rutaFicha(indice, 'detalleUnitario.subtotalSalarial'), mensaje: `No reconcilia: calculado=${subtotalSalarialCalc}, enviado=${d.subtotalSalarial}.` });

  const totalPrestacionesCalc = d.cesantias + d.prima + d.vacaciones + d.interesesCesantias;
  if (!cerca(totalPrestacionesCalc, d.totalPrestaciones)) errores.push({ fichaId, indice, campo: 'totalPrestaciones', ruta: rutaFicha(indice, 'detalleUnitario.totalPrestaciones'), mensaje: `No reconcilia: calculado=${totalPrestacionesCalc}, enviado=${d.totalPrestaciones}.` });

  const totalSeguridadSocialCalc = d.salud + d.pension + d.arl;
  if (!cerca(totalSeguridadSocialCalc, d.totalSeguridadSocial)) errores.push({ fichaId, indice, campo: 'totalSeguridadSocial', ruta: rutaFicha(indice, 'detalleUnitario.totalSeguridadSocial'), mensaje: `No reconcilia: calculado=${totalSeguridadSocialCalc}, enviado=${d.totalSeguridadSocial}.` });

  const totalParafiscalesCalc = d.cajaCompensacion + d.sena + d.icbf;
  if (!cerca(totalParafiscalesCalc, d.totalParafiscales)) errores.push({ fichaId, indice, campo: 'totalParafiscales', ruta: rutaFicha(indice, 'detalleUnitario.totalParafiscales'), mensaje: `No reconcilia: calculado=${totalParafiscalesCalc}, enviado=${d.totalParafiscales}.` });

  const totalOtrosCostosCalc = d.dotacion + d.epp + d.examenes + d.cursos + d.vacunas;
  if (!cerca(totalOtrosCostosCalc, d.totalOtrosCostos)) errores.push({ fichaId, indice, campo: 'totalOtrosCostos', ruta: rutaFicha(indice, 'detalleUnitario.totalOtrosCostos'), mensaje: `No reconcilia: calculado=${totalOtrosCostosCalc}, enviado=${d.totalOtrosCostos}.` });

  const costoLaboralUnitarioCalc = d.subtotalSalarial + d.totalPrestaciones + d.totalSeguridadSocial + d.totalParafiscales + d.totalOtrosCostos + d.bonosNoPrestacionales;
  if (!cerca(costoLaboralUnitarioCalc, d.costoLaboralUnitario)) errores.push({ fichaId, indice, campo: 'costoLaboralUnitario', ruta: rutaFicha(indice, 'detalleUnitario.costoLaboralUnitario'), mensaje: `No reconcilia: calculado=${costoLaboralUnitarioCalc}, enviado=${d.costoLaboralUnitario}.` });
}

function validarFicha(indice: number, f: FichaManoObraExportDto, errores: ErrorValidacionDto[]) {
  if (!f.fichaId || typeof f.fichaId !== 'string') { errores.push({ indice, campo: 'fichaId', ruta: rutaFicha(indice, 'fichaId'), mensaje: 'fichaId es obligatorio.' }); return; }
  if (f.tipo !== 'CARGO' && f.tipo !== 'TURNANTE') errores.push({ fichaId: f.fichaId, indice, campo: 'tipo', ruta: rutaFicha(indice, 'tipo'), mensaje: 'tipo debe ser CARGO o TURNANTE.' });
  if (!f.cargo || !f.cargo.trim()) errores.push({ fichaId: f.fichaId, indice, campo: 'cargo', ruta: rutaFicha(indice, 'cargo'), mensaje: 'cargo es obligatorio.' });
  if (!Number.isInteger(f.cantidadTrabajadores) || f.cantidadTrabajadores < 0 || f.cantidadTrabajadores > 100000) {
    errores.push({ fichaId: f.fichaId, indice, campo: 'cantidadTrabajadores', ruta: rutaFicha(indice, 'cantidadTrabajadores'), mensaje: 'cantidadTrabajadores debe ser un entero razonable (0-100000).' });
  }
  if (!esFinitoNoNegativo(f.horasSemanales)) errores.push({ fichaId: f.fichaId, indice, campo: 'horasSemanales', ruta: rutaFicha(indice, 'horasSemanales'), mensaje: 'horasSemanales debe ser un número finito no negativo.' });
  if (!esFinitoNoNegativo(f.totalCargo)) errores.push({ fichaId: f.fichaId, indice, campo: 'totalCargo', ruta: rutaFicha(indice, 'totalCargo'), mensaje: 'totalCargo debe ser un número finito no negativo.' });

  validarDetalleUnitario(indice, f.fichaId, f.detalleUnitario, errores);

  // §5-D — turnantes proporcionales: el bloque `turnante` se valida antes
  // de reconciliar `totalCargo`, porque el factor de proporcionalidad
  // (aplicado SOLO al total final, nunca fila por fila — decisión
  // explícita "OJO EL TURNANTE DEBE TENER LA MISMA FICHA DE LIQUIDACION
  // DE 42H Y AL FINAL ES QUE SE COLOCA EL FACTOR") viene de ahí.
  let factorProporcional = 1;
  if (f.tipo === 'TURNANTE') {
    if (!f.turnante) { errores.push({ fichaId: f.fichaId, indice, campo: 'turnante', ruta: rutaFicha(indice, 'turnante'), mensaje: 'Una ficha TURNANTE requiere el bloque turnante.' }); return; }
    const t = f.turnante;
    const camposTurnante: (keyof typeof t)[] = ['coberturaHoras', 'diasEquivalentes', 'factorNumerador', 'factorDenominador', 'costoReferencia42Horas', 'cantidadTurnantesFisicos'];
    for (const campo of camposTurnante) if (!esFinitoNoNegativo(t[campo])) errores.push({ fichaId: f.fichaId, indice, campo: `turnante.${campo}`, ruta: rutaFicha(indice, `turnante.${campo}`), mensaje: `turnante.${campo} debe ser un número finito no negativo.` });
    // `costoReferencia42Horas` debe coincidir con el costo unitario COMPLETO
    // de la ficha (la ficha ya NO se escala fila por fila; el factor se
    // aplica una sola vez, más abajo, sobre totalCargo).
    if (!errores.some(e => e.indice === indice && e.campo === 'costoLaboralUnitario') && esFinitoNoNegativo(t.costoReferencia42Horas)) {
      if (!cerca(t.costoReferencia42Horas, f.detalleUnitario.costoLaboralUnitario)) {
        errores.push({ fichaId: f.fichaId, indice, campo: 'turnante.costoReferencia42Horas', ruta: rutaFicha(indice, 'turnante.costoReferencia42Horas'), mensaje: `No reconcilia: costoReferencia42Horas=${t.costoReferencia42Horas}, detalleUnitario.costoLaboralUnitario=${f.detalleUnitario.costoLaboralUnitario}.` });
      }
    }
    if (t.factorDenominador > 0) factorProporcional = t.factorNumerador / t.factorDenominador;
  }

  if (!errores.some(e => e.indice === indice && e.campo === 'costoLaboralUnitario') && esFinitoNoNegativo(f.cantidadTrabajadores)) {
    const totalCargoCalc = f.detalleUnitario.costoLaboralUnitario * f.cantidadTrabajadores * factorProporcional;
    if (!cerca(totalCargoCalc, f.totalCargo)) errores.push({ fichaId: f.fichaId, indice, campo: 'totalCargo', ruta: rutaFicha(indice, 'totalCargo'), mensaje: `No reconcilia: costoLaboralUnitario×cantidadTrabajadores${f.tipo === 'TURNANTE' ? '×factorProporcional' : ''}=${totalCargoCalc}, enviado=${f.totalCargo}.` });
  }
}

/** §7 — sanitización contra inyección de fórmulas: un texto que empiece
 * por =,+,-,@ nunca se escribe literal en una celda de Excel (Excel lo
 * interpretaría como fórmula). Se antepone un apóstrofe, igual que hace
 * Excel/Sheets nativamente al pegar texto "forzado a texto". */
export function sanearTextoExcel(texto: string): string {
  if (/^[=+\-@]/.test(texto)) return `'${texto}`;
  return texto;
}

export function validarDtoExportacion(dto: ExportacionManoObraDto): ResultadoValidacionDto {
  const errores: ErrorValidacionDto[] = [];
  if (!dto || typeof dto !== 'object') return { ok: false, errores: [{ campo: 'dto', ruta: 'dto', mensaje: 'DTO ausente o inválido.' }] };
  if (!dto.estructuraCostoId) errores.push({ campo: 'estructuraCostoId', ruta: 'estructuraCostoId', mensaje: 'estructuraCostoId es obligatorio.' });
  if (!dto.procesoId) errores.push({ campo: 'procesoId', ruta: 'procesoId', mensaje: 'procesoId es obligatorio.' });
  if (!Array.isArray(dto.fichas) || dto.fichas.length === 0) {
    errores.push({ campo: 'fichas', ruta: 'fichas', mensaje: 'Debe incluir al menos una ficha.' });
    return { ok: false, errores };
  }
  if (dto.fichas.length > MAX_FICHAS) errores.push({ campo: 'fichas', ruta: 'fichas', mensaje: `Demasiadas fichas (máximo ${MAX_FICHAS}).` });

  const idsVistos = new Map<string, number>();
  dto.fichas.forEach((f, indice) => {
    if (f.fichaId) {
      const otroIndice = idsVistos.get(f.fichaId);
      if (otroIndice !== undefined) {
        errores.push({ fichaId: f.fichaId, indice, campo: 'fichaId', ruta: rutaFicha(indice, 'fichaId'), mensaje: `fichaId duplicado dentro del DTO (ya usado en fichas[${otroIndice}]).` });
      } else {
        idsVistos.set(f.fichaId, indice);
      }
    }
    validarFicha(indice, f, errores);
  });
  return { ok: errores.length === 0, errores };
}
