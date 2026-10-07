'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import LicyChangePasswordModal from './LicyChangePasswordModal';
import { formatearUsuarioVisible } from '@/lib/formato-usuario';

interface Sesion {
  usuario?: string;
  cargo?: string;
  email?: string;
  rol?: string;
  entidadGrupo?: string;
  [key: string]: unknown;
}

interface Notif {
  id: number;
  tipo: string;
  titulo: string;
  descripcion: string | null;
  codigoProceso: string | null;
  entidad: string | null;
  perfil: string | null;
  leida: boolean;
  creadoEn: string;
  fechaPublicacion?: string | null;
  datos?: {
    diasRestantes?: number;
    etapa?: string;
    fechaEtapa?: string;
    [key: string]: unknown;
  } | null;
}

export interface LicyTopbarProps {
  moduloActual?: string;
  sesion?: Sesion | null;
  usuario?: Sesion | null;
  user?: Sesion | null;
  userName?: string;
  userRole?: string;
  userInitials?: string;
  breadcrumbParent?: string;
  breadcrumbCurrent?: string;
  onNewRequest?: () => void;
  onSearch?: (q: string) => void;
  onBuscarGlobal?: (q: string) => void;
  onBuscarSolicitudes?: (q: string) => void;
  onAbrirSolicitud?: (id: number) => void;
  onLogout?: () => void;
  onNotificationClick?: (codigoProceso: string | null) => void;
  onLicyOpen?: () => void;
}

const CRUMBS: Record<string, { parent: string; current: string }> = {
  procesosNuevos:           { parent: 'Búsqueda de procesos', current: 'Procesos nuevos' },
  busquedaFinal:            { parent: 'Búsqueda de procesos', current: 'Todos los procesos' },
  solicitudesAbiertas:      { parent: 'Solicitudes', current: 'Abiertas' },
  solicitudesComercial:     { parent: 'Solicitudes', current: 'Comercial' },
  solicitudesEspecializada: { parent: 'Solicitudes', current: 'Especializados' },
  solicitudesRechazadas:    { parent: 'Solicitudes', current: 'Rechazadas' },
  solicitudesEliminadas:    { parent: 'Solicitudes', current: 'Eliminadas' },
  solicitudesTodas:         { parent: 'Solicitudes', current: 'Todas' },
  asignacionesPendientes:   { parent: 'Asignaciones', current: 'Pendientes' },
  asignacionesTerminadas:   { parent: 'Asignaciones', current: 'Terminadas' },
  usuarios:                 { parent: 'Usuarios y perfiles', current: 'Usuarios' },
  usuariosEliminados:       { parent: 'Usuarios y perfiles', current: 'Eliminados' },
  examenesMedicos:          { parent: 'Módulos', current: 'Exámenes médicos' },
  dashboard:                { parent: 'LICYCOLBA', current: 'Dashboard' },
  trm:                      { parent: 'LICYCOLBA', current: 'TRM' },
  // Módulo "Informes Gerenciales" — la key interna sigue siendo 'indicadores'
  // (histórica), pero el breadcrumb nunca debe mostrar esa key cruda.
  indicadores:              { parent: 'LICYCOLBA', current: 'Informes' },
  asignacionesPorValidar:   { parent: 'Asignaciones', current: 'Por validar' },
  procesosEnEjecucion:      { parent: 'Asignaciones', current: 'Procesos en ejecución' },
  procesosEnEvaluacion:     { parent: 'Asignaciones', current: 'Procesos en evaluación' },
  asignacionesCerradas: { parent: 'Asignaciones', current: 'Procesos cerrados' },
};

/* ── Colores corporativos ───────────────────────────────── */
const C = {
  navy:       '#0d2d5e',
  blue:       '#1a5ea8',
  red:        '#c8102e',
  green:      '#15803d',
  amber:      '#b45309',
  amberDot:   '#f59e0b',
  bgRed:      'rgba(200,16,46,.08)',
  bgAmber:    'rgba(180,83,9,.08)',
  bgGreen:    'rgba(21,128,61,.07)',
  bgNavy:     'rgba(13,45,94,.06)',
};

/* ── Categorías ─────────────────────────────────────────── */
type CatKey = 'todas' | 'alertas' | 'adendas' | 'cronogramas' | 'estados';

const CATEGORIAS: { key: CatKey; label: string; tipos: string[] }[] = [
  { key: 'todas',       label: 'Todas',       tipos: [] },
  { key: 'alertas',     label: 'Alertas',     tipos: ['alerta_manifestacion', 'manifestacion_interes'] },
  { key: 'adendas',     label: 'Adendas',     tipos: ['documento_nuevo'] },
  { key: 'cronogramas', label: 'Cronogramas', tipos: ['cambio_cronograma', 'cambio_fecha_cierre'] },
  { key: 'estados',     label: 'Estados',     tipos: ['cambio_estado', 'cambio_valor'] },
];

