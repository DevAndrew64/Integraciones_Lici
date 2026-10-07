/**
 * Motor GENÉRICO de normalización de familias de producto para el catálogo
 * de Dotación/EPP ("CORRECCIÓN DE ENFOQUE — NORMALIZAR TODO EL CATÁLOGO").
 *
 * Reemplaza el enfoque de "una regla por producto observado" por un pipeline
 * de 12 pasos que opera sobre ESTRUCTURA del texto (puntuación, talla,
 * abreviaturas, morfología, conectores) — nunca sobre nombres de producto
 * específicos. Los nombres reales usados en los comentarios/tests son solo
 * EJEMPLOS del catálogo real (medidos vía diagnóstico, ver
 * scripts/diagnostico), no casos codificados.
 *
 * Diagnóstico real (24.744 filas crudas / 693 códigos únicos / 3
 * combinaciones empresa+uen + EPP, medido 2026-08-02):
 *  - talla: 8 formatos distintos conviven (T. NN, T:NN, T-NN, T NN, TNN,
 *    TALLA NN, TALLA: NN, T:LETRA) — de ahí que la extracción de talla se
 *    haga DESPUÉS de normalizar puntuación a espacios (así "T.38"/"T:38"/
 *    "T-38" quedan todos como "T 38" y una sola expresión los cubre).
 *  - abreviaturas recurrentes con >100 apariciones: SEG(495), R.H(495),
 *    M/L(2265), M/C(64), GCOLBA/GRUPO COLBA(5819).
 *  - pares singular/plural reales: BOTA/BOTAS(2048/8958),
 *    SENCILLA/SENCILLAS(2046/372), CAMISA/CAMISAS, GORRA/GORRAS,
 *    ANALISTA/ANALISTAS, RAYA/RAYAS, REFLECTIVO/REFLECTIVOS,
 *    SALVAVIDA/SALVAVIDAS, MEDIA/MEDIAS.
 *  - la API NO trae ningún campo estructurado de familia/talla/referencia/
 *    sexo/categoría (ni en Dotación ni en EPP) — el nombre de texto libre es
 *    la única fuente; EPP además usa el campo `nombre` en vez de
 *    `descripcion` y no trae `fecha_ultima_compra`.
 */
import { buscarCampo } from './catalogo-dotacion-filtro';

export const normalizadorVersion = 1;

