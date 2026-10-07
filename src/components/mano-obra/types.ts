/**
 * Tipos compartidos entre los componentes de revisión MO.
 * El motor determinístico es la única fuente de verdad para cálculos.
 */

export interface InputsMensualesView {
  jornadaBaseLegalSemana: number;
  horasServicioSemana: number;
  horasOrdinariasSemana: number;
  hRecNocHabil: number;
  hExtDiurHabil: number;
  hExtNocHabil: number;
  hOrdDomDiu: number;
  hOrdDomNoc: number;
  hExtDomDiu: number;
  hExtDomNoc: number;
  hFestDiu: number;
  hFestNoc: number;
  hExtFestDiu: number;
  hExtFestNoc: number;
  factorMensual: number;
  metodoPeriodo: string;
  modoCosteo: string;
  exportableAlTabActual: boolean;
  motivoNoExportable?: string | null;
}

export interface TurnoView {
  id: number;
  dias: string[];
  horaInicio: string;
  horaFin: string;
  cruzaMedianoche: boolean;
  descansoMinutos: number;
  descansoComputable: boolean;
  descansoHoraInicio: string | null;
  descansoHoraFin: string | null;
  metodoDistribucionDescanso: string | null;
  tipoDiaGemini: string | null;
  tipoDiaCalculado: string | null;
  horasBrutasDia: number | null;
  horasNetasDia: number | null;
  horasDiurnas: number | null;
  horasNocturnas: number | null;
}

export interface CargoView {
  id: number;
  escenarioId: number;
  cargoOriginal: string;
  cargoNormalizado: string;
  cantidadSolicitada: number;
  cantidadPuestosPorTurno: number | null;
  cantidadPersonasCalculadas: number | null;
  fteTeorico: number | null;
  personasSinHorasExtra: number | null;
  personasConHorasExtra: number | null;
  requiereValidacionHorasExtra: boolean | null;
  requiereTurnante: boolean;
  tipoCobertura: string;
  diaDescansoObligatorio: string | null;
  jornadaSemanalDeclarada: number | null;
  jornadaSemanalCalculada: number | null;
  coincideJornada: boolean | null;
  diferenciaHoras: number | null;
  claseRiesgoArl: string | null;
  porcentajeArl: number | null;
  requiereValidacionArl: boolean;
  requiereDotacion: boolean;
  requiereEpp: boolean;
  requiereExamenMedico: boolean;
  requiereAlturas: boolean | null;
  editadoManualmente: boolean;
  observaciones: string | null;
  inputsMensuales: InputsMensualesView | null;
  turnos: TurnoView[];
  sedeNombre: string | null;
  // alertas propias del cargo (subset de las globales)
  alertas: AlertaView[];
}

export interface EscenarioView {
  id: number;
  nombre: string;
  empresaGrupo: string;
  tipoServicio: string;
  esPrincipal: boolean;
  orden: number;
  sedeNombre: string | null;
  tieneInsumos: boolean | null;
  cargos: CargoView[];
  // Export summary — tres estados
  exportable: 'completo' | 'parcial' | 'no_exportable';
  motivoNoExportable: string | null;
  // Listas preparadas para Fase 4
  cargosExportables: CargoView[];
  cargosBloqueados: CargoView[];
}

export interface AlertaView {
  id: number;
  severidad: 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAJA';
  codigo: string;
  mensaje: string;
  fuenteNormativa: string | null;
  campoAfectado: string | null;
  revisada: boolean;
  comentarioValidacion: string | null;
  escenarioId: number | null;
  cargoId: number | null;
  escenarioNombre: string | null;
  cargoNombre: string | null;
}

export interface PreguntaView {
  id: number;
  pregunta: string;
  prioridad: 'urgente' | 'normal' | 'opcional';
  contexto: string | null;
  respondida: boolean;
  respuesta: string | null;
  escenarioId: number | null;
  cargoId: number | null;
  escenarioNombre: string | null;
  cargoNombre: string | null;
}

export interface SolicitudView {
  id: number;
  cliente: string;
  empresaGrupo: string | null;
  estado: 'borrador' | 'en_revision' | 'aprobada' | 'rechazada';
  textoOriginal: string;
  servicioDetectado: string | null;
  duracionMeses: number | null;
  requiereInsumos: boolean | null;
  requiereDotacionEspecial: boolean | null;
  requiereEppEspecial: boolean | null;
  requiereAlturas: boolean | null;
  multisede: boolean;
  geminiVersion: string | null;
  creadoEn: string;
  aprobadoEn: string | null;
  condicionInsumos: string | null;
  valoresAgregados: string[];
  observacionesGenerales: string | null;
}

export interface RevisionMOData {
  solicitud: SolicitudView;
  escenarios: EscenarioView[];
  alertas: AlertaView[];
  preguntas: PreguntaView[];
  geminiExtraccion: Record<string, unknown> | null;
  guardadoEnBD: boolean;
}

// ─── Estado de edición local en el frontend ───────────────────────────────────

export interface CargoEdit {
  cargoNormalizado: string;
  cantidadSolicitada: number;
  tipoCobertura: string;
  jornadaSemanalDeclarada: number | null;
  claseRiesgoArl: string | null;
  requiereAlturas: boolean | null;
  requiereDotacion: boolean;
  requiereEpp: boolean;
  requiereExamenMedico: boolean;
  observaciones: string;
  editadoManualmente: boolean;
}

export const SEVERIDAD_COLOR: Record<string, { bg: string; text: string; border: string; label: string }> = {
  CRITICA: { bg: '#fef2f2', text: '#dc2626', border: '#fca5a5', label: 'CRÍTICA' },
  ALTA:    { bg: '#fff7ed', text: '#ea580c', border: '#fdba74', label: 'ALTA' },
  MEDIA:   { bg: '#fefce8', text: '#ca8a04', border: '#fde047', label: 'MEDIA' },
  BAJA:    { bg: '#eff6ff', text: '#2563eb', border: '#93c5fd', label: 'BAJA' },
};

export const ESTADO_COLOR: Record<string, { bg: string; text: string; label: string }> = {
  borrador:    { bg: '#f3f4f6', text: '#6b7280', label: 'Borrador' },
  en_revision: { bg: '#eff6ff', text: '#1d4ed8', label: 'En revisión' },
  aprobada:    { bg: '#f0fdf4', text: '#16a34a', label: 'Aprobada' },
  rechazada:   { bg: '#fef2f2', text: '#dc2626', label: 'Rechazada' },
};

export const EMPRESA_COLOR: Record<string, { bg: string; text: string }> = {
  ASEOCOLBA:  { bg: '#eff6ff', text: '#1d4ed8' },
  VIGICOLBA:  { bg: '#faf5ff', text: '#7c3aed' },
  TEMPOCOLBA: { bg: '#f0fdf4', text: '#16a34a' },
  MULTIPLE:   { bg: '#fff7ed', text: '#ea580c' },
};

export const COBERTURA_LABELS: Record<string, string> = {
  persona:   'Por persona',
  puesto:    'Puesto fijo',
  turnante:  'Rotación de turnos',
  relevo:    'Relevo',
  eventual:  'Eventual',
};

export const ARL_LABELS: Record<string, string> = {
  I: 'Riesgo I (0.522%)', II: 'Riesgo II (1.044%)', III: 'Riesgo III (2.436%)',
  IV: 'Riesgo IV (4.350%)', V: 'Riesgo V (6.960%)',
};

export const ARL_PCT: Record<string, number> = {
  I: 0.522, II: 1.044, III: 2.436, IV: 4.350, V: 6.960,
};

export function fmt(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined) return '—';
  return n.toFixed(decimals);
}