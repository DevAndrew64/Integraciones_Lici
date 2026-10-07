/**
 * Lote F2D — el botón "Editar solicitud" (dentro de Solicitudes: Todas las
 * solicitudes / Procesos públicos / Procesos privados) y la apertura de
 * ModalEditarSolicitud deben quedar bloqueados para registros sincronizados
 * (SECOP I, SECOP II, NC real) — regla POSITIVA y conservadora:
 * `esManualConfirmada = procesoSourceKey empieza por "mix:" Y externalId vacío`.
 *
 * Mismo patrón de verificación de fuente ya usado en el resto del repo
 * (sin jsdom/RTL): confirma el cableado exacto en page.tsx, y evalúa la
 * función pura extraída del propio archivo para probar su comportamiento
 * real contra los 6 casos + ambiguos, sin duplicar la lógica en el test.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, 'page.tsx'), 'utf-8');

describe('Cableado F2D en page.tsx', () => {
  it('existe esSolicitudManualConfirmada() con la regla positiva mix:+sin externalId', () => {
    expect(PAGE_TSX).toContain('function esSolicitudManualConfirmada(sol: Solicitud): boolean {');
    expect(PAGE_TSX).toContain("sourceKey.startsWith('mix:')");
  });

  it('el botón Editar solicitud exige exactamente 1 seleccionado Y esSolicitudManualConfirmada — ya no se limita a "disabled"', () => {
    expect(PAGE_TSX).toContain(
      "{puedeConBD(sesion.rol,'solicitudesComercial','editar',sesion.permisosRol)&&seleccionados.length===1&&esSolicitudManualConfirmada(solicitudes.find(s=>s.id===seleccionados[0])||({} as Solicitud))&&<button className=\"icon-btn\" title=\"Editar solicitud\" onClick={()=>{const s=solicitudes.find(s=>s.id===seleccionados[0]);if(s&&esSolicitudManualConfirmada(s))setModalEditar(s);}}><IcoPencil/></button>}"
    );
  });

  it('ModalEditarSolicitud tiene defensa propia: no se monta aunque modalEditar tenga un valor residual no-manual', () => {
    expect(PAGE_TSX).toContain(
      '{modalEditar&&esSolicitudManualConfirmada(modalEditar)&&(<ModalEditarSolicitud'
    );
  });
});

// Corrección "MODAL EDITAR SOLICITUD NO PERMITE GUARDAR EN ESTADOS
// PROTEGIDOS" — ModalEditarSolicitud reenviaba `estadoSolicitud` sin
// cambios (el modal nunca lo hace editable) — si la Solicitud ya estaba en
// uno de los tokens canónicos bloqueados por `detectarCambioDeFlujoNoAutorizado`
// (ver deteccion-cambio-flujo.ts), el PATCH se rechazaba con 400 aunque el
// usuario solo quisiera editar campos legítimos (fecha de cierre,
// plataforma, etc.). Fix: el body del PATCH ya no incluye esa clave.
describe('ModalEditarSolicitud.handleGuardar — el PATCH ya no reenvía estadoSolicitud', () => {
  const inicioModal = PAGE_TSX.indexOf('function ModalEditarSolicitud(');
  const finModal = PAGE_TSX.indexOf('function ModalEditarAsignacion(');
  if (inicioModal === -1 || finModal === -1 || finModal <= inicioModal) {
    throw new Error('No se pudo delimitar ModalEditarSolicitud en page.tsx');
  }
  const bloqueModal = PAGE_TSX.slice(inicioModal, finModal);
  // Acota ESTRICTAMENTE al body del PATCH (fetch('/api/solicitudes', {... body:
  // JSON.stringify({...}) ...}) — nunca a la función completa, que también
  // contiene el merge-back local `onGuardado({..., estadoSolicitud: form.estadoSolicitud, ...})`
  // (estado local, nunca enviado al servidor) — mezclar ambos produciría
  // falsos positivos/negativos sobre lo que realmente viaja en la red.
  const inicioBody = bloqueModal.indexOf("fetch('/api/solicitudes', {");
  const finBody = bloqueModal.indexOf('});', inicioBody);
  if (inicioBody === -1 || finBody === -1) {
    throw new Error('No se pudo delimitar el body del PATCH dentro de ModalEditarSolicitud');
  }
  const bloquePatchBody = bloqueModal.slice(inicioBody, finBody);

  it('el body del PATCH /api/solicitudes NO contiene la clave estadoSolicitud', () => {
    expect(bloquePatchBody).not.toMatch(/estadoSolicitud:\s*form\.estadoSolicitud,/);
    expect(bloquePatchBody).not.toContain('estadoSolicitud');
  });

  it('el body del PATCH SÍ sigue enviando los demás campos editables (fechaCierre, plataforma, entre otros)', () => {
    expect(bloquePatchBody).toContain("fechaCierre:       form.fechaCierre || null,");
    expect(bloquePatchBody).toContain('plataforma:        form.plataforma,');
    expect(bloquePatchBody).toContain('entidad:           form.entidad,');
    expect(bloquePatchBody).toContain('linkDetalle:       urlProcesoFinal,');
  });

  it('reproduce conceptualmente el caso reportado: para cualquiera de los estados protegidos, el PATCH ya no incluiría ese valor en el body — el guard de cambio de flujo (que solo revisa "estadoSolicitud" si la clave está presente) nunca se activaría por esta causa', () => {
    const ESTADOS_PROTEGIDOS = ['EN_REVISION', 'ASIGNADO_REVISION', 'EN_ELABORACION', 'APROBADO_ELABORACION', 'EN_OBSERVACION', 'PRESENTADO'];
    // El body ya no depende en absoluto de sol.estadoSolicitud/form.estadoSolicitud
    // para decidir qué se envía — por tanto es indiferente cuál sea el
    // estado real de la Solicitud al momento de guardar: la clave
    // simplemente no existe en el payload para NINGÚN estado.
    for (const estado of ESTADOS_PROTEGIDOS) {
      expect(bloquePatchBody).not.toContain(`estadoSolicitud:   '${estado}'`);
    }
    expect(bloquePatchBody).not.toContain('estadoSolicitud');
  });

  it('el merge-back local (onGuardado) puede seguir conservando estadoSolicitud sin efecto en el servidor — nunca se envía por red, solo es estado local del componente', () => {
    const bloqueOnGuardado = bloqueModal.slice(finBody);
    // No es parte del contrato de red — este assert documenta que su
    // presencia (si existe) es intencional e inocua, no un descuido.
    expect(bloqueOnGuardado.includes('onGuardado({')).toBe(true);
  });
});

describe('esSolicitudManualConfirmada — comportamiento real (función extraída de page.tsx)', () => {
  const match = PAGE_TSX.match(/function esSolicitudManualConfirmada\(sol: Solicitud\): boolean \{([\s\S]*?)\n\}/);
  if (!match) throw new Error('No se encontró esSolicitudManualConfirmada en page.tsx');
  // eslint-disable-next-line no-new-func
  const esSolicitudManualConfirmada = new Function('sol', match[1]) as (sol: Record<string, unknown>) => boolean;

  it('SECOP I sincronizado (ext:, con externalId) → NO manual confirmada', () => {
    expect(esSolicitudManualConfirmada({ procesoSourceKey: 'ext:11833728', externalId: '11833728' })).toBe(false);
  });
  it('SECOP II sincronizado → NO manual confirmada', () => {
    expect(esSolicitudManualConfirmada({ procesoSourceKey: 'ext:22222', externalId: '22222' })).toBe(false);
  });
  it('NC sincronizado (ext: + externalId, aliasFuente NC) → NO manual confirmada', () => {
    expect(esSolicitudManualConfirmada({ procesoSourceKey: 'ext:33333', externalId: '33333' })).toBe(false);
  });
  it('Público manual (mix:, sin externalId) → SÍ manual confirmada', () => {
    expect(esSolicitudManualConfirmada({ procesoSourceKey: 'mix:CODIGO||S2||ENTIDAD', externalId: null })).toBe(true);
  });
  it('Cotización manual (mix:, sin externalId) → SÍ manual confirmada', () => {
    expect(esSolicitudManualConfirmada({ procesoSourceKey: 'mix:No 1||NC||CLIENTE', externalId: undefined })).toBe(true);
  });
  it('Oferta/NC manual (mix:, sin externalId, aliasFuente NC) → SÍ manual confirmada — no se confunde con NC sincronizada', () => {
    expect(esSolicitudManualConfirmada({ procesoSourceKey: 'mix:No 5||NC||CLIENTE', externalId: '' })).toBe(true);
  });
  it('origen desconocido / formato legado (sin prefijo ext:/mix:) → NO manual confirmada (conservador)', () => {
    expect(esSolicitudManualConfirmada({ procesoSourceKey: '029-2026-MC||S1', externalId: null })).toBe(false);
  });
  it('sin procesoSourceKey → NO manual confirmada', () => {
    expect(esSolicitudManualConfirmada({ procesoSourceKey: null, externalId: null })).toBe(false);
  });
  it('anomalía mix: con externalId presente → NO manual confirmada (la regla exige AMBAS condiciones)', () => {
    expect(esSolicitudManualConfirmada({ procesoSourceKey: 'mix:X||S2||Y', externalId: '123' })).toBe(false);
  });
});
