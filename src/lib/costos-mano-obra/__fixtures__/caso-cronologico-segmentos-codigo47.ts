/**
 * FIXTURE — ESPECIFICACIÓN CRONOLÓGICA OBJETIVA (posición en el reloj).
 * NO DECIDE TODAVÍA ORDINARIA/EXTRA.
 *
 * Datos literales, escritos a mano a partir de la línea de tiempo real
 * del horario "05:00-11:00 Y 13:00-14:20" (código 47), verificados
 * manualmente durante la auditoría (Addendum Bloque 0.2 §2-3). Estos
 * valores NO se derivan llamando a segmentador-cronologico-referencia.ts
 * — son el resultado esperado independiente que la prueba de
 * especificación usa para verificar esa utilidad (evita que la prueba
 * valide su propia implementación).
 */

export const CASO_CRONOLOGICO_SEGMENTOS_47 = {
  etiqueta: 'ESPECIFICACIÓN CRONOLÓGICA OBJETIVA — NO DECIDE ORDINARIA/EXTRA' as const,

  entrada: {
    fecha: '2026-07-25', // sábado — el mismo caso se reutiliza con '2026-07-26' (domingo) en el fixture de hipótesis diaria
    bloques: [
      { inicio: '05:00', fin: '11:00' },
      { inicio: '13:00', fin: '14:20' },
    ],
    horaInicioNocturna: '19:00',
    horaFinNocturna: '06:00',
  },

  segmentosEsperados: [
    { fecha: '2026-07-25', inicio: '05:00', fin: '06:00', minutos: 60, franja: 'NOCTURNA' as const },
    { fecha: '2026-07-25', inicio: '06:00', fin: '11:00', minutos: 300, franja: 'DIURNA' as const },
    { fecha: '2026-07-25', inicio: '13:00', fin: '14:20', minutos: 80, franja: 'DIURNA' as const },
  ],

  totalesEsperados: {
    minutosTrabajados: 440,
    minutosNocturnos: 60,
    minutosDiurnos: 380,
    descansoEntreBloquesMinutos: 120, // 11:00-13:00, informativo — no es un segmento trabajado
    minutosExtra: 'NO_DETERMINADO' as const, // decisión pendiente — ver fixtures de hipótesis
  },
} as const;
