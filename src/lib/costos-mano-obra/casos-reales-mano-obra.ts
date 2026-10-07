/**
 * Banco de Casos Reales — Mano de Obra (Fase 2.2)
 *
 * Fuente de verdad para pruebas de regresión del módulo Estructura de Costo:
 * Mano de Obra. Cada caso registra expectativas de clasificación, alertas,
 * preguntas y exportabilidad según la lógica del motor Fase 1.1.
 *
 * NOTA: textoOriginal es representativo hasta recibir los textos reales del cliente.
 *       Reemplazar con el texto literal cuando esté disponible.
 */

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type EmpresaGrupo      = 'ASEOCOLBA' | 'VIGICOLBA' | 'MULTIPLE';
export type CondicionInsumos  = 'con_insumos' | 'sin_insumos' | 'con_y_sin' | null;

export type CategoriaCase =
  | 'MULTI_CARGO'
  | 'MULTI_ESCENARIO'
  | 'NOCTURNO'
  | 'DOMINICAL'
  | 'FESTIVO'
  | 'PISCINA_SALVAVIDAS'
  | 'VIGILANCIA'
  | 'MULTIEMPRESA'
  | 'CON_SIN_INSUMOS'
  | '24_7'
  | 'JORNADA_PARCIAL'
  | 'ALTURAS'
  | 'CRUCE_MEDIANOCHE'
  | 'TURNO_MIXTO'
  | 'MULTISEDE'
  | 'VALOR_AGREGADO'
  | 'SIMPLE';

export interface CargoEsperado {
  cargoNormalizado:       string;
  cantidad:               number;
  tipoCobertura:          'persona' | 'puesto' | 'turnante' | 'relevo' | 'eventual';
  requiereTurnante?:      boolean;
  jornadaDeclaradaH?:     number | null;
  tieneHorarioDefinido:   boolean;
  observaciones?:         string;
}

export interface AlertaEsperada {
  codigo:      string;
  severidad:   'CRITICA' | 'ALTA' | 'MEDIA' | 'BAJA';
  obligatoria: boolean;  // true = el test debe encontrarla; false = puede aparecer
  razon:       string;
}

export interface PreguntaEsperada {
  prioridad:   'urgente' | 'normal' | 'opcional';
  patronTexto: string;   // fragmento que debe aparecer en la pregunta
  razon:       string;
}

export interface CasoRealMO {
  idCaso:          string;
  cliente:         string;
  textoOriginal:   string;
  empresaEsperada: EmpresaGrupo;
  escenariosEsperados: {
    cantidad:           number;
    notas?:             string;
    condicionInsumos?:  CondicionInsumos;
  };
  cargosEsperados:       CargoEsperado[];
  alertasEsperadas:      AlertaEsperada[];
  preguntasEsperadas:    PreguntaEsperada[];
  exportableEsperado:    boolean | 'parcial';
  motivoNoExportable?:   string;
  observaciones:         string;
  categorias:            CategoriaCase[];
  requiereMejorPrompt:        boolean;
  requiereCatalogoAdicional:  boolean;
  requiereValidacionManual:   boolean;
  motivoValidacionManual?:    string;
}

// ─── Casos ────────────────────────────────────────────────────────────────────

