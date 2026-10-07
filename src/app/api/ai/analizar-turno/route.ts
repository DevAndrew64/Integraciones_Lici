import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSession } from '@/lib/session';
import { requireSession, resolveSessionUserId } from '@/lib/authz';
import { auditFromRequest } from '@/lib/audit';
import { checkGeminiRateLimitPg, recordGeminiUsagePg } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const client = new Anthropic();

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  const usuarioId = await resolveSessionUserId(session!);
  if (usuarioId === null) return NextResponse.json({ ok: false, error: 'Sesión inválida. Inicie sesión nuevamente.' }, { status: 401 });

  const rlTurno = await checkGeminiRateLimitPg(usuarioId, 'turno');
  if (rlTurno.bloqueado) {
    return NextResponse.json({ ok: false, error: `Límite diario de análisis de turnos alcanzado (${rlTurno.usos}/${rlTurno.limite}). Intente mañana.` }, { status: 429 });
  }

  try {
    const { descripcion } = await req.json();
    if (!descripcion?.trim()) {
      return NextResponse.json({ ok: false, error: 'Descripción requerida' }, { status: 400 });
    }

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `Analiza este requisito operativo de contrato laboral colombiano y extrae las horas de trabajo. Responde SOLO con JSON válido, sin markdown ni texto adicional.

Requisito: "${descripcion}"

Considera:
- La jornada ordinaria máxima es 44h/semana (Ley 2101/2021 en Colombia)
- Los recargos aplican por horas nocturnas (9pm-6am), domingos/festivos y horas extra
- Las horas de domingo/festivo son adicionales a la jornada ordinaria
- Usa valores enteros para las horas mensuales (multiplica semanales × 4.33 si aplica)

JSON a devolver (todos los campos son obligatorios, usa 0 si no aplica):
{
  "horasSemanales": <entero 1-48, horas ordinarias semanales>,
  "hRecNocHabilMes": <horas recargo nocturno días hábiles por mes>,
  "hExtDiurHabilMes": <horas extra diurnas días hábiles por mes>,
  "hExtNocHabilMes": <horas extra nocturnas días hábiles por mes>,
  "hOrdDomDiurnaMes": <horas ordinarias domingo/festivo diurnas por mes>,
  "hOrdDomNocturnaMes": <horas ordinarias domingo/festivo nocturnas por mes>,
  "hExtDomDiurnaMes": <horas extra domingo/festivo diurnas por mes>,
  "hExtDomNocturnaMes": <horas extra domingo/festivo nocturnas por mes>,
  "nota": "<explicación breve en español de cómo interpretó el turno>"
}`,
      }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
    const parsed = JSON.parse(text) as Record<string, unknown>;

    void recordGeminiUsagePg(usuarioId, 'turno');
    void auditFromRequest(req, session!, {
      accion: 'ia_analizar_turno',
      recurso: 'analizar-turno',
      detalle: { descripcionLen: String(descripcion).length },
    });

    return NextResponse.json({ ok: true, ...parsed });
  } catch (e) {
    console.error('[analizar-turno]', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Error al analizar' },
      { status: 500 }
    );
  }
}