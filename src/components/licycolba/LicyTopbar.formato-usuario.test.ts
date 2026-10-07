/**
 * Ajuste "FORMATO VISIBLE DE USERNAMES" — el perfil de sesión en la
 * esquina superior derecha (`LicyTopbar`) mostraba "Andrea.Calderin"
 * (formato local propio, con punto) — ahora reutiliza EXACTAMENTE el
 * mismo helper central `formatearUsuarioVisible` que ya usa `page.tsx`,
 * mostrando "Andrea Calderin". El valor interno de sesión (`sess.usuario`)
 * no se toca — solo el texto renderizado.
 *
 * Mismo patrón de texto fuente que el resto de *-page.test.ts (sin harness
 * de render de componentes en este repo).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'LicyTopbar.tsx'), 'utf-8');

describe('LicyTopbar — perfil de sesión usa el helper central', () => {
  it('importa formatearUsuarioVisible desde la fuente única (@/lib/formato-usuario)', () => {
    expect(SRC).toContain("import { formatearUsuarioVisible } from '@/lib/formato-usuario';");
  });
  it('ya no existe la función local formatearNombreUsuario (duplicaba la lógica)', () => {
    expect(SRC).not.toContain('function formatearNombreUsuario(');
  });
  it('nombreUsuario se calcula con el helper central sobre nombreUsuarioRaw (userName ?? sess.usuario ?? sess.email)', () => {
    expect(SRC).toContain('const nombreUsuarioRaw = userName ?? sess?.usuario ?? sess?.email ?? \'Usuario\';');
    expect(SRC).toContain('formatearUsuarioVisible(nombreUsuarioRawStr)');
  });
  it('un email de fallback (sin sess.usuario) NO se transforma con el helper — evita mangling del dominio', () => {
    const idx = SRC.indexOf('const nombreUsuario = nombreUsuarioRawStr.includes');
    expect(idx).toBeGreaterThan(-1);
    const tramo = SRC.slice(idx, idx + 200);
    expect(tramo).toContain('? nombreUsuarioRawStr');
  });
  it('el valor interno de sesión (sess?.usuario) nunca se reasigna — solo se lee para derivar el texto visible', () => {
    expect(SRC).toContain('const sess            = sesion ?? usuario ?? user;');
  });
  it('buildInitials (avatar) no fue tocado — sigue siendo un helper independiente', () => {
    expect(SRC).toContain('function buildInitials(value: string) {');
  });
});
