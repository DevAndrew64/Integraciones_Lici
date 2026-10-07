/**
 * Ajuste "AMPLIAR ESTRUCTURA DE COSTOS CON DOS PESTAÑAS NUEVAS" (ronda
 * inicial — solo estructura visual base, sin modelo de datos todavía).
 * Verificado por texto fuente (mismo patrón que el resto de
 * guardado-modular-*.test.ts — no hay jsdom/RTL en este proyecto para
 * montar ModuloEstructuraCostos).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLAVES_MODULO, CLAVES_MODULO_NO_APLICA } from './guardado-modular';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');
const EXPORTAR_ROUTE = readFileSync(join(__dirname, '../../app/api/costos-estructura/[id]/exportar/route.ts'), 'utf-8');

function bloque(inicioMarcador: string, finMarcador: string, desde = 0): string {
  const inicio = PAGE_TSX.indexOf(inicioMarcador, desde);
  if (inicio === -1) throw new Error(`No se encontró el marcador de inicio: ${inicioMarcador}`);
  const fin = PAGE_TSX.indexOf(finMarcador, inicio);
  if (fin === -1) throw new Error(`No se encontró el marcador de fin: ${finMarcador}`);
  return PAGE_TSX.slice(inicio, fin);
}

describe('Pestañas "Servicios no continuos" y "Valor agregado" — navegación', () => {
  const bTabs = () => bloque("const TABS:{key:Tab,label:string}[]=[", '];');

  it('1) existe la pestaña "Servicios no continuos" en la barra de navegación', () => {
    expect(bTabs()).toContain("{key:'serviciosNoContinuos',label:'Serv. no continuos'}");
  });

  it('2) existe la pestaña "Valor agregado" en la barra de navegación', () => {
    expect(bTabs()).toContain("{key:'valorAgregado',label:'Valor agregado'}");
  });

  it('3) aparecen en el orden correcto: entre "Maq. y Equipos" y "Costos Admin."', () => {
    const t = bTabs();
    const iMaq = t.indexOf("{key:'maquinaria',label:'Maq. y Equipos'}");
    const iServ = t.indexOf("{key:'serviciosNoContinuos',label:'Serv. no continuos'}");
    const iVA = t.indexOf("{key:'valorAgregado',label:'Valor agregado'}");
    const iAdmin = t.indexOf("{key:'admin',label:'Costos Admin.'}");
    expect(iMaq).toBeGreaterThan(-1);
    expect(iServ).toBeGreaterThan(iMaq);
    expect(iVA).toBeGreaterThan(iServ);
    expect(iAdmin).toBeGreaterThan(iVA);
  });

  // Ajuste (feedback en vivo) "tarifa regulada colocala antes del resultado
  // y el resumen colocalo de ultimo al final del flujo" — Resumen pasó del
  // INICIO al FINAL del stepper (último paso visual, después de Resultado);
  // Tarifa Regulada (Vigicolba-only, fuera del alcance de este orden fijo
  // porque depende de esVigicolbaProceso) se ubica entre Costos Admin. y
  // Resultado. El resto de pestañas fijas conserva su orden relativo.
  it('9) no se altera el orden relativo de las pestañas fijas (Resumen ahora al final, no al inicio)', () => {
    const t = bTabs();
    const orden = [
      "{key:'manoObra',label:'Mano de Obra'}",
      "{key:'epp',label:'EPP y Dotación'}",
      "{key:'examenes',label:'Exámenes Médicos'}",
      "{key:'insumos',label:'Insumos'}",
      "{key:'maquinaria',label:'Maq. y Equipos'}",
      "{key:'admin',label:'Costos Admin.'}",
      "{key:'resultado',label:'Resultado'}",
      "{key:'resumen',label:'Resumen'}",
    ];
    let cursor = -1;
    for (const marcador of orden) {
      const i = t.indexOf(marcador);
      expect(i).toBeGreaterThan(cursor);
      cursor = i;
    }
  });
});

describe('Pestaña "Servicios no continuos" — contenido propio (estructura base de esta ronda; la funcionalidad real quedó implementada en una ronda posterior, ver servicios-no-continuos-page.test.ts)', () => {
  const bTab = () => bloque("{tab==='serviciosNoContinuos'&&(()=>{", "{/* ══ VALOR AGREGADO ══");

  it('4/5) muestra su propio título y el mensaje de estado vacío correcto', () => {
    const b = bTab();
    expect(b).toContain('Servicios no continuos');
    expect(b).toContain('No hay servicios no continuos agregados.');
    expect(b).toContain('Registra los servicios adicionales o eventuales requeridos para este proceso.');
    expect(b).toContain('+ Agregar servicio no continuo');
  });

  it('no reutiliza el texto de la pestaña Valor agregado (contenido exclusivo)', () => {
    const b = bTab();
    expect(b).not.toContain('Detalle de valor agregado');
    expect(b).not.toContain('No hay conceptos de valor agregado registrados.');
  });
});

// Ajuste "VALOR AGREGADO — 5 TIPOS CONSOLIDADOS" (feedback en vivo,
// reemplaza el placeholder original de esta pestaña) — Valor Agregado ya
// NO es un placeholder de estructura base: consolida Reinversión
// (administrada aquí) + los 4 tipos derivados (Mano de Obra/Insumos/
// Maquinaria/SNC, marcados `esValorAgregado` en su módulo de origen,
// nunca editados desde aquí) y SÍ tiene guardado modular propio real
// (`estadoModuloValorAgregado`, en `CLAVES_MODULO`) — las aserciones de
// "estructura base sin datos" de la ronda inicial ya no aplican.
describe('Pestaña "Valor agregado" — contenido propio', () => {
  const bTab = () => bloque("{tab==='valorAgregado'&&(", "{/* ══ ADMIN ══ */}");

  // Ajuste "MEJORA UX — SECCIÓN VALOR AGREGADO" (feedback en vivo) —
  // "Tipos de valor agregado" se rebautizó "Componentes de valor
  // agregado" (mismo checklist, misma lógica, solo nombre visible).
  it('4/6) muestra su propio título, la sección "Componentes de valor agregado" (5 checkboxes) y el mensaje de estado vacío correcto', () => {
    const b = bTab();
    expect(b).toContain('Valor agregado');
    expect(b).toContain('Componentes de valor agregado');
    expect(b).toContain("{tipo:'REINVERSION',label:'Reinversión'}");
    expect(b).toContain("{tipo:'MANO_DE_OBRA',label:'Mano de Obra'}");
    expect(b).toContain("{tipo:'INSUMOS',label:'Insumos'}");
    expect(b).toContain("{tipo:'MAQUINARIA',label:'Maquinaria'}");
    expect(b).toContain("{tipo:'SNC',label:'Servicios No Continuos'}");
    expect(b).toContain('No hay conceptos de valor agregado registrados.');
  });

  it('los tipos 2-5 son SOLO derivados — nunca un botón para escribir un valor manual desde esta pestaña', () => {
    const b = bTab();
    expect(b).not.toContain('+ Agregar Mano de Obra');
    expect(b).not.toContain('+ Agregar Insumo');
    expect(b).not.toContain('+ Agregar Maquinaria');
    expect(b).not.toContain('+ Agregar SNC');
    // Ajuste "MEJORA UX — SECCIÓN VALOR AGREGADO" (feedback en vivo) — el
    // botón de Mano de Obra pasó de "Gestionar en Mano de Obra" a "Editar
    // Mano de Obra" (misma acción, abre el mismo modal de selección).
    expect(b).toContain('Editar Mano de Obra');
    expect(b).toContain('Gestionar Insumos');
    expect(b).toContain('Gestionar Maquinaria');
    expect(b).toContain('Gestionar Servicios No Continuos');
  });

  it('Reinversión sí se administra directamente aquí (crear/editar/eliminar)', () => {
    const b = bTab();
    expect(b).toContain('abrirModalReinversionNuevo');
    expect(b).toContain('abrirModalReinversionEditar');
    expect(b).toContain('eliminarReinversion');
  });
});

