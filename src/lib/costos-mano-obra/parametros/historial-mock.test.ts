import { describe, it, expect, beforeEach } from 'vitest';
import {
  crearPerfilEmpresarial,
  crearAjusteProceso,
  restaurarValorNormativo,
  listarPerfilesEmpresariales,
  listarAjustesProceso,
  listarAuditoria,
  reiniciarHistorialMock,
} from './historial-mock';

describe('historial-mock — nunca sobreescribe, nunca borra', () => {
  beforeEach(() => reiniciarHistorialMock());

  it('crear perfil empresarial agrega, no reemplaza uno previo del mismo parámetro/empresa', () => {
    crearPerfilEmpresarial({
      parametroId: 'seguridadSocial.porcentajeSalud',
      empresa: 'ASEOCOLBA',
      valorAplicado: 9,
      fechaInicial: '2026-01-01',
      motivo: 'primero',
      creadoPor: 'a',
      rol: 'ADMINISTRADOR_PARAMETROS',
    });
    crearPerfilEmpresarial({
      parametroId: 'seguridadSocial.porcentajeSalud',
      empresa: 'ASEOCOLBA',
      valorAplicado: 10,
      fechaInicial: '2026-06-01',
      motivo: 'segundo',
      creadoPor: 'a',
      rol: 'ADMINISTRADOR_PARAMETROS',
    });
    expect(listarPerfilesEmpresariales('seguridadSocial.porcentajeSalud')).toHaveLength(2);
  });

  it('restaurarValorNormativo cierra (fechaFinal) sin reducir el conteo de perfiles', () => {
    crearPerfilEmpresarial({
      parametroId: 'seguridadSocial.porcentajePension',
      empresa: 'VIGICOLBA',
      valorAplicado: 13,
      fechaInicial: '2026-01-01',
      motivo: 'x',
      creadoPor: 'a',
      rol: 'ADMINISTRADOR_PARAMETROS',
    });
    restaurarValorNormativo('seguridadSocial.porcentajePension', 'VIGICOLBA', 'a', 'ADMINISTRADOR_PARAMETROS');
    const perfiles = listarPerfilesEmpresariales('seguridadSocial.porcentajePension');
    expect(perfiles).toHaveLength(1);
    expect(perfiles[0].fechaFinal).not.toBeNull();
  });

  it('restaurarValorNormativo sin perfil vigente no registra auditoría ni lanza error', () => {
    const cerrados = restaurarValorNormativo('seguridadSocial.porcentajePension', 'EMPRESA_SIN_AJUSTES', 'a', 'ADMINISTRADOR_PARAMETROS');
    expect(cerrados).toHaveLength(0);
    expect(listarAuditoria('seguridadSocial.porcentajePension')).toHaveLength(0);
  });

  it('crearAjusteProceso agrega un ajuste independiente del historial empresarial', () => {
    crearAjusteProceso({
      parametroId: 'bonosIbc.limitePagosNoSalariales',
      procesoId: 'proc-1',
      valorAplicado: 0.35,
      motivo: 'Excepción de este proceso',
      responsable: 'r1',
      rol: 'ANALISTA',
    });
    expect(listarAjustesProceso('bonosIbc.limitePagosNoSalariales')).toHaveLength(1);
    expect(listarPerfilesEmpresariales('bonosIbc.limitePagosNoSalariales')).toHaveLength(0);
  });

  it('cada creación de perfil/ajuste deja una entrada de auditoría trazable', () => {
    crearPerfilEmpresarial({
      parametroId: 'parafiscales.porcentajeCaja',
      empresa: 'ASEOCOLBA',
      valorAplicado: 4.5,
      fechaInicial: '2026-01-01',
      motivo: 'x',
      creadoPor: 'admin1',
      rol: 'ADMINISTRADOR_PARAMETROS',
    });
    const auditoria = listarAuditoria('parafiscales.porcentajeCaja');
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0].accion).toBe('CREAR_AJUSTE_EMPRESARIAL');
    expect(auditoria[0].usuario).toBe('admin1');
  });

  it('reiniciarHistorialMock limpia todo (solo para pruebas/reinicio del prototipo)', () => {
    crearAjusteProceso({
      parametroId: 'bonosIbc.limitePagosNoSalariales',
      procesoId: 'proc-2',
      valorAplicado: 0.4,
      motivo: 'x',
      responsable: 'r1',
      rol: 'ANALISTA',
    });
    reiniciarHistorialMock();
    expect(listarAjustesProceso()).toHaveLength(0);
    expect(listarPerfilesEmpresariales()).toHaveLength(0);
    expect(listarAuditoria()).toHaveLength(0);
  });
});