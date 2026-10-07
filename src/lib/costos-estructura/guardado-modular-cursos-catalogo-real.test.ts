/**
 * Ajuste "ACLARACIÓN FUNCIONAL — SÍ EXISTE API REAL DE CURSOS" —
 * verificación de cableado en page.tsx del selector "Seleccionar cursos"
 * (consume /api/cursos/grupos y /api/cursos, nunca llama grupocolba.com
 * directamente desde el navegador). Mismo patrón de texto exacto que el
 * resto de guardado-modular-*.test.ts.
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

describe('§2) No se llama la API externa de cursos desde el frontend', () => {
  it('el selector de cursos consume /api/cursos/grupos y /api/cursos, nunca grupocolba.com', () => {
    const b = bloque('const consultarCatalogCurso=async(', "const hayFiltrosActivosCurso=");
    expect(b).toContain("fetch('/api/cursos'");
    expect(b).not.toContain('grupocolba.com');
    const bGrupos = bloque("fetch('/api/cursos/grupos'", ');', PAGE_TSX.indexOf('const [gruposCursoDisponibles'));
    expect(bGrupos).not.toContain('grupocolba.com');
  });
});

describe('§7) La sección Cursos del modal principal ofrece catálogo + manual', () => {
  it('seccionCursosTabla recibe onAgregarCatalogo (abrirSelectorCursoParaLinea), no solo manual', () => {
    expect(PAGE_TSX).toContain('{seccionCursosTabla(linea,cursosDeLinea,delCurso,()=>abrirModalManual(\'CURSO\',linea),()=>abrirSelectorCursoParaLinea(linea))}');
  });
});

describe('§8/§9) Filtros del selector "Seleccionar cursos" en el orden pedido', () => {
  const idxSelectorCurso = PAGE_TSX.indexOf('{showSelCurso&&(()=>{');

  // Ajuste "SIMPLIFICAR FILTROS DE 'SELECCIONAR CURSOS'" (feedback en
  // vivo) — se retiran NIT proveedor/Cód. municipio/Valor desde/Valor
  // hasta de la UI (quedaban redundantes con la búsqueda de texto libre
  // y generaban ruido visual). El estado/consulta al servidor de esos 4
  // filtros NO se tocó (sigue existiendo, simplemente ya no hay input
  // que los cambie) — solo Cód. grupo/Cód. curso/Ciudad/Limpiar quedan
  // visibles.
  it('Cód. grupo/Cód. curso en fila 1, Ciudad/Limpiar en fila 2 — sin NIT proveedor/Cód. municipio/Valor desde/Valor hasta', () => {
    const bFiltros = bloque('Seleccionar cursos', 'Sin resultados para los filtros actuales', idxSelectorCurso);
    const idxGrupo = bFiltros.indexOf('Cód. grupo');
    const idxCurso = bFiltros.indexOf('Cód. curso');
    const idxCiudad = bFiltros.indexOf('>Ciudad<');
    const idxLimpiar = bFiltros.indexOf('Limpiar filtros');
    expect(idxGrupo).toBeGreaterThan(-1);
    expect(idxCurso).toBeGreaterThan(idxGrupo);
    expect(idxCiudad).toBeGreaterThan(idxCurso);
    expect(idxLimpiar).toBeGreaterThan(idxCiudad);
    expect(bFiltros).not.toContain('NIT proveedor');
    expect(bFiltros).not.toContain('Cód. municipio');
    expect(bFiltros).not.toContain('Valor desde');
    expect(bFiltros).not.toContain('Valor hasta');
  });
});

describe('§9) Cód. grupo se alimenta de grupo_cursos, nunca texto libre', () => {
  it('el filtro de grupo es un <select> poblado por gruposCursoDisponibles', () => {
    const idxSelectorCurso = PAGE_TSX.indexOf('{showSelCurso&&(()=>{');
    const b = bloque('Cód. grupo</div>', 'Cód. curso</div>', idxSelectorCurso);
    expect(b).toContain('<select value={selCursoGrupoF}');
    expect(b).toContain('gruposCursoDisponibles.map(g=>');
  });
});

describe('§10/§11) Identidad del registro y columnas del catálogo', () => {
  // Corrección "CORREGIR KEYS DUPLICADAS EN 'SELECCIONAR CURSOS'" —
  // codigoGrupo+codigoCurso+nitProveedor+codigoMunicipio ya NO basta:
  // confirmado en vivo que la misma combinación puede tener varias
  // ofertas reales que solo difieren en el valor de reentrenamiento (la
  // fuente no entrega ningún id/consecutivo propio). La identidad ahora
  // es la fila completa — mismos campos que el backend usa para
  // deduplicar filas idénticas byte a byte (route.ts).
  it('identidadFilaCurso usa la fila completa (grupo+curso+descripción+NIT+proveedor+municipio+ciudad+ambos valores) — ninguna oferta real puede colisionar ni desaparecer', () => {
    const inicio = PAGE_TSX.indexOf('const identidadFilaCurso=(r:CursoCatalogoNormalizado)=>[');
    expect(inicio).toBeGreaterThan(-1);
    const b = PAGE_TSX.slice(inicio, inicio + 300);
    expect(b).toContain('r.codigoGrupo,r.codigoCurso,r.descripcionCurso,r.nitProveedor,r.nombreProveedor,');
    expect(b).toContain('r.codigoMunicipio,r.ciudad,r.valorPrimeraVez,r.valorReentrenamiento,');
    expect(b).not.toContain('`${r.codigoGrupo}|${r.codigoCurso}|${r.nitProveedor}|${r.codigoMunicipio}`');
  });

  // Ajuste "COLUMNAS EXACTAS DEL SELECTOR DE CURSOS" (feedback en vivo) —
  // Proveedor/NIT se retiran de la tabla (nombreProveedor/nitProveedor
  // siguen en el objeto normalizado — ver identidadFilaCurso arriba —
  // nunca se pierden, solo dejan de mostrarse); Ciudad conserva sus 2
  // líneas (ciudad+cód.municipio); Primera vez/Reentrenamiento quedan
  // como columnas separadas, nunca una sola "VALOR" genérica.
  it('la tabla del selector muestra CÓD. GRUPO | CÓD. CURSO | CURSO | CIUDAD | VALOR PRIMERA VEZ | VALOR REENTRENAMIENTO, sin PROVEEDOR', () => {
    const idxSelectorCurso = PAGE_TSX.indexOf('{showSelCurso&&(()=>{');
    const bHead = bloque('CÓD. GRUPO</th>', '</thead>', idxSelectorCurso);
    expect(bHead).not.toContain('PROVEEDOR');
    expect(bHead).toContain('CÓD. CURSO</th>');
    expect(bHead).toContain('CURSO</th>');
    expect(bHead).toContain('CIUDAD</th>');
    expect(bHead).toContain('VALOR PRIMERA VEZ</th>');
    expect(bHead).toContain('VALOR REENTRENAMIENTO</th>');
    const bBody = bloque('CÓD. GRUPO</th>', '</tbody>', idxSelectorCurso);
    expect(bBody).not.toContain('NIT {r.nitProveedor');
    expect(bBody).not.toContain('r.nombreProveedor');
    expect(bBody).toContain('r.codigoMunicipio');
    expect(bBody).toContain('{fmtV(r.valorPrimeraVez)}');
    expect(bBody).toContain('{fmtV(r.valorReentrenamiento)}');
  });
});

describe('§9 (respuesta) Dos valores por curso — Primera vez / Reentrenamiento', () => {
  it('agregarSeleccionadosCurso guarda ambos valores originales + tipoValorSeleccionado + valor aplicado', () => {
    const b = bloque('const agregarSeleccionadosCurso=()=>{', 'cerrarSelectorCurso();');
    expect(b).toContain('valorPrimeraVez:r.valorPrimeraVez,valorReentrenamiento:r.valorReentrenamiento,');
    expect(b).toContain('tipoValorSeleccionado:tipoValor,');
    expect(b).toContain("origen:'CATALOGO'");
  });

  // Ajuste "QUE SEAN SOLO PRIMERA VEZ" — el selector de catálogo de cursos
  // retiró la opción de elegir Reentrenamiento: un clic en la fila
  // selecciona/deselecciona SIEMPRE con tipoValor 'PRIMERA_VEZ' (el valor
  // de Reentrenamiento sigue viajando en el modelo para trazabilidad,
  // nunca se ofrece como opción seleccionable aquí).
  it('toggleSelCurso selecciona la fila con tipoValor SIEMPRE PRIMERA_VEZ, nunca ofrece Reentrenamiento como opción', () => {
    const b = bloque('const toggleSelCurso=', 'const cerrarSelectorCurso=');
    expect(b).toContain("if(m.has(key))m.delete(key);else m.set(key,{fila:r,tipoValor:'PRIMERA_VEZ'});");
    expect(b).not.toContain('REENTRENAMIENTO');
  });

  it('un curso sin valor de Primera vez deshabilita la fila completa, nunca la reemplaza', () => {
    const inicio = PAGE_TSX.indexOf('{filasPaginaCurso.map((r,i)=>{');
    const bloqueTabla = PAGE_TSX.slice(inicio, inicio + 2500);
    expect(bloqueTabla).toContain('const sinValor=r.valorPrimeraVez==null;');
    expect(bloqueTabla).toContain('disabled={sinValor}');
    expect(bloqueTabla).not.toContain("'REENTRENAMIENTO'");
  });

  // Ajuste "AHORA EN CURSOS IGUAL... SERIA LA MISMA FORMULA" (feedback en
  // vivo) — revierte "CURSOS NO SE AMORTIZA": Cursos divide entre
  // frecAnios×12 (mensualRowCurso), igual que Exámenes; requerimiento 5
  // (auditoría) — Vacunas también divide entre su frecuencia en meses
  // (resolverValorMensualVacuna, factor-examen.ts, única fuente real).
  it('vacunas usa resolverValorMensualVacuna (÷frecuencia); cursos usa mensualRowCurso (÷frecAnios×12)', () => {
    const b = bloque('const mensualRowCurso=(r:{cant:number;valor:number;frecAnios:number})=>', 'const cursos:ItemCostoResuelto[]=cursosRows');
    expect(b).toContain('const mensualRowCurso=(r:{cant:number;valor:number;frecAnios:number})=>r.cant*r.valor/((r.frecAnios||1)*12);');
    expect(PAGE_TSX).toContain('.map(r=>({valorMensual:resolverValorMensualVacuna(r)}));');
  });
});

describe('§17) Compatibilidad histórica — cursos sin campos de catálogo', () => {
  it('la hidratación nunca fuerza origen CATALOGO/codigoGrupo/proveedor para cursos históricos', () => {
    const b = bloque('const cursosRowsCrudo=', 'setCursosRows(cursosRowsD);');
    expect(b).toContain("origen:r.origen??('MANUAL' as const)");
    expect(b).not.toContain("origen:'CATALOGO'");
  });
});

// Ajuste "IMPLEMENTAR CATÁLOGO DE VACUNAS EN EL MÓDULO DE EXÁMENES, CURSOS
// Y VACUNAS" — revierte §18: Vacunas SÍ tiene ahora un selector de
// catálogo, pero es una fuente LOCAL estática (CATALOGO_VACUNAS, 19
// registros, src/data/costos-estructura/catalogo-vacunas.ts), nunca la
// API externa real de Cursos (grupocolba.com) — arquitecturas
// deliberadamente distintas, cubierto con detalle en
// guardado-modular-catalogo-vacunas.test.ts.
describe('§18) Vacunas tiene su propio catálogo LOCAL (nunca reutiliza la API externa de Cursos)', () => {
  it('el selector de catálogo de Vacunas no llama a grupocolba.com ni a /api/cursos', () => {
    const inicio = PAGE_TSX.indexOf('const abrirSelectorVacunaParaLinea=');
    expect(inicio).toBeGreaterThan(-1);
    const bloque = PAGE_TSX.slice(inicio, inicio + 400);
    expect(bloque).not.toContain('grupocolba.com');
    expect(bloque).not.toContain("fetch('/api/cursos'");
  });
});

describe('Corrección "CORREGIR KEYS DUPLICADAS EN SELECCIONAR CURSOS" — dos ofertas del mismo curso con distinto valor se seleccionan/agregan de forma independiente', () => {
  it('agregarSeleccionadosCurso compara también valorPrimeraVez/valorReentrenamiento al detectar duplicados — dos ofertas con distinto precio NUNCA se omiten entre sí', () => {
    const b = bloque('const agregarSeleccionadosCurso=()=>{', 'cerrarSelectorCurso();');
    expect(b).toContain('c.valorPrimeraVez===r.valorPrimeraVez&&c.valorReentrenamiento===r.valorReentrenamiento');
  });

  it('toggleSelCurso usa identidadFilaCurso (única fuente) para marcar/desmarcar en el Map — nunca una llave propia', () => {
    const b = bloque('const toggleSelCurso=(r:CursoCatalogoNormalizado)=>{', '\n  };');
    expect(b).toContain('const key=identidadFilaCurso(r);');
  });

  it('la fila de la tabla del selector (key/checkbox/selected) lee la MISMA identidadFilaCurso, nunca key+índice ni un cálculo propio', () => {
    const idxSelectorCurso = PAGE_TSX.indexOf('{showSelCurso&&(()=>{');
    const b = bloque('filasPaginaCurso.map((r,i)=>{', '</tbody>', idxSelectorCurso);
    expect(b).toContain('const key=identidadFilaCurso(r);');
    expect(b).toContain('const sel=selCursoSeleccion.get(key);');
    expect(b).toContain('<tr key={key||i}');
  });
});

// Ajuste "AVISO GRUPO SIN CURSOS VIGENTES" + "NOTA VALORES DEL CATÁLOGO
// EXTERNO" (confirmado en vivo contra grupocolba.com/service/public/api/
// cursos y grupo_cursos, empresa=vigi: el catálogo maestro de grupos
// devuelve 4 grupos —GC001..GC004— pero el catálogo real de cursos solo
// tiene filas para GC001; CU002 trae Primera vez $300.000/Reentrenamiento
// $120.000 EXACTAMENTE como responde la fuente, sin ningún campo
// intercambiado).
describe('Ajuste "AVISO GRUPO SIN CURSOS VIGENTES" — 0 filas con grupo seleccionado nunca es el genérico "Sin resultados"', () => {
  const idxSelectorCurso = () => PAGE_TSX.indexOf('{showSelCurso&&(()=>{');
  const bVacio = () => bloque(
    '{filasPaginaCurso.length===0&&!selCursoCarg&&(()=>{',
    "return <div style={{textAlign:'center' as const,padding:'40px 10px',color:'#6b7280',fontSize:13}}>Sin resultados para los filtros actuales.</div>;",
    idxSelectorCurso(),
  );

  it('con un grupo seleccionado, el mensaje usa código + descripción del grupo (gruposCursoDisponibles), nunca el genérico', () => {
    const b = bVacio();
    expect(b).toContain('if(selCursoGrupoF.trim()){');
    expect(b).toContain("const grupo=gruposCursoDisponibles.find(g=>g.codigoGrupo===selCursoGrupoF);");
    expect(b).toContain('const etiquetaGrupo=grupo?`${grupo.codigoGrupo} — ${grupo.nombreGrupo}`:selCursoGrupoF;');
    expect(b).toContain('No hay cursos vigentes disponibles para {etiquetaGrupo} en el catálogo externo.');
  });

  it('sin grupo seleccionado (solo texto/ciudad sin match), sigue mostrando el mensaje genérico "Sin resultados para los filtros actuales"', () => {
    expect(PAGE_TSX).toContain("return <div style={{textAlign:'center' as const,padding:'40px 10px',color:'#6b7280',fontSize:13}}>Sin resultados para los filtros actuales.</div>;");
  });

  it('el mensaje de grupo vacío (igual que el genérico) solo se renderiza cuando filasPaginaCurso.length===0 — un grupo que SÍ devuelve cursos (ej. GC001) nunca lo muestra', () => {
    expect(PAGE_TSX).toContain('{filasPaginaCurso.length===0&&!selCursoCarg&&(()=>{');
  });

  it('GC002/GC003/GC004 (grupos sin cursos vigentes hoy) NUNCA se ocultan del <select> — el dropdown lista gruposCursoDisponibles completo, sin filtrar por si tiene filas', () => {
    const b = bloque('Cód. grupo</div>', 'Cód. curso</div>', idxSelectorCurso());
    expect(b).toContain('{gruposCursoDisponibles.map(g=><option key={g.codigoGrupo} value={g.codigoGrupo}>{g.codigoGrupo} — {g.nombreGrupo}</option>)}');
    // Nunca un .filter(...) antes del .map — confirmaría que se excluyen grupos sin cursos.
    expect(b).not.toMatch(/gruposCursoDisponibles\.filter\(/);
  });

  it('nota informativa "Valores suministrados por el catálogo externo." aparece junto a la tabla de resultados (nunca marca los valores como error)', () => {
    const b = bloque('{filasPaginaCurso.length>0&&!selCursoCarg&&(<>', '<table', idxSelectorCurso());
    expect(b).toContain('Valores suministrados por el catálogo externo.');
  });

  it('valorPrimeraVez y valorReentrenamiento se muestran directamente (fmtV), en columnas separadas y en ese orden — nunca intercambiados ni recalculados', () => {
    const bHead = bloque('CÓD. GRUPO</th>', '</thead>', idxSelectorCurso());
    const idxPrimera = bHead.indexOf('VALOR PRIMERA VEZ</th>');
    const idxReentrena = bHead.indexOf('VALOR REENTRENAMIENTO</th>');
    expect(idxPrimera).toBeGreaterThan(-1);
    expect(idxReentrena).toBeGreaterThan(idxPrimera);
    const bBody = bloque('CÓD. GRUPO</th>', '</tbody>', idxSelectorCurso());
    const idxCeldaPrimera = bBody.indexOf('{fmtV(r.valorPrimeraVez)}');
    const idxCeldaReentrena = bBody.indexOf('{fmtV(r.valorReentrenamiento)}');
    expect(idxCeldaPrimera).toBeGreaterThan(-1);
    expect(idxCeldaReentrena).toBeGreaterThan(idxCeldaPrimera);
    // Ninguna expresión aritmética sobre estos campos en la celda — se
    // muestran tal cual llegan del backend (route.ts), sin transformación.
    expect(bBody).not.toMatch(/fmtV\(r\.valorPrimeraVez[*/+-]/);
    expect(bBody).not.toMatch(/fmtV\(r\.valorReentrenamiento[*/+-]/);
  });
});

