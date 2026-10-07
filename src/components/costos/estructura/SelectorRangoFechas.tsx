'use client';
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

const F = 'var(--font)';
const NAVY = '#0d2d5e';
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const DIAS_SEMANA = ['Do','Lu','Ma','Mi','Ju','Vi','Sa'];

export function toISO(d: Date): string {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatoDDMMAAAA(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/** Plazo en meses y fracción de días, a partir del rango [inicio, fin] inclusive. */
export function plazoTexto(fechaInicio: string, fechaFin: string): string {
  const ini = new Date(fechaInicio + 'T00:00:00');
  const fin = new Date(fechaFin + 'T00:00:00');
  const totalDias = Math.round((fin.getTime() - ini.getTime()) / 86_400_000) + 1;
  if (totalDias <= 0) return '';
  const meses = Math.floor(totalDias / 30);
  const diasResto = totalDias - meses * 30;
  if (meses === 0) return `${totalDias} día${totalDias !== 1 ? 's' : ''}`;
  const parteMeses = `${meses} mes${meses !== 1 ? 'es' : ''}`;
  return diasResto > 0 ? `${parteMeses} y ${diasResto} día${diasResto !== 1 ? 's' : ''}` : parteMeses;
}

export interface RangoFechas { fechaInicio: string; fechaFin: string }

/** Reconcilia el rango al hacer clic en un día del calendario: sin inicio o con
 * rango ya completo → empieza uno nuevo; con inicio y sin fin → cierra el rango
 * (ordenando si el clic cae antes del inicio). Misma lógica que ya vivía en
 * `clicDia`, extraída para poder probarla sin renderizar el componente. */
export function siguienteRangoPorClicDia(actual: RangoFechas, diaClicadoISO: string): RangoFechas {
  if (!actual.fechaInicio || (actual.fechaInicio && actual.fechaFin)) {
    return { fechaInicio: diaClicadoISO, fechaFin: '' };
  }
  return diaClicadoISO < actual.fechaInicio
    ? { fechaInicio: diaClicadoISO, fechaFin: actual.fechaInicio }
    : { fechaInicio: actual.fechaInicio, fechaFin: diaClicadoISO };
}

/** Reconcilia el rango al editar el input de inicio: si ya hay fin y el nuevo
 * inicio lo supera, limpia el fin (rango inválido); si no, conserva el fin. */
export function siguienteRangoPorInputInicio(actual: RangoFechas, nuevoInicioISO: string): RangoFechas {
  if (actual.fechaFin && nuevoInicioISO > actual.fechaFin) return { fechaInicio: nuevoInicioISO, fechaFin: '' };
  return { fechaInicio: nuevoInicioISO, fechaFin: actual.fechaFin };
}

/** Reconcilia el rango al editar el input de fin: si hay inicio y el nuevo fin
 * cae antes, intercambia (el valor tecleado pasa a ser el inicio). */
export function siguienteRangoPorInputFin(actual: RangoFechas, nuevoFinISO: string): RangoFechas {
  if (actual.fechaInicio && nuevoFinISO < actual.fechaInicio) return { fechaInicio: nuevoFinISO, fechaFin: actual.fechaInicio };
  return { fechaInicio: actual.fechaInicio, fechaFin: nuevoFinISO };
}

interface Props {
  fechaInicio: string;
  fechaFin: string;
  onChange: (fechaInicio: string, fechaFin: string) => void;
  placeholder?: string;
  mesInicial?: string;
}

/**
 * Selector de rango (plazo de ejecución) — clic en el día de inicio, clic en el
 * día de fin. Reemplaza los dos campos "Fecha de inicio"/"Fecha fin" sueltos por
 * un único botón que muestra el rango y el plazo calculado en meses/fracción.
 * Mismo patrón de portal + position:fixed que SelectorFechasMultiples, para no
 * quedar recortado por contenedores padre con overflow:hidden.
 *
 * `mesVisible` (mes que muestra el calendario) es estado interno de UI — no se
 * sincroniza con `mesInicial` después del montaje (evita el antipatrón "copiar
 * prop a estado en un efecto"). Si un futuro consumidor necesita reiniciar el
 * mes visible al cambiar de contexto (otro cargo/bloque), debe forzar un
 * remount con `key={identificadorDelContexto}` en vez de agregar un efecto.
 */
export function SelectorRangoFechas({ fechaInicio, fechaFin, onChange, placeholder = 'Seleccionar plazo', mesInicial }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const [mesVisible, setMesVisible] = useState(() => {
    const base = mesInicial ? new Date(mesInicial + 'T00:00:00')
      : fechaInicio ? new Date(fechaInicio + 'T00:00:00') : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!abierto || !btnRef.current) return;
    const actualizarPosicion = () => {
      const r = btnRef.current!.getBoundingClientRect();
      setCoords({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    actualizarPosicion();
    window.addEventListener('scroll', actualizarPosicion, true);
    window.addEventListener('resize', actualizarPosicion);
    return () => {
      window.removeEventListener('scroll', actualizarPosicion, true);
      window.removeEventListener('resize', actualizarPosicion);
    };
  }, [abierto]);

  const year = mesVisible.getFullYear();
  const month = mesVisible.getMonth();
  const primerDia = new Date(year, month, 1);
  const diasEnMes = new Date(year, month + 1, 0).getDate();
  const offsetInicio = primerDia.getDay();

  const celdas: (Date | null)[] = [];
  for (let i = 0; i < offsetInicio; i++) celdas.push(null);
  for (let d = 1; d <= diasEnMes; d++) celdas.push(new Date(year, month, d));

  function clicDia(fecha: Date) {
    const habiaRangoCompleto = !!(fechaInicio && fechaFin);
    const { fechaInicio: nuevoInicio, fechaFin: nuevoFin } = siguienteRangoPorClicDia({ fechaInicio, fechaFin }, toISO(fecha));
    onChange(nuevoInicio, nuevoFin);
    // Solo cierra el popover cuando el clic completó un rango (había inicio,
    // faltaba fin) — igual que antes, no al empezar un rango nuevo.
    if (fechaInicio && !habiaRangoCompleto) setAbierto(false);
  }

  const textoBoton = fechaInicio && fechaFin
    ? `${formatoDDMMAAAA(fechaInicio)} – ${formatoDDMMAAAA(fechaFin)}`
    : fechaInicio
    ? `${formatoDDMMAAAA(fechaInicio)} – Seleccionar fin`
    : placeholder;

  return (
    <div style={{ position: 'relative' }}>
      <button ref={btnRef} type="button" onClick={() => setAbierto(p => !p)}
        style={{ width: '100%', textAlign: 'left' as const, padding: '7px 10px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13, fontFamily: F, background: 'white', cursor: 'pointer', color: fechaInicio ? '#0f172a' : '#9ca3af', overflow: 'hidden', whiteSpace: 'nowrap' as const, textOverflow: 'ellipsis', boxSizing: 'border-box' as const }}>
        {textoBoton}
      </button>
      {abierto && coords && typeof document !== 'undefined' && createPortal(
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 9200 }} onClick={() => setAbierto(false)} />
          <div style={{ position: 'fixed', zIndex: 9201, top: coords.top, left: coords.left, background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.15)', padding: 10, width: 260, fontFamily: F }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <label style={{ flex: 1, fontSize: 9, color: '#9ca3af' }}>
                Inicio
                <input type="date" value={fechaInicio} onChange={e => {
                  const iso = e.target.value;
                  if (!iso) return;
                  const { fechaInicio: nuevoInicio, fechaFin: nuevoFin } = siguienteRangoPorInputInicio({ fechaInicio, fechaFin }, iso);
                  onChange(nuevoInicio, nuevoFin);
                  setMesVisible(new Date(new Date(iso + 'T00:00:00').getFullYear(), new Date(iso + 'T00:00:00').getMonth(), 1));
                }} style={{ display: 'block', width: '100%', marginTop: 2, padding: '4px 6px', border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 11, fontFamily: F, boxSizing: 'border-box' as const }} />
              </label>
              <label style={{ flex: 1, fontSize: 9, color: '#9ca3af' }}>
                Fin
                <input type="date" value={fechaFin} min={fechaInicio || undefined} onChange={e => {
                  const iso = e.target.value;
                  if (!iso) return;
                  const { fechaInicio: nuevoInicio, fechaFin: nuevoFin } = siguienteRangoPorInputFin({ fechaInicio, fechaFin }, iso);
                  onChange(nuevoInicio, nuevoFin);
                }} style={{ display: 'block', width: '100%', marginTop: 2, padding: '4px 6px', border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 11, fontFamily: F, boxSizing: 'border-box' as const }} />
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <button type="button" onClick={() => setMesVisible(new Date(year, month - 1, 1))} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, color: NAVY, padding: '2px 8px' }}>‹</button>
              <span style={{ fontSize: 12, fontWeight: 700, color: NAVY }}>{MESES[month]} {year}</span>
              <button type="button" onClick={() => setMesVisible(new Date(year, month + 1, 1))} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, color: NAVY, padding: '2px 8px' }}>›</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 4 }}>
              {DIAS_SEMANA.map(d => <div key={d} style={{ fontSize: 9, fontWeight: 700, color: '#9ca3af', textAlign: 'center' as const }}>{d}</div>)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
              {celdas.map((fecha, i) => {
                if (!fecha) return <div key={`vacio-${i}`} />;
                const iso = toISO(fecha);
                const esInicio = iso === fechaInicio;
                const esFin = iso === fechaFin;
                const enRango = !!fechaInicio && !!fechaFin && iso > fechaInicio && iso < fechaFin;
                const activo = esInicio || esFin;
                return (
                  <button type="button" key={iso} onClick={() => clicDia(fecha)} title={!fechaInicio ? 'Clic: fecha de inicio' : !fechaFin ? 'Clic: fecha de fin' : 'Clic: nuevo rango'}
                    style={{ width: 28, height: 28, borderRadius: 5, border: 'none', background: activo ? NAVY : enRango ? '#dbeafe' : 'transparent', color: activo ? 'white' : '#374151', fontSize: 11, cursor: 'pointer', fontWeight: activo ? 700 : 400 }}>
                    {fecha.getDate()}
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 8, borderTop: '1px solid #f3f4f6' }}>
              <button type="button" onClick={() => onChange('', '')} style={{ fontSize: 10, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', fontFamily: F }}>Limpiar</button>
              <span style={{ fontSize: 9.5, color: '#9ca3af' }}>{!fechaInicio ? 'Elegí el inicio' : !fechaFin ? 'Elegí el fin' : plazoTexto(fechaInicio, fechaFin)}</span>
              <button type="button" onClick={() => setAbierto(false)} style={{ fontSize: 10, color: NAVY, fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', fontFamily: F }}>Listo</button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
