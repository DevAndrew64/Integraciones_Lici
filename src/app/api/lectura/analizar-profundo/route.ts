import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { safeHash } from '@/lib/safe-log';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { registrarUso } from '@/lib/gemini-usage';
import { getSession } from '@/lib/session';
import { validarUrlAntiSSRF } from '@/lib/ssrf-guard';
import { checkGeminiRateLimitPg, recordGeminiUsagePg } from '@/lib/rate-limit';
import { isAdmin, resolveSessionUserId } from '@/lib/authz';
import { auditFromRequest } from '@/lib/audit';
import prisma from '@/lib/prisma';

import { detectarTipoArchivo } from '@/lib/lectura/extractors/detectar-tipo-archivo';
import { extraerPdfTexto } from '@/lib/lectura/extractors/extraer-pdf-texto';
import { extraerWord } from '@/lib/lectura/extractors/extraer-word';
import { extraerExcel } from '@/lib/lectura/extractors/extraer-excel';
import { dividirPaginasEnBloques, dividirTextoEnBloques } from '@/lib/lectura/pipeline/dividir-bloques';
import type { BloqueTexto } from '@/lib/lectura/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// â”€â”€ Tipos internos â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type FuenteRef = {
  pagina_inicial: number;
  pagina_final: number;
  fragmento_busqueda: string;
};

type ItemProfundo = Record<string, unknown> & {
  texto_literal_pliego?: string;
  fuente?: FuenteRef;
};

// Todas las claves de minuta soportadas (nuevas + legacy para backward compat)
const ALL_MINUTA_KEYS = [
  'forma_pago',
  'obligaciones_contratista',
  'obligaciones_entidad',
  'obligaciones_supervisor_interventor',
  'supervision_interventoria',           // legacy
  'seguridad_social_parafiscales',
  'estabilidad_laboral_personal',
  'multas',
  'procedimiento_multas_sanciones',
  'pena_pecuniaria_clausula_penal',
  'multas_sanciones_clausula_penal',     // legacy
  'garantias_contractuales',
  'polizas_requisitos_pago',
  'amparos',
  'indemnidad',
  'cesion_subcontratacion',
  'confidencialidad',
  'laft_sarlaft_listas',
  'caso_fortuito_fuerza_mayor',
  'solucion_controversias',
  'terminacion',
  'liquidacion',
  'terminacion_liquidacion',             // legacy
  'perfeccionamiento_requisitos_ejecucion',
  'ans_niveles_servicio',                // legacy
  'otros',
] as const;

type MinutaKey = typeof ALL_MINUTA_KEYS[number];

type ResultadoBloque = {
  ficha_general_proceso?: Record<string, unknown> | null;
  cronograma?: ItemProfundo[];
  requisitos_juridicos_habilitantes?: ItemProfundo[];
  requisitos_financieros_habilitantes?: ItemProfundo[];
  requisitos_organizacionales_habilitantes?: ItemProfundo[];
  requisitos_tecnicos_habilitantes?: ItemProfundo[];
  experiencia_habilitante?: ItemProfundo[];
  especificaciones_tecnicas_servicio?: ItemProfundo[];
  criterios_evaluacion_puntaje?: ItemProfundo[];
  criterios_desempate?: ItemProfundo[];
  causales_rechazo?: ItemProfundo[];
  reglas_subsanabilidad?: ItemProfundo[];
  garantias?: ItemProfundo[];
  minuta_condiciones_contractuales?: Record<string, ItemProfundo[]>;
  riesgos_contractuales?: ItemProfundo[];
  acuerdos_comerciales?: ItemProfundo[];
  anexos_formatos_matrices_formularios?: ItemProfundo[];
  alertas?: ItemProfundo[];
};