export const CASOS_REALES: CasoRealMO[] = [
  // ── C1 ──────────────────────────────────────────────────────────────────────
  {
    idCaso:   'C1-LA-OPINION',
    cliente:  'La Opinión S.A.S.',
    textoOriginal: `Servicio de aseo. Lunes a viernes horario 07:00-16:00 y turno nocturno 23:00-07:00.
Sábados 07:00-12:00 y 21:00-07:00. Sin insumos.`,
    empresaEsperada: 'ASEOCOLBA',
    escenariosEsperados: { cantidad: 1, condicionInsumos: 'sin_insumos' },
    cargosEsperados: [{
      cargoNormalizado:     'Operario de Aseo',
      cantidad:             1,
      tipoCobertura:        'puesto',
      tieneHorarioDefinido: true,
      observaciones:        '4 turnos: 2 diurnos + 2 nocturnos/mixtos. Necesita ≥ 2 personas.',
    }],
    alertasEsperadas: [
      { codigo: 'DESCANSO_EN_TURNO_MIXTO_NO_DEFINIDO', severidad: 'ALTA', obligatoria: true,  razon: 'Turno 23:00-07:00 cruza fin nocturno (06:00) → mixto. Política aplica 60min sin hora exacta.' },
      { codigo: 'DESCANSO_APLICADO_POR_POLITICA',      severidad: 'MEDIA', obligatoria: true,  razon: 'Turnos sin descanso explícito > 6h.' },
      { codigo: 'COBERTURA_INSUFICIENTE_FTE',           severidad: 'ALTA', obligatoria: false, razon: 'Con 4 turnos/semana se requieren ≥ 2 personas como puesto.' },
    ],
    preguntasEsperadas: [],
    exportableEsperado:  false,
    motivoNoExportable:  'Turnos nocturnos con cruce de medianoche requieren distribución de descanso exacta.',
    observaciones: 'Turno 23:00-07:00 es mixto (7h noc + 1h diu). Turno 21:00-07:00 también mixto (9h noc + 1h diu). Turno 22:00-06:00 es 100% nocturno (no mixto). Sábados tienen 2 turnos distintos.',
    categorias: ['NOCTURNO', 'CRUCE_MEDIANOCHE', 'TURNO_MIXTO'],
    requiereMejorPrompt:       false,
    requiereCatalogoAdicional: false,
    requiereValidacionManual:  true,
    motivoValidacionManual:    'Cruce de medianoche en múltiples días; descanso nocturno requiere confirmación de posición exacta.',
  },

  // ── C2 ──────────────────────────────────────────────────────────────────────
  {
    idCaso:   'C2-ATLANTIC',
    cliente:  'Atlantic',
    textoOriginal: `Servicio de aseo diurno 06:00-14:00, aseo nocturno 22:00-06:00, todero.
Propuesta para varios operarios. Valores agregados: fumigación, maquinaria, supervisión, autoscrubber.`,
    empresaEsperada: 'ASEOCOLBA',
    escenariosEsperados: { cantidad: 1, condicionInsumos: null },
    cargosEsperados: [
      { cargoNormalizado: 'Operario de Aseo',   cantidad: 1, tipoCobertura: 'persona', tieneHorarioDefinido: true },
      { cargoNormalizado: 'Operario de Aseo',   cantidad: 1, tipoCobertura: 'persona', tieneHorarioDefinido: true,  observaciones: 'Turno nocturno 22:00-06:00' },
      { cargoNormalizado: 'Todero',             cantidad: 1, tipoCobertura: 'persona', tieneHorarioDefinido: false, observaciones: 'Horario no especificado' },
    ],
    alertasEsperadas: [
      { codigo: 'DESCANSO_EN_TURNO_MIXTO_NO_DEFINIDO', severidad: 'ALTA', obligatoria: true,  razon: 'Turno 13:00-21:00 cruza inicio nocturno 19:00 → mixto.' },
      { codigo: 'DESCANSO_APLICADO_POR_POLITICA',      severidad: 'MEDIA', obligatoria: true,  razon: 'Política aplica al turno de 13:00-21:00 y turno nocturno.' },
      { codigo: 'FALTA_HORARIO',                        severidad: 'ALTA', obligatoria: false, razon: 'Todero sin horario definido.' },
    ],
    preguntasEsperadas: [
      { prioridad: 'urgente', patronTexto: 'fumigación', razon: 'Fumigación no es MO estándar; debe separarse como valor agregado.' },
    ],
    exportableEsperado:  'parcial',
    motivoNoExportable:  'Turno 13:00-21:00 es mixto; todero sin horario; valores agregados no son MO directa.',
    observaciones: 'Turno 06:00-14:00: diurno puro (no mixto). Turno 13:00-21:00: mixto (2h noc + 6h diu). Turno 22:00-06:00: nocturno puro (NOT mixto). Fumigación/maquinaria/autoscrubber → valores agregados, NO cargos de MO.',
    categorias: ['MULTI_CARGO', 'NOCTURNO', 'TURNO_MIXTO', 'VALOR_AGREGADO'],
    requiereMejorPrompt:       true,
    requiereCatalogoAdicional: true,
    requiereValidacionManual:  true,
    motivoValidacionManual:    'Valores agregados (fumigación, maquinaria, autoscrubber) deben separarse de MO antes de exportar.',
  },

  // ── C3 ──────────────────────────────────────────────────────────────────────
  {
    idCaso:   'C3-EDIFICIO-SOLARA',
    cliente:  'Edificio Solarà',
    textoOriginal: `Dos propuestas: (A) 4 personas incluyendo piscina/salvavidas y jardinería. (B) 3 personas + servicio semanal adicional jardinería y salvavidas.`,
    empresaEsperada: 'ASEOCOLBA',
    escenariosEsperados: { cantidad: 2, notas: 'Propuesta A (4 personas) vs Propuesta B (3 personas + servicio semanal)', condicionInsumos: null },
    cargosEsperados: [
      { cargoNormalizado: 'Operario de Aseo',        cantidad: 3, tipoCobertura: 'persona', tieneHorarioDefinido: false },
      { cargoNormalizado: 'Piscinero / Salvavidas',  cantidad: 1, tipoCobertura: 'persona', tieneHorarioDefinido: false, observaciones: 'Confirmar si es salvavidas certificado.' },
      { cargoNormalizado: 'Jardinero',               cantidad: 1, tipoCobertura: 'eventual', tieneHorarioDefinido: false, observaciones: 'Servicio semanal puntual; no es cargo mensual.' },
    ],
    alertasEsperadas: [
      { codigo: 'FALTA_HORARIO',     severidad: 'ALTA', obligatoria: true,  razon: 'Mayoría de cargos sin horario definido.' },
      { codigo: 'ARL_SIN_VALIDAR',   severidad: 'ALTA', obligatoria: false, razon: 'Piscinero puede ser riesgo III (sin salvavidas) o IV (con salvavidas).' },
    ],
    preguntasEsperadas: [
      { prioridad: 'urgente', patronTexto: 'salvavidas', razon: 'esSalvavidas=null → pregunta obligatoria sobre certificación.' },
      { prioridad: 'normal',  patronTexto: 'jardinería', razon: 'Servicio semanal adicional: ¿es eventual o periódico mensual?' },
    ],
    exportableEsperado:  false,
    motivoNoExportable:  'Escenarios múltiples sin horarios definidos; piscinero/salvavidas sin confirmar ARL.',
    observaciones: 'esEscenarioMultiple=true. Jardinería semanal no es cargo mensual regular → valor eventual. La distinción piscinero vs piscinero-salvavidas afecta ARL (III vs IV).',
    categorias: ['MULTI_ESCENARIO', 'PISCINA_SALVAVIDAS', 'MULTI_CARGO'],
    requiereMejorPrompt:       false,
    requiereCatalogoAdicional: false,
    requiereValidacionManual:  true,
    motivoValidacionManual:    'Clasificación ARL piscinero/salvavidas requiere confirmación del cliente.',
  },

  // ── C4 ──────────────────────────────────────────────────────────────────────
  {
    idCaso:   'C4-SOLVO',
    cliente:  'Solvo',
    textoOriginal: `Servicio multisede. Operarios por sede. 1 supervisor. Trabaja domingos. Con y sin insumos básicos. Riesgo varía por centro de costo.`,
    empresaEsperada: 'ASEOCOLBA',
    escenariosEsperados: { cantidad: 2, notas: 'Sin insumos básicos / Con insumos básicos', condicionInsumos: 'con_y_sin' },
    cargosEsperados: [
      { cargoNormalizado: 'Operario de Aseo', cantidad: 1, tipoCobertura: 'persona', tieneHorarioDefinido: false, observaciones: 'Por sede; cantidad total pendiente.' },
      { cargoNormalizado: 'Supervisor',       cantidad: 1, tipoCobertura: 'persona', tieneHorarioDefinido: false },
    ],
    alertasEsperadas: [
      { codigo: 'FALTA_HORARIO',   severidad: 'ALTA', obligatoria: true,  razon: 'Ningún cargo tiene horario específico por sede.' },
      { codigo: 'ARL_SIN_VALIDAR', severidad: 'ALTA', obligatoria: true,  razon: 'Riesgo varía por centro de costo; no se puede asumir clase fija.' },
    ],
    preguntasEsperadas: [
      { prioridad: 'urgente', patronTexto: 'sed', razon: '¿Cuántos operarios por sede? ¿Horarios por sede?' },
      { prioridad: 'urgente', patronTexto: 'riesgo', razon: '¿Qué clase de riesgo ARL tiene cada centro de costo?' },
    ],
    exportableEsperado:  false,
    motivoNoExportable:  'Multisede sin horarios; ARL por sede sin confirmar; supervisor sin cargo definido en catálogo.',
    observaciones: 'condicionInsumos=con_y_sin → 2 escenarios comerciales. Domingos declarados → recargo dominical. Multisede requiere desglose por sede en la cotización.',
    categorias: ['MULTISEDE', 'DOMINICAL', 'CON_SIN_INSUMOS', 'MULTI_CARGO'],
    requiereMejorPrompt:       true,
    requiereCatalogoAdicional: false,
    requiereValidacionManual:  true,
    motivoValidacionManual:    'Riesgo ARL por sede debe confirmarse antes de calcular parafiscales.',
  },

  // ── C5 ──────────────────────────────────────────────────────────────────────
  {
    idCaso:   'C5-COUNTRY-MOTORS',
    cliente:  'Country Motors',
    textoOriginal: `Vigilancia y conserjería como alternativas. Turnos nocturnos. Sábado 12:30 hasta el lunes 08:00. Si el lunes es festivo, hasta el martes 08:00.`,
    empresaEsperada: 'MULTIPLE',
    escenariosEsperados: { cantidad: 2, notas: 'Escenario A: Vigilancia (VIGICOLBA). Escenario B: Conserjería (ASEOCOLBA).', condicionInsumos: null },
    cargosEsperados: [
      { cargoNormalizado: 'Vigilante',          cantidad: 1, tipoCobertura: 'puesto', tieneHorarioDefinido: true,  observaciones: 'VIGICOLBA. Turno S 12:30 → L 08:00 ≈ 19.5h.' },
      { cargoNormalizado: 'Conserje / Portero', cantidad: 1, tipoCobertura: 'puesto', tieneHorarioDefinido: false, observaciones: 'ASEOCOLBA. Horario conserje sin definir.' },
    ],
    alertasEsperadas: [
      { codigo: 'DESCANSO_EN_TURNO_MIXTO_NO_DEFINIDO', severidad: 'ALTA', obligatoria: true,  razon: 'Turno S 12:30-L 08:00 es mixto (19.5h, cruza nocturno).' },
      { codigo: 'DESCANSO_APLICADO_POR_POLITICA',      severidad: 'MEDIA', obligatoria: true,  razon: '19.5h >> 6h umbral → política aplica descanso.' },
    ],
    preguntasEsperadas: [
      { prioridad: 'urgente', patronTexto: 'festivo', razon: '¿Hasta cuándo se extiende si lunes es festivo? Lógica condicional no resoluble automáticamente.' },
      { prioridad: 'urgente', patronTexto: 'vigilancia', razon: '¿Vigilancia armada o desarmada? Afecta ARL y empresa.' },
    ],
    exportableEsperado:  false,
    motivoNoExportable:  'Lógica condicional festivo no codificable en schema fijo. Multiempresa requiere separar cotizaciones.',
    observaciones: 'esEscenarioMultiple=true. VIGICOLBA para vigilancia, ASEOCOLBA para conserjería. Turno S12:30-L08:00 = 19.5h bruto, cruza medianoche S→D→L. Condición festivo = validación manual.',
    categorias: ['MULTIEMPRESA', 'VIGILANCIA', 'CRUCE_MEDIANOCHE', 'FESTIVO', 'MULTI_ESCENARIO', 'NOCTURNO'],
    requiereMejorPrompt:       true,
    requiereCatalogoAdicional: false,
    requiereValidacionManual:  true,
    motivoValidacionManual:    'Lógica "si lunes festivo → martes" no se puede automatizar; requiere override manual.',
  },

  // ── C6 ──────────────────────────────────────────────────────────────────────
  {
    idCaso:   'C6-VILLA-MAGNA',
    cliente:  'Edificio Villa Magna',
    textoOriginal: `1 operario de aseo 44 horas semanales, lunes a sábado. Con y sin insumos. Valor agregado: brigada de aseo.`,
    empresaEsperada: 'ASEOCOLBA',
    escenariosEsperados: { cantidad: 2, notas: 'Sin insumos / Con insumos', condicionInsumos: 'con_y_sin' },
    cargosEsperados: [{
      cargoNormalizado:   'Operario de Aseo',
      cantidad:           1,
      tipoCobertura:      'persona',
      jornadaDeclaradaH:  44,
      tieneHorarioDefinido: false,
      observaciones:      '44h L-S; horario exacto no especificado.',
    }],
    alertasEsperadas: [
      { codigo: 'JORNADA_NO_DECLARADA', severidad: 'MEDIA', obligatoria: false, razon: 'Si Gemini deja turnos vacíos, motor emite FALTA_HORARIO no JORNADA_NO_DECLARADA.' },
    ],
    preguntasEsperadas: [
      { prioridad: 'normal', patronTexto: 'brigada', razon: 'Brigada de aseo es valor agregado; ¿frecuencia, duración, precio aparte?' },
    ],
    exportableEsperado:  true,
    observaciones: 'Caso SIMPLE con condicionInsumos=con_y_sin. Si Gemini extrae horario L-S con descanso, exportable=true. La brigada de aseo es un servicio adicional no incluido en MO mensual.',
    categorias: ['SIMPLE', 'CON_SIN_INSUMOS', 'VALOR_AGREGADO'],
    requiereMejorPrompt:       false,
    requiereCatalogoAdicional: false,
    requiereValidacionManual:  false,
  },

  // ── C7 ──────────────────────────────────────────────────────────────────────
  {
    idCaso:   'C7-OCEANA-52',
    cliente:  'Oceana 52',
    textoOriginal: `8 operarios: 5 de aseo/mantenimiento, 1 piscinero, 1 todero, 1 jardinero.
Lunes a viernes 07:00-16:00, sábados 07:00-15:00.`,
    empresaEsperada: 'ASEOCOLBA',
    escenariosEsperados: { cantidad: 1, condicionInsumos: null },
    cargosEsperados: [
      { cargoNormalizado: 'Operario de Aseo', cantidad: 5, tipoCobertura: 'persona', jornadaDeclaradaH: 44, tieneHorarioDefinido: true },
      { cargoNormalizado: 'Piscinero',        cantidad: 1, tipoCobertura: 'persona', jornadaDeclaradaH: null, tieneHorarioDefinido: true, observaciones: 'esSalvavidas pendiente' },
      { cargoNormalizado: 'Todero',           cantidad: 1, tipoCobertura: 'persona', jornadaDeclaradaH: null, tieneHorarioDefinido: true },
      { cargoNormalizado: 'Jardinero',        cantidad: 1, tipoCobertura: 'persona', jornadaDeclaradaH: null, tieneHorarioDefinido: true },
    ],
    alertasEsperadas: [
      { codigo: 'DESCANSO_APLICADO_POR_POLITICA', severidad: 'MEDIA', obligatoria: true,  razon: 'L-V 9h bruto > 6h y S 8h bruto > 6h → política aplica.' },
      { codigo: 'EXCEDE_JORNADA_LEGAL',           severidad: 'ALTA', obligatoria: true,  razon: 'Con policy: L-V 8h×5=40h + S 7h = 47h > 44h.' },
      { codigo: 'ARL_SIN_VALIDAR',                severidad: 'ALTA', obligatoria: false, razon: 'Piscinero: confirmar si requiere salvavidas (riesgo III vs IV).' },
    ],
    preguntasEsperadas: [
      { prioridad: 'urgente', patronTexto: 'salvavidas', razon: 'Piscinero sin confirmar salvavidas.' },
    ],
    exportableEsperado:  'parcial',
    motivoNoExportable:  'Jornada calculada (47h) excede 44h; requiere ajuste de horario o aceptar horas extra.',
    observaciones: 'L-V 07:00-16:00 = 9h bruto. S 07:00-15:00 = 8h bruto. Política: L-V → 8h net×5=40h; S → 7h net. Total=47h > 44h legal. Declarado 44h (no coincide). EXCEDE_JORNADA_LEGAL obligatoria.',
    categorias: ['MULTI_CARGO', 'PISCINA_SALVAVIDAS', 'ALTURAS'],
    requiereMejorPrompt:       false,
    requiereCatalogoAdicional: false,
    requiereValidacionManual:  true,
    motivoValidacionManual:    'Jornada 47h requiere validar si se pagan horas extra o se ajusta horario.',
  },

  // ── C8 ──────────────────────────────────────────────────────────────────────
  {
    idCaso:   'C8-SERVIMEDICAL',
    cliente:  'Servimedical',
    textoOriginal: `Servicio de limpieza de oficina. Sin insumos ni EPP especial. Período 6 meses. 44 horas semanales lunes a sábado.`,
    empresaEsperada: 'ASEOCOLBA',
    escenariosEsperados: { cantidad: 1, condicionInsumos: 'sin_insumos' },
    cargosEsperados: [{
      cargoNormalizado:   'Operario de Aseo',
      cantidad:           1,
      tipoCobertura:      'persona',
      jornadaDeclaradaH:  44,
      tieneHorarioDefinido: false,
      observaciones:      'Período 6 meses. EPP básico estándar (no especial), no eliminar del costo.',
    }],
    alertasEsperadas: [],
    preguntasEsperadas: [],
    exportableEsperado:  true,
    observaciones: 'CASO SIMPLE. "Sin EPP especial" ≠ sin EPP; EPP básico (guantes, tapabocas) siempre incluido en costo. Período 6 meses no afecta cálculo mensual pero puede afectar prestaciones prorrateadas.',
    categorias: ['SIMPLE'],
    requiereMejorPrompt:       false,
    requiereCatalogoAdicional: false,
    requiereValidacionManual:  false,
  },

  // ── C9 ──────────────────────────────────────────────────────────────────────
  {
    idCaso:   'C9-DATABANKS',
    cliente:  'Databanks MKS',
    textoOriginal: `Servicio de aseo lunes a viernes. 7 horas diarias. Período 1 año.`,
    empresaEsperada: 'ASEOCOLBA',
    escenariosEsperados: { cantidad: 1, condicionInsumos: null },
    cargosEsperados: [{
      cargoNormalizado:   'Operario de Aseo',
      cantidad:           1,
      tipoCobertura:      'persona',
      jornadaDeclaradaH:  35,  // 7h × 5 días — NO usar 44h
      tieneHorarioDefinido: true,
      observaciones:      'JORNADA PARCIAL CONFIRMADA 35h/sem (7h×5). NUNCA usar plantilla 44h sin ajuste.',
    }],
    alertasEsperadas: [
      { codigo: 'JORNADA_APROXIMADA', severidad: 'BAJA', obligatoria: false, razon: 'Con policy 60min aplicada: 7h bruto - 1h = 6h net × 5 = 30h ≠ 35h declaradas. O sin policy: 7h neto × 5 = 35h.' },
    ],
    preguntasEsperadas: [],
    exportableEsperado:  true,
    observaciones: 'JORNADA PARCIAL REAL: 7h diarias declaradas = 35h/sem. Si el horario es 07:00-14:00 y no hay descanso reportado por el cliente, la jornada neta = 35h (no 30h). Gemini NO debe asumir 44h. Período 1 año = contrato fijo; factor mensual estándar.',
    categorias: ['JORNADA_PARCIAL', 'SIMPLE'],
    requiereMejorPrompt:       true,
    requiereCatalogoAdicional: false,
    requiereValidacionManual:  false,
    motivoValidacionManual:    'Verificar que Gemini no use jornadaMaxSemana como declared si el cliente dice 35h.',
  },

  // ── C10 ─────────────────────────────────────────────────────────────────────
  {
    idCaso:   'C10-CENTRO-EJECUTIVO',
    cliente:  'Edificio Centro Ejecutivo I',
    textoOriginal: `Limpieza áreas comunes. No requiere alturas. Cotización con insumos. 44 horas lunes a sábado.`,
    empresaEsperada: 'ASEOCOLBA',
    escenariosEsperados: { cantidad: 1, condicionInsumos: 'con_insumos' },
    cargosEsperados: [{
      cargoNormalizado:   'Operario de Aseo',
      cantidad:           1,
      tipoCobertura:      'persona',
      jornadaDeclaradaH:  44,
      tieneHorarioDefinido: false,
      observaciones:      'requiereAlturas=false (explícito). ARL clase II, no III ni IV.',
    }],
    alertasEsperadas: [
      { codigo: 'ALTURAS_SIN_CONFIRMAR', severidad: 'MEDIA', obligatoria: false, razon: 'No debe aparecer porque requiereAlturas=false es explícito.' },
    ],
    preguntasEsperadas: [],
    exportableEsperado:  true,
    observaciones: 'requiereAlturas=false declarado → NO generar alerta ALTURAS_SIN_CONFIRMAR. Insumos como condición comercial (condicionInsumos=con_insumos). ARL clase II estándar para aseo sin alturas.',
    categorias: ['SIMPLE', 'CON_SIN_INSUMOS'],
    requiereMejorPrompt:       false,
    requiereCatalogoAdicional: false,
    requiereValidacionManual:  false,
  },

  // ── C11 ─────────────────────────────────────────────────────────────────────
  {
    idCaso:   'C11-PUNTA-DEL-ESTE',
    cliente:  'Edificio Punta del Este',
    textoOriginal: `Conserjería 24/7. Todero-piscinero. Domingo a domingo y festivos. Descansa 2 domingos al mes. Horario 06:00-15:00 con 1 hora de almuerzo. Sin insumos de piscina.`,
    empresaEsperada: 'ASEOCOLBA',
    escenariosEsperados: { cantidad: 1, condicionInsumos: 'sin_insumos' },
    cargosEsperados: [
      {
        cargoNormalizado: 'Conserje / Portero',
        cantidad: 1, tipoCobertura: 'puesto', requiereTurnante: true,
        tieneHorarioDefinido: false,
        observaciones: '24/7 → necesita ≥ 4 personas (FTE ≈ 3.82). No exportable sin distribución de rotación.',
      },
      {
        cargoNormalizado: 'Todero',
        cantidad: 1, tipoCobertura: 'persona',
        tieneHorarioDefinido: true,
        observaciones: 'También piscinero. 06:00-15:00 con 1h almuerzo = 8h neto. L-D con 2 dom libres/mes → ajuste cobertura.',
      },
    ],
    alertasEsperadas: [
      { codigo: 'COBERTURA_INSUFICIENTE_FTE', severidad: 'ALTA', obligatoria: true,  razon: 'Conserje 24/7 puesto: FTE ≈ 3.82 > 1 solicitado.' },
      { codigo: 'ARL_SIN_VALIDAR',            severidad: 'ALTA', obligatoria: false, razon: 'Piscinero: ¿es también salvavidas? (riesgo III vs IV).' },
    ],
    preguntasEsperadas: [
      { prioridad: 'urgente', patronTexto: 'piscin', razon: 'Todero-piscinero: ¿incluye salvavidas? ¿Hay usuario certificado?' },
      { prioridad: 'normal',  patronTexto: 'domingo', razon: '2 domingos libres/mes: ¿quién cubre esos días?' },
    ],
    exportableEsperado:  false,
    motivoNoExportable:  'Conserje 24/7 requiere distribución de rotación para exportar.',
    observaciones: 'Conserje 24/7: tipoCobertura=puesto, requiereTurnante=true, no exportable. Todero-piscinero: cargo híbrido, riesgo ARL pendiente. "Sin insumos de piscina" ≠ sin EPP básico.',
    categorias: ['24_7', 'PISCINA_SALVAVIDAS', 'DOMINICAL', 'FESTIVO', 'MULTI_CARGO'],
    requiereMejorPrompt:       false,
    requiereCatalogoAdicional: true,
    requiereValidacionManual:  true,
    motivoValidacionManual:    'Cobertura 24/7 + 2 domingos libres/mes requiere diseño de rotación manual.',
  },

  // ── C12 ─────────────────────────────────────────────────────────────────────
  {
    idCaso:   'C12-ANDALUCIA',
    cliente:  'Andalucía Gran Reserva',
    textoOriginal: `1 conserje-portero 24 horas en 3 turnos de 8 horas: 06-14, 14-22, 22-06. 2 operarios de aseo 44 horas. Cotización con y sin insumos. 4 horas solo domingos. 4 horas domingos y festivos.`,
    empresaEsperada: 'ASEOCOLBA',
    escenariosEsperados: { cantidad: 2, notas: 'Con insumos / Sin insumos', condicionInsumos: 'con_y_sin' },
    cargosEsperados: [
      {
        cargoNormalizado: 'Conserje / Portero',
        cantidad: 1, tipoCobertura: 'puesto', requiereTurnante: true,
        tieneHorarioDefinido: true,
        observaciones: '3 turnos de 8h (NO 2 de 12h). FTE ≈ 3.82. Turno 22:00-06:00 es nocturno puro (no mixto). Turno 14:00-22:00 tiene 3h noct (22 no → termina a las 22:00, fin en 22:00 → noc 19:00-22:00 = 3h noc + 5h diu → MIXTO).',
      },
      { cargoNormalizado: 'Operario de Aseo', cantidad: 2, tipoCobertura: 'persona', jornadaDeclaradaH: 44, tieneHorarioDefinido: false },
    ],
    alertasEsperadas: [
      { codigo: 'COBERTURA_INSUFICIENTE_FTE',           severidad: 'ALTA', obligatoria: true,  razon: 'Conserje 24/7 en puesto: FTE ≈ 3.82 > 1.' },
      { codigo: 'DESCANSO_EN_TURNO_MIXTO_NO_DEFINIDO', severidad: 'ALTA', obligatoria: true,  razon: 'Turno 14:00-22:00 es mixto (5h diu + 3h noc). Política aplica 60min sin hora exacta.' },
    ],
    preguntasEsperadas: [
      { prioridad: 'urgente', patronTexto: 'turno', razon: '¿Los 3 turnos de 8h son correctos? No convertir a 2 de 12h.' },
    ],
    exportableEsperado:  'parcial',
    motivoNoExportable:  'Conserje 24/7 no exportable sin rotación. Operarios de aseo sí exportables si horario confirmado.',
    observaciones: 'CRÍTICO: 3 turnos de 8h ≠ 2 turnos de 12h. El Gemini debe extraer los 3 turnos individualmente. Turno 14:00-22:00: 14:00-19:00 (5h diu) + 19:00-22:00 (3h noc) → MIXTO. Turno 22:00-06:00: 100% nocturno → NOT mixto. condicionInsumos=con_y_sin.',
    categorias: ['MULTI_CARGO', '24_7', 'CON_SIN_INSUMOS', 'DOMINICAL', 'FESTIVO', 'TURNO_MIXTO', 'NOCTURNO'],
    requiereMejorPrompt:       true,
    requiereCatalogoAdicional: false,
    requiereValidacionManual:  true,
    motivoValidacionManual:    'Validar que Gemini extrae 3 turnos de 8h; no fusionar en 2 turnos de 12h.',
  },

  // ── C13 ─────────────────────────────────────────────────────────────────────
  {
    idCaso:   'C13-BIOMEDICAL',
    cliente:  'Consultorio Biomedical',
    textoOriginal: `1 operario tiempo completo 8 horas diurno. Adicional: operario de medio tiempo.`,
    empresaEsperada: 'ASEOCOLBA',
    escenariosEsperados: { cantidad: 1, condicionInsumos: null },
    cargosEsperados: [
      {
        cargoNormalizado: 'Operario de Aseo',
        cantidad: 1, tipoCobertura: 'persona', jornadaDeclaradaH: 40,
        tieneHorarioDefinido: true,
        observaciones: 'Tiempo completo 8h/día × 5 = 40h. O puede ser 44h L-S.',
      },
      {
        cargoNormalizado: 'Operario de Aseo',
        cantidad: 1, tipoCobertura: 'persona', jornadaDeclaradaH: null,
        tieneHorarioDefinido: false,
        observaciones: 'Medio tiempo: esJornadaParcialSinHoras=true, turnos=[]. No asumir horas.',
      },
    ],
    alertasEsperadas: [
      { codigo: 'JORNADA_PARCIAL_SIN_HORAS', severidad: 'ALTA', obligatoria: true,  razon: 'Medio tiempo sin especificar horas → no se puede calcular.' },
    ],
    preguntasEsperadas: [
      { prioridad: 'urgente', patronTexto: 'medio tiempo', razon: '¿Cuáles son los días y horarios del operario de medio tiempo?' },
    ],
    exportableEsperado:  'parcial',
    motivoNoExportable:  'Cargo de medio tiempo no exportable sin horas definidas.',
    observaciones: 'Gemini debe marcar el medio tiempo con esJornadaParcialSinHoras=true y turnos=[]. El motor genera JORNADA_PARCIAL_SIN_HORAS automáticamente. El operario de tiempo completo sí exportable si tiene horario.',
    categorias: ['JORNADA_PARCIAL', 'MULTI_CARGO'],
    requiereMejorPrompt:       true,
    requiereCatalogoAdicional: false,
    requiereValidacionManual:  false,
  },

  // ── C14 ─────────────────────────────────────────────────────────────────────
  {
    idCaso:   'C14-VITRA-57',
    cliente:  'Vitra 57',
    textoOriginal: `Dos ofertas: (A) 1 posición aseador/todero lunes a sábado 44h. (B) 1 posición aseador/todero lunes a domingo. Adicional: vigilancia armada 24/7 + aseador/todero.`,
    empresaEsperada: 'MULTIPLE',
    escenariosEsperados: { cantidad: 3, notas: 'Oferta A (L-S) / Oferta B (L-D) / Oferta C (vigilancia + aseo)', condicionInsumos: null },
    cargosEsperados: [
      { cargoNormalizado: 'Aseador / Todero', cantidad: 1, tipoCobertura: 'persona', jornadaDeclaradaH: 44, tieneHorarioDefinido: false, observaciones: 'ASEOCOLBA. L-S.' },
      { cargoNormalizado: 'Aseador / Todero', cantidad: 1, tipoCobertura: 'persona', jornadaDeclaradaH: null, tieneHorarioDefinido: false, observaciones: 'ASEOCOLBA. L-D → excede 44h. Domingo con recargo.' },
      { cargoNormalizado: 'Vigilante',        cantidad: 1, tipoCobertura: 'puesto', requiereTurnante: true, tieneHorarioDefinido: false, observaciones: 'VIGICOLBA. 24/7 → FTE ≈ 3.82. No exportable sin rotación.' },
    ],
    alertasEsperadas: [
      { codigo: 'COBERTURA_INSUFICIENTE_FTE', severidad: 'ALTA', obligatoria: true,  razon: 'Vigilancia 24/7 puesto: FTE >> 1.' },
    ],
    preguntasEsperadas: [
      { prioridad: 'urgente', patronTexto: 'vigilancia armada', razon: '¿Armada o desarmada? Afecta empresa (VIGICOLBA), ARL y costo.' },
    ],
    exportableEsperado:  'parcial',
    motivoNoExportable:  'Vigilancia 24/7 no exportable sin distribución de rotación.',
    observaciones: 'esEscenarioMultiple=true (3 escenarios). MULTIEMPRESA: ASEOCOLBA para aseo, VIGICOLBA para vigilancia. Oferta B (L-D) genera recargo dominical. Vigilancia armada 24/7 es el cargo más complejo.',
    categorias: ['MULTI_ESCENARIO', 'MULTIEMPRESA', 'VIGILANCIA', '24_7', 'DOMINICAL', 'ALTURAS'],
    requiereMejorPrompt:       true,
    requiereCatalogoAdicional: false,
    requiereValidacionManual:  true,
    motivoValidacionManual:    'Vigilancia armada vs desarmada + rotación 24/7 requieren confirmación antes de exportar.',
  },

  // ── C15 ─────────────────────────────────────────────────────────────────────
  {
    idCaso:   'C15-OCEAN-MALL',
    cliente:  'Ocean Mall Vigilancia',
    textoOriginal: `Entrada/salida vehículos: 1 posición 24 horas lunes a domingo y festivos. CCTV: 08:00-22:00 lunes a domingo y festivos. Entrada vehicular: 08:00-22:00 lunes a domingo y festivos. Refuerzo vehicular: 12:00-20:00 lunes a domingo y festivos.`,
    empresaEsperada: 'VIGICOLBA',
    escenariosEsperados: { cantidad: 1, condicionInsumos: null },
    cargosEsperados: [
      { cargoNormalizado: 'Vigilante',                    cantidad: 1, tipoCobertura: 'puesto', requiereTurnante: true,   tieneHorarioDefinido: true,  observaciones: '24h L-D+Fest. FTE ≈ 3.82. No exportable.' },
      { cargoNormalizado: 'Operador CCTV / Vigilante',   cantidad: 1, tipoCobertura: 'puesto', tieneHorarioDefinido: true, observaciones: '14h/día L-D+Fest. Cargo a validar en catálogo.' },
      { cargoNormalizado: 'Vigilante',                    cantidad: 1, tipoCobertura: 'puesto', tieneHorarioDefinido: true, observaciones: 'Entrada vehicular 14h. Cargo duplicado vs CCTV?' },
      { cargoNormalizado: 'Vigilante',                    cantidad: 1, tipoCobertura: 'persona', tieneHorarioDefinido: true, observaciones: 'Refuerzo 8h. ¿Persona o puesto? A confirmar.' },
    ],
    alertasEsperadas: [
      { codigo: 'COBERTURA_INSUFICIENTE_FTE', severidad: 'ALTA', obligatoria: true,  razon: 'Entrada/salida 24/7 puesto: FTE ≈ 3.82 > 1.' },
      { codigo: 'FESTIVOS_EN_PERIODO',        severidad: 'MEDIA', obligatoria: false, razon: 'L-D + festivos incluidos explícitamente.' },
    ],
    preguntasEsperadas: [
      { prioridad: 'urgente', patronTexto: 'CCTV',     razon: '¿Operador CCTV requiere certificación especial? ¿Es cargo en catálogo?' },
      { prioridad: 'urgente', patronTexto: 'refuerzo', razon: '¿Refuerzo es puesto fijo o eventual? Afecta tipo de cobertura.' },
    ],
    exportableEsperado:  false,
    motivoNoExportable:  'Posición 24/7 no exportable sin rotación. CCTV no está en catálogo estándar.',
    observaciones: 'Empresa: VIGICOLBA (vigilancia exclusiva). L-D+festivos → recargos dominicales y festivos en todos los cargos. CCTV como cargo: confirmar si está en catálogo o requiere normalización.',
    categorias: ['MULTI_CARGO', 'VIGILANCIA', '24_7', 'FESTIVO', 'DOMINICAL'],
    requiereMejorPrompt:       false,
    requiereCatalogoAdicional: true,
    requiereValidacionManual:  true,
    motivoValidacionManual:    'CCTV como cargo, 4 posiciones distintas, festivos L-D requieren revisión comercial.',
  },

  // ── C16 ─────────────────────────────────────────────────────────────────────
  {
    idCaso:   'C16-RIBERA-ALTA',
    cliente:  'Ribera Alta',
    textoOriginal: `Servicio aseo, jardinería y salvavidas por 12 meses. Incluye insumos, dotación y EPP especial. 4 operarios aseo L-S 8h. 1 salvavidas V-D 8h. 1 conserje L-D 12h. 1 todero L-S 8h. Visita técnica aplazada.`,
    empresaEsperada: 'ASEOCOLBA',
    escenariosEsperados: { cantidad: 1, condicionInsumos: 'con_insumos' },
    cargosEsperados: [
      { cargoNormalizado: 'Operario de Aseo',       cantidad: 4, tipoCobertura: 'persona', jornadaDeclaradaH: null, tieneHorarioDefinido: true, observaciones: 'L-S 8h.' },
      { cargoNormalizado: 'Salvavidas / Piscinero',  cantidad: 1, tipoCobertura: 'persona', jornadaDeclaradaH: null, tieneHorarioDefinido: true, observaciones: 'V-D 8h → incluye domingo con recargo.' },
      { cargoNormalizado: 'Conserje / Portero',      cantidad: 1, tipoCobertura: 'puesto', tieneHorarioDefinido: true, observaciones: 'L-D 12h/día. Si es 07:00-19:00 → diurno (no mixto).' },
      { cargoNormalizado: 'Todero',                  cantidad: 1, tipoCobertura: 'persona', tieneHorarioDefinido: true, observaciones: 'L-S 8h. requiereAlturas=null → alerta.' },
    ],
    alertasEsperadas: [
      { codigo: 'ALTURAS_SIN_CONFIRMAR',  severidad: 'MEDIA', obligatoria: true,  razon: 'Todero: requiereAlturas=null (no mencionado).' },
      { codigo: 'ARL_SIN_VALIDAR',        severidad: 'ALTA', obligatoria: false, razon: 'Salvavidas: confirmar riesgo ARL (IV si certificado).' },
      { codigo: 'COBERTURA_INSUFICIENTE_FTE', severidad: 'ALTA', obligatoria: false, razon: 'Conserje L-D 12h: FTE=(7×12)/44≈1.91 > 1.' },
    ],
    preguntasEsperadas: [
      { prioridad: 'normal',  patronTexto: 'jardinería', razon: 'Jardinería mencionada pero sin operario asignado; ¿es cargo adicional?' },
      { prioridad: 'urgente', patronTexto: 'salvavidas',  razon: '¿El salvavidas tiene certificación? ARL depende.' },
    ],
    exportableEsperado:  'parcial',
    motivoNoExportable:  'Todero alturas sin confirmar; conserje 12/7 requiere ≥ 2 personas.',
    observaciones: 'Jardinería mencionada en el encabezado pero sin cargo asignado → pregunta pendiente. Conserje 12h L-D: si horario 07:00-19:00 es diurno puro. Salvavidas V-D → viernes (diurno) + sábado (diurno) + domingo (recargo 75%). EPP especial a detallar.',
    categorias: ['MULTI_CARGO', 'PISCINA_SALVAVIDAS', 'DOMINICAL', 'ALTURAS', 'VALOR_AGREGADO'],
    requiereMejorPrompt:       false,
    requiereCatalogoAdicional: false,
    requiereValidacionManual:  true,
    motivoValidacionManual:    'Jardinería sin cargo asignado; todero alturas; salvavidas ARL. Visita técnica pendiente.',
  },

  // ── C17 ─────────────────────────────────────────────────────────────────────
  {
    idCaso:   'C17-LUCCA',
    cliente:  'Lucca',
    textoOriginal: `4 operarios de aseo 44h. 1 todero lunes a sábado con herramientas básicas. 1 salvavidas martes a domingo. Valores agregados pendientes.`,
    empresaEsperada: 'ASEOCOLBA',
    escenariosEsperados: { cantidad: 1, condicionInsumos: null },
    cargosEsperados: [
      { cargoNormalizado: 'Operario de Aseo',      cantidad: 4, tipoCobertura: 'persona', jornadaDeclaradaH: 44, tieneHorarioDefinido: false },
      { cargoNormalizado: 'Todero',                cantidad: 1, tipoCobertura: 'persona', jornadaDeclaradaH: null, tieneHorarioDefinido: false, observaciones: 'Herramientas básicas = valor agregado menor.' },
      { cargoNormalizado: 'Salvavidas / Piscinero', cantidad: 1, tipoCobertura: 'persona', jornadaDeclaradaH: null, tieneHorarioDefinido: false, observaciones: 'M-D sin horario → FALTA_HORARIO.' },
    ],
    alertasEsperadas: [
      { codigo: 'FALTA_HORARIO',      severidad: 'ALTA', obligatoria: true,  razon: 'Salvavidas M-D sin horario explícito.' },
      { codigo: 'ARL_SIN_VALIDAR',    severidad: 'ALTA', obligatoria: false, razon: 'Salvavidas: confirmar certificación.' },
      { codigo: 'JORNADA_NO_DECLARADA', severidad: 'MEDIA', obligatoria: false, razon: 'Todero sin jornada declarada ni horario.' },
    ],
    preguntasEsperadas: [
      { prioridad: 'urgente', patronTexto: 'salvavidas', razon: 'Sin horario; ¿cuántas horas, qué días exactos?' },
      { prioridad: 'normal',  patronTexto: 'herramientas', razon: 'Herramientas básicas: ¿incluidas en contrato o cargo aparte?' },
      { prioridad: 'normal',  patronTexto: 'valores agregados', razon: '¿Qué valores agregados están pendientes?' },
    ],
    exportableEsperado:  'parcial',
    motivoNoExportable:  'Salvavidas y todero sin horarios. Valores agregados no definidos.',
    observaciones: 'Salvavidas M-D con turnos=[] → FALTA_HORARIO (no esJornadaParcialSinHoras). Los 4 operarios de aseo sí exportables si Gemini infiere horario estándar. Herramientas básicas no son cargo de MO directo.',
    categorias: ['MULTI_CARGO', 'PISCINA_SALVAVIDAS', 'VALOR_AGREGADO'],
    requiereMejorPrompt:       false,
    requiereCatalogoAdicional: false,
    requiereValidacionManual:  true,
    motivoValidacionManual:    'Salvavidas sin horario ni ARL; valores agregados pendientes de definición.',
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getCaso(id: string): CasoRealMO | undefined {
  return CASOS_REALES.find(c => c.idCaso === id);
}

export function getCasosPorCategoria(cat: CategoriaCase): CasoRealMO[] {
  return CASOS_REALES.filter(c => c.categorias.includes(cat));
}

export function getResumenMetadata() {
  return {
    total:                    CASOS_REALES.length,
    requierenMejorPrompt:     CASOS_REALES.filter(c => c.requiereMejorPrompt).map(c => c.idCaso),
    requierenCatalogo:        CASOS_REALES.filter(c => c.requiereCatalogoAdicional).map(c => c.idCaso),
    requierenValidacion:      CASOS_REALES.filter(c => c.requiereValidacionManual).map(c => c.idCaso),
    casosSimples:             CASOS_REALES.filter(c => c.categorias.includes('SIMPLE')).map(c => c.idCaso),
    casosMultiEmpresa:        CASOS_REALES.filter(c => c.empresaEsperada === 'MULTIPLE').map(c => c.idCaso),
    casos24_7:                CASOS_REALES.filter(c => c.categorias.includes('24_7')).map(c => c.idCaso),
    casosConSinInsumos:       CASOS_REALES.filter(c => c.escenariosEsperados.condicionInsumos === 'con_y_sin').map(c => c.idCaso),
  };
}