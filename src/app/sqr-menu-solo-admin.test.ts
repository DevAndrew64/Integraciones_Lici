/**
 * Ajuste "SQR SOLO ADMINISTRADOR" (petición directa) — el enlace lateral
 * "SQR" dejó de reutilizar `verAsignaciones` (visible para Comercial y,
 * desde el ajuste de permisos de cierre, también implícitamente accesible
 * a Mercadeo por compartir ese mismo permiso) y pasa a `rol==='Administrador'`,
 * el mismo criterio exacto que ya usa el enlace "Lectura de procesos" para
 * un caso idéntico (módulo exclusivo de Administrador). Mismo patrón de
 * texto fuente que el resto de *-page.test.ts (sin harness de render de
 * componentes en este repo).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, 'page.tsx'), 'utf-8');

describe('Enlace lateral "SQR" — exclusivo de Administrador', () => {
  it('el enlace "SQR" está condicionado a rol===\'Administrador\', no a verAsignaciones', () => {
    const idx = PAGE_TSX.indexOf("<span className=\"nav-item-text\">SQR</span>");
    expect(idx).toBeGreaterThan(-1);
    const antes = PAGE_TSX.slice(Math.max(0, idx - 400), idx);
    expect(antes).toContain("{rol==='Administrador'&&");
    expect(antes).not.toContain('{verAsignaciones&&');
  });

  it('usa EXACTAMENTE el mismo criterio que "Lectura de procesos" (rol===\'Administrador\'), sin introducir un nuevo mecanismo de permisos', () => {
    const idxLecturaCond = PAGE_TSX.indexOf("rol==='Administrador'&&\n            <div className={ni('lecturaProcesosBD')}");
    const idxSqr = PAGE_TSX.indexOf('<span className="nav-item-text">SQR</span>');
    expect(idxLecturaCond).toBeGreaterThan(-1);
    expect(idxSqr).toBeGreaterThan(idxLecturaCond);
  });
});
