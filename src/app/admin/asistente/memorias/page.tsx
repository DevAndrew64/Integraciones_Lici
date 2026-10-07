'use client';
import { useState, useEffect, useCallback } from 'react';

type Memory = {
  id: number;
  key: string;
  scope: string;
  empresa: string | null;
  title: string;
  content: string;
  priority: number;
  isActive: boolean;
  source: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

const F = "'Inter', 'Segoe UI', sans-serif";
const SCOPES = ['GLOBAL', 'EMPRESA'];
const SOURCES = ['manual', 'correccion', 'seed', 'auto'];
const EMPRESAS = ['ASEOCOLBA', 'VIGICOLBA', 'TEMPOCOLBA', 'TRANSCOLBA'];

const sourceColors: Record<string, { bg: string; text: string; label: string }> = {
  correccion: { bg: '#fef2f2', text: '#dc2626', label: '⚠ Corrección' },
  manual:     { bg: '#eff6ff', text: '#1d4ed8', label: '📌 Manual' },
  seed:       { bg: '#f0fdf4', text: '#059669', label: '🌱 Seed' },
  auto:       { bg: '#fafaf9', text: '#78716c', label: '🤖 Auto' },
};

function SourceBadge({ source }: { source: string }) {
  const c = sourceColors[source] ?? { bg: '#f3f4f6', text: '#374151', label: source };
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: c.bg, color: c.text, fontFamily: F, whiteSpace: 'nowrap' as const, border: `1px solid ${c.text}33` }}>
      {c.label}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: number }) {
  const bg = priority >= 90 ? '#dc2626' : priority >= 70 ? '#f59e0b' : priority >= 50 ? '#3b82f6' : '#94a3b8';
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: bg, color: '#fff', fontFamily: F }}>
      P{priority}
    </span>
  );
}

const VACIO = {
  key: '', scope: 'GLOBAL', empresa: null as string | null,
  title: '', content: '', priority: 50, source: 'manual', isActive: true,
};

