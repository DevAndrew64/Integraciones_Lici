/**
 * Ajuste "ORDEN Y NUMERACIÓN DE CARGOS EN REGISTRAR DOTACIÓN Y EPP" — pura,
 * sin React. Agrupa las líneas principales de Mano de Obra por familia de
 * cargo (orden de PRIMERA APARICIÓN, nunca alfabético) y ubica los
 * turnantes automáticos inmediatamente después de las líneas de su familia
 * — nunca en una sección global al final.
 *
 * Diagnóstico (§13.A/B) — campo actual de asociación turnante↔Mano de Obra:
 * `LineaMOExtra.claveGrupoTurnante` (page.tsx) es un HASH de compatibilidad
 * salarial/ARL/horario (`GrupoNecesidadTurnantes.claveGrupo`,
 * calculo-turnantes.ts), NUNCA una lista de ids de línea ni el nombre del
 * cargo — el turnante generado ni siquiera guarda el nombre del cargo que
 * originó la cobertura (`nombreCargo` es el texto fijo "Turnante (cobertura
 * de descanso...)"). El único lugar donde SÍ existen ids estables de las
 * líneas cubiertas es `GrupoNecesidadTurnantes.coberturaPorPosicion[].id`
 * (id de `lineasExtra`, como string) — vive en el memo de page.tsx, no se
 * persiste en el turnante. Por eso esta función recibe `idsLineasOrigen`
 * ya resuelto por el llamador (page.tsx cruza `claveGrupoTurnante` contra
 * `gruposNecesidadTurnantes` para obtenerlo) — nunca agrupa turnantes por
 * coincidencia de texto en el nombre.
 *
 * Criterio de orden ANTERIOR (§13.B): concatenación simple
 * `[...lineasExtra, ...cargosTurnantes]` en orden de creación — de ahí que
 * un turnante apareciera siempre al final, sin importar a qué cargo
 * perteneciera.
 */

export interface LineaPrincipalOrdenable {
  id: number;
  nombreCargo: string;
}

export interface LineaTurnanteOrdenable {
  id: number;
  /** Ids de `lineasExtra` (Mano de Obra) que este turnante cubre, resueltos
   * por el llamador vía `claveGrupoTurnante` → `GrupoNecesidadTurnantes`.
   * Vacío o sin coincidencia con ninguna familia ⇒ turnante huérfano. */
  idsLineasOrigen: number[];
}

export interface EntradaOrdenSujetoCosteo {
  id: number;
  origen: 'manoObra' | 'turnante';
}

export interface ResultadoOrdenSujetosCosteo {
  /** Orden final — principales agrupados por familia (primera aparición) +
   * turnantes de esa familia intercalados justo después; nunca muta las
   * listas de entrada. */
  orden: EntradaOrdenSujetoCosteo[];
  /** Ids de turnantes sin familia detectada (idsLineasOrigen vacío o sin
   * intersección con ninguna línea principal) — quedan al final, marcados
   * para revisión; nunca se descartan. */
  huerfanoIds: number[];
}

function normalizarNombreCargo(nombre: string): string {
  return nombre.trim().toUpperCase();
}

/**
 * Agrupa por familia de cargo (primera aparición) y ubica cada turnante
 * automático inmediatamente después de las líneas principales de su
 * familia. Un turnante que cubre VARIAS familias (pool compartido) se
 * ubica una sola vez, tras la PRIMERA familia (en orden de aparición) que
 * cubre — nunca se duplica en la lista. Un turnante sin intersección con
 * ninguna familia queda al final (huérfano), nunca se pierde.
 */
export function ordenarSujetosCosteoPorCargo(params: {
  lineasManoObra: readonly LineaPrincipalOrdenable[];
  turnantes: readonly LineaTurnanteOrdenable[];
}): ResultadoOrdenSujetosCosteo {
  const { lineasManoObra, turnantes } = params;

  // Familias en orden de PRIMERA APARICIÓN (Map conserva orden de inserción).
  const familias = new Map<string, { ids: number[] }>();
  for (const linea of lineasManoObra) {
    const clave = normalizarNombreCargo(linea.nombreCargo);
    const familia = familias.get(clave);
    if (familia) familia.ids.push(linea.id);
    else familias.set(clave, { ids: [linea.id] });
  }

  const turnantesUsados = new Set<number>();
  const orden: EntradaOrdenSujetoCosteo[] = [];

  for (const [, familia] of familias) {
    for (const id of familia.ids) orden.push({ id, origen: 'manoObra' });
    for (const t of turnantes) {
      if (turnantesUsados.has(t.id)) continue;
      if (t.idsLineasOrigen.some(idOrigen => familia.ids.includes(idOrigen))) {
        orden.push({ id: t.id, origen: 'turnante' });
        turnantesUsados.add(t.id);
      }
    }
  }

  const huerfanoIds: number[] = [];
  for (const t of turnantes) {
    if (!turnantesUsados.has(t.id)) {
      orden.push({ id: t.id, origen: 'turnante' });
      huerfanoIds.push(t.id);
    }
  }

  return { orden, huerfanoIds };
}
