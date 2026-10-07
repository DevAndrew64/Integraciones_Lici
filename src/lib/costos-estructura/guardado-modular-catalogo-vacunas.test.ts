/**
 * Ajuste "IMPLEMENTAR CATÁLOGO DE VACUNAS EN EL MÓDULO DE EXÁMENES, CURSOS
 * Y VACUNAS" — verificación de cableado en page.tsx (texto fuente, mismo
 * patrón que el resto de guardado-modular-*.test.ts: no existe arnés de
 * render para este archivo de ~34.000 líneas). El catálogo en sí
 * (CATALOGO_VACUNAS: 19 registros, dos tarifas, esquema) se prueba por
 * separado en src/data/costos-estructura/catalogo-vacunas.test.ts.
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

describe('§1/§2) La sección Vacunas ofrece catálogo LOCAL + manual (mismo patrón visual que Cursos)', () => {
  it('seccionVacunasTabla recibe onAgregarCatalogo (abrirSelectorVacunaParaLinea), no solo manual', () => {
    expect(PAGE_TSX).toContain("{seccionVacunasTabla(linea,vacunasDeLinea,delVacuna,()=>abrirModalManual('VACUNA',linea),()=>abrirSelectorVacunaParaLinea(linea))}");
  });
  it('seccionVacunasTabla renderiza los dos botones: "Agregar desde catálogo" y "Agregar registro manual" (§16 — se mantiene el registro manual)', () => {
    const b = bloque('const seccionVacunasTabla=(', 'const seccionCategoria=');
    expect(b).toContain('Agregar desde catálogo');
    expect(b).toContain('Agregar registro manual');
    expect(b).toContain('onClick={onAgregarCatalogo}');
    expect(b).toContain('onClick={onAgregarManual}');
  });
});

describe('§2) El catálogo de Vacunas es una fuente LOCAL estática (nunca la API externa de Cursos)', () => {
  it('importa CATALOGO_VACUNAS desde src/data/costos-estructura/catalogo-vacunas, no una ruta absoluta de Windows', () => {
    expect(PAGE_TSX).toContain("import { CATALOGO_VACUNAS, type VacunaCatalogo } from '@/data/costos-estructura/catalogo-vacunas';");
  });
  it('el selector de vacunas no hace fetch a grupocolba.com ni a /api/cursos', () => {
    const inicio = PAGE_TSX.indexOf('const [showSelVacuna,setShowSelVacuna]=useState(false);');
    const fin = PAGE_TSX.indexOf('const agregarSeleccionadosVacuna=');
    const b = PAGE_TSX.slice(inicio, fin);
    expect(b).not.toContain('grupocolba.com');
    expect(b).not.toContain('fetch(');
  });
});

describe('§4) El buscador del modal filtra por código o nombre, insensible a mayúsculas y tildes', () => {
  it('catalogoVacunasFiltrado usa normTextoVacuna sobre codigo y nombre', () => {
    const b = bloque('const catalogoVacunasFiltrado=React.useMemo(', '},[selVacunaQ]);');
    expect(b).toContain('normTextoVacuna(v.codigo).includes(q)');
    expect(b).toContain('normTextoVacuna(v.nombre).includes(q)');
  });
  it('normTextoVacuna normaliza a minúsculas y elimina tildes (NFD + rango combining diacritics)', () => {
    expect(PAGE_TSX).toContain("const normTextoVacuna=(s:string)=>s.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'');");
  });
});

describe('§4/§5) Selección múltiple con contador y botón "Agregar selección"', () => {
  it('toggleSelVacuna usa un Map (selección múltiple), no un solo código', () => {
    expect(PAGE_TSX).toContain('const [selVacunaSeleccion,setSelVacunaSeleccion]=useState<Map<string,VacunaCatalogo>>(new Map());');
  });
  it('el JSX del modal muestra "seleccionado(s)" y el botón agregarSeleccionadosVacuna', () => {
    const inicioTitulo = PAGE_TSX.indexOf("<div style={{fontSize:14,fontWeight:700,color:NAVY}}>Seleccionar vacunas</div>");
    expect(inicioTitulo).toBeGreaterThan(-1);
    const inicioPie = PAGE_TSX.indexOf('onClick={agregarSeleccionadosVacuna}', inicioTitulo);
    expect(inicioPie).toBeGreaterThan(inicioTitulo);
    const b = PAGE_TSX.slice(inicioPie - 600, inicioPie + 300);
    expect(b).toContain('seleccionado');
  });
});

describe('§5/§6/§7) Tipo de tarifa visible y editable, nunca escogido en silencio', () => {
  it('el valor inicial del tipo de tarifa es "Público general" (visible/editable, nunca oculto)', () => {
    const b = bloque('const agregarSeleccionadosVacuna=()=>{', 'const cerrarModalManual=');
    expect(b).toContain("tipoTarifa:'PUBLICO_GENERAL'");
  });
  it('filaVacunaTabla muestra un <select> Preferencial/Público general que recalcula el valor al cambiar', () => {
    const b = bloque('const filaVacunaTabla=(', 'const seccionVacunasTabla=(');
    expect(b).toContain('<option value="PREFERENCIAL">Preferencial</option>');
    expect(b).toContain('<option value="PUBLICO_GENERAL">Público general</option>');
    expect(b).toContain('actualizarVacunaRow(r.id,{tipoTarifa:nuevoTipo,valor:nuevoValor})');
  });
});

describe('§6/§8) El esquema se muestra como referencia, nunca se usa para inferir dosis', () => {
  it('filaVacunaTabla muestra r.esquemaVacunacion como texto de apoyo, no como cantidad', () => {
    const b = bloque('const filaVacunaTabla=(', 'const seccionVacunasTabla=(');
    expect(b).toContain('r.esquemaVacunacion');
    expect(b).not.toContain('esquemaVacunacion.includes');
    expect(b).not.toContain("esquemaVacunacion==='POM'");
  });
});

// Ajuste (petición directa) "en vez de trab es frec en meses" — revierte
// §9/§10 del ajuste original: la tabla ya NO rastrea "cantidad de
// trabajadores" por fila (el headcount lo sigue aportando el cargo/línea,
// igual que Exámenes); en su lugar expone "Frec. (meses)" como dato
// informativo/editable (frecAnios), sin efecto en el total.
describe('§9/§10) Dosis por trabajador editable (inicia en 1); frecuencia en meses es informativa (nunca multiplica el total)', () => {
  it('agregarSeleccionadosVacuna inicia dosisPorTrabajador en 1, sin fijar una cantidadTrabajadores propia', () => {
    const b = bloque('const agregarSeleccionadosVacuna=()=>{', 'const cerrarModalManual=');
    expect(b).toContain('dosisPorTrabajador:1,');
    expect(b).not.toContain('cantidadTrabajadores:ctx.cantidadTrabajadores');
  });
  it('la tabla permite editar la frecuencia en meses (frecAnios) y dosisPorTrabajador por fila', () => {
    const b = bloque('const filaVacunaTabla=(', 'const seccionVacunasTabla=(');
    expect(b).toContain('actualizarVacunaRow(r.id,{frecAnios:(Number(e.target.value)||12)/12})');
    expect(b).toContain('actualizarVacunaRow(r.id,{dosisPorTrabajador:Number(e.target.value)||0})');
  });
  it('el registro manual de Vacunas expone "Cantidad" y "Dosis por trabajador" (dosisPorTrabajador nace en 1)', () => {
    expect(PAGE_TSX).toContain("dosisPorTrabajador:'1'");
    expect(PAGE_TSX).toContain("campo('Cantidad *'");
    expect(PAGE_TSX).toContain("campo('Dosis por trabajador *'");
  });
});

describe('§8) Fórmula de cálculo: total = (valorUnitario × dosisPorTrabajador) ÷ frecuenciaMeses (requerimiento 5 — auditoría)', () => {
  it('valorTotalVacunaFila usa resolverValorMensualVacuna (valor×dosis÷frecuencia), sin hardcodear el resultado', () => {
    expect(PAGE_TSX).toContain("const valorTotalVacunaFila=resolverValorMensualVacuna;");
  });
});

describe('§9/§13/§15) Integración con Mano de Obra — costo unitario por trabajador, headcount lo aporta SIEMPRE el cargo', () => {
  it('construirEntradaOtrosCostosLinea alimenta valor×dosisPorTrabajador÷frecuencia (nunca multiplicado por una cantidadTrabajadores propia de la fila)', () => {
    const inicio = PAGE_TSX.indexOf("const vacunas:ItemCostoResuelto[]=vacunasRows");
    expect(inicio).toBeGreaterThan(-1);
    const b = PAGE_TSX.slice(inicio, inicio + 300);
    expect(b).toContain('valorMensual:resolverValorMensualVacuna(r)');
  });
});

describe('§12/§14) TOTAL VACUNAS (agregado del módulo) usa la misma fórmula por fila que la tabla', () => {
  it('seccionVacunasTabla suma valorTotalVacunaFila (nunca cant×valor directo)', () => {
    const b = bloque('const seccionVacunasTabla=(', 'const seccionCategoria=');
    expect(b).toContain('filas.reduce((s,r)=>s+valorTotalVacunaFila(r),0)');
  });
});

describe('§12/§18) El total de Vacunas llega una sola vez al consolidado (mismo ensamblador único que Exámenes/Cursos)', () => {
  it('totalesExamCursosVacunasPorSujeto sigue siendo el único punto que suma entrada.vacunas', () => {
    const b = bloque('const totalesExamCursosVacunasPorSujeto=React.useMemo(', 'const totalExamCursosVacunasGeneral=');
    expect(b).toContain('entrada.vacunas.reduce((s,i)=>s+i.valorMensual,0)');
  });
});

describe('§16) El origen (CATALOGO vs MANUAL) se conserva y se refleja en la UI', () => {
  it('agregarSeleccionadosVacuna marca origen:CATALOGO; guardarRegistroManual sigue marcando origen:MANUAL para Vacunas', () => {
    const bCatalogo = bloque('const agregarSeleccionadosVacuna=()=>{', 'const cerrarModalManual=');
    expect(bCatalogo).toContain("origen:'CATALOGO'");
    const bManual = bloque("}else{\n      // Ajuste \"IMPLEMENTAR CATÁLOGO DE VACUNAS", 'setVacunasRows(p=>esNuevo?[...p,fila]:p.map(r=>r.id===filaId?fila:r));');
    expect(bManual).toContain("origen:'MANUAL'");
  });
  it('el botón "Editar" de la tabla solo se muestra para filas de origen MANUAL (las de catálogo no son editables como Cursos)', () => {
    const b = bloque('const filaVacunaTabla=(', 'const seccionVacunasTabla=(');
    expect(b).toContain("r.origen==='MANUAL'&&<button onClick={()=>abrirModalManual('VACUNA',linea,r)}");
  });
});

describe('§17) Persistencia — guardar y recargar conserva los campos nuevos', () => {
  it('vacunasRowsD se restaura desde el payload guardado sin filtrar/descartar campos (VacunaRow completo, incluye dosisPorTrabajador/cantidadTrabajadores/tipoTarifa)', () => {
    expect(PAGE_TSX).toContain('const vacunasRowsD=Array.isArray(vacunasRowsCrudo)?vacunasRowsCrudo as VacunaRow[]:[];');
    expect(PAGE_TSX).toContain('setVacunasRows(vacunasRowsD);');
  });
});

// Ajuste "VR UNITARIO EDITABLE" (feedback en vivo, mismo patrón que "VR
// CURSO EDITABLE" en Cursos) — la celda "VR UNITARIO" de filaVacunaTabla
// (tabla del modal "Registrar Exámenes, Cursos y Vacunas") pasa de texto a
// input editable, mismo patrón monetario ya usado en Maquinaria/Cursos.
// Actualiza EXCLUSIVAMENTE r.valor (el valor de TRABAJO) vía
// actualizarVacunaRow — precioPreferencial/precioPublicoGeneral/tipoTarifa
// (el dato original del catálogo) nunca se tocan. Funciona igual para
// vacunas de catálogo y manuales (misma fila).
describe('Ajuste "VR UNITARIO EDITABLE" — celda VR UNITARIO de filaVacunaTabla es un input, no texto', () => {
  const bFilaVacunaTabla = () => bloque('const filaVacunaTabla=(linea:typeof lineasManoObraDisponibles[number],r:VacunaRow,eliminar:()=>void)=>{', 'const seccionVacunasTabla=(');

  it('VR UNITARIO es un <input type="text" inputMode="numeric"> con formato es-CO, no un <div> de solo lectura', () => {
    const b = bFilaVacunaTabla();
    expect(b).toContain('type="text" inputMode="numeric" value={r.valor?\'$ \'+r.valor.toLocaleString(\'es-CO\'):\'\'}');
  });

  it('el onChange usa actualizarVacunaRow(r.id,{valor:...}) con el mismo idiom de limpieza replace(/\\D/g,\'\') — nunca parseFloat', () => {
    const b = bFilaVacunaTabla();
    expect(b).toContain("onChange={e=>actualizarVacunaRow(r.id,{valor:Number(e.target.value.replace(/\\D/g,''))||0})}");
    expect(b).not.toContain('parseFloat');
  });

  it('editar VR UNITARIO NUNCA escribe precioPreferencial/precioPublicoGeneral/tipoTarifa — solo valor', () => {
    const b = bFilaVacunaTabla();
    const idxInput = b.indexOf("onChange={e=>actualizarVacunaRow(r.id,{valor:Number(e.target.value.replace(/\\D/g,''))||0})}");
    expect(idxInput).toBeGreaterThan(-1);
    expect(b).not.toMatch(/actualizarVacunaRow\(r\.id,\{valor:[^}]*precioPreferencial/);
    expect(b).not.toMatch(/actualizarVacunaRow\(r\.id,\{valor:[^}]*precioPublicoGeneral/);
    expect(b).not.toMatch(/actualizarVacunaRow\(r\.id,\{valor:[^}]*tipoTarifa/);
  });

  it('actualizarVacunaRow hace merge parcial ({...r,...cambios}) — por construcción, cambiar solo "valor" nunca toca los demás campos del registro (incluido el select de TARIFA, que sigue intacto)', () => {
    expect(PAGE_TSX).toContain('const actualizarVacunaRow=(id:number,cambios:Partial<VacunaRow>)=>setVacunasRows(p=>p.map(r=>r.id===id?{...r,...cambios}:r));');
    const b = bFilaVacunaTabla();
    // El <select> de tarifa (Preferencial/Público general) sigue existiendo
    // sin cambios — no se retiró junto con la celda de texto.
    expect(b).toContain("value={r.tipoTarifa??'PUBLICO_GENERAL'}");
    expect(b).toContain('<option value="PREFERENCIAL">Preferencial</option>');
  });

  it('resolverValorMensualVacuna sigue usando r.valor (y dosis/frecuencia) para el total — se recalcula solo al editar el input, sin fórmula nueva', () => {
    const b = bFilaVacunaTabla();
    expect(b).toContain('const total=valorTotalVacunaFila(r);');
    expect(b).toContain('{cop(total)}');
    expect(PAGE_TSX).toContain('const valorTotalVacunaFila=resolverValorMensualVacuna;');
    // Fórmula pura (factor-examen.ts), sin cambios en esta ronda (confirma
    // que no se mezcló con el ajuste "VR UNITARIO EDITABLE").
    const factorExamenTs = readFileSync(join(__dirname, '../costos-mano-obra/motor-distribuido/factor-examen.ts'), 'utf-8');
    expect(factorExamenTs).toContain('return (r.valor * dosis) / ((r.frecAnios || 1) * 12);');
  });

  it('la fila (filaVacunaTabla) es la MISMA para vacunas de catálogo y manuales — no hay condición de origen que oculte o reemplace el input de VR UNITARIO', () => {
    const b = bFilaVacunaTabla();
    const idxInput = b.indexOf('type="text" inputMode="numeric" value={r.valor?');
    // El único condicional de origen en toda la fila es r.origen==='MANUAL'
    // (para el botón "Editar"), nunca envolviendo el input de VR UNITARIO.
    const idxOrigenManualCond = b.indexOf("{r.origen==='MANUAL'&&<button");
    expect(idxInput).toBeGreaterThan(-1);
    expect(idxOrigenManualCond).toBeGreaterThan(idxInput);
  });

  it('el valor editado persiste al reconstruir vacunasRows desde el módulo guardado — vacunasRowsD es un cast directo del payload persistido (VacunaRow completo), nunca reconstruido campo por campo ni reseteado a un precio de catálogo', () => {
    expect(PAGE_TSX).toContain('const vacunasRowsD=Array.isArray(vacunasRowsCrudo)?vacunasRowsCrudo as VacunaRow[]:[];');
    expect(PAGE_TSX).not.toContain('valor:r.precioPublicoGeneral');
    expect(PAGE_TSX).not.toContain('valor:r.precioPreferencial');
  });
});
