export type TipoDocumento =
  | 'PLIEGO_PRINCIPAL'
  | 'ESTUDIOS_PREVIOS'
  | 'ANEXO_TECNICO'
  | 'PRESUPUESTO'
  | 'MATRIZ_RIESGOS'
  | 'EVALUACION_CALIDAD'
  | 'ADENDA'
  | 'OBSERVACIONES'
  | 'FORMATO_OBLIGATORIO'
  | 'ACTO_ADMINISTRATIVO'
  | 'AVISO_CONVOCATORIA'
  | 'OTRO';

export type FormatoArchivo = 'pdf' | 'word' | 'excel' | 'otro';

export type ClasificacionDoc = {
  tipo: TipoDocumento;
  /** Orden de aparición en grupos visuales (modal, badges). Menor = primero. */
  prioridad: number;
  /** Prioridad jurídica/documental para deduplicación. Menor = fuente más autoritativa. */
  prioridadDedup: number;
  grupo: string;
  descripcion: string;
  recomendadoParaAnalisisCompleto: boolean;
  color: string;
  bgColor: string;
  labelCorto: string;
};

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function clasificarDocumentoProceso(nombre: string): ClasificacionDoc {
  const n = norm(nombre);

  // 1. ADENDA — prioridad jurídica máxima (modifica/supera el pliego)
  if (/adenda/.test(n)) {
    return {
      tipo: 'ADENDA', prioridad: 4, prioridadDedup: 1,
      grupo: 'Adendas', descripcion: 'Adenda al pliego', labelCorto: 'Adenda',
      recomendadoParaAnalisisCompleto: true,
      color: '#92400e', bgColor: '#fef3c7',
    };
  }

  // 2. PLIEGO_PRINCIPAL
  if (
    /pliego\s*(de\s*condiciones|definitivo|final|vf\b|v\s*final|principal)/.test(n) ||
    /documento\s*(complementario\s*del?\s*)?pliego/.test(n) ||
    /proyecto\s*de\s*pliego/.test(n)
  ) {
    return {
      tipo: 'PLIEGO_PRINCIPAL', prioridad: 1, prioridadDedup: 2,
      grupo: 'Pliego principal', descripcion: 'Pliego de condiciones', labelCorto: 'Pliego',
      recomendadoParaAnalisisCompleto: true,
      color: '#1e3a8a', bgColor: '#dbeafe',
    };
  }

  // 3. ESTUDIOS_PREVIOS
  if (/estudio[s]?\s*previo[s]?/.test(n) || /\bep\s+[a-z]/.test(n) || /\bep\s*-/.test(n)) {
    return {
      tipo: 'ESTUDIOS_PREVIOS', prioridad: 2, prioridadDedup: 4,
      grupo: 'Estudios previos', descripcion: 'Estudio previo', labelCorto: 'Estudio previo',
      recomendadoParaAnalisisCompleto: true,
      color: '#065f46', bgColor: '#d1fae5',
    };
  }

  // 4. MATRIZ_RIESGOS
  if (/matriz\s*(de\s*)?riesgo[s]?/.test(n) || /\briesgo[s]?\b/.test(n)) {
    return {
      tipo: 'MATRIZ_RIESGOS', prioridad: 5, prioridadDedup: 6,
      grupo: 'Matriz de riesgos', descripcion: 'Matriz de riesgos', labelCorto: 'Riesgos',
      recomendadoParaAnalisisCompleto: true,
      color: '#dc2626', bgColor: '#fee2e2',
    };
  }

  // 5. ANEXO_TECNICO
  if (
    /anexo\s*(de?\s*)?especificacione?s?\s*(tecnicas?)?/.test(n) ||
    /especificacione?s?\s*tecnicas?/.test(n) ||
    /ficha\s*tecnica/.test(n) ||
    /medios?\s*tecnologico[s]?/.test(n)
  ) {
    return {
      tipo: 'ANEXO_TECNICO', prioridad: 3, prioridadDedup: 3,
      grupo: 'Anexo técnico', descripcion: 'Especificaciones técnicas', labelCorto: 'Técnico',
      recomendadoParaAnalisisCompleto: true,
      color: '#0369a1', bgColor: '#e0f2fe',
    };
  }

  // 6. PRESUPUESTO
  if (
    /presupuesto/.test(n) || /propuesta\s*economica/.test(n) ||
    /cotizacion/.test(n) || /formato\s*de\s*cotizacion/.test(n)
  ) {
    return {
      tipo: 'PRESUPUESTO', prioridad: 6, prioridadDedup: 5,
      grupo: 'Presupuesto', descripcion: 'Presupuesto / Propuesta económica', labelCorto: 'Presupuesto',
      recomendadoParaAnalisisCompleto: true,
      color: '#166534', bgColor: '#dcfce7',
    };
  }

  // 7. EVALUACION_CALIDAD
  if (
    /factor\s*(de\s*)?calidad/.test(n) ||
    /factores?\s*(de\s*)?desempate/.test(n) ||
    /criterio[s]?\s*(de\s*)?evaluacion/.test(n)
  ) {
    return {
      tipo: 'EVALUACION_CALIDAD', prioridad: 7, prioridadDedup: 7,
      grupo: 'Evaluación / calidad', descripcion: 'Criterios de evaluación y calidad', labelCorto: 'Calidad',
      recomendadoParaAnalisisCompleto: true,
      color: '#6d28d9', bgColor: '#ede9fe',
    };
  }

  // 8. OBSERVACIONES
  if (/respuesta[s]?\s*(a\s*)?observaciones?/.test(n) || /observaciones?/.test(n)) {
    return {
      tipo: 'OBSERVACIONES', prioridad: 8, prioridadDedup: 9,
      grupo: 'Observaciones', descripcion: 'Respuestas a observaciones', labelCorto: 'Observaciones',
      recomendadoParaAnalisisCompleto: true,
      color: '#7c3aed', bgColor: '#f3e8ff',
    };
  }

  // 9. ACTO_ADMINISTRATIVO
  if (/acto\s*administrativo/.test(n) || /apertura/.test(n)) {
    return {
      tipo: 'ACTO_ADMINISTRATIVO', prioridad: 9, prioridadDedup: 8,
      grupo: 'Actos administrativos', descripcion: 'Acto administrativo', labelCorto: 'Acto admin.',
      recomendadoParaAnalisisCompleto: true,
      color: '#1e40af', bgColor: '#dbeafe',
    };
  }

  // 10. AVISO_CONVOCATORIA
  if (/\baviso\b/.test(n) || /\bconvocatoria\b/.test(n)) {
    return {
      tipo: 'AVISO_CONVOCATORIA', prioridad: 10, prioridadDedup: 11,
      grupo: 'Avisos y convocatorias', descripcion: 'Aviso de convocatoria', labelCorto: 'Aviso',
      recomendadoParaAnalisisCompleto: false,
      color: '#64748b', bgColor: '#f1f5f9',
    };
  }

  // 11. FORMATO_OBLIGATORIO
  if (
    /\bformato\b/.test(n) ||
    /carta\s*(de\s*)?presentacion/.test(n) ||
    /compromiso\s*consorcial/.test(n) ||
    /union\s*temporal/.test(n) ||
    /\baportes\b/.test(n) ||
    /inhabilidade?s?/.test(n) ||
    /relacion\s*(de\s*)?contratos/.test(n) ||
    /hoja\s*(de\s*)?vida/.test(n) ||
    /\bexperiencia\b/.test(n) ||
    /tratamiento\s*(de\s*)?datos/.test(n)
  ) {
    return {
      tipo: 'FORMATO_OBLIGATORIO', prioridad: 11, prioridadDedup: 10,
      grupo: 'Formatos obligatorios', descripcion: 'Formato obligatorio de la oferta', labelCorto: 'Formato',
      recomendadoParaAnalisisCompleto: false,
      color: '#6b7280', bgColor: '#f1f5f9',
    };
  }

  // 12. OTRO
  return {
    tipo: 'OTRO', prioridad: 12, prioridadDedup: 12,
    grupo: 'Otros', descripcion: 'Documento sin clasificar', labelCorto: 'Otro',
    recomendadoParaAnalisisCompleto: false,
    color: '#9ca3af', bgColor: '#f9fafb',
  };
}