describe('Ajuste "VALOR AGREGADO — GUARDADO MODULAR PROPIO"', () => {
  // Confirmado: `valorAgregado` SÍ tiene clave de módulo propia (guardado
  // modular real, ver `guardarModuloValorAgregado`) — deliberadamente
  // nunca en `CLAVES_MODULO_NO_APLICA` (mismo criterio que Servicios No
  // Continuos: usa su propio mecanismo ad-hoc de "No aplica" en el
  // frontend, sin el gate de validación backend de los 4 módulos
  // oficiales).
  it('7) valorAgregado SÍ tiene clave de módulo propia; ninguna de las dos participa de CLAVES_MODULO_NO_APLICA', () => {
    expect(CLAVES_MODULO as readonly string[]).toContain('valorAgregado');
    expect(CLAVES_MODULO_NO_APLICA as readonly string[]).not.toContain('serviciosNoContinuos');
    expect(CLAVES_MODULO_NO_APLICA as readonly string[]).not.toContain('valorAgregado');
  });

  it('8) el Excel de Exportar costos muestra Valor agregado en el Resumen con el valor del panel, pero no lo valida/bloquea (el bucle de estados solo recorre CLAVES_MODULO_NO_APLICA)', () => {
    const resumen = readFileSync(join(__dirname, 'exportacion/resumen.ts'), 'utf-8');
    expect(resumen).toContain("{ nombre: 'Valor agregado', clave: null, valor: t.valorAgregado }");
    expect(EXPORTAR_ROUTE).toContain('for (const clave of CLAVES_MODULO_NO_APLICA)');
  });

  it('la pestaña Valor agregado SÍ lee/escribe su propio estado de módulo (estadoModuloValorAgregado)', () => {
    const bVA = bloque("{tab==='valorAgregado'&&(", "{/* ══ ADMIN ══ */}");
    expect(bVA).toMatch(/estadoModuloValorAgregado/);
  });
});

