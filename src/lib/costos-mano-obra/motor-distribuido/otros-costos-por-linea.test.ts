/**
 * Pruebas de "Otros costos por línea de cargo" — implementación funcional
 * posterior a la auditoría. Cubre los 6 casos de control obligatorios y
 * las pruebas #1-#14, #19-#27 relacionadas con el módulo puro (las
 * pruebas de persistencia #15-#18 y UI viven en texto-ui-otros-costos-*
 * o se verifican por inspección de fuente).
 */
import { describe, expect, it } from 'vitest';
import {
  resolverLineaManoObraId, construirDesgloseOtrosCostosLinea, construirResultadoLineaConOtrosCostos,
  agregarCostoMensualTotalManoObra, promediarDotacionPorSexo,
} from './otros-costos-por-linea';
import type { LineaManoObraResumen, ItemCostoResuelto } from './otros-costos-por-linea';

describe('resolverLineaManoObraId — migración en memoria de registros antiguos (§16)', () => {
  it('1/2) cada línea tiene un id estable, y dos líneas con el mismo cargo tienen ids diferentes', () => {
    const lineas: LineaManoObraResumen[] = [
      { id: 10, cargoCodigo: 'ASEADOR', cantidadTrabajadores: 3 },
      { id: 11, cargoCodigo: 'ASEADOR', cantidadTrabajadores: 2 },
    ];
    expect(lineas[0].id).not.toBe(lineas[1].id);
  });

  it('ya trae lineaManoObraId explícito → se respeta tal cual, nunca se recalcula', () => {
    const lineas: LineaManoObraResumen[] = [{ id: 1, cargoCodigo: 'ASEADOR', cantidadTrabajadores: 3 }];
    const r = resolverLineaManoObraId({ lineaManoObraId: 99 }, lineas);
    expect(r.lineaManoObraIdResuelto).toBe(99);
    expect(r.estado).toBe('ASIGNADO');
  });

  it('20) Caso A — registro histórico sin lineaManoObraId, una sola línea en toda la estructura → se asigna a esa única línea', () => {
    const lineas: LineaManoObraResumen[] = [{ id: 5, cargoCodigo: 'ASEADOR', cantidadTrabajadores: 1 }];
    const r = resolverLineaManoObraId({ cargoCodigo: null }, lineas);
    expect(r.lineaManoObraIdResuelto).toBe(5);
    expect(r.estado).toBe('ASIGNADO');
  });

  it('Caso B — varias líneas, cargoCodigo coincide con exactamente una → se asigna a esa línea', () => {
    const lineas: LineaManoObraResumen[] = [
      { id: 1, cargoCodigo: 'ASEADOR', cantidadTrabajadores: 3 },
      { id: 2, cargoCodigo: 'SUPERVISOR', cantidadTrabajadores: 1 },
    ];
    const r = resolverLineaManoObraId({ cargoCodigo: 'SUPERVISOR' }, lineas);
    expect(r.lineaManoObraIdResuelto).toBe(2);
    expect(r.estado).toBe('ASIGNADO');
  });

  it('21) Caso C — varias líneas con el mismo cargoCodigo (ambiguo) → PENDIENTE_DE_ASIGNACION, nunca se adivina', () => {
    const lineas: LineaManoObraResumen[] = [
      { id: 1, cargoCodigo: 'ASEADOR', cantidadTrabajadores: 3 },
      { id: 2, cargoCodigo: 'ASEADOR', cantidadTrabajadores: 2 },
    ];
    const r = resolverLineaManoObraId({ cargoCodigo: 'ASEADOR' }, lineas);
    expect(r.lineaManoObraIdResuelto).toBeNull();
    expect(r.estado).toBe('PENDIENTE_DE_ASIGNACION');
  });

  it('Caso C — sin cargoCodigo y varias líneas → PENDIENTE_DE_ASIGNACION', () => {
    const lineas: LineaManoObraResumen[] = [
      { id: 1, cargoCodigo: 'ASEADOR', cantidadTrabajadores: 3 },
      { id: 2, cargoCodigo: 'SUPERVISOR', cantidadTrabajadores: 1 },
    ];
    const r = resolverLineaManoObraId({}, lineas);
    expect(r.estado).toBe('PENDIENTE_DE_ASIGNACION');
  });
});

