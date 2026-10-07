import { describe, it, expect, beforeEach } from 'vitest';
import { resolverParametro, resolverCatalogoCompleto } from './resolver-parametros';
import { crearPerfilEmpresarial, crearAjusteProceso, restaurarValorNormativo, reiniciarHistorialMock, listarAuditoria } from './historial-mock';
import { CATALOGO_PARAMETROS } from './catalogo-parametros';

describe('resolverParametro — precedencia de 3 niveles', () => {
  beforeEach(() => reiniciarHistorialMock());

  it('sin ajustes/empresarial, usa el perfil normativo vigente', () => {
    const r = resolverParametro('jornada.semanalMaxima', { fecha: '2026-07-20' });
    expect(r.valor).toBe(42);
    expect(r.origen).toBe('NORMATIVO');
  });

  it('fecha anterior a la vigencia normativa cae al valor técnico de respaldo', () => {
    const r = resolverParametro('jornada.semanalMaxima', { fecha: '2020-01-01' });
    expect(r.origen).toBe('TECNICO_RESPALDO');
    expect(r.valor).toBe(42);
  });

  it('perfil empresarial vigente tiene precedencia sobre el normativo', () => {
    crearPerfilEmpresarial({
      parametroId: 'seguridadSocial.porcentajeSalud',
      empresa: 'ASEOCOLBA',
      valorAplicado: 9,
      fechaInicial: '2026-01-01',
      motivo: 'Ajuste piloto de prueba',
      creadoPor: 'analista1',
      rol: 'ADMINISTRADOR_PARAMETROS',
    });
    const r = resolverParametro('seguridadSocial.porcentajeSalud', { fecha: '2026-07-20', empresa: 'ASEOCOLBA' });
    expect(r.valor).toBe(9);
    expect(r.origen).toBe('EMPRESARIAL');
  });

  it('empresa distinta no hereda el perfil empresarial de otra empresa', () => {
    crearPerfilEmpresarial({
      parametroId: 'seguridadSocial.porcentajeSalud',
      empresa: 'ASEOCOLBA',
      valorAplicado: 9,
      fechaInicial: '2026-01-01',
      motivo: 'Ajuste piloto',
      creadoPor: 'analista1',
      rol: 'ADMINISTRADOR_PARAMETROS',
    });
    const r = resolverParametro('seguridadSocial.porcentajeSalud', { fecha: '2026-07-20', empresa: 'VIGICOLBA' });
    expect(r.origen).toBe('NORMATIVO');
    expect(r.valor).toBe(0.085);
  });

  it('ajuste de proceso tiene precedencia sobre empresarial y normativo', () => {
    crearPerfilEmpresarial({
      parametroId: 'seguridadSocial.porcentajeSalud',
      empresa: 'ASEOCOLBA',
      valorAplicado: 9,
      fechaInicial: '2026-01-01',
      motivo: 'Ajuste piloto',
      creadoPor: 'analista1',
      rol: 'ADMINISTRADOR_PARAMETROS',
    });
    crearAjusteProceso({
      parametroId: 'seguridadSocial.porcentajeSalud',
      procesoId: 'proceso-777',
      valorAplicado: 11,
      motivo: 'Excepción puntual de este costeo',
      responsable: 'analista2',
      rol: 'ANALISTA',
    });
    const r = resolverParametro('seguridadSocial.porcentajeSalud', {
      fecha: '2026-07-20',
      empresa: 'ASEOCOLBA',
      procesoId: 'proceso-777',
    });
    expect(r.valor).toBe(11);
    expect(r.origen).toBe('AJUSTE_PROCESO');
  });

  it('ajuste de proceso de OTRO proceso no interfiere', () => {
    crearAjusteProceso({
      parametroId: 'seguridadSocial.porcentajePension',
      procesoId: 'proceso-A',
      valorAplicado: 99,
      motivo: 'x',
      responsable: 'analista2',
      rol: 'ANALISTA',
    });
    const r = resolverParametro('seguridadSocial.porcentajePension', { fecha: '2026-07-20', procesoId: 'proceso-B' });
    expect(r.origen).toBe('NORMATIVO');
    expect(r.valor).toBe(0.12);
  });

  it('restaurar valor normativo cierra el perfil empresarial (no lo borra) y el resolver vuelve al normativo para fechas posteriores al cierre', () => {
    crearPerfilEmpresarial({
      parametroId: 'seguridadSocial.porcentajeSalud',
      empresa: 'ASEOCOLBA',
      valorAplicado: 9,
      fechaInicial: '2026-01-01',
      motivo: 'Ajuste piloto',
      creadoPor: 'analista1',
      rol: 'ADMINISTRADOR_PARAMETROS',
    });
    const cerrados = restaurarValorNormativo(
      'seguridadSocial.porcentajeSalud',
      'ASEOCOLBA',
      'admin1',
      'ADMINISTRADOR_PARAMETROS',
    );
    expect(cerrados).toHaveLength(1);
    expect(cerrados[0].fechaFinal).not.toBeNull();
    // Fecha muy posterior al cierre real (hecho "ahora") — más allá de
    // cualquier fechaFinal posible, para no depender de la fecha del reloj.
    const r = resolverParametro('seguridadSocial.porcentajeSalud', {
      fecha: '2099-01-01',
      empresa: 'ASEOCOLBA',
    });
    expect(r.origen).toBe('NORMATIVO');
    expect(listarAuditoria('seguridadSocial.porcentajeSalud').some((a) => a.accion === 'RESTAURAR_VALOR_NORMATIVO')).toBe(true);
  });

  it('perfil empresarial fuera de su rango de fechas no aplica', () => {
    crearPerfilEmpresarial({
      parametroId: 'seguridadSocial.porcentajePension',
      empresa: 'ASEOCOLBA',
      valorAplicado: 15,
      fechaInicial: '2026-01-01',
      motivo: 'x',
      creadoPor: 'a',
      rol: 'ADMINISTRADOR_PARAMETROS',
    });
    // cerrarlo manualmente vía restaurar y confirmar que una fecha posterior al cierre no lo usa
    const [cerrado] = restaurarValorNormativo('seguridadSocial.porcentajePension', 'ASEOCOLBA', 'a', 'ADMINISTRADOR_PARAMETROS');
    const r = resolverParametro('seguridadSocial.porcentajePension', {
      fecha: cerrado.fechaFinal as string,
      empresa: 'ASEOCOLBA',
    });
    expect(r.origen).toBe('NORMATIVO');
  });

  describe('valores derivados — nunca editables sueltos, siempre calculados', () => {
    it('extraFestivaDiurna = recargoDescansoObligatorio + extraDiurna', () => {
      const r = resolverParametro('jornada.extraFestivaDiurna', { fecha: '2026-07-20' });
      expect(r.valor).toBeCloseTo(0.9 + 0.25, 10);
      expect(r.origen).toBe('DERIVADO_AUTOMATICO');
    });

    it('extraFestivaNocturna = recargoDescansoObligatorio + extraNocturna', () => {
      const r = resolverParametro('jornada.extraFestivaNocturna', { fecha: '2026-07-20' });
      expect(r.valor).toBeCloseTo(0.9 + 0.75, 10);
    });

    it('recargoNocturnoFestivo = recargoDescansoObligatorio + recargoNocturno', () => {
      const r = resolverParametro('jornada.recargoNocturnoFestivo', { fecha: '2026-07-20' });
      expect(r.valor).toBeCloseTo(0.9 + 0.35, 10);
    });

    it('un ajuste empresarial sobre recargoDescansoObligatorio se propaga a los 3 derivados', () => {
      crearPerfilEmpresarial({
        parametroId: 'jornada.recargoDescansoObligatorio',
        empresa: 'ASEOCOLBA',
        valorAplicado: 1.0,
        fechaInicial: '2026-01-01',
        motivo: 'Anticipación voluntaria del tramo 100%',
        creadoPor: 'admin1',
        rol: 'ADMINISTRADOR_PARAMETROS',
      });
      const ctx = { fecha: '2026-07-20', empresa: 'ASEOCOLBA' };
      expect(resolverParametro('jornada.extraFestivaDiurna', ctx).valor).toBeCloseTo(1.0 + 0.25, 10);
      expect(resolverParametro('jornada.extraFestivaNocturna', ctx).valor).toBeCloseTo(1.0 + 0.75, 10);
      expect(resolverParametro('jornada.recargoNocturnoFestivo', ctx).valor).toBeCloseTo(1.0 + 0.35, 10);
    });
  });

  it('parámetro desconocido lanza error explícito, nunca retorna un valor inventado', () => {
    expect(() => resolverParametro('no.existe', { fecha: '2026-07-20' })).toThrow(/desconocido/);
  });

  it('resolverCatalogoCompleto resuelve todos los parámetros no derivados-de-texto del catálogo', () => {
    const resultados = resolverCatalogoCompleto({ fecha: '2026-07-20' });
    const idsCatalogo = CATALOGO_PARAMETROS.filter((p) => p.unidad !== 'TEXTO').map((p) => p.id);
    expect(resultados.map((r) => r.parametroId).sort()).toEqual(idsCatalogo.sort());
    resultados.forEach((r) => expect(typeof r.valor).toBe('number'));
  });
});