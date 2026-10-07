/**
 * Ajuste "DOCUMENTACIÓN — DESCARGAR TODO (ZIP)" — tests puros de
 * `documentos-zip.ts` (extracción de `docData`, resolución de
 * extensión/nombre, saneo, deduplicación, nombre del ZIP).
 */
import { describe, it, expect } from 'vitest';
import {
  extraerDocumentosDeDocData, resolverExtensionArchivo, resolverNombreConExtension,
  sanearNombreEntradaZip, nombreUnicoEnZip, resolverEntradaZipParaDocumento,
  nombreArchivoZipProceso, type DocumentoParaZip,
} from './documentos-zip';

function doc(p: Partial<DocumentoParaZip> = {}): DocumentoParaZip {
  return { nombre: 'documento', url: '', base64: '', mimeType: '', extensionDeclarada: '', ...p };
}

describe('extraerDocumentosDeDocData', () => {
  it('no-array (null/undefined/objeto suelto) → arreglo vacío, nunca lanza', () => {
    expect(extraerDocumentosDeDocData(null)).toEqual([]);
    expect(extraerDocumentosDeDocData(undefined)).toEqual([]);
    expect(extraerDocumentosDeDocData({})).toEqual([]);
    expect(extraerDocumentosDeDocData('texto')).toEqual([]);
  });
  it('resuelve nombre/ruta/base64/tipo/extension con la MISMA prioridad que descargarDoc/getDocExt de page.tsx', () => {
    const r = extraerDocumentosDeDocData([
      { nombre: 'Acta.pdf', ruta: 'https://x.com/a.pdf', tipo: 'application/pdf', extension: '.pdf' },
    ]);
    expect(r).toEqual([{ nombre: 'Acta.pdf', url: 'https://x.com/a.pdf', base64: '', mimeType: 'application/pdf', extensionDeclarada: 'pdf' }]);
  });
  it('usa titulo si no hay nombre, url/link si no hay ruta', () => {
    const r = extraerDocumentosDeDocData([{ titulo: 'Título X', url: 'https://x.com/y' }, { link: 'https://x.com/z' }]);
    expect(r[0].nombre).toBe('Título X');
    expect(r[0].url).toBe('https://x.com/y');
    expect(r[1].url).toBe('https://x.com/z');
  });
  it('conserva TODOS los elementos, incluso sin url/base64 utilizables (el endpoint decide qué hacer)', () => {
    const r = extraerDocumentosDeDocData([{}, { nombre: 'x' }]);
    expect(r).toHaveLength(2);
  });
  it('sin nombre/titulo → "Documento N" (1-indexado)', () => {
    const r = extraerDocumentosDeDocData([{}, {}]);
    expect(r[0].nombre).toBe('Documento 1');
    expect(r[1].nombre).toBe('Documento 2');
  });
});

