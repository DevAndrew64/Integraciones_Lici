/**
 * Ajuste "ORDEN Y NUMERACIÓN DE CARGOS EN REGISTRAR DOTACIÓN Y EPP" —
 * verificación de CABLEADO en page.tsx (la lógica pura ya está cubierta en
 * orden-sujetos-costeo.test.ts). Mismo patrón de texto exacto del código
 * fuente usado en el resto de guardado-modular-*.test.ts.
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

describe('lineasManoObraDisponiblesOrdenadas — cableado en page.tsx', () => {
  it('importa ordenarSujetosCosteoPorCargo desde el módulo puro (nunca lógica inline duplicada en el JSX)', () => {
    expect(PAGE_TSX).toContain("import { ordenarSujetosCosteoPorCargo } from '@/lib/costos-mano-obra/turnantes/orden-sujetos-costeo';");
  });

  it('se calcula DESPUÉS de gruposNecesidadTurnantes (evita depender de un valor circular sin resolver)', () => {
    const idxGrupos = PAGE_TSX.indexOf('return construirGruposNecesidadTurnantes(posiciones,SMLMV);');
    const idxOrdenadas = PAGE_TSX.indexOf('const lineasManoObraDisponiblesOrdenadas=React.useMemo(');
    expect(idxGrupos).toBeGreaterThan(-1);
    expect(idxOrdenadas).toBeGreaterThan(idxGrupos);
  });

  it('resuelve idsLineasOrigen de cada turnante vía claveGrupoTurnante → coberturaPorPosicion (única asociación estable, nunca por nombre)', () => {
    const b = bloque('const lineasManoObraDisponiblesOrdenadas=React.useMemo(', '\n  // Resumen agregado');
    expect(b).toContain('idsOrigenPorClaveGrupo.set(g.claveGrupo,g.coberturaPorPosicion.map(c=>Number(c.id)))');
    expect(b).toContain('idsLineasOrigenPorTurnanteId.get(l.id)??[]');
    expect(b).not.toContain("l.nombreCargo.includes('ASEADOR')");
  });

  it('nunca muta lineasExtra/cargosTurnantes — construye un arreglo nuevo (orden.map)', () => {
    const b = bloque('const lineasManoObraDisponiblesOrdenadas=React.useMemo(', '\n  // Resumen agregado');
    expect(b).toContain('return orden.map(o=>{');
  });

  it('el turnante muestra "Turnante de <cargo>" (nombre real de la línea, no el texto fijo guardado) — huérfano conserva "Turnante" a secas', () => {
    const b = bloque('const lineasManoObraDisponiblesOrdenadas=React.useMemo(', '\n  // Resumen agregado');
    expect(b).toContain("`Turnante de ${cargosCubiertos.join(' / ')}`:'Turnante'");
  });

  it('el modal (ModalDotacionEpp) y el default de apertura usan la lista YA ORDENADA, nunca la cruda', () => {
    const bModal = bloque('function ModalDotacionEpp()', '\n  function Sec(');
    expect(bModal).toContain(':lineasManoObraDisponiblesOrdenadas).map((linea,i)=>tarjetaCargo(linea,i))');
    const bAbrir = bloque('const abrirModalDotacionEpp=', '\n  const cancelarModalDotacionEpp=');
    // Ajuste "SERVICIOS NO CONTINUOS — REUTILIZACIÓN REAL DE CATÁLOGOS" —
    // `listaCargos` resuelve a `lineasManoObraDisponiblesOrdenadas` (lista
    // YA ordenada, comportamiento histórico intacto) cuando el modal no
    // está destinado a un servicio.
    expect(bAbrir).toContain('const listaCargos=servicioId!=null?lineasManoObraDisponiblesEfectivas:lineasManoObraDisponiblesOrdenadas;');
    expect(bAbrir).toContain('listaCargos[0]?.id??null');
  });

  it('el selector "Aplica a" de otros costos pendientes ya no existe (ajuste "QUITAR BLOQUE COSTOS PENDIENTES DE ASIGNACIÓN DE MANO DE OBRA", retirado sin reemplazo visual a pedido del usuario) — tampoco los 3 selectores de reasignación de Exámenes/Cursos/Vacunas (ajuste "REDISEÑAR EXÁMENES, CURSOS Y VACUNAS": las filas nuevas siempre traen lineaManoObraId explícito desde el modal, nunca "Pendiente de asignación" por defecto)', () => {
    const ocurrencias = (PAGE_TSX.match(/lineasManoObraDisponiblesOrdenadas\.map\(l=><option/g) ?? []).length;
    expect(ocurrencias).toBe(0);
  });

  it('la sección "Resumen" (Personal principal / Turnantes) también usa la lista ordenada — muestra el nombre amigable del turnante', () => {
    const b = bloque('const seccion=(origen:OrigenSujetoDotacion,titulo:string)=>{', '\n                const hayAlgunSujetoConfigurado=');
    expect(b).toContain('lineasManoObraDisponiblesOrdenadas.filter(l=>l.origen===origen)');
  });

  it('la tarjeta de un turnante muestra la leyenda "Cobertura de descanso calculada automáticamente"', () => {
    const b = bloque('const tarjetaCargo=', '\n    return(\n      <div style={{position:\'fixed\'');
    expect(b).toContain("linea.origen==='turnante'");
    expect(b).toContain('Cobertura de descanso calculada automáticamente');
  });

  it('no se creó ninguna condición ad-hoc por nombre de cargo en el cableado (motor genérico, no reglas por cargo)', () => {
    const b = bloque('const lineasManoObraDisponiblesOrdenadas=React.useMemo(', '\n  // Resumen agregado');
    expect(b).not.toMatch(/===\s*['"](ASEADOR|SUPERVISOR)['"]/i);
    expect(b).not.toContain(".includes('ASEADOR')");
  });
});
