'use client';

import React, { useEffect, useState } from 'react';

/** Solicitudes cuyo NIT ya se buscó en esta sesión del navegador: la búsqueda en SECOP se hace una sola vez por ficha. */
const yaBuscadas = new Set<number>();

/**
 * Fila «NIT» de la tarjeta «Entidad contratante». Si la solicitud no tiene NIT, lo busca en los datos abiertos de SECOP
 * (`POST /api/solicitudes/{id}/nit-entidad`, que lo guarda); si la fuente no lo trae, muestra «NIT no disponible» y permite
 * digitarlo. Nunca inventa un NIT.
 */
export default function NitEntidad({ solicitudId, nit: nitInicial, fontFamily, puedeDigitar = true, onNit }: {
  solicitudId: number | null | undefined;
  nit: string | null | undefined;
  fontFamily?: string;
  puedeDigitar?: boolean;
  onNit?: (nit: string) => void;
}) {
  const [nit, setNit] = useState<string | null>(nitInicial?.trim() || null);
  const [estado, setEstado] = useState<'listo' | 'buscando' | 'no_disponible' | 'editando' | 'guardando'>('listo');
  const [texto, setTexto] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { setNit(nitInicial?.trim() || null); }, [nitInicial]);

  useEffect(() => {
    if (nit || !solicitudId) return;
    if (yaBuscadas.has(solicitudId)) { setEstado('no_disponible'); return; }
    yaBuscadas.add(solicitudId);
    let vigente = true;
    setEstado('buscando');
    fetch(`/api/solicitudes/${solicitudId}/nit-entidad`, { method: 'POST' })
      .then((r) => r.json())
      .then((d) => {
        if (!vigente) return;
        if (d?.ok && d.nit) { setNit(d.nit); setEstado('listo'); onNit?.(d.nit); } else setEstado('no_disponible');
      })
      .catch(() => { if (vigente) setEstado('no_disponible'); });
    return () => { vigente = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solicitudId, nit]);

  async function guardar() {
    if (!solicitudId) return;
    setEstado('guardando'); setError('');
    try {
      const res = await fetch(`/api/solicitudes/${solicitudId}/nit-entidad`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nit: texto }) });
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

  return (
    <div>
      <div style={etiqueta}>NIT</div>
      {nit && <div style={{ fontSize: 12.5, color: '#0f172a', fontFamily: 'monospace' }}>{nit}</div>}
      {!nit && estado === 'buscando' && <div style={{ fontSize: 12, color: '#64748b', fontFamily }}>Buscando en SECOP…</div>}
      {!nit && estado === 'no_disponible' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#64748b', fontFamily }}>
          NIT no disponible
          {puedeDigitar && solicitudId ? <button type="button" style={boton} onClick={() => { setTexto(''); setError(''); setEstado('editando'); }}>Digitar</button> : null}
        </div>
      )}
      {!nit && (estado === 'editando' || estado === 'guardando') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ej. 830037739" maxLength={20} autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter' && texto.trim()) void guardar(); }}
              style={{ fontSize: 12.5, fontFamily: 'monospace', padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, width: 140 }} />
            <button type="button" style={boton} disabled={estado === 'guardando' || !texto.trim()} onClick={() => void guardar()}>{estado === 'guardando' ? 'Guardando…' : 'Guardar'}</button>
            <button type="button" style={{ ...boton, color: '#64748b' }} disabled={estado === 'guardando'} onClick={() => setEstado('no_disponible')}>Cancelar</button>
          </div>
          {error && <div style={{ fontSize: 11, color: '#dc2626', fontFamily }}>{error}</div>}
        </div>
      )}
    </div>
  );
}
