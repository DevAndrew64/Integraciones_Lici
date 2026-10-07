/**
 * Auditoría de fuentes exógenas candidatas (Segunda Generación, entregable
 * 5/8 — Línea B). SOLO diseño/documentación: ningún dato se descarga ni se
 * integra en esta ronda. Los campos marcados `pendiente: true` requieren
 * verificación directa contra la documentación del proveedor antes de
 * aprobar la integración — no se afirma nada aquí sin poder señalar de
 * dónde saldría la confirmación (mismo criterio "no inferir sin evidencia
 * primaria" aplicado en la auditoría del calendario Fed/Banrep).
 */

export type Prioridad = 'ALTA' | 'SECUNDARIA';

export interface AuditoriaFuenteExogena {
  variable: string;
  prioridad: Prioridad;
  proveedoresCandidatos: string[];
  licenciaTipica: string;
  historicoDisponibleEstimado: string;
  granularidad: string;
  zonaHoraria: string;
  timestamps: string;
  disponibleAntesDelCorteTrm: string;
  continuidad: string;
  costoEstimado: string;
  riesgoRevisionRetrospectiva: string;
  riesgoLeakage: 'NINGUNO' | 'BAJO' | 'MEDIO' | 'ALTO';
  pendienteVerificacion: boolean;
  notas: string;
}

