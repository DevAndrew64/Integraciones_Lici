import prisma from '@/lib/prisma';

// Precios USD por 1M tokens (entrada / salida) — julio 2026
const PRECIOS: Record<string, { in: number; out: number }> = {
  'gemini-2.5-pro':         { in: 1.25,  out: 10.00 },
  'gemini-3.5-flash':       { in: 0.15,  out: 0.60 },
  'gemini-3.1-flash-lite':  { in: 0.075, out: 0.30 },
  'gemini-2.5-flash':       { in: 0.15,  out: 0.60 },
  'gemini-2.5-flash-lite':  { in: 0.075, out: 0.30 },
  'claude-haiku-4-5':       { in: 1.00,  out: 5.00 },
};

function calcularCosto(modelo: string, tokensIn: number, tokensOut: number): number {
  // Coincidencia por prefijo para IDs con fecha (ej. claude-haiku-4-5-20251001)
  const clave = PRECIOS[modelo] ? modelo : Object.keys(PRECIOS).find(k => modelo.startsWith(k));
  const precio = clave ? PRECIOS[clave] : { in: 0.15, out: 0.60 };
  return (tokensIn / 1_000_000) * precio.in + (tokensOut / 1_000_000) * precio.out;
}

export async function registrarUso(params: {
  modelo: string;
  endpoint: string;
  tokensIn?: number;
  tokensOut?: number;
  perfil?: string;
  usuario?: string;
  usuarioId?: number | null;
}): Promise<void> {
  const { modelo, endpoint, tokensIn = 0, tokensOut = 0, perfil, usuario, usuarioId } = params;
  const costUsd = calcularCosto(modelo, tokensIn, tokensOut);
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "GeminiUsage" (modelo, endpoint, "tokensIn", "tokensOut", "costUsd", perfil, usuario, "usuarioId", "creadoEn")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      modelo, endpoint, tokensIn, tokensOut, costUsd, perfil ?? null, usuario ?? null, usuarioId ?? null,
    );
  } catch (e) {
    console.error('[GeminiUsage] Error al registrar:', e instanceof Error ? e.message.slice(0, 100) : 'error');
  }
}