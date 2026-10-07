/**
 * Ajuste "QUE SE ENTIENDA BIEN LO QUE SE DIGITA" — los campos Cantidad/
 * Frecuencia de cada producto (filaSoloLectura) eran demasiado angostos
 * (width:38/42 con padding 8px lateral de `cInp`, boxSizing:border-box):
 * un valor de 4 dígitos como "1000" no cabía y se veía cortado/solapado.
 *
 * Ajuste posterior "AHORA TAMBIÉN EN DOTACIÓN, EPP" — la fila dejó de
 * vivir dentro de un <table> (no envolvía bien la descripción larga ni
 * evitaba el scroll horizontal): ahora es una fila flex con columnas de
 * ancho fijo en px (suficientes para 4 dígitos), nunca el `width:'100%'`
 * de la tabla anterior.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');

describe('filaSoloLectura — inputs de Cantidad/Frecuencia con ancho suficiente', () => {
  it('Cantidad ya no usa el ancho angosto original (38px) — ahora usa un ancho fijo suficiente (40px) en la fila flex', () => {
    // El estilo termina ahora con `...(cantBloqueada?estiloBloqueadoApi:{})` (ajuste
    // "CANTIDAD Y FRECUENCIA DE EPP DESDE LA API"); el ancho/relleno no cambia.
    expect(PAGE_TSX).toContain("<input style={{...cInp,width:40,flexShrink:0,fontSize:10,boxSizing:'border-box' as const,padding:'5px 2px',textAlign:'center' as const,...(cantBloqueada?estiloBloqueadoApi:{})}} type=\"number\" min=\"0\" value={r.cant||''}");
    expect(PAGE_TSX).not.toContain("style={{...cInp,fontSize:10.5,width:38,textAlign:'center' as const}} type=\"number\" min=\"0\" value={r.cant||''}");
  });

  it('Frecuencia ya no usa el ancho angosto original (42px) — ahora usa un ancho fijo suficiente en la fila flex', () => {
    expect(PAGE_TSX).toContain("<input style={{...cInp,width:44,flexShrink:0,fontSize:10,boxSizing:'border-box' as const,padding:'5px 2px',textAlign:'center' as const,...(frecBloqueada?estiloBloqueadoApi:{})}} type=\"number\" min=\"1\" max=\"52\" value={r.frec||''}");
    expect(PAGE_TSX).not.toContain("style={{...cInp,fontSize:10.5,width:42,textAlign:'center' as const}} type=\"number\" min=\"1\" max=\"52\" value={r.frec||''}");
  });
});
