/**
 * Ajuste "TRM — NO VISIBLE NI ACCESIBLE PARA MERCADEO" (Parte A — backend)
 * — `GET /api/trm/proyeccion-decimal` ahora exige `requireNoMercadeo`
 * (`@/lib/authz`) en vez de `requireSession`: 401 sin sesión (sin
 * cambios), 403 para Mercadeo (nuevo), comportamiento actual sin cambios
 * para cualquier otro rol autenticado.
 *
 * Las peticiones de este archivo se hacen SIN `fecha`/`fechaCierre` a
 * propósito — la ruta responde 400 antes de tocar ninguna lógica de
 * cálculo/histórico (rama ya existente, sin cambios), lo que permite
 * probar SOLO el guard de autorización sin mockear todo el motor TRM
 * (`@/lib/trm`, `trmCache`, `trmStore`, `trmJobs`). El punto a verificar es
 * que la respuesta para roles autorizados NUNCA sea 401/403 — el 400 es el
 * mismo comportamiento de siempre para una petición sin fecha.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

let sesionActual: { id: number; email: string; rol: string; usuario: string } | null;

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/session', () => ({ getSession: async () => sesionActual }));

function req() {
  return new NextRequest('http://localhost/api/trm/proyeccion-decimal');
}

describe('GET /api/trm/proyeccion-decimal — autorización (Parte A: TRM bloqueado para Mercadeo)', () => {
  it('2) Mercadeo → 403 (antes incluso de validar fecha/fechaCierre)', async () => {
    sesionActual = { id: 201, email: 'ana.rios@grupocolba.com', rol: 'Analista Mercadeo', usuario: 'ana.rios' };
    const { GET } = await import('./route');
    const res = await GET(req());
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  it('3) Administrador → comportamiento actual (pasa el guard, cae al 400 de "falta fecha", nunca 401/403)', async () => {
    sesionActual = { id: 1, email: 'admin.qa@grupocolba.com', rol: 'Administrador', usuario: 'admin.qa' };
    const { GET } = await import('./route');
    const res = await GET(req());
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('fecha');
  });

  it('4) Comercial (Analista Comercial) → comportamiento actual (mismo 400, nunca 401/403)', async () => {
    sesionActual = { id: 101, email: 'oscar.pallares@grupocolba.com', rol: 'Analista Comercial', usuario: 'oscar.pallares' };
    const { GET } = await import('./route');
    const res = await GET(req());
    expect(res.status).toBe(400);
  });

  it('5) Sin sesión → 401', async () => {
    sesionActual = null;
    const { GET } = await import('./route');
    const res = await GET(req());
    expect(res.status).toBe(401);
  });
});