export const AUDITORIA_FUENTES_EXOGENAS: AuditoriaFuenteExogena[] = [
  {
    variable: 'USD/COP spot (apertura/cierre/máximo/mínimo intradía)',
    prioridad: 'ALTA',
    proveedoresCandidatos: ['Investing.com (API/scraping)', 'TwelveData', 'Alpha Vantage', 'Yahoo Finance (no oficial)', 'Banco de la República — Serie histórica de tasa de cambio de mercado (SET-FX)'],
    licenciaTipica: 'La mayoría de proveedores de mercado retail (Investing, Yahoo) restringen uso comercial/redistribución en sus términos; TwelveData/Alpha Vantage tienen planes pagos con licencia explícita para uso productivo. Banrep publica series públicas pero con menor granularidad intradía.',
    historicoDisponibleEstimado: 'Proveedores de mercado retail: típicamente varios años de velas diarias, intradía limitado en planes gratuitos (semanas-meses).',
    granularidad: 'Diaria (todos) hasta 1 minuto (planes pagos de TwelveData/Alpha Vantage).',
    zonaHoraria: 'Requiere verificar — normalmente UTC o hora del mercado (Nueva York), NO Bogotá; conversión obligatoria antes de comparar contra fechaHoraCorte.',
    timestamps: 'Requiere verificar si el timestamp de "cierre diario" corresponde al cierre del mercado SET-FX colombiano o a un cierre genérico de sesión FX 24h (relevante porque el SET-FX cierra ~13:00 hora Bogotá, no a medianoche).',
    disponibleAntesDelCorteTrm: 'La TRM del día D se certifica con base en operaciones del día hábil D-1 — el spot USD/COP del día D-1 ESTARÍA disponible antes del corte, siempre que su timestamp de publicación real (no solo la fecha de la vela) sea anterior a la certificación. Pendiente de verificar caso por caso.',
    continuidad: 'Requiere verificar huecos en fines de semana/festivos colombianos vs. mercado FX global (que opera casi continuo) — desalineación de calendario es un riesgo real, análogo al de vigencias TRM (ver Fase 1/2 del baseline).',
    costoEstimado: 'Gratuito con límites de tasa (Alpha Vantage free tier, TwelveData free tier) hasta ~USD 50-100/mes para planes con más historia/granularidad — cifras aproximadas, requieren cotización vigente.',
    riesgoRevisionRetrospectiva: 'Bajo para spot FX (a diferencia de indicadores macro, no suele revisarse retroactivamente), pero el proveedor puede corregir datos erróneos días después — requiere snapshot con timestamp de descarga, no solo el valor.',
    riesgoLeakage: 'MEDIO',
    pendienteVerificacion: true,
    notas: 'Prioridad #1 para nowcast h=1: es la variable más directamente relacionada con el mecanismo de cálculo real de la TRM oficial (promedio de operaciones spot). Antes de integrar: confirmar zona horaria exacta y hora de cierre del proveedor elegido contra el mecanismo real de certificación de la TRM (Superfinanciera).',
  },
  {
    variable: 'DXY (índice dólar)',
    prioridad: 'SECUNDARIA',
    proveedoresCandidatos: ['ICE (fuente primaria)', 'Investing.com', 'FRED (Federal Reserve Economic Data)'],
    licenciaTipica: 'FRED: datos públicos de uso libre con atribución. ICE directo: licencia comercial.',
    historicoDisponibleEstimado: 'Décadas de historia diaria vía FRED.',
    granularidad: 'Diaria en FRED; intradía requiere proveedor de mercado.',
    zonaHoraria: 'FRED reporta en fecha calendario US, sin hora — requiere verificar el corte horario real.',
    timestamps: 'FRED suele publicar con 1 día de rezago respecto al cierre de mercado.',
    disponibleAntesDelCorteTrm: 'Pendiente de verificar — el rezago de publicación de FRED podría hacer que el dato de D-1 no esté disponible en el corte de la TRM de D.',
    continuidad: 'Calendario de mercado US (festivos Fed/NYSE) — reutilizable el trabajo ya hecho en `festivosFederalReserveBanks.ts` del baseline v1 para alinear calendarios.',
    costoEstimado: 'Gratuito vía FRED (uso público).',
    riesgoRevisionRetrospectiva: 'Bajo.',
    riesgoLeakage: 'BAJO',
    pendienteVerificacion: true,
    notas: 'Proxy de fortaleza global del dólar — relevante para forecast (h>=2), no para nowcast intradía dado el rezago de publicación.',
  },
  {
    variable: 'VIX (volatilidad implícita S&P500)',
    prioridad: 'SECUNDARIA',
    proveedoresCandidatos: ['CBOE (fuente primaria)', 'FRED', 'Investing.com'],
    licenciaTipica: 'FRED: público. CBOE directo: licencia comercial para redistribución.',
    historicoDisponibleEstimado: 'Desde 1990 vía FRED/CBOE.',
    granularidad: 'Diaria (cierre).',
    zonaHoraria: 'Cierre de mercado US (Nueva York).',
    timestamps: 'Publicado tras el cierre de NYSE — para el nowcast h=1 con corte antes del cierre US, no estaría disponible; para forecast con corte posterior al cierre US del día anterior, sí.',
    disponibleAntesDelCorteTrm: 'Depende de la hora exacta de fechaHoraCorte vs. el cierre NYSE (16:00 hora Nueva York) — requiere `ContextoPrediccionTrm.fechaHoraCorte` explícito para decidir caso por caso.',
    continuidad: 'Calendario NYSE.',
    costoEstimado: 'Gratuito vía FRED.',
    riesgoRevisionRetrospectiva: 'Bajo.',
    riesgoLeakage: 'BAJO',
    pendienteVerificacion: true,
    notas: 'Proxy de aversión al riesgo global — señal indirecta, no específica de COP.',
  },
  {
    variable: 'Brent / WTI (petróleo)',
    prioridad: 'SECUNDARIA',
    proveedoresCandidatos: ['EIA (US Energy Information Administration)', 'FRED', 'Investing.com'],
    licenciaTipica: 'EIA/FRED: público.',
    historicoDisponibleEstimado: 'Décadas de historia diaria.',
    granularidad: 'Diaria.',
    zonaHoraria: 'Requiere verificar (mercados de futuros operan casi 24h).',
    timestamps: 'Rezago de publicación variable según fuente.',
    disponibleAntesDelCorteTrm: 'Pendiente de verificar.',
    continuidad: 'Alta — mercado de futuros muy líquido.',
    costoEstimado: 'Gratuito vía EIA/FRED.',
    riesgoRevisionRetrospectiva: 'Bajo.',
    riesgoLeakage: 'BAJO',
    pendienteVerificacion: true,
    notas: 'Colombia es exportador neto de petróleo — relación teórica con COP documentada en la literatura económica, pero no verificada empíricamente en este harness todavía.',
  },
  {
    variable: 'Tasas de interés (Fed Funds Rate, tasa BanRep)',
    prioridad: 'SECUNDARIA',
    proveedoresCandidatos: ['FRED (Fed Funds)', 'Banco de la República (tasa de intervención)'],
    licenciaTipica: 'Ambas públicas.',
    historicoDisponibleEstimado: 'Décadas.',
    granularidad: 'Por reunión de política monetaria (no diaria) — variable de baja frecuencia, relevante como régimen más que como serie continua.',
    zonaHoraria: 'No aplica (evento discreto, fecha de anuncio).',
    timestamps: 'Fecha de anuncio pública y conocida con antelación (calendario de reuniones).',
    disponibleAntesDelCorteTrm: 'Sí, siempre que el anuncio sea anterior a fechaHoraCorte — es la variable con MENOR riesgo de leakage de toda la lista, por ser un evento discreto y públicamente calendarizado.',
    continuidad: 'N/A — evento discreto.',
    costoEstimado: 'Gratuito.',
    riesgoRevisionRetrospectiva: 'Ninguno (decisión de política monetaria no se revisa retroactivamente).',
    riesgoLeakage: 'NINGUNO',
    pendienteVerificacion: false,
    notas: 'Candidata de bajo costo/bajo riesgo para una primera integración exógena, si el análisis de estructura del target (ver reporte) llegara a justificarla — hoy el análisis TRM-only no encontró señal que motive priorizar esto todavía.',
  },
  {
    variable: 'Monedas regionales (MXN, BRL, CLP, PEN vs. USD)',
    prioridad: 'SECUNDARIA',
    proveedoresCandidatos: ['TwelveData', 'Alpha Vantage', 'bancos centrales respectivos'],
    licenciaTipica: 'Similar a USD/COP spot.',
    historicoDisponibleEstimado: 'Similar a USD/COP spot.',
    granularidad: 'Diaria a intradía según proveedor.',
    zonaHoraria: 'Requiere verificar por moneda.',
    timestamps: 'Requiere verificar por moneda.',
    disponibleAntesDelCorteTrm: 'Pendiente de verificar.',
    continuidad: 'Pendiente de verificar (calendarios de mercado distintos por país).',
    costoEstimado: 'Similar a USD/COP spot (mismo proveedor típicamente cubre varias monedas en el mismo plan).',
    riesgoRevisionRetrospectiva: 'Bajo.',
    riesgoLeakage: 'MEDIO',
    pendienteVerificacion: true,
    notas: 'Proxy de "contagio regional" (movimientos correlacionados de monedas emergentes) — de menor prioridad hasta agotar el análisis de USD/COP spot directo.',
  },
];
