/**
 * Ajuste "APLICAR LA MISMA LÓGICA DE EMPRESA/PERFIL EN INSUMOS" —
 * verificación de cableado en page.tsx (texto fuente, mismo patrón que
 * `guardado-modular-empresa-automatica-dotacion-epp.test.ts`).
 *
 * Regla funcional: la empresa del catálogo de Insumos NUNCA es
 * seleccionable/editable manualmente — se deriva de la MISMA fuente única
 * que Dotación/EPP (`empresaCatalogoProceso`, derivada de
 * `solicitudProceso.perfil`), reutilizando exactamente
 * `derivarCodigoEmpresaCatalogoDotEpp` — nunca un mapeo paralelo. La única
 * diferencia con Dotación/EPP es la ETIQUETA visible: Insumos muestra el
 * nombre oficial completo en mayúsculas (ASEOCOLBA/TEMPOCOLBA/VIGICOLBA),
 * mientras el código corto que viaja a la API (aseo/tempo/vigi) nunca
 * cambia. Además, UEN pasa de <input> de texto libre a <select>
 * BAQ/BOG/MIN, igual que Dotación/EPP.
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

describe('ETIQUETA_EMPRESA_CATALOGO_INS — mapeo de nombre oficial completo, reutiliza el código corto ya existente', () => {
  it('mapea los 3 códigos cortos (aseo/tempo/vigi) al nombre oficial completo en mayúsculas', () => {
    const inicio = PAGE_TSX.indexOf('const ETIQUETA_EMPRESA_CATALOGO_INS:Record<CodigoEmpresaCatalogoDotEpp,string>=');
    expect(inicio).toBeGreaterThan(-1);
    const b = PAGE_TSX.slice(inicio, inicio + 200);
    expect(b).toContain("aseo:'ASEOCOLBA'");
    expect(b).toContain("tempo:'TEMPOCOLBA'");
    expect(b).toContain("vigi:'VIGICOLBA'");
  });

  it('usa el mismo tipo CodigoEmpresaCatalogoDotEpp que Dotación/EPP — nunca un tipo/mapeo de código paralelo', () => {
    const inicio = PAGE_TSX.indexOf('const ETIQUETA_EMPRESA_CATALOGO_INS:Record<');
    expect(inicio).toBeGreaterThan(-1);
    const b = PAGE_TSX.slice(inicio, inicio + 80);
    expect(b).toContain('Record<CodigoEmpresaCatalogoDotEpp,string>');
  });
});

describe('selInsEmpresa — misma fuente única que Dotación/EPP (empresaCatalogoProceso), nunca su propio useState', () => {
  it('selInsEmpresa es una constante derivada de empresaCatalogoProceso, nunca un useState/EMPRESA_INICIAL_CATALOGO_INS independiente', () => {
    expect(PAGE_TSX).toContain("const selInsEmpresa:string=empresaCatalogoProceso??'';");
    expect(PAGE_TSX).not.toContain('EMPRESA_INICIAL_CATALOGO_INS');
    expect(PAGE_TSX).not.toContain('setSelInsEmpresa');
  });
});

describe('el usuario no puede editar la Empresa de Insumos — el <input> fue retirado', () => {
  it('no existe ningún <input> ligado a selInsEmpresa; el bloque "Empresa" ahora es un <div> de solo lectura con el nombre oficial completo', () => {
    expect(PAGE_TSX).not.toContain('<input value={selInsEmpresa}');
    const inicio = PAGE_TSX.indexOf('ETIQUETA_EMPRESA_CATALOGO_INS[empresaCatalogoProceso]');
    expect(inicio).toBeGreaterThan(-1);
  });

  it('el badge visible reutiliza ETIQUETA_EMPRESA_CATALOGO_INS indexado por empresaCatalogoProceso — nunca un valor hardcodeado ni el perfil crudo', () => {
    const inicioModal = PAGE_TSX.indexOf('{showSelIns&&(()=>{');
    const b = PAGE_TSX.slice(inicioModal, inicioModal + 5000);
    expect(b).toContain('{ETIQUETA_EMPRESA_CATALOGO_INS[empresaCatalogoProceso]}');
    expect(b).toContain('title="La empresa se toma automáticamente del proceso actual y no se puede modificar"');
  });
});

describe('UEN de Insumos ahora es un <select> BAQ/BOG/MIN — nunca un <input> de texto libre digitado a mano', () => {
  it('no existe ningún <input> ligado a selInsUen; en su lugar hay un <select> con las 3 opciones', () => {
    expect(PAGE_TSX).not.toContain('<input value={selInsUen}');
    // Ajuste "QUE LEA LA UEN EN EL FILTRO DE INSUMOS" agregó comentarios
    // explicativos antes del <select> de UEN dentro de este mismo modal,
    // desplazando su posición — se amplía la ventana de caracteres para
    // seguir alcanzándolo (mismo <select>, sin cambios de contrato).
    const inicioModal = PAGE_TSX.indexOf('{showSelIns&&(()=>{');
    const b = PAGE_TSX.slice(inicioModal, inicioModal + 9000);
    expect(b).toContain("<select value={selInsUen} onChange={e=>{const v=e.target.value;setSelInsUen(v);consultarCatalogIns(1,{uen:v});}}");
    expect(b).toContain('<option value="BAQ">BAQ</option>');
    expect(b).toContain('<option value="BOG">BOG</option>');
    expect(b).toContain('<option value="MIN">MIN</option>');
  });
});

describe('todas las consultas de Insumos envían la empresa del proceso — bloqueo si el proceso no tiene empresa', () => {
  it('consultarCatalogIns bloquea (setSelInsErr, sin fetch) si selInsEmpresa está vacío — nunca consulta sin filtro', () => {
    const b = bloque('const consultarCatalogIns=async(', '\n  };');
    expect(b).toContain("if(!selInsEmpresa){setSelInsErr('Este proceso no tiene una empresa/perfil asociado. No es posible consultar el catálogo de Insumos.');return;}");
    expect(b).toContain('empresa:selInsEmpresa,');
  });

  it('traerProductosPorGrupoIns (búsqueda por código de grupo/insumo puntual) bloquea igual si no hay empresa', () => {
    const b = bloque('const traerProductosPorGrupoIns=async(', '\n  };');
    expect(b).toContain("if(!selInsEmpresa){alert('Este proceso no tiene una empresa/perfil asociado. No es posible consultar el catálogo de Insumos.');return;}");
  });

  it('el filtrosOverride de consultarCatalogIns ya NO acepta empresa como propiedad — nadie externo puede fijarla', () => {
    const firma = PAGE_TSX.slice(PAGE_TSX.indexOf('const consultarCatalogIns=async('), PAGE_TSX.indexOf('=>{', PAGE_TSX.indexOf('const consultarCatalogIns=async(')));
    expect(firma).not.toContain('empresa?:string');
  });

  it('"Limpiar filtros" de Insumos nunca toca la empresa — no aparece en filtrosLimpios ni en el cuerpo enviado', () => {
    const b = bloque('const limpiarFiltrosCatalogoIns=async()=>{', '\n  };');
    expect(b).not.toContain('empresa');
  });
});

describe('manejo de procesos sin empresa/perfil asociado en Insumos — bloquea la selección, nunca consulta sin filtro', () => {
  it('si empresaCatalogoProceso es null, el modal muestra un mensaje claro y NUNCA renderiza filtros/tabla', () => {
    const inicioModal = PAGE_TSX.indexOf('{showSelIns&&(()=>{');
    const bloqueModal = PAGE_TSX.slice(inicioModal, inicioModal + 1200);
    expect(bloqueModal).toContain('if(!empresaCatalogoProceso){');
    expect(bloqueModal).toContain('Este proceso no tiene una empresa/perfil asociado. No es posible consultar el catálogo de Insumos sin una empresa definida.');
  });
});

describe('backend — /api/insumos-ext exige empresa (no es solo un filtro visual)', () => {
  it('valida empresa contra una lista blanca (aseo/tempo/vigi) y responde 400 si falta o es inválida', () => {
    const src = readFileSync(join(__dirname, '../../app/api/insumos-ext/route.ts'), 'utf-8');
    expect(src).toContain("const EMPRESAS_VALIDAS = ['aseo', 'tempo', 'vigi']");
    expect(src).toContain('status: 400');
    expect(src).not.toContain("empresa ? [empresa] : ['aseo', 'tempo', 'vigi']");
  });
});