// Ajuste "VALOR AGREGADO — SELECCIONAR INSUMOS EXISTENTES" — "Gestionar en
// Insumos" navegaba al módulo Insumos (mostraba "No hay insumos
// agregados"/exigía registrar de nuevo, en vez de dejar marcar insumos ya
// cargados). Mismo patrón que abrirModalVAManoObra/guardarModalVAManoObra
// (ya cubierto funcionalmente, sin test dedicado): modal propio que lee
// `insumosRows` como única fuente, nunca copia ni crea un registro nuevo.
describe('Valor agregado — modal "Seleccionar insumos" (mismo patrón que Mano de Obra)', () => {
  const bAbrir = () => bloque('const abrirModalVAInsumos=()=>{', '\n  const cerrarModalVAInsumos=');
  const bCerrar = () => bloque('const cerrarModalVAInsumos=()=>{', '\n  const actualizarBorradorVAInsumos=');
  const bActualizar = () => bloque('const actualizarBorradorVAInsumos=', '\n  const erroresVAInsumos=');
  const bGuardar = () => bloque('const guardarModalVAInsumos=()=>{', '\n  // Ajuste "VALOR AGREGADO — SELECCIONADO vs CONFIGURADO, PERSISTENTE"');
  const bModal = () => bloque('{modalVAInsumosAbierto&&(', '\n        {/* ══ TARIFA REGULADA (VIGICOLBA) ══');

  it('el botón del panel de Insumos abre el modal (abrirModalVAInsumos), nunca navega de pestaña', () => {
    expect(PAGE_TSX).toContain("panelDerivado(filasValorAgregadoInsumos,'No hay insumos marcados como Valor Agregado.',abrirModalVAInsumos,'Gestionar Insumos')");
    expect(PAGE_TSX).not.toContain("panelDerivado(filasValorAgregadoInsumos,'No hay insumos marcados como Valor Agregado.',()=>irAGestionarDesdeValorAgregado('insumos')");
  });

  it('abrirModalVAInsumos puebla el borrador con TODOS los insumos de insumosRows (no solo los ya marcados VA)', () => {
    const b = bAbrir();
    expect(b).toContain('setBorradorVAInsumos(insumosRows.map(r=>');
  });

  it('el valor mostrado es exactamente r.valorMensual, nunca recalculado con otra fórmula', () => {
    const bAb = bAbrir();
    expect(bAb).toContain('valorMensual:r.valorMensual');
    expect(bAb).not.toMatch(/valorMensual:r\.valorMensual[*/+-]/);
    const bMo = bModal();
    expect(bMo).toContain('{cop(r.valorMensual)}');
  });

  it('reabrir conserva selección y frecuencia — el borrador SIEMPRE se repuebla desde insumosRows, incluyendo los ya marcados VA con su frecuencia', () => {
    const b = bAbrir();
    expect(b).toContain('esValorAgregado:!!r.esValorAgregado,frecuenciaValorAgregado:r.frecuenciaValorAgregado');
  });

  it('el <select> de frecuencia solo aparece si el insumo está marcado, y usa las mismas FRECUENCIAS_VALOR_AGREGADO que Mano de Obra', () => {
    const b = bModal();
    expect(b).toContain('{r.esValorAgregado&&(');
    expect(b).toContain('{FRECUENCIAS_VALOR_AGREGADO.map(f=><option key={f.value} value={f.value}>{f.label}</option>)}');
  });

  it('desmarcar un insumo limpia su frecuencia en el borrador (actualizarBorradorVAInsumos)', () => {
    const b = bActualizar();
    expect(b).toContain("...(cambios.esValorAgregado===false?{frecuenciaValorAgregado:undefined}:{})");
  });

  it('seleccionar sin frecuencia y guardar bloquea (erroresVAInsumos) y muestra el mensaje de error', () => {
    expect(PAGE_TSX).toContain('const erroresVAInsumos=borradorVAInsumos.filter(r=>r.esValorAgregado&&!r.frecuenciaValorAgregado);');
    const bG = bGuardar();
    expect(bG).toContain('if(erroresVAInsumos.length>0)return;');
    const bMo = bModal();
    expect(bMo).toContain('Selecciona la frecuencia del Valor Agregado.');
  });

  it('guardar actualiza EL MISMO registro de insumosRows por id (setInsumosRows(prev=>prev.map(...))) — nunca crea ni duplica una fila', () => {
    const b = bGuardar();
    expect(b).toContain('setInsumosRows(prev=>prev.map(r=>{');
    expect(b).toContain('const b=borradorVAInsumos.find(x=>x.id===r.id);');
    expect(b).not.toContain('setInsumosRows(prev=>[...prev,');
    expect(b).not.toContain('setInsumosRows([...insumosRows');
  });

  it('guardar deja esValorAgregado:false y frecuenciaValorAgregado:undefined en el registro cuando el insumo NO quedó marcado — vuelve al subtotal normal (mismo filtro esRecursoValorAgregado ya usado por totalMensualInsumos)', () => {
    const b = bGuardar();
    expect(b).toContain('return {...r,esValorAgregado:b.esValorAgregado,frecuenciaValorAgregado:b.esValorAgregado?b.frecuenciaValorAgregado:undefined};');
    // No se toca la fórmula de totalMensualInsumos/filasValorAgregadoInsumos —
    // ambas ya filtran/leen por esRecursoValorAgregado, sin cambios aquí.
    expect(PAGE_TSX).toContain("const totalMensualInsumos=insumosRows.filter(r=>!esRecursoValorAgregado(r)).reduce((s,r)=>s+r.valorMensual,0);");
    expect(PAGE_TSX).toContain('insumosRows.filter(esRecursoValorAgregado)');
  });

  it('Cancelar/cerrar el modal nunca toca insumosRows — todo cambio queda en borradorVAInsumos hasta pulsar "Agregar"', () => {
    const b = bCerrar();
    expect(b).not.toContain('setInsumosRows');
    expect(b).toContain('setModalVAInsumosAbierto(false)');
    expect(b).toContain('setBorradorVAInsumos([])');
  });

  it('estado vacío: si insumosRows está vacío, el modal muestra el mensaje y ofrece ir a Insumos, nunca la lista', () => {
    const b = bModal();
    expect(b).toContain('No hay insumos cargados para seleccionar.');
    expect(b).toContain("irAGestionarDesdeValorAgregado('insumos')");
  });

  it('cada fila del modal muestra código (si existe) y nombre, con checkbox de selección', () => {
    const b = bModal();
    expect(b).toContain("<input type=\"checkbox\" checked={r.esValorAgregado} onChange={e=>actualizarBorradorVAInsumos(r.id,{esValorAgregado:e.target.checked})}");
    expect(b).toContain("{r.codigo?r.codigo+' · ':''}{r.nombre}");
  });
});