function buildPromptBloque(bloque: number, total: number, pInicial: number, pFinal: number): string {
  const fuenteEj = '{"pagina_inicial": N, "pagina_final": N, "fragmento_busqueda": "primeros 150 chars de texto_literal_pliego"}';
  const itemMinutaEj = `{
      "id": "FP-001",
      "nombre_clausula": "nombre descriptivo de la clÃ¡usula",
      "numero_clausula": "CLÃUSULA X o numeral exacto",
      "clasificacion": "FORMA_PAGO|OBLIGACION_CONTRATISTA|MULTA_CONTRACTUAL|PROCEDIMIENTO_SANCIONATORIO|PENA_PECUNIARIA|CLAUSULA_PENAL|GARANTIA_CONTRACTUAL|POLIZA_REQUISITO|AMPARO_CONTRACTUAL|RECIBO_PAGO_POLIZA|INDEMNIDAD|CESION_SUBCONTRATACION|OBLIGACION_LABORAL|SEGURIDAD_SOCIAL_PARAFISCALES|ESTABILIDAD_LABORAL|SOLUCION_CONTROVERSIAS|TERMINACION_CONTRACTUAL|LIQUIDACION_CONTRACTUAL|CASO_FORTUITO_FUERZA_MAYOR|CONFIDENCIALIDAD_CONTRACTUAL|LAFT_SARLAFT|PERFECCIONAMIENTO_EJECUCION|OTRO",
      "texto_literal_pliego": "TRANSCRIPCIÃ“N EXACTA SIN MODIFICAR",
      "numeral": "numeral o N/A",
      "fuente": ${fuenteEj},
      "nivel_riesgo": "ALTO|MEDIO|BAJO",
      "impacto_contractual": "descripciÃ³n del impacto en la ejecuciÃ³n del contrato",
      "impacto_economico": "impacto econÃ³mico si aplica o N/A",
      "impacto_operativo": "impacto operativo si aplica o N/A",
      "responsable_interno_sugerido": "Ã¡rea o cargo interno sugerido",
      "analisis_controlado": "tu interpretaciÃ³n jurÃ­dica de esta clÃ¡usula",
      "accion_preventiva": "acciÃ³n concreta recomendada para gestionar este riesgo"
    }`;

  return `Eres abogado especialista en contrataciÃ³n estatal colombiana: Ley 80 de 1993, Ley 1150 de 2007, Decreto 1082 de 2015, SECOP, documentos tipo, subsanabilidad, causales de rechazo, garantÃ­as, minuta contractual, obligaciones del contratista, obligaciones de la entidad, obligaciones del supervisor, multas, sanciones, clÃ¡usula penal, pena pecuniaria, procedimiento sancionatorio, artÃ­culo 86 de la Ley 1474 de 2011, riesgos, inhabilidades, incompatibilidades, estabilidad laboral, indemnidad, cesiÃ³n, subcontrataciÃ³n, soluciÃ³n de controversias, terminaciÃ³n, liquidaciÃ³n, amparos, pÃ³lizas, recibo o comprobante de pago de pÃ³lizas y requisitos de perfeccionamiento y ejecuciÃ³n contractual.

BLOQUE ${bloque} DE ${total} â€” pÃ¡ginas ${pInicial}â€“${pFinal}.

â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
REGLAS OBLIGATORIAS â€” INCUMPLIR INVALIDA EL ANÃLISIS
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
1. Extrae ÃšNICAMENTE informaciÃ³n que aparezca en el texto del bloque suministrado.
2. NO inventes. NO completes con conocimiento externo.
3. texto_literal_pliego = TRANSCRIPCIÃ“N EXACTA sin cambiar mayÃºsculas, puntuaciÃ³n ni errores del original.
4. analisis_controlado = tu interpretaciÃ³n jurÃ­dica, SIEMPRE separada del texto literal.
5. Identifica pÃ¡ginas con [INICIO_PAGINA X] / [FIN_PAGINA X].
6. Sin lÃ­mite de cantidad: extrae TODOS los Ã­tems.
7. Si algo no aparece: "NO ENCONTRADO EN EL DOCUMENTO FUENTE"
8. ÃšNICAMENTE JSON vÃ¡lido. Sin markdown. Sin texto antes o despuÃ©s.
9. fragmento_busqueda = primeros 150 caracteres del texto_literal_pliego.
10. Omite claves del JSON si no tienen informaciÃ³n real en este bloque.

â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
FASE CONTRACTUAL OBLIGATORIA â€” MINUTA, CLÃUSULAS Y CONDICIONES DEL CONTRATO
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
Revisa de forma exhaustiva la minuta, anexo de condiciones contractuales, capÃ­tulo de garantÃ­as, capÃ­tulo de riesgos y cualquier secciÃ³n contractual.
EXTRAE LITERALMENTE cada clÃ¡usula contractual relevante.
NO RESUMAS. NO AGRUPES clÃ¡usulas distintas en una sola.
Cada clÃ¡usula debe salir como registro independiente con texto literal, pÃ¡gina, numeral o nombre de clÃ¡usula, clasificaciÃ³n, nivel de riesgo, impacto y anÃ¡lisis controlado.

PALABRAS CLAVE CONTRACTUALES â€” busca obligatoriamente estas palabras y sinÃ³nimos:
CLÃUSULA Â· MINUTA Â· CONDICIONES DEL CONTRATO Â· OBLIGACIONES DEL CONTRATISTA Â· OBLIGACIONES DE LA ENTIDAD Â· OBLIGACIONES DEL SUPERVISOR Â· SUPERVISIÃ“N Â· INTERVENTORÃA Â· FORMA DE PAGO Â· ANTICIPO Â· PAGO ANTICIPADO Â· FACTURA Â· SOPORTES DE PAGO Â· SEGURIDAD SOCIAL Â· PARAFISCALES Â· APORTES Â· ESTABILIDAD LABORAL Â· PERSONAL MÃNIMO Â· SUSTITUCIÃ“N DE PERSONAL Â· CONTINUIDAD LABORAL Â· MULTAS Â· SANCIONES Â· INCUMPLIMIENTO Â· PROCEDIMIENTO SANCIONATORIO Â· ARTÃCULO 86 DE LA LEY 1474 DE 2011 Â· DECRETO DISTRITAL 0513 DE 2014 Â· MANUAL DE CONTRATACIÃ“N Â· CLÃUSULA PENAL Â· PENA PECUNIARIA Â· DIEZ POR CIENTO Â· GARANTÃA ÃšNICA Â· GARANTÃA DE CUMPLIMIENTO Â· PÃ“LIZA Â· RECIBO DE PAGO Â· COMPROBANTE DE PAGO Â· CONSTANCIA DE PAGO Â· TOMADOR Â· ASEGURADO Â· BENEFICIARIO Â· OBJETO ASEGURADO Â· VIGENCIA Â· VALOR ASEGURADO Â· AMPARO Â· SALARIOS Y PRESTACIONES Â· RESPONSABILIDAD CIVIL EXTRACONTRACTUAL Â· CALIDAD DEL SERVICIO Â· INDEMNIDAD Â· CESIÃ“N Â· SUBCONTRATACIÃ“N Â· PROPIEDAD INTELECTUAL Â· CONFIDENCIALIDAD Â· LAVADO DE ACTIVOS Â· FINANCIACIÃ“N DEL TERRORISMO Â· CASO FORTUITO Â· FUERZA MAYOR Â· SUSPENSIÃ“N Â· SOLUCIÃ“N DE CONTROVERSIAS Â· ARREGLO DIRECTO Â· CONCILIACIÃ“N Â· JURISDICCIÃ“N CONTENCIOSA Â· TERMINACIÃ“N Â· LIQUIDACIÃ“N Â· PERFECCIONAMIENTO Â· REQUISITOS DE EJECUCIÃ“N \u00b7 ESTAMPILLA \u00b7 IMPUESTO \u00b7 RETENCION \u00b7 TASA \u00b7 DESCUENTO \u00b7 GASTOS LEGALIZACION \u00b7 PUBLICACION \u00b7 INHABILIDAD \u00b7 INCOMPATIBILIDAD \u00b7 CONFLICTO DE INTERES \u00b7 ANTECEDENTES FISCALES \u00b7 ANTECEDENTES DISCIPLINARIOS \u00b7 RNMC \u00b7 REDAM \u00b7 BOLETIN RESPONSABLES FISCALES \u00b7 LISTAS RESTRICTIVAS \u00b7 PROHIBICIONES

CLASIFICACIÃ“N RIESGO: "ALTO", "MEDIO", "BAJO" o "NO APLICA"
SUBSANABLE: "SÃ", "NO" o "NO ESPECIFICADO EN EL DOCUMENTO"

â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
JSON A DEVOLVER
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
{
  "ficha_general_proceso": {
    "objeto": "texto literal o NO ENCONTRADO",
    "entidad": "nombre entidad o NO ENCONTRADO",
    "numero_proceso": "cÃ³digo proceso o NO ENCONTRADO",
    "modalidad_seleccion": "modalidad o NO ENCONTRADO",
    "presupuesto_oficial": "cifra y texto o NO ENCONTRADO",
    "plazo_ejecucion": "plazo o NO ENCONTRADO",
    "forma_pago": "condiciones de pago o NO ENCONTRADO",
    "lugar_ejecucion": "lugar o NO ENCONTRADO",
    "fuente": ${fuenteEj}
  },
  "cronograma": [{ "evento": "...", "fecha": "...", "hora": "...", "texto_literal_pliego": "EXACTO", "fuente": ${fuenteEj} }],
  "requisitos_juridicos_habilitantes": [{
    "id": "RJ-001", "nombre_requisito": "...", "texto_literal_pliego": "EXACTO",
    "numeral": "...", "capitulo": "...", "titulo_seccion": "...",
    "clasificacion": "capacidad jurÃ­dica|inscripciÃ³n RUP|documentos sociedad|otro",
    "subsanable": "SÃ|NO|NO ESPECIFICADO EN EL DOCUMENTO",
    "causal_rechazo_asociada": "...", "documento_soporte_requerido": "...",
    "responsable_interno_sugerido": "...", "nivel_riesgo": "ALTO|MEDIO|BAJO",
    "analisis_controlado": "...", "observacion": "...", "fuente": ${fuenteEj}
  }],
  "requisitos_financieros_habilitantes": [{ "id":"RF-001", "nombre_requisito":"...", "texto_literal_pliego":"EXACTO", "numeral":"...", "clasificacion":"...", "subsanable":"...", "documento_soporte_requerido":"...", "responsable_interno_sugerido":"...", "nivel_riesgo":"...", "analisis_controlado":"...", "fuente":${fuenteEj} }],
  "requisitos_organizacionales_habilitantes": [{ "id":"RO-001", "nombre_requisito":"...", "texto_literal_pliego":"EXACTO", "numeral":"...", "clasificacion":"...", "subsanable":"...", "documento_soporte_requerido":"...", "nivel_riesgo":"...", "analisis_controlado":"...", "fuente":${fuenteEj} }],
  "requisitos_tecnicos_habilitantes": [{ "id":"RT-001", "nombre_requisito":"...", "texto_literal_pliego":"EXACTO", "numeral":"...", "clasificacion":"...", "subsanable":"...", "documento_soporte_requerido":"...", "nivel_riesgo":"...", "analisis_controlado":"...", "fuente":${fuenteEj} }],
  "experiencia_habilitante": [{
    "id": "EX-001", "nombre_requisito": "...", "texto_literal_pliego": "EXACTO",
    "tipo_experiencia": "...", "actividades_aceptadas": "...", "valor_minimo": "...",
    "numero_contratos": "...", "periodo": "...", "numeral": "...",
    "subsanable": "...", "nivel_riesgo": "...", "analisis_controlado": "...", "fuente": ${fuenteEj}
  }],
  "especificaciones_tecnicas_servicio": [{ "id":"ET-001", "nombre_especificacion":"...", "texto_literal_pliego":"EXACTO", "numeral":"...", "obligatoriedad":"obligatorio|deseable|opcional", "nivel_riesgo":"...", "analisis_controlado":"...", "fuente":${fuenteEj} }],
  "criterios_evaluacion_puntaje": [{ "id":"CE-001", "nombre_criterio":"...", "texto_literal_pliego":"EXACTO", "puntaje_maximo":0, "tipo_evaluacion":"tÃ©cnico|econÃ³mico|calidad|experiencia|social|otro", "formula_aplicable":"...", "documentos_verificacion":"...", "numeral":"...", "nivel_riesgo":"...", "analisis_controlado":"...", "fuente":${fuenteEj} }],
  "criterios_desempate": [{ "id":"CD-001", "nombre_criterio":"...", "texto_literal_pliego":"EXACTO", "orden_aplicacion":0, "fuente":${fuenteEj} }],
  "causales_rechazo": [{ "id":"CR-001", "nombre_causal":"...", "texto_literal_pliego":"EXACTO", "tipo":"subsanable|no_subsanable|no_especificado", "subsanable":"...", "consecuencia":"rechazo|descalificaciÃ³n|otro", "nivel_riesgo":"...", "analisis_controlado":"...", "fuente":${fuenteEj} }],
  "reglas_subsanabilidad": [{ "id":"RS-001", "nombre_regla":"...", "texto_literal_pliego":"EXACTO", "aplica_a":"...", "plazo_subsanacion":"...", "fuente":${fuenteEj} }],
  "garantias": [{ "id":"GA-001", "nombre_garantia":"...", "texto_literal_pliego":"EXACTO",
  "tipo_garantia":"seriedad_oferta|cumplimiento|pago_salarios|calidad|responsabilidad_civil|estabilidad|buen_manejo_anticipo|otro",
  "monto_cobertura":"porcentaje o valor exacto del pliego",
  "plazo_vigencia":"vigencia exacta segun el pliego",
  "momento_entrega":"cuando debe entregarse la garantia",
  "tomador":"quien debe ser el tomador segun el pliego o NO ENCONTRADO EN EL DOCUMENTO FUENTE",
  "asegurado":"quien debe ser el asegurado segun el pliego o NO ENCONTRADO EN EL DOCUMENTO FUENTE",
  "beneficiario":"quien debe ser el beneficiario segun el pliego o NO ENCONTRADO EN EL DOCUMENTO FUENTE",
  "objeto_asegurado":"objeto asegurado segun el pliego o NO ENCONTRADO EN EL DOCUMENTO FUENTE",
  "exige_comprobante_pago":"SI|NO|NO ESPECIFICADO EN EL DOCUMENTO",
  "plazo_entrega_poliza":"plazo para entregar la poliza segun el pliego o NO ENCONTRADO EN EL DOCUMENTO FUENTE",
  "consecuencia_no_entrega":"consecuencia si no se entrega a tiempo o NO ENCONTRADO EN EL DOCUMENTO FUENTE",
  "aseguradora_banco_requerido":"...",
  "consecuencia_incumplimiento":"...",
  "nivel_riesgo":"...", "analisis_controlado":"...", "fuente":${fuenteEj} }],
  "minuta_condiciones_contractuales": {
    "forma_pago":                         [${itemMinutaEj}],
    "obligaciones_contratista":           [${itemMinutaEj}],
    "obligaciones_entidad":               [${itemMinutaEj}],
    "obligaciones_supervisor_interventor":[${itemMinutaEj}],
    "seguridad_social_parafiscales":      [${itemMinutaEj}],
    "estabilidad_laboral_personal":       [${itemMinutaEj}],
    "multas":                             [${itemMinutaEj}],
    "procedimiento_multas_sanciones":     [${itemMinutaEj}],
    "pena_pecuniaria_clausula_penal":     [${itemMinutaEj}],
    "garantias_contractuales":            [${itemMinutaEj}],
    "polizas_requisitos_pago":            [${itemMinutaEj}],
    "amparos":                            [${itemMinutaEj}],
    "indemnidad":                         [${itemMinutaEj}],
    "cesion_subcontratacion":             [${itemMinutaEj}],
    "confidencialidad":                   [${itemMinutaEj}],
    "laft_sarlaft_listas":                [${itemMinutaEj}],
    "caso_fortuito_fuerza_mayor":         [${itemMinutaEj}],
    "solucion_controversias":             [${itemMinutaEj}],
    "terminacion":                        [${itemMinutaEj}],
    "liquidacion":                        [${itemMinutaEj}],
    "perfeccionamiento_requisitos_ejecucion": [${itemMinutaEj}],
    "otros":                              [${itemMinutaEj}]
  },
  "riesgos_contractuales": [{ "id":"RI-001", "nombre_riesgo":"...", "texto_literal_pliego":"EXACTO", "tipo_riesgo":"de la entidad|del contratista|compartido|externo", "etapa":"precontractual|contractual|postcontractual", "nivel_riesgo":"...", "mitigacion_pliego":"...", "analisis_controlado":"...", "fuente":${fuenteEj} }],
  "acuerdos_comerciales": [{ "id":"AC-001", "nombre_acuerdo":"...", "texto_literal_pliego":"EXACTO", "aplica_para":"...", "fuente":${fuenteEj} }],
  "anexos_formatos_matrices_formularios": [{ "id":"AN-001", "nombre_anexo":"...", "texto_literal_pliego":"EXACTO", "tipo":"formato|matriz|formulario|anexo|otro", "obligatorio":"SÃ|NO|NO ESPECIFICADO", "descripcion":"...", "fuente":${fuenteEj} }],
  "inhabilidades_incompatibilidades": [{
    "id": "II-001",
    "requisito": "nombre del requisito o inhabilidad encontrada en el pliego",
    "tipo": "inhabilidad|incompatibilidad|conflicto_interes|prohibicion|antecedente_fiscal|antecedente_disciplinario|antecedente_judicial|lista_restrictiva|sancion_vigente|otro",
    "texto_literal_pliego": "TRANSCRIPCION EXACTA SIN MODIFICAR",
    "documento_soporte": "documento requerido para acreditar o NO ENCONTRADO EN EL DOCUMENTO FUENTE",
    "pagina": "pagina o numeral",
    "numeral": "numeral exacto",
    "nivel_riesgo": "ALTO|MEDIO|BAJO",
    "impacto_practico": "impacto practico para el oferente",
    "observacion": "observacion adicional",
    "fuente": ${fuenteEj}
  }],
  "estampillas_impuestos_retenciones": [{
    "id": "EI-001",
    "concepto": "nombre del impuesto, estampilla, tasa, retencion o descuento",
    "tipo": "estampilla|impuesto|tasa|contribucion|retencion|descuento|costo_legalizacion|publicacion|otro",
    "porcentaje_o_valor": "porcentaje o valor exacto del pliego o NO ENCONTRADO EN EL DOCUMENTO FUENTE",
    "base_calculo": "base de calculo exacta o NO ENCONTRADO EN EL DOCUMENTO FUENTE",
    "responsable_pago": "quien paga: contratista|entidad|compartido",
    "momento_pago": "cuando se paga o NO ENCONTRADO EN EL DOCUMENTO FUENTE",
    "consecuencia_no_pago": "consecuencia o NO ENCONTRADO EN EL DOCUMENTO FUENTE",
    "texto_literal_pliego": "TRANSCRIPCION EXACTA SIN MODIFICAR",
    "pagina": "pagina o numeral",
    "numeral": "numeral exacto",
    "impacto_economico": "impacto economico estimado sobre el contrato",
    "fuente": ${fuenteEj}
  }],
  "alertas": [{ "id":"AL-001", "tipo_alerta":"documental|jurÃ­dica|financiera|tÃ©cnica|econÃ³mica|contractual|operativa", "titulo":"...", "texto_literal_pliego":"EXACTO", "descripcion_alerta":"...", "impacto_potencial":"...", "nivel_riesgo":"ALTO|MEDIO|BAJO", "accion_recomendada":"...", "fuente":${fuenteEj} }]
}`;
}