// Ajuste "VR CURSO EDITABLE" (feedback en vivo) — la celda "Vr curso" de
// filaCursoTabla (tabla del modal "Registrar Exámenes, Cursos y Vacunas",
// distinta del selector de catálogo cubierto arriba) pasa de texto a input
// editable, mismo patrón monetario ya usado en Maquinaria (valorUnitario).
// Actualiza EXCLUSIVAMENTE r.valor (el valor de TRABAJO) vía
// actualizarCursoRow — valorPrimeraVez/valorReentrenamiento/
// tipoValorSeleccionado (el dato original del catálogo) nunca se tocan.
// Funciona igual para cursos de catálogo y manuales (misma fila).
describe('Ajuste "VR CURSO EDITABLE" — celda Vr curso de filaCursoTabla es un input, no texto', () => {
  const bFilaCursoTabla = () => bloque('const filaCursoTabla=(linea:typeof lineasManoObraDisponibles[number],r:CursoRow,eliminar:()=>void)=>{', 'const seccionCursosTabla=(');

  it('Vr curso es un <input type="text" inputMode="numeric"> con formato es-CO, no un <div> de solo lectura', () => {
    const b = bFilaCursoTabla();
    expect(b).toContain('type="text" inputMode="numeric" value={r.valor?\'$ \'+r.valor.toLocaleString(\'es-CO\'):\'\'}');
  });

  it('el onChange usa actualizarCursoRow(r.id,{valor:...}) con el mismo idiom de limpieza replace(/\\D/g,\'\') ya usado en Maquinaria — nunca parseFloat', () => {
    const b = bFilaCursoTabla();
    expect(b).toContain("onChange={e=>actualizarCursoRow(r.id,{valor:Number(e.target.value.replace(/\\D/g,''))||0})}");
    expect(b).not.toContain('parseFloat');
  });

  it('editar Vr curso NUNCA escribe valorPrimeraVez/valorReentrenamiento/tipoValorSeleccionado — solo valor', () => {
    const b = bFilaCursoTabla();
    const idxInput = b.indexOf("onChange={e=>actualizarCursoRow(r.id,{valor:Number(e.target.value.replace(/\\D/g,''))||0})}");
    expect(idxInput).toBeGreaterThan(-1);
    // El propio cambios pasado a actualizarCursoRow en este onChange es
    // {valor:...} y nada más — nunca {valor:...,valorPrimeraVez:...} etc.
    expect(b).not.toMatch(/actualizarCursoRow\(r\.id,\{valor:[^}]*valorPrimeraVez/);
    expect(b).not.toMatch(/actualizarCursoRow\(r\.id,\{valor:[^}]*valorReentrenamiento/);
    expect(b).not.toMatch(/actualizarCursoRow\(r\.id,\{valor:[^}]*tipoValorSeleccionado/);
  });

  it('actualizarCursoRow hace merge parcial ({...r,...cambios}) — por construcción, cambiar solo "valor" nunca toca los demás campos del registro', () => {
    expect(PAGE_TSX).toContain('const actualizarCursoRow=(id:number,cambios:Partial<CursoRow>)=>setCursosRows(p=>p.map(r=>r.id===id?{...r,...cambios}:r));');
  });

  it('el costo mensual sigue dependiendo de r.valor con la MISMA fórmula (r.cant*r.valor/((r.frecAnios||1)*12)) — se recalcula solo al reactivar el input, sin fórmula nueva', () => {
    const b = bFilaCursoTabla();
    expect(b).toContain('const mensual=r.cant*r.valor/((r.frecAnios||1)*12);');
    expect(b).toContain('{cop(mensual)}');
  });

  it('la fila (filaCursoTabla) es la MISMA para cursos de catálogo y manuales — no hay una condición de origen que oculte o reemplace el input de Vr curso', () => {
    const b = bFilaCursoTabla();
    const idxInput = b.indexOf("type=\"text\" inputMode=\"numeric\" value={r.valor?");
    // El único condicional de origen en toda la fila es esManual (para el
    // botón "Editar"), nunca envolviendo el input de Vr curso.
    const idxEsManualCond = b.indexOf('{esManual&&<button');
    expect(idxInput).toBeGreaterThan(-1);
    expect(idxEsManualCond).toBeGreaterThan(idxInput);
  });

  it('el valor editado persiste al reconstruir cursosRows desde el módulo guardado — la carga usa spread del registro persistido, nunca resetea "valor" a valorPrimeraVez', () => {
    const inicio = PAGE_TSX.indexOf('const cursosRowsD=(Array.isArray(cursosRowsCrudo)');
    expect(inicio).toBeGreaterThan(-1);
    const b = PAGE_TSX.slice(inicio, inicio + 250);
    expect(b).toContain('...r,alcance:r.alcance??');
    expect(b).not.toContain('valor:r.valorPrimeraVez');
  });
});
