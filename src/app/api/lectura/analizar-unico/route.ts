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

// ═══════════════════════════════════════════════════════════════════════════
// ANÁLISIS ÚNICO EXPERTO DEL PLIEGO
// ─────────────────────────────────────────────────────────────────────────
// Único endpoint de análisis del módulo "Lectura de procesos". Reemplaza
// funcionalmente los antiguos modos "normal"/"profundo"/"proceso completo":
// ejecuta siempre extracción completa + OCR si aplica + bloques + prompt
// experto único + consolidación + trazabilidad, en una sola pasada.
//
// Reutiliza la lógica de extracción, bloques, dedup y consolidación ya
// probada en /api/lectura/analizar-proceso-completo (el pipeline más
// robusto existente), con un prompt ampliado (comité experto multi-área,
// 63 temas obligatorios) y secciones JSON adicionales. Guarda con
// modo="analisis_unico_experto" — no requiere migración de esquema porque
// LecturaAnalisis.modo es un campo String? libre.
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MODO = 'analisis_unico_experto';
const NR = 'NO ENCONTRADO EN EL DOCUMENTO FUENTE';

// ── Tipos ────────────────────────────────────────────────────────────────────

type TipoFuente = 'pdf' | 'word' | 'excel';

type DocInput = {
  nombre: string;
  url: string;
  tipo: string;
  prioridad: number;
  prioridadDedup?: number;
  pdfBase64?: string;
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

type ResultadoBloqueUnico = {
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
  declaratoria_desierta?: ItemPC[];
  garantias?: ItemPC[];
  minuta_condiciones_contractuales?: Record<string, ItemPC[]>;
  riesgos_contractuales?: ItemPC[];
  acuerdos_comerciales?: ItemPC[];
  anexos_formatos_matrices_formularios?: ItemPC[];
  inhabilidades_incompatibilidades?: ItemPC[];
  estampillas_impuestos_retenciones?: ItemPC[];
  unspsc?: ItemPC[];
  mano_obra_personal_perfiles?: ItemPC[];
  insumos_equipos_dotacion_epp_examenes?: ItemPC[];
  supervision_ans_tiempos_respuesta?: ItemPC[];
  documentos_externos_referenciados?: ItemPC[];
  temas_no_encontrados_o_no_desarrollados?: string[];
  comunicaciones_secop?: Record<string, unknown> | null;
  forma_pago_reajuste_facturacion?: Record<string, unknown> | null;
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
  bloques: ResultadoBloqueUnico[];
  advertencias: string[];
  totalPaginas?: number;
  metodoExtraccion?: string;
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

function parsearJSON(raw: string, etiqueta: string): ResultadoBloqueUnico {
  const clean = raw.trim().replace(/^```(?:json|JSON)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
  try { return JSON.parse(clean) as ResultadoBloqueUnico; } catch { /* */ }
  const m = clean.match(/\{[\s\S]*\}/);
  if (!m) { console.error(`[unico:${etiqueta}] sin JSON`); return {}; }
  try { return JSON.parse(m[0]) as ResultadoBloqueUnico; } catch {
    let fixed = m[0];
    let b = 0, br = 0;
    for (const ch of fixed) { if (ch === '{') b++; else if (ch === '}') b--; else if (ch === '[') br++; else if (ch === ']') br--; }
    fixed = fixed.replace(/,\s*$/, '').replace(/,\s*([}\]])/g, '$1') + ']'.repeat(Math.max(0, br)) + '}'.repeat(Math.max(0, b));
    try { return JSON.parse(fixed) as ResultadoBloqueUnico; } catch { console.error(`[unico:${etiqueta}] JSON irreparable`); return {}; }
  }
}

// ── Prompt único experto ───────────────────────────────────────────────────────

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

  // Plantilla única de ítem experto — usada en TODAS las secciones para que cada
  // hallazgo traiga la trazabilidad completa exigida (numeral, capítulo, páginas,
  // texto literal/mostrado, soporte, subsanable, puntuable, puntaje, causal de
  // rechazo asociada, impacto práctico, rol responsable, riesgo, observación).
  const itemExp = (nombreCampo: string, extra = '') =>
    `{"id":"","${nombreCampo}":"...","numeral":"...","capitulo":"...","texto_literal_pliego":"TRANSCRIPCIÓN EXACTA o \\"${NR}\\"","texto_mostrado":"versión resumida legible para pantalla","documento_soporte_requerido":"...","formato_anexo_asociado":"...","subsanable":"SÍ|NO|NO ESPECIFICADO EN EL DOCUMENTO","puntuable":"SÍ|NO","puntaje":0,"causal_rechazo_asociada":"...","impacto_practico":"...","rol_responsable_principal":"...","roles_apoyo":"...","razon_rol":"...","nivel_riesgo":"ALTO|MEDIO|BAJO|NO APLICA","observacion":"...","fuente":${fe}${extra}}`;

  return `Eres un COMITÉ EXPERTO MULTIDISCIPLINARIO de análisis de pliegos de contratación estatal colombiana, conformado por: (1) Jurídico contratación estatal, (2) Jurídico documental/societario, (3) Financiero, (4) Costos y presupuestos, (5) Técnico-operativo, (6) SST, (7) Nómina y laboral, (8) Seguros y pólizas, (9) Comercial licitaciones, (10) Operaciones, (11) Calidad, (12) Ambiental, (13) Tecnología/sistemas, (14) Gestión documental, (15) Gerencia/aprobación final.

Conoces en profundidad: Ley 80 de 1993, Ley 1150 de 2007, Decreto 1082 de 2015, SECOP I/II, subsanabilidad, causales de rechazo, garantías, minuta contractual, obligaciones del contratista/entidad/supervisor, multas, sanciones, cláusula penal, procedimiento sancionatorio (art. 86 Ley 1474 de 2011), riesgos, inhabilidades, incompatibilidades, LAFT/SARLAFT.

Este es un ANÁLISIS ÚNICO EXPERTO — no existen modos "básico" ni "preliminar". Debes extraer TODO lo exigido con el mismo nivel de detalle y trazabilidad, sin omitir secciones.

${infoBloque} del documento: "${nombreDoc}" (tipo: ${tipoDoc}).

REGLAS OBLIGATORIAS:
1. Extrae ÚNICAMENTE lo que aparezca en el texto del bloque. NO inventes ni completes con conocimiento externo ni con requisitos legales genéricos que no estén en el pliego.
2. texto_literal_pliego = transcripción EXACTA sin modificar (para trazabilidad/soporte legal). texto_mostrado = SÍNTESIS ANALÍTICA de qué debe hacer/presentar el proponente en concreto para cumplir este requisito, en 1-3 oraciones claras y accionables (quién lo firma, qué formato o documento se exige, plazos o períodos relevantes, condiciones especiales). NO es un resumen acortado del texto literal ni una copia parcial — debe leerse como la conclusión práctica de un analista experto que ya entendió el requisito, no como una transcripción. Ejemplo MAL: "El proponente debe presentar el Formato 5 (...)" copiando el inicio del párrafo. Ejemplo BIEN: "Debe anexarse el Formato 5 firmado por el Revisor Fiscal (o el representante legal si no aplica Revisor Fiscal), certificando el pago de aportes a salud, pensión, riesgos profesionales y parafiscales de los últimos 6 meses anteriores al cierre."
3. Nunca uses null, undefined ni NaN. Nunca dejes puntaje vacío: usa 0 si no aplica o no se identificó.
4. Si algo no aparece en el documento: "${NR}".
5. Si está mencionado pero no desarrollado: "NO DESARROLLADO EN EL DOCUMENTO FUENTE".
6. Si remite a otro documento no cargado: "DOCUMENTO REFERENCIADO PERO NO SUMINISTRADO".
7. Si el OCR no permite leer una parte: "TEXTO NO LEGIBLE O INCOMPLETO EN EL DOCUMENTO FUENTE".
${reglaPaginas}
8. Sin límite de cantidad: extrae TODO lo que exista en este bloque, cada hallazgo es un registro independiente (no agrupes ni resumas cláusulas distintas en una sola). CRÍTICO: cuando un numeral/encabezado de sección (ej. "5.1.2. EXISTENCIA Y REPRESENTACIÓN LEGAL") introduce un requisito o condición general ANTES de listar sub-numerales o literales (A, B, C...), ese encabezado también es un hallazgo propio e independiente — no lo omitas ni lo trates solo como categoría. Extrae el encabezado como su propio ítem (con su numeral) Y ADEMÁS cada sub-numeral/literal como ítems separados con sus propios numerales anidados (ej. "5.1.2", "5.1.2.1", "5.1.2.1.A", "5.1.2.1.B"). No saltes directo a los literales de más bajo nivel omitiendo los encabezados intermedios que sí tienen contenido propio.
9. Solo JSON válido. Sin markdown. Sin texto extra.
10. fragmento_busqueda = primeros 150 caracteres del texto_literal_pliego.
11. CRÍTICO: en cada "fuente" usa SIEMPRE: ${fe}
12. rol_responsable_principal = área interna de Grupo Colba (Jurídico, Financiero, Costos, SST, Nómina, Seguros, Comercial, Operaciones, Calidad, Ambiental, Tecnología, Gestión documental, Gerencia) más adecuada para gestionar ese hallazgo; roles_apoyo = otras áreas que deben participar; razon_rol = por qué corresponde a esa área.
13. CRÍTICO — "numeral" debe ser EXACTAMENTE el número/letra que aparece literalmente en el pliego inmediatamente antes o como encabezado del requisito (ej.: "5.1", "5.1.1", "Numeral 3.2", "Literal C", "Cláusula Décima"). NO inventes, NO redondees al numeral padre, NO reutilices un numeral de otro requisito cercano. Si el requisito no tiene un numeral identificable justo encima o al inicio del párrafo, usa "${NR}" en vez de adivinar. "capitulo" = título de la sección/capítulo bajo la cual aparece (ej.: "CAPACIDAD JURÍDICA"), tal como está escrito en el pliego.
CRÍTICO — verifica que el numeral corresponda al MISMO tema del contenido que estás describiendo en ESE ítem. NUNCA asignes el numeral de una sección con un tema distinto (ej.: si el contenido trata sobre "capacidad organizacional", el numeral debe ser el que literalmente encabeza ESE párrafo sobre capacidad organizacional — jamás el numeral de una sección de "capacidad técnica", "capacidad jurídica" u otro tema diferente, aunque estén cerca en el documento o parezcan seguir el mismo patrón de numeración). Si tienes dudas sobre si el numeral corresponde al tema correcto, usa "${NR}" en vez de asignar uno que no coincide.
14. CRÍTICO — el campo de nombre del ítem (nombre_requisito, nombre_clausula, nombre_criterio, etc.) DEBE ser copiado TAL CUAL aparece el encabezado en el pliego junto al numeral, sin traducirlo a un título "más claro" ni embellecerlo. PROHIBIDO reformular, resumir o mejorar la redacción del encabezado. Ejemplos de lo que está PROHIBIDO hacer: si el pliego dice "5.1.1. APODERADO", el nombre debe ser exactamente "APODERADO" (o "Apoderado"), NUNCA "Poder para Apoderado" ni "Requisitos del Apoderado" ni ninguna otra variación tuya. Si el pliego dice "2.10. IDIOMA", el nombre es "IDIOMA"/"Idioma", NUNCA "Traducción oficial de documentos". Copia el encabezado con el mismo orden de palabras y el mismo nivel de detalle que tiene en el pliego. Si un mismo numeral/encabezado agrupa varios párrafos distintos, usa el MISMO nombre del encabezado para todos esos hallazgos (no inventes subtítulos distintos por párrafo). Solo si el pliego no tiene un encabezado claro para ese numeral, describe brevemente el contenido.

CLASIFICACIÓN RIESGO: "ALTO", "MEDIO", "BAJO" o "NO APLICA"
SUBSANABLE: "SÍ", "NO" o "NO ESPECIFICADO EN EL DOCUMENTO"

═══════════════════════════════════════════
FASE CONTRACTUAL OBLIGATORIA — MINUTA, CLÁUSULAS Y CONDICIONES DEL CONTRATO
═══════════════════════════════════════════
Revisa exhaustivamente la minuta, anexo de condiciones contractuales, capítulo de garantías, capítulo de riesgos y cualquier sección contractual.
EXTRAE LITERALMENTE cada cláusula. NO RESUMAS. NO AGRUPES. Cada cláusula = un registro independiente.

PALABRAS CLAVE — busca obligatoriamente (lista no exhaustiva, úsala como guía de búsqueda):
CLÁUSULA · MINUTA · CONDICIONES DEL CONTRATO · OBLIGACIONES DEL CONTRATISTA/ENTIDAD/SUPERVISOR · SUPERVISIÓN · INTERVENTORÍA · FORMA DE PAGO · REAJUSTE · ANTICIPO · FACTURA · VALOR MENSUAL DE FACTURACIÓN · SEGURIDAD SOCIAL · PARAFISCALES · ESTABILIDAD LABORAL · PERSONAL MÍNIMO · EQUIPO DE TRABAJO · PERFIL DEL PERSONAL · PERSONAL INHOUSE · MANO DE OBRA · INSUMOS · EQUIPOS · HERRAMIENTAS · DOTACIÓN · ELEMENTOS DE PROTECCIÓN PERSONAL · EPP · EXÁMENES MÉDICOS OCUPACIONALES · MULTAS · SANCIONES · PROCEDIMIENTO SANCIONATORIO · CLÁUSULA PENAL · PENA PECUNIARIA · ACUERDO DE NIVEL DE SERVICIO · ANS · TIEMPOS DE RESPUESTA · CUBRIMIENTO DE NOVEDADES · GARANTÍA DE SERIEDAD · GARANTÍA DE CUMPLIMIENTO · RECIBO O COMPROBANTE DE PAGO DE GARANTÍA · RESPONSABILIDAD CIVIL EXTRACONTRACTUAL · CALIDAD DEL SERVICIO · PAGO DE SALARIOS Y PRESTACIONES · INDEMNIDAD · CESIÓN · SUBCONTRATACIÓN · CONFIDENCIALIDAD · LAVADO DE ACTIVOS · CASO FORTUITO · FUERZA MAYOR · SOLUCIÓN DE CONTROVERSIAS · TERMINACIÓN · LIQUIDACIÓN · PERFECCIONAMIENTO · ESTAMPILLA · IMPUESTO · RETENCIÓN · INHABILIDAD · INCOMPATIBILIDAD · DECLARATORIA DESIERTA · UNSPSC · CÓDIGO DE CLASIFICACIÓN DE BIENES Y SERVICIOS · COMUNICACIONES · SECOP · SUBSANABILIDAD · CAUSAL DE RECHAZO · DOCUMENTOS EXTERNOS REFERENCIADOS

═══════════════════════════════════════════
CRÍTICO — CONTENIDO EN TABLAS (no lo omitas)
═══════════════════════════════════════════
El texto de este bloque puede incluir tablas cuyo formato de filas/columnas se ve alterado o linealizado. NO ignores ni te saltes contenido solo porque viene en formato de tabla — cada fila con información propia es un hallazgo independiente, igual que un párrafo.
1. INDICADORES FINANCIEROS/ORGANIZACIONALES EN TABLA: busca tablas con columnas tipo "Indicador / Fórmula / Parámetro mínimo exigido / Criterio MIPYMES". Cada fila (ej. "Capital de Trabajo", "Liquidez", "Nivel de Endeudamiento", "Razón de Cobertura de Intereses", "Rentabilidad sobre Patrimonio (ROE)", "Rentabilidad del Activo (ROA)", "Índice de Endeudamiento", "Capacidad Organizacional") es un ítem independiente en requisitos_financieros_habilitantes o requisitos_organizacionales_habilitantes: nombre_requisito = nombre del indicador, texto_literal_pliego = la fórmula y el parámetro mínimo exigido tal como aparecen, incluyendo el valor diferencial para MIPYMES si existe.
2. COMPONENTES/PLANES DE EVALUACIÓN CON PUNTAJE EN TABLA: busca tablas de calificación de "Componente 1/2/3", "Plan de Seguridad y Salud en el Trabajo", "Plan de Gestión Socio-Ambiental" u otros planes con desglose de puntos (ej. filas "Planear/Hacer/Verificar/Actuar" con puntaje cada una y una fila de "PUNTOS TOTALES"). Extrae CADA COMPONENTE/PLAN como un ítem propio en criterios_evaluacion_puntaje, con puntaje_maximo = el puntaje TOTAL de ese componente (la fila de totales), y describe en texto_literal_pliego el desglose de sub-criterios y sus puntos.

═══════════════════════════════════════════
CRÍTICO — ASPECTOS OPERATIVOS ESPECÍFICOS DE GRUPO COLBA (no los omitas)
═══════════════════════════════════════════
Busca explícitamente estos puntos y, si el pliego los trata, regístralos como ítems propios en requisitos_tecnicos_habilitantes o especificaciones_tecnicas_servicio (según corresponda), dejando claro en texto_mostrado la respuesta concreta (sí/no aplica, y bajo qué condición):
1. SEDE/SUCURSAL EN LA REGIÓN: identifica si la entidad exige que el proponente cuente con oficina, establecimiento de comercio, sede, agencia o sucursal en un lugar/región/ciudad determinada (dónde exactamente, y si debe existir desde antes de presentar oferta o puede constituirse después de la adjudicación).
2. FUMIGACIÓN Y CONTROL DE PLAGAS: identifica si el servicio contratado incluye actividades de fumigación y/o control de plagas, y si el pliego permite subcontratar o tercerizar específicamente ese servicio (relevante porque de permitirse, se debe aportar el concepto sanitario del subcontratista en vez de el propio).
3. LAVADO DE TANQUES: identifica si el servicio contratado incluye actividades de lavado de tanques de almacenamiento de agua, y si el pliego permite subcontratar o tercerizar específicamente ese servicio (misma razón: de permitirse, se debe aportar el concepto sanitario del subcontratista).
Si el pliego no menciona alguno de estos tres puntos en este bloque, simplemente no generes un ítem para ese punto (no inventes que "no aplica" si no hay evidencia en el texto del bloque).

JSON (solo secciones con información real en este bloque):
{
  "ficha_general_proceso": {"objeto":"...","entidad":"...","numero_proceso":"...","modalidad_seleccion":"...","tipo_documento":"Pliego de Condiciones|Terminos de Referencia|Invitacion Publica|Documento de Terminos y Condiciones|otro","presupuesto_oficial":"...","plazo_ejecucion":"...","lugar_ejecucion":"...","plataforma":"SECOP I|SECOP II|Colombia Compra Eficiente|Otro","supervision_interventoria":"quien supervisa segun el pliego o \\"${NR}\\"","factor_seleccion":"menor precio|calidad y precio|mayor puntaje|concurso de meritos|precio fijo|otro","forma_pago":"...","fuente":${fe}},
  "unspsc": [${itemExp('descripcion_unspsc', ',"codigo_unspsc":"..."')}],
  "comunicaciones_secop": {"canal_oficial":"...","plataforma":"SECOP I|SECOP II|Otro","correo_notificaciones":"...","plazo_respuesta_preguntas":"...","texto_literal_pliego":"EXACTO o \\"${NR}\\"","fuente":${fe}},
  "cronograma": [{"evento":"...","fecha":"...","hora":"...","texto_literal_pliego":"EXACTO","fuente":${fe}}],
  "requisitos_juridicos_habilitantes": [${itemExp('nombre_requisito')}],
  "requisitos_financieros_habilitantes": [${itemExp('nombre_requisito')}],
  "requisitos_organizacionales_habilitantes": [${itemExp('nombre_requisito')}],
  "requisitos_tecnicos_habilitantes": [${itemExp('nombre_requisito')}],
  "experiencia_habilitante": [${itemExp('nombre_requisito', ',"tipo_experiencia":"...","actividades_aceptadas":"...","valor_minimo":"...","numero_contratos":"...","periodo":"..."')}],
  "especificaciones_tecnicas_servicio": [${itemExp('nombre_especificacion', ',"obligatoriedad":"obligatorio|deseable|opcional"')}],
  "criterios_evaluacion_puntaje": [${itemExp('nombre_criterio', ',"tipo_evaluacion":"técnico|económico|calidad|experiencia|otro","formula_aplicable":"..."')}],
  "criterios_desempate": [${itemExp('nombre_criterio', ',"orden_aplicacion":0')}],
  "causales_rechazo": [${itemExp('nombre_causal', ',"consecuencia":"rechazo|descalificación|otro"')}],
  "declaratoria_desierta": [${itemExp('causal_declaratoria')}],
  "reglas_subsanabilidad": [${itemExp('nombre_regla', ',"aplica_a":"...","plazo_subsanacion":"..."')}],
  "garantias": [${itemExp('nombre_garantia', ',"tipo_garantia":"seriedad_oferta|cumplimiento|pago_salarios|calidad|responsabilidad_civil|estabilidad_obra|buen_manejo_anticipo|otro","monto_cobertura":"...","plazo_vigencia":"...","momento_entrega":"...","tomador":"...","asegurado":"...","beneficiario":"...","objeto_asegurado":"...","exige_comprobante_pago":"SÍ|NO|NO ESPECIFICADO EN EL DOCUMENTO","plazo_entrega_poliza":"...","consecuencia_no_entrega":"..."')}],
  "inhabilidades_incompatibilidades": [${itemExp('requisito', ',"tipo":"inhabilidad|incompatibilidad|conflicto_interes|prohibicion|antecedente_fiscal|antecedente_disciplinario|antecedente_judicial|lista_restrictiva|sancion_vigente|otro"')}],
  "estampillas_impuestos_retenciones": [${itemExp('concepto', ',"tipo":"estampilla|impuesto|tasa|contribucion|retencion|descuento|costo_legalizacion|publicacion|otro","porcentaje_o_valor":"...","base_calculo":"...","responsable_pago":"contratista|entidad|compartido","momento_pago":"...","consecuencia_no_pago":"..."')}],
  "mano_obra_personal_perfiles": [${itemExp('nombre_perfil', ',"cantidad":"...","dedicacion":"tiempo completo|medio tiempo|otro","formacion_academica":"...","experiencia_especifica":"...","tipo_vinculacion":"inhouse|outsourcing|no especificado"')}],
  "insumos_equipos_dotacion_epp_examenes": [${itemExp('nombre_item', ',"categoria":"insumo|equipo|herramienta|dotacion|epp|examen_medico","cantidad_periodicidad":"..."')}],
  "forma_pago_reajuste_facturacion": {"forma_pago":"...","reajuste_aplica":"SÍ|NO|NO ESPECIFICADO EN EL DOCUMENTO","formula_reajuste":"...","periodicidad_facturacion":"...","valor_mensual_promedio_facturacion":"...","texto_literal_pliego":"EXACTO o \\"${NR}\\"","fuente":${fe}},
  "supervision_ans_tiempos_respuesta": [${itemExp('descripcion', ',"tipo":"supervision|ans|tiempo_respuesta_novedades","tiempo_maximo":"...","consecuencia_incumplimiento":"..."')}],
  "minuta_condiciones_contractuales": {
    "forma_pago":                         [${itemExp('nombre_clausula', ',"numero_clausula":"...","clasificacion":"FORMA_PAGO"')}],
    "obligaciones_contratista":           [${itemExp('nombre_clausula', ',"numero_clausula":"...","clasificacion":"OBLIGACION_CONTRATISTA"')}],
    "obligaciones_entidad":               [${itemExp('nombre_clausula', ',"numero_clausula":"...","clasificacion":"OBLIGACION_ENTIDAD"')}],
    "obligaciones_supervisor_interventor":[${itemExp('nombre_clausula', ',"numero_clausula":"...","clasificacion":"SUPERVISION"')}],
    "seguridad_social_parafiscales":      [${itemExp('nombre_clausula', ',"numero_clausula":"...","clasificacion":"SEGURIDAD_SOCIAL_PARAFISCALES"')}],
    "estabilidad_laboral_personal":       [${itemExp('nombre_clausula', ',"numero_clausula":"...","clasificacion":"ESTABILIDAD_LABORAL"')}],
    "multas":                             [${itemExp('nombre_clausula', ',"numero_clausula":"...","clasificacion":"MULTA_CONTRACTUAL"')}],
    "procedimiento_multas_sanciones":     [${itemExp('nombre_clausula', ',"numero_clausula":"...","clasificacion":"PROCEDIMIENTO_SANCIONATORIO"')}],
    "pena_pecuniaria_clausula_penal":     [${itemExp('nombre_clausula', ',"numero_clausula":"...","clasificacion":"CLAUSULA_PENAL"')}],
    "garantias_contractuales":            [${itemExp('nombre_clausula', ',"numero_clausula":"...","clasificacion":"GARANTIA_CONTRACTUAL"')}],
    "polizas_requisitos_pago":            [${itemExp('nombre_clausula', ',"numero_clausula":"...","clasificacion":"RECIBO_PAGO_POLIZA"')}],
    "amparos":                            [${itemExp('nombre_clausula', ',"numero_clausula":"...","clasificacion":"AMPARO_CONTRACTUAL"')}],
    "indemnidad":                         [${itemExp('nombre_clausula', ',"numero_clausula":"...","clasificacion":"INDEMNIDAD"')}],
    "cesion_subcontratacion":             [${itemExp('nombre_clausula', ',"numero_clausula":"...","clasificacion":"CESION_SUBCONTRATACION"')}],
    "confidencialidad":                   [${itemExp('nombre_clausula', ',"numero_clausula":"...","clasificacion":"CONFIDENCIALIDAD_CONTRACTUAL"')}],
    "laft_sarlaft_listas":                [${itemExp('nombre_clausula', ',"numero_clausula":"...","clasificacion":"LAFT_SARLAFT"')}],
    "caso_fortuito_fuerza_mayor":         [${itemExp('nombre_clausula', ',"numero_clausula":"...","clasificacion":"CASO_FORTUITO_FUERZA_MAYOR"')}],
    "solucion_controversias":             [${itemExp('nombre_clausula', ',"numero_clausula":"...","clasificacion":"SOLUCION_CONTROVERSIAS"')}],
    "terminacion":                        [${itemExp('nombre_clausula', ',"numero_clausula":"...","clasificacion":"TERMINACION_CONTRACTUAL"')}],
    "liquidacion":                        [${itemExp('nombre_clausula', ',"numero_clausula":"...","clasificacion":"LIQUIDACION_CONTRACTUAL"')}],
    "perfeccionamiento_requisitos_ejecucion": [${itemExp('nombre_clausula', ',"numero_clausula":"...","clasificacion":"PERFECCIONAMIENTO_EJECUCION"')}],
    "otros":                              [${itemExp('nombre_clausula', ',"numero_clausula":"...","clasificacion":"OTRO"')}]
  },
  "riesgos_contractuales": [${itemExp('nombre_riesgo', ',"tipo_riesgo":"de la entidad|del contratista|compartido|externo","mitigacion_pliego":"..."')}],
  "acuerdos_comerciales": [${itemExp('nombre_acuerdo', ',"aplica_para":"..."')}],
  "anexos_formatos_matrices_formularios": [${itemExp('nombre_anexo', ',"tipo":"formato|matriz|formulario|otro","obligatorio":"SÍ|NO|NO ESPECIFICADO"')}],
  "documentos_externos_referenciados": [${itemExp('nombre_documento_referenciado', ',"motivo_referencia":"..."')}],
  "temas_no_encontrados_o_no_desarrollados": ["lista de temas de los 63 obligatorios que NO aparecieron o no se desarrollaron en este bloque"],
  "alertas": [${itemExp('titulo', ',"tipo_alerta":"documental|jurídica|financiera|técnica|económica|contractual|operativa","descripcion_alerta":"...","accion_recomendada":"..."')}],
  "resumen_ejecutivo_experto": {
    "que_contrata": "Parrafo experto 3-5 oraciones sobre que busca contratar la entidad, que servicio/obra/suministro se contrata y cual es la necesidad que lo justifica",
    "tipo_proponente": "Parrafo sobre que tipo de empresa o persona puede participar segun el objeto, modalidad y requisitos identificados en este bloque",
    "puntos_sensibles": "Parrafo sobre los 2-3 puntos mas criticos del proceso: experiencia exigida, garantias, causales de rechazo, cargas economicas, con lenguaje de comité experto en contratacion estatal colombiana",
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
): Promise<{ resultado: ResultadoBloqueUnico; tokensIn: number; tokensOut: number; ok: boolean }> {
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
      registrarUso({ modelo: modelId, endpoint: 'lectura/analizar-unico', tokensIn, tokensOut, usuarioId });
      if (!text?.trim()) throw new Error('Gemini vacío');
      return { resultado: parsearJSON(text, `${nombreDoc.slice(0, 20)}_b${bloque.numeroBloque}`), tokensIn, tokensOut, ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[unico] ${modelId} bloque${bloque.numeroBloque}: ${msg.slice(0, 200)}`);
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

function consolidarUnico(resultadosPorDoc: DocResultado[], codigoProceso: string): Record<string, unknown> {
  const ARRAY_KEYS: Array<keyof ResultadoBloqueUnico> = [
    'cronograma', 'requisitos_juridicos_habilitantes', 'requisitos_financieros_habilitantes',
    'requisitos_organizacionales_habilitantes', 'requisitos_tecnicos_habilitantes',
    'experiencia_habilitante', 'especificaciones_tecnicas_servicio', 'criterios_evaluacion_puntaje',
    'criterios_desempate', 'causales_rechazo', 'declaratoria_desierta', 'reglas_subsanabilidad', 'garantias',
    'riesgos_contractuales', 'acuerdos_comerciales', 'anexos_formatos_matrices_formularios', 'alertas',
    'inhabilidades_incompatibilidades', 'estampillas_impuestos_retenciones', 'unspsc',
    'mano_obra_personal_perfiles', 'insumos_equipos_dotacion_epp_examenes',
    'supervision_ans_tiempos_respuesta', 'documentos_externos_referenciados',
  ];
  const PREFIJOS: Record<string, string> = {
    cronograma: 'CR', requisitos_juridicos_habilitantes: 'RJ', requisitos_financieros_habilitantes: 'RF',
    requisitos_organizacionales_habilitantes: 'RO', requisitos_tecnicos_habilitantes: 'RT',
    experiencia_habilitante: 'EX', especificaciones_tecnicas_servicio: 'ET', criterios_evaluacion_puntaje: 'CE',
    criterios_desempate: 'CD', causales_rechazo: 'CAR', declaratoria_desierta: 'DD', reglas_subsanabilidad: 'RS', garantias: 'GA',
    riesgos_contractuales: 'RI', acuerdos_comerciales: 'AC', anexos_formatos_matrices_formularios: 'AN', alertas: 'AL',
    inhabilidades_incompatibilidades: 'II', estampillas_impuestos_retenciones: 'EI', unspsc: 'UN',
    mano_obra_personal_perfiles: 'MO', insumos_equipos_dotacion_epp_examenes: 'IE',
    supervision_ans_tiempos_respuesta: 'SA', documentos_externos_referenciados: 'DE',
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
        if (f.objeto && f.objeto !== NR) { fichaGeneral = f; break; }
        if (!fichaGeneral) fichaGeneral = f;
      }
    }
    if (fichaGeneral?.objeto && String(fichaGeneral.objeto) !== NR) break;
  }

  const secciones: Record<string, ItemPC[]> = {};
  for (const key of ARRAY_KEYS) {
    const mapaDedup = new Map<string, { idx: number; prioridad: number }>();
    const acumulado: ItemPC[] = [];
    for (const r of docsSorted) {
      for (const bloque of r.bloques) {
        const arrVal = bloque[key];
        if (Array.isArray(arrVal)) acumulado.push(...dedup(arrVal as ItemPC[], r.prioridadDedup, mapaDedup));
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

  // Temas no encontrados / no desarrollados — únicos, tomados de todos los bloques
  const temasSet = new Set<string>();
  for (const r of docsSorted) for (const b of r.bloques) {
    if (Array.isArray(b.temas_no_encontrados_o_no_desarrollados)) {
      for (const t of b.temas_no_encontrados_o_no_desarrollados) if (typeof t === 'string' && t.trim()) temasSet.add(t.trim());
    }
  }

  // Objetos de valor único — primer valor no vacío/NR encontrado
  const primerObjetoValido = (campo: 'comunicaciones_secop' | 'forma_pago_reajuste_facturacion'): Record<string, unknown> | null => {
    for (const r of docsSorted) for (const b of r.bloques) {
      const v = b[campo];
      if (v && typeof v === 'object' && Object.values(v).some(x => x && String(x) !== NR)) return v as Record<string, unknown>;
    }
    return null;
  };

  const cntMinuta = (...keys: string[]) => keys.reduce((a, k) => a + (minuta[k]?.length ?? 0), 0);
  const siNo = (n: number) => n > 0 ? 'SÍ' : 'NO_ENCONTRADO';
  const totalMinutaItems = Object.values(minuta).reduce((a, arrVal) => a + arrVal.length, 0);
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

  const controlLecturaDocumento = {
    documentos_leidos: docsAnalizados.length,
    bloques_procesados: resultadosPorDoc.reduce((acc, r) => acc + r.bloques.length, 0),
    metodos_extraccion: resultadosPorDoc.map(r => ({ nombre: r.nombreDoc, totalPaginas: r.totalPaginas ?? null, metodoExtraccion: r.metodoExtraccion ?? null })),
    tipo_analisis: 'ANALISIS_UNICO_EXPERTO',
    advertencias: resultadosPorDoc.flatMap(r => r.advertencias),
  };

  return {
    codigo_proceso: codigoProceso,
    tipo_analisis: 'analisis_unico_experto',
    documentos_analizados: docsAnalizados,
    bloques_procesados: resultadosPorDoc.reduce((acc, r) => acc + r.bloques.length, 0),
    control_lectura_documento: controlLecturaDocumento,
    ficha_general_proceso: fichaGeneral ?? {},
    comunicaciones_secop: primerObjetoValido('comunicaciones_secop') ?? {},
    forma_pago_reajuste_facturacion: primerObjetoValido('forma_pago_reajuste_facturacion') ?? {},
    ...secciones,
    temas_no_encontrados_o_no_desarrollados: Array.from(temasSet),
    resumen_ejecutivo_experto: resumenExperto,
    minuta_condiciones_contractuales: minuta,
    validacion_contractual: validacionContractual,
    validacion_final: {
      documentos_revisados: docsAnalizados.length,
      advertencias: resultadosPorDoc.flatMap(r => r.advertencias),
      observacion_final: `Análisis único experto consolidado de ${docsAnalizados.length} documento(s) del proceso ${codigoProceso}.`,
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
      const esBase64 = !!docInfo.pdfBase64?.trim();
      if (!esBase64 && !docInfo.url?.trim()) continue;

      const prioridadDedup = docInfo.prioridadDedup ?? docInfo.prioridad;
      const tipoFuente = esBase64 ? 'pdf' : detectarTipoFuente(docInfo.nombre, docInfo.url);

      if (tipoFuente === 'otro') {
        resultadosPorDoc.push({ nombreDoc: docInfo.nombre, tipoDoc: docInfo.tipo, prioridad: docInfo.prioridad, prioridadDedup, bloques: [], advertencias: [`Formato no soportado para "${docInfo.nombre}".`] });
        continue;
      }

      let buf: Buffer;
      try {
        buf = esBase64 ? Buffer.from(docInfo.pdfBase64!, 'base64') : await descargar(docInfo.url);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        resultadosPorDoc.push({ nombreDoc: docInfo.nombre, tipoDoc: docInfo.tipo, prioridad: docInfo.prioridad, prioridadDedup, bloques: [], advertencias: [`Descarga fallida "${docInfo.nombre}": ${msg}`] });
        continue;
      }

      let bloques: BloqueTexto[] = [];
      let advertencias: string[] = [];
      let totalPaginas: number | undefined;
      let metodoExtraccion: string | undefined;

      if (tipoFuente === 'word') {
        const res = await extraerWord(buf, docInfo.nombre);
        advertencias = res.advertencias;
        metodoExtraccion = 'word';
        if (!res.texto.trim()) { resultadosPorDoc.push({ nombreDoc: docInfo.nombre, tipoDoc: docInfo.tipo, prioridad: docInfo.prioridad, prioridadDedup, bloques: [], advertencias, metodoExtraccion }); continue; }
        bloques = dividirTextoEnBloques(res.texto, 'word');
      } else if (tipoFuente === 'excel') {
        const res = await extraerExcel(buf, docInfo.nombre);
        advertencias = res.advertencias;
        metodoExtraccion = 'excel';
        if (!res.texto.trim()) { resultadosPorDoc.push({ nombreDoc: docInfo.nombre, tipoDoc: docInfo.tipo, prioridad: docInfo.prioridad, prioridadDedup, bloques: [], advertencias, metodoExtraccion }); continue; }
        bloques = dividirTextoEnBloques(res.texto, 'excel', res.hojas);
      } else {
        const extRes = await extraerPdfTexto(buf);
        advertencias = extRes.advertencias;
        totalPaginas = extRes.totalPaginas;
        metodoExtraccion = extRes.metodo;
        if (!extRes.paginas.length) { resultadosPorDoc.push({ nombreDoc: docInfo.nombre, tipoDoc: docInfo.tipo, prioridad: docInfo.prioridad, prioridadDedup, bloques: [], advertencias: [...extRes.advertencias, `"${docInfo.nombre}": PDF sin texto.`], totalPaginas, metodoExtraccion }); continue; }
        bloques = dividirPaginasEnBloques(extRes.paginas);
        if (extRes.metodo === 'document_ai_ocr') {
          const hashCorto = createHash('sha256').update(buf.subarray(0, 8192)).digest('hex').slice(0, 12);
          void auditLog({ accion: 'document_ai_ocr_usado', recurso: 'lectura/document-ai-ocr', usuarioId, detalle: { nombreDocumento: docInfo.nombre, hashCorto, totalPaginas: extRes.totalPaginas, totalChars: extRes.paginas.map((p: { texto: string }) => p.texto).join('').length, metodoExtraccion: 'document_ai_ocr', paginasOcr: extRes.paginas.filter((p: { texto: string }) => p.texto.trim().length > 0).length } });
        }
        console.log(`[unico:bg] PDF "${docInfo.nombre}": ${extRes.paginas.length} págs | ${bloques.length} bloques | ${extRes.metodo}`);
      }

      const bloquesResultados: ResultadoBloqueUnico[] = new Array(bloques.length).fill({});

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

      resultadosPorDoc.push({ nombreDoc: docInfo.nombre, tipoDoc: docInfo.tipo, prioridad: docInfo.prioridad, prioridadDedup, bloques: bloquesResultados, advertencias, totalPaginas, metodoExtraccion });
    }

    if (!resultadosPorDoc.some(r => r.bloques.length > 0)) {
      await prisma.lecturaAnalisis.update({
        where: { id: analisisId },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { resultado: { estado: 'ERROR', mensaje: 'Ningún documento fue procesado exitosamente.' } as any },
      });
      return;
    }

    const resultadoFinal = consolidarUnico(resultadosPorDoc, codigoProceso);
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

    console.log(`[unico:bg] Análisis ${analisisId} COMPLETADO. Docs: ${resultadosPorDoc.filter(r => r.bloques.length > 0).length}. Tokens: in=${totalTokensIn}, out=${totalTokensOut}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[unico:bg] Error en análisis ${analisisId}: ${msg}`);
    try {
      await prisma.lecturaAnalisis.update({
        where: { id: analisisId },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { resultado: { estado: 'ERROR', mensaje: msg.slice(0, 500) } as any },
      });
    } catch (dbErr) {
      console.error('[unico:bg] Error guardando ERROR en BD:', dbErr);
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
      modo: MODO,
      docs: docsAAnalizar.map(d => ({ url: d.url?.trim() || '', tipo: d.tipo, b64: d.pdfBase64 ? createHash('sha256').update(d.pdfBase64).digest('hex').slice(0, 16) : '' })).sort((a, b) => (a.url || a.b64).localeCompare(b.url || b.b64)),
    })
  ).digest('hex');

  const usuarioId = await resolveSessionUserId(session!);
  if (usuarioId === null) {
    return NextResponse.json(
      { ok: false, error: 'Sesión inválida. Inicie sesión nuevamente.' },
      { status: 401 }
    );
  }

  if (!forzarReanalisis) {
    try {
      const existente = await prisma.lecturaAnalisis.findFirst({
        where: {
          codigoProceso: codigoProceso || null,
          modo: MODO,
          pdfHash: seleccionHash,
          ...(isAdmin(session.rol) ? {} : { usuarioId }),
        },
        orderBy: { creadoEn: 'desc' },
      });
      if (existente) {
        const res = existente.resultado as { estado?: string } | null;
        const estadoExistente = String(res?.estado ?? 'COMPLETADO');

        if (estadoExistente === 'COMPLETADO') {
          void auditFromRequest(req, session, { accion: 'analisis_unico_experto', recurso: 'lectura_analisis', recursoId: String(existente.id), detalle: { modo: MODO, codigoProceso: codigoProceso || null, cache: true } });
          return NextResponse.json({ ok: true, cached: true, estado: 'COMPLETADO', analisisId: existente.id, resultado: existente.resultado, tokens: { entrada: existente.tokensEntrada, salida: existente.tokensSalida } });
        }
        if (estadoExistente === 'PROCESANDO') {
          const msElapsed = Date.now() - existente.creadoEn.getTime();
          if (msElapsed < 20 * 60 * 1000) {
            return NextResponse.json({ ok: true, estado: 'PROCESANDO', analisisId: existente.id, seleccionHash, mensaje: 'El análisis ya está en proceso. La pantalla consultará el avance automáticamente.' });
          }
        }
      }
    } catch (cacheErr) {
      console.warn('[analizar-unico] Error en búsqueda de caché (continuando):', {
        errorMessage: (cacheErr as Error)?.message?.slice(0, 200),
        codigoProceso,
      });
    }
  }

  // Reutiliza el mismo cupo diario que el antiguo análisis "proceso completo" —
  // es el mismo tipo de operación pesada (multi-bloque, multi-documento).
  const rlC = await checkGeminiRateLimitPg(usuarioId, 'completo');
  if (rlC.bloqueado) {
    return NextResponse.json({ ok: false, error: `Límite diario de análisis alcanzado (${rlC.usos}/${rlC.limite}). Intente mañana.` }, { status: 429 });
  }

  void recordGeminiUsagePg(usuarioId, 'completo');

  // Documentos subidos como archivo local (pdfBase64, sin URL externa) se guardan
  // como blob para poder volver a mostrar el PDF en el visor tras el análisis.
  // Pliegos reales de decenas/cientos de páginas suelen pesar varios MB; 4 MB
  // dejaba fuera casos comunes (ej. 145 páginas) y el PDF quedaba sin poder
  // previsualizarse. Postgres soporta este tamaño en un campo text sin problema.
  const PDF_BLOB_MAX = 20 * 1024 * 1024;
  const docConBase64 = docsAAnalizar.length === 1 ? docsAAnalizar[0] : undefined;
  const pdfBlobToStore = (docConBase64?.pdfBase64 && !docConBase64.url?.trim() && Buffer.byteLength(docConBase64.pdfBase64, 'base64') <= PDF_BLOB_MAX)
    ? docConBase64.pdfBase64
    : null;

  let analisisId: number;
  try {
    const registro = await prisma.lecturaAnalisis.create({
      data: {
        nombreDocumento: docsAAnalizar[0]?.nombre || `Análisis único experto — ${codigoProceso || 'proceso'}`,
        urlDocumento: docsAAnalizar.length === 1 ? (docsAAnalizar[0]?.url?.trim() || null) : null,
        pdfHash: seleccionHash,
        modo: MODO,
        pdfBlob: pdfBlobToStore,
        codigoProceso: codigoProceso || null,
        entidad: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        resultado: { estado: 'PROCESANDO', seleccionHash, mensaje: 'Análisis único experto en proceso', documentos: docsAAnalizar.map(d => ({ nombre: d.nombre, tipo: d.tipo })) } as any,
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
    console.error('[analizar-unico] Error creando LecturaAnalisis', {
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

  Promise.resolve().then(() =>
    procesarEnSegundoPlano(analisisId, docsAAnalizar, codigoProceso, apiKey, usuarioId)
      .catch(err => console.error('[unico:bg] Uncaught:', err))
  );

  void auditFromRequest(req, session, { accion: 'analisis_unico_experto', recurso: 'lectura_analisis', recursoId: String(analisisId), detalle: { modo: MODO, codigoProceso: codigoProceso || null, cache: false, documentosCount: docsAAnalizar.length } });

  return NextResponse.json({
    ok: true,
    estado: 'PROCESANDO',
    analisisId,
    seleccionHash,
    mensaje: 'El análisis único experto se está ejecutando. La pantalla consultará el avance automáticamente.',
  });
}