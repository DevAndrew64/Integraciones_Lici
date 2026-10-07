import { describe, it, expect } from 'vitest';
import { CATALOGO_PARAMETROS, PERFILES_NORMATIVOS_SEMILLA, obtenerDefinicionParametro, VERSION_CATALOGO } from './catalogo-parametros';

describe('catalogo-parametros', () => {
  it('cubre los 9 grupos exigidos por el usuario', () => {
    const grupos = new Set(CATALOGO_PARAMETROS.map((p) => p.grupo));
    expect(grupos).toEqual(
      new Set([
        'JORNADA_Y_RECARGOS',
        'MENSUALIZACION_COMERCIAL',
        'SEGURIDAD_SOCIAL',
        'RIESGOS_LABORALES',
        'PARAFISCALES',
        'PRESTACIONES_SOCIALES',
        'BONOS_E_IBC',
        'REDONDEO_Y_PRECISION',
        'HISTORIAL_Y_VIGENCIAS',
      ]),
    );
  });

  it('ids únicos, sin duplicados', () => {
    const ids = CATALOGO_PARAMETROS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('todo parámetro derivado trae fórmula legible y ningún perfil normativo propio', () => {
    const derivados = CATALOGO_PARAMETROS.filter((p) => p.derivadoAutomaticamente);
    expect(derivados.length).toBe(3);
    derivados.forEach((d) => {
      expect(d.formulaDerivacion).toBeTruthy();
      expect(PERFILES_NORMATIVOS_SEMILLA.some((pn) => pn.parametroId === d.id)).toBe(false);
    });
  });

  it('obtenerDefinicionParametro encuentra y no-encuentra correctamente', () => {
    expect(obtenerDefinicionParametro('jornada.semanalMaxima')?.valorTecnicoRespaldo).toBe(42);
    expect(obtenerDefinicionParametro('no.existe')).toBeUndefined();
  });

  it('valores vigentes julio 2026 confirmados por el usuario', () => {
    const jornada = obtenerDefinicionParametro('jornada.semanalMaxima')!;
    const nocturnoInicio = obtenerDefinicionParametro('jornada.horaInicioNocturno')!;
    const nocturnoFin = obtenerDefinicionParametro('jornada.horaFinNocturno')!;
    const recargoNocturno = obtenerDefinicionParametro('jornada.recargoNocturno')!;
    const extraDiurna = obtenerDefinicionParametro('jornada.extraDiurna')!;
    const extraNocturna = obtenerDefinicionParametro('jornada.extraNocturna')!;
    const recargoFestivo = obtenerDefinicionParametro('jornada.recargoDescansoObligatorio')!;
    expect(jornada.valorTecnicoRespaldo).toBe(42);
    expect(nocturnoInicio.valorTecnicoRespaldo).toBe(19);
    expect(nocturnoFin.valorTecnicoRespaldo).toBe(6);
    expect(recargoNocturno.valorTecnicoRespaldo).toBe(0.35);
    expect(extraDiurna.valorTecnicoRespaldo).toBe(0.25);
    expect(extraNocturna.valorTecnicoRespaldo).toBe(0.75);
    expect(recargoFestivo.valorTecnicoRespaldo).toBe(0.9);
  });

  it('cada perfil normativo semilla referencia un id existente en el catálogo', () => {
    const ids = new Set(CATALOGO_PARAMETROS.map((p) => p.id));
    PERFILES_NORMATIVOS_SEMILLA.forEach((pn) => expect(ids.has(pn.parametroId)).toBe(true));
  });

  it('VERSION_CATALOGO es una marca de versión estable y no vacía', () => {
    expect(VERSION_CATALOGO).toMatch(/^parametros-v\d/);
  });
});