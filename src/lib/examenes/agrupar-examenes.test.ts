import { describe, expect, it } from 'vitest';
import {
  filtrarOfertasExamenes, agruparExamenesPorMayorValor, identidadExamenAgrupado,
  consultarExamenesAgrupados, type OfertaExamen,
} from './agrupar-examenes';

function oferta(o: Partial<OfertaExamen>): OfertaExamen {
  return { cod_grupo_exam: 'EM001', cod_examen: 'EX001', descripcion: 'Examen', ciudad: 'Bogotá', codmun: '11001', nit_proveedor: '900000001', vlr_costo: 10000, ...o };
}

describe('CASO 1 — Barranquilla: EX001 con 2 proveedores → 1 fila, ×2, valor mayor', () => {
  it('agrupa las 2 ofertas del mismo examen en una sola fila con el mayor valor', () => {
    const ofertas = [
      oferta({ ciudad: 'Barranquilla', nit_proveedor: 'A', vlr_costo: 16052 }),
      oferta({ ciudad: 'Barranquilla', nit_proveedor: 'B', vlr_costo: 15975 }),
    ];
    const agrupados = agruparExamenesPorMayorValor(ofertas);
    expect(agrupados).toHaveLength(1);
    expect(agrupados[0].numOfertas).toBe(2);
    expect(agrupados[0].vlr_costo).toBe(16052);
    expect(agrupados[0].nit_proveedor).toBe('A');
  });
});

describe('CASO 2 — tres proveedores ($10.000/$30.000/$20.000) → ×3, valor $30.000', () => {
  it('elige la oferta de mayor valor entre 3, nunca promedio ni mínimo', () => {
    const ofertas = [
      oferta({ nit_proveedor: 'A', vlr_costo: 10000 }),
      oferta({ nit_proveedor: 'B', vlr_costo: 30000 }),
      oferta({ nit_proveedor: 'C', vlr_costo: 20000 }),
    ];
    const [g] = agruparExamenesPorMayorValor(ofertas);
    expect(g.numOfertas).toBe(3);
    expect(g.vlr_costo).toBe(30000);
    expect(g.nit_proveedor).toBe('B');
  });
});

describe('CASO 3 — EX001 y EX002 → 2 filas únicas', () => {
  it('exámenes distintos nunca se mezclan en un mismo grupo', () => {
    const ofertas = [
      oferta({ cod_examen: 'EX001' }),
      oferta({ cod_examen: 'EX002' }),
    ];
    expect(agruparExamenesPorMayorValor(ofertas)).toHaveLength(2);
  });
});

describe('CASO 4/5 — paginación de exámenes agrupados: el mismo examen NUNCA se reparte entre páginas', () => {
  it('30 exámenes únicos con múltiples proveedores cada uno → página 1 contiene EXACTAMENTE 30 exámenes únicos', () => {
    const ofertas: OfertaExamen[] = [];
    for (let i = 1; i <= 30; i++) {
      const cod = `EX${String(i).padStart(3, '0')}`;
      for (let p = 1; p <= 5; p++) ofertas.push(oferta({ cod_examen: cod, nit_proveedor: `P${p}`, vlr_costo: 1000 * p }));
    }
    const r = consultarExamenesAgrupados(ofertas, {}, 1, 30, false);
    expect(r.total).toBe(30); // 30 exámenes únicos, NUNCA 150 ofertas
    expect(r.data).toHaveLength(30);
    const codigos = new Set(r.data.map((d) => d.cod_examen));
    expect(codigos.size).toBe(30); // sin duplicados entre sí
  });

  it('el mismo examen con 5 proveedores nunca vuelve a aparecer en la página 2', () => {
    const ofertas: OfertaExamen[] = [];
    for (let i = 1; i <= 31; i++) {
      const cod = `EX${String(i).padStart(3, '0')}`;
      for (let p = 1; p <= 5; p++) ofertas.push(oferta({ cod_examen: cod, nit_proveedor: `P${p}` }));
    }
    const pagina1 = consultarExamenesAgrupados(ofertas, {}, 1, 30, false);
    const pagina2 = consultarExamenesAgrupados(ofertas, {}, 2, 30, false);
    const codigosP1 = new Set(pagina1.data.map((d) => d.cod_examen));
    const codigosP2 = new Set(pagina2.data.map((d) => d.cod_examen));
    const interseccion = [...codigosP1].filter((c) => codigosP2.has(c));
    expect(interseccion).toHaveLength(0);
    expect(pagina2.data).toHaveLength(1); // EX031, el único que sobra
  });
});

