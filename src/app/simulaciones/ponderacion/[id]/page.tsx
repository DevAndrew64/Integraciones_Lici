'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { SimulacionAvanzada, NAVY } from '@/components/trm/simulaciones/types';
import { SimulacionAvanzadaHeader } from '@/components/trm/simulaciones/SimulacionAvanzadaHeader';
import { ResumenEjecutivoSimulacion } from '@/components/trm/simulaciones/ResumenEjecutivoSimulacion';
import { InfoSimulacionCard } from '@/components/trm/simulaciones/InfoSimulacionCard';
import { CompetidoresSimulacionTable } from '@/components/trm/simulaciones/CompetidoresSimulacionTable';
import { AnalisisPonderacionTable } from '@/components/trm/simulaciones/AnalisisPonderacionTable';
import { NuestraOfertaOptima } from '@/components/trm/simulaciones/NuestraOfertaOptima';
import { ProcesosSimilaresPanel } from '@/components/trm/simulaciones/ProcesosSimilaresPanel';
import { AlertasSimulacionPanel } from '@/components/trm/simulaciones/AlertasSimulacionPanel';
import { AccionesSimulacion } from '@/components/trm/simulaciones/AccionesSimulacion';

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '.1em',
      textTransform: 'uppercase' as const,
      color: '#94a3b8',
      marginBottom: 10,
      marginTop: 28,
      paddingBottom: 6,
      borderBottom: '1px solid #e8edf3',
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <span style={{ display: 'inline-block', width: 3, height: 12, background: NAVY, borderRadius: 2 }} />
      {children}
    </div>
  );
}

export default function SimulacionAvanzadaPage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;

  const [sim, setSim] = useState<SimulacionAvanzada | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [archivando, setArchivando] = useState(false);
  const [archivoMsg, setArchivoMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    fetch(`/api/simulaciones/ponderacion/${id}`)
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.error ?? `Error ${r.status}`);
        }
        return r.json() as Promise<{ ok: boolean; simulacion: SimulacionAvanzada }>;
      })
      .then(data => {
        setSim(data.simulacion);
        setLoading(false);
      })
      .catch(e => {
        setError(e.message);
        setLoading(false);
      });
  }, [id]);

  async function handleArchivar() {
    if (!sim) return;
    if (!confirm('¿Archivar esta simulación? No podrá editarse después.')) return;
    setArchivando(true);
    try {
      const r = await fetch(`/api/simulaciones/ponderacion/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: 'archivada' }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error ?? `Error ${r.status}`);
      }
      const body = await r.json();
      const nuevoEstado = body?.simulacion?.estado ?? body?.estado ?? 'archivada';
      setSim(prev => prev ? { ...prev, estado: nuevoEstado } : prev);
      setArchivoMsg('Simulación archivada correctamente.');
      setTimeout(() => setArchivoMsg(null), 4000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error al archivar';
      alert(msg);
    } finally {
      setArchivando(false);
    }
  }

  const pagePad: React.CSSProperties = {
    minHeight: '100vh',
    background: '#f1f5f9',
    fontFamily: 'Inter, system-ui, sans-serif',
  };

  const contentWrap: React.CSSProperties = {
    maxWidth: 1080,
    margin: '0 auto',
    padding: '28px 24px 56px',
  };

  if (loading) {
    return (
      <div style={{ ...pagePad, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center' as const, color: '#64748b' }}>
          <div style={{ fontSize: 36, marginBottom: 14 }}>⏳</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Cargando simulación…</div>
        </div>
      </div>
    );
  }

  if (error || !sim) {
    return (
      <div style={{ ...pagePad, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center' as const, color: '#64748b', maxWidth: 420 }}>
          <div style={{ fontSize: 40, marginBottom: 14 }}>⚠️</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#374151', marginBottom: 8 }}>
            No se pudo cargar la simulación
          </div>
          <div style={{ fontSize: 13, marginBottom: 24, color: '#94a3b8' }}>
            {error ?? 'Simulación no encontrada o sin acceso.'}
          </div>
          <button
            onClick={() => router.push('/')}
            style={{
              padding: '9px 20px', borderRadius: 8, background: NAVY, color: 'white',
              border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            ← Volver al inicio
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={pagePad}>
      <SimulacionAvanzadaHeader sim={sim} onArchivar={handleArchivar} archivando={archivando} />

      {archivoMsg && (
        <div style={{
          background: '#f0fdf4', borderBottom: '1px solid #bbf7d0',
          padding: '10px 24px', fontSize: 12, color: '#14532d', fontWeight: 600,
        }}>
          ✓ {archivoMsg}
        </div>
      )}

      <div style={contentWrap}>

        {/* ── Resumen ejecutivo ─────────────────────────── */}
        <SectionLabel>Resumen ejecutivo</SectionLabel>
        <ResumenEjecutivoSimulacion sim={sim} />

        {/* ── Datos de la simulación ────────────────────── */}
        <SectionLabel>Datos de la simulación</SectionLabel>
        <InfoSimulacionCard sim={sim} />

        {/* ── Análisis de competencia ───────────────────── */}
        <SectionLabel>Análisis de competencia</SectionLabel>
        <CompetidoresSimulacionTable sim={sim} />
        <AnalisisPonderacionTable sim={sim} />

        {/* ── Oferta óptima ────────────────────────────── */}
        <SectionLabel>Nuestra oferta óptima</SectionLabel>
        <NuestraOfertaOptima sim={sim} />

        {/* ── Contexto ─────────────────────────────────── */}
        <SectionLabel>Contexto y alertas</SectionLabel>
        <ProcesosSimilaresPanel />
        <AlertasSimulacionPanel sim={sim} />

        {/* ── Acciones ─────────────────────────────────── */}
        <SectionLabel>Acciones</SectionLabel>
        <AccionesSimulacion
          simId={sim.id}
          estado={sim.estado}
          onArchivar={handleArchivar}
          onVolver={() => router.push('/')}
        />

      </div>
    </div>
  );
}