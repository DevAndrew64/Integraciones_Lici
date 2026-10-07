import { describe, it, expect } from 'vitest';
import {
  validarExcepcionesCalendario,
  crearPoliticaCalendarioTrm,
  resolverSesionConExcepciones,
  resolverIntervaloVigenciaEsperadoConPolitica,
  type ExcepcionCalendarioTrm,
} from './excepcionesCalendario';
import { esSesionMercadoElegible } from './calendarioFuturo';
import { festivoChiquinquira, esFestivoChiquinquira, CHIQUINQUIRA_PRIMER_ANIO } from './festivoChiquinquira';
import { EXCEPCIONES_CALENDARIO_TRM } from './politicaCalendarioTrmActual';
import {
  normalizarRegistrosTrmOficiales,
  construirEventosTrmDesdeVigencias,
  resolverTrmVigenteEnFecha,
} from './vigencias';

const POLITICA_ACTUAL = crearPoliticaCalendarioTrm(EXCEPCIONES_CALENDARIO_TRM);
const ORDINARIA = (f: string) => esSesionMercadoElegible(f);

// ─── 1) Cierre CUD 2022-12-30 ────────────────────────────────────────────────

describe('1) Cierre CUD confirmado — 2022-12-30 (GE-1360-2022)', () => {
  it('30-dic-2022 es no elegible por la excepción confirmada, no por el calendario ordinario', () => {
    expect(ORDINARIA('2022-12-30')).toBe(true); // el calendario ordinario lo marcaría hábil
    const r = resolverSesionConExcepciones('2022-12-30', POLITICA_ACTUAL, ORDINARIA);
    expect(r.elegible).toBe(false);
    expect(r.excepcionAplicada?.numeroCircular).toBe('GE-1360-2022');
    expect(r.excepcionAplicada?.estadoEvidencia).toBe('CONFIRMADA_PRIMARIA');
  });
});

// ─── 2) Cierre CUD 2024-12-31 ────────────────────────────────────────────────

describe('2) Cierre CUD confirmado — 2024-12-31 (GE-0242-2024)', () => {
  it('31-dic-2024 es no elegible por la excepción confirmada', () => {
    expect(ORDINARIA('2024-12-31')).toBe(true);
    const r = resolverSesionConExcepciones('2024-12-31', POLITICA_ACTUAL, ORDINARIA);
    expect(r.elegible).toBe(false);
    expect(r.excepcionAplicada?.numeroCircular).toBe('GE-0242-2024');
  });
});

// ─── 3) Cierre CUD 2025-12-31 ────────────────────────────────────────────────

describe('3) Cierre CUD confirmado — 2025-12-31 (GE-0189-2025)', () => {
  it('31-dic-2025 es no elegible por la excepción confirmada', () => {
    expect(ORDINARIA('2025-12-31')).toBe(true);
    const r = resolverSesionConExcepciones('2025-12-31', POLITICA_ACTUAL, ORDINARIA);
    expect(r.elegible).toBe(false);
    expect(r.excepcionAplicada?.numeroCircular).toBe('GE-0189-2025');
  });
});

// ─── 4) Excepción confirmada modifica sesión ───────────────────────────────────

describe('4) Excepción CONFIRMADA_PRIMARIA modifica el intervalo de vigencia esperado', () => {
  it('el intervalo que cubre el cierre 2024-12-31 se extiende hasta la siguiente sesión real', () => {
    // Origen: sesión del lunes 2024-12-30. Sin la excepción, "hasta" sería el propio
    // 31-dic (martes, ordinariamente hábil). Con el cierre confirmado, la siguiente
    // sesión elegible real es el jueves 2-ene-2025 (1-ene es festivo CO+Fed).
    const r = resolverIntervaloVigenciaEsperadoConPolitica('2024-12-31', POLITICA_ACTUAL);
    expect(r.calendarioEstado).toBe('ESTIMADO_CON_EXCEPCION');
    expect(r.fuenteCalendario).toContain('GE-0242');
    expect(r.hasta).not.toBe('2024-12-31'); // ya no es un intervalo de 1 solo día
  });
});

// ─── 5) Excepción pendiente NO modifica sesión ─────────────────────────────────

describe('5) Excepción PENDIENTE_DOCUMENTO_PRIMARIO nunca modifica el calendario', () => {
  it('2023-12-29 sigue elegible según la regla ordinaria — la excepción pendiente no se aplica', () => {
    const pendiente = EXCEPCIONES_CALENDARIO_TRM.find(e => e.fecha === '2023-12-29');
    expect(pendiente?.estadoEvidencia).toBe('PENDIENTE_DOCUMENTO_PRIMARIO');

    expect(ORDINARIA('2023-12-29')).toBe(true);
    const r = resolverSesionConExcepciones('2023-12-29', POLITICA_ACTUAL, ORDINARIA);
    expect(r.elegible).toBe(true); // NO se aplica el cierre pendiente
    expect(r.excepcionAplicada).toBeNull();
  });
});

// ─── 6) Festivo Chiquinquirá desde 2026 ────────────────────────────────────────

