import { describe, it, expect } from 'vitest';
import {
  normalizarRegistrosTrmOficiales,
  construirEventosTrmDesdeVigencias,
  resolverTrmVigenteEnFecha,
  resolverEventoObjetivo,
  agruparFechasPorEventoTrm,
  type RegistroTrmOficial,
} from './vigencias';

// ─── 1) Resolver fecha dentro de vigencia ──────────────────────────────────────

describe('1) resolverTrmVigenteEnFecha — fecha dentro de una vigencia', () => {
  it('devuelve el evento cuya vigencia [desde,hasta] contiene la fecha', () => {
    const { registros } = normalizarRegistrosTrmOficiales([
      { valor: 4000.5, vigenciaDesde: '2024-01-02', vigenciaHasta: '2024-01-02' },
      { valor: 4010.25, vigenciaDesde: '2024-01-03', vigenciaHasta: '2024-01-05' },
    ]);
    const eventos = construirEventosTrmDesdeVigencias(registros);
    const evento = resolverTrmVigenteEnFecha('2024-01-04', eventos);
    expect(evento).not.toBeNull();
    expect(evento!.valor).toBe(4010.25);
    expect(evento!.decimal).toBe(25);
  });
});

// ─── 2) Sábado/domingo/lunes dentro del mismo intervalo ────────────────────────

describe('2) Sábado/domingo/lunes dentro de la misma vigencia comparten el mismo evento', () => {
  it('agruparFechasPorEventoTrm pone las 3 fechas en el mismo grupo', () => {
    // Viernes 2024-01-05, la vigencia se extiende hasta el lunes 2024-01-08 (fin de semana incluido)
    const { registros } = normalizarRegistrosTrmOficiales([
      { valor: 4000, vigenciaDesde: '2024-01-05', vigenciaHasta: '2024-01-08' },
    ]);
    const eventos = construirEventosTrmDesdeVigencias(registros);
    const grupos = agruparFechasPorEventoTrm(['2024-01-06', '2024-01-07', '2024-01-08'], eventos);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].fechas).toEqual(['2024-01-06', '2024-01-07', '2024-01-08']);
    expect(grupos[0].evento?.valor).toBe(4000);
  });
});

// ─── 3) Festivo prolonga vigencia ───────────────────────────────────────────────

describe('3) Festivo prolonga la vigencia (misma certificación cubre el festivo)', () => {
  it('una vigencia que incluye un festivo entre semana sigue siendo UN solo evento', () => {
    // 2024-01-01 es festivo (Año Nuevo); la vigencia lo incluye sin cortar el evento
    const { registros } = normalizarRegistrosTrmOficiales([
      { valor: 3950, vigenciaDesde: '2023-12-29', vigenciaHasta: '2024-01-01' },
    ]);
    const eventos = construirEventosTrmDesdeVigencias(registros);
    expect(eventos).toHaveLength(1);
    expect(resolverTrmVigenteEnFecha('2024-01-01', eventos)?.valor).toBe(3950);
    expect(resolverTrmVigenteEnFecha('2023-12-30', eventos)?.valor).toBe(3950);
  });
});

// ─── 4) Dos registros distintos con igual valor se conservan ──────────────────

describe('4) Dos certificaciones distintas con el MISMO valor se conservan como eventos separados', () => {
  it('nunca se fusionan por igualdad de valor, aunque sean vigencias adyacentes', () => {
    const { registros } = normalizarRegistrosTrmOficiales([
      { valor: 4000, vigenciaDesde: '2024-01-02', vigenciaHasta: '2024-01-02' },
      { valor: 4000, vigenciaDesde: '2024-01-03', vigenciaHasta: '2024-01-03' }, // mismo valor, vigencia distinta
    ]);
    const eventos = construirEventosTrmDesdeVigencias(registros);
    expect(eventos).toHaveLength(2); // NO se colapsan en 1, a diferencia de construirEventosEfectivos()
    expect(eventos[0].vigenciaDesde).toBe('2024-01-02');
    expect(eventos[1].vigenciaDesde).toBe('2024-01-03');
  });
});

