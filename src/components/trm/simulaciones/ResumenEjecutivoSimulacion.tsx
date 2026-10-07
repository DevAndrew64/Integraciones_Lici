'use client';

import React from 'react';
import {
  SimulacionAvanzada, FORMULA_LABELS, NAVY,
  fmtCOP, fmtPct, fmtPts,
} from './types';

interface Props {
  sim: SimulacionAvanzada;
}

function KpiCard({
  label, value, sub, highlight,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div style={{
      background: 'white',
      border: highlight ? `2px solid ${NAVY}` : '1px solid #e2e8f0',
      borderRadius: 10,
      padding: '14px 16px',
      boxShadow: '0 1px 4px rgba(13,45,94,.06)',
      flex: '1 1 0',
      minWidth: 0,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '.07em',
        textTransform: 'uppercase' as const,
        color: highlight ? NAVY : '#64748b',
        marginBottom: 6,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 15, fontWeight: 800, color: highlight ? NAVY : '#0f172a',
        lineHeight: 1.2, wordBreak: 'break-word' as const,
      }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4, lineHeight: 1.4 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

export function ResumenEjecutivoSimulacion({ sim }: Props) {
  const resultadoActivo =
    sim.resultados.find(r => r.esMetodoActivo) ?? sim.resultados[0] ?? null;
  const label = FORMULA_LABELS[sim.metodoActivo] ?? sim.metodoActivo;

  return (
    <div style={{ marginBottom: 16 }}>
      {/* ── Banda oferta óptima ─────────────────────────── */}
      {resultadoActivo && (
        <div style={{
          background: NAVY,
          borderRadius: 10,
          padding: '18px 22px',
          marginBottom: 10,
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap' as const,
          gap: 24,
          boxShadow: '0 2px 8px rgba(13,45,94,.18)',
        }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' as const, color: '#93c5fd', marginBottom: 4 }}>
              Oferta óptima · TRM actual · ★ {label}
            </div>
            <div style={{ fontSize: 34, fontWeight: 900, color: 'white', lineHeight: 1 }}>
              {fmtPct(resultadoActivo.porcentajeOptimo)}
            </div>
            <div style={{ fontSize: 14, color: '#93c5fd', marginTop: 5 }}>
              {fmtCOP(resultadoActivo.valorOptimo)}
            </div>
          </div>

          <div style={{ width: 1, height: 50, background: 'rgba(255,255,255,.15)', flexShrink: 0 }} />

          <div>
            <div style={{ fontSize: 10, color: '#bfdbfe', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '.06em' }}>Puntaje óptimo</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'white' }}>{fmtPts(resultadoActivo.puntajeOptimo)}</div>
          </div>

          {resultadoActivo.miOfertaPorcentaje != null && (
            <>
              <div style={{ width: 1, height: 50, background: 'rgba(255,255,255,.15)', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 10, color: '#bfdbfe', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '.06em' }}>Mi oferta actual</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'white' }}>{fmtPct(resultadoActivo.miOfertaPorcentaje)}</div>
                {resultadoActivo.diferenciaPuntos != null && (
                  <div style={{
                    marginTop: 4, fontSize: 11, fontWeight: 700,
                    color: resultadoActivo.diferenciaPuntos >= 0 ? '#86efac' : '#fca5a5',
                  }}>
                    {resultadoActivo.diferenciaPuntos >= 0 ? '+' : ''}{fmtPts(resultadoActivo.diferenciaPuntos)} vs mi oferta
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── KPI chips ───────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' as const }}>
        <KpiCard
          label="Presupuesto oficial"
          value={fmtCOP(sim.presupuestoOficial)}
        />
        <KpiCard
          label="TRM usada"
          value={`$${sim.trmValor.toFixed(2)}`}
          sub={`${sim.trmCentavos} centavos · ${sim.trmFecha}`}
        />
        <KpiCard
          label="Puntaje máximo"
          value={fmtPts(sim.puntajeMaximo)}
        />
        <KpiCard
          label="Competidores"
          value={sim.competidores.length === 0 ? '—' : String(sim.competidores.length)}
          sub={sim.competidores.length === 0 ? 'Sin competidores' : 'registrados'}
        />
        {sim.miOfertaPorcentaje != null && (
          <KpiCard
            label="Mi oferta"
            value={fmtPct(sim.miOfertaPorcentaje)}
            sub={sim.miOfertaValor != null ? fmtCOP(sim.miOfertaValor) : undefined}
          />
        )}
      </div>
    </div>
  );
}