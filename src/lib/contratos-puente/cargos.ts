/**
 * Cargos de mano de obra para Contratos (módulo 5 del puente). La pantalla de costos manda cada LÍNEA de cargo con el costo
 * que ella misma calculó (laboral + dotación, EPP, exámenes, cursos y vacunas + bonos no prestacionales), más las líneas
 * automáticas de turnantes: juntas suman exactamente el total de Mano de Obra del panel de Resumen. Aquí no se calcula
 * ningún costo: solo se valida lo recibido y se pasa a la forma que pide el puente.
 */

/**
 * Códigos de grupo que usa la línea en Dotación/EPP, Exámenes y Cursos, tal como vienen del catálogo del almacén (los mismos
 * de Contratos: M### y F### dotación, EP### EPP, EM### exámenes, GC### cursos). La pantalla manda todos los que encuentra.
 */
export interface GruposCargoDto {
  dotacionMasculina: string[];
  dotacionFemenina: string[];
  epp: string[];
  examenes: string[];
  cursos: string[];
}

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
  /** Ausente en pantallas anteriores a este dato: equivale a «sin grupos». */
  grupos?: GruposCargoDto;
  /** Código del cargo en la nómina de la UEN, si quien envía lo eligió (si no, el puente lo cruza por el nombre). */
  codigoNomina?: number | null;
  /** Tarifa de Contratos a la que va la línea (1, 2, …) cuando la oferta lleva varias; sin ella, la 1. */
  tarifa?: number | null;
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
  /** Grupo de cada tipo cuando la línea usa EXACTAMENTE uno (Contratos guarda un grupo por cargo); si no, null. */
  grupoDotacionMasculina: string | null;
  grupoDotacionFemenina: string | null;
  grupoEpp: string | null;
  grupoExamen: string | null;
  grupoCurso: string | null;
  /** Solo si quien envía eligió el cargo de nómina (`<base de nómina>.cargos.codigo`). */
  codigoNomina?: number;
  /** Consecutivo de su tarifa, solo cuando no es la 1. */
  tarifa?: number;
}

/** Formato de cada código de grupo en Contratos (columnas dotm char(4), dotf char(4), epp, examen y cod_grupo_curso char(5)). */
const FORMATO_GRUPO: Record<keyof GruposCargoDto, RegExp> = {
  dotacionMasculina: /^M\d{3}$/,
  dotacionFemenina: /^F\d{3}$/,
  epp: /^EP\d{3}$/,
  examenes: /^EM\d{3}$/,
  cursos: /^(?:GC|CU)\d{3}$/,
};
/** Como en Contratos, M000 / F000 significan «sin dotación». */
const SIN_GRUPO = new Set(['M000', 'F000']);

/** Los códigos válidos y distintos de un tipo (mayúsculas, sin espacios). Lo que no tiene el formato no es de ese tipo. */
export function gruposValidos(codigos: readonly string[] | undefined, tipo: keyof GruposCargoDto): string[] {
  const vistos = new Set<string>();
  for (const c of codigos ?? []) {
    const codigo = String(c ?? '').trim().toUpperCase();
    if (FORMATO_GRUPO[tipo].test(codigo) && !SIN_GRUPO.has(codigo)) vistos.add(codigo);
  }
  return [...vistos].sort();
}

const grupoUnico = (codigos: readonly string[] | undefined, tipo: keyof GruposCargoDto) => {
  const validos = gruposValidos(codigos, tipo);
  return validos.length === 1 ? validos[0] : null;
};

const NOMBRE_TIPO: Record<keyof GruposCargoDto, string> = {
  dotacionMasculina: 'dotación masculina',
  dotacionFemenina: 'dotación femenina',
  epp: 'EPP',
  examenes: 'exámenes',
  cursos: 'cursos',
};

/**
 * Líneas que usan MÁS de un grupo de un mismo tipo: Contratos guarda uno solo por cargo, así que ese grupo no se envía y
 * se completa en Contratos. Nunca se elige uno al azar.
 */
export function avisosGruposCargos(cargos: CargoPantallaDto[]): string[] {
  const avisos: string[] = [];
  for (const c of cargos.filter((x) => x.cantidad > 0)) {
    for (const tipo of Object.keys(FORMATO_GRUPO) as (keyof GruposCargoDto)[]) {
      const validos = gruposValidos(c.grupos?.[tipo], tipo);
      if (validos.length > 1) avisos.push(`«${c.nombre.trim()}» usa varios grupos de ${NOMBRE_TIPO[tipo]} (${validos.join(', ')})`);
    }
  }
  return avisos;
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
    if (c.codigoNomina !== undefined && c.codigoNomina !== null && !(Number.isInteger(c.codigoNomina) && (c.codigoNomina as number) > 0)) {
      errores.push(`cargos[${i}].codigoNomina debe ser un entero positivo o null.`);
    }
    if (c.grupos !== undefined) {
      const g = c.grupos;
      const bien = esObjeto(g) && (Object.keys(FORMATO_GRUPO) as (keyof GruposCargoDto)[]).every((t) => Array.isArray(g[t]) && (g[t] as unknown[]).every((x) => typeof x === 'string'));
      if (!bien) errores.push(`cargos[${i}].grupos debe traer listas de códigos (dotacionMasculina, dotacionFemenina, epp, examenes, cursos).`);
    }
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
/** La línea va a una tarifa distinta de la 1 (solo entonces viaja el dato). */
export const enOtraTarifa = (t: unknown) => typeof t === 'number' && Number.isInteger(t) && t > 1;

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
        grupoDotacionMasculina: grupoUnico(c.grupos?.dotacionMasculina, 'dotacionMasculina'),
        grupoDotacionFemenina: grupoUnico(c.grupos?.dotacionFemenina, 'dotacionFemenina'),
        grupoEpp: grupoUnico(c.grupos?.epp, 'epp'),
        grupoExamen: grupoUnico(c.grupos?.examenes, 'examenes'),
        grupoCurso: grupoUnico(c.grupos?.cursos, 'cursos'),
        ...(typeof c.codigoNomina === 'number' ? { codigoNomina: c.codigoNomina } : {}),
        ...(enOtraTarifa(c.tarifa) ? { tarifa: c.tarifa as number } : {}),
      };
    });
}
