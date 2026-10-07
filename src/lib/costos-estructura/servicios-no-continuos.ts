/**
 * Ajuste "SERVICIOS NO CONTINUOS — CONTENEDOR DE SERVICIOS INDEPENDIENTES"
 * — cada Servicio no continuo replica la estructura económica del costeo
 * principal (Mano de Obra, EPP/Dotación, Exámenes Médicos con
 * Exámenes/Cursos/Vacunas, Insumos, Maquinaria y Equipos), EXCLUYENDO
 * Costos Administrativos (Pólizas/Impuestos/Garantías siguen siendo
 * únicos por proceso, nunca por servicio — decisión explícita del
 * usuario). Puro — sin React, sin `fetch` — reutilizable por page.tsx y
 * por pruebas.
 *
 * Reutiliza, sin duplicar fórmulas, los motores puros ya existentes de
 * Maquinaria (`calculo-maquinaria.ts`) e Insumos (`calculo-insumos.ts`).
 *
 * Ajuste "MANO DE OBRA COMPLETA EN SERVICIOS NO CONTINUOS" — la Mano de
 * Obra del servicio YA NO tiene una fórmula simplificada propia en este
 * archivo: cada cargo es un `LineaMOExtra` completo (horario, festivos,
 * recargos, los 5 bonos — el MISMO tipo que la Mano de Obra principal y
 * Turnantes, importado de `motor-distribuido/tipos-cargo.ts`), y se
 * calcula con el MISMO motor pesado (`construirCalculadaLinea` y el resto
 * del pipeline de `page.tsx`, ver `resultadosLineasExtraMensuales`) —
 * nunca una segunda lógica. Ese motor depende de festivos por año/
 * metodología de costeo/etc., que solo existen como estado de
 * `ModuloEstructuraCostos` (React) — por eso `calcularTotalesServicioNoContinuo`
 * ya NO calcula el total de Mano de Obra internamente: lo recibe ya
 * calculado (`totalManoObraServicio`, calculado en page.tsx con el mismo
 * motor que Mano de Obra principal) y solo lo suma con el resto de
 * bloques del servicio.
 *  - EPP/Dotación (ronda "REUTILIZACIÓN REAL DE CATÁLOGOS"): `dotacionEpp`
 *    reutiliza EXACTAMENTE el tipo `DotGroup`/`DotItemRow` global (ver
 *    `dotacion-epp-tipo.ts`) — el modal "Registrar Dotación y EPP" del
 *    módulo principal se reutiliza tal cual, redirigiendo su destino de
 *    escritura al servicio (page.tsx: `mutarDotGroups`/
 *    `destinoModalDotEpp`). `calcularValorMensualItemDotacionEpp` replica
 *    la MISMA fórmula que `valorConIva`/`valorMesRow` (inline en
 *    page.tsx, todavía sin extraer a una función pura reutilizable).
 *  - Exámenes/Cursos/Vacunas: la fórmula real de la pantalla global vive
 *    inline en `page.tsx` (`examMesPorTrab`, con tablas de factor por
 *    examen y "alcance por trabajador") y el catálogo NO está todavía
 *    parametrizado por destino — fuera de alcance de esta ronda (ver
 *    informe). Aquí se mantiene la fórmula base simplificada (cantidad ×
 *    valor / frecuencia en meses) documentada en la ronda anterior.
 */
import type { DotGroup, DotItemRow } from '../costos-mano-obra/motor-distribuido/dotacion-epp-tipo';
import type { LineaMOExtra } from '../costos-mano-obra/motor-distribuido/tipos-cargo';
import { resolverFactorPeriodicidadValorAgregado, type FrecuenciaValorAgregado } from './valor-agregado';
import {
  calcularTotalMensualMaquinariaEquipos,
  type MaquinariaEquipoRowNormalizado,
} from './calculo-maquinaria';
import { calcularValorUnitarioConIva, calcularValorMensualInsumo, IVA_INSUMOS_PORCENTAJE } from './calculo-insumos';
import {
  buscarTarifaCatalogoAseocolba, calcularTarifaServicioAseocolba,
  type TarifaServicioAseocolba,
} from './tarifario-especiales-aseocolba';
export type { TarifaServicioAseocolba } from './tarifario-especiales-aseocolba';
import {
  calcularTotalEquiposEspecializadosServicio,
  type EquipoEspecializadoServicioNoContinuo,
} from './equipos-especializados-snc';
export type { EquipoEspecializadoServicioNoContinuo, EquipoEspecializadoCatalogoSNC } from './equipos-especializados-snc';
export {
  crearEquipoEspecializadoDesdeCatalogo, crearEquipoEspecializadoManual, calcularValorTotalEquipoEspecializado,
  calcularTotalEquiposEspecializadosServicio, claveEquipoEspecializado,
  buscarEquiposEspecializados,
} from './equipos-especializados-snc';

/* ───────────────────────── Mano de Obra del servicio ───────────────────────── */

// Ajuste "MANO DE OBRA COMPLETA EN SERVICIOS NO CONTINUOS" — cada cargo de
// un servicio no continuo es ahora un `LineaMOExtra` COMPLETO (mismo tipo
// que Mano de Obra principal/Turnantes), calculado con el mismo motor
// pesado en page.tsx — ver nota del encabezado del archivo. Re-exportado
// aquí bajo el mismo nombre para que los consumidores de este módulo
// (page.tsx, tests) puedan importar el tipo de cargo desde un solo lugar
// junto con el resto del contrato de Servicios no continuos.
export type { LineaMOExtra } from '../costos-mano-obra/motor-distribuido/tipos-cargo';

/* ───────────────────────── EPP / Dotación del servicio ───────────────────────── */

