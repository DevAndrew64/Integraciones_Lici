/**
 * Ajuste "PERMISOS DE CIERRE — PRIVADOS PARA MERCADEO" — el botón real de
 * cierre dentro de `GestionAsignacionInline` (Adjudicado/No adjudicado +
 * "Finalizar proceso") deja de usar el array de roles hardcodeado
 * (`puedeActuar`, que sigue rigiendo TODAS las demás acciones del panel —
 * observaciones, evidencias, revisión — sin ningún cambio) y pasa a
 * reflejar EXACTAMENTE `permisos?.puedeCerrarSolicitud` — el mismo booleano
 * que ya calcula el backend (`calcularPermisosFicha` → `puedeCerrarSolicitud`
 * en `src/lib/solicitudes/autorizacion-asignacion.ts`) y que también
 * autoriza (o rechaza) la llamada real a `POST .../cerrar`. La regla en sí
 * (Público/Privado, Comercial/Mercadeo) se prueba con unit tests reales
 * sobre `puedeCerrarSolicitud` en `autorizacion-asignacion.test.ts`, y con
 * integración de endpoint en `route.permisos-tipo-proceso.test.ts` — este
 * archivo cubre SOLO lo que no puede verificarse ahí: que la UI realmente
 * consulta ese mismo permiso, sin duplicar la decisión localmente. Mismo
 * patrón de texto fuente que el resto de *-page.test.ts (sin harness de
 * render de componentes en este repo).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, 'page.tsx'), 'utf-8');

function bloque(inicioMarcador: string, finMarcador: string, desde = 0): string {
  const inicio = PAGE_TSX.indexOf(inicioMarcador, desde);
  if (inicio === -1) throw new Error(`No se encontró el marcador de inicio: ${inicioMarcador}`);
  const fin = PAGE_TSX.indexOf(finMarcador, inicio);
  if (fin === -1) throw new Error(`No se encontró el marcador de fin: ${finMarcador}`);
  return PAGE_TSX.slice(inicio, fin);
}

describe('GestionAsignacionInline — el gate de cierre usa permisos?.puedeCerrarSolicitud', () => {
  it('existe una variable `puedeCerrar` derivada de `permisos?.puedeCerrarSolicitud ?? false` (nunca un array de roles local)', () => {
    expect(PAGE_TSX).toContain('const puedeCerrar = permisos?.puedeCerrarSolicitud ?? false;');
  });

  it('el bloque "Resultado del proceso" (Adjudicado/No adjudicado + "Finalizar proceso") está gateado por `puedeCerrar`, no por `puedeActuar`', () => {
    expect(PAGE_TSX).toContain("{puedeCerrar && estadoRevision === 'PRESENTADO' && (");
    expect(PAGE_TSX).not.toContain("{puedeActuar && estadoRevision === 'PRESENTADO' && (");
  });

  it('no existe ningún array hardcodeado de roles (\'Director Comercial\'/\'Coordinador Comercial\') decidiendo el cierre — la única aparición de ese array en el componente es `puedeActuar`, que gatea las DEMÁS acciones del panel (observaciones/evidencias/revisión), nunca "Finalizar proceso"', () => {
    const inicioComponente = PAGE_TSX.indexOf('function GestionAsignacionInline(');
    const bloqueCierre = bloque("{puedeCerrar && estadoRevision === 'PRESENTADO' && (", 'Finalizar proceso', inicioComponente);
    expect(bloqueCierre).not.toContain("['Administrador','Director Comercial','Coordinador Comercial']");
  });

  it('`puedeCerrar` se calcula ANTES del bloque de cierre y usa `permisos` (prop del componente, ya alimentada por `calcularPermisosFicha` en el backend) — nunca `sesion.rol` directamente', () => {
    const inicioComponente = PAGE_TSX.indexOf('function GestionAsignacionInline(');
    const idxPuedeCerrar = PAGE_TSX.indexOf('const puedeCerrar = permisos?.puedeCerrarSolicitud ?? false;', inicioComponente);
    const idxBloqueCierre = PAGE_TSX.indexOf("{puedeCerrar && estadoRevision === 'PRESENTADO' && (", inicioComponente);
    expect(idxPuedeCerrar).toBeGreaterThan(inicioComponente);
    expect(idxBloqueCierre).toBeGreaterThan(idxPuedeCerrar);
  });

  it('`puedeActuar`: Administrador/Director/Coordinador, o el responsable por identidad (un comercial no responsable NO actúa)', () => {
    expect(PAGE_TSX).toContain('const puedeActuar = esRolPrivilegiadoParaAsignacion(sesion.rol)');
    expect(PAGE_TSX).toContain("|| (!!responsableAsignado && coincideIdentidad(responsableAsignado, { email: sesion.email || '', usuario: sesion.usuario || '', rol: sesion.rol }));");
    expect(PAGE_TSX).not.toContain('esEquipoComercial(sesion.rol) || (!!responsableAsignado');
  });

  it('"Observación no aceptada" usa puedeNoAceptarObservacion del backend; "Rechazar" de validación sigue con puedeRechazar', () => {
    expect(PAGE_TSX).toContain('const puedeNoAceptarObs = permisos?.puedeNoAceptarObservacion ?? puedeRechazar;');
    expect(PAGE_TSX).toContain("{puedeNoAceptarObs && <button onClick={() => { setDecisionObs('no_aceptada');");
    expect(PAGE_TSX).toContain("{puedeRechazar && <button onClick={() => { setDecisionObs('rechazar');");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Ajuste "PERMISOS DE CIERRE — MERCADEO NO ENTRABA AL PANEL" — bug real:
// `puedeCerrarSolicitud=true` para Mercadeo+Privado no bastaba, porque el
// botón que da acceso al panel (`GestionAsignacionInline`, vía
// `setGestionAsig`) estaba gateado por `puedeGestionarFicha`, que solo
// miraba `puedeRevisarProceso` (admin/admin-funcional/responsable) — nunca
// `puedeCerrarSolicitud`. Mercadeo nunca llegaba a donde `puedeCerrar` (ya
// correcto) importaba. Corrección: `puedeGestionarFicha` ahora es
// verdadero también cuando `permisos?.puedeCerrarSolicitud` lo es — sin
// tocar `puedeRevisarProceso`, `puedeAgregarObservacion`, ni el
// `puedeActuar` local de `GestionAsignacionInline` (observaciones/
// evidencias, ver bloque de arriba).
// ═══════════════════════════════════════════════════════════════════════
describe('VistFichaAsignacion — puedeGestionarFicha también se abre por puedeCerrarSolicitud', () => {
  it('puedeGestionarFicha = (puedeRevisarProceso ?? fallback) || (permisos?.puedeCerrarSolicitud ?? false) — la condición original de puedeRevisarProceso/fallback queda intacta, solo se agrega un OR', () => {
    expect(PAGE_TSX).toContain('const puedeGestionarFicha = (permisosBackend?.puedeRevisarProceso');
    expect(PAGE_TSX).toContain('|| (permisosBackend?.puedeCerrarSolicitud ?? false);');
  });

  it('esta variable es la ÚNICA fuente del `puedeActuar` de VistFichaAsignacion (el botón "Cerrar proceso sin presentar") — reutilizarla es correcto porque ese botón llama al MISMO endpoint POST .../cerrar, autorizado por el MISMO puedeCerrarSolicitud, nunca una regla distinta', () => {
    expect(PAGE_TSX).toContain('const puedeActuar = puedeGestionarFicha;');
    const idxBoton = PAGE_TSX.indexOf('Cerrar proceso sin presentar');
    expect(idxBoton).toBeGreaterThan(-1);
    const idxGuardarCierreDirecto = PAGE_TSX.indexOf('const guardarCierreDirecto=async()=>{');
    const bloqueGuardar = bloque('const guardarCierreDirecto=async()=>{', '};', idxGuardarCierreDirecto);
    expect(bloqueGuardar).toContain("fetch(`/api/solicitudes/${solLocal.id}/cerrar`");
  });

  it('la lógica original de `puedeRevisarProceso`/`puedeAgregarObservacion` NO se modificó — siguen sin mencionar Mercadeo ni puedeCerrarSolicitud en su propia definición backend', () => {
    const autz = readFileSync(join(__dirname, '..', 'lib', 'solicitudes', 'autorizacion-asignacion.ts'), 'utf-8');
    const idxRevisar = autz.indexOf('export function puedeRevisarProceso(');
    const idxFinRevisar = autz.indexOf('\n}\n', idxRevisar);
    const cuerpoRevisar = autz.slice(idxRevisar, idxFinRevisar);
    expect(cuerpoRevisar).not.toContain('esMercadeo');
    expect(cuerpoRevisar).not.toContain('puedeCerrarSolicitud');
  });

  it('el `puedeActuar` local de `GestionAsignacionInline` (observaciones/evidencias) usa el rol privilegiado y el responsable asignado, sin depender de `permisosBackend`', () => {
    const inicioComponente = PAGE_TSX.indexOf('function GestionAsignacionInline(');
    const idxPuedeActuarLocal = PAGE_TSX.indexOf('const puedeActuar = esRolPrivilegiadoParaAsignacion(sesion.rol)', inicioComponente);
    expect(idxPuedeActuarLocal).toBeGreaterThan(inicioComponente);
    const lineaCompleta = PAGE_TSX.slice(idxPuedeActuarLocal, PAGE_TSX.indexOf(';', idxPuedeActuarLocal) + 1);
    expect(lineaCompleta).not.toContain('permisos');
    expect(lineaCompleta).not.toContain('permisosBackend');
  });
});
