/**
 * FASE 5 (diagnóstico Aseocolba) — corrección de la sustitución visual del
 * horario configurado por los bloques derivados del descanso. Causa raíz:
 * `actualizarBloquesEditorHorario` (page.tsx) comparaba `descanso!==
 * descansoValido` para decidir si llamar `setDescansoAplicado` — cuando
 * `bloques.length===1`, `descansoValido` es LITERALMENTE la misma
 * referencia que `descanso`, así que esa condición nunca era verdadera al
 * aplicar un descanso por primera vez. Efecto en cascada: `descansoAplicado`
 * quedaba en null, la detección de `modoCapturaHorario` al confirmar
 * siempre resolvía BLOQUES_INDEPENDIENTES (nunca RANGO_CON_DESCANSO), y al
 * reabrir para editar se cargaban los bloques derivados del descanso como
 * si el usuario los hubiera creado manualmente.
 *
 * Verificación por texto fuente (mismo patrón que el resto de
 * `*-page.test.ts` del proyecto — no hay jsdom/RTL para montar
 * ModuloEstructuraCostos).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');

function bloqueFuncion(nombreMarcador: string): string {
  const inicio = PAGE_TSX.indexOf(nombreMarcador);
  if (inicio === -1) throw new Error(`No se encontró "${nombreMarcador}" — page.tsx pudo cambiar de forma.`);
  // Busca el cierre de la función acotando por el siguiente "\n  function " o límite razonable.
  const fin = PAGE_TSX.indexOf('\n  function ', inicio + nombreMarcador.length);
  return PAGE_TSX.slice(inicio, fin === -1 ? inicio + 1500 : fin);
}

describe('FASE 5 — actualizarBloquesEditorHorario: descansoAplicado se actualiza siempre (bug de referencia corregido)', () => {
  it('[VERDE tras Fase 5] ya NO existe la condición rota "if(descanso!==descansoValido)setDescansoAplicado(...)"', () => {
    expect(PAGE_TSX).not.toContain('if(descanso!==descansoValido)setDescansoAplicado(descansoValido);');
  });

  it('[VERDE tras Fase 5] setDescansoAplicado(descansoValido) se llama de forma incondicional dentro de actualizarBloquesEditorHorario', () => {
    const cuerpo = bloqueFuncion('function actualizarBloquesEditorHorario(');
    expect(cuerpo).toContain('setDescansoAplicado(descansoValido);');
    // No debe quedar ningún "if(" inmediatamente antes de esa línea que
    // condicione la llamada — verificación simple: la línea anterior no
    // termina en un bloque if de una sola línea sobre esta misma llamada.
    const idx = cuerpo.indexOf('setDescansoAplicado(descansoValido);');
    const lineaCompleta = cuerpo.slice(Math.max(0, idx - 80), idx);
    expect(lineaCompleta).not.toMatch(/if\([^)]*\)\s*$/);
  });
});

describe('FASE 5 — bloquesConDescansoAplicado delega en el módulo compartido tiempo-absoluto.ts (regresión, no reimplementa la aritmética inline)', () => {
  it('usa resolverOffsetsBloque/rangoAbsolutoBloque/aplicarDescansoRangoAbsoluto/bloqueDesdeRangoAbsoluto, no una resta ingenua de HH:mm', () => {
    const cuerpo = bloqueFuncion('function bloquesConDescansoAplicado(');
    expect(cuerpo).toContain('resolverOffsetsBloque(');
    expect(cuerpo).toContain('rangoAbsolutoBloque(');
    expect(cuerpo).toContain('aplicarDescansoRangoAbsoluto(');
    expect(cuerpo).toContain('bloqueDesdeRangoAbsoluto(');
    // La fórmula histórica rota (resta directa de horas*60+minutos sin
    // offsets) no debe reaparecer en esta función.
    expect(cuerpo).not.toContain('(hf*60+mf)-(hi*60+mi)');
  });
});

describe('FASE 5 — modoCapturaHorario se detecta a partir de bloquesEditorHorario/descansoAplicado, nunca de nuevoHorario.horario (los bloques derivados del descanso)', () => {
  it('la detección de RANGO_CON_DESCANSO al confirmar sigue basada en bloquesEditorHorario.length===1 && descansoAplicado', () => {
    const idx = PAGE_TSX.indexOf("const modoCapturaFinal:'RANGO_CON_DESCANSO'|'BLOQUES_INDEPENDIENTES'=");
    expect(idx).toBeGreaterThan(-1);
    const ventana = PAGE_TSX.slice(idx, idx + 300);
    expect(ventana).toContain('bloquesEditorHorario.length===1&&descansoAplicado');
  });
});

describe('FASE 5 (cierre) — etiqueta del resumen distingue "Descanso no trabajado" (RANGO_CON_DESCANSO) de "Intervalo no trabajado" (bloques manuales independientes)', () => {
  it('la etiqueta se decide por descansoAplicado (nunca una etiqueta fija) y usa el mismo dato descansoTexto', () => {
    expect(PAGE_TSX).toContain("{descansoAplicado?'Descanso no trabajado: ':'Intervalo no trabajado: '}");
    expect(PAGE_TSX).not.toContain("Descanso no trabajado: </span>{resumenNuevoHorario.resumen.descansoTexto}");
  });
});

describe('FASE 5 (cierre) — checkbox manual "Día siguiente" ELIMINADO del editor de bloques', () => {
  it('no existe ningún checkbox ni campo diaSiguiente en el editor (la inferencia es automática, ver parser-horario.ts)', () => {
    expect(PAGE_TSX).not.toContain('Día siguiente');
    expect(PAGE_TSX).not.toContain('diaSiguiente');
  });
});

describe('FASE 5 (cierre) — advertencia de continuación al día siguiente: rojo corporativo, NO bloqueante', () => {
  it('el recuadro de advertencia usa el rojo corporativo (RED) en tono suave, nunca el ámbar histórico', () => {
    const idx = PAGE_TSX.indexOf('resumenNuevoHorario.advertencias&&resumenNuevoHorario.advertencias.length>0');
    expect(idx).toBeGreaterThan(-1);
    const ventana = PAGE_TSX.slice(idx, idx + 1400);
    expect(ventana).toContain("background:'#fef2f2',border:'1px solid '+RED");
    expect(ventana).toContain('color:RED');
    expect(ventana).not.toContain('#fffbeb');
    expect(ventana).not.toContain('#fde68a');
    expect(ventana).not.toContain('#92400e');
  });

  it('el botón de guardar/actualizar se deshabilita SOLO por !resumenNuevoHorario.ok — una advertencia (rama ok:true) nunca lo deshabilita', () => {
    expect(PAGE_TSX).toContain('disabled={cargandoHorarios||!resumenNuevoHorario.ok}');
  });
});

describe('FASE 5 (cierre) — texto del botón de guardado del modal de horarios', () => {
  it('editando un horario existente: "Actualizar horario"; creando uno nuevo: "Agregar horario" (ya no "...distribución" en ninguno de los dos casos)', () => {
    expect(PAGE_TSX).toContain("modoEditorDistribucion==='EDITANDO'?'Actualizar horario':'Agregar horario'");
    expect(PAGE_TSX).not.toContain("'Actualizar distribución'");
    expect(PAGE_TSX).not.toContain("'Agregar distribución'");
  });
});
