'use client';

/**
 * Vista de administración AISLADA del módulo Parámetros (§14 primera
 * entrega). No está enlazada desde ninguna navegación del app productivo
 * ni consume/escribe nada del motor de Mano de Obra — opera enteramente
 * sobre el catálogo y el historial en memoria de
 * `src/lib/costos-mano-obra/parametros/*`. Ruta de solo prototipo:
 * /laboratorio-parametros.
 */
import { useMemo, useState } from 'react';
import { obtenerDefinicionParametro } from '@/lib/costos-mano-obra/parametros/catalogo-parametros';
import { resolverCatalogoCompleto } from '@/lib/costos-mano-obra/parametros/resolver-parametros';
import {
  crearPerfilEmpresarial,
  crearAjusteProceso,
  restaurarValorNormativo,
  listarPerfilesEmpresariales,
  listarAjustesProceso,
  listarAuditoria,
} from '@/lib/costos-mano-obra/parametros/historial-mock';
import { ETIQUETA_GRUPO, ETIQUETA_ORIGEN, ETIQUETA_ESTADO_NORMATIVO, formatearValorParametro } from '@/lib/costos-mano-obra/parametros/presentacion-parametros';
import type { GrupoParametro, RolParametros } from '@/lib/costos-mano-obra/parametros/tipos';

const GRUPOS_ORDEN: GrupoParametro[] = [
  'JORNADA_Y_RECARGOS',
  'MENSUALIZACION_COMERCIAL',
  'SEGURIDAD_SOCIAL',
  'RIESGOS_LABORALES',
  'PARAFISCALES',
  'PRESTACIONES_SOCIALES',
  'BONOS_E_IBC',
  'REDONDEO_Y_PRECISION',
];

const ROL_ACTUAL: RolParametros = 'ADMINISTRADOR_PARAMETROS';
const USUARIO_ACTUAL = 'demo-laboratorio';

