/**
 * Auditoría profunda de fuentes USD/COP (Segunda Generación, Línea B —
 * entregable §2). SOLO diseño/documentación — ningún dato se descarga ni
 * se integra en esta ronda. Investigado con búsquedas verificables (ver
 * citas en el reporte de esta ronda), no inferido — los campos marcados
 * `pendienteVerificacion: true` requieren confirmación directa contra la
 * documentación del proveedor antes de aprobar la integración.
 */

export type Prioridad = 1 | 2 | 3; // 1=oficial/institucional, 2=proveedor financiero robusto, 3=agregador de respaldo

export interface AuditoriaFuenteUsdCop {
  proveedor: string;
  prioridad: Prioridad;
  endpointOMecanismo: string;
  costo: string;
  coberturaHistorica: string;
  frecuencia: ('diaria' | 'horaria' | 'minuto' | 'tick')[];
  zonaHoraria: string;
  timestamps: string;
  aperturaCierre: string;
  highLow: string;
  volumen: string;
  continuidad: string;
  diasFaltantes: string;
  revisionesRetrospectivas: string;
  licencia: string;
  estabilidadAcceso: string;
  permiteUsoProductivo: string;
  riesgoLeakage: 'NINGUNO' | 'BAJO' | 'MEDIO' | 'ALTO';
  pendienteVerificacion: boolean;
  notas: string;
}

