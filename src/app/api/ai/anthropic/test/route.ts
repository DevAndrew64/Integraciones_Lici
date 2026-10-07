import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireSession, resolveSessionUserId } from '@/lib/authz';
import { checkGeminiRateLimitPg, recordGeminiUsagePg } from '@/lib/rate-limit';
import { analisisGeneralClaude } from '@/lib/ai/analisisGeneralClaude';
import { registrarUsoIA } from '@/lib/ai/aiUsage';
import { endpointPruebaHabilitado } from '@/lib/ai/testEndpoint';

export const dynamic = 'force-dynamic';

/** Longitud máxima del texto de prueba (independiente del límite global). */
const MAX_TEXT_CHARS = 4000;

/**
 * POST /api/ai/anthropic/test — endpoint interno de desarrollo.
 *
 * Prueba el proveedor Anthropic (Claude Haiku) con el caso de uso aislado
 * analisis_general_claude. Reglas:
 *   - usa exclusivamente Anthropic (sin selector);
 *   - deshabilitado en producción salvo ANTHROPIC_TEST_ENDPOINT_ENABLED=1;
 *   - requiere sesión + rate limit diario por usuario;
 *   - NO acepta system prompts arbitrarios (solo { text });
 *   - nunca expone la clave ni la respuesta cruda del SDK.
 */
export async function POST(req: NextRequest) {
  if (!endpointPruebaHabilitado()) {
    return NextResponse.json({ ok: false, error: 'No disponible' }, { status: 404 });
  }

  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  const usuarioId = await resolveSessionUserId(session!);
  if (usuarioId === null) {
    return NextResponse.json({ ok: false, error: 'Sesión inválida' }, { status: 401 });
  }

  const rl = await checkGeminiRateLimitPg(usuarioId, 'anthropic_test');
  if (rl.bloqueado) {
    return NextResponse.json(
      { ok: false, error: `Límite diario alcanzado (${rl.usos}/${rl.limite})` },
      { status: 429 },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) {
      return NextResponse.json({ ok: false, error: 'Se requiere { "text": "..." }' }, { status: 400 });
    }
    if (text.length > MAX_TEXT_CHARS) {
      return NextResponse.json(
        { ok: false, error: `Texto demasiado largo (máx. ${MAX_TEXT_CHARS} caracteres)` },
        { status: 400 },
      );
    }

    const inicio = Date.now();
    const resultado = await analisisGeneralClaude({ contenido: text, usuarioId });

    void recordGeminiUsagePg(usuarioId, 'anthropic_test');
    void registrarUsoIA({
      respuesta: {
        success: true,
        provider: 'anthropic',
        model: resultado.model,
        text: '',
        usage: resultado.usage,
      },
      modulo: 'anthropic_test',
      duracionMs: Date.now() - inicio,
      usuarioId,
    });

    return NextResponse.json({ ok: true, ...resultado });
  } catch (e) {
    // Mensaje controlado: nunca la respuesta cruda del SDK ni la clave
    const msg = e instanceof Error ? e.message : 'Error en análisis';
    console.error('[POST /api/ai/anthropic/test]', msg.slice(0, 200));
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
