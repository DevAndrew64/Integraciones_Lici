import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { registrarUso } from '@/lib/gemini-usage';
import { getSession } from '@/lib/session';
import { validarUrlAntiSSRF } from '@/lib/ssrf-guard';
import { checkGeminiRateLimitPg, recordGeminiUsagePg } from '@/lib/rate-limit';
import { isAdmin, resolveSessionUserId } from '@/lib/authz';
import { auditFromRequest, auditLog } from '@/lib/audit';
import prisma from '@/lib/prisma';

import { extraerPdfTexto } from '@/lib/lectura/extractors/extraer-pdf-texto';
import { extraerWord } from '@/lib/lectura/extractors/extraer-word';
import { extraerExcel } from '@/lib/lectura/extractors/extraer-excel';
import { dividirPaginasEnBloques, dividirTextoEnBloques } from '@/lib/lectura/pipeline/dividir-bloques';
import type { BloqueTexto } from '@/lib/lectura/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// ── Tipos ────────────────────────────────────────────────────────────────────

type TipoFuente = 'pdf' | 'word' | 'excel';

type DocInput = {
  nombre: string;
  url: string;
  tipo: string;
  prioridad: number;
  prioridadDedup?: number;
};

type FuenteConDoc = {
  pagina_inicial: number | string;
  pagina_final: number | string;
  hoja?: string | null;
  fragmento_busqueda: string;
  nombre_documento: string;
  tipo_documento: string;
};

type ItemPC = Record<string, unknown> & {
  texto_literal_pliego?: string;
  fuente?: FuenteConDoc;
};

type ResultadoBloquePC = {
  ficha_general_proceso?: Record<string, unknown> | null;
  cronograma?: ItemPC[];
  requisitos_juridicos_habilitantes?: ItemPC[];
  requisitos_financieros_habilitantes?: ItemPC[];
  requisitos_organizacionales_habilitantes?: ItemPC[];
  requisitos_tecnicos_habilitantes?: ItemPC[];
  experiencia_habilitante?: ItemPC[];
  especificaciones_tecnicas_servicio?: ItemPC[];
  criterios_evaluacion_puntaje?: ItemPC[];
  criterios_desempate?: ItemPC[];
  causales_rechazo?: ItemPC[];
  reglas_subsanabilidad?: ItemPC[];
  garantias?: ItemPC[];
  minuta_condiciones_contractuales?: Record<string, ItemPC[]>;
  riesgos_contractuales?: ItemPC[];
  acuerdos_comerciales?: ItemPC[];
  anexos_formatos_matrices_formularios?: ItemPC[];
  inhabilidades_incompatibilidades?: ItemPC[];
  estampillas_impuestos_retenciones?: ItemPC[];
  alertas?: ItemPC[];
  resumen_ejecutivo_experto?: {
    que_contrata?: string;
    tipo_proponente?: string;
    puntos_sensibles?: string;
    validaciones_previas?: string;
    conclusion?: string;
  };
};

type DocResultado = {
  nombreDoc: string;
  tipoDoc: string;
  prioridad: number;
  prioridadDedup: number;
  bloques: ResultadoBloquePC[];
  advertencias: string[];
};

// ── Detección de formato ──────────────────────────────────────────────────────

function detectarTipoFuente(nombre: string, url: string): TipoFuente | 'otro' {
  const n = (nombre + ' ' + url).toLowerCase().split('?')[0];
  if (/\.(docx?)(\s|$)/.test(n)) return 'word';
  if (/\.(xlsx?|xlsm|xlsb)(\s|$)/.test(n)) return 'excel';
  if (/\.(pptx?|csv|zip|rar|7z)(\s|$)/.test(n)) return 'otro';
  return 'pdf';
}

async function descargar(url: string): Promise<Buffer> {
  const ssrf = validarUrlAntiSSRF(url);
  if (!ssrf.ok) throw new Error(ssrf.error);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 35_000);
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', Accept: 'application/pdf,*/*;q=0.8' },
      redirect: 'follow', signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const ct = resp.headers.get('content-type') ?? '';
    if (ct.includes('text/html')) throw new Error('El servidor devolvió HTML en lugar del documento.');
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

// ── Parser JSON ───────────────────────────────────────────────────────────────

function parsearJSON(raw: string, etiqueta: string): ResultadoBloquePC {
  const clean = raw.trim().replace(/^```(?:json|JSON)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
  try { return JSON.parse(clean) as ResultadoBloquePC; } catch { /* */ }
  const m = clean.match(/\{[\s\S]*\}/);
  if (!m) { console.error(`[pc:${etiqueta}] sin JSON`); return {}; }
  try { return JSON.parse(m[0]) as ResultadoBloquePC; } catch {
    let fixed = m[0];
    let b = 0, br = 0;
    for (const ch of fixed) { if (ch === '{') b++; else if (ch === '}') b--; else if (ch === '[') br++; else if (ch === ']') br--; }
    fixed = fixed.replace(/,\s*$/, '').replace(/,\s*([}\]])/g, '$1') + ']'.repeat(Math.max(0, br)) + '}'.repeat(Math.max(0, b));
    try { return JSON.parse(fixed) as ResultadoBloquePC; } catch { console.error(`[pc:${etiqueta}] JSON irreparable`); return {}; }
  }
}

// ── Prompt ────────────────────────────────────────────────────────────────────

