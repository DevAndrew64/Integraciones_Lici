import { describe, expect, it } from 'vitest';
import { formatearResumenSujetoDotEpp } from './resumen-sujeto-dotacion';
import type { DistribucionHorarioConfigurada } from './tipos';

function distribucion(over: Partial<DistribucionHorarioConfigurada> = {}): DistribucionHorarioConfigurada {
  return {
    idCliente: 'd1', empresa: '', codigo: '', horario: '', jornada: '', turno: '',
    diasSemana: ['M', 'X', 'J', 'V', 'S', 'D'], bloques: [{ inicio: '07:00', fin: '14:00', orden: 0 }],
    excepcionesFecha: [], sincronizadoExterno: false,
    ...over,
  };
}

describe('formatearResumenSujetoDotEpp — caso real ASEADOR/SUPERVISOR', () => {
  it('1) ASEADOR (1 distribución con días y bloques) muestra días y franja horaria', () => {
    const texto = formatearResumenSujetoDotEpp(1, [distribucion()]);
    expect(texto).toBe('1 trabajador · Martes a Domingo · 07:00-14:00');
  });

  it('2) SUPERVISOR con distribución HORARIO_DETALLADO propia (lunes a viernes 08:00-17:00) muestra días y franja horaria', () => {
    const texto = formatearResumenSujetoDotEpp(1, [distribucion({ diasSemana: ['L', 'M', 'X', 'J', 'V'], bloques: [{ inicio: '08:00', fin: '17:00', orden: 0 }] })]);
    expect(texto).toBe('1 trabajador · Lunes a Viernes · 08:00-17:00');
  });

  it('3) dos cargos con estructuras de horario distintas (bloque único vs. partido) se formatean cada uno', () => {
    const aseador = formatearResumenSujetoDotEpp(1, [distribucion()]);
    const conPartido = formatearResumenSujetoDotEpp(1, [distribucion({ bloques: [{ inicio: '08:00', fin: '12:00', orden: 0 }, { inicio: '14:00', fin: '18:00', orden: 1 }] })]);
    expect(aseador).not.toBe(conPartido);
  });

  it('4) un horario partido muestra ambas franjas', () => {
    const texto = formatearResumenSujetoDotEpp(1, [distribucion({ diasSemana: ['L', 'M', 'X', 'J', 'V'], bloques: [{ inicio: '08:00', fin: '12:00', orden: 0 }, { inicio: '14:00', fin: '18:00', orden: 1 }] })]);
    expect(texto).toBe('1 trabajador · Lunes a Viernes · 08:00-12:00 / 14:00-18:00');
  });

  it('5) varios horarios se muestran de forma legible (conteo, no el detalle completo en el resumen compacto)', () => {
    const texto = formatearResumenSujetoDotEpp(2, [distribucion(), distribucion({ diasSemana: ['L'], bloques: [{ inicio: '08:00', fin: '12:00', orden: 0 }] })]);
    expect(texto).toBe('2 trabajadores · 2 horarios');
  });

  it('6) SUPERVISOR sin programación real (distribución sin días ni bloques) muestra "Horario no definido", no un texto vacío', () => {
    const texto = formatearResumenSujetoDotEpp(1, [distribucion({ diasSemana: [], bloques: [] })]);
    expect(texto).toBe('1 trabajador · Horario no definido');
  });

  it('6b) sin ninguna distribución (arreglo vacío) también muestra "Horario no definido"', () => {
    const texto = formatearResumenSujetoDotEpp(1, []);
    expect(texto).toBe('1 trabajador · Horario no definido');
  });

  it('7) nunca aparece un separador final "·" suelto, con o sin programación', () => {
    for (const distribuciones of [[], [distribucion()], [distribucion({ diasSemana: [], bloques: [] })], [distribucion(), distribucion()]]) {
      const texto = formatearResumenSujetoDotEpp(1, distribuciones);
      expect(texto.trim().endsWith('·')).toBe(false);
      expect(texto).not.toContain('· ·');
      expect(texto).not.toMatch(/·\s*$/);
    }
  });

  it('total de trabajadores singular/plural correcto junto al horario', () => {
    expect(formatearResumenSujetoDotEpp(1, [distribucion()])).toContain('1 trabajador ·');
    expect(formatearResumenSujetoDotEpp(3, [distribucion()])).toContain('3 trabajadores ·');
  });
});

describe('formatearResumenSujetoDotEpp — corrección "PROGRAMACIÓN POR HORAS" (segundo ASEADOR, TOTAL_SEMANAL)', () => {
  function distribucionPorHoras(horas: number): DistribucionHorarioConfigurada {
    return {
      idCliente: 'd-horas', empresa: '', codigo: '', horario: '', jornada: '', turno: '',
      diasSemana: [], bloques: [], excepcionesFecha: [], sincronizadoExterno: false,
      tipoCapturaHorario: 'TOTAL_SEMANAL', horasSemanalesManual: horas, distribucionInferida: false,
    };
  }

  it('6/9) un cargo "Por horas" (21 h semanales) muestra "Programación por horas · 21 h semanales", nunca "Horario no definido"', () => {
    const texto = formatearResumenSujetoDotEpp(1, [distribucionPorHoras(21)]);
    expect(texto).toBe('1 trabajador · Programación por horas · 21 h semanales');
  });

  it('7) no inventa días, hora de inicio ni hora final para la modalidad por horas', () => {
    const texto = formatearResumenSujetoDotEpp(1, [distribucionPorHoras(21)]);
    expect(texto).not.toMatch(/Lunes|Martes|Miércoles|Jueves|Viernes|Sábado|Domingo/);
    expect(texto).not.toMatch(/\d{2}:\d{2}/);
  });

  it('5) prioridad 1 — si además existe programación detallada por días/franjas en OTRA distribución, esa se muestra (caso de varios horarios)', () => {
    const texto = formatearResumenSujetoDotEpp(1, [distribucion(), distribucionPorHoras(21)]);
    expect(texto).toBe('1 trabajador · 2 horarios');
  });

  it('8) un cargo realmente sin programación (TOTAL_SEMANAL sin horasSemanalesManual) muestra "Horario no definido"', () => {
    const texto = formatearResumenSujetoDotEpp(1, [{ ...distribucionPorHoras(0), horasSemanalesManual: undefined }]);
    expect(texto).toBe('1 trabajador · Horario no definido');
  });

  it('nunca aparece un separador final "·" para la modalidad por horas', () => {
    const texto = formatearResumenSujetoDotEpp(1, [distribucionPorHoras(21)]);
    expect(texto).not.toMatch(/·\s*$/);
  });

  it('formatea horas decimales sin ceros sobrantes (21 h, no 21.00 h)', () => {
    expect(formatearResumenSujetoDotEpp(1, [distribucionPorHoras(21)])).toContain('21 h semanales');
    expect(formatearResumenSujetoDotEpp(1, [distribucionPorHoras(21.5)])).toContain('21,5 h semanales');
  });
});
