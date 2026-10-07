/**
 * Prompt dedicado de extracción de ponderación económica.
 * Se usa SOLO como fallback cuando no existe LecturaAnalisis previa para el proceso.
 * Gemini extrae estructura — no calcula, no simula, no recomienda.
 */

export const EXTRACCION_PONDERACION_SYSTEM = `Eres un experto en contratación pública colombiana (Ley 80/93, Ley 1150/07, Decreto 1082/15).
Tu única tarea es extraer y estructurar la metodología de evaluación económica de un pliego de condiciones.

REGLAS ESTRICTAS:
- Solo extrae lo que esté soportado LITERALMENTE por el texto del pliego.
- Si no encuentras información suficiente, usa null o "desconocida".
- NO inventes fórmulas, rangos, puntajes ni valores.
- NO calcules la oferta óptima.
- NO simules competidores.
- NO recomiendes porcentaje de oferta.
- NO asumas TRM si no aparece en el texto.
- Devuelve SIEMPRE JSON válido y estricto.`;

export function buildExtraccionPrompt(textoPliego: string): string {
  const textoTruncado = textoPliego.slice(0, 60000);

  return `${EXTRACCION_PONDERACION_SYSTEM}

TEXTO DEL PLIEGO:
---
${textoTruncado}
---

Analiza el texto y extrae la metodología de evaluación económica. Busca específicamente:
- Fórmula de ponderación económica (mediana, media geométrica, media aritmética, menor valor, etc.)
- Puntaje máximo para el factor económico
- Presupuesto oficial del proceso
- Condición por centavos de TRM (si aplica)
- Rangos de centavos de TRM que determinan la fórmula
- Texto literal de la fórmula
- Sección o página donde aparece

TIPOS DE FÓRMULA RECONOCIDOS (usa exactamente estos valores):
- "mediana"
- "media_geometrica"
- "media_geometrica_presupuesto"
- "media_aritmetica"
- "media_aritmetica_baja"
- "media_aritmetica_alta"
- "menor_valor"
- "desconocida" (si no coincide con ninguna)
- "personalizada" (si tiene estructura propia no estándar)

Devuelve ÚNICAMENTE este JSON (sin markdown, sin texto adicional):

{
  "presupuestoOficial": <número en COP o null>,
  "puntajeMaximoEconomico": <número o null>,
  "moneda": "COP",
  "metodos": [
    {
      "nombreMetodo": "<nombre como aparece en el pliego>",
      "tipoFormula": "<uno de los tipos reconocidos>",
      "rangoTrmDesde": <entero 0-99 o null si no aplica>,
      "rangoTrmHasta": <entero 0-99 o null si no aplica>,
      "puntajeMaximo": <número o null>,
      "formulaTexto": "<texto literal de la fórmula si aparece, o null>",
      "notasFormula": "<aclaraciones o condiciones adicionales, o null>",
      "paginaReferencia": <número de página o null>,
      "seccionReferencia": "<nombre de sección o cláusula, o null>",
      "textoFuente": "<cita textual corta del pliego (máx 300 chars), o null>",
      "confianzaExtraccion": <número entre 0 y 1, según certeza>,
      "requiereRevision": true,
      "advertencias": ["<advertencia si algo es ambiguo>"]
    }
  ],
  "advertenciasGenerales": ["<advertencias sobre el documento completo>"],
  "preguntasPendientes": ["<preguntas que requieren revisión humana>"]
}

Si no encuentras metodología económica clara, devuelve:
{
  "presupuestoOficial": null,
  "puntajeMaximoEconomico": null,
  "moneda": "COP",
  "metodos": [],
  "advertenciasGenerales": ["No se identificó una metodología económica clara en el documento. Requiere revisión manual."],
  "preguntasPendientes": []
}`;
}