describe('resolverExtensionArchivo — nunca fuerza .pdf sobre un tipo desconocido', () => {
  it('extensión ya en el nombre tiene prioridad', () => {
    expect(resolverExtensionArchivo(doc({ nombre: 'Acta.docx', extensionDeclarada: 'pdf' }))).toBe('docx');
  });
  it('extensión declarada explícita si el nombre no la trae', () => {
    expect(resolverExtensionArchivo(doc({ nombre: 'Acta', extensionDeclarada: 'xlsx' }))).toBe('xlsx');
  });
  it('extensión de la URL si no hay declarada', () => {
    expect(resolverExtensionArchivo(doc({ nombre: 'Acta', url: 'https://x.com/carpeta/archivo.png?x=1' }))).toBe('png');
  });
  it('mapa de mimeType si no hay nombre/declarada/url con extensión', () => {
    expect(resolverExtensionArchivo(doc({ nombre: 'Acta', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))).toBe('docx');
  });
  it('sin ninguna pista → cadena vacía, NUNCA adivina .pdf', () => {
    expect(resolverExtensionArchivo(doc({ nombre: 'Acta', mimeType: 'application/x-mi-tipo-raro' }))).toBe('');
  });
  it('reconoce .zip explícitamente (archivo .zip ya existente entre los documentos)', () => {
    expect(resolverExtensionArchivo(doc({ nombre: 'Anexos.zip' }))).toBe('zip');
    expect(resolverExtensionArchivo(doc({ nombre: 'Anexos', mimeType: 'application/zip' }))).toBe('zip');
  });
});

describe('resolverNombreConExtension', () => {
  it('nombre ya con extensión se respeta tal cual', () => {
    expect(resolverNombreConExtension(doc({ nombre: 'Acta.pdf' }))).toBe('Acta.pdf');
  });
  it('nombre sin extensión se le agrega la resuelta', () => {
    expect(resolverNombreConExtension(doc({ nombre: 'Acta', extensionDeclarada: 'pdf' }))).toBe('Acta.pdf');
  });
  it('sin extensión resoluble, el nombre queda sin extensión (nunca inventa una)', () => {
    expect(resolverNombreConExtension(doc({ nombre: 'Acta' }))).toBe('Acta');
  });
});

describe('sanearNombreEntradaZip — seguridad: path traversal, control chars, comillas', () => {
  it('elimina separadores de ruta (previene escribir fuera del directorio del ZIP)', () => {
    expect(sanearNombreEntradaZip('../../etc/passwd')).not.toContain('..');
    expect(sanearNombreEntradaZip('../../etc/passwd')).not.toMatch(/[\\/]/);
    expect(sanearNombreEntradaZip('carpeta\\..\\..\\archivo.pdf')).not.toMatch(/[\\/]/);
  });
  it('elimina comillas y caracteres de control', () => {
    expect(sanearNombreEntradaZip('Acta".pdf')).not.toContain('"');
    expect(sanearNombreEntradaZip('Acta\x00\x1f.pdf')).toBe('Acta.pdf');
  });
  it('preserva espacios, acentos y paréntesis — nombres legibles', () => {
    expect(sanearNombreEntradaZip('Acta valoración (final).pdf')).toBe('Acta valoración (final).pdf');
  });
  it('vacío o solo separadores → "documento"', () => {
    expect(sanearNombreEntradaZip('')).toBe('documento');
    expect(sanearNombreEntradaZip('///')).toBe('documento');
  });
  it('trunca nombres extremadamente largos preservando la extensión', () => {
    const largo = 'a'.repeat(300) + '.pdf';
    const r = sanearNombreEntradaZip(largo);
    expect(r.length).toBeLessThanOrEqual(180);
    expect(r.endsWith('.pdf')).toBe(true);
  });
});

describe('nombreUnicoEnZip — evita colisiones, NUNCA sobrescribe', () => {
  it('primer uso: nombre tal cual', () => {
    const usados = new Set<string>();
    expect(nombreUnicoEnZip('Acta.pdf', usados)).toBe('Acta.pdf');
  });
  it('Acta.pdf + Acta.pdf → Acta.pdf + Acta (2).pdf', () => {
    const usados = new Set<string>();
    expect(nombreUnicoEnZip('Acta.pdf', usados)).toBe('Acta.pdf');
    expect(nombreUnicoEnZip('Acta.pdf', usados)).toBe('Acta (2).pdf');
  });
  it('tres colisiones seguidas → (2), (3), (4)', () => {
    const usados = new Set<string>();
    expect(nombreUnicoEnZip('X.pdf', usados)).toBe('X.pdf');
    expect(nombreUnicoEnZip('X.pdf', usados)).toBe('X (2).pdf');
    expect(nombreUnicoEnZip('X.pdf', usados)).toBe('X (3).pdf');
    expect(nombreUnicoEnZip('X.pdf', usados)).toBe('X (4).pdf');
  });
  it('nombres sin extensión también se deduplican correctamente', () => {
    const usados = new Set<string>();
    expect(nombreUnicoEnZip('Documento', usados)).toBe('Documento');
    expect(nombreUnicoEnZip('Documento', usados)).toBe('Documento (2)');
  });
  it('no colisiona con un candidato "(2)" ya usado por otro documento', () => {
    const usados = new Set<string>(['Acta.pdf', 'Acta (2).pdf']);
    expect(nombreUnicoEnZip('Acta.pdf', usados)).toBe('Acta (3).pdf');
  });
});

describe('resolverEntradaZipParaDocumento — integración extensión+saneo+dedup', () => {
  it('dos documentos "Acta.pdf" reales → Acta.pdf y Acta (2).pdf', () => {
    const usados = new Set<string>();
    const d1 = doc({ nombre: 'Acta.pdf' });
    const d2 = doc({ nombre: 'Acta.pdf' });
    expect(resolverEntradaZipParaDocumento(d1, usados)).toBe('Acta.pdf');
    expect(resolverEntradaZipParaDocumento(d2, usados)).toBe('Acta (2).pdf');
  });
});

describe('nombreArchivoZipProceso — convención del proyecto (mismo saneo que nombreArchivoExportacion)', () => {
  it('formato Documentos_<codigo>_<fecha>.zip', () => {
    const fecha = new Date('2026-08-26T10:00:00Z');
    expect(nombreArchivoZipProceso('SED-LP-2026-0091', 5, fecha)).toBe('Documentos_SED-LP-2026-0091_2026-08-26.zip');
  });
  it('sanea caracteres fuera de [a-zA-Z0-9-_] (barras, espacios) — mismo regex que nombreArchivoExportacion', () => {
    const fecha = new Date('2026-08-26T10:00:00Z');
    expect(nombreArchivoZipProceso('CONTRATACION EMPRESA/DE VIGILANCIA', 5, fecha)).toBe('Documentos_CONTRATACION_EMPRESA_DE_VIGILANCIA_2026-08-26.zip');
  });
  it('codigoProceso ausente/vacío → usa el id de la solicitud como respaldo', () => {
    const fecha = new Date('2026-08-26T10:00:00Z');
    expect(nombreArchivoZipProceso(null, 950, fecha)).toBe('Documentos_950_2026-08-26.zip');
    expect(nombreArchivoZipProceso('', 950, fecha)).toBe('Documentos_950_2026-08-26.zip');
  });
});
