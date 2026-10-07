/**
 * Ajuste "ACA HACER LO MISMO QUE SE HIZO ANTERIORMENTE" — verificación de
 * cableado en page.tsx (texto fuente, mismo patrón que
 * `guardado-modular-empresa-automatica-dotacion-epp.test.ts`/
 * `-insumos.test.ts`).
 *
 * Regla funcional: la EMPRESA de Impuestos (matriz ICA) NUNCA es
 * seleccionable/editable manualmente — se deriva SIEMPRE de la empresa
 * real del proceso (`solicitudProceso.perfil`, mismo campo que produce el
 * badge de la cabecera), reutilizando el MISMO criterio de coincidencia
 * de texto que `perfilColor`/`derivarCodigoEmpresaCatalogoDotEpp` — nunca
 * un mapeo paralelo. Ajuste "ACA NO ES DE SELECCION" (feedback en vivo) —
 * el <select> se retiró por completo, igual que en Dotación/EPP/Insumos;
 * MUNICIPIO sigue siendo el único campo que el usuario elige a mano en
 * este módulo.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');

describe('derivarEmpresaIcaDeProceso — mismo criterio de texto que perfilColor/derivarCodigoEmpresaCatalogoDotEpp, nunca un mapeo paralelo', () => {
  it('reconoce aseo/vigi/tempo/trans y devuelve directamente el enum EmpresaIca en mayúsculas', () => {
    const inicio = PAGE_TSX.indexOf('const derivarEmpresaIcaDeProceso=');
    expect(inicio).toBeGreaterThan(-1);
    const b = PAGE_TSX.slice(inicio, inicio + 400);
    expect(b).toContain("if(s.includes('aseo'))return'ASEOCOLBA';");
    expect(b).toContain("if(s.includes('vigi'))return'VIGICOLBA';");
    expect(b).toContain("if(s.includes('tempo'))return'TEMPOCOLBA';");
    expect(b).toContain("if(s.includes('trans'))return'TRANSCOLBA';");
    expect(b).toContain("return'';");
  });
});

describe('empresaIcaProceso / autocompletado de icaEmpresa — nunca sobrescribe un valor ya guardado ni una selección manual posterior', () => {
  it('empresaIcaProceso se deriva de solicitudProceso.perfil, misma fuente única que empresaCatalogoProceso', () => {
    const inicio = PAGE_TSX.indexOf('const empresaIcaProceso=React.useMemo<EmpresaIca|\'\'>(');
    expect(inicio).toBeGreaterThan(-1);
    const b = PAGE_TSX.slice(inicio, inicio + 200);
    expect(b).toContain('derivarEmpresaIcaDeProceso(solicitudProceso?.perfil)');
    expect(b).toContain('[solicitudProceso?.perfil]');
  });

  it('un useEffect fija icaEmpresa desde empresaIcaProceso SOLO mientras icaEmpresa sigue vacío (\'\') — nunca reemplaza un valor ya presente', () => {
    const inicio = PAGE_TSX.indexOf('const empresaIcaProceso=React.useMemo<EmpresaIca|\'\'>(');
    const b = PAGE_TSX.slice(inicio, inicio + 700);
    expect(b).toContain('React.useEffect(()=>{');
    expect(b).toContain('if(!icaEmpresa&&empresaIcaProceso)setIcaEmpresa(empresaIcaProceso);');
    expect(b).toContain('},[icaEmpresa,empresaIcaProceso]);');
  });

  it('la carga de datos guardados sigue teniendo prioridad — su propio "if(...)setIcaEmpresa(...)" existe intacto y no depende del default automático', () => {
    expect(PAGE_TSX).toContain('if(datosAdminV2?.impuestosConfig?.icaEmpresa)setIcaEmpresa(datosAdminV2.impuestosConfig.icaEmpresa);');
  });
});

describe('Ajuste "ACA NO ES DE SELECCION" — el <select> de Empresa se retiró; ahora es un <div> de solo lectura, igual que Dotación/EPP/Insumos', () => {
  it('no existe ningún <select> ligado a icaEmpresaBorrador', () => {
    expect(PAGE_TSX).not.toContain('<select value={icaEmpresaBorrador}');
  });

  it('el bloque "EMPRESA" del modal es un <div> de solo lectura que muestra icaEmpresaBorrador, con el mismo tooltip explicativo que Insumos', () => {
    const inicio = PAGE_TSX.indexOf('<div style={{fontSize:11,fontWeight:700,color:\'#475569\'}}>EMPRESA</div>');
    expect(inicio).toBeGreaterThan(-1);
    const b = PAGE_TSX.slice(inicio, inicio + 500);
    expect(b).toContain('title="La empresa se toma automáticamente del proceso actual y no se puede modificar"');
    expect(b).toContain('{icaEmpresaBorrador||\'—\'}');
  });
});