export const AUDITORIA_FUENTES_USD_COP: AuditoriaFuenteUsdCop[] = [
  {
    proveedor: 'Banco de la República — Portal de Estadísticas Económicas / datos.gov.co (TRM histórica, NO spot SET-FX)',
    prioridad: 1,
    endpointOMecanismo: 'Portal de Estadísticas Económicas (series prearmadas) + dataset abierto datos.gov.co (mismo usado en el harness v1, `trm-raw-response.json`).',
    costo: 'Gratuito.',
    coberturaHistorica: 'Décadas (ya en uso: 2016-2026 en el harness v1, con historia disponible más atrás).',
    frecuencia: ['diaria'],
    zonaHoraria: 'Fecha calendario Colombia, sin componente horario — es la TRM CERTIFICADA, no la cotización spot en tiempo real.',
    timestamps: 'Solo fecha de vigencia (vigenciaDesde/vigenciaHasta) — sin hora.',
    aperturaCierre: 'No aplica — es un valor único diario (la TRM certificada), no una serie OHLC.',
    highLow: 'No disponible.',
    volumen: 'No disponible.',
    continuidad: 'Alta (ya validada exhaustivamente en el harness v1 — 2.500 eventos oficiales sin huecos relevantes).',
    diasFaltantes: 'Ninguno conocido dentro del rango ya auditado.',
    revisionesRetrospectivas: 'Ninguna — es la certificación oficial, definitiva desde su publicación.',
    licencia: 'Datos públicos de uso libre.',
    estabilidadAcceso: 'Alta — API pública estable, ya en uso productivo dentro del harness.',
    permiteUsoProductivo: 'Sí.',
    riesgoLeakage: 'NINGUNO',
    pendienteVerificacion: false,
    notas: 'IMPORTANTE: esto es la TRM misma (el target), no la variable USD/COP spot independiente que se busca en esta ronda — se incluye aquí solo para dejar constancia de que Banrep NO publica en abierto la serie de operaciones SET-FX subyacente con la granularidad necesaria (no se encontró, en la búsqueda de esta ronda, un endpoint abierto de spot intradía — ver "Banco de la República — spot SET-FX" abajo).',
  },
  {
    proveedor: 'SET-ICAP FX — DAPI (Datatec Application Programming Interface)',
    prioridad: 1,
    endpointOMecanismo: 'Mecanismo de TRANSMISIÓN AUTOMÁTICA de información entre el sistema SET-FX y un tercero — es la vía técnica más parecida a una "API" de este proveedor, pero es un servicio contractual, no autoservicio: requiere afiliación/contrato con SET-ICAP FX, no hay endpoint público auto-gestionable.',
    costo: 'Tarifado por usuario, publicado en boletines anuales de SET-ICAP FX (ej. Boletín No. 382, tarifas 2022; existen boletines más recientes de 2024) — "cada usuario adicional tiene un costo equivalente a la mitad del primer usuario", confirmado; cifra exacta vigente pendiente de cotización directa.',
    coberturaHistorica: 'No verificado — depende de lo que el contrato de afiliación incluya (histórico vs. solo transmisión en tiempo real hacia adelante). Debe preguntarse explícitamente en la cotización.',
    frecuencia: ['tick', 'minuto'],
    zonaHoraria: 'America/Bogota (sesión SET-FX 08:00–13:00, más "Next day" 14:30–16:30 — verificado).',
    timestamps: 'No verificado si DAPI transmite timestamp por operación individual (tick) o solo agregados por barra — pendiente de confirmar en la ficha técnica/cotización.',
    aperturaCierre: 'La ventana de sesión spot está fija (08:00–13:00 Bogotá) — si DAPI entrega granularidad de operación, apertura/cierre serían derivables; no confirmado si vienen ya calculados.',
    highLow: 'No verificado.',
    volumen: 'Probable (es infraestructura de registro de operaciones reales) — no confirmado el campo exacto.',
    continuidad: 'Días hábiles colombianos (mismo calendario ya auditado en `calendarioHabil.ts`/`festivosFederalReserveBanks.ts`, harness v1).',
    diasFaltantes: 'No verificado.',
    revisionesRetrospectivas: 'No verificado — relevante preguntar explícitamente (operaciones tardías/correcciones post-sesión).',
    licencia: 'Contractual — requiere afiliación comercial directa con SET-ICAP FX; términos de uso interno/almacenamiento/modelado NO públicos, deben negociarse.',
    estabilidadAcceso: 'Infraestructura de mercado regulado, probablemente estable, pero sin SLA público conocido.',
    permiteUsoProductivo: 'No verificado — debe confirmarse explícitamente en el contrato (uso en modelos predictivos no es lo mismo que uso de visualización/BI).',
    riesgoLeakage: 'BAJO',
    pendienteVerificacion: true,
    notas: 'ES LA FUENTE CONCEPTUALMENTE MÁS CORRECTA para transmisión automática — pero es contractual, no autoservicio. Requiere cotización directa (ver propuesta de correo en el reporte de esta ronda) antes de poder completar esta ficha.',
  },
  {
    proveedor: 'SET-ICAP FX — SET-FX Analytics',
    prioridad: 1,
    endpointOMecanismo: 'Herramienta de Business Intelligence vía navegador web (usuario/clave), con visualizaciones y análisis cuantitativo sobre las transacciones negociadas/registradas en SET-FX (Spot, Next Day, Forward, Swaps, Opciones, IRS, CCS, todos los pares negociados en Colombia) — acceso también desde apps móviles (iOS/Android). NO es un mecanismo de transmisión automática (a diferencia de DAPI) — es una interfaz de consulta/análisis para un humano, no pensada para integrarse directamente a un pipeline de datos.',
    costo: 'Suscripción — cifra exacta no pública, requiere cotización.',
    coberturaHistorica: 'No verificado — depende de la suscripción contratada.',
    frecuencia: ['diaria', 'minuto'],
    zonaHoraria: 'America/Bogota (asumido, no confirmado explícitamente).',
    timestamps: 'No verificado.',
    aperturaCierre: 'Probable (herramienta de análisis de mercado) — no confirmado el detalle exacto de campos exportables.',
    highLow: 'No verificado.',
    volumen: 'Probable — no confirmado.',
    continuidad: 'No verificado.',
    diasFaltantes: 'No verificado.',
    revisionesRetrospectivas: 'No verificado.',
    licencia: 'Contractual, para uso vía interfaz — el derecho a EXTRAER datos de forma automatizada (vs. solo visualizar) no está confirmado, debe preguntarse explícitamente.',
    estabilidadAcceso: 'No verificado.',
    permiteUsoProductivo: 'No verificado — riesgo de que sea una herramienta de consulta manual, no una fuente apta para un pipeline automatizado.',
    riesgoLeakage: 'MEDIO',
    pendienteVerificacion: true,
    notas: 'Riesgo MEDIO porque, al ser una herramienta de consulta manual (no confirmada su exportación automatizada), integrarla a un pipeline reproducible podría requerir procesos manuales propensos a error de alineación de corte. Preguntar explícitamente en la cotización si existe exportación automatizada (CSV/Excel/API) además de la interfaz visual.',
  },
  {
    proveedor: 'SET-ICAP FX — "Dólar SET-FX" (dolar.set-icap.com, página pública en tiempo real)',
    prioridad: 3,
    endpointOMecanismo: 'Página web pública ("Información del Dólar en Tiempo Real") — sin mecanismo de descarga/API confirmado, análogo en naturaleza a Investing.com (consulta visual, no integración programática oficial).',
    costo: 'Gratuito para consulta visual.',
    coberturaHistorica: 'No verificado — probablemente solo el valor actual/reciente, no histórico profundo.',
    frecuencia: [],
    zonaHoraria: 'America/Bogota (asumido).',
    timestamps: 'No verificado.',
    aperturaCierre: 'No verificado.',
    highLow: 'No verificado.',
    volumen: 'No verificado.',
    continuidad: 'No verificado.',
    diasFaltantes: 'No verificado.',
    revisionesRetrospectivas: 'No verificado.',
    licencia: 'No verificado — sin API pública confirmada, mismo riesgo que Investing.com si se intentara scraping.',
    estabilidadAcceso: 'No verificado.',
    permiteUsoProductivo: 'No — sin confirmación de licencia de uso programático, se trata igual que Investing.com (fuente de referencia visual únicamente, no candidata de integración).',
    riesgoLeakage: 'BAJO',
    pendienteVerificacion: true,
    notas: 'Riesgo de leakage BAJO si funcionara, pero se descarta como candidata de integración por falta de mecanismo oficial de acceso programático — igual criterio que Investing.com. Útil solo como referencia de contraste manual, nunca como fuente del pipeline.',
  },
  {
    proveedor: 'TwelveData (Forex API)',
    prioridad: 2,
    endpointOMecanismo: '/time_series (REST), símbolo COP/USD o USD/COP disponible desde el plan "Basic" en adelante — verificado vía búsqueda.',
    costo: 'CORREGIDO esta ronda — el precio de ~USD 29/mes reportado antes era incorrecto. Planes INDIVIDUALES verificados: Grow USD 79/mes, Pro USD 229/mes, Ultra USD 999/mes — y estos planes individuales son EXPLÍCITAMENTE "para uso personal, interno y no comercial" (confirmado en la página de precios). Para uso comercial/productivo se requiere un plan de NEGOCIO (Venture/Enterprise), con precio NO público — solo por cotización directa. Además, redistribución externa (si aplicara) requiere un "Redistribution Rights Add-On" aparte, y el precio de datos fuera de EE.UU. (como USD/COP) requiere aprobación adicional para uso comercial — todo confirmado vía búsqueda esta ronda.',
    coberturaHistorica: 'Intradía (1min–8h) típicamente varios años; diaria, más profunda — verificado en general para forex, sin cifra exacta confirmada para el par USD/COP específico.',
    frecuencia: ['diaria', 'horaria', 'minuto'],
    zonaHoraria: 'Pendiente de verificar exactamente (documentación de la API) — proveedores de forex globales suelen reportar en UTC.',
    timestamps: 'Por vela (timestamp de apertura de cada intervalo) — pendiente confirmar granularidad exacta de publicación en tiempo real (delay).',
    aperturaCierre: 'Sí (OHLC estándar).',
    highLow: 'Sí.',
    volumen: 'Variable según el par — forex spot en general no siempre reporta volumen real (mercado descentralizado); pendiente verificar para USD/COP específicamente.',
    continuidad: 'Mercado FX global casi continuo 24/5 — DISTINTO del calendario SET-FX colombiano (8am-1pm días hábiles CO); requiere alineación explícita, no asumir que "sin dato" en TwelveData para un día implica que SET-FX tampoco operó, ni viceversa.',
    diasFaltantes: 'No verificado para USD/COP específicamente.',
    revisionesRetrospectivas: 'Bajo riesgo típico en spot FX (no es un dato macro sujeto a revisión), pero no confirmado explícitamente por el proveedor.',
    licencia: 'CORREGIDO: los planes INDIVIDUALES (Grow/Pro/Ultra) son explícitamente para uso personal/interno/no comercial — NO cubren un modelo predictivo que eventualmente sirva un resultado a usuarios de Licycolba. Se requiere un plan de NEGOCIO (Venture/Enterprise, precio por cotización) y posible aprobación adicional para datos fuera de EE.UU.',
    estabilidadAcceso: 'API REST documentada, empresa establecida — razonablemente estable.',
    permiteUsoProductivo: 'NO en los planes individuales (Grow/Pro/Ultra) — requiere confirmar plan de negocio y aprobación de datos no-US antes de asumir que es viable para producción.',
    riesgoLeakage: 'MEDIO',
    pendienteVerificacion: true,
    notas: 'PLAN B únicamente — degradado de "candidato práctico principal" a plan de respaldo tras corregir el costo/licencia real: (a) el símbolo cotiza en el mercado FX global 24h, que NO es la sesión SET-FX colombiana, riesgo de desalineación de calendario; (b) el costo real para uso productivo requiere un plan de negocio no público, sustancialmente más caro que lo asumido en la ronda anterior; (c) los planes individuales explícitamente NO permiten el uso que necesitamos. Solo evaluar tras descartar/confirmar SET-ICAP FX (DAPI) como opción principal.',
  },
  {
    proveedor: 'Alpha Vantage (FX_DAILY / FX_INTRADAY)',
    prioridad: 2,
    endpointOMecanismo: 'FX_DAILY (histórico diario, gratuito) / FX_INTRADAY (gratuito con alcance muy limitado) — verificado vía búsqueda.',
    costo: 'Nivel gratuito existe (con límite de ~25 solicitudes/día o 5/min según la fuente consultada) — planes pagos para mayor volumen.',
    coberturaHistorica: 'FX_DAILY: profunda (años). FX_INTRADAY gratuito: MUY limitada — solo ~100 puntos recientes (aprox. el último día de trading a 1 min) o hasta 30 días con `outputsize=full` — verificado. Insuficiente para backtesting histórico de nowcast intradía sin plan pago.',
    frecuencia: ['diaria', 'minuto'],
    zonaHoraria: 'Pendiente de verificar exactamente en la documentación.',
    timestamps: 'Por vela.',
    aperturaCierre: 'Sí (OHLC).',
    highLow: 'Sí.',
    volumen: 'No confirmado para forex (spot FX descentralizado, volumen no siempre significativo).',
    continuidad: 'Mercado FX global — mismo riesgo de desalineación con SET-FX que TwelveData.',
    diasFaltantes: 'No verificado.',
    revisionesRetrospectivas: 'No verificado.',
    licencia: 'Uso gratuito permitido con atribución para casos no comerciales/prototipos según los términos generales de la plataforma — el propio proveedor indica que el nivel gratuito está pensado para aprendizaje/prototipos, no para producción (verificado vía búsqueda).',
    estabilidadAcceso: 'Límites de tasa estrictos en el nivel gratuito — poco práctico para una descarga histórica masiva o para producción real sin pagar.',
    permiteUsoProductivo: 'No en el nivel gratuito (según el propio proveedor); requiere plan pago para eso.',
    riesgoLeakage: 'MEDIO',
    pendienteVerificacion: true,
    notas: 'Riesgo MEDIO (mismo problema de calendario que TwelveData) + riesgo operativo alto por límite de tasa. Útil únicamente para un PRIMER prototipo/prueba de concepto con FX_DAILY (gratuito, suficiente historia diaria) — no apto para el nowcast intradía (h=1, escenario B) ni para producción, por las limitaciones confirmadas del nivel gratuito.',
  },
  {
    proveedor: 'Investing.com',
    prioridad: 3,
    endpointOMecanismo: 'SIN API pública oficial — cualquier acceso programático es no oficial (scraping/librerías de terceros como `investpy`/`investiny`), verificado vía búsqueda: "Investing.com does not offer public API access due to the terms of their contractual agreements with their data providers".',
    costo: 'Gratuito para uso manual/visual del sitio; sin mecanismo comercial de API.',
    coberturaHistorica: 'Amplia en el sitio web (no verificable de forma estable vía scraping).',
    frecuencia: ['diaria'],
    zonaHoraria: 'No verificado de forma confiable (dependería del método de scraping usado).',
    timestamps: 'No verificado.',
    aperturaCierre: 'Visualmente sí, programáticamente no garantizado.',
    highLow: 'Visualmente sí.',
    volumen: 'No aplica típicamente para FX en este sitio.',
    continuidad: 'No verificable de forma estable.',
    diasFaltantes: 'No verificable.',
    revisionesRetrospectivas: 'No verificable.',
    licencia: 'Explícitamente SIN API pública — cualquier scraping viola los términos contractuales del proveedor con SUS proveedores de datos (confirmado por la propia página de soporte de Investing.com).',
    estabilidadAcceso: 'Baja — cualquier scraping puede romperse sin aviso y expone a riesgo legal/de bloqueo.',
    permiteUsoProductivo: 'No — descartado para este proyecto por esta razón, no solo por preferencia técnica.',
    riesgoLeakage: 'BAJO',
    pendienteVerificacion: false,
    notas: 'Riesgo de leakage BAJO si funcionara, pero IRRELEVANTE — se descarta por la razón de licencia/estabilidad, no por leakage. DESCARTADO como fuente candidata para este proyecto: sin API oficial y con términos que expresamente excluyen el acceso programático redistribuible. Se mantiene documentado solo para no repetir la investigación.',
  },
];

