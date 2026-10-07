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
import { detectarTipoArchivo } from '@/lib/lectura/extractors/detectar-tipo-archivo';
import { extraerPdfTexto, documentAiEnabled } from '@/lib/lectura/extractors/extraer-pdf-texto';
import { extraerWord } from '@/lib/lectura/extractors/extraer-word';
import { extraerExcel } from '@/lib/lectura/extractors/extraer-excel';
import prisma from '@/lib/prisma';

function inferTipoDesdeNombre(nombre: string | null | undefined): string | null {
  if (!nombre) return null;
  const ext = nombre.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx') return 'docx';
  if (ext === 'doc') return 'doc';
  return null;
}

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// ── Extracción inteligente de texto ──────────────────────────────────────────

const SECCIONES_CLAVE = [
  'objeto del contrato', 'objeto contractual', 'descripcion del objeto',
  'presupuesto oficial', 'valor estimado', 'valor del contrato', 'cuantia',
  'requisitos habilitantes', 'capacidad juridica', 'capacidad financiera',
  'capacidad organizacional', 'capacidad tecnica',
  'criterios de evaluacion', 'factores de evaluacion', 'ponderacion',
  'puntaje', 'formula de evaluacion', 'metodo de evaluacion',
  'cronograma', 'fechas', 'calendario del proceso',
  'forma de pago', 'condiciones de pago',
  'plazo de ejecucion', 'duracion del contrato',
  'experiencia requerida', 'experiencia acreditada',
  'tipo de proceso', 'modalidad de seleccion',
];

function _extractSmartText(fullText: string, maxChars: number): { texto: string; origLen: number } {
  if (fullText.length <= maxChars) return { texto: fullText, origLen: fullText.length };

  const HEAD = Math.floor(maxChars * 0.45);
  const head = fullText.slice(0, HEAD);
  const body = fullText.slice(HEAD);
  const bodyLow = body.toLowerCase();

  const covered = new Set<number>();
  const snippets: string[] = [];
  let extraLen = 0;
  const remaining = maxChars - head.length;

  for (const kw of SECCIONES_CLAVE) {
    if (extraLen >= remaining) break;
    let pos = 0;
    while (pos < bodyLow.length && extraLen < remaining) {
      const idx = bodyLow.indexOf(kw, pos);
      if (idx === -1) break;
      const start = Math.max(0, idx - 200);
      const end = Math.min(body.length, idx + 1_800);
      const blockKey = Math.floor(start / 500);
      if (!covered.has(blockKey)) {
        covered.add(blockKey);
        const snip = body.slice(start, end);
        snippets.push(snip);
        extraLen += snip.length;
      }
      pos = idx + 1_800;
    }
  }

  const texto = (head + (snippets.length ? '\n[...]\n' + snippets.join('\n[...]\n') : '')).slice(0, maxChars);
  return { texto, origLen: fullText.length };
}

// ── Prompts divididos por parte ───────────────────────────────────────────────

const MAX_OUTPUT_POR_PARTE = 16000;

const PROMPT_PARTE1 = `Eres experto en contratación pública colombiana. Analiza el pliego y responde ÚNICAMENTE con JSON válido. Sin texto, sin markdown, sin explicaciones fuera del JSON.

══ REGLAS ABSOLUTAS — SIN EXCEPCIÓN ══════════════════════════════════════
R1. PROHIBIDO inventar datos. Si un campo no está EXPLÍCITAMENTE en el documento → usa null (strings) o [] (arrays). No estimes, no infieras, no supongas.
R2. PROHIBIDO usar: "aproximadamente", "se presume", "podría", "normalmente", "debería", "estimado" ni ningún término que indique suposición.
R3. FECHAS — NUNCA uses formato con "XX" (ej: "2026-05-XX" está prohibido). Reglas exactas:
    • Fecha completa → YYYY-MM-DD
    • Solo mes y año → texto en español: "mayo de 2026 - día no identificado en el documento"
    • Solo año → "año 2026 - mes y día no identificados en el documento"
    • Fecha remite a SECOP → "Ver SECOP - fecha no especificada en este documento"
R4. PRESUPUESTO — Busca TODAS estas expresiones: "presupuesto oficial", "presupuesto estimado", "valor del contrato", "valor estimado del contrato", "disponibilidad presupuestal", "CDP", "cuantía del proceso", "monto máximo", "techo presupuestal". Si encuentras alguna → extrae el número entero puro (ej: 150000000). Solo usa null si NO aparece ningún valor económico asociado al contrato en TODO el documento.
R5. FUENTES — fragmento debe ser texto LITERAL del documento, máximo 80 caracteres. Incluir número de página si aparece.
R6. VALORES ECONÓMICOS — Si encuentras cualquier cifra en el documento (presupuesto, garantías, multas, experiencia, anticipo), listarlos todos en valoresEconomicosDetectados.
══════════════════════════════════════════════════════════════════════════

{
  "objeto": "descripción del objeto contractual exactamente como aparece en el pliego, o null si no se encuentra",
  "entidad": "nombre exacto de la entidad contratante como aparece en el pliego, o null",
  "presupuesto": 150000000,
  "moneda": "COP",
  "plazo": "plazo de ejecución exactamente como aparece en el pliego (ej: '6 meses'), o null",
  "lugar_ejecucion": "ciudad, municipio, departamento o región exacta, o null",
  "tipo_proceso": "licitacion_publica|seleccion_abreviada|concurso_meritos|contratacion_directa|minima_cuantia|regimen_especial|otro|null",
  "forma_pago": "condiciones de pago exactas como aparecen en el pliego, o null",
  "resumen": "2-3 oraciones precisas: qué se contrata, quién contrata, valor si se encontró (o 'valor no identificado en el documento' si falta), y perfil del oferente requerido. NUNCA inventes datos ausentes.",
  "fechas_clave": [
    {"evento": "nombre exacto del evento como aparece en el pliego", "fecha": "YYYY-MM-DD o texto descriptivo SIN XX"}
  ],
  "valoresEconomicosDetectados": [
    {
      "tipo": "presupuesto_oficial|valor_estimado|valor_referencia_experiencia|valor_garantia|valor_poliza|valor_multa|anticipo|otro_valor",
      "descripcion": "descripción del valor exactamente como aparece en el pliego",
      "valor": "valor numérico formateado con moneda (ej: $150.000.000 COP)",
      "pagina": "número de página o numeral de sección donde aparece",
      "texto_fuente": "fragmento literal máx 80 chars"
    }
  ],
  "fuentes_texto": [
    {"campo": "objeto", "pagina": "p. X o numeral Y", "fragmento": "texto literal del pliego máx 80 chars", "confianza": "ALTA|MEDIA|BAJA"},
    {"campo": "presupuesto", "pagina": "p. X o numeral Y", "fragmento": "texto literal del pliego máx 80 chars", "confianza": "ALTA|MEDIA|BAJA"},
    {"campo": "plazo", "pagina": "p. X o numeral Y", "fragmento": "texto literal del pliego máx 80 chars", "confianza": "ALTA|MEDIA|BAJA"},
    {"campo": "entidad", "pagina": "p. X o numeral Y", "fragmento": "texto literal del pliego máx 80 chars", "confianza": "ALTA|MEDIA|BAJA"},
    {"campo": "forma_pago", "pagina": "p. X o numeral Y", "fragmento": "texto literal del pliego máx 80 chars", "confianza": "ALTA|MEDIA|BAJA"}
  ]
}

FORMATO FINAL: presupuesto = número entero sin puntos ni comas, o null. Arrays vacíos = []. No omitas ningún campo del JSON.`;