// ─── 5) Intervalos solapados → error ───────────────────────────────────────────

describe('5) Vigencias solapadas → error explícito', () => {
  it('lanza al detectar 2 registros con vigencias que se solapan', () => {
    const crudos: RegistroTrmOficial[] = [
      { valor: 4000, vigenciaDesde: '2024-01-02', vigenciaHasta: '2024-01-05' },
      { valor: 4010, vigenciaDesde: '2024-01-04', vigenciaHasta: '2024-01-06' }, // se solapa el 04-05
    ];
    expect(() => normalizarRegistrosTrmOficiales(crudos)).toThrow(/solapad/i);
  });
});

// ─── 6) Hueco de vigencia → detectado ──────────────────────────────────────────

describe('6) Hueco de vigencia — se detecta y reporta, sin inventar dato', () => {
  it('reporta el rango de fechas sin cobertura entre 2 vigencias no contiguas', () => {
    const { huecos } = normalizarRegistrosTrmOficiales([
      { valor: 4000, vigenciaDesde: '2024-01-02', vigenciaHasta: '2024-01-03' },
      { valor: 4010, vigenciaDesde: '2024-01-08', vigenciaHasta: '2024-01-09' }, // hueco: 01-04 a 01-07
    ]);
    expect(huecos).toEqual([{ desde: '2024-01-04', hasta: '2024-01-07' }]);
  });

  it('vigencias contiguas (sin día de por medio) NO generan hueco', () => {
    const { huecos } = normalizarRegistrosTrmOficiales([
      { valor: 4000, vigenciaDesde: '2024-01-02', vigenciaHasta: '2024-01-03' },
      { valor: 4010, vigenciaDesde: '2024-01-04', vigenciaHasta: '2024-01-05' },
    ]);
    expect(huecos).toEqual([]);
  });
});

// ─── 7) Fecha objetivo fuera del histórico → no inventar dato ─────────────────

describe('7) Fecha fuera de toda vigencia → null, nunca se inventa', () => {
  it('resolverEventoObjetivo devuelve null si la fecha no está cubierta', () => {
    const { registros } = normalizarRegistrosTrmOficiales([
      { valor: 4000, vigenciaDesde: '2024-01-02', vigenciaHasta: '2024-01-05' },
    ]);
    const eventos = construirEventosTrmDesdeVigencias(registros);
    expect(resolverEventoObjetivo('2024-06-01', eventos)).toBeNull();
    expect(resolverEventoObjetivo('2023-12-01', eventos)).toBeNull();
  });
});

// ─── 8) El backtest usa un evento por certificación/vigencia (verificado a nivel de función) ──

describe('8) construirEventosTrmDesdeVigencias produce exactamente 1 evento por registro normalizado', () => {
  it('mapeo 1:1 registro→evento, sin deduplicar por valor', () => {
    const { registros } = normalizarRegistrosTrmOficiales([
      { valor: 4000, vigenciaDesde: '2024-01-02', vigenciaHasta: '2024-01-02' },
      { valor: 4005, vigenciaDesde: '2024-01-03', vigenciaHasta: '2024-01-03' },
      { valor: 4000, vigenciaDesde: '2024-01-04', vigenciaHasta: '2024-01-04' }, // repite valor de la 1ra, no consecutiva
    ]);
    const eventos = construirEventosTrmDesdeVigencias(registros);
    expect(eventos).toHaveLength(3);
  });
});

// ─── 9) Dato posterior al corte no cambia la predicción (no-leakage a nivel de resolución) ──

describe('9) Agregar un registro posterior no altera la resolución de fechas anteriores', () => {
  it('resolverTrmVigenteEnFecha para una fecha pasada da el mismo resultado con o sin datos futuros', () => {
    const base: RegistroTrmOficial[] = [
      { valor: 4000, vigenciaDesde: '2024-01-02', vigenciaHasta: '2024-01-05' },
    ];
    const { registros: reg1 } = normalizarRegistrosTrmOficiales(base);
    const eventos1 = construirEventosTrmDesdeVigencias(reg1);
    const resultado1 = resolverTrmVigenteEnFecha('2024-01-03', eventos1);

    const { registros: reg2 } = normalizarRegistrosTrmOficiales([
      ...base,
      { valor: 9999.99, vigenciaDesde: '2024-06-01', vigenciaHasta: '2024-06-01' }, // futuro, no solapa
    ]);
    const eventos2 = construirEventosTrmDesdeVigencias(reg2);
    const resultado2 = resolverTrmVigenteEnFecha('2024-01-03', eventos2);

    expect(resultado2).toEqual(resultado1);
  });
});

