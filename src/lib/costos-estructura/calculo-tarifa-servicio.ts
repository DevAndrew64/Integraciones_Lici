/**
 * Consolidación de la pestaña "Resultado" como TARIFA DE SERVICIO
 * comercial — módulo PURO, reutilizable, sin fetch. Ajuste "REDISEÑAR
 * COMPLETAMENTE LA PESTAÑA RESULTADO" (confirmado explícitamente): NUNCA
 * reconstruye los 4 totales fuente (Mano de Obra/Insumos/Equipos/Costos
 * Administrativos) — los recibe YA CALCULADOS por sus motores respectivos
 * (page.tsx los pasa tal cual, sin tocar sus fórmulas internas) y solo
 * arma la cadena de subtotales de la tarifa.
 *
 * Ajuste "REGLA REAL DE IVA/A.I.U. — HOJA RESUMEN DEL EXCEL DE REFERENCIA" +
 * "IMPLEMENTAR SERVICIOS TEMPORALES / PERSONAL EN MISIÓN" (confirmados
 * explícitamente por el usuario) — regla INTERNA de la empresa, nunca
 * doctrina/interpretación automática de nombres:
 *
 *   ASEO                                    → ASEO_CAFETERIA_ESPECIAL
 *   ASEO + CAFETERÍA                        → ASEO_CAFETERIA_ESPECIAL
 *   VIGILANCIA                              → VIGILANCIA_ESPECIAL
 *   PERSONAL EN MISIÓN / SERVICIOS TEMPORALES → SERVICIOS_TEMPORALES_ESPECIAL
 *   SERVICIO GENERAL (evidencia EXPLÍCITA)  → IVA_PLENO
 *   SIN EVIDENCIA SUFICIENTE DE MODALIDAD   → REQUIERE_REVISION
 *
 * `proponerRegimenIVA` implementa ESTA regla exacta (nunca la doctrina
 * legal que distingue "solo aseo" de "aseo integral") — es una PROPUESTA
 * automática, explícita y auditable (`RegimenIVA`), nunca una detección
 * silenciosa. Un proceso de Aseo con un cargo adicional (jardinero/
 * todero) SIGUE siendo ASEO_CAFETERIA_ESPECIAL. Un cargo genérico
 * (jardinero/todero/conserje/operario/auxiliar) sin evidencia explícita
 * de su modalidad (servicio general vs. personal en misión) NUNCA cae
 * automáticamente en IVA_PLENO — queda en REQUIERE_REVISION hasta que se
 * determine la modalidad real (ver `detectarConceptosServicio`).
 */

/** Único redondeo de esta cadena — nunca se suman conceptos ya redondeados por separado con criterios distintos. */
function redondearPeso(n: number): number {
  return Math.round(n);
}

export type RegimenIVA = 'ASEO_CAFETERIA_ESPECIAL' | 'VIGILANCIA_ESPECIAL' | 'SERVICIOS_TEMPORALES_ESPECIAL' | 'IVA_PLENO' | 'REQUIERE_REVISION';

export const TARIFA_IVA_GENERAL = 19;
export const PORCENTAJE_MINIMO_BASE_IVA_ASEO = 10;
export const PORCENTAJE_BASE_IVA_VIGILANCIA = 10;
/** Mismo mínimo del 10% que Aseo/Cafetería — Ajuste "IMPLEMENTAR SERVICIOS
 * TEMPORALES / PERSONAL EN MISIÓN" §6, rama explícita (ver `calcularBaseIva`). */
export const PORCENTAJE_MINIMO_BASE_IVA_SERVICIOS_TEMPORALES = 10;

/** Detección de conceptos compartida por `proponerRegimenIVA` y
 * `proponerOrigenRegimenIVA` — un único lugar con las subcadenas
 * reconocidas, nunca duplicadas de forma dispersa. Se normalizan tildes
 * (NFD) para que "personal en misión" y "personal en mision" detecten
 * igual — Ajuste "IMPLEMENTAR SERVICIOS TEMPORALES / PERSONAL EN MISIÓN". */
function detectarConceptosServicio(conceptosServicio: string[]): {
  tieneAseo: boolean; tieneCafeteria: boolean; tieneVigilancia: boolean;
  tienePersonalEnMision: boolean; tieneServicioGeneral: boolean;
} {
  const normalizados = conceptosServicio.map(c => (c || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
  return {
    // Se revisan AMBAS subcadenas — "aseo" ("ASEO"/"ASEO INTEGRAL") y
    // "asea" ("ASEADOR"/"ASEADORA", el nombre de cargo más común en los
    // procesos reales) — ninguna de las dos por separado cubre ambos
    // casos ("aseador" no contiene "aseo"; "aseo" no contiene "asea").
    tieneAseo: normalizados.some(c => c.includes('aseo') || c.includes('asea')),
    tieneCafeteria: normalizados.some(c => c.includes('cafeter')),
    tieneVigilancia: normalizados.some(c => c.includes('vigilancia') || c.includes('vigi')),
    // Ajuste "IMPLEMENTAR SERVICIOS TEMPORALES / PERSONAL EN MISIÓN" §3/§4
    // (auditado: no existe un campo estructurado dedicado; la única señal
    // disponible hoy es el nombre de la empresa/perfil del proceso —
    // "TEMPOCOLBA" es, por diseño de negocio, la empresa de servicios
    // temporales/personal en misión — o una frase explícita en el cargo/
    // objeto). Nunca se infiere de un cargo genérico (jardinero/todero/
    // etc.) por sí solo.
    tienePersonalEnMision: normalizados.some(c => c.includes('tempo') || c.includes('personal en mision') || c.includes('servicio temporal') || c.includes('trabajador en mision') || c.includes('suministro de personal')),
    // Evidencia EXPLÍCITA de modalidad "servicio general" — nunca se
    // asume por ausencia de las demás señales (eso cae en REQUIERE_REVISION).
    tieneServicioGeneral: normalizados.some(c => c.includes('servicio general') || c.includes('servicios generales')),
  };
}

/**
 * Propuesta automática de `RegimenIVA` a partir de los conceptos/cargos
 * del proceso (ej. nombres de línea de Mano de Obra, y el perfil/empresa
 * del proceso) — SIEMPRE explícita (nunca se aplica en silencio): quien la
 * use debe guardar el resultado como el campo auditable `regimenIVA`,
 * nunca re-derivarlo cada vez de forma dispersa. Prioridad fija: Aseo/
 * Cafetería > Vigilancia > Personal en misión/Servicios temporales >
 * IVA pleno (solo con evidencia EXPLÍCITA de "servicio general") >
 * REQUIERE_REVISION. Ajuste "IMPLEMENTAR SERVICIOS TEMPORALES / PERSONAL
 * EN MISIÓN" §2/§9 (confirmado explícitamente) — SE ELIMINÓ el fallback
 * "si no es Aseo ni Vigilancia ⇒ IVA_PLENO": un cargo genérico
 * (jardinero/todero/conserje/operario/auxiliar) NO determina por sí solo
 * el régimen — puede ser servicio general (⇒ IVA_PLENO) o personal en
 * misión (⇒ SERVICIOS_TEMPORALES_ESPECIAL) según la modalidad real del
 * proceso; sin evidencia de cuál de las dos, el resultado es
 * `REQUIERE_REVISION` (nunca un "cajón de sastre" en IVA_PLENO).
 */
export function proponerRegimenIVA(conceptosServicio: string[]): RegimenIVA {
  if (conceptosServicio.length === 0 || conceptosServicio.every(c => !(c || '').trim())) return 'REQUIERE_REVISION';
  const { tieneAseo, tieneCafeteria, tieneVigilancia, tienePersonalEnMision, tieneServicioGeneral } = detectarConceptosServicio(conceptosServicio);
  if (tieneAseo || tieneCafeteria) return 'ASEO_CAFETERIA_ESPECIAL';
  if (tieneVigilancia) return 'VIGILANCIA_ESPECIAL';
  if (tienePersonalEnMision) return 'SERVICIOS_TEMPORALES_ESPECIAL';
  if (tieneServicioGeneral) return 'IVA_PLENO';
  return 'REQUIERE_REVISION';
}

/** Distingue el FUNDAMENTO de una propuesta de régimen: `FUENTE_NORMATIVA`
 * (Art. 462-1/447 E.T., misma conclusión para cualquier proceso del mismo
 * tipo) vs `POLITICA_INTERNA` (una decisión comercial de la empresa,
 * nunca una conclusión legal automática). Nunca se mezclan en el mismo
 * campo. Trazabilidad INTERNA únicamente (Ajuste "CORRIGE EL FLUJO DE
 * GESTIONAR TARIFA" §4/§7) — nunca se muestra al usuario en Resultado. */
export type OrigenRegimenIVA = 'FUENTE_NORMATIVA' | 'POLITICA_INTERNA';

/**
 * Ajuste "CASO ESPECIAL: SOLO ASEO" (confirmado explícitamente) — la
 * doctrina DIAN 2024 distingue el servicio de aseo prestado SIN
 * cafetería integrada (base gravable general), pero la empresa ha
 * definido internamente que ciertos procesos de solo-Aseo se manejen
 * comercialmente bajo el esquema especial de AIU. Por eso, cuando se
 * detecta Aseo SIN Cafetería, el origen de la propuesta es SIEMPRE
 * `POLITICA_INTERNA` — nunca `FUENTE_NORMATIVA` — aunque el régimen
 * propuesto (`proponerRegimenIVA`) sea el mismo `ASEO_CAFETERIA_ESPECIAL`
 * que el caso normativo de Aseo+Cafetería integrada. Vigilancia e IVA
 * pleno son siempre `FUENTE_NORMATIVA` (Art. 462-1/447 E.T., sin
 * variantes por decisión comercial).
 */
export function proponerOrigenRegimenIVA(conceptosServicio: string[]): OrigenRegimenIVA {
  const { tieneAseo, tieneCafeteria } = detectarConceptosServicio(conceptosServicio);
  if (tieneAseo && !tieneCafeteria) return 'POLITICA_INTERNA';
  return 'FUENTE_NORMATIVA';
}

/**
 * Ajuste "CORRIGE EL FLUJO DE GESTIONAR TARIFA" / "AJUSTA LA CABECERA DE
 * DETALLE DE LA TARIFA" (confirmado explícitamente) — etiqueta CORTA para
 * la cabecera comercial de Resultado: SOLO depende del régimen, NUNCA
 * menciona el origen (norma/política interna/override admin) — esa
 * distinción es trazabilidad interna (ver `proponerOrigenRegimenIVA` y
 * `regimenIVAConfirmado!=null` en page.tsx), nunca información visible en
 * el Resultado comercial. `REQUIERE_REVISION` no tiene etiqueta de
 * criterio — ese caso se muestra como una alerta aparte ("Régimen IVA
 * pendiente de definición"), nunca como un criterio calculado.
 */
export const ETIQUETA_CRITERIO_IVA_CORTA: Record<RegimenIVA, string> = {
  ASEO_CAFETERIA_ESPECIAL: 'Base especial AIU',
  VIGILANCIA_ESPECIAL: 'Base especial',
  SERVICIOS_TEMPORALES_ESPECIAL: 'Base especial AIU',
  IVA_PLENO: 'IVA pleno',
  REQUIERE_REVISION: 'Pendiente de definición',
};

/** Régimen tributario REAL (nunca `REQUIERE_REVISION`, que es solo un
 * estado interno de seguridad, nunca una opción que el usuario elija) —
 * Ajuste "ELIMINA REQUIERE REVISIÓN DEL SELECTOR VISIBLE" +
 * "IMPLEMENTAR SERVICIOS TEMPORALES / PERSONAL EN MISIÓN" §1/§8. */
export type RegimenIVASeleccionable = Exclude<RegimenIVA, 'REQUIERE_REVISION'>;

/** Etiqueta combinada "{régimen} — {base}" para el <select> visible y
 * para la vista de solo-lectura del modal "Gestionar tarifa" — Ajuste
 * "ELIMINA REQUIERE REVISIÓN DEL SELECTOR VISIBLE" §8. Solo cubre los 4
 * regímenes REALES; `REQUIERE_REVISION` nunca aparece aquí. */
export const ETIQUETA_OPCION_REGIMEN_IVA: Record<RegimenIVASeleccionable, string> = {
  ASEO_CAFETERIA_ESPECIAL: 'Aseo y Cafetería — Base especial AIU',
  VIGILANCIA_ESPECIAL: 'Vigilancia — Base especial AIU',
  SERVICIOS_TEMPORALES_ESPECIAL: 'Personal en misión / Servicios temporales — Base especial AIU',
  IVA_PLENO: 'IVA pleno — Base general',
};

/** Frase (una sola línea, nunca un párrafo) del criterio aplicado por
 * régimen — Ajuste "DETALLE DESPLEGABLE DE IVA" §2. */
export const CRITERIO_APLICADO_REGIMEN: Record<RegimenIVA, string> = {
  ASEO_CAFETERIA_ESPECIAL: 'IVA sobre base especial AIU',
  VIGILANCIA_ESPECIAL: 'IVA sobre base especial definida para vigilancia',
  SERVICIOS_TEMPORALES_ESPECIAL: 'IVA sobre base especial AIU para personal en misión/servicios temporales',
  IVA_PLENO: 'IVA sobre el valor total de la operación',
  REQUIERE_REVISION: 'Pendiente de clasificar régimen',
};

/** Fundamento tributario AMPLIADO por régimen — Ajuste "MODAL GESTIONAR
 * TARIFA" §3 / "DETALLE DESPLEGABLE DE IVA" §2 ("Ver fundamento
 * tributario"). Texto de referencia, no reemplaza asesoría legal — solo
 * documenta el criterio aplicado por el sistema. */
export const FUNDAMENTO_TRIBUTARIO_REGIMEN: Record<RegimenIVA, { titulo: string; texto: string; fuente: string }> = {
  ASEO_CAFETERIA_ESPECIAL: {
    titulo: 'Base especial AIU',
    texto: 'Para servicios integrales de aseo y cafetería, el IVA se calcula a la tarifa general sobre la parte correspondiente al AIU. La base AIU no puede ser inferior al 10% del valor del contrato.',
    fuente: 'Art. 462-1 Estatuto Tributario',
  },
  VIGILANCIA_ESPECIAL: {
    titulo: 'Base especial AIU / régimen especial',
    texto: 'Aplica a servicios de vigilancia autorizados dentro del tratamiento del artículo 462-1.',
    fuente: 'Art. 462-1 Estatuto Tributario',
  },
  SERVICIOS_TEMPORALES_ESPECIAL: {
    titulo: 'Base especial AIU',
    texto: 'Aplica a servicios de suministro de personal/personal en misión (empresas de servicios temporales) dentro del tratamiento del artículo 462-1. La base AIU no puede ser inferior al 10% del valor del contrato.',
    fuente: 'Art. 462-1 Estatuto Tributario',
  },
  IVA_PLENO: {
    titulo: 'Base general',
    texto: 'El IVA se calcula sobre el valor total de la operación antes de IVA.',
    fuente: 'Art. 447 Estatuto Tributario',
  },
  REQUIERE_REVISION: {
    titulo: 'Sin clasificar',
    texto: 'Aún no se ha determinado la base gravable a aplicar; requiere revisión manual antes de calcular el IVA final.',
    fuente: '—',
  },
};

export interface ResultadoBaseIva {
  regimenIVA: RegimenIVA;
  porcentajeIU: number | null;
  iu: number;
  /** true en ASEO_CAFETERIA_ESPECIAL/SERVICIOS_TEMPORALES_ESPECIAL cuando porcentajeIU < 10% — la base de IVA usó el mínimo del 10%, nunca el IU real (menor). */
  baseMinima10Aplicada: boolean;
  baseIva: number;
  tarifaIva: number;
  iva: number;
}

/**
 * Fórmula de Base/Valor de IVA — SIEMPRE por régimen explícito, nunca una
 * fórmula única genérica. Auditada contra la hoja RESUMEN del Excel de
 * referencia (caso exacto: subtotal $270.067.860, IU 10% → IVA $5.131.289).
 *
 *  ASEO_CAFETERIA_ESPECIAL:
 *    baseIva = subtotalParaAiu × MAX(porcentajeIU, 10%)
 *    iva     = baseIva × 19%
 *    (si porcentajeIU >= 10%, baseIva === iu exactamente; si es menor,
 *    se usa el mínimo del 10% sobre subtotalParaAiu — NUNCA el IU real,
 *    que sería menor).
 *
 *  VIGILANCIA_ESPECIAL — regla SEPARADA, NO es la misma fórmula que Aseo
 *  (auditada explícitamente: la base es 10% de subtotalAntesIva — que ya
 *  incluye I.U. — nunca 10%/MAX sobre subtotalParaAiu):
 *    baseIva = subtotalAntesIva × 10%
 *    iva     = baseIva × 19%
 *
 *  SERVICIOS_TEMPORALES_ESPECIAL (personal en misión/servicios temporales)
 *  — Ajuste "IMPLEMENTAR SERVICIOS TEMPORALES / PERSONAL EN MISIÓN" §6:
 *  rama EXPLÍCITA y separada de Vigilancia (que usa una base distinta). A
 *  falta de una fórmula distinta explícitamente aprobada para este
 *  régimen, se modela con el MISMO tratamiento de base especial AIU ya
 *  auditado para Aseo/Cafetería (mínimo 10% sobre subtotalParaAiu) —
 *  supuesto documentado, a confirmar/corregir si el modelo aprobado real
 *  difiere:
 *    baseIva = subtotalParaAiu × MAX(porcentajeIU, 10%)
 *    iva     = baseIva × 19%
 *
 *  IVA_PLENO (servicio general con evidencia EXPLÍCITA de esa modalidad —
 *  nunca "cualquier cargo que no sea Aseo/Vigilancia/personal en misión"):
 *    baseIva = subtotalAntesIva
 *    iva     = baseIva × 19%
 *
 *  REQUIERE_REVISION (sin clasificar todavía — nunca se inventa un
 *  régimen ni una base): baseIva=0, iva=0.
 */
export function calcularBaseIva(params: {
  regimenIVA: RegimenIVA;
  subtotalParaAiu: number;
  porcentajeIU: number | null;
  iu: number;
  subtotalAntesIva: number;
}): ResultadoBaseIva {
  const tarifaIva = TARIFA_IVA_GENERAL;
  const porcentajeIU = params.porcentajeIU;
  if (params.regimenIVA === 'ASEO_CAFETERIA_ESPECIAL' && porcentajeIU != null) {
    const porcentajeBase = Math.max(porcentajeIU, PORCENTAJE_MINIMO_BASE_IVA_ASEO);
    const baseIva = redondearPeso((params.subtotalParaAiu * porcentajeBase) / 100);
    const iva = redondearPeso((baseIva * tarifaIva) / 100);
    return { regimenIVA: params.regimenIVA, porcentajeIU, iu: params.iu, baseMinima10Aplicada: porcentajeIU < PORCENTAJE_MINIMO_BASE_IVA_ASEO, baseIva, tarifaIva, iva };
  }
  if (params.regimenIVA === 'VIGILANCIA_ESPECIAL') {
    const baseIva = redondearPeso((params.subtotalAntesIva * PORCENTAJE_BASE_IVA_VIGILANCIA) / 100);
    const iva = redondearPeso((baseIva * tarifaIva) / 100);
    return { regimenIVA: params.regimenIVA, porcentajeIU, iu: params.iu, baseMinima10Aplicada: false, baseIva, tarifaIva, iva };
  }
  if (params.regimenIVA === 'SERVICIOS_TEMPORALES_ESPECIAL' && porcentajeIU != null) {
    const porcentajeBase = Math.max(porcentajeIU, PORCENTAJE_MINIMO_BASE_IVA_SERVICIOS_TEMPORALES);
    const baseIva = redondearPeso((params.subtotalParaAiu * porcentajeBase) / 100);
    const iva = redondearPeso((baseIva * tarifaIva) / 100);
    return { regimenIVA: params.regimenIVA, porcentajeIU, iu: params.iu, baseMinima10Aplicada: porcentajeIU < PORCENTAJE_MINIMO_BASE_IVA_SERVICIOS_TEMPORALES, baseIva, tarifaIva, iva };
  }
  if (params.regimenIVA === 'IVA_PLENO') {
    const baseIva = redondearPeso(params.subtotalAntesIva);
    const iva = redondearPeso((baseIva * tarifaIva) / 100);
    return { regimenIVA: params.regimenIVA, porcentajeIU, iu: params.iu, baseMinima10Aplicada: false, baseIva, tarifaIva, iva };
  }
  // ASEO_CAFETERIA_ESPECIAL/SERVICIOS_TEMPORALES_ESPECIAL sin porcentajeIU configurado aún, o REQUIERE_REVISION.
  return { regimenIVA: params.regimenIVA, porcentajeIU, iu: params.iu, baseMinima10Aplicada: false, baseIva: 0, tarifaIva, iva: 0 };
}

export interface EntradaTarifaServicio {
  /** Total mensual final de Mano de Obra — `tarifaMensualTotalManoObra` (page.tsx), sin reconstruir. */
  manoObra: number;
  /** Total mensual final de Insumos — `totalMensualInsumos` (page.tsx), sin reconstruir. */
  insumos: number;
  /** Total mensual final de Maq. y Equipos — `maqTotal` (page.tsx), sin reconstruir. */
  equipos: number;
  /** Total mensual final de Costos Administrativos — `adminTotal` (Pólizas+Impuestos+Variables administrativas, ya incluye el IVA propio de Pólizas), sin reconstruir. */
  costosAdministrativos: number;
  /** Régimen de IVA/I.U. explícito y auditable — nunca detección dispersa; ver `proponerRegimenIVA`. */
  regimenIVA: RegimenIVA;
  /** % de I.U. (Imprevistos+Utilidad) configurado — `null` mientras no exista una fuente de configuración real (nunca un 10% inventado). */
  porcentajeIU: number | null;
  /** Duración del contrato del proceso, en meses — misma fuente única que ya usan Pólizas e Impuestos (`polizasNumeroMesesContrato`), nunca un segundo número independiente. */
  vigenciaMeses: number;
}

export interface ResultadoTarifaServicio {
  manoObra: number;
  insumos: number;
  equipos: number;
  costosAdministrativos: number;
  /** manoObra + insumos + equipos + costosAdministrativos. */
  subtotalParaAiu: number;
  iu: number;
  iuPendienteConfigurar: boolean;
  /** subtotalParaAiu + iu. */
  subtotalAntesIva: number;
  regimenIVA: RegimenIVA;
  porcentajeIU: number | null;
  /** Base sobre la que se calculó `iva` — depende del régimen, ver `calcularBaseIva`. */
  ivaBase: number;
  /** true en ASEO_CAFETERIA_ESPECIAL/SERVICIOS_TEMPORALES_ESPECIAL cuando porcentajeIU < 10%. */
  baseMinima10Aplicada: boolean;
  tarifaIva: number;
  iva: number;
  /** subtotalAntesIva + iva — valor comercial mensual final del servicio. */
  valorMesIncluidoIva: number;
  vigenciaMeses: number;
  /** valorMesIncluidoIva × vigenciaMeses — `null` si `vigenciaMeses` no es un número válido (nunca se inventa una vigencia). */
  valorTotalVigencia: number | null;
}

export function calcularTarifaServicio(entrada: EntradaTarifaServicio): ResultadoTarifaServicio {
  const manoObra = redondearPeso(entrada.manoObra);
  const insumos = redondearPeso(entrada.insumos);
  const equipos = redondearPeso(entrada.equipos);
  const costosAdministrativos = redondearPeso(entrada.costosAdministrativos);
  const subtotalParaAiu = redondearPeso(manoObra + insumos + equipos + costosAdministrativos);

  const iuPendienteConfigurar = entrada.porcentajeIU == null;
  const iu = redondearPeso(entrada.porcentajeIU != null ? (subtotalParaAiu * entrada.porcentajeIU) / 100 : 0);
  const subtotalAntesIva = redondearPeso(subtotalParaAiu + iu);

  const resultadoIva = calcularBaseIva({
    regimenIVA: entrada.regimenIVA,
    subtotalParaAiu,
    porcentajeIU: entrada.porcentajeIU,
    iu,
    subtotalAntesIva,
  });
  const valorMesIncluidoIva = redondearPeso(subtotalAntesIva + resultadoIva.iva);

  const vigenciaValida = Number.isFinite(entrada.vigenciaMeses) && entrada.vigenciaMeses > 0;
  const valorTotalVigencia = vigenciaValida ? redondearPeso(valorMesIncluidoIva * entrada.vigenciaMeses) : null;

  return {
    manoObra, insumos, equipos, costosAdministrativos,
    subtotalParaAiu,
    iu, iuPendienteConfigurar,
    subtotalAntesIva,
    regimenIVA: entrada.regimenIVA,
    porcentajeIU: entrada.porcentajeIU,
    ivaBase: resultadoIva.baseIva,
    baseMinima10Aplicada: resultadoIva.baseMinima10Aplicada,
    tarifaIva: resultadoIva.tarifaIva,
    iva: resultadoIva.iva,
    valorMesIncluidoIva,
    vigenciaMeses: entrada.vigenciaMeses,
    valorTotalVigencia,
  };
}

/**
 * Ajuste "CONFIGURACIÓN Y PERSISTENCIA REAL DE % I.U. Y regimenIVA" —
 * prioridad EXPLÍCITA (nunca se recalcula por render): (1) el régimen
 * GUARDADO explícitamente por un usuario autorizado siempre gana, sin
 * importar qué proponga `proponerRegimenIVA` después (ej. si cambian los
 * cargos del proceso); (2) si nunca se ha guardado uno (`null`/
 * `undefined`), se usa la propuesta automática como provisional. NUNCA
 * se confunde `REQUIERE_REVISION` explícitamente guardado (una decisión
 * válida) con "no hay decisión guardada" (`null`/`undefined`) — por eso
 * la firma exige `RegimenIVA | null | undefined` para el confirmado,
 * nunca un booleano ni un string vacío.
 */
export function resolverRegimenIVAEfectivo(regimenIVAConfirmado: RegimenIVA | null | undefined, regimenIVAPropuesto: RegimenIVA): RegimenIVA {
  return regimenIVAConfirmado ?? regimenIVAPropuesto;
}

/**
 * Ajuste "CORRIGE EL FLUJO DE GESTIONAR TARIFA" (confirmado
 * explícitamente) — la política tributaria interna NO exige confirmación
 * manual: si la clasificación automática (`regimenIVAEfectivo` —
 * propuesta automática, o el override de un administrador cuando
 * exista) ya determinó un régimen real, Resultado es FINAL sin pedir un
 * paso adicional al usuario. Resultado NUNCA se considera FINAL mientras
 * falte: (1) un `porcentajeIU` explícitamente configurado (nunca
 * `null`/`undefined` — `0` SÍ cuenta como configurado); o (2) el régimen
 * efectivo sea `REQUIERE_REVISION` (el único caso que sí exige
 * intervención humana/administrativa antes de cerrar el resultado).
 */
export function resultadoTarifaEsFinal(porcentajeIU: number | null | undefined, regimenIVAEfectivo: RegimenIVA): boolean {
  if (porcentajeIU == null) return false;
  if (regimenIVAEfectivo === 'REQUIERE_REVISION') return false;
  return true;
}

/**
 * Ajuste "CORRIGE LA CABECERA DE DETALLE DE LA TARIFA" (confirmado
 * explícitamente) — `tipoServicio` (QUÉ se vende) y `regimenIVA` (CÓMO se
 * liquida tributariamente) son dos datos DIFERENTES; `IVA_PLENO`/
 * `ASEO_CAFETERIA_ESPECIAL`/etc. NUNCA deben mostrarse como "Tipo de
 * servicio" — eso pertenece exclusivamente al motor tributario
 * (`proponerRegimenIVA`). Esta función clasifica el servicio para
 * VISUALIZACIÓN únicamente, completamente separada de `proponerRegimenIVA`
 * (nunca comparte ni reutiliza su resultado) — mismas subcadenas de
 * detección que ya usa el motor tributario, pero un propósito distinto:
 * aquí Aseo/Vigilancia/Personal en misión NO tienen prioridad exclusiva
 * entre sí, pueden coexistir (⇒ "Mixto") ni existe fallback a IVA_PLENO.
 */
export type TipoServicioClasificado =
  | 'Aseo' | 'Aseo y Cafetería' | 'Cafetería' | 'Vigilancia' | 'Personal en misión'
  | 'Jardinería' | 'Todero' | 'Conserjería' | 'Servicios generales' | 'Mixto' | 'No determinado';

export function clasificarTipoServicio(conceptosServicio: string[]): TipoServicioClasificado {
  if (conceptosServicio.length === 0 || conceptosServicio.every(c => !(c || '').trim())) return 'No determinado';
  const normalizados = conceptosServicio.map(c => (c || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
  const tiene = (...subcadenas: string[]) => normalizados.some(c => subcadenas.some(s => c.includes(s)));
  const categorias: TipoServicioClasificado[] = [];
  const aseo = tiene('aseo', 'asea');
  const cafeteria = tiene('cafeter');
  if (aseo && cafeteria) categorias.push('Aseo y Cafetería');
  else if (aseo) categorias.push('Aseo');
  else if (cafeteria) categorias.push('Cafetería');
  if (tiene('vigilancia', 'vigi')) categorias.push('Vigilancia');
  if (tiene('tempo', 'personal en mision', 'servicio temporal', 'trabajador en mision', 'suministro de personal')) categorias.push('Personal en misión');
  if (tiene('jardin')) categorias.push('Jardinería');
  if (tiene('todero')) categorias.push('Todero');
  if (tiene('conserje', 'conserjeria')) categorias.push('Conserjería');
  if (tiene('servicio general', 'servicios generales')) categorias.push('Servicios generales');
  if (categorias.length === 0) return 'No determinado';
  if (categorias.length === 1) return categorias[0];
  return 'Mixto';
}