function buildPrompt(blq: BloqueTexto, total: number, nombreDoc: string, tipoDoc: string): string {
  const esPDF = blq.tipoFuente === 'pdf';
  const esExcel = blq.tipoFuente === 'excel';

  const infoBloque = esPDF
    ? `Bloque ${blq.numeroBloque}/${total} — páginas ${blq.paginaInicial}–${blq.paginaFinal}`
    : esExcel
    ? `Bloque ${blq.numeroBloque}/${total} — hojas: ${(blq.hojasIncluidas ?? []).join(', ') || 'Excel'}`
    : `Bloque ${blq.numeroBloque}/${total} — documento Word`;

  const fe = esPDF
    ? `{"nombre_documento":"${nombreDoc}","tipo_documento":"${tipoDoc}","pagina_inicial":N,"pagina_final":N,"hoja":null,"fragmento_busqueda":"..."}`
    : esExcel
    ? `{"nombre_documento":"${nombreDoc}","tipo_documento":"${tipoDoc}","pagina_inicial":"NO_APLICA","pagina_final":"NO_APLICA","hoja":"NOMBRE_HOJA","fragmento_busqueda":"..."}`
    : `{"nombre_documento":"${nombreDoc}","tipo_documento":"${tipoDoc}","pagina_inicial":"NO_DETERMINADO","pagina_final":"NO_DETERMINADO","hoja":null,"fragmento_busqueda":"..."}`;

  const reglaPaginas = esPDF
    ? '5. Identifica páginas con [INICIO_PAGINA X] / [FIN_PAGINA X].'
    : esExcel
    ? '5. Identifica la hoja de origen con [INICIO_HOJA X] / [FIN_HOJA X]. Usa el nombre exacto de la hoja en fuente.hoja.'
    : '5. El documento es Word — no hay números de página. Usa pagina_inicial y pagina_final = "NO_DETERMINADO".';

  const itemMinutaEj = `{"id":"","nombre_clausula":"nombre descriptivo","numero_clausula":"CLÁUSULA X o numeral","clasificacion":"MULTA_CONTRACTUAL|PROCEDIMIENTO_SANCIONATORIO|PENA_PECUNIARIA|CLAUSULA_PENAL|GARANTIA_CONTRACTUAL|POLIZA_REQUISITO|AMPARO_CONTRACTUAL|RECIBO_PAGO_POLIZA|INDEMNIDAD|CESION_SUBCONTRATACION|OBLIGACION_LABORAL|SEGURIDAD_SOCIAL_PARAFISCALES|ESTABILIDAD_LABORAL|SOLUCION_CONTROVERSIAS|TERMINACION_CONTRACTUAL|LIQUIDACION_CONTRACTUAL|CASO_FORTUITO_FUERZA_MAYOR|CONFIDENCIALIDAD_CONTRACTUAL|LAFT_SARLAFT|PERFECCIONAMIENTO_EJECUCION|FORMA_PAGO|OBLIGACION_CONTRATISTA|OTRO","texto_literal_pliego":"TRANSCRIPCIÓN EXACTA","numeral":"...","fuente":${fe},"nivel_riesgo":"ALTO|MEDIO|BAJO","impacto_contractual":"...","impacto_economico":"...","impacto_operativo":"...","responsable_interno_sugerido":"...","analisis_controlado":"...","accion_preventiva":"..."}`;

  return `Eres abogado especialista en contratación estatal colombiana: Ley 80 de 1993, Ley 1150 de 2007, Decreto 1082 de 2015, SECOP, documentos tipo, subsanabilidad, causales de rechazo, garantías, minuta contractual, obligaciones del contratista, obligaciones de la entidad, obligaciones del supervisor, multas, sanciones, cláusula penal, pena pecuniaria, procedimiento sancionatorio, artículo 86 de la Ley 1474 de 2011, riesgos, inhabilidades, incompatibilidades, estabilidad laboral, indemnidad, cesión, subcontratación, solución de controversias, terminación, liquidación, amparos, pólizas, recibo o comprobante de pago de pólizas y requisitos de perfeccionamiento y ejecución contractual.

${infoBloque} del documento: "${nombreDoc}" (tipo: ${tipoDoc}).

REGLAS OBLIGATORIAS:
1. Extrae ÚNICAMENTE lo que aparezca en el texto del bloque.
2. NO inventes ni completes con conocimiento externo.
3. texto_literal_pliego = transcripción EXACTA sin modificar.
4. analisis_controlado = tu interpretación, SIEMPRE separada.
${reglaPaginas}
6. Sin límite de cantidad: extrae TODO.
7. Si algo no aparece: "NO ENCONTRADO EN EL DOCUMENTO FUENTE"
8. Solo JSON válido. Sin markdown. Sin texto extra.
9. fragmento_busqueda = primeros 150 caracteres del texto_literal_pliego.
10. CRÍTICO: en cada "fuente" usa SIEMPRE: ${fe}

CLASIFICACIÓN RIESGO: "ALTO", "MEDIO", "BAJO" o "NO APLICA"
SUBSANABLE: "SÍ", "NO" o "NO ESPECIFICADO EN EL DOCUMENTO"

═══════════════════════════════════════════
FASE CONTRACTUAL OBLIGATORIA — MINUTA, CLÁUSULAS Y CONDICIONES DEL CONTRATO
═══════════════════════════════════════════
Revisa exhaustivamente la minuta, anexo de condiciones contractuales, capítulo de garantías, capítulo de riesgos y cualquier sección contractual.
EXTRAE LITERALMENTE cada cláusula. NO RESUMAS. NO AGRUPES. Cada cláusula = un registro independiente.

PALABRAS CLAVE contractuales — busca obligatoriamente:
CLÁUSULA · MINUTA · CONDICIONES DEL CONTRATO · OBLIGACIONES DEL CONTRATISTA · OBLIGACIONES DE LA ENTIDAD · OBLIGACIONES DEL SUPERVISOR · SUPERVISIÓN · INTERVENTORÍA · FORMA DE PAGO · ANTICIPO · PAGO ANTICIPADO · FACTURA · SOPORTES DE PAGO · SEGURIDAD SOCIAL · PARAFISCALES · APORTES · ESTABILIDAD LABORAL · PERSONAL MÍNIMO · SUSTITUCIÓN DE PERSONAL · CONTINUIDAD LABORAL · MULTAS · SANCIONES · INCUMPLIMIENTO · PROCEDIMIENTO SANCIONATORIO · ARTÍCULO 86 DE LA LEY 1474 DE 2011 · DECRETO DISTRITAL 0513 DE 2014 · MANUAL DE CONTRATACIÓN · CLÁUSULA PENAL · PENA PECUNIARIA · DIEZ POR CIENTO · GARANTÍA ÚNICA · GARANTÍA DE CUMPLIMIENTO · PÓLIZA · RECIBO DE PAGO · COMPROBANTE DE PAGO · CONSTANCIA DE PAGO · TOMADOR · ASEGURADO · BENEFICIARIO · OBJETO ASEGURADO · VIGENCIA · VALOR ASEGURADO · AMPARO · SALARIOS Y PRESTACIONES · RESPONSABILIDAD CIVIL EXTRACONTRACTUAL · CALIDAD DEL SERVICIO · INDEMNIDAD · CESIÓN · SUBCONTRATACIÓN · PROPIEDAD INTELECTUAL · CONFIDENCIALIDAD · LAVADO DE ACTIVOS · FINANCIACIÓN DEL TERRORISMO · CASO FORTUITO · FUERZA MAYOR · SUSPENSIÓN · SOLUCIÓN DE CONTROVERSIAS · ARREGLO DIRECTO · CONCILIACIÓN · JURISDICCIÓN CONTENCIOSA · TERMINACIÓN · LIQUIDACIÓN · PERFECCIONAMIENTO · REQUISITOS DE EJECUCIÓN · ESTAMPILLA · IMPUESTO · RETENCIÓN · TASA · CONTRIBUCIÓN · DESCUENTO · GASTOS DE LEGALIZACIÓN · PUBLICACIÓN DEL CONTRATO · INHABILIDAD · INCOMPATIBILIDAD · CONFLICTO DE INTERÉS · ANTECEDENTES FISCALES · ANTECEDENTES DISCIPLINARIOS · ANTECEDENTES JUDICIALES · RNMC · REDAM · BOLETÍN DE RESPONSABLES FISCALES · LISTAS RESTRICTIVAS · PROHIBICIONES · SUBSANABILIDAD · SUBSANAR · NO SUBSANABLE · CAUSAL DE RECHAZO

JSON (solo secciones con información real en este bloque):
{
  "ficha_general_proceso": {"objeto":"...","entidad":"...","numero_proceso":"...","modalidad_seleccion":"...","tipo_documento":"Pliego de Condiciones|Terminos de Referencia|Invitacion Publica|Documento de Terminos y Condiciones|otro","presupuesto_oficial":"...","plazo_ejecucion":"...","lugar_ejecucion":"...","plataforma":"SECOP I|SECOP II|Colombia Compra Eficiente|Otro","supervision_interventoria":"quien supervisa segun el pliego o NO ENCONTRADO EN EL DOCUMENTO FUENTE","factor_seleccion":"menor precio|calidad y precio|mayor puntaje|concurso de meritos|precio fijo|otro","documentos_externos_referenciados":"lista de documentos mencionados pero no adjuntos o NO ENCONTRADO","forma_pago":"...","fuente":${fe}},
  "cronograma": [{"evento":"...","fecha":"...","hora":"...","texto_literal_pliego":"EXACTO","fuente":${fe}}],
  "requisitos_juridicos_habilitantes": [{"id":"RJ-001","nombre_requisito":"...","texto_literal_pliego":"EXACTO","numeral":"...","capitulo":"...","subsanable":"SÍ|NO|NO ESPECIFICADO EN EL DOCUMENTO","documento_soporte_requerido":"...","nivel_riesgo":"ALTO|MEDIO|BAJO","analisis_controlado":"...","fuente":${fe}}],
  "requisitos_financieros_habilitantes": [{"id":"RF-001","nombre_requisito":"...","texto_literal_pliego":"EXACTO","subsanable":"...","nivel_riesgo":"...","analisis_controlado":"...","fuente":${fe}}],
  "requisitos_organizacionales_habilitantes": [{"id":"RO-001","nombre_requisito":"...","texto_literal_pliego":"EXACTO","subsanable":"...","nivel_riesgo":"...","analisis_controlado":"...","fuente":${fe}}],
  "requisitos_tecnicos_habilitantes": [{"id":"RT-001","nombre_requisito":"...","texto_literal_pliego":"EXACTO","subsanable":"...","nivel_riesgo":"...","analisis_controlado":"...","fuente":${fe}}],
  "experiencia_habilitante": [{"id":"EX-001","nombre_requisito":"...","texto_literal_pliego":"EXACTO","tipo_experiencia":"...","actividades_aceptadas":"...","valor_minimo":"...","numero_contratos":"...","periodo":"...","subsanable":"...","nivel_riesgo":"...","analisis_controlado":"...","fuente":${fe}}],
  "especificaciones_tecnicas_servicio": [{"id":"ET-001","nombre_especificacion":"...","texto_literal_pliego":"EXACTO","obligatoriedad":"obligatorio|deseable|opcional","nivel_riesgo":"...","analisis_controlado":"...","fuente":${fe}}],
  "criterios_evaluacion_puntaje": [{"id":"CE-001","nombre_criterio":"...","texto_literal_pliego":"EXACTO","puntaje_maximo":0,"tipo_evaluacion":"técnico|económico|calidad|experiencia|otro","formula_aplicable":"...","nivel_riesgo":"...","analisis_controlado":"...","fuente":${fe}}],
  "criterios_desempate": [{"id":"CD-001","nombre_criterio":"...","texto_literal_pliego":"EXACTO","orden_aplicacion":0,"fuente":${fe}}],
  "causales_rechazo": [{"id":"CR-001","nombre_causal":"...","texto_literal_pliego":"EXACTO","subsanable":"SÍ|NO|NO ESPECIFICADO EN EL DOCUMENTO","consecuencia":"rechazo|descalificación|otro","nivel_riesgo":"...","analisis_controlado":"...","fuente":${fe}}],
  "reglas_subsanabilidad": [{"id":"RS-001","nombre_regla":"...","texto_literal_pliego":"EXACTO","aplica_a":"...","plazo_subsanacion":"...","fuente":${fe}}],
  "garantias": [{"id":"GA-001","nombre_garantia":"...","texto_literal_pliego":"EXACTO","tipo_garantia":"seriedad_oferta|cumplimiento|pago_salarios|calidad|responsabilidad_civil|estabilidad_obra|buen_manejo_anticipo|otro","monto_cobertura":"porcentaje o valor exacto del pliego","plazo_vigencia":"vigencia exacta","momento_entrega":"cuándo debe entregarse","tomador":"quién debe ser el tomador o NO ENCONTRADO EN EL DOCUMENTO FUENTE","asegurado":"quién debe ser el asegurado o NO ENCONTRADO EN EL DOCUMENTO FUENTE","beneficiario":"quién debe ser el beneficiario o NO ENCONTRADO EN EL DOCUMENTO FUENTE","objeto_asegurado":"objeto asegurado o NO ENCONTRADO EN EL DOCUMENTO FUENTE","exige_comprobante_pago":"SÍ|NO|NO ESPECIFICADO EN EL DOCUMENTO","plazo_entrega_poliza":"plazo para entregar la póliza o NO ENCONTRADO","consecuencia_no_entrega":"consecuencia si no se entrega a tiempo o NO ENCONTRADO","consecuencia_incumplimiento":"...","nivel_riesgo":"...","analisis_controlado":"...","fuente":${fe}}],
  "inhabilidades_incompatibilidades": [{"id":"II-001","requisito":"nombre del requisito o inhabilidad","tipo":"inhabilidad|incompatibilidad|conflicto_interes|prohibicion|antecedente_fiscal|antecedente_disciplinario|antecedente_judicial|lista_restrictiva|sancion_vigente|otro","texto_literal_pliego":"EXACTO","documento_soporte":"documento requerido o NO ENCONTRADO EN EL DOCUMENTO FUENTE","pagina":"...","numeral":"...","nivel_riesgo":"ALTO|MEDIO|BAJO","impacto_practico":"impacto práctico para el oferente","observacion":"...","fuente":${fe}}],
  "estampillas_impuestos_retenciones": [{"id":"EI-001","concepto":"nombre del impuesto, estampilla o retención","tipo":"estampilla|impuesto|tasa|contribucion|retencion|descuento|costo_legalizacion|publicacion|otro","porcentaje_o_valor":"exacto o NO ENCONTRADO EN EL DOCUMENTO FUENTE","base_calculo":"base de cálculo o NO ENCONTRADO","responsable_pago":"contratista|entidad|compartido","momento_pago":"cuándo se paga o NO ENCONTRADO","consecuencia_no_pago":"consecuencia o NO ENCONTRADO","texto_literal_pliego":"EXACTO","pagina":"...","numeral":"...","impacto_economico":"impacto económico sobre el contrato","fuente":${fe}}],
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
  "riesgos_contractuales": [{"id":"RI-001","nombre_riesgo":"...","texto_literal_pliego":"EXACTO","tipo_riesgo":"de la entidad|del contratista|compartido|externo","nivel_riesgo":"...","mitigacion_pliego":"...","analisis_controlado":"...","fuente":${fe}}],
  "acuerdos_comerciales": [{"id":"AC-001","nombre_acuerdo":"...","texto_literal_pliego":"EXACTO","aplica_para":"...","fuente":${fe}}],
  "anexos_formatos_matrices_formularios": [{"id":"AN-001","nombre_anexo":"...","texto_literal_pliego":"EXACTO","tipo":"formato|matriz|formulario|otro","obligatorio":"SÍ|NO|NO ESPECIFICADO","fuente":${fe}}],
  "alertas": [{"id":"AL-001","tipo_alerta":"documental|jurídica|financiera|técnica|económica|contractual|operativa","titulo":"...","texto_literal_pliego":"EXACTO","descripcion_alerta":"...","impacto_potencial":"...","nivel_riesgo":"ALTO|MEDIO|BAJO","accion_recomendada":"...","fuente":${fe}},
  "resumen_ejecutivo_experto": {
    "que_contrata": "Parrafo experto 3-5 oraciones sobre que busca contratar la entidad, que servicio/obra/suministro se contrata y cual es la necesidad que lo justifica",
    "tipo_proponente": "Parrafo sobre que tipo de empresa o persona puede participar segun el objeto, modalidad y requisitos identificados en este bloque",
    "puntos_sensibles": "Parrafo sobre los 2-3 puntos mas criticos del proceso: experiencia exigida, garantias, causales de rechazo, cargas economicas, con lenguaje de analista experto en contratacion estatal colombiana",
    "validaciones_previas": "Parrafo sobre que debe validar el equipo antes de presentar oferta: contratos de experiencia, personal minimo, documentos juridicos, capacidad financiera",
    "conclusion": "Parrafo prudente sobre viabilidad de participacion con base UNICAMENTE en lo encontrado en este bloque. No hacer conclusiones absolutas si falta informacion critica."
  }
}`;
}

