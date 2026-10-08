/**
 * Cargos de mano de obra para Contratos (módulo 5 del puente). La pantalla de costos manda cada LÍNEA de cargo con el costo
 * que ella misma calculó (laboral + dotación, EPP, exámenes, cursos y vacunas + bonos no prestacionales), más las líneas
 * automáticas de turnantes: juntas suman exactamente el total de Mano de Obra del panel de Resumen. Aquí no se calcula
 * ningún costo: solo se valida lo recibido y se pasa a la forma que pide el puente.
 */

/** Una línea de cargo tal como la dejó la pantalla de costos. */
export interface CargoPantallaDto {
  id: number;
  nombre: string;
  /** Trabajadores de la línea (los que multiplican el costo por trabajador). */
  cantidad: number;
  horasSemana: number | null;
  /** Horas de la jornada diaria; null si la línea no la tiene (p. ej. el turnante automático). */
  jornada: number | null;
  salario: number | null;
  /** Clase de riesgo ARL en romano: I a V. */
  arlKey: string;
  codigoHorario: string;
  /** Costo mensual de TODA la línea, con A.I.U. NO incluido y antes de IVA. */
  valorTotal: number;
  esTurnante: boolean;
}

/** Forma que recibe el puente (`cargos[]` del contrato v1). */
export interface CargoPayload {
  nombre: string | null;
  cantidad: number | null;
  horasSemana: number | null;
  jornada: number | null;
  salario: number | null;
  riesgo: number | null;
  valorUnitario: number | null;
  valorTotal: number | null;
  codigoHorario: string | null;
}

const MAX_LINEAS = 300;
/** Holgura de pesos por línea al comparar la suma de las líneas con el total de Mano de Obra (cada total ya viene redondeado al peso). */
const HOLGURA_POR_LINEA = 1;

const ARL: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5 };

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finito = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const finitoONulo = (v: unknown): v is number | null => v === null || finito(v);

export type ResultadoCargos = { ok: true; cargos: CargoPantallaDto[] } | { ok: false; errores: string[] };

/**
 * Valida la lista que manda la pantalla y comprueba que las líneas sumen el total de Mano de Obra del panel (con 1 peso de
 * holgura por línea): si no cuadran, algo se extrajo mal y NO se envía nada a Contratos.
 */
export function validarCargosPantalla(valor: unknown, totalManoObra: number): ResultadoCargos {
  if (!Array.isArray(valor)) return { ok: false, errores: ['cargos debe ser una lista.'] };
  if (valor.length > MAX_LINEAS) return { ok: false, errores: [`cargos tiene demasiadas líneas (máximo ${MAX_LINEAS}).`] };
  const errores: string[] = [];
  valor.forEach((c, i) => {
    if (!esObjeto(c)) return void errores.push(`cargos[${i}] debe ser un objeto.`);
    if (!Number.isInteger(c.id)) errores.push(`cargos[${i}].id debe ser un entero.`);
    if (typeof c.nombre !== 'string') errores.push(`cargos[${i}].nombre debe ser texto.`);
    if (!finito(c.cantidad) || c.cantidad < 0) errores.push(`cargos[${i}].cantidad debe ser un número ≥ 0.`);
    if (!finito(c.valorTotal) || c.valorTotal < 0) errores.push(`cargos[${i}].valorTotal debe ser un número ≥ 0.`);
    for (const k of ['horasSemana', 'jornada', 'salario'] as const) if (!finitoONulo(c[k])) errores.push(`cargos[${i}].${k} debe ser un número o null.`);
    if (typeof c.arlKey !== 'string') errores.push(`cargos[${i}].arlKey debe ser texto.`);
    if (typeof c.codigoHorario !== 'string') errores.push(`cargos[${i}].codigoHorario debe ser texto.`);
    if (typeof c.esTurnante !== 'boolean') errores.push(`cargos[${i}].esTurnante debe ser verdadero o falso.`);
  });
  if (errores.length > 0) return { ok: false, errores };

  const cargos = valor as CargoPantallaDto[];
  const suma = cargos.reduce((s, c) => s + c.valorTotal, 0);
  if (Math.abs(suma - totalManoObra) > (cargos.length + 1) * HOLGURA_POR_LINEA) {
    return { ok: false, errores: [`Los cargos no cuadran con la Mano de Obra del panel: suman ${Math.round(suma)} y el total es ${Math.round(totalManoObra)}.`] };
  }
  return { ok: true, cargos };
}

const texto = (v: string) => (v.trim() ? v.trim() : null);

/**
 * Las columnas de Contratos son enteros (horas por semana, salario, personas) o tienen 2 decimales (jornada): se redondea a
 * esa escala. El valor unitario es el total de la línea ÷ sus trabajadores, así `unitario × cantidad = total` siempre.
 * Las líneas sin trabajadores (costo 0) no se envían.
 */
export function cargosParaPuente(cargos: CargoPantallaDto[]): CargoPayload[] {
  return cargos
    .filter((c) => c.cantidad > 0)
    .map((c) => {
      const cantidad = Math.round(c.cantidad);
      return {
        nombre: texto(c.nombre),
        cantidad: cantidad >= 1 ? cantidad : 1,
        horasSemana: c.horasSemana === null || c.horasSemana <= 0 ? null : Math.round(c.horasSemana),
        // Sin jornada diaria (el turnante automático) se envía 0, nunca una cifra inventada.
        jornada: c.jornada === null || c.jornada <= 0 ? 0 : Math.round(c.jornada * 100) / 100,
        salario: c.salario === null || c.salario <= 0 ? null : Math.round(c.salario),
        riesgo: ARL[c.arlKey.trim().toUpperCase()] ?? null,
        valorUnitario: c.valorTotal / (cantidad >= 1 ? cantidad : 1),
        valorTotal: c.valorTotal,
        codigoHorario: texto(c.codigoHorario),
      };
    });
}
