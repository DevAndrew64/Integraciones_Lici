/**
 * Ajuste "DOCUMENTACIÓN — DESCARGAR TODO (ZIP)" — lógica pura (sin
 * `fetch`, sin `archiver`, sin React) para interpretar `Solicitud.docData`
 * (JSON suelto, sin interfaz estricta — mismo campo que ya consume la
 * pestaña Documentación en `page.tsx`, ver `descargarDoc`/`getDocExt`,
 * MISMA resolución de campos: `ruta||url||link`, `nombre||titulo`,
 * `tipo||mimeType`, `base64`, `extension`) y para construir nombres de
 * archivo seguros y sin colisiones dentro del ZIP generado por
 * `src/app/api/solicitudes/[id]/documentos/descargar-todo/route.ts`.
 *
 * Nunca decide QUÉ documentos existen (eso es responsabilidad exclusiva
 * del endpoint, que lee `docData` directo de Prisma — nunca de una lista
 * enviada por el cliente) — este módulo solo interpreta/sanea lo que ya
 * se le entrega.
 */

export interface DocumentoParaZip {
  /** Nombre a mostrar (sin sanear, puede o no traer extensión). */
  nombre: string;
  /** URL externa (SECOP/Licicont/servidor propio) — vacío si el
   * documento solo trae `base64`. */
  url: string;
  /** Contenido embebido en base64 — vacío si el documento solo trae `url`. */
  base64: string;
  /** MIME type declarado (`tipo`/`mimeType` en el JSON crudo). */
  mimeType: string;
  /** Extensión declarada explícitamente en el JSON (`extension`), sin el
   * punto — puede estar vacía. */
  extensionDeclarada: string;
}

/** Único punto de lectura de `docData` — misma tolerancia que `safeArray`
 * de `page.tsx` (array no válido ⇒ arreglo vacío, nunca lanza) y misma
 * resolución de campos que `descargarDoc`/`getDocExt`. Conserva TODOS los
 * elementos de `docData` (incluso los que no traen ni `url` ni `base64`
 * utilizables) — el endpoint decide qué hacer con cada uno al intentar
 * obtener su contenido; este extractor nunca descarta datos por su cuenta. */
export function extraerDocumentosDeDocData(docData: unknown): DocumentoParaZip[] {
  if (!Array.isArray(docData)) return [];
  return docData.map((raw, i) => {
    const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return {
      nombre: String(d.nombre || d.titulo || `Documento ${i + 1}`),
      url: String(d.ruta || d.url || d.link || ''),
      base64: String(d.base64 || ''),
      mimeType: String(d.tipo || d.mimeType || ''),
      extensionDeclarada: String(d.extension || '').toLowerCase().replace(/^\./, '').trim(),
    };
  });
}

/** Mapa mínimo MIME → extensión para los tipos que realmente circulan en
 * `docData` (documentos de procesos de contratación) — nunca se inventa
 * una extensión para un MIME desconocido, se prefiere devolver `''` (el
 * llamador decide el fallback). */
const EXTENSION_POR_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/vnd.rar': 'rar',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'text/plain': 'txt',
};

const EXTENSION_VALIDA = /^[a-z0-9]{1,6}$/i;

/** Extensión ya presente al final de `nombre` o `url` (antes del query
 * string), si la hay — nunca inventa una extensión que no está ahí. */
