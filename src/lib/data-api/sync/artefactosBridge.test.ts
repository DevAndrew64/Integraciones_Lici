/**
 * FASE B.4.1 — guardia estática: NINGÚN artefacto con estructura de mapa de
 * correspondencia de identidad (OLD→NEW / OLD→OPAQUE / OPAQUE→NEW) debe
 * existir dentro del árbol del repositorio compartible.
 *
 * Esos artefactos se generan y se destruyen FUERA de `licycolba-final`
 * durante la ventana de cutover (ver B4_MIGRATION_BRIDGE_PLAN.md). Este test
 * es una defensa por si alguno se copia por error al árbol.
 *
 * Heurística conservadora para evitar falsos positivos: solo se marca un
 * fichero de texto tabular (.tsv/.csv/.txt/.map) cuyas líneas sean
 * mayoritariamente pares `entero <sep> entero` o `entero <sep> uuid` o
 * `uuid <sep> entero`. El código, JSON, YAML, Markdown y fixtures normales
 * no matchean.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join, relative, extname } from 'node:path';

const RAIZ = resolve(__dirname, '../../../..');

const DIRS_IGNORADOS = new Set([
  'node_modules', '.next', '.git', 'out', 'build', 'coverage',
  '.playwright', 'src/generated',
]);
const EXT_CANDIDATAS = new Set(['.tsv', '.csv', '.txt', '.map', '.dat', '']);

const RE_ENTERO = /^\d{1,12}$/;
const RE_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const RE_OPACO = /^[0-9a-fA-F-]{20,}$/; // uuid u otro id opaco largo

function esFilaDeMapa(linea: string): boolean {
  const partes = linea.trim().split(/[\t,;| ]+/).filter(Boolean);
  if (partes.length < 2 || partes.length > 3) return false;
  const [a, b] = partes;
  const aOk = RE_ENTERO.test(a) || RE_UUID.test(a) || RE_OPACO.test(a);
  const bOk = RE_ENTERO.test(b) || RE_UUID.test(b) || RE_OPACO.test(b);
  // al menos uno de los dos debe ser claramente un id (uuid/opaco) para no
  // confundir con CSV numéricos de negocio
  const hayId = RE_UUID.test(a) || RE_OPACO.test(a) || RE_UUID.test(b) || RE_OPACO.test(b) ||
    (RE_ENTERO.test(a) && RE_ENTERO.test(b)); // int→int también cuenta (old→new)
  return aOk && bOk && hayId;
}

function pareceArtefactoDeMapa(contenido: string): boolean {
  const lineas = contenido.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const utiles = lineas.filter((l) => !l.startsWith('#') && !l.startsWith('//'));
  if (utiles.length < 8) return false;
  const filasMapa = utiles.filter(esFilaDeMapa).length;
  return filasMapa / utiles.length >= 0.9;
}

function* recorrer(dir: string): Generator<string> {
  for (const entrada of readdirSync(dir)) {
    const abs = join(dir, entrada);
    const rel = relative(RAIZ, abs).replace(/\\/g, '/');
    if (DIRS_IGNORADOS.has(entrada) || DIRS_IGNORADOS.has(rel)) continue;
    let st;
    try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) { yield* recorrer(abs); continue; }
    if (st.size > 5_000_000) continue;
    if (EXT_CANDIDATAS.has(extname(entrada).toLowerCase())) yield abs;
  }
}

describe('B.4.1 — ningún artefacto de mapeo OLD→NEW dentro del árbol', () => {
  it('recorre el repo y no encuentra ficheros con estructura de mapa de identidad', () => {
    const sospechosos: string[] = [];
    for (const abs of recorrer(RAIZ)) {
      let contenido: string;
      try { contenido = readFileSync(abs, 'utf8'); } catch { continue; }
      if (pareceArtefactoDeMapa(contenido)) {
        sospechosos.push(relative(RAIZ, abs).replace(/\\/g, '/'));
      }
    }
    expect(
      sospechosos,
      `posibles artefactos de correspondencia de identidad en el árbol (deben vivir FUERA del repo): ${sospechosos.join(', ')}`,
    ).toEqual([]);
  });
});
