/**
 * Ajuste "SERVICIOS NO CONTINUOS — FASE 1: CATÁLOGO ASEOCOLBA" —
 * verificación de:
 *  1) el modelo (`ServicioNoContinuo`) acepta datos antiguos y nuevos,
 *  2) el wiring en page.tsx (selector, activación por EMPRESA_EXTERNA,
 *     persistencia de la selección),
 *  3) que `calcularTotalesServicioNoContinuo` NO cambió en esta fase (sigue
 *     siendo manoObra+dotacionEpp+examenes+insumos+maquinaria, sin ningún
 *     concepto de tarifa/codigo).
 * Mismo patrón `bloque()` sobre texto fuente ya usado en el resto de
 * *-page.test.ts (no hay arnés de render de componentes para page.tsx).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crearServicioNoContinuoVacio, calcularTotalesServicioNoContinuo, claveOpcionServicioNoContinuo, type ServicioNoContinuo } from './servicios-no-continuos';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');
const SERVICIOS_NO_CONTINUOS_TS = readFileSync(join(__dirname, './servicios-no-continuos.ts'), 'utf-8');

function bloque(inicioMarcador: string, finMarcador: string, desde = 0): string {
  const inicio = PAGE_TSX.indexOf(inicioMarcador, desde);
  if (inicio === -1) throw new Error(`No se encontró el marcador de inicio: ${inicioMarcador}`);
  const fin = PAGE_TSX.indexOf(finMarcador, inicio);
  if (fin === -1) throw new Error(`No se encontró el marcador de fin: ${finMarcador}`);
  return PAGE_TSX.slice(inicio, fin);
}

describe('ServicioNoContinuo — modelo retrocompatible (Fase 1)', () => {
  it('un registro ANTIGUO (sin los campos nuevos) sigue siendo un ServicioNoContinuo válido', () => {
    const antiguo: ServicioNoContinuo = {
      id: '1', descripcion: 'Servicio viejo',
      manoObra: [], dotacionEpp: [],
      examenesMedicos: { examenes: [], cursos: [], vacunas: [] },
      insumos: [], maquinariaEquipos: [],
    };
    expect(antiguo.codigo).toBeUndefined();
    expect(antiguo.origen).toBeUndefined();
    expect(antiguo.empresaCatalogo).toBeUndefined();
    expect(antiguo.undneg).toBeUndefined();
  });

  it('crearServicioNoContinuoVacio NO fija origen/codigo (un servicio nuevo sin seleccionar del catálogo sigue siendo manual por ausencia, nunca por un valor por defecto inventado)', () => {
    const s = crearServicioNoContinuoVacio('1');
    expect(s.origen).toBeUndefined();
    expect(s.codigo).toBeUndefined();
    expect(s.descripcion).toBe('');
  });

  it('un registro con codigo/empresaCatalogo/undneg conserva los 4 campos de identidad tal cual', () => {
    const conCatalogo: ServicioNoContinuo = {
      id: '2', descripcion: 'BRIGADA DE ASEO', origen: 'CATALOGO', codigo: '001', empresaCatalogo: 'aseo', undneg: 'ASE',
      manoObra: [], dotacionEpp: [],
      examenesMedicos: { examenes: [], cursos: [], vacunas: [] },
      insumos: [], maquinariaEquipos: [],
    };
    expect(conCatalogo).toMatchObject({ codigo: '001', empresaCatalogo: 'aseo', undneg: 'ASE', origen: 'CATALOGO' });
  });
});

describe('servicios-no-continuos.ts — calcularTotalesServicioNoContinuo: rama histórica (ESTRUCTURA_COSTOS) SIN cambios de fórmula', () => {
  // Nota: la ronda "FASE 2 MVP: TARIFARIO ASEOCOLBA" (posterior a esta
  // Fase 1) SÍ agrega una rama de cálculo de tarifa a este mismo archivo
  // — la aserción original de esta ronda ("ninguna fórmula referencia
  // tarifa") quedó obsoleta por diseño y fue retirada; la cobertura real
  // de esa bifurcación vive en `servicios-no-continuos-tipo-calculo.test.ts`.
  it('el total histórico sigue siendo manoObra+dotacionEpp+totalExamenesMedicos+insumos+maquinariaEquipos+otrosCostos (Ajuste "OTROS COSTOS DE SNC" agregó el último término, dividido por subtotalAntesFrecuencia/frecuenciaServicioMeses — ver servicios-no-continuos-otros-costos.test.ts)', () => {
    expect(SERVICIOS_NO_CONTINUOS_TS).toContain('const subtotalAntesFrecuencia = manoObra + dotacionEpp + totalExamenesMedicos + insumos + maquinariaEquipos + otrosCostos;');
  });
  it('la identidad del catálogo (codigo/empresaCatalogo/undneg) nunca participa de la fórmula histórica — ni antes ni después de la bifurcación por tipoCalculo', () => {
    const cuerpoRamaHistorica = SERVICIOS_NO_CONTINUOS_TS.slice(
      SERVICIOS_NO_CONTINUOS_TS.indexOf("if (servicio.tipoCalculo === 'TARIFA_ASEOCOLBA') {")
        + "if (servicio.tipoCalculo === 'TARIFA_ASEOCOLBA') {".length,
      SERVICIOS_NO_CONTINUOS_TS.indexOf('export function calcularTotalServiciosNoContinuos('),
    );
    // La rama TARIFA_ASEOCOLBA (antes del corte) sí referencia `tarifa` —
    // deliberado; lo que se audita aquí es que la rama HISTÓRICA (después
    // del cierre `}` de esa rama) nunca lo haga.
    const cuerpoRamaHistoricaSolo = cuerpoRamaHistorica.slice(cuerpoRamaHistorica.lastIndexOf('  }\n') + 4);
    expect(cuerpoRamaHistoricaSolo).not.toMatch(/\bcodigo\b|\bundneg\b|empresaCatalogo|tarifa/i);
  });
  it('el cálculo real con un servicio de catálogo (ESTRUCTURA_COSTOS) produce el MISMO total que uno manual con los mismos bloques (la identidad del catálogo no afecta el total)', () => {
    const base: Pick<ServicioNoContinuo, 'manoObra'|'dotacionEpp'|'examenesMedicos'|'insumos'|'maquinariaEquipos'> = { manoObra: [], dotacionEpp: [], examenesMedicos: { examenes: [], cursos: [], vacunas: [] }, insumos: [], maquinariaEquipos: [] };
    const manual: ServicioNoContinuo = { id: '1', descripcion: 'x', ...base };
    const deCatalogo: ServicioNoContinuo = { id: '2', descripcion: 'BRIGADA DE ASEO', origen: 'CATALOGO', codigo: '001', empresaCatalogo: 'aseo', undneg: 'ASE', ...base };
    expect(calcularTotalesServicioNoContinuo(deCatalogo, 500000)).toEqual(calcularTotalesServicioNoContinuo(manual, 500000));
  });
});

describe('page.tsx — activación EXCLUSIVA vía EMPRESA_EXTERNA (nunca comparaciones dispersas, nunca el fallback ||\'aseo\')', () => {
  // Ajuste "UNIFICACIÓN SNC" — esAseocolba se renombró a esAseocolbaProceso
  // y su fuente pasó de EMPRESA_EXTERNA[empresaProceso] a
  // capacidadCatalogoSNC.codigoEmpresaCatalogo (misma fuente segura/fresca
  // que ya usa esVigicolbaProceso) — nunca de empresaExterna (que tiene
  // ||'aseo' como fallback histórico).
  it('esAseocolbaProceso se lee de capacidadCatalogoSNC.codigoEmpresaCatalogo DIRECTAMENTE — nunca de empresaExterna (que tiene ||\'aseo\' como fallback histórico)', () => {
    expect(PAGE_TSX).toContain("const esAseocolbaProceso=capacidadCatalogoSNC.codigoEmpresaCatalogo==='aseo';");
    expect(PAGE_TSX).not.toContain("const esAseocolbaProceso=empresaExterna==='aseo';");
  });
  it('una empresaProceso vacía o no mapeada NUNCA activa esAseocolba (aunque empresaExterna caiga en su fallback \'aseo\')', () => {
    const EMPRESA_EXTERNA: Record<string, string> = { ASEOCOLBA: 'aseo', VIGICOLBA: 'vigi', TEMPOCOLBA: 'tempo' };
    const empresaProceso = '';
    const empresaExterna = EMPRESA_EXTERNA[empresaProceso] || 'aseo';
    const esAseocolba = EMPRESA_EXTERNA[empresaProceso] === 'aseo';
    expect(empresaExterna).toBe('aseo'); // el fallback histórico sigue intacto para otros usos
    expect(esAseocolba).toBe(false); // pero NO activa el catálogo de Servicios no continuos
  });
  // Ajuste "UNIFICACIÓN SNC" — el selector del catálogo ya no se gatea por
  // el booleano esAseocolba: usa capacidadCatalogoSNC.disponibleCatalogo
  // (misma fuente segura/fresca, extendida a cualquier empresa con
  // catálogo propio confirmado, no solo Aseocolba).
  it('el selector del servicio (dentro del modal Agregar/Editar, Fase B) usa capacidadCatalogoSNC.disponibleCatalogo, nunca una segunda comparación de empresa', () => {
    // Ajuste "FASE B: MODAL AGREGAR/EDITAR" — el selector del catálogo ya no
    // vive inline dentro de la tarjeta (bTab, que ahora es de solo lectura):
    // se movió al modal `ModalServicioNoContinuo`, único lugar donde se
    // configura el servicio. La condición se conserva idéntica en esencia
    // (¿hay catálogo disponible?), solo cambió su fuente y su ubicación en
    // el archivo.
    const bModal = bloque('function ModalServicioNoContinuo(){', '  // ═══ Ajuste "VALOR AGREGADO — 5 TIPOS CONSOLIDADOS" — CRUD de\n  // Reinversión, el ÚNICO tipo administrado directamente en esta pestaña');
    expect(bModal).toContain('{capacidadCatalogoSNC.disponibleCatalogo?(');
    expect(bModal).not.toMatch(/empresaProceso===['"]ASEOCOLBA['"]/);
  });
});

describe('page.tsx — selector "Servicio no continuo" (catálogo /api/servicios-no-continuos-ext)', () => {
  // Ajuste "UNIFICACIÓN SNC" — la carga solo ocurre cuando hay catálogo
  // disponible (capacidadCatalogoSNC.codigoEmpresaCatalogo, nunca un
  // booleano fijo de Aseocolba), y el empresa enviado al backend es
  // SIEMPRE ese mismo código (nunca empresaExterna, que cae a 'aseo' por
  // defecto para cualquier empresa no reconocida).
  it('el catálogo se carga por POST con {empresa:codigoEmpresa}, solo en la pestaña correspondiente y solo cuando hay catálogo disponible', () => {
    expect(PAGE_TSX).toContain("const codigoEmpresa=capacidadCatalogoSNC.codigoEmpresaCatalogo;");
    expect(PAGE_TSX).toContain("if(tab!=='serviciosNoContinuos'||!codigoEmpresa)return;");
    expect(PAGE_TSX).toContain("fetch('/api/servicios-no-continuos-ext',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({empresa:codigoEmpresa})})");
  });
  it('evita llamadas duplicadas: no vuelve a pedir el catálogo de la MISMA empresa dos veces', () => {
    expect(PAGE_TSX).toContain('if(serviciosNoContinuosCatalogoCargadoPara.current===codigoEmpresa)return;');
  });
  it('la guardia de "ya cargado" SOLO se marca DESPUÉS de una respuesta exitosa, nunca antes de lanzar el fetch (permite reintentar tras un error)', () => {
    const b = bloque("if(tab!=='serviciosNoContinuos'||!codigoEmpresa)return;", '},[tab,capacidadCatalogoSNC.codigoEmpresaCatalogo,reintentoServiciosNoContinuos]);');
    const idxFetch = b.indexOf("fetch('/api/servicios-no-continuos-ext'");
    const idxMarcaExito = b.indexOf('serviciosNoContinuosCatalogoCargadoPara.current=codigoEmpresa;', idxFetch);
    expect(idxMarcaExito).toBeGreaterThan(idxFetch);
    // La marca de éxito vive DENTRO del .then, después de validar d.ok — nunca antes del fetch.
    expect(b).not.toMatch(/serviciosNoContinuosCatalogoCargadoPara\.current=codigoEmpresa;\s*setCargandoServiciosNoContinuosCatalogo\(true\)/);
  });
  it('protección de race condition: una respuesta tardía (tras cambiar de empresa/pestaña) se descarta, nunca sobrescribe el catálogo actual', () => {
    const b = bloque("if(tab!=='serviciosNoContinuos'||!codigoEmpresa)return;", '},[tab,capacidadCatalogoSNC.codigoEmpresaCatalogo,reintentoServiciosNoContinuos]);');
    expect(b).toContain('let cancelado=false;');
    expect(b).toContain('if(cancelado)return;');
    expect(b).toContain('return ()=>{cancelado=true;};');
  });
  it('botón "Reintentar" visible solo si hay error, incrementa reintentoServiciosNoContinuos para forzar una nueva consulta', () => {
    // Ajuste "FASE B" — mismo botón, ahora dentro del modal (ver nota arriba).
    const bModal = bloque('function ModalServicioNoContinuo(){', '  // ═══ Ajuste "VALOR AGREGADO — 5 TIPOS CONSOLIDADOS" — CRUD de\n  // Reinversión, el ÚNICO tipo administrado directamente en esta pestaña');
    expect(bModal).toContain('errorServiciosNoContinuosCatalogo&&(');
    expect(bModal).toContain('onClick={()=>setReintentoServiciosNoContinuos(n=>n+1)}');
    expect(bModal).toContain('>Reintentar</button>');
  });
  it('expone loading y error del catálogo (cargandoServiciosNoContinuosCatalogo/errorServiciosNoContinuosCatalogo)', () => {
    expect(PAGE_TSX).toContain('setCargandoServiciosNoContinuosCatalogo(true)');
    expect(PAGE_TSX).toContain("setErrorServiciosNoContinuosCatalogo('El catálogo de servicios no continuos llegó vacío.')");
  });
  it('el selector de "Servicio no continuo" del modal identifica cada opción con una CLAVE COMPUESTA (empresa+undneg+codigo) — nunca descripcion, nunca codigo solo (no garantizado único globalmente)', () => {
    // Ajuste "FASE B" — mismo identificador compuesto; el control dejó de
    // ser un <select> nativo (su lista desplegable no se puede acotar por
    // CSS, ver ajuste "QUE NO LLEGUE TAN ABAJO") y pasó a un combobox
    // propio (botón + panel en portal), pero sigue comparando por la MISMA
    // clave compuesta, nunca por descripcion/codigo solos.
    const bModal = bloque('function ModalServicioNoContinuo(){', '  // ═══ Ajuste "VALOR AGREGADO — 5 TIPOS CONSOLIDADOS" — CRUD de\n  // Reinversión, el ÚNICO tipo administrado directamente en esta pestaña');
    expect(bModal).toContain('claveOpcionServicioNoContinuo({codigo:b.codigo,empresa:b.empresaCatalogo,undneg:b.undneg})');
    expect(bModal).toContain('<button key={claveOpcionServicioNoContinuo(c)} type="button"');
    expect(bModal).toContain('>{c.descripcion}</button>');
  });
});

describe('claveOpcionServicioNoContinuo — clave compuesta SOLO para identificar la opción en UI', () => {
  it('combina empresa+undneg+codigo, nunca solo codigo', () => {
    expect(claveOpcionServicioNoContinuo({ codigo: '001', empresa: 'aseo', undneg: 'ASE' })).toBe('aseo::ASE::001');
  });
  it('dos registros con el MISMO codigo pero distinta empresa/undneg producen claves DISTINTAS (nunca colisionan en el selector)', () => {
    const a = claveOpcionServicioNoContinuo({ codigo: '001', empresa: 'aseo', undneg: 'ASE' });
    const b = claveOpcionServicioNoContinuo({ codigo: '001', empresa: 'aseo', undneg: 'OTRA' });
    expect(a).not.toBe(b);
  });
});

describe('page.tsx — al seleccionar, se persiste el registro completo dentro del MISMO ServicioNoContinuo', () => {
  it('seleccionarServicioNoContinuoCatalogo escribe descripcion+origen+codigo+empresaCatalogo+undneg, sin tocar los demás bloques del servicio', () => {
    const b = bloque(
      'function seleccionarServicioNoContinuoCatalogo(servicioId:string,item:{codigo:string;descripcion:string;empresa:string;undneg:string}){',
      'function eliminarServicioNoContinuo(',
    );
    expect(b).toContain('descripcion:item.descripcion,');
    expect(b).toContain("origen:'CATALOGO',");
    expect(b).toContain('codigo:item.codigo,');
    expect(b).toContain('empresaCatalogo:item.empresa,');
    expect(b).toContain('undneg:item.undneg,');
    // No reconstruye manoObra/dotacionEpp/examenesMedicos/insumos/maquinariaEquipos.
    expect(b).not.toContain('manoObra:');
    expect(b).not.toContain('dotacionEpp:');
    expect(b).not.toContain('maquinariaEquipos:');
  });
  it('no crea ninguna estructura paralela — sigue viviendo en el mismo arreglo serviciosNoContinuos (setServiciosNoContinuos)', () => {
    const b = bloque(
      'function seleccionarServicioNoContinuoCatalogo(servicioId:string,item:{codigo:string;descripcion:string;empresa:string;undneg:string}){',
      'function eliminarServicioNoContinuo(',
    );
    expect(b).toContain('setServiciosNoContinuos(p=>p.map(s=>s.id!==servicioId?s:{');
  });
});

describe('page.tsx — payload de guardado conserva los campos nuevos sin cambios de contrato', () => {
  it('construirDatosEntradaServiciosNoContinuos sigue siendo {servicios:serviciosNoContinuos} — los campos nuevos viajan porque son parte del mismo objeto servicio, sin transformación', () => {
    expect(PAGE_TSX).toContain('function construirDatosEntradaServiciosNoContinuos(){\n    return { servicios: serviciosNoContinuos };\n  }');
  });
});