/* ── Semáforo por días restantes ────────────────────────── */
function getSemaforo(diasRestantes?: number): { label: string; color: string; dot: string; bg: string } | null {
  if (diasRestantes === undefined || diasRestantes === null) return null;
  if (diasRestantes <= 1)  return { label: 'Urgente',  color: C.red,   dot: C.red,      bg: C.bgRed   };
  if (diasRestantes <= 3)  return { label: 'Próxima',  color: C.amber, dot: C.amberDot, bg: C.bgAmber };
  return                          { label: 'En plazo', color: C.green, dot: C.green,    bg: C.bgGreen };
}

function getDiasRestantes(n: Notif): number | undefined {
  if (n.datos?.diasRestantes !== undefined) return n.datos.diasRestantes;
  if (n.datos?.fechaEtapa) {
    const diff = new Date(n.datos.fechaEtapa).getTime() - Date.now();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }
  // Fallback: parsear fecha desde descripción "DD/MM/YYYY - HH:MM PM"
  if (n.descripcion) {
    const match = n.descripcion.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (match) {
      const [, d, m, y] = match;
      const fecha = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
      if (!isNaN(fecha.getTime())) {
        const diff = fecha.getTime() - Date.now();
        return Math.ceil(diff / (1000 * 60 * 60 * 24));
      }
    }
  }
  return undefined;
}

function getBorderColor(n: Notif): string {
  const esAlerta = n.tipo === 'alerta_manifestacion' || n.tipo === 'manifestacion_interes';
  if (!esAlerta) return 'transparent';
  const dias = getDiasRestantes(n);
  const sem = getSemaforo(dias);
  return sem?.dot ?? C.red;
}

function getRowBg(n: Notif): string {
  const esAlerta = n.tipo === 'alerta_manifestacion' || n.tipo === 'manifestacion_interes';
  if (!esAlerta) return 'transparent';
  const dias = getDiasRestantes(n);
  const sem = getSemaforo(dias);
  return sem?.bg ?? C.bgRed;
}

/* ── Helpers ────────────────────────────────────────────── */
function buildInitials(value: string) {
  const clean = String(value || '').trim();
  if (!clean) return 'US';
  const parts = clean.split(/[.\s@_-]+/).filter(Boolean).map(p => p[0]?.toUpperCase() ?? '');
  return parts.join('').slice(0, 2) || clean.slice(0, 2).toUpperCase() || 'US';
}

function fmtTiempo(fecha: string) {
  const diff = Date.now() - new Date(fecha).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'ahora';
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `hace ${hrs}h`;
  return `hace ${Math.floor(hrs / 24)}d`;
}

