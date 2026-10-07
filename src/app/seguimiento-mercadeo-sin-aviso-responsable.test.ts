/**
 * Ajuste "AVISO 'NO FIGURAS COMO RESPONSABLE' — NO APLICA A MERCADEO EN
 * SEGUIMIENTO" (decisión explícita del usuario) — el mensaje asumía que
 * solo un responsable asignado puede "agregar observaciones ni
 * cerrarla", pero Mercadeo tiene sus PROPIOS permisos independientes de
 * ser responsable (`puedeAgregarSeguimiento`/`puedeCerrarSolicitud`
 * sobre Privados) — queda incorrecto/confuso para ese rol en su propia
 * navegación ("Seguimiento de proceso"). Cambio: se agrega ÚNICAMENTE
 * `!esMercadeo(sesion.rol)` a la condición existente — `puedeGestionarFicha`
 * y todo lo demás quedan exactamente igual para el resto de roles.
 *
 * Mismo patrón de texto fuente que el resto de *-page.test.ts (sin
 * harness de render de componentes en este repo).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, 'page.tsx'), 'utf-8');

function extraerVistFichaAsignacion(): string {
  const inicio = PAGE_TSX.indexOf('function VistFichaAsignacion(');
  const fin = PAGE_TSX.indexOf('function ModuloAsignacionesPorValidar(', inicio);
  if (inicio === -1 || fin === -1) throw new Error('No se encontró VistFichaAsignacion en page.tsx');
  return PAGE_TSX.slice(inicio, fin);
}
const BLOQUE = extraerVistFichaAsignacion();

describe('1) Mercadeo + no responsable + no puedeGestionarFicha → mensaje NO visible', () => {
  it('la condición de render incluye !esMercadeo(sesion.rol)', () => {
    expect(BLOQUE).toContain("cargaResponsablesFicha.tipo!=='loading'&&!puedeGestionarFicha&&asignaciones.length>0&&!esMercadeo(sesion.rol)&&(");
  });
});

describe('2) Comercial/no Mercadeo + no responsable + no puedeGestionarFicha → mensaje sigue visible', () => {
  it('las 3 condiciones ORIGINALES (loading/puedeGestionarFicha/asignaciones.length) se conservan intactas — solo se agregó una cláusula, ninguna se removió', () => {
    const idx = BLOQUE.indexOf('No figuras como responsable activo');
    expect(idx).toBeGreaterThan(-1);
    const antes = BLOQUE.slice(Math.max(0, idx - 900), idx);
    expect(antes).toContain("cargaResponsablesFicha.tipo!=='loading'");
    expect(antes).toContain('!puedeGestionarFicha');
    expect(antes).toContain('asignaciones.length>0');
  });
  it('el texto del mensaje no cambió ni una palabra', () => {
    expect(BLOQUE).toContain('No figuras como responsable activo de esta solicitud — puedes consultarla, pero no agregar observaciones ni cerrarla. Para reasignar o agregar responsables usa el editor de la ficha.');
  });
});

describe('3) Mercadeo mantiene: responsables visibles, estado visible, cierre según permisos actuales — nada más se tocó', () => {
  it('puedeGestionarFicha no fue modificado (misma fórmula de siempre: puedeRevisarProceso/asignacionPropia/admin, OR puedeCerrarSolicitud)', () => {
    expect(BLOQUE).toContain('const puedeGestionarFicha = (permisosBackend?.puedeRevisarProceso');
    expect(BLOQUE).toContain('?? (!!asignacionPropia || esAdministradorProcesosCliente))');
    expect(BLOQUE).toContain('|| (permisosBackend?.puedeCerrarSolicitud ?? false);');
  });
  it('el bloque "Estado de asignación" sigue presente e incondicional a esMercadeo (no se movió detrás de ningún nuevo gate)', () => {
    const idxAviso = BLOQUE.indexOf('No figuras como responsable activo');
    const idxEstado = BLOQUE.indexOf('Estado de asignación', idxAviso);
    expect(idxEstado).toBeGreaterThan(idxAviso);
    const entre = BLOQUE.slice(idxAviso, idxEstado);
    // Entre el aviso y "Estado de asignación" solo debe cerrar el bloque
    // condicional del aviso (`)}`), nunca abrir un nuevo condicional que
    // envuelva también el bloque de estado.
    expect(entre.trim().endsWith(')}') || entre.includes(')}\n')).toBe(true);
  });
  it('no se tocó puedeCerrarSolicitud/puedeAgregarSeguimiento como funciones — siguen siendo las mismas fuentes centrales, sin duplicar', () => {
    expect(PAGE_TSX).not.toMatch(/function puedeCerrarSolicitud\(/); // sigue viviendo en autorizacion-asignacion.ts, no en page.tsx
  });
});
