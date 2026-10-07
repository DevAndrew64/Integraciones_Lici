/**
 * Ajuste "OTRA CAUSA — RECHAZO" — el modal "Rechazar proceso"
 * (`ModalEditarAsignacion`, page.tsx) agrega la causal 'OTRA_CAUSA', que
 * reutiliza el textarea existente (`obsRechazo`) como "Detalle de la causa"
 * obligatorio. La regla de negocio en sí (validación backend, catálogo,
 * comportamiento de `handleRechazar`) se prueba con unit tests reales en
 * `route.seguridad.test.ts` y `solicitudes-rechazar-soporte-upload.test.ts`
 * — este archivo cubre SOLO el cableado del componente: que el catálogo, el
 * label condicional, la limpieza al cambiar de causal y la visualización
 * posterior (Panel — Rechazado) están realmente presentes en el código
 * fuente. Mismo patrón de texto fuente que el resto de *-page.test.ts (sin
 * harness de render de componentes en este repo).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, 'page.tsx'), 'utf-8');

describe('CAUSALES — catálogo del modal de rechazo (1)', () => {
  it('incluye "Otra causa" (OTRA_CAUSA) junto a las 5 causales existentes', () => {
    expect(PAGE_TSX).toContain("{ value: 'ESTUDIO_MERCADO',          label: 'Estudio de mercado' }");
    expect(PAGE_TSX).toContain("{ value: 'PROCESO_DUPLICADO',        label: 'Proceso duplicado' }");
    expect(PAGE_TSX).toContain("{ value: 'NO_OBJETO_SOCIAL',         label: 'No corresponde a objeto social' }");
    expect(PAGE_TSX).toContain("{ value: 'SERVICIOS_ESPECIALIZADOS', label: 'Servicios especializados' }");
    expect(PAGE_TSX).toContain("{ value: 'DECISION_GERENCIAL',       label: 'Decisión gerencial' }");
    expect(PAGE_TSX).toContain("{ value: 'OTRA_CAUSA',               label: 'Otra causa' }");
  });
});

describe('esOtraCausa — derivado de causal, mismo patrón que esDecisionGerencial', () => {
  it('existe `const esOtraCausa = causal === \'OTRA_CAUSA\';`', () => {
    expect(PAGE_TSX).toContain("const esOtraCausa = causal === 'OTRA_CAUSA';");
  });
});

describe('Textarea reutilizado — label condicional "Detalle de la causa *" (2)', () => {
  it('el label cambia a "Detalle de la causa *" cuando esOtraCausa, "Observaciones" en los demás casos', () => {
    expect(PAGE_TSX).toContain("{esOtraCausa ? 'Detalle de la causa *' : 'Observaciones'}");
  });

  it('NO se creó ningún estado/campo nuevo — sigue usando `obsRechazo` (mismo textarea)', () => {
    // El textarea del bloque "Rechazar proceso" sigue ligado a obsRechazo —
    // no aparece ningún nuevo useState tipo `detalleCausa`/`detalleOtraCausa`.
    expect(PAGE_TSX).not.toMatch(/const \[detalleCausa,/);
    expect(PAGE_TSX).not.toMatch(/const \[detalleOtraCausa,/);
    expect(PAGE_TSX).toContain('const [obsRechazo, setObsRechazo] = useState(\'\');');
  });
});

describe('Validación frontend obligatoria (3, 4)', () => {
  it('handleRechazar bloquea con mensaje claro cuando esOtraCausa y obsRechazo está vacío', () => {
    expect(PAGE_TSX).toContain("if (esOtraCausa && !obsRechazo.trim()) { setError('Debes indicar el detalle cuando seleccionas Otra causa.'); return; }");
  });

  it('el botón "Confirmar rechazo" se deshabilita cuando esOtraCausa && !obsRechazo.trim()', () => {
    expect(PAGE_TSX).toContain("disabled={guardando || !causal || (esDecisionGerencial && !archivo) || (esOtraCausa && !obsRechazo.trim())}");
  });
});

describe('Limpieza al cambiar de causal (6)', () => {
  it('el onChange del select de causal sigue limpiando obsRechazo — comportamiento preexistente, sin cambios', () => {
    expect(PAGE_TSX).toContain("onChange={e => { setCausal(e.target.value); setObsRechazo(''); setArchivo(null); setError(''); }}");
  });
});

describe('Backend en paridad con el frontend', () => {
  it('CAUSALES_RECHAZO (route.ts) incluye OTRA_CAUSA', async () => {
    const routeTs = readFileSync(join(__dirname, 'api/solicitudes/[id]/cerrar/route.ts'), 'utf-8');
    expect(routeTs).toContain("'ESTUDIO_MERCADO', 'PROCESO_DUPLICADO', 'NO_OBJETO_SOCIAL', 'SERVICIOS_ESPECIALIZADOS', 'DECISION_GERENCIAL', 'OTRA_CAUSA',");
    expect(routeTs).toContain("if (f.causalRechazo === 'OTRA_CAUSA' && !fila.observacionRechazo)");
  });

  it('ETIQUETA_CAUSAL_RECHAZO (observacion-cierre-terminal.ts) incluye OTRA_CAUSA', async () => {
    const { ETIQUETA_CAUSAL_RECHAZO } = await import('@/lib/solicitudes/observacion-cierre-terminal');
    expect(ETIQUETA_CAUSAL_RECHAZO.OTRA_CAUSA).toBe('Otra causa');
  });
});

describe('Panel — Rechazado: visualización posterior (8, 9)', () => {
  it('importa ETIQUETA_CAUSAL_RECHAZO desde la fuente única compartida con el backend', () => {
    // Ajuste "MOTIVO DEL CIERRE — FILA TERMINAL REAL" agregó
    // `obtenerObservacionCierreTerminal`/`obtenerFilaCierreTerminal` al
    // mismo import — misma fuente única, sin duplicar.
    expect(PAGE_TSX).toContain("import { ETIQUETA_CAUSAL_RECHAZO, obtenerObservacionCierreTerminal, obtenerFilaCierreTerminal } from '@/lib/solicitudes/observacion-cierre-terminal';");
  });

  it('muestra la etiqueta legible de causalRechazo bajo el label "Causal"', () => {
    expect(PAGE_TSX).toContain("const causalRechazoLabel = causalRechazoCodigo ? (ETIQUETA_CAUSAL_RECHAZO[causalRechazoCodigo] ?? causalRechazoCodigo) : '';");
    expect(PAGE_TSX).toContain('<div style={labelStyleRechazo}>Causal</div>');
  });

  it('muestra observacionRechazo bajo "Detalle" (OTRA_CAUSA) u "Observación" (las demás causales)', () => {
    expect(PAGE_TSX).toContain("const labelDetalle = causalRechazoCodigo === 'OTRA_CAUSA' ? 'Detalle' : 'Observación';");
  });

  it('sigue mostrando motivoRechazo para registros del flujo antiguo/simple (compatibilidad histórica)', () => {
    expect(PAGE_TSX).toContain("const motivoRechazoTexto = safeString(getRecordValue(asigActual, 'motivoRechazo'));");
    expect(PAGE_TSX).toContain('{motivoRechazoTexto && (');
  });

  it('nunca duplica el mismo texto si observacionRechazo coincide exactamente con la etiqueta de la causal', () => {
    expect(PAGE_TSX).toContain('{observacionRechazoTexto && observacionRechazoTexto !== causalRechazoLabel && (');
  });
});