/**
 * Detecta el formato de archivo a partir del nombre (o URL).
 * Retorna `soportado: false` para formatos que el sistema no puede extraer texto (PPT, CSV, ZIP, etc.).
 */
export function detectarFormatoArchivo(nombre: string): { formato: FormatoArchivo; soportado: boolean } {
  const n = nombre.toLowerCase().split('?')[0]; // remove query strings
  if (/\.(docx?)$/.test(n)) return { formato: 'word', soportado: true };
  if (/\.(xlsx?|xlsm|xlsb)$/.test(n)) return { formato: 'excel', soportado: true };
  if (/\.(pptx?|csv|zip|rar|7z|txt)$/.test(n)) return { formato: 'otro', soportado: false };
  // Default: assume PDF (most SECOP documents are PDF even without explicit extension)
  return { formato: 'pdf', soportado: true };
}

/** Agrupa documentos clasificados por grupo, ordenados por prioridad visual mínima. */
export function agruparDocumentos<T extends { clasif: ClasificacionDoc }>(
  docs: T[]
): Array<{ grupo: string; tipo: TipoDocumento; color: string; bgColor: string; items: T[] }> {
  const map = new Map<string, { grupo: string; tipo: TipoDocumento; color: string; bgColor: string; items: T[]; minPrioridad: number }>();

  for (const doc of docs) {
    const g = doc.clasif.grupo;
    if (!map.has(g)) {
      map.set(g, { grupo: g, tipo: doc.clasif.tipo, color: doc.clasif.color, bgColor: doc.clasif.bgColor, items: [], minPrioridad: doc.clasif.prioridad });
    }
    const entry = map.get(g)!;
    entry.items.push(doc);
    if (doc.clasif.prioridad < entry.minPrioridad) entry.minPrioridad = doc.clasif.prioridad;
  }

  return Array.from(map.values()).sort((a, b) => a.minPrioridad - b.minPrioridad);
}