/** Ajuste "SERVICIOS NO CONTINUOS — REUTILIZACIÓN REAL DE CATÁLOGOS" —
 * `dotacionEpp` del servicio es un `DotGroup[]`, EXACTAMENTE el mismo
 * tipo que usa `ModalDotacionEpp` en page.tsx (importado desde
 * `dotacion-epp-tipo.ts`, nunca declarado dos veces) — el modal escribe
 * y lee directamente `servicio.dotacionEpp` sin ninguna conversión.
 * `IVA_DOTACION_EPP_SERVICIO`/`calcularValorMensualItemDotacionEpp`
 * replican la MISMA fórmula que `valorConIva`/`valorMesRow` en page.tsx
 * (Math.floor(cant×valorConIva/frecuencia), IVA 19%) — page.tsx aún no
 * expone esa fórmula como función pura reutilizable (vive inline,
 * §"EPP/Dotación" del encabezado de este archivo), así que esta es la
 * primera versión compartida; nunca diverge del cálculo real. */
export const IVA_DOTACION_EPP_SERVICIO = 1.19;

export function calcularValorMensualItemDotacionEpp(row: DotItemRow): number {
  return Math.floor((row.cant * row.vUnit * IVA_DOTACION_EPP_SERVICIO) / (row.frec || 1));
}

export function calcularTotalDotacionEppServicio(grupos: readonly DotGroup[]): number {
  return grupos.reduce((s, g) => s + (g.rows ?? []).reduce((s2, r) => s2 + calcularValorMensualItemDotacionEpp(r), 0), 0);
}

/* ───────────────────────── Exámenes Médicos del servicio ───────────────────────── */

export type CategoriaExamenMedicoServicio = 'EXAMEN' | 'CURSO' | 'VACUNA';

export interface ItemExamenMedicoServicioNoContinuo {
  id: number;
  concepto: string;
  cantidad: number;
  frecuenciaMeses: number;
  valorUnitario: number;
  cargoId?: number;
}

/** valorMensual = cantidad × valorUnitario / frecuencia — ver nota de
 * alcance del encabezado (sin factor por examen ni catálogo). Misma
 * fórmula para Exámenes, Cursos y Vacunas del servicio. */
export function calcularValorMensualItemExamenMedico(item: ItemExamenMedicoServicioNoContinuo): number {
  const frecuencia = item.frecuenciaMeses > 0 ? item.frecuenciaMeses : 1;
  return (item.cantidad * item.valorUnitario) / frecuencia;
}

export interface ExamenesMedicosServicioNoContinuo {
  examenes: ItemExamenMedicoServicioNoContinuo[];
  cursos: ItemExamenMedicoServicioNoContinuo[];
  vacunas: ItemExamenMedicoServicioNoContinuo[];
}

export interface TotalesExamenesMedicosServicio {
  totalExamenes: number;
  totalCursos: number;
  totalVacunas: number;
  totalExamenesMedicos: number;
}

export function calcularTotalesExamenesMedicosServicio(bloque: ExamenesMedicosServicioNoContinuo): TotalesExamenesMedicosServicio {
  const totalExamenes = bloque.examenes.reduce((s, i) => s + calcularValorMensualItemExamenMedico(i), 0);
  const totalCursos = bloque.cursos.reduce((s, i) => s + calcularValorMensualItemExamenMedico(i), 0);
  const totalVacunas = bloque.vacunas.reduce((s, i) => s + calcularValorMensualItemExamenMedico(i), 0);
  return { totalExamenes, totalCursos, totalVacunas, totalExamenesMedicos: totalExamenes + totalCursos + totalVacunas };
}

/* ───────────────────────── Insumos del servicio ───────────────────────── */

/** Igual forma que `InsumoRow` global — `codigo` puede quedar como cadena
 * vacía (insumo manual sin código de catálogo, `origen==='MANUAL'` es la
 * señal real, nunca se exige código). Reutiliza EXACTAMENTE
 * `calcularValorUnitarioConIva`/`calcularValorMensualInsumo` de
 * `calculo-insumos.ts` — nunca una fórmula paralela. */
export interface InsumoServicioNoContinuo {
  id: number;
  origen: 'CATALOGO' | 'MANUAL';
  codigo: string;
  nombre: string;
  unidad?: string;
  cantidad: number;
  frecuenciaMeses: number;
  valorUnitarioSinIva: number;
  ivaPorcentaje?: number;
  // Ajuste "REUTILIZACIÓN REAL DE CATÁLOGOS" — mismos dos campos
  // calculados que `InsumoRow` global (nunca opcionales ahí): esta forma
  // EXACTA es la que permite que el modal "Gestionar insumos" (borrador
  // tipado `InsumoRow[]`) escriba y lea directamente `servicio.insumos`
  // sin ninguna conversión — nunca un tipo paralelo incompatible.
  valorUnitarioConIva: number;
  valorMensual: number;
}

export function calcularValorMensualInsumoServicio(insumo: InsumoServicioNoContinuo): number {
  const valorUnitarioConIva = calcularValorUnitarioConIva(insumo.valorUnitarioSinIva, insumo.ivaPorcentaje ?? IVA_INSUMOS_PORCENTAJE);
  return calcularValorMensualInsumo({ cantidad: insumo.cantidad, frecuenciaMeses: insumo.frecuenciaMeses, valorUnitarioConIva });
}

export function calcularTotalInsumosServicio(insumos: readonly InsumoServicioNoContinuo[]): number {
  return insumos.reduce((s, i) => s + calcularValorMensualInsumoServicio(i), 0);
}

/* ───────────────────────── Maquinaria y Equipos del servicio ───────────────────────── */

/** Ajuste "REUTILIZACIÓN REAL DE CATÁLOGOS" — MISMO tipo que
 * `MaquinariaEquipoRowNormalizado` global (nunca un tipo paralelo): el
 * modal "Gestionar maquinaria y equipos" (borrador tipado
 * `MaquinariaEquipoRow[]`, estructuralmente idéntico) escribe y lee
 * directamente `servicio.maquinariaEquipos` sin ninguna conversión. */
export type MaquinariaServicioNoContinuo = MaquinariaEquipoRowNormalizado;

