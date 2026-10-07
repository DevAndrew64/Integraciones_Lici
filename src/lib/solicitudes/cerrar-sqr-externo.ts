/**
 * Ajuste "CIERRE DE SQR AL PRESENTAR" §8 (confirmado explícitamente) —
 * ÚNICO punto de llamada al API externo de cierre de SQR. Extraído tal
 * cual del contrato YA confirmado en `/api/solicitudes/cerrar-sqr`
 * (mismos 3 campos, mismo endpoint) — nunca una segunda integración
 * paralela. Reutilizado por esa ruta (hardening de validaciones), por el
 * flujo server-side de `PRESENTAR` (`cierre-sqr-al-presentar.ts`) y por
 * los cierres terminales de `/[id]/cerrar` (mismo archivo).
 *
 * `soporte` es OPCIONAL a este nivel — cada llamador decide si tiene un
 * archivo disponible (Presentar siempre lo exige antes de llegar aquí;
 * los cierres terminales pueden no tener ninguno, ej. un rechazo simple
 * sin evidencia) — GrupoColba sigue recibiendo el campo `soporte` solo
 * cuando existe.
 *
 * Ajuste "ESTADO FINAL SQR (booleano)" — `estadoFinalSqr` (true=Presentado/
 * false=No presentado) se envía también a GrupoColba, además de
 * persistirse localmente. Todo el resto del sistema (dominio, Prisma,
 * motores, helpers, frontend) sigue manejando `estadoFinalSqr` como
 * `boolean | null` real, con comparaciones estrictas (`===true`/
 * `===false`) — eso NUNCA cambia. La ÚNICA conversión a texto de todo el
 * flujo ocurre aquí mismo, justo en el borde HTTP, nunca antes.
 *
 * Ajuste "SERIALIZACIÓN HTTP '1'/'0' (confirmado con evidencia real)" —
 * un intento real de cierre (SQR 272702, Solicitud #129) devolvió de
 * GrupoColba: `{"errors":{"estadoFinalSqr":["The estado final sqr field
 * must be true or false."]}}` al enviar los literales `"true"`/`"false"`
 * dentro del `multipart/form-data`. La API receptora valida el campo como
 * boolean al estilo Laravel, donde los únicos valores textuales "boolean-
 * like" seguros que la validación acepta son `"1"`/`"0"` — un `FormData`
 * nunca transporta un booleano nativo, solo texto, así que la
 * representación literal `"true"`/`"false"` (fiel al string de JS, pero
 * NO al contrato boolean-string de la API receptora) era la causa raíz
 * del error. Por eso, específicamente en esta serialización:
 *   true  -> '1'
 *   false -> '0'
 *   null  -> NO se envía nada; se aborta el cierre con un error interno
 * (la nulabilidad NUNCA se envía como cadena — decisión indefinida no es
 * lo mismo que "No presentado").
 *
 * Ajuste "CLASIFICACIÓN INTERNA DE ERRORES EXTERNOS" (confirmado
 * explícitamente, tras un segundo intento real sobre SQR 272702/Solicitud
 * #129 que ya NO falló por serialización, sino con
 * `{"message":"Error al cerrar la SQR. Verifique que la SQR esté en
 * estado \"En Proceso\" e intente nuevamente."}`) — se auditó el
 * repositorio completo y NO existe ningún endpoint/helper para consultar
 * el estado real de una SQR en GrupoColba (solo existen los dos POST de
 * crear/cerrar). Por eso esta clasificación es EXCLUSIVAMENTE diagnóstico
 * interno (log/AuditLog) — nunca decide nada de negocio: en particular,
 * `EXTERNAL_NOT_IN_PROCESS` significa únicamente "GrupoColba no acepta el
 * cierre desde el estado externo actual", NUNCA "la SQR ya está cerrada"
 * — no autoriza marcar `sqrCerrada=true` ni `sqrCierreEstado='CERRADA'`
 * bajo ninguna circunstancia. El usuario final sigue viendo siempre el
 * mismo mensaje genérico (`MENSAJE_ERROR_CIERRE_SQR_EXTERNO`); estos
 * códigos nunca se exponen fuera de logs/auditoría.
 *
 * Clasificación conservadora, en este orden:
 *   1. `VALIDATION_ERROR` — status 400/422 Y el cuerpo parsea como JSON
 *      con un objeto `errors` no vacío (forma típica de validación estilo
 *      Laravel: `{"message":...,"errors":{"campo":[...]}}`) — el payload
 *      que enviamos está mal formado.
 *   2. `EXTERNAL_NOT_IN_PROCESS` — el texto (parseado o crudo) contiene,
 *      normalizado, tanto "estado" como "en proceso" — coincide con el
 *      mensaje de negocio real ya confirmado. Nunca se activa solo por
 *      status, siempre requiere el texto.
 *   3. `EXTERNAL_GENERIC_ERROR` — cualquier otro caso: 5xx, texto no
 *      reconocido, o un error de red (`catch`).
 */