const PROMPT_PARTE2 = `Eres experto en contratación pública colombiana. Analiza el pliego y responde ÚNICAMENTE con JSON válido. Sin texto, sin markdown, sin explicaciones fuera del JSON.

══ REGLAS ABSOLUTAS — SIN EXCEPCIÓN ══════════════════════════════════════
R1. PROHIBIDO inventar requisitos, criterios, garantías o causales. Solo incluye lo que está EXPLÍCITAMENTE en el documento.
R2. PROHIBIDO agrupar varios requisitos en una sola frase genérica. Cada requisito = un ítem independiente con su valor/umbral específico.
R3. PROHIBIDO incluir causales legales externas (ley, decreto) que NO estén citadas en el pliego como causales de rechazo.
R4. CRITERIOS DE EVALUACIÓN:
    • Si el criterio otorga puntaje → puntaje = número exacto del pliego (ej: 100). No estimes.
    • Si el criterio es HABILITANTE y no otorga puntaje → puntaje = "NO APLICA - HABILITANTE".
    • NUNCA uses null, 0 ni string vacío si el pliego indica o no indica puntaje.
    • Siempre incluye el tipo: "puntaje" o "habilitante".
R5. REQUISITOS HABILITANTES: cada ítem debe incluir el valor/umbral/porcentaje que pide el pliego si aparece (ej: "Capital de trabajo mínimo: $500.000.000" o "Índice de liquidez ≥ 1.5"). No resumir genéricamente.
R6. EXPERIENCIA: extraer número de contratos, objeto similar, valor, período de acreditación, documentos válidos. Si un dato no aparece → "no especificado en el pliego" solo para ese sub-dato.
R7. GARANTÍAS: cada amparo va en un ítem separado con porcentaje, base y vigencia. No agrupar varios amparos en un ítem.
R8. CAUSALES: prefijo [RECHAZO], [SUBSANABLE] o [NO SUBSANABLE] según el pliego. Cada causal = ítem independiente.
R9. Usa null para strings ausentes, [] para arrays vacíos, false para booleanos no confirmados.
══════════════════════════════════════════════════════════════════════════

{
  "requisitos_habilitantes": {
    "juridicos": [
      "Cada requisito jurídico como ítem separado — incluir umbrales exactos si el pliego los indica (ej: 'RUP vigente al cierre — clasificación UNSPSC código XXXX, numeral 3.1', 'Certificado de existencia y representación legal — máx 30 días de expedición')"
    ],
    "financieros": [
      "Cada indicador financiero como ítem separado — incluir fórmula y umbral exacto (ej: 'Capital de trabajo ≥ $X — fórmula: Activo corriente - Pasivo corriente, año del balance exigido: XXXX')"
    ],
    "tecnicos": [
      "Cada requisito técnico como ítem separado con especificaciones exactas del pliego"
    ],
    "organizacionales": [
      "Cada requisito organizacional como ítem separado (ej: capacidad de contratación, personal mínimo, equipos)"
    ]
  },
  "experiencia_requerida": "Descripción completa y específica: número mínimo de contratos, objeto similar requerido según el pliego, valor exigido o porcentaje del presupuesto, período de acreditación (ej: últimos 5 años), documentos válidos para acreditar, y reglas para consorcios si aplica. Todo según el pliego. Si no hay experiencia requerida → null.",
  "personal_requerido": ["Cargo — requisitos exactos según el pliego (formación, experiencia, certificaciones)"],
  "documentos_exigidos": [
    "Nombre exacto del documento — tipo (habilitante/soporte/formato/anexo) — observaciones del pliego si aplica"
  ],
  "garantias_polizas": [
    "Nombre del amparo: porcentaje o valor — base de cálculo — vigencia exacta según el pliego (ej: 'Seriedad de la oferta: 10% del presupuesto oficial — vigencia: hasta 6 meses después del cierre')"
  ],
  "obligaciones_contratista": [
    "Descripción específica de cada obligación según el pliego. NO resumir en genérico. Cada obligación = ítem independiente."
  ],
  "causales_rechazo_subsanacion": [
    "[RECHAZO] Descripción exacta de la causal de rechazo según el pliego",
    "[SUBSANABLE] Descripción de lo que es subsanable según el pliego",
    "[NO SUBSANABLE] Descripción de requisito no subsanable según el pliego"
  ],
  "criterios_evaluacion": [
    {
      "criterio": "nombre del criterio exactamente como aparece en el pliego",
      "puntaje": 100,
      "descripcion": "cómo se calcula o acredita según el pliego",
      "tipo": "puntaje|habilitante",
      "formula": "fórmula exacta si aparece en el pliego, o null",
      "documento_soporte": "documento requerido para acreditar este criterio",
      "pagina": "página o numeral del pliego",
      "texto_literal": "fragmento literal del pliego máx 100 chars"
    }
  ],
  "ponderacion_economica": {
    "tiene_ponderacion": false,
    "puntaje_maximo": null,
    "metodos": [{"nombre": "", "tipo_formula": "mediana|media_geometrica|media_geometrica_con_presupuesto|media_aritmetica|media_aritmetica_baja|media_aritmetica_alta|menor_valor", "trm_centavos_desde": -1, "trm_centavos_hasta": -1, "puntaje": 0}]
  },
  "alertas": [
    "Alerta o riesgo ESPECÍFICO para el oferente basado en el pliego — describe el riesgo concreto, no generalices"
  ],
  "conclusion_viabilidad": "Análisis de viabilidad para Grupo Colba (ASEOCOLBA servicios temporales, TEMPOCOLBA y VIGICOLBA vigilancia): indica cuál empresa aplica según el objeto del contrato, por qué, y principales riesgos concretos para participar.",
  "experiencia_extendida": {
    "n_contratos_minimo": "número mínimo de contratos o null",
    "n_contratos_maximo": "número máximo de contratos o null",
    "objeto_similar_pliego": "descripción exacta del objeto similar según el pliego o null",
    "valor_exigido": "valor exacto o null",
    "porcentaje_del_presupuesto": "porcentaje o null",
    "documentos_validos": ["lista de documentos válidos para acreditar experiencia"],
    "periodo_acreditacion": "período de validez (ej: últimos 5 años) o null",
    "reglas_consorcios": "reglas para consorcios o uniones temporales o null",
    "pagina": "página o numeral donde aparece la experiencia",
    "texto_literal": "fragmento literal del pliego máx 100 chars"
  },
  "garantias_extendidas": [
    {
      "amparo": "seriedad_oferta|cumplimiento|calidad_servicio|salarios_prestaciones|responsabilidad_civil|estabilidad_obra|buen_manejo_anticipo|otro",
      "porcentaje_o_valor": "porcentaje o valor exacto según el pliego",
      "base_calculo": "base de cálculo (ej: presupuesto oficial, valor del contrato)",
      "vigencia": "vigencia exacta según el pliego",
      "exige_comprobante_pago": "SI|NO|NO ENCONTRADO EN EL DOCUMENTO FUENTE",
      "plazo_entrega": "plazo para entregar la garantía según el pliego o NO ENCONTRADO EN EL DOCUMENTO FUENTE",
      "consecuencia_no_presentacion": "consecuencia si no se presenta a tiempo o NO ENCONTRADO EN EL DOCUMENTO FUENTE",
      "pagina": "página o numeral"
    }
  ],
  "analisisEjecutivoHumano": "Mínimo 3 párrafos. Explica: (1) qué busca contratar la entidad y qué tipo de empresa puede participar; (2) cuáles son los puntos más sensibles del proceso (experiencia, garantías, criterios de evaluación, documentación); (3) si el proceso parece viable, condicionado o riesgoso para el Grupo Colba, y qué debe validar el equipo antes de ofertar. Escribe como un analista de licitaciones experto, en tono profesional pero claro. NO inventes datos ausentes — si falta información crítica indícalo. Ejemplo de tono: 'El proceso está orientado a contratar una empresa de servicios temporales para suministrar trabajadores en misión. Desde el punto de vista documental, la participación exige especial cuidado en la habilitación jurídica como Empresa de Servicios Temporales, la experiencia específica y las garantías...'",
  "riesgosPrincipales": [
    {
      "categoria": "juridico|financiero|tecnico|operativo|contractual|laboral|economico|documental|comercial",
      "nombre_riesgo": "nombre claro del riesgo",
      "fundamento_en_pliego": "en qué parte del pliego se basa este riesgo",
      "nivel": "CRITICO|ALTO|MEDIO|BAJO|INFORMATIVO",
      "impacto": "qué puede pasar si se materializa el riesgo",
      "accion_preventiva": "qué debe hacer el equipo para prevenir o mitigar este riesgo",
      "pagina": "página o numeral"
    }
  ],
  "alertasHumanas": [
    {
      "titulo": "título breve del alerta",
      "descripcion": "Explicación detallada del alerta: qué es, por qué importa, qué riesgo representa y qué debe revisar el equipo. Mínimo 2-3 oraciones.",
      "texto_literal_relacionado": "fragmento literal del pliego relacionado, máx 120 chars",
      "pagina": "página o numeral",
      "nivel_riesgo": "CRITICO|ALTO|MEDIO|BAJO|INFORMATIVO",
      "accion_preventiva": "acción concreta que debe tomar el equipo"
    }
  ],
  "validacionDeCompletitud": {
    "seRevisoTodoElDocumento": "SI|NO|PARCIAL",
    "camposNoEncontrados": ["campo: motivo por el que no se encontró"],
    "documentosReferenciadosNoSuministrados": ["nombre del documento referenciado en el pliego pero no incluido en la carga"],
    "observacionFinal": "conclusión sobre el nivel de completitud del análisis"
  }
}

LÍMITES DE ÍTEMS POR ARRAY:
• requisitos_habilitantes (por subcategoría): máximo 20
• criterios_evaluacion: máximo 20
• documentos_exigidos: máximo 25
• garantias_polizas: máximo 12
• obligaciones_contratista: máximo 25
• causales_rechazo_subsanacion: máximo 20
• alertas: máximo 10 (strings cortos, 1-2 oraciones por alerta para el panel de chips)
• alertasHumanas: máximo 10 (texto detallado)
• riesgosPrincipales: máximo 12
• personal_requerido: máximo 10

ESTILO DE ESCRITURA:
• alertas: strings de 1-2 oraciones que expliquen el riesgo con contexto, no solo la palabra clave.
• conclusion_viabilidad: mencionar explícitamente qué empresa del Grupo Colba aplica y por qué; si falta información crítica usar "REVISAR" o "NO_DETERMINABLE_POR_INFORMACION_FALTANTE" como conclusión.
• analisisEjecutivoHumano: tono de analista experto, técnico pero entendible, sin inventar datos.`;