describe('CASO 6/7 — filtro de ciudad ANTES de agrupar (server-side, nunca solo visual sobre una página)', () => {
  it('filtrar por Barranquilla excluye por completo ofertas de otras ciudades del resultado agrupado', () => {
    const ofertas = [
      oferta({ ciudad: 'Bogotá', cod_examen: 'EX001' }),
      oferta({ ciudad: 'Cartagena', cod_examen: 'EX002' }),
      oferta({ ciudad: 'Barranquilla', cod_examen: 'EX003' }),
    ];
    const filtradas = filtrarOfertasExamenes(ofertas, { ciudad: 'Barranquilla' });
    expect(filtradas).toHaveLength(1);
    expect(filtradas[0].cod_examen).toBe('EX003');
    const agrupados = agruparExamenesPorMayorValor(filtradas);
    expect(agrupados.every((a) => a.ciudad === 'Barranquilla')).toBe(true);
  });

  it('el total tras filtrar por ciudad refleja SOLO los exámenes agrupados de esa ciudad', () => {
    const ofertas = [
      oferta({ ciudad: 'Bogotá', cod_examen: 'EX001', nit_proveedor: 'A' }),
      oferta({ ciudad: 'Bogotá', cod_examen: 'EX001', nit_proveedor: 'B' }),
      oferta({ ciudad: 'Barranquilla', cod_examen: 'EX002', nit_proveedor: 'C' }),
    ];
    const r = consultarExamenesAgrupados(ofertas, { ciudad: 'Barranquilla' }, 1, 30, false);
    expect(r.total).toBe(1);
    expect(r.data[0].cod_examen).toBe('EX002');
  });
});

describe('CASO 8 — EM001/EX001 y EM002/EX001: identidad real, nunca se mezclan si son grupos distintos', () => {
  it('el mismo cod_examen bajo dos cod_grupo_exam distintos produce DOS filas, cada una con sus propias ofertas', () => {
    const ofertas = [
      oferta({ cod_grupo_exam: 'EM001', cod_examen: 'EX001', nit_proveedor: 'A', vlr_costo: 16000 }),
      oferta({ cod_grupo_exam: 'EM001', cod_examen: 'EX001', nit_proveedor: 'B', vlr_costo: 15000 }),
      oferta({ cod_grupo_exam: 'EM002', cod_examen: 'EX001', nit_proveedor: 'C', vlr_costo: 20000 }),
    ];
    const agrupados = agruparExamenesPorMayorValor(ofertas);
    expect(agrupados).toHaveLength(2);
    const em001 = agrupados.find((a) => a.cod_grupo_exam === 'EM001')!;
    const em002 = agrupados.find((a) => a.cod_grupo_exam === 'EM002')!;
    expect(em001.numOfertas).toBe(2);
    expect(em001.vlr_costo).toBe(16000);
    expect(em002.numOfertas).toBe(1);
    expect(em002.vlr_costo).toBe(20000);
  });

  it('identidadExamenAgrupado distingue EM001|EX001 de EM002|EX001', () => {
    const a = identidadExamenAgrupado(oferta({ cod_grupo_exam: 'EM001', cod_examen: 'EX001' }));
    const b = identidadExamenAgrupado(oferta({ cod_grupo_exam: 'EM002', cod_examen: 'EX001' }));
    expect(a).not.toBe(b);
  });
});

describe('CASO 9 — selección: usa la oferta de mayor valor y conserva el proveedor ganador', () => {
  it('la fila agrupada representa UNA selección con el proveedor/valor de la oferta ganadora, nunca las dos ofertas', () => {
    const ofertas = [
      oferta({ nit_proveedor: 'SIOMLAB', vlr_costo: 16052 }),
      oferta({ nit_proveedor: 'OTRO', vlr_costo: 15975 }),
    ];
    const [g] = agruparExamenesPorMayorValor(ofertas);
    expect(g.nit_proveedor).toBe('SIOMLAB');
    expect(g.vlr_costo).toBe(16052);
  });
});

describe('CASO 10 — el total del paginador cuenta exámenes agrupados, nunca ofertas brutas', () => {
  it('6 ofertas (EX001×2, EX002×3, EX003×1) → total=3, nunca 6', () => {
    const ofertas = [
      oferta({ cod_examen: 'EX001', nit_proveedor: 'A', vlr_costo: 16052 }),
      oferta({ cod_examen: 'EX001', nit_proveedor: 'B', vlr_costo: 15975 }),
      oferta({ cod_examen: 'EX002', nit_proveedor: 'C', vlr_costo: 25000 }),
      oferta({ cod_examen: 'EX002', nit_proveedor: 'D', vlr_costo: 27000 }),
      oferta({ cod_examen: 'EX002', nit_proveedor: 'E', vlr_costo: 23000 }),
      oferta({ cod_examen: 'EX003', nit_proveedor: 'F', vlr_costo: 40000 }),
    ];
    const r = consultarExamenesAgrupados(ofertas, {}, 1, 30, false);
    expect(r.total).toBe(3);
    const porCodigo = new Map(r.data.map((d) => [d.cod_examen, d]));
    expect(porCodigo.get('EX001')!.vlr_costo).toBe(16052);
    expect(porCodigo.get('EX001')!.numOfertas).toBe(2);
    expect(porCodigo.get('EX002')!.vlr_costo).toBe(27000);
    expect(porCodigo.get('EX002')!.numOfertas).toBe(3);
    expect(porCodigo.get('EX003')!.vlr_costo).toBe(40000);
    expect(porCodigo.get('EX003')!.numOfertas).toBe(1);
  });
});

