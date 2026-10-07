/**
 * Ajuste "EVIDENCIA SIN FILA RESUELTA" — un Administrador (o Director/
 * Coordinador Comercial) que NO es responsable de un proceso con 2+
 * responsables abre `GestionAsignacionInline` sin fila de asignación:
 * `asignacion` llega vacío. Antes, `puedeActuar` (verdadero por su rol)
 * mostraba igual el adjuntar; `guardarSilencioso` no encontraba la fila por
 * `idAsignacion` (vacío) y agregaba al arreglo una fila fantasma sin
 * `idAsignacion` ni `analistaAsignado`, que el servidor rechazaba con 400
 * ("Las transiciones de estado deben realizarse mediante el endpoint
 * dedicado..."). Además la evidencia ya se había agregado a la lista local,
 * así que la pantalla decía "1 evidencia cargada" sin que existiera nada
 * guardado, y "Responsable" mostraba "--" mientras "Responsables asignados"
 * decía 2.
 *
 * Este archivo verifica el cableado fuente (mismo patrón que el resto de
 * *-page.test.ts, sin harness de render en este repo). Solo usa subcadenas de
 * una sola línea: page.tsx está en CRLF en el disco de Windows.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, 'page.tsx'), 'utf-8');

describe('la fila resuelta se decide por idAsignacion, no por puedeActuar', () => {
  it('tieneFilaResuelta sale del idAsignacion de la fila del panel', () => {
    expect(PAGE_TSX).toContain("const tieneFilaResuelta = safeString(getRecordValue(asigActual, 'idAsignacion'), '').trim() !== '';");
  });

  it('adjuntar, eliminar y presentar exigen puedeActuar + permiteCargarEvidencias + tieneFilaResuelta', () => {
    const conFila = PAGE_TSX.split('puedeActuar && permiteCargarEvidencias(estadoRevision) && tieneFilaResuelta').length - 1;
    // dropzone de carga + botón Eliminar + panel "Presentar proceso"
    expect(conFila).toBe(3);
  });

  it('sin fila resuelta se muestra un aviso en lugar del adjuntar', () => {
    expect(PAGE_TSX).toContain('puedeActuar && permiteCargarEvidencias(estadoRevision) && !tieneFilaResuelta');
    expect(PAGE_TSX).toContain('Tu usuario no es uno de los responsables de este proceso');
  });
});

describe('guardarSilencioso nunca inventa una fila y informa si guardó', () => {
  it('devuelve Promise<boolean>', () => {
    expect(PAGE_TSX).toContain("const guardarSilencioso = async (nuevoEstadoRevision: string, extraAsig?: Partial<Record<string, unknown>>): Promise<boolean> => {");
  });

  it('corta antes de armar el PATCH cuando no hay idAsignacion', () => {
    expect(PAGE_TSX).toContain('if (!idAsignacionActual.trim()) {');
    expect(PAGE_TSX).toContain('No hay una asignación sobre la cual guardar este cambio.');
  });

  it('devuelve false en los tres caminos de fallo del PATCH y true en el éxito', () => {
    expect(PAGE_TSX).toContain("if (!res.ok || !data.ok) { setError(data.error ?? 'Error al guardar.'); return false; }");
    expect(PAGE_TSX).toContain("} catch { setError('No se pudo conectar.'); return false; }");
    expect(PAGE_TSX).toContain("if (!res.ok || !data.ok) { setError(data.error ?? 'Error al cerrar.'); return false; }");
  });
});

describe('la lista local no muestra como cargado lo que no se guardó', () => {
  it('al adjuntar, si el guardado falla se quita el archivo de la lista', () => {
    expect(PAGE_TSX).toContain("const guardado = await guardarSilencioso('EN_ELABORACION', { evidencias: nuevasEvidencias });");
    expect(PAGE_TSX).toContain('if (!guardado) setEvidencias((prev) => prev.filter((ev) => ev !== nueva));');
  });

  it('al eliminar, si el guardado falla se restaura la evidencia', () => {
    expect(PAGE_TSX).toContain('if (!guardado) setEvidencias(evidencias);');
  });
});

describe('"Responsable" muestra a los responsables cuando el panel no tiene fila', () => {
  it('toma los nombres de los responsables activos (fuente única obtenerResponsablesActivos)', () => {
    expect(PAGE_TSX).toContain('const nombresResponsablesActivos = obtenerResponsablesActivos(safeArray<Record<string, unknown>>(sol.asignaciones))');
  });

  it('con fila propia se conserva el valor de siempre; sin ella se listan todos y solo si no hay ninguno se muestra "--"', () => {
    expect(PAGE_TSX).toContain("{ label: 'Responsable', value: responsableAsignado || (nombresResponsablesActivos.length > 0 ? nombresResponsablesActivos.join('\\n') : '--') },");
  });
});
