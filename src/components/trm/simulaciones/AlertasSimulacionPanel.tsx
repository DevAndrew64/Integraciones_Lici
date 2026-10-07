'use client';

import React from 'react';
import { SimulacionAvanzada, NAVY, sCard, sCardHead, sCardBody } from './types';

interface Props {
  sim: SimulacionAvanzada;
}

interface Alerta {
  nivel: 'info' | 'warn' | 'ok';
  texto: string;
}

function buildAlertas(sim: SimulacionAvanzada): Alerta[] {
  const alertas: Alerta[] = [];

  if (sim.competidores.length === 0) {
    alertas.push({
      nivel: 'warn',
      texto: 'Sin competidores registrados. El resultado es una referencia matemática, no un análisis competitivo completo.',
    });
  }

  const sinProbabilidad = sim.competidores.filter(c => c.probabilidadParticipacion === null);
  if (sinProbabilidad.length > 0 && sim.competidores.length > 0) {
    alertas.push({
      nivel: 'info',
      texto: `${sinProbabilidad.length} competidor(es) sin probabilidad de participación estimada.`,
    });
  }

  const manuales = sim.competidores.filter(c => c.fuente === 'manual');
  if (manuales.length > 0) {
    alertas.push({
      nivel: 'info',
      texto: `${manuales.length} competidor(es) ingresados manualmente. Verifique que los datos reflejen información real.`,
    });
  }

  if (sim.miOfertaPorcentaje === null) {
    alertas.push({
      nivel: 'info',
      texto: 'No se registró una oferta propia en esta simulación. El análisis comparativo no está disponible.',
    });
  }

  const trmOld = new Date(sim.trmFecha);
  const diffDias = Math.floor((Date.now() - trmOld.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDias > 7) {
    alertas.push({
      nivel: 'warn',
      texto: `La TRM usada (${sim.trmFecha}) tiene ${diffDias} días de antigüedad. Considere recalcular con TRM vigente.`,
    });
  }

  if (sim.estado === 'archivado') {
    alertas.push({
      nivel: 'info',
      texto: 'Esta simulación está archivada y es de solo lectura.',
    });
  }

  if (alertas.length === 0) {
    alertas.push({
      nivel: 'ok',
      texto: 'Simulación completa con competidores, oferta propia y TRM reciente. Lista para revisión comercial.',
    });
  }

  return alertas;
}

const COLORES = {
  info:  { bg: '#eff6ff', border: '#bfdbfe', color: '#1e3a8a', icon: 'ℹ' },
  warn:  { bg: '#fffbeb', border: '#fde68a', color: '#92400e', icon: '⚠' },
  ok:    { bg: '#f0fdf4', border: '#bbf7d0', color: '#14532d', icon: '✓' },
};

export function AlertasSimulacionPanel({ sim }: Props) {
  const alertas = buildAlertas(sim);

  return (
    <div style={sCard}>
      <div style={sCardHead}>
        <div style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>Alertas y supuestos</div>
      </div>
      <div style={{ ...sCardBody, display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
        {alertas.map((a, i) => {
          const c = COLORES[a.nivel];
          return (
            <div key={i} style={{
              background: c.bg,
              border: `1px solid ${c.border}`,
              borderRadius: 8,
              padding: '10px 14px',
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
            }}>
              <span style={{ fontSize: 14, color: c.color, flexShrink: 0, marginTop: 1 }}>{c.icon}</span>
              <span style={{ fontSize: 12, color: c.color, lineHeight: 1.5 }}>{a.texto}</span>
            </div>
          );
        })}
        <div style={{
          marginTop: 4, padding: '10px 14px',
          background: '#f8fafc', borderRadius: 8, fontSize: 11, color: '#64748b', lineHeight: 1.6,
        }}>
          <strong>Supuesto importante:</strong> Esta simulación tiene carácter matemático y estadístico.
          No garantiza resultados en el proceso licitatorio. Los competidores registrados son estimaciones
          basadas en información disponible al momento de creación de la simulación.
        </div>
      </div>
    </div>
  );
}