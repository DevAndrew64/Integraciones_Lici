/**
 * Regla de producto "INSUMOS — GRUPO 18 (EPP) SOLO EN SERVICIOS NO CONTINUOS"
 * (petición directa) + "ASEOCOLBA SNC EXCLUYE GRUPO 01".
 *
 * Diagnóstico EN VIVO contra la fuente real
 * (`POST grupocolba.com/service/public/api/insumos`, empresa=aseo,
 * uen=baq — 2026-08-28), probando `nocontinuo:false` vs `nocontinuo:true`:
 *  - La fuente NO trae ningún campo de grupo/categoría propio (solo
 *    `codigo, coddot, nombre, undmed, undnegocio, valor, iva,
 *    fecha_ultima_compra`) — `coddot` es un cruce disperso con Dotación
 *    (vacío en ~96% de las filas), NUNCA un grupo.
 *  - El ÚNICO campo que codifica el grupo es el PREFIJO de 2 dígitos de
 *    `codigo` (ej. "18173" → grupo "18") — confirmado por CONTENIDO, no por
 *    intuición: con `nocontinuo:true` los 272 códigos "18xxx" son EPP real
 *    (GUANTE, ARNEZ, BOTA DE SEGURIDAD, CASCO, ALCOHOL INDUSTRIAL, BATA
 *    QUIRÚRGICA...), nunca basura.
 *  - Con `nocontinuo:false` (lo que la app envía HOY, incluso cuando el
 *    body simplemente omite el campo — confirmado idéntico) NINGÚN código
 *    "18xxx" aparece jamás (0 de 2894 filas, aseo/BAQ). Con
 *    `nocontinuo:true` sí aparecen (272 de 4076). `true` es SIEMPRE
 *    superset de `false` (2888/2888 códigos de `false` también están en
 *    `true`) — nunca un catálogo disjunto.
 *  - Prefijo "01" NO existe en ningún caso probado (aseo, BAQ/BOG/MIN,
 *    ambos booleanos) — la exclusión de abajo es inerte con los datos de
 *    hoy pero se implementa igual porque es la regla de producto pedida.
 *
 * Por eso: `nocontinuo` es lo que distingue el contexto (Insumos normal vs.
 * Servicios No Continuos) — NUNCA una condición `codigo.startsWith('18')`
 * aplicada globalmente. Habilitar 18 en SNC es un efecto AUTOMÁTICO de
 * pedir `nocontinuo:true` ahí — este archivo no necesita "permitir" nada,
 * solo excluir lo que además hay que excluir (01, y solo para Aseocolba).
 */

/** Primeros 2 dígitos de `codigo` — único campo de la fuente que codifica
 * el grupo/categoría del insumo (ver diagnóstico arriba). */
export function codigoGrupoInsumo(codigo: string | null | undefined): string {
  return String(codigo ?? '').trim().slice(0, 2);
}

/**
 * true si esa fila debe EXCLUIRSE del catálogo de Insumos para Servicios No
 * Continuos. Regla confirmada SOLO para Aseocolba (`empresa==='aseo'`,
 * mismo código corto que ya usa `/api/insumos-ext`) — grupo/código "01".
 * NUNCA se extiende a Vigicolba/Tempocolba sin una confirmación equivalente
 * (no existe hoy ninguna regla legacy de Vigicolba que debiera heredarse
 * aquí — verificado, no hay nada que copiar por error).
 */
export function debeExcluirseDeInsumosSNC(empresa: string, codigo: string | null | undefined): boolean {
  if (empresa !== 'aseo') return false;
  return codigoGrupoInsumo(codigo) === '01';
}