// ── Parsing JSON robusto con logging diagnóstico ──────────────────────────────

function parsearJSON(raw: string, etiqueta: string): Record<string, unknown> {
  const rawClean = raw.trim()
    .replace(/^```(?:json|JSON)?\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim();

  // Intento 1: parse directo
  try { return JSON.parse(rawClean) as Record<string, unknown>; } catch { /* continuar */ }

  // Intento 2: extraer bloque {…}
  const jsonMatch = rawClean.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error(`[analizar:${etiqueta}] Sin JSON.`, { rawLen: raw.length, rawSha256: safeHash(raw) });
    throw new Error(`[${etiqueta}] Gemini no devolvió un JSON válido.`);
  }

  // Intento 3: parse del bloque extraído
  try { return JSON.parse(jsonMatch[0]) as Record<string, unknown>; } catch { /* continuar */ }

  // Intento 4: reparar llaves/corchetes desbalanceados
  let fixed = jsonMatch[0];
  let braces = 0, brackets = 0;
  for (const ch of fixed) {
    if (ch === '{') braces++; else if (ch === '}') braces--;
    else if (ch === '[') brackets++; else if (ch === ']') brackets--;
  }
  fixed = fixed.replace(/,\s*$/, '').replace(/,\s*([}\]])/, '$1');
  fixed += ']'.repeat(Math.max(0, brackets)) + '}'.repeat(Math.max(0, braces));
  try { return JSON.parse(fixed) as Record<string, unknown>; } catch {
    console.error(`[analizar:${etiqueta}] JSON irreparable.`, { rawLen: raw.length, rawSha256: safeHash(raw) });
    throw new Error(`[${etiqueta}] JSON truncado o irreparable.`);
  }
}

// ── Llamada a Gemini por parte ────────────────────────────────────────────────

// gemini-2.5-pro como fallback: mejor JSON que flash, aún activo en v1beta
const MODELOS_ANALIZAR = ['gemini-2.5-flash', 'gemini-2.5-pro'] as const;
const TIMEOUT_POR_MODELO_MS = 85_000;

async function llamarGemini(
  client: GoogleGenerativeAI,
  promptFull: string,
  etiqueta: 'parte1' | 'parte2',
): Promise<{ resultado: Record<string, unknown>; tokensEntrada: number | null; tokensSalida: number | null; modeloUsado: string }> {
  let lastErr: unknown;
  for (const modelId of MODELOS_ANALIZAR) {
    // Hasta 2 intentos por modelo antes de pasar al siguiente
    for (let intento = 1; intento <= 2; intento++) {
      try {
        const model = client.getGenerativeModel({
          model: modelId,
          generationConfig: { maxOutputTokens: MAX_OUTPUT_POR_PARTE, responseMimeType: 'application/json', temperature: 0.1 },
        });
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`[${etiqueta}] Timeout ${TIMEOUT_POR_MODELO_MS / 1000}s en ${modelId}`)), TIMEOUT_POR_MODELO_MS)
        );
        const result = await Promise.race([model.generateContent([promptFull]), timeoutPromise]);
        const response = result.response;
        const text = response.text();
        const finishReason = response.candidates?.[0]?.finishReason ?? 'unknown';
        const tokensOut = response.usageMetadata?.candidatesTokenCount ?? 0;
        console.log(`[analizar:${etiqueta}] ${modelId} intento:${intento} | finish: ${finishReason} | tokensOut: ${tokensOut} | textLen: ${text?.length ?? 0}`);
        if (!text?.trim()) throw new Error(`[${etiqueta}] Gemini devolvió respuesta vacía.`);
        const resultado = parsearJSON(text, etiqueta);
        return {
          resultado,
          tokensEntrada: response.usageMetadata?.promptTokenCount ?? null,
          tokensSalida: response.usageMetadata?.candidatesTokenCount ?? null,
          modeloUsado: modelId,
        };
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[analizar:${etiqueta}] ${modelId} intento:${intento} fallado:`, msg.slice(0, 200));
        const esModeloInvalido = msg.includes('404') || msg.includes('not found');
        if (esModeloInvalido) break; // no reintentar con modelo que no existe
        const esCuotaOSobrecarga = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') ||
          msg.includes('503') || msg.includes('overloaded') || msg.includes('high demand');
        if (esCuotaOSobrecarga) {
          await new Promise(r => setTimeout(r, 4_000));
        } else {
          await new Promise(r => setTimeout(r, 1_500)); // pausa corta entre reintentos por JSON inválido
        }
      }
    }
  }
  throw lastErr;
}

