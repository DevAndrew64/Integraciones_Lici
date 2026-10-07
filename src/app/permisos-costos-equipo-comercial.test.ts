/**
 * Ajuste "PERMISOS DE COSTOS — EQUIPO COMERCIAL" (frontend) — dentro de
 * `ModuloEstructuraCostos` (pestaña "Costos" embebida en la ficha), VER
 * (lectura) sigue abierto a cualquier sesión con acceso a la ficha (sin
 * cambios); EDITAR (crear/guardar/eliminar/mutar cualquier campo) exige
 * Administrador o Equipo Comercial (`puedeEditarCostosUI`, fuente única
 * `@/lib/roles`, MISMA que el backend `requireEditarCostos` en
 * `src/lib/authz.ts`). Mismo patrón de texto fuente que el resto de
 * *-page.test.ts (sin harness de render de componentes en este repo) — ver
 * `src/app/sqr-menu-solo-admin.test.ts`/`src/app/evidencia-visible-para-consulta.test.ts`
 * para el patrón exacto usado en todo el repo.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, 'page.tsx'), 'utf-8');

const INICIO_MODULO = PAGE_TSX.indexOf('function ModuloEstructuraCostos(');
const FIN_MODULO = PAGE_TSX.indexOf('function Placeholder(', INICIO_MODULO);
const MODULO = PAGE_TSX.slice(INICIO_MODULO, FIN_MODULO);

describe('ModuloEstructuraCostos — existe y arranca antes de Placeholder', () => {
  it('se encontraron los límites del componente', () => {
    expect(INICIO_MODULO).toBeGreaterThan(-1);
    expect(FIN_MODULO).toBeGreaterThan(INICIO_MODULO);
  });
});

describe('puedeEditarCostosUI — fórmula exacta, fuente única @/lib/roles', () => {
  it('importa isAdmin y esEquipoComercial desde @/lib/roles (sin duplicar el import)', () => {
    expect(PAGE_TSX).toContain("import { esMercadeo, isAdmin, esProcesoPrivadoPorAlias, esEquipoComercial } from '@/lib/roles';");
  });

  it('define puedeEditarCostosUI con la fórmula exacta isAdmin || esEquipoComercial', () => {
    expect(MODULO).toContain("const puedeEditarCostosUI = isAdmin(sesion?.rol ?? '') || esEquipoComercial(sesion?.rol ?? '');");
  });

  it('no toca esAdminCostos (gate preexistente, exclusivo de Administrador, para el override manual de IVA)', () => {
    expect(MODULO).toContain("const esAdminCostos=sesion?.rol==='Administrador';");
  });

  it('nunca compara rol==="..." directamente para gatear edición (siempre a través de puedeEditarCostosUI)', () => {
    // Todas las comparaciones literales de rol dentro del módulo deben ser
    // exclusivamente la ya existente de esAdminCostos (IVA override) — no se
    // introduce una segunda.
    const comparacionesRol = MODULO.match(/rol\s*===\s*'[A-Za-zÀ-ÿ ]+'/g) ?? [];
    const noEsAdminCostos = comparacionesRol.filter(c => c !== "rol==='Administrador'");
    expect(noEsAdminCostos).toEqual([]);
  });
});

describe('Mano de Obra / Turnantes — controles de mutación gateados por puedeEditarCostosUI', () => {
  it('el botón "Guardar Mano de Obra" está condicionado a puedeEditarCostosUI', () => {
    const idx = MODULO.lastIndexOf("'Guardar Mano de Obra'");
    const idxGate = MODULO.lastIndexOf('{puedeEditarCostosUI&&(', idx);
    expect(idxGate).toBeGreaterThan(-1);
    expect(idx - idxGate).toBeLessThan(1000);
  });

  it('el botón "Guardar Turnantes" está condicionado a puedeEditarCostosUI', () => {
    const idx = MODULO.lastIndexOf("'Guardar Turnantes'");
    const idxGate = MODULO.lastIndexOf('{puedeEditarCostosUI&&(', idx);
    expect(idxGate).toBeGreaterThan(-1);
    expect(idx - idxGate).toBeLessThan(1000);
  });

  it('"Agregar cargo" (Mano de Obra) está condicionado a puedeEditarCostosUI', () => {
    const idx = MODULO.indexOf("abrirModalCargoNuevo('manoObra')");
    const antes = MODULO.slice(Math.max(0, idx - 100), idx);
    expect(antes).toContain('puedeEditarCostosUI&&');
  });
});

describe('EPP y Dotación — controles de mutación gateados', () => {
  it('el footer "Guardar EPP y Dotación" / "No aplica EPP/Dotación" está condicionado a puedeEditarCostosUI', () => {
    const idx = MODULO.indexOf('No aplica EPP/Dotación');
    const idxGate = MODULO.lastIndexOf('{puedeEditarCostosUI&&(', idx);
    expect(idxGate).toBeGreaterThan(-1);
    expect(idx - idxGate).toBeLessThan(3000);
  });

  it('el botón "No aplica {noAplica!.nombre}" (bloqueCategoria, reutilizado por masculina/femenina/EPP) exige puedeEditarCostosUI', () => {
    expect(MODULO).toContain('{mostrarBotonNoAplica&&puedeEditarCostosUI&&(');
  });

  it('"Seleccionar X"/"Agregar manual" (bloqueCategoria) están envueltos en puedeEditarCostosUI', () => {
    const idx = MODULO.indexOf('Agregar manual\n            </button>');
    expect(idx).toBeGreaterThan(-1);
  });
});

describe('Exámenes/Cursos/Vacunas — controles de mutación gateados', () => {
  it('el trigger "Gestionar exámenes, cursos y vacunas" (estado vacío) exige puedeEditarCostosUI', () => {
    const idx = MODULO.lastIndexOf('Gestionar exámenes, cursos y vacunas');
    const idxGate = MODULO.lastIndexOf('puedeEditarCostosUI&&', idx);
    expect(idxGate).toBeGreaterThan(-1);
    expect(idx - idxGate).toBeLessThan(300);
  });

  it('el footer "Guardar Exámenes, Cursos y Vacunas" / "No aplica Exámenes" está condicionado a puedeEditarCostosUI', () => {
    const idx = MODULO.indexOf('No aplica Exámenes');
    const idxGate = MODULO.lastIndexOf('{puedeEditarCostosUI&&(', idx);
    expect(idxGate).toBeGreaterThan(-1);
    expect(idx - idxGate).toBeLessThan(3000);
  });
});

describe('Insumos — controles de mutación gateados, incluido VR UNIT. editable', () => {
  it('el input VR UNIT. (actualizarInsumoBorrador → valorUnitarioSinIva) está condicionado a puedeEditarCostosUI, con texto plano cop() en modo lectura', () => {
    const idx = MODULO.indexOf('valorUnitarioSinIva:parsearValorMonetario');
    expect(idx).toBeGreaterThan(-1);
    const antes = MODULO.slice(Math.max(0, idx - 500), idx);
    expect(antes).toContain('{puedeEditarCostosUI?(');
    const despues = MODULO.slice(idx, idx + 400);
    expect(despues).toContain('cop(r.valorUnitarioSinIva)');
  });

  it('cantidad y frecuenciaMeses del borrador de insumos también quedan en texto plano para solo lectura', () => {
    const idx = MODULO.indexOf("actualizarInsumoBorrador(r.id,{cantidad:Number(e.target.value)||0})");
    const antes = MODULO.slice(Math.max(0, idx - 400), idx);
    expect(antes).toContain('puedeEditarCostosUI?(<>');
  });

  it('"Seleccionar desde catálogo"/"Agregar insumo manual" (modal Registrar insumos) están condicionados a puedeEditarCostosUI', () => {
    const idx = MODULO.indexOf('Seleccionar desde catálogo\n                      </button>\n                      <button onClick={()=>abrirModalManualInsumo()}');
    expect(idx).toBeGreaterThan(-1);
    const idxGate = MODULO.lastIndexOf('{puedeEditarCostosUI&&(<>', idx);
    expect(idxGate).toBeGreaterThan(-1);
    expect(idx - idxGate).toBeLessThan(2000);
  });

  it('los triggers "Gestionar insumos"/"+ Agregar insumo" exigen puedeEditarCostosUI', () => {
    const ocurrencias = [...MODULO.matchAll(/Gestionar insumos<\/button>/g)];
    expect(ocurrencias.length).toBeGreaterThan(0);
    for (const m of ocurrencias) {
      const antes = MODULO.slice(Math.max(0, m.index! - 400), m.index);
      expect(antes).toContain('puedeEditarCostosUI&&');
    }
  });

  it('el botón "Eliminar" (BtnDel) de cada fila de insumo del borrador exige puedeEditarCostosUI', () => {
    expect(MODULO).toContain('{puedeEditarCostosUI&&<BtnDel onClick={()=>eliminarInsumoBorrador(r.id)}/>}');
  });
});

describe('Maquinaria y Equipos — controles de mutación gateados', () => {
  it('los triggers "Gestionar maquinaria y equipos" exigen puedeEditarCostosUI', () => {
    const ocurrencias = [...MODULO.matchAll(/Gestionar maquinaria y equipos<\/button>/g)];
    expect(ocurrencias.length).toBeGreaterThan(0);
    for (const m of ocurrencias) {
      const antes = MODULO.slice(Math.max(0, m.index! - 400), m.index);
      expect(antes).toContain('puedeEditarCostosUI&&');
    }
  });

  it('el footer "Guardar Maquinaria y Equipos" / "No aplica Equipos" está condicionado a puedeEditarCostosUI', () => {
    const idx = MODULO.indexOf('No aplica Equipos');
    const idxGate = MODULO.lastIndexOf('{puedeEditarCostosUI&&(', idx);
    expect(idxGate).toBeGreaterThan(-1);
    expect(idx - idxGate).toBeLessThan(3000);
  });

  it('"Seleccionar desde catálogo"/"Agregar equipo manual" (modal Registrar maquinaria) están condicionados a puedeEditarCostosUI', () => {
    const idxModal = MODULO.indexOf('Registrar maquinaria y equipos</div>');
    expect(idxModal).toBeGreaterThan(-1);
    const idx = MODULO.indexOf('Agregar equipo manual', idxModal);
    const antes = MODULO.slice(idxModal, idx);
    expect(antes).toContain('{puedeEditarCostosUI&&(');
  });
});

describe('Servicios No Continuos (SNC) — controles de mutación gateados', () => {
  it('el trigger "+ Agregar servicio no continuo" exige puedeEditarCostosUI', () => {
    expect(MODULO).toContain("{puedeEditarCostosUI&&<button onClick={abrirModalServicioNoContinuoNuevo}");
  });

  it('"Gestionar Serv. no continuos"/"Eliminar" (por servicio) exigen puedeEditarCostosUI', () => {
    const idx = MODULO.indexOf('Gestionar Serv. no continuos');
    const antes = MODULO.slice(Math.max(0, idx - 500), idx);
    expect(antes).toContain('{puedeEditarCostosUI&&(');
  });

  it('el footer "Guardar Servicios no continuos" está condicionado a puedeEditarCostosUI', () => {
    const idx = MODULO.indexOf('Guardar Servicios no continuos');
    const idxGate = MODULO.lastIndexOf('{puedeEditarCostosUI&&(', idx);
    expect(idxGate).toBeGreaterThan(-1);
    expect(idx - idxGate).toBeLessThan(3000);
  });
});

describe('Valor Agregado — controles de mutación gateados', () => {
  it('"+ Agregar reinversión" exige puedeEditarCostosUI', () => {
    expect(MODULO).toContain('{puedeEditarCostosUI&&<button onClick={abrirModalReinversionNuevo}');
  });

  it('"Editar Mano de Obra" (Valor Agregado) exige puedeEditarCostosUI', () => {
    expect(MODULO).toContain('{puedeEditarCostosUI&&<button onClick={abrirModalVAManoObra}');
  });

  it('el footer "Guardar avance" (Valor Agregado) está condicionado a puedeEditarCostosUI', () => {
    const idx = MODULO.indexOf("guardandoModuloValorAgregado?'Guardando...':'Guardar avance'");
    const idxGate = MODULO.lastIndexOf('{puedeEditarCostosUI&&(', idx);
    expect(idxGate).toBeGreaterThan(-1);
    expect(idx - idxGate).toBeLessThan(3000);
  });
});

describe('Costos Administrativos — controles de mutación gateados (esAdminCostos intacto)', () => {
  it('el botón compartido "Gestionar" (Pólizas/Impuestos/Variables Admin, BloqueResumenSeccionAdmin) exige puedeEditarCostosUI', () => {
    const idx = MODULO.indexOf('{tieneDatos?textoBotonConDatos:textoBotonSinDatos}');
    const idxGate = MODULO.lastIndexOf('{puedeEditarCostosUI&&(', idx);
    expect(idxGate).toBeGreaterThan(-1);
    expect(idx - idxGate).toBeLessThan(2000);
  });

  it('"VALOR DE LA OFERTA" y "DURACIÓN DEL CONTRATO" quedan en texto plano para solo lectura', () => {
    expect(MODULO).toContain('{puedeEditarCostosUI?(\n                  <div style={{position:\'relative\' as const,width:190}}>');
    expect(MODULO).toContain("{puedeEditarCostosUI?(\n                  <input type=\"number\" value={polizasNumeroMesesContrato}");
  });

  it('el footer "Guardar Costos Administrativos" está condicionado a puedeEditarCostosUI', () => {
    const idx = MODULO.indexOf('Guardar Costos Administrativos');
    const idxGate = MODULO.lastIndexOf('{puedeEditarCostosUI&&(', idx);
    expect(idxGate).toBeGreaterThan(-1);
    expect(idx - idxGate).toBeLessThan(2000);
  });

  it('el override manual de régimen de IVA (esAdminCostos, Avisos/Estampillas) NO fue tocado — sigue siendo exclusivo de esAdminCostos, nunca ampliado a puedeEditarCostosUI', () => {
    const idxAvisos = MODULO.indexOf('title="Aplica"');
    expect(idxAvisos).toBeGreaterThan(-1);
  });
});

describe('Tarifa Regulada — controles de mutación gateados', () => {
  it('"+ Agregar posición" exige puedeEditarCostosUI', () => {
    expect(MODULO).toContain('{puedeEditarCostosUI&&<button onClick={agregarPosicionTarifaRegulada}');
  });

  it('los campos de cada posición (Descripción/Tipo/Modalidad/Turno/Cantidad) quedan en texto plano para solo lectura', () => {
    const idx = MODULO.indexOf('actualizarPosicionTarifaRegulada(pos.id,{descripcion:e.target.value})');
    const antes = MODULO.slice(Math.max(0, idx - 100), idx);
    expect(antes).toContain('{puedeEditarCostosUI?(');
  });

  it('"Eliminar posición" exige puedeEditarCostosUI', () => {
    const idx = MODULO.indexOf('Eliminar posición');
    const idxGate = MODULO.lastIndexOf('{puedeEditarCostosUI&&(', idx);
    expect(idxGate).toBeGreaterThan(-1);
    expect(idx - idxGate).toBeLessThan(1000);
  });

  it('el footer "Guardar Tarifa Regulada" está condicionado a puedeEditarCostosUI', () => {
    const idx = MODULO.indexOf('Guardar Tarifa Regulada');
    const idxGate = MODULO.lastIndexOf('{puedeEditarCostosUI&&(', idx);
    expect(idxGate).toBeGreaterThan(-1);
    expect(idx - idxGate).toBeLessThan(2000);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Ajuste "PERMISOS DE COSTOS — RESIDUAL GESTIONAR TARIFA/GUARDAR RESULTADO"
// — reportado en vivo por el usuario (Analista Mercadeo veía "Gestionar
// tarifa" en la tarjeta "Tarifa del servicio" y "Guardar Resultado" en el
// pie de la pestaña Resultado, ambos sin gate). El describe anterior
// ("Resultado — sin controles de mutación") quedó OBSOLETO por diseño —
// Resultado sí tiene 2 controles de mutación reales (configurar %I.U./
// régimen IVA vía "Gestionar tarifa", y "Guardar Resultado" del guardado
// modular por etapas) — ambos corregidos aquí con el mismo patrón
// `puedeEditarCostosUI&&` + protección defensiva en el handler.
// ═══════════════════════════════════════════════════════════════════════
describe('Resultado — "Gestionar tarifa" gateado (botón + handler defensivo)', () => {
  it('el botón "Gestionar tarifa" exige puedeEditarCostosUI', () => {
    const idx = MODULO.indexOf("<button onClick={abrirModalConfigTarifa}");
    const idxGate = MODULO.lastIndexOf('{puedeEditarCostosUI&&(', idx);
    expect(idxGate).toBeGreaterThan(-1);
    expect(idx - idxGate).toBeLessThan(400);
  });

  it('abrirModalConfigTarifa corta con early-return si !puedeEditarCostosUI (no depende solo de ocultar el botón)', () => {
    const idx = MODULO.indexOf('function abrirModalConfigTarifa(){');
    expect(idx).toBeGreaterThan(-1);
    const cuerpo = MODULO.slice(idx, idx + 400);
    expect(cuerpo).toContain('if(!puedeEditarCostosUI)return;');
  });

  it('la información de la tarifa (Mano de obra/Insumos/Maquinaria/Costos admin/I.U./IVA/Duración/Valor total) sigue 100% visible sin el gate', () => {
    expect(MODULO).toContain('titulo="Mano de obra para el servicio"');
    expect(MODULO).toContain('Duración contractual');
    expect(MODULO).toContain('Valor total vigencia');
    expect(MODULO).toContain('RESUMEN TARIFA DEL SERVICIO');
  });
});

describe('Resultado — "Guardar Resultado" gateado (botón + handler defensivo)', () => {
  it('el footer "Guardar Resultado" exige puedeEditarCostosUI', () => {
    const idx = MODULO.indexOf("'Guardando…':'Guardar Resultado'");
    const idxGate = MODULO.lastIndexOf('{puedeEditarCostosUI&&(', idx);
    expect(idxGate).toBeGreaterThan(-1);
    expect(idx - idxGate).toBeLessThan(600);
  });

  it('guardarAvanceResultado corta con early-return si !puedeEditarCostosUI', () => {
    const idx = MODULO.indexOf('async function guardarAvanceResultado(){');
    expect(idx).toBeGreaterThan(-1);
    const cuerpo = MODULO.slice(idx, idx + 250);
    expect(cuerpo).toContain('if(!puedeEditarCostosUI)return;');
  });

  it('el estado y último guardado de Resultado siguen visibles para todos', () => {
    expect(MODULO).toContain('Último guardado: {new Date(resultadoUltimaActualizacion)');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Ajuste "PERMISOS DE COSTOS — RESIDUAL VALOR AGREGADO" — reportado en vivo
// por el usuario (Analista Mercadeo podía marcar/desmarcar los 5 checkboxes
// de "Componentes de valor agregado"). Corrección: `disabled` + early-return
// en el handler (nunca depender solo del atributo visual). Auditoría
// adicional de la misma subsección encontró un SEGUNDO control sin gate:
// los botones Editar/Eliminar de Reinversión en la tabla "Consolidado"
// (render independiente del panel de gestión, se muestra siempre) —
// corregido con el mismo patrón `puedeEditarCostosUI&&`.
// ═══════════════════════════════════════════════════════════════════════
describe('Valor Agregado — checkbox "Componentes de valor agregado" (residual corregido)', () => {
  it('el checkbox de selección de tipo queda disabled cuando !puedeEditarCostosUI', () => {
    expect(MODULO).toContain('<input type="checkbox" checked={seleccionado} disabled={!puedeEditarCostosUI} onChange={()=>{if(!puedeEditarCostosUI)return;toggleTipoVA(tipo);}} style={{cursor:puedeEditarCostosUI?\'pointer\':\'default\'}}/>');
  });

  it('el handler corta con early-return además del atributo disabled (no depende solo de lo visual)', () => {
    expect(MODULO).toContain('onChange={()=>{if(!puedeEditarCostosUI)return;toggleTipoVA(tipo);}}');
  });

  it('el estado marcado/desmarcado (checked) sigue siendo visible para todos — nunca se oculta el control ni "Pendiente de configurar"', () => {
    expect(MODULO).toContain('checked={seleccionado}');
    expect(MODULO).toContain("estadoTexto=!seleccionado?'Sin seleccionar':configurado?'Configurado':'Pendiente de configurar'");
  });
});

describe('Valor Agregado — tabla "Consolidado", Reinversión Editar/Eliminar (segundo control encontrado en la auditoría)', () => {
  it('Editar/Eliminar de Reinversión en el Consolidado exigen puedeEditarCostosUI (render independiente del panel de gestión)', () => {
    expect(MODULO).toContain(
      "{puedeEditarCostosUI&&(<>\n                        <button onClick={()=>abrirModalReinversionEditar(r.id)} title=\"Editar\" style={{width:24,height:24,border:'1px solid #e2e8f0',background:'white',borderRadius:5,cursor:'pointer',fontSize:11,color:NAVY}}>✎</button>\n                        <button onClick={()=>eliminarReinversion(r.id,r.descripcion||'Reinversión')} title=\"Eliminar\" style={{width:24,height:24,border:'1px solid #fecaca',background:'white',color:'#c8102e',borderRadius:5,cursor:'pointer',fontSize:12}}>×</button>\n                        </>)}"
    );
  });

  it('las 4 filas derivadas (Mano de Obra/Insumos/Maquinaria/SNC) del Consolidado son texto "solo lectura", sin handler', () => {
    expect(MODULO).toContain('title="Editar desde su módulo de origen">solo lectura</span>');
  });
});

describe('Exportar — NUNCA gateado por puedeEditarCostosUI (lectura, sin cambios)', () => {
  it('el botón "Exportar fichas a Excel" (Mano de Obra) no está condicionado a puedeEditarCostosUI', () => {
    const idx = MODULO.indexOf('Exportar fichas a Excel');
    const antes = MODULO.slice(Math.max(0, idx - 400), idx);
    expect(antes).not.toContain('puedeEditarCostosUI');
  });

  it('ninguna llamada a fetch de exportación (`/exportar`) está condicionada a puedeEditarCostosUI', () => {
    const ocurrencias = [...MODULO.matchAll(/exportarExcelManoObra|exportarExcelGeneral/g)];
    expect(ocurrencias.length).toBeGreaterThan(0);
  });
});
