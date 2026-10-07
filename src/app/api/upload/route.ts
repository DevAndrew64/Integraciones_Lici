import { NextRequest, NextResponse } from 'next/server';
import { UTApi } from 'uploadthing/server';
import { getSession } from '@/lib/session';

const utapi = new UTApi();

/**
 * Ajuste "NO EXPONER ERRORES INTERNOS DE UPLOADTHING AL USUARIO" — el SDK
 * de UploadThing (`response.error.message`, o una excepción de
 * `uploadFiles()`) puede describir el FORMATO INTERNO esperado del token de
 * configuración del servidor (p.ej. "Invalid token. A token is a base64
 * encoded JSON object matching {...}") o cualquier otro detalle de
 * diagnóstico — nunca es información útil para quien está subiendo un
 * archivo, y nunca debe llegar al cliente. El detalle real se registra
 * SIEMPRE con `console.error` (solo servidor); el cliente recibe
 * ÚNICAMENTE este mensaje genérico, sin importar la causa exacta del fallo.
 */
const MENSAJE_ERROR_PUBLICO_UPLOAD = 'No fue posible cargar el archivo en este momento. Intenta nuevamente o contacta al administrador.';

export async function POST(req: NextRequest) {
  // Requiere sesión activa — endpoint era público (hallazgo alto A-4)
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 });
  }

  let file: File | null = null;
  try {
    const formData = await req.formData();
    file = (formData.get('file') as File | null) ?? null;
  } catch (e) {
    console.error('[POST /api/upload] No fue posible leer el formulario recibido', e);
    return NextResponse.json({ ok: false, error: MENSAJE_ERROR_PUBLICO_UPLOAD }, { status: 500 });
  }
  if (!file) return NextResponse.json({ ok: false, error: 'No file' }, { status: 400 });

  try {
    const response = await utapi.uploadFiles(file);
    if (response.error) {
      // `response.error` es el canal de fallo NORMAL de `uploadFiles()`
      // (token ausente/inválido, config de servidor incompleta, rechazo de
      // la API de UploadThing, etc.) — 503: la subida depende de un
      // servicio externo que no respondió como se esperaba, nunca un error
      // de la solicitud del usuario.
      console.error('[POST /api/upload] Error de UploadThing al subir archivo', response.error);
      return NextResponse.json({ ok: false, error: MENSAJE_ERROR_PUBLICO_UPLOAD }, { status: 503 });
    }
    return NextResponse.json({ ok: true, url: response.data.ufsUrl, key: response.data.key, name: response.data.name });
  } catch (e) {
    // Cualquier excepción CRUDA del SDK (nunca capturada como
    // `response.error`) o de red — mismo criterio: nunca se reenvía
    // `String(e)`/`e.message` al cliente.
    console.error('[POST /api/upload] Excepción inesperada al subir archivo', e);
    return NextResponse.json({ ok: false, error: MENSAJE_ERROR_PUBLICO_UPLOAD }, { status: 500 });
  }
}