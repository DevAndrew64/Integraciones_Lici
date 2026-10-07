/**
 * Catálogo de parámetros (§12 diagnóstico previo + §2 grupos) y semilla de
 * perfiles normativos vigentes a julio de 2026 — la fuente única de
 * definiciones; NUNCA se lee el valor de un parámetro desde aquí
 * directamente, siempre vía `resolverParametro()` (resolver-parametros.ts).
 *
 * Los 3 valores derivados (extraFestivaDiurna/extraFestivaNocturna/
 * recargoNocturnoFestivo) usan la convención "recargo adicional" (no
 * "factor total") — ver nota de reconciliación en AUDITORIA_CONSTANTES
 * más abajo: el motor comercial activo (`motor-comercial-30-dias.ts`)
 * usa factor total (1 + adicional) para sus 4 factores dominicales/
 * festivos, así que estos valores derivados NO son intercambiables 1:1
 * con los del motor sin sumar 1 — documentado, no corregido (Fase 2 en
 * adelante, fuera de alcance de esta entrega).
 */
import type { DefinicionParametro, PerfilNormativoParametro } from './tipos';

export const CATALOGO_PARAMETROS: DefinicionParametro[] = [
  // ── 1. Jornada y recargos ────────────────────────────────────────────
  {
    id: 'jornada.semanalMaxima',
    grupo: 'JORNADA_Y_RECARGOS',
    nombre: 'Jornada máxima semanal',
    descripcion: 'Horas semanales máximas de la jornada ordinaria vigente (Ley 2101/2021).',
    unidad: 'HORAS',
    valorTecnicoRespaldo: 42,
  },
  {
    id: 'jornada.horaInicioNocturno',
    grupo: 'JORNADA_Y_RECARGOS',
    nombre: 'Hora de inicio de la franja nocturna',
    descripcion: 'Hora (0-23) a partir de la cual una hora trabajada se considera nocturna.',
    unidad: 'ADIMENSIONAL',
    valorTecnicoRespaldo: 19,
  },
  {
    id: 'jornada.horaFinNocturno',
    grupo: 'JORNADA_Y_RECARGOS',
    nombre: 'Hora de fin de la franja nocturna',
    descripcion: 'Hora (0-23) hasta la cual una hora trabajada se considera nocturna.',
    unidad: 'ADIMENSIONAL',
    valorTecnicoRespaldo: 6,
  },
  {
    id: 'jornada.recargoNocturno',
    grupo: 'JORNADA_Y_RECARGOS',
    nombre: 'Recargo nocturno',
    descripcion: 'Recargo adicional sobre la hora ordinaria por trabajo en franja nocturna.',
    unidad: 'PORCENTAJE',
    valorTecnicoRespaldo: 0.35,
  },
  {
    id: 'jornada.extraDiurna',
    grupo: 'JORNADA_Y_RECARGOS',
    nombre: 'Recargo hora extra diurna',
    descripcion: 'Recargo adicional sobre la hora ordinaria por hora extra diurna.',
    unidad: 'PORCENTAJE',
    valorTecnicoRespaldo: 0.25,
  },
  {
    id: 'jornada.extraNocturna',
    grupo: 'JORNADA_Y_RECARGOS',
    nombre: 'Recargo hora extra nocturna',
    descripcion: 'Recargo adicional sobre la hora ordinaria por hora extra nocturna.',
    unidad: 'PORCENTAJE',
    valorTecnicoRespaldo: 0.75,
  },
  {
    id: 'jornada.recargoDescansoObligatorio',
    grupo: 'JORNADA_Y_RECARGOS',
    nombre: 'Recargo por descanso obligatorio/festivo',
    descripcion: 'Recargo adicional sobre la hora ordinaria por trabajo en domingo o festivo (Ley 2466/2025 art.14).',
    unidad: 'PORCENTAJE',
    valorTecnicoRespaldo: 0.90,
  },
  {
    id: 'jornada.extraFestivaDiurna',
    grupo: 'JORNADA_Y_RECARGOS',
    nombre: 'Recargo hora extra festiva diurna (derivado)',
    descripcion: 'Nunca editar suelto salvo modo avanzado justificado — se deriva siempre de recargoDescansoObligatorio + extraDiurna.',
    unidad: 'PORCENTAJE',
    derivadoAutomaticamente: true,
    formulaDerivacion: 'recargoDescansoObligatorio + extraDiurna',
    valorTecnicoRespaldo: 1.15,
  },
  {
    id: 'jornada.extraFestivaNocturna',
    grupo: 'JORNADA_Y_RECARGOS',
    nombre: 'Recargo hora extra festiva nocturna (derivado)',
    descripcion: 'Nunca editar suelto salvo modo avanzado justificado — se deriva siempre de recargoDescansoObligatorio + extraNocturna.',
    unidad: 'PORCENTAJE',
    derivadoAutomaticamente: true,
    formulaDerivacion: 'recargoDescansoObligatorio + extraNocturna',
    valorTecnicoRespaldo: 1.65,
  },
  {
    id: 'jornada.recargoNocturnoFestivo',
    grupo: 'JORNADA_Y_RECARGOS',
    nombre: 'Recargo nocturno festivo (derivado)',
    descripcion: 'Nunca editar suelto salvo modo avanzado justificado — se deriva siempre de recargoDescansoObligatorio + recargoNocturno.',
    unidad: 'PORCENTAJE',
    derivadoAutomaticamente: true,
    formulaDerivacion: 'recargoDescansoObligatorio + recargoNocturno',
    valorTecnicoRespaldo: 1.25,
  },

  // ── 2. Mensualización comercial ──────────────────────────────────────
  {
    id: 'mensualizacion.diasComercialesMes',
    grupo: 'MENSUALIZACION_COMERCIAL',
    nombre: 'Días comerciales por mes',
    descripcion: 'Base comercial de 30 días (metodología COMERCIAL_30_DIAS).',
    unidad: 'DIAS',
    valorTecnicoRespaldo: 30,
  },
  {
    id: 'mensualizacion.diasOrdinariosPromedioMes',
    grupo: 'MENSUALIZACION_COMERCIAL',
    nombre: 'Días ordinarios promedio por mes',
    descripcion: 'Promedio fijo de días ordinarios/mes usado por el método comercial (24,08 + 5,92 = 30,00).',
    unidad: 'DIAS',
    valorTecnicoRespaldo: 24.08,
  },
  {
    id: 'mensualizacion.domingosFestivosPromedioMes',
    grupo: 'MENSUALIZACION_COMERCIAL',
    nombre: 'Domingos/festivos promedio por mes',
    descripcion: 'Promedio fijo de domingos/festivos por mes usado por el método comercial.',
    unidad: 'DIAS',
    valorTecnicoRespaldo: 5.92,
  },
  {
    id: 'mensualizacion.divisorHoraMensual',
    grupo: 'MENSUALIZACION_COMERCIAL',
    nombre: 'Divisor de hora mensual',
    descripcion: 'Divisor usado para obtener el valor hora a partir del salario mensual.',
    unidad: 'HORAS',
    valorTecnicoRespaldo: 210,
  },

  // ── 3. Seguridad social ───────────────────────────────────────────────
  {
    id: 'seguridadSocial.porcentajeSalud',
    grupo: 'SEGURIDAD_SOCIAL',
    nombre: 'Salud (aporte patronal)',
    descripcion: 'Porcentaje de salud sobre el IBC.',
    unidad: 'PORCENTAJE',
    valorTecnicoRespaldo: 0.085,
  },
  {
    id: 'seguridadSocial.porcentajePension',
    grupo: 'SEGURIDAD_SOCIAL',
    nombre: 'Pensión',
    descripcion: 'Porcentaje de pensión sobre el IBC.',
    unidad: 'PORCENTAJE',
    valorTecnicoRespaldo: 0.12,
  },

  // ── 4. Riesgos laborales ──────────────────────────────────────────────
  {
    id: 'riesgosLaborales.arlClaseI',
    grupo: 'RIESGOS_LABORALES',
    nombre: 'ARL clase I',
    descripcion: 'Porcentaje ARL clase de riesgo I sobre el IBC.',
    unidad: 'PORCENTAJE',
    valorTecnicoRespaldo: 0.00522,
  },
  {
    id: 'riesgosLaborales.arlClaseII',
    grupo: 'RIESGOS_LABORALES',
    nombre: 'ARL clase II',
    descripcion: 'Porcentaje ARL clase de riesgo II sobre el IBC.',
    unidad: 'PORCENTAJE',
    valorTecnicoRespaldo: 0.01044,
  },
  {
    id: 'riesgosLaborales.arlClaseIII',
    grupo: 'RIESGOS_LABORALES',
    nombre: 'ARL clase III',
    descripcion: 'Porcentaje ARL clase de riesgo III sobre el IBC.',
    unidad: 'PORCENTAJE',
    valorTecnicoRespaldo: 0.02436,
  },
  {
    id: 'riesgosLaborales.arlClaseIV',
    grupo: 'RIESGOS_LABORALES',
    nombre: 'ARL clase IV',
    descripcion: 'Porcentaje ARL clase de riesgo IV sobre el IBC.',
    unidad: 'PORCENTAJE',
    valorTecnicoRespaldo: 0.0435,
  },
  {
    id: 'riesgosLaborales.arlClaseV',
    grupo: 'RIESGOS_LABORALES',
    nombre: 'ARL clase V',
    descripcion: 'Porcentaje ARL clase de riesgo V sobre el IBC.',
    unidad: 'PORCENTAJE',
    valorTecnicoRespaldo: 0.0696,
  },

  // ── 5. Parafiscales ───────────────────────────────────────────────────
  {
    id: 'parafiscales.porcentajeCaja',
    grupo: 'PARAFISCALES',
    nombre: 'Caja de compensación',
    descripcion: 'Porcentaje de caja de compensación (sobre IBC + vacaciones, ver motor).',
    unidad: 'PORCENTAJE',
    valorTecnicoRespaldo: 0.04,
  },
  {
    id: 'parafiscales.porcentajeSena',
    grupo: 'PARAFISCALES',
    nombre: 'SENA',
    descripcion: 'Porcentaje SENA sobre el IBC (sujeto a exoneración parafiscal).',
    unidad: 'PORCENTAJE',
    valorTecnicoRespaldo: 0.02,
  },
  {
    id: 'parafiscales.porcentajeIcbf',
    grupo: 'PARAFISCALES',
    nombre: 'ICBF',
    descripcion: 'Porcentaje ICBF sobre el IBC (sujeto a exoneración parafiscal).',
    unidad: 'PORCENTAJE',
    valorTecnicoRespaldo: 0.03,
  },

  // ── 6. Prestaciones sociales ──────────────────────────────────────────
  {
    id: 'prestaciones.porcentajeCesantias',
    grupo: 'PRESTACIONES_SOCIALES',
    nombre: 'Cesantías',
    descripcion: 'Porcentaje de cesantías (base salario + sobretiempo + auxilio).',
    unidad: 'PORCENTAJE',
    valorTecnicoRespaldo: 0.0833,
  },
  {
    id: 'prestaciones.porcentajePrima',
    grupo: 'PRESTACIONES_SOCIALES',
    nombre: 'Prima de servicios',
    descripcion: 'Porcentaje de prima de servicios (misma base que cesantías).',
    unidad: 'PORCENTAJE',
    valorTecnicoRespaldo: 0.0833,
  },
  {
    id: 'prestaciones.porcentajeVacaciones',
    grupo: 'PRESTACIONES_SOCIALES',
    nombre: 'Vacaciones',
    descripcion: 'Porcentaje de vacaciones sobre el IBC.',
    unidad: 'PORCENTAJE',
    valorTecnicoRespaldo: 0.05,
  },
  {
    id: 'prestaciones.porcentajeInteresesCesantias',
    grupo: 'PRESTACIONES_SOCIALES',
    nombre: 'Intereses sobre cesantías',
    descripcion: 'Porcentaje de intereses de cesantías (misma base que cesantías).',
    unidad: 'PORCENTAJE',
    valorTecnicoRespaldo: 0.01,
  },

  // ── 7. Bonos e IBC ────────────────────────────────────────────────────
  {
    id: 'bonosIbc.limitePagosNoSalariales',
    grupo: 'BONOS_E_IBC',
    nombre: 'Límite de pagos no salariales para IBC',
    descripcion: 'Ley 1393/2010 art. 30 — tope de pagos no salariales excluibles del IBC de salud/pensión/ARL.',
    unidad: 'PORCENTAJE',
    valorTecnicoRespaldo: 0.40,
  },

  // ── 8. Redondeo y precisión ───────────────────────────────────────────
  {
    id: 'redondeo.escalaDecimalPeso',
    grupo: 'REDONDEO_Y_PRECISION',
    nombre: 'Escala decimal — peso colombiano',
    descripcion: 'Cantidad de decimales en el redondeo monetario final (0 = sin decimales).',
    unidad: 'ADIMENSIONAL',
    valorTecnicoRespaldo: 0,
  },

  // ── 9. Historial y vigencias ──────────────────────────────────────────
  {
    id: 'historial.versionCatalogo',
    grupo: 'HISTORIAL_Y_VIGENCIAS',
    nombre: 'Versión del catálogo de parámetros',
    descripcion: 'Marca de versión de este catálogo, para trazabilidad de snapshots en costeos futuros.',
    unidad: 'TEXTO',
    valorTecnicoRespaldo: 1, // texto real vive en versionCatalogoTexto; se deja 1 como placeholder numérico del contrato
  },
];

