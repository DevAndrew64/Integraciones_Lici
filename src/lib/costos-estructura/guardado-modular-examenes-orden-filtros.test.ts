/**
 * Ajuste "CORREGIR ORDEN DE FILTROS Y TRATAMIENTO DE LA FECHA EN EL
 * CATÁLOGO DE EXÁMENES MÉDICOS" + "CORREGIR SELECTOR DE EXÁMENES
 * MÉDICOS" + "AJUSTA ACÁ" (feedback en vivo: se retiraron NIT
 * proveedor/Cód. municipio/Valor desde/Valor hasta como filtros del
 * selector) — verificación de cableado en page.tsx.
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

describe('§2/§3) Orden exacto de filtros del selector de Exámenes (reducido a 4: Buscar, Cód. grupo, Cód. examen, Ciudad)', () => {
  it('Cód. grupo, Cód. examen, Ciudad, Limpiar filtros — NIT proveedor/Cód. municipio/Valor desde/Valor hasta ya NO son filtros de este selector', () => {
    const b = bloque('Seleccionar exámenes médicos', 'Sin resultados para los filtros actuales').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    const idxGrupo = b.indexOf('Cód. grupo');
    const idxExamen = b.indexOf('Cód. examen');
    const idxCiudad = b.indexOf('>Ciudad<');
    const idxLimpiar = b.indexOf('>Limpiar filtros<');
    expect(idxGrupo).toBeGreaterThan(-1);
    expect(idxExamen).toBeGreaterThan(idxGrupo);
    expect(idxCiudad).toBeGreaterThan(idxExamen);
    expect(idxLimpiar).toBeGreaterThan(idxCiudad);
    expect(b).not.toContain('NIT proveedor');
    expect(b).not.toContain('Cód. municipio');
    expect(b).not.toContain('Valor desde');
    expect(b).not.toContain('Valor hasta');
  });
});

describe('§6) Limpiar filtros — reinicio completo en una sola consulta', () => {
  it('limpiarFiltrosExamenes resetea los 3 filtros + búsqueda + página 1 en una única llamada', () => {
    const b = bloque('const limpiarFiltrosExamenes=()=>{', '};');
    expect(b).toContain("setSelExamQ('')");
    expect(b).toContain("setSelExamGrupoF('')");
    expect(b).toContain("setSelExamCodigoF('')");
    expect(b).toContain("setSelExamCiudadF('')");
    expect(b).toContain("consultarCatalogExam(1,{grupo:'',q:'',codExamen:'',ciudad:''});");
  });

  it('consultarCatalogExam acepta filtrosOverride (grupo/q/codExamen/ciudad) para no depender del estado aún no aplicado (mismo patrón que Dotación/EPP)', () => {
    expect(PAGE_TSX).toContain('const consultarCatalogExam=async(pagina:number=1,filtrosOverride?:{grupo?:string;q?:string;codExamen?:string;ciudad?:string})=>{');
    expect(PAGE_TSX).toContain('const grupo=filtrosOverride?.grupo??selExamGrupoF;');
  });

  it('limpiar filtros nunca toca contextoExamCursoVacuna ni selExamSeleccion (cargo/sujeto/selección ya marcada se conservan)', () => {
    const b = bloque('const limpiarFiltrosExamenes=()=>{', '};');
    expect(b).not.toContain('setContextoExamCursoVacuna');
    expect(b).not.toContain('setSelExamSeleccion');
  });
});

describe('Ajuste "CORREGIR SELECTOR DE EXÁMENES MÉDICOS" — grupo/cód. examen/ciudad hacen debounce server-side (nunca un filtrado visual sobre la página recibida)', () => {
  it('onChangeSelExamGrupoF (y análogos) usan el debounce COMPARTIDO dispararFiltroExamDebounced (400ms), sin esperar a "Consultar"', () => {
    const b = bloque('const onChangeSelExamGrupoF=', '};');
    expect(b).toContain('setSelExamGrupoF(v);dispararFiltroExamDebounced({grupo:v});');
    const bShared = bloque('const dispararFiltroExamDebounced=', '};');
    expect(bShared).toContain('if(selExamFiltroDebounceRef.current)clearTimeout(selExamFiltroDebounceRef.current);');
    expect(bShared).toContain('selExamFiltroDebounceRef.current=setTimeout(()=>consultarCatalogExam(1,override),400);');
  });

  it('cód. examen y ciudad TAMBIÉN hacen debounce server-side', () => {
    expect(PAGE_TSX).toContain('const onChangeSelExamCodigoF=(v:string)=>{setSelExamCodigoF(v);dispararFiltroExamDebounced({codExamen:v});};');
    expect(PAGE_TSX).toContain('const onChangeSelExamCiudadF=(v:string)=>{setSelExamCiudadF(v);dispararFiltroExamDebounced({ciudad:v});};');
  });

  it('el input de Cód. grupo usa el handler con debounce, nunca solo setSelExamGrupoF', () => {
    expect(PAGE_TSX).toContain("value={selExamGrupoF} onChange={e=>onChangeSelExamGrupoF(e.target.value)}");
  });

  it('limpiar filtros y cerrar el selector cancelan el debounce pendiente (nunca dispara una consulta después de limpiar/cerrar)', () => {
    const bLimpiar = bloque('const limpiarFiltrosExamenes=()=>{', '};');
    expect(bLimpiar).toContain('if(selExamFiltroDebounceRef.current)clearTimeout(selExamFiltroDebounceRef.current);');
    const bCerrar = bloque('const cerrarSelectorExam=()=>{', '};');
    expect(bCerrar).toContain('if(selExamFiltroDebounceRef.current)clearTimeout(selExamFiltroDebounceRef.current);');
  });
});

describe('§7) Columnas del catálogo — Ciudad y Proveedor combinados, sin "Últ. compra"', () => {
  it('la tabla no tiene columna "Últ. compra" ni fecha para catálogo', () => {
    const b = bloque('GRUPO</th>', '</tbody>');
    expect(b).not.toContain('Últ. compra');
    expect(b).not.toContain('fechaUltimaCompra');
  });

  it('Ajuste "QUE SE VEA ASI ORGANIZADA Y CLARA COMO LA DE IMAGEN 1" — PROVEEDOR/CIUDAD son una sola línea (NIT/codmun pasan a tooltip, nunca una segunda línea visible que ensucie la fila)', () => {
    const b = bloque('{filasPaginaExam.map((r,i)=>{', '</tbody>');
    expect(b).toContain('r.nombre_proveedor');
    expect(b).toContain('title={`NIT ${nitRow}`}');
    expect(b).toContain('r.codmun');
    expect(b).toContain('title={`Cód. municipio ${codmunRow}`}');
  });
});

describe('§8) EX001 — "×2" visible sin alterar el valor mostrado', () => {
  it('la fila del selector muestra el badge "×2" para EX001, en la misma línea del nombre (no una segunda línea), sin modificar la celda VALOR', () => {
    const b = bloque('{filasPaginaExam.map((r,i)=>{', '</tbody>');
    expect(b).toContain('factorRow>1&&');
    expect(b).toContain('>×{factorRow}<');
  });
});

// Ajuste "QUITAR BADGE AZUL DE OFERTAS" (feedback en vivo) — el badge azul
// ×{r.numOfertas} (ofertas agrupadas del mismo examen) se retira del
// selector; el naranja ×{factorRow} (multiplicador de tarifa, ej. EX001)
// es un dato completamente distinto y se conserva sin cambios. La
// agrupación/cálculo de ofertas (agrupar-examenes.ts, que produce
// numOfertas) tampoco se toca — solo deja de mostrarse en la UI.
describe('Ajuste "QUITAR BADGE AZUL DE OFERTAS" — ×numOfertas desaparece de la UI, ×factorRow se conserva intacto', () => {
  it('no se renderiza el badge azul ×{r.numOfertas} en la fila del selector', () => {
    const b = bloque('{filasPaginaExam.map((r,i)=>{', '</tbody>');
    expect(b).not.toContain('r.numOfertas>1&&');
    expect(b).not.toContain('×{r.numOfertas}');
    expect(b).not.toContain("color:'#1e40af',background:'#eff6ff'");
  });

  it('el badge naranja ×{factorRow} (multiplicador de tarifa) sigue existiendo, sin cambios de estilo ni de condición', () => {
    const b = bloque('{filasPaginaExam.map((r,i)=>{', '</tbody>');
    expect(b).toContain("{factorRow>1&&<span style={{fontSize:9.5,fontWeight:700,color:'#b45309',background:'#fef3e2',padding:'1px 6px',borderRadius:20,whiteSpace:'nowrap' as const,flexShrink:0}}>×{factorRow}</span>}");
  });

  it('el campo numOfertas y su cálculo en agrupar-examenes.ts (agrupación real de ofertas) no se tocan — solo se dejó de consumir en la UI', () => {
    const agruparExamenesTs = readFileSync(join(__dirname, '../examenes/agrupar-examenes.ts'), 'utf-8');
    expect(agruparExamenesTs).toContain('numOfertas: number;');
    expect(agruparExamenesTs).toContain('numOfertas: grupo.length,');
  });
});
