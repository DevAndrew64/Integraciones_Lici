'use client';
import React from 'react';

const F = 'var(--font)';
const NAVY = '#0d2d5e';
const cop = (v: number) => v.toLocaleString('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 });
export const COLS_LIQ = 'minmax(0,1fr) 200px 78px 128px 152px';

interface Props {
  titulo: string;
  subtitulo?: string;
  valor?: number;
  resumenTexto?: string;
  abierto: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  mostrarEncabezados?: boolean;
  extra?: React.ReactNode;
  acento?: 'navy' | 'rojo' | 'azulOscuro';
}

// Paletas corporativas ya usadas en el resto de la app (ver graficos de
// Costos Administrativos) — reutilizadas aquí, nunca un color inventado,
// para diferenciar visualmente un bloque resumen/total del resto de
// tarjetas de cargo (que siguen usando el navy por defecto).
const ROJO_CORPORATIVO = '#991b1b';
const ROJO_CORPORATIVO_BG = '#fee2e2';
const ROJO_CORPORATIVO_BORDE = '#fecaca';
const AZUL_OSCURO_CORPORATIVO = '#1e5799';
const AZUL_OSCURO_CORPORATIVO_BG = '#dbeafe';
const AZUL_OSCURO_CORPORATIVO_BORDE = '#bfdbfe';

/**
 * Bloque colapsable reutilizado por la sección de liquidación de Mano de Obra.
 * Extraído como componente de módulo (no definido dentro de ModuloEstructuraCostos)
 * a propósito: definirlo dentro de otro componente hace que React lo recree en cada
 * render del padre, desmontando y remontando todo lo que hay adentro (perdiendo el
 * estado local de sus hijos, ej. un popover abierto).
 */
export function BloqueColapsable({ titulo, subtitulo, valor, resumenTexto, abierto, onToggle, children, mostrarEncabezados = true, extra, acento = 'navy' }: Props) {
  const colorTitulo = acento === 'rojo' ? ROJO_CORPORATIVO : acento === 'azulOscuro' ? AZUL_OSCURO_CORPORATIVO : NAVY;
  const bgEncabezado = acento === 'rojo' ? ROJO_CORPORATIVO_BG : acento === 'azulOscuro' ? AZUL_OSCURO_CORPORATIVO_BG : '#f8fafc';
  const borderEncabezado = acento === 'rojo' ? ROJO_CORPORATIVO_BORDE : acento === 'azulOscuro' ? AZUL_OSCURO_CORPORATIVO_BORDE : '#e2e8f0';
  return (
    <div style={{ marginBottom: 10 }}>
      <div onClick={onToggle} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: bgEncabezado, border: '1px solid ' + borderEncabezado, borderRadius: abierto ? '6px 6px 0 0' : '6px', cursor: 'pointer', fontFamily: F }}>
        <span style={{ display: 'flex', flexDirection: 'column' as const, gap: 2 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: colorTitulo }}>{titulo}</span>
          {subtitulo && <span style={{ fontSize: 10, fontWeight: 400, color: '#9ca3af' }}>{subtitulo}</span>}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {extra && <span onClick={e => e.stopPropagation()}>{extra}</span>}
          {!abierto && resumenTexto && <span style={{ fontSize: 11, color: '#6b7280' }}>{resumenTexto}</span>}
          {/* Ajuste (petición directa) "ASI DEBE VERSE EL VALOR Y LA FLECHA"
              — mismo estilo ya usado en el resumen de Dotación/EPP: valor en
              negrilla navy monoespaciado (nunca gris/regular), y chevron '›'
              que gira 90° al abrir (en vez del caret '⌄' que giraba 180°). */}
          {!abierto && resumenTexto === undefined && valor !== undefined && <span style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 700, color: colorTitulo }}>{cop(valor)}</span>}
          <span aria-hidden="true" style={{ fontSize: 14, color: '#94a3b8', transform: abierto ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform .15s' }}>›</span>
        </div>
      </div>
      {abierto && (
        <div style={{ borderLeft: '1px solid ' + borderEncabezado, borderRight: '1px solid ' + borderEncabezado, borderBottom: '1px solid ' + borderEncabezado, borderRadius: '0 0 6px 6px', overflow: 'hidden', background: 'white' }}>
          {mostrarEncabezados && (
            <div style={{ display: 'grid', gridTemplateColumns: COLS_LIQ, background: 'white', borderBottom: '2px solid ' + colorTitulo }}>
              {[{ label: 'Concepto', align: 'left' as const }, { label: 'Detalle / Cantidad', align: 'left' as const }, { label: 'Factor', align: 'center' as const }, { label: 'Valor / hora', align: 'right' as const }, { label: 'Total mes', align: 'right' as const }].map((col, ci) => (
                <div key={ci} style={{ padding: '9px ' + (ci === 4 ? '16px' : '10px') + ' 9px ' + (ci === 0 ? '16px' : '10px'), fontSize: 10, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '.08em', textAlign: col.align }}>{col.label}</div>
              ))}
            </div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