export const VERSION_CATALOGO = 'parametros-v1-2026-07';

/** Perfiles normativos semilla — julio 2026, régimen GENERAL. Estado
 * 'VIGENTE' porque son los valores hoy aplicables; no hay tramos
 * anteriores/posteriores cargados en esta primera entrega (eso es
 * trabajo de Fase 3, "perfiles y resolución de vigencia" completa). */
export const PERFILES_NORMATIVOS_SEMILLA: PerfilNormativoParametro[] = CATALOGO_PARAMETROS.filter(
  (p) => !p.derivadoAutomaticamente && p.unidad !== 'TEXTO',
).map((p, i) => ({
  id: `pn-seed-${i + 1}`,
  parametroId: p.id,
  fuenteLegal:
    p.grupo === 'JORNADA_Y_RECARGOS'
      ? 'Ley 2101 de 2021; Ley 2466 de 2025, artículo 14'
      : 'Configuración vigente Mano de Obra 2026',
  fechaVigenciaDesde: '2026-07-15',
  fechaVigenciaHasta: null,
  valor: p.valorTecnicoRespaldo,
  estado: 'VIGENTE',
  versionParametro: VERSION_CATALOGO,
  creadoEn: '2026-07-18T00:00:00.000Z',
}));

export function obtenerDefinicionParametro(parametroId: string): DefinicionParametro | undefined {
  return CATALOGO_PARAMETROS.find((p) => p.id === parametroId);
}