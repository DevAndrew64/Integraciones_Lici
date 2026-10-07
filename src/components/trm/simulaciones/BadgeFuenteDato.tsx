'use client';

import React from 'react';

const FUENTE_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  manual:           { label: 'Manual', bg: '#f1f5f9', color: '#64748b' },
  gemini:           { label: 'IA', bg: '#ede9fe', color: '#6d28d9' },
  historico:        { label: 'Histórico', bg: '#dcfce7', color: '#166534' },
  cache:            { label: 'Caché', bg: '#eff6ff', color: '#1d4ed8' },
  externo:          { label: 'Externo', bg: '#fef3c7', color: '#92400e' },
  lectura_analisis: { label: 'Análisis', bg: '#dcfce7', color: '#166534' },
};

interface Props {
  fuente: string;
}

export function BadgeFuenteDato({ fuente }: Props) {
  const cfg = FUENTE_CONFIG[fuente] ?? { label: fuente, bg: '#f1f5f9', color: '#64748b' };
  return (
    <span style={{
      display: 'inline-block',
      background: cfg.bg, color: cfg.color,
      padding: '1px 7px', borderRadius: 10,
      fontSize: 10, fontWeight: 700, letterSpacing: '.02em',
    }}>
      {cfg.label}
    </span>
  );
}