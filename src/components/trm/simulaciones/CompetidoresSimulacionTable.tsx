'use client';

import React from 'react';
import {
  SimulacionAvanzada, NAVY, BORDER,
  sCard, sCardHead, sCardBody,
  fmtCOP, fmtPct,
} from './types';
import { BadgeFuenteDato } from './BadgeFuenteDato';

interface Props {
  sim: SimulacionAvanzada;
}

const TH: React.CSSProperties = {
  padding: '7px 10px',
  textAlign: 'left' as const,
  fontSize: 10,
  fontWeight: 700,
  color: '#64748b',
  letterSpacing: '.05em',
  textTransform: 'uppercase' as const,
  borderBottom: BORDER,
  background: '#f8fafc',
  whiteSpace: 'nowrap' as const,
};

const TD: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: 12,
  borderBottom: '1px solid #f8fafc',
  color: '#374151',
};

export function CompetidoresSimulacionTable({ sim }: Props) {
  const { competidores, presupuestoOficial } = sim;

  return (
    <div style={sCard}>
      <div style={sCardHead}>
        <div style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>
          Competidores registrados
          {competidores.length > 0 && (
            <span style={{
              marginLeft: 8, background: '#eff6ff', color: '#2563eb',
              fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 20,
            }}>
              {competidores.length}
            </span>
          )}
        </div>
      </div>

      {competidores.length === 0 ? (
        <div style={{ ...sCardBody, textAlign: 'center' as const, padding: '28px 20px' }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>⚠️</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
            Sin competidores registrados
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', maxWidth: 420, margin: '0 auto' }}>
            Esta simulación no tiene competidores registrados. El resultado puede servir como referencia matemática,
            pero no como análisis competitivo completo.
          </div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' as const }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' as const }}>
            <thead>
              <tr>
                <th style={TH}>Empresa</th>
                <th style={{ ...TH, textAlign: 'right' as const }}>Oferta %</th>
                <th style={{ ...TH, textAlign: 'right' as const }}>Valor estimado</th>
                <th style={TH}>Fuente</th>
                <th style={{ ...TH, textAlign: 'right' as const }}>Probabilidad</th>
                <th style={TH}>Observaciones</th>
              </tr>
            </thead>
            <tbody>
              {competidores.map(c => {
                const valorEst = c.valorOferta ?? (presupuestoOficial * c.porcentajeOferta / 100);
                return (
                  <tr key={c.id}>
                    <td style={{ ...TD, fontWeight: 600, color: NAVY }}>
                      {c.nombre ?? <span style={{ color: '#94a3b8' }}>Sin nombre</span>}
                    </td>
                    <td style={{ ...TD, textAlign: 'right' as const, fontFamily: 'monospace', fontWeight: 700 }}>
                      {fmtPct(c.porcentajeOferta)}
                    </td>
                    <td style={{ ...TD, textAlign: 'right' as const, fontFamily: 'monospace', fontSize: 11 }}>
                      {fmtCOP(valorEst)}
                    </td>
                    <td style={TD}>
                      <BadgeFuenteDato fuente={c.fuente} />
                    </td>
                    <td style={{ ...TD, textAlign: 'right' as const }}>
                      {c.probabilidadParticipacion != null
                        ? <span style={{ fontWeight: 700, color: '#0d2d5e' }}>{(c.probabilidadParticipacion * 100).toFixed(0)}%</span>
                        : <span style={{ color: '#94a3b8', fontSize: 11 }}>No estimada</span>
                      }
                    </td>
                    <td style={{ ...TD, fontSize: 11, color: '#64748b', maxWidth: 200, overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const }}>
                      {c.observaciones ?? <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}