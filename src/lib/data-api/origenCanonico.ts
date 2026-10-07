/**
 * Equivalentes CANÓNICOS para inferir el origen / actualizabilidad de un
 * `Proceso` sin depender de prefijos de `sourceKey` ni del `rawJson` crudo:
 * el origen y la actualizabilidad se derivan de `origenFuncional` /
 * `disponibleDataApi` (ver `src/lib/procesos/origen-proceso.ts` y
 * `src/lib/proceso-identidad.ts` para la variante que sí inspecciona columnas
 * de adquisición en registros heredados).
 *
 * Convención de identidad local: `sourceKey = local:<uuid>` para las altas
 * manuales nuevas. `origenFuncional === 'MANUAL'` es la señal PRIMARIA; el
 * prefijo es solo un detalle de formato del identificador opaco, nunca el
 * criterio de negocio.
 */

export type OrigenCanonico = 'MANUAL' | 'PUBLICO_ABIERTO' | 'PUBLICO_REGISTRADO' | 'PRIVADO' | 'DESCONOCIDO';

export interface ProcesoParaClasificarCanonico {
  origenFuncional?: OrigenCanonico | null;
  disponibleDataApi?: boolean | null;
  sourceKey?: string | null;
}

/** Prefijo de identidad local para altas manuales nuevas. */
export const PREFIJO_SOURCE_KEY_LOCAL = 'local:';

/**
 * Prefijo heredado de alta manual. Coexiste con `local:%` sin ser
 * intercambiable: los registros `manual:%` provienen de datos históricos y su
 * `sourceKey` nunca se remapea. Ambos prefijos se tratan como "no gestionado
 * por el servicio de datos" por igual, pero NUNCA deben fusionarse ni
 * reescribirse el uno al otro.
 */
export const PREFIJO_SOURCE_KEY_MANUAL_LEGACY = 'manual:';

export function esSourceKeyLocal(sourceKey: string | null | undefined): boolean {
  return String(sourceKey ?? '').trim().toLowerCase().startsWith(PREFIJO_SOURCE_KEY_LOCAL);
}

/** `true` si el prefijo (cualquiera de los dos universos) marca identidad manual/local — nunca gestionable por Data API. */
export function esSourceKeyManualOLocal(sourceKey: string | null | undefined): boolean {
  const s = String(sourceKey ?? '').trim().toLowerCase();
  return s.startsWith(PREFIJO_SOURCE_KEY_LOCAL) || s.startsWith(PREFIJO_SOURCE_KEY_MANUAL_LEGACY);
}

/**
 * Fragmento de `where` Prisma que excluye procesos MANUAL de un listado
 * (feed "Nuevos", stats, dashboard…). Señal PRIMARIA: `origenFuncional =
 * 'MANUAL'` (persistida, fiable para TODA fila que haya pasado por el
 * backfill/aplicador canónico — incluidas las `manual:%` migradas, que
 * `10_procesos_manuales.sql` clasifica con `origenFuncional='MANUAL'`
 * reproduciendo exactamente `determinarOrigenProceso` regla 1).
 * Compatibilidad: además excluye por prefijo (`local:`/`manual:`) para
 * filas históricas sin `origenFuncional` poblado (`NULL`) — nunca al revés
 * (el prefijo nunca desclasifica una fila que `origenFuncional` ya marcó
 * como no-MANUAL).
 *
 * `origenFuncional: { not: 'MANUAL' }` en Prisma compila a `<> 'MANUAL'`,
 * que en SQL de 3 valores EXCLUYE los NULL — por eso la rama `OR
 * { origenFuncional: null }` es obligatoria (mismo patrón ya usado en la
 * reconciliación de `aplicarPaginaCanonica.ts`).
 */
export function whereExcluirManual(): Record<string, unknown> {
  return {
    AND: [
      { OR: [{ origenFuncional: null }, { NOT: { origenFuncional: 'MANUAL' } }] },
      { NOT: { sourceKey: { startsWith: PREFIJO_SOURCE_KEY_LOCAL } } },
      { NOT: { sourceKey: { startsWith: PREFIJO_SOURCE_KEY_MANUAL_LEGACY } } },
    ],
  };
}

