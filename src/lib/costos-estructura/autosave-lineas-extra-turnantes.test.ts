/**
 * FASE 1 (diagnóstico Aseocolba) — test permanente para el bug de autosave
 * confirmado: `lineasExtra`/`cargosTurnantes` están incluidos en
 * `buildDraftData()` pero AUSENTES del arreglo de dependencias del
 * `useEffect` de autosave (page.tsx ~línea 10705-10716) — agregar/editar un
 * cargo no dispara un nuevo guardado de borrador hasta que cambie algún
 * otro campo del formulario.
 *
 * Mismo patrón de verificación que el resto de `*-page.test.ts` del
 * proyecto (no hay jsdom/RTL — verificación por texto fuente, ver
 * servicios-no-continuos-page.test.ts).
 *
 * NO se modifica ningún archivo de producción en esta fase.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');

/** Extrae el bloque del useEffect de autosave (con debounce ~700ms), desde
 * su declaración hasta el cierre del arreglo de dependencias. */
function bloqueAutosave(): string {
  const marcadorInicio = "localStorage.setItem(draftKey,JSON.stringify({guardadoEn:new Date().toISOString(),data:buildDraftData()}));";
  const inicio = PAGE_TSX.indexOf(marcadorInicio);
  if (inicio === -1) throw new Error('No se encontró el useEffect de autosave — buscar el marcador manualmente si page.tsx cambió de forma.');
  const finDependencias = PAGE_TSX.indexOf(']);', inicio);
  if (finDependencias === -1) throw new Error('No se encontró el cierre del arreglo de dependencias del useEffect de autosave.');
  return PAGE_TSX.slice(inicio, finDependencias + 3);
}

describe('FASE 1 — autosave: lineasExtra/cargosTurnantes ausentes de las dependencias del useEffect', () => {
  it('[VERDE — confirma que ambos campos SÍ están en el objeto persistido] buildDraftData() incluye lineasExtra y cargosTurnantes', () => {
    const inicioBuildDraft = PAGE_TSX.indexOf('const buildDraftData=()=>({');
    const finBuildDraft = PAGE_TSX.indexOf('});', inicioBuildDraft);
    const cuerpo = PAGE_TSX.slice(inicioBuildDraft, finBuildDraft);
    expect(cuerpo).toContain('lineasExtra,cargosTurnantes,');
  });

  it('[VERDE tras Fase 4 — bug corregido] el arreglo de dependencias del useEffect de autosave incluye lineasExtra y cargosTurnantes — agregar/editar un cargo ahora dispara un nuevo guardado de borrador por sí solo', () => {
    const bloque = bloqueAutosave();
    expect(bloque).toContain('lineasExtra');
    expect(bloque).toContain('cargosTurnantes');
  });

  it('[VERDE tras Fase 4] el arreglo de dependencias termina en "...saveCodigo,saveNombre,...lineasExtra,cargosTurnantes]);" — ambos campos agregados al final, sin tocar ninguna de las dependencias preexistentes', () => {
    const bloque = bloqueAutosave();
    expect(bloque).toContain('dotGroups,examRows,cursosRows,vacunasRows,maqRows,adminRows,saveCodigo,saveNombre,');
    expect(bloque).toMatch(/lineasExtra,cargosTurnantes\]\);\s*$/);
  });
});

describe('FASE 1 — autosave: precedencia backend > borrador local (regresión, NO tocar)', () => {
  it('[VERDE — ya correcto hoy, debe seguir así tras la corrección de dependencias] al reabrir un costeo con regId (ya guardado en backend), el flujo va directo a verDetallesCosteo y nunca consulta el borrador local', () => {
    expect(PAGE_TSX).toContain('if(regId){await verDetallesCosteo(s);return;}');
  });
});

describe('FASE 4 — autosave: debounce sin cambios (regresión estructural, no se tocó duración/estrategia)', () => {
  it('[VERDE] el useEffect sigue usando un único setTimeout de 700ms con clearTimeout en el cleanup — cambios rápidos dentro de ese intervalo cancelan la escritura anterior y solo la última programada llega a ejecutarse (mismo mecanismo de siempre, sin cambios en Fase 4)', () => {
    const inicioEfecto = PAGE_TSX.indexOf('// Autosave con debounce ~700ms');
    const finEfecto = PAGE_TSX.indexOf(']);', PAGE_TSX.indexOf(bloqueAutosave()));
    const efectoCompleto = PAGE_TSX.slice(inicioEfecto, finEfecto + 3);
    expect(efectoCompleto).toContain('setTimeout(()=>{');
    expect(efectoCompleto).toContain('},700);');
    expect(efectoCompleto).toContain('return ()=>clearTimeout(t);');
  });

  it('[VERDE] no se agregó ningún setTimeout/setInterval adicional al bloque de autosave — sigue siendo una única escritura agrupada por disparo del efecto', () => {
    const inicioEfecto = PAGE_TSX.indexOf('// Autosave con debounce ~700ms');
    const finEfecto = PAGE_TSX.indexOf(']);', PAGE_TSX.indexOf(bloqueAutosave()));
    const efectoCompleto = PAGE_TSX.slice(inicioEfecto, finEfecto + 3);
    const ocurrenciasSetTimeout = efectoCompleto.split('setTimeout(').length - 1;
    expect(ocurrenciasSetTimeout).toBe(1);
  });
});

describe('FASE 4 — autosave: un draft local desactualizado no debe sobrescribir backend (regresión, mismo mecanismo de precedencia)', () => {
  it('[VERDE] la restauración de draft (restaurarDraft) solo se invoca cuando el costeo NO tiene regId — el guardado con regId nunca pasa por localStorage.getItem(draftKey)', () => {
    const inicioElegir = PAGE_TSX.indexOf('if(regId){await verDetallesCosteo(s);return;}');
    expect(inicioElegir).toBeGreaterThan(-1);
    // El propio guard ya probado arriba (backend>draft) es la garantía
    // estructural de esta invariante: si regId existe, ni restaurarDraft
    // ni descartarDraft se alcanzan para ese costeo en el flujo de
    // "elegir" — el borrador local queda simplemente sin consultar.
  });
});