// ── Gemini por bloque ─────────────────────────────────────────────────────────

const MODELOS = ['gemini-2.5-flash', 'gemini-2.5-pro'] as const;

async function llamarGeminiBloque(
  client: GoogleGenerativeAI,
  bloque: BloqueTexto,
  totalBloques: number,
  nombreDoc: string,
  tipoDoc: string,
  usuarioId?: number | null,
): Promise<{ resultado: ResultadoBloquePC; tokensIn: number; tokensOut: number; ok: boolean }> {
  const prompt = buildPrompt(bloque, totalBloques, nombreDoc, tipoDoc);
  const promptFull = `${prompt}\n\n---\nTEXTO DEL BLOQUE:\n${bloque.textoConMarcadores}`;

  for (const modelId of MODELOS) {
    try {
      const model = client.getGenerativeModel({ model: modelId, generationConfig: { maxOutputTokens: 16000, responseMimeType: 'application/json', temperature: 0.05 } });
      const result = await model.generateContent([promptFull]);
      const resp = result.response;
      const text = resp.text();
      const tokensIn = resp.usageMetadata?.promptTokenCount ?? 0;
      const tokensOut = resp.usageMetadata?.candidatesTokenCount ?? 0;
      registrarUso({ modelo: modelId, endpoint: 'lectura/analizar-proceso-completo', tokensIn, tokensOut, usuarioId });
      if (!text?.trim()) throw new Error('Gemini vacío');
      return { resultado: parsearJSON(text, `${nombreDoc.slice(0, 20)}_b${bloque.numeroBloque}`), tokensIn, tokensOut, ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[pc] ${modelId} bloque${bloque.numeroBloque}: ${msg.slice(0, 200)}`);
      if (/429|RESOURCE_EXHAUSTED|503|overloaded/.test(msg)) await new Promise(r => setTimeout(r, 3_000));
    }
  }
  return { resultado: {}, tokensIn: 0, tokensOut: 0, ok: false };
}

// ── Consolidación ─────────────────────────────────────────────────────────────

function normTxt(s: string | undefined | null): string {
  if (!s) return '';
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function dedup(items: ItemPC[], prioridadDedup: number, mapaDedup: Map<string, { idx: number; prioridad: number }>): ItemPC[] {
  const result: ItemPC[] = [];
  for (const item of items) {
    const f = item.fuente as FuenteConDoc | undefined;
    const pageKey = f?.hoja ? `h:${f.hoja}` : String(f?.pagina_inicial ?? '');
    const key = normTxt(item.texto_literal_pliego) + '|' + pageKey;
    if (!key.trim()) { result.push(item); continue; }
    const existing = mapaDedup.get(key);
    if (!existing) {
      mapaDedup.set(key, { idx: result.length, prioridad: prioridadDedup });
      result.push(item);
    } else if (prioridadDedup < existing.prioridad) {
      result.splice(existing.idx, 1, item);
      mapaDedup.set(key, { idx: existing.idx, prioridad: prioridadDedup });
    }
  }
  return result;
}

function consolidarPC(resultadosPorDoc: DocResultado[], codigoProceso: string): Record<string, unknown> {
  const ARRAY_KEYS: Array<keyof ResultadoBloquePC> = [
    'cronograma', 'requisitos_juridicos_habilitantes', 'requisitos_financieros_habilitantes',
    'requisitos_organizacionales_habilitantes', 'requisitos_tecnicos_habilitantes',
    'experiencia_habilitante', 'especificaciones_tecnicas_servicio', 'criterios_evaluacion_puntaje',
    'criterios_desempate', 'causales_rechazo', 'reglas_subsanabilidad', 'garantias',
    'riesgos_contractuales', 'acuerdos_comerciales', 'anexos_formatos_matrices_formularios', 'alertas',
    'inhabilidades_incompatibilidades', 'estampillas_impuestos_retenciones',
  ];
  const PREFIJOS: Record<string, string> = {
    cronograma: 'CR', requisitos_juridicos_habilitantes: 'RJ', requisitos_financieros_habilitantes: 'RF',
    requisitos_organizacionales_habilitantes: 'RO', requisitos_tecnicos_habilitantes: 'RT',
    experiencia_habilitante: 'EX', especificaciones_tecnicas_servicio: 'ET', criterios_evaluacion_puntaje: 'CE',
    criterios_desempate: 'CD', causales_rechazo: 'CAR', reglas_subsanabilidad: 'RS', garantias: 'GA',
    riesgos_contractuales: 'RI', acuerdos_comerciales: 'AC', anexos_formatos_matrices_formularios: 'AN', alertas: 'AL',
    inhabilidades_incompatibilidades: 'II', estampillas_impuestos_retenciones: 'EI',
  };
  const ALL_MINUTA_KEYS = [
    'forma_pago', 'obligaciones_contratista', 'obligaciones_entidad',
    'obligaciones_supervisor_interventor', 'supervision_interventoria',
    'seguridad_social_parafiscales', 'estabilidad_laboral_personal',
    'multas', 'procedimiento_multas_sanciones', 'pena_pecuniaria_clausula_penal',
    'multas_sanciones_clausula_penal',
    'garantias_contractuales', 'polizas_requisitos_pago', 'amparos',
    'indemnidad', 'cesion_subcontratacion', 'confidencialidad',
    'laft_sarlaft_listas', 'caso_fortuito_fuerza_mayor', 'solucion_controversias',
    'terminacion', 'liquidacion', 'terminacion_liquidacion',
    'perfeccionamiento_requisitos_ejecucion', 'ans_niveles_servicio', 'otros',
  ] as const;

  const docsSorted = [...resultadosPorDoc].sort((a, b) => a.prioridadDedup - b.prioridadDedup);

  let fichaGeneral: Record<string, unknown> | null = null;
  for (const r of docsSorted) {
    for (const b of r.bloques) {
      if (b.ficha_general_proceso) {
        const f = b.ficha_general_proceso as Record<string, unknown>;
        if (f.objeto && f.objeto !== 'NO ENCONTRADO EN EL DOCUMENTO FUENTE') { fichaGeneral = f; break; }
        if (!fichaGeneral) fichaGeneral = f;
      }
    }
    if (fichaGeneral?.objeto && String(fichaGeneral.objeto) !== 'NO ENCONTRADO EN EL DOCUMENTO FUENTE') break;
  }

  const secciones: Record<string, ItemPC[]> = {};
  for (const key of ARRAY_KEYS) {
    const mapaDedup = new Map<string, { idx: number; prioridad: number }>();
    const acumulado: ItemPC[] = [];
    for (const r of docsSorted) {
      for (const bloque of r.bloques) {
        const arr = bloque[key];
        if (Array.isArray(arr)) acumulado.push(...dedup(arr as ItemPC[], r.prioridadDedup, mapaDedup));
      }
    }
    secciones[key] = acumulado.map((item, i) => ({ ...item, id: `${PREFIJOS[key] ?? 'X'}-${String(i + 1).padStart(3, '0')}` }));
  }

  const minuta: Record<string, ItemPC[]> = {};
  for (const k of ALL_MINUTA_KEYS) {
    const all: ItemPC[] = [];
    const mapa = new Map<string, { idx: number; prioridad: number }>();
    for (const r of docsSorted) {
      for (const b of r.bloques) {
        const m = b.minuta_condiciones_contractuales;
        if (m && Array.isArray(m[k])) all.push(...dedup(m[k] as ItemPC[], r.prioridadDedup, mapa));
      }
    }
    minuta[k] = all;
  }

  const cntMinuta = (...keys: string[]) => keys.reduce((a, k) => a + (minuta[k]?.length ?? 0), 0);
  const siNo = (n: number) => n > 0 ? 'SÍ' : 'NO_ENCONTRADO';
  const totalMinutaItems = Object.values(minuta).reduce((a, arr) => a + arr.length, 0);
  const validacionContractual = {
    se_reviso_minuta: 'SÍ',
    se_extrajeron_obligaciones_contratista: siNo(cntMinuta('obligaciones_contratista')),
    se_extrajeron_multas: siNo(cntMinuta('multas', 'multas_sanciones_clausula_penal')),
    se_extrajo_procedimiento_sancionatorio: siNo(cntMinuta('procedimiento_multas_sanciones')),
    se_extrajo_pena_pecuniaria: siNo(cntMinuta('pena_pecuniaria_clausula_penal')),
    se_extrajo_cesion_subcontratacion: siNo(cntMinuta('cesion_subcontratacion')),
    se_extrajo_indemnidad: siNo(cntMinuta('indemnidad')),
    se_extrajo_solucion_controversias: siNo(cntMinuta('solucion_controversias')),
    se_extrajo_terminacion: siNo(cntMinuta('terminacion', 'terminacion_liquidacion')),
    se_extrajo_liquidacion: siNo(cntMinuta('liquidacion', 'terminacion_liquidacion')),
    se_extrajeron_garantias_y_polizas: siNo(cntMinuta('garantias_contractuales', 'polizas_requisitos_pago', 'amparos')),
    se_extrajo_recibo_pago_poliza_si_aplica: cntMinuta('polizas_requisitos_pago') > 0 ? 'SÍ' : 'NO_APLICA',
    estado_analisis_contractual: totalMinutaItems === 0 ? 'ANALISIS_CONTRACTUAL_INCOMPLETO' : 'COMPLETO',
    advertencias: totalMinutaItems === 0 ? ['No se encontraron cláusulas contractuales. Verificar si los documentos incluyen minuta o condiciones contractuales.'] : [],
  };

  const docsAnalizados = resultadosPorDoc.map(r => ({ nombre: r.nombreDoc, tipo: r.tipoDoc }));

  // Consolidar resumen ejecutivo experto (tomar el valor más largo por campo)
  const resumenExperto: Record<string, string> = {};
  for (const r of docsSorted) {
    for (const b of r.bloques) {
      const re = b.resumen_ejecutivo_experto;
      if (re && typeof re === 'object') {
        for (const [k, v] of Object.entries(re)) {
          if (typeof v === 'string' && v.trim().length > (resumenExperto[k]?.length ?? 0)) {
            resumenExperto[k] = v.trim();
          }
        }
      }
    }
  }

  return {
    codigo_proceso: codigoProceso,
    documentos_analizados: docsAnalizados,
    bloques_procesados: resultadosPorDoc.reduce((acc, r) => acc + r.bloques.length, 0),
    ficha_general_proceso: fichaGeneral ?? {},
    ...secciones,
    resumen_ejecutivo_experto: resumenExperto,
    minuta_condiciones_contractuales: minuta,
    validacion_contractual: validacionContractual,
    validacion_final: {
      documentos_revisados: docsAnalizados.length,
      advertencias: resultadosPorDoc.flatMap(r => r.advertencias),
      observacion_final: `Análisis consolidado de ${docsAnalizados.length} documento(s) del proceso ${codigoProceso}.`,
    },
  };
}

// ── Procesador en segundo plano ───────────────────────────────────────────────

async function procesarEnSegundoPlano(
  analisisId: number,
  docsAAnalizar: DocInput[],
  codigoProceso: string,
  apiKey: string,
  usuarioId?: number | null,
): Promise<void> {
  const client = new GoogleGenerativeAI(apiKey);
  const CONCURRENCIA = 3;
  const resultadosPorDoc: DocResultado[] = [];
  let totalTokensIn = 0;
  let totalTokensOut = 0;

  try {
    for (const docInfo of docsAAnalizar) {
      if (!docInfo.url?.trim()) continue;

      const prioridadDedup = docInfo.prioridadDedup ?? docInfo.prioridad;
      const tipoFuente = detectarTipoFuente(docInfo.nombre, docInfo.url);

      if (tipoFuente === 'otro') {
        resultadosPorDoc.push({ nombreDoc: docInfo.nombre, tipoDoc: docInfo.tipo, prioridad: docInfo.prioridad, prioridadDedup, bloques: [], advertencias: [`Formato no soportado para "${docInfo.nombre}".`] });
        continue;
      }

      let buf: Buffer;
      try {
        buf = await descargar(docInfo.url);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        resultadosPorDoc.push({ nombreDoc: docInfo.nombre, tipoDoc: docInfo.tipo, prioridad: docInfo.prioridad, prioridadDedup, bloques: [], advertencias: [`Descarga fallida "${docInfo.nombre}": ${msg}`] });
        continue;
      }

      let bloques: BloqueTexto[] = [];
      let advertencias: string[] = [];

      if (tipoFuente === 'word') {
        const res = await extraerWord(buf, docInfo.nombre);
        advertencias = res.advertencias;
        if (!res.texto.trim()) { resultadosPorDoc.push({ nombreDoc: docInfo.nombre, tipoDoc: docInfo.tipo, prioridad: docInfo.prioridad, prioridadDedup, bloques: [], advertencias }); continue; }
        bloques = dividirTextoEnBloques(res.texto, 'word');
      } else if (tipoFuente === 'excel') {
        const res = await extraerExcel(buf, docInfo.nombre);
        advertencias = res.advertencias;
        if (!res.texto.trim()) { resultadosPorDoc.push({ nombreDoc: docInfo.nombre, tipoDoc: docInfo.tipo, prioridad: docInfo.prioridad, prioridadDedup, bloques: [], advertencias }); continue; }
        bloques = dividirTextoEnBloques(res.texto, 'excel', res.hojas);
      } else {
        const extRes = await extraerPdfTexto(buf);
        advertencias = extRes.advertencias;
        if (!extRes.paginas.length) { resultadosPorDoc.push({ nombreDoc: docInfo.nombre, tipoDoc: docInfo.tipo, prioridad: docInfo.prioridad, prioridadDedup, bloques: [], advertencias: [...extRes.advertencias, `"${docInfo.nombre}": PDF sin texto.`] }); continue; }
        bloques = dividirPaginasEnBloques(extRes.paginas);
        if (extRes.metodo === 'document_ai_ocr') {
          const hashCorto = createHash('sha256').update(buf.subarray(0, 8192)).digest('hex').slice(0, 12);
          void auditLog({ accion: 'document_ai_ocr_usado', recurso: 'lectura/document-ai-ocr', usuarioId, detalle: { nombreDocumento: docInfo.nombre, hashCorto, totalPaginas: extRes.totalPaginas, totalChars: extRes.paginas.map((p: { texto: string }) => p.texto).join('').length, metodoExtraccion: 'document_ai_ocr', paginasOcr: extRes.paginas.filter((p: { texto: string }) => p.texto.trim().length > 0).length } });
        }
        console.log(`[pc:bg] PDF "${docInfo.nombre}": ${extRes.paginas.length} págs | ${bloques.length} bloques | ${extRes.metodo}`);
      }

      const bloquesResultados: ResultadoBloquePC[] = new Array(bloques.length).fill({});

      for (let i = 0; i < bloques.length; i += CONCURRENCIA) {
        const lote = bloques.slice(i, i + CONCURRENCIA);
        const resultados = await Promise.allSettled(lote.map(b => llamarGeminiBloque(client, b, bloques.length, docInfo.nombre, docInfo.tipo, usuarioId)));
        for (let j = 0; j < resultados.length; j++) {
          const res = resultados[j];
          if (res.status === 'fulfilled') {
            bloquesResultados[i + j] = res.value.resultado;
            totalTokensIn += res.value.tokensIn;
            totalTokensOut += res.value.tokensOut;
          }
        }
        if (i + CONCURRENCIA < bloques.length) await new Promise(r => setTimeout(r, 1_200));
      }

      resultadosPorDoc.push({ nombreDoc: docInfo.nombre, tipoDoc: docInfo.tipo, prioridad: docInfo.prioridad, prioridadDedup, bloques: bloquesResultados, advertencias });
    }

    if (!resultadosPorDoc.some(r => r.bloques.length > 0)) {
      await prisma.lecturaAnalisis.update({
        where: { id: analisisId },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { resultado: { estado: 'ERROR', mensaje: 'Ningún documento fue procesado exitosamente.' } as any },
      });
      return;
    }

    const resultadoFinal = consolidarPC(resultadosPorDoc, codigoProceso);
    const entidadStr = String((resultadoFinal.ficha_general_proceso as Record<string, unknown>)?.entidad ?? '').slice(0, 500) || null;

    await prisma.lecturaAnalisis.update({
      where: { id: analisisId },
      data: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        resultado: { estado: 'COMPLETADO', ...(resultadoFinal as object) } as any,
        tokensEntrada: totalTokensIn || null,
        tokensSalida: totalTokensOut || null,
        entidad: entidadStr,
      },
    });

    console.log(`[pc:bg] Análisis ${analisisId} COMPLETADO. Docs: ${resultadosPorDoc.filter(r => r.bloques.length > 0).length}. Tokens: in=${totalTokensIn}, out=${totalTokensOut}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[pc:bg] Error en análisis ${analisisId}: ${msg}`);
    try {
      await prisma.lecturaAnalisis.update({
        where: { id: analisisId },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { resultado: { estado: 'ERROR', mensaje: msg.slice(0, 500) } as any },
      });
    } catch (dbErr) {
      console.error('[pc:bg] Error guardando ERROR en BD:', dbErr);
    }
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 });

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: false, error: 'GOOGLE_AI_API_KEY no configurada.' }, { status: 503 });

  let body: { codigoProceso?: string; documentos?: DocInput[]; incluirFormatos?: boolean; forzarReanalisis?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Body inválido.' }, { status: 400 }); }

  const { codigoProceso = '', documentos = [], incluirFormatos = false, forzarReanalisis = false } = body;

  if (!documentos.length) return NextResponse.json({ ok: false, error: 'Se requiere al menos un documento.' }, { status: 400 });

  const docsAAnalizar = incluirFormatos
    ? documentos
    : documentos.filter(d => d.tipo !== 'FORMATO_OBLIGATORIO' && d.tipo !== 'AVISO_CONVOCATORIA');

  if (!docsAAnalizar.length) return NextResponse.json({ ok: false, error: 'No hay documentos analizables luego del filtro.' }, { status: 400 });

  const seleccionHash = createHash('sha256').update(
    JSON.stringify({
      codigoProceso: codigoProceso || '',
      incluirFormatos,
      docs: docsAAnalizar.map(d => ({ url: d.url.trim(), tipo: d.tipo })).sort((a, b) => a.url.localeCompare(b.url)),
    })
  ).digest('hex');

  // Resolver usuarioId real antes de cualquier consulta de propiedad
  const usuarioId = await resolveSessionUserId(session!);
  if (usuarioId === null) {
    return NextResponse.json(
      { ok: false, error: 'Sesión inválida. Inicie sesión nuevamente.' },
      { status: 401 }
    );
  }

  // Buscar registro existente
  if (!forzarReanalisis) {
    try {
      const existente = await prisma.lecturaAnalisis.findFirst({
        where: {
          codigoProceso: codigoProceso || null,
          modo: 'proceso_completo',
          pdfHash: seleccionHash,
          ...(isAdmin(session.rol) ? {} : { usuarioId }),
        },
        orderBy: { creadoEn: 'desc' },
      });
      if (existente) {
        const res = existente.resultado as { estado?: string } | null;
        const estadoExistente = String(res?.estado ?? 'COMPLETADO');

        if (estadoExistente === 'COMPLETADO') {
          void auditFromRequest(req, session, { accion: 'analisis_proceso_completo', recurso: 'lectura_analisis', recursoId: String(existente.id), detalle: { modo: 'proceso_completo', codigoProceso: codigoProceso || null, cache: true } });
          return NextResponse.json({ ok: true, cached: true, estado: 'COMPLETADO', analisisId: existente.id, resultado: existente.resultado, tokens: { entrada: existente.tokensEntrada, salida: existente.tokensSalida } });
        }
        if (estadoExistente === 'PROCESANDO') {
          const msElapsed = Date.now() - existente.creadoEn.getTime();
          if (msElapsed < 12 * 60 * 1000) {
            return NextResponse.json({ ok: true, estado: 'PROCESANDO', analisisId: existente.id, seleccionHash, mensaje: 'El análisis ya está en proceso. La pantalla consultará el avance automáticamente.' });
          }
          // Stale (>12 min) → crear nuevo registro
        }
        // ERROR o PROCESANDO obsoleto → caer al bloque de creación
      }
    } catch (cacheErr) {
      // Loguear para diagnóstico — no debe bloquear, pero necesitamos saber si falla
      console.warn('[analizar-proceso-completo] Error en búsqueda de caché (continuando):', {
        errorMessage: (cacheErr as Error)?.message?.slice(0, 200),
        codigoProceso,
      });
    }
  }

  // ── Rate limit — solo si no hay caché ni análisis PROCESANDO activo ──────────
  const rlC = await checkGeminiRateLimitPg(usuarioId, 'completo');
  if (rlC.bloqueado) {
    return NextResponse.json({ ok: false, error: `Límite diario de análisis completo alcanzado (${rlC.usos}/${rlC.limite}). Intente mañana.` }, { status: 429 });
  }

  void recordGeminiUsagePg(usuarioId, 'completo');

  // Crear registro PROCESANDO
  let analisisId: number;
  try {
    const registro = await prisma.lecturaAnalisis.create({
      data: {
        nombreDocumento: `ANÁLISIS COMPLETO — ${codigoProceso || 'PROCESO'}`,
        urlDocumento: null,
        pdfHash: seleccionHash,
        modo: 'proceso_completo',
        pdfBlob: null,
        codigoProceso: codigoProceso || null,
        entidad: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        resultado: { estado: 'PROCESANDO', seleccionHash, mensaje: 'Análisis consolidado en proceso', documentos: docsAAnalizar.map(d => ({ nombre: d.nombre, tipo: d.tipo })) } as any,
        tokensEntrada: null,
        tokensSalida: null,
        usuarioId,
      },
    });
    analisisId = registro.id;
  } catch (dbErr) {
    const prismaCode = (dbErr as { code?: string })?.code;
    const prismaMeta = (dbErr as { meta?: unknown })?.meta;
    const errMsg     = dbErr instanceof Error ? dbErr.message.slice(0, 300) : String(dbErr).slice(0, 300);
    console.error('[analizar-proceso-completo] Error creando LecturaAnalisis', {
      errorName:    (dbErr as Error)?.name,
      errorCode:    prismaCode,
      errorMeta:    prismaMeta,
      errorMessage: errMsg,
      codigoProceso,
      usuarioId,
      docsCount:    docsAAnalizar?.length,
    });
    return NextResponse.json(
      { ok: false, error: 'No fue posible iniciar el análisis. Verifique la sesión y la configuración de base de datos.' },
      { status: 500 }
    );
  }

  // Lanzar procesamiento en segundo plano (fire-and-forget, funciona en un entorno Node.js persistente)
  Promise.resolve().then(() =>
    procesarEnSegundoPlano(analisisId, docsAAnalizar, codigoProceso, apiKey, usuarioId)
      .catch(err => console.error('[pc:bg] Uncaught:', err))
  );

  void auditFromRequest(req, session, { accion: 'analisis_proceso_completo', recurso: 'lectura_analisis', recursoId: String(analisisId), detalle: { modo: 'proceso_completo', codigoProceso: codigoProceso || null, cache: false, documentosCount: docsAAnalizar.length } });

  return NextResponse.json({
    ok: true,
    estado: 'PROCESANDO',
    analisisId,
    seleccionHash,
    mensaje: 'El análisis se está ejecutando. La pantalla consultará el avance automáticamente.',
  });
}