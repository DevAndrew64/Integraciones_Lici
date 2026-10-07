/**
 * Ajuste "ESTADO DE ASIGNACIÓN — SIN VALORES TÉCNICOS CRUDOS" (bug real
 * reportado: el badge "Estado de asignación" en `VistFichaAsignacion`
 * mostraba "EN_OBSERVACION" tal cual, en vez de "En observación").
 *
 * DIAGNÓSTICO: el badge ya usaba un helper de etiquetas existente
 * (`ESTADO_LABELS`, un `Record<string,string>` local a `VistFichaAsignacion`,
 * ya usado también por `estadoAsigLabel`) — nunca un valor crudo directo.
 * El bug era que ese mapa cubría los códigos de fila (`estadoRevision`:
 * CERRADO_ADJUDICADO/RECHAZADO/CANCELADO/etc.) pero le faltaban 6 valores
 * del enum GLOBAL `EstadoCanonico` (`src/lib/solicitudes/estados-canonicos.ts`)
 * que también resuelve `estadoGlobalLabel` con el MISMO mapa: cuando
 * `estadoGlobalCanonico` era uno de esos 6 (más frecuentemente
 * `EN_OBSERVACION`), el fallback `ESTADO_LABELS[x] ?? estadoGlobalCanonico`
 * devolvía el código crudo. NO se creó un segundo helper — se completó el
 * mapa existente.
 *
 * Solo presentación: `estadoGlobalCanonico`/`estadoAsig` (los valores
 * reales usados en comparaciones, filtros, payloads y lógica de negocio)
 * no cambiaron.
 *
 * Mismo patrón de texto fuente que el resto de *-page.test.ts (sin harness
 * de render de componentes en este repo).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, 'page.tsx'), 'utf-8');

function extraerBloque(inicioMarker: string, finMarker: string): string {
  const inicio = PAGE_TSX.indexOf(inicioMarker);
  const fin = PAGE_TSX.indexOf(finMarker, inicio);
  if (inicio === -1 || fin === -1) throw new Error(`No se encontró el bloque ${inicioMarker} → ${finMarker}`);
  return PAGE_TSX.slice(inicio, fin);
}

const BLOQUE_VISTFICHA_ASIGNACION = extraerBloque('function VistFichaAsignacion(', 'function ModuloAsignacionesPorValidar(');

describe('1) EN_OBSERVACION -> "En observación"', () => {
  it('ESTADO_LABELS incluye la entrada EN_OBSERVACION con la etiqueta humana', () => {
    expect(BLOQUE_VISTFICHA_ASIGNACION).toContain("EN_OBSERVACION:       'En observación',");
  });
});

describe('2) El badge nunca interpola el valor crudo directamente', () => {
  it('el badge "Estado de asignación" renderiza {estadoGlobalLabel} (la etiqueta ya resuelta), nunca {estadoGlobalCanonico}', () => {
    const idx = BLOQUE_VISTFICHA_ASIGNACION.indexOf('Estado de asignación</div>');
    expect(idx).toBeGreaterThan(-1);
    const tramo = BLOQUE_VISTFICHA_ASIGNACION.slice(idx, idx + 300);
    expect(tramo).toContain('{estadoGlobalLabel}');
    expect(tramo).not.toContain('{estadoGlobalCanonico}');
  });
  it('estadoGlobalLabel se resuelve con ESTADO_LABELS (mismo mapa, sin duplicar lógica), con fallback solo para casos genuinamente no mapeados', () => {
    expect(BLOQUE_VISTFICHA_ASIGNACION).toContain(
      "const estadoGlobalLabel = estadoGlobalAmbiguo\n  ? 'En validación — verificar asignaciones'\n  : (ESTADO_LABELS[estadoGlobalCanonico ?? ''] ?? estadoGlobalCanonico ?? 'Selección de proceso');"
    );
  });
});

describe('3) Otros estados relevantes tienen etiqueta humana consistente (sin guion bajo, capitalización natural)', () => {
  it('los 6 valores del enum global que faltaban ahora están cubiertos', () => {
    expect(BLOQUE_VISTFICHA_ASIGNACION).toContain("SELECCION_PROCESO:    'Selección de proceso',");
    expect(BLOQUE_VISTFICHA_ASIGNACION).toContain("REVISION_COMERCIAL:   'Revisión comercial',");
    expect(BLOQUE_VISTFICHA_ASIGNACION).toContain("EN_OBSERVACION:       'En observación',");
    expect(BLOQUE_VISTFICHA_ASIGNACION).toContain("REVISION_FINALIZADA:  'Revisión finalizada',");
    expect(BLOQUE_VISTFICHA_ASIGNACION).toContain("CERRADA:              'Cerrada',");
    expect(BLOQUE_VISTFICHA_ASIGNACION).toContain("CANCELADA:             'Cancelada',");
  });
  it('los estados de fila (row-level) ya mapeados siguen intactos: Adjudicado, No adjudicado, Rechazado, Cancelado, Cerrado sin presentar', () => {
    expect(BLOQUE_VISTFICHA_ASIGNACION).toContain("CERRADO_ADJUDICADO:   'Adjudicado',");
    expect(BLOQUE_VISTFICHA_ASIGNACION).toContain("CERRADO_NO_ADJUDICADO:'No adjudicado',");
    expect(BLOQUE_VISTFICHA_ASIGNACION).toContain("RECHAZADO:            'Rechazado',");
    expect(BLOQUE_VISTFICHA_ASIGNACION).toContain("CANCELADO:               'Cancelado',");
    expect(BLOQUE_VISTFICHA_ASIGNACION).toContain("CERRADO_NO_CUMPLIMIENTO: 'Cerrado sin presentar',");
  });
  it('ninguna etiqueta nueva contiene guion bajo (_)', () => {
    const idx = BLOQUE_VISTFICHA_ASIGNACION.indexOf("SELECCION_PROCESO:    'Selección de proceso',");
    const idxFin = BLOQUE_VISTFICHA_ASIGNACION.indexOf('};', idx);
    const bloqueNuevo = BLOQUE_VISTFICHA_ASIGNACION.slice(idx, idxFin);
    const etiquetas = [...bloqueNuevo.matchAll(/:\s*'([^']+)'/g)].map(m => m[1]);
    expect(etiquetas.length).toBeGreaterThan(0);
    for (const etiqueta of etiquetas) {
      expect(etiqueta).not.toContain('_');
      expect(etiqueta).not.toMatch(/^[A-Z_]+$/); // nunca todo mayúsculas tipo código interno
    }
  });
});

describe('4) La lógica interna sigue usando los valores crudos (sin cambios de comparaciones/filtros/payloads)', () => {
  it('etapaGlobal, los case del switch de cierre y las comparaciones siguen usando estadoGlobalCanonico crudo, nunca la etiqueta', () => {
    expect(BLOQUE_VISTFICHA_ASIGNACION).toContain("estadoGlobalCanonico==='CERRADA'");
    expect(BLOQUE_VISTFICHA_ASIGNACION).toContain("estadoGlobalCanonico==='EN_OBSERVACION'");
  });
  it('estados-canonicos.ts (fuente del tipo EstadoCanonico y ETAPA_POR_ESTADO) no fue tocado', () => {
    const src = readFileSync(join(__dirname, '..', 'lib', 'solicitudes', 'estados-canonicos.ts'), 'utf-8');
    expect(src).toContain("| 'EN_OBSERVACION' | 'REVISION_FINALIZADA'");
  });
});

describe('5) "Ver observaciones" sigue visible cuando corresponde (sin relación con este ajuste)', () => {
  it('el botón sigue gateado por totalObservacionesHistoricas>0, sin cambios', () => {
    expect(BLOQUE_VISTFICHA_ASIGNACION).toContain('{totalObservacionesHistoricas>0&&(');
    expect(BLOQUE_VISTFICHA_ASIGNACION).toContain('Ver observaciones');
  });
});