// ─── 10) Misma vigencia → misma fecha/evento objetivo ──────────────────────────

describe('10) Distintas fechas de la misma vigencia resuelven al MISMO evento (misma predicción reutilizable)', () => {
  it('resolverEventoObjetivo para 2 fechas de la misma vigencia devuelve el mismo evento (igualdad estructural)', () => {
    const { registros } = normalizarRegistrosTrmOficiales([
      { valor: 4022.13, vigenciaDesde: '2024-03-01', vigenciaHasta: '2024-03-04' },
    ]);
    const eventos = construirEventosTrmDesdeVigencias(registros);
    const a = resolverEventoObjetivo('2024-03-01', eventos);
    const b = resolverEventoObjetivo('2024-03-04', eventos);
    expect(a).toEqual(b);
  });
});

// ─── Extra: normalización — validación de crudos ───────────────────────────────

describe('normalizarRegistrosTrmOficiales — validación de datos crudos', () => {
  it('descarta valor no numérico, valor ≤0, y fechas inválidas/invertidas', () => {
    const r = normalizarRegistrosTrmOficiales([
      { valor: 'no-numero', vigenciaDesde: '2024-01-01', vigenciaHasta: '2024-01-01' },
      { valor: -5, vigenciaDesde: '2024-01-02', vigenciaHasta: '2024-01-02' },
      { valor: 4000, vigenciaDesde: '2024-01-10', vigenciaHasta: '2024-01-05' }, // desde > hasta
      { valor: 4000, vigenciaDesde: '2024-01-02', vigenciaHasta: '2024-01-02' }, // válido
    ]);
    expect(r.descartados).toBe(3);
    expect(r.registros).toHaveLength(1);
  });

  it('elimina duplicados EXACTOS (misma valor+vigencia completa) sin tratarlos como huecos ni error', () => {
    const r = normalizarRegistrosTrmOficiales([
      { valor: 4000, vigenciaDesde: '2024-01-02', vigenciaHasta: '2024-01-02' },
      { valor: 4000, vigenciaDesde: '2024-01-02', vigenciaHasta: '2024-01-02' }, // exacto duplicado
    ]);
    expect(r.duplicadosExactosEliminados).toBe(1);
    expect(r.registros).toHaveLength(1);
  });

  it('registros ya vienen ordenados ascendente por vigenciaDesde', () => {
    const r = normalizarRegistrosTrmOficiales([
      { valor: 4010, vigenciaDesde: '2024-02-01', vigenciaHasta: '2024-02-01' },
      { valor: 4000, vigenciaDesde: '2024-01-01', vigenciaHasta: '2024-01-01' },
    ]);
    expect(r.registros.map(x => x.vigenciaDesde)).toEqual(['2024-01-01', '2024-02-01']);
  });
});

describe('agruparFechasPorEventoTrm — fechas sin evento no se inventan', () => {
  it('fechas fuera de toda vigencia quedan agrupadas bajo clave null, con evento null', () => {
    const { registros } = normalizarRegistrosTrmOficiales([
      { valor: 4000, vigenciaDesde: '2024-01-02', vigenciaHasta: '2024-01-02' },
    ]);
    const eventos = construirEventosTrmDesdeVigencias(registros);
    const grupos = agruparFechasPorEventoTrm(['2024-01-02', '2099-01-01'], eventos);
    const grupoSinEvento = grupos.find(g => g.evento === null);
    expect(grupoSinEvento).toBeDefined();
    expect(grupoSinEvento!.fechas).toEqual(['2099-01-01']);
  });
});
