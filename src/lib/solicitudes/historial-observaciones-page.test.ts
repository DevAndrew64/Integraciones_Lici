/**
 * Ajuste "VER OBSERVACIONES — HISTÓRICO DE SOLO LECTURA" — verificación de
 * cableado en `page.tsx`, mismo patrón de assertions sobre TEXTO exacto del
 * código fuente ya usado en el resto de *-page.test.ts (no hay arnés de
 * render de componentes para page.tsx).
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

const B_MODAL = bloque(
  'function ModalHistorialObservaciones({sol,onClose}:{sol:Solicitud;onClose:()=>void}){',
  '\n/* =========================================================\n   VISTA FICHA DE ASIGNACIÓN',
);

describe('ModalHistorialObservaciones — histórico de solo lectura, nunca filtra por estado actual', () => {
  it('aplana TODAS las observaciones de TODAS las asignaciones (nunca solo la última/activa)', () => {
    // Ajuste "OBSERVACIONES DEL PROCESO — FUENTE CANÓNICA COMPARTIDA" —
    // el flatMap inline se extrajo al helper de módulo
    // `obtenerObservacionesProceso` (misma lógica, ya no duplicada).
    expect(PAGE_TSX).toContain('function obtenerObservacionesProceso(asignaciones: unknown): Record<string, unknown>[] {');
    expect(PAGE_TSX).toContain(
      "return safeArray<Record<string, unknown>>(asignaciones).flatMap(a => safeArray<Record<string, unknown>>(getRecordValue(a, 'observaciones')));"
    );
    expect(B_MODAL).toContain('const observaciones=obtenerObservacionesProceso(sol.asignaciones);');
  });

  it('nunca filtra por estado de la solicitud (no hay condición estado=En observación ni similar)', () => {
    expect(B_MODAL).not.toMatch(/estadoSolicitud/);
    expect(B_MODAL).not.toMatch(/estado\s*===\s*['"]En observaci/);
  });

  it('proceso sin observaciones muestra el mensaje vacío, nunca un error', () => {
    expect(B_MODAL).toContain('Sin observaciones registradas.');
  });

  it('cada observación muestra tipo de causa/causa específica, detalle, fecha y usuario', () => {
    expect(B_MODAL).toContain("safeString(o.tipoCausa)");
    expect(B_MODAL).toContain('causaEspecifica');
    expect(B_MODAL).toContain('safeString(o.detalle)');
    expect(B_MODAL).toContain('safeString(o.fecha)');
    // Ajuste "FORMATO VISIBLE DE USERNAMES" — el autor ahora pasa por
    // formatearUsuarioVisible (misma fuente cruda o.usuario).
    expect(B_MODAL).toContain("Por: {formatearUsuarioVisible(safeString(o.usuario))}");
  });

  it('muestra Aceptada/No aceptada cuando existe decisión registrada', () => {
    expect(B_MODAL).toContain("decision==='aceptada'?'✓ Aceptada':'✗ No aceptada'");
  });

  it('observación tipo Indicador muestra la tabla de indicadores (subcausa/requerido/evidenciado/cumple)', () => {
    expect(B_MODAL).toContain("esObsIndicador=safeString(o.tipoCausa)==='Indicador'");
    expect(B_MODAL).toContain('renderIndicadoresObs(o)');
    expect(B_MODAL).toContain('ind.valorRequerido');
    expect(B_MODAL).toContain('ind.valorEvidenciado');
  });

  it('SOLO LECTURA — nunca renderiza acciones de registrar/editar/eliminar/marcar decisión', () => {
    expect(B_MODAL).not.toContain('Editar');
    expect(B_MODAL).not.toContain('Eliminar');
    expect(B_MODAL).not.toContain('onClick={async () =>');
    expect(B_MODAL).not.toContain('setDecisionesLocales');
    expect(B_MODAL).not.toContain('await guardar(');
    // único botón interactivo real del modal: cerrar (✕ y "Cerrar")
    expect((B_MODAL.match(/<button/g) ?? []).length).toBe(2);
  });
});

describe('VistFichaAsignacion — botón "Ver observaciones"', () => {
  const B_FICHA = bloque(
    'function VistFichaAsignacion({sol,sesion,onVolver,onGuardado,onModuleChange=()=>{}}',
    '\n/* =========================================================\n   MÓDULO PROCESOS POR VALIDAR',
  );

  it('cuenta observaciones de TODAS las asignaciones (histórico completo, no solo la activa)', () => {
    expect(B_FICHA).toContain('const totalObservacionesHistoricas=asignaciones.reduce((s,a)=>s+safeArray(getRecordValue(a,\'observaciones\')).length,0);');
  });

  it('el botón se OCULTA (nunca deshabilitado) cuando no hay ninguna observación', () => {
    expect(B_FICHA).toContain('{totalObservacionesHistoricas>0&&(');
    expect(B_FICHA).not.toContain('Sin observaciones</button>');
  });

  it('abre el modal histórico con la Solicitud completa (todas sus asignaciones)', () => {
    expect(B_FICHA).toContain('{showHistorialObs&&<ModalHistorialObservaciones sol={solLocal} onClose={()=>setShowHistorialObs(false)}/>}');
  });

  it('el botón vive junto a "Estado de asignación" en el Resumen de la ficha', () => {
    const idxEstado = B_FICHA.indexOf('Estado de asignación</div>');
    expect(idxEstado).toBeGreaterThan(-1);
    const idxBoton = B_FICHA.indexOf('Ver observaciones', idxEstado);
    expect(idxBoton).toBeGreaterThan(idxEstado);
    // Ajuste "MOTIVO DEL CIERRE — FILA TERMINAL REAL" / "DETALLE DEL
    // CIERRE" / "CIERRE — NO USAR asigActual COMO GATE" insertaron un
    // bloque adicional (badge "Resultado"/"Detalle del cierre"/causa
    // gerencial/"Motivo del cierre") entre el estado y el botón — mismo
    // panel, ventana ampliada para el nuevo contenido.
    expect(idxBoton - idxEstado).toBeLessThan(6500);
  });
});