// â”€â”€ Parser JSON robusto â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function parsearJSONBloque(raw: string, etiqueta: string): ResultadoBloque {
  const clean = raw.trim().replace(/^```(?:json|JSON)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
  try { return JSON.parse(clean) as ResultadoBloque; } catch { /* continuar */ }
  const m = clean.match(/\{[\s\S]*\}/);
  if (!m) { console.error(`[profundo:${etiqueta}] Sin JSON.`, { rawLen: raw.length, rawSha256: safeHash(raw) }); return {}; }
  try { return JSON.parse(m[0]) as ResultadoBloque; } catch { /* */ }
  let fixed = m[0];
  let b = 0, br = 0;
  for (const ch of fixed) { if (ch === '{') b++; else if (ch === '}') b--; else if (ch === '[') br++; else if (ch === ']') br--; }
  fixed = fixed.replace(/,\s*$/, '').replace(/,\s*([}\]])/g, '$1');
  fixed += ']'.repeat(Math.max(0, br)) + '}'.repeat(Math.max(0, b));
  try { return JSON.parse(fixed) as ResultadoBloque; } catch {
    console.error(`[profundo:${etiqueta}] JSON irreparable.`, { rawLen: raw.length, rawSha256: safeHash(raw) });
    return {};
  }
}

// â”€â”€ Llamada Gemini por bloque â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const MODELOS = ['gemini-2.5-flash', 'gemini-2.5-pro'] as const;
const MAX_TOKENS_BLOQUE = 16000;

async function llamarGeminiBloque(
  client: GoogleGenerativeAI,
  bloque: BloqueTexto,
  totalBloques: number,
): Promise<{ resultado: ResultadoBloque; tokensIn: number; tokensOut: number; modelo: string; ok: boolean; error?: string }> {
  const prompt = buildPromptBloque(bloque.numeroBloque, totalBloques, bloque.paginaInicial, bloque.paginaFinal);
  const promptFull = `${prompt}\n\n---\nTEXTO DEL BLOQUE:\n${bloque.textoConMarcadores}`;

  for (const modelId of MODELOS) {
    try {
      const model = client.getGenerativeModel({ model: modelId, generationConfig: { maxOutputTokens: MAX_TOKENS_BLOQUE, responseMimeType: 'application/json', temperature: 0.05 } });
      const result = await model.generateContent([promptFull]);
      const resp = result.response;
      const text = resp.text();
      const tokensIn = resp.usageMetadata?.promptTokenCount ?? 0;
      const tokensOut = resp.usageMetadata?.candidatesTokenCount ?? 0;
      const finReason = resp.candidates?.[0]?.finishReason ?? 'unknown';
      console.log(`[profundo:b${bloque.numeroBloque}] ${modelId} finish:${finReason} tokOut:${tokensOut}`);
      if (!text?.trim()) throw new Error('Gemini vacÃ­o.');
      const resultado = parsearJSONBloque(text, `b${bloque.numeroBloque}`);
      return { resultado, tokensIn, tokensOut, modelo: modelId, ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[profundo:b${bloque.numeroBloque}] ${modelId}: ${msg.slice(0, 200)}`);
      if (/429|RESOURCE_EXHAUSTED|503|overloaded/.test(msg)) await new Promise(r => setTimeout(r, 3_000));
    }
  }
  return { resultado: {}, tokensIn: 0, tokensOut: 0, modelo: 'fallback', ok: false, error: `Bloque ${bloque.numeroBloque} (p${bloque.paginaInicial}-${bloque.paginaFinal}) fallÃ³.` };
}