// Ajuste "VALOR AGREGADO — SELECCIONAR MAQUINARIA EXISTENTE" — mismo
// patrón que Insumos/Mano de Obra: "Gestionar en Maquinaria y Equipos"
// navegaba al módulo Maquinaria (obligaba a gestionar desde allí). Ahora
// abre un modal propio que lee `maqRows` como única fuente.
describe('Valor agregado — modal "Seleccionar maquinaria" (mismo patrón que Insumos/Mano de Obra)', () => {
  const bAbrir = () => bloque('const abrirModalVAMaquinaria=()=>{', '\n  const cerrarModalVAMaquinaria=');
  const bCerrar = () => bloque('const cerrarModalVAMaquinaria=()=>{', '\n  const actualizarBorradorVAMaquinaria=');
  const bActualizar = () => bloque('const actualizarBorradorVAMaquinaria=', '\n  const erroresVAMaquinaria=');
  const bGuardar = () => bloque('const guardarModalVAMaquinaria=()=>{', '\n  // Ajuste "VALOR AGREGADO — SELECCIONAR SERVICIOS NO CONTINUOS');
  const bModal = () => bloque('{modalVAMaquinariaAbierto&&(', '\n        {/* ══ MODAL VALOR AGREGADO — SELECCIONAR SERVICIOS NO CONTINUOS');

  it('el botón del panel de Maquinaria abre el modal (abrirModalVAMaquinaria), nunca navega de pestaña', () => {
    expect(PAGE_TSX).toContain("panelDerivado(filasValorAgregadoMaquinaria,'No hay recursos de Maquinaria marcados como Valor Agregado.',abrirModalVAMaquinaria,'Gestionar Maquinaria')");
    expect(PAGE_TSX).not.toContain("panelDerivado(filasValorAgregadoMaquinaria,'No hay recursos de Maquinaria marcados como Valor Agregado.',()=>irAGestionarDesdeValorAgregado('maquinaria')");
  });

  it('abrirModalVAMaquinaria puebla el borrador con TODOS los equipos de maqRows (no solo los ya marcados VA)', () => {
    expect(bAbrir()).toContain('setBorradorVAMaquinaria(maqRows.map(r=>');
  });

  it('el valor mostrado es EXACTAMENTE valorMesComprar+valorMesMantenimiento (mismo criterio que filasValorAgregadoMaquinaria/maqTotal), nunca otra fórmula', () => {
    const bAb = bAbrir();
    expect(bAb).toContain('valorMensual:r.valorMesComprar+r.valorMesMantenimiento');
    const bMo = bModal();
    expect(bMo).toContain('{cop(r.valorMensual)}');
  });

  it('reabrir conserva selección y frecuencia — el borrador siempre se repuebla desde maqRows, incluyendo los ya marcados VA con su frecuencia', () => {
    expect(bAbrir()).toContain('esValorAgregado:!!r.esValorAgregado,frecuenciaValorAgregado:r.frecuenciaValorAgregado');
  });

  it('el <select> de frecuencia solo aparece si el equipo está marcado, y usa las mismas FRECUENCIAS_VALOR_AGREGADO', () => {
    const b = bModal();
    expect(b).toContain('{r.esValorAgregado&&(');
    expect(b).toContain('{FRECUENCIAS_VALOR_AGREGADO.map(f=><option key={f.value} value={f.value}>{f.label}</option>)}');
  });

  it('desmarcar un equipo limpia su frecuencia en el borrador', () => {
    expect(bActualizar()).toContain("...(cambios.esValorAgregado===false?{frecuenciaValorAgregado:undefined}:{})");
  });

  it('seleccionar sin frecuencia y guardar bloquea (erroresVAMaquinaria) y muestra el mensaje de error', () => {
    expect(PAGE_TSX).toContain('const erroresVAMaquinaria=borradorVAMaquinaria.filter(r=>r.esValorAgregado&&!r.frecuenciaValorAgregado);');
    expect(bGuardar()).toContain('if(erroresVAMaquinaria.length>0)return;');
    expect(bModal()).toContain('Selecciona la frecuencia del Valor Agregado.');
  });

  it('guardar actualiza EL MISMO registro de maqRows por id (setMaqRows(prev=>prev.map(...))) — nunca crea ni duplica un equipo', () => {
    const b = bGuardar();
    expect(b).toContain('setMaqRows(prev=>prev.map(r=>{');
    expect(b).toContain('const b=borradorVAMaquinaria.find(x=>x.id===r.id);');
    expect(b).not.toContain('setMaqRows(prev=>[...prev,');
    expect(b).not.toContain('setMaqRows([...maqRows');
  });

  it('guardar deja esValorAgregado:false y frecuenciaValorAgregado:undefined cuando el equipo NO quedó marcado — vuelve al subtotal normal', () => {
    const b = bGuardar();
    expect(b).toContain('return {...r,esValorAgregado:b.esValorAgregado,frecuenciaValorAgregado:b.esValorAgregado?b.frecuenciaValorAgregado:undefined};');
    expect(PAGE_TSX).toContain('maqRows.filter(esRecursoValorAgregado)');
  });

  it('Cancelar/cerrar el modal nunca toca maqRows — todo cambio queda en borradorVAMaquinaria hasta pulsar "Agregar"', () => {
    const b = bCerrar();
    expect(b).not.toContain('setMaqRows');
    expect(b).toContain('setModalVAMaquinariaAbierto(false)');
    expect(b).toContain('setBorradorVAMaquinaria([])');
  });

  it('estado vacío: si maqRows está vacío, el modal muestra el mensaje y ofrece ir a Maquinaria, nunca la lista', () => {
    const b = bModal();
    expect(b).toContain('No hay equipos cargados para seleccionar.');
    expect(b).toContain("irAGestionarDesdeValorAgregado('maquinaria')");
  });

  it('cada fila del modal muestra código (si existe) y descripción, con checkbox de selección', () => {
    const b = bModal();
    expect(b).toContain("<input type=\"checkbox\" checked={r.esValorAgregado} onChange={e=>actualizarBorradorVAMaquinaria(r.id,{esValorAgregado:e.target.checked})}");
    expect(b).toContain("{r.codigo?r.codigo+' · ':''}{r.descripcion}");
  });
});

