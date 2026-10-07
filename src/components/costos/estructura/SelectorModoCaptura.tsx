'use client';
import React from 'react';

const F = 'var(--font)';
const NAVY = '#0d2d5e';

interface Props {
  modo: 'formulario' | 'texto';
  onCambiar: (modo: 'formulario' | 'texto') => void;
}

/** Pestañas [Formulario guiado] [Escribir requisito] — docs/diseno-formulario-requisito-mo.md §1. */
export function SelectorModoCaptura({ modo, onCambiar }: Props) {
  const opciones: { key: 'formulario' | 'texto'; label: string }[] = [
    { key: 'formulario', label: 'Formulario guiado' },
    { key: 'texto', label: 'Escribir requisito' },
  ];
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
      {opciones.map(o => {
        const activo = modo === o.key;
        return (
          <button
            key={o.key}
            onClick={() => onCambiar(o.key)}
            style={{
              padding: '6px 14px', borderRadius: 6, border: activo ? `1px solid ${NAVY}` : '1px solid #e2e8f0',
              background: activo ? NAVY : 'white', color: activo ? 'white' : '#6b7280',
              fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: F,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
