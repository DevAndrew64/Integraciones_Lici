/**
 * Ajuste "FILTRO DE EMPRESA EN DOTACIÓN/EPP DEBE SER AUTOMÁTICO" —
 * verificación de cableado en page.tsx (texto fuente, mismo patrón que el
 * resto de guardado-modular-*.test.ts).
 *
 * Regla funcional: la empresa de los catálogos de Dotación (masculina/
 * femenina) y EPP NUNCA es seleccionable manualmente — se deriva SIEMPRE
 * de `solicitudProceso.perfil` (el proceso/ficha actualmente abierto),
 * nunca de un valor por defecto, localStorage, el usuario autenticado ni
 * el primer elemento de una lista. Si el proceso no tiene un perfil
 * reconocible, el catálogo se bloquea con un mensaje claro — nunca
 * consulta sin filtro (eso devolvería productos de cualquier empresa).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');

function bloque(inicioMarcador: string, finMarcador: string, desde = 0): string {
  const inicio = PAGE_TSX.indexOf(inicioMarcador, desde);
  if (inicio === -1) throw new Error(`No se encontró el marcador de inicio: ${inicioMarcador}`);
  const fin = PAGE_TSX.indexOf(finMarcador, inicio);
  if (fin === -1) throw new Error(`No se encontró el marcador de fin: ${finMarcador}`);
  return PAGE_TSX.slice(inicio, fin);
}

describe('derivarCodigoEmpresaCatalogoDotEpp — fuente única, pura, sin estado', () => {
  it('deriva aseo/tempo/vigi por coincidencia de texto en el perfil, igual que perfilColor (nunca un mapeo distinto/paralelo)', () => {
    const inicio = PAGE_TSX.indexOf('const derivarCodigoEmpresaCatalogoDotEpp=');
    expect(inicio).toBeGreaterThan(-1);
    const bloqueFn = PAGE_TSX.slice(inicio, inicio + 400);
    expect(bloqueFn).toContain("if(s.includes('aseo'))return'aseo';");
    expect(bloqueFn).toContain("if(s.includes('vigi'))return'vigi';");
    expect(bloqueFn).toContain("if(s.includes('tempo'))return'tempo';");
    expect(bloqueFn).toContain('return null;');
  });

  it('no depende de React (nunca useState/useEffect) — es una función pura de módulo, reutilizable sin closure', () => {
    const inicio = PAGE_TSX.indexOf('const derivarCodigoEmpresaCatalogoDotEpp=');
    const bloqueFn = PAGE_TSX.slice(inicio, inicio + 400);
    expect(bloqueFn).not.toContain('useState');
    expect(bloqueFn).not.toContain('useEffect');
  });
});

describe('empresaCatalogoProceso — única fuente de empresa para Dotación/EPP', () => {
  it('se deriva de solicitudProceso.perfil (el proceso/ficha actual), nunca de un default/localStorage/usuario/primer elemento de lista', () => {
    const inicio = PAGE_TSX.indexOf('const empresaCatalogoProceso=React.useMemo');
    expect(inicio).toBeGreaterThan(-1);
    const b = PAGE_TSX.slice(inicio, inicio + 300);
    expect(b).toContain('derivarCodigoEmpresaCatalogoDotEpp(solicitudProceso?.perfil)');
    expect(b).toContain('[solicitudProceso?.perfil]');
    expect(b).not.toContain('localStorage');
    expect(b).not.toContain('sessionStorage');
  });

  it('selDotEmpresa/selEppEmpresa son constantes derivadas de empresaCatalogoProceso (nunca su propio useState independiente)', () => {
    expect(PAGE_TSX).toContain('const selDotEmpresa:string=empresaCatalogoProceso??\'\';');
    expect(PAGE_TSX).toContain('const selEppEmpresa:string=empresaCatalogoProceso??\'\';');
    expect(PAGE_TSX).not.toContain('useState(EMPRESA_INICIAL_CATALOGO_DOT)');
    expect(PAGE_TSX).not.toContain('useState(EMPRESA_INICIAL_CATALOGO_EPP)');
  });
});

describe('el usuario no puede seleccionar otra empresa — el <select> de Empresa fue retirado en ambos catálogos', () => {
  it('Dotación: no existe ningún <select> ligado a selDotEmpresa; el bloque "Empresa" ahora es un <div> de solo lectura', () => {
    expect(PAGE_TSX).not.toContain('<select value={selDotEmpresa}');
    const inicioLabel = PAGE_TSX.indexOf("fontFamily:F}}>Empresa</div>\n");
    expect(inicioLabel).toBeGreaterThan(-1);
    const bloqueTrasLabel = PAGE_TSX.slice(inicioLabel, inicioLabel + 400);
    expect(bloqueTrasLabel).toContain('title="La empresa se toma automáticamente del proceso actual y no se puede modificar"');
  });

  it('EPP: no existe ningún <select> ligado a selEppEmpresa; el bloque "Empresa" ahora es un <div> de solo lectura', () => {
    expect(PAGE_TSX).not.toContain('<select value={selEppEmpresa}');
    // Ajuste "APLICAR LA MISMA LÓGICA... EN INSUMOS" reutiliza el mismo
    // texto de `title` — el mínimo (Dotación+EPP) es lo que importa aquí,
    // no un conteo exacto acoplado a cuántos catálogos más lo adopten.
    const ocurrencias = (PAGE_TSX.match(/title="La empresa se toma automáticamente del proceso actual y no se puede modificar"/g) ?? []).length;
    expect(ocurrencias).toBeGreaterThanOrEqual(2); // al menos Dotación + EPP
  });

  it('el badge visible de Empresa reutiliza perfilColor (misma etiqueta que el encabezado "Empresa: Aseocolba" del proceso) — nunca un mapeo de etiqueta paralelo', () => {
    const ocurrencias = (PAGE_TSX.match(/\{perfilColor\(solicitudProceso\?\.perfil\|\|''\)\.label\}/g) ?? []).length;
    expect(ocurrencias).toBe(2);
  });
});

describe('todas las consultas envían la empresa del proceso — bloqueo si el proceso no tiene empresa', () => {
  it('consultarCatalogDot bloquea (setSelDotErr, sin fetch) si selDotEmpresa está vacío — nunca consulta sin filtro', () => {
    const b = bloque('const consultarCatalogDot=async(', '\n  };');
    expect(b).toContain("if(!selDotEmpresa){setSelDotErr('Este proceso no tiene una empresa/perfil asociado. No es posible consultar el catálogo de Dotación.');return;}");
    expect(b).toContain('empresa:selDotEmpresa,uen:');
  });

  it('consultarCatalogEpp bloquea (setSelEppErr, sin fetch) si selEppEmpresa está vacío — nunca consulta sin filtro', () => {
    const b = bloque('const consultarCatalogEpp=async(', '\n  };');
    expect(b).toContain("if(!selEppEmpresa){setSelEppErr('Este proceso no tiene una empresa/perfil asociado. No es posible consultar el catálogo de EPP.');return;}");
    expect(b).toContain('empresa:selEppEmpresa,uen:');
  });

  it('duplicarDotacionAMujer (duplicar a femenina) y traerProductosPorGrupoDot (búsqueda por código de grupo) bloquean igual si no hay empresa', () => {
    const bDup = bloque('const duplicarDotacionAMujer=async(', '\n  };');
    expect(bDup).toContain("if(!selDotEmpresa){alert('Este proceso no tiene una empresa/perfil asociado. No es posible consultar el catálogo de Dotación.');return;}");
    const bGrupo = bloque('const traerProductosPorGrupoDot=async(', '\n  };');
    expect(bGrupo).toContain("if(!selDotEmpresa){alert('Este proceso no tiene una empresa/perfil asociado. No es posible consultar el catálogo de Dotación.');return;}");
  });

  it('el filtrosOverride de consultarCatalogDot/Epp ya NO acepta empresa como propiedad (tipo sin `empresa?`) — nadie externo puede fijarla', () => {
    const firmaDot = PAGE_TSX.slice(PAGE_TSX.indexOf('const consultarCatalogDot=async('), PAGE_TSX.indexOf('=>{', PAGE_TSX.indexOf('const consultarCatalogDot=async(')));
    expect(firmaDot).not.toContain('empresa?:string');
    const firmaEpp = PAGE_TSX.slice(PAGE_TSX.indexOf('const consultarCatalogEpp=async('), PAGE_TSX.indexOf('=>{', PAGE_TSX.indexOf('const consultarCatalogEpp=async(')));
    expect(firmaEpp).not.toContain('empresa?:string');
  });
});

describe('manejo de procesos sin empresa/perfil asociado — bloquea la selección, nunca consulta sin filtro', () => {
  it('Dotación: si empresaCatalogoProceso es null, el modal muestra un mensaje claro y NUNCA renderiza filtros/tabla', () => {
    const inicioModal = PAGE_TSX.indexOf('{showSelDot&&(()=>{');
    const bloqueModal = PAGE_TSX.slice(inicioModal, inicioModal + 3500);
    expect(bloqueModal).toContain('if(!empresaCatalogoProceso){');
    expect(bloqueModal).toContain('Este proceso no tiene una empresa/perfil asociado. No es posible consultar el catálogo de Dotación sin una empresa definida.');
  });

  it('EPP: si empresaCatalogoProceso es null, el modal muestra un mensaje claro y NUNCA renderiza filtros/tabla', () => {
    const inicioModal = PAGE_TSX.indexOf('{showSelEpp&&(()=>{');
    const bloqueModal = PAGE_TSX.slice(inicioModal, inicioModal + 3500);
    expect(bloqueModal).toContain('if(!empresaCatalogoProceso){');
    expect(bloqueModal).toContain('Este proceso no tiene una empresa/perfil asociado. No es posible consultar el catálogo de EPP sin una empresa definida.');
  });
});

describe('backend — /api/dotacion-ext y /api/epp-ext exigen empresa (no es solo un filtro visual)', () => {
  it('dotacion-ext: valida empresa contra una lista blanca (aseo/tempo/vigi) y responde 400 si falta o es inválida', () => {
    const src = readFileSync(join(__dirname, '../../app/api/dotacion-ext/route.ts'), 'utf-8');
    expect(src).toContain("const EMPRESAS_VALIDAS = ['aseo', 'tempo', 'vigi']");
    expect(src).toContain('status: 400');
    expect(src).not.toContain("empresa ? [empresa] : ['aseo', 'tempo', 'vigi']");
  });

  it('epp-ext: mismo endurecimiento — lista blanca y 400 si falta o es inválida', () => {
    const src = readFileSync(join(__dirname, '../../app/api/epp-ext/route.ts'), 'utf-8');
    expect(src).toContain("const EMPRESAS_VALIDAS = ['aseo', 'tempo', 'vigi']");
    expect(src).toContain('status: 400');
    expect(src).not.toContain("empresa ? [empresa] : ['aseo', 'tempo', 'vigi']");
  });
});