// Ajuste "VALOR AGREGADO — SELECCIONAR SERVICIOS NO CONTINUOS EXISTENTES"
// — mismo patrón. `id` es string (único caso entre los 4 tipos). Valor
// mensual = calcularTotalesServicioNoContinuo(...), la MISMA función que
// ya usa filasValorAgregadoSnc/totalServiciosNoContinuos.
describe('Valor agregado — modal "Seleccionar Servicios No Continuos" (mismo patrón que los otros 3 tipos)', () => {
  const bAbrir = () => bloque('const abrirModalVASnc=()=>{', '\n  const cerrarModalVASnc=');
  const bCerrar = () => bloque('const cerrarModalVASnc=()=>{', '\n  const actualizarBorradorVASnc=');
  const bActualizar = () => bloque('const actualizarBorradorVASnc=', '\n  const erroresVASnc=');
  const bGuardar = () => bloque('const guardarModalVASnc=()=>{', '\n  // Ajuste "VALOR AGREGADO — SELECCIONADO vs CONFIGURADO, PERSISTENTE"');
  const bModal = () => bloque('{modalVASncAbierto&&(', '\n        {/* ══ TARIFA REGULADA (VIGICOLBA) ══');

  it('el botón del panel de SNC abre el modal (abrirModalVASnc), nunca navega de pestaña', () => {
    expect(PAGE_TSX).toContain("panelDerivado(filasValorAgregadoSnc,'No hay Servicios No Continuos marcados como Valor Agregado.',abrirModalVASnc,'Gestionar Servicios No Continuos')");
    expect(PAGE_TSX).not.toContain("panelDerivado(filasValorAgregadoSnc,'No hay Servicios No Continuos marcados como Valor Agregado.',()=>irAGestionarDesdeValorAgregado('serviciosNoContinuos')");
  });

  it('abrirModalVASnc puebla el borrador con TODOS los servicios de serviciosNoContinuos (no solo los ya marcados VA)', () => {
    expect(bAbrir()).toContain('setBorradorVASnc(serviciosNoContinuos.map(s=>({');
  });

  it('el valor mostrado usa EXACTAMENTE calcularTotalesServicioNoContinuo(s,totalesManoObraPorServicioNoContinuo.get(s.id)??0).total — la misma función que filasValorAgregadoSnc/totalServiciosNoContinuos, nunca otra fórmula', () => {
    const bAb = bAbrir();
    expect(bAb).toContain('valorMensual:calcularTotalesServicioNoContinuo(s,totalesManoObraPorServicioNoContinuo.get(s.id)??0).total');
    expect(bModal()).toContain('{cop(r.valorMensual)}');
  });

  it('reabrir conserva selección y frecuencia — el borrador siempre se repuebla desde serviciosNoContinuos, incluyendo los ya marcados VA con su frecuencia', () => {
    expect(bAbrir()).toContain('esValorAgregado:!!s.esValorAgregado,');
    expect(bAbrir()).toContain('frecuenciaValorAgregado:s.frecuenciaValorAgregado,');
  });

  it('el <select> de frecuencia solo aparece si el servicio está marcado, y usa las mismas FRECUENCIAS_VALOR_AGREGADO', () => {
    const b = bModal();
    expect(b).toContain('{r.esValorAgregado&&(');
    expect(b).toContain('{FRECUENCIAS_VALOR_AGREGADO.map(f=><option key={f.value} value={f.value}>{f.label}</option>)}');
  });

  it('desmarcar un servicio limpia su frecuencia en el borrador', () => {
    expect(bActualizar()).toContain("...(cambios.esValorAgregado===false?{frecuenciaValorAgregado:undefined}:{})");
  });

  it('seleccionar sin frecuencia y guardar bloquea (erroresVASnc) y muestra el mensaje de error', () => {
    expect(PAGE_TSX).toContain('const erroresVASnc=borradorVASnc.filter(r=>r.esValorAgregado&&!r.frecuenciaValorAgregado);');
    expect(bGuardar()).toContain('if(erroresVASnc.length>0)return;');
    expect(bModal()).toContain('Selecciona la frecuencia del Valor Agregado.');
  });

  it('guardar actualiza EL MISMO registro de serviciosNoContinuos por id (setServiciosNoContinuos(prev=>prev.map(...))) — nunca crea ni duplica un servicio', () => {
    const b = bGuardar();
    expect(b).toContain('setServiciosNoContinuos(prev=>prev.map(s=>{');
    expect(b).toContain('const b=borradorVASnc.find(x=>x.id===s.id);');
    expect(b).not.toContain('setServiciosNoContinuos(prev=>[...prev,');
  });

  it('guardar preserva el objeto COMPLETO del servicio vía {...s,...} — solo escribe esValorAgregado/frecuenciaValorAgregado, nunca reconstruye descripción/código/tarifas/cargos/dotación/exámenes/insumos/maquinaria/otrosCostos campo por campo', () => {
    const b = bGuardar();
    expect(b).toContain('return {...s,esValorAgregado:b.esValorAgregado,frecuenciaValorAgregado:b.esValorAgregado?b.frecuenciaValorAgregado:undefined};');
    // Ninguno de los campos propios del servicio se menciona explícitamente
    // en el guardado — la prueba de que se preservan es que NUNCA se
    // reconstruyen, solo se copian por spread.
    expect(b).not.toContain('descripcion:');
    expect(b).not.toContain('tarifas:');
    expect(b).not.toContain('cargosManuales:');
    expect(b).not.toContain('dotacionEpp:');
    expect(b).not.toContain('examenesMedicos:');
    expect(b).not.toContain('insumos:');
    expect(b).not.toContain('maquinariaEquipos:');
    expect(b).not.toContain('otrosCostos:');
  });

  it('guardar deja esValorAgregado:false y frecuenciaValorAgregado:undefined cuando el servicio NO quedó marcado — vuelve al subtotal normal (mismo particionarPorValorAgregado ya usado por totalServiciosNoContinuos)', () => {
    expect(PAGE_TSX).toContain('const serviciosNoContinuosParticionVA=React.useMemo(');
    expect(PAGE_TSX).toContain('()=>particionarPorValorAgregado(serviciosNoContinuos),');
    expect(PAGE_TSX).toContain('()=>calcularTotalServiciosNoContinuos(serviciosNoContinuosParticionVA.normales,totalesManoObraPorServicioNoContinuo),');
  });

  it('Cancelar/cerrar el modal nunca toca serviciosNoContinuos — todo cambio queda en borradorVASnc hasta pulsar "Agregar"', () => {
    const b = bCerrar();
    expect(b).not.toContain('setServiciosNoContinuos');
    expect(b).toContain('setModalVASncAbierto(false)');
    expect(b).toContain('setBorradorVASnc([])');
  });

  it('estado vacío: si serviciosNoContinuos está vacío, el modal muestra el mensaje y ofrece ir a Servicios No Continuos, nunca la lista', () => {
    const b = bModal();
    expect(b).toContain('No hay Servicios No Continuos cargados para seleccionar.');
    expect(b).toContain("irAGestionarDesdeValorAgregado('serviciosNoContinuos')");
  });

  it('cada fila del modal muestra referencia (código/UEN, si existe) y descripción, con checkbox de selección', () => {
    const b = bModal();
    expect(b).toContain("<input type=\"checkbox\" checked={r.esValorAgregado} onChange={e=>actualizarBorradorVASnc(r.id,{esValorAgregado:e.target.checked})}");
    expect(b).toContain("{r.referencia?r.referencia+' · ':''}{r.descripcion}");
  });
});

