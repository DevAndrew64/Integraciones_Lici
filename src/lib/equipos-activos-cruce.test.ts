import { describe, expect, it } from 'vitest';
import { cruzarCatalogoConDisponibilidad, cruzarEquipoConDisponibilidad, derivarCatalogoDesdeActivos, normalizarNombreEquipoActivo } from './equipos-activos-cruce';
import type { FilaActivaParaCatalogo, FilaDisponibilidadParaCruce } from './equipos-activos-cruce';

// Ajuste "INTEGRACIÓN DE DOS ENDPOINTS — CATÁLOGO + DISPONIBILIDAD" — casos
// tomados de datos reales (búsqueda "brilla", empresa aseo, ver reporte):
// tipo_c=004/sub_tipo_c=014 agrupa MÁS de 10 nombre_c distintos
// (BRILLADORA INDUSTRIAL 16"/17"/17" ELECTROLUX/LAVABRILLADORA...) —
// confirma que tipo_c+sub_tipo_c NUNCA es suficiente por sí solo.

describe('normalizarNombreEquipoActivo', () => {
  it('colapsa espacios repetidos (mismo equipo registrado con doble espacio en algunas filas reales)', () => {
    expect(normalizarNombreEquipoActivo('BRILLADORA INDUSTRIAL  17"')).toBe(normalizarNombreEquipoActivo('BRILLADORA INDUSTRIAL 17"'));
  });
  it('ignora mayúsculas/minúsculas y tildes, sin alterar el texto original mostrado al usuario', () => {
    expect(normalizarNombreEquipoActivo('Colorímetro')).toBe('COLORIMETRO');
  });
  it('recorta espacios al inicio/fin', () => {
    expect(normalizarNombreEquipoActivo('  BRILLADORA  ')).toBe('BRILLADORA');
  });
});

function fila(p: Partial<FilaDisponibilidadParaCruce>): FilaDisponibilidadParaCruce {
  return { codGrupo: '004', codSubtipo: '014', nombre_c: 'BRILLADORA INDUSTRIAL 17"', uen: 'BAQ', ubicacion: 'Barranquilla', cantidadDisponible: 1, valorMantenimiento: 40000, ...p };
}