/** Adquisición + mantenimiento, EXACTAMENTE como el total global
 * (`calcularTotalMensualMaquinariaEquipos`) — las filas ya traen sus
 * campos calculados (valorMesComprar/valorMesMantenimiento) porque
 * provienen del mismo modal/flujo que las filas globales. */
export function calcularTotalMaquinariaServicio(filas: readonly MaquinariaServicioNoContinuo[]): number {
  return calcularTotalMensualMaquinariaEquipos([...filas]);
}

/* ───────────────────────── Maquinaria y Equipos SNC — modelo Servicios Especializados ───────────────────────── */
// Ajuste "MAQUINARIA Y EQUIPOS SNC — MODELO SERVICIOS ESPECIALIZADOS" —
// bloque NUEVO e INDEPENDIENTE de `maquinariaEquipos` (arriba, modelo
// general de activos fijos): el catálogo de equipos utilizado dentro de
// SNC proviene de Servicios Especializados (Código/Nombre/Subtipo/Marca/
// Referencia/Valor día), un concepto distinto que NUNCA se mezcla con
// Cant. disponible/A comprar/Compra por mes/Mantenimiento/Valor con IVA
// (ver `equipos-especializados-snc.ts` para el tipo/fórmula/mock).
//
// Retrocompatibilidad: `maquinariaEquipos` (arriba) se CONSERVA sin
// ningún cambio — un servicio guardado antes de este ajuste sigue
// cargando y sumando exactamente igual (ver `calcularTotalesServicioNoContinuo`,
// que suma AMBOS bloques en el componente "maquinariaEquipos" de los
// totales). `equiposEspecializados` es opcional y arranca vacío — nunca
// se migran datos históricos hacia este campo (no hay forma segura de
// derivar código/subtipo/valor día especializados desde un registro de
// activo fijo general).

/* ───────────────────────── Otros costos del servicio ───────────────────────── */

/**
 * Ajuste "OTROS COSTOS DE SNC" — bloque independiente para conceptos que no
 * pertenecen a Mano de Obra/Insumos/Maquinaria (ej. transporte de equipos,
 * viáticos, alimentación, hospedaje, peajes). Estructura mínima, igual
 * forma que `ItemExamenMedicoServicioNoContinuo` (el precedente más
 * cercano de "concepto libre" dentro de este mismo archivo) — `total` es
 * SIEMPRE derivado, nunca almacenado, igual que el resto de bloques de
 * este módulo.
 *
 * Semántica de `frecuenciaMeses`: revisada explícitamente contra Insumos
 * (`calcularValorMensualInsumo`, `calculo-insumos.ts`) y Exámenes Médicos
 * (`calcularValorMensualItemExamenMedico`, arriba en este mismo archivo) —
 * en AMBOS, `frecuenciaMeses` es un DIVISOR ("cada cuántos meses se repite
 * la compra/gasto"), nunca un multiplicador. Otros Costos reutiliza
 * EXACTAMENTE esa misma convención — nunca una semántica nueva para
 * "Frec.". Sin IVA/AIU/tarifas Aseocolba: no existe ninguna regla
 * funcional existente que indique tratamiento tributario especial para
 * este bloque, así que no se inventa ninguna aquí.
 */
export interface OtroCostoServicioNoContinuo {
  id: number;
  concepto: string;
  cantidad: number;
  frecuenciaMeses: number;
  valorUnitario: number;
}

/** Misma fórmula que `calcularValorMensualItemExamenMedico`/
 * `calcularValorMensualInsumo`: cantidad × valorUnitario / frecuencia
 * (frecuencia ≤0 se trata como 1, nunca división por cero). */
export function calcularValorMensualOtroCostoServicio(item: OtroCostoServicioNoContinuo): number {
  const frecuencia = item.frecuenciaMeses > 0 ? item.frecuenciaMeses : 1;
  return (item.cantidad * item.valorUnitario) / frecuencia;
}

export function calcularTotalOtrosCostosServicio(items: readonly OtroCostoServicioNoContinuo[]): number {
  return items.reduce((s, i) => s + calcularValorMensualOtroCostoServicio(i), 0);
}

/** Ajuste "CARGO MANUAL DE SNC" — cargo de Mano de Obra dentro de un
 * Servicio No Continuo, cuando el servicio no usa tarifa Aseocolba (SIN
 * tarifario automático — el catálogo/tarifario de Vigicolba NUNCA se
 * conecta aquí, ver `tarifa-regulada-vigicolba.ts`, pestaña propia,
 * independiente del SNC). Representa EXCLUSIVAMENTE el costo interno de
 * ese componente: cuánto le cuesta a COLBA prestarlo — nunca un valor de
 * oferta ni una tarifa regulada.
 *
 * Fórmula: `cantidad × días × valorUnitario` — ningún otro modelo de este
 * archivo usa ya esta combinación (Insumos/Exámenes/Otros Costos usan
 * cantidad×valorUnitario ÷ frecuenciaMeses, un divisor de recurrencia,
 * semánticamente distinto de "días trabajados", que es un MULTIPLICADOR).
 * Por eso es la fórmula canónica propia de este concepto, no una segunda
 * fórmula paralela a algo que ya existiera. */
export interface CargoManualServicioNoContinuo {
  id: number;
  nombreCargo: string;
  cantidad: number;
  dias: number;
  valorUnitario: number;
}

export function calcularCostoInternoCargoManualServicio(cargo: CargoManualServicioNoContinuo): number {
  return cargo.cantidad * cargo.dias * cargo.valorUnitario;
}
export function calcularTotalCostoInternoCargosManualesServicio(cargos: readonly CargoManualServicioNoContinuo[]): number {
  return cargos.reduce((s, c) => s + calcularCostoInternoCargoManualServicio(c), 0);
}

/* ───────────────────────── Servicio no continuo (unidad completa) ───────────────────────── */

