// Validación mínima del motivo obligatorio para eliminación/restauración de
// Solicitudes (Lote S1) — texto no vacío, normalizado (espacios colapsados,
// sin espacios al borde) y con longitud razonable. Se guarda únicamente en
// AuditLog.detalle — no se agrega columna nueva a Solicitud/DeletedSolicitud.

const LONGITUD_MINIMA = 5;
const LONGITUD_MAXIMA = 500;

export type ResultadoValidarMotivo =
  | { ok: true; valor: string }
  | { ok: false; error: string };

export function validarMotivo(raw: unknown): ResultadoValidarMotivo {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'motivo es requerido y debe ser texto.' };
  }
  const normalizado = raw.trim().replace(/\s+/g, ' ');
  if (normalizado.length < LONGITUD_MINIMA) {
    return { ok: false, error: `motivo debe tener al menos ${LONGITUD_MINIMA} caracteres.` };
  }
  if (normalizado.length > LONGITUD_MAXIMA) {
    return { ok: false, error: `motivo no puede exceder ${LONGITUD_MAXIMA} caracteres.` };
  }
  return { ok: true, valor: normalizado };
}
