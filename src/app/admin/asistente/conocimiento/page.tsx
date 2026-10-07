'use client';
import { useState, useEffect, useCallback } from 'react';

type Item = {
  id: number;
  empresa: string | null;
  modulo: string | null;
  titulo: string;
  contenido: string;
  tipo: string | null;
  activo: boolean;
  creadoEn: string;
  actualizadoEn: string;
  embeddingModel: string | null;
  embeddingAt: string | null;
  tieneEmbedding: boolean;
};

const EMPRESAS = ['', 'ASEOCOLBA', 'TEMPOCOLBA', 'VIGICOLBA', 'GRUPO_COLBA'];
const TIPOS    = ['', 'empresa', 'servicios', 'certificaciones', 'sgsst', 'licitaciones', 'plataforma', 'procesos', 'solicitudes', 'trm', 'documentos', 'normativa', 'otro'];
const F        = "'Inter', 'Segoe UI', sans-serif";

const colores: Record<string, string> = {
  ASEOCOLBA:  '#0d2d5e',
  TEMPOCOLBA: '#06b6d4',
  VIGICOLBA:  '#dc2626',
  GRUPO_COLBA:'#374151',
};

function Badge({ empresa }: { empresa: string | null }) {
  const bg = empresa ? (colores[empresa] ?? '#6b7280') : '#94a3b8';
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: bg, color: '#fff', fontFamily: F, whiteSpace: 'nowrap' as const }}>
      {empresa ?? 'GLOBAL'}
    </span>
  );
}

function EmbBadge({ item, onRegen }: { item: Item; onRegen: (id: number) => void }) {
  if (item.tieneEmbedding) {
    const fecha = item.embeddingAt ? new Date(item.embeddingAt).toLocaleDateString('es-CO') : '—';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 10, color: '#059669', fontWeight: 600 }}>✓ pgvector</span>
        <span style={{ fontSize: 10, color: '#94a3b8' }}>{fecha}</span>
      </div>
    );
  }
  return (
    <button
      onClick={() => onRegen(item.id)}
      style={{ fontSize: 10, fontWeight: 600, color: '#f59e0b', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 4, padding: '2px 7px', cursor: 'pointer', fontFamily: F }}
    >
      ⚠ Sin embedding
    </button>
  );
}

const VACIO: Omit<Item, 'id' | 'creadoEn' | 'actualizadoEn' | 'embeddingModel' | 'embeddingAt' | 'tieneEmbedding'> = {
  empresa: null, modulo: null, titulo: '', contenido: '', tipo: null, activo: true,
};

