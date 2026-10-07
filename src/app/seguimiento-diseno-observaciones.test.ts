/**
 * Ajuste "SEGUIMIENTO — DISEÑO IGUAL A OBSERVACIONES DEL PROCESO" —
 * "Observaciones de seguimiento" reutiliza el patrón visual real del
 * bloque "Observaciones registradas" (borde, padding, tipografía,
 * jerarquía, posición de fecha, "Por:", botones Editar/Eliminar, hover,
 * espaciado) — nunca un diseño de tarjeta nuevo. Deliberadamente NO
 * reutiliza Aceptada/No aceptada ni tipoCausa (Seguimiento es una
 * bitácora distinta). Mismo patrón de texto fuente que el resto de
 * *-page.test.ts (sin harness de render de componentes en este repo).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, 'page.tsx'), 'utf-8');

/** Extrae el cuerpo del panel "Observaciones de seguimiento" completo
 * (desde su comentario hasta el cierre del IIFE que lo renderiza) contando
 * llaves balanceadas desde el primer `{` de `const puedeGestionarSeguimientoUI`. */
function extraerPanelSeguimiento(): string {
  const marcador = 'const puedeGestionarSeguimientoUI = isAdmin(sesion.rol)';
  const inicio = PAGE_TSX.indexOf(marcador);
  if (inicio === -1) throw new Error(`No se encontró "${marcador}" en page.tsx`);
  // El panel termina en el cierre del componente IIFE — usamos el
  // siguiente marcador conocido (inicio del panel "Rechazado") como límite.
  const fin = PAGE_TSX.indexOf('Panel — Rechazado — Ajuste "OTRA CAUSA', inicio);
  if (fin === -1) throw new Error('No se encontró el final del panel de seguimiento');
  return PAGE_TSX.slice(inicio, fin);
}

const PANEL = extraerPanelSeguimiento();

describe('Encabezado (1)', () => {
  it('título "Observaciones de seguimiento" y contador "Observaciones registradas · N"', () => {
    expect(PAGE_TSX).toContain("Observaciones de seguimiento</div>");
    expect(PANEL).toContain('Observaciones registradas · {listaOrdenada.length}');
  });
});

describe('Reutilización literal del patrón visual de "Observaciones registradas" (10)', () => {
  it('caja gris exterior: mismo background/border/borderRadius/padding que el bloque de Observaciones del proceso', () => {
    // Mismos valores exactos que ya usa el bloque "Observaciones registradas"
    // (obsAcumuladas, más arriba en page.tsx) — no una paleta nueva.
    expect(PANEL).toContain("background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px'");
  });
  it('encabezado del contador: mismo estilo (10px, bold, #1e5799, uppercase, letterSpacing)', () => {
    expect(PANEL).toContain("fontSize: 10, fontWeight: 700, color: '#1e5799', fontFamily: F, marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: '0.07em'");
  });
  it('tarjeta individual blanca: mismo borde/radio/padding/separación que cada observación', () => {
    expect(PANEL).toContain("background: 'white', borderRadius: 7, border: '1px solid #e2e8f0', padding: '10px 12px', marginBottom: i < listaOrdenada.length - 1 ? 8 : 0");
  });
  it('botón Editar: mismo estilo y hover que el módulo Observaciones (border-color/color a #1e5799 en hover)', () => {
    expect(PANEL).toContain("height: 24, padding: '0 8px', borderRadius: 5, border: '1px solid #e2e8f0', background: 'white', fontSize: 10, fontWeight: 600, color: '#64748b', fontFamily: F, cursor: 'pointer'");
    expect(PANEL).toContain("(e.currentTarget as HTMLButtonElement).style.borderColor = '#1e5799'; (e.currentTarget as HTMLButtonElement).style.color = '#1e5799';");
  });
  it('botón Eliminar: mismo estilo y hover (fondo #fef2f2) que el módulo Observaciones', () => {
    expect(PANEL).toContain("height: 24, padding: '0 8px', borderRadius: 5, border: '1px solid #fecaca', background: 'white', fontSize: 10, fontWeight: 600, color: '#dc2626', fontFamily: F, cursor: 'pointer'");
    expect(PANEL).toContain("(e.currentTarget as HTMLButtonElement).style.background = '#fef2f2';");
  });
  it('modal de confirmación de eliminar: mismo overlay/tamaño/icono/textos que confirmarEliminarObs', () => {
    expect(PANEL).toContain("position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.48)', zIndex: 1300");
    expect(PANEL).toContain("width: 'min(400px,94vw)'");
    expect(PANEL).toContain('¿Eliminar observación?');
    expect(PANEL).toContain('Esta acción no se puede deshacer. La observación quedará eliminada del proceso.');
  });
  it('NO reutiliza Aceptada/No aceptada ni tipoCausa — bitácora distinta', () => {
    expect(PANEL).not.toContain('Aceptada');
    expect(PANEL).not.toContain('No aceptada');
    expect(PANEL).not.toContain('tipoCausa');
  });
});

