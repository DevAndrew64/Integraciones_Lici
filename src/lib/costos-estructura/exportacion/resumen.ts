import ExcelJS from 'exceljs';
import { escribirTituloHoja, escribirEncabezados, autoAjustarColumnas, FORMATO_MONEDA } from './estilos-hoja-simple';
import type { ClaveModulo, EstadoModuloResultado } from '@/lib/costos-estructura/guardado-modular';
import type { TotalesPantallaDto } from './costos-pantalla';

export interface DatosResumenExport {
  procesoCodigo: string | null;
  procesoNombre: string | null;
  /** Cargos de Mano de Obra tal como los muestra la pantalla. */
  cargos: string[];
  nTrabajadores: number;
  /** Los mismos valores que muestra el panel de Resumen de la pantalla. */
  totales: TotalesPantallaDto;
  estados: Partial<Record<ClaveModulo, EstadoModuloResultado>>;
}

const ETIQUETA_ESTADO: Record<EstadoModuloResultado, string> = {
  NO_INICIADO: 'No iniciado', EN_PROGRESO: 'En progreso', COMPLETADO: 'Completado', NO_APLICA: 'No aplica',
};

const TEXTO_INCLUIDO_EN_MANO_OBRA = 'Incluido en Mano de Obra';

/**
 * Hoja Resumen — escribe tal cual los rubros y el TOTAL del panel de Resumen
 * de la pantalla (`totales`); no suma ni recalcula nada. EPP/Dotación y
 * Exámenes ya viajan dentro de Mano de Obra, igual que en la pantalla, así
 * que aquí solo se informa su estado.
 */
export function escribirHojaResumen(wb: ExcelJS.Workbook, datos: DatosResumenExport): void {
  const ws = wb.addWorksheet('Resumen');
  let fila = escribirTituloHoja(ws, 'RESUMEN DE LA ESTRUCTURA DE COSTOS', datos.procesoNombre ?? undefined);

  ws.getCell(`A${fila}`).value = 'No. proceso';
  ws.getCell(`B${fila}`).value = datos.procesoCodigo ?? '—';
  fila++;
  ws.getCell(`A${fila}`).value = 'Cargo';
  ws.getCell(`B${fila}`).value = datos.cargos.length > 0 ? datos.cargos.join(', ') : '—';
  fila++;
  ws.getCell(`A${fila}`).value = 'N.° de trabajadores';
  ws.getCell(`B${fila}`).value = datos.nTrabajadores;
  fila += 2;

  escribirEncabezados(ws, fila, ['Componente', 'Estado', 'Valor mensual']);
  fila++;

  const t = datos.totales;
  const componentes: { nombre: string; clave: ClaveModulo | null; valor: number; incluidoEnManoObra?: boolean }[] = [
    { nombre: 'Mano de Obra (incl. Turnantes)', clave: null, valor: t.manoObra },
    { nombre: 'EPP / Dotación', clave: 'dotacionEpp', valor: 0, incluidoEnManoObra: true },
    { nombre: 'Exámenes Médicos', clave: 'examenesMedicos', valor: 0, incluidoEnManoObra: true },
    { nombre: 'Insumos', clave: 'insumos', valor: t.insumos },
    { nombre: 'Maquinaria y Equipos', clave: 'maquinariaEquipos', valor: t.maquinaria },
    { nombre: 'Servicios no continuos', clave: null, valor: t.serviciosNoContinuos },
    { nombre: 'Valor agregado', clave: null, valor: t.valorAgregado },
    { nombre: 'Costos Administrativos', clave: null, valor: t.administrativos },
  ];
  const hayCostoIncluido = t.otrosCostosEnManoObra > 0;
  let hayIncluidoActivo = false;
  let hayCompletadoSinCosto = false;
  for (const c of componentes) {
    const estado = c.clave ? datos.estados[c.clave] : undefined;
    ws.getCell(`A${fila}`).value = c.nombre;
    ws.getCell(`B${fila}`).value = estado ? ETIQUETA_ESTADO[estado] : '—';
    const celdaValor = ws.getCell(`C${fila}`);
    if (c.incluidoEnManoObra) {
      // "Incluido en Mano de Obra" solo si la pantalla realmente trae costo de estos conceptos dentro de Mano de Obra.
      if (estado !== 'NO_APLICA' && hayCostoIncluido) { celdaValor.value = TEXTO_INCLUIDO_EN_MANO_OBRA; hayIncluidoActivo = true; }
      else {
        celdaValor.value = 0; celdaValor.numFmt = FORMATO_MONEDA;
        if (estado === 'COMPLETADO') hayCompletadoSinCosto = true;
      }
    } else {
      celdaValor.value = estado === 'NO_APLICA' ? 0 : c.valor;
      celdaValor.numFmt = FORMATO_MONEDA;
    }
    fila++;
  }
  ws.getCell(`A${fila}`).value = 'TOTAL';
  ws.getCell(`A${fila}`).font = { bold: true };
  const celdaTotal = ws.getCell(`C${fila}`);
  celdaTotal.value = t.total;
  celdaTotal.numFmt = FORMATO_MONEDA;
  celdaTotal.font = { bold: true };

  if (hayIncluidoActivo) {
    ws.getCell(`A${fila + 2}`).value = `Nota: Dotación, EPP, Exámenes, Cursos y Vacunas ya están incluidos en Mano de Obra (${Math.round(t.otrosCostosEnManoObra).toLocaleString('es-CO')} COP/mes); no se suman al TOTAL.`;
    ws.getCell(`A${fila + 2}`).font = { italic: true };
  } else if (hayCompletadoSinCosto) {
    ws.getCell(`A${fila + 2}`).value = 'Nota: EPP/Dotación y Exámenes están Completados, pero no hay costos asignados a los cargos vigentes de Mano de Obra; por eso aportan $0.';
    ws.getCell(`A${fila + 2}`).font = { italic: true };
  }

  autoAjustarColumnas(ws, [32, 16, 24]);
}
