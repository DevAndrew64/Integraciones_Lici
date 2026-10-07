/**
 * Clasificación pura del ORIGEN real de un `Proceso` — no confía en un solo
 * campo (`aliasFuente='NC'` no es suficiente: existen NC manuales y NC
 * importados de una fuente histórica sincronizada, con reglas de
 * enriquecimiento distintas).
 *
 * Combina `sourceKey`, `externalId`, `aliasFuente` y la forma de `rawJson`.
 * Ante señales incompletas o contradictorias entre sí, devuelve DESCONOCIDO
 * — nunca se inventa un origen a partir de evidencia insuficiente.
 */

export type OrigenProceso = 'MANUAL' | 'FUENTE_HISTORICA' | 'SECOP_I' | 'SECOP_II' | 'DESCONOCIDO';

export interface ProcesoParaClasificar {
  sourceKey?: string | null;
  externalId?: string | null;
  aliasFuente?: string | null;
  fuente?: string | null;
  /** JSON crudo tal como se guarda en `Proceso.rawJson` (string) o ya parseado. */
  rawJson?: string | Record<string, unknown> | null;
  /**
   * Concepto canónico Data API (ver `ficha-contractual.ts`). Un Proceso
   * Data API nunca trae `aliasFuente` ni un `sourceKey` con prefijo `ext:`
   * (su `sourceKey` es el id opaco del contrato canónico) — sin esta señal,
   * las reglas de abajo (todas basadas en `aliasFuente`/`sourceKey`) siempre
   * devuelven DESCONOCIDO para una fila Data API, aunque su origen real sea
   * público.
   */
  origenFuncional?: string | null;
}

function parsearRawJson(raw: string | Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * Firma estructural de un payload importado por origen NC — verificada contra
 * ejemplos reales (`idContrato` + `EntidadContratante`/`Objeto`, y un campo
 * `link` propio del payload de importación). Exigir `idContrato` + al menos
 * una de esas señales estructurales evita falsos positivos con un objeto
 * vacío o con forma distinta (ej. un rawJson de SECOP, que no lleva estos
 * campos con estos nombres).
 */
export function pareceRawJsonFuenteHistorica(raw: Record<string, unknown> | null): boolean {
  if (!raw) return false;
  const tieneIdContrato = raw.idContrato != null && String(raw.idContrato).trim() !== '' && String(raw.idContrato) !== '0';
  if (!tieneIdContrato) return false;
  const tieneEntidad = typeof raw.EntidadContratante === 'string' && raw.EntidadContratante.trim() !== '';
  const tieneObjeto = typeof raw.Objeto === 'string' && raw.Objeto.trim() !== '';
  const linkRaw = typeof raw.link === 'string' ? raw.link : (typeof raw.Link === 'string' ? raw.Link : '');
  const tieneLink = linkRaw.trim() !== '';
  return tieneEntidad || tieneObjeto || tieneLink;
}

/**
 * Determina el origen real de un Proceso combinando todas las señales
 * disponibles. Reglas (en orden, la primera que aplica decide):
 *
 *  1. `sourceKey` empieza con `manual:` — si además hay `externalId` o un
 *     `aliasFuente` de SECOP (S1/S2), es una CONTRADICCIÓN (un proceso
 *     manual nunca debería tener identidad externa) → DESCONOCIDO.
 *     Si no hay contradicción → MANUAL.
 *  2. `aliasFuente='NC'` + `sourceKey` empieza con `ext:` + `externalId`
 *     presente + `rawJson` con la firma estructural de una fuente histórica
 *     sincronizada → FUENTE_HISTORICA. Un `ext:` solo, sin la forma de
 *     rawJson confirmada, NO es suficiente.
 *  3. `aliasFuente='S1'` + alguna identidad externa (`sourceKey ext:` o
 *     `externalId`) → SECOP_I. Sin identidad externa, S1 es incoherente → DESCONOCIDO.
 *  4. `aliasFuente='S2'` — igual que S1 → SECOP_II.
 *  5. `NC`/`S1`/`S2` sin firma/identidad suficiente → DESCONOCIDO.
 *  6. `aliasFuente` AUSENTE (Proceso Data API — nunca se escribe, ver
 *     `mapeoCanonico.ts`) + `origenFuncional` presente → PUBLICO_REGISTRADO
 *     mapea a SECOP_II, PUBLICO_ABIERTO a SECOP_I (ver
 *     `aliasFuenteDesdeOrigenFuncional` en `ficha-contractual.ts`, única
 *     fuente de verdad del mapeo). Sin `origenFuncional` tampoco →
 *     DESCONOCIDO (nunca se inventa un origen).
 */
export function determinarOrigenProceso(proceso: ProcesoParaClasificar): OrigenProceso {
  const sourceKey = String(proceso.sourceKey ?? '').trim();
  const externalId = proceso.externalId != null ? String(proceso.externalId).trim() : '';
  const alias = String(proceso.aliasFuente ?? '').trim().toUpperCase();

  const esManualSourceKey = sourceKey.startsWith('manual:');
  const esExtSourceKey = sourceKey.startsWith('ext:');
  const tieneExternalId = externalId !== '';
  const tieneIdentidadExterna = esExtSourceKey || tieneExternalId;

  if (esManualSourceKey) {
    // Contradicción: sourceKey dice "manual" pero hay identidad externa o
    // alias de SECOP — no se puede confiar en ninguna de las dos señales.
    if (tieneIdentidadExterna || alias === 'S1' || alias === 'S2') return 'DESCONOCIDO';
    return 'MANUAL';
  }

  const raw = parsearRawJson(proceso.rawJson);

  if (alias === 'NC') {
    if (esExtSourceKey && tieneExternalId && pareceRawJsonFuenteHistorica(raw)) {
      return 'FUENTE_HISTORICA';
    }
    return 'DESCONOCIDO';
  }

  if (alias === 'S1') {
    return tieneIdentidadExterna ? 'SECOP_I' : 'DESCONOCIDO';
  }

  if (alias === 'S2') {
    return tieneIdentidadExterna ? 'SECOP_II' : 'DESCONOCIDO';
  }

  // 6. Sin ninguna señal legacy (`aliasFuente` ausente) — última chance:
  // el equivalente canónico Data API. Nunca pisa una regla anterior (todas
  // ya retornaron si `alias` traía algo reconocible); solo cubre el caso
  // real de un Proceso Data API (`aliasFuente=null`), donde SÍ hay evidencia
  // de origen, solo que en otro campo.
  if (!alias) {
    if (proceso.origenFuncional === 'PUBLICO_REGISTRADO') return 'SECOP_II';
    if (proceso.origenFuncional === 'PUBLICO_ABIERTO') return 'SECOP_I';
  }

  return 'DESCONOCIDO';
}