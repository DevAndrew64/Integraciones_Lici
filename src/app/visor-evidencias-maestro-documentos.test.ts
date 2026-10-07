/**
 * Ajuste "PREVIEW DE EVIDENCIAS — MISMO PATRÓN QUE MAESTRO DE DOCUMENTOS" —
 * el botón del ojo en "Evidencia de elaboración" ya no expande el
 * archivo inline dentro de la ficha: abre `VisorArchivoModal`, el mismo
 * componente que ahora también usa `ModuloMaestroDocumentos` (extraído de
 * su "MODAL VER PDF" existente, sin reescribir su comportamiento — mismo
 * `pdfUrl`/`cerrar`). Mismo patrón de texto fuente que el resto de
 * *-page.test.ts (sin harness de render de componentes en este repo).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, 'page.tsx'), 'utf-8');

describe('VisorArchivoModal — componente compartido (1, 3, 4, 6)', () => {
  it('existe un único componente VisorArchivoModal, con soporte PDF, imagen y fallback de otros formatos', () => {
    expect(PAGE_TSX).toContain('function VisorArchivoModal({titulo,tipo,src,onClose}');
    expect(PAGE_TSX).toContain("const esPdf=tipo==='application/pdf';");
    expect(PAGE_TSX).toContain("esImagen=!!tipo&&tipo.startsWith('image/');");
    expect(PAGE_TSX).toContain('Vista previa no disponible.');
  });

  it('conserva el patrón visual del modal ya existente en Maestro de documentos (overlay, tamaño, encabezado, botón cerrar)', () => {
    expect(PAGE_TSX).toContain("width:'min(900px,96vw)',height:'90vh'");
    expect(PAGE_TSX).toContain("background:'rgba(15,23,42,.6)',zIndex:1100");
  });

  it('cierra con el botón X (onClick={onClose})', () => {
    expect(PAGE_TSX).toContain('<button onClick={onClose} style={{width:28,height:28');
  });

  it('imagen usa object-fit: contain — nunca se deforma', () => {
    expect(PAGE_TSX).toContain("objectFit:'contain' as const,borderRadius:6}}/>");
  });
});

describe('Maestro de documentos reutiliza VisorArchivoModal — sin duplicar el visor (comportamiento sin cambios)', () => {
  it('el modal "ver-pdf" de ModuloMaestroDocumentos ahora renderiza VisorArchivoModal con el mismo pdfUrl/cerrar de siempre', () => {
    expect(PAGE_TSX).toContain('<VisorArchivoModal titulo="Visualizar documento" tipo="application/pdf" src={pdfUrl} onClose={cerrar}/>');
  });

  it('ya no existe una segunda copia del JSX del modal PDF dentro de Maestro de documentos', () => {
    // El antiguo bloque embebido (overlay+iframe con title="Documento PDF")
    // se eliminó — solo debe quedar UNA referencia a ese título, dentro de
    // VisorArchivoModal (usa `title={titulo}`, nunca el string literal viejo).
    expect(PAGE_TSX).not.toContain('title="Documento PDF"');
  });
});

describe('Evidencia de elaboración — botón ojo abre el modal compartido, nunca preview inline (1, 2)', () => {
  it('el botón "Ver" ahora solo abre (setViendoEvidencia(i)), nunca hace toggle inline', () => {
    expect(PAGE_TSX).toContain("<button title=\"Ver\" onClick={() => setViendoEvidencia(i)}");
    expect(PAGE_TSX).not.toContain('onClick={() => setViendoEvidencia(viendoEvidencia === i ? null : i)}');
  });

  it('ya no existe el bloque de preview EXPANDIDO INLINE (borderTop dentro del map de evidencias)', () => {
    expect(PAGE_TSX).not.toContain("{viendoEvidencia === i && (() => {");
  });

  it('el modal de evidencia se renderiza UNA sola vez (fuera del .map de filas), usando VisorArchivoModal', () => {
    expect(PAGE_TSX).toContain('{viendoEvidencia !== null && evidencias[viendoEvidencia] && (');
    expect(PAGE_TSX).toContain('titulo={evidencias[viendoEvidencia].nombre}');
    expect(PAGE_TSX).toContain('tipo={evidencias[viendoEvidencia].tipo}');
    expect(PAGE_TSX).toContain('src={`data:${evidencias[viendoEvidencia].tipo};base64,${evidencias[viendoEvidencia].base64}`}');
  });
});

describe('Descargar sigue funcionando sin cambios (5)', () => {
  it('el botón Descargar conserva su lógica original (atob + Blob + <a download>)', () => {
    expect(PAGE_TSX).toContain('const bytes = atob(ev.base64); const arr = new Uint8Array(bytes.length);');
    expect(PAGE_TSX).toContain("a.href = URL.createObjectURL(blob); a.download = ev.nombre; a.click();");
  });
});

describe('Abrir el visor NO habilita edición — permisos sin cambios (7, 8)', () => {
  it('el botón Ver no depende de puedeActuar/permiteCargarEvidencias — accesible para cualquier lector', () => {
    // Verifica que entre el <button title="Ver" y su onClick no aparece
    // ninguna condición de permiso — solo el estado local viendoEvidencia.
    const idx = PAGE_TSX.indexOf('<button title="Ver" onClick={() => setViendoEvidencia(i)}');
    expect(idx).toBeGreaterThan(-1);
    const fragmento = PAGE_TSX.slice(idx, idx + 200);
    expect(fragmento).not.toContain('puedeActuar');
    expect(fragmento).not.toContain('permiteCargarEvidencias');
  });

  it('subir/eliminar evidencia siguen exigiendo puedeActuar + permiteCargarEvidencias (sin ampliar escritura por este ajuste)', () => {
    const ocurrencias = PAGE_TSX.split('puedeActuar && permiteCargarEvidencias(estadoRevision)').length - 1;
    expect(ocurrencias).toBeGreaterThanOrEqual(2);
  });

  it('VisorArchivoModal no incluye ningún control de edición (nunca inputs de archivo, nunca botón eliminar dentro del propio componente)', () => {
    const inicio = PAGE_TSX.indexOf('function VisorArchivoModal(');
    const fin = PAGE_TSX.indexOf('\nfunction GestionAsignacionInline(');
    expect(inicio).toBeGreaterThan(-1);
    expect(fin).toBeGreaterThan(inicio);
    const cuerpo = PAGE_TSX.slice(inicio, fin);
    expect(cuerpo).not.toContain('type="file"');
    expect(cuerpo).not.toContain('title="Eliminar"');
  });
});