// ---------------------------------------------------------------------------
// 1-4. normalizarTextoProducto — Unicode → mayúsculas → sin tildes →
// puntuación/separadores a espacio. Deliberadamente NO toca talla ni
// abreviaturas todavía: esos pasos necesitan el texto ya libre de puntuación
// para reconocer un único patrón sin importar el separador original.
// ---------------------------------------------------------------------------
function quitarTildes(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function normalizarTextoProducto(nombre: string): string {
  let n = String(nombre ?? '').normalize('NFC').trim().toUpperCase();
  n = quitarTildes(n);
  n = n.replace(/[.\-:/,;()]/g, ' ');
  n = n.replace(/\s+/g, ' ').trim();
  return n;
}

// ---------------------------------------------------------------------------
// 5. extraerTallaProducto — marcador T/TALLA + talla, en CUALQUIER posición
// del texto (no solo al final). Requiere el marcador T/TALLA inmediatamente
// antes del valor: esa exigencia estructural (no la posición) es lo que
// evita cortar números reales de modelo/referencia/calibre/norma técnica
// ("REF 080", "MODELO 2025", "3M 6200", "CALIBRE 13", "100% ALGODON",
// "N95", "ANSI Z87 1" — ninguno tiene un marcador T/TALLA delante).
// ---------------------------------------------------------------------------
const TAMANOS = '(?:\\d{1,2}|XXS|XS|S|M|L|XL|XXL|XXXL|\\d?XL|UNICA)';
const PATRON_TALLA = new RegExp(`\\bT(?:ALLA)?\\s?${TAMANOS}\\b`, 'gi');
const PATRON_TALLA_CAPTURA = new RegExp(`\\bT(?:ALLA)?\\s?(${TAMANOS})\\b`, 'i');

export interface ResultadoTalla {
  textoSinTalla: string;
  tallaExtraida: string | null;
}

export function extraerTallaProducto(textoNormalizado: string): ResultadoTalla {
  const captura = textoNormalizado.match(PATRON_TALLA_CAPTURA);
  const textoSinTalla = textoNormalizado.replace(PATRON_TALLA, ' ').replace(/\s+/g, ' ').trim();
  return { textoSinTalla, tallaExtraida: captura ? captura[1].toUpperCase() : null };
}

// ---------------------------------------------------------------------------
// 6/10. extraerAtributosProtegidos — captura (sin retirar del texto) los
// números/expresiones que SÍ deben permanecer y diferenciar variantes reales:
// referencia, modelo, calibre, marca+modelo técnico (3M NNNN), norma técnica
// (ANSI/N95) y composición (%). No se eliminan del texto porque deben seguir
// formando parte de la firma de familia (§7 — no fusionar productos con
// referencia/modelo distintos).
// ---------------------------------------------------------------------------
export interface AtributosProtegidos {
  referencia: string | null;
  modelo: string | null;
  calibre: string | null;
  marcaTecnica: string | null; // p.ej. "3M 6200"
  norma: string | null; // p.ej. "ANSI Z87 1", "N95"
  composicion: string[]; // p.ej. ["100%"]
}

export function extraerAtributosProtegidos(textoNormalizado: string): AtributosProtegidos {
  const ref = textoNormalizado.match(/\bREF\s?(\d+)\b/i);
  const modelo = textoNormalizado.match(/\bMODELO\s?(\d+)\b/i);
  const calibre = textoNormalizado.match(/\bCALIBRE\s?(\d+)\b/i);
  const marca3m = textoNormalizado.match(/\b3M\s?(\d+)\b/i);
  const ansi = textoNormalizado.match(/\bANSI\s?Z[\d\s]+\b/i);
  const n9x = textoNormalizado.match(/\bN\d{2,3}\b/);
  const composicion = textoNormalizado.match(/\b\d{1,3}%/g) ?? [];
  return {
    referencia: ref ? ref[1] : null,
    modelo: modelo ? modelo[1] : null,
    calibre: calibre ? calibre[1] : null,
    marcaTecnica: marca3m ? `3M ${marca3m[1]}` : null,
    norma: ansi ? ansi[0].replace(/\s+/g, ' ').trim() : (n9x ? n9x[0] : null),
    composicion,
  };
}

// ---------------------------------------------------------------------------
// 7. Diccionario ÚNICO y CENTRAL de abreviaturas/alias generales (§6 del
// ajuste) — equivalencias lingüísticas o corporativas confirmadas, nunca
// nombres completos de producto. Aplicado sobre el texto YA sin puntuación
// (así "SEG." llega como "SEG" y "R.H" como "R H", ambos palabras sueltas).
// ---------------------------------------------------------------------------
const ABREVIATURAS: [RegExp, string][] = [
  [/\bSEGUR\b/g, 'SEGURIDAD'],
  [/\bSEG\b/g, 'SEGURIDAD'],
  [/\bR\s?H\b/g, 'RH'],
  [/\bM\s?L\b/g, 'MANGA LARGA'],
  [/\bMANGA\s+LARGA\b/g, 'MANGA LARGA'],
  [/\bM\s?C\b/g, 'MANGA CORTA'],
  [/\bMANGA\s+CORTA\b/g, 'MANGA CORTA'],
  [/\bGRUPO\s+COLBA\b/g, 'GRUPOCOLBA'],
  [/\bG\s?COLBA\b/g, 'GRUPOCOLBA'],
];

export function expandirAbreviaturasProducto(texto: string): string {
  let n = texto;
  for (const [patron, alias] of ABREVIATURAS) n = n.replace(patron, alias);
  return n.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// 8. Normalización morfológica CONSERVADORA (singular/plural) — reglas
// lingüísticas generales, nunca una lista de productos. Excepciones: siglas/
// marcas cortas (protegidas también por el guard de longitud) y nombres
// comerciales cuyo "singular" cambiaría la denominación (GAFAS).
// ---------------------------------------------------------------------------
const EXCEPCIONES_SINGULAR = new Set(['GAFAS']);

function singularizar(token: string): string {
  if (EXCEPCIONES_SINGULAR.has(token)) return token;
  if (token.length <= 3) return token; // protege siglas/marcas: RH, ML, 3M, EPP, GPS, PVC
  // Plural en "-ES" tras consonante N/L/R/D/Z (PANTALONES→PANTALON, COLORES→COLOR)
  if (/[NLRDZ]ES$/.test(token)) return token.slice(0, -2);
  // Plural regular tras vocal + S (BOTAS→BOTA, GUANTES→GUANTE, REFLECTIVOS→REFLECTIVO)
  if (/[AEIOU]S$/.test(token)) return token.slice(0, -1);
  return token;
}

// ---------------------------------------------------------------------------
// 9. Conectores SIN valor distintivo — se retiran solo si aparecen como
// token independiente. CON/SIN/PARA se conservan siempre porque pueden
// distinguir productos reales (§9 del ajuste).
// ---------------------------------------------------------------------------
const CONECTORES_SIN_VALOR = new Set(['DE', 'DEL', 'EL', 'LA']);

/**
 * Tokeniza el texto (ya sin talla, con abreviaturas expandidas) aplicando
 * singularización conservadora y retiro de conectores. Devuelve tokens en
 * el orden original — el llamador decide si ordenarlos (firma canónica) o
 * conservarlos (lectura).
 */
export function normalizarTokensProducto(textoSinTalla: string): string[] {
  const expandido = expandirAbreviaturasProducto(textoSinTalla);
  return expandido
    .split(' ')
    .filter(Boolean)
    .filter(tok => !CONECTORES_SIN_VALOR.has(tok))
    .map(singularizar);
}

// ---------------------------------------------------------------------------
// 10/11. construirFamiliaKey — firma canónica INDEPENDIENTE DEL ORDEN:
// tokens normalizados + atributos protegidos (referencia/modelo/calibre/
// marca técnica/norma/composición, que nunca se retiran del texto y por
// tanto ya forman parte de los tokens), ordenados alfabéticamente.
// §10: si el registro trae un campo estructurado de familia confiable, se
// usa ese ANTES que inferir desde el nombre (hoy esta API no lo trae en
// ningún catálogo medido, pero la función queda lista).
// ---------------------------------------------------------------------------
const CAMPOS_FAMILIA_ESTRUCTURADA = [
  'familia', 'productobase', 'producto_base', 'referencia',
  'codigomaestro', 'codigo_maestro', 'codigopadre', 'codigo_padre', 'modelo',
];

function nombreDe(registro: Record<string, unknown>): string {
  return String(buscarCampo(registro, 'nombre', 'descripcion', 'description', 'name') ?? '');
}

export function construirFamiliaKey(registro: Record<string, unknown>): string {
  const estructurado = buscarCampo(registro, ...CAMPOS_FAMILIA_ESTRUCTURADA);
  if (estructurado !== undefined && String(estructurado).trim() !== '') {
    return String(estructurado).trim().toUpperCase();
  }
  const normalizado = normalizarTextoProducto(nombreDe(registro));
  const { textoSinTalla } = extraerTallaProducto(normalizado);
  const tokens = normalizarTokensProducto(textoSinTalla);
  return [...tokens].sort().join('|');
}

// ---------------------------------------------------------------------------
// 12. NIVEL 2 — selección de variante representativa dentro de una familia.
// Prioridad exacta: 1) valor vigente válido; 2) mayor valor; 3) fecha de
// compra más reciente; 4) updatedAt más reciente (no existe en esta API);
// 5) código menor por comparación NATURAL (numérica cuando ambos lados son
// dígitos, para que "P9" quede antes que "P10") como último criterio
// determinístico — nunca "el primero visto", que dependería del orden en
// que la API entregue las filas.
// ---------------------------------------------------------------------------
function tieneValorValido(registro: Record<string, unknown>): boolean {
  const v = Number(buscarCampo(registro, 'valor', 'precio', 'price', 'vlr', 'value'));
  return !!v && !isNaN(v) && v > 0;
}

function valorDe(registro: Record<string, unknown>): number {
  return Number(buscarCampo(registro, 'valor', 'precio', 'price', 'vlr', 'value')) || 0;
}

function fechaValidaDe(registro: Record<string, unknown>): Date | null {
  const f = buscarCampo(registro, 'fecha_ultima_compra', 'fechaultimacompra', 'ultima_compra', 'fecha_compra');
  if (f === undefined) return null;
  const d = new Date(String(f));
  return isNaN(d.getTime()) ? null : d;
}

function updatedAtDe(registro: Record<string, unknown>): Date | null {
  const f = buscarCampo(registro, 'updatedat', 'updated_at', 'fechaactualizacion', 'fecha_actualizacion');
  if (f === undefined) return null;
  const d = new Date(String(f));
  return isNaN(d.getTime()) ? null : d;
}

function codigoDe(registro: Record<string, unknown>): string {
  return String(buscarCampo(registro, 'codigo', 'code', 'ref') ?? '');
}

/** Compara dos códigos en orden NATURAL (segmentos numéricos como número, no como texto). */
function compararCodigoNatural(a: string, b: string): number {
  const partir = (s: string) => s.match(/\d+|\D+/g) ?? [s];
  const pa = partir(a);
  const pb = partir(b);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? '';
    const y = pb[i] ?? '';
    if (x === y) continue;
    const nx = Number(x), ny = Number(y);
    const numX = x !== '' && !isNaN(nx);
    const numY = y !== '' && !isNaN(ny);
    if (numX && numY) return nx - ny;
    return x < y ? -1 : 1;
  }
  return 0;
}

function ganaSobre<T extends Record<string, unknown>>(candidato: T, actual: T): boolean {
  const candidatoValido = tieneValorValido(candidato);
  const actualValido = tieneValorValido(actual);
  if (candidatoValido !== actualValido) return candidatoValido;

  const vc = valorDe(candidato), va = valorDe(actual);
  if (vc !== va) return vc > va;

  const fc = fechaValidaDe(candidato), fa = fechaValidaDe(actual);
  if (fc && !fa) return true;
  if (!fc && fa) return false;
  if (fc && fa && fc.getTime() !== fa.getTime()) return fc.getTime() > fa.getTime();

  const uc = updatedAtDe(candidato), ua = updatedAtDe(actual);
  if (uc && !ua) return true;
  if (!uc && ua) return false;
  if (uc && ua && uc.getTime() !== ua.getTime()) return uc.getTime() > ua.getTime();

  return compararCodigoNatural(codigoDe(candidato), codigoDe(actual)) < 0;
}

export function seleccionarVarianteRepresentativa<T extends Record<string, unknown>>(candidatos: readonly T[]): T {
  if (candidatos.length === 0) throw new Error('seleccionarVarianteRepresentativa: lista vacía');
  let ganador = candidatos[0];
  for (let i = 1; i < candidatos.length; i++) {
    if (ganaSobre(candidatos[i], ganador)) ganador = candidatos[i];
  }
  return ganador;
}

// ---------------------------------------------------------------------------
// Nivel de confianza (§14) — ALTA: campo estructurado o texto idéntico tras
// solo retirar talla (sin necesitar abreviaturas/plural/reordenar). MEDIA:
// coincide la firma canónica pero el texto (sin talla) no era literalmente
// igual — requirió abreviaturas, singular/plural o reordenar tokens. BAJA
// no se genera aquí (no hay auto-fusión difusa, ver reportarCandidatosDudosos).
// ---------------------------------------------------------------------------
export type NivelConfianza = 'ALTA' | 'MEDIA';

function textoBaseLiteral(registro: Record<string, unknown>): string {
  const estructurado = buscarCampo(registro, ...CAMPOS_FAMILIA_ESTRUCTURADA);
  if (estructurado !== undefined && String(estructurado).trim() !== '') return String(estructurado).trim().toUpperCase();
  const normalizado = normalizarTextoProducto(nombreDe(registro));
  return extraerTallaProducto(normalizado).textoSinTalla;
}

export interface ResultadoConsolidacionCatalogo<T> {
  familias: T[];
  totalFamilias: number;
  confianzaPorCodigo: Record<string, NivelConfianza>;
}

/**
 * NIVEL 2 completo: agrupa por `construirFamiliaKey`, escoge el
 * representante de cada grupo con `seleccionarVarianteRepresentativa` y
 * clasifica el nivel de confianza de cada consolidación. Se aplica SOBRE el
 * resultado ya deduplicado por código (NIVEL 1) — el llamador es responsable
 * de ese orden (filtros → NIVEL 1 por código → NIVEL 2 por familia → paginar).
 */
export function consolidarCatalogoPorFamilia<T extends Record<string, unknown>>(
  registros: readonly T[],
): ResultadoConsolidacionCatalogo<T> {
  const grupos = new Map<string, T[]>();
  for (const registro of registros) {
    const clave = construirFamiliaKey(registro);
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave)!.push(registro);
  }
  const familias: T[] = [];
  const confianzaPorCodigo: Record<string, NivelConfianza> = {};
  for (const [, miembros] of grupos) {
    const ganador = seleccionarVarianteRepresentativa(miembros);
    familias.push(ganador);
    const literales = new Set(miembros.map(textoBaseLiteral));
    confianzaPorCodigo[codigoDe(ganador)] = literales.size === 1 ? 'ALTA' : 'MEDIA';
  }
  return { familias, totalFamilias: familias.length, confianzaPorCodigo };
}

