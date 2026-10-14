'use client';

import React, { useState } from 'react';
import { nitVerificado, validarNitConDv } from '@/lib/solicitudes/nit-entidad';

/**
 * Fila «NIT» de la tarjeta «Entidad contratante». El NIT se registra al marcar el proceso como Adjudicado, con su dígito de
 * verificación; aquí solo se muestra. Un proceso ya adjudicado sin NIT verificado (de antes) puede registrarlo con
 * «Registrar NIT» (`POST /api/solicitudes/{id}/nit-entidad`). Ya no se busca en ninguna fuente externa.
 */
export default function NitEntidad({ solicitudId, nit: nitInicial, adjudicado = false, fontFamily, puedeDigitar = true, onNit }: {
  solicitudId: number | null | undefined;
  nit: string | null | undefined;
  adjudicado?: boolean;
  fontFamily?: string;
  puedeDigitar?: boolean;
  onNit?: (nit: string) => void;
}) {
  // Lo guardado aquí manda sobre la prop hasta que el padre la actualice con `onNit`.
  const [guardado, setNit] = useState<string | null>(null);
  const nit = guardado ?? (nitInicial?.trim() || null);
  const [estado, setEstado] = useState<'listo' | 'editando' | 'guardando'>('listo');
  const [texto, setTexto] = useState('');
  const [error, setError] = useState('');

  const verificado = nitVerificado(nit);
  const puedeRegistrar = adjudicado && puedeDigitar && !!solicitudId && !verificado;

  async function guardar() {
    if (!solicitudId) return;
    const v = validarNitConDv(texto);
    if (!v.ok) { setError(v.error); return; }
    setEstado('guardando'); setError('');
    try {
      const res = await fetch(`/api/solicitudes/${solicitudId}/nit-entidad`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nit: v.nit }) });
      const d = await res.json();
      if (d?.ok && d.nit) { setNit(d.nit); setEstado('listo'); onNit?.(d.nit); return; }
      if (res.status === 409 && d?.nit) { setNit(d.nit); setEstado('listo'); onNit?.(d.nit); return; }
      setError(d?.error || 'No se pudo guardar el NIT.'); setEstado('editando');
    } catch {
      setError('Error de conexión.'); setEstado('editando');
    }
  }

  const etiqueta = { fontSize: 10, fontWeight: 700, color: '#374151', fontFamily, marginBottom: 2 } as const;
  const boton = { fontSize: 11, fontWeight: 600, color: '#1e5799', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily } as const;
  const nota = { fontSize: 11, color: '#b45309', fontFamily } as const;

  return (
    <div>
      <div style={etiqueta}>NIT</div>
      {estado === 'listo' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
          {nit
            ? <span style={{ fontSize: 12.5, color: '#0f172a', fontFamily: 'monospace' }}>{nit}</span>
            : <span style={{ fontSize: 12, color: '#64748b', fontFamily }}>{adjudicado ? 'Sin NIT registrado' : 'Se registra al adjudicar'}</span>}
          {nit && !verificado && <span style={nota}>sin verificar</span>}
          {puedeRegistrar && <button type="button" style={boton} onClick={() => { setTexto(''); setError(''); setEstado('editando'); }}>Registrar NIT</button>}
        </div>
      )}
      {(estado === 'editando' || estado === 'guardando') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ej. 900123456-8" maxLength={22} autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter' && texto.trim()) void guardar(); }}
              style={{ fontSize: 12.5, fontFamily: 'monospace', padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, width: 150 }} />
            <button type="button" style={boton} disabled={estado === 'guardando' || !texto.trim()} onClick={() => void guardar()}>{estado === 'guardando' ? 'Guardando…' : 'Guardar'}</button>
            <button type="button" style={{ ...boton, color: '#64748b' }} disabled={estado === 'guardando'} onClick={() => setEstado('listo')}>Cancelar</button>
          </div>
          <div style={{ fontSize: 10.5, color: error ? '#dc2626' : '#64748b', fontFamily }}>{error || 'Con dígito de verificación, tomado del RUT o del pliego de la entidad.'}</div>
        </div>
      )}
    </div>
  );
}
