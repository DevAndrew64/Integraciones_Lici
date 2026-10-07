'use client';

import React from 'react';
import { NAVY, sCard, sCardHead, sCardBody } from './types';

export function ProcesosSimilaresPanel() {
  return (
    <div style={sCard}>
      <div style={sCardHead}>
        <div style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>Procesos similares</div>
        <button
          disabled
          title="Próxima fase"
          style={{
            padding: '5px 12px', borderRadius: 7,
            border: '1px solid #e2e8f0', background: '#f8fafc',
            color: '#94a3b8', fontSize: 11, fontWeight: 600, cursor: 'not-allowed',
          }}
        >
          Buscar procesos similares · próxima fase
        </button>
      </div>
      <div style={{ ...sCardBody, textAlign: 'center' as const, padding: '32px 20px' }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
          No hay procesos similares calculados todavía.
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8', maxWidth: 440, margin: '0 auto' }}>
          Esta sección estará disponible cuando se habilite la búsqueda con históricos reales.
          No se inventan procesos ni porcentajes en esta vista.
        </div>
      </div>
    </div>
  );
}