export default function ConocimientoAdmin() {
  const [items, setItems]         = useState<Item[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [form, setForm]           = useState({ ...VACIO });
  const [editId, setEditId]       = useState<number | null>(null);
  const [saving, setSaving]       = useState(false);
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenStatus, setRegenStatus]   = useState('');
  const [buscar, setBuscar]             = useState('');
  const [filtroEmpresa, setFiltroEmpresa]     = useState('');
  const [filtroTipo, setFiltroTipo]           = useState('');
  const [mostrarInactivos, setMostrarInactivos] = useState(false);
  const [confirmDelete, setConfirmDelete]       = useState<number | null>(null);
  const [panelAbierto, setPanelAbierto]         = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams();
      if (filtroEmpresa) params.set('empresa', filtroEmpresa);
      if (filtroTipo)    params.set('tipo', filtroTipo);
      if (mostrarInactivos) params.set('activos', 'false');
      const res = await fetch(`/api/admin/conocimiento?${params}`);
      if (res.status === 401) { setError('Sesión no válida. Inicia sesión en LICYCOLBA primero.'); return; }
      if (res.status === 403) { setError('Solo administradores pueden acceder a este módulo.'); return; }
      const data = await res.json();
      setItems(data.items ?? []);
    } catch { setError('Error de conexión.'); }
    finally { setLoading(false); }
  }, [filtroEmpresa, filtroTipo, mostrarInactivos]);

  useEffect(() => { cargar(); }, [cargar]);

  const abrirNuevo  = () => { setEditId(null); setForm({ ...VACIO }); setPanelAbierto(true); };
  const abrirEditar = (item: Item) => {
    setEditId(item.id);
    setForm({ empresa: item.empresa, modulo: item.modulo, titulo: item.titulo, contenido: item.contenido, tipo: item.tipo, activo: item.activo });
    setPanelAbierto(true);
  };
  const cerrarPanel = () => { setPanelAbierto(false); setEditId(null); setForm({ ...VACIO }); };

  const guardar = async () => {
    if (!form.titulo.trim() || !form.contenido.trim()) return;
    setSaving(true);
    try {
      const url    = editId ? `/api/admin/conocimiento/${editId}` : '/api/admin/conocimiento';
      const method = editId ? 'PUT' : 'POST';
      const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!res.ok) { const d = await res.json(); alert(d.error ?? 'Error al guardar'); return; }
      cerrarPanel();
      await cargar();
    } finally { setSaving(false); }
  };

  const toggleActivo = async (item: Item) => {
    await fetch(`/api/admin/conocimiento/${item.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activo: !item.activo }),
    });
    await cargar();
  };

  const regenerarUno = async (id: number) => {
    await fetch(`/api/admin/conocimiento/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _regenerarEmbedding: true }),
    });
    setTimeout(cargar, 2500); // dar tiempo al background task
  };

  const regenerarTodos = async (soloVacios: boolean) => {
    setRegenLoading(true);
    setRegenStatus('Generando embeddings…');
    try {
      const res = await fetch(`/api/admin/conocimiento?accion=regenerar-todos&soloVacios=${soloVacios}`);
      const d   = await res.json();
      setRegenStatus(`✓ ${d.ok} OK · ${d.error} errores`);
      await cargar();
    } catch { setRegenStatus('Error al regenerar'); }
    finally { setRegenLoading(false); }
  };

  const eliminar = async (id: number) => {
    await fetch(`/api/admin/conocimiento/${id}`, { method: 'DELETE' });
    setConfirmDelete(null);
    await cargar();
  };

  const filtrados = items.filter(i => {
    if (!mostrarInactivos && !i.activo) return false;
    if (buscar.trim()) {
      const q = buscar.toLowerCase();
      if (!i.titulo.toLowerCase().includes(q) && !i.contenido.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const sinEmbedding = items.filter(i => !i.tieneEmbedding && i.activo).length;

  const s = {
    page:    { minHeight: '100vh', background: '#f8fafc', fontFamily: F, padding: '0 0 60px' },
    header:  { background: '#0d2d5e', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' as const, gap: 12 },
    title:   { color: '#fff', fontSize: 18, fontWeight: 700, margin: 0 },
    sub:     { color: '#93c5fd', fontSize: 12, margin: 0 },
    body:    { maxWidth: 1300, margin: '0 auto', padding: '24px 24px 0' },
    card:    { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '16px 20px', marginBottom: 16 },
    row:     { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' as const },
    input:   { fontFamily: F, fontSize: 13, border: '1px solid #e2e8f0', borderRadius: 6, padding: '7px 12px', outline: 'none', background: '#f8fafc' },
    select:  { fontFamily: F, fontSize: 13, border: '1px solid #e2e8f0', borderRadius: 6, padding: '7px 10px', background: '#f8fafc' },
    btn:     (bg: string, color = '#fff') => ({ fontFamily: F, fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 7, padding: '8px 18px', background: bg, color, cursor: 'pointer' }),
    table:   { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
    th:      { padding: '10px 12px', textAlign: 'left' as const, fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '0.04em', borderBottom: '2px solid #e2e8f0' },
    td:      { padding: '11px 12px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' as const },
    overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 200, display: 'flex', justifyContent: 'flex-end' },
    panel:   { width: 520, maxWidth: '95vw', background: '#fff', height: '100vh', overflowY: 'auto' as const, padding: 28, boxShadow: '-4px 0 24px rgba(0,0,0,.1)' },
    label:   { fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase' as const, letterSpacing: '0.04em', display: 'block', marginBottom: 4 },
    textarea:{ fontFamily: F, fontSize: 13, border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 12px', width: '100%', resize: 'vertical' as const, minHeight: 150, outline: 'none' },
  };

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <p style={s.title}>Base de Conocimiento — Asistente Colba</p>
          <p style={s.sub}>RAG semántico · pgvector · gemini-embedding-001 (3072 dims)</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' as const }}>
          {sinEmbedding > 0 && (
            <span style={{ fontSize: 12, background: '#fef3c7', color: '#92400e', padding: '4px 10px', borderRadius: 6, fontWeight: 600 }}>
              ⚠ {sinEmbedding} sin embedding
            </span>
          )}
          <button
            style={{ ...s.btn('#1e40af'), fontSize: 12, padding: '7px 14px', opacity: regenLoading ? 0.7 : 1 }}
            disabled={regenLoading}
            onClick={() => regenerarTodos(true)}
            title="Solo genera embeddings para fragmentos que aún no tienen"
          >
            {regenLoading ? '⏳ Generando…' : '⚡ Generar faltantes'}
          </button>
          <button
            style={{ ...s.btn('#374151'), fontSize: 12, padding: '7px 14px', opacity: regenLoading ? 0.7 : 1 }}
            disabled={regenLoading}
            onClick={() => regenerarTodos(false)}
            title="Regenera todos los embeddings (incluye los que ya existen)"
          >
            🔄 Regenerar todos
          </button>
          <button style={s.btn('#06b6d4')} onClick={abrirNuevo}>+ Nuevo fragmento</button>
        </div>
      </div>

      <div style={s.body}>
        {regenStatus && (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 16px', fontSize: 13, color: '#166534', marginBottom: 12 }}>
            {regenStatus} · <button onClick={() => setRegenStatus('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 12 }}>✕</button>
          </div>
        )}
        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 16px', color: '#b91c1c', fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {/* Filtros */}
        <div style={{ ...s.card, ...s.row }}>
          <input style={{ ...s.input, flex: 1, minWidth: 200 }} placeholder="Buscar en títulos y contenido…" value={buscar} onChange={e => setBuscar(e.target.value)} />
          <select style={s.select} value={filtroEmpresa} onChange={e => setFiltroEmpresa(e.target.value)}>
            <option value="">Todas las empresas</option>
            {EMPRESAS.filter(Boolean).map(e => <option key={e} value={e}>{e}</option>)}
          </select>
          <select style={s.select} value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}>
            <option value="">Todos los tipos</option>
            {TIPOS.filter(Boolean).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <label style={{ fontSize: 13, color: '#374151', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={mostrarInactivos} onChange={e => setMostrarInactivos(e.target.checked)} />
            Mostrar inactivos
          </label>
          <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 'auto' }}>{filtrados.length} registro{filtrados.length !== 1 ? 's' : ''}</span>
        </div>

        {/* Tabla */}
        <div style={s.card}>
          {loading ? (
            <p style={{ textAlign: 'center', color: '#94a3b8', padding: 40 }}>Cargando…</p>
          ) : filtrados.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#94a3b8', padding: 40 }}>
              {items.length === 0 ? 'No hay fragmentos cargados aún. Haz clic en "+ Nuevo fragmento" para comenzar.' : 'Sin resultados.'}
            </p>
          ) : (
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Empresa</th>
                  <th style={s.th}>Tipo · Módulo</th>
                  <th style={s.th}>Título</th>
                  <th style={s.th}>Contenido</th>
                  <th style={s.th}>Embedding</th>
                  <th style={s.th}>Estado</th>
                  <th style={s.th}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map(item => (
                  <tr key={item.id} style={{ opacity: item.activo ? 1 : 0.5 }}>
                    <td style={s.td}><Badge empresa={item.empresa} /></td>
                    <td style={s.td}>
                      {item.tipo && <span style={{ fontSize: 11, color: '#64748b', background: '#f1f5f9', padding: '2px 7px', borderRadius: 4 }}>{item.tipo}</span>}
                      {item.modulo && <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{item.modulo}</div>}
                    </td>
                    <td style={{ ...s.td, fontWeight: 600, color: '#1e293b', maxWidth: 200 }}>{item.titulo}</td>
                    <td style={{ ...s.td, color: '#475569', maxWidth: 260 }}>
                      <span title={item.contenido}>{item.contenido.slice(0, 90)}{item.contenido.length > 90 ? '…' : ''}</span>
                    </td>
                    <td style={s.td}><EmbBadge item={item} onRegen={regenerarUno} /></td>
                    <td style={s.td}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: item.activo ? '#059669' : '#94a3b8' }}>
                        {item.activo ? '✓ Activo' : '✗ Inactivo'}
                      </span>
                    </td>
                    <td style={{ ...s.td, whiteSpace: 'nowrap' as const }}>
                      <button onClick={() => abrirEditar(item)} style={{ ...s.btn('#e0f2fe', '#0369a1'), fontSize: 11, padding: '4px 10px', marginRight: 4 }}>Editar</button>
                      <button onClick={() => toggleActivo(item)} style={{ ...s.btn(item.activo ? '#fef3c7' : '#f0fdf4', item.activo ? '#92400e' : '#166534'), fontSize: 11, padding: '4px 10px', marginRight: 4 }}>
                        {item.activo ? 'Desactivar' : 'Activar'}
                      </button>
                      {confirmDelete === item.id ? (
                        <>
                          <button onClick={() => eliminar(item.id)} style={{ ...s.btn('#dc2626'), fontSize: 11, padding: '4px 10px', marginRight: 4 }}>Confirmar</button>
                          <button onClick={() => setConfirmDelete(null)} style={{ ...s.btn('#f1f5f9', '#374151'), fontSize: 11, padding: '4px 10px' }}>Cancelar</button>
                        </>
                      ) : (
                        <button onClick={() => setConfirmDelete(item.id)} style={{ ...s.btn('#fee2e2', '#dc2626'), fontSize: 11, padding: '4px 10px' }}>Eliminar</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Panel lateral */}
      {panelAbierto && (
        <div style={s.overlay} onClick={cerrarPanel}>
          <div style={s.panel} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0d2d5e', fontFamily: F }}>
                {editId ? 'Editar fragmento' : 'Nuevo fragmento'}
              </h2>
              <button onClick={cerrarPanel} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#94a3b8' }}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={s.label}>Empresa</label>
                <select style={{ ...s.select, width: '100%' }} value={form.empresa ?? ''} onChange={e => setForm(f => ({ ...f, empresa: e.target.value || null }))}>
                  {EMPRESAS.map(e => <option key={e} value={e}>{e || '— Global (aplica a todas) —'}</option>)}
                </select>
              </div>
              <div>
                <label style={s.label}>Tipo de información</label>
                <select style={{ ...s.select, width: '100%' }} value={form.tipo ?? ''} onChange={e => setForm(f => ({ ...f, tipo: e.target.value || null }))}>
                  {TIPOS.map(t => <option key={t} value={t}>{t || '— Sin categoría —'}</option>)}
                </select>
              </div>
              <div>
                <label style={s.label}>Módulo (opcional)</label>
                <input style={{ ...s.input, width: '100%' }} placeholder="Ej: TRM, Solicitudes, Procesos…" value={form.modulo ?? ''} onChange={e => setForm(f => ({ ...f, modulo: e.target.value || null }))} />
              </div>
              <div>
                <label style={s.label}>Título <span style={{ color: '#dc2626' }}>*</span></label>
                <input style={{ ...s.input, width: '100%' }} placeholder="Título descriptivo" value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} />
              </div>
              <div>
                <label style={s.label}>Contenido <span style={{ color: '#dc2626' }}>*</span></label>
                <textarea style={s.textarea} placeholder="Describe el conocimiento…" value={form.contenido} onChange={e => setForm(f => ({ ...f, contenido: e.target.value }))} />
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                  {form.contenido.length} chars · máx. 600 enviados a Gemini por fragmento
                  {editId ? ' · el embedding se regenera automáticamente al guardar' : ' · el embedding se genera automáticamente al crear'}
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151', cursor: 'pointer', fontFamily: F }}>
                <input type="checkbox" checked={form.activo} onChange={e => setForm(f => ({ ...f, activo: e.target.checked }))} />
                Fragmento activo (visible para el asistente)
              </label>
              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                <button
                  style={{ ...s.btn(!form.titulo.trim() || !form.contenido.trim() ? '#e2e8f0' : '#0d2d5e'), flex: 1, opacity: saving ? 0.7 : 1 }}
                  disabled={saving || !form.titulo.trim() || !form.contenido.trim()}
                  onClick={guardar}
                >
                  {saving ? 'Guardando…' : editId ? 'Actualizar' : 'Guardar'}
                </button>
                <button style={s.btn('#f1f5f9', '#374151')} onClick={cerrarPanel}>Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}