// â”€â”€ ConsolidaciÃ³n de bloques â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function normalizarTexto(s: string | undefined | null): string {
  if (!s) return '';
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function deduplicar(items: ItemProfundo[]): ItemProfundo[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = normalizarTexto(item.texto_literal_pliego) + '|' + String((item.fuente as FuenteRef | undefined)?.pagina_inicial ?? '') + '|' + String(item.numeral ?? '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function reasignarIds(items: ItemProfundo[], prefijo: string): ItemProfundo[] {
  return items.map((item, i) => ({ ...item, id: `${prefijo}-${String(i + 1).padStart(3, '0')}` }));
}

function mergeArrayKey(resultados: ResultadoBloque[], key: keyof ResultadoBloque): ItemProfundo[] {
  const all: ItemProfundo[] = [];
  for (const r of resultados) {
    const arr = r[key];
    if (Array.isArray(arr)) all.push(...(arr as ItemProfundo[]));
  }
  return all;
}

function mergeMinuta(resultados: ResultadoBloque[]): Record<string, ItemProfundo[]> {
  const merged: Record<string, ItemProfundo[]> = {};
  for (const k of ALL_MINUTA_KEYS) {
    const all: ItemProfundo[] = [];
    for (const r of resultados) {
      const minuta = r.minuta_condiciones_contractuales;
      if (minuta && Array.isArray(minuta[k])) all.push(...(minuta[k] as ItemProfundo[]));
    }
    merged[k] = deduplicar(all);
  }
  return merged;
}

function construirValidacionContractual(minuta: Record<string, ItemProfundo[]>): Record<string, unknown> {
  const cnt = (keys: readonly MinutaKey[]) => keys.reduce((a, k) => a + (minuta[k]?.length ?? 0), 0);
  const si_no = (n: number) => n > 0 ? 'SÃ' : 'NO_ENCONTRADO';

  const obligatoriasContratista = cnt(['obligaciones_contratista']);
  const multas = cnt(['multas', 'multas_sanciones_clausula_penal']);
  const procedimiento = cnt(['procedimiento_multas_sanciones']);
  const pena = cnt(['pena_pecuniaria_clausula_penal']);
  const cesion = cnt(['cesion_subcontratacion']);
  const indemnidad = cnt(['indemnidad']);
  const controversias = cnt(['solucion_controversias']);
  const terminacion = cnt(['terminacion', 'terminacion_liquidacion']);
  const liquidacion = cnt(['liquidacion', 'terminacion_liquidacion']);
  const garantias = cnt(['garantias_contractuales', 'polizas_requisitos_pago', 'amparos']);
  const recibo = cnt(['polizas_requisitos_pago']);

  const total = cnt(ALL_MINUTA_KEYS);
  const estado = total === 0 ? 'ANALISIS_CONTRACTUAL_INCOMPLETO' : 'COMPLETO';

  return {
    se_reviso_minuta: 'SÃ',
    se_extrajeron_obligaciones_contratista: si_no(obligatoriasContratista),
    se_extrajeron_multas: si_no(multas),
    se_extrajo_procedimiento_sancionatorio: si_no(procedimiento),
    se_extrajo_pena_pecuniaria: si_no(pena),
    se_extrajo_cesion_subcontratacion: si_no(cesion),
    se_extrajo_indemnidad: si_no(indemnidad),
    se_extrajo_solucion_controversias: si_no(controversias),
    se_extrajo_terminacion: si_no(terminacion),
    se_extrajo_liquidacion: si_no(liquidacion),
    se_extrajeron_garantias_y_polizas: si_no(garantias),
    se_extrajo_recibo_pago_poliza_si_aplica: recibo > 0 ? 'SÃ' : 'NO_APLICA',
    estado_analisis_contractual: estado,
    advertencias: total === 0 ? ['No se encontraron clÃ¡usulas contractuales. Verificar si el pliego tiene minuta o condiciones contractuales.'] : [],
  };
}

function consolidarResultados(
  bloques: ResultadoBloque[],
  bloquesInfo: BloqueTexto[],
  advertencias: string[],
  metodoExtraccion: string,
  totalPaginas: number,
  nombreDocumento: string,
): Record<string, unknown> {
  let fichaGeneral: Record<string, unknown> | null = null;
  for (const b of bloques) {
    if (b.ficha_general_proceso && typeof b.ficha_general_proceso === 'object') {
      const f = b.ficha_general_proceso as Record<string, unknown>;
      if (f.objeto && f.objeto !== 'NO ENCONTRADO EN EL DOCUMENTO FUENTE') { fichaGeneral = f; break; }
      if (!fichaGeneral) fichaGeneral = f;
    }
  }

  const PREFIJOS: Record<string, string> = {
    cronograma: 'CR', requisitos_juridicos_habilitantes: 'RJ', requisitos_financieros_habilitantes: 'RF',
    requisitos_organizacionales_habilitantes: 'RO', requisitos_tecnicos_habilitantes: 'RT',
    experiencia_habilitante: 'EX', especificaciones_tecnicas_servicio: 'ET', criterios_evaluacion_puntaje: 'CE',
    criterios_desempate: 'CD', causales_rechazo: 'CAR', reglas_subsanabilidad: 'RS', garantias: 'GA',
    riesgos_contractuales: 'RI', acuerdos_comerciales: 'AC', anexos_formatos_matrices_formularios: 'AN', alertas: 'AL',
  };

  const secciones: Record<string, ItemProfundo[]> = {};
  for (const [key, prefijo] of Object.entries(PREFIJOS)) {
    secciones[key] = reasignarIds(deduplicar(mergeArrayKey(bloques, key as keyof ResultadoBloque)), prefijo);
  }

  type ItemConCategoria = ItemProfundo & { _categoria: string };
  const cat = (items: ItemProfundo[], label: string): ItemConCategoria[] => items.map(i => ({ ...(i as Record<string, unknown>), _categoria: label } as ItemConCategoria));
  const todosRequisitos: ItemConCategoria[] = [
    ...cat(secciones.requisitos_juridicos_habilitantes, 'JurÃ­dico habilitante'),
    ...cat(secciones.requisitos_financieros_habilitantes, 'Financiero habilitante'),
    ...cat(secciones.requisitos_organizacionales_habilitantes, 'Organizacional habilitante'),
    ...cat(secciones.requisitos_tecnicos_habilitantes, 'TÃ©cnico habilitante'),
    ...cat(secciones.experiencia_habilitante, 'Experiencia habilitante'),
    ...cat(secciones.criterios_evaluacion_puntaje, 'Criterio evaluaciÃ³n'),
    ...cat(secciones.garantias, 'GarantÃ­a'),
    ...cat(secciones.causales_rechazo, 'Causal rechazo'),
  ];
  const matrizCumplimiento = todosRequisitos.map((req, i) => ({
    id: `MCM-${String(i + 1).padStart(3, '0')}`,
    categoria: req._categoria,
    nombre_requisito: req.nombre_requisito ?? req.nombre_criterio ?? req.nombre_garantia ?? req.nombre_causal ?? req.id,
    texto_literal_pliego: req.texto_literal_pliego,
    nivel_riesgo: req.nivel_riesgo,
    subsanable: req.subsanable,
    documento_soporte_requerido: req.documento_soporte_requerido,
    estado_cumplimiento: 'PENDIENTE_VERIFICAR',
    fuente: req.fuente,
  }));

  const minuta = mergeMinuta(bloques);
  const validacionContractual = construirValidacionContractual(minuta);

  return {
    control_documento: {
      nombre_archivo: nombreDocumento,
      numero_paginas: totalPaginas,
      calidad_lectura: (metodoExtraccion === 'pdf_text' || metodoExtraccion === 'por_pagina')
        ? 'Texto embebido detectado'
        : metodoExtraccion === 'document_ai_ocr'
          ? 'OCR Document AI — texto extraído de PDF escaneado'
          : metodoExtraccion === 'word'
            ? 'Word — extracción mammoth'
            : metodoExtraccion === 'excel'
              ? 'Excel — extracción ExcelJS'
              : 'PDF aproximado — trazabilidad de página aproximada',
      paginas_ilegibles: [],
      limitaciones: advertencias,
      documentos_externos_referenciados_no_suministrados: [],
    },
    bloques_procesados: bloques.length,
    mapa_estructural: bloquesInfo.map(b => ({ bloque: b.numeroBloque, paginas: `${b.paginaInicial}-${b.paginaFinal}`, chars: b.chars })),
    ficha_general_proceso: fichaGeneral ?? {},
    ...secciones,
    minuta_condiciones_contractuales: minuta,
    validacion_contractual: validacionContractual,
    matriz_cumplimiento_documental: matrizCumplimiento,
    validacion_final: {
      se_reviso_todo_el_documento: 'SÃ',
      paginas_revisadas: bloquesInfo.map(b => `${b.paginaInicial}-${b.paginaFinal}`).join(', '),
      campos_no_encontrados: [],
      posibles_contradicciones: [],
      advertencias_ocr: advertencias,
      observacion_final: `Documento procesado en ${bloques.length} bloque(s). MÃ©todo: ${metodoExtraccion}.`,
    },
  };
}

// â”€â”€ Descarga â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function descargarDocumento(url: string): Promise<Buffer> {
  const ssrf = validarUrlAntiSSRF(url);
  if (!ssrf.ok) throw new Error(ssrf.error);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 35_000);
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept': 'application/pdf,*/*;q=0.8' },
      redirect: 'follow', signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const ct = resp.headers.get('content-type') ?? '';
    if (ct.includes('text/html')) throw new Error('El servidor devolviÃ³ HTML.');
    const MAX_DESCARGA_BYTES = 100 * 1024 * 1024;
    const clStr = resp.headers.get('content-length');
    if (clStr && parseInt(clStr, 10) > MAX_DESCARGA_BYTES) {
      throw new Error(`Documento demasiado pesado (${Math.round(parseInt(clStr, 10) / 1024 / 1024)} MB). Máximo: 100 MB.`);
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > MAX_DESCARGA_BYTES) {
      throw new Error(`Documento demasiado pesado (${Math.round(buf.length / 1024 / 1024)} MB). Máximo: 100 MB.`);
    }
    return buf;
  } finally { clearTimeout(timer); }
}

// â”€â”€ Handler principal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 });

  const usuarioId = await resolveSessionUserId(session);
  if (usuarioId === null) {
    return NextResponse.json({ ok: false, error: 'SesiÃ³n invÃ¡lida. Inicie sesiÃ³n nuevamente.' }, { status: 401 });
  }

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: false, error: 'GOOGLE_AI_API_KEY no configurada.' }, { status: 503 });

  let body: { urlDocumento?: string; nombreDocumento?: string; pdfBase64?: string; forzar?: boolean; codigoProceso?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Body invÃ¡lido.' }, { status: 400 }); }

  const { urlDocumento, nombreDocumento = 'Documento', pdfBase64: pdfBase64Input, forzar = false, codigoProceso: codigoProcesoParam } = body;
  const modo = 'profundo';

  if (!urlDocumento?.trim() && !pdfBase64Input?.trim()) return NextResponse.json({ ok: false, error: 'Se requiere urlDocumento o pdfBase64.' }, { status: 400 });

  if (urlDocumento?.trim() && !forzar) {
    try {
      const existente = await prisma.lecturaAnalisis.findFirst({ where: { urlDocumento, modo, ...(isAdmin(session.rol) ? {} : { usuarioId }) }, orderBy: { creadoEn: 'desc' } });
      if (existente) {
        void auditFromRequest(req, session, { accion: 'analisis_profundo', recurso: 'lectura_analisis', recursoId: String(existente.id), detalle: { modo, nombreDocumento: existente.nombreDocumento, cache: true } });
        return NextResponse.json({ ok: true, cached: true, analisisId: existente.id, nombreDocumento: existente.nombreDocumento, urlDocumento, modo, resultado: existente.resultado, tokens: { entrada: existente.tokensEntrada, salida: existente.tokensSalida } });
      }
    } catch { /* ignorar */ }
  }

  // â”€â”€ Rate limit â€” solo si no hay cachÃ© â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const rlP = await checkGeminiRateLimitPg(usuarioId, 'profundo');
  if (rlP.bloqueado) {
    return NextResponse.json({ ok: false, error: `LÃ­mite diario de anÃ¡lisis profundo alcanzado (${rlP.usos}/${rlP.limite}). Intente maÃ±ana.` }, { status: 429 });
  }

  let pdfBuffer: Buffer;
  if (pdfBase64Input) {
    const PDF_B64_MAX_BYTES = Math.ceil(10 * 1024 * 1024 * 4 / 3);
    if (pdfBase64Input.length > PDF_B64_MAX_BYTES) {
      return NextResponse.json({ ok: false, error: 'Archivo demasiado grande. MÃ¡ximo permitido: 10 MB.' }, { status: 400 });
    }
    pdfBuffer = Buffer.from(pdfBase64Input, 'base64');
  } else {
    try { pdfBuffer = await descargarDocumento(urlDocumento!); } catch (err) {
      return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Error al descargar.' }, { status: 502 });
    }
  }

  const pdfHash = createHash('sha256').update(pdfBuffer.subarray(0, 8_192)).digest('hex');
  if (!forzar) {
    try {
      const porHash = await prisma.lecturaAnalisis.findFirst({ where: { pdfHash, modo, ...(isAdmin(session.rol) ? {} : { usuarioId }) }, orderBy: { creadoEn: 'desc' } });
      if (porHash) {
        void auditFromRequest(req, session, { accion: 'analisis_profundo', recurso: 'lectura_analisis', recursoId: String(porHash.id), detalle: { modo, nombreDocumento: porHash.nombreDocumento, cache: true } });
        return NextResponse.json({ ok: true, cached: true, analisisId: porHash.id, nombreDocumento: porHash.nombreDocumento, modo, resultado: porHash.resultado, tokens: { entrada: porHash.tokensEntrada, salida: porHash.tokensSalida } });
      }
    } catch { /* ignorar */ }
  }

  // Detectar formato y extraer texto por bloques
  const tipoArchivo = detectarTipoArchivo(pdfBuffer, nombreDocumento);
  let bloques: BloqueTexto[] = [];
  let totalPaginas = 0;
  let metodo = 'pdf_text';
  const advertencias: string[] = [];

  if (!tipoArchivo.soportado) {
    return NextResponse.json({ ok: false, error: tipoArchivo.advertencia ?? 'Formato no soportado.' }, { status: 422 });
  }
  if (tipoArchivo.formato === 'pdf') {
    const extRes = await extraerPdfTexto(pdfBuffer);
    advertencias.push(...extRes.advertencias);
    totalPaginas = extRes.totalPaginas;
    metodo = extRes.metodo;
    if (extRes.metodo === 'document_ai_ocr') {
      void auditFromRequest(req, session, { accion: 'document_ai_ocr_usado', recurso: 'lectura/document-ai-ocr', detalle: { nombreDocumento, hashCorto: pdfHash.slice(0, 12), totalPaginas: extRes.totalPaginas, totalChars: extRes.paginas.map((p: { texto: string }) => p.texto).join('').length, metodoExtraccion: 'document_ai_ocr', paginasOcr: extRes.paginas.filter((p: { texto: string }) => p.texto.trim().length > 0).length } });
    }
    if (extRes.paginas.length === 0) {
      return NextResponse.json({ ok: false, error: 'No se pudo extraer texto. ' + advertencias.join(' ') }, { status: 422 });
    }
    bloques = dividirPaginasEnBloques(extRes.paginas, 40_000);
  } else if (tipoArchivo.formato === 'word_docx') {
    const extRes = await extraerWord(pdfBuffer, nombreDocumento);
    advertencias.push(...extRes.advertencias);
    metodo = 'word';
    if (!extRes.texto.trim()) {
      return NextResponse.json({ ok: false, error: 'No se pudo extraer texto del Word. ' + advertencias.join(' ') }, { status: 422 });
    }
    bloques = dividirTextoEnBloques(extRes.texto, 'word', [], 40_000);
  } else if (tipoArchivo.formato === 'excel_xlsx') {
    const extRes = await extraerExcel(pdfBuffer, nombreDocumento);
    advertencias.push(...extRes.advertencias);
    metodo = 'excel';
    if (!extRes.texto.trim()) {
      return NextResponse.json({ ok: false, error: 'No se pudo extraer texto del Excel. ' + advertencias.join(' ') }, { status: 422 });
    }
    bloques = dividirTextoEnBloques(extRes.texto, 'excel', extRes.hojas, 40_000);
  } else {
    return NextResponse.json({ ok: false, error: `Formato "${tipoArchivo.formato}" no soportado para análisis profundo.` }, { status: 422 });
  }

  if (bloques.length === 0) {
    return NextResponse.json({ ok: false, error: 'No se pudo dividir el documento en bloques procesables.' }, { status: 422 });
  }
  console.log(`[profundo] ${totalPaginas} págs | ${bloques.length} bloques | ${metodo}`);

  const client = new GoogleGenerativeAI(apiKey);
  const CONCURRENCIA = 3;
  const resultadosBloques: ResultadoBloque[] = new Array(bloques.length).fill({});
  const bloquesError: string[] = [];
  let totalTokensIn = 0, totalTokensOut = 0;

  for (let i = 0; i < bloques.length; i += CONCURRENCIA) {
    const lote = bloques.slice(i, i + CONCURRENCIA);
    const resultados = await Promise.allSettled(lote.map(b => llamarGeminiBloque(client, b, bloques.length)));
    for (let j = 0; j < resultados.length; j++) {
      const res = resultados[j];
      const idx = i + j;
      if (res.status === 'fulfilled') {
        const { resultado, tokensIn, tokensOut, modelo, ok, error } = res.value;
        resultadosBloques[idx] = resultado;
        totalTokensIn += tokensIn;
        totalTokensOut += tokensOut;
        if (!ok && error) bloquesError.push(error);
        registrarUso({ modelo, endpoint: 'lectura/analizar-profundo', tokensIn, tokensOut, usuarioId });
      } else {
        bloquesError.push(`Bloque ${bloques[idx].numeroBloque} rechazado: ${String(res.reason).slice(0, 100)}`);
        resultadosBloques[idx] = {};
      }
    }
    if (i + CONCURRENCIA < bloques.length) await new Promise(r => setTimeout(r, 1_500));
  }

  if (bloquesError.length > 0) advertencias.push(...bloquesError);

  const resultadoFinal = consolidarResultados(resultadosBloques, bloques, advertencias, metodo, totalPaginas, nombreDocumento);

  const pdfBlobToStore = (!urlDocumento && pdfBase64Input && pdfBuffer.length <= 4 * 1024 * 1024) ? pdfBase64Input : null;
  let analisisId: number | null = null;
  try {
    const guardado = await prisma.lecturaAnalisis.create({
      data: {
        nombreDocumento, urlDocumento: urlDocumento || null, pdfHash, modo, pdfBlob: pdfBlobToStore,
        codigoProceso: codigoProcesoParam?.trim() || null,
        entidad: String((resultadoFinal.ficha_general_proceso as Record<string, unknown>)?.entidad ?? '').slice(0, 500) || null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        resultado: resultadoFinal as any, tokensEntrada: totalTokensIn || null, tokensSalida: totalTokensOut || null, usuarioId,
      },
    });
    analisisId = guardado.id;
  } catch (dbErr) {
    const prismaCode = (dbErr as { code?: string })?.code;
    const errMsg     = dbErr instanceof Error ? dbErr.message.slice(0, 200) : String(dbErr).slice(0, 200);
    console.error('[profundo] Error BD', { prismaCode, errMsg, usuarioId });
  }

  void recordGeminiUsagePg(usuarioId, 'profundo');
  void auditFromRequest(req, session, { accion: 'analisis_profundo', recurso: 'lectura_analisis', recursoId: analisisId != null ? String(analisisId) : undefined, detalle: { modo, nombreDocumento, cache: false, tokensEntrada: totalTokensIn || null, tokensSalida: totalTokensOut || null } });
  return NextResponse.json({
    ok: true, analisisId, nombreDocumento, urlDocumento, modo, resultado: resultadoFinal,
    tokens: { entrada: totalTokensIn || null, salida: totalTokensOut || null },
    debug: { totalPaginas, bloquesTotal: bloques.length, bloquesConError: bloquesError.length, metodoExtraccion: metodo, advertencias },
  });
}
