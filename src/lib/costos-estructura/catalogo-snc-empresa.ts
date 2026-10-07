/**
 * Ajuste "UNIFICACIÓN SNC — MISMA UI, MISMA ARQUITECTURA, DISTINTA FUENTE
 * POR EMPRESA" — abstracción ÚNICA que la UI de Servicios No Continuos (y
 * Valor Agregado, que reutiliza la misma implementación) consulta para
 * decidir si puede ofrecer el selector de catálogo "Tipo de servicio", en
 * vez de preguntar `esAseocolba` disperso en el JSX.
 *
 * Confirmado EN VIVO contra la fuente real
 * (`grupocolba.com/service/public/api/no_continuos`, ver
 * `servicios-no-continuos-buscar.ts`), probando el parámetro `empresa` en
 * todas sus variantes de formato (minúscula/mayúscula, código corto/nombre
 * completo):
 *  - `aseo` → catálogo real de Aseocolba (213 registros).
 *  - `vigi` → catálogo real y DISTINTO de Vigicolba (3 registros propios:
 *    "Estudio de seguridad con poligrafía", "Curso persona autorizada
 *    T.S.A.", "Examen médico trabajo en altura").
 *  - `tempo`/`trans` (cualquier variante de formato) → devuelven, siempre,
 *    el MISMO catálogo de Aseocolba — un fallback silencioso de la fuente
 *    externa, NUNCA un catálogo propio. Mostrarlo a Tempocolba/Transcolba
 *    presentaría datos ajenos como propios.
 *
 * Por eso la whitelist de abajo es DELIBERADAMENTE de solo 2 empresas — no
 * es una limitación de esta implementación, es lo que la fuente real
 * soporta hoy. Cuando exista catálogo propio para Tempocolba/Transcolba,
 * agregarlo aquí es el ÚNICO cambio necesario — ningún otro archivo debe
 * tocarse (la UI ya lee esta función, nunca una lista propia).
 *
 * Reutiliza `EmpresaIca` (`calculo-costos-administrativos.ts`) — el MISMO
 * identificador canónico de 4 empresas que ya usa Costos Administrativos
 * (`derivarEmpresaIcaDeProceso`, el único derivador de empresa del archivo
 * que ya reconoce TRANSCOLBA) — nunca un mapeo de empresa paralelo.
 */
import type { EmpresaIca } from './calculo-costos-administrativos';

/** Código corto que espera la fuente real de catálogo SNC — mismo
 * significado que `CodigoEmpresaCatalogoDotEpp` en page.tsx, pero un tipo
 * PROPIO (deliberadamente sin 'tempo'): ese código nunca debe poder
 * construirse para este catálogo específico, para que sea imposible pedir
 * "el catálogo tempo" por error de tipos. */
export type CodigoEmpresaCatalogoSNC = 'aseo' | 'vigi';

/** Única fuente de verdad de "qué empresas tienen catálogo SNC propio
 * confirmado" — la ruta backend (`/api/servicios-no-continuos-ext`) y la UI
 * (page.tsx) leen AMBAS de aquí, nunca de una lista duplicada. */
const CODIGO_CATALOGO_SNC_POR_EMPRESA_ICA: Partial<Record<EmpresaIca, CodigoEmpresaCatalogoSNC>> = {
  ASEOCOLBA: 'aseo',
  VIGICOLBA: 'vigi',
};

export interface CapacidadCatalogoSNC {
  /** `true` únicamente para las empresas con catálogo real confirmado —
   * la UI muestra el selector de catálogo "Tipo de servicio" SOLO cuando
   * esto es `true`; en caso contrario, "Tipo de servicio" es una entrada
   * manual y "Código SNC" queda "No disponible" (nunca simulado). */
  disponibleCatalogo: boolean;
  /** Código corto a usar en la llamada real al catálogo — `null` si no
   * hay fuente propia confirmada para esta empresa (incluye el caso de
   * empresa no reconocida). */
  codigoEmpresaCatalogo: CodigoEmpresaCatalogoSNC | null;
}

/** Punto único de decisión — reutilizado tanto por la UI (page.tsx) como
 * por la ruta backend, para que ambas capas apliquen exactamente la misma
 * regla (defensa en profundidad: aunque alguien invoque la API directo sin
 * pasar por la UI, la ruta aplica esta MISMA whitelist, ver
 * `EMPRESAS_CON_CATALOGO_SNC_PROPIO`). */
export function resolverCapacidadCatalogoSNC(empresaIca: EmpresaIca | ''): CapacidadCatalogoSNC {
  const codigo = empresaIca ? (CODIGO_CATALOGO_SNC_POR_EMPRESA_ICA[empresaIca] ?? null) : null;
  return { disponibleCatalogo: codigo !== null, codigoEmpresaCatalogo: codigo };
}

/** Whitelist explícita para el backend — cualquier código de empresa fuera
 * de esta lista NUNCA llega a invocar la fuente externa (ver
 * `/api/servicios-no-continuos-ext`): así, aunque esa fuente devuelva 200
 * con el catálogo de Aseocolba como fallback silencioso para cualquier
 * empresa no reconocida, esa respuesta nunca se consulta ni se expone. */
export const EMPRESAS_CON_CATALOGO_SNC_PROPIO: readonly CodigoEmpresaCatalogoSNC[] = ['aseo', 'vigi'];

export function empresaTieneCatalogoSNCPropio(empresa: string): boolean {
  return (EMPRESAS_CON_CATALOGO_SNC_PROPIO as readonly string[]).includes(empresa);
}