/** Ajuste "SERVICIOS NO CONTINUOS — FASE 1: CATÁLOGO ASEOCOLBA" —
 * identidad del servicio cuando proviene del catálogo externo
 * (`POST /service/public/api/no_continuos`, ver `buscarServiciosNoContinuos`
 * en `@/lib/servicios-no-continuos-buscar`). TODOS opcionales — un
 * `ServicioNoContinuo` antiguo (guardado antes de esta fase) no tiene
 * ninguno de estos campos y debe seguir cargando sin errores (nunca se
 * exige `codigo` para que el servicio sea válido). `origen==='MANUAL'` es
 * la misma señal ya usada en `InsumoServicioNoContinuo` — un servicio sin
 * `origen` explícito (dato antiguo) se trata como manual, nunca se asume
 * catálogo. `empresaCatalogo` es la `empresa` que trae CADA registro de la
 * fuente externa — se guarda tal cual, nunca se asume igual a la empresa
 * del proceso (`empresaProceso`/`empresaExterna` en page.tsx). */
/** Ajuste "SERVICIOS NO CONTINUOS — FASE 2 MVP: TARIFARIO ASEOCOLBA" —
 * `tipoCalculo` discrimina el motor económico del servicio. AUSENTE
 * (`undefined`) equivale exactamente a `'ESTRUCTURA_COSTOS'` — todo dato
 * guardado antes de esta fase sigue calculando IGUAL, sin migración. Los 5
 * bloques históricos (manoObra/dotacionEpp/examenesMedicos/insumos/
 * maquinariaEquipos) se CONSERVAN en el tipo por retrocompatibilidad, pero
 * un servicio `TARIFA_ASEOCOLBA` nunca los puebla ni los usa para calcular
 * (ver `calcularTotalesServicioNoContinuo`).
 *
 * Ajuste "FASE A: MÚLTIPLES CARGOS/TARIFAS ASEOCOLBA POR SERVICIO" — un
 * servicio `TARIFA_ASEOCOLBA` ahora puede tener VARIOS cargos/tarifas
 * simultáneos (`tarifas[]`, ej. Operario Todero × 2 + Coordinador × 1),
 * cada uno independiente (propio `tarifaKey`/cargo/modalidad/cantidad/AIU).
 * `tarifa` (singular) se CONSERVA solo por retrocompatibilidad de lectura —
 * un servicio guardado antes de este ajuste trae `tarifa` y NUNCA `tarifas`;
 * `tarifasServicio(servicio)` es el ÚNICO punto de lectura correcto (nunca
 * leer `servicio.tarifa`/`servicio.tarifas` directamente fuera de esta
 * función), normaliza ambos formatos a un arreglo sin exigir migración de
 * datos. Nada nuevo escribe `tarifa` singular a partir de este ajuste, pero
 * el campo no se elimina del tipo para no romper datos ya persistidos. */
