import { NextResponse } from 'next/server';

/**
 * Endpoint deshabilitado por política de seguridad.
 * Permitía cambiar contraseñas sin autenticación (hallazgo crítico C-1).
 * Para restablecimiento legítimo, usar el flujo de administrador en el panel.
 */
export async function POST() {
  return NextResponse.json(
    { ok: false, error: 'Endpoint deshabilitado por seguridad.' },
    { status: 403 }
  );
}