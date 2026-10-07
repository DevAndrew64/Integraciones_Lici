import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireSession, hasPermiso } from '@/lib/authz';
import {
  CATALOGO_PROVISIONAL_ASEOCOLBA, FUENTE_TARIFARIO_PROVISIONAL, VIGENTE_HASTA_TARIFARIO_PROVISIONAL,
} from '@/lib/costos-estructura/tarifario-especiales-aseocolba';

/**
 * Ajuste "SERVICIOS NO CONTINUOS — FASE 2 MVP: TARIFARIO ASEOCOLBA" — sirve
 * el catálogo de tarifas EXCLUSIVO de Servicios no continuos ASEOCOLBA.
 * Mismo patrón que `/api/servicios-no-continuos-ext` (sesión + permiso
 * `ver_estructura_costos`), pero esta ruta NO llama a ningún servicio
 * externo — hoy re-sirve el proveedor provisional estático
 * (`CATALOGO_PROVISIONAL_ASEOCOLBA`, ver `tarifario-especiales-aseocolba.ts`).
 *
 * RUTA DE REEMPLAZO FUTURO: cuando exista una fuente oficial de valores
 * económicos (evolución de `/no_continuos` u otra API), solo cambia el
 * INTERIOR de este handler (de dónde saca `tarifas`) — el contrato de
 * respuesta `{ok, fuente, vigenteHasta, tarifas}` y el consumidor en
 * page.tsx no necesitan cambiar.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  if (!(await hasPermiso(session!, 'ver_estructura_costos'))) {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 403 });
  }

  return NextResponse.json({
    ok: true,
    fuente: FUENTE_TARIFARIO_PROVISIONAL,
    vigenteHasta: VIGENTE_HASTA_TARIFARIO_PROVISIONAL,
    tarifas: CATALOGO_PROVISIONAL_ASEOCOLBA,
  });
}