export interface ServicioNoContinuo {
  id: string;
  descripcion: string;
  origen?: 'CATALOGO' | 'MANUAL';
  codigo?: string;
  empresaCatalogo?: string;
  undneg?: string;
  tipoCalculo?: 'TARIFA_ASEOCOLBA' | 'ESTRUCTURA_COSTOS';
  /** @deprecated Formato antiguo (una sola tarifa). Se conserva solo por
   * retrocompatibilidad de lectura — usar `tarifas` para escribir. Leer
   * siempre a través de `tarifasServicio(servicio)`, nunca este campo
   * directamente. */
  tarifa?: TarifaServicioAseocolba;
  /** Formato vigente — 0/1/N cargos/tarifas del servicio. Leer siempre a
   * través de `tarifasServicio(servicio)`. */
  tarifas?: TarifaServicioAseocolba[];
  manoObra: LineaMOExtra[];
  /** Ajuste "CARGO MANUAL DE SNC" — cargos manuales (Cargo/Cantidad/Días/
   * Valor unitario) para servicios sin tarifa automática demostrable
   * (hoy, los 3 SNC de Vigicolba). Opcional — un servicio guardado antes
   * de este ajuste no lo trae y debe seguir cargando sin errores (`??[]`
   * en todo lector, nunca se exige). Coexiste con `manoObra` (LineaMOExtra),
   * nunca lo reemplaza: el total de Mano de Obra del servicio suma AMBOS
   * (ver page.tsx, cálculo de `totalManoObraBorrador`) para no perder
   * ningún dato histórico que ya estuviera en `manoObra`. */
  cargosManuales?: CargoManualServicioNoContinuo[];
  dotacionEpp: DotGroup[];
  examenesMedicos: ExamenesMedicosServicioNoContinuo;
  insumos: InsumoServicioNoContinuo[];
  maquinariaEquipos: MaquinariaServicioNoContinuo[];
  /** Ajuste "MAQUINARIA Y EQUIPOS SNC — MODELO SERVICIOS ESPECIALIZADOS" —
   * bloque INDEPENDIENTE de `maquinariaEquipos` (arriba, modelo general de
   * activos fijos): equipos tomados del catálogo de Servicios
   * Especializados (`GET equipos/obtener_espec`), valorados por día
   * (`cantidad×numeroDias×valorDia`), nunca mezclados con Cant.
   * disponible/A comprar/Mantenimiento/IVA/Depreciación del modelo
   * general. Opcional — un servicio guardado antes de este ajuste no lo
   * trae y sigue cargando sin errores (`??[]` en todo lector, nunca se
   * exige ni se migra). Su total participa UNA sola vez, sumado dentro
   * del mismo componente `maquinariaEquipos` de `TotalesServicioNoContinuo`
   * (ver `calcularTotalesServicioNoContinuo`) — nunca un total aparte que
   * pudiera duplicarse en el resumen/exportación. */
  equiposEspecializados?: EquipoEspecializadoServicioNoContinuo[];
  /** Ajuste "OTROS COSTOS DE SNC" — opcional, igual criterio que `tarifas`:
   * un servicio guardado antes de este ajuste no trae el campo y debe
   * seguir cargando sin errores (nunca se exige, nunca se migra). Leer
   * siempre con `servicio.otrosCostos ?? []`, nunca asumir presente. */
  otrosCostos?: OtroCostoServicioNoContinuo[];
  /**
   * Ajuste "FRECUENCIA GLOBAL DEL SERVICIO" (decisión explícita del
   * usuario, confirmada en vivo vía AskUserQuestion) — campo único, visible
   * dentro del bloque "Otros costos" del modal, que divide el TOTAL
   * COMPLETO del servicio (manoObra+dotacionEpp+examenesMedicos+insumos+
   * maquinariaEquipos+otrosCostos, o totalCargos+insumos+maquinariaEquipos+
   * otrosCostos en TARIFA_ASEOCOLBA) — NUNCA solo Otros Costos. Mismo
   * patrón que "Duración del contrato" en Pólizas (Total de pólizas ÷
   * duración = Valor mensual de pólizas). Ausente/≤0 se trata como 1
   * (retrocompatible — ningún servicio histórico cambia su total).
   *
   * Ajuste "CATÁLOGO OFICIAL DE FRECUENCIAS EN SNC" — este campo queda
   * CONGELADO (nunca más se escribe desde la UI) el día que se introduce
   * `frecuenciaServicioCodigo`: reinterpretar sus valores como códigos del
   * catálogo sería peligroso para históricos fuera de 1..12 (13/14/15 NO
   * son "13/14/15 meses"). Sigue existiendo solo como fallback de lectura
   * para servicios guardados antes del catálogo — ver
   * `resolverDivisorFrecuenciaServicio`. */
  frecuenciaServicioMeses?: number;
  /** Ajuste "CATÁLOGO OFICIAL DE FRECUENCIAS EN SNC" — reemplaza
   * `frecuenciaServicioMeses` como ÚNICO campo que la UI escribe desde
   * ahora: mismo catálogo de 15 frecuencias que `frecuenciaValorAgregado`
   * (reutiliza literalmente `FrecuenciaValorAgregado`/
   * `FRECUENCIAS_VALOR_AGREGADO`/`resolverFactorPeriodicidadValorAgregado`
   * de `valor-agregado.ts` — sin duplicar catálogo ni lógica). Sigue
   * dividiendo el TOTAL COMPLETO del servicio, exactamente el mismo punto
   * de división que antes (`calcularTotalesServicioNoContinuo`), nunca dos
   * veces. Ausente ⇒ se resuelve por `resolverDivisorFrecuenciaServicio`
   * (retrocompatibilidad con `frecuenciaServicioMeses`). */
  frecuenciaServicioCodigo?: FrecuenciaValorAgregado;
  /** Ajuste "VALOR AGREGADO — 5 TIPOS CONSOLIDADOS" — la unidad VA tipo
   * "Servicios No Continuos" es el SERVICIO COMPLETO (no una sub-línea
   * interna): `true` traslada `calcularTotalesServicioNoContinuo(...).total`
   * del subtotal de SNC al subtotal de Valor Agregado, nunca ambos (ver
   * `particionarPorValorAgregado` en `valor-agregado.ts`). Histórico sin
   * este campo ⇒ `false`. */
  esValorAgregado?: boolean;
  frecuenciaValorAgregado?: FrecuenciaValorAgregado;
}

/** Único punto de lectura de "las tarifas de este servicio" — normaliza el
 * formato nuevo (`tarifas[]`) y el antiguo (`tarifa` singular,
 * retrocompatibilidad) a un mismo arreglo. `tarifas` tiene prioridad si
 * ambos existieran (no debería pasar en la práctica: nada escribe los dos
 * a la vez). Arreglo vacío = servicio sin tarifa asignada (mismo caso que
 * `tarifa===undefined` en el formato antiguo). */
export function tarifasServicio(servicio: ServicioNoContinuo): TarifaServicioAseocolba[] {
  if (servicio.tarifas) return servicio.tarifas;
  return servicio.tarifa ? [servicio.tarifa] : [];
}

export interface DatosServiciosNoContinuos {
  servicios: ServicioNoContinuo[];
}

/** Corrección "AUDITORÍA FASE 1 §3" — el contrato de `/no_continuos` NO
 * garantiza que `codigo` sea único a nivel global (podría repetirse entre
 * empresas o unidades de negocio distintas); esta clave SOLO identifica
 * la opción dentro del `<select>` de la UI — nunca se persiste como tal en
 * `ServicioNoContinuo` (que sigue guardando codigo/empresaCatalogo/undneg
 * por separado). Acepta tanto un registro del catálogo (`empresa`) como un
 * `ServicioNoContinuo` ya seleccionado (`empresaCatalogo`, ver el segundo
 * overload de uso en page.tsx). */
export function claveOpcionServicioNoContinuo(item: { codigo?: string; empresa?: string; undneg?: string }): string {
  return [item.empresa ?? '', item.undneg ?? '', item.codigo ?? ''].join('::');
}

export function crearServicioNoContinuoVacio(id: string, descripcion = '', tipoCalculo?: ServicioNoContinuo['tipoCalculo']): ServicioNoContinuo {
  return {
    id, descripcion,
    ...(tipoCalculo ? { tipoCalculo } : {}),
    manoObra: [], cargosManuales: [], dotacionEpp: [],
    examenesMedicos: { examenes: [], cursos: [], vacunas: [] },
    insumos: [], maquinariaEquipos: [], equiposEspecializados: [], otrosCostos: [],
  };
}