export default function AdminMemoriasPage() {
  const [list, setList] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterActive, setFilterActive] = useState<'all' | 'true' | 'false'>('all');
  const [filterSource, setFilterSource] = useState('');
  const [filterScope, setFilterScope] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Memory | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(VACIO);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ active: 'false' });
    if (filterSource) params.set('source', filterSource);
    if (filterScope) params.set('scope', filterScope);
    const res = await fetch(`/api/admin/memories?${params}`);
    const data = await res.json();
    setList(data.memories ?? []);
    setLoading(false);
  }, [filterSource, filterScope]);

  useEffect(() => { load(); }, [load]);

  const filtered = list.filter(m => {
    if (filterActive === 'true' && !m.isActive) return false;
    if (filterActive === 'false' && m.isActive) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!m.title.toLowerCase().includes(q) && !m.key.toLowerCase().includes(q) && !m.content.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  async function saveNew() {
    if (!form.key || !form.title || !form.content) { setMsg('key, título y contenido son requeridos.'); return; }
    setSaving(true);
    const res = await fetch('/api/admin/memories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    const data = await res.json();
    setSaving(false);
    if (!data.ok) { setMsg(data.error ?? 'Error al crear.'); return; }
    setCreating(false);
    setForm(VACIO);
    setMsg('Memoria creada.');
    load();
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    const res = await fetch(`/api/admin/memories/${editing.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: form.title, content: form.content, priority: form.priority, isActive: form.isActive, scope: form.scope, empresa: form.empresa, source: form.source }),
    });
    const data = await res.json();
    setSaving(false);
    if (!data.ok) { setMsg(data.error ?? 'Error al guardar.'); return; }
    setEditing(null);
    setMsg('Guardado.');
    load();
  }

  async function toggleActive(m: Memory) {
    await fetch(`/api/admin/memories/${m.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !m.isActive }) });
    load();
  }

  async function deleteMemory(m: Memory) {
    if (!confirm(`¿Eliminar "${m.title}"? Esta acción no se puede deshacer.`)) return;
    await fetch(`/api/admin/memories/${m.id}`, { method: 'DELETE' });
    setMsg('Eliminada.');
    load();
  }

  function openEdit(m: Memory) {
    setEditing(m);
    setForm({ key: m.key, scope: m.scope, empresa: m.empresa, title: m.title, content: m.content, priority: m.priority, source: m.source, isActive: m.isActive });
    setCreating(false);
  }

  function openCreate() {
    setCreating(true);
    setEditing(null);
    setForm(VACIO);
  }

  const isOpen = editing !== null || creating;

  return (
    <div style={{ fontFamily: F, maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#0d2d5e' }}>Memorias del Asistente</h1>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b' }}>Gestión de memoria persistente para el Asistente Colba</p>
        </div>
        <button onClick={openCreate} style={{ marginLeft: 'auto', background: '#0d2d5e', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontFamily: F, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
          + Nueva memoria
        </button>
      </div>

      {msg && (
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '8px 14px', marginBottom: 14, fontSize: 13, color: '#1d4ed8', display: 'flex', justifyContent: 'space-between' }}>
          {msg}
          <button onClick={() => setMsg('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>✕</button>
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <input
          placeholder="Buscar..."
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 200, border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 12px', fontSize: 13, fontFamily: F }}
        />
        <select value={filterActive} onChange={e => setFilterActive(e.target.value as 'all' | 'true' | 'false')}
          style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 12px', fontSize: 13, fontFamily: F, background: '#fff' }}>
          <option value="all">Todas</option>
          <option value="true">Activas</option>
          <option value="false">Inactivas</option>
        </select>
        <select value={filterScope} onChange={e => setFilterScope(e.target.value)}
          style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 12px', fontSize: 13, fontFamily: F, background: '#fff' }}>
          <option value="">Todos los scopes</option>
          {SCOPES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterSource} onChange={e => setFilterSource(e.target.value)}
          style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 12px', fontSize: 13, fontFamily: F, background: '#fff' }}>
          <option value="">Todas las fuentes</option>
          {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Modal edición/creación */}
      {isOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 28, width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h2 style={{ margin: '0 0 20px', fontSize: 17, fontWeight: 700, color: '#0d2d5e' }}>
              {creating ? 'Nueva memoria' : `Editar — ${editing?.key}`}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {creating && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>KEY (slug único)</label>
                  <input value={form.key} onChange={e => setForm(f => ({ ...f, key: e.target.value }))}
                    placeholder="ej: aseocolba-identidad"
                    style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', fontSize: 13, fontFamily: F, boxSizing: 'border-box' }} />
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Scope</label>
                  <select value={form.scope} onChange={e => setForm(f => ({ ...f, scope: e.target.value, empresa: e.target.value === 'GLOBAL' ? null : f.empresa }))}
                    style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', fontSize: 13, fontFamily: F, background: '#fff' }}>
                    {SCOPES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                {form.scope === 'EMPRESA' && (
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Empresa</label>
                    <select value={form.empresa ?? ''} onChange={e => setForm(f => ({ ...f, empresa: e.target.value || null }))}
                      style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', fontSize: 13, fontFamily: F, background: '#fff' }}>
                      <option value="">— Seleccionar —</option>
                      {EMPRESAS.map(e => <option key={e} value={e}>{e}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Fuente</label>
                  <select value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
                    style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', fontSize: 13, fontFamily: F, background: '#fff' }}>
                    {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Prioridad (0–100)</label>
                  <input type="number" min={0} max={100} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: parseInt(e.target.value) || 50 }))}
                    style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', fontSize: 13, fontFamily: F, boxSizing: 'border-box' }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Título</label>
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', fontSize: 13, fontFamily: F, boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Contenido</label>
                <textarea value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                  rows={7}
                  style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', fontSize: 13, fontFamily: F, resize: 'vertical', boxSizing: 'border-box' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" id="isActive" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} />
                <label htmlFor="isActive" style={{ fontSize: 13, color: '#374151' }}>Activa</label>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 22, justifyContent: 'flex-end' }}>
              <button onClick={() => { setEditing(null); setCreating(false); }}
                style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '8px 18px', fontFamily: F, fontSize: 13, cursor: 'pointer', color: '#374151' }}>
                Cancelar
              </button>
              <button onClick={creating ? saveNew : saveEdit} disabled={saving}
                style={{ background: '#0d2d5e', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', fontFamily: F, fontWeight: 600, fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabla */}
      {loading ? (
        <div style={{ textAlign: 'center', color: '#94a3b8', padding: 40 }}>Cargando...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#94a3b8', padding: 40 }}>No hay memorias.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(m => (
            <div key={m.id} style={{ border: `1px solid ${m.isActive ? '#e2e8f0' : '#f1f5f9'}`, borderRadius: 10, padding: '14px 18px', background: m.isActive ? '#fff' : '#fafafa', opacity: m.isActive ? 1 : 0.65 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#0d2d5e' }}>{m.title}</span>
                    <SourceBadge source={m.source} />
                    <PriorityBadge priority={m.priority} />
                    {!m.isActive && <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>INACTIVA</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>
                    <code style={{ fontSize: 11 }}>{m.key}</code>
                    {' · '}
                    <span>{m.scope}{m.empresa ? ` › ${m.empresa}` : ''}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: '#475569', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{m.content.length > 200 ? m.content.slice(0, 200) + '…' : m.content}</p>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button onClick={() => openEdit(m)}
                    style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 7, padding: '5px 12px', fontSize: 12, fontFamily: F, cursor: 'pointer', color: '#1d4ed8', fontWeight: 600 }}>
                    Editar
                  </button>
                  <button onClick={() => toggleActive(m)}
                    style={{ background: m.isActive ? '#fef2f2' : '#f0fdf4', border: `1px solid ${m.isActive ? '#fecaca' : '#bbf7d0'}`, borderRadius: 7, padding: '5px 12px', fontSize: 12, fontFamily: F, cursor: 'pointer', color: m.isActive ? '#dc2626' : '#059669', fontWeight: 600 }}>
                    {m.isActive ? 'Desactivar' : 'Activar'}
                  </button>
                  <button onClick={() => deleteMemory(m)}
                    style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 7, padding: '5px 10px', fontSize: 12, fontFamily: F, cursor: 'pointer', color: '#dc2626' }}>
                    ✕
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 16, fontSize: 12, color: '#94a3b8' }}>
        {filtered.length} de {list.length} memorias
      </div>
    </div>
  );
}