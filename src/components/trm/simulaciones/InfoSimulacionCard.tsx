'use client';

import React from 'react';
import {
  SimulacionAvanzada, NAVY, BORDER,
  sCard, sCardHead, sCardBody,
  fmtCOP, fmtPts, estadoBadge, FORMULA_LABELS,
} from './types';

interface Props {
  sim: SimulacionAvanzada;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, paddingBottom: 8, borderBottom: '1px solid #f8fafc' }}>
      <div style={{ minWidth: 160, fontSize: 11, color: '#94a3b8', fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase' as const, paddingTop: 1 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: '#0f172a', flex: 1 }}>
        {value ?? <span style={{ color: '#cbd5e1' }}>No informado</span>}
      </div>
    </div>
  );
}

export function InfoSimulacionCard({ sim }: Props) {
  const badge = estadoBadge(sim.estado);
  const labelMetodo = FORMULA_LABELS[sim.metodoActivo] ?? sim.metodoActivo;
  const creadoPorNombre = sim.creadoPor?.usuario ?? (sim.creadoPorId ? `ID #${sim.creadoPorId}` : null);
  const fechaCreacion = new Date(sim.createdAt).toLocaleDateString('es-CO', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div style={sCard}>
      <div style={sCardHead}>
        <div style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>Información de la simulación</div>
      </div>
      <div style={{ ...sCardBody, display: 'flex', gap: 24, flexWrap: 'wrap' as const }}>
        <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
          <InfoRow label="Nombre" value={sim.nombre} />
          <InfoRow label="Fecha de creación" value={fechaCreacion} />
          <InfoRow label="Creado por" value={creadoPorNombre} />
          <InfoRow label="Razón social" value={sim.razonSocial} />
          <InfoRow label="Empresa grupo" value={sim.empresaGrupo} />
          <InfoRow label="N.° de proceso" value={sim.numeroProceso} />
          <InfoRow label="Estado" value={
            <span style={{ background: badge.bg, color: badge.color, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20 }}>
              {badge.label}
            </span>
          } />
          {sim.notas && <InfoRow label="Notas" value={sim.notas} />}
        </div>
        <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
          <InfoRow label="Presupuesto oficial" value={<strong>{fmtCOP(sim.presupuestoOficial)}</strong>} />
          <InfoRow label="Puntaje máximo" value={fmtPts(sim.puntajeMaximo)} />
          <InfoRow label="TRM usada" value={`$${sim.trmValor.toFixed(4)} COP/USD`} />
          <InfoRow label="Fecha TRM" value={sim.trmFecha} />
          <InfoRow label="Fuente TRM" value={
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
              background: sim.trmFuente === 'cache' ? '#eff6ff' : '#f0fdf4',
              color: sim.trmFuente === 'cache' ? '#1d4ed8' : '#166534',
            }}>
              {sim.trmFuente}
            </span>
          } />
          <InfoRow label="Centavos TRM" value={`${sim.trmCentavos} ctvs`} />
          <InfoRow label="Método activo" value={
            <span style={{ background: NAVY, color: 'white', fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 20 }}>
              ★ {labelMetodo}
            </span>
          } />
          {sim.miOfertaPorcentaje != null && (
            <InfoRow label="Mi oferta" value={
              <>
                <strong>{sim.miOfertaPorcentaje.toFixed(2)}%</strong>
                {sim.miOfertaValor != null && <span style={{ color: '#64748b', marginLeft: 8, fontSize: 12 }}>{fmtCOP(sim.miOfertaValor)}</span>}
              </>
            } />
          )}
        </div>
      </div>
    </div>
  );
}