/** Ajuste "CATÁLOGO OFICIAL DE FRECUENCIAS EN SNC" — sugiere qué código
 * preseleccionar en el `<select>` de frecuencia al abrir/editar un
 * servicio (NUNCA persiste nada por sí sola, solo decide qué mostrar):
 *  - `frecuenciaServicioCodigo` ya presente → ese mismo código.
 *  - Sin código, pero `frecuenciaServicioMeses` legado entero en 1..12 →
 *    el MISMO número como código (divisor idéntico bajo ambas semánticas,
 *    MENSUAL..ANUAL literalmente "cada N meses" para N=1..12 — cero
 *    riesgo de reinterpretación).
 *  - Servicio nuevo (`frecuenciaServicioMeses` ausente) → 1 (MENSUAL),
 *    mismo default histórico que ya aplicaba el fallback ausente/≤0.
 *  - Legado AMBIGUO (`frecuenciaServicioMeses` presente pero fuera de
 *    1..12 — p. ej. 0, o cualquier valor no entero o mayor a 12) →
 *    `undefined` (sin preselección): el usuario debe elegir
 *    explícitamente antes de poder guardar (ver page.tsx, mismo patrón de
 *    botón deshabilitado que ya usa Valor Agregado) — nunca se asume una
 *    interpretación de un valor que no coincide 1:1 con el catálogo. */
export function sugerirFrecuenciaServicioCodigo(
  servicio: Pick<ServicioNoContinuo, 'frecuenciaServicioCodigo' | 'frecuenciaServicioMeses'>,
): FrecuenciaValorAgregado | undefined {
  if (servicio.frecuenciaServicioCodigo != null) return servicio.frecuenciaServicioCodigo;
  const meses = servicio.frecuenciaServicioMeses;
  if (meses == null) return 1;
  if (Number.isInteger(meses) && meses >= 1 && meses <= 12) return meses as FrecuenciaValorAgregado;
  return undefined;
}

/** Ajuste "CATÁLOGO OFICIAL DE FRECUENCIAS EN SNC" — único punto de
 * cálculo del DIVISOR efectivo del servicio, usado por
 * `calcularTotalesServicioNoContinuo`. Prioridad: `frecuenciaServicioCodigo`
 * (nuevo catálogo, vía `resolverFactorPeriodicidadValorAgregado` — mismo
 * helper que Valor Agregado, sin duplicar tabla) → si ausente, el
 * comportamiento LEGADO exacto de `frecuenciaServicioMeses` (número de
 * meses tal cual, ausente/≤0 ⇒ 1) — nunca reinterpreta un valor legado
 * ambiguo (13+, no entero) como código. */
function resolverDivisorFrecuenciaServicio(servicio: Pick<ServicioNoContinuo, 'frecuenciaServicioCodigo' | 'frecuenciaServicioMeses'>): number {
  if (servicio.frecuenciaServicioCodigo != null) return resolverFactorPeriodicidadValorAgregado(servicio.frecuenciaServicioCodigo);
  return servicio.frecuenciaServicioMeses && servicio.frecuenciaServicioMeses > 0 ? servicio.frecuenciaServicioMeses : 1;
}

export interface TotalesServicioNoContinuo {
  manoObra: number;
  dotacionEpp: number;
  examenes: number;
  cursos: number;
  vacunas: number;
  totalExamenesMedicos: number;
  insumos: number;
  maquinariaEquipos: number;
  /** Ajuste "OTROS COSTOS DE SNC" — igual que insumos/maquinariaEquipos: se
   * suma en AMBAS ramas (histórica y TARIFA_ASEOCOLBA), nunca solo una. */
  otrosCostos: number;
  /** Ajuste "FRECUENCIA GLOBAL DEL SERVICIO" — suma de todos los bloques
   * ANTES de dividir por `frecuenciaServicioMeses` (mismo rol que "Total
   * de pólizas" antes de "Valor mensual de pólizas"). `total` (abajo) YA
   * es el valor dividido — nunca recalcular la división por fuera de esta
   * función. */
  subtotalAntesFrecuencia: number;
  /** Divisor de frecuencia ya resuelto (ver `resolverDivisorFrecuenciaServicio`)
   * — expuesto para que la UI lo muestre sin tener que resolverlo de
   * nuevo. Puede ser fraccionario (QUINCENAL=0.5, SEMANAL=0.433). */
  frecuenciaServicioMeses: number;
  /** Código del catálogo oficial (1-15) si el servicio ya lo tiene
   * asignado (nuevo o migrado), `null` si sigue en semántica legada pura
   * de `frecuenciaServicioMeses` — la UI usa esto para decidir si muestra
   * la etiqueta del catálogo o "{N} meses". */
  frecuenciaServicioCodigo: FrecuenciaValorAgregado | null;
  total: number;
  // Ajuste "FASE 2 MVP: TARIFARIO ASEOCOLBA" — SOLO poblados cuando
  // `servicio.tipoCalculo==='TARIFA_ASEOCOLBA'`; `undefined` en el cálculo
  // histórico (ESTRUCTURA_COSTOS), que nunca los toca.
  tarifaValida?: boolean;
  tarifaMotivoInvalido?: string;
  tarifaValorBase?: number;
  tarifaPorcentajeAIU?: number;
  tarifaValorUnitarioConAIU?: number;
  /** Ajuste "boton editable del AIU... marcar si aplica o no" — pasarela
   * de `ResultadoCalculoTarifaAseocolba.aplicaAiu`/`valorUnitarioAplicado`. */
  tarifaAplicaAiu?: boolean;
  tarifaValorUnitarioAplicado?: number;
  /** Ajuste "TOTAL MANO DE OBRA DEL SERVICIO MOSTRABA UN NEGATIVO" — suma
   * BRUTA de los `r.total` de cada cargo de la tarifa (`totalCargos`), ANTES
   * de dividir por frecuencia y SIN mezclar insumos/maquinaria/otros costos.
   * Es EXACTAMENTE la suma de las filas de cargos que ve el usuario en la
   * grilla "Mano de obra del servicio". Antes la UI la derivaba mal como
   * `total - insumos - maquinariaEquipos` (mezclaba una cifra ya dividida
   * por frecuencia con cifras sin dividir → valores negativos). `manoObra`
   * sigue en 0 en esta rama (la tarifa reemplaza el detalle histórico de
   * MO); este campo es SOLO para mostrar el subtotal real de cargos.
   * `undefined` en la rama histórica (ESTRUCTURA_COSTOS), que usa `manoObra`. */
  tarifaTotalCargos?: number;
}

