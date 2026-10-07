/**
 * FIXTURE — COMPORTAMIENTO ACTUAL CARACTERIZADO.
 * NO ES RESULTADO FUNCIONAL APROBADO.
 *
 * Reproduce, como dato puro (sin ejecutar page.tsx), el comportamiento
 * exacto del motor viejo inline de src/app/page.tsx para el caso
 * "Operario de aseo, horario código 47" auditado en la Fase 0
 * (Bloque 0.2 + Addendum correctivo).
 *
 * Origen de cada número: reconstrucción aritmética verificada contra
 * src/app/page.tsx líneas 5895-5970 durante la auditoría. El código
 * 47 no existe en HorarioCatalogo (ver Addendum Bloque 0.2 §6) — el
 * origen exacto de horaInicio/horaFin no está determinado; el receso
 * de 120 minutos no tiene ninguna vía automática de origen en el
 * código y se asume digitado manualmente.
 *
 * Contiene DOS defectos ya identificados, documentados por separado:
 *   - ERROR A: clasificación proporcional de la fracción nocturna
 *     (no cronológica) — ver caso-cronologico-segmentos-codigo47.ts.
 *   - ERROR B: redondeo anticipado de horas (a 1 decimal) y de
 *     valorHora (a entero), antes de valorizar.
 */

export const CASO_LEGACY_OPERARIO_ASEO_47 = {
  etiqueta: 'COMPORTAMIENTO ACTUAL CARACTERIZADO. NO ES RESULTADO FUNCIONAL APROBADO.' as const,

  entrada: {
    horaInicioProceso: '05:00',
    horaFinProceso: '14:20',
    recesoProceso: '120',
    salBase: '1750905',
    horasSemanales: '44',
    diasSeleccionados: ['2026-07-25', '2026-07-26'] as const, // sábado, domingo
    nHoras: '', // N.° horas contratadas — no declarado en el caso auditado
  },

  // Duración e identificación de la franja nocturna (page.tsx:5895-5900)
  intermedios: {
    horasBrutas: 9.333333333333334, // calcularHorasBrutas('05:00','14:20') — incluye el receso (Error A)
    horasNetas: 7.333333333333334, // horasBrutas - 120/60 (resta plana, no posicional)
    nocBruta: 1, // contarHorasNocturnas(5, horasBrutas, 19, 6)
    fraccionNoc: 0.10714285714285714, // 1 / 9.333333333333334
    jornadaLegalDiaHoras: 7, // jornadaLegalMinParaFecha('2026-07-25')/60 — tramo post 15/07/2026
  },

  // Horas exactas ANTES de redondear (page.tsx:5908-5919, previo a .toFixed)
  horasExactasPreRedondeo: {
    recargoNocturnoHabil: 0.75,           // R.N.
    extraDiurnaHabil: 0.29761904761904762, // H.E.
    extraNocturnaHabil: 0.03571428571428571, // H.E.N. — asignado por Error A, el excedente real (14:00-14:20) es 100% diurno
    ordinariaDomDiurna: 6.25,             // Dom./Fest.
    recargoNocturnoDom: 0.75,             // R.N.F.
    extraDomDiurna: 0.29761904761904762,  // H.E.D.F.
    extraDomNocturna: 0.03571428571428571, // H.E.N.F. — mismo Error A que H.E.N.
  },

  // Horas redondeadas anticipadamente a 1 decimal (page.tsx:5920-5927, .toFixed(1))
  // — estas son las cantidades que efectivamente valorizan el sobretiempo (Error B)
  horasRedondeadasAnticipadamente: {
    recargoNocturnoHabil: 0.8,
    extraDiurnaHabil: 0.3,
    extraNocturnaHabil: 0.0,
    ordinariaDomDiurna: 6.3,
    recargoNocturnoDom: 0.8,
    extraDomDiurna: 0.3,
    extraDomNocturna: 0.0,
  },

  // Factores legados usados por el motor viejo (page.tsx:5944-5952)
  factoresLegados: {
    recargoNocturnoHabil: 1.35,
    extraDiurnaHabil: 1.25,
    extraNocturnaHabil: 1.75,
    ordinariaDomDiurna: 1.80,
    recargoNocturnoDom: 2.15,
    extraDomDiurna: 2.05,
    extraDomNocturna: 2.55,
  },

  resultadoEsperado: {
    divisor: 220, // page.tsx:5942, fijo, sin resolución por fecha
    valorHora: 7959, // Math.round(1750905/220) — redondeado ANTES de valorizar (Error B)
    salarioBasico: 1750905, // Math.round((44/44)*1750905) — sin prorrateo, hsSem=44 declarado
    conceptos: {
      recargoNocturnoHabil: 8596,
      extraDiurnaHabil: 2985,
      extraNocturnaHabil: 0,
      ordinariaDomDiurna: 90255,
      recargoNocturnoDom: 13689,
      extraDomDiurna: 4895,
      extraDomNocturna: 0,
    },
    sobretiempo: 120420,
    auxilioTransporte: 249095,
    total: 2120420, // dev = salarioBasico + sobretiempo + auxilioTransporte
  },
} as const;