export type CodigoErrorCierreSqr = 'VALIDATION_ERROR' | 'EXTERNAL_NOT_IN_PROCESS' | 'EXTERNAL_GENERIC_ERROR';

export type ResultadoCierreSqrExterno =
  | { ok: true }
  | { ok: false; error: string; status?: number; codigo?: CodigoErrorCierreSqr };

function normalizarParaClasificar(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Intenta parsear JSON sin lanzar — `null` si el cuerpo no es JSON válido
 * (ej. una página de error HTML de un 5xx). */
function parsearJsonSeguro(texto: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(texto);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * Clasificación EXCLUSIVAMENTE diagnóstica de un fallo HTTP ya ocurrido —
 * nunca decide nada de negocio (ver comentario del ajuste arriba).
 * Exportada para poder testearla de forma aislada además de a través de
 * `cerrarSqrEnGrupoColba`.
 */
export function clasificarErrorCierreSqrExterno(status: number | undefined, rawText: string): CodigoErrorCierreSqr {
  const parsed = parsearJsonSeguro(rawText);

  if (status === 400 || status === 422) {
    const errors = parsed?.errors;
    if (errors && typeof errors === 'object' && Object.keys(errors).length > 0) {
      return 'VALIDATION_ERROR';
    }
  }

  const textoCompleto = normalizarParaClasificar(
    typeof parsed?.message === 'string' ? parsed.message : rawText,
  );
  if (textoCompleto.includes('estado') && textoCompleto.includes('en proceso')) {
    return 'EXTERNAL_NOT_IN_PROCESS';
  }

  return 'EXTERNAL_GENERIC_ERROR';
}

export async function cerrarSqrEnGrupoColba(params: {
  sqrNumero: string;
  observacion: string;
  estadoFinalSqr: boolean;
  soporte?: { nombre: string; contenido: Blob };
}): Promise<ResultadoCierreSqrExterno> {
  const fd = new FormData();
  fd.append('novedad_id', params.sqrNumero);
  fd.append('observacion', params.observacion);

  // Comparación ESTRICTA, nunca un ternario `?:` — así, si por cualquier
  // fallo de tipado futuro este parámetro llegara a ser `null`/`undefined`
  // (todavía "En proceso", sin decisión final), NUNCA se serializa
  // silenciosamente como "0": se rechaza el cierre en vez de mentirle a
  // GrupoColba sobre una decisión que no existe. `'1'`/`'0'` — NUNCA
  // `'true'`/`'false'` (ver ajuste de serialización arriba: ese literal
  // es la causa raíz confirmada del error real de validación recibido).
  if (params.estadoFinalSqr === true) {
    fd.append('estadoFinalSqr', '1');
  } else if (params.estadoFinalSqr === false) {
    fd.append('estadoFinalSqr', '0');
  } else {
    return { ok: false, error: 'estadoFinalSqr indefinido — la SQR sigue "En proceso", no corresponde intentar cerrarla.' };
  }

  if (params.soporte) fd.append('soporte', params.soporte.contenido, params.soporte.nombre);

  try {
    const resp = await fetch('https://grupocolba.com/service/public/api/sqr/cerrar', {
      method: 'POST',
      body: fd,
    });
    const rawText = await resp.text();
    if (!resp.ok) {
      const error = rawText || `Error HTTP ${resp.status}`;
      return { ok: false, error, status: resp.status, codigo: clasificarErrorCierreSqrExterno(resp.status, rawText) };
    }
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Error de red al contactar GrupoColba.';
    return { ok: false, error, codigo: 'EXTERNAL_GENERIC_ERROR' };
  }
}
