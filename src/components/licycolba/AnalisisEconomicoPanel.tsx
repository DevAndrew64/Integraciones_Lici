'use client';

/**
 * FASE A.1 — Panel "Criterios de evaluación económica" para la ficha del proceso.
 *
 * Vertical slice: cargar PDF -> Analizar con Gemini -> revisar -> aprobar.
 * Standalone: NO está importado en page.tsx todavía. Se monta pasando `procesoId`.
 * NO rediseña el modal TRM ni el de simulación.
 */

import { useCallback, useEffect, useState } from 'react';

interface Props { procesoId: number; }

type Metodo = { id: number; nombreMetodo: string; tipoFormula: string; rangoTrmDesde: number | null; rangoTrmHasta: number | null; puntajeMaximo: number | null; textoFuente: string | null; paginaReferencia: number | null; confianzaExtraccion: number | null; estadoRevision: string; aprobado: boolean };
type Conjunto = { id: number; version: number; estadoVersion: string; presupuestoOficialAprobado: number | null; puntajeMaximoEconomicoAprobado: number | null; metodos: Metodo[] } | null;
type Estado = {
  proceso: { estadoRevisionPliego: string };
  documentos: Array<{ id: number; nombreArchivo: string; tamanoBytes: number; estadoAnalisis: string; errorAnalisis: string | null; rol: string; nPaginas: number | null; storageBackend: string }>;
  reglaActiva: any | null;
  reglaCandidata: any | null;
  conjuntoActivo: Conjunto;
  conjuntoCandidato: Conjunto;
};

const fmtMB = (b: number) => (b / 1024 / 1024).toFixed(1) + ' MB';
const badge: Record<string, { bg: string; label: string }> = {
  SIN_ANALIZAR: { bg: '#94a3b8', label: 'Sin analizar' },
  PENDIENTE_REVISION: { bg: '#d97706', label: 'Pendiente de revisión' },
  REQUIERE_REVISION_PLIEGO: { bg: '#dc2626', label: 'Requiere revisión del pliego' },
  PLIEGO_VERIFICADO: { bg: '#16a34a', label: 'Pliego verificado' },
};

