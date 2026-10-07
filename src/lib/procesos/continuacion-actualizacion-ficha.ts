/**
 * Estado de "continuación" del lado del cliente para el submodo
 * `completar_datos` del actualizador puntual — usado idénticamente por los
 * tres componentes de ficha con botón "Actualizar ficha" (VistFicha,
 * VistFichaAsignacion, VistFichaBusqueda) para no repetir la lógica tres
 * veces ni arriesgar que un componente omita el detalle y otro no.
 *
 * El backend es la única autoridad: el token viaja opaco (nunca se decodifica
 * aquí) y siempre se revalida en servidor (`validarContinuacionActualizacion`).
 * Este módulo solo decide, del lado del cliente, CUÁNDO vale la pena mandar
 * el token en el siguiente clic — un filtro de conveniencia, no de seguridad.
 * Se guarda únicamente en estado React de cada componente (nunca localStorage
 * ni sessionStorage) — se pierde al recargar la página o desmontar la ficha.
 */

export interface ContinuacionFicha {
  procesoId: number | null;
  externalId: string | null;
  token: string;
  expiraEnMs: number;
}

export interface RespuestaConContinuacion {
  estado?: string;
  puedeCompletarDatos?: boolean;
  continuacionActualizacion?: string | null;
  continuacionExpiraEn?: string | null;
  procesoId?: number | null;
  externalId?: string | null;
}

/**
 * Deriva el próximo estado de continuación a partir de CUALQUIER respuesta
 * del endpoint puntual (haya sido con o sin `modo:'completar_datos'`).
 *
 * Regla, en orden:
 *   1. `estado` completa/sin_cambios → sin continuación (ya no hace falta).
 *   2. El backend ofrece explícitamente `puedeCompletarDatos===true` con un
 *      `continuacionActualizacion` no vacío y una `continuacionExpiraEn`
 *      parseable → se guarda esa continuación.
 *   3. Cualquier otro caso (incluido un resultado parcial SIN esos dos campos,
 *      un error de identidad, NC/manual, o un token que el backend rechazó
 *      silenciosamente al caer al flujo normal) → sin continuación.
 *
 * Nunca se deduce `puedeCompletarDatos` de `estado==='parcial'` + `linkDetalle`
 * presente — eso es exactamente lo que el pedido prohíbe: la decisión es
 * siempre explícita del backend.
 */
export function siguienteContinuacionFicha(data: RespuestaConContinuacion): ContinuacionFicha | null {
  if (data.estado === 'completa' || data.estado === 'sin_cambios') return null;

  if (
    data.puedeCompletarDatos === true &&
    typeof data.continuacionActualizacion === 'string' &&
    data.continuacionActualizacion.trim() !== ''
  ) {
    const expiraEnMs = data.continuacionExpiraEn ? Date.parse(data.continuacionExpiraEn) : NaN;
    if (Number.isFinite(expiraEnMs)) {
      return {
        procesoId: data.procesoId ?? null,
        externalId: data.externalId ?? null,
        token: data.continuacionActualizacion,
        expiraEnMs,
      };
    }
  }

  return null;
}

/**
 * true solo si la continuación guardada sigue siendo utilizable AHORA MISMO
 * para el proceso que la ficha tiene abierto: no venció localmente y
 * corresponde exactamente al mismo procesoId/externalId — nunca se reutiliza
 * la continuación de un proceso para otro, ni siquiera dentro de la misma
 * ficha si su identidad cambió. El backend igual vuelve a validar todo esto
 * de forma autoritativa; esta comprobación es solo para no enviar de más.
 */
export function continuacionAplicable(
  continuacion: ContinuacionFicha | null,
  proceso: { procesoId: number | null; externalId: string | null },
  ahoraMs: number = Date.now()
): boolean {
  if (!continuacion) return false;
  if (continuacion.expiraEnMs <= ahoraMs) return false;
  if (continuacion.procesoId !== proceso.procesoId) return false;
  if (continuacion.externalId !== proceso.externalId) return false;
  return true;
}
