/**
 * Ajuste "EPP EN VALOR AGREGADO" — el 6to componente de Valor Agregado.
 *
 * Reglas verificadas:
 *  - EPP disponible = filas de `dotGroups` GLOBAL con `tipo==='epp'`
 *    (NUNCA `tipo==='dot'`, NUNCA el `dotacionEpp` de un ServicioNoContinuo).
 *  - Identidad = par `(grupoId, rowId)` — `DotItemRow.id` NO es único por
 *    sí solo entre grupos históricos.
 *  - Valor = `calcularValorMensualItemDotacionEpp(row)` (helper existente)
 *    ÷ factor de periodicidad (mismo criterio que los otros 4 tipos).
 *  - "No doble conteo": una fila EPP marcada `esValorAgregado:true` deja de
 *    sumar en el subtotal normal de Mano de Obra (motor `otros-costos`) y
 *    pasa al subtotal de Valor Agregado — nunca en ambos.
 *  - Histórico sin el campo `esValorAgregado` ⇒ no seleccionado.
 *
 * Estas pruebas son de la MECÁNICA pura reutilizada por page.tsx (mismo
 * enfoque que servicios-no-continuos-epp-snc.test.ts) + verificación de
 * TEXTO del cableado en page.tsx.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { esRecursoValorAgregado, resolverFactorPeriodicidadValorAgregado, type FrecuenciaValorAgregado } from './valor-agregado';
import { calcularValorMensualItemDotacionEpp } from './servicios-no-continuos';
import type { DotGroup, DotItemRow } from '../costos-mano-obra/motor-distribuido/dotacion-epp-tipo';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');

function fila(over: Partial<DotItemRow> = {}): DotItemRow {
  return { id: 1, codigo: '18029', desc: 'GUANTE INDUSTRIAL', medida: 'UND', cant: 1, frec: 1, vUnit: 3183, section: 'epp', origen: 'catalogo', ...over };
}
function grupoEpp(id: number, rows: DotItemRow[], lineaManoObraId = 1): DotGroup {
  return { id, tipo: 'epp', nombre: 'EPP', rows, categoria: 'EPP', lineaManoObraId };
}
function grupoDot(id: number, rows: DotItemRow[]): DotGroup {
  return { id, tipo: 'dot', nombre: 'Hombre', rows, categoria: 'DOTACION_MASCULINA', lineaManoObraId: 1 };
}

// Reproduce la construcción de `filasValorAgregadoEpp` de page.tsx.
function filasValorAgregadoEpp(dotGroups: DotGroup[]) {
  return dotGroups.filter(g => g.tipo === 'epp').flatMap(g =>
    g.rows.filter(esRecursoValorAgregado).map(r => ({
      tipo: 'EPP' as const,
      claveFila: 'epp-' + g.id + '-' + r.id,
      descripcion: r.desc || '(sin descripción)',
      valorMensual: calcularValorMensualItemDotacionEpp(r) / resolverFactorPeriodicidadValorAgregado(r.frecuenciaValorAgregado),
      frecuencia: r.frecuenciaValorAgregado,
      origen: 'EPP',
    })),
  );
}

describe('filasValorAgregadoEpp — fuente = dotGroups global, tipo:"epp"', () => {
  it('solo incluye filas EPP marcadas esValorAgregado:true', () => {
    const dg: DotGroup[] = [grupoEpp(10, [
      fila({ id: 1, esValorAgregado: true, frecuenciaValorAgregado: 1 }),
      fila({ id: 2, codigo: '18111', desc: 'LENTE' }), // sin marcar → fuera
    ])];
    const filas = filasValorAgregadoEpp(dg);
    expect(filas).toHaveLength(1);
    expect(filas[0].claveFila).toBe('epp-10-1');
    expect(filas[0].tipo).toBe('EPP');
    expect(filas[0].origen).toBe('EPP');
  });

  it('NUNCA incluye grupos tipo:"dot" (Dotación), aunque una fila "dot" tuviera el flag', () => {
    const dg: DotGroup[] = [
      grupoDot(20, [fila({ id: 9, section: 'dot', esValorAgregado: true, frecuenciaValorAgregado: 1, vUnit: 99999 } as Partial<DotItemRow>)]),
      grupoEpp(21, [fila({ id: 1, esValorAgregado: true, frecuenciaValorAgregado: 1 })]),
    ];
    const filas = filasValorAgregadoEpp(dg);
    expect(filas).toHaveLength(1);
    expect(filas.every(f => f.origen === 'EPP')).toBe(true);
    expect(filas.some(f => f.valorMensual >= 99999)).toBe(false); // la fila "dot" nunca entró
  });

  it('histórico sin esValorAgregado ⇒ ninguna fila seleccionada', () => {
    const dg: DotGroup[] = [grupoEpp(30, [fila({ id: 1 }), fila({ id: 2 })])];
    expect(filasValorAgregadoEpp(dg)).toEqual([]);
  });

  it('identidad estable (gid+rid) — dos grupos distintos con rows de id=1 no colisionan', () => {
    const dg: DotGroup[] = [
      grupoEpp(40, [fila({ id: 1, desc: 'A', esValorAgregado: true, frecuenciaValorAgregado: 1 })], 1),
      grupoEpp(41, [fila({ id: 1, desc: 'B', esValorAgregado: true, frecuenciaValorAgregado: 1 })], 2),
    ];
    const claves = filasValorAgregadoEpp(dg).map(f => f.claveFila);
    expect(claves).toEqual(['epp-40-1', 'epp-41-1']);
    expect(new Set(claves).size).toBe(2);
  });

  it('valorMensual = calcularValorMensualItemDotacionEpp(row) ÷ factor de periodicidad', () => {
    const r = fila({ id: 1, cant: 2, vUnit: 10_000, frec: 1, esValorAgregado: true, frecuenciaValorAgregado: 6 /* semestral → ÷6 */ });
    const filas = filasValorAgregadoEpp([grupoEpp(50, [r])]);
    expect(filas[0].valorMensual).toBe(calcularValorMensualItemDotacionEpp(r) / 6);
    expect(filas[0].valorMensual).toBeGreaterThan(0);
  });
});