function extensionDesdeTexto(texto: string): string {
  const sinQuery = texto.split(/[?#]/)[0] || '';
  const m = /\.([a-z0-9]{1,6})$/i.exec(sinQuery.trim());
  return m ? m[1].toLowerCase() : '';
}

/** Ajuste "CONSERVAR EXTENSIÓN ORIGINAL" — prioridad: extensión ya
 * incluida en `nombre` → extensión declarada explícitamente en el JSON
 * (`extension`) → extensión de la URL → mapa de `mimeType` → `''` (sin
 * adivinar). Nunca fuerza `.pdf` sobre un archivo de tipo desconocido
 * (a diferencia del badge visual `getDocExt`, que sí categoriza todo lo
 * no reconocido como "PDF" solo para el ícono — esa simplificación NO es
 * válida para nombrar el archivo real dentro del ZIP). */
export function resolverExtensionArchivo(doc: DocumentoParaZip): string {
  const enNombre = extensionDesdeTexto(doc.nombre);
  if (enNombre) return enNombre;
  if (doc.extensionDeclarada && EXTENSION_VALIDA.test(doc.extensionDeclarada)) return doc.extensionDeclarada;
  const enUrl = extensionDesdeTexto(doc.url);
  if (enUrl) return enUrl;
  const porMime = EXTENSION_POR_MIME[doc.mimeType.toLowerCase().trim()];
  if (porMime) return porMime;
  return '';
}

/** Nombre final de la entrada dentro del ZIP, CON extensión (si `nombre`
 * ya la traía, se respeta tal cual; si no, se le agrega la resuelta por
 * `resolverExtensionArchivo`) — todavía SIN sanear ni deduplicar, ver
 * `sanearNombreEntradaZip`/`nombreUnicoEnZip`. */
export function resolverNombreConExtension(doc: DocumentoParaZip): string {
  const yaTraeExtension = extensionDesdeTexto(doc.nombre) !== '';
  if (yaTraeExtension) return doc.nombre;
  const ext = resolverExtensionArchivo(doc);
  return ext ? `${doc.nombre}.${ext}` : doc.nombre;
}

/** Ajuste "SEGURIDAD — SANITIZAR NOMBRES DE ARCHIVO / PATH TRAVERSAL" —
 * elimina cualquier separador de ruta (`/`, `\`), secuencias `..`,
 * caracteres de control y comillas — nunca permite que un nombre de
 * `docData` (dato semi-confiable, viene de fuentes externas como SECOP)
 * escriba fuera del directorio esperado dentro del ZIP ni rompa el header
 * `Content-Disposition`. Preserva espacios/acentos/paréntesis para que el
 * nombre siga siendo legible (requisito explícito del usuario) — NO es
 * el mismo saneo agresivo que `nombreArchivoZipProceso` (ese sí colapsa
 * todo a `_`, porque termina en un header HTTP, no dentro del ZIP). */
export function sanearNombreEntradaZip(nombreCrudo: string): string {
  let nombre = (nombreCrudo || 'documento').normalize('NFC');
  nombre = nombre.replace(/[\\/]+/g, '_');
  nombre = nombre.replace(/\.\.+/g, '_');
  // eslint-disable-next-line no-control-regex
  nombre = nombre.replace(/["\x00-\x1f\x7f]/g, '');
  nombre = nombre.trim();
  if (!nombre || nombre === '.' || nombre === '_') nombre = 'documento';
  if (nombre.length > 180) {
    const idx = nombre.lastIndexOf('.');
    const ext = idx > 0 && idx > nombre.length - 8 ? nombre.slice(idx) : '';
    nombre = nombre.slice(0, 180 - ext.length) + ext;
  }
  return nombre;
}

/** Ajuste "EVITAR COLISIONES DE NOMBRE" — `Acta.pdf` + `Acta.pdf` ⇒
 * `Acta.pdf` + `Acta (2).pdf`, nunca sobrescribe una entrada dentro del
 * ZIP. `usados` se muta (agrega el nombre final elegido) — el llamador
 * debe reutilizar el MISMO `Set` para todos los documentos de un mismo
 * ZIP. */
export function nombreUnicoEnZip(nombreDeseado: string, usados: Set<string>): string {
  if (!usados.has(nombreDeseado)) {
    usados.add(nombreDeseado);
    return nombreDeseado;
  }
  const idx = nombreDeseado.lastIndexOf('.');
  // Extensión solo si es corta y no es el primer carácter (evita tratar
  // ".gitignore"-like o nombres sin extensión real como si la tuvieran).
  const tieneExtension = idx > 0 && nombreDeseado.length - idx <= 7;
  const base = tieneExtension ? nombreDeseado.slice(0, idx) : nombreDeseado;
  const ext = tieneExtension ? nombreDeseado.slice(idx) : '';
  let n = 2;
  let candidato = `${base} (${n})${ext}`;
  while (usados.has(candidato)) {
    n++;
    candidato = `${base} (${n})${ext}`;
  }
  usados.add(candidato);
  return candidato;
}

/** Nombre final de la entrada dentro del ZIP para un documento — combina
 * resolución de extensión + saneo + deduplicación en un solo paso,
 * mutando `usados` (mismo `Set` para todos los documentos del ZIP). */
export function resolverEntradaZipParaDocumento(doc: DocumentoParaZip, usados: Set<string>): string {
  const conExtension = resolverNombreConExtension(doc);
  const saneado = sanearNombreEntradaZip(conExtension);
  return nombreUnicoEnZip(saneado, usados);
}

/** Ajuste "NOMBRE DEL ARCHIVO ZIP — CONVENCIÓN DEL PROYECTO" — mismo
 * patrón de saneo ya usado por `nombreArchivoExportacion`
 * (`generar-excel-mano-obra.ts`): `/[^a-zA-Z0-9-_]/g → '_'` sobre el
 * código de proceso (nunca el mismo saneo "legible" de las entradas
 * internas del ZIP — este nombre termina en un header HTTP
 * `Content-Disposition`, exige ser agresivo). `codigoProceso`
 * ausente/vacío ⇒ usa el id numérico de la solicitud como respaldo,
 * igual criterio que `nombreArchivoExportacion(dto.numeroProceso ||
 * String(dto.procesoId))`. */
export function nombreArchivoZipProceso(codigoProceso: string | null | undefined, solicitudId: number, fecha: Date = new Date()): string {
  const base = (codigoProceso || '').trim() || String(solicitudId);
  const saneado = base.replace(/[^a-zA-Z0-9-_]/g, '_');
  const fechaIso = fecha.toISOString().slice(0, 10);
  return `Documentos_${saneado}_${fechaIso}.zip`;
}