/** Misma exclusión que `whereExcluirManual()`, como fragmento SQL crudo (para `$queryRawUnsafe`) sobre el alias de tabla dado (por defecto sin alias). */
export function sqlExcluirManual(aliasPunto = ''): string {
  const col = (nombre: string) => `${aliasPunto}"${nombre}"`;
  return `(${col('origenFuncional')} IS NULL OR ${col('origenFuncional')} <> 'MANUAL') ` +
    `AND ${col('sourceKey')} NOT LIKE '${PREFIJO_SOURCE_KEY_LOCAL}%' ` +
    `AND ${col('sourceKey')} NOT LIKE '${PREFIJO_SOURCE_KEY_MANUAL_LEGACY}%'`;
}

/**
 * Traducción canónica de una fuente SECOP (S1/S2) al equivalente que SÍ
 * tienen las filas Data API. `Proceso.aliasFuente` nunca se escribe para
 * esas filas (contrato canónico, ver `mapeoCanonico.ts`), así que un filtro
 * directo por `aliasFuente` las excluye por completo — D11: filtrar
 * `/api/procesos/nuevos?fuente=S1` devolvía cero procesos recientes, porque
 * TODOS entran hoy por la Data API. Mismo mapeo que `aliasFuenteDesdeOrigenFuncional`
 * (`src/lib/procesos/ficha-contractual.ts`), en sentido inverso y como
 * fragmento de `where` en vez de post-procesado.
 *
 * `fuente` distinta de S1/S2 (p.ej. `'NC'`) no tiene un equivalente
 * canónico 1:1 fiable — se filtra por igualdad directa, igual que antes.
 */
export function condicionFuente(fuente: string): Record<string, unknown> {
  const f = String(fuente ?? '').trim().toUpperCase();
  if (f === 'S2') {
    return { OR: [{ aliasFuente: { equals: 'S2' } }, { AND: [{ aliasFuente: null }, { origenFuncional: 'PUBLICO_REGISTRADO' }] }] };
  }
  if (f === 'S1') {
    return { OR: [{ aliasFuente: { equals: 'S1' } }, { AND: [{ aliasFuente: null }, { origenFuncional: 'PUBLICO_ABIERTO' }] }] };
  }
  return { aliasFuente: f };
}

/**
 * Misma traducción que `condicionFuente()`, como expresión SQL cruda (para
 * `$queryRawUnsafe`) que da el alias EFECTIVO de un Proceso: `aliasFuente`
 * si está poblado, si no el equivalente derivado de `origenFuncional`, si
 * tampoco eso aplica un sentinela `''` que nunca coincide con `'S1'`/`'S2'`
 * — así una comparación `IN`/`NOT IN` sobre el resultado nunca cae en el
 * NULL de tres valores de SQL (D12: sin el sentinela, `NOT IN ('S1','S2')`
 * sobre un valor NULL nunca es TRUE, y el bucket "privado" perdía filas en
 * vez de ganarlas de más).
 */
export function sqlAliasFuenteEfectivo(aliasPunto = ''): string {
  const col = (nombre: string) => `${aliasPunto}"${nombre}"`;
  return (
    `COALESCE(${col('aliasFuente')}, ` +
    `CASE ${col('origenFuncional')} WHEN 'PUBLICO_REGISTRADO' THEN 'S2' WHEN 'PUBLICO_ABIERTO' THEN 'S1' END, ` +
    `'')`
  );
}

/**
 * Equivalente canónico de `determinarOrigenProceso` (origen-proceso.ts): el
 * origen YA viene resuelto y persistido — no hay que re-derivarlo de
 * rawJson/aliasFuente. Si `origenFuncional` está ausente (dato heredado sin
 * backfill), se cae a DESCONOCIDO — nunca se inventa un origen a partir de
 * evidencia insuficiente.
 */
export function origenCanonicoDeProceso(proceso: ProcesoParaClasificarCanonico): OrigenCanonico {
  return proceso.origenFuncional ?? 'DESCONOCIDO';
}

/**
 * Equivalente canónico de `puedeActualizarProcesoDesdeFuenteExterna`
 * (proceso-identidad.ts): en vez de exigir `externalId` + prefijo `ext:`,
 * la pregunta "¿esto lo gobierna una fuente externa (actualizable por
 * sync)?" se responde directamente con `disponibleDataApi` — la MISMA
 * señal que ya usa la reconciliación para proteger MANUAL/local.
 */
export function puedeActualizarDesdeDataApi(proceso: ProcesoParaClasificarCanonico): boolean {
  // Ambos universos de identidad manual/local (`local:` nativo,
  // `manual:` heredado migrado) se tratan igual — ver `esSourceKeyManualOLocal()`.
  if (esSourceKeyManualOLocal(proceso.sourceKey)) return false;
  if (proceso.origenFuncional === 'MANUAL') return false;
  return proceso.disponibleDataApi === true;
}