describe('no doble conteo — subtotal normal de Mano de Obra excluye EPP marcado VA', () => {
  // Reproduce la línea del motor `construirEntradaOtrosCostosLinea` de page.tsx.
  const totalEppNormalDeGrupo = (g: DotGroup) =>
    g.rows.filter(r => !esRecursoValorAgregado(r)).reduce((s, r) => s + Math.floor((r.cant * (r.vUnit * 1.19)) / (r.frec || 1)), 0);

  it('una fila EPP marcada VA no suma en el subtotal normal; una sin marcar sí', () => {
    const normal = fila({ id: 1, vUnit: 10_000, frec: 1 });
    const va = fila({ id: 2, vUnit: 50_000, frec: 1, esValorAgregado: true, frecuenciaValorAgregado: 1 });
    const g = grupoEpp(60, [normal, va]);
    const totalNormal = totalEppNormalDeGrupo(g);
    expect(totalNormal).toBe(Math.floor((1 * (10_000 * 1.19)) / 1)); // solo la fila normal
    // y esa misma fila VA sí aparece en Valor Agregado
    expect(filasValorAgregadoEpp([g])).toHaveLength(1);
  });
});

describe('page.tsx — cableado de EPP en Valor Agregado', () => {
  it('EPP es un componente propio en CHECK_TIPOS_VA con label exactamente "EPP"', () => {
    expect(PAGE_TSX).toContain("{tipo:'EPP',label:'EPP'}");
  });
  it('panel derivado "Gestionar EPP" con el texto vacío pedido', () => {
    expect(PAGE_TSX).toContain("mostrarPanelTipo('EPP')");
    expect(PAGE_TSX).toContain("panelDerivado(filasValorAgregadoEpp,'No hay EPP marcados como Valor Agregado.',abrirModalVAEpp,'Gestionar EPP')");
  });
  it('la fuente del modal "Gestionar EPP" es dotGroups global (tipo:epp), NUNCA /api/epp-ext ni showSelEpp', () => {
    const i = PAGE_TSX.indexOf('const abrirModalVAEpp=()=>{');
    expect(i).toBeGreaterThan(-1);
    const b = PAGE_TSX.slice(i, PAGE_TSX.indexOf('\n  };', i));
    expect(b).toContain("dotGroups.filter(g=>g.tipo==='epp')");
    expect(b).not.toContain('/api/epp-ext');
    expect(b).not.toContain('setShowSelEpp');
    expect(b).not.toContain('consultarCatalogEpp');
  });
  it('guardar escribe los flags SOBRE la fila existente de dotGroups (nunca duplica el EPP)', () => {
    const i = PAGE_TSX.indexOf('const guardarModalVAEpp=()=>{');
    const b = PAGE_TSX.slice(i, PAGE_TSX.indexOf('\n  };', i));
    expect(b).toContain('setDotGroups(prev=>prev.map(g=>{');
    expect(b).toContain("if(g.tipo!=='epp')return g;");
    expect(b).toContain('x.gid===g.id&&x.rid===r.id');
    expect(b).toContain('esValorAgregado:b.esValorAgregado');
  });
  it('el modal usa identidad (gid,rid), nunca solo r.codigo', () => {
    const i = PAGE_TSX.indexOf('{modalVAEppAbierto&&(');
    const b = PAGE_TSX.slice(i, PAGE_TSX.indexOf('SELECCIONAR SERVICIOS NO CONTINUOS', i));
    expect(b).toContain("key={r.gid+'-'+r.rid}");
    expect(b).toContain('actualizarBorradorVAEpp(r.gid,r.rid,');
    expect(b).toContain("irAGestionarDesdeValorAgregado('epp')"); // "Ir a EPP", nunca catálogo
  });
  it('EPP entra a filasConsolidadasValorAgregado (memo + total)', () => {
    expect(PAGE_TSX).toContain('...filasValorAgregadoInsumos,...filasValorAgregadoMaquinaria,...filasValorAgregadoEpp,...filasValorAgregadoSnc]');
    expect(PAGE_TSX).toContain("EPP:'EPP',SNC:'Servicios No Continuos'"); // etiqueta en la tabla Consolidado
  });
  it('EPP se RENDERIZA como fila en la tabla Consolidado (no solo en el total)', () => {
    expect(PAGE_TSX).toContain('[...filasValorAgregadoManoObra,...filasValorAgregadoInsumos,...filasValorAgregadoMaquinaria,...filasValorAgregadoEpp,...filasValorAgregadoSnc].map(filaVA)');
  });
  it('EPP tiene su chip de resumen por tipo (mismo bloque que Insumos/Maquinaria/SNC)', () => {
    expect(PAGE_TSX).toContain("{tipo:'EPP' as const,label:'EPP',valor:filasValorAgregadoEpp.reduce((s,f)=>s+f.valorMensual,0)}");
  });
  it('no doble conteo: el motor de Mano de Obra excluye EPP marcado VA (mismo patrón que Insumos/Maquinaria)', () => {
    expect(PAGE_TSX).toContain("gruposActivos.filter(g=>g.tipo==='epp').map(g=>({valorMensual:g.rows.filter(r=>!esRecursoValorAgregado(r)).reduce((s,r)=>s+valorMesRow(r),0)}))");
    // y la herencia del turnante también lo excluye
    expect(PAGE_TSX).toContain("gruposActivos.filter(g=>g.tipo==='epp').flatMap(g=>g.rows.filter(r=>!esRecursoValorAgregado(r)))");
  });
  it('la fuente NUNCA es el dotacionEpp de un ServicioNoContinuo (evita doble conteo con el tipo SNC)', () => {
    const i = PAGE_TSX.indexOf('const filasValorAgregadoEpp=React.useMemo');
    const b = PAGE_TSX.slice(i, PAGE_TSX.indexOf('},[dotGroups]);', i) + 15);
    expect(b).toContain("dotGroups.filter(g=>g.tipo==='epp')");
    expect(b).not.toContain('serviciosNoContinuos');
    expect(b).not.toContain('.dotacionEpp');
  });
});

describe('DotItemRow implementa RecursoConValorAgregado', () => {
  it('esValorAgregado?/frecuenciaValorAgregado? son opcionales (compatibilidad histórica)', () => {
    const historica: DotItemRow = fila(); // sin los campos nuevos
    expect(esRecursoValorAgregado(historica)).toBe(false);
    const marcada: DotItemRow = fila({ esValorAgregado: true, frecuenciaValorAgregado: 1 as FrecuenciaValorAgregado });
    expect(esRecursoValorAgregado(marcada)).toBe(true);
  });
});
