/**
 * FIXTURE — HIPÓTESIS DE TOPE DIARIO.
 * NO ES REGLA FUNCIONAL APROBADA.
 *
 * Aplica la Hipótesis A (jornada ordinaria = tope diario fijo, aquí
 * 420 min = 7h, tramo vigente post 15/07/2026) sobre los segmentos
 * OBJETIVOS de caso-cronologico-segmentos-codigo47.ts — nunca reescribe
 * esos segmentos a mano, los importa, para que un cambio en la
 * especificación cronológica se propague aquí automáticamente.
 *
 * Esta hipótesis compite con la Hipótesis B (presupuesto semanal, ver
 * caso-cronologico-presupuesto-semanal-codigo47.ts). Ninguna de las dos
 * está aprobada — ver "Decisión funcional requerida antes de implementar
 * el motor corregido", preguntas 1-4, en el Bloque 0.3.
 */

import { CASO_CRONOLOGICO_SEGMENTOS_47 } from './caso-cronologico-segmentos-codigo47';

export const CASO_CRONOLOGICO_TOPE_DIARIO_47 = {
  etiqueta: 'HIPÓTESIS DE TOPE DIARIO. NO ES REGLA FUNCIONAL APROBADA.' as const,
  estadoAprobacion: 'HIPOTESIS_NO_APROBADA' as const,

  hipotesis: {
    limiteOrdinarioDiarioMinutos: 420, // 7h — tramo vigente para 25-26/07/2026 (post 15/07/2026)
    descripcion:
      'La jornada ordinaria se agota cronológicamente día a día, consumiendo el ' +
      'tope de 420 min en el orden real de los segmentos trabajados (segmentos ' +
      'importados de caso-cronologico-segmentos-codigo47.ts).',
  },

  segmentosOrigen: CASO_CRONOLOGICO_SEGMENTOS_47.segmentosEsperados,

  // Sábado 25/07/2026 (día hábil) — mismos segmentos objetivos, tope diario aplicado
  // cronológicamente: 05:00-06:00 (60min, nocturna, dentro del tope) => R.N.;
  // 06:00-11:00 (300min, diurna, dentro del tope, resto=60min) => ordinaria diurna,
  // no itemizada (factor 1.00, ya cubierta por el salario);
  // 13:00-14:20 (80min, diurna): primeros 60min agotan el tope => ordinaria diurna;
  // los 20min restantes exceden el tope => H.E.
  resultadoSabadoMinutos: {
    recargoNocturno: 60,   // R.N.
    horaExtra: 20,         // H.E.
    horaExtraNocturna: 0,  // H.E.N.
  },

  // Domingo 26/07/2026 (descanso obligatorio) — mismo tope diario 420min aplicado
  // a los mismos segmentos objetivos (el caso asume el mismo horario ambos días).
  resultadoDomingoMinutos: {
    dominicalFestivaDiurna: 360, // Dom./Fest. — 300min de 06:00-11:00 + 60min de 13:00-14:00
    recargoNocturnoFestivo: 60,  // R.N.F.
    horaExtraDomFest: 20,        // H.E.D.F.
    horaExtraNocturnaDomFest: 0, // H.E.N.F.
  },
} as const;