describe('Filtros por campo específico — NIT proveedor filtra primero, agrupa después (Ajuste §9)', () => {
  it('filtrar por NIT reduce las ofertas ANTES de agrupar — el badge ×N refleja solo las ofertas de ese proveedor', () => {
    const ofertas = [
      oferta({ nit_proveedor: '900111', vlr_costo: 10000 }),
      oferta({ nit_proveedor: '900222', vlr_costo: 30000 }),
    ];
    const r = consultarExamenesAgrupados(ofertas, { nitProveedor: '900111' }, 1, 30, false);
    expect(r.total).toBe(1);
    expect(r.data[0].numOfertas).toBe(1);
    expect(r.data[0].vlr_costo).toBe(10000); // NUNCA 30000 — ese proveedor quedó excluido por el filtro
  });
});

describe('Orden estable — por cod_grupo_exam y luego cod_examen (Ajuste §13)', () => {
  it('el orden no cambia entre llamadas ni con distinto orden de entrada', () => {
    const ofertas = [
      oferta({ cod_grupo_exam: 'EM002', cod_examen: 'EX010' }),
      oferta({ cod_grupo_exam: 'EM001', cod_examen: 'EX020' }),
      oferta({ cod_grupo_exam: 'EM001', cod_examen: 'EX010' }),
    ];
    const agrupados = agruparExamenesPorMayorValor(ofertas);
    expect(agrupados.map((a) => `${a.cod_grupo_exam}|${a.cod_examen}`)).toEqual(['EM001|EX010', 'EM001|EX020', 'EM002|EX010']);
  });
});

describe('Corrección de seguimiento — la ciudad es SIEMPRE parte de la identidad, nunca solo un filtro (evita mezclar ciudades sin filtro activo)', () => {
  it('el mismo EM001|EX001 en Cartago y en Bogotá produce DOS filas (una por ciudad), sin filtro de ciudad activo', () => {
    const ofertas = [
      oferta({ ciudad: 'Cartago', nit_proveedor: 'A', vlr_costo: 30000 }),
      oferta({ ciudad: 'Bogotá', nit_proveedor: 'B', vlr_costo: 10000 }),
    ];
    const agrupados = agruparExamenesPorMayorValor(ofertas);
    expect(agrupados).toHaveLength(2);
    expect(agrupados.map((a) => a.ciudad).sort()).toEqual(['Bogotá', 'Cartago']);
  });

  it('un examen con 31 ofertas repartidas en varias ciudades NUNCA aparece como una sola fila "×31" — cada ciudad agrupa solo sus propias ofertas', () => {
    const ciudades = ['Cartago', 'Bogotá', 'Riohacha'];
    const ofertas: OfertaExamen[] = [];
    ciudades.forEach((ciudad, i) => {
      for (let p = 0; p < 10 + i; p++) ofertas.push(oferta({ ciudad, nit_proveedor: `P${ciudad}${p}`, vlr_costo: 1000 * (p + 1) }));
    });
    const agrupados = agruparExamenesPorMayorValor(ofertas);
    expect(agrupados).toHaveLength(3); // una fila por ciudad, nunca una sola fila global
    const porCiudad = new Map(agrupados.map((a) => [a.ciudad, a]));
    expect(porCiudad.get('Cartago')!.numOfertas).toBe(10);
    expect(porCiudad.get('Bogotá')!.numOfertas).toBe(11);
    expect(porCiudad.get('Riohacha')!.numOfertas).toBe(12);
  });

  it('identidadExamenAgrupado incluye la ciudad — dos ofertas del mismo grupo/examen en ciudades distintas tienen identidades distintas', () => {
    const a = identidadExamenAgrupado(oferta({ ciudad: 'Cartago' }));
    const b = identidadExamenAgrupado(oferta({ ciudad: 'Bogotá' }));
    expect(a).not.toBe(b);
  });

  it('CON filtro de ciudad activo, el comportamiento no cambia: sigue habiendo una sola fila para esa ciudad (la ciudad ya era constante en el conjunto filtrado)', () => {
    const ofertas = [
      oferta({ ciudad: 'Barranquilla', nit_proveedor: 'A', vlr_costo: 16052 }),
      oferta({ ciudad: 'Barranquilla', nit_proveedor: 'B', vlr_costo: 15975 }),
    ];
    const r = consultarExamenesAgrupados(ofertas, { ciudad: 'Barranquilla' }, 1, 30, false);
    expect(r.total).toBe(1);
    expect(r.data[0].numOfertas).toBe(2);
  });
});
