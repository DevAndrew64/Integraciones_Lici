'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { SimulacionAvanzada, NAVY, estadoBadge } from './types';

interface Props {
  sim: SimulacionAvanzada;
  onArchivar: () => void;
  archivando: boolean;
}

export function SimulacionAvanzadaHeader({ sim, onArchivar, archivando }: Props) {
  const router = useRouter();
  const badge = estadoBadge(sim.estado);
  const archivada = sim.estado === 'archivada';

  return (
    <div style={{
      background: NAVY, color: 'white',
      padding: '16px 24px',
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      gap: 16, flexWrap: 'wrap' as const,
    }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#93c5fd', letterSpacing: '.08em', textTransform: 'uppercase' as const }}>
            Simulación económica avanzada
          </span>
          <span style={{
            background: badge.bg, color: badge.color,
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
          }}>
            {badge.label}
          </span>
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.2, marginBottom: 6 }}>
          {sim.nombre ?? `Simulación #${sim.id}`}
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' as const, fontSize: 12, color: '#bfdbfe' }}>
          {sim.razonSocial && <span>🏢 {sim.razonSocial}</span>}
          {sim.numeroProceso && <span>📋 {sim.numeroProceso}</span>}
          {sim.empresaGrupo && <span>🔗 {sim.empresaGrupo}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const }}>
        <button
          onClick={() => router.push('/')}
          style={{
            padding: '7px 14px', borderRadius: 7, border: '1px solid rgba(255,255,255,.3)',
            background: 'transparent', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          ← Módulo TRM
        </button>
        <button
          onClick={() => router.back()}
          style={{
            padding: '7px 14px', borderRadius: 7, border: '1px solid rgba(255,255,255,.3)',
            background: 'transparent', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          ← Volver
        </button>
        {!archivada && (
          <button
            onClick={onArchivar}
            disabled={archivando}
            style={{
              padding: '7px 14px', borderRadius: 7, border: 'none',
              background: archivando ? '#6b7280' : 'rgba(255,255,255,.15)',
              color: 'white', fontSize: 12, fontWeight: 600,
              cursor: archivando ? 'not-allowed' : 'pointer',
            }}
          >
            {archivando ? 'Archivando…' : 'Archivar'}
          </button>
        )}
      </div>
    </div>
  );
}