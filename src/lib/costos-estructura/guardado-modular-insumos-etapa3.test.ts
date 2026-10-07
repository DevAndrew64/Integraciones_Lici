/**
 * Ajuste "REDISEÑAR LA PESTAÑA INSUMOS" ETAPA 3 — guardado modular
 * independiente, baseline/dirty propios, conflicto 409, hidratación,
 * Resumen/Resultado y corrección general de `modulosConCambiosSinGuardar`.
 * Mismo patrón `bloque()` que el resto de guardado-modular-*.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLAVES_MODULO } from './guardado-modular';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');

function bloque(inicioMarcador: string, finMarcador: string, desde = 0): string {
  const inicio = PAGE_TSX.indexOf(inicioMarcador, desde);
  if (inicio === -1) throw new Error(`No se encontró el marcador de inicio: ${inicioMarcador}`);
  const fin = PAGE_TSX.indexOf(finMarcador, inicio);
  if (fin === -1) throw new Error(`No se encontró el marcador de fin: ${finMarcador}`);
  return PAGE_TSX.slice(inicio, fin);
}

describe('§1) "insumos" ya existe en ClaveModulo/CLAVES_MODULO', () => {
  it('CLAVES_MODULO contiene insumos', () => {
    expect(CLAVES_MODULO).toContain('insumos');
  });
});

describe('§1/§2/§3) guardarModuloInsumos guarda con modulo:\'insumos\', payload propio y totales', () => {
  it('llama ejecutarGuardadoModuloCosteo con la clave insumos', () => {
    const b = bloque('async function guardarModuloInsumos(', 'async function guardarAvanceInsumos(');
    expect(b).toContain("ejecutarGuardadoModuloCosteo('insumos',estadoDestino,datosEntrada,insumosUltimaActualizacion,{totalMensualInsumos})");
  });

  it('construirDatosEntradaInsumos devuelve únicamente insumosRows', () => {
    const b = bloque('function construirDatosEntradaInsumos(){', 'const insumosBaseline=useRef');
    expect(b).toContain('return { insumosRows };');
    expect(b).not.toContain('cargosTurnantes');
    expect(b).not.toContain('dotGroups');
    expect(b).not.toContain('examRows');
    expect(b).not.toContain('maqRows');
    expect(b).not.toContain('adminRows');
  });
});

describe('§4/§5/§6) Éxito actualiza baseline/estado y limpia SOLO el dirty de Insumos', () => {
  it('guardarModuloInsumos actualiza insumosBaseline y hayCambiosSinGuardarInsumos únicamente en la rama de éxito', () => {
    const b = bloque('async function guardarModuloInsumos(', 'async function guardarAvanceInsumos(');
    expect(b).toContain('setEstadoModuloInsumos(r.estado!)');
    expect(b).toContain('setInsumosUltimaActualizacion(r.ultimaActualizacion!)');
    expect(b).toContain('insumosBaseline.current=JSON.stringify(datosEntrada)');
    expect(b).toContain('setHayCambiosSinGuardarInsumos(false)');
    // nunca toca el dirty de otros módulos en esta función
    expect(b).not.toContain('setHayCambiosSinGuardarManoObra');
    expect(b).not.toContain('setHayCambiosSinGuardarDotacionEpp');
    expect(b).not.toContain('setHayCambiosSinGuardarExamenesMedicos');
  });

  it('la rama de error retorna false SIN tocar baseline ni limpiar el dirty', () => {
    const b = bloque('async function guardarModuloInsumos(', 'async function guardarAvanceInsumos(');
    const bError = b.slice(b.indexOf('if(!r.ok){'), b.indexOf('return false;') + 'return false;'.length);
    expect(bError).not.toContain('insumosBaseline.current');
    expect(bError).not.toContain('setHayCambiosSinGuardarInsumos');
  });
});

describe('§4/§7) "Almacenar insumos" marca dirty, nunca lo limpia directamente', () => {
  it('almacenarInsumos solo cambia insumosRows — el dirty se recalcula reactivamente contra el baseline, nunca se limpia aquí', () => {
    const b = bloque('const almacenarInsumos=()=>{', '};');
    expect(b).not.toContain('insumosBaseline.current=');
    expect(b).not.toContain('setHayCambiosSinGuardarInsumos(false)');
  });

  it('el useEffect de dirty compara SIEMPRE contra el baseline (comparación estructural, no por referencia)', () => {
    const b = bloque('const insumosBaseline=useRef<string|null>(null);', '},[insumosRows]);');
    expect(b).toContain('setHayCambiosSinGuardarInsumos(insumosBaseline.current!==JSON.stringify(construirDatosEntradaInsumos()))');
  });
});

describe('§8) Un conflicto 409 conserva el borrador y el dirty (tratamiento genérico ya existente)', () => {
  it('ejecutarGuardadoModuloCosteo devuelve ok:false en 409, sin togar el módulo ni versionConocida', () => {
    const b = bloque('if(res.status===409){', 'if(!res.ok||!d.ok)return{ok:false');
    expect(b).toContain("mensajeError:d.mensaje||'Esta sección fue actualizada por otro usuario. Recarga la información antes de guardar tus cambios.'");
  });

  it('guardarModuloInsumos en la rama de error (incluye 409) nunca actualiza insumosRows ni el baseline', () => {
    const b = bloque('async function guardarModuloInsumos(', 'async function guardarAvanceInsumos(');
    expect(b).not.toContain('setInsumosRows(');
  });
});

describe('§9/§10) Hidratación prioriza modulos.insumos; fallback histórico sin duplicar', () => {
  it('moduloInsumosResuelto lee el módulo propio "insumos"', () => {
    expect(PAGE_TSX).toContain("const moduloInsumosResuelto=obtenerModulo<{insumosRows?:unknown}>(dCrudo,'insumos');");
  });

  it('insumosRowsCrudo prioriza el módulo, usa d.insumosRows SOLO como fallback (ternario, nunca combina ambas fuentes)', () => {
    const b = bloque('const insumosRowsCrudo=', 'const insumosRowsD=');
    expect(b).toContain('Array.isArray(moduloInsumosResuelto?.datos?.insumosRows)?moduloInsumosResuelto?.datos?.insumosRows:d.insumosRows');
  });

  it('cada fila pasa por normalizarInsumoHistorico (compatibilidad defensiva, sin recalcular IVA ya persistido)', () => {
    const b = bloque('const insumosRowsCrudo=', 'nextInsumoId.current=Math.max(nextInsumoId.current,maxIns+1);');
    expect(b).toContain('.map(normalizarInsumoHistorico)');
  });

  it('Ajuste "ya estaba guardado y no permite" — el efecto que captura los baselines tras restaurar reinicia el de Insumos con los datos YA actualizados (aplicarDatosGuardados solo llama setState, que React aplica después de esa misma línea, no antes)', () => {
    const b = bloque('const capturarBaselinesTrasRestaurarRef=useRef(false);', '\n  });');
    expect(b).toContain('insumosBaseline.current=JSON.stringify(construirDatosEntradaInsumos());');
    expect(b).toContain('setHayCambiosSinGuardarInsumos(false);');
  });
});

describe('§11) modulosConCambiosSinGuardar incluye los 5 módulos con guardado real (corrección general, no aislada)', () => {
  it('incluye Mano de Obra, Turnantes, EPP y Dotación, Exámenes/Cursos/Vacunas e Insumos', () => {
    const b = bloque('const modulosConCambiosSinGuardar:string[]=[', '];');
    expect(b).toContain("...(hayCambiosSinGuardarManoObra?['Mano de Obra']:[])");
    expect(b).toContain("...(hayCambiosSinGuardarTurnantes?['Turnantes']:[])");
    expect(b).toContain("...(hayCambiosSinGuardarDotacionEpp?['EPP y Dotación']:[])");
    expect(b).toContain("...(hayCambiosSinGuardarExamenesMedicos?['Exámenes, Cursos y Vacunas']:[])");
    expect(b).toContain("...(hayCambiosSinGuardarInsumos?['Insumos']:[])");
  });

  // Ajuste "REDISEÑAR MAQUINARIA Y EQUIPOS/COSTOS ADMINISTRATIVOS" — ambos
  // módulos ya tienen guardado modular y dirty reales, así que ahora SÍ
  // se incluyen (ver guardado-modular-maquinaria-admin.test.ts).
  it('Maquinaria y Costos Administrativos ya se incluyen (tienen guardado modular y dirty reales)', () => {
    const b = bloque('const modulosConCambiosSinGuardar:string[]=[', '];');
    expect(b).toContain('Maquinaria');
    expect(b).toContain('Costos Administrativos');
  });

  it('cambiar de pestaña interna sigue usando setTab directo, sin gate (Insumos incluido, misma TABS.map genérica, ahora un stepper)', () => {
    const idxTabsMap = PAGE_TSX.indexOf('{TABS.map((t,i)=>{');
    const idxBoton = PAGE_TSX.indexOf('<button onClick={()=>setTab(key)}', idxTabsMap);
    expect(idxTabsMap).toBeGreaterThan(-1);
    expect(idxBoton).toBeGreaterThan(idxTabsMap);
  });

  it('"Volver" (única salida real) pasa por intentarNavegarFueraDeManoObra', () => {
    expect(PAGE_TSX).toContain('onClick={()=>intentarNavegarFueraDeManoObra(()=>{setSolicitudProceso(null);setModalProcesoAbierto(true);})}');
  });
});

describe('§12) Resumen muestra el total de Insumos, misma fuente que la pestaña', () => {
  it('la tarjeta de Resumen usa totalMensualInsumos, nunca otra fórmula', () => {
    // Ajuste (feedback en vivo, screenshot) "existe forma que todo quepa en
    // un solo bloque y no tenga que desplazar" — fontSize de esta tarjeta
    // bajó de 11 a 10 (panel de Resumen compactado completo); el marcador
    // se actualiza para seguir apuntando al mismo bloque real.
    const b = bloque("<span style={{fontSize:10,fontWeight:700,color:'#374151',fontFamily:F}}>Insumos</span>", '<button onClick={exportarCostos}');
    expect(b).toContain('{cop(totalMensualInsumos)}');
  });
});

describe('§13) Resultado incluye Insumos exactamente una vez, sin doble conteo', () => {
  it('totalEstructuraCostos suma Mano de Obra + Maquinaria + Administrativos + Insumos, una sola vez cada uno (fórmula canónica del consolidado)', () => {
    expect(PAGE_TSX).toContain('const totalCostosModulos=baseCostoDirectoAdministrativos;');
    expect(PAGE_TSX).toContain('const totalEstructuraCostos=consolidadoAdmin.costoMensualGeneral;');
  });

  it('Resultado (Tarifa del servicio) lista una única fila "Insumos" con el mismo total totalMensualInsumos, sin reconstruirlo', () => {
    const ocurrencias = (PAGE_TSX.match(/titulo="Insumos" valor=\{rts\.insumos\}/g) ?? []).length;
    expect(ocurrencias).toBe(1);
    expect(PAGE_TSX).toContain('insumos:totalMensualInsumos,');
  });

  it('el total general de la estructura (Mano de obra+Insumos+Equipos+Costos administrativos) se muestra en la pestaña Resultado como "Subtotal para aplicar A.I.U.", y de ahí en adelante hacia "Valor mensual incluido IVA"/"Valor total vigencia" — nunca un total aparte que pueda desviarse', () => {
    expect(PAGE_TSX).toContain('<FilaSubtotalTarifaServicio label="Subtotal para aplicar A.I.U." valor={rts.subtotalParaAiu}/>');
    expect(PAGE_TSX).toContain('{cop(rts.valorMesIncluidoIva)}');
    expect(PAGE_TSX).toContain("rts.valorTotalVigencia!=null?cop(rts.valorTotalVigencia)");
  });
});

describe('§21/§22/§23) Guardar Insumos no modifica Mano de Obra, EPP/Dotación ni Exámenes', () => {
  it('guardarModuloInsumos no llama a ningún setter de otro módulo', () => {
    const b = bloque('async function guardarModuloInsumos(', 'async function guardarAvanceInsumos(');
    expect(b).not.toContain('setDotGroups');
    expect(b).not.toContain('setExamRows');
    expect(b).not.toContain('setCursosRows');
    expect(b).not.toContain('setVacunasRows');
    expect(b).not.toContain('setEstadoModuloManoObra');
    expect(b).not.toContain('setEstadoModuloDotacionEpp');
    expect(b).not.toContain('setEstadoModuloExamenesMedicos');
  });
});

describe('§6) Botón Guardar Insumos, deshabilitado durante un guardado activo', () => {
  it('Ajuste "un solo guardado" — el botón usa disabled={guardandoModuloInsumos}; ya no hay botón "Finalizar" separado', () => {
    expect(PAGE_TSX).toContain('<button onClick={guardarAvanceInsumos} disabled={guardandoModuloInsumos}');
    expect(PAGE_TSX).not.toContain('function finalizarInsumos(');
  });

  it('guardarAvanceInsumos no exige insumosRows no vacío (misma convención que dotacionEpp/examenesMedicos, que tampoco lo exigen)', () => {
    const b = bloque('async function guardarAvanceInsumos(', 'async function guardarModuloMaquinaria(');
    expect(b).not.toContain('insumosRows.length');
  });
});
