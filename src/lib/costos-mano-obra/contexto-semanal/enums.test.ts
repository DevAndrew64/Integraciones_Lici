import { describe, it, expect } from 'vitest';
import {
  MODALIDADES_DISTRIBUCION_JORNADA,
  REGIMENES_LABORALES,
  TIPOS_ASIGNACION_TRABAJADOR,
  TIPOS_DESCANSO_OBLIGATORIO,
  ESTADOS_CONTEXTO_SEMANAL,
  FUENTES_PROGRAMACION,
  TIPOS_EXCEPCION_PROGRAMACION,
  ESTADOS_CONFIRMACION,
  FUENTES_APLICADAS_SOBRETIEMPO,
} from './enums';

// Todos los arreglos de enums de este módulo, salvo RegimenLaboral (donde
// "GENERAL" es un valor de negocio legítimo, no un comodín/sentinela).
const ENUMS_SIN_COMODINES: { nombre: string; valores: readonly string[] }[] = [
  { nombre: 'ModalidadDistribucionJornada', valores: MODALIDADES_DISTRIBUCION_JORNADA },
  { nombre: 'TipoAsignacionTrabajador', valores: TIPOS_ASIGNACION_TRABAJADOR },
  { nombre: 'TipoDescansoObligatorio', valores: TIPOS_DESCANSO_OBLIGATORIO },
  { nombre: 'EstadoContextoSemanal', valores: ESTADOS_CONTEXTO_SEMANAL },
  { nombre: 'FuenteProgramacion', valores: FUENTES_PROGRAMACION },
  { nombre: 'TipoExcepcionProgramacion', valores: TIPOS_EXCEPCION_PROGRAMACION },
  { nombre: 'EstadoConfirmacion', valores: ESTADOS_CONFIRMACION },
  { nombre: 'FuenteAplicadaSobretiempo', valores: FUENTES_APLICADAS_SOBRETIEMPO },
];

describe('enums de dominio — existencia exacta de valores', () => {
  it('ModalidadDistribucionJornada contiene exactamente los 4 valores esperados', () => {
    expect(MODALIDADES_DISTRIBUCION_JORNADA).toEqual([
      'ESTANDAR', 'FLEXIBLE_ACORDADA', 'TURNOS_SUCESIVOS_ESPECIALES', 'REGIMEN_ESPECIAL',
    ]);
  });

  it('RegimenLaboral contiene GENERAL y VIGILANCIA_SEGURIDAD_PRIVADA, y solo esos dos', () => {
    expect(REGIMENES_LABORALES).toEqual(['GENERAL', 'VIGILANCIA_SEGURIDAD_PRIVADA']);
    expect(REGIMENES_LABORALES).toHaveLength(2);
  });

  it('TipoAsignacionTrabajador contiene exactamente los 8 valores esperados', () => {
    expect(TIPOS_ASIGNACION_TRABAJADOR).toEqual([
      'TURNO_ORDINARIO', 'RELEVO', 'COBERTURA_DESCANSO', 'REEMPLAZO',
      'TURNO_ADICIONAL', 'DESCANSO', 'AUSENCIA', 'FESTIVO_NO_LABORADO',
    ]);
  });

  it('TipoDescansoObligatorio contiene exactamente los 4 valores esperados', () => {
    expect(TIPOS_DESCANSO_OBLIGATORIO).toEqual(['FIJO', 'ROTATIVO', 'EXCEPCIONAL', 'PENDIENTE_CONFIRMACION']);
  });

  it('EstadoContextoSemanal contiene exactamente los 6 estados definidos', () => {
    expect(ESTADOS_CONTEXTO_SEMANAL).toEqual([
      'COMPLETO', 'REQUIERE_CONTEXTO_ANTERIOR', 'REQUIERE_PROGRAMACION_DIARIA',
      'INCONSISTENTE', 'BLOQUEADO_POR_PARAMETROS', 'LISTO_PARA_CLASIFICAR',
    ]);
    expect(ESTADOS_CONTEXTO_SEMANAL).toHaveLength(6);
  });

  it('FuenteProgramacion contiene exactamente los 7 valores esperados', () => {
    expect(FUENTES_PROGRAMACION).toEqual([
      'REGLA_SEMANAL', 'EXCEPCION_FECHA', 'MATRIZ_TURNO', 'COBERTURA_DESCANSO',
      'AJUSTE_MANUAL', 'API_TURNOS', 'REGULARIZACION_MANUAL',
    ]);
  });

  it('TipoExcepcionProgramacion contiene exactamente los 9 valores esperados', () => {
    expect(TIPOS_EXCEPCION_PROGRAMACION).toEqual([
      'CAMBIO_TURNO', 'DESCANSO_EXCEPCIONAL', 'TRABAJO_ADICIONAL', 'REEMPLAZO',
      'AUSENCIA', 'INCAPACIDAD', 'FESTIVO_NO_LABORADO', 'COBERTURA', 'AJUSTE_CONFIRMADO',
    ]);
  });

  it('EstadoConfirmacion contiene exactamente los 3 valores esperados', () => {
    expect(ESTADOS_CONFIRMACION).toEqual(['PENDIENTE', 'CONFIRMADO', 'RECHAZADO']);
  });

  it('FuenteAplicadaSobretiempo tiene exactamente cuatro valores', () => {
    expect(FUENTES_APLICADAS_SOBRETIEMPO).toEqual(['AUTOMATICO', 'MATRIZ_TURNO', 'COBERTURA_DESCANSO', 'AJUSTE_EXCEPCIONAL']);
    expect(FUENTES_APLICADAS_SOBRETIEMPO).toHaveLength(4);
  });
});

describe('enums de dominio — ausencia de valores comodín/sentinela', () => {
  for (const { nombre, valores } of ENUMS_SIN_COMODINES) {
    it(`${nombre} no contiene UNKNOWN, DEFAULT ni GENERAL como valor comodín`, () => {
      expect(valores).not.toContain('UNKNOWN');
      expect(valores).not.toContain('DEFAULT');
      expect(valores).not.toContain('GENERAL');
    });
  }

  it('RegimenLaboral SÍ contiene GENERAL, pero como valor de negocio legítimo (régimen), no como comodín', () => {
    expect(REGIMENES_LABORALES).toContain('GENERAL');
    // Confirmación explícita de que es una decisión de dominio, no un sentinela:
    // el único otro valor es un régimen igualmente concreto, nunca "OTRO" ni "SIN_DEFINIR".
    expect(REGIMENES_LABORALES).not.toContain('SIN_DEFINIR');
    expect(REGIMENES_LABORALES).not.toContain('OTRO');
  });
});