export default function LaboratorioParametrosPage() {
  const [fecha, setFecha] = useState('2026-07-26');
  const [empresa, setEmpresa] = useState('ASEOCOLBA');
  const [procesoId, setProcesoId] = useState('');
  const [expandidoId, setExpandidoId] = useState<string | null>(null);
  const [formAjusteId, setFormAjusteId] = useState<string | null>(null);
  const [formValor, setFormValor] = useState('');
  const [formMotivo, setFormMotivo] = useState('');
  const [refrescar, setRefrescar] = useState(0);

  const resultados = useMemo(
    () => resolverCatalogoCompleto({ fecha, empresa: empresa || undefined, procesoId: procesoId || undefined }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fecha, empresa, procesoId, refrescar],
  );

  function abrirFormularioAjuste(parametroId: string) {
    setFormAjusteId(parametroId);
    setFormValor('');
    setFormMotivo('');
  }

  function guardarAjusteEmpresarial() {
    if (formAjusteId == null || formValor.trim() === '' || formMotivo.trim() === '') return;
    crearPerfilEmpresarial({
      parametroId: formAjusteId,
      empresa,
      valorAplicado: Number(formValor),
      fechaInicial: fecha,
      motivo: formMotivo,
      creadoPor: USUARIO_ACTUAL,
      rol: ROL_ACTUAL,
    });
    setFormAjusteId(null);
    setRefrescar((n) => n + 1);
  }

  function restaurar(parametroId: string) {
    restaurarValorNormativo(parametroId, empresa, USUARIO_ACTUAL, ROL_ACTUAL);
    setRefrescar((n) => n + 1);
  }

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Laboratorio de Parámetros — Mano de Obra (prototipo aislado)</h1>
      <p style={{ color: '#666', fontSize: 13, marginBottom: 16 }}>
        Vista de solo prototipo, no conectada al motor productivo. Historial en memoria — se reinicia al recargar.
      </p>

      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13 }}>
          Fecha de resolución{' '}
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </label>
        <label style={{ fontSize: 13 }}>
          Empresa{' '}
          <input value={empresa} onChange={(e) => setEmpresa(e.target.value)} placeholder="ASEOCOLBA" />
        </label>
        <label style={{ fontSize: 13 }}>
          Proceso (opcional){' '}
          <input value={procesoId} onChange={(e) => setProcesoId(e.target.value)} placeholder="proceso-123" />
        </label>
      </div>

      {GRUPOS_ORDEN.map((grupo) => {
        const filas = resultados.filter((r) => obtenerDefinicionParametro(r.parametroId)?.grupo === grupo);
        if (filas.length === 0) return null;
        return (
          <div key={grupo} style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{ETIQUETA_GRUPO[grupo]}</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                  <th style={{ padding: 6 }}>Parámetro</th>
                  <th style={{ padding: 6 }}>Referencia normativa</th>
                  <th style={{ padding: 6 }}>Valor aplicado</th>
                  <th style={{ padding: 6 }}>Vigente desde</th>
                  <th style={{ padding: 6 }}>Origen</th>
                  <th style={{ padding: 6 }}>Estado</th>
                  <th style={{ padding: 6 }}>Acción</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((r) => {
                  const def = obtenerDefinicionParametro(r.parametroId)!;
                  return (
                    <>
                      <tr key={r.parametroId} style={{ borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: 6 }}>
                          {def.nombre}
                          {def.derivadoAutomaticamente && (
                            <span style={badgeStyle('#eef')}>Derivado automáticamente</span>
                          )}
                        </td>
                        <td style={{ padding: 6, color: '#555' }}>{def.descripcion}</td>
                        <td style={{ padding: 6, fontWeight: 600 }}>{formatearValorParametro(r.valor, def.unidad)}</td>
                        <td style={{ padding: 6 }}>{r.vigenteDesde ?? '—'}</td>
                        <td style={{ padding: 6 }}>
                          <span style={badgeStyle(colorOrigen(r.origen))}>{ETIQUETA_ORIGEN[r.origen]}</span>
                        </td>
                        <td style={{ padding: 6 }}>{r.estadoPerfilNormativo ? ETIQUETA_ESTADO_NORMATIVO[r.estadoPerfilNormativo] : '—'}</td>
                        <td style={{ padding: 6, display: 'flex', gap: 4 }}>
                          {!def.derivadoAutomaticamente && (
                            <button onClick={() => abrirFormularioAjuste(r.parametroId)}>Crear ajuste empresarial</button>
                          )}
                          {r.origen === 'EMPRESARIAL' && <button onClick={() => restaurar(r.parametroId)}>Restaurar valor normativo</button>}
                          <button onClick={() => setExpandidoId(expandidoId === r.parametroId ? null : r.parametroId)}>
                            {expandidoId === r.parametroId ? 'Ocultar historial' : 'Ver historial'}
                          </button>
                        </td>
                      </tr>
                      {expandidoId === r.parametroId && (
                        <tr>
                          <td colSpan={7} style={{ padding: 10, background: '#fafafa', fontSize: 12 }}>
                            <HistorialParametro parametroId={r.parametroId} />
                          </td>
                        </tr>
                      )}
                      {formAjusteId === r.parametroId && (
                        <tr>
                          <td colSpan={7} style={{ padding: 10, background: '#fff8e6' }}>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                              <input
                                placeholder="Valor aplicado"
                                value={formValor}
                                onChange={(e) => setFormValor(e.target.value)}
                              />
                              <input
                                placeholder="Motivo (obligatorio)"
                                value={formMotivo}
                                onChange={(e) => setFormMotivo(e.target.value)}
                                style={{ minWidth: 260 }}
                              />
                              <button onClick={guardarAjusteEmpresarial}>Guardar ajuste para {empresa}</button>
                              <button onClick={() => setFormAjusteId(null)}>Cancelar</button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function HistorialParametro({ parametroId }: { parametroId: string }) {
  const perfiles = listarPerfilesEmpresariales(parametroId);
  const ajustes = listarAjustesProceso(parametroId);
  const auditoria = listarAuditoria(parametroId);
  if (perfiles.length === 0 && ajustes.length === 0 && auditoria.length === 0) {
    return <em>Sin historial registrado todavía para este parámetro.</em>;
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {perfiles.length > 0 && (
        <div>
          <strong>Perfiles empresariales:</strong>
          <ul>
            {perfiles.map((p) => (
              <li key={p.id}>
                {p.empresa}: {p.valorAplicado} desde {p.fechaInicial}
                {p.fechaFinal ? ` hasta ${p.fechaFinal} (cerrado)` : ' (vigente)'} — {p.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}
      {ajustes.length > 0 && (
        <div>
          <strong>Ajustes de proceso:</strong>
          <ul>
            {ajustes.map((a) => (
              <li key={a.id}>
                Proceso {a.procesoId}: {a.valorAplicado} — {a.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}
      {auditoria.length > 0 && (
        <div>
          <strong>Auditoría:</strong>
          <ul>
            {auditoria.map((a) => (
              <li key={a.id}>
                [{a.fecha}] {a.usuario} ({a.rol}): {a.detalle}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function colorOrigen(origen: string): string {
  switch (origen) {
    case 'AJUSTE_PROCESO':
      return '#fde2e2';
    case 'EMPRESARIAL':
      return '#fff3cd';
    case 'NORMATIVO':
      return '#d4edda';
    case 'DERIVADO_AUTOMATICO':
      return '#e2e3ff';
    default:
      return '#eee';
  }
}

function badgeStyle(bg: string): React.CSSProperties {
  return {
    marginLeft: 6,
    padding: '2px 6px',
    borderRadius: 4,
    fontSize: 11,
    background: bg,
  };
}