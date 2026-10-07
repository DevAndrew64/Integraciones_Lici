/**
 * Ajuste "CORREGIR EL COMPORTAMIENTO DE GARANTÍAS Y AMPAROS: DETALLE
 * DESPLEGABLE DE SOLO LECTURA + MODAL EXCLUSIVO PARA EDICIÓN" (renombrado
 * visualmente a "Pólizas contractuales" en un ajuste posterior — mismo
 * módulo/estado, solo cambian los textos visibles).
 *
 * No existe arnés de render de componentes para page.tsx (~34.000 líneas,
 * sin jsdom/RTL en este proyecto) — mismo patrón de verificación de TEXTO
 * exacto del código fuente ya usado en el resto de *-page.test.ts.
 *
 * BloqueResumenSeccionAdmin se invoca como FUNCIÓN simple
 * (`{BloqueResumenSeccionAdmin({...})}`), nunca como JSX (`<.../>`): al ser
 * una función redefinida en cada render del componente padre, usarla como
 * JSX hacía que React la tratara como un tipo de componente nuevo en cada
 * tecla, remontando todo el árbol y perdiendo el foco del input tras cada
 * dígito (bug reportado como "solo permite una cifra por una"). Por eso los
 * marcadores de este archivo usan sintaxis de objeto (`clave:valor,`), no
 * de atributo JSX (`clave={valor}`).
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

const BLOQUE_COMPONENTE = bloque(
  'function BloqueResumenSeccionAdmin(',
  '\n  // ── Modal Crear/Editar cargo',
);

const INICIO_GARANTIAS = PAGE_TSX.indexOf('{BloqueResumenSeccionAdmin({');

const BLOQUE_GARANTIAS = bloque(
  '{BloqueResumenSeccionAdmin({',
  '{/* ══ MODAL "Agregar/Editar amparo"',
);

const BLOQUE_DETALLE = bloque('detalle:', 'modalContenido:', INICIO_GARANTIAS);
const BLOQUE_MODAL_CONTENIDO = bloque('modalContenido:', 'modalPie:', INICIO_GARANTIAS);
const BLOQUE_MODAL_PIE = bloque('modalPie:', '})}', INICIO_GARANTIAS);

describe('1/2/3) La tarjeta (título/valor/flecha) SOLO expande/contrae el acordeón — nunca abre el modal', () => {
  it('el onClick de la tarjeta llama a onToggleExpandir, nunca a onAbrirModal', () => {
    expect(BLOQUE_COMPONENTE).toContain('<div onClick={onToggleExpandir}');
  });

  it('alternarAcordeonSeccionAdmin invierte el booleano (expandir/contraer con el mismo handler)', () => {
    expect(PAGE_TSX).toContain("const alternarAcordeonSeccionAdmin=(clave:string)=>setAcordeonSeccionAdminAbierto(p=>({...p,[clave]:!p[clave]}));");
  });

  it('Pólizas contractuales conecta el acordeón con expandido/onToggleExpandir propios (acordeonSeccionAdminAbierto), independientes del modal', () => {
    expect(BLOQUE_GARANTIAS).toContain('expandido:acordeonSeccionAdminAbierto.polizas??false,');
    expect(BLOQUE_GARANTIAS).toContain("onToggleExpandir:()=>alternarAcordeonSeccionAdmin('polizas'),");
  });

  it('el bloque expandido del detalle está gateado únicamente por `expandido`, no por `modalAbierto`', () => {
    const inicio = BLOQUE_COMPONENTE.indexOf('{expandido&&(');
    expect(inicio).toBeGreaterThan(-1);
    const fin = BLOQUE_COMPONENTE.indexOf(')}', inicio);
    const gate = BLOQUE_COMPONENTE.slice(inicio, fin);
    expect(gate).not.toContain('modalAbierto');
  });
});

describe('4/5) El botón explícito ("Agregar pólizas"/"Gestionar pólizas") es el ÚNICO disparador del modal', () => {
  it('el botón llama a onAbrirModal, nunca a onToggleExpandir, y vive DENTRO del panel expandido (no en el header colapsado)', () => {
    const inicioExpandido = BLOQUE_COMPONENTE.indexOf('{expandido&&(');
    const inicioBoton = BLOQUE_COMPONENTE.indexOf('<button onClick={e=>{e.stopPropagation();onAbrirModal();}}');
    expect(inicioBoton).toBeGreaterThan(inicioExpandido);
  });

  it('el texto del botón alterna según tieneDatos: "Gestionar pólizas" (con datos) / "Agregar pólizas" (sin datos)', () => {
    expect(BLOQUE_COMPONENTE).toContain('{tieneDatos?textoBotonConDatos:textoBotonSinDatos}');
    expect(BLOQUE_GARANTIAS).toContain('textoBotonConDatos:"Gestionar pólizas",');
    expect(BLOQUE_GARANTIAS).toContain('textoBotonSinDatos:"Agregar pólizas",');
  });

  it('tieneDatos se resuelve desde subtotalPolizas>0 (nunca por la sola presencia de las 9 filas predeterminadas)', () => {
    expect(PAGE_TSX).toContain('const polizasTieneDatos=polizasCalculado.subtotalPolizas>0;');
    expect(BLOQUE_GARANTIAS).toContain('tieneDatos:polizasTieneDatos,');
  });

  it('el modal se abre con abrirModalGarantias, que copia el estado confirmado al borrador antes de abrir', () => {
    expect(BLOQUE_GARANTIAS).toContain('onAbrirModal:abrirModalGarantias,');
    const inicio = PAGE_TSX.indexOf('const abrirModalGarantias=()=>{');
    const fin = PAGE_TSX.indexOf('};', inicio);
    const cuerpo = PAGE_TSX.slice(inicio, fin);
    expect(cuerpo).toContain('setPolizasFilasBorrador(polizasFilas.map(f=>({...f})));');
    expect(cuerpo).toContain('setPolizasValorBaseBorrador(polizasValorBase);');
    expect(cuerpo).toContain('setPolizasOtrosBorrador(polizasOtros);');
    expect(cuerpo).toContain('setPolizasPorcentajeIvaBorrador(polizasPorcentajeIva);');
  });
});

describe('6/7) El detalle desplegable muestra ÚNICAMENTE conceptos activos', () => {
  it('polizasActivasConfirmado filtra por activo===true sobre el estado confirmado (polizasCalculado, nunca el borrador)', () => {
    expect(PAGE_TSX).toContain('const polizasActivasConfirmado=polizasCalculado.filasCalculadas.filter(f=>f.activo);');
  });

  it('el detalle itera sobre polizasActivasConfirmado, nunca sobre polizasFilasVisibles (que puede incluir inactivos con el toggle del modal)', () => {
    expect(BLOQUE_DETALLE).toContain('polizasActivasConfirmado.map(f=>');
    expect(BLOQUE_DETALLE).not.toContain('polizasFilasVisibles');
    expect(BLOQUE_DETALLE).not.toContain('mostrarPolizasInactivas');
  });

  it('sin filas activas, el detalle muestra un estado vacío ("No hay amparos registrados."), nunca una fila vacía', () => {
    expect(BLOQUE_DETALLE).toContain('No hay amparos registrados.');
    expect(BLOQUE_DETALLE).toContain('polizasActivasConfirmado.length===0');
  });
});

describe('8) El detalle desplegable es exclusivamente informativo — sin inputs, switches, checkboxes ni botones de guardado', () => {
  it('no contiene ningún <input', () => {
    expect(BLOQUE_DETALLE).not.toContain('<input');
  });

  it('no contiene checkboxes/switches (type="checkbox") ni el botón "Agregar concepto"', () => {
    expect(BLOQUE_DETALLE).not.toContain('type="checkbox"');
    expect(BLOQUE_DETALLE).not.toContain('Agregar concepto');
  });

  it('no contiene ningún botón de guardado ("Guardar")', () => {
    expect(BLOQUE_DETALLE).not.toContain('Guardar');
  });
});

describe('9/10/11) El detalle usa el estado CONFIRMADO — nunca el borrador ni cambios sin guardar', () => {
  it('el título del detalle es "Detalle de amparos activos"', () => {
    expect(BLOQUE_DETALLE).toContain('Detalle de amparos activos');
  });

  it('el valor base mostrado es polizasValorBase (confirmado), nunca polizasValorBaseBorrador', () => {
    expect(BLOQUE_DETALLE).toContain('Valor base de la oferta');
    expect(BLOQUE_DETALLE).toContain('{cop(polizasValorBase)}');
    expect(BLOQUE_DETALLE).not.toContain('polizasValorBaseBorrador');
  });

  it('el resumen (subtotal/otros/iva/total/valor mensual) usa polizasCalculado (confirmado), nunca polizasCalculadoBorrador', () => {
    expect(BLOQUE_DETALLE).toContain('polizasCalculado.subtotalPolizas');
    expect(BLOQUE_DETALLE).toContain('polizasCalculado.iva');
    expect(BLOQUE_DETALLE).toContain('polizasCalculado.total');
    expect(BLOQUE_DETALLE).toContain('polizasCalculado.valorMensual');
    expect(BLOQUE_DETALLE).not.toContain('polizasCalculadoBorrador');
    expect(BLOQUE_DETALLE).not.toContain('Borrador');
  });

  it('ajuste "CORREGIR EL CÁLCULO DE PÓLIZAS..." — el resumen SÍ vuelve a mostrar "Otros" (campo global restaurado en §4/§9) y "Duración del contrato"', () => {
    expect(BLOQUE_DETALLE).toContain('>Otros<');
    expect(BLOQUE_DETALLE).toContain('Duración del contrato');
  });
});

describe('12/13/14) Cancelar descarta el borrador; Guardar reemplaza el estado confirmado (tarjeta + detalle se actualizan)', () => {
  it('cancelarModalGarantias SOLO cierra el modal — nunca toca polizasFilas/polizasValorBase/polizasOtros/polizasPorcentajeIva (el borrador se descarta implícitamente)', () => {
    const inicio = PAGE_TSX.indexOf('const cancelarModalGarantias=');
    const fin = PAGE_TSX.indexOf(';', inicio) + 1;
    const cuerpo = PAGE_TSX.slice(inicio, fin);
    expect(cuerpo).toContain("setModalSeccionAdminAbierta(p=>({...p,polizas:false}))");
    expect(cuerpo).not.toContain('setPolizasFilas(');
    expect(cuerpo).not.toContain('setPolizasValorBase(');
    expect(cuerpo).not.toContain('setPolizasOtros(');
    expect(cuerpo).not.toContain('setPolizasPorcentajeIva(');
  });

  it('guardarModalGarantias reemplaza los 4 estados confirmados con el borrador completo, luego cierra el modal', () => {
    const inicio = PAGE_TSX.indexOf('const guardarModalGarantias=()=>{');
    const fin = PAGE_TSX.indexOf('};', inicio);
    const cuerpo = PAGE_TSX.slice(inicio, fin);
    expect(cuerpo).toContain('setPolizasFilas(polizasFilasBorrador);');
    expect(cuerpo).toContain('setPolizasValorBase(polizasValorBaseBorrador);');
    expect(cuerpo).toContain('setPolizasOtros(polizasOtrosBorrador);');
    expect(cuerpo).toContain('setPolizasPorcentajeIva(polizasPorcentajeIvaBorrador);');
    expect(cuerpo).toContain("setModalSeccionAdminAbierta(p=>({...p,polizas:false}));");
  });

  it('la tarjeta muestra polizasCalculado.valorMensual (derivado del estado confirmado) — al guardar, el nuevo confirmado recalcula ese valor automáticamente', () => {
    expect(BLOQUE_GARANTIAS).toContain('valor:polizasCalculado.valorMensual,');
  });

  it('los botones "Cancelar"/"Guardar y cerrar" del pie del modal llaman a cancelarModalGarantias/guardarModalGarantias respectivamente', () => {
    expect(BLOQUE_MODAL_PIE).toContain('onClick={cancelarModalGarantias}');
    expect(BLOQUE_MODAL_PIE).toContain('onClick={guardarModalGarantias}');
  });
});

describe('15) El botón de acción nunca dispara accidentalmente el acordeón (control de propagación de eventos)', () => {
  it('el botón usa e.stopPropagation() antes de onAbrirModal()', () => {
    expect(BLOQUE_COMPONENTE).toContain('onClick={e=>{e.stopPropagation();onAbrirModal();}}');
  });

  it('la fila del sub-modal ya no tiene un onClick ambiguo: solo el nombre del amparo abre "Editar amparo"; Aplica/%/Tasa/Vigencia/eliminar actúan directo sobre el borrador, sin abrir ningún modal', () => {
    expect(BLOQUE_MODAL_CONTENIDO).toContain('<div title={f.concepto} onClick={()=>abrirModalPoliza(f)}');
    expect(BLOQUE_MODAL_CONTENIDO).toContain("<button type=\"button\" onClick={()=>actualizarPolizaBorrador(f.id,{activo:!f.activo})}");
  });
});

describe('16) El acordeón (expandir/contraer) nunca modifica la lógica económica', () => {
  it('alternarAcordeonSeccionAdmin solo cambia acordeonSeccionAdminAbierto — nunca llama a calcularPolizas ni a ningún setter de polizasFilas/valorBase/otros/iva', () => {
    const inicio = PAGE_TSX.indexOf('const alternarAcordeonSeccionAdmin=');
    const fin = PAGE_TSX.indexOf(';', inicio) + 1;
    const cuerpo = PAGE_TSX.slice(inicio, fin);
    expect(cuerpo).toContain('setAcordeonSeccionAdminAbierto');
    expect(cuerpo).not.toContain('calcularPolizas');
    expect(cuerpo).not.toContain('setPolizasFilas');
    expect(cuerpo).not.toContain('setPolizasValorBase');
  });

  it('acordeonSeccionAdminAbierto es un estado 100% independiente de modalSeccionAdminAbierta', () => {
    expect(PAGE_TSX).toContain('const [acordeonSeccionAdminAbierto,setAcordeonSeccionAdminAbierto]=useState<Record<string,boolean>>({});');
    expect(PAGE_TSX).toContain('const [modalSeccionAdminAbierta,setModalSeccionAdminAbierta]=useState<Record<string,boolean>>({});');
  });
});

describe('§7 — el modal de registro conserva la estructura editable (valor base, conceptos, agregar concepto, guardar y cerrar), ahora sobre el borrador', () => {
  it('el modal opera sobre las variables *Borrador, nunca sobre las confirmadas', () => {
    expect(BLOQUE_MODAL_CONTENIDO).toContain('polizasValorBaseBorrador');
    expect(BLOQUE_MODAL_CONTENIDO).toContain('polizasFilasVisiblesBorrador');
  });

  it('conserva el botón "Agregar amparo" dentro del modal (renombrado desde "Agregar concepto")', () => {
    expect(BLOQUE_MODAL_CONTENIDO).toContain('Agregar amparo');
  });

  it('DURACIÓN DEL CONTRATO (MESES) es un campo global editable en el modal (sobre el borrador)', () => {
    expect(BLOQUE_MODAL_CONTENIDO).toContain('polizasNumeroMesesContratoBorrador');
    expect(BLOQUE_MODAL_CONTENIDO).toContain('DURACIÓN DEL CONTRATO (MESES)');
  });

  it('OTROS y % IVA ya NO se muestran en el modal (ocultos tras feedback visual) — pero siguen calculándose con su valor guardado (se ven en el detalle de solo lectura)', () => {
    expect(BLOQUE_MODAL_CONTENIDO).not.toContain('>OTROS<');
    expect(BLOQUE_MODAL_CONTENIDO).not.toContain('% IVA');
    expect(BLOQUE_DETALLE).toContain('>Otros<');
  });

  it('el modal ya NO repite el resumen (subtotal/total/valor mensual): eso vive solo en el detalle de solo lectura de la tarjeta', () => {
    expect(BLOQUE_MODAL_CONTENIDO).not.toContain('Subtotal de pólizas');
    expect(BLOQUE_MODAL_CONTENIDO).not.toContain('Total de pólizas');
    expect(BLOQUE_MODAL_CONTENIDO).not.toContain('Valor mensual de pólizas');
  });

  it('el pie del modal ya no muestra un preview del valor mensual — solo Cancelar/Guardar y cerrar', () => {
    expect(BLOQUE_MODAL_PIE).not.toContain('polizasCalculadoBorrador');
  });
});

describe('Renombrado visual "PÓLIZAS CONTRACTUALES" — mismos datos/cálculos, solo cambian los textos', () => {
  it('el título de la tarjeta/modal es "Pólizas contractuales" (antes "Garantías y amparos contractuales")', () => {
    expect(BLOQUE_GARANTIAS).toContain('titulo:"Pólizas contractuales",');
  });

  it('los conceptos internos predeterminados (amparos cubiertos por cada póliza) NO se renombraron', () => {
    const libSrc = readFileSync(join(__dirname, 'calculo-costos-administrativos.ts'), 'utf-8');
    expect(libSrc).toContain("fila(1, 'Cumplimiento del contrato', true)");
    expect(libSrc).toContain("fila(9, 'Otros amparos o garantías', false)");
  });
});

describe('Ajuste "CORREGIR EL CÁLCULO DE PÓLIZAS..." + "AJUSTAR TERMINOLOGÍA Y DISTRIBUCIÓN VISUAL DEL MODAL" — columnas del detalle (Valor amparado ≠ Costo del amparo)', () => {
  it('el encabezado del detalle muestra % amparo, Tasa póliza, Vigencia, Valor amparado y Costo del amparo (sin abreviaturas como "% AMP.")', () => {
    expect(BLOQUE_DETALLE).toContain('% amparo');
    expect(BLOQUE_DETALLE).toContain('Tasa póliza (%)');
    expect(BLOQUE_DETALLE).toContain('Vigencia (meses)');
    expect(BLOQUE_DETALLE).toContain('Valor amparado');
    expect(BLOQUE_DETALLE).toContain('Costo del amparo');
    expect(BLOQUE_DETALLE).not.toContain('% AMP.');
  });

  it('las celdas de fila muestran valorAmparado y costoTotalPoliza (nunca el antiguo valorTotal/valorMensual por fila)', () => {
    expect(BLOQUE_DETALLE).toContain('{cop(f.valorAmparado)}');
    expect(BLOQUE_DETALLE).toContain('cop(f.costoTotalPoliza)');
    expect(BLOQUE_DETALLE).not.toContain('f.valorTotal');
    expect(BLOQUE_DETALLE).not.toContain('f.valorMensual');
  });

  it('la vigencia mostrada es la vigencia TOTAL almacenada, sin ningún "+1" agregado en la presentación', () => {
    expect(BLOQUE_DETALLE).toContain('{f.vigenciaMeses} meses');
    expect(BLOQUE_DETALLE).not.toContain('+ 1 m');
  });

  it('el subtotal de la tarjeta/detalle se construye desde costoTotalPoliza — nunca desde valorAmparado (el bug original reportado por el usuario)', () => {
    const libSrc = readFileSync(join(__dirname, 'calculo-costos-administrativos.ts'), 'utf-8');
    expect(libSrc).toContain('const subtotalPolizas = activas.reduce((s, f) => s + f.costoTotalPoliza, 0);');
    expect(libSrc).not.toContain('const subtotalPolizas = activas.reduce((s, f) => s + f.valorTotal, 0);');
  });

  it('la fórmula real del Excel está implementada SIN suma oculta de un mes: valorAmparado=baseAmparo×porcentaje/100 (baseAmparo=valorOferta, salvo RC que usa el SMLMV), factorVigencia=vigenciaMeses/12 (vigenciaMeses YA es el total), costoTotalPoliza=valorAmparado×tasaPoliza/100×factorVigencia', () => {
    const libSrc = readFileSync(join(__dirname, 'calculo-costos-administrativos.ts'), 'utf-8');
    // Ajuste "LA BASE PARA RC ES EL SALARIO MÍNIMO, NO LA OFERTA" — se
    // introdujo `baseAmparo` (valorOferta para todos los amparos, SMLMV
    // únicamente para Responsabilidad civil extracontractual, id=4); la
    // fórmula posterior (valorAmparado = baseAmparo × porcentaje/100) y el
    // resto de la cadena (factorVigencia, costoTotalPoliza) no cambiaron.
    expect(libSrc).toContain('const esResponsabilidadCivil = fila.id === ID_POLIZA_RESPONSABILIDAD_CIVIL;');
    expect(libSrc).toContain('salarioMinimoVigente * cantidadSMLMV');
    expect(libSrc).toContain('const valorAmparado = (baseAmparo || 0) * (fila.porcentaje || 0) / 100;');
    expect(libSrc).toContain('const factorVigencia = vigenciaValida ? fila.vigenciaMeses / 12 : 0;');
    expect(libSrc).toContain("const costoTotalPoliza = completa ? valorAmparado * ((fila.tasaPoliza || 0) / 100) * factorVigencia : 0;");
    expect(libSrc).not.toContain('MES_ADICIONAL_FACTOR_VIGENCIA_POLIZA');
  });

  it('migrarFilasPolizasVigenciaTotal existe para la migración ÚNICA de registros guardados antes de este ajuste, guardada con el flag vigenciaTotalMigrada', () => {
    const libSrc = readFileSync(join(__dirname, 'calculo-costos-administrativos.ts'), 'utf-8');
    expect(libSrc).toContain('export function migrarFilasPolizasVigenciaTotal(filas: PolizaRow[], vigenciaTotalMigrada: boolean): PolizaRow[] {');
    expect(PAGE_TSX).toContain('migrarFilasPolizasVigenciaTotal(filasNormalizadas,datosAdminV2?.polizasConfig?.vigenciaTotalMigrada===true)');
    expect(PAGE_TSX).toContain('vigenciaTotalMigrada:true');
  });
});
