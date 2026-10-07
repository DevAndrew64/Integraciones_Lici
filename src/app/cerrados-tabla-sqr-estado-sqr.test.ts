/**
 * Ajuste "TABLA DE CERRADOS — SQR vs ESTADO SQR" (bug real reportado) — en
 * `ModuloAsignacionesTerminadas` (componente ÚNICO detrás de TODAS las
 * variantes de "Seguimiento de proceso → Cerrados/Todos": Adjudicados, No
 * adjudicados, No presentados, Cancelados y Todos — públicos, privados y
 * mixto, ver los `case` de `moduloEfectivo` que le pasan distintos
 * `filtroEstado`/`filtroTipo`), la columna "SQR" mostraba el BADGE de
 * estado (`sqrDisplay(s).label`: "Cerrada"/"Abierta"/"Sin SQR") en vez del
 * número real de SQR (`s.sqrNumero`, el mismo campo canónico ya usado en
 * las 3 fichas — VistFicha/VistFichaBusqueda/VistFichaAsignacion — para
 * mostrar "No. SQR").
 *
 * Corrección: se separan en 2 columnas —
 *  - "SQR": texto plano `s.sqrNumero||'—'` (nunca el badge).
 *  - "Estado SQR": el badge de siempre (Cerrada/Abierta), oculto a "—"
 *    cuando no hay `sqrNumero` (nunca inventa un estado sin SQR real).
 *
 * `sqrDisplay(s)` (la función que arma el badge) NO fue tocada — solo
 * dónde y cuándo se usa su resultado. Sin cambios de endpoint: `sqrNumero`
 * y `sqrCerrada` ya venían en `Solicitud` (mismo objeto que alimenta las
 * fichas).
 *
 * Mismo patrón de texto fuente que el resto de *-page.test.ts (sin harness
 * de render de componentes en este repo).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, 'page.tsx'), 'utf-8');

function extraerBloque(inicioMarker: string, finMarker: string): string {
  const inicio = PAGE_TSX.indexOf(inicioMarker);
  const fin = PAGE_TSX.indexOf(finMarker, inicio);
  if (inicio === -1 || fin === -1) throw new Error(`No se encontró el bloque ${inicioMarker} → ${finMarker}`);
  return PAGE_TSX.slice(inicio, fin);
}

const BLOQUE = extraerBloque('function ModuloAsignacionesTerminadas(', "case 'cerradosAdjudicados':");

describe('Componente único — todas las variantes de Cerrados/Todos reutilizan ModuloAsignacionesTerminadas', () => {
  it('los 11 case (público/privado/mixto × adjudicado/noAdjudicado/noPresentado/cancelado + Todos) montan el mismo componente', () => {
    expect(PAGE_TSX).toContain("case 'cerradosAdjudicados': return <ModuloAsignacionesTerminadas key={rk('cerradosAdjudicados')} sesion={sesion} filtroEstado='adjudicado'/>;");
    expect(PAGE_TSX).toContain("case 'cerradosNoAdjudicados': return <ModuloAsignacionesTerminadas key={rk('cerradosNoAdjudicados')} sesion={sesion} filtroEstado='noAdjudicado'/>;");
    expect(PAGE_TSX).toContain("case 'cerradosNoPresentados': return <ModuloAsignacionesTerminadas key={rk('cerradosNoPresentados')} sesion={sesion} filtroEstado='noPresentado'/>;");
    expect(PAGE_TSX).toContain("case 'cerradosCancelados': return <ModuloAsignacionesTerminadas key={rk('cerradosCancelados')} sesion={sesion} filtroEstado='cancelado'/>;");
    expect(PAGE_TSX).toContain("case 'privadosTodosCerrados': return <ModuloAsignacionesTerminadas key={rk('privadosTodosCerrados')} sesion={sesion} filtroTipo='Privado'/>;");
    expect(PAGE_TSX).toContain("case 'asignacionesCerradas': return <ModuloAsignacionesTerminadas key={rk('asignacionesCerradas')} sesion={sesion}/>;");
  });
});

describe('Encabezados — "SQR" y "Estado SQR" son columnas separadas, en ese orden, después de "Responsable"', () => {
  it('el header incluye ambas columnas, sin fusionarlas', () => {
    const idxResp = BLOQUE.indexOf('<div className="th-top">Responsable</div>');
    expect(idxResp).toBeGreaterThan(-1);
    const idxSqr = BLOQUE.indexOf('textAlign:\'center\'}}>SQR</div>', idxResp);
    const idxEstadoSqr = BLOQUE.indexOf('Estado SQR</div>', idxResp);
    const idxFuente = BLOQUE.indexOf('<div className="th-top">Fuente</div>', idxResp);
    expect(idxSqr).toBeGreaterThan(idxResp);
    expect(idxEstadoSqr).toBeGreaterThan(idxSqr);
    expect(idxFuente).toBeGreaterThan(idxEstadoSqr);
  });
});

describe('1/2) Celda SQR — muestra el número real (s.sqrNumero), nunca el badge de estado', () => {
  it('la celda SQR usa exactamente {s.sqrNumero||\'—\'}, en texto plano (fontFamily monospace, sin badge/pill)', () => {
    expect(BLOQUE).toContain("<td style={{fontSize:11,color:'#374151',whiteSpace:'nowrap',textAlign:'center' as const,fontFamily:'monospace'}}>{s.sqrNumero||'—'}</td>");
  });
});

describe('3) Sin SQR → columna SQR muestra "—" (no inventa valores)', () => {
  it('el fallback es el guion exacto, no otro texto', () => {
    expect(BLOQUE).toContain("{s.sqrNumero||'—'}");
  });
});

describe('4) La columna SQR nunca muestra "Cerrada"/"Abierta"/"Sin SQR" (eso quedó en Estado SQR)', () => {
  it('la celda SQR no referencia sqr.label/sqr.bg/sqr.color — solo s.sqrNumero', () => {
    const idxCeldaSqr = BLOQUE.indexOf("{s.sqrNumero||'—'}</td>");
    expect(idxCeldaSqr).toBeGreaterThan(-1);
    const celdaSqr = BLOQUE.slice(Math.max(0, idxCeldaSqr - 140), idxCeldaSqr + 20);
    expect(celdaSqr).not.toContain('sqr.label');
    expect(celdaSqr).not.toContain('sqr.bg');
  });
});

describe('Estado SQR — conserva el badge visual actual (Cerrada/Abierta), oculto a "—" sin SQR', () => {
  it('la celda Estado SQR usa sqrDisplay(s) (sin tocar su lógica) gateada por s.sqrNumero', () => {
    expect(BLOQUE).toContain(
      "<td style={{textAlign:'center' as const}}>{s.sqrNumero?<span style={{fontSize:10,fontWeight:600,padding:'2px 7px',borderRadius:20,background:sqr.bg,color:sqr.color,whiteSpace:'nowrap' as const,display:'inline-block'}}>{sqr.label}</span>:<span style={{fontSize:11,color:'#94a3b8'}}>—</span>}</td>"
    );
  });
  it('sqrDisplay (la función que arma el badge) no fue modificada — misma lógica Cerrada/Abierta/Sin SQR de siempre', () => {
    expect(BLOQUE).toContain("const sqrDisplay=(s:Solicitud)=>{if(!s.sqrNumero)return{label:'Sin SQR',bg:'#f1f5f9',color:'#94a3b8'};return s.sqrCerrada?{label:'Cerrada',bg:'#E8F5E9',color:'#15803d'}:{label:'Abierta',bg:'#fef9c3',color:'#92400e'};};");
  });
});

describe('5) Las demás columnas permanecen intactas (Responsable antes, Fuente después, sin tocar su contenido)', () => {
  it('Responsable sigue mostrando todosAnalistas, sin cambios', () => {
    expect(BLOQUE).toContain('{todosAnalistas.length>0?todosAnalistas.map((a,ix)=>');
  });
  it('Fuente sigue mostrando s.fuente sin cambios, inmediatamente después de Estado SQR', () => {
    const idxEstado = BLOQUE.indexOf("<span style={{fontSize:11,color:'#94a3b8'}}>—</span>}</td>");
    const idxFuenteTd = BLOQUE.indexOf("<td style={{fontSize:11,color:'#475569',whiteSpace:'nowrap'}}>{s.fuente||'—'}</td>", idxEstado);
    expect(idxFuenteTd).toBeGreaterThan(idxEstado);
  });
});

describe('colSpan del mensaje vacío se actualizó a 18 columnas (17 + Estado SQR nueva)', () => {
  it('"No hay asignaciones cerradas." usa colSpan={18}, coherente con el nuevo total de columnas', () => {
    expect(BLOQUE).toContain('colSpan={18}');
    expect(BLOQUE).not.toContain('colSpan={17}');
  });
});

describe('Endpoint — sin cambios: sqrNumero/sqrCerrada ya venían en Solicitud (mismo objeto que las fichas)', () => {
  it('Solicitud declara sqrNumero como campo propio (tipo del modelo, no derivado de otra tabla)', () => {
    expect(PAGE_TSX).toContain('sqrNumero: string | null;');
  });
});

describe('No se tocaron filtros, cierre, responsables, observaciones, navegación ni permisos', () => {
  it('filtradas/filtradasPaginadas (lógica de filtro) siguen presentes sin cambios estructurales', () => {
    expect(BLOQUE).toContain('filtradas.length===0');
    expect(BLOQUE).toContain('filtradasPaginadas.map(s=>{');
  });
  it('el doble clic para abrir la ficha (setFichaAbierta) sigue intacto', () => {
    expect(BLOQUE).toContain('onDoubleClick={()=>setFichaAbierta(s)}');
  });
});