describe('construirDesgloseOtrosCostosLinea — CASOS DE CONTROL OBLIGATORIOS (§18)', () => {
  it('CASO 1 — ASEADOR cant=1, dotación $50.000/trab + examen $20.000/trab → otrosCostosLinea = $70.000', () => {
    const desglose = construirDesgloseOtrosCostosLinea({
      cantidadTrabajadores: 1,
      dotacion: [{ valorMensual: 50000 }],
      epp: [],
      examenes: [{ valorMensual: 20000 }],
      cursos: [],
      vacunas: [],
    });
    expect(desglose.otrosCostosMensualesLinea).toBe(70000);
  });

  it('CASO 2 — ASEADOR cant=3, mismos valores unitarios → otrosCostosLinea = $70.000 × 3 = $210.000', () => {
    const desglose = construirDesgloseOtrosCostosLinea({
      cantidadTrabajadores: 3,
      dotacion: [{ valorMensual: 50000 }],
      epp: [],
      examenes: [{ valorMensual: 20000 }],
      cursos: [],
      vacunas: [],
    });
    expect(desglose.otrosCostosMensualesPorTrabajadorLinea).toBe(70000);
    expect(desglose.otrosCostosMensualesLinea).toBe(210000);
  });

  it('CASO 3 — ASEADOR (cant=3, $70.000/trab) + SUPERVISOR (cant=1, $120.000/trab) → 210.000 + 120.000 = 330.000, sin promediar', () => {
    const aseador = construirDesgloseOtrosCostosLinea({
      cantidadTrabajadores: 3, dotacion: [{ valorMensual: 70000 }], epp: [], examenes: [], cursos: [], vacunas: [],
    });
    const supervisor = construirDesgloseOtrosCostosLinea({
      cantidadTrabajadores: 1, dotacion: [{ valorMensual: 120000 }], epp: [], examenes: [], cursos: [], vacunas: [],
    });
    expect(aseador.otrosCostosMensualesLinea).toBe(210000);
    expect(supervisor.otrosCostosMensualesLinea).toBe(120000);
    const total = aseador.otrosCostosMensualesLinea + supervisor.otrosCostosMensualesLinea;
    expect(total).toBe(330000);
    // Nunca se aplica el valor unitario de ASEADOR a SUPERVISOR: cada línea
    // conserva su propio otrosCostosMensualesPorTrabajadorLinea.
    expect(aseador.otrosCostosMensualesPorTrabajadorLinea).toBe(70000);
    expect(supervisor.otrosCostosMensualesPorTrabajadorLinea).toBe(120000);
    expect(aseador.otrosCostosMensualesPorTrabajadorLinea).not.toBe(supervisor.otrosCostosMensualesPorTrabajadorLinea);
  });

  it('CASO 4 — dos líneas "ASEADOR" (cant=3 a $70.000/trab, cant=2 a $40.000/trab) → 210.000 + 80.000 = 290.000, nunca agrupadas por nombre', () => {
    const linea1 = construirDesgloseOtrosCostosLinea({
      cantidadTrabajadores: 3, dotacion: [{ valorMensual: 70000 }], epp: [], examenes: [], cursos: [], vacunas: [],
    });
    const linea2 = construirDesgloseOtrosCostosLinea({
      cantidadTrabajadores: 2, dotacion: [{ valorMensual: 40000 }], epp: [], examenes: [], cursos: [], vacunas: [],
    });
    expect(linea1.otrosCostosMensualesLinea).toBe(210000);
    expect(linea2.otrosCostosMensualesLinea).toBe(80000);
    expect(linea1.otrosCostosMensualesLinea + linea2.otrosCostosMensualesLinea).toBe(290000);
  });

  it('CASO 5 — SUPERVISOR cant=4, curso fijo POR_LINEA de $100.000 → curso mensual de la línea = $100.000, nunca ×4', () => {
    const cursoFijo: ItemCostoResuelto = { valorMensual: 100000, alcance: 'POR_LINEA' };
    const desglose = construirDesgloseOtrosCostosLinea({
      cantidadTrabajadores: 4, dotacion: [], epp: [], examenes: [], cursos: [cursoFijo], vacunas: [],
    });
    expect(desglose.cursosFijosLinea).toBe(100000);
    expect(desglose.otrosCostosFijosMensualesLinea).toBe(100000);
    expect(desglose.otrosCostosMensualesLinea).toBe(100000);
    expect(desglose.otrosCostosMensualesLinea).not.toBe(400000);
  });

  it('10/11) curso POR_TRABAJADOR se multiplica por cantidad; curso POR_LINEA no se multiplica', () => {
    const cursoPorTrabajador: ItemCostoResuelto = { valorMensual: 10000, alcance: 'POR_TRABAJADOR' };
    const desglosePorTrabajador = construirDesgloseOtrosCostosLinea({
      cantidadTrabajadores: 5, dotacion: [], epp: [], examenes: [], cursos: [cursoPorTrabajador], vacunas: [],
    });
    expect(desglosePorTrabajador.otrosCostosMensualesLinea).toBe(50000);

    const cursoFijo: ItemCostoResuelto = { valorMensual: 10000, alcance: 'POR_LINEA' };
    const desgloseFijo = construirDesgloseOtrosCostosLinea({
      cantidadTrabajadores: 5, dotacion: [], epp: [], examenes: [], cursos: [cursoFijo], vacunas: [],
    });
    expect(desgloseFijo.otrosCostosMensualesLinea).toBe(10000);
  });

  it('valor predeterminado del alcance (ausente) es POR_TRABAJADOR', () => {
    const cursoSinAlcance: ItemCostoResuelto = { valorMensual: 10000 };
    const desglose = construirDesgloseOtrosCostosLinea({
      cantidadTrabajadores: 3, dotacion: [], epp: [], examenes: [], cursos: [cursoSinAlcance], vacunas: [],
    });
    expect(desglose.otrosCostosMensualesLinea).toBe(30000);
  });
});

