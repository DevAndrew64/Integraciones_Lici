'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import {CalendarioPicker} from './CalendarioPicker';

type Proceso = Record<string, any>;

export interface ProcesosCardsViewProps {
  procesos: Proceso[];
  loading?: boolean;
  error?: string | null;
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
  filtros?: any;
  setFiltros?: (value: any) => void;
  onBuscar?: (filtros?: any) => void;
  onCambiarPagina?: (page: number) => void;
  onCambiarLimit?: (limit: number) => void;
  onGestionarProceso?: (proceso: Proceso) => void;
  esNuevo?: (proceso: Proceso) => boolean;
}

const getEntidad = (p: Proceso) =>
  p.entidad || p.cliente || p.nombreEntidad || p.entidadContratante || 'Entidad no disponible';

const getTitulo = (p: Proceso) =>
  p.titulo || p.nombre || p.nombreProceso || p.objeto || 'Proceso sin título';

const getObjeto = (p: Proceso) =>
  p.objeto || p.descripcion || p.resumen || p.detalle || 'Sin descripción disponible';

const getCiudad = (p: Proceso) => {
  const departamento = String(p.departamento || '').trim();
  if (p.ciudad || p.municipio) return p.ciudad || p.municipio;
  if (departamento.includes(';')) return departamento.split(';')[0]?.split(':')[0]?.trim() || 'Ubicación no disponible';
  if (departamento.includes(':')) return departamento.split(':')[0]?.trim() || 'Ubicación no disponible';
  return departamento || 'Ubicación no disponible';
};

const getFuente = (p: Proceso) =>
  p.fuente || p.portal || p.origen || p.aliasFuente || 'Fuente no disponible';

const getModalidad = (p: Proceso) => {
  const raw = p.modalidad || p.tipo || p.tipoProceso || p.modalidadContratacion || '';
  if (raw) return raw;
  const titulo = String(p.titulo || p.nombre || p.nombreProceso || p.objeto || '').toLowerCase();
  if (titulo.includes('licitación') || titulo.includes('licitacion')) return 'Licitación';
  if (titulo.includes('mínima cuantía') || titulo.includes('minima cuantia')) return 'Mínima cuantía';
  if (titulo.includes('selección abreviada') || titulo.includes('seleccion abreviada')) return 'Sel. abreviada';
  if (titulo.includes('concurso de méritos') || titulo.includes('concurso de meritos')) return 'Concurso méritos';
  if (titulo.includes('contratación directa') || titulo.includes('contratacion directa')) return 'Contrat. directa';
  if (titulo.includes('régimen especial') || titulo.includes('regimen especial')) return 'Régimen especial';
  if (titulo.includes('subasta')) return 'Subasta inversa';
  return '';
};

const getEstado = (p: Proceso) =>
  p.estado || p.estadoFuente || p.vigencia || 'Estado no disponible';

const getFechaCierre = (p: Proceso) =>
  p.fechaCierre || p.fecha_cierre || p.cierre || p.fechaLimite || p.fechaPresentacion || p.fechaVencimiento || null;

const getSiglas = (entidad: string) => {
  const words = entidad.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
  return words.slice(0, 3).map((w) => w[0]).join('').toUpperCase();
};

const getDeadlineClass = (fechaStr: string | null): string => {
  if (!fechaStr) return '';
  try {
    const diff = new Date(fechaStr).getTime() - Date.now();
    const days = diff / (1000 * 60 * 60 * 24);
    if (days <= 3) return 'licy-proceso-deadline-red';
    if (days <= 14) return 'licy-proceso-deadline-amber';
    return 'licy-proceso-deadline-blue';
  } catch { return 'licy-proceso-deadline-blue'; }
};

const formatFecha = (fechaStr: string | null): string => {
  if (!fechaStr) return '';
  try {
    const d = new Date(fechaStr);
    if (isNaN(d.getTime())) return fechaStr;
    const diff = d.getTime() - Date.now();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    if (days < 0) return 'Vencido';
    if (days === 0) return 'Cierra hoy';
    if (days === 1) return 'Cierra mañana';
    return `Cierra en ${days} días`;
  } catch { return fechaStr; }
};

const getPortalTag = (fuente: string) => {
  const f = String(fuente || '').toUpperCase();
  if (f.includes('SECOP II') || f === 'S2') return { label: 'S2', cls: 'licy-proceso-tag-s2' };
  if (f.includes('SECOP I') || f === 'S1') return { label: 'S1', cls: 'licy-proceso-tag-s1' };
  if (f.includes('PRIVADO') || f.includes('PRIV')) return { label: 'Priv.', cls: 'licy-proceso-tag-priv' };
  return { label: f.slice(0, 6) || 'NC', cls: 'licy-proceso-tag-otro' };
};

const normalizarTextoFiltro = (valor: string) =>
  String(valor || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const labelStyleBase: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: '#374151',
  display: 'block', marginBottom: 8, letterSpacing: 0.2,
};

const inputStyleBase: React.CSSProperties = {
  width: '100%', height: 36, border: '1.5px solid #e2e8f0',
  borderRadius: 8, padding: '0 10px', fontSize: 13, color: '#1e293b',
  outline: 'none', boxSizing: 'border-box', fontFamily: 'var(--font, system-ui)',
};

const PERFILES_OPTS = ['aseocolba', 'vigicolba', 'tempocolba'];

const FUENTES_OPTS = ['secop ii', 'secop i', 'contrato privado'];

const MODALIDADES_OPTS = [
  'Licitación pública', 'Mínima cuantía', 'Selección abreviada',
  'Contratación directa', 'Concurso de méritos', 'Subasta inversa', 'Régimen especial',
];

