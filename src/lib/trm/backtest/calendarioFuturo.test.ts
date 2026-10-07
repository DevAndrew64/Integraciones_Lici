import { describe, it, expect } from 'vitest';
import {
  esSesionMercadoElegible,
  resolverSesionOrigenTrm,
  resolverIntervaloVigenciaEsperado,
} from './calendarioFuturo';

describe('esSesionMercadoElegible — calendario colombiano (sin festivos Fed involucrados)', () => {
  it('sábado y domingo nunca son sesión elegible', () => {
    expect(esSesionMercadoElegible('2026-07-04')).toBe(false); // sábado, además coincide con Independence Day US
    expect(esSesionMercadoElegible('2026-07-05')).toBe(false); // domingo
  });
  it('festivo colombiano (Ley Emiliani) no es sesión elegible', () => {
    expect(esSesionMercadoElegible('2026-07-20')).toBe(false); // Independencia CO (lunes)
  });
  it('día hábil colombiano normal, sin festivo Fed ese día, sí es elegible', () => {
    expect(esSesionMercadoElegible('2026-07-08')).toBe(true); // miércoles normal
  });
});

// ─── 8) Día hábil Colombia + festivo Fed → sesión NO elegible ─────────────────

describe('8) Día hábil en Colombia pero festivo Fed → sesión NO elegible (calendario Fed real, por defecto)', () => {
  it('Thanksgiving 2025 (27-nov, jueves) es día hábil en Colombia pero festivo Fed → no elegible', () => {
    expect(esSesionMercadoElegible('2025-11-27')).toBe(false);
  });
  it('con esFestivoFed explícito también aplica (compatibilidad con inyección directa)', () => {
    const config = { esFestivoFed: (f: string) => f === '2026-07-08' };
    expect(esSesionMercadoElegible('2026-07-08', config)).toBe(false);
  });
});

// ─── 9) Festivo Colombia + día normal Fed → sesión NO elegible ────────────────

describe('9) Festivo colombiano en día que NO es festivo Fed → sigue sin ser elegible', () => {
  it('Batalla de Boyacá (07-ago, festivo solo colombiano) no es festivo Fed pero tampoco es sesión elegible', () => {
    expect(esSesionMercadoElegible('2026-08-07')).toBe(false); // festivo CO
  });
});

// ─── 10) Sábado/domingo → sesión no elegible (ya cubierto arriba, se repite explícito) ──

describe('10) Sábado/domingo — sesión no elegible incluso sin ningún festivo involucrado', () => {
  it('sábado normal sin festivo alguno', () => {
    expect(esSesionMercadoElegible('2026-08-15')).toBe(false); // sábado
  });
});

describe('resolverSesionOrigenTrm', () => {
  it('para un lunes normal, la sesión de origen es el viernes anterior (fin de semana no elegible)', () => {
    expect(resolverSesionOrigenTrm('2026-07-13')).toBe('2026-07-10'); // viernes
  });
  it('para un martes normal, la sesión de origen es el lunes inmediatamente anterior', () => {
    // 2026-03-10 (martes), semana sin festivos CO/Fed conocidos
    expect(resolverSesionOrigenTrm('2026-03-10')).toBe('2026-03-09');
  });
});

// ─── 9 (sección "CASOS DE VIGENCIA ESPERADA" del enunciado) ────────────────────

describe('Casos de vigencia esperada A–D', () => {
  it('A) Viernes elegible → intervalo esperado sábado–martes (el lunes es festivo de Chiquinquirá desde 2026)', () => {
    // 2026-07-10 es viernes, elegible. El lunes 2026-07-13 es el traslado
    // Ley Emiliani del festivo de Chiquinquirá (9-jul, vigente desde 2026)
    // — por eso la siguiente sesión elegible real es el martes 14.
    const r = resolverIntervaloVigenciaEsperado('2026-07-11'); // sábado
    expect(r.sesionOrigen).toBe('2026-07-10');
    expect(r.desde).toBe('2026-07-11');
    expect(r.hasta).toBe('2026-07-14');
  });

  it('B) Lunes festivo Fed → sesión origen viernes, intervalo esperado cubre sábado–martes', () => {
    // Usamos un lunes festivo Fed real: MLK Day 2026 = 19-ene-2026 (lunes)
    const lunesFestivoFed = '2026-01-19';
    expect(esSesionMercadoElegible(lunesFestivoFed)).toBe(false);
    // fechaObjetivo = el sábado previo a ese lunes festivo (17-ene-2026)
    const r = resolverIntervaloVigenciaEsperado('2026-01-17');
    expect(r.sesionOrigen).toBe('2026-01-16'); // viernes anterior al fin de semana
    expect(r.desde).toBe('2026-01-17'); // sábado
    // La siguiente sesión elegible después del viernes 16 es el martes 20
    // (lunes 19 es MLK Day, festivo Fed)
    expect(r.hasta).toBe('2026-01-20');
  });

  it('C) Miércoles festivo Fed → sesión origen martes, intervalo esperado cubre miércoles–jueves', () => {
    // Juneteenth 2024 = 19-jun-2024, miércoles
    const miercolesFestivoFed = '2024-06-19';
    expect(esSesionMercadoElegible(miercolesFestivoFed)).toBe(false);
    const r = resolverIntervaloVigenciaEsperado(miercolesFestivoFed);
    expect(r.sesionOrigen).toBe('2024-06-18'); // martes anterior
    expect(r.desde).toBe('2024-06-19'); // miércoles (el propio festivo Fed)
    expect(r.hasta).toBe('2024-06-20'); // jueves, siguiente sesión elegible
  });

  it('D) Lunes festivo colombiano → sesión origen viernes, misma lógica de extensión', () => {
    // 2026-07-20 es lunes, Día de la Independencia de Colombia
    const lunesFestivoCO = '2026-07-20';
    expect(esSesionMercadoElegible(lunesFestivoCO)).toBe(false);
    const r = resolverIntervaloVigenciaEsperado('2026-07-18'); // sábado
    expect(r.sesionOrigen).toBe('2026-07-17'); // viernes anterior
    expect(r.desde).toBe('2026-07-18');
    // Siguiente sesión elegible tras el viernes 17: no el lunes 20 (festivo CO), sino el martes 21
    expect(r.hasta).toBe('2026-07-21');
  });
});

describe('resolverIntervaloVigenciaEsperado — caso simple', () => {
  it('para un día hábil normal (no adyacente a fin de semana/festivo), el intervalo es de 1 solo día', () => {
    const r = resolverIntervaloVigenciaEsperado('2026-07-08');
    expect(r.desde).toBe('2026-07-08');
    expect(r.hasta).toBe('2026-07-08');
  });
});
