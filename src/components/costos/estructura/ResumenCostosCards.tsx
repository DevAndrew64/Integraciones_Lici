'use client';
import React from 'react';

const F = 'var(--font)';
const NAVY = '#0d2d5e';
const cop = (v: number) =>
  v.toLocaleString('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 });

interface Props {
  dev: number;
  totalAportes: number;
  totalPrest: number;
  eppMesPorTrab: number;
  examMesPorTrab: number;
  costoUno: number;
  n: number;
  costoMO: number;
}

export function ResumenCostosCards({ dev, totalAportes, totalPrest, eppMesPorTrab, examMesPorTrab, costoUno, n, costoMO }: Props) {
  const cards: { label: string; value: number; sub: string; big?: boolean }[] = [
    { label: 'Devengado',    value: dev,            sub: 'Salario + aux. + recargos' },
    { label: 'Aportes soc.', value: totalAportes,   sub: 'Salud · Pensión · ARL · Parafiscales' },
    { label: 'Prestaciones', value: totalPrest,     sub: 'Ces. · Prima · Vac. · Dotación' },
    { label: 'EPP / trab.',  value: eppMesPorTrab,  sub: 'Dotación + EPP mensualizado' },
    { label: 'Exámenes',     value: examMesPorTrab, sub: 'Mensualizados por trabajador' },
    { label: 'Total / trab.', value: costoUno,      sub: 'MO por trabajador (sin EPP ni exám.)', big: true },
  ];

  return (
    <div style={{ marginBottom: 14, fontFamily: F }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' as const, letterSpacing: '.08em', marginBottom: 8 }}>
        Resumen de costos — por trabajador / mes
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(128px, 1fr))', gap: 8 }}>
        {cards.map(({ label, value, sub, big }) => (
          <div key={label} style={{ background: big ? '#f8fafc' : 'white', border: big ? '1px solid #c7d2e0' : '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 9, color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '.07em', marginBottom: 3 }}>{label}</div>
            <div style={{ fontSize: big ? 15 : 13, fontWeight: big ? 800 : 700, color: big ? NAVY : '#374151', fontFamily: 'monospace' }}>{cop(value)}</div>
            <div style={{ fontSize: 9, color: '#b3bac6', marginTop: 2, lineHeight: 1.3 }}>{sub}</div>
          </div>
        ))}
      </div>
      {n > 1 && (
        <div style={{ marginTop: 8, padding: '9px 14px', background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#6b7280', fontFamily: F }}>× {n} trabajadores = Total mano de obra</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: NAVY, fontFamily: 'monospace' }}>{cop(costoMO)}</span>
        </div>
      )}
    </div>
  );
}