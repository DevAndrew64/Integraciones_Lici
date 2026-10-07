'use client';

import React from 'react';
import {
  SimulacionAvanzada, NAVY, BORDER,
  sCard, sCardHead,
  fmtCOP, fmtPct, FORMULA_LABELS_LARGO,
} from './types';

interface Props {
  sim: SimulacionAvanzada;
}

const TH: React.CSSProperties = {
  padding: '7px 10px',
  textAlign: 'left' as const,
  fontSize: 10,
  fontWeight: 700,
  color: '#64748b',
  letterSpacing: '.04em',
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

export function AnalisisPonderacionTable({ sim }: Props) {
  const { competidores, resultados, presupuestoOficial, metodoActivo } = sim;

  if (resultados.length === 0) {
    return (
      <div style={{
        background: 'white', border: BORDER, borderRadius: 10,
        marginBottom: 16, padding: '24px 20px',
        textAlign: 'center' as const, color: '#94a3b8', fontSize: 13,
      }}>
        No hay resultados de ponderación calculados para esta simulación.
      </div>
    );
  }

  const tieneCompetidores = competidores.length > 0;

  return (
    <div style={sCard}>
      <div style={sCardHead}>
        <div style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>Análisis de ponderación económica</div>
        {!tieneCompetidores && (
          <span style={{ fontSize: 10, color: '#d97706', background: '#fef3c7', padding: '2px 8px', borderRadius: 8, fontWeight: 600 }}>
            Sin competidores · referencia matemática
          </span>
        )}
      </div>

      {!tieneCompetidores && (
        <div style={{
          margin: '12px 20px 0',
          padding: '10px 14px',
          background: '#fffbeb',
          borderRadius: 7,
          fontSize: 11,
          color: '#92400e',
        }}>
          El cálculo detallado por competidor y método se habilitará en una fase posterior.
          Los resultados mostrados corresponden a la oferta óptima matemática según TRM.
        </div>
      )}

      <div style={{ overflowX: 'auto' as const, marginTop: 12 }}>
        {tieneCompetidores ? (
          <table style={{ width: '100%', borderCollapse: 'collapse' as const }}>
            <thead>
              <tr>
                <th style={TH}>Empresa</th>
                <th style={{ ...TH, textAlign: 'right' as const }}>Oferta %</th>
                <th style={{ ...TH, textAlign: 'right' as const }}>Valor estimado</th>
                <th style={TH}>Fuente</th>
                {resultados.map(r => (
                  <th key={r.id} style={{
                    ...TH,
                    textAlign: 'center' as const,
                    background: r.esMetodoActivo ? '#eff6ff' : '#f8fafc',
                    color: r.esMetodoActivo ? NAVY : '#64748b',
                    borderBottom: r.esMetodoActivo ? `2px solid ${NAVY}` : BORDER,
                  }}>
                    {r.esMetodoActivo && <span style={{ display: 'block', fontSize: 8, color: '#2563eb' }}>★ activo</span>}
                    {FORMULA_LABELS_LARGO[r.metodo] ?? r.metodo}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {competidores.map(c => {
                const valorEst = c.valorOferta ?? (presupuestoOficial * c.porcentajeOferta / 100);
                return (
                  <tr key={c.id}>
                    <td style={{ ...TD, fontWeight: 600, color: NAVY }}>{c.nombre ?? 'Sin nombre'}</td>
                    <td style={{ ...TD, textAlign: 'right' as const, fontFamily: 'monospace' }}>{fmtPct(c.porcentajeOferta)}</td>
                    <td style={{ ...TD, textAlign: 'right' as const, fontFamily: 'monospace', fontSize: 11 }}>{fmtCOP(valorEst)}</td>
                    <td style={{ ...TD, fontSize: 10, color: '#64748b' }}>{c.fuente}</td>
                    {resultados.map(r => (
                      <td key={r.id} style={{
                        ...TD, textAlign: 'center' as const,
                        background: r.esMetodoActivo ? '#f8fbff' : undefined,
                        fontSize: 11, color: '#94a3b8', fontStyle: 'italic' as const,
                      }}>
                        —
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' as const }}>
            <thead>
              <tr>
                <th style={TH}>Fórmula</th>
                <th style={{ ...TH, textAlign: 'right' as const }}>Oferta óptima %</th>
                <th style={{ ...TH, textAlign: 'right' as const }}>Valor óptimo COP</th>
                <th style={{ ...TH, textAlign: 'right' as const }}>Puntaje óptimo</th>
              </tr>
            </thead>
            <tbody>
              {resultados.map(r => (
                <tr key={r.id} style={{ background: r.esMetodoActivo ? '#f8fbff' : undefined }}>
                  <td style={{ ...TD, fontWeight: r.esMetodoActivo ? 700 : 400, color: r.esMetodoActivo ? NAVY : '#374151' }}>
                    {r.esMetodoActivo && <span style={{ marginRight: 6, fontSize: 11 }}>★</span>}
                    {FORMULA_LABELS_LARGO[r.metodo] ?? r.metodo}
                  </td>
                  <td style={{ ...TD, textAlign: 'right' as const, fontFamily: 'monospace', fontWeight: 700, color: r.esMetodoActivo ? NAVY : undefined }}>
                    {fmtPct(r.porcentajeOptimo)}
                  </td>
                  <td style={{ ...TD, textAlign: 'right' as const, fontFamily: 'monospace', fontSize: 11 }}>
                    {fmtCOP(r.valorOptimo)}
                  </td>
                  <td style={{ ...TD, textAlign: 'right' as const, fontWeight: r.esMetodoActivo ? 700 : 400 }}>
                    {r.puntajeOptimo.toFixed(2)} pts
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div style={{ padding: '8px 16px 12px', fontSize: 10, color: '#94a3b8', textAlign: 'right' as const }}>
        ★ = Método activo según TRM actual · {sim.trmCentavos} centavos
      </div>
    </div>
  );
}