/**
 * Recomendación de esta ronda (auditoría, no integración): para el
 * BACKTESTING histórico (features diarias TRAIN/VALIDATION/TEST), usar
 * FX_DAILY de un proveedor con API REST estándar y licencia clara para el
 * volumen necesario (TwelveData en un plan pago, dado que Alpha Vantage
 * gratuito no permite uso productivo); para el NOWCAST intradía en
 * producción (si se implementa escenario B — pronóstico durante la
 * sesión), se requiere obligatoriamente un plan con intradía real y
 * licencia productiva confirmada — no el nivel gratuito de ningún
 * proveedor auditado aquí. La fuente conceptualmente correcta (spot SET-FX
 * real) queda pendiente de una segunda ronda de contacto directo con
 * SET-ICAP FX antes de descartarla o aprobarla.
 */
export const RECOMENDACION_FUENTE_USD_COP = {
  // Ajuste "FASE B.1 — corrección del diagnóstico" — SET-ICAP FX SÍ tiene
  // infraestructura contractual real (DAPI/Analytics), y el costo de
  // TwelveData estaba subestimado (planes individuales no cubren uso
  // productivo). Prioridad invertida respecto a la ronda anterior.
  opcionPrincipal: 'SET-ICAP FX — DAPI, para transmisión automática de datos de operaciones SET-FX (Spot/FIX). Requiere cotización directa antes de aprobar — ver dataset mínimo y propuesta de correo en el reporte de esta ronda.',
  planB: 'TwelveData plan de NEGOCIO (Venture/Enterprise, precio por cotización) — solo si SET-ICAP FX no es viable en costo/plazo/licencia. Los planes individuales (Grow/Pro/Ultra) quedan DESCARTADOS por licencia (no permiten uso productivo).',
  descartadas: [
    'Investing.com (sin API oficial, términos que excluyen redistribución programática).',
    '"Dólar SET-FX" página pública (dolar.set-icap.com) — mismo motivo que Investing.com, sin mecanismo de acceso programático confirmado.',
  ],
} as const;
