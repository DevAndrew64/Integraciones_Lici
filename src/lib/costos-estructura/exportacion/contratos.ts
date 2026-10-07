import ExcelJS from 'exceljs';
import { escribirTituloHoja, escribirEncabezados, autoAjustarColumnas, FORMATO_MONEDA } from './estilos-hoja-simple';
import type { TotalesPantallaDto } from './costos-pantalla';

/**
 * Hoja «Contratos» — los datos de la oferta con los NOMBRES del formulario «Contratos» (VFP) y en el orden de sus
 * pestañas, para digitarlos o copiarlos sin reescribir. Solo incluye lo que LiciColba ya tiene (Solicitud, totales de
 * la pantalla y el snapshot guardado del módulo Resultado): lo demás (fechas, forma de pago…) se digita en Contratos.
 * No recalcula nada ni escribe en ningún sistema.
 */

export interface SolicitudContratos {
  id: number;
  codigoProceso: string | null;
  entidad: string | null;
  objeto: string | null;
  nitContacto: string | null;
  direccionContacto: string | null;
  estadoSolicitud: string;
  asignaciones: unknown;
}

/** Snapshot que guarda el módulo «Resultado» del costeo (ver `construirDatosEntradaResultado` en page.tsx). */
export interface ResultadoGuardado {
  subtotalAntesIva?: unknown;
  valorMesIncluidoIva?: unknown;
  porcentajeIU?: unknown;
  vigenciaMeses?: unknown;
}

export interface CampoContratos {
  pestana: string;
  campo: string;
  valor: string | number | null;
  formato?: 'moneda';
}

/** ¿La última asignación cerró la solicitud como adjudicada? (mismo criterio que el informe de procesos adjudicados). */
export function esAdjudicada(s: { asignaciones: unknown }): boolean {
  const asignaciones = Array.isArray(s.asignaciones) ? s.asignaciones : [];
  const ultima = asignaciones[asignaciones.length - 1] as { estadoRevision?: unknown } | undefined;
  return ultima?.estadoRevision === 'CERRADO_ADJUDICADO';
}

/**
 * `CostoEstructura` solo se vincula a la Solicitud por el código de proceso (texto): puede haber varias. Se prefiere la
 * adjudicada; si no hay, la primera (la más reciente). `ambigua` avisa que hubo más de una candidata.
 */
export function elegirSolicitud<T extends { asignaciones: unknown }>(candidatas: T[]): { solicitud: T; ambigua: boolean } | null {
  const solicitud = candidatas.find(esAdjudicada) ?? candidatas[0];
  return solicitud ? { solicitud, ambigua: candidatas.length > 1 } : null;
}

const texto = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
const numero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * % A.I.U. = (Administración + Imprevistos + Utilidad) ÷ costos directos. El costeo guarda solo el % de I.U.; la «A» son
 * los Costos Administrativos, y el I.U. se aplica sobre (directos + administrativos), igual que `calcularTarifaServicio`.
 * `null` si falta el % de I.U. configurado o no hay costos directos.
 */
export function porcentajeAIU(t: TotalesPantallaDto, porcentajeIU: unknown): number | null {
  const iu = numero(porcentajeIU);
  const directos = t.manoObra + t.insumos + t.maquinaria;
  if (iu === null || !(directos > 0)) return null;
  const valorIU = ((directos + t.administrativos) * iu) / 100;
  return Math.round(((t.administrativos + valorIU) / directos) * 10000) / 100;
}