const ESTADOS_OPTS = [
  'Convocatoria', 'En Evaluacion', 'Adjudicado',
  'Liquidado', 'Terminado Anormalmente O Descartado', 'No Aplica',
];
const COLOMBIA_DEPTS: { nombre: string; municipios: string[] }[] = [
  { nombre: 'Amazonas', municipios: ['Leticia', 'Puerto Nariño', 'La Chorrera', 'El Encanto', 'La Pedrera', 'Mirití-Paraná', 'Puerto Alegría', 'Tarapacá'] },
  { nombre: 'Antioquia', municipios: ['Medellín', 'Bello', 'Itagüí', 'Envigado', 'Apartadó', 'Turbo', 'Rionegro', 'Caucasia', 'Carepa', 'Copacabana', 'La Estrella', 'Sabaneta', 'Caldas', 'Yarumal', 'Puerto Berrío'] },
  { nombre: 'Arauca', municipios: ['Arauca', 'Saravena', 'Tame', 'Arauquita', 'Fortul', 'Cravo Norte', 'Puerto Rondón'] },
  { nombre: 'Atlántico', municipios: ['Barranquilla', 'Soledad', 'Malambo', 'Sabanalarga', 'Baranoa', 'Galapa', 'Puerto Colombia', 'Santo Tomás', 'Palmar de Varela'] },
  { nombre: 'Bogotá D.C.', municipios: ['Bogotá D.C.'] },
  { nombre: 'Bolívar', municipios: ['Cartagena', 'Magangué', 'El Carmen de Bolívar', 'Mompós', 'Turbaco', 'Arjona', 'San Juan Nepomuceno', 'Achí', 'Simití'] },
  { nombre: 'Boyacá', municipios: ['Tunja', 'Duitama', 'Sogamoso', 'Chiquinquirá', 'Paipa', 'Puerto Boyacá', 'Moniquirá', 'Garagoa', 'Guateque', 'Samacá'] },
  { nombre: 'Caldas', municipios: ['Manizales', 'Villamaría', 'La Dorada', 'Riosucio', 'Chinchiná', 'Salamina', 'Anserma', 'Neira', 'Supía', 'Aguadas'] },
  { nombre: 'Caquetá', municipios: ['Florencia', 'San Vicente del Caguán', 'Puerto Rico', 'El Doncello', 'La Montañita', 'Milán', 'Curillo', 'Belén de los Andaquíes', 'Cartagena del Chairá'] },
  { nombre: 'Casanare', municipios: ['Yopal', 'Aguazul', 'Villanueva', 'Tauramena', 'Monterrey', 'Paz de Ariporo', 'Trinidad', 'Hato Corozal', 'Orocué', 'Nunchía'] },
  { nombre: 'Cauca', municipios: ['Popayán', 'Santander de Quilichao', 'Puerto Tejada', 'El Tambo', 'Timbío', 'Patía', 'Miranda', 'Bolívar', 'Piendamó', 'Toribío'] },
  { nombre: 'Cesar', municipios: ['Valledupar', 'Aguachica', 'Bosconia', 'Codazzi', 'La Jagua de Ibirico', 'Chiriguaná', 'El Copey', 'Pailitas', 'San Alberto', 'Pelaya'] },
  { nombre: 'Chocó', municipios: ['Quibdó', 'Istmina', 'Condoto', 'Riosucio', 'Nuquí', 'Bahía Solano', 'Bojayá', 'Unguía', 'Tadó', 'Bagadó'] },
  { nombre: 'Córdoba', municipios: ['Montería', 'Lorica', 'Sahagún', 'Cereté', 'Tierralta', 'Montelíbano', 'San Pelayo', 'Ciénaga de Oro', 'Ayapel', 'Chinú'] },
  { nombre: 'Cundinamarca', municipios: ['Soacha', 'Fusagasugá', 'Facatativá', 'Zipaquirá', 'Chía', 'Mosquera', 'Girardot', 'La Mesa', 'Villeta', 'Cajicá', 'Tabio', 'Ubaté', 'Cota', 'Funza'] },
  { nombre: 'Guainía', municipios: ['Inírida', 'Barranco Minas', 'Cacahual', 'La Guadalupe', 'Mapiripana', 'San Felipe'] },
  { nombre: 'Guaviare', municipios: ['San José del Guaviare', 'Calamar', 'El Retorno', 'Miraflores'] },
  { nombre: 'Huila', municipios: ['Neiva', 'Pitalito', 'Garzón', 'La Plata', 'Campoalegre', 'Palermo', 'Gigante', 'Timaná', 'Aipe', 'Rivera'] },
  { nombre: 'La Guajira', municipios: ['Riohacha', 'Maicao', 'Uribia', 'Manaure', 'Fonseca', 'Barrancas', 'San Juan del Cesar', 'El Molino', 'Albania', 'Distracción'] },
  { nombre: 'Magdalena', municipios: ['Santa Marta', 'Ciénaga', 'Fundación', 'El Banco', 'Plato', 'Aracataca', 'Pivijay', 'Zona Bananera', 'Salamina', 'El Piñón'] },
  { nombre: 'Meta', municipios: ['Villavicencio', 'Acacías', 'Granada', 'San Martín', 'Cumaral', 'Restrepo', 'Vista Hermosa', 'Puerto López', 'Puerto Gaitán', 'Castilla la Nueva'] },
  { nombre: 'Nariño', municipios: ['Pasto', 'Ipiales', 'Tumaco', 'Túquerres', 'La Unión', 'Samaniego', 'Sandoná', 'Barbacoas', 'Chachagüí', 'El Peñol'] },
  { nombre: 'Norte de Santander', municipios: ['Cúcuta', 'Ocaña', 'Pamplona', 'Villa del Rosario', 'Los Patios', 'El Zulia', 'Chinácota', 'Tibú', 'Sardinata', 'Cáchira'] },
  { nombre: 'Putumayo', municipios: ['Mocoa', 'Puerto Asís', 'Orito', 'Valle del Guamuez', 'San Miguel', 'Puerto Caicedo', 'Villagarzón', 'Puerto Leguízamo', 'Colón', 'Sibundoy'] },
  { nombre: 'Quindío', municipios: ['Armenia', 'Calarcá', 'La Tebaida', 'Montenegro', 'Quimbaya', 'Filandia', 'Salento', 'Génova', 'Buenavista', 'Circasia', 'Córdoba', 'Pijao'] },
  { nombre: 'Risaralda', municipios: ['Pereira', 'Dosquebradas', 'Santa Rosa de Cabal', 'La Virginia', 'Belén de Umbría', 'Quinchía', 'Apía', 'Santuario', 'Marsella', 'Guática', 'Mistrató'] },
  { nombre: 'San Andrés y Providencia', municipios: ['San Andrés', 'Providencia', 'Santa Catalina'] },
  { nombre: 'Santander', municipios: ['Bucaramanga', 'Floridablanca', 'Girón', 'Barrancabermeja', 'Piedecuesta', 'Lebrija', 'San Gil', 'Socorro', 'Vélez', 'Barbosa', 'Málaga', 'Charalá'] },
  { nombre: 'Sucre', municipios: ['Sincelejo', 'Corozal', 'San Marcos', 'Tolú', 'Coveñas', 'Majagual', 'Sampués', 'Ovejas', 'Morroa', 'Palmito', 'San Onofre'] },
  { nombre: 'Tolima', municipios: ['Ibagué', 'Espinal', 'Honda', 'Melgar', 'Líbano', 'Chaparral', 'Ataco', 'Purificación', 'Planadas', 'Rovira', 'Mariquita'] },
  { nombre: 'Valle del Cauca', municipios: ['Cali', 'Buenaventura', 'Palmira', 'Tuluá', 'Buga', 'Cartago', 'Yumbo', 'Jamundí', 'Candelaria', 'Florida', 'Pradera', 'El Cerrito', 'Roldanillo', 'Zarzal'] },
  { nombre: 'Vaupés', municipios: ['Mitú', 'Carurú', 'Taraira', 'Pacoa', 'Papunaua'] },
  { nombre: 'Vichada', municipios: ['Puerto Carreño', 'La Primavera', 'Cumaribo', 'Santa Rosalía'] },
];

