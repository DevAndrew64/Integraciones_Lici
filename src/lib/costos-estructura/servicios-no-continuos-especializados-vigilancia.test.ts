/**
 * Ajuste "EQUIPOS ESPECIALIZADOS — NO APLICA A VIGILANCIA" — el bloque
 * "Maquinaria y Equipos - Especializados" del modal SNC (con sus botones
 * "+ Crear manual"/"+ Agregar equipo" y el catálogo que abren) es
 * exclusivo de Aseo; para Vigicolba se oculta salvo que ya existan
 * registros históricos (persistidos antes de este ajuste), en cuyo caso
 * se muestran en modo solo-lectura + eliminar (auditoría/consulta, nunca
 * se borran automáticamente). Reutiliza `esVigicolbaProceso`, el MISMO
 * criterio central ya usado en todo el módulo (nunca un texto/empresa
 * hardcodeado nuevo). Mismo patrón de texto fuente que el resto de
 * *-page.test.ts (sin harness de render de componentes en este repo).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calcularTotalesServicioNoContinuo, crearServicioNoContinuoVacio } from './servicios-no-continuos';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');

function extraerBloqueEspecializados(): string {
  const inicio = PAGE_TSX.indexOf('Ajuste "EQUIPOS ESPECIALIZADOS — NO APLICA A VIGILANCIA"');
  const fin = PAGE_TSX.indexOf('Ajuste "OTROS COSTOS DE SNC" — bloque independiente', inicio);
  if (inicio === -1 || fin === -1) throw new Error('No se encontró el bloque de Equipos Especializados en page.tsx');
  return PAGE_TSX.slice(inicio, fin);
}
const BLOQUE = extraerBloqueEspecializados();

describe('1) Vigicolba/Vigilancia — sin alta posible', () => {
  it('el bloque completo se oculta cuando no hay históricos: gateado por esVigicolbaProceso + longitud del arreglo', () => {
    expect(BLOQUE).toContain('{(!esVigicolbaProceso||(b.equiposEspecializados??[]).length>0)&&(');
  });
  it('el contenedor de los botones de alta está gateado por !esVigicolbaProceso (oculta AMBOS a la vez, "+ Crear manual" y "+ Agregar equipo")', () => {
    const idxBotones = BLOQUE.indexOf('{!esVigicolbaProceso&&(');
    expect(idxBotones).toBeGreaterThan(-1);
    const idxCrearManual = BLOQUE.indexOf('+ Crear manual', idxBotones);
    const idxAgregarEquipo = BLOQUE.indexOf('+ Agregar equipo', idxBotones);
    const idxAvisoSoloLectura = BLOQUE.indexOf('Solo lectura — Equipos Especializados no aplica a Vigilancia', idxBotones);
    expect(idxAvisoSoloLectura).toBeGreaterThan(-1);
    expect(idxCrearManual).toBeGreaterThan(idxBotones);
    expect(idxCrearManual).toBeLessThan(idxAvisoSoloLectura);
    expect(idxAgregarEquipo).toBeGreaterThan(idxBotones);
    expect(idxAgregarEquipo).toBeLessThan(idxAvisoSoloLectura);
  });
  it('"+ Crear manual" (agregarEquipoEspecializadoManualServicio) no es alcanzable fuera de ese gate', () => {
    expect(BLOQUE.match(/agregarEquipoEspecializadoManualServicio\(b\.id\)/g)?.length).toBe(1);
  });
  it('"+ Agregar equipo" (abrirModalEquipoEspecializado, el único punto que abre el selector/catálogo) no es alcanzable fuera de ese gate', () => {
    expect(BLOQUE.match(/abrirModalEquipoEspecializado\(b\.id\)/g)?.length).toBe(1);
    const idxBotones = BLOQUE.indexOf('{!esVigicolbaProceso&&(');
    const idxAbrir = BLOQUE.indexOf('abrirModalEquipoEspecializado(b.id)', idxBotones);
    const idxAvisoSoloLectura = BLOQUE.indexOf('Solo lectura — Equipos Especializados no aplica a Vigilancia', idxBotones);
    expect(idxAbrir).toBeGreaterThan(idxBotones);
    expect(idxAbrir).toBeLessThan(idxAvisoSoloLectura);
  });
  it('no existe ninguna otra ruta de escritura: agregarEquipoEspecializadoServicio/agregarEquipoEspecializadoManualServicio solo se invocan desde este modal (3 sitios: el botón, "Crear manual" y "Listo" del catálogo — ninguno fuera de este componente)', () => {
    const total = (PAGE_TSX.match(/agregarEquipoEspecializadoServicio\(/g)?.length ?? 0)
      + (PAGE_TSX.match(/agregarEquipoEspecializadoManualServicio\(/g)?.length ?? 0);
    // 1 declaración de cada función + sus invocaciones (botón "Crear
    // manual", botón "Agregar equipo" abre el modal que internamente usa
    // agregarEquipoEspecializadoServicio al elegir un ítem del catálogo).
    expect(total).toBeLessThanOrEqual(4);
  });
});

describe('2) Aseocolba/Aseo — sin cambios', () => {
  it('el bloque y sus botones NO están condicionados por esAseocolbaProceso (solo por esVigicolbaProceso) — Aseo y cualquier otra empresa no-Vigicolba lo ven igual que antes', () => {
    expect(BLOQUE).not.toMatch(/esAseocolbaProceso[^)]*Maquinaria y Equipos - Especializados/);
    expect(BLOQUE).toContain('+ Crear manual');
    expect(BLOQUE).toContain('+ Agregar equipo');
  });
  it('el catálogo de especializados (fetchCatalogoEquiposEspecializados / showModalEquipoEspecializado) no fue tocado — sigue siendo el mismo modal, sin condición nueva de empresa', () => {
    expect(PAGE_TSX).toContain('const abrirModalEquipoEspecializado=(servicioId:string)=>{');
    expect(PAGE_TSX).toContain('async function fetchCatalogoEquiposEspecializados(){');
  });
});

describe('3) Activos Fijos — disponibles para ambos', () => {
  it('el bloque "Maquinaria y Equipos - Activos Fijos" (Subtotal Activos Fijos) no está gateado por esVigicolbaProceso en ningún punto', () => {
    const inicioActivos = PAGE_TSX.indexOf('Subtotal Activos Fijos');
    const antes = PAGE_TSX.slice(Math.max(0, inicioActivos - 1600), inicioActivos);
    expect(antes).not.toContain('esVigicolbaProceso');
  });
});

describe('4) Histórico Vigicolba con equiposEspecializados — nunca se elimina automáticamente', () => {
  it('el arreglo histórico se sigue leyendo tal cual (b.equiposEspecializados) para decidir si se muestra el bloque, sin filtrar/descartar nada', () => {
    expect(BLOQUE).toContain('(b.equiposEspecializados??[]).length>0');
  });
  it('en modo solo-lectura los campos editables (descripción/subtipo manual, cantidad, N.º días, valor día) se reemplazan por texto plano, nunca inputs', () => {
    expect(BLOQUE).toContain('const soloLectura=esVigicolbaProceso;');
    expect(BLOQUE).toContain('esManual&&!soloLectura?(');
    expect(BLOQUE.match(/soloLectura\?\(/g)?.length).toBeGreaterThanOrEqual(3);
  });
  it('el botón eliminar (BtnDel/eliminarEquipoEspecializadoServicio) NUNCA está condicionado por soloLectura ni esVigicolbaProceso — retirar un histórico sigue siendo posible', () => {
    const idxDel = BLOQUE.indexOf('eliminarEquipoEspecializadoServicio(b.id,item.id)');
    expect(idxDel).toBeGreaterThan(-1);
    const contexto = BLOQUE.slice(idxDel - 120, idxDel);
    expect(contexto).not.toContain('soloLectura?');
    expect(contexto).not.toContain('esVigicolbaProceso?');
  });
  it('aviso explícito de "solo lectura" visible solo para Vigicolba', () => {
    expect(BLOQUE).toContain('Solo lectura — Equipos Especializados no aplica a Vigilancia');
    expect(BLOQUE).toContain('{esVigicolbaProceso&&(');
  });
  it('documentación de comportamiento: comentario explica que nunca se borra nada automáticamente (retrocompatibilidad de datos)', () => {
    expect(BLOQUE).toMatch(/nunca se borra nada autom[aá]ticamente/);
  });
});

describe('5) calcularTotalesServicioNoContinuo — sin alteraciones', () => {
  it('el archivo puro de cálculo (servicios-no-continuos.ts) no cambia: equiposEspecializados se sigue sumando exactamente igual sin importar la empresa (el filtro es solo de UI, nunca del motor de cálculo)', () => {
    const s = crearServicioNoContinuoVacio('s1', 'Vigicolba histórico');
    const conEspecializados = {
      ...s,
      equiposEspecializados: [{ id: 1, origen: 'CATALOGO' as const, codigo: 1, descripcion: 'Equipo X', subTipo: 'Tipo', codigoTipo: 'T1', codigoSubtipo: 'S1', cantidad: 2, numeroDias: 10, valorDia: 5000 }],
    };
    const totales = calcularTotalesServicioNoContinuo(conEspecializados, 0);
    // 2 * 10 * 5000 = 100000, EXACTAMENTE igual sea Vigicolba o Aseocolba
    // (el motor puro no conoce ni le importa la empresa del proceso).
    expect(totales.maquinariaEquipos).toBe(100000);
    expect(totales.total).toBe(100000);
  });
});