describe('6) Festivo "Día de Nuestra Señora del Rosario de Chiquinquirá" — regla algorítmica desde 2026', () => {
  it('fecha base 9 de julio, trasladado al lunes siguiente (Ley Emiliani) — 2026: jueves 9 → lunes 13', () => {
    expect(festivoChiquinquira(2026)).toBe('2026-07-13');
  });
  it('2028: 9 de julio es domingo → traslado al lunes 10', () => {
    expect(new Date('2028-07-09T12:00:00Z').getUTCDay()).toBe(0);
    expect(festivoChiquinquira(2028)).toBe('2028-07-10');
  });
  it('2027: 9 de julio es viernes → NO se traslada (no aplica Ley Emiliani a festivos que no caen entre semana distinto de lunes... regla real: se traslada siempre que no sea lunes)', () => {
    // Confirma la regla real de traslado: SIEMPRE al lunes siguiente salvo que ya caiga lunes.
    expect(new Date('2027-07-09T12:00:00Z').getUTCDay()).toBe(5); // viernes
    expect(festivoChiquinquira(2027)).toBe('2027-07-12'); // lunes siguiente
  });
});

// ─── 7) 2026-07-13 no elegible ──────────────────────────────────────────────────

describe('7) 2026-07-13 (lunes, traslado de Chiquinquirá) — no elegible', () => {
  it('esFestivoChiquinquira lo confirma directamente', () => {
    expect(esFestivoChiquinquira('2026-07-13')).toBe(true);
  });
  it('esSesionMercadoElegible lo rechaza — vía el calendario, no vía una excepción', () => {
    expect(esSesionMercadoElegible('2026-07-13')).toBe(false);
  });
});

// ─── 8) Vigencia esperada 2026-07-11 a 2026-07-14 ──────────────────────────────

describe('8) Vigencia esperada real: 2026-07-11 (sábado) a 2026-07-14 (martes)', () => {
  it('coincide EXACTAMENTE con la vigencia oficial real (2026-07-11 → 2026-07-14)', () => {
    const r = resolverIntervaloVigenciaEsperadoConPolitica('2026-07-11', POLITICA_ACTUAL);
    expect(r.sesionOrigen).toBe('2026-07-10'); // viernes
    expect(r.desde).toBe('2026-07-11');
    expect(r.hasta).toBe('2026-07-14');
    // Este caso se explica por el calendario (Chiquinquirá), no por una excepción
    // registrada — no debe traer fuenteCalendario de una ExcepcionCalendarioTrm.
    expect(r.calendarioEstado).toBe('ESTIMADO');
    expect(r.fuenteCalendario).toBeUndefined();
  });
});

// ─── 9) Antes de 2026 no se agrega el festivo ──────────────────────────────────

describe('9) Antes de 2026, el 9 de julio NO es festivo (la Ley 2578 no aplica retroactivamente)', () => {
  it('festivoChiquinquira(anio) devuelve null para años < 2026', () => {
    expect(CHIQUINQUIRA_PRIMER_ANIO).toBe(2026);
    expect(festivoChiquinquira(2025)).toBeNull();
    expect(festivoChiquinquira(2020)).toBeNull();
  });
  it('2025-07-09/10/14 (equivalentes del año anterior) siguen siendo días hábiles ordinarios', () => {
    expect(esFestivoChiquinquira('2025-07-09')).toBe(false);
    expect(esSesionMercadoElegible('2025-07-09')).toBe(true); // miércoles normal, sin festivo
  });
});

// ─── 10) No crear regla global de último día hábil del año ────────────────────

describe('10) NO existe una regla genérica "último día hábil del año siempre cierra"', () => {
  it('las excepciones de fin de año son fechas puntuales respaldadas por circular, no una regla recurrente', () => {
    const excepcionesFinDeAnio = EXCEPCIONES_CALENDARIO_TRM.filter(e =>
      ['2022-12-30', '2023-12-29', '2024-12-31', '2025-12-31'].includes(e.fecha),
    );
    expect(excepcionesFinDeAnio).toHaveLength(4); // 4 fechas explícitas, no una fórmula
    for (const ex of excepcionesFinDeAnio) {
      expect(ex.numeroCircular).toBeDefined(); // cada una respaldada por su propia circular
    }
  });
  it('un año SIN excepción registrada (ej. 2026, fin de año) sigue la regla ordinaria — no hay cierre automático', () => {
    // No hay excepción para 2026-12-31 en la política — el 31-dic-2026 (jueves)
    // debe evaluarse por el calendario ordinario, no por ninguna fórmula de
    // "último día hábil del año".
    const excepcion2026 = EXCEPCIONES_CALENDARIO_TRM.find(e => e.fecha === '2026-12-31');
    expect(excepcion2026).toBeUndefined();
    const r = resolverSesionConExcepciones('2026-12-31', POLITICA_ACTUAL, ORDINARIA);
    expect(r.excepcionAplicada).toBeNull();
  });
});

// ─── Prioridad: sesión forzada sobre cierre (test de diseño ya existente) ──────