/** Total del servicio — NUNCA incluye Costos Administrativos (Pólizas/
 * Impuestos/Garantías siguen siendo únicos por proceso, decisión
 * explícita del usuario).
 *
 * Ajuste "FASE 2 MVP: TARIFARIO ASEOCOLBA" — bifurca EXCLUSIVAMENTE por
 * `tipoCalculo`. Cuando es `'TARIFA_ASEOCOLBA'`, Mano de Obra/EPP/Exámenes
 * vienen SIEMPRE del motor puro `calcularTarifaServicioAseocolba` (archivo
 * propio `tarifario-especiales-aseocolba.ts`) — esos 3 bloques históricos
 * NUNCA se leen ni se suman en esa rama. Ajuste "agregale aca dos bloques
 * uno que sea para agregar insumos y otra para agregar maquinaria y
 * equipos" — Insumos y Maquinaria son la EXCEPCIÓN: siguen siendo bloques
 * propios editables (reutilizan `calcularTotalInsumosServicio`/
 * `calcularTotalMaquinariaServicio`, MISMA fórmula que la rama histórica)
 * y su total SÍ se suma al total del servicio también en
 * `TARIFA_ASEOCOLBA`. En cualquier otro caso (ausente o
 * `'ESTRUCTURA_COSTOS'`) se ejecuta EXACTAMENTE el cálculo histórico, sin
 * ningún cambio de fórmula.
 *
 * Ajuste "FASE A: MÚLTIPLES CARGOS/TARIFAS ASEOCOLBA POR SERVICIO" — la
 * rama `TARIFA_ASEOCOLBA` ya no calcula UNA tarifa: lee `tarifasServicio
 * (servicio)` (0/1/N, normaliza el formato antiguo `tarifa` singular) y
 * llama `calcularTarifaServicioAseocolba` UNA VEZ POR CADA entrada — cada
 * tarifa calcula su propio AIU de forma independiente (mismo motor de
 * siempre, sin cambios), y el total de cargos es la SUMA de esos `total`
 * ya-con-su-AIU-propio — nunca se vuelve a aplicar un AIU global sobre la
 * suma (eso duplicaría el cobro). `tarifaValida` es `true` solo si TODAS
 * las tarifas son válidas (una sola inválida bloquea el guardado del
 * servicio, igual que antes). Los campos singulares
 * (`tarifaValorBase`/`tarifaPorcentajeAIU`/etc.) solo se poblan cuando hay
 * EXACTAMENTE 0 o 1 tarifa — es el mismo caso que existía antes de este
 * ajuste, byte a byte igual (requisito de retrocompatibilidad); con 2+
 * tarifas esos campos quedan `undefined` porque no hay UN solo valor que
 * representarlos (el desglose por tarifa es responsabilidad de la UI, Fase
 * B — no de este cálculo).
 *
 * `totalManoObraServicio` viene YA CALCULADO por el llamador (page.tsx),
 * con el MISMO motor pesado que Mano de Obra principal/Turnantes (ver
 * nota del encabezado del archivo) — este módulo puro no puede
 * recalcularlo porque ese motor depende de festivos/metodología de
 * costeo, que solo existen como estado de `ModuloEstructuraCostos`.
 * Ignorado por completo en la rama `TARIFA_ASEOCOLBA`. */