// Ajuste "PERIODICIDAD AFECTA EL VALOR MENSUAL DE VALOR AGREGADO" —
// verificación de cableado: cada uno de los 5 useMemo (Reinversión + 4
// módulos) divide el valor BASE que ya calcula su propio módulo por
// resolverFactorPeriodicidadValorAgregado(...), nunca modifica ese valor
// base ni duplica la fórmula del divisor (único punto central en
// valor-agregado.ts).
describe('Ajuste "PERIODICIDAD AFECTA EL VALOR MENSUAL DE VALOR AGREGADO" — los 5 useMemo mensualizan con el helper central', () => {
  it('resolverFactorPeriodicidadValorAgregado se importa desde valor-agregado.ts — nunca una fórmula paralela', () => {
    const bImport = bloque("import {\n  FRECUENCIAS_VALOR_AGREGADO,", "} from '@/lib/costos-estructura/valor-agregado';");
    expect(bImport).toContain('resolverFactorPeriodicidadValorAgregado');
  });

  it('Mano de Obra — valorMensual = (costoOtros+bonos) / resolverFactorPeriodicidadValorAgregado(l.frecuenciaValorAgregado), valor base intacto', () => {
    const b = bloque('const filasValorAgregadoManoObra=React.useMemo', 'const filasValorAgregadoInsumos=React.useMemo');
    expect(b).toContain('valorMensual:(costoOtros+bonos)/resolverFactorPeriodicidadValorAgregado(l.frecuenciaValorAgregado)');
    // El valor base (costoOtros+bonos) sigue siendo EXACTAMENTE el mismo cálculo, sin alterar.
    expect(b).toContain("const costoOtros=resultadosLineasExtraConOtrosCostos.find(r=>r.id===l.id)?.resultado?.costoMensualTotalLinea??0;");
    expect(b).toContain("const bonos=resultadosLineasExtraMensuales.find(r=>r.id===l.id)?.bonosNoPrestacionales.totalLinea??0;");
  });

  it('Insumos — valorMensual = r.valorMensual / resolverFactorPeriodicidadValorAgregado(r.frecuenciaValorAgregado), nunca reescribe r.valorMensual', () => {
    const b = bloque('const filasValorAgregadoInsumos=React.useMemo', 'const filasValorAgregadoMaquinaria=React.useMemo');
    expect(b).toContain('valorMensual:r.valorMensual/resolverFactorPeriodicidadValorAgregado(r.frecuenciaValorAgregado)');
  });

  it('Maquinaria — valorMensual = (valorMesComprar+valorMesMantenimiento) / resolverFactorPeriodicidadValorAgregado(...), sin tocar esos dos campos', () => {
    const b = bloque('const filasValorAgregadoMaquinaria=React.useMemo', 'const filasValorAgregadoSnc=React.useMemo');
    expect(b).toContain('valorMensual:(r.valorMesComprar+r.valorMesMantenimiento)/resolverFactorPeriodicidadValorAgregado(r.frecuenciaValorAgregado)');
  });

  it('SNC — divide el .total YA calculado por calcularTotalesServicioNoContinuo, nunca reimplementa esa fórmula', () => {
    const b = bloque('const filasValorAgregadoSnc=React.useMemo', 'const totalValorOfertaTarifaRegulada=React.useMemo');
    expect(b).toContain('valorMensual:calcularTotalesServicioNoContinuo(s,totalesManoObraPorServicioNoContinuo.get(s.id)??0).total/resolverFactorPeriodicidadValorAgregado(s.frecuenciaValorAgregado)');
  });

  it('Reinversión — divide el resultado de calcularValorMensualReinversion(...) tal cual (sin tocarla por dentro), y propaga frecuencia a la fila consolidada (antes ausente)', () => {
    const b = bloque('const filasValorAgregadoReinversion=React.useMemo', 'const filasConsolidadasValorAgregado=React.useMemo');
    expect(b).toContain('valorMensual:calcularValorMensualReinversion(r,totalValorOfertaTarifaRegulada)/resolverFactorPeriodicidadValorAgregado(r.frecuenciaReinversion)');
    expect(b).toContain('frecuencia:r.frecuenciaReinversion');
  });

  it('el total consolidado (calcularTotalValorAgregado) sigue siendo una suma simple — la mensualización ya ocurrió en cada useMemo, nunca se divide dos veces', () => {
    const bLib = readFileSync(join(__dirname, 'valor-agregado.ts'), 'utf-8');
    const inicio = bLib.indexOf('export function calcularTotalValorAgregado');
    const fin = bLib.indexOf('\n}', inicio);
    const b = bLib.slice(inicio, fin);
    expect(b).toContain('s + f.valorMensual');
    expect(b).not.toMatch(/resolverFactorPeriodicidadValorAgregado|\/\s*divisor|\/\s*factor/);
  });
});
