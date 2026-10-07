/**
 * Ajuste "CORREGIR MODAL REGISTRAR DOTACIÓN Y EPP — CONTENIDO CORTADO +
 * PROGRAMACIÓN POR HORAS". Dos defectos independientes, verificados por
 * texto fuente (mismo patrón que el resto de guardado-modular-*.test.ts —
 * no hay jsdom/RTL en este proyecto para medir scroll real).
 *
 * Causa exacta del recorte (defecto 1): el body del modal (`overflowY:
 * 'auto', flex:1`) no tenía `minHeight:0` — regla del propio flexbox: un
 * hijo flex con overflow nunca se encoge por debajo de la altura de su
 * contenido sin `min-height:0`, así que el contenido crecía más allá de
 * `maxHeight:88vh` del modal y el `overflow:hidden` del contenedor exterior
 * lo recortaba en vez de dejarlo desplazable. El footer nunca fue position
 * fixed/absolute (ya era un hijo flex normal con flexShrink:0) — no era la
 * causa del recorte, pero sí quedaba visualmente "encima" del contenido
 * cortado por el mismo motivo.
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

describe('ModalDotacionEpp — layout vertical real (header / body con scroll / footer)', () => {
  const bModal = () => bloque('function ModalDotacionEpp()', '\n  function Sec(');

  it('1/2/4) el body tiene minHeight:0 — condición de flexbox para que el scroll viva ahí y no se recorte el contenido', () => {
    const b = bModal();
    expect(b).toContain("overflowY:'auto' as const,overflowX:'hidden' as const,flex:'1 1 auto',minHeight:0");
  });

  it('el contenedor exterior es flex-column con overflow:hidden — header y footer flexShrink:0', () => {
    const b = bModal();
    expect(b).toContain("display:'flex',flexDirection:'column' as const,boxShadow:'0 12px 40px rgba(15,23,42,.22)',overflow:'hidden' as const");
    // header
    expect(b).toMatch(/borderBottom:'1px solid #e2e8f0',display:'flex',justifyContent:'space-between',alignItems:'center',background:'white',flexShrink:0/);
    // footer
    expect(b).toMatch(/borderTop:'1px solid #e2e8f0',display:'flex',justifyContent:'flex-end',gap:10,background:'white',flexShrink:0/);
  });

  it('3) el footer NUNCA es position fixed/absolute (evita superponerse al contenido)', () => {
    const inicioModal = PAGE_TSX.indexOf('function ModalDotacionEpp()');
    const bFooter = bloque("padding:'14px 24px',borderTop:'1px solid #e2e8f0'", '\n            </div>\n          </div>\n        </div>\n      </div>\n    );\n  }', inicioModal);
    expect(bFooter).not.toContain("position:'fixed'");
    expect(bFooter).not.toContain("position:'absolute'");
  });

  it('el body agrega padding inferior adicional para que la última tarjeta se vea completa con el footer visible', () => {
    const b = bModal();
    expect(b).toContain("padding:'20px 24px 28px'");
  });

  it('el scroll principal pertenece al body (único overflowY:auto entre header y footer, sin scrolls anidados adicionales para la lista de cargos)', () => {
    const bBody = bloque("padding:'20px 24px 28px'", ':lineasManoObraDisponiblesOrdenadas).map((linea,i)=>tarjetaCargo(linea,i))');
    const ocurrenciasOverflow = (bBody.match(/overflowY:'auto'/g) ?? []).length;
    expect(ocurrenciasOverflow).toBe(1);
  });
});

describe('ModalDotacionEpp — corrección de seguimiento: la tarjeta EXPANDIDA (sección EPP) se recortaba en viewports bajos', () => {
  // Reproducido con Playwright contra un HTML estático que replica la
  // estructura exacta de este modal: con viewport de 500px de alto, sin
  // `flexShrink:0` en la tarjeta, el flex-shrink:1 por defecto encogía la
  // tarjeta 1 (ASEADOR, expandida) para caber en el espacio visible del
  // primer pintado — y como la tarjeta tiene `overflow:hidden` (solo para
  // redondear esquinas), ese exceso se recortaba en silencio (la sección
  // EPP y su botón desaparecían) en vez de que el BODY se desbordara y
  // mostrara su propio scroll. `minHeight:0` en el body (defecto anterior)
  // no bastaba por sí solo si las tarjetas individuales podían encogerse.
  it('cada tarjeta de cargo (tarjetaCargo) tiene flexShrink:0 — nunca se encoge, el body es quien se desborda y scrollea', () => {
    const b = bloque('const tarjetaCargo=', '\n    return(\n      <div style={{position:\'fixed\'');
    expect(b).toContain("borderRadius:8,border:'1px solid #e2e8f0',overflow:'hidden' as const,background:'white',flexShrink:0");
  });
});

describe('Corrección "PROGRAMACIÓN POR HORAS" — el resumen del cargo sigue usando el helper único (sin lógica ad-hoc en el JSX)', () => {
  it('tarjetaCargo delega en formatearResumenSujetoDotEpp (que ya reconoce TOTAL_SEMANAL) — no hay condicional de "por horas" duplicada en page.tsx', () => {
    const b = bloque('const tarjetaCargo=', '\n    return(\n      <div style={{position:\'fixed\'');
    expect(b).toContain('formatearResumenSujetoDotEpp(linea.cantidadTrabajadores,distribuciones)');
    expect(b).not.toContain('tipoCapturaHorario');
  });
});
