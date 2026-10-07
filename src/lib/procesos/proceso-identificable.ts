/**
 * Ajuste "PROCESOS SIN IDENTIFICADOR — FILTRO DE LISTADOS".
 *
 * La Data API empezó a entregar el 2026-09-16 procesos completamente vacíos:
 * sin `codigoProceso`, `nombre`, `entidad`, `objeto`, `estado`, fechas ni
 * `valor`, con `origenFuncional = 'DESCONOCIDO'` y `disponibleDataApi = true`
 * (232 medidos en dos días, y siguen entrando). El contrato canónico declara
 * todos esos campos nullable y el aplicador no exige contenido mínimo, así que
 * se persisten tal cual — la causa raíz vive en la Data API, no aquí.
 *
 * En la UI aparecían como fichas sin nada que mostrar, identificadas con el
 * `PROCESO-<id>` sintético que los endpoints fabrican cuando no hay ni código
 * ni nombre (ver `procesos/route.ts`), imposibles de buscar porque ese texto no
 * existe en ninguna columna.
 *
 * Se filtran en LECTURA, nunca en la ingesta: la fila se sigue guardando, así
 * que el día que la Data API complete esos procesos reaparecen solos, sin
 * re-sincronizar ni migrar nada. Rechazarlos al entrar habría exigido tocar el
 * contrato canónico y su batería de tests para un problema de otro repositorio.
 *
 * Criterio: basta UNO de los dos identificadores. Un proceso con nombre pero
 * sin código (o al revés) es perfectamente usable y se conserva visible.
 */

/**
 * Fragmento de `where` Prisma que deja fuera los procesos sin ningún
 * identificador legible.
 *
 * NULL-safe por construcción: cada rama exige `IS NOT NULL` ANTES de comparar
 * contra `''`. Sin ese guard, en Postgres `"nombre" <> ''` sobre un NULL es
 * UNKNOWN y la fila se descartaría aunque tuviera código — el mismo patrón de
 * lógica de tres valores que ya corrigieron los filtros de fuente (D11/D12).
 */
export function whereProcesoIdentificable(): Record<string, unknown> {
  return {
    OR: [
      { AND: [{ codigoProceso: { not: null } }, { codigoProceso: { not: '' } }] },
      { AND: [{ nombre: { not: null } }, { nombre: { not: '' } }] },
    ],
  };
}

/** `true` si el proceso tiene al menos un identificador legible (código o nombre). */
export function procesoEsIdentificable(proceso: { codigoProceso?: string | null; nombre?: string | null }): boolean {
  return String(proceso.codigoProceso ?? '').trim() !== '' || String(proceso.nombre ?? '').trim() !== '';
}
