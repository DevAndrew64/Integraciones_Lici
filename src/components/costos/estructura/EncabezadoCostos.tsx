'use client';
import React from 'react';

const F = 'var(--font)';

interface Props {
  cargo: string;
  grandTotal: number;
  notaIA: string;
  esComplejo: boolean;
}

export function EncabezadoCostos({}: Props) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 12, flexWrap: 'wrap' as const }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const }}>
          <h2 style={{ margin: 0, fontSize: 16, color: '#0f172a', fontWeight: 700, fontFamily: F }}>Estructura de costos</h2>
        </div>
      </div>
    </div>
  );
}