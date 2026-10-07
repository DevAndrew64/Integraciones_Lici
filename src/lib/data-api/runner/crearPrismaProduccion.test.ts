/**
 * FASE B.4.5 — `crearPrismaProduccion` usa UN solo schema productivo
 * (`@prisma/client`), pool propio ligado a `DATA_API_RUNTIME_DATABASE_URL`,
 * y NUNCA el singleton `@/lib/prisma`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(__dirname, 'crearPrismaProduccion.ts'), 'utf8');

describe('crearPrismaProduccion — schema productivo único', () => {
  it("importa `@prisma/client` (NO el cliente `generated/prisma-candidata`)", () => {
    expect(/from '@prisma\/client'/.test(src)).toBe(true);
    expect(/generated\/prisma-candidata/.test(src)).toBe(false);
  });

  it('NUNCA hace `import ... from "@/lib/prisma"` (el singleton de la app)', () => {
    expect(/\bimport\b[^;]*from\s+['"]@\/lib\/prisma['"]/.test(src)).toBe(false);
    expect(/\brequire\(\s*['"]@\/lib\/prisma['"]\s*\)/.test(src)).toBe(false);
  });

  it('lee exclusivamente `DATA_API_RUNTIME_DATABASE_URL` (nunca `process.env.DATABASE_URL`)', () => {
    expect(/DATA_API_RUNTIME_DATABASE_URL/.test(src)).toBe(true);
    expect(/process\.env\.DATABASE_URL/.test(src)).toBe(false);
  });

  it('lanza si falta la URL (no abre pool con undefined)', async () => {
    const { crearPrismaProduccion } = await import('./crearPrismaProduccion.js');
    expect(() => crearPrismaProduccion(undefined)).toThrow(/DATA_API_RUNTIME_DATABASE_URL/);
  });

  it('expone `pool` para el advisory lock y `cerrar` para liberar', async () => {
    const { crearPrismaProduccion } = await import('./crearPrismaProduccion.js');
    // URL sintáctica válida: no conecta hasta la primera query.
    const d = crearPrismaProduccion('postgresql://u:p@127.0.0.1:1/none');
    expect(typeof d.pool.connect).toBe('function');
    expect(typeof d.cerrar).toBe('function');
    await d.cerrar().catch(() => {});
  });
});

describe('resolverDestinoRuntime — el guardrail es obligatorio y va primero', () => {
  it('el módulo usa el aplicador REAL (`prismaAplicadorReal`), no el de la candidata', () => {
    const s = readFileSync(resolve(__dirname, 'resolverDestinoRuntime.ts'), 'utf8');
    expect(/prismaAplicadorReal/.test(s)).toBe(true);
    expect(/prismaAplicadorCandidataB44/.test(s)).toBe(false);
    expect(/verificarDestinoProduccion/.test(s)).toBe(true);
  });
});
