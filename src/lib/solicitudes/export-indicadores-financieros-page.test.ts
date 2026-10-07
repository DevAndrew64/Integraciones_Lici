/**
 * Ajuste "HOJA INDICADORES EN EL EXPORT DE PROCESOS PÚBLICOS" — verificación
 * de cableado en `page.tsx` (`exportarTrazabilidad`), mismo patrón de
 * assertions sobre TEXTO exacto del código fuente ya usado en el resto de
 * *-page.test.ts (no hay arnés de render de componentes para page.tsx).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');

function bloque(inicioMarcador: string, finMarcador: string, desde = 0): string {
  const inicio = PAGE_TSX.indexOf(inicioMarcador, desde);
  if (inicio === -1) throw new Error(`No se encontró el marcador de inicio: ${inicioMarcador}`);
  const fin = PAGE_TSX.indexOf(finMarcador, inicio);
  if (fin === -1) throw new Error(`No se encontró el marcador de fin: ${finMarcador}`);
  return PAGE_TSX.slice(inicio, fin);
}

const B_EXPORTAR = bloque('const exportarTrazabilidad=async(tipo:', "finally{setExportando(false);}\n  };");

describe('exportarTrazabilidad — hoja "Indicadores", fuente distinta de las 8 hojas por estado', () => {
  it('fetchIndicadoresFinancieros solo se llama para el export público (tipo!==\'publico\' devuelve vacío, sin fetch)', () => {
    expect(B_EXPORTAR).toContain("if(tipo!=='publico')return[];");
    expect(B_EXPORTAR).toContain("fetch(`/api/solicitudes/indicadores-financieros?${qs}`)");
  });

  it('usa un endpoint DISTINTO de fetchLista (nunca lee indicadores del arreglo `asignaciones` recortado al último elemento)', () => {
    expect(B_EXPORTAR).toContain('const fetchIndicadoresFinancieros=async()');
    expect(B_EXPORTAR).not.toContain('indicadoresFinancieros=fetchLista');
  });

  it('la hoja "Indicadores" solo se agrega en el export público y cuando hay datos', () => {
    expect(B_EXPORTAR).toContain("if(tipo==='publico'&&indicadoresFinancieros.length>0){");
    expect(B_EXPORTAR).toContain("XLSX.utils.book_append_sheet(wb,wsInd,'Indicadores');");
  });

  it('las 8 hojas por estado existentes se conservan intactas (mismo arreglo `hojas`, sin tocar sus columnas)', () => {
    expect(B_EXPORTAR).toContain("const hojas:[string,Solicitud[],boolean][]=[['Por validar',porValidar,false],['En observación',enObservacion,true],['En ejecución',enEjecucion,false],['En evaluación',enEvaluacion,false],['Adjudicados',adjudicados,false],['No adjudicados',noAdjudicados,false],['No presentados',noPresentados,true],['Cancelados',cancelados,false]];");
  });

  it('las columnas de indicador son DINÁMICAS — se descubren los nombres realmente presentes, nunca una lista fija de 6 hardcodeada', () => {
    expect(B_EXPORTAR).toContain('const nombresIndicadoresDescubiertos:string[]=[];');
    expect(B_EXPORTAR).toContain('for(const nombre of Object.keys(p.indicadores)){');
    expect(B_EXPORTAR).not.toContain("['Liquidez','Endeudamiento'");
  });

  it('el orden de columnas prioriza el orden canónico ya usado en Observaciones (CAUSAS_ESPECIFICAS), nunca una segunda lista duplicada', () => {
    expect(B_EXPORTAR).toContain("const ordenCanonicoIndicadores=CAUSAS_ESPECIFICAS['Indicador']||[];");
    expect(B_EXPORTAR).toContain('...ordenCanonicoIndicadores.filter(n=>vistosIndicador.has(n)),');
    expect(B_EXPORTAR).toContain('...nombresIndicadoresDescubiertos.filter(n=>!ordenCanonicoIndicadores.includes(n)),');
  });

  it('encabezado: Modalidad primero, luego identificación del proceso + columnas dinámicas de indicador', () => {
    expect(B_EXPORTAR).toContain("const cabInd=['Modalidad','No. proceso','Entidad','Empresa','Objeto','Presupuesto oficial',...nombresIndicadores];");
  });

  it('Modalidad reutiliza modS (misma normalización que las otras 8 hojas), nunca una fórmula paralela', () => {
    const b = bloque('const filaInd=(p:IndicadorFinancieroExport)=>[', '];');
    expect(b).toContain('modS({modalidad:p.modalidad,objeto:p.objeto,nombreProceso:null}');
  });

  it('celdaIndicador: valor puramente numérico se escribe como número; cualquier otro texto (ej. "80%") se conserva tal cual, nunca se fuerza a porcentaje', () => {
    const b = bloque('const celdaIndicador=(v:string|undefined):number|string=>{', 'const filaInd=');
    expect(b).toContain('/^-?\\d+(\\.\\d+)?$/.test(t)?Number(t):t');
  });

  it('un indicador sin valor real para un proceso queda vacío, NUNCA se pone 0 automáticamente', () => {
    const b = bloque('const celdaIndicador=(v:string|undefined):number|string=>{', 'const filaInd=');
    expect(b).toContain("if(t==='')return'';");
    expect(b).not.toMatch(/return\s*0\s*;/);
  });

  it('presupuesto oficial reutiliza fmtValX (blanco si es null/0, nunca "0" por defecto) igual que las demás hojas', () => {
    expect(B_EXPORTAR).toContain('fmtValX(p.valor),...nombresIndicadores.map(n=>celdaIndicador(p.indicadores[n]))];');
  });

  it('formato moneda "$ #,##0" en la columna Presupuesto oficial, mismo formato que las demás hojas', () => {
    const b = bloque('if(tipo===\'publico\'&&indicadoresFinancieros.length>0){', "XLSX.utils.book_append_sheet(wb,wsInd,'Indicadores');");
    expect(b).toContain('wsInd[addr].z=\'"$" #,##0\'');
  });

  it('encabezado con el mismo estilo (fondo navy, fuente blanca) que las demás hojas', () => {
    const b = bloque('if(tipo===\'publico\'&&indicadoresFinancieros.length>0){', "XLSX.utils.book_append_sheet(wb,wsInd,'Indicadores');");
    expect(b).toContain("fill:{fgColor:{rgb:'0D2D5E'}}");
  });
});
