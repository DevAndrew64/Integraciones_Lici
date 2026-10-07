/**
 * Ajuste "REDISEÑAR MAQUINARIA Y EQUIPOS" + "REDISEÑAR COSTOS
 * ADMINISTRATIVOS" — verificación de cableado en page.tsx: catálogo de
 * Maquinaria conectado a /api/equipos-ext, fórmula pura preservada
 * (cantidad×valorMensual, sin amortización/alquiler — decisión del
 * usuario), Costos Administrativos con VALOR_FIJO/PORCENTAJE real sobre
 * una base sin circularidad, guardado modular independiente para ambos,
 * hidratación con prioridad al módulo propio, y Resumen/Resultado
 * incluyendo cada total una sola vez. Mismo patrón `bloque()` que el
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

describe('MAQUINARIA — 1) usa el catálogo REAL consolidado por EMPRESA (sin filtro de ubicación), nunca llama a grupocolba.com directamente desde el cliente', () => {
  it('consultarCatalogMaq llama a /api/equipos-activos, nunca a grupocolba.com ni al catálogo plano anterior', () => {
    const b = bloque('const consultarCatalogMaq=async(', 'const onChangeSelMaqEmpresa=');
    expect(b).toContain("fetch('/api/equipos-activos'");
    expect(b).not.toContain('grupocolba.com');
    expect(b).not.toContain("fetch('/api/equipos-ext'");
  });

  it('onChangeSelMaqEmpresa envía el código técnico de EMPRESA_EXTERNA, nunca la empresa capturada libremente', () => {
    const b = bloque('const onChangeSelMaqEmpresa=(', 'const onChangeSelMaqQ=');
    expect(b).toContain('EMPRESA_EXTERNA[empresaLabel]');
  });

  it('abrirSelectorMaquinaria NUNCA dispara una consulta automática (la nueva API exige descripción real) — nunca un recorrido/consulta masiva al abrir', () => {
    const b = bloque('const abrirSelectorMaquinaria=(', 'const cerrarSelectorMaquinaria=');
    expect(b).not.toContain('consultarCatalogMaq');
  });

  it('el buscador de catálogo nunca envía `uen` en el body de /api/equipos-activos — solo empresa/q/page/limit', () => {
    const b = bloque('const consultarCatalogMaq=async(', 'const onChangeSelMaqEmpresa=');
    expect(b).not.toContain('uen:');
    expect(b).toContain("const body={empresa:empresaActual,q:(filtrosOverride?.q??selMaqQ).trim()||undefined,page:pagina,limit:SEL_MAQ_LIMIT};");
  });

  // Ajuste "ELIMINAR FILTRO DE UEN DEL BUSCADOR DE CATÁLOGO GENERAL"
  // (petición directa) — el filtro de UEN mezclaba catálogo externo (qué
  // equipos existen) con inventario interno (disponibilidad por sede),
  // ocultando equipos con disponibilidad 0 que podrían requerir compra.
  // Se retira por completo del selector de búsqueda: no debe existir
  // ningún estado ni `<select>` de UEN en el modal "Seleccionar
  // maquinaria y equipos".
  it('no existe filtro de UEN en el selector de catálogo (UEN_MAQ_INICIAL/selMaqUenFiltro/UENES_MAQ_BASE retirados)', () => {
    expect(PAGE_TSX).not.toContain('selMaqUenFiltro');
    expect(PAGE_TSX).not.toContain('UEN_MAQ_INICIAL');
    expect(PAGE_TSX).not.toContain('UENES_MAQ_BASE');
  });

  it('el import de las fórmulas viene de la librería compartida', () => {
    // Ajuste "REGISTRAR MAQUINARIA Y EQUIPOS COMO TABLA" — la nueva tabla
    // integrada ya no muestra "Valor antes de IVA"/"IVA calculado" como
    // columnas separadas, así que esos dos helpers dejaron de importarse.
    expect(PAGE_TSX).toContain("import { calcularCamposMaquinariaEquipo, calcularSubtotalAdquisicionMaquinaria, calcularSubtotalMantenimientoMaquinaria, normalizarMaquinariaHistorico } from '@/lib/costos-estructura/calculo-maquinaria';");
  });
});

describe('MAQUINARIA — 2) catálogo y manual son independientes', () => {
  it('agregarSeleccionadosMaq crea filas origen CATALOGO', () => {
    const b = bloque('const agregarSeleccionadosMaq=()=>{', 'const guardarManualMaquinaria=');
    expect(b).toContain("origen:'CATALOGO'");
  });

  it('guardarManualMaquinaria crea filas origen MANUAL', () => {
    const b = bloque('const guardarManualMaquinaria=()=>{', 'cerrarModalManualMaquinaria();');
    expect(b).toContain("origen:'MANUAL'");
  });

  it('agregarSeleccionadosMaq precarga valorUnitario desde el valor de la API (§8), pero incluyeIva SIEMPRE nace en false (nunca se asume que ya incluye IVA)', () => {
    const b = bloque('const agregarSeleccionadosMaq=()=>{', 'const guardarManualMaquinaria=');
    expect(b).toContain("const valorUnitario=typeof r.valor==='number'?r.valor:0;");
    expect(b).toContain('incluyeIva:false');
    expect(b).not.toContain('incluyeIva:true');
  });

  // Ajuste "INTEGRACIÓN DE DOS ENDPOINTS — CATÁLOGO + DISPONIBILIDAD" —
  // agregarSeleccionadosMaq ya NO consulta el Excel de mantenimiento
  // (`/api/equipos-activos/mantenimiento`): cantidadDisponible/
  // valorMantenimientoMensualUnitario vienen del cruce YA HECHO por
  // `/api/equipos-activos` (catálogo `equipos/obtener_recientes` +
  // disponibilidad `equipos/obtener`, ver `equipos-activos-cruce.ts`) —
  // `r.disponibleTotal`/`r.valorMantenimiento` en la fila seleccionada.
  it('agregarSeleccionadosMaq toma disponibleTotal/valorMantenimiento de la fila ya cruzada (nueva integración), nunca del Excel ni de Prisma', () => {
    const b = bloque('const agregarSeleccionadosMaq=()=>{', 'const guardarManualMaquinaria=');
    expect(b).not.toContain('/api/equipos-activos/mantenimiento');
    expect(b).not.toContain('tarifaMantenimientoEquipo');
    expect(b).toContain("const cantidadDisponible=typeof r.disponibleTotal==='number'?r.disponibleTotal:0;");
    expect(b).toContain("const valorMantenimientoMensualUnitario=typeof r.valorMantenimiento==='number'?r.valorMantenimiento:null;");
    expect(b).toContain("origenMantenimiento:MaquinariaEquipoRow['origenMantenimiento']=valorMantenimientoMensualUnitario!=null?'API_EQUIPOS':'SIN_COINCIDENCIA';");
    expect(b).toContain('disponibilidadVerificada:true');
  });

  it('agregarSeleccionadosMaq conserva codigoGrupo/codigoSubtipo/codigoCatalogoCompuesto, nunca inventa un código de equipo', () => {
    const b = bloque('const agregarSeleccionadosMaq=()=>{', 'const guardarManualMaquinaria=');
    expect(b).toContain('codigoGrupo:codigoGrupoActual,codigoSubtipo:codigoSubtipoActual,');
    expect(b).toContain('codigoCatalogoCompuesto:`${codigoGrupoActual}-${codigoSubtipoActual}`,');
  });
});

describe('MAQUINARIA — 3) el cálculo mensual usa las fórmulas reales del Excel (depreciación/IVA/mantenimiento, nunca cantidad×valorMensual plano)', () => {
  it('actualizarMaquinariaBorrador recalcula TODOS los campos derivados con calcularCamposMaquinariaEquipo', () => {
    const b = bloque('const actualizarMaquinariaBorrador=', 'const eliminarMaquinariaBorrador=');
    expect(b).toContain('...calcularCamposMaquinariaEquipo(actualizado)');
  });

  // Ajuste "VALOR AGREGADO — 5 TIPOS CONSOLIDADOS" — filas marcadas VA
  // dejan de sumar aquí (se trasladan al subtotal de Valor Agregado),
  // nunca en ambos lugares.
  it('maqTotal es la suma de los subtotales de adquisición y mantenimiento (filas NO marcadas Valor Agregado), nunca una fórmula paralela ni "Vr mes requerido" sumado', () => {
    expect(PAGE_TSX).toContain("const maqRowsNormalesParaTotal=maqRows.filter(r=>!esRecursoValorAgregado(r));");
    expect(PAGE_TSX).toContain('const subtotalMensualAdquisicionMaq=calcularSubtotalAdquisicionMaquinaria(maqRowsNormalesParaTotal);');
    expect(PAGE_TSX).toContain('const subtotalMensualMantenimientoMaq=calcularSubtotalMantenimientoMaquinaria(maqRowsNormalesParaTotal);');
    expect(PAGE_TSX).toContain('const maqTotal=subtotalMensualAdquisicionMaq+subtotalMensualMantenimientoMaq;');
  });
});

describe('MAQUINARIA — 4) Almacenar no ejecuta PUT', () => {
  it('almacenarMaquinaria solo hace setMaqRows, sin fetch', () => {
    const b = bloque('const almacenarMaquinaria=()=>{', '};');
    expect(b).toContain('setMaqRows(borradorMaquinaria)');
    expect(b).not.toContain('fetch(');
  });
});

describe('MAQUINARIA — 5) Guardar usa modulo maquinariaEquipos', () => {
  it('guardarModuloMaquinaria llama ejecutarGuardadoModuloCosteo con la clave correcta y totales:{maqTotal}', () => {
    const b = bloque('async function guardarModuloMaquinaria(', 'async function guardarAvanceMaquinaria(');
    expect(b).toContain("ejecutarGuardadoModuloCosteo('maquinariaEquipos',estadoDestino,datosEntrada,maquinariaUltimaActualizacion,{maqTotal})");
  });

  it('el payload contiene únicamente maqRows', () => {
    const b = bloque('function construirDatosEntradaMaquinaria(){', 'const maquinariaBaseline=useRef');
    expect(b).toContain('return { maqRows };');
  });
});

describe('MAQUINARIA — 6) hidratación prioriza el módulo', () => {
  it('moduloMaquinariaResuelto lee el módulo propio "maquinariaEquipos"', () => {
    expect(PAGE_TSX).toContain("const moduloMaquinariaResuelto=obtenerModulo<{maqRows?:unknown}>(dCrudo,'maquinariaEquipos');");
  });

  it('maqRowsCrudo prioriza el módulo, usa d.maqRows solo como fallback (nunca combina ambas fuentes)', () => {
    const b = bloque('const maqRowsCrudo=', 'const maqRowsD=');
    expect(b).toContain('Array.isArray(moduloMaquinariaResuelto?.datos?.maqRows)?moduloMaquinariaResuelto?.datos?.maqRows:d.maqRows');
  });

  it('cada fila pasa por normalizarMaquinariaHistorico', () => {
    const b = bloque('const maqRowsCrudo=', 'nextMaqId.current=Math.max(nextMaqId.current,maxM+1);');
    expect(b).toContain('.map(normalizarMaquinariaHistorico)');
  });
});

describe('MAQUINARIA — 7) Resumen y Resultado incluyen maqTotal una sola vez', () => {
  it('Resumen usa maqTotal', () => {
    const b = bloque('Maquinaria y Equipos</span>', '</div>\n                <div style={{background');
    expect(b).toContain('{cop(maqTotal)}');
  });

  it('Resultado (Tarifa del servicio) lista una única fila "Maquinaria y equipos" con el mismo total maqTotal, sin reconstruirlo', () => {
    const ocurrencias = (PAGE_TSX.match(/titulo="Maquinaria y equipos" valor=\{rts\.equipos\}/g) ?? []).length;
    expect(ocurrencias).toBe(1);
    expect(PAGE_TSX).toContain('equipos:maqTotal,');
  });
});

describe('MAQUINARIA — 8) conflicto 409 conserva el borrador', () => {
  it('guardarModuloMaquinaria en la rama de error nunca actualiza maqRows ni el baseline', () => {
    const b = bloque('async function guardarModuloMaquinaria(', 'async function guardarAvanceMaquinaria(');
    expect(b).not.toContain('setMaqRows(');
    const inicioError = b.indexOf('if(!r.ok){');
    const bError = b.slice(inicioError, b.indexOf('return false;', inicioError));
    expect(bError).not.toContain('maquinariaBaseline.current');
    expect(bError).not.toContain('setHayCambiosSinGuardarMaquinariaEquipos');
  });
});

// Ajuste "ESTRUCTURA DEFINITIVA DE COSTOS ADMINISTRATIVOS" — el modelo
// VALOR_FIJO/PORCENTAJE (adminRows/adminRowsCalculado/borradorAdmin/modal)
// fue reemplazado por Pólizas + Impuestos + Variables administrativas +
// consolidado. Las pruebas 9-16 se reescriben sobre la nueva estructura;
// el modelo anterior se conserva solo como migración histórica (ver
// calculo-costos-administrativos.test.ts, migrarAdminRowsHistoricoAVariables).

describe('ADMINISTRATIVOS — 9) el consolidado usa las funciones puras, nunca una fórmula inline', () => {
  it('polizasCalculado usa calcularPolizas', () => {
    // Ajuste "LA BASE PARA RC ES EL SALARIO MÍNIMO, NO LA OFERTA" agregó
    // `salarioMinimoVigente:SMLMV` a la llamada; el resto no cambió.
    expect(PAGE_TSX).toContain('const polizasCalculado=calcularPolizas({filas:polizasFilas,valorBase:polizasValorBase,otros:polizasOtros,porcentajeIva:polizasPorcentajeIva,numeroMesesContrato:polizasNumeroMesesContrato,salarioMinimoVigente:SMLMV});');
  });

  it('consolidadoAdmin usa calcularConsolidadoCostosAdministrativos, la única fuente del cálculo', () => {
    const b = bloque('const consolidadoAdmin=calcularConsolidadoCostosAdministrativos({', 'const adminTotal=consolidadoAdmin.totalMensualAdministrativo;');
    expect(b).toContain('totalCostosModulos');
    expect(b).toContain('totalVariablesAdministrativas');
    expect(b).toContain('valorMensualPolizas:polizasCalculado.valorMensual');
    expect(b).toContain('valorMensualImpuestos');
  });
});

describe('ADMINISTRATIVOS — 10) Impuestos calculan sobre la base correcta', () => {
  it('basesImpuestos pasa costoDirecto/manoObra reales, nunca adminTotal', () => {
    const b = bloque('const basesImpuestos={', '};');
    expect(b).toContain('costoDirecto:baseCostoDirectoAdministrativos');
    expect(b).toContain('manoObra:tarifaMensualTotalManoObra');
    expect(b).not.toContain('adminTotal');
  });

  it('baseCostoDirectoAdministrativos/totalCostosModulos nunca incluyen adminTotal (evita circularidad)', () => {
    expect(PAGE_TSX).toContain('const baseCostoDirectoAdministrativos=tarifaMensualTotalManoObra+maqTotal+totalMensualInsumos;');
    expect(PAGE_TSX).toContain('const totalCostosModulos=baseCostoDirectoAdministrativos;');
  });
});

describe('ADMINISTRATIVOS — 11) no existe referencia circular', () => {
  it('adminTotal se calcula DESPUÉS de baseCostoDirectoAdministrativos/totalCostosModulos, nunca al revés', () => {
    const idxBase = PAGE_TSX.indexOf('const baseCostoDirectoAdministrativos=');
    const idxTotal = PAGE_TSX.indexOf('const adminTotal=consolidadoAdmin.totalMensualAdministrativo;');
    expect(idxBase).toBeGreaterThan(-1);
    expect(idxTotal).toBeGreaterThan(idxBase);
  });
});

describe('ADMINISTRATIVOS — 12) las mutaciones locales nunca ejecutan fetch', () => {
  it('agregarPoliza/agregarImpuesto/agregarVariableAdmin son mutaciones locales puras', () => {
    const b = bloque('const eliminarPoliza=', 'const alternarSeccionAdmin=');
    expect(b).not.toContain('fetch(');
  });
});

describe('ADMINISTRATIVOS — 13) Guardar usa modulo costosAdministrativos', () => {
  it('guardarModuloAdmin llama ejecutarGuardadoModuloCosteo con la clave correcta y totales:{adminTotal}', () => {
    const b = bloque('async function guardarModuloAdmin(', 'async function guardarAvanceAdmin(');
    expect(b).toContain("ejecutarGuardadoModuloCosteo('costosAdministrativos',estadoDestino,datosEntrada,adminUltimaActualizacion,{adminTotal})");
  });

  it('el payload nunca incluye totales de otros módulos — solo configuración propia', () => {
    const b = bloque('function construirDatosEntradaCostosAdministrativos(', 'const adminBaseline=useRef');
    expect(b).toContain('polizasConfig:');
    expect(b).toContain('impuestosConfig:');
    expect(b).toContain('variablesAdministrativas:variablesAdmin');
    expect(b).not.toContain('tarifaMensualTotalManoObra');
    expect(b).not.toContain('maqTotal');
    expect(b).not.toContain('totalMensualInsumos');
  });
});

describe('ADMINISTRATIVOS — 14) hidratación prioriza el módulo, con migración histórica', () => {
  it('moduloAdminResuelto lee el módulo propio "costosAdministrativos"', () => {
    expect(PAGE_TSX).toContain("const moduloAdminResuelto=obtenerModulo<{adminRows?:unknown}>(dCrudo,'costosAdministrativos');");
  });

  it('si no existe variablesAdministrativas en el payload nuevo, se migra desde adminRows histórico', () => {
    expect(PAGE_TSX).toContain('migrarAdminRowsHistoricoAVariables(adminRowsD,{baseManoObra:0,baseCostoDirecto:0},()=>nextVariableAdminId.current++)');
  });

  it('las pólizas/impuestos hidratados pasan por sus arreglos tipados (PolizaRow/ImpuestoRow)', () => {
    expect(PAGE_TSX).toContain('setPolizasFilas(filasP);');
    expect(PAGE_TSX).toContain('setImpuestosFilas(filasI);');
  });
});

describe('ADMINISTRATIVOS — 15) Resumen y Resultado incluyen adminTotal una sola vez', () => {
  it('Resumen usa adminTotal', () => {
    const b = bloque('Costos Administrativos</span>', '<button onClick={exportarCostos}');
    expect(b).toContain('{cop(adminTotal)}');
  });

  it('Resultado (Tarifa del servicio) lista una única fila "Costos administrativos" con el mismo total adminTotal, sin reconstruirlo', () => {
    const ocurrencias = (PAGE_TSX.match(/titulo="Costos administrativos" valor=\{rts\.costosAdministrativos\}/g) ?? []).length;
    expect(ocurrencias).toBe(1);
    expect(PAGE_TSX).toContain('costosAdministrativos:adminTotal,');
  });
});

describe('ADMINISTRATIVOS — 16) conflicto 409 conserva la configuración', () => {
  it('guardarModuloAdmin en la rama de error nunca actualiza el baseline ni limpia el dirty', () => {
    const b = bloque('async function guardarModuloAdmin(', 'async function guardarAvanceAdmin(');
    const inicioError = b.indexOf('if(!r.ok){');
    const bError = b.slice(inicioError, b.indexOf('return false;', inicioError));
    expect(bError).not.toContain('adminBaseline.current');
    expect(bError).not.toContain('setHayCambiosSinGuardarCostosAdministrativos');
  });
});

describe('GENERALES — 17/18/19) dirty independiente entre Maquinaria y Admin', () => {
  it('guardarModuloMaquinaria no llama a ningún setter de Admin', () => {
    const b = bloque('async function guardarModuloMaquinaria(', 'async function guardarAvanceMaquinaria(');
    expect(b).not.toContain('setAdminRows');
    expect(b).not.toContain('setHayCambiosSinGuardarCostosAdministrativos');
    expect(b).not.toContain('adminBaseline.current');
  });

  it('guardarModuloAdmin no llama a ningún setter de Maquinaria', () => {
    const b = bloque('async function guardarModuloAdmin(', 'async function guardarAvanceAdmin(');
    expect(b).not.toContain('setMaqRows');
    expect(b).not.toContain('setHayCambiosSinGuardarMaquinariaEquipos');
    expect(b).not.toContain('maquinariaBaseline.current');
  });

  it('cada módulo tiene su propio useEffect de dirty, comparando contra su propio baseline', () => {
    expect(PAGE_TSX).toContain('setHayCambiosSinGuardarMaquinariaEquipos(maquinariaBaseline.current!==JSON.stringify(construirDatosEntradaMaquinaria()));');
    expect(PAGE_TSX).toContain('setHayCambiosSinGuardarCostosAdministrativos(adminBaseline.current!==JSON.stringify(construirDatosEntradaCostosAdministrativos()));');
  });
});

describe('GENERALES — 20) el modal de salida lista ambos cuando están sucios', () => {
  it('modulosConCambiosSinGuardar incluye los 7 módulos con guardado modular real', () => {
    const b = bloque('const modulosConCambiosSinGuardar:string[]=[', '];');
    expect(b).toContain("...(hayCambiosSinGuardarManoObra?['Mano de Obra']:[])");
    expect(b).toContain("...(hayCambiosSinGuardarTurnantes?['Turnantes']:[])");
    expect(b).toContain("...(hayCambiosSinGuardarDotacionEpp?['EPP y Dotación']:[])");
    expect(b).toContain("...(hayCambiosSinGuardarExamenesMedicos?['Exámenes, Cursos y Vacunas']:[])");
    expect(b).toContain("...(hayCambiosSinGuardarMaquinariaEquipos?['Maquinaria y Equipos']:[])");
    expect(b).toContain("...(hayCambiosSinGuardarInsumos?['Insumos']:[])");
    expect(b).toContain("...(hayCambiosSinGuardarCostosAdministrativos?['Costos Administrativos']:[])");
  });
});

describe('GENERALES — 21) cambiar de pestaña es libre (misma TABS.map genérica, sin gate)', () => {
  it('el botón de pestaña usa setTab directo, sin intentarNavegarFueraDeManoObra', () => {
    const idxTabsMap = PAGE_TSX.indexOf('{TABS.map((t,i)=>{');
    const idxBoton = PAGE_TSX.indexOf('<button onClick={()=>setTab(key)}', idxTabsMap);
    expect(idxTabsMap).toBeGreaterThan(-1);
    expect(idxBoton).toBeGreaterThan(idxTabsMap);
  });
});

describe('GENERALES — 22) el total general no duplica componentes', () => {
  it('totalEstructuraCostos es exactamente costoMensualGeneral del consolidado canónico', () => {
    expect(PAGE_TSX).toContain('const totalEstructuraCostos=consolidadoAdmin.costoMensualGeneral;');
  });

  it('totalCostosModulos (Mano de Obra + Maquinaria + Insumos) nunca incluye Costos Administrativos', () => {
    const b = bloque('const totalCostosModulos=', ';');
    expect(b).not.toContain('adminTotal');
    expect(b).not.toContain('consolidadoAdmin');
  });

  it('tarifaMensualTotalManoObra ya incluye Dotación/EPP y Exámenes/Cursos/Vacunas — nunca se vuelven a sumar aparte en totalCostosModulos', () => {
    const b = bloque('const baseCostoDirectoAdministrativos=', 'const totalCostosModulos=');
    expect(b).not.toContain('totalDotacionEppGeneral');
    expect(b).not.toContain('examTotal');
    expect(b).not.toContain('agregadoTurnantesMensual');
  });
});
