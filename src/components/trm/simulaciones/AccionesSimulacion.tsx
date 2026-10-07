'use client';

import React, { useState } from 'react';
import { NAVY } from './types';

interface Props {
  simId: number;
  estado: string;
  onArchivar?: () => Promise<void>;
  onVolver?: () => void;
}

export function AccionesSimulacion({ simId, estado, onArchivar, onVolver }: Props) {
  const [archivando, setArchivando] = useState(false);

  const isArchivado = estado === 'archivado';

  async function handleArchivar() {
    if (!onArchivar) return;
    if (!confirm('¿Archivar esta simulación? No podrá editarse después.')) return;
    setArchivando(true);
    try {
      await onArchivar();
    } finally {
      setArchivando(false);
    }
  }

  return (
    <div style={{
      display: 'flex', gap: 10, flexWrap: 'wrap' as const,
      padding: '16px 20px',
      background: 'white',
      border: '1px solid #e2e8f0',
      borderRadius: 10,
      alignItems: 'center',
    }}>
      <div style={{ flex: 1, fontSize: 12, color: '#64748b' }}>
        Acciones disponibles para esta simulación
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
        <button
          onClick={onVolver}
          style={{
            padding: '8px 16px', borderRadius: 7,
            border: '1.5px solid #e2e8f0', background: 'white',
            color: '#374151', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          ← Volver al módulo TRM
        </button>

        {!isArchivado && (
          <button
            onClick={handleArchivar}
            disabled={archivando}
            style={{
              padding: '8px 16px', borderRadius: 7,
              border: '1.5px solid #fca5a5', background: archivando ? '#f8fafc' : '#fff5f5',
              color: '#991b1b', fontSize: 12, fontWeight: 600,
              cursor: archivando ? 'not-allowed' : 'pointer',
              opacity: archivando ? 0.7 : 1,
            }}
          >
            {archivando ? 'Archivando…' : 'Archivar simulación'}
          </button>
        )}

        <button
          disabled
          title="Próxima fase"
          style={{
            padding: '8px 16px', borderRadius: 7,
            border: '1px solid #e2e8f0', background: '#f8fafc',
            color: '#94a3b8', fontSize: 12, fontWeight: 600, cursor: 'not-allowed',
          }}
        >
          Exportar · próxima fase
        </button>
      </div>
    </div>
  );
}