export default function AnalisisEconomicoPanel({ procesoId }: Props) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [cargando, setCargando] = useState(false);
  const [analizando, setAnalizando] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    const r = await fetch(`/api/procesos/${procesoId}/analisis-economico`);
    const d = await r.json();
    if (d.ok) setEstado(d);
    else setErr(d.error || 'Error al cargar');
  }, [procesoId]);

  useEffect(() => { void recargar(); }, [recargar]);

  const subirPdf = async (file: File) => {
    setErr(null); setMsg(null); setCargando(true);
    try {
      const b64 = await new Promise<string>((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result).split(',')[1] ?? '');
        fr.onerror = () => rej(new Error('No se pudo leer el archivo'));
        fr.readAsDataURL(file);
      });
      const r = await fetch(`/api/procesos/${procesoId}/analisis-economico`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombreArchivo: file.name, mimeType: file.type || 'application/pdf', archivoBase64: b64, rol: 'PLIEGO' }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      setMsg(d.mensaje); await recargar();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error al cargar'); }
    finally { setCargando(false); }
  };

  const analizar = async (docId: number) => {
    setErr(null); setMsg(null); setAnalizando(docId);
    try {
      const r = await fetch(`/api/procesos/${procesoId}/analisis-economico/${docId}/analizar`, { method: 'POST' });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      setMsg(`Análisis completado. Regla TRM detectada: ${d.resumen?.reglaTrm?.tipo ?? '—'}. ${d.metodosCreados} método(s). Requiere revisión.`);
      await recargar();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error en el análisis'); }
    finally { setAnalizando(null); }
  };

  const revisar = async (tipo: 'regla' | 'conjunto', id: number, accion: 'aprobar' | 'rechazar', extra?: Record<string, unknown>) => {
    setErr(null); setMsg(null);
    const motivo = accion === 'rechazar' ? window.prompt('Motivo del rechazo:') : undefined;
    if (accion === 'rechazar' && !motivo?.trim()) return;
    const r = await fetch(`/api/procesos/${procesoId}/analisis-economico/${tipo}/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion, motivo, ...extra }),
    });
    const d = await r.json();
    if (!d.ok) { setErr(d.error); return; }
    setMsg(accion === 'aprobar' ? `Aprobado. Estado del pliego: ${d.estadoRevisionPliego}.` : (d.mensaje || 'Rechazado.'));
    await recargar();
  };

  const aprobarConjunto = async (conjuntoId: number) => {
    const pres = Number(window.prompt('Presupuesto oficial APROBADO (COP):') || '');
    const pm = Number(window.prompt('Puntaje máximo económico APROBADO:') || '');
    if (!(pres > 0) || !(pm > 0)) { setErr('Presupuesto y PM deben ser > 0'); return; }
    await revisar('conjunto', conjuntoId, 'aprobar', { presupuestoOficialAprobado: pres, puntajeMaximoEconomicoAprobado: pm });
  };

  if (!estado) return <div style={{ padding: 16, color: '#64748b' }}>Cargando criterios económicos…</div>;
  const b = badge[estado.proceso.estadoRevisionPliego] ?? badge.SIN_ANALIZAR;
  const cand = estado.reglaCandidata;

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 20, background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ fontSize: 15, fontWeight: 800, color: '#0f172a', margin: 0 }}>CRITERIOS DE EVALUACIÓN ECONÓMICA</h3>
        <span style={{ background: b.bg, color: '#fff', fontSize: 11, fontWeight: 700, borderRadius: 6, padding: '3px 10px' }}>{b.label}</span>
      </div>

      {err && <div style={{ background: '#fef2f2', color: '#b91c1c', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 10 }}>{err}</div>}
      {msg && <div style={{ background: '#f0fdf4', color: '#15803d', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 10 }}>{msg}</div>}

      {/* Cargar PDF */}
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>Documento para análisis</div>
      <label style={{ display: 'inline-block', border: '1px dashed #94a3b8', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#334155' }}>
        {cargando ? 'Cargando…' : 'Cargar PDF'}
        <input type="file" accept="application/pdf" style={{ display: 'none' }} disabled={cargando}
          onChange={e => { const f = e.target.files?.[0]; if (f) void subirPdf(f); e.currentTarget.value = ''; }} />
      </label>

      {/* Documentos */}
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {estado.documentos.map(doc => (
          <div key={doc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #f1f5f9', borderRadius: 8, padding: '10px 12px' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{doc.nombreArchivo}</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>{fmtMB(doc.tamanoBytes)} · {doc.rol}{doc.nPaginas ? ` · ${doc.nPaginas} pág` : ''} · {doc.estadoAnalisis}{doc.errorAnalisis ? ` — ${doc.errorAnalisis}` : ''}</div>
            </div>
            <button onClick={() => void analizar(doc.id)} disabled={analizando != null || doc.estadoAnalisis === 'ANALIZANDO'}
              style={{ background: '#0d2d5e', color: '#fff', border: 0, borderRadius: 6, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: analizando != null ? 0.6 : 1 }}>
              {analizando === doc.id ? 'Analizando…' : 'Analizar con Gemini'}
            </button>
          </div>
        ))}
      </div>

      {/* Revisión de la CANDIDATA */}
      {cand && (
        <div style={{ marginTop: 18, border: '1px solid #fde68a', background: '#fffbeb', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#92400e', marginBottom: 8 }}>ANÁLISIS COMPLETADO — pendiente de revisión (v{cand.version})</div>
          <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.7 }}>
            <div><b>Regla TRM detectada:</b> {cand.textoReglaTrm ? `"${cand.textoReglaTrm}"` : '—'}</div>
            <div style={{ fontSize: 11, color: '#78716c' }}>
              {cand.paginaReferencia ? `Página ${cand.paginaReferencia}` : 'Sin página'}
              {cand.confianzaExtraccion != null ? ` · Confianza ${Number(cand.confianzaExtraccion).toFixed(2)}` : ''}
            </div>
            <div style={{ marginTop: 4 }}>Detectado: <b>{cand.tipoReglaTrm}</b>{cand.eventoBaseTrm ? <> · Evento base: <b>{cand.eventoBaseTrm}</b></> : null} · Centavos: <b>{cand.reglaCentavos}</b></div>
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <button onClick={() => void revisar('regla', cand.id, 'aprobar')} style={{ background: '#16a34a', color: '#fff', border: 0, borderRadius: 6, padding: '7px 16px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Aprobar regla</button>
            <button onClick={() => void revisar('regla', cand.id, 'rechazar')} style={{ background: '#fff', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 6, padding: '7px 16px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Rechazar regla</button>
            <span style={{ fontSize: 11, color: '#78716c', alignSelf: 'center' }}>Editar: PATCH regla accion:"editar"</span>
          </div>
        </div>
      )}

      {estado.reglaActiva && (
        <div style={{ marginTop: 12, fontSize: 12, color: '#15803d' }}>
          ✓ Regla TRM ACTIVA (v{estado.reglaActiva.version}): {estado.reglaActiva.tipoReglaTrm} · centavos {estado.reglaActiva.reglaCentavos}
        </div>
      )}

      {/* CONJUNTO de métodos CANDIDATO (versionado — no se mezcla con el activo) */}
      {estado.conjuntoCandidato && (
        <div style={{ marginTop: 14, border: '1px solid #fde68a', background: '#fffbeb', borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#92400e' }}>CONJUNTO DE MÉTODOS — CANDIDATO v{estado.conjuntoCandidato.version} (pendiente)</div>
          {estado.conjuntoCandidato.metodos.map(m => (
            <div key={m.id} style={{ fontSize: 12, color: '#334155', padding: '4px 0', borderBottom: '1px solid #fde68a' }}>
              {m.aprobado ? '✓' : '○'} <b>{m.nombreMetodo}</b> · {m.tipoFormula} · centavos {m.rangoTrmDesde}–{m.rangoTrmHasta} · PM {m.puntajeMaximo ?? '—'}
              {m.paginaReferencia ? <span style={{ color: '#94a3b8' }}> · pág {m.paginaReferencia}</span> : null}
              <span style={{ color: '#94a3b8' }}> · {m.estadoRevision}</span>
            </div>
          ))}
          <div style={{ fontSize: 11, color: '#78716c', marginTop: 6 }}>Revisa cada método: PATCH /api/ponderacion/metodos/[id]. Luego aprueba el CONJUNTO (pide presupuesto y PM aprobados).</div>
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button onClick={() => void aprobarConjunto(estado.conjuntoCandidato!.id)} style={{ background: '#16a34a', color: '#fff', border: 0, borderRadius: 6, padding: '6px 14px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Aprobar conjunto</button>
            <button onClick={() => void revisar('conjunto', estado.conjuntoCandidato!.id, 'rechazar')} style={{ background: '#fff', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 6, padding: '6px 14px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Rechazar conjunto</button>
          </div>
        </div>
      )}

      {estado.conjuntoActivo && (
        <div style={{ marginTop: 12, fontSize: 12, color: '#15803d' }}>
          ✓ CONJUNTO ACTIVO (v{estado.conjuntoActivo.version}): {estado.conjuntoActivo.metodos.length} métodos · PO ${estado.conjuntoActivo.presupuestoOficialAprobado?.toLocaleString('es-CO') ?? '—'} · PM {estado.conjuntoActivo.puntajeMaximoEconomicoAprobado ?? '—'}
        </div>
      )}
    </div>
  );
}