const FUENTES_LABEL: Record<string, string> = {
  'secop ii': 'SECOP II',
  'secop i': 'SECOP I',
  'contrato privado': 'Contrato Privado',
};


// ── DROPDOWN MULTI-SELECT ──────────────────────────────────────────────────────
function DropdownMulti({
  opciones, seleccionados, onChange, placeholder, labelMap,
}: {
  opciones: string[];
  seleccionados: string[];
  onChange: (vals: string[]) => void;
  placeholder: string;
  labelMap?: Record<string, string>;
}) {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (v: string) => {
    if (seleccionados.includes(v)) onChange(seleccionados.filter((x) => x !== v));
    else onChange([...seleccionados, v]);
  };

  const displayText = seleccionados.length === 0
    ? placeholder
    : seleccionados.map((s) => labelMap?.[s] ?? s.charAt(0).toUpperCase() + s.slice(1)).join(', ');

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div onClick={() => setAbierto((p) => !p)} style={{
        ...inputStyleBase, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        cursor: 'pointer', color: seleccionados.length > 0 ? '#1e293b' : '#94a3b8',
        userSelect: 'none', paddingRight: 10,
      }}>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{displayText}</span>
        <svg width={13} height={13} fill="none" stroke="#94a3b8" strokeWidth={2} viewBox="0 0 24 24" style={{ transform: abierto ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}>
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </div>
      {abierto && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.1)', zIndex: 20, marginTop: 4, overflow: 'hidden' }}>
          {opciones.map((op) => {
            const activo = seleccionados.includes(op);
            const label = labelMap?.[op] ?? op.charAt(0).toUpperCase() + op.slice(1);
            return (
              <div key={op} onClick={() => toggle(op)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer', background: activo ? '#eff6ff' : '#fff', borderBottom: '1px solid #f3f4f6', transition: 'background .1s' }}
                onMouseEnter={(e) => { if (!activo) e.currentTarget.style.background = '#f8fafc'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = activo ? '#eff6ff' : '#fff'; }}>
                <input type="checkbox" checked={activo} onChange={() => {}} style={{ width: 15, height: 15, accentColor: '#0d2d5e', pointerEvents: 'none', flexShrink: 0 }}/>
                <span style={{ fontSize: 13, color: '#1e293b', fontWeight: activo ? 600 : 400 }}>{label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── MODAL UBICACIÓN ────────────────────────────────────────────────────────────
function UbicacionModal({
  seleccionados,
  onAplicar,
  onCerrar,
}: {
  seleccionados: string[];
  onAplicar: (vals: string[]) => void;
  onCerrar: () => void;
}) {
  const [local, setLocal] = useState<string[]>(seleccionados);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [busqueda, setBusqueda] = useState('');

  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  const deptsFiltrados = useMemo(() => {
    if (!busqueda.trim()) return COLOMBIA_DEPTS;
    const q = norm(busqueda);
    return COLOMBIA_DEPTS
      .map((d) => ({
        ...d,
        municipios: norm(d.nombre).includes(q) ? d.municipios : d.municipios.filter((m) => norm(m).includes(q)),
      }))
      .filter((d) => norm(d.nombre).includes(q) || d.municipios.length > 0);
  }, [busqueda]);

  const isDeptSel = (dept: typeof COLOMBIA_DEPTS[0]) =>
    local.includes(dept.nombre) || dept.municipios.every((m) => local.includes(m));

  const hasSomeMuni = (dept: typeof COLOMBIA_DEPTS[0]) =>
    !isDeptSel(dept) && dept.municipios.some((m) => local.includes(m));

  const isMuniSel = (dept: typeof COLOMBIA_DEPTS[0], muni: string) =>
    local.includes(muni) || local.includes(dept.nombre);

  const toggleDept = (dept: typeof COLOMBIA_DEPTS[0]) => {
    if (isDeptSel(dept)) {
      setLocal((prev) => prev.filter((x) => x !== dept.nombre && !dept.municipios.includes(x)));
    } else {
      setLocal((prev) => {
        const sin = prev.filter((x) => x !== dept.nombre && !dept.municipios.includes(x));
        return [...sin, dept.nombre];
      });
    }
  };

  const toggleMuni = (dept: typeof COLOMBIA_DEPTS[0], muni: string) => {
    if (local.includes(dept.nombre)) {
      const sinDept = local.filter((x) => x !== dept.nombre);
      setLocal([...sinDept, ...dept.municipios.filter((m) => m !== muni)]);
    } else if (local.includes(muni)) {
      setLocal((prev) => prev.filter((x) => x !== muni));
    } else {
      setLocal((prev) => [...prev, muni]);
    }
  };

  const toggleExpand = (nombre: string) => {
    setExpandidos((prev) => { const s = new Set(prev); if (s.has(nombre)) s.delete(nombre); else s.add(nombre); return s; });
  };

  const totalSel = useMemo(() => {
    let c = 0;
    for (const d of COLOMBIA_DEPTS) {
      if (local.includes(d.nombre)) { c++; continue; }
      c += d.municipios.filter((m) => local.includes(m)).length;
    }
    return c;
  }, [local]);

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1200 }} onClick={onCerrar}/>
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 560, maxWidth: '95vw', maxHeight: '85vh', background: '#fff', borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.22)', zIndex: 1201, display: 'flex', flexDirection: 'column', fontFamily: 'var(--font, system-ui)' }}>
        {/* Header */}
        <div style={{ padding: '22px 24px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#111827' }}>Selecciona ubicaciones</h2>
              <p style={{ margin: '5px 0 0', fontSize: 13, color: '#6b7280', lineHeight: 1.5 }}>
                Filtra por departamento o por municipios específicos. Puedes combinar ambos niveles.
                Para mayor control, los filtros se mantienen independientes.
              </p>
            </div>
            <button type="button" onClick={onCerrar} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#9ca3af', marginLeft: 12, flexShrink: 0 }}>
              <svg width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div style={{ borderBottom: '1px solid #e5e7eb', margin: '14px 0 0' }}/>
        </div>
        {/* Buscador */}
        <div style={{ padding: '14px 24px 6px' }}>
          <div style={{ position: 'relative' }}>
            <input type="text" placeholder="Buscar departamento o municipio..." value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)} autoFocus
              style={{ width: '100%', height: 40, border: '1.5px solid #e2e8f0', borderRadius: 8, padding: '0 36px 0 12px', fontSize: 13, color: '#1e293b', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}/>
            <svg style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} width={15} height={15} fill="none" stroke="#9ca3af" strokeWidth={2} viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          </div>
        </div>
        {/* Lista */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 24px 8px' }}>
          {deptsFiltrados.length === 0 && (
            <p style={{ padding: '20px 0', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>Sin resultados para &quot;{busqueda}&quot;</p>
          )}
          {deptsFiltrados.map((dept) => {
            const isExp = expandidos.has(dept.nombre) || busqueda.trim().length > 0;
            const sel = isDeptSel(dept);
            const parcial = hasSomeMuni(dept);
            return (
              <div key={dept.nombre} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <div style={{ display: 'flex', alignItems: 'center', padding: '9px 0', gap: 8 }}>
                  <button type="button" onClick={() => toggleExpand(dept.nombre)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#9ca3af', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                    <svg width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" style={{ transform: isExp ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}><path d="M9 18l6-6-6-6"/></svg>
                  </button>
                  <input type="checkbox" checked={sel} ref={(el) => { if (el) el.indeterminate = parcial; }} onChange={() => toggleDept(dept)} style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#0d2d5e', flexShrink: 0 }}/>
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: '#111827', cursor: 'pointer' }} onClick={() => toggleExpand(dept.nombre)}>{dept.nombre}</span>
                  <span style={{ fontSize: 11.5, color: '#9ca3af', whiteSpace: 'nowrap' }}>{dept.municipios.length} municipios</span>
                </div>
                {isExp && (
                  <div style={{ paddingLeft: 36, paddingBottom: 6 }}>
                    {dept.municipios.map((muni) => (
                      <div key={muni} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid #f9fafb', cursor: 'pointer' }} onClick={() => toggleMuni(dept, muni)}>
                        <input type="checkbox" checked={isMuniSel(dept, muni)} onChange={() => {}} style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#0d2d5e', flexShrink: 0, pointerEvents: 'none' }}/>
                        <span style={{ fontSize: 13, color: '#374151' }}>{muni}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {/* Footer */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button type="button" onClick={() => setLocal([])} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#6b7280', fontFamily: 'inherit', padding: '8px 0' }}>
            Limpiar todo
          </button>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" onClick={onCerrar} style={{ height: 40, padding: '0 20px', border: '1.5px solid #0d2d5e', borderRadius: 8, background: '#fff', fontSize: 13, fontWeight: 600, color: '#0d2d5e', cursor: 'pointer', fontFamily: 'inherit' }}>
              Cancelar
            </button>
            <button type="button" onClick={() => { onAplicar(local); onCerrar(); }} style={{ height: 40, padding: '0 20px', border: 'none', borderRadius: 8, background: '#0d2d5e', fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
              Aplicar{totalSel > 0 ? ` (${totalSel})` : ''}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
interface FiltrosPanelProps {
  abierto: boolean;
  onCerrar: () => void;
  filtros: any;
  setFiltros: (v: any) => void;
  onAplicar: (filtros?: any) => void;
  onLimpiar: () => void;
}

function ChipGroup({
  opciones, seleccionados, onChange, labelMap,
}: {
  opciones: string[];
  seleccionados: string[];
  onChange: (vals: string[]) => void;
  labelMap?: Record<string, string>;
}) {
  const toggle = (v: string) => {
    if (seleccionados.includes(v)) onChange(seleccionados.filter((x) => x !== v));
    else onChange([...seleccionados, v]);
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {opciones.map((op) => {
        const activo = seleccionados.includes(op);
        return (
          <button key={op} type="button" onClick={() => toggle(op)}
            style={{
              height: 30, padding: '0 12px', borderRadius: 999,
              border: activo ? 'none' : '1.5px solid #e2e8f0',
              background: activo ? '#0d2d5e' : 'white',
              color: activo ? 'white' : '#374151',
              fontSize: 12, fontWeight: activo ? 600 : 400,
              cursor: 'pointer', fontFamily: 'var(--font, system-ui)', transition: 'all .15s',
            }}>
            {labelMap?.[op] ?? op.charAt(0).toUpperCase() + op.slice(1)}
          </button>
        );
      })}
    </div>
  );
}

function FiltrosPanel({ abierto, onCerrar, filtros, setFiltros, onAplicar, onLimpiar }: FiltrosPanelProps) {
  const toArr = (v: unknown): string[] => {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string' && v) return v.split(',').map((x) => x.trim()).filter(Boolean);
    return [];
  };

  const [local, setLocal] = useState({
    codigo: filtros?.codigo || filtros?.codigoProceso || '',
    perfiles: toArr(filtros?.perfiles).length ? toArr(filtros?.perfiles) : filtros?.perfil ? toArr(filtros.perfil) : [],
    fuentes: toArr(filtros?.fuentes).length ? toArr(filtros?.fuentes) : filtros?.fuente ? toArr(filtros.fuente) : [],
    modalidades: toArr(filtros?.modalidades).length ? toArr(filtros?.modalidades) : filtros?.modalidad ? toArr(filtros.modalidad) : [],
    estados: toArr(filtros?.estados).length ? toArr(filtros?.estados) : filtros?.estado ? toArr(filtros.estado) : [],
    departamentos: toArr(filtros?.departamentos).length ? toArr(filtros?.departamentos) : filtros?.departamento ? toArr(filtros.departamento) : [],
    fechaDesde: filtros?.fechaDesde || '',
    fechaHasta: filtros?.fechaHasta || '',
    cuantiaDesde: filtros?.cuantiaDesde || '',
    cuantiaHasta: filtros?.cuantiaHasta || '',
  });


  useEffect(() => {
    if (abierto) {
      setLocal({
        codigo: filtros?.codigo || filtros?.codigoProceso || '',
        perfiles: toArr(filtros?.perfiles).length ? toArr(filtros?.perfiles) : filtros?.perfil ? toArr(filtros.perfil) : [],
        fuentes: toArr(filtros?.fuentes).length ? toArr(filtros?.fuentes) : filtros?.fuente ? toArr(filtros.fuente) : [],
        modalidades: toArr(filtros?.modalidades).length ? toArr(filtros?.modalidades) : filtros?.modalidad ? toArr(filtros.modalidad) : [],
        estados: toArr(filtros?.estados).length ? toArr(filtros?.estados) : filtros?.estado ? toArr(filtros.estado) : [],
        departamentos: toArr(filtros?.departamentos).length ? toArr(filtros?.departamentos) : filtros?.departamento ? toArr(filtros.departamento) : [],
        fechaDesde: filtros?.fechaDesde || '',
        fechaHasta: filtros?.fechaHasta || '',
        cuantiaDesde: filtros?.cuantiaDesde || '',
        cuantiaHasta: filtros?.cuantiaHasta || '',
      });
    }
  }, [abierto]);



  const upd = (campo: string, valor: unknown) => setLocal((prev) => ({ ...prev, [campo]: valor }));
  const [modalUbic, setModalUbic] = useState(false);

  const handleAplicar = () => {
    const departamentosSeleccionados = Array.isArray(local.departamentos) ? local.departamentos : [];
    const departamentosParam = departamentosSeleccionados.join(',');
    const perfilesParam = Array.isArray(local.perfiles) ? local.perfiles.join(',') : '';

    const nuevosFiltros = {
      ...filtros,
      codigo: local.codigo, codigoProceso: local.codigo,
      perfiles: local.perfiles, perfil: perfilesParam, entidadGrupo: perfilesParam,
      fuentes: local.fuentes, fuente: local.fuentes[0] || '', portal: local.fuentes[0] || '',
      modalidades: local.modalidades, modalidad: local.modalidades[0] || '',
      estados: local.estados, estado: local.estados[0] || '',
      departamentos: departamentosSeleccionados, departamento: departamentosParam, dpto: departamentosParam,
      fechaDesde: local.fechaDesde, fechaHasta: local.fechaHasta,
      cuantiaDesde: local.cuantiaDesde, cuantiaHasta: local.cuantiaHasta,
    };

    setFiltros(nuevosFiltros);
    onAplicar(nuevosFiltros);
    onCerrar();
  };

  const handleLimpiar = () => {
    setLocal({ codigo: '', perfiles: [], fuentes: [], modalidades: [], estados: [], departamentos: [], fechaDesde: '', fechaHasta: '', cuantiaDesde: '', cuantiaHasta: '' });
    onLimpiar();
    onCerrar();
  };

  if (!abierto) return null;

  // Cuenta filtros activos para el badge del header
  const nActivos = local.perfiles.length + local.fuentes.length + local.modalidades.length
    + local.estados.length + local.departamentos.length
    + (local.codigo ? 1 : 0) + (local.cuantiaDesde ? 1 : 0) + (local.cuantiaHasta ? 1 : 0)
    + (local.fechaDesde ? 1 : 0) + (local.fechaHasta ? 1 : 0);

  const SL: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: '0.6px', textTransform: 'uppercase' as const, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 };
  const SEP: React.CSSProperties = { borderTop: '1px solid #f1f5f9', margin: '4px 0' };
  const badge = (n: number) => n > 0
    ? <span style={{ background: '#0d2d5e', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '1px 6px', marginLeft: 4 }}>{n}</span>
    : null;

  return (
    <>
      {/* Overlay */}
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(13,45,94,0.28)', zIndex: 1000, backdropFilter: 'blur(1.5px)' }} onClick={onCerrar}/>

      {/* Panel */}
      <div style={{ position: 'fixed', top: 0, right: 0, width: 400, height: '100vh', background: '#fff', zIndex: 1001, boxShadow: '-6px 0 32px rgba(13,45,94,0.14)', display: 'flex', flexDirection: 'column', fontFamily: 'var(--font, system-ui)', animation: 'slideInPanel 0.2s cubic-bezier(.4,0,.2,1)' }}>

        {/* ── HEADER ── */}
        <div style={{ background: '#0d2d5e', padding: '0 20px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <svg width={16} height={16} fill="none" stroke="#93c5fd" strokeWidth={2.2} viewBox="0 0 24 24"><path d="M3 6h18M6 12h12M10 18h4"/></svg>
            <span style={{ color: '#fff', fontWeight: 700, fontSize: 14.5 }}>Filtros</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>

            <button type="button" onClick={onCerrar}
              style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 6, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff' }}>
              <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>

        {/* ── BODY ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 20px' }}>

          {/* Empresa */}
          <div style={{ padding: '16px 0 14px' }}>
            <label style={SL}>Empresa {badge(local.perfiles.length)}</label>
            <DropdownMulti opciones={PERFILES_OPTS} seleccionados={local.perfiles}
              onChange={(v) => { upd('perfiles', v); upd('departamentos', []); }}
              placeholder="Seleccionar empresa..."
              labelMap={{ aseocolba: 'Aseocolba', vigicolba: 'Vigicolba', tempocolba: 'Tempocolba' }}/>
          </div>
          <div style={SEP}/>

          {/* Código proceso */}
          <div style={{ padding: '14px 0' }}>
            <label style={SL}>Código proceso</label>
            <input type="text" placeholder="Ej. SECOP-2026-001..." value={local.codigo}
              onChange={(e) => upd('codigo', e.target.value)} style={inputStyleBase}/>
          </div>
          <div style={SEP}/>

          {/* Fuente */}
          <div style={{ padding: '14px 0' }}>
            <label style={SL}>Fuente / Portal {badge(local.fuentes.length)}</label>
            <DropdownMulti opciones={FUENTES_OPTS} seleccionados={local.fuentes} onChange={(v) => upd('fuentes', v)} placeholder="Seleccionar fuente..." labelMap={FUENTES_LABEL}/>
          </div>
          <div style={SEP}/>

          {/* Modalidad */}
          <div style={{ padding: '14px 0' }}>
            <label style={SL}>Modalidad {badge(local.modalidades.length)}</label>
            <DropdownMulti opciones={MODALIDADES_OPTS} seleccionados={local.modalidades} onChange={(v) => upd('modalidades', v)} placeholder="Seleccionar modalidad..."/>
          </div>
          <div style={SEP}/>

          {/* Estado */}
          <div style={{ padding: '14px 0' }}>
            <label style={SL}>Estado {badge(local.estados.length)}</label>
            <DropdownMulti opciones={ESTADOS_OPTS} seleccionados={local.estados} onChange={(v) => upd('estados', v)} placeholder="Seleccionar estado..."/>
          </div>
          <div style={SEP}/>

          {/* Cuantía — inputs planos sin tarjetas */}
          <div style={{ padding: '14px 0' }}>
            <label style={SL}>
              Cuantía (COP)
              {(local.cuantiaDesde || local.cuantiaHasta) && <span style={{ background: '#eff6ff', color: '#1e40af', fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '1px 6px' }}>activo</span>}
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <span style={{ fontSize: 10.5, color: '#94a3b8', display: 'block', marginBottom: 5 }}>Desde</span>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 12, fontWeight: 600, pointerEvents: 'none' }}>$</span>
                  <input type="number" min="0" step="1000000" placeholder="0"
                    value={local.cuantiaDesde}
                    onChange={(e) => upd('cuantiaDesde', e.target.value)}
                    style={{ ...inputStyleBase, paddingLeft: 22, margin: 0 }}/>
                </div>
              </div>
              <div>
                <span style={{ fontSize: 10.5, color: '#94a3b8', display: 'block', marginBottom: 5 }}>Hasta</span>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 12, fontWeight: 600, pointerEvents: 'none' }}>$</span>
                  <input type="number" min="0" step="1000000" placeholder="Sin límite"
                    value={local.cuantiaHasta}
                    onChange={(e) => upd('cuantiaHasta', e.target.value)}
                    style={{ ...inputStyleBase, paddingLeft: 22, margin: 0 }}/>
                </div>
              </div>
            </div>
          </div>
          <div style={SEP}/>

          {/* Ubicación */}
          <div style={{ padding: '14px 0' }}>
            <label style={SL}>Ubicación {badge(local.departamentos.length)}</label>
            {local.departamentos.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                {local.departamentos.map((d: string) => (
                  <span key={d} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 24, padding: '0 8px', borderRadius: 999, background: '#eff6ff', color: '#1e40af', fontSize: 11, fontWeight: 600 }}>
                    {d}
                    <button type="button" onClick={() => upd('departamentos', local.departamentos.filter((x: string) => x !== d))} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#6b7280', lineHeight: 1, fontSize: 13, display: 'flex', alignItems: 'center' }}>×</button>
                  </span>
                ))}
              </div>
            )}
            <div style={{ position: 'relative', marginBottom: 8 }}>
              <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} width={13} height={13} fill="none" stroke="#94a3b8" strokeWidth={2} viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              <input type="text" readOnly placeholder={local.departamentos.length > 0 ? `${local.departamentos.length} ubicación(es) seleccionada(s)` : 'Buscar departamento o municipio...'}
                onClick={() => setModalUbic(true)}
                style={{ ...inputStyleBase, paddingLeft: 30, margin: 0, cursor: 'pointer' }}/>
            </div>
            <button type="button" onClick={() => setModalUbic(true)}
              style={{ background: '#fff', border: '1.5px solid #c8102e', borderRadius: 20, padding: '5px 0', fontSize: 12, fontWeight: 600, color: '#c8102e', cursor: 'pointer', fontFamily: 'inherit', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
              <svg width={12} height={12} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              Búsqueda avanzada
            </button>
          </div>
          <div style={SEP}/>

          {/* Fecha de publicación */}
          <div style={{ padding: '14px 0 0' }}>
            <label style={SL}>Fecha de publicación</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <span style={{ fontSize: 10.5, color: '#94a3b8', display: 'block', marginBottom: 5 }}>Desde</span>
                <CalendarioPicker value={local.fechaDesde} onChange={(v)=>upd('fechaDesde',v)}/>
              </div>
              <div>
                <span style={{ fontSize: 10.5, color: '#94a3b8', display: 'block', marginBottom: 5 }}>Hasta</span>
                <CalendarioPicker value={local.fechaHasta} onChange={(v)=>upd('fechaHasta',v)}/>
              </div>
            </div>
          </div>

        </div>

        {/* ── FOOTER ── */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid #e8edf4', display: 'flex', gap: 10, flexShrink: 0, background: '#fff' }}>
          <button type="button" onClick={handleLimpiar}
            style={{ flex: 1, height: 42, border: '1.5px solid #e2e8f0', borderRadius: 8, background: '#fff', fontSize: 13, fontWeight: 600, color: '#64748b', cursor: 'pointer', fontFamily: 'inherit', transition: 'background .15s' }}>
            Restablecer
          </button>
          <button type="button" onClick={handleAplicar}
            style={{ flex: 2, height: 42, border: 'none', borderRadius: 8, background: '#0d2d5e', fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
            <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path d="M3 6h18M6 12h12M10 18h4"/></svg>
            Aplicar filtros
            {nActivos > 0 && <span style={{ background: 'rgba(255,255,255,0.2)', borderRadius: 999, padding: '1px 7px', fontSize: 11 }}>{nActivos}</span>}
          </button>
        </div>
      </div>
      {modalUbic && (
        <UbicacionModal
          seleccionados={local.departamentos}
          onAplicar={(vals) => upd('departamentos', vals)}
          onCerrar={() => setModalUbic(false)}
        />
      )}      <style>{`@keyframes slideInPanel { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>
    </>
  );
}

function ProcesoCard({
  proceso,
  onGestionar,
  esNuevo=false,
}: {
  proceso: Proceso;
  onGestionar: (p: Proceso) => void;
  esNuevo?: boolean;
}) {
  const entidad = getEntidad(proceso);
  const titulo = getTitulo(proceso);
  const objeto = getObjeto(proceso);
  const ciudad = getCiudad(proceso);
  const fuente = getFuente(proceso);
  const modalidad = getModalidad(proceso);
  const fechaCierre = getFechaCierre(proceso);
  const deadlineClass = getDeadlineClass(fechaCierre);
  const fechaLabel = formatFecha(fechaCierre);
  const portalTag = getPortalTag(fuente);

  return (
    <div className="licy-proceso-card" onClick={() => onGestionar(proceso)} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onGestionar(proceso); }}>
      {getEstado(proceso) && getEstado(proceso) !== 'Estado no disponible' && (
        <span className="licy-proceso-empresa-badge licy-proceso-empresa-aseocolba">{getEstado(proceso)}</span>
      )}
      <div className="licy-proceso-card-header">
        <div className="licy-proceso-card-logo" style={{position:'relative',overflow:'hidden'}}>
          {esNuevo&&(
            <span style={{position:'absolute',inset:0,background:'#1e5799',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:800,color:'white',letterSpacing:'0.05em',borderRadius:'inherit'}}>NEW</span>
          )}
          <span style={{visibility:esNuevo?'hidden':'visible'}}>{getSiglas(entidad)}</span>
        </div>
        <div className="licy-proceso-card-entity">
          <div className="licy-proceso-card-entity-name">{entidad}</div>
          <div className="licy-proceso-card-location">{ciudad}</div>
        </div>
      </div>
      <div className="licy-proceso-card-title">{titulo}</div>
      <div className="licy-proceso-card-desc">{objeto}</div>
      <div className="licy-proceso-card-footer">
        {fechaLabel ? (
          <div className={`licy-proceso-deadline ${deadlineClass}`}>
            <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
            {fechaLabel}
          </div>
        ) : (
          <div className="licy-proceso-deadline licy-proceso-deadline-blue" style={{ opacity: 0.4 }}>Sin fecha límite</div>
        )}
        <div className="licy-proceso-card-actions">
          <div className="licy-proceso-card-tags">
            <span className={`licy-proceso-tag ${portalTag.cls}`}>{portalTag.label}</span>
            {modalidad && modalidad !== 'Modalidad no disponible' && (
              <span className="licy-proceso-tag-modalidad">{modalidad}</span>
            )}
          </div>
          <button className="licy-proceso-gestionar-btn" title="Gestionar proceso" type="button"
            onClick={(e) => { e.stopPropagation(); onGestionar(proceso); }}>
            <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function ProcesoPaginacion({ page, totalPages, limit, total, onCambiarPagina, onCambiarLimit }: {
  page: number; totalPages: number; limit: number; total: number;
  onCambiarPagina: (p: number) => void; onCambiarLimit: (l: number) => void;
}) {
  const pages: (number | -1)[] = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const arr: (number | -1)[] = [1];
    if (page > 3) arr.push(-1);
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) arr.push(i);
    if (page < totalPages - 2) arr.push(-1);
    arr.push(totalPages);
    return arr;
  }, [page, totalPages]);

  return (
    <div className="licy-procesos-paginacion">
      <div className="licy-pag-left">
        <span>Resultados por página:</span>
        <select className="licy-pag-select" value={limit} onChange={(e) => onCambiarLimit(Number(e.target.value))}>
          {[6, 12, 24, 30, 50].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {total > 0 && (
          <span style={{ marginLeft: 10, opacity: 0.7 }}>
            {(page - 1) * limit + 1}–{Math.min(page * limit, total)} de {total.toLocaleString('es-CO')}
          </span>
        )}
      </div>
      <div className="licy-pag-right">
        <button className="licy-pag-btn licy-pag-btn-nav" disabled={page <= 1} onClick={() => onCambiarPagina(page - 1)} type="button">
          <svg fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
          Anterior
        </button>
        {pages.map((n, i) =>
          n === -1 ? (
            <span key={`el-${i}`} className="licy-pag-btn licy-pag-btn-dots">…</span>
          ) : (
            <button key={n} type="button" className={`licy-pag-btn${n === page ? ' licy-pag-btn-active' : ''}`} onClick={() => n !== page && onCambiarPagina(n)}>{n}</button>
          )
        )}
        <button className="licy-pag-btn licy-pag-btn-nav" disabled={page >= totalPages} onClick={() => onCambiarPagina(page + 1)} type="button">
          Siguiente
          <svg fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </button>
      </div>
    </div>
  );
}

export default function ProcesosCardsView({
  procesos = [], loading = false, error = null, page = 1, limit = 12,
  total = 0, totalPages = 1, filtros, setFiltros, onBuscar,
  onCambiarPagina, onCambiarLimit, onGestionarProceso, esNuevo,
}: ProcesosCardsViewProps) {
  const [busquedaLocal, setBusquedaLocal] = useState(filtros?.q || filtros?.busqueda || '');
  const [ciudadLocal, setCiudadLocal] = useState(filtros?.ciudad || filtros?.departamento || '');
  const [panelAbierto, setPanelAbierto] = useState(false);

  const handleBuscar = () => {
    setFiltros?.({ ...filtros, q: busquedaLocal, busqueda: busquedaLocal, ciudad: ciudadLocal, departamento: ciudadLocal, dpto: ciudadLocal });
    setTimeout(() => { onBuscar?.(); }, 50);
  };

  const handleFiltroChange = (campo: string, valor: string) => {
    setFiltros?.({ ...filtros, [campo]: valor });
  };

  const filtrosActivos = useMemo(() => {
    if (!filtros) return 0;
    const campos = ['codigo','codigoProceso','perfil','entidadGrupo','fuente','portal','modalidad','estado','departamento','dpto','fechaDesde','fechaHasta','cuantiaDesde','cuantiaHasta'];
    return campos.filter((c) => filtros[c] && filtros[c] !== '' && filtros[c] !== 'all').length;
  }, [filtros]);

  const handleLimpiarFiltrosAvanzados = () => {
    const filtrosLimpios = {
      ...filtros,
      codigo: '', codigoProceso: '',
      perfiles: [], perfil: '', entidadGrupo: '',
      fuentes: [], fuente: '', portal: '',
      modalidades: [], modalidad: '',
      estados: [], estado: '',
      departamentos: [], departamento: '', dpto: '',
      fechaDesde: '', fechaHasta: '', cuantiaDesde: '', cuantiaHasta: '', entidad: 'all',
    };
    setFiltros?.(filtrosLimpios);
    setBusquedaLocal('');
    setCiudadLocal('');
    setTimeout(() => { onBuscar?.(); }, 50);
  };

  return (
    <div className="licy-procesos-view">
      {setFiltros && (
        <FiltrosPanel
          abierto={panelAbierto}
          onCerrar={() => setPanelAbierto(false)}
          filtros={filtros}
          setFiltros={setFiltros}
          onAplicar={(nuevosFiltros) => { setTimeout(() => { onBuscar?.(nuevosFiltros); }, 50); }}
          onLimpiar={handleLimpiarFiltrosAvanzados}
        />
      )}

      {setFiltros && (
        <button type="button" onClick={() => setPanelAbierto(true)} title="Filtros avanzados"
          style={{ position: 'fixed', right: 0, top: '50%', transform: 'translateY(-50%)', width: 36, height: 44, background: '#c8102e', border: 'none', borderRadius: '8px 0 0 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', zIndex: 500, boxShadow: '-3px 0 12px rgba(107,33,168,0.35)', transition: 'background .15s, width .15s' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#a50d24'; e.currentTarget.style.width = '42px'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = '#c8102e'; e.currentTarget.style.width = '36px'; }}>
          <svg width={16} height={16} fill="currentColor" viewBox="0 0 24 24">
            <path d="M3 4.5A1.5 1.5 0 014.5 3h15A1.5 1.5 0 0121 4.5v1.88a3 3 0 01-.879 2.121L15 13.622V19.5a1.5 1.5 0 01-2.276 1.285l-3-1.8A1.5 1.5 0 019 17.7v-4.078L3.879 8.501A3 3 0 013 6.38V4.5z"/>
          </svg>
          {filtrosActivos > 0 && (
            <span style={{ position: 'absolute', top: -6, right: -6, minWidth: 18, height: 18, background: '#c8102e', color: '#fff', borderRadius: 9, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', border: '2px solid #fff', lineHeight: 1 }}>
              {filtrosActivos}
            </span>
          )}
        </button>
      )}

      <div className="licy-procesos-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="licy-procesos-title">Procesos públicos</h1>
          <p className="licy-procesos-subtitle">Gestiona propuestas y trabaja con las mejores entidades del país.</p>
        </div>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      <div className="licy-procesos-search-bar">
        <div className="licy-procesos-search-inputs">
          <div className="licy-procesos-search-wrap">
            <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            <input type="text" placeholder="Nombre del proceso, entidad u objeto…" value={busquedaLocal}
              onChange={(e) => setBusquedaLocal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleBuscar(); }}/>
          </div>
          <div className="licy-procesos-search-wrap">
            <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
            <input type="text" placeholder="Departamento o ciudad…" value={ciudadLocal}
              onChange={(e) => setCiudadLocal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleBuscar(); }}/>
          </div>
          <button className="licy-procesos-search-btn" type="button" onClick={handleBuscar}>Buscar proceso</button>
        </div>

        <div className="licy-procesos-filters">
          <select className="licy-procesos-filter-select" value={filtros?.orderBy || ''} onChange={(e) => handleFiltroChange('orderBy', e.target.value)}>
            <option value="">Fecha ↕</option>
            <option value="asc">Más antiguos</option>
            <option value="desc">Más recientes</option>
          </select>
          <select className="licy-procesos-filter-select" value={filtros?.portal || filtros?.fuente || ''} onChange={(e) => handleFiltroChange('portal', e.target.value)}>
            <option value="">Portal</option>
            <option value="SECOP II">SECOP II</option>
            <option value="SECOP I">SECOP I</option>
            <option value="Contrato Privado">Contrato Privado</option>
          </select>
          <select className="licy-procesos-filter-select" value={filtros?.modalidad || ''} onChange={(e) => handleFiltroChange('modalidad', e.target.value)}>
            <option value="">Modalidad</option>
            <option value="Licitación pública">Licitación pública</option>
            <option value="Mínima cuantía">Mínima cuantía</option>
            <option value="Selección abreviada">Selección abreviada</option>
            <option value="Contratación directa">Contratación directa</option>
            <option value="Concurso de méritos">Concurso de méritos</option>
          </select>
          <select className="licy-procesos-filter-select" value={filtros?.perfil || filtros?.entidadGrupo || ''} onChange={(e) => handleFiltroChange('perfil', e.target.value)}>
            <option value="">Perfil</option>
            <option value="aseocolba">Aseocolba</option>
            <option value="vigicolba">Vigicolba</option>
            <option value="tempocolba">Tempocolba</option>
          </select>
          <select className="licy-procesos-filter-select" value={filtros?.estado || ''} onChange={(e) => handleFiltroChange('estado', e.target.value)}>
            <option value="">Estado</option>
            <option value="Abierto">Abierto</option>
            <option value="En evaluación">En evaluación</option>
            <option value="Cerrado">Cerrado</option>
            <option value="Adjudicado">Adjudicado</option>
          </select>
          {filtros && (Object.values(filtros).some((v) => v !== '' && v != null) || busquedaLocal || ciudadLocal) && (
            <button type="button" className="licy-procesos-filter-clear"
              onClick={() => { handleLimpiarFiltrosAvanzados(); setBusquedaLocal(''); setCiudadLocal(''); }}>
              Limpiar
            </button>
          )}
        </div>

        {filtrosActivos > 0 && (
          <div className="licy-filtros-badges-row">
            {filtros?.codigo && (
              <span className="licy-filtro-badge-chip">
                Código: {filtros.codigo}
                <button type="button" onClick={() => setFiltros?.({ ...filtros, codigo: '', codigoProceso: '' })}>×</button>
              </span>
            )}
            {filtros?.perfil && filtros.perfil !== 'all' && (
              <span className="licy-filtro-badge-chip">
                Perfil: {filtros.perfil}
                <button type="button" onClick={() => setFiltros?.({ ...filtros, perfiles: [], perfil: '', entidadGrupo: '', departamentos: [], departamento: '', dpto: '' })}>×</button>
              </span>
            )}
            {filtros?.fuente && filtros.fuente !== 'all' && (
              <span className="licy-filtro-badge-chip">
                Fuente: {filtros.fuente}
                <button type="button" onClick={() => setFiltros?.({ ...filtros, fuente: '', portal: '', fuentes: [] })}>×</button>
              </span>
            )}
            {filtros?.modalidad && (
              <span className="licy-filtro-badge-chip">
                Modalidad: {filtros.modalidad}
                <button type="button" onClick={() => setFiltros?.({ ...filtros, modalidad: '', modalidades: [] })}>×</button>
              </span>
            )}
            {filtros?.estado && (
              <span className="licy-filtro-badge-chip">
                Estado: {filtros.estado}
                <button type="button" onClick={() => setFiltros?.({ ...filtros, estado: '', estados: [] })}>×</button>
              </span>
            )}
            {Array.isArray(filtros?.departamentos) && filtros.departamentos.length > 0 ? (
              filtros.departamentos.map((dep: string) => (
                <span key={dep} className="licy-filtro-badge-chip">
                  Dpto: {dep}
                  <button type="button" onClick={() => {
                    const nuevos = filtros.departamentos.filter((x: string) => x !== dep);
                    setFiltros?.({ ...filtros, departamentos: nuevos, departamento: nuevos.join(','), dpto: nuevos.join(',') });
                  }}>×</button>
                </span>
              ))
            ) : (filtros?.departamento || filtros?.dpto) && (
              <span className="licy-filtro-badge-chip">
                Dpto: {filtros.departamento || filtros.dpto}
                <button type="button" onClick={() => setFiltros?.({ ...filtros, departamentos: [], departamento: '', dpto: '' })}>×</button>
              </span>
            )}
            {filtros?.fechaDesde && (
              <span className="licy-filtro-badge-chip">
                Desde: {filtros.fechaDesde}
                <button type="button" onClick={() => setFiltros?.({ ...filtros, fechaDesde: '' })}>×</button>
              </span>
            )}
            {filtros?.fechaHasta && (
              <span className="licy-filtro-badge-chip">
                Hasta: {filtros.fechaHasta}
                <button type="button" onClick={() => setFiltros?.({ ...filtros, fechaHasta: '' })}>×</button>
              </span>
            )}
            {filtros?.cuantiaDesde && (
              <span className="licy-filtro-badge-chip">
                Cuantía desde: ${Number(filtros.cuantiaDesde).toLocaleString('es-CO')}
                <button type="button" onClick={() => setFiltros?.({ ...filtros, cuantiaDesde: '' })}>×</button>
              </span>
            )}
            {filtros?.cuantiaHasta && (
              <span className="licy-filtro-badge-chip">
                Cuantía hasta: ${Number(filtros.cuantiaHasta).toLocaleString('es-CO')}
                <button type="button" onClick={() => setFiltros?.({ ...filtros, cuantiaHasta: '' })}>×</button>
              </span>
            )}
          </div>
        )}
      </div>

      {error && <div className="licy-procesos-error">⚠️ {error}</div>}

      {loading && !error && (
        <div className="licy-procesos-loading">
          <svg className="licy-spin" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M4 4v5h5M20 20v-5h-5"/><path d="M4.055 9A8 8 0 0120 15.944M19.945 15A8 8 0 014 8.056"/></svg>
          Cargando procesos…
        </div>
      )}

      {!loading && !error && procesos.length > 0 && (
        <div className="licy-procesos-grid">
          {procesos.map((proceso, idx) => (
            <ProcesoCard
              key={proceso.id ?? proceso.codigoProceso ?? idx}
              proceso={proceso}
              onGestionar={(p) => onGestionarProceso?.(p)}
              esNuevo={esNuevo?.(proceso)??false}
            />
          ))}
        </div>
      )}

      {!loading && !error && procesos.length === 0 && (
        <div className="licy-procesos-empty">
          <p>No hay procesos para mostrar.</p>
          <span>Ajusta los filtros o intenta una búsqueda diferente.</span>
        </div>
      )}

      {!loading && (totalPages ?? 1) > 0 && (
        <ProcesoPaginacion page={page} totalPages={totalPages ?? 1} limit={limit} total={total}
          onCambiarPagina={onCambiarPagina ?? (() => {})} onCambiarLimit={onCambiarLimit ?? (() => {})}/>
      )}
    </div>
  );
}