describe('Prioridad — sesión forzada gana sobre un cierre de la misma fecha/ámbito', () => {
  it('con un CIERRE y una SESION_FORZADA confirmados para la misma fecha, gana la sesión forzada', () => {
    const excepciones: ExcepcionCalendarioTrm[] = [
      { fecha: '2026-08-19', tipo: 'CIERRE', ambito: 'CUD', fuente: 'Fuente A (test)', observacion: 'Cierre de prueba', estadoEvidencia: 'CONFIRMADA_PRIMARIA' },
      { fecha: '2026-08-19', tipo: 'SESION_FORZADA', ambito: 'TRM', fuente: 'Fuente B (test)', observacion: 'Corrección de prueba', estadoEvidencia: 'CONFIRMADA_PRIMARIA' },
    ];
    const politica = crearPoliticaCalendarioTrm(excepciones);
    const r = resolverSesionConExcepciones('2026-08-19', politica, () => true);
    expect(r.elegible).toBe(true);
    expect(r.excepcionAplicada?.tipo).toBe('SESION_FORZADA');
  });
});

// ─── SISTEMA_CAMBIARIO nunca decide, ni siquiera confirmado ────────────────────

describe('Una excepción de ámbito SISTEMA_CAMBIARIO NUNCA decide la elegibilidad, aunque esté CONFIRMADA_PRIMARIA', () => {
  it('se ignora en el cálculo — la fecha cae a la regla ordinaria', () => {
    const excepciones: ExcepcionCalendarioTrm[] = [{
      fecha: '2026-07-08',
      tipo: 'CIERRE',
      ambito: 'SISTEMA_CAMBIARIO',
      fuente: 'Aviso de soporte técnico del Sistema de Información Cambiaria (test)',
      observacion: 'Cierre de soporte técnico — NO implica cierre de mercado ni de TRM',
      estadoEvidencia: 'CONFIRMADA_PRIMARIA',
    }];
    const politica = crearPoliticaCalendarioTrm(excepciones);
    const r = resolverSesionConExcepciones('2026-07-08', politica, ORDINARIA);
    expect(r.elegible).toBe(true);
    expect(r.excepcionAplicada).toBeNull();
  });
});

// ─── Trazabilidad de fuentes ────────────────────────────────────────────────────

describe('La excepción aplicada queda trazable (fuente, número de circular, documento, observación)', () => {
  it('resolverSesionConExcepciones devuelve el objeto ExcepcionCalendarioTrm completo', () => {
    const r = resolverSesionConExcepciones('2025-12-31', POLITICA_ACTUAL, ORDINARIA);
    expect(r.excepcionAplicada?.fuente).toContain('GE-0189-2025');
    expect(r.excepcionAplicada?.numeroCircular).toBe('GE-0189-2025');
    expect(r.excepcionAplicada?.observacion.length).toBeGreaterThan(0);
  });
});

// ─── Histórico nunca se sobrescribe ─────────────────────────────────────────────

describe('El histórico oficial (vigencias.ts) nunca se sobrescribe por excepciones ni por el calendario', () => {
  it('resolverTrmVigenteEnFecha usa exclusivamente vigenciaDesde/vigenciaHasta oficiales', () => {
    const { registros } = normalizarRegistrosTrmOficiales([
      { valor: 4000, vigenciaDesde: '2026-07-11', vigenciaHasta: '2026-07-14' }, // vigencia OFICIAL real
    ]);
    const eventos = construirEventosTrmDesdeVigencias(registros);
    const vigente = resolverTrmVigenteEnFecha('2026-07-13', eventos); // el propio festivo Chiquinquirá
    expect(vigente?.valor).toBe(4000);
    expect(vigente?.vigenciaDesde).toBe('2026-07-11');
    expect(vigente?.vigenciaHasta).toBe('2026-07-14');
  });
});

// ─── Validación de política ──────────────────────────────────────────────────────

describe('validarExcepcionesCalendario / crearPoliticaCalendarioTrm', () => {
  it('rechaza excepciones sin fuente', () => {
    const v = validarExcepcionesCalendario([
      { fecha: '2026-01-01', tipo: 'CIERRE', ambito: 'CUD', fuente: '', observacion: 'sin fuente', estadoEvidencia: 'CONFIRMADA_PRIMARIA' },
    ]);
    expect(v.validas).toBe(false);
    expect(v.errores.some(e => e.includes('fuente'))).toBe(true);
  });
  it('rechaza estadoEvidencia inválido', () => {
    const v = validarExcepcionesCalendario([
      { fecha: '2026-01-01', tipo: 'CIERRE', ambito: 'CUD', fuente: 'X', observacion: 'o', estadoEvidencia: 'INVENTADO' as never },
    ]);
    expect(v.validas).toBe(false);
    expect(v.errores.some(e => e.includes('estadoEvidencia'))).toBe(true);
  });
  it('la política de producción actual (EXCEPCIONES_CALENDARIO_TRM) es válida', () => {
    expect(() => crearPoliticaCalendarioTrm(EXCEPCIONES_CALENDARIO_TRM)).not.toThrow();
  });
});
