/**
 * Regla "INFORMES GERENCIALES — TODOS EXCEPTO MERCADEO".
 *
 * `GET /api/informes/procesos-adjudicados` es la ÚNICA descarga del módulo
 * Informes Gerenciales y también la que dispara el botón del Dashboard. La
 * autorización va en el backend (`requireNoMercadeo`, criterio REAL vía
 * importOriginal — nunca una reimplementación del set de roles):
 *   - sin sesión            → 401
 *   - Analista/Asistente Mercadeo → 403
 *   - cualquier otro rol autenticado → pasa el guard (aquí, con `$queryRaw`
 *     mockeado a `[]`, la ruta responde 404 "no hay procesos" — lo relevante
 *     es que NO es 401/403).
 *
 * NO se prueba aquí la generación del XLSX ni la plantilla (sin cambios).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

let sesionActual: { id: number; usuario: string; email: string; rol: string } | null = null;

vi.mock('@/lib/session', () => ({ getSession: async () => sesionActual }));

// La ruta usa $queryRaw (adjudicados + indicadores) y procesoCronogramaSecop.
// Se mockea $queryRaw devolviendo [] → la ruta corta con 404 ANTES de tocar
// la plantilla; eso basta para distinguir "autorizado" (404/200) de 401/403.
const fakePrisma = {
  $queryRaw: async () => [] as unknown[],
  procesoCronogramaSecop: { findMany: async () => [] as unknown[] },
};
vi.mock('@/lib/prisma', () => ({ default: fakePrisma }));

vi.mock('@/lib/informes/plantilla-procesos-adjudicados', () => ({
  generarInformeProcesosAdjudicados: async () => Buffer.from(''),
}));

function req(qs = 'desde=2024-01-01&hasta=2024-12-31') {
  return new NextRequest(`http://localhost/api/informes/procesos-adjudicados?${qs}`, { method: 'GET' });
}

beforeEach(() => { sesionActual = null; });
afterEach(() => { vi.resetModules(); });

describe('GET /api/informes/procesos-adjudicados — requireNoMercadeo', () => {
  it('sin sesión → 401', async () => {
    sesionActual = null;
    const { GET } = await import('./route');
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it.each(['Analista Mercadeo', 'Asistente Mercadeo'])(
    '%s → 403 (no puede descargar el informe de adjudicados)',
    async (rol) => {
      sesionActual = { id: 9, usuario: 'm.gomez', email: 'm.gomez@grupocolba.com', rol };
      const { GET } = await import('./route');
      const res = await GET(req());
      expect(res.status).toBe(403);
    },
  );

  it.each(['Administrador', 'Director Comercial', 'Coordinador Comercial', 'Analista Comercial', 'Gerencia', 'Usuario Final'])(
    '%s (autenticado, no Mercadeo) → pasa el guard (no 401/403)',
    async (rol) => {
      sesionActual = { id: 1, usuario: 'u', email: 'u@grupocolba.com', rol };
      const { GET } = await import('./route');
      const res = await GET(req());
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
      // con $queryRaw → [] la ruta responde 404 "no hay procesos en el rango"
      expect(res.status).toBe(404);
    },
  );

  it('Administrador sin rango de fechas → 400 (validación previa intacta, no 403)', async () => {
    sesionActual = { id: 1, usuario: 'u', email: 'u@grupocolba.com', rol: 'Administrador' };
    const { GET } = await import('./route');
    const res = await GET(req(''));
    expect(res.status).toBe(400);
  });
});