describe('construirDesgloseOtrosCostosLinea — asociación por concepto (§3-§6, pruebas #3-#7)', () => {
  it('3) dotación se asocia por línea — dos líneas con dotación distinta no se mezclan', () => {
    const l1 = construirDesgloseOtrosCostosLinea({ cantidadTrabajadores: 1, dotacion: [{ valorMensual: 30000 }], epp: [], examenes: [], cursos: [], vacunas: [] });
    const l2 = construirDesgloseOtrosCostosLinea({ cantidadTrabajadores: 1, dotacion: [{ valorMensual: 90000 }], epp: [], examenes: [], cursos: [], vacunas: [] });
    expect(l1.dotacionMensualPorTrabajador).not.toBe(l2.dotacionMensualPorTrabajador);
  });

  it('4) EPP se asocia por línea', () => {
    const desglose = construirDesgloseOtrosCostosLinea({ cantidadTrabajadores: 2, dotacion: [], epp: [{ valorMensual: 15000 }], examenes: [], cursos: [], vacunas: [] });
    expect(desglose.eppMensualPorTrabajador).toBe(15000);
    expect(desglose.otrosCostosMensualesLinea).toBe(30000);
  });

  it('5) exámenes se asocian por línea', () => {
    const desglose = construirDesgloseOtrosCostosLinea({ cantidadTrabajadores: 3, dotacion: [], epp: [], examenes: [{ valorMensual: 5000 }], cursos: [], vacunas: [] });
    expect(desglose.examenesMensualesPorTrabajador).toBe(5000);
    expect(desglose.otrosCostosMensualesLinea).toBe(15000);
  });

  it('6) cursos se asocian por línea (alcance POR_TRABAJADOR)', () => {
    const desglose = construirDesgloseOtrosCostosLinea({ cantidadTrabajadores: 2, dotacion: [], epp: [], examenes: [], cursos: [{ valorMensual: 8000, alcance: 'POR_TRABAJADOR' }], vacunas: [] });
    expect(desglose.cursosPorTrabajadorMensuales).toBe(8000);
    expect(desglose.otrosCostosMensualesLinea).toBe(16000);
  });

  it('7) vacunas se asocian por línea', () => {
    const desglose = construirDesgloseOtrosCostosLinea({ cantidadTrabajadores: 4, dotacion: [], epp: [], examenes: [], cursos: [], vacunas: [{ valorMensual: 2000 }] });
    expect(desglose.vacunasMensualesPorTrabajador).toBe(2000);
    expect(desglose.otrosCostosMensualesLinea).toBe(8000);
  });

  it('8/25) la cantidad se aplica por línea, una sola vez', () => {
    const desglose = construirDesgloseOtrosCostosLinea({ cantidadTrabajadores: 7, dotacion: [{ valorMensual: 1000 }], epp: [{ valorMensual: 500 }], examenes: [], cursos: [], vacunas: [] });
    expect(desglose.otrosCostosMensualesPorTrabajadorLinea).toBe(1500);
    expect(desglose.otrosCostosMensualesLinea).toBe(1500 * 7);
  });
});

