/**
 * Ajuste "REDISEÑAR 'REGISTRAR MAQUINARIA Y EQUIPOS' COMO TABLA" —
 * verificación de que el modal post-selección usa UNA fila por equipo
 * (nunca una tarjeta grande), que todos los campos editables se conservan,
 * y que la disponibilidad NO verificada nunca se presenta como un
 * resultado confirmado (A comprar/Compra Mes/Total Mes) — sin tocar el
 * motor de cálculo puro (calculo-maquinaria.ts sigue con cantidadDisponible
 * como `number`, maqTotal/Administrativos/Resultado sin cambios). Mismo
 * patrón `bloque()` de assertions sobre PAGE_TSX que el resto de
 * guardado-modular-*.test.ts.
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

const inicioTabla = PAGE_TSX.indexOf("{showModalMaquinaria&&(");
const finTabla = PAGE_TSX.indexOf('Guardar y cerrar</button>', inicioTabla);
const BLOQUE_MODAL = PAGE_TSX.slice(inicioTabla, finTabla);

describe('MAQUINARIA — tabla integrada "Registrar maquinaria y equipos" (1-4: estructura de filas, nunca tarjeta)', () => {
  it('1/2/3) una fila por equipo vía borradorMaquinaria.map, con columnas fijas (cols[]) — nunca una tarjeta grande por equipo', () => {
    expect(BLOQUE_MODAL).toContain('const cols:{label:string;grupo:string;width:number;align:');
    expect(BLOQUE_MODAL).toContain('{borradorMaquinaria.map(r=>{');
    // La fila usa el mismo <div key={r.id}> de layout flex de columna fija
    // (nunca un contenedor de tarjeta con título grande por equipo).
    expect(BLOQUE_MODAL).toContain('<div key={r.id} style={{display:\'flex\',alignItems:\'center\',gap:6,padding:\'6px 8px\'');
  });

  it('4) Producto/descripción aparece como columna, con nombre completo disponible vía title', () => {
    expect(BLOQUE_MODAL).toContain("{label:'Producto',grupo:'IDENTIFICACIÓN',width:210,align:'left'}");
    expect(BLOQUE_MODAL).toContain('title={r.descripcion}');
  });
});

describe('MAQUINARIA — tabla integrada (5-8: campos editables inline, sin segundo modal)', () => {
  it('5) cantidad requerida sigue editable inline', () => {
    expect(BLOQUE_MODAL).toContain("actualizarMaquinariaBorrador(r.id,{cantidadRequerida:Number(e.target.value)||0})");
  });

  it('6) frecuencia/depreciación (mesesDepreciacion) sigue editable inline, con tooltip de equivalencia Excel (nunca renombrada sin evidencia)', () => {
    expect(BLOQUE_MODAL).toContain("actualizarMaquinariaBorrador(r.id,{mesesDepreciacion:Number(e.target.value)||0})");
    expect(BLOQUE_MODAL).toContain('Excel: Frecuencia de entrega');
  });

  it('7) valor unitario sigue editable inline, con formato moneda (mismo patrón que Mano de Obra: type=text+inputMode=numeric, solo dígitos)', () => {
    expect(BLOQUE_MODAL).toContain("actualizarMaquinariaBorrador(r.id,{valorUnitario:Number(e.target.value.replace(/\\D/g,''))||0})");
    expect(BLOQUE_MODAL).toContain("value={r.valorUnitario?'$ '+r.valorUnitario.toLocaleString('es-CO'):''}");
  });

  it('8) Ajuste "PLANTILLA EXCEL COMO REFERENCIA FUNCIONAL" — el toggle de IVA por fila se retiró de la tabla y del formulario manual (el Excel real no lo tiene)', () => {
    expect(BLOQUE_MODAL).not.toContain("checked={r.incluyeIva}");
    expect(BLOQUE_MODAL).not.toContain("{label:'IVA',grupo:'REQUERIMIENTO'");
    const bloqueManual = bloque('{showModalManualMaquinaria&&(()=>{', 'Guardar</button>');
    expect(bloqueManual).not.toContain('checked={f.incluyeIva}');
    expect(bloqueManual).not.toContain('El valor unitario ya incluye IVA');
  });

  it('Vr Und/Vr con IVA quedan como columnas contiguas (sin columna IVA entre ellas), Vr con IVA es solo lectura', () => {
    expect(BLOQUE_MODAL).toContain("{label:'Vr Und',grupo:'REQUERIMIENTO',width:82,align:'right'}");
    expect(BLOQUE_MODAL).toContain("{label:'Vr con IVA',grupo:'REQUERIMIENTO',width:82,align:'right'}");
    // Vr con IVA se renderiza como texto calculado (cop(r.valorConIva)), nunca un <input> editable.
    expect(BLOQUE_MODAL).not.toMatch(/valorConIva:[^}]*onChange/);
  });

  it('incluyeIva se conserva internamente por compatibilidad histórica, pero nunca se sobreescribe al editar otros campos de la fila', () => {
    const b = bloque('const actualizarMaquinariaBorrador=(', 'const eliminarMaquinariaBorrador=');
    // `cambios` nunca puede incluir incluyeIva (ya no existe control de UI que lo envíe) — Pick sigue
    // permitiéndolo por tipo (compatibilidad), pero el spread `{...r,...cambios}` respeta r.incluyeIva
    // tal cual estaba persistido cuando `cambios` no lo trae.
    expect(b).toContain('const actualizado={...r,...cambios,origenMantenimiento,disponibilidadVerificada};');
  });

  it('filas nuevas (catálogo y manual) siempre nacen con incluyeIva:false, así que Vr con IVA = Vr Und × 1.19 automáticamente', () => {
    const bCatalogo = bloque('const agregarSeleccionadosMaq=()=>{', 'const guardarManualMaquinaria=');
    expect(bCatalogo).toContain('incluyeIva:false');
    expect(PAGE_TSX).toContain("valorUnitario:'',incluyeIva:false,"); // FORM_MANUAL_MAQUINARIA_VACIO
  });
});

describe('MAQUINARIA — tabla integrada (VR CON IVA = VR UND × 1.19, mismo helper existente, nunca 1.19 hardcodeado en el JSX)', () => {
  it('calcularValorConIvaMaquinaria(valorUnitario,false) aplica exactamente PORCENTAJE_IVA_MAQUINARIA_EQUIPO — verificado con los 4 ejemplos aportados por el usuario', async () => {
    const { calcularValorConIvaMaquinaria, PORCENTAJE_IVA_MAQUINARIA_EQUIPO } = await import('./calculo-maquinaria');
    expect(PORCENTAJE_IVA_MAQUINARIA_EQUIPO).toBe(1.19);
    expect(calcularValorConIvaMaquinaria(5278908, false)).toBeCloseTo(6281900.52, 2); // VAPORIZADORA
    expect(calcularValorConIvaMaquinaria(16150000, false)).toBe(19218500); // AUTOSCRUBBER
    expect(calcularValorConIvaMaquinaria(1800000, false)).toBe(2142000); // BATERÍAS
    expect(calcularValorConIvaMaquinaria(1634000, false)).toBe(1944460); // ASPIRADORA
  });

  it('el JSX de la tabla nunca hardcodea 1.19 — reutiliza r.valorConIva ya calculado por calcularCamposMaquinariaEquipo', () => {
    expect(BLOQUE_MODAL).not.toMatch(/valorUnitario\s*\*\s*1\.19/);
  });
});

describe('MAQUINARIA — tabla integrada (9-10: valores calculados reutilizan los helpers existentes, ninguna fórmula nueva en el JSX)', () => {
  it('9) Vr con IVA muestra r.valorConIva (calculado por calcularCamposMaquinariaEquipo, nunca una fórmula inline)', () => {
    expect(BLOQUE_MODAL).toContain('{cop(r.valorConIva)}');
  });

  it('10) Vr Mes teórico muestra r.valorMesRequerido, distinguido explícitamente de "Compra/Mes" (nunca se suma al total)', () => {
    expect(BLOQUE_MODAL).toContain('title="Costo mensual teórico de comprar TODA la cantidad requerida — informativo, nunca se suma al total."');
    expect(BLOQUE_MODAL).toContain('{cop(r.valorMesRequerido)}');
  });
});

describe('MAQUINARIA — tabla integrada (11-13: disponibilidad NO verificada nunca se presenta como resultado confirmado)', () => {
  it('11/12) "A comprar" muestra "Pendiente" (nunca un número) mientras disponibilidadVerificada sea falso — nunca fuerza A comprar=cantidadRequerida en silencio', () => {
    expect(BLOQUE_MODAL).toContain('const dispPendiente=!r.disponibilidadVerificada;');
    expect(BLOQUE_MODAL).toContain("{dispPendiente?'Pendiente':r.cantidadComprar}");
  });

  it('13) "Compra/Mes" y "Total/Mes" también muestran "Pendiente" mientras la disponibilidad no esté verificada — nunca un costo definitivo con datos incompletos', () => {
    expect(BLOQUE_MODAL).toContain("{dispPendiente?'Pendiente':cop(r.valorMesComprar)}");
    expect(BLOQUE_MODAL).toContain("{dispPendiente?'Pendiente':cop(totalMensualEquipo)}");
  });

  it('el motor de cálculo NO cambia: cantidadDisponible/cantidadComprar/valorMesComprar siguen siendo `number` en calculo-maquinaria.ts (Pendiente es solo presentación)', () => {
    const lib = readFileSync(join(__dirname, 'calculo-maquinaria.ts'), 'utf-8');
    expect(lib).toContain('cantidadDisponible: number;');
    expect(lib).not.toContain('cantidadDisponible: number | null');
  });

  it('actualizarMaquinariaBorrador marca disponibilidadVerificada=true SOLO cuando la edición incluye cantidadDisponible (incluso si el usuario confirma 0)', () => {
    const b = bloque('const actualizarMaquinariaBorrador=(', 'const eliminarMaquinariaBorrador=');
    expect(b).toContain("const disponibilidadVerificada='cantidadDisponible' in cambios?true:r.disponibilidadVerificada;");
  });

  it('guardarManualMaquinaria marca disponibilidadVerificada=true (el formulario manual muestra "Disponible" explícitamente en pantalla)', () => {
    const b = bloque('const guardarManualMaquinaria=()=>{', 'cerrarModalManualMaquinaria();');
    expect((b.match(/disponibilidadVerificada:true/g) ?? []).length).toBe(2); // rama de edición y rama de creación
  });

  // Ajuste "NUEVA API DE MAQUINARIA Y EQUIPOS — DISPONIBILIDAD Y
  // MANTENIMIENTO COMO FUENTE DE VERDAD" — desde que `cant_disponible`
  // viene directo de la fuente (nunca un placeholder en 0), una fila
  // nueva del catálogo YA es disponibilidad real/verificada — deja de
  // nacer "pendiente".
  it('agregarSeleccionadosMaq (catálogo) SÍ marca disponibilidadVerificada:true — la disponibilidad viene real de la nueva API, nunca queda pendiente de confirmación manual', () => {
    const b = bloque('const agregarSeleccionadosMaq=()=>{', 'const guardarManualMaquinaria=');
    expect(b).toContain('disponibilidadVerificada:true');
  });
});

describe('MAQUINARIA — tabla integrada (14: resumen no presenta un total falso como definitivo)', () => {
  it('el resumen muestra una advertencia explícita cuando hay filas con disponibilidad sin verificar, sin alterar los subtotales reales (motor intacto)', () => {
    const b = bloque('{borradorMaquinaria.length>0&&(()=>{', "Cancelar</button>");
    expect(b).toContain('const filasPendientes=borradorMaquinaria.filter(r=>!r.disponibilidadVerificada).length;');
    expect(b).toContain('con disponibilidad sin verificar');
    // Los subtotales siguen usando exactamente las mismas funciones puras.
    expect(b).toContain('calcularSubtotalAdquisicionMaquinaria(borradorMaquinaria)');
    expect(b).toContain('calcularSubtotalMantenimientoMaquinaria(borradorMaquinaria)');
  });
});

describe('MAQUINARIA — tabla integrada (mantenimiento sin coincidencia se muestra como "$0", petición directa — reemplaza la decisión anterior de "Sin coincidencia")', () => {
  it('Mtto/Mes muestra $0 (cop(r.valorMesMantenimiento), sin condicional de texto) cuando valorMantenimientoMensualUnitario es null', () => {
    expect(BLOQUE_MODAL).not.toContain('Sin coincidencia');
    expect(BLOQUE_MODAL).toContain("title={ORIGEN_MANTENIMIENTO_TEXTO[r.origenMantenimiento]}>{cop(r.valorMesMantenimiento)}</div>");
  });

  it('el input de mantenimiento unitario muestra "$ 0" (nunca vacío/placeholder) cuando no hay tarifa', () => {
    expect(BLOQUE_MODAL).not.toContain('placeholder="Sin tarifa"');
    expect(BLOQUE_MODAL).toContain("value={'$ '+(r.valorMantenimientoMensualUnitario??0).toLocaleString('es-CO')}");
  });
});

describe('MAQUINARIA — tabla integrada (15: eliminar afecta solo su fila)', () => {
  it('cada fila usa BtnDel con eliminarMaquinariaBorrador(r.id), que filtra únicamente por ese id', () => {
    expect(BLOQUE_MODAL).toContain('<BtnDel onClick={()=>eliminarMaquinariaBorrador(r.id)}/>');
    expect(PAGE_TSX).toContain('const eliminarMaquinariaBorrador=(id:number)=>setBorradorMaquinaria(p=>p.filter(r=>r.id!==id));');
  });
});

describe('MAQUINARIA — tabla integrada (17/21: encabezado y contenedor)', () => {
  it('agrupa visualmente el encabezado en 2 niveles con IDENTIFICACIÓN/REQUERIMIENTO/DISPONIBILIDAD/MANTENIMIENTO/RESULTADO', () => {
    expect(BLOQUE_MODAL).toContain("grupo:'IDENTIFICACIÓN'");
    expect(BLOQUE_MODAL).toContain("grupo:'REQUERIMIENTO'");
    expect(BLOQUE_MODAL).toContain("grupo:'DISPONIBILIDAD'");
    expect(BLOQUE_MODAL).toContain("grupo:'MANTENIMIENTO'");
    expect(BLOQUE_MODAL).toContain("grupo:'RESULTADO'");
  });

  it('scroll horizontal: el contenedor de la tabla usa overflowX:auto (nunca comprimido a costa de la legibilidad)', () => {
    expect(BLOQUE_MODAL).toContain("overflowX:'auto' as const");
  });

  it('encabezado sticky dentro del área con scroll (2 niveles, ambos position:sticky)', () => {
    expect(BLOQUE_MODAL).toContain("position:'sticky' as const,top:0");
    expect(BLOQUE_MODAL).toContain("position:'sticky' as const,top:14");
  });
});

describe('MAQUINARIA — tabla integrada (15/botones: catálogo y manual quedan ANTES de la tabla)', () => {
  it('"Seleccionar desde catálogo" y "Agregar equipo manual" aparecen antes del bloque de tabla/tarjetas', () => {
    const idxBotones = BLOQUE_MODAL.indexOf('Seleccionar desde catálogo');
    const idxTabla = BLOQUE_MODAL.indexOf("const cols:{label:string;grupo:string;width:number;align:");
    expect(idxBotones).toBeGreaterThan(-1);
    expect(idxTabla).toBeGreaterThan(idxBotones);
  });
});