// ── Descarga robusta de documento ────────────────────────────────────────────

async function descargarDocumento(url: string): Promise<Buffer> {
  const ssrf = validarUrlAntiSSRF(url);
  if (!ssrf.ok) throw new Error(ssrf.error);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35_000);
  const urlLog = url.split('?')[0] + (url.includes('?') ? '?[params-ocultos]' : '');

  try {
    let resp: Response;
    try {
      console.log('[analizar] Descargando:', urlLog);
      resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept': 'application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/octet-stream,*/*;q=0.8',
          'Accept-Language': 'es-CO,es;q=0.9',
        },
        redirect: 'follow',
        signal: controller.signal,
      });
    } catch (fetchErr) {
      if (controller.signal.aborted) {
        throw new Error('La descarga del documento tardó demasiado. Intenta nuevamente.');
      }
      const raw = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      console.error('[analizar] fetch error:', raw.slice(0, 200));
      throw new Error(`No fue posible descargar el documento desde la URL externa. (${raw})`);
    }

    const ct = resp.headers.get('content-type') ?? '';
    const cl = resp.headers.get('content-length') ?? '?';
    console.log(`[analizar] Respuesta: ${resp.status} | ct: ${ct} | cl: ${cl}`);

    if (resp.status === 403) throw new Error('No fue posible descargar el documento porque el servidor bloqueó el acceso.');
    if (resp.status === 404) throw new Error('No fue posible descargar el documento porque el archivo no existe o el enlace expiró.');
    if (!resp.ok) throw new Error(`HTTP ${resp.status} al descargar el documento.`);

    const toExt = (u: string) => { try { return new URL(u).pathname.toLowerCase().split('.').pop() ?? ''; } catch { return ''; } };
    const extOrig = toExt(url);
    const extFinal = toExt(resp.url);
    const cd = resp.headers.get('content-disposition') ?? '';
    const cdMatch = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)/i);
    const extCd = cdMatch ? (cdMatch[1].trim().split('.').pop()?.toLowerCase() ?? '') : '';
    console.log(`[analizar] Validación: ct="${ct}" | extOrig="${extOrig}" | extFinal="${extFinal}" | extCd="${extCd}"`);

    if (ct.includes('text/html')) {
      throw new Error('El servidor devolvió una página HTML en lugar del archivo. El enlace puede haber expirado o requiere autenticación.');
    }

    const EXTS_OK = new Set(['pdf', 'docx', 'doc', 'xlsx', 'xlsm', 'xlsb']);
    const extValida = EXTS_OK.has(extOrig) || EXTS_OK.has(extFinal) || EXTS_OK.has(extCd);
    const mimeOk = ct.includes('pdf') || ct.includes('octet-stream') ||
      ct.includes('word') || ct.includes('officedocument') ||
      ct.includes('spreadsheet') || ct.includes('excel');
    const esUnknown = ct.includes('application/unknown') || ct === '';
    if (!mimeOk && !extValida && !esUnknown) {
      throw new Error('Tipo de archivo no soportado. Solo se admiten archivos PDF, DOCX y XLSX.');
    }

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
  } finally {
    clearTimeout(timer);
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // ── Autenticación ──────────────────────────────────────────────────────────
  const session = await getSession(req);
  if (!session) return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 });

  const usuarioId = await resolveSessionUserId(session);
  if (usuarioId === null) {
    return NextResponse.json({ ok: false, error: 'Sesión inválida. Inicie sesión nuevamente.' }, { status: 401 });
  }

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'GOOGLE_AI_API_KEY no configurada.' }, { status: 503 });
  }

  let body: { urlDocumento?: string; nombreDocumento?: string; pdfBase64?: string; forzar?: boolean; modo?: string; codigoProceso?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido.' }, { status: 400 });
  }

  const {
    urlDocumento,
    nombreDocumento = 'Documento',
    pdfBase64: pdfBase64Input,
    forzar = false,
    codigoProceso: codigoProcesoParam,
  } = body;
  const modo = 'completo' as const;

  if (!urlDocumento?.trim() && !pdfBase64Input?.trim()) {
    return NextResponse.json({ ok: false, error: 'Se requiere urlDocumento o pdfBase64.' }, { status: 400 });
  }

  // ── Caché 1: por URL ────────────────────────────────────────────────────────
  if (urlDocumento?.trim() && !forzar) {
    try {
      const existente = await prisma.lecturaAnalisis.findFirst({
        where: { urlDocumento, modo, ...(isAdmin(session.rol) ? {} : { usuarioId }) },
        orderBy: { creadoEn: 'desc' },
      });
      if (existente) {
        const codigoFinalCache = codigoProcesoParam?.trim() || null;
        if (codigoFinalCache) {
          (async () => {
            try {
              const ragDoc = await prisma.ragDocumento.findFirst({ where: { codigoProceso: codigoFinalCache } });
              if (ragDoc) return;
              if (!validarUrlAntiSSRF(urlDocumento!).ok) return;
              const resp = await fetch(urlDocumento!, {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LicycolbaBot/1.0)' },
                signal: AbortSignal.timeout(30_000),
              });
              if (!resp.ok) return;
              const buf = Buffer.from(await resp.arrayBuffer());
              const _ragExt = await extraerPdfTexto(buf);
              const texto = _ragExt.paginas.map(p => p.texto).join('\n');
              const paragraphs = texto.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 30);
              const chunks: string[] = [];
              let current = '';
              for (const para of paragraphs) {
                if (current.length + para.length > 2_500 && current.length > 0) {
                  chunks.push(current.trim());
                  current = current.slice(-300) + '\n\n' + para;
                } else {
                  current += (current ? '\n\n' : '') + para;
                }
              }
              if (current.trim().length > 30) chunks.push(current.trim());
              if (chunks.length === 0) return;
              const nombreDoc = existente.nombreDocumento || nombreDocumento;
              await prisma.ragDocumento.create({
                data: {
                  nombre: nombreDoc,
                  codigoProceso: codigoFinalCache,
                  totalPaginas: null,
                  totalChunks: chunks.length,
                  chunks: { create: chunks.map((texto, indice) => ({ indice, texto })) },
                },
              });
            } catch { /* no bloquear */ }
          })();
        }
        void auditFromRequest(req, session, { accion: 'analisis_normal', recurso: 'lectura_analisis', recursoId: String(existente.id), detalle: { modo: existente.modo, nombreDocumento: existente.nombreDocumento, cache: true } });
        return NextResponse.json({
          ok: true, cached: true, analisisId: existente.id,
          nombreDocumento: existente.nombreDocumento, urlDocumento,
          modo: existente.modo, resultado: existente.resultado,
          tipoArchivoDetectado: inferTipoDesdeNombre(existente.nombreDocumento),
          tokens: { entrada: existente.tokensEntrada, salida: existente.tokensSalida },
        });
      }
    } catch { /* ignorar error de BD */ }
  }

  // ── Rate limit — solo si no hay caché (los hits de caché no consumen cupo) ──────────────────────
  const rl = await checkGeminiRateLimitPg(usuarioId, 'analizar');
  if (rl.bloqueado) {
    return NextResponse.json({ ok: false, error: `Límite diario de análisis alcanzado (${rl.usos}/${rl.limite}). Intente mañana.` }, { status: 429 });
  }

  // ── Obtener PDF ─────────────────────────────────────────────────────────────
  let pdfBuffer: Buffer;

  if (pdfBase64Input) {
    const PDF_B64_MAX_BYTES = Math.ceil(10 * 1024 * 1024 * 4 / 3); // 10 MB en base64
    if (pdfBase64Input.length > PDF_B64_MAX_BYTES) {
      return NextResponse.json({ ok: false, error: 'Archivo demasiado grande. Máximo permitido: 10 MB.' }, { status: 400 });
    }
    pdfBuffer = Buffer.from(pdfBase64Input, 'base64');
  } else {
    try {
      pdfBuffer = await descargarDocumento(urlDocumento!);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al descargar el documento.';
      return NextResponse.json({ ok: false, error: msg }, { status: 502 });
    }
  }

  // ── Caché 2: por hash del PDF ───────────────────────────────────────────────
  const pdfHash = createHash('sha256').update(pdfBuffer.subarray(0, 8_192)).digest('hex');
  const tipoArchivoDetectado = detectarTipoArchivo(pdfBuffer, nombreDocumento).formato;

  if (!forzar) {
    try {
      const porHash = await prisma.lecturaAnalisis.findFirst({
        where: { pdfHash, modo, ...(isAdmin(session.rol) ? {} : { usuarioId }) },
        orderBy: { creadoEn: 'desc' },
      });
      if (porHash) {
        // Si el resultado cacheado requería OCR y ahora OCR está activo → forzar reanálisis
        const resultadoCacheado = porHash.resultado as Record<string, unknown> | null;
        const cacheRequiereOcr = (resultadoCacheado?._extraccion as Record<string, unknown> | undefined)?.requiereOcr === true;
        if (cacheRequiereOcr && documentAiEnabled()) {
          console.log('[ocr] caché ignorada — resultado previo requería OCR y DOCUMENT_AI_ENABLED=true');
        } else {
          void auditFromRequest(req, session, { accion: 'analisis_normal', recurso: 'lectura_analisis', recursoId: String(porHash.id), detalle: { modo: porHash.modo, nombreDocumento: porHash.nombreDocumento, cache: true } });
          return NextResponse.json({
            ok: true, cached: true, analisisId: porHash.id,
            nombreDocumento: porHash.nombreDocumento, urlDocumento,
            modo: porHash.modo, resultado: porHash.resultado,
            tipoArchivoDetectado: inferTipoDesdeNombre(porHash.nombreDocumento),
            tokens: { entrada: porHash.tokensEntrada, salida: porHash.tokensSalida },
          });
        }
      }
    } catch { /* ignorar error de BD */ }
  }

  // ── Llamar a Gemini en paralelo ─────────────────────────────────────────────
  try {
    const client = new GoogleGenerativeAI(apiKey);

    // Detectar formato y extraer texto
    const tipoArchivo = detectarTipoArchivo(pdfBuffer, nombreDocumento);
    let rawText = '';
    let numeroPaginas = 1;
    const advertenciasExtraccion: string[] = [];
    let metodoExtraccionDoc = 'pdf_text';
    let requiereOcrDoc = false;

    if (!tipoArchivo.soportado) {
      throw new Error(tipoArchivo.advertencia ?? 'Formato de archivo no soportado.');
    }
    if (tipoArchivo.formato === 'pdf') {
      const extRes = await extraerPdfTexto(pdfBuffer);
      rawText = extRes.paginas.map(p => p.texto).join('\n');
      numeroPaginas = extRes.totalPaginas;
      advertenciasExtraccion.push(...extRes.advertencias);
      metodoExtraccionDoc = extRes.metodo;
      requiereOcrDoc = extRes.requiereOcr;
      if (extRes.metodo === 'document_ai_ocr') {
        void auditFromRequest(req, session, { accion: 'document_ai_ocr_usado', recurso: 'lectura/document-ai-ocr', detalle: { nombreDocumento, hashCorto: pdfHash.slice(0, 12), totalPaginas: numeroPaginas, totalChars: rawText.length, metodoExtraccion: 'document_ai_ocr', paginasOcr: extRes.paginas.filter((p: { texto: string }) => p.texto.trim().length > 0).length } });
      }
    } else if (tipoArchivo.formato === 'word_docx') {
      const extRes = await extraerWord(pdfBuffer, nombreDocumento);
      rawText = extRes.texto;
      numeroPaginas = 1;
      advertenciasExtraccion.push(...extRes.advertencias);
      metodoExtraccionDoc = 'word';
    } else if (tipoArchivo.formato === 'excel_xlsx') {
      const extRes = await extraerExcel(pdfBuffer, nombreDocumento);
      rawText = extRes.texto;
      numeroPaginas = extRes.hojas.length || 1;
      advertenciasExtraccion.push(...extRes.advertencias);
      metodoExtraccionDoc = 'excel';
    } else {
      throw new Error(`Formato "${tipoArchivo.formato}" no soportado para análisis. Solo se admiten PDF, DOCX y XLSX.`);
    }

    if (!rawText.trim() || rawText.trim().length < 100) {
      // Mostrar el error real de OCR si está disponible en advertenciasExtraccion
      const ocrError = advertenciasExtraccion
        .filter(a => /OCR falló|falló.*autent|procesador no|permisos|API no habilitada|credenciales inválidas|sin texto extraído/i.test(a))
        .map(a => a.slice(0, 400))
        .join(' | ');
      const ocrHint = requiereOcrDoc
        ? (documentAiEnabled()
            ? ` El PDF parece escaneado. ${ocrError || 'OCR Document AI falló — revise credenciales y configuración.'}`
            : ' El PDF parece escaneado. Active DOCUMENT_AI_ENABLED=true para procesarlo con OCR.')
        : '';
      throw new Error(`El documento no contiene texto extraíble.${ocrHint}`);
    }
    const { texto, origLen } = _extractSmartText(rawText, 52_000);
    const docSection = `---\nDOCUMENTO (${numeroPaginas} págs, ${texto.length.toLocaleString()} / ${origLen.toLocaleString()} chars):\n\n${texto}`;

    // Dos llamadas en paralelo
    const [res1, res2] = await Promise.allSettled([
      llamarGemini(client, `${PROMPT_PARTE1}\n\n${docSection}`, 'parte1'),
      llamarGemini(client, `${PROMPT_PARTE2}\n\n${docSection}`, 'parte2'),
    ]);

    // Registrar consumo para lo que completó
    if (res1.status === 'fulfilled') {
      registrarUso({
        modelo: res1.value.modeloUsado,
        endpoint: 'lectura/analizar:parte1',
        tokensIn: res1.value.tokensEntrada ?? 0,
        tokensOut: res1.value.tokensSalida ?? 0,
        usuarioId,
      });
    }
    if (res2.status === 'fulfilled') {
      registrarUso({
        modelo: res2.value.modeloUsado,
        endpoint: 'lectura/analizar:parte2',
        tokensIn: res2.value.tokensEntrada ?? 0,
        tokensOut: res2.value.tokensSalida ?? 0,
        usuarioId,
      });
    }

    // Ambas partes deben completarse
    if (res1.status === 'rejected' || res2.status === 'rejected') {
      const p1Err = res1.status === 'rejected' ? String(res1.reason).slice(0, 200) : null;
      const p2Err = res2.status === 'rejected' ? String(res2.reason).slice(0, 200) : null;
      if (p1Err) console.error('[analizar] parte1 falló:', p1Err);
      if (p2Err) console.error('[analizar] parte2 falló:', p2Err);
      const esTimeout = [p1Err, p2Err].some(e => e?.includes('Timeout'));
      const esCuota = [p1Err, p2Err].some(e => e?.includes('429') || e?.includes('RESOURCE_EXHAUSTED'));
      const msgUsuario = esTimeout
        ? 'El servicio de IA tardó demasiado. Intenta nuevamente en unos segundos.'
        : esCuota
          ? 'Límite de uso de IA alcanzado temporalmente. Intenta en 30 segundos.'
          : 'No fue posible completar el análisis completo. Intenta nuevamente.';
      return NextResponse.json({ ok: false, error: msgUsuario }, { status: 502 });
    }

    // Unir los dos resultados y metadatos de extracción
    const resultado: Record<string, unknown> = {
      ...res1.value.resultado,
      ...res2.value.resultado,
      _extraccion: {
        metodoExtraccion: metodoExtraccionDoc,
        requiereOcr: requiereOcrDoc,
        totalPaginas: numeroPaginas,
        totalChars: rawText.length,
        advertencias: advertenciasExtraccion,
      },
    };
    const tokensEntrada = (res1.value.tokensEntrada ?? 0) + (res2.value.tokensEntrada ?? 0);
    const tokensSalida = (res1.value.tokensSalida ?? 0) + (res2.value.tokensSalida ?? 0);

    // Solo guardar blob para uploads locales (sin URL) y si pesa <= 4 MB binary
    const PDF_BLOB_MAX = 4 * 1024 * 1024;
    const pdfBlobToStore = (!urlDocumento && pdfBase64Input && pdfBuffer.length <= PDF_BLOB_MAX)
      ? pdfBase64Input
      : null;

    const codigoFinal = codigoProcesoParam?.trim() || null;

    let analisisId: number | null = null;
    try {
      const guardado = await prisma.lecturaAnalisis.create({
        data: {
          nombreDocumento,
          urlDocumento: urlDocumento || null,
          pdfHash,
          modo,
          pdfBlob: pdfBlobToStore,
          codigoProceso: codigoFinal,
          entidad: (resultado.entidad as string) || null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          resultado: resultado as any,
          tokensEntrada: tokensEntrada || null,
          tokensSalida: tokensSalida || null,
          usuarioId,
        },
      });
      analisisId = guardado.id;
    } catch (dbErr) {
      const prismaCode = (dbErr as { code?: string })?.code;
      const errMsg     = dbErr instanceof Error ? dbErr.message.slice(0, 200) : String(dbErr).slice(0, 200);
      console.error('[POST /api/lectura/analizar] Error guardando en BD', { prismaCode, errMsg, usuarioId });
    }

    // Indexar chunks RAG en background
    if (codigoFinal) {
      const chunkFn = async () => {
        try {
          const paragraphs = rawText.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 30);
          const chunks: string[] = [];
          let current = '';
          for (const para of paragraphs) {
            if (current.length + para.length > 2_500 && current.length > 0) {
              chunks.push(current.trim());
              current = current.slice(-300) + '\n\n' + para;
            } else {
              current += (current ? '\n\n' : '') + para;
            }
          }
          if (current.trim().length > 30) chunks.push(current.trim());
          if (chunks.length === 0) return;

          const existing = await prisma.ragDocumento.findFirst({
            where: { codigoProceso: codigoFinal, nombre: { contains: nombreDocumento.slice(0, 50) } },
          });
          if (existing) return;

          await prisma.ragDocumento.create({
            data: {
              nombre: nombreDocumento,
              codigoProceso: codigoFinal,
              totalPaginas: null,
              totalChunks: chunks.length,
              chunks: { create: chunks.map((t, indice) => ({ indice, texto: t })) },
            },
          });
        } catch { /* no bloquear la respuesta */ }
      };
      chunkFn();
    }

    void recordGeminiUsagePg(usuarioId, 'analizar');
    void auditFromRequest(req, session, { accion: 'analisis_normal', recurso: 'lectura_analisis', recursoId: analisisId != null ? String(analisisId) : undefined, detalle: { modo, nombreDocumento, cache: false, tokensEntrada: tokensEntrada || null, tokensSalida: tokensSalida || null } });
    return NextResponse.json({
      ok: true,
      analisisId,
      nombreDocumento,
      urlDocumento,
      modo,
      hasPdf: !!(urlDocumento || pdfBlobToStore),
      resultado,
      tipoArchivoDetectado,
      tokens: { entrada: tokensEntrada || null, salida: tokensSalida || null },
      debug: {
        charsEnviados: texto.length,
        charsOriginales: origLen,
        reduccion: origLen > 0 ? Math.round((1 - texto.length / origLen) * 100) + '%' : '0%',
        metodoExtraccion: metodoExtraccionDoc,
      },
    });
  } catch (err) {
    console.error('[POST /api/lectura/analizar]', err);
    const msg = err instanceof Error ? err.message : String(err);
    const esCuota = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
    const esSobrecarga = msg.includes('503') || msg.includes('overloaded') || msg.includes('high demand');
    const mensajeUsuario = esCuota
      ? 'Servicio de IA no disponible por límite de cuota. Intenta en unos minutos.'
      : esSobrecarga
      ? 'El servicio de IA está temporalmente saturado. Intenta de nuevo en unos segundos.'
      : msg;
    return NextResponse.json({ ok: false, error: mensajeUsuario }, { status: esCuota || esSobrecarga ? 503 : 500 });
  }
}