describe('Cada registro — estructura y contenido (2, 3, 5, 6)', () => {
  it('cada anotación en un bloque de tarjeta separado (map sobre listaOrdenada)', () => {
    expect(PANEL).toContain('{listaOrdenada.map((a, i) => {');
  });
  it('etiqueta "Observación {numero}" — numeración estable (3)', () => {
    expect(PANEL).toContain("Observación {safeString(a.numero) || '—'}");
  });
  it('fecha a la derecha del encabezado de la tarjeta (5)', () => {
    expect(PANEL).toContain('{safeString(a.creadoEn).slice(0, 16)}');
  });
  it('"Por: usuario" visible en el footer (6)', () => {
    expect(PANEL).toContain("Por: {safeString(a.creadoPor)}");
  });
});

describe('Orden — más reciente arriba (4)', () => {
  it('ordena por numero descendente (mayor primero)', () => {
    expect(PANEL).toContain('.sort((a, b) => (Number(b.numero) || 0) - (Number(a.numero) || 0))');
  });
});

describe('Permisos — Editar/Eliminar y creación solo Admin/Mercadeo (7, 8)', () => {
  it('puedeGestionarSeguimientoUI = isAdmin(rol) || (esMercadeo(rol) && Privado) — misma fuente que el backend', () => {
    expect(PANEL).toContain('const puedeGestionarSeguimientoUI = isAdmin(sesion.rol) || (esMercadeo(sesion.rol) && esProcesoPrivadoPorAlias(sol.aliasFuente));');
  });
  it('Editar/Eliminar están gateados por puedeGestionarSeguimientoUI (nunca visibles para Comercial)', () => {
    expect(PANEL).toContain('{puedeGestionarSeguimientoUI && !enEdicion && (');
  });
  it('el formulario de crear (textarea + botón) también está gateado por puedeGestionarSeguimientoUI', () => {
    const ocurrencias = PANEL.split('{puedeGestionarSeguimientoUI && (').length - 1;
    expect(ocurrencias).toBeGreaterThanOrEqual(1);
  });
  it('usuarios sin permiso ven "Solo lectura" en vez de "Opcional"', () => {
    expect(PANEL).toContain("{puedeGestionarSeguimientoUI ? 'Opcional' : 'Solo lectura'}");
  });
});

describe('Backend aplica la misma regla (7, 8)', () => {
  it('POST/PATCH/DELETE usan puedeGestionarSeguimiento — misma función para las 3 operaciones', () => {
    const routeTs = readFileSync(join(__dirname, 'api/solicitudes/[id]/seguimiento/route.ts'), 'utf-8');
    const ocurrencias = routeTs.split('puedeGestionarSeguimiento(usuario.rol, solicitud)').length - 1;
    expect(ocurrencias).toBe(3);
  });
});

describe('Eliminar no renumera las demás (9)', () => {
  it('DELETE hace soft-delete (activo:false), nunca reconstruye/renumera el arreglo', () => {
    const routeTs = readFileSync(join(__dirname, 'api/solicitudes/[id]/seguimiento/route.ts'), 'utf-8');
    expect(routeTs).toContain("activo: false, eliminadoEn: ahoraLegible(), eliminadoPor: usuario.usuario");
    expect(routeTs).not.toContain('actuales.filter((a) => String(a.id ?? \'\') !== anotacionId)');
  });
});

describe('Orden en la ficha: formulario de creación DEBAJO del listado', () => {
  it('el cierre del listado (ternario) aparece antes que el textarea de creación en el texto fuente', () => {
    const idxCierreListado = PANEL.indexOf(')}', PANEL.indexOf('{listaOrdenada.map'));
    const idxTextareaCrear = PANEL.indexOf('Escribe una observación sobre el seguimiento del proceso...');
    expect(idxCierreListado).toBeGreaterThan(-1);
    expect(idxTextareaCrear).toBeGreaterThan(idxCierreListado);
  });
});
