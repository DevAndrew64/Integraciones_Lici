/**
 * FIXTURE — HIPÓTESIS DE PRESUPUESTO SEMANAL.
 * NO ES REGLA FUNCIONAL APROBADA. REQUIERE_CONTEXTO_SEMANAL.
 *
 * Aplica la Hipótesis B (jornada ordinaria = distribución contractual /
 * acumulado semanal, máximo 42h/sem) sobre los mismos segmentos
 * OBJETIVOS de caso-cronologico-segmentos-codigo47.ts.
 *
 * A diferencia del fixture de tope diario, este NO produce un resultado
 * numérico: con solo 2 días aislados (sábado y domingo) y sin conocer
 * el resto de la semana ni la distribución contractual pactada, no es
 * posible determinar si los 20 minutos excedentes de cada día son
 * ordinarios o extra. Forzar un número aquí (cero, o 20 minutos, o
 * cualquier otro) tomaría la decisión funcional pendiente por la
 * puerta trasera — está explícitamente prohibido (Bloque 0.3 §2 y
 * mensaje de aprobación del usuario).
 */

import { CASO_CRONOLOGICO_SEGMENTOS_47 } from './caso-cronologico-segmentos-codigo47';

export const CASO_CRONOLOGICO_PRESUPUESTO_SEMANAL_47 = {
  etiqueta:
    'HIPÓTESIS DE PRESUPUESTO SEMANAL. NO ES REGLA FUNCIONAL APROBADA. REQUIERE_CONTEXTO_SEMANAL.' as const,

  hipotesis: {
    jornadaSemanalMaximaMinutos: 2520, // 42h — matriz vigente 15/07/2026 (§J del plan)
    acumuladoAnteriorSemana: null,
    distribucionContractualDiaria: null,
    contextoSemanaCompletaDisponible: false,
    descripcion:
      'Bajo esta hipótesis, un día concreto solo es "extra" si el acumulado ' +
      'semanal ya superó 2520 min o si excede la distribución contractual ' +
      'diaria pactada — ninguno de los dos datos está disponible con un ' +
      'plazo aislado de 2 días.',
  },

  segmentosOrigen: CASO_CRONOLOGICO_SEGMENTOS_47.segmentosEsperados,

  estado: 'REQUIERE_CONTEXTO_SEMANAL' as const,
  horasExtra: null, // explícitamente NO determinado — nunca inferir 0 ni 1/3h aquí

  motivoIndeterminacion:
    'Un plazo de 2 días aislados (sábado y domingo) no permite conocer el ' +
    'acumulado semanal (¿cuántas horas ya trabajó el operario de lunes a ' +
    'viernes?) ni la distribución contractual diaria pactada (¿su jornada ' +
    'de 42h/sem se reparte en 6 días de 7h, en 5 días de 8h24, o de otra ' +
    'forma?) — sin esa información, cualquier cifra de horas extra sería ' +
    'una decisión funcional tomada implícitamente, no un cálculo. Ver ' +
    'preguntas 1-3 de "Decisión funcional requerida antes de implementar ' +
    'el motor corregido" (Bloque 0.3).',
} as const;
