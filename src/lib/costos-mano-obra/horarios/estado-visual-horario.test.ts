import { describe, expect, it } from 'vitest';
import {
  ESTADO_HORARIO_DESCONOCIDO, PRESENTACION_ESTADO_HORARIO, presentarEstadoHorario,
} from './estado-visual-horario';
import type { EstadoNormalizacionHorario } from './tipos-normalizacion';

const TODOS_LOS_ESTADOS: EstadoNormalizacionHorario[] = [
  'NORMALIZADO', 'NORMALIZADO_CON_ADVERTENCIAS', 'DIFIERE_DE_DATOS_DECLARADOS',
  'REQUIERE_ASIGNAR_DIAS', 'REQUIERE_CONFIRMAR_ROTACION', 'REQUIERE_DETALLE_DESCANSO',
  'REQUIERE_UBICAR_DESCANSO', 'REQUIERE_CONFIRMAR_HORA', 'REQUIERE_CONFIRMAR_SEPARADORES',
  'REQUIERE_CONFIRMAR_CRUCE_MEDIANOCHE', 'POSIBLE_INTERCAMBIO_DE_CAMPOS',
  'HORARIO_COMPUESTO_PENDIENTE', 'HORARIO_NO_INTERPRETABLE',
];

describe('PRESENTACION_ESTADO_HORARIO — mapeo exhaustivo', () => {
  it('define presentación propia (no genérica) para cada uno de los 13 estados', () => {
    for (const estado of TODOS_LOS_ESTADOS) {
      const p = PRESENTACION_ESTADO_HORARIO[estado];
      expect(p).toBeDefined();
      expect(p.texto).not.toBe('Requiere revisión');
    }
  });

  it('textos exactos pedidos', () => {
    expect(PRESENTACION_ESTADO_HORARIO.NORMALIZADO.texto).toBe('Normalizado');
    expect(PRESENTACION_ESTADO_HORARIO.NORMALIZADO_CON_ADVERTENCIAS.texto).toBe('Con observaciones');
    expect(PRESENTACION_ESTADO_HORARIO.DIFIERE_DE_DATOS_DECLARADOS.texto).toBe('Difiere del dato declarado');
    expect(PRESENTACION_ESTADO_HORARIO.REQUIERE_ASIGNAR_DIAS.texto).toBe('Requiere asignar días');
    expect(PRESENTACION_ESTADO_HORARIO.REQUIERE_CONFIRMAR_ROTACION.texto).toBe('Requiere confirmar rotación');
    expect(PRESENTACION_ESTADO_HORARIO.REQUIERE_DETALLE_DESCANSO.texto).toBe('Requiere completar descanso');
    expect(PRESENTACION_ESTADO_HORARIO.REQUIERE_UBICAR_DESCANSO.texto).toBe('Requiere ubicar descanso');
    expect(PRESENTACION_ESTADO_HORARIO.REQUIERE_CONFIRMAR_HORA.texto).toBe('Requiere confirmar hora');
    expect(PRESENTACION_ESTADO_HORARIO.REQUIERE_CONFIRMAR_SEPARADORES.texto).toBe('Requiere confirmar formato');
    expect(PRESENTACION_ESTADO_HORARIO.REQUIERE_CONFIRMAR_CRUCE_MEDIANOCHE.texto).toBe('Requiere confirmar turno nocturno');
    expect(PRESENTACION_ESTADO_HORARIO.POSIBLE_INTERCAMBIO_DE_CAMPOS.texto).toBe('Posible error de campos');
    expect(PRESENTACION_ESTADO_HORARIO.HORARIO_COMPUESTO_PENDIENTE.texto).toBe('Requiere completar distribución');
    expect(PRESENTACION_ESTADO_HORARIO.HORARIO_NO_INTERPRETABLE.texto).toBe('No interpretable');
  });

  it('colores por categoría pedidos', () => {
    expect(PRESENTACION_ESTADO_HORARIO.NORMALIZADO.color).toBe('verde');
    expect(PRESENTACION_ESTADO_HORARIO.NORMALIZADO_CON_ADVERTENCIAS.color).toBe('amarillo');
    expect(PRESENTACION_ESTADO_HORARIO.DIFIERE_DE_DATOS_DECLARADOS.color).toBe('amarillo');
    expect(PRESENTACION_ESTADO_HORARIO.REQUIERE_ASIGNAR_DIAS.color).toBe('naranja');
    expect(PRESENTACION_ESTADO_HORARIO.REQUIERE_CONFIRMAR_ROTACION.color).toBe('naranja');
    expect(PRESENTACION_ESTADO_HORARIO.HORARIO_COMPUESTO_PENDIENTE.color).toBe('naranja');
    expect(PRESENTACION_ESTADO_HORARIO.POSIBLE_INTERCAMBIO_DE_CAMPOS.color).toBe('rojo');
    expect(PRESENTACION_ESTADO_HORARIO.HORARIO_NO_INTERPRETABLE.color).toBe('rojo');
  });

  it('presentarEstadoHorario nunca cae en "Requiere revisión" para un estado real conocido', () => {
    for (const estado of TODOS_LOS_ESTADOS) {
      expect(presentarEstadoHorario(estado).texto).not.toBe('Requiere revisión');
    }
  });

  it('presentarEstadoHorario SÍ usa "Requiere revisión" solo para un valor desconocido/corrupto', () => {
    expect(presentarEstadoHorario('ESTADO_QUE_NO_EXISTE')).toEqual(ESTADO_HORARIO_DESCONOCIDO);
    expect(presentarEstadoHorario(null)).toEqual(ESTADO_HORARIO_DESCONOCIDO);
    expect(presentarEstadoHorario(undefined)).toEqual(ESTADO_HORARIO_DESCONOCIDO);
    expect(presentarEstadoHorario('').texto).toBe('Requiere revisión');
  });
});