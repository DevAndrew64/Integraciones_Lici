import { NextResponse } from 'next/server';
import { dataApiRuntimeEnabled } from '@/lib/data-api/runtimeFlag';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * B.4.5 — capability booleana SEGURA para el frontend. Solo expone un `boolean`
 * derivado de `dataApiRuntimeEnabled()` — NUNCA el valor crudo de la env ni
 * ningún otro secreto/DSN. El UI la usa para ocultar operaciones ya retiradas
 * con el cutover activo (p. ej. el panel admin "Resolver Links").
 */
export function GET() {
  return NextResponse.json({ dataApiCutover: dataApiRuntimeEnabled() });
}
