/**
 * Guardrail de IDENTIDAD POSITIVA del destino de escritura de la aplicación,
 * previo a CUALQUIER escritura del runner de sincronización.
 *
 * Afirma de forma POSITIVA que la conexión de runtime apunta exactamente a la
 * instancia física esperada, comparando su `system_identifier` real contra
 * `DATA_API_RUNTIME_EXPECTED_SYSTEM_IDENTIFIER`.
 *
 * Exige, en este orden, y ABORTA en el primer fallo (antes de abrir
 * ninguna conexión de escritura):
 *   1. `DATA_API_RUNTIME_DATABASE_URL` presente.
 *   2. `DATA_API_RUNTIME_WRITE_ENABLED === 'true'` (exacto).
 *   3. `DATA_API_RUNTIME_EXPECTED_SYSTEM_IDENTIFIER` presente y no vacío.
 *   4. Conexión real read-only al destino (la provee el caller).
 *   5. `system_identifier` real === esperado.
 *   6. (Opcional, defensa en profundidad) Si
 *      `DATA_API_RUNTIME_FORBIDDEN_SYSTEM_IDENTIFIER` está definida, el
 *      `system_identifier` real NO puede coincidir con ese valor (p. ej. una
 *      instancia que se quiera excluir). Este repositorio NO hardcodea ningún
 *      `system_identifier` de infraestructura; el valor prohibido, si se
 *      necesita, se aporta por entorno.
 *
 * NUNCA imprime ni incluye en los errores: connection strings, usuarios,
 * contraseñas ni hashes. El `system_identifier` de un cluster PostgreSQL
 * no es un secreto; aun así solo se expone en el objeto de resultado y en
 * el mensaje de la discrepancia (para diagnóstico), nunca junto a una URL.
 */

export interface EntornoDestinoProduccion {
  DATA_API_RUNTIME_DATABASE_URL?: string;
  DATA_API_RUNTIME_WRITE_ENABLED?: string;
  DATA_API_RUNTIME_EXPECTED_SYSTEM_IDENTIFIER?: string;
  /** Opcional: system_identifier que NUNCA puede ser destino de escritura (defensa en profundidad). */
  DATA_API_RUNTIME_FORBIDDEN_SYSTEM_IDENTIFIER?: string;
}

export class IdentidadDestinoProduccionNoConfirmadaError extends Error {
  readonly code = 'DESTINO_PRODUCCION_NO_CONFIRMADO';
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'IdentidadDestinoProduccionNoConfirmadaError';
  }
}

/**
 * Dependencia inyectable: ejecuta UNA consulta read-only contra la URL de
 * runtime y devuelve el `system_identifier` del cluster
 * (`SELECT system_identifier FROM pg_control_system()`), como string.
 * Nunca escribe. En tests es un fake; en runtime real lo implementa un
 * cliente `pg` en una transacción `READ ONLY`.
 */
export interface ConsultaIdentidadDestino {
  obtenerSystemIdentifier(runtimeUrl: string): Promise<string>;
}

export interface ResultadoIdentidadDestinoProduccion {
  /** `system_identifier` real leído del destino — igual al esperado si esta función no lanzó. */
  systemIdentifier: string;
}

function requerido(valor: string | undefined): valor is string {
  return typeof valor === 'string' && valor.trim().length > 0;
}

export async function verificarDestinoProduccion(
  env: EntornoDestinoProduccion,
  consulta: ConsultaIdentidadDestino,
): Promise<ResultadoIdentidadDestinoProduccion> {
  if (!requerido(env.DATA_API_RUNTIME_DATABASE_URL)) {
    throw new IdentidadDestinoProduccionNoConfirmadaError(
      'Falta DATA_API_RUNTIME_DATABASE_URL — no hay destino de runtime explícito. Abortando antes de cualquier escritura.',
    );
  }
  if (env.DATA_API_RUNTIME_WRITE_ENABLED !== 'true') {
    throw new IdentidadDestinoProduccionNoConfirmadaError(
      'DATA_API_RUNTIME_WRITE_ENABLED no es exactamente "true" — la escritura sobre el destino de runtime no está habilitada explícitamente. Abortando antes de cualquier escritura.',
    );
  }
  if (!requerido(env.DATA_API_RUNTIME_EXPECTED_SYSTEM_IDENTIFIER)) {
    throw new IdentidadDestinoProduccionNoConfirmadaError(
      'Falta DATA_API_RUNTIME_EXPECTED_SYSTEM_IDENTIFIER — sin identidad positiva esperada no se puede confirmar el destino de runtime. Abortando antes de cualquier escritura.',
    );
  }

  const esperado = env.DATA_API_RUNTIME_EXPECTED_SYSTEM_IDENTIFIER.trim();

  let real: string;
  try {
    real = (await consulta.obtenerSystemIdentifier(env.DATA_API_RUNTIME_DATABASE_URL)).trim();
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err);
    throw new IdentidadDestinoProduccionNoConfirmadaError(
      `No se pudo leer el system_identifier del destino de runtime (consulta read-only): ${detalle}. Abortando antes de cualquier escritura.`,
    );
  }

  if (!requerido(real)) {
    throw new IdentidadDestinoProduccionNoConfirmadaError(
      'El destino de runtime no devolvió un system_identifier — no se puede confirmar su identidad. Abortando antes de cualquier escritura.',
    );
  }

  if (real !== esperado) {
    throw new IdentidadDestinoProduccionNoConfirmadaError(
      `El system_identifier real del destino (${real}) NO coincide con el esperado (${esperado}). ` +
        'La URL de runtime no apunta a la instancia física prevista. Abortando antes de cualquier escritura.',
    );
  }

  const prohibido = env.DATA_API_RUNTIME_FORBIDDEN_SYSTEM_IDENTIFIER?.trim();
  if (prohibido && real === prohibido) {
    throw new IdentidadDestinoProduccionNoConfirmadaError(
      `El destino de runtime resolvió a un system_identifier marcado como PROHIBIDO ` +
        `(DATA_API_RUNTIME_FORBIDDEN_SYSTEM_IDENTIFIER). Este runner nunca escribe ahí. Abortando.`,
    );
  }

  return { systemIdentifier: real };
}