function fmtFecha(fecha?: string | null): string {
  if (!fecha) return '';
  const d = new Date(fecha);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

/* ── Componente principal ───────────────────────────────── */
export default function LicyTopbar({
  moduloActual = '',
  sesion, usuario, user,
  userName, userRole, userInitials,
  breadcrumbParent, breadcrumbCurrent,
  onNewRequest, onSearch, onBuscarGlobal, onBuscarSolicitudes, onAbrirSolicitud, onLogout, onNotificationClick, onLicyOpen,
}: LicyTopbarProps) {
  const [busqueda,      setBusqueda]      = useState('');
  const [resultados,    setResultados]    = useState<{id:number;codigoProceso:string;entidad:string;objeto:string}[]>([]);
  const [buscando,      setBuscando]      = useState(false);
  const [errorBusqueda, setErrorBusqueda] = useState(false);
  const [dropdownOpen,  setDropdownOpen]  = useState(false);
  const searchRef = useRef<HTMLDivElement|null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>|null>(null);
  // Ajuste "BUSCADOR GLOBAL — CARRERA DE BÚSQUEDAS" — una respuesta vieja
  // (ej. "cru") nunca debe sobrescribir el resultado de una búsqueda más
  // reciente (ej. "cruz roja") que ya está en vuelo o ya resolvió.
  const abortBusquedaRef = useRef<AbortController | null>(null);
  const [notifs,        setNotifs]        = useState<Notif[]>([]);
  const [totalNoLeidas, setTotalNoLeidas] = useState(0);
  const [notifOpen,     setNotifOpen]     = useState(false);
  const [catActiva,     setCatActiva]     = useState<CatKey>('todas');
  const [soloNoLeidas,  setSoloNoLeidas]  = useState(false);
  const [userMenuOpen,  setUserMenuOpen]  = useState(false);
  const [pwModalOpen,   setPwModalOpen]   = useState(false);
  const [tema, setTema] = useState<'glass'|'dark'|'red'|'pink'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('licy_theme') as 'glass'|'dark'|'red'|'pink') || 'pink';
    }
    return 'pink';
  });

  const notifRef = useRef<HTMLDivElement | null>(null);
  const userRef  = useRef<HTMLDivElement | null>(null);
  const moduloActualRef        = useRef(moduloActual);
  const onBuscarGlobalRef      = useRef(onBuscarGlobal);
  const onBuscarSolicitudesRef = useRef(onBuscarSolicitudes);
  useEffect(() => { moduloActualRef.current        = moduloActual;        }, [moduloActual]);
  useEffect(() => { onBuscarGlobalRef.current      = onBuscarGlobal;      }, [onBuscarGlobal]);
  useEffect(() => { onBuscarSolicitudesRef.current = onBuscarSolicitudes; }, [onBuscarSolicitudes]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', tema);
    localStorage.setItem('licy_theme', tema);
  }, [tema]);

  const sess            = sesion ?? usuario ?? user;
  const nombreUsuarioRaw = userName ?? sess?.usuario ?? sess?.email ?? 'Usuario';
  // Ajuste "FORMATO VISIBLE DE USERNAMES" — mismo helper central que ya
  // usa page.tsx (fichas/tablas/exportes), reutilizado tal cual, nunca una
  // segunda implementación. Se preserva el email sin transformar cuando
  // `nombreUsuarioRaw` cae al fallback `sess.email` (caso raro sin
  // `sess.usuario`) — el helper solo formatea usernames tipo "nombre.apellido".
  const nombreUsuarioRawStr = String(nombreUsuarioRaw);
  const nombreUsuario = nombreUsuarioRawStr.includes('@')
    ? nombreUsuarioRawStr
    : (formatearUsuarioVisible(nombreUsuarioRawStr) || 'Usuario');
  const rolUsuario      = userRole ?? sess?.cargo ?? sess?.rol ?? 'Usuario';
  const initials        = userInitials ?? buildInitials(String(nombreUsuarioRaw));
  const puedeVerRosa    = sess?.entidadGrupo === 'Mercadeo y Comunicaciones';

  // Si el usuario no tiene permiso para el tema rosa pero lo tiene guardado, resetear a Claro
  useEffect(() => {
    if (!puedeVerRosa && tema === 'pink') {
      setTema('glass');
    }
  }, [puedeVerRosa, tema]);

  const crumb        = CRUMBS[moduloActual] ?? { parent: 'LICYCOLBA', current: moduloActual || 'Inicio' };
  const crumbParent  = breadcrumbParent ?? crumb.parent;
  const crumbCurrent = breadcrumbCurrent ?? crumb.current;

  const F = 'var(--font)';

  /* ── API ──────────────────────────────────────────────── */
  const sinceRef   = useRef<string | null>(null);
  const syncRunRef = useRef(false);

  const cargarNotifs = useCallback(async () => {
    try {
      const res  = await fetch('/api/notificaciones?limit=100');
      if (!res.ok) return; // 401/403/500 — silencioso, no recargar
      const data = await res.json();
      if (data.ok) {
        setNotifs(data.notificaciones ?? []);
        setTotalNoLeidas(data.totalNoLeidas ?? 0);
      }
    } catch { /* silencioso */ }
  }, []);

  useEffect(() => {
    const SYNC_COOLDOWN_MS = 8 * 60 * 1000; // 8 min entre syncs del mismo navegador
    const LS_SYNC_KEY = 'licy_notif_sync_at';
    const LS_ALERTA_KEY = 'licy_alerta_sync_at';

    const runSync = async () => {
      if (syncRunRef.current) return;

      // Cooldown: no re-sincronizar si corrió hace menos de 8 min en esta pestaña
      const lastSync = Number(localStorage.getItem(LS_SYNC_KEY) ?? 0);
      if (Date.now() - lastSync < SYNC_COOLDOWN_MS) return;

      syncRunRef.current = true;
      try {
        const url = sinceRef.current
          ? `/api/notificaciones/sync?since=${encodeURIComponent(sinceRef.current)}`
          : '/api/notificaciones/sync';
        const res = await fetch(url);
        if (res.status === 429) return;
        const data = await res.json();
        if (data.ok && data.nextSince) {
          sinceRef.current = data.nextSince;
          try { localStorage.setItem(LS_SYNC_KEY, String(Date.now())); } catch { /* storage lleno */ }
        }
        if (data.items?.length > 0) await cargarNotifs();
      } catch { /* silencioso */ } finally {
        syncRunRef.current = false;
      }

      // alertas-manifestacion: solo si no corrió en las últimas 2 horas en este navegador
      const lastAlerta = Number(localStorage.getItem(LS_ALERTA_KEY) ?? 0);
      if (Date.now() - lastAlerta > 2 * 60 * 60 * 1000) {
        try {
          await fetch('/api/notificaciones/alertas-manifestacion');
          try { localStorage.setItem(LS_ALERTA_KEY, String(Date.now())); } catch { /* storage lleno */ }
        } catch { /* silencioso */ }
      }
    };

    runSync().then(cargarNotifs).catch(() => { /* 401 / sesión expirada — silencioso */ });
  }, [cargarNotifs]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (notifRef.current && !notifRef.current.contains(t)) setNotifOpen(false);
      if (userRef.current  && !userRef.current.contains(t))  setUserMenuOpen(false);
      if (searchRef.current && !searchRef.current.contains(t)) setDropdownOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setNotifOpen(false); setUserMenuOpen(false); setPwModalOpen(false); }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', esc); };
  }, []);

  const marcarLeida = async (id: number) => {
    try {
      await fetch(`/api/notificaciones/${id}`, { method: 'PATCH' });
      setNotifs(prev => prev.map(n => n.id === id ? { ...n, leida: true } : n));
      setTotalNoLeidas(prev => Math.max(0, prev - 1));
    } catch { /* silencioso */ }
  };

  const marcarTodas = async () => {
    try {
      await fetch('/api/notificaciones', { method: 'PATCH' });
      setNotifs(prev => prev.map(n => ({ ...n, leida: true })));
      setTotalNoLeidas(0);
    } catch { /* silencioso */ }
  };

      useEffect(()=>{
          if(debounceRef.current) clearTimeout(debounceRef.current);
          const q = busqueda.trim();
          if(q.length < 2){
            // Ajuste "BUSCADOR GLOBAL — CARRERA DE BÚSQUEDAS" — limpiar el
            // campo también cancela cualquier fetch en vuelo (nunca debe
            // "resucitar" resultados de una búsqueda ya abandonada).
            abortBusquedaRef.current?.abort();
            setResultados([]); setDropdownOpen(false); setErrorBusqueda(false); setBuscando(false);
            return;
          }
          debounceRef.current = setTimeout(async()=>{
            // Ajuste "BUSCADOR GLOBAL — ESTADOS DEL DROPDOWN" — el dropdown
            // se abre YA al empezar a buscar (no solo cuando llegan
            // resultados), para poder mostrar un estado de carga claro
            // ("Buscando...") dentro del mismo contenedor con fondo/borde/
            // sombra — nunca un "…" flotando suelto junto al input.
            // Ajuste "BUSCADOR GLOBAL — CARRERA DE BÚSQUEDAS" — se aborta
            // cualquier búsqueda anterior todavía en vuelo ANTES de lanzar
            // la nueva, y además se compara `abortBusquedaRef.current`
            // contra el controller capturado en este cierre antes de tocar
            // cualquier estado — doble protección: ni una respuesta
            // abortada (AbortError) ni una respuesta tardía que ya no es la
            // más reciente pueden pisar resultados/buscando/errorBusqueda.
            abortBusquedaRef.current?.abort();
            const controller = new AbortController();
            abortBusquedaRef.current = controller;
            setBuscando(true);
            setErrorBusqueda(false);
            setDropdownOpen(true);
            try{
              const res = await fetch(`/api/solicitudes?limit=8&q=${encodeURIComponent(q)}`, { signal: controller.signal });
              const data = await res.json();
              if(abortBusquedaRef.current !== controller) return; // ya hay una búsqueda más reciente en curso
              const lista = Array.isArray(data.solicitudes) ? data.solicitudes : [];
              setResultados(lista.slice(0,8).map((s:any)=>({
                id: s.id,
                codigoProceso: s.codigoProceso||'',
                entidad: s.entidad||'',
                objeto: s.objeto||'',
              })));
            }catch(err){
              if((err as { name?: string })?.name === 'AbortError') return; // cancelada a propósito, nunca un error real
              if(abortBusquedaRef.current !== controller) return;
              setResultados([]); setErrorBusqueda(true);
            }finally{
              if(abortBusquedaRef.current === controller) setBuscando(false);
            }
          }, 300);
        },[busqueda]);

      // Ajuste "BUSCADOR GLOBAL — CARRERA DE BÚSQUEDAS" — al desmontar
      // LicyTopbar (ej. navegación fuera del layout que lo monta), cancela
      // el debounce pendiente y aborta cualquier fetch en vuelo.
      useEffect(()=>{
        return ()=>{
          if(debounceRef.current) clearTimeout(debounceRef.current);
          abortBusquedaRef.current?.abort();
        };
      },[]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const texto = busqueda.trim();
    onSearch?.(texto);
    onBuscarGlobal?.(texto);
  };

  /* ── Filtrado ─────────────────────────────────────────── */
  const filtradas = notifs.filter(n => {
    const catOk = catActiva === 'todas'
      ? true
      : (CATEGORIAS.find(c => c.key === catActiva)?.tipos.includes(n.tipo) ?? false);
    const leidaOk = soloNoLeidas ? !n.leida : true;
    return catOk && leidaOk;
  });

  const conteoNL = (cat: CatKey): number => {
    if (cat === 'todas') return totalNoLeidas;
    const tipos = CATEGORIAS.find(c => c.key === cat)?.tipos ?? [];
    return notifs.filter(n => !n.leida && tipos.includes(n.tipo)).length;
  };

  const catActual = CATEGORIAS.find(c => c.key === catActiva);

  /* ── Estilos inline reutilizables ─────────────────────── */
  const borderBase = '0.5px solid var(--color-border-tertiary)';

  return (
    <>
      <div className="licy-topbar">

        {/* Breadcrumb */}
        <div className="licy-topbar-crumb">
          <span className="licy-topbar-crumb-parent">{crumbParent}</span>
          <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" style={{ width: 12, height: 12 }}>
            <path d="M9 18l6-6-6-6" />
          </svg>
          <span className="licy-topbar-crumb-current">{crumbCurrent}</span>
        </div>

        <div className="licy-topbar-space" />

        {/* Search */}
        <div ref={searchRef} style={{position:'relative'}}>
          <form className="licy-topbar-search" onSubmit={handleSearch}>
            <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input type="text" placeholder="Buscar aquí..." value={busqueda}
              onChange={e=>setBusqueda(e.target.value)}
              onFocus={()=>{ if(resultados.length>0||buscando||errorBusqueda) setDropdownOpen(true); }}
              aria-label="Buscar" />
          </form>
          {/* Ajuste "BUSCADOR GLOBAL — ESTADOS DEL DROPDOWN" — un único
              contenedor posicionado (mismo fondo/borde/sombra/z-index de
              siempre) que ahora cubre los 4 estados reales: cargando, error,
              sin resultados y con resultados — nunca un "…" suelto fuera de
              este contenedor. Input vacío/muy corto sigue sin mostrar nada
              (dropdownOpen se pone en false en ese caso, sin cambios). */}
          {dropdownOpen&&(
            <div style={{position:'absolute',top:'calc(100% + 4px)',left:0,right:0,minWidth:380,background:'white',border:'1px solid #e2e8f0',borderRadius:10,boxShadow:'0 8px 24px rgba(13,45,94,.15)',zIndex:9999,overflow:'hidden',fontFamily:F}}>
              {buscando?(
                <div style={{padding:'14px',fontSize:12,color:'#64748b',fontFamily:F}}>Buscando...</div>
              ):errorBusqueda?(
                <div style={{padding:'14px',fontSize:12,color:'#dc2626',fontFamily:F}}>No se pudo completar la búsqueda. Intenta de nuevo.</div>
              ):resultados.length===0?(
                <div style={{padding:'14px',fontSize:12,color:'#94a3b8',fontFamily:F}}>No se encontraron resultados.</div>
              ):(<>
              {resultados.map((r,i)=>(
                <div key={r.id}
                  onClick={()=>{
                    setDropdownOpen(false);
                    setBusqueda('');
                    // Abrir ficha directamente (funciona para privados y públicos)
                    if(onAbrirSolicitud){ onAbrirSolicitud(r.id); }
                    else {
                      const q = r.codigoProceso||r.entidad||r.objeto||'';
                      onBuscarGlobal?.(q);
                    }
                  }}
                  style={{padding:'9px 14px',borderBottom:i<resultados.length-1?'1px solid #f1f5f9':'none',cursor:'pointer',transition:'background .1s'}}
                  onMouseOver={e=>{(e.currentTarget as HTMLDivElement).style.background='#f8fafc';}}
                  onMouseOut={e=>{(e.currentTarget as HTMLDivElement).style.background='white';}}>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <span style={{fontSize:11,fontFamily:'monospace',color:'#1e5799',fontWeight:600,flexShrink:0}}>{r.codigoProceso||'—'}</span>
                    <span style={{fontSize:11,color:'#64748b',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.entidad}</span>
                  </div>
                  {r.objeto&&<div style={{fontSize:10.5,color:'#94a3b8',marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.objeto.charAt(0).toUpperCase()+r.objeto.slice(1).toLowerCase()}</div>}
                </div>
              ))}
              <div style={{padding:'8px 14px',borderTop:'1px solid #f1f5f9',background:'#f8fafc',cursor:'pointer'}}
                onClick={()=>{ handleSearch({preventDefault:()=>{}} as any); setDropdownOpen(false); }}>
                <span style={{fontSize:11,color:'#1e5799',fontWeight:600,fontFamily:F}}>
                  Ver todos los resultados para &quot;{busqueda}&quot;
                </span>
              </div>
              </>)}
            </div>
          )}
        </div>


        {/* Botón Asistente Licy */}
        {onLicyOpen && (
          <button
            type="button"
            onClick={() => { onLicyOpen(); setNotifOpen(false); setUserMenuOpen(false); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 16px', borderRadius: 999,
              background: tema === 'pink'
                ? 'linear-gradient(135deg, #C4566A 0%, #D9778A 100%)'
                : tema === 'red'
                ? 'linear-gradient(135deg, #7d1120 0%, #c8102e 100%)'
                : 'linear-gradient(135deg, #0d2d5e 0%, #1a5ea8 100%)',
              border: 'none', cursor: 'pointer',
              boxShadow: tema === 'pink'
                ? '0 2px 8px rgba(196,86,106,.35)'
                : '0 2px 8px rgba(13,45,94,.35)',
              transition: 'opacity .15s, transform .1s',
              flexShrink: 0,
            }}
            onMouseOver={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.88'; }}
            onMouseOut={e  => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%',
              background: 'rgba(255,255,255,.18)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700, color: 'white', flexShrink: 0,
            }}>C</div>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'white', fontFamily: F, whiteSpace: 'nowrap' }}>
              Asistente Colba
            </span>
          </button>
        )}

        {/* Campanita */}
        <div className="licy-notif-bell-wrap" ref={notifRef} style={{ position: 'relative' }}>
          <button type="button"
            className={`licy-topbar-bell${notifOpen ? ' licy-topbar-bell--active' : ''}`}
            title="Notificaciones"
            onClick={() => { setNotifOpen(v => !v); setUserMenuOpen(false); }}>
            <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 01-3.46 0" />
            </svg>
            {totalNoLeidas > 0 && (
              <span className="licy-topbar-bell-dot">{totalNoLeidas > 99 ? '99+' : totalNoLeidas}</span>
            )}
          </button>

          {/* ── Panel notificaciones ── */}
          {notifOpen && (
            <div style={{
              position: 'absolute', top: 44, right: 0,
              width: 560, maxHeight: 'calc(100vh - 80px)',
              background: 'white',
              borderRadius: 12,
              border: '1px solid #e2e8f0',
              boxShadow: '0 12px 40px rgba(13,45,94,.2)',
              display: 'flex', zIndex: 9999, overflow: 'hidden', fontFamily: F,
            }}>

              {/* Sidebar categorías */}
              <div style={{
                width: 148, flexShrink: 0,
                borderRight: borderBase,
                display: 'flex', flexDirection: 'column',
              }}>
                {/* Header sidebar */}
                <div style={{ padding: '13px 14px 10px', borderBottom: borderBase }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.navy, marginBottom: 2, fontFamily: F }}>
                    Notificaciones
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontFamily: F }}>
                    {totalNoLeidas} sin leer
                  </div>
                </div>

                {/* Lista categorías */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '6px 0', overflowY: 'auto' }}>
                  {CATEGORIAS.map(cat => {
                    const nl     = conteoNL(cat.key);
                    const activa = catActiva === cat.key;
                    const esAlerta = cat.key === 'alertas';

                    const borderColor = activa ? (esAlerta ? C.red : C.navy) : 'transparent';
                    const bgColor     = activa ? (esAlerta ? C.bgRed : C.bgNavy) : 'transparent';
                    const labelColor  = activa ? (esAlerta ? C.red : C.navy) : 'var(--color-text-secondary)';

                    const badgeBg    = cat.key === 'todas'   ? 'var(--color-background-secondary)'
                                     : esAlerta              ? C.bgRed
                                     : 'var(--color-background-secondary)';
                    const badgeColor = cat.key === 'todas'   ? 'var(--color-text-tertiary)'
                                     : esAlerta && nl > 0    ? C.red
                                     : 'var(--color-text-tertiary)';

                    return (
                      <div key={cat.key}
                        onClick={() => setCatActiva(cat.key)}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '8px 14px', cursor: 'pointer',
                          borderLeft: `2.5px solid ${borderColor}`,
                          background: bgColor,
                          transition: 'background .1s',
                        }}
                        onMouseOver={e => { if (!activa) (e.currentTarget as HTMLDivElement).style.background = 'var(--color-background-secondary)'; }}
                        onMouseOut={e  => { if (!activa) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}>
                        <span style={{ fontSize: 12, fontWeight: activa ? 600 : 400, color: labelColor, fontFamily: F }}>
                          {cat.label}
                        </span>
                        {nl > 0 && (
                          <span style={{
                            fontSize: 10, fontWeight: 500,
                            padding: '1px 7px', borderRadius: 999,
                            background: badgeBg, color: badgeColor,
                            fontFamily: F,
                          }}>
                            {nl > 99 ? '99+' : nl}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Footer sidebar */}
                <div style={{ padding: '10px 14px', borderTop: borderBase }}>
                  {totalNoLeidas > 0 && (
                    <span onClick={marcarTodas}
                      style={{ fontSize: 11, color: C.blue, cursor: 'pointer', fontFamily: F }}>
                      Marcar leídas
                    </span>
                  )}
                </div>
              </div>

              {/* Panel lista */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

                {/* Header lista */}
                <div style={{
                  padding: '10px 14px', borderBottom: borderBase,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: C.navy, fontFamily: F }}>
                      {catActual?.label ?? 'Todas'}
                    </span>
                    {conteoNL(catActiva) > 0 && (
                      <span style={{
                        fontSize: 10, fontWeight: 500,
                        padding: '1px 7px', borderRadius: 999,
                        background: catActiva === 'alertas' ? C.bgRed : 'var(--color-background-secondary)',
                        color: catActiva === 'alertas' ? C.red : 'var(--color-text-tertiary)',
                        fontFamily: F,
                      }}>
                        {conteoNL(catActiva)} nuevas
                      </span>
                    )}
                  </div>
                  <button onClick={() => setSoloNoLeidas(v => !v)}
                    style={{
                      fontSize: 11, fontFamily: F, cursor: 'pointer',
                      background: 'none', border: 'none',
                      color: soloNoLeidas ? C.navy : 'var(--color-text-tertiary)',
                      fontWeight: soloNoLeidas ? 600 : 400,
                    }}>
                    {soloNoLeidas ? '● No leídas' : '○ Todas'}
                  </button>
                </div>

                {/* Lista notificaciones */}
                <div style={{ overflowY: 'auto', flex: 1, scrollbarWidth: 'thin' }}>
                  {filtradas.length === 0 ? (
                    <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: 13, fontFamily: F }}>
                      {soloNoLeidas ? '✓ Todo al día en esta categoría' : 'Sin notificaciones'}
                    </div>
                  ) : filtradas.map(n => {
                    const esAlerta    = n.tipo === 'alerta_manifestacion' || n.tipo === 'manifestacion_interes';
                    const sem = esAlerta ? getSemaforo(getDiasRestantes(n)) : null;
                    const borderColor = getBorderColor(n);
                    const rowBg       = getRowBg(n);
                    const fechaDisplay = fmtFecha(n.datos?.fechaEtapa ?? n.fechaPublicacion ?? n.creadoEn);

                    return (
                      <div key={n.id}
                        style={{
                          padding: '11px 14px',
                          borderBottom: borderBase,
                          borderLeft: `2.5px solid ${borderColor}`,
                          background: rowBg || (n.leida ? 'transparent' : 'var(--color-background-secondary)'),
                          cursor: 'pointer', transition: 'background .1s',
                        }}
                        onMouseOver={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--color-background-secondary)'; }}
                        onMouseOut={e  => { (e.currentTarget as HTMLDivElement).style.background = rowBg || (n.leida ? 'transparent' : 'var(--color-background-secondary)'); }}
                        onClick={() => { if (!n.leida) marcarLeida(n.id); onNotificationClick?.(n.codigoProceso); setNotifOpen(false); }}>


                        {/* Fila título */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
                          <span style={{
                            fontSize: 12, fontWeight: n.leida ? 400 : 600, lineHeight: 1.35,
                            color: sem ? sem.color : 'var(--color-text-primary)',
                            fontFamily: F,
                          }}>
                            {n.titulo}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                            {/* Semáforo */}
                            {sem && (
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                fontSize: 10, fontWeight: 500,
                                padding: '2px 8px', borderRadius: 999,
                                background: sem.bg, color: sem.color,
                                fontFamily: F,
                              }}>
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: sem.dot, display: 'inline-block' }} />
                                {sem.label}
                              </span>
                            )}
                            <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap', fontFamily: F }}>
                              {fmtTiempo(n.creadoEn)}
                            </span>
                            {!n.leida && (
                              <div style={{ width: 6, height: 6, borderRadius: '50%', background: sem ? sem.dot : C.navy, flexShrink: 0 }} />
                            )}
                          </div>
                        </div>

                        {/* Descripción */}
                        {n.descripcion && (
                          <p style={{ margin: '0 0 5px', fontSize: 11.5, color: 'var(--color-text-secondary)', lineHeight: 1.45, fontFamily: F }}>
                            {n.descripcion}
                          </p>
                        )}

                        {/* Meta: código + fecha */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          {n.codigoProceso && (
                            <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontFamily: 'monospace' }}>
                              {n.codigoProceso}
                            </span>
                          )}
                          {fechaDisplay && (
                            <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontFamily: F }}>
                              {fechaDisplay}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Footer lista */}
                <div style={{ padding: '9px 14px', borderTop: borderBase, textAlign: 'center', flexShrink: 0 }}>
                  <button onClick={cargarNotifs}
                    style={{ fontSize: 11, color: 'var(--color-text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: F }}>
                    Actualizar
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Botón opcional */}
        {onNewRequest && (
          <button className="licy-topbar-new-btn" type="button" onClick={onNewRequest}>
            <svg fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Nueva solicitud
          </button>
        )}

        {/* User menu */}
        <div className="licy-user-wrap" ref={userRef}>
          <button type="button"
            className={`licy-topbar-user${userMenuOpen ? ' licy-topbar-user--active' : ''}`}
            onClick={() => { setUserMenuOpen(v => !v); setNotifOpen(false); }}>
            <div className="licy-topbar-user-av">{initials}</div>
            <div className="licy-topbar-user-text">
              <div className="licy-topbar-user-name">{nombreUsuario}</div>
              <div className="licy-topbar-user-role">{rolUsuario}</div>
            </div>
            <span className={`licy-topbar-user-chev${userMenuOpen ? ' licy-topbar-user-chev--open' : ''}`}>
              <svg fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" style={{ width: 12, height: 12 }}>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </span>
          </button>

          {userMenuOpen && (
            <div className="licy-user-menu" role="menu">
              <button className="licy-user-menu-item" type="button" role="menuitem"
                onClick={() => { setUserMenuOpen(false); setPwModalOpen(true); }}>
                <span className="licy-user-menu-icon">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5.5 7V5.5a2.5 2.5 0 015 0V7" />
                    <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
                    <path d="M8 10v1.5" />
                  </svg>
                </span>
                Cambiar contraseña
              </button>
              <div className="licy-user-menu-divider" />
              {/* Selector de apariencia */}
              <div style={{padding:'8px 12px 10px'}}>
                <div style={{fontSize:10,fontWeight:600,color:'#9ca3af',textTransform:'uppercase' as const,letterSpacing:'0.06em',marginBottom:8,fontFamily:'var(--font)'}}>Apariencia</div>
                <div style={{display:'flex',gap:6}}>
                  {([
                    {id:'glass',label:'Claro',bg:'linear-gradient(135deg,#f0f7ff,#5a9fd4)',accent:'#1e5799',accentLight:'#eff6ff'},
                    {id:'dark', label:'Azul', bg:'#0F2040',                                 accent:'#1e5799',accentLight:'#eff6ff'},
                    {id:'red',  label:'Rojo', bg:'linear-gradient(135deg,#c8102e,#8b1222)', accent:'#c8102e',accentLight:'#fff0f2'},
                    ...(puedeVerRosa ? [{id:'pink' as const, label:'Rosa', bg:'linear-gradient(135deg,#e91e63,#c2185b)', accent:'#c2185b',accentLight:'#fce4ec'}] : []),
                  ] as {id:'glass'|'dark'|'red'|'pink';label:string;bg:string;accent:string;accentLight:string}[]).map(t=>(
                    <button key={t.id} type="button" onClick={()=>setTema(t.id)}
                      style={{
                        flex:1,display:'flex',flexDirection:'column' as const,alignItems:'center',gap:5,
                        padding:'7px 4px',borderRadius:8,cursor:'pointer',
                        border:'1.5px solid',borderColor:tema===t.id?t.accent:'#e5e7eb',
                        background:tema===t.id?t.accentLight:'transparent',transition:'all .12s',
                      }}>
                      <span style={{width:18,height:18,borderRadius:'50%',flexShrink:0,background:t.bg,boxShadow:'0 0 0 1px rgba(0,0,0,.10)'}}/>
                      <span style={{fontSize:10,fontWeight:tema===t.id?700:400,color:tema===t.id?t.accent:'#6b7280',fontFamily:'var(--font)'}}>{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="licy-user-menu-divider" />
              <button className="licy-user-menu-item licy-user-menu-item--danger" type="button" role="menuitem"
                onClick={() => { setUserMenuOpen(false); setNotifOpen(false); onLogout?.(); }}>
                <span className="licy-user-menu-icon">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 14H3.5A1.5 1.5 0 012 12.5v-9A1.5 1.5 0 013.5 2H6" />
                    <path d="M10 11l3-3-3-3" />
                    <path d="M13 8H6" />
                  </svg>
                </span>
                Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </div>

      {pwModalOpen && <LicyChangePasswordModal email={sess?.email ?? ''} onClose={() => setPwModalOpen(false)} />}
    </>
  );
}