export function camposFormularioContratos(d: {
  solicitud: SolicitudContratos | null;
  totales: TotalesPantallaDto;
  resultado: ResultadoGuardado | null;
}): CampoContratos[] {
  const { solicitud: s, totales: t, resultado: r } = d;
  const aiu = porcentajeAIU(t, r?.porcentajeIU);
  return [
    { pestana: 'Encabezado', campo: 'Nombre o Razón Social Cliente', valor: texto(s?.entidad) },
    { pestana: 'Datos Generales', campo: 'Nit', valor: texto(s?.nitContacto) },
    { pestana: 'Datos Generales', campo: 'Dirección', valor: texto(s?.direccionContacto) },
    { pestana: 'Datos Generales', campo: 'Descripción', valor: texto(s?.objeto) },
    { pestana: 'Datos Generales', campo: '% A.I.U.', valor: aiu },
    // Decisión de Contratos: el valor del contrato es MENSUAL (el valor comercial mensual final del costeo, con IVA).
    { pestana: 'Datos Generales', campo: 'Valor Contrato (mensual, incluye IVA)', valor: numero(r?.valorMesIncluidoIva), formato: 'moneda' },
    { pestana: 'Datos Generales', campo: 'Valor mensual antes de IVA (referencia)', valor: numero(r?.subtotalAntesIva), formato: 'moneda' },
    { pestana: 'Datos Generales', campo: 'Plazo de ejecución (meses) — para calcular «Fecha Final»', valor: numero(r?.vigenciaMeses) },
    { pestana: 'Mic Hoja 1/4', campo: 'Objeto', valor: texto(s?.objeto) },
    { pestana: 'Operación del Contrato', campo: '% AIU', valor: aiu },
    { pestana: 'Operación del Contrato', campo: 'Vr. Mano Obra', valor: t.manoObra, formato: 'moneda' },
    { pestana: 'Operación del Contrato', campo: 'Vr. Insumos', valor: t.insumos, formato: 'moneda' },
    { pestana: 'Operación del Contrato', campo: 'Vr. Maquinaria', valor: t.maquinaria, formato: 'moneda' },
    { pestana: 'Operación del Contrato', campo: 'Costos Admtivos.', valor: t.administrativos, formato: 'moneda' },
    { pestana: 'Operación del Contrato', campo: 'Vlrs. Agregados', valor: t.valorAgregado, formato: 'moneda' },
    { pestana: 'Operación del Contrato', campo: 'Servs. No Conts.', valor: t.serviciosNoContinuos, formato: 'moneda' },
  ];
}

export function escribirHojaContratos(
  wb: ExcelJS.Workbook,
  datos: {
    procesoCodigo: string | null;
    procesoNombre: string | null;
    solicitud: { solicitud: SolicitudContratos; ambigua: boolean } | null;
    totales: TotalesPantallaDto;
    resultado: ResultadoGuardado | null;
  },
): void {
  const ws = wb.addWorksheet('Contratos');
  let fila = escribirTituloHoja(ws, 'FORMULARIO CONTRATOS — DATOS DE LA OFERTA', datos.procesoNombre ?? undefined);

  const sol = datos.solicitud?.solicitud ?? null;
  const origen = !sol
    ? 'Sin solicitud con este código de proceso: razón social, NIT, dirección y descripción quedan vacíos.'
    : `Solicitud #${sol.id} — ${esAdjudicada(sol) ? 'Adjudicada' : sol.estadoSolicitud}` +
      (datos.solicitud?.ambigua ? ' (hay más de una solicitud con este código: verifique que sea la correcta)' : '');
  ws.getCell(`A${fila}`).value = 'Proceso (LiciColba)';
  ws.getCell(`B${fila}`).value = datos.procesoCodigo ?? '—';
  fila++;
  ws.getCell(`A${fila}`).value = 'Origen de los datos';
  ws.getCell(`B${fila}`).value = origen;
  fila += 2;

  escribirEncabezados(ws, fila, ['Pestaña', 'Campo del formulario', 'Valor']);
  fila++;
  for (const c of camposFormularioContratos({ solicitud: sol, totales: datos.totales, resultado: datos.resultado })) {
    ws.getCell(`A${fila}`).value = c.pestana;
    ws.getCell(`B${fila}`).value = c.campo;
    const celda = ws.getCell(`C${fila}`);
    celda.value = c.valor ?? 'Completar en Contratos';
    if (c.valor === null) celda.font = { italic: true, color: { argb: 'FF92400E' } };
    else if (c.formato === 'moneda') celda.numFmt = FORMATO_MONEDA;
    fila++;
  }
  ws.getCell(`A${fila + 1}`).value = 'El resto de campos del formulario se digita en Contratos.';
  ws.getCell(`A${fila + 1}`).font = { italic: true };

  autoAjustarColumnas(ws, [24, 56, 44]);
}