// ---------------------------------------------------------------------------
// §11 — similitud difusa SOLO como apoyo de auditoría, nunca para fusionar
// automáticamente. Reporta pares de familias YA CONSOLIDADAS (claves
// distintas) cuyos conjuntos de tokens se solapan mucho, para revisión
// manual — respeta bloqueadores (atributos protegidos distintos nunca se
// reportan como candidatos, porque ya son motivo suficiente de separación).
// ---------------------------------------------------------------------------
export interface CandidatoDudoso {
  familiaA: string;
  familiaB: string;
  similitud: number;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let interseccion = 0;
  for (const t of a) if (b.has(t)) interseccion++;
  const union = a.size + b.size - interseccion;
  return union === 0 ? 0 : interseccion / union;
}

export function reportarCandidatosDudosos<T extends Record<string, unknown>>(
  familias: readonly T[],
  umbral = 0.7,
): CandidatoDudoso[] {
  const claves = familias.map(f => construirFamiliaKey(f));
  const tokenSets = claves.map(k => new Set(k.split('|')));
  const atributos = familias.map(f => extraerAtributosProtegidos(normalizarTextoProducto(nombreDe(f))));
  const reportes: CandidatoDudoso[] = [];
  for (let i = 0; i < familias.length; i++) {
    for (let j = i + 1; j < familias.length; j++) {
      if (claves[i] === claves[j]) continue;
      const ai = atributos[i], aj = atributos[j];
      const difierenAtributos =
        (ai.referencia && aj.referencia && ai.referencia !== aj.referencia) ||
        (ai.modelo && aj.modelo && ai.modelo !== aj.modelo) ||
        (ai.calibre && aj.calibre && ai.calibre !== aj.calibre);
      if (difierenAtributos) continue;
      const sim = jaccard(tokenSets[i], tokenSets[j]);
      if (sim >= umbral) reportes.push({ familiaA: claves[i], familiaB: claves[j], similitud: sim });
    }
  }
  return reportes;
}