describe('cruzarEquipoConDisponibilidad — tipo_c+sub_tipo_c+nombre_c normalizado, nunca solo códigos', () => {
  it('equipo presente en ambos endpoints: cruza y trae disponibilidad', () => {
    const r = cruzarEquipoConDisponibilidad(
      { codGrupo: '004', codSubtipo: '014', nombre_c: 'BRILLADORA INDUSTRIAL 17"' },
      [fila({ cantidadDisponible: 5 })],
    );
    expect(r.disponibleTotal).toBe(5);
    expect(r.disponibilidadPorUen).toEqual([{ uen: 'BAQ', ubicacion: 'Barranquilla', cantidad: 5 }]);
  });

  it('dos nombres distintos con el mismo tipo_c+sub_tipo_c NUNCA se mezclan (caso real: 004+014 tiene >10 nombre_c distintos)', () => {
    const disponibilidad = [
      fila({ nombre_c: 'BRILLADORA INDUSTRIAL 16"', cantidadDisponible: 8 }),
      fila({ nombre_c: 'BRILLADORA INDUSTRIAL 17"', cantidadDisponible: 37 }),
      fila({ nombre_c: 'LAVABRILLADORA 17"', cantidadDisponible: 6 }),
    ];
    const r = cruzarEquipoConDisponibilidad({ codGrupo: '004', codSubtipo: '014', nombre_c: 'BRILLADORA INDUSTRIAL 17"' }, disponibilidad);
    expect(r.disponibleTotal).toBe(37);
  });

  it('matching por nombre normalizado (doble espacio vs uno solo) cuando los códigos coinciden', () => {
    const disponibilidad = [fila({ nombre_c: 'BRILLADORA INDUSTRIAL  17"', cantidadDisponible: 34 })];
    const r = cruzarEquipoConDisponibilidad({ codGrupo: '004', codSubtipo: '014', nombre_c: 'BRILLADORA INDUSTRIAL 17"' }, disponibilidad);
    expect(r.disponibleTotal).toBe(34);
  });

  it('disponibilidad por múltiples UEN: conserva el detalle, nunca solo el total', () => {
    const disponibilidad = [
      fila({ uen: 'BAQ', ubicacion: 'Barranquilla', cantidadDisponible: 37 }),
      fila({ uen: 'BOG', ubicacion: 'Bogotá', cantidadDisponible: 42 }),
      fila({ uen: 'MIN', ubicacion: 'Mina', cantidadDisponible: 1, valorMantenimiento: 0 }),
    ];
    const r = cruzarEquipoConDisponibilidad({ codGrupo: '004', codSubtipo: '014', nombre_c: 'BRILLADORA INDUSTRIAL 17"' }, disponibilidad);
    expect(r.disponibilidadPorUen).toEqual([
      { uen: 'BAQ', ubicacion: 'Barranquilla', cantidad: 37 },
      { uen: 'BOG', ubicacion: 'Bogotá', cantidad: 42 },
      { uen: 'MIN', ubicacion: 'Mina', cantidad: 1 },
    ]);
    expect(r.disponibleTotal).toBe(80);
  });

  it('mismo UEN con varias filas coincidentes (distintos lotes) suma la cantidad, nunca lista duplicados', () => {
    const disponibilidad = [
      fila({ uen: 'BAQ', cantidadDisponible: 34 }),
      fila({ uen: 'BAQ', cantidadDisponible: 37 }),
    ];
    const r = cruzarEquipoConDisponibilidad({ codGrupo: '004', codSubtipo: '014', nombre_c: 'BRILLADORA INDUSTRIAL 17"' }, disponibilidad);
    expect(r.disponibilidadPorUen).toEqual([{ uen: 'BAQ', ubicacion: 'Barranquilla', cantidad: 71 }]);
  });

  it('equipo con un solo UEN', () => {
    const r = cruzarEquipoConDisponibilidad({ codGrupo: '004', codSubtipo: '001', nombre_c: 'BRILLADORA INDUSTRIAL 17" 175 RPM' }, [
      fila({ codSubtipo: '001', nombre_c: 'BRILLADORA INDUSTRIAL 17" 175 RPM', uen: 'MIN', ubicacion: 'Mina', cantidadDisponible: 2, valorMantenimiento: 0 }),
    ]);
    expect(r.disponibilidadPorUen).toEqual([{ uen: 'MIN', ubicacion: 'Mina', cantidad: 2 }]);
    expect(r.valorMantenimiento).toBe(0);
  });

  it('equipo de catálogo SIN coincidencia en disponibilidad: 0/vacío, nunca un error ni un valor inventado', () => {
    const r = cruzarEquipoConDisponibilidad({ codGrupo: '004', codSubtipo: '999', nombre_c: 'EQUIPO SIN STOCK' }, [fila({})]);
    expect(r.disponibilidadPorUen).toEqual([]);
    expect(r.disponibleTotal).toBe(0);
    expect(r.valorMantenimiento).toBeNull();
  });

  it('cant_disponible=0 se respeta tal cual (no se descarta la fila)', () => {
    const r = cruzarEquipoConDisponibilidad({ codGrupo: '004', codSubtipo: '014', nombre_c: 'BRILLADORA INDUSTRIAL 17"' }, [fila({ cantidadDisponible: 0 })]);
    expect(r.disponibilidadPorUen).toEqual([{ uen: 'BAQ', ubicacion: 'Barranquilla', cantidad: 0 }]);
    expect(r.disponibleTotal).toBe(0);
  });

  it('valor_mantenimiento=0 se respeta tal cual', () => {
    const r = cruzarEquipoConDisponibilidad({ codGrupo: '004', codSubtipo: '014', nombre_c: 'BRILLADORA INDUSTRIAL 17"' }, [fila({ valorMantenimiento: 0 })]);
    expect(r.valorMantenimiento).toBe(0);
    expect(r.valorMantenimientoConflictivo).toBe(false);
  });

  it('mantenimiento > 0 se propaga', () => {
    const r = cruzarEquipoConDisponibilidad({ codGrupo: '004', codSubtipo: '014', nombre_c: 'BRILLADORA INDUSTRIAL 17"' }, [fila({ valorMantenimiento: 40000 })]);
    expect(r.valorMantenimiento).toBe(40000);
  });

  // Caso real confirmado: mismo equipo, misma búsqueda "brilla" — BAQ/BOG
  // traen valorMantenimiento=40000, MIN trae 0.
  it('valorMantenimiento con valores DISTINTOS entre filas del mismo equipo: nunca elige uno silenciosamente, queda null y marca el conflicto', () => {
    const disponibilidad = [
      fila({ uen: 'BAQ', valorMantenimiento: 40000 }),
      fila({ uen: 'BOG', valorMantenimiento: 40000 }),
      fila({ uen: 'MIN', valorMantenimiento: 0 }),
    ];
    const r = cruzarEquipoConDisponibilidad({ codGrupo: '004', codSubtipo: '014', nombre_c: 'BRILLADORA INDUSTRIAL 17"' }, disponibilidad);
    expect(r.valorMantenimiento).toBeNull();
    expect(r.valorMantenimientoConflictivo).toBe(true);
    expect(r.valorMantenimientoValoresDistintos.sort()).toEqual([0, 40000]);
  });

  it('cruzarCatalogoConDisponibilidad conserva los campos propios del catálogo (fechaAdquisicion/valor) sin tocarlos, solo agrega disponibilidad', () => {
    const catalogo = [{ codGrupo: '004', codSubtipo: '014', nombre_c: 'BRILLADORA INDUSTRIAL 17"', fechaAdquisicion: '2026-02-19', valor: 2808400 }];
    const [r] = cruzarCatalogoConDisponibilidad(catalogo, [fila({ cantidadDisponible: 5 })]);
    expect(r.fechaAdquisicion).toBe('2026-02-19');
    expect(r.valor).toBe(2808400);
    expect(r.disponibleTotal).toBe(5);
  });
});

function activo(p: Partial<FilaActivaParaCatalogo>): FilaActivaParaCatalogo {
  return {
    codGrupo: '004', codSubtipo: '030', nombre_c: 'ESCALERA 4 PASOS', uen: 'BAQ', ubicacion: 'Barranquilla',
    cantidadDisponible: 3, valorMantenimiento: 0,
    grupo: 'MAQUINARIA Y EQUIPO', sub_tipo: 'ESCALERA TIPO TIJERA 4 PASOS',
    fecha_adquisicion: '2014-04-21', valor: 81000,
    ...p,
  };
}

// Ajuste "CATÁLOGO ÚNICO DESDE equipos/obtener" — caso real confirmado:
// búsqueda "ESCALERA" en ASEOCOLBA trae 15 subtipos distintos en
// `equipos/obtener` (tijera 3/4/5/6/8/10/12 pasos, extensible aluminio/
// fibra de vidrio, plástica, etc.), donde antes `equipos/obtener_recientes`
// solo devolvía 1 — `derivarCatalogoDesdeActivos` debe recuperar los 15.
describe('derivarCatalogoDesdeActivos — catálogo derivado de equipos/obtener, nunca de obtener_recientes', () => {
  it('una fila por tipo_c+sub_tipo_c+nombre_c normalizado distinto — nunca colapsa tipos reales distintos', () => {
    const activos = [
      activo({ codSubtipo: '030', nombre_c: 'ESCALERA 4 PASOS', sub_tipo: 'ESCALERA TIPO TIJERA 4 PASOS' }),
      activo({ codSubtipo: '029', nombre_c: 'ESCALERA 6 PASOS', sub_tipo: 'ESCALERA TIPO TIJERA 6 PASOS' }),
      activo({ codSubtipo: '031', nombre_c: 'ESCALERA 8 PASOS', sub_tipo: 'ESCALERA TIPO TIJERA 8 PASOS' }),
    ];
    const catalogo = derivarCatalogoDesdeActivos(activos);
    expect(catalogo).toHaveLength(3);
  });

  it('15 subtipos reales de escalera (caso confirmado en vivo): ninguno se pierde', () => {
    const activos = Array.from({ length: 15 }, (_, i) => activo({ codSubtipo: String(i).padStart(3, '0'), nombre_c: `ESCALERA TIPO ${i}` }));
    expect(derivarCatalogoDesdeActivos(activos)).toHaveLength(15);
  });

  it('varias filas del mismo equipo (distintas UEN/lotes) colapsan en UNA sola fila de catálogo', () => {
    const activos = [
      activo({ uen: 'BAQ', fecha_adquisicion: '2014-04-21' }),
      activo({ uen: 'BOG', fecha_adquisicion: '2015-01-01' }),
      activo({ uen: 'MIN', fecha_adquisicion: '2013-06-01' }),
    ];
    expect(derivarCatalogoDesdeActivos(activos)).toHaveLength(1);
  });

  it('elige como representativa la fila con fecha_adquisicion MÁS RECIENTE del grupo (mismo criterio que "la compra más reciente")', () => {
    const activos = [
      activo({ uen: 'BAQ', fecha_adquisicion: '2014-04-21', valor: 81000 }),
      activo({ uen: 'BOG', fecha_adquisicion: '2018-12-03', valor: 744058 }),
      activo({ uen: 'MIN', fecha_adquisicion: '2013-06-01', valor: 50000 }),
    ];
    const [r] = derivarCatalogoDesdeActivos(activos);
    expect(r.fecha_adquisicion).toBe('2018-12-03');
    expect(r.valor).toBe(744058);
  });

  it('nombre_c con doble espacio vs uno solo (mismo equipo): se agrupan igual, nunca se duplican', () => {
    const activos = [
      activo({ nombre_c: 'BRILLADORA INDUSTRIAL  17"' }),
      activo({ nombre_c: 'BRILLADORA INDUSTRIAL 17"' }),
    ];
    expect(derivarCatalogoDesdeActivos(activos)).toHaveLength(1);
  });

  it('fecha_adquisicion ausente (null) nunca gana sobre una fila con fecha real', () => {
    const activos = [
      activo({ uen: 'BAQ', fecha_adquisicion: null, valor: 1 }),
      activo({ uen: 'BOG', fecha_adquisicion: '2020-01-01', valor: 2 }),
    ];
    const [r] = derivarCatalogoDesdeActivos(activos);
    expect(r.fecha_adquisicion).toBe('2020-01-01');
    expect(r.valor).toBe(2);
  });

  it('sin activos: catálogo vacío, sin error', () => {
    expect(derivarCatalogoDesdeActivos([])).toEqual([]);
  });

  it('el catálogo derivado, cruzado contra los mismos activos, recupera la disponibilidad completa de cada tipo', () => {
    const activos = [
      activo({ codSubtipo: '030', nombre_c: 'ESCALERA 4 PASOS', uen: 'BAQ', cantidadDisponible: 3 }),
      activo({ codSubtipo: '030', nombre_c: 'ESCALERA 4 PASOS', uen: 'BOG', cantidadDisponible: 2 }),
      activo({ codSubtipo: '029', nombre_c: 'ESCALERA 6 PASOS', uen: 'BAQ', cantidadDisponible: 5 }),
    ];
    const catalogo = derivarCatalogoDesdeActivos(activos);
    const cruzado = cruzarCatalogoConDisponibilidad(catalogo, activos);
    expect(cruzado).toHaveLength(2);
    const escalera4 = cruzado.find(r => r.codSubtipo === '030')!;
    expect(escalera4.disponibleTotal).toBe(5);
    const escalera6 = cruzado.find(r => r.codSubtipo === '029')!;
    expect(escalera6.disponibleTotal).toBe(5);
  });
});
