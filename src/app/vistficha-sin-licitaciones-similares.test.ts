/**
 * Ajuste "QUITAR 'VER LICITACIONES SIMILARES' DE LA FICHA DE SOLICITUDES"
 * (decisión explícita del usuario) — `VistFicha` es la ficha EXCLUSIVA del
 * módulo Solicitudes (único call site en todo `page.tsx`, vía
 * `ModuloSolicitudesAbiertasBase` — Procesos públicos/privados/Todas las
 * solicitudes/Rechazadas comparten este componente). El botón "Ver
 * licitaciones similares" no tenía `onClick` ni lógica real detrás (era un
 * botón estático, sin endpoint ni búsqueda propia) — se retira solo de
 * `VistFicha`; `VistFichaBusqueda` (Búsqueda de procesos, un componente
 * completamente distinto) conserva el suyo sin cambios.
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

const BLOQUE_VISTFICHA = extraerBloque('function VistFicha(', 'function VistFichaBusqueda(');
const BLOQUE_VISTFICHA_BUSQUEDA = extraerBloque('function VistFichaBusqueda(', 'function DptoMultiSelect(');

describe('1) VistFicha (Solicitudes) — "Ver licitaciones similares" ya no aparece', () => {
  it('el texto del botón no existe dentro de VistFicha', () => {
    expect(BLOQUE_VISTFICHA).not.toContain('Ver licitaciones similares');
  });
  it('VistFicha tiene un único call site en todo page.tsx (ModuloSolicitudesAbiertasBase) — afecta a las 4 variantes de Solicitudes (Públicos/Privados/Todas/Rechazadas)', () => {
    const usos = PAGE_TSX.match(/<VistFicha /g) ?? [];
    expect(usos.length).toBe(1);
  });
});

describe('2) "Ver documento IA" sigue visible en VistFicha', () => {
  it('el botón y su icono siguen presentes, sin cambios', () => {
    expect(BLOQUE_VISTFICHA).toContain('Ver documento IA');
  });
});

describe('3) "Actualizar ficha" sigue visible en VistFicha (gateado por puedeActualizarFicha, sin cambios)', () => {
  it('el botón sigue existiendo tal cual', () => {
    expect(BLOQUE_VISTFICHA).toContain('puedeActualizarFicha&&');
    expect(BLOQUE_VISTFICHA).toContain('Actualizar ficha');
  });
});

describe('4) Otros componentes donde debe conservarse — VistFichaBusqueda no fue tocado', () => {
  it('VistFichaBusqueda conserva su propio botón "Ver licitaciones similares"', () => {
    expect(BLOQUE_VISTFICHA_BUSQUEDA).toContain('Ver licitaciones similares');
  });
});

describe('No se tocó el endpoint/lógica de licitaciones similares ni permisos', () => {
  it('el botón removido no tenía onClick/endpoint propio (era estático) — nada que desconectar', () => {
    // Verificado por inspección: el bloque eliminado no contenía fetch/onClick.
    expect(BLOQUE_VISTFICHA).not.toContain('licitaciones-similares');
  });
});