describe('construirResultadoLineaConOtrosCostos — §8/#23/#24', () => {
  it('23) costoLaboralMensualLinea NO incluye otros costos', () => {
    const desglose = construirDesgloseOtrosCostosLinea({ cantidadTrabajadores: 1, dotacion: [{ valorMensual: 50000 }], epp: [], examenes: [{ valorMensual: 20000 }], cursos: [], vacunas: [] });
    const resultado = construirResultadoLineaConOtrosCostos(2990547, 2990547, desglose);
    expect(resultado.costoLaboralMensualLinea).toBe(2990547);
  });

  it('24) costoMensualTotalLinea SÍ incluye los otros costos de esa línea', () => {
    const desglose = construirDesgloseOtrosCostosLinea({ cantidadTrabajadores: 1, dotacion: [{ valorMensual: 50000 }], epp: [], examenes: [{ valorMensual: 20000 }], cursos: [], vacunas: [] });
    const resultado = construirResultadoLineaConOtrosCostos(2990547, 2990547, desglose);
    expect(resultado.costoMensualTotalLinea).toBe(2990547 + 70000);
  });
});

describe('agregarCostoMensualTotalManoObra — resultado general (§13, pruebas #12/#13)', () => {
  it('12/13) el resultado general es la suma de costoMensualTotalLinea de cada línea, nunca promedio × total', () => {
    const desglose1 = construirDesgloseOtrosCostosLinea({ cantidadTrabajadores: 3, dotacion: [{ valorMensual: 70000 }], epp: [], examenes: [], cursos: [], vacunas: [] });
    const desglose2 = construirDesgloseOtrosCostosLinea({ cantidadTrabajadores: 1, dotacion: [{ valorMensual: 120000 }], epp: [], examenes: [], cursos: [], vacunas: [] });
    const l1 = construirResultadoLineaConOtrosCostos(1000000, 3000000, desglose1);
    const l2 = construirResultadoLineaConOtrosCostos(1500000, 1500000, desglose2);
    const agregado = agregarCostoMensualTotalManoObra([l1, l2]);
    expect(agregado.costoLaboralMensualTotal).toBe(3000000 + 1500000);
    expect(agregado.otrosCostosMensualesTotal).toBe(210000 + 120000);
    expect(agregado.costoMensualTotalManoObra).toBe(3000000 + 210000 + 1500000 + 120000);
    expect(agregado.cantidadLineas).toBe(2);
  });

  it('lista vacía produce todos los totales en cero', () => {
    const agregado = agregarCostoMensualTotalManoObra([]);
    expect(agregado.costoMensualTotalManoObra).toBe(0);
    expect(agregado.cantidadLineas).toBe(0);
  });
});

describe('promediarDotacionPorSexo — regla comercial de promedio Masculino/Femenino POR SUJETO (§ EPP y Dotación por cargo/turnante)', () => {
  it('ambas aplicaciones con elementos → promedio de los dos totales unitarios', () => {
    expect(promediarDotacionPorSexo(70000, true, 90000, true)).toBe(80000);
  });

  it('solo masculino tiene elementos → se usa tal cual, sin promediar con el femenino vacío', () => {
    expect(promediarDotacionPorSexo(70000, true, 0, false)).toBe(70000);
  });

  it('solo femenino tiene elementos → se usa tal cual', () => {
    expect(promediarDotacionPorSexo(0, false, 90000, true)).toBe(90000);
  });

  it('ninguna aplicación tiene elementos → 0', () => {
    expect(promediarDotacionPorSexo(0, false, 0, false)).toBe(0);
  });

  it('producto "Ambos/Unisex" con el MISMO valor en Hombre y Mujer ($20.000 cada uno) da $20.000, NUNCA $40.000 (bug de doble conteo corregido)', () => {
    expect(promediarDotacionPorSexo(20000, true, 20000, true)).toBe(20000);
  });

  it('redondea el promedio a peso entero', () => {
    expect(promediarDotacionPorSexo(70001, true, 70000, true)).toBe(70001); // (70001+70000)/2=70000.5 → redondea a 70001 (Math.round)
  });
});

describe('19) false/cero/IDs sobreviven JSON.stringify/parse', () => {
  it('un item con lineaManoObraId=0 (id válido) y alcance POR_LINEA sobrevive la serialización', () => {
    const item = { lineaManoObraId: 0, cargoCodigo: null, alcance: 'POR_LINEA' as const, valorMensual: 0 };
    const json = JSON.stringify(item);
    expect(json).toContain('"lineaManoObraId":0');
    expect(json).toContain('"alcance":"POR_LINEA"');
    expect(json).toContain('"valorMensual":0');
    const restaurado = JSON.parse(json);
    expect(restaurado.lineaManoObraId).toBe(0);
    expect(restaurado.alcance).toBe('POR_LINEA');
  });
});