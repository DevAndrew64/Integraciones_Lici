'use client';

import React from 'react';
import {
  SimulacionAvanzada, NAVY, BORDER,
  sCard, sCardHead, sCardBody,
  fmtCOP, fmtPct, fmtPts, FORMULA_LABELS_LARGO,
} from './types';
import { BadgeMetodoActivo } from './BadgeMetodoActivo';

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
  padding: '9px 10px',
  fontSize: 12,
  borderBottom: '1px solid #f8fafc',
  color: '#374151',
};

function DiferenciaBadge({ diff }: { diff: number | null }) {
  if (diff === null) return <span style={{ color: '#cbd5e1', fontSize: 11 }}>—</span>;
  const pos = diff >= 0;
  return (
    <span style={{
      fontWeight: 700, fontSize: 11,
      color: pos ? '#166534' : '#991b1b',
      background: pos ? '#f0fdf4' : '#fef2f2',
      padding: '2px 7px', borderRadius: 8,
    }}>
      {pos ? '+' : ''}{diff.toFixed(2)} pts
    </span>
  );
}

function EstadoFila({ r }: { r: SimulacionAvanzada['resultados'][number] }) {
  if (r.esMetodoActivo) {
    return (
      <span style={{ background: NAVY, color: 'white', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 8 }}>
        ★ Método TRM actual
      </span>
    );
  }
  return <span style={{ color: '#94a3b8', fontSize: 11 }}>—</span>;
}

export function NuestraOfertaOptima({ sim }: Props) {
  const { resultados, metodoActivo } = sim;

  if (resultados.length === 0) {
    return (
      <div style={{ ...sCard, marginBottom: 16 }}>
        <div style={sCardHead}>
          <div style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>Nuestra oferta óptima</div>
        </div>
        <div style={{ ...sCardBody, textAlign: 'center' as const, padding: '28px 20px', color: '#94a3b8', fontSize: 13 }}>
          No hay resultados de simulación calculados.
        </div>
      </div>
    );
  }

  const activo = resultados.find(r => r.esMetodoActivo) ?? null;

  return (
    <div style={sCard}>
      <div style={sCardHead}>
        <div style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>Nuestra oferta óptima</div>
        {activo && <BadgeMetodoActivo metodo={metodoActivo} size="sm" />}
      </div>

      {activo && (
        <div style={{
          margin: '12px 16px 0',
          padding: '14px 18px',
          background: '#f8fbff',
          border: `1.5px solid ${NAVY}`,
          borderRadius: 9,
          display: 'flex', flexWrap: 'wrap' as const, gap: 20, alignItems: 'center',
        }}>
          <div>
            <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' as const }}>
              Oferta óptima · {FORMULA_LABELS_LARGO[metodoActivo] ?? metodoActivo}
            </div>
            <div style={{ fontSize: 28, fontWeight: 900, color: NAVY, lineHeight: 1.1, marginTop: 4 }}>
              {fmtPct(activo.porcentajeOptimo)}
            </div>
            <div style={{ fontSize: 13, color: '#475569', marginTop: 2 }}>
              {fmtCOP(activo.valorOptimo)}
            </div>
          </div>
          <div style={{ borderLeft: BORDER, paddingLeft: 20 }}>
            <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' as const }}>
              Puntaje óptimo
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: NAVY, marginTop: 4 }}>
              {activo.puntajeOptimo.toFixed(2)} pts
            </div>
            {activo.miOfertaPuntaje != null && (
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                Mi puntaje: {activo.miOfertaPuntaje.toFixed(2)} pts
              </div>
            )}
          </div>
          {activo.miOfertaPorcentaje != null && (
            <div style={{ borderLeft: BORDER, paddingLeft: 20 }}>
              <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' as const }}>
                Mi oferta actual
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#374151', marginTop: 4 }}>
                {fmtPct(activo.miOfertaPorcentaje)}
              </div>
              {activo.diferenciaPuntos != null && (
                <div style={{ marginTop: 4 }}>
                  <DiferenciaBadge diff={activo.diferenciaPuntos} />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div style={{ overflowX: 'auto' as const, marginTop: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' as const }}>
          <thead>
            <tr>
              <th style={TH}>Método</th>
              <th style={{ ...TH, textAlign: 'right' as const }}>Oferta óptima %</th>
              <th style={{ ...TH, textAlign: 'right' as const }}>Valor óptimo COP</th>
              <th style={{ ...TH, textAlign: 'right' as const }}>Puntaje óptimo</th>
              <th style={{ ...TH, textAlign: 'right' as const }}>Mi oferta %</th>
              <th style={{ ...TH, textAlign: 'right' as const }}>Mi puntaje</th>
              <th style={{ ...TH, textAlign: 'center' as const }}>Diferencia</th>
              <th style={{ ...TH, textAlign: 'center' as const }}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {resultados.map(r => (
              <tr key={r.id} style={{
                background: r.esMetodoActivo ? '#f8fbff' : undefined,
                borderLeft: r.esMetodoActivo ? `3px solid ${NAVY}` : undefined,
              }}>
                <td style={{ ...TD, fontWeight: r.esMetodoActivo ? 700 : 400, color: r.esMetodoActivo ? NAVY : '#374151' }}>
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
                <td style={{ ...TD, textAlign: 'right' as const }}>
                  {r.miOfertaPorcentaje != null
                    ? <span style={{ fontFamily: 'monospace' }}>{fmtPct(r.miOfertaPorcentaje)}</span>
                    : <span style={{ color: '#94a3b8', fontSize: 11 }}>—</span>}
                </td>
                <td style={{ ...TD, textAlign: 'right' as const }}>
                  {r.miOfertaPuntaje != null
                    ? <span style={{ fontFamily: 'monospace' }}>{r.miOfertaPuntaje.toFixed(2)} pts</span>
                    : <span style={{ color: '#94a3b8', fontSize: 11 }}>—</span>}
                </td>
                <td style={{ ...TD, textAlign: 'center' as const }}>
                  <DiferenciaBadge diff={r.diferenciaPuntos} />
                </td>
                <td style={{ ...TD, textAlign: 'center' as const }}>
                  <EstadoFila r={r} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ padding: '8px 16px 12px', fontSize: 10, color: '#94a3b8' }}>
        Diferencia de puntos = Puntaje óptimo − Mi puntaje. Positivo indica que la oferta óptima supera a mi oferta actual.
      </div>
    </div>
  );
}