export function calcularTotalesServicioNoContinuo(
  servicio: ServicioNoContinuo,
  totalManoObraServicio: number,
): TotalesServicioNoContinuo {
  // Ajuste "FRECUENCIA GLOBAL DEL SERVICIO" / "CATÁLOGO OFICIAL DE
  // FRECUENCIAS EN SNC" — resuelta UNA vez, aplicada al final sobre el
  // subtotal completo (mismo orden que Pólizas: total bruto → ÷ duración
  // → valor mensual), en AMBAS ramas.
  const frecuenciaServicioMeses = resolverDivisorFrecuenciaServicio(servicio);
  const frecuenciaServicioCodigo = servicio.frecuenciaServicioCodigo ?? null;
  if (servicio.tipoCalculo === 'TARIFA_ASEOCOLBA') {
    const tarifas = tarifasServicio(servicio);
    const resultados = tarifas.length > 0
      ? tarifas.map(t => calcularTarifaServicioAseocolba(t, buscarTarifaCatalogoAseocolba(t.tarifaKey)))
      : [calcularTarifaServicioAseocolba(undefined, null)];
    const totalCargos = resultados.reduce((s, r) => s + r.total, 0);
    const valido = resultados.every(r => r.valido);
    const primerInvalido = resultados.find(r => !r.valido);
    // Ajuste "agregale aca dos bloques uno que sea para agregar insumos y
    // otra para agregar maquinaria y equipos" — a diferencia de Mano de
    // Obra/EPP/Exámenes (que la tarifa Aseocolba SÍ reemplaza por
    // completo), Insumos y Maquinaria siguen siendo bloques propios
    // editables también en TARIFA_ASEOCOLBA — reutilizan EXACTAMENTE las
    // mismas funciones puras que la rama histórica, nunca una fórmula
    // paralela, y su total SÍ se suma al total del servicio, UNA sola vez
    // (nunca por cargo).
    const insumos = calcularTotalInsumosServicio(servicio.insumos);
    // Ajuste "MAQUINARIA Y EQUIPOS SNC — MODELO SERVICIOS ESPECIALIZADOS"
    // — se suma DENTRO del mismo componente `maquinariaEquipos` (nunca un
    // campo aparte): participa una sola vez en el total del servicio, en
    // el resumen consolidado y en cualquier exportación que lea este
    // mismo campo, sin duplicar el costo.
    const maquinariaEquipos = calcularTotalMaquinariaServicio(servicio.maquinariaEquipos) + calcularTotalEquiposEspecializadosServicio(servicio.equiposEspecializados ?? []);
    const otrosCostos = calcularTotalOtrosCostosServicio(servicio.otrosCostos ?? []);
    const unaTarifa = tarifas.length <= 1 ? resultados[0] : undefined;
    const subtotalAntesFrecuenciaAseo = totalCargos + insumos + maquinariaEquipos + otrosCostos;
    return {
      manoObra: 0, dotacionEpp: 0, examenes: 0, cursos: 0, vacunas: 0, totalExamenesMedicos: 0, insumos, maquinariaEquipos, otrosCostos,
      subtotalAntesFrecuencia: subtotalAntesFrecuenciaAseo, frecuenciaServicioMeses, frecuenciaServicioCodigo,
      total: subtotalAntesFrecuenciaAseo / frecuenciaServicioMeses,
      // Subtotal real de los cargos de la tarifa — lo que la UI debe mostrar
      // como "TOTAL MANO DE OBRA DEL SERVICIO" (ver comentario del campo en
      // la interfaz). Nunca participa de `total`/`subtotalAntesFrecuencia`.
      tarifaTotalCargos: totalCargos,
      tarifaValida: valido, tarifaMotivoInvalido: primerInvalido?.motivoInvalido,
      tarifaValorBase: unaTarifa?.valorBase, tarifaPorcentajeAIU: unaTarifa?.porcentajeAIU, tarifaValorUnitarioConAIU: unaTarifa?.valorUnitarioConAIU,
      tarifaAplicaAiu: unaTarifa?.aplicaAiu, tarifaValorUnitarioAplicado: unaTarifa?.valorUnitarioAplicado,
    };
  }
  const manoObra = totalManoObraServicio;
  const dotacionEpp = calcularTotalDotacionEppServicio(servicio.dotacionEpp);
  const { totalExamenes, totalCursos, totalVacunas, totalExamenesMedicos } = calcularTotalesExamenesMedicosServicio(servicio.examenesMedicos);
  const insumos = calcularTotalInsumosServicio(servicio.insumos);
  // Ajuste "MAQUINARIA Y EQUIPOS SNC — MODELO SERVICIOS ESPECIALIZADOS" —
  // mismo criterio ya aplicado más arriba en este archivo (la otra rama
  // de cálculo): se suma DENTRO del mismo componente `maquinariaEquipos`,
  // una sola vez.
  const maquinariaEquipos = calcularTotalMaquinariaServicio(servicio.maquinariaEquipos) + calcularTotalEquiposEspecializadosServicio(servicio.equiposEspecializados ?? []);
  const otrosCostos = calcularTotalOtrosCostosServicio(servicio.otrosCostos ?? []);
  const subtotalAntesFrecuencia = manoObra + dotacionEpp + totalExamenesMedicos + insumos + maquinariaEquipos + otrosCostos;
  return {
    manoObra, dotacionEpp,
    examenes: totalExamenes, cursos: totalCursos, vacunas: totalVacunas, totalExamenesMedicos,
    insumos, maquinariaEquipos, otrosCostos,
    subtotalAntesFrecuencia, frecuenciaServicioMeses, frecuenciaServicioCodigo,
    total: subtotalAntesFrecuencia / frecuenciaServicioMeses,
  };
}

/** Total consolidado de TODOS los servicios — nunca ingresado
 * manualmente, siempre derivado. `totalesManoObraPorServicio` trae el
 * total de Mano de Obra YA CALCULADO de cada servicio (por `servicio.id`,
 * ver nota de `calcularTotalesServicioNoContinuo`); un servicio ausente
 * del mapa se trata como 0 (nunca lanza). */
export function calcularTotalServiciosNoContinuos(
  servicios: readonly ServicioNoContinuo[],
  totalesManoObraPorServicio: ReadonlyMap<string, number>,
): number {
  return servicios.reduce((s, srv) => s + calcularTotalesServicioNoContinuo(srv, totalesManoObraPorServicio.get(srv.id) ?? 0).total, 0);
}

/** Un servicio "tiene datos" si al menos uno de sus 5 bloques tiene al
 * menos un registro — usado para decidir si `NO_APLICA` requiere
 * confirmación (nunca borra nada silenciosamente). Ajuste "FASE 2 MVP" —
 * un servicio `TARIFA_ASEOCOLBA` nunca puebla esos 5 bloques (por diseño);
 * para ese caso "tiene datos" es tener al menos una tarifa asignada
 * (ajuste "FASE A" — `tarifasServicio` normaliza `tarifas[]`/`tarifa`). */
export function servicioNoContinuoTieneDatos(servicio: ServicioNoContinuo): boolean {
  // Mismo criterio ya vigente para insumos/maquinariaEquipos en esta rama
  // (no cuentan por sí solos sin una tarifa asignada) — otrosCostos sigue
  // exactamente esa misma exclusión aquí, nunca una regla nueva/asimétrica
  // respecto a esos dos bloques hermanos.
  if (servicio.tipoCalculo === 'TARIFA_ASEOCOLBA') return tarifasServicio(servicio).length > 0;
  return servicio.manoObra.length > 0 || (servicio.cargosManuales ?? []).length > 0 || servicio.dotacionEpp.some(g => g.rows.length > 0)
    || servicio.examenesMedicos.examenes.length > 0 || servicio.examenesMedicos.cursos.length > 0 || servicio.examenesMedicos.vacunas.length > 0
    || servicio.insumos.length > 0 || servicio.maquinariaEquipos.length > 0 || (servicio.equiposEspecializados ?? []).length > 0 || (servicio.otrosCostos ?? []).length > 0;
}

/** El módulo completo "tiene datos" si existe al menos un servicio con al
 * menos una descripción diligenciada — un servicio recién creado sin
 * ningún bloque ni descripción no cuenta como dato real. */
export function serviciosNoContinuosTienenDatos(servicios: readonly ServicioNoContinuo[]): boolean {
  return servicios.some(s => s.descripcion.trim().length > 0 || servicioNoContinuoTieneDatos(s));
}
