import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireSession, resolveSessionUserId } from '@/lib/authz';
import { auditFromRequest } from '@/lib/audit';
import prisma from '@/lib/prisma';


export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>;

// ── HELPERS ──────────────────────────────────────────────────────────────────
function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtCOP(n: unknown): string {
  const num = typeof n === 'number' ? n : Number(String(n ?? '').replace(/[^0-9]/g,''));
  if (!num || isNaN(num)) return '—';
  return '$ ' + num.toLocaleString('es-CO') + ' COP';
}
function fmtPag(fuente: AnyObj | undefined): string {
  if (!fuente) return '';
  const pi = fuente.pagina_inicial ?? fuente.pagina;
  const pf = fuente.pagina_final;
  const doc = fuente.nombre_documento ? ` · ${String(fuente.nombre_documento).slice(0,40)}` : '';
  if (pi && pf && pi !== pf) return `Págs. ${pi}–${pf}${doc}`;
  if (pi) return `Pág. ${pi}${doc}`;
  return doc ? doc.slice(3) : '';
}
function getNombre(item: AnyObj): string {
  return String(
    item.nombre_clausula || item.nombre_requisito || item.nombre_criterio ||
    item.nombre_garantia || item.nombre_causal || item.nombre_riesgo ||
    item.nombre_especificacion || item.nombre_acuerdo || item.nombre_anexo ||
    item.nombre_perfil || item.nombre_item || item.causal_declaratoria ||
    item.nombre_documento_referenciado || item.descripcion_unspsc ||
    item.requisito || item.concepto || item.descripcion ||
    item.titulo || item.evento || item.nombre || item.numeral || ''
  ).trim() || '—';
}
function nivelColor(nivel: string | undefined): string {
  if (!nivel) return '#64748b';
  const n = nivel.toUpperCase();
  if (n.includes('ALTO') || n.includes('CRITICO')) return '#dc2626';
  if (n.includes('MEDIO')) return '#d97706';
  return '#16a34a';
}
function arr(v: unknown): AnyObj[] {
  return Array.isArray(v) ? v.filter(Boolean) : [];
}
function strVal(v: unknown): string {
  const s = String(v ?? '').trim();
  return (s && s !== 'null' && s !== 'undefined' && s !== '...' && s !== 'N/A') ? s : '';
}

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
@page { size: Letter; margin: 15mm 14mm 14mm 14mm; }
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; color: #1f2937; font-size: 10.5px; line-height: 1.5; background: #fff; }
.doc-header { background: #1e3a5f; color: #fff; padding: 12px 16px 10px; margin-bottom: 12px; border-bottom: 4px solid #2563eb; }
.doc-header-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px; }
.brand { font-size: 12px; font-weight: 700; letter-spacing: 1.5px; color: #93c5fd; }
.brand-sub { font-size: 8.5px; color: #94a3b8; letter-spacing: 0.3px; margin-top: 1px; }
.doc-title { font-size: 20px; font-weight: 700; color: #fff; line-height: 1.1; }
.doc-subtitle { font-size: 9.5px; color: #93c5fd; margin-top: 3px; }
.badge { background: #1d4ed8; color: #bfdbfe; font-size: 7.5px; font-weight: 700; letter-spacing: 1px; padding: 3px 9px; border-radius: 3px; white-space: nowrap; }
.doc-date { font-size: 8px; color: #64748b; margin-top: 5px; }
.warn-banner { background: #fffbeb; border-left: 5px solid #f59e0b; padding: 9px 14px; margin-bottom: 10px; font-size: 10px; color: #78350f; line-height: 1.5; }
section { page-break-inside: avoid; break-inside: avoid; margin-bottom: 11px; }
.section-title { background: #1e3a5f; color: #fff; font-size: 8.5px; font-weight: 700; letter-spacing: 0.8px; padding: 4px 10px; margin-bottom: 0; border-left: 5px solid #2563eb; page-break-after: avoid; break-after: avoid; }
.sub-title { background: #eff6ff; color: #1e3a5f; font-size: 8px; font-weight: 700; letter-spacing: 0.5px; padding: 3px 10px; border-left: 3px solid #93c5fd; margin-bottom: 0; page-break-after: avoid; break-after: avoid; }
table { width: 100%; border-collapse: collapse; font-size: 10px; }
th { background: #f1f5f9; color: #1e3a5f; font-weight: 700; font-size: 8.5px; letter-spacing: 0.3px; padding: 5px 8px; border-bottom: 2px solid #bfdbfe; text-align: left; vertical-align: middle; }
td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; word-break: break-word; overflow-wrap: break-word; }
tr:last-child td { border-bottom: none; }
tr:nth-child(even) td { background: #f8fafc; }
.ficha-label { font-weight: 700; color: #1e3a5f; width: 32%; background: #f1f5f9 !important; }
.semaforo-row { display: flex; gap: 7px; margin: 0; }
.semaforo-item { flex: 1; padding: 8px 9px 7px; border-left: 4px solid; background: #f8fafc; }
.semaforo-item .s-titulo { font-size: 7.5px; font-weight: 700; letter-spacing: 0.5px; color: #64748b; margin-bottom: 2px; }
.semaforo-item .s-valor { font-size: 11px; font-weight: 700; line-height: 1.1; }
.semaforo-item .s-desc { font-size: 8px; color: #6b7280; margin-top: 2px; }
.verde { border-color: #16a34a; } .verde .s-valor { color: #15803d; }
.amarillo { border-color: #ca8a04; } .amarillo .s-valor { color: #92400e; }
.rojo { border-color: #dc2626; } .rojo .s-valor { color: #b91c1c; }
.bar-row { margin-bottom: 7px; page-break-inside: avoid; break-inside: avoid; }
.bar-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 2px; }
.bar-name { font-weight: 700; color: #1f2937; font-size: 10px; }
.bar-pts { font-weight: 700; color: #1e3a5f; font-size: 10.5px; white-space: nowrap; margin-left: 8px; }
.bar-desc { font-size: 8.5px; color: #6b7280; margin-bottom: 2px; }
.bar-track { height: 5px; background: #e5e7eb; border-radius: 3px; }
.bar-fill { height: 5px; background: #2563eb; border-radius: 3px; }
.alert-box { border-left: 4px solid #f59e0b; background: #fffbeb; padding: 8px 12px; margin-bottom: 8px; page-break-inside: avoid; break-inside: avoid; }
.alert-title { font-weight: 700; color: #92400e; font-size: 10.5px; margin-bottom: 2px; }
.alert-desc { color: #78350f; font-size: 10px; line-height: 1.4; }
.literal-box { background: #f8fafc; border-left: 3px solid #94a3b8; padding: 5px 8px; margin: 4px 0; font-size: 9px; color: #374151; line-height: 1.4; font-style: italic; }
.fuente-tag { font-size: 8px; color: #6366f1; font-weight: 600; margin-top: 2px; }
.conclusion { background: #eff6ff; border-left: 5px solid #1e3a5f; padding: 10px 14px; page-break-inside: avoid; break-inside: avoid; }
.conclusion-title { font-weight: 700; color: #1e3a5f; font-size: 11.5px; margin-bottom: 6px; }
.conclusion-item { margin-bottom: 5px; font-size: 10px; }
.conclusion-lbl { font-weight: 700; color: #1e3a5f; }
.page-break { page-break-before: always; break-before: always; }
.incompleto-warn { background: #fef2f2; border: 2px solid #fca5a5; border-radius: 4px; padding: 8px 12px; margin-bottom: 10px; font-size: 10px; color: #991b1b; font-weight: 600; }
.tag-nivel { display:inline-block; padding: 1px 6px; border-radius: 3px; font-size: 8px; font-weight: 700; }
.tag-alto { background: #fef2f2; color: #991b1b; }
.tag-medio { background: #fffbeb; color: #92400e; }
.tag-bajo { background: #f0fdf4; color: #166534; }
@page { @bottom-left { content: "LICYCOLBA · Análisis de Licitaciones"; font-size: 7.5px; color: #9ca3af; font-family: Arial, sans-serif; } @bottom-right { content: "Pág. " counter(page) " de " counter(pages); font-size: 7.5px; color: #9ca3af; font-family: Arial, sans-serif; } }
`;

// ── SEMÁFORO ─────────────────────────────────────────────────────────────────
function semItem(cls: string, titulo: string, valor: string, desc: string) {
  return `<div class="semaforo-item ${cls}"><div class="s-titulo">${titulo}</div><div class="s-valor">${valor}</div><div class="s-desc">${desc}</div></div>`;
}

function semaforoDesdeNormal(r: AnyObj) {
  const alertas = arr(r.alertas);
  const rh = r.requisitos_habilitantes || {};
  const totalReq = (rh.juridicos?.length||0)+(rh.financieros?.length||0)+(rh.tecnicos?.length||0)+(rh.organizacionales?.length||0);
  const pe = r.ponderacion_economica;
  const nMetodos = pe?.metodos?.length||0;
  const viab = alertas.length===0?{l:'VIABLE',c:'verde',d:'Sin alertas críticas'}:alertas.length<=2?{l:'CON RESERVAS',c:'amarillo',d:`${alertas.length} alerta(s)`}:{l:'REVISAR',c:'rojo',d:`${alertas.length} alertas`};
  const eco = nMetodos<=1?{l:'BAJO',c:'verde',d:'Fórmula simple'}:nMetodos<=3?{l:'MEDIO',c:'amarillo',d:'Múltiples fórmulas'}:{l:'ALTO',c:'rojo',d:'Método complejo'};
  const doc = totalReq<=4?{l:'BAJO',c:'verde',d:'Pocos requisitos'}:totalReq<=9?{l:'MEDIO',c:'amarillo',d:`${totalReq} requisitos`}:{l:'ALTO',c:'rojo',d:`${totalReq} requisitos`};
  return `<div class="semaforo-row">${semItem(viab.c,'VIABILIDAD',viab.l,viab.d)}${semItem(eco.c,'RIESGO ECONÓMICO',eco.l,eco.d)}${semItem(doc.c,'RIESGO DOCUMENTAL',doc.l,doc.d)}${semItem(totalReq>8?'rojo':totalReq>4?'amarillo':'verde','REQUISITOS HABIIT.',String(totalReq),'Total habilitantes')}</div>`;
}

function semaforoDesdeProf(data: AnyObj) {
  const alertas = arr(data.alertas);
  const vf = data.validacion_final as AnyObj || {};
  const vc = data.validacion_contractual as AnyObj || {};
  const totalReq = arr(data.requisitos_juridicos_habilitantes).length + arr(data.requisitos_financieros_habilitantes).length + arr(data.requisitos_tecnicos_habilitantes).length + arr(data.requisitos_organizacionales_habilitantes).length;
  const tieneMinuta = Object.values(data.minuta_condiciones_contractuales||{}).some((v:unknown)=>Array.isArray(v)&&(v as unknown[]).length>0);
  const estadoVC = vc.estado_analisis_contractual === 'ANALISIS_CONTRACTUAL_INCOMPLETO' ? 'INCOMP.' : 'COMPLETO';
  const viabLabel = vf.conclusion_viabilidad ? String(vf.conclusion_viabilidad).includes('VIABLE') ? 'VIABLE' : 'REVISAR' : alertas.length===0?'VIABLE':'REVISAR';
  const viabCls = viabLabel === 'VIABLE' ? 'verde' : 'rojo';
  const contCls = tieneMinuta ? 'verde' : 'rojo';
  return `<div class="semaforo-row">${semItem(viabCls,'VIABILIDAD',viabLabel,`${alertas.length} alerta(s)`)}${semItem(totalReq<=4?'verde':totalReq<=9?'amarillo':'rojo','REQUISITOS HABIT.',String(totalReq),'Total habilitantes')}${semItem(tieneMinuta?'verde':'rojo','MINUTA CONTRACTUAL',estadoVC,tieneMinuta?'Cláusulas extraídas':'Sin cláusulas')}${semItem(contCls,'ANÁLISIS','PROFUNDO',data.bloques_procesados?`${data.bloques_procesados} bloques`:'Análisis completo')}</div>`;
}

// ── TABLA GENÉRICA DE ITEMS PROFUNDOS ─────────────────────────────────────────
const MAX_ITEMS_PDF = 150;

function renderItems(items: AnyObj[], tituloSeccion: string, opts?: { showLiteral?: boolean; showFuente?: boolean; showClasif?: boolean; showNivel?: boolean }): string {
  if (!items?.length) return '';
  const { showLiteral=true, showFuente=true, showClasif=false, showNivel=true } = opts||{};
  const truncado = items.length > MAX_ITEMS_PDF;
  const itemsRender = truncado ? items.slice(0, MAX_ITEMS_PDF) : items;
  const rows = itemsRender.map((item, i) => {
    const nombre = getNombre(item);
    const nivel = strVal(item.nivel_riesgo);
    const clasif = strVal(item.clasificacion);
    const literal = strVal(item.texto_literal_pliego);
    const analisis = strVal(item.analisis_controlado);
    const fuente = item.fuente ? fmtPag(item.fuente as AnyObj) : '';
    const numeral = strVal(item.numeral) || strVal(item.numero_clausula);
    const accion = strVal(item.accion_preventiva) || strVal(item.accion_recomendada);
    const impacto = strVal(item.impacto_contractual);
    const subsanable = strVal(item.subsanable);
    return `<tr>
      <td style="width:22px;text-align:center;color:#9ca3af;font-size:9px">${i+1}</td>
      <td>
        <div style="font-weight:700;color:#1e3a5f;font-size:10px">${esc(nombre)}</div>
        ${numeral?`<div style="font-size:8.5px;color:#6366f1;font-weight:600">${esc(numeral)}</div>`:''}
        ${showClasif&&clasif?`<div style="font-size:8px;color:#64748b;margin-top:1px">${esc(clasif)}</div>`:''}
        ${showNivel&&nivel?`<span class="tag-nivel ${nivel.toUpperCase().includes('ALTO')?'tag-alto':nivel.toUpperCase().includes('MEDIO')?'tag-medio':'tag-bajo'}">${esc(nivel)}</span>`:''}
        ${subsanable&&subsanable!=='NO ESPECIFICADO EN EL DOCUMENTO'?`<span class="tag-nivel" style="background:#eff6ff;color:#1e5799;margin-left:4px">Sub: ${esc(subsanable)}</span>`:''}
        ${analisis?`<div style="font-size:9px;color:#374151;margin-top:3px;line-height:1.4">${esc(analisis.slice(0,300))}</div>`:''}
        ${impacto?`<div style="font-size:8.5px;color:#854d0e;background:#fefce8;padding:2px 5px;border-radius:3px;margin-top:2px"><b>Impacto:</b> ${esc(impacto.slice(0,180))}</div>`:''}
        ${accion?`<div style="font-size:8.5px;color:#065f46;background:#ecfdf5;padding:2px 5px;border-radius:3px;margin-top:2px"><b>Acción:</b> ${esc(accion.slice(0,180))}</div>`:''}
        ${showLiteral&&literal?`<div class="literal-box">"${esc(literal.slice(0,500))}"</div>`:''}
        ${showFuente&&fuente?`<div class="fuente-tag">${esc(fuente)}</div>`:''}
      </td>
    </tr>`;
  }).join('');
  return `<section>
    <div class="section-title">${esc(tituloSeccion)} (${items.length})</div>
    ${truncado?`<div style="padding:4px 10px;font-size:8.5px;color:#92400e;background:#fffbeb;font-style:italic">Mostrando los primeros ${MAX_ITEMS_PDF} de ${items.length} ítems para mantener el PDF manejable.</div>`:''}
    <table><thead><tr><th style="width:22px">#</th><th>Detalle</th></tr></thead><tbody>${rows}</tbody></table>
  </section>`;
}

// ── SECCIÓN DE MINUTA CONTRACTUAL ─────────────────────────────────────────────
function renderMinutaSeccion(items: AnyObj[], titulo: string): string {
  if (!items?.length) return '';
  const truncado = items.length > MAX_ITEMS_PDF;
  const itemsRender = truncado ? items.slice(0, MAX_ITEMS_PDF) : items;
  const rows = itemsRender.map((item, i) => {
    const nombre = getNombre(item);
    const literal = strVal(item.texto_literal_pliego);
    const analisis = strVal(item.analisis_controlado);
    const fuente = item.fuente ? fmtPag(item.fuente as AnyObj) : '';
    const numCl = strVal(item.numero_clausula);
    const impC = strVal(item.impacto_contractual);
    const impE = strVal(item.impacto_economico);
    const impO = strVal(item.impacto_operativo);
    const accion = strVal(item.accion_preventiva);
    return `<tr>
      <td style="width:22px;text-align:center;color:#9ca3af;font-size:9px">${i+1}</td>
      <td>
        <div style="font-weight:700;color:#1e3a5f;font-size:10px">${esc(nombre)}</div>
        ${numCl?`<div style="font-size:8px;color:#6366f1;font-weight:600">${esc(numCl)}</div>`:''}
        ${literal?`<div class="literal-box">"${esc(literal.slice(0,600))}"</div>`:''}
        ${analisis?`<div style="font-size:9px;color:#374151;margin-top:2px;line-height:1.4">${esc(analisis.slice(0,250))}</div>`:''}
        ${impC?`<div style="font-size:8.5px;color:#854d0e;background:#fefce8;padding:2px 5px;border-radius:3px;margin-top:2px"><b>Impacto contractual:</b> ${esc(impC.slice(0,150))}</div>`:''}
        ${impE?`<div style="font-size:8.5px;color:#1e40af;background:#eff6ff;padding:2px 5px;border-radius:3px;margin-top:2px"><b>Impacto económico:</b> ${esc(impE.slice(0,150))}</div>`:''}
        ${impO?`<div style="font-size:8.5px;color:#5b21b6;background:#f5f3ff;padding:2px 5px;border-radius:3px;margin-top:2px"><b>Impacto operativo:</b> ${esc(impO.slice(0,150))}</div>`:''}
        ${accion?`<div style="font-size:8.5px;color:#065f46;background:#ecfdf5;padding:2px 5px;border-radius:3px;margin-top:2px"><b>Acción preventiva:</b> ${esc(accion.slice(0,150))}</div>`:''}
        ${fuente?`<div class="fuente-tag">${esc(fuente)}</div>`:''}
      </td>
    </tr>`;
  }).join('');
  return `<div style="margin-bottom:8px;page-break-inside:avoid;break-inside:avoid">
    <div class="sub-title">${esc(titulo)} (${items.length})</div>
    ${truncado?`<div style="padding:3px 8px;font-size:8px;color:#92400e;font-style:italic">Mostrando los primeros ${MAX_ITEMS_PDF} de ${items.length}.</div>`:''}
    <table><thead><tr><th style="width:22px">#</th><th>Cláusula / Condición</th></tr></thead><tbody>${rows}</tbody></table>
  </div>`;
}

// ── FICHA DESDE RESULTADO PROFUNDO ────────────────────────────────────────────
function buildFichaProfundo(data: AnyObj): string {
  const f = (data.ficha_general_proceso || {}) as AnyObj;
  const rows: [string, string][] = [
    ['Entidad contratante', strVal(f.entidad_contratante||f.entidad) || strVal(data.entidad) || '—'],
    ['Código / N.° proceso', strVal(f.codigo_proceso||f.numero_proceso||data.codigo_proceso) || '—'],
    ['Tipo de proceso', strVal(f.tipo_proceso||f.modalidad_seleccion) || '—'],
    ['Objeto contractual', strVal(f.objeto_contractual||f.objeto||data.objeto) || '—'],
    ['Presupuesto oficial', fmtCOP(f.presupuesto_oficial??f.presupuesto??data.presupuesto)],
    ['Moneda', strVal(f.moneda) || 'COP'],
    ['Plazo de ejecución', strVal(f.plazo_ejecucion||f.plazo||data.plazo) || '—'],
    ['Lugar de ejecución', strVal(f.lugar_ejecucion) || '—'],
    ['Fecha límite ofertas', strVal(f.fecha_presentacion_ofertas||f.fecha_limite_ofertas) || '—'],
    ['Fecha publicación', strVal(f.fecha_publicacion) || '—'],
  ];
  return `<section>
    <div class="section-title">FICHA DEL PROCESO</div>
    <table><tbody>${rows.map(([l,v])=>`<tr><td class="ficha-label">${esc(l)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table>
  </section>`;
}

// ── CRONOGRAMA PROFUNDO ───────────────────────────────────────────────────────
function buildCronograma(items: AnyObj[]): string {
  if (!items?.length) return '';
  const rows = items.map(item => {
    const evento = strVal(item.evento||item.titulo||item.nombre||item.nombre_evento);
    const fecha = strVal(item.fecha||item.fecha_evento);
    const fuente = item.fuente ? fmtPag(item.fuente as AnyObj) : '';
    return `<tr><td style="font-weight:700;color:#1e3a5f;white-space:nowrap;width:25%">${esc(fecha||'—')}</td><td>${esc(evento||'—')}${fuente?`<div class="fuente-tag">${esc(fuente)}</div>`:''}</td></tr>`;
  }).join('');
  return `<section>
    <div class="section-title">CRONOGRAMA DEL PROCESO</div>
    <table><thead><tr><th>Fecha</th><th>Hito / Evento</th></tr></thead><tbody>${rows}</tbody></table>
  </section>`;
}

// ── GARANTÍAS PROFUNDAS ───────────────────────────────────────────────────────
function buildGarantias(items: AnyObj[]): string {
  if (!items?.length) return '';
  const rows = items.map((item, i) => {
    const nombre = strVal(item.nombre_garantia||item.nombre||item.titulo) || '—';
    const tipo = strVal(item.tipo_garantia);
    const monto = strVal(item.monto_cobertura);
    const plazo = strVal(item.plazo_vigencia);
    const literal = strVal(item.texto_literal_pliego);
    const analisis = strVal(item.analisis_controlado);
    const fuente = item.fuente ? fmtPag(item.fuente as AnyObj) : '';
    return `<tr>
      <td style="width:22px;text-align:center;color:#9ca3af;font-size:9px">${i+1}</td>
      <td style="font-weight:700;color:#7c3aed">${esc(nombre)}</td>
      <td>${esc(tipo||'—')}</td>
      <td>${esc(monto||'—')}</td>
      <td>${esc(plazo||'—')}
        ${analisis?`<div style="font-size:8.5px;color:#374151;margin-top:2px">${esc(analisis.slice(0,150))}</div>`:''}
        ${literal?`<div class="literal-box">"${esc(literal.slice(0,300))}"</div>`:''}
        ${fuente?`<div class="fuente-tag">${esc(fuente)}</div>`:''}
      </td>
    </tr>`;
  }).join('');
  return `<section>
    <div class="section-title">GARANTÍAS, PÓLIZAS Y AMPAROS (${items.length})</div>
    <table><thead><tr><th style="width:22px">#</th><th>Garantía</th><th>Tipo</th><th>Monto/Cobertura</th><th>Plazo/Vigencia</th></tr></thead><tbody>${rows}</tbody></table>
  </section>`;
}

// ── MINUTA COMPLETA ───────────────────────────────────────────────────────────
function buildMinutaCompleta(minuta: AnyObj): string {
  const SECS: [string, string][] = [
    ['forma_pago','Forma de pago'],
    ['obligaciones_contratista','Obligaciones del contratista'],
    ['obligaciones_entidad','Obligaciones de la entidad'],
    ['obligaciones_supervisor_interventor','Obligaciones del supervisor / interventor'],
    ['supervision_interventoria','Supervisión e interventoría'],
    ['seguridad_social_parafiscales','Seguridad social y parafiscales'],
    ['estabilidad_laboral_personal','Estabilidad laboral y personal'],
    ['multas','Multas'],
    ['procedimiento_multas_sanciones','Procedimiento sancionatorio'],
    ['pena_pecuniaria_clausula_penal','Pena pecuniaria / Cláusula penal'],
    ['multas_sanciones_clausula_penal','Multas y sanciones (consolidado)'],
    ['garantias_contractuales','Garantías contractuales'],
    ['polizas_requisitos_pago','Pólizas y requisitos de pago'],
    ['amparos','Amparos'],
    ['indemnidad','Indemnidad'],
    ['cesion_subcontratacion','Cesión y subcontratación'],
    ['confidencialidad','Confidencialidad'],
    ['laft_sarlaft_listas','LAFT / SARLAFT / Listas'],
    ['caso_fortuito_fuerza_mayor','Caso fortuito / Fuerza mayor'],
    ['solucion_controversias','Solución de controversias'],
    ['terminacion','Terminación del contrato'],
    ['liquidacion','Liquidación del contrato'],
    ['terminacion_liquidacion','Terminación y liquidación (consolidado)'],
    ['perfeccionamiento_requisitos_ejecucion','Perfeccionamiento y ejecución'],
    ['ans_niveles_servicio','ANS / Niveles de servicio'],
    ['otros','Otras condiciones contractuales'],
  ];
  const secciones = SECS.map(([k, t]) => renderMinutaSeccion(arr(minuta[k]), t)).filter(Boolean);
  if (!secciones.length) return '';
  return `<section>
    <div class="section-title">MINUTA Y CLÁUSULAS CONTRACTUALES</div>
    <div style="padding:2px 0">${secciones.join('')}</div>
  </section>`;
}

// ── VALIDACIÓN CONTRACTUAL ────────────────────────────────────────────────────
function buildValidacionContractual(vc: AnyObj): string {
  if (!vc || Object.keys(vc).length === 0) return '';
  const estado = strVal(vc.estado_analisis_contractual);
  const advs = arr(vc.advertencias).map(a => String(a));
  const isIncomp = estado === 'ANALISIS_CONTRACTUAL_INCOMPLETO';
  const checks = Object.entries(vc)
    .filter(([k]) => k.startsWith('se_') || k === 'estado_analisis_contractual')
    .map(([k, v]) => `<tr><td style="font-size:9px;color:#374151">${k.replace(/_/g,' ')}</td><td style="font-weight:700;color:${String(v)==='SÍ'?'#15803d':'#dc2626'}">${esc(String(v))}</td></tr>`)
    .join('');
  return `<section>
    <div class="section-title" style="background:${isIncomp?'#dc2626':'#166534'}">VALIDACIÓN CONTRACTUAL — ${esc(estado||'N/A')}</div>
    ${advs.length?`<div class="incompleto-warn">${advs.map(a=>`• ${esc(a)}`).join('<br>')}</div>`:''}
    <table><thead><tr><th>Campo validado</th><th>Estado</th></tr></thead><tbody>${checks}</tbody></table>
  </section>`;
}

// ── HELPERS PARA RESUMEN PRELIMINAR ──────────────────────────────────────────

/** Formatea una fecha parcial eliminando el patrón "XX" de día desconocido */
function formatFechaParcial(fecha: unknown): string {
  const f = strVal(fecha);
  if (!f) return '—';
  if (/\d{4}-\d{2}-XX/i.test(f)) {
    const m = f.match(/(\d{4})-(\d{2})/);
    if (m) {
      const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
      const mes = meses[parseInt(m[2]) - 1] || m[2];
      return `${mes} de ${m[1]} — día no especificado en el documento`;
    }
  }
  // Catch other XX patterns
  if (/XX/i.test(f)) return f.replace(/-?XX/gi, '') + ' — día no especificado en el documento';
  return f;
}

/** Formatea el presupuesto para el resumen preliminar sin mostrar "NO ESPECIFICADO" */
function formatPresupuestoPreliminar(r: AnyObj): string {
  if (r.presupuesto && Number(r.presupuesto) > 0) return fmtCOP(r.presupuesto);
  return 'No identificado directamente en análisis preliminar';
}

/** Detecta valores monetarios en los textos del resultado para mostrarlos como relacionados */
function detectarValoresEconomicosRelacionados(r: AnyObj): Array<{valor: string; contexto: string}> {
  if (r.presupuesto && Number(r.presupuesto) > 0) return []; // ya tiene presupuesto
  const resultado: Array<{valor: string; contexto: string}> = [];
  const seen = new Set<string>();
  const fuentes: {text: string; etiqueta: string}[] = [
    { text: String(r.resumen || ''), etiqueta: 'resumen' },
    { text: String(r.experiencia_requerida || ''), etiqueta: 'experiencia requerida' },
    { text: String(r.objeto || ''), etiqueta: 'objeto contractual' },
    ...arr(r.alertas).map((a: unknown) => ({ text: String(a), etiqueta: 'alertas' })),
    ...arr(r.criterios_evaluacion).map((c: AnyObj) => ({ text: String(c.descripcion||''), etiqueta: 'criterios' })),
  ];
  const RE = /\$\s?[\d]{1,3}(?:[.,]\d{3})+/g;
  for (const { text, etiqueta } of fuentes) {
    if (!text) continue;
    const matches = text.match(RE);
    if (!matches) continue;
    for (const m of matches) {
      const key = m.replace(/\s/g,'');
      if (seen.has(key)) continue;
      seen.add(key);
      const idx = text.indexOf(m);
      const antes = text.substring(Math.max(0, idx - 55), idx).replace(/\n/g,' ').trim();
      const despues = text.substring(idx + m.length, Math.min(text.length, idx + m.length + 90)).replace(/\n/g,' ').trim();
      const contexto = `${antes} [${m.trim()}] ${despues} — fuente: ${etiqueta}`;
      resultado.push({ valor: m.trim(), contexto: contexto.slice(0, 220) });
    }
  }
  return resultado;
}

/** Sección de valores económicos relacionados (cuando no hay presupuesto directo) */
function renderValoresEconomicosRelacionados(r: AnyObj): string {
  const valores = detectarValoresEconomicosRelacionados(r);
  if (!valores.length) return '';
  return `<section>
    <div class="section-title" style="background:#1d4ed8">VALORES ECONÓMICOS RELACIONADOS DETECTADOS</div>
    <div style="padding:7px 10px;background:#eff6ff;border-left:4px solid #3b82f6">
      <div style="font-size:9px;color:#1e40af;margin-bottom:6px">El presupuesto oficial no fue identificado directamente. Los siguientes valores monetarios fueron detectados en el documento y pueden estar relacionados. Requieren validación en análisis profundo.</div>
      ${valores.map(v=>`<div style="margin-bottom:6px;padding:4px 8px;background:#fff;border-left:3px solid #93c5fd;border-radius:2px"><div style="font-weight:700;color:#1e3a5f;font-size:10px">${esc(v.valor)}</div><div style="font-size:8.5px;color:#64748b;margin-top:1px;font-style:italic">${esc(v.contexto)}</div></div>`).join('')}
    </div>
  </section>`;
}

/** Renderiza criterios de adjudicación sin mostrar "null pts" ni "TOTAL: 0 PTS" */
function renderCriteriosPreliminar(criterios: AnyObj[]): string {
  if (!criterios.length) return '';
  const conPuntaje = criterios.filter(c => c.puntaje !== null && c.puntaje !== undefined && !isNaN(Number(c.puntaje)) && Number(c.puntaje) > 0);
  if (!conPuntaje.length) {
    // Habilitantes / pasa-no pasa
    const rows = criterios.map(c=>`<div class="bar-row"><div class="bar-header"><span class="bar-name">${esc(String(c.criterio||c.nombre||'Criterio'))}</span><span class="bar-pts" style="color:#64748b;font-size:9px;font-weight:400">No aplica</span></div>${c.descripcion?`<div class="bar-desc">${esc(String(c.descripcion))}</div>`:''}<div style="font-size:8.5px;color:#6b7280;margin-top:2px">Tipo: Habilitante / Pasa–No pasa &nbsp;|&nbsp; Puntaje: No aplica</div></div>`).join('');
    return `<section><div class="section-title">CRITERIOS DE ADJUDICACIÓN — sin puntaje numérico identificado en análisis preliminar</div><div style="padding:8px 10px">${rows}</div></section>`;
  }
  const totalPts = conPuntaje.reduce((s,c)=>s+(Number(c.puntaje)||0),0);
  const rows = criterios.map(c=>{const pts=Number(c.puntaje)||0;const pct=totalPts>0?Math.round((pts/totalPts)*100):0;return`<div class="bar-row"><div class="bar-header"><span class="bar-name">${esc(String(c.criterio||c.nombre||'Criterio'))}</span><span class="bar-pts">${pts} pts (${pct}%)</span></div>${c.descripcion?`<div class="bar-desc">${esc(String(c.descripcion))}</div>`:''}<div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div></div>`;}).join('');
  return `<section><div class="section-title">CRITERIOS DE ADJUDICACIÓN — TOTAL: ${totalPts} PTS</div><div style="padding:8px 10px">${rows}</div></section>`;
}

/** Renderiza cronograma con fechas formateadas y mensaje cuando está vacío */
function renderCronogramaPreliminar(fechas: AnyObj[]): string {
  if (!fechas.length) {
    return `<section><div class="section-title">FECHAS CLAVE</div><div style="padding:7px 10px;font-size:9.5px;color:#64748b;font-style:italic">Cronograma no extraído en análisis preliminar. Ejecutar análisis profundo para fechas completas.</div></section>`;
  }
  const hayIncompletas = fechas.some(f=>/XX/i.test(String(f.fecha||'')));
  const rows = fechas.map(f=>`<tr><td style="font-weight:700;color:#1e3a5f;white-space:nowrap;width:35%">${esc(formatFechaParcial(f.fecha))}</td><td>${esc(strVal(f.evento)||'—')}</td></tr>`).join('');
  return `<div class="page-break"></div><section><div class="section-title">FECHAS CLAVE</div>${hayIncompletas?`<div style="padding:3px 10px;font-size:8.5px;color:#92400e;background:#fffbeb">⚠ Algunas fechas no tienen día exacto especificado en el documento.</div>`:''}<table><thead><tr><th>Fecha</th><th>Hito</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

/** Lista de campos críticos pendientes de validación */
function renderCamposCriticosPendientes(r: AnyObj): string {
  const rh = r.requisitos_habilitantes || {};
  const criterios: AnyObj[] = arr(r.criterios_evaluacion);
  const pendientes: string[] = [];
  if (!r.presupuesto || Number(r.presupuesto) === 0) pendientes.push('Presupuesto oficial');
  if (!strVal(r.forma_pago)) pendientes.push('Forma de pago');
  if (!arr(r.fechas_clave).length) pendientes.push('Cronograma');
  if (!criterios.some(c=>Number(c.puntaje)>0)) pendientes.push('Criterios de adjudicación con puntaje numérico');
  if (!arr(r.garantias_polizas).length) pendientes.push('Garantías y pólizas');
  if (!arr(r.causales_rechazo_subsanacion).length) pendientes.push('Causales de rechazo');
  const totalReq=(rh.juridicos?.length||0)+(rh.financieros?.length||0)+(rh.tecnicos?.length||0)+(rh.organizacionales?.length||0);
  if (totalReq===0) pendientes.push('Requisitos habilitantes');
  pendientes.push('Minuta contractual (requiere análisis profundo)');
  if (!pendientes.length) return '';
  return `<section><div class="section-title" style="background:#475569">CAMPOS CRÍTICOS PENDIENTES DE VALIDACIÓN</div><div style="padding:7px 10px;background:#f8fafc">${pendientes.map(p=>`<div style="font-size:9.5px;color:#374151;padding:2px 0;border-bottom:1px solid #e5e7eb">• ${esc(p)}</div>`).join('')}<div style="font-size:8.5px;color:#64748b;margin-top:5px;font-style:italic">Ejecutar Análisis profundo o Análisis proceso completo para obtener estos datos con trazabilidad completa.</div></div></section>`;
}

// ── DETECCIÓN DE ANÁLISIS INCOMPLETO (normal) ──────────────────────────────────
function detectarIncompleto(r: AnyObj): string[] {
  const warn: string[] = [];
  if (!r.presupuesto || r.presupuesto === 0) warn.push('Presupuesto no identificado directamente');
  if (!strVal(r.plazo)) warn.push('Plazo de ejecución no identificado');
  if (!strVal(r.forma_pago)) warn.push('Forma de pago no identificada');
  const rh = r.requisitos_habilitantes || {};
  const totalReq = (rh.juridicos?.length||0)+(rh.financieros?.length||0)+(rh.tecnicos?.length||0)+(rh.organizacionales?.length||0);
  if (totalReq === 0) warn.push('Requisitos habilitantes no extraídos');
  if (!arr(r.garantias_polizas).length) warn.push('Garantías y pólizas no identificadas');
  if (!arr(r.causales_rechazo_subsanacion).length) warn.push('Causales de rechazo no identificadas');
  if (!arr(r.criterios_evaluacion).length) warn.push('Criterios de adjudicación no identificados');
  if (!arr(r.fechas_clave).length) warn.push('Cronograma no extraído');
  return warn;
}

// ── HTML PARA RESULTADO NORMAL (fallback) ─────────────────────────────────────
function generateHtmlNormal(r: AnyObj, nombre: string): string {
  const today = new Date().toLocaleDateString('es-CO', { day:'2-digit', month:'long', year:'numeric' });
  const rh = r.requisitos_habilitantes || {};
  const criterios: AnyObj[] = arr(r.criterios_evaluacion);
  const fechas: AnyObj[] = arr(r.fechas_clave);
  const alertas: AnyObj[] = arr(r.alertas);
  const warn = detectarIncompleto(r);

  const fichaRows = [
    ['Entidad contratante', strVal(r.entidad) || '—'],
    ['Tipo de proceso', strVal(r.tipo_proceso) || '—'],
    ['Objeto contractual', strVal(r.objeto) || '—'],
    ['Presupuesto oficial', formatPresupuestoPreliminar(r)],
    ['Plazo de ejecución', strVal(r.plazo) || 'No identificado en análisis preliminar'],
    ['Forma de pago', strVal(r.forma_pago) || 'No identificada en análisis preliminar'],
  ];
  function reqTable(items: string[], title: string) {
    if (!items?.length) return '';
    const nota = `<div style="padding:3px 10px 5px;font-size:8.5px;color:#64748b;font-style:italic;background:#f8fafc">⚠ Detalle sin trazabilidad completa. Ejecutar análisis profundo para página, numeral y texto literal.</div>`;
    return `<section><div class="section-title">${title}</div>${nota}<table><tbody>${items.map((t,i)=>`<tr><td style="width:22px;text-align:center;color:#9ca3af">${i+1}</td><td>${esc(t)}</td></tr>`).join('')}</tbody></table></section>`;
  }
  const sinIdentificar = (v: string) => v.startsWith('No identificad');
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Resumen IA — ${esc(nombre)}</title><style>${CSS}</style></head><body>
<div class="doc-header">
  <div class="doc-header-top"><div><div class="brand">LICYCOLBA</div><div class="brand-sub">Plataforma de Análisis de Licitaciones</div></div><div class="badge">RESUMEN PRELIMINAR</div></div>
  <div class="doc-title">Resumen Ejecutivo IA</div><div class="doc-subtitle">Análisis automático — resumen general</div>
  <div class="doc-date">Generado: ${today} &nbsp;|&nbsp; Documento: ${esc(nombre)}</div>
</div>
<div class="warn-banner">
  ⚠ <strong>Este resumen preliminar no reemplaza el análisis profundo.</strong> No debe usarse como decisión final de participación cuando existan campos críticos no identificados. Para extracción completa ejecute <strong>Análisis profundo</strong> o <strong>Análisis proceso completo</strong>.
  ${warn.length ? '<br><strong>Campos no identificados:</strong> ' + warn.map(w=>`<em>${esc(w)}</em>`).join(' · ') : ''}
</div>
${warn.length ? `<div class="incompleto-warn">⚠ ANÁLISIS INCOMPLETO — ${warn.length} campo(s) crítico(s) no identificados en análisis preliminar. Ver advertencias arriba.</div>` : ''}
${renderCamposCriticosPendientes(r)}
<section><div class="section-title">RESUMEN EJECUTIVO</div><p style="padding:7px 10px;line-height:1.6;font-size:10px;color:#374151">${esc(r.resumen||'—')}</p></section>
<section><div class="section-title">FICHA DEL PROCESO</div><table><tbody>${fichaRows.map(([l,v])=>`<tr><td class="ficha-label">${l}</td><td style="${sinIdentificar(v)?'color:#94a3b8;font-style:italic':''}">${esc(v)}</td></tr>`).join('')}</tbody></table></section>
${renderValoresEconomicosRelacionados(r)}
<section><div class="section-title">EVALUACIÓN PRELIMINAR</div><div style="padding:8px 10px">${semaforoDesdeNormal(r)}</div></section>
<div class="page-break"></div>
${renderCriteriosPreliminar(criterios)}
${reqTable(rh.juridicos||[],'REQUISITOS JURÍDICOS HABILITANTES')}
${reqTable(rh.financieros||[],'REQUISITOS FINANCIEROS HABILITANTES')}
${reqTable(rh.tecnicos||[],'REQUISITOS TÉCNICOS HABILITANTES')}
${reqTable(rh.organizacionales||[],'REQUISITOS ORGANIZACIONALES')}
${r.experiencia_requerida?`<section><div class="section-title">EXPERIENCIA REQUERIDA</div><p style="padding:7px 10px;font-size:10px">${esc(r.experiencia_requerida)}</p></section>`:''}
${renderCronogramaPreliminar(fechas)}
${alertas.length?`<div class="page-break"></div><section><div class="section-title">ALERTAS (${alertas.length})</div><div style="padding:8px 10px">${alertas.map(a=>`<div class="alert-box"><div class="alert-title">Observación</div><div class="alert-desc">${esc(String(a))}</div></div>`).join('')}</div></section>`:''}
${r.conclusion_viabilidad?`<section><div class="section-title">CONCLUSIÓN EJECUTIVA</div><div class="conclusion" style="margin:0;padding:10px 12px"><div class="conclusion-item">${esc(r.conclusion_viabilidad)}</div></div></section>`:''}
</body></html>`;
}

// ── HTML PARA RESULTADO PROFUNDO / PC ─────────────────────────────────────────
function generateHtmlProfundo(data: AnyObj, nombre: string, fuente: 'profundo'|'proceso_completo'): string {
  const today = new Date().toLocaleDateString('es-CO', { day:'2-digit', month:'long', year:'numeric' });
  const fuenteLabel = fuente === 'proceso_completo' ? 'ANÁLISIS PROCESO COMPLETO' : 'ANÁLISIS PROFUNDO';
  const vf = (data.validacion_final || {}) as AnyObj;
  const vc = (data.validacion_contractual || {}) as AnyObj;
  const alertas = arr(data.alertas);
  const minuta = (data.minuta_condiciones_contractuales || {}) as AnyObj;
  const totalMinutaItems = Object.values(minuta).reduce((acc:number, v:unknown)=>acc+(Array.isArray(v)?v.length:0),0);

  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${esc(fuenteLabel)} — ${esc(nombre)}</title><style>${CSS}</style></head><body>

<!-- ENCABEZADO -->
<div class="doc-header">
  <div class="doc-header-top"><div><div class="brand">LICYCOLBA</div><div class="brand-sub">Plataforma de Análisis de Licitaciones</div></div><div class="badge">${esc(fuenteLabel)}</div></div>
  <div class="doc-title">Análisis Completo de Contratación</div>
  <div class="doc-subtitle">Extracción profunda — requisitos, criterios, minuta y cláusulas contractuales</div>
  <div class="doc-date">Generado: ${today} &nbsp;|&nbsp; Documento: ${esc(nombre)}${data.bloques_procesados?` &nbsp;|&nbsp; ${data.bloques_procesados} bloques procesados`:''}</div>
</div>

<!-- SEMÁFORO -->
<section><div class="section-title">EVALUACIÓN INTEGRAL</div><div style="padding:8px 10px">${semaforoDesdeProf(data)}</div></section>

<!-- FICHA -->
${buildFichaProfundo(data)}

${vf.resumen_ejecutivo||vf.conclusion_viabilidad?`<section><div class="section-title">RESUMEN EJECUTIVO</div><p style="padding:7px 10px;font-size:10px;color:#374151;line-height:1.6">${esc(String(vf.resumen_ejecutivo||vf.conclusion_viabilidad||''))}</p></section>`:''}

<!-- CRONOGRAMA -->
${buildCronograma(arr(data.cronograma))}

<div class="page-break"></div>

<!-- REQUISITOS HABILITANTES -->
${renderItems(arr(data.requisitos_juridicos_habilitantes),'REQUISITOS JURÍDICOS HABILITANTES',{showClasif:true})}
${renderItems(arr(data.requisitos_financieros_habilitantes),'REQUISITOS FINANCIEROS HABILITANTES',{showClasif:true})}
${renderItems(arr(data.requisitos_tecnicos_habilitantes),'REQUISITOS TÉCNICOS HABILITANTES',{showClasif:true})}
${renderItems(arr(data.requisitos_organizacionales_habilitantes),'REQUISITOS ORGANIZACIONALES HABILITANTES',{showClasif:true})}
${renderItems(arr(data.experiencia_habilitante),'EXPERIENCIA HABILITANTE',{showClasif:true})}

<div class="page-break"></div>

<!-- CRITERIOS DE EVALUACIÓN -->
${renderItems(arr(data.criterios_evaluacion_puntaje),'CRITERIOS DE EVALUACIÓN Y PUNTAJE',{showNivel:false})}
${renderItems(arr(data.criterios_desempate),'CRITERIOS DE DESEMPATE',{showNivel:false})}
${renderItems(arr(data.especificaciones_tecnicas_servicio),'ESPECIFICACIONES TÉCNICAS DEL SERVICIO',{})}

<div class="page-break"></div>

<!-- CAUSALES DE RECHAZO -->
${renderItems(arr(data.causales_rechazo),'CAUSALES DE RECHAZO',{showClasif:true,showNivel:false})}
${renderItems(arr(data.reglas_subsanabilidad),'REGLAS DE SUBSANABILIDAD',{showNivel:false})}

<!-- GARANTÍAS -->
${buildGarantias(arr(data.garantias))}

<!-- RIESGOS CONTRACTUALES -->
${renderItems(arr(data.riesgos_contractuales),'RIESGOS CONTRACTUALES',{showClasif:true,showNivel:true})}

<!-- ALERTAS -->
${alertas.length?`<section><div class="section-title">ALERTAS Y ASPECTOS CRÍTICOS (${alertas.length})</div><div style="padding:8px 10px">${alertas.map((a:AnyObj)=>{const txt=String(getNombre(a)||a.descripcion_alerta||a);const anal=strVal(a.analisis_controlado||a.impacto_potencial);const fuente=a.fuente?fmtPag(a.fuente as AnyObj):'';return`<div class="alert-box"><div class="alert-title">${esc(strVal(a.tipo_alerta)||'Alerta')}</div><div class="alert-desc">${esc(txt)}</div>${anal?`<div style="font-size:9px;color:#374151;margin-top:3px">${esc(anal.slice(0,200))}</div>`:''} ${fuente?`<div class="fuente-tag">${esc(fuente)}</div>`:''}</div>`;}).join('')}</div></section>`:''}

<div class="page-break"></div>

<!-- ACUERDOS COMERCIALES / ANEXOS / MATRIZ -->
${renderItems(arr(data.acuerdos_comerciales),'ACUERDOS COMERCIALES',{})}
${renderItems(arr(data.anexos_formatos_matrices_formularios),'ANEXOS, FORMATOS Y MATRICES',{showNivel:false})}
${renderItems(arr(data.matriz_cumplimiento_documental),'MATRIZ DE CUMPLIMIENTO DOCUMENTAL',{showNivel:false})}

<div class="page-break"></div>

<!-- MINUTA CONTRACTUAL -->
${totalMinutaItems>0?buildMinutaCompleta(minuta):`<section><div class="section-title" style="background:#dc2626">MINUTA CONTRACTUAL — NO ENCONTRADA</div><div class="incompleto-warn" style="margin:0">No se encontraron cláusulas contractuales en el documento. Si el pliego incluye minuta, ejecuta nuevamente el análisis profundo.</div></section>`}

<!-- VALIDACIÓN CONTRACTUAL -->
${buildValidacionContractual(vc)}

<!-- VALIDACIÓN FINAL / CONCLUSIÓN -->
${Object.keys(vf).length?`<section>
  <div class="section-title">VALIDACIÓN FINAL Y CONCLUSIÓN</div>
  <div style="padding:8px 10px">
    ${vf.conclusion_viabilidad?`<div class="conclusion"><div class="conclusion-title">Conclusión ejecutiva</div><div class="conclusion-item">${esc(String(vf.conclusion_viabilidad))}</div></div>`:''}
    ${Object.entries(vf).filter(([k])=>k!=='conclusion_viabilidad'&&k!=='resumen_ejecutivo').map(([k,v])=>`<div class="conclusion-item"><span class="conclusion-lbl">${esc(k.replace(/_/g,' '))}:</span> ${esc(String(v).slice(0,300))}</div>`).join('')}
  </div>
</section>`:''}

</body></html>`;
}

// ── ROUTE HANDLER ─────────────────────────────────────────────────────────────

// ── RESUMEN EJECUTIVO EXPERTO ───────────────────────────────────────────
function buildResumenExperto(re: AnyObj): string {
  const campos: [string, string][] = [
    ['que_contrata', 'Qu\u00e9 contrata la entidad'],
    ['tipo_proponente', 'Tipo de proponente apto para participar'],
    ['puntos_sensibles', 'Puntos sensibles del proceso'],
    ['validaciones_previas', 'Validaciones previas antes de ofertar'],
    ['conclusion', 'Conclusi\u00f3n ejecutiva'],
  ];
  const paras = campos.map(([k, label]) => {
    const v = strVal(re[k]);
    if (!v || v.toUpperCase().includes('NO ENCONTRADO')) return '';
    return `<div style="margin-bottom:12px"><div style="font-size:8.5px;font-weight:700;color:#1e3a5f;letter-spacing:0.5px;margin-bottom:3px;text-transform:uppercase;border-left:3px solid #2563eb;padding-left:6px">${esc(label)}</div><p style="font-size:10.5px;color:#1f2937;line-height:1.75;margin:0;padding-left:9px">${esc(v)}</p></div>`;
  }).filter(Boolean);
  if (!paras.length) return '';
  return `<section>
    <div class="section-title">RESUMEN EJECUTIVO — CRITERIO EXPERTO</div>
    <div style="padding:14px 16px;background:#f8fafc">${paras.join('')}</div>
  </section>`;
}

// ── GARANTÍAS EXPERTO ───────────────────────────────────────────────
function buildGarantiasExperto(items: AnyObj[]): string {
  const noEnc = 'NO ENCONTRADO EN EL DOCUMENTO FUENTE';
  if (!items?.length) return `<section>
    <div class="section-title">GARANT\u00cdAS, P\u00d3LIZAS Y AMPAROS</div>
    <div class="incompleto-warn">Garant\u00edas y p\u00f3lizas: ${noEnc}</div>
  </section>`;

  function field(label: string, val: string) {
    if (!val) return '';
    const isNF = val.toUpperCase().includes('NO ENCONTRADO') || val.toUpperCase().includes('NO ESPECIFICADO');
    return `<tr><td class="ficha-label" style="width:36%;font-size:9px">${esc(label)}</td><td style="${isNF ? 'color:#94a3b8;font-style:italic' : ''};font-size:9.5px">${esc(val)}</td></tr>`;
  }

  const cards = items.map((item, i) => {
    const nombre = strVal(item.nombre_garantia || item.nombre || item.titulo) || '\u2014';
    const tipo = strVal(item.tipo_garantia);
    const monto = strVal(item.monto_cobertura) || noEnc;
    const plazo = strVal(item.plazo_vigencia) || noEnc;
    const momento = strVal(item.momento_entrega) || noEnc;
    const tomador = strVal(item.tomador) || noEnc;
    const asegurado = strVal(item.asegurado) || noEnc;
    const beneficiario = strVal(item.beneficiario) || noEnc;
    const objeto = strVal(item.objeto_asegurado) || noEnc;
    const comprobante = strVal(item.exige_comprobante_pago) || 'NO ESPECIFICADO EN EL DOCUMENTO';
    const plazoPoliza = strVal(item.plazo_entrega_poliza) || noEnc;
    const consecNoEnt = strVal(item.consecuencia_no_entrega) || noEnc;
    const consecInc = strVal(item.consecuencia_incumplimiento);
    const literal = strVal(item.texto_literal_pliego);
    const analisis = strVal(item.analisis_controlado);
    const fuente = item.fuente ? fmtPag(item.fuente as AnyObj) : '';
    return `<div style="margin-bottom:14px;border:1px solid #bfdbfe;border-radius:5px;overflow:hidden;page-break-inside:avoid;break-inside:avoid">
      <div style="background:#1e3a5f;color:#fff;padding:7px 12px;display:flex;align-items:center;gap:8px">
        <span style="font-weight:700;font-size:11px">${i + 1}. ${esc(nombre)}</span>
        ${tipo ? `<span style="font-size:8px;background:#2563eb;padding:2px 7px;border-radius:3px">${esc(tipo)}</span>` : ''}
      </div>
      <table style="width:100%;border-collapse:collapse"><tbody>
        ${field('Monto / Cobertura', monto)}
        ${field('Vigencia', plazo)}
        ${field('Momento de entrega', momento)}
        ${field('Tomador de la p\u00f3liza', tomador)}
        ${field('Asegurado', asegurado)}
        ${field('Beneficiario', beneficiario)}
        ${field('Objeto asegurado', objeto)}
        ${field('Exige comprobante de pago', comprobante)}
        ${field('Plazo para entregar p\u00f3liza', plazoPoliza)}
        ${field('Consecuencia si no se entrega', consecNoEnt)}
        ${field('Consecuencia de incumplimiento', consecInc)}
      </tbody></table>
      ${analisis ? `<div style="font-size:9px;color:#374151;margin:4px 10px 4px;line-height:1.5">${esc(analisis.slice(0, 350))}</div>` : ''}
      ${literal ? `<div class="literal-box" style="margin:4px 10px 6px">"${esc(literal.slice(0, 500))}"</div>` : ''}
      ${fuente ? `<div class="fuente-tag" style="padding:0 10px 7px">${esc(fuente)}</div>` : ''}
    </div>`;
  }).join('');

  return `<section>
    <div class="section-title">GARANT\u00cdAS, P\u00d3LIZAS Y AMPAROS (${items.length})</div>
    <div style="padding:10px 12px">${cards}</div>
  </section>`;
}

// ── INHABILIDADES E INCOMPATIBILIDADES ─────────────────────────────────────────
function buildInhabilidades(items: AnyObj[]): string {
  if (!items?.length) return '';
  const rows = items.map((item, i) => {
    const req = strVal(item.requisito || item.nombre || item.titulo) || '\u2014';
    const tipo = strVal(item.tipo);
    const literal = strVal(item.texto_literal_pliego);
    const docSoporte = strVal(item.documento_soporte);
    const impacto = strVal(item.impacto_practico || item.analisis_controlado);
    const nivel = strVal(item.nivel_riesgo);
    const fuente = item.fuente ? fmtPag(item.fuente as AnyObj) : '';
    return `<tr>
      <td style="width:22px;text-align:center;color:#9ca3af;font-size:9px">${i + 1}</td>
      <td>
        <div style="font-weight:700;color:#7c3aed;font-size:10px">${esc(req)}</div>
        <div style="display:flex;gap:5px;margin-top:2px;flex-wrap:wrap">
          ${tipo ? `<span style="background:#ede9fe;color:#5b21b6;font-size:7.5px;font-weight:700;padding:2px 6px;border-radius:3px">${esc(tipo)}</span>` : ''}
          ${nivel ? `<span class="tag-nivel ${nivel.toUpperCase().includes('ALTO') ? 'tag-alto' : nivel.toUpperCase().includes('MEDIO') ? 'tag-medio' : 'tag-bajo'}">${esc(nivel)}</span>` : ''}
        </div>
        ${impacto ? `<div style="font-size:9px;color:#374151;margin-top:3px;line-height:1.5">${esc(impacto.slice(0, 350))}</div>` : ''}
        ${docSoporte && !docSoporte.toUpperCase().includes('NO ENCONTRADO') ? `<div style="font-size:8.5px;color:#065f46;background:#ecfdf5;padding:2px 5px;border-radius:3px;margin-top:2px"><b>Doc soporte:</b> ${esc(docSoporte.slice(0, 180))}</div>` : ''}
        ${literal ? `<div class="literal-box">"${esc(literal.slice(0, 450))}"</div>` : ''}
        ${fuente ? `<div class="fuente-tag">${esc(fuente)}</div>` : ''}
      </td>
    </tr>`;
  }).join('');
  return `<section>
    <div class="section-title">INHABILIDADES E INCOMPATIBILIDADES (${items.length})</div>
    <table><thead><tr><th style="width:22px">#</th><th>Detalle</th></tr></thead><tbody>${rows}</tbody></table>
  </section>`;
}

// ── ESTAMPILLAS, IMPUESTOS Y RETENCIONES ─────────────────────────────────────────
function buildEstampillas(items: AnyObj[]): string {
  if (!items?.length) return '';
  const rows = items.map((item, i) => {
    const concepto = strVal(item.concepto || item.nombre) || '\u2014';
    const tipo = strVal(item.tipo);
    const porcentaje = strVal(item.porcentaje_o_valor);
    const base = strVal(item.base_calculo);
    const responsable = strVal(item.responsable_pago);
    const momento = strVal(item.momento_pago);
    const consecuencia = strVal(item.consecuencia_no_pago);
    const impacto = strVal(item.impacto_economico);
    const literal = strVal(item.texto_literal_pliego);
    const fuente = item.fuente ? fmtPag(item.fuente as AnyObj) : '';
    return `<tr>
      <td style="width:22px;text-align:center;color:#9ca3af;font-size:9px">${i + 1}</td>
      <td style="font-weight:700;color:#1e3a5f;font-size:10px;width:24%">${esc(concepto)}</td>
      <td style="font-size:8.5px;color:#64748b;width:12%">${esc(tipo || '\u2014')}</td>
      <td style="font-weight:700;color:#dc2626;width:12%">${esc(porcentaje || '\u2014')}</td>
      <td>
        ${base ? `<div style="font-size:8.5px;color:#374151"><b>Base:</b> ${esc(base)}</div>` : ''}
        ${responsable ? `<div style="font-size:8.5px;color:#374151"><b>Responsable:</b> ${esc(responsable)}</div>` : ''}
        ${momento ? `<div style="font-size:8.5px;color:#374151"><b>Momento:</b> ${esc(momento)}</div>` : ''}
        ${consecuencia ? `<div style="font-size:8.5px;color:#991b1b"><b>Consecuencia:</b> ${esc(consecuencia.slice(0, 150))}</div>` : ''}
        ${impacto ? `<div style="font-size:8.5px;color:#1e40af;background:#eff6ff;padding:2px 5px;border-radius:3px;margin-top:2px">${esc(impacto.slice(0, 200))}</div>` : ''}
        ${literal ? `<div class="literal-box">"${esc(literal.slice(0, 300))}"</div>` : ''}
        ${fuente ? `<div class="fuente-tag">${esc(fuente)}</div>` : ''}
      </td>
    </tr>`;
  }).join('');
  return `<section>
    <div class="section-title">ESTAMPILLAS, IMPUESTOS, TASAS Y RETENCIONES (${items.length})</div>
    <div style="font-size:8.5px;color:#64748b;padding:4px 10px;font-style:italic">Estos descuentos reducen el ingreso efectivo. Incluirlos en la estructura econ\u00f3mica de la propuesta.</div>
    <table><thead><tr><th style="width:22px">#</th><th>Concepto</th><th>Tipo</th><th>% / Valor</th><th>Detalle</th></tr></thead><tbody>${rows}</tbody></table>
  </section>`;
}

// ── CAUSALES DE RECHAZO EXPERTO ────────────────────────────────────────────
function buildCausalesRechazoExperto(items: AnyObj[]): string {
  if (!items?.length) return '';
  const rows = items.map((item, i) => {
    const nombre = strVal(item.nombre_causal || item.nombre || item.titulo) || '\u2014';
    const literal = strVal(item.texto_literal_pliego);
    const subsanable = strVal(item.subsanable);
    const consecuencia = strVal(item.consecuencia);
    const nivel = strVal(item.nivel_riesgo);
    const analisis = strVal(item.analisis_controlado);
    const accion = strVal(item.accion_preventiva);
    const fuente = item.fuente ? fmtPag(item.fuente as AnyObj) : '';
    const numeral = strVal(item.numeral);
    const subColor = subsanable === 'NO' ? 'background:#fef2f2;color:#b91c1c' : subsanable === 'S\u00cd' ? 'background:#f0fdf4;color:#166534' : 'background:#f8fafc;color:#64748b';
    return `<tr>
      <td style="width:22px;text-align:center;color:#9ca3af;font-size:9px">${i + 1}</td>
      <td>
        <div style="font-weight:700;color:#b91c1c;font-size:10px">${esc(nombre)}</div>
        ${numeral ? `<div style="font-size:8px;color:#6366f1;font-weight:600">${esc(numeral)}</div>` : ''}
        <div style="display:flex;gap:5px;margin-top:3px;flex-wrap:wrap">
          ${nivel ? `<span class="tag-nivel ${nivel.toUpperCase().includes('ALTO') ? 'tag-alto' : nivel.toUpperCase().includes('MEDIO') ? 'tag-medio' : 'tag-bajo'}">${esc(nivel)}</span>` : ''}
          ${subsanable ? `<span class="tag-nivel" style="${subColor}">${subsanable === 'NO' ? 'NO SUBSANABLE' : subsanable === 'S\u00cd' ? 'SUBSANABLE' : esc(subsanable)}</span>` : ''}
          ${consecuencia ? `<span class="tag-nivel" style="background:#fef2f2;color:#991b1b">${esc(consecuencia)}</span>` : ''}
        </div>
        ${analisis ? `<div style="font-size:9px;color:#374151;margin-top:3px;line-height:1.5">${esc(analisis.slice(0, 350))}</div>` : ''}
        ${accion ? `<div style="font-size:8.5px;color:#065f46;background:#ecfdf5;padding:2px 5px;border-radius:3px;margin-top:2px"><b>Acci\u00f3n preventiva:</b> ${esc(accion.slice(0, 200))}</div>` : ''}
        ${literal ? `<div class="literal-box">"${esc(literal.slice(0, 500))}"</div>` : ''}
        ${fuente ? `<div class="fuente-tag">${esc(fuente)}</div>` : ''}
      </td>
    </tr>`;
  }).join('');
  return `<section>
    <div class="section-title">CAUSALES DE RECHAZO (${items.length})</div>
    <div style="font-size:8.5px;color:#64748b;padding:4px 10px;font-style:italic">Cada causal listada de forma independiente seg\u00fan el pliego. Las causales NO SUBSANABLES implican rechazo directo de la oferta.</div>
    <table><thead><tr><th style="width:22px">#</th><th>Causal / Condici\u00f3n</th></tr></thead><tbody>${rows}</tbody></table>
  </section>`;
}

// ── TEMAS NO ENCONTRADOS ──────────────────────────────────────────────────────────────────
function buildTemasNoEncontrados(data: AnyObj): string {
  type Clasif = 'NO ENCONTRADO EN EL DOCUMENTO FUENTE' | 'NO DESARROLLADO EN EL DOCUMENTO FUENTE' | 'DOCUMENTO REFERENCIADO PERO NO SUMINISTRADO';
  const checks: Array<[string, Clasif]> = [];
  const hasItems = (key: string) => arr(data[key]).length > 0;
  const hasMinutaKey = (key: string) => { const m = (data.minuta_condiciones_contractuales || {}) as AnyObj; return arr(m[key]).length > 0; };
  const hasFichaField = (fld: string) => { const f = (data.ficha_general_proceso || {}) as AnyObj; const v = strVal(f[fld]); return v && !v.toUpperCase().includes('NO ENCONTRADO'); };

  if (!hasFichaField('forma_pago') && !hasMinutaKey('forma_pago')) checks.push(['Forma de pago del contrato', 'NO ENCONTRADO EN EL DOCUMENTO FUENTE']);
  if (!hasMinutaKey('multas') && !hasMinutaKey('multas_sanciones_clausula_penal')) checks.push(['R\u00e9gimen detallado de multas', 'NO ENCONTRADO EN EL DOCUMENTO FUENTE']);
  if (!hasMinutaKey('procedimiento_multas_sanciones')) checks.push(['Procedimiento sancionatorio (Art. 86 Ley 1474)', 'NO ENCONTRADO EN EL DOCUMENTO FUENTE']);
  if (!hasMinutaKey('pena_pecuniaria_clausula_penal')) checks.push(['Monto espec\u00edfico de cl\u00e1usula penal pecuniaria', 'NO ENCONTRADO EN EL DOCUMENTO FUENTE']);
  const tieneGarantias = hasItems('garantias') || hasMinutaKey('garantias_contractuales') || hasMinutaKey('polizas_requisitos_pago');
  if (!tieneGarantias) checks.push(['Garant\u00edas y p\u00f3lizas (seriedad, cumplimiento)', 'NO ENCONTRADO EN EL DOCUMENTO FUENTE']);
  else if (!arr(data.garantias).some((g: AnyObj) => strVal(g.exige_comprobante_pago) === 'S\u00cd')) checks.push(['Comprobante de pago de p\u00f3liza: exigencia expl\u00edcita', 'NO ENCONTRADO EN EL DOCUMENTO FUENTE']);
  if (!hasMinutaKey('ans_niveles_servicio')) checks.push(['ANS / SLA / Niveles de servicio', 'NO ENCONTRADO EN EL DOCUMENTO FUENTE']);
  if (!hasItems('riesgos_contractuales')) checks.push(['Matriz de riesgos contractuales', 'NO ENCONTRADO EN EL DOCUMENTO FUENTE']);
  if (!hasItems('requisitos_financieros_habilitantes')) checks.push(['Indicadores financieros habilitantes', 'NO ENCONTRADO EN EL DOCUMENTO FUENTE']);
  if (!arr(data.criterios_evaluacion_puntaje).some((c: AnyObj) => Number(c.puntaje_maximo) > 0)) checks.push(['Puntajes t\u00e9cnicos detallados', 'NO ENCONTRADO EN EL DOCUMENTO FUENTE']);
  if (!hasItems('cronograma')) checks.push(['Cronograma del proceso', 'NO ENCONTRADO EN EL DOCUMENTO FUENTE']);
  if (!hasMinutaKey('estabilidad_laboral_personal')) checks.push(['Estabilidad laboral / personal m\u00ednimo', 'NO ENCONTRADO EN EL DOCUMENTO FUENTE']);
  if (!hasItems('estampillas_impuestos_retenciones')) checks.push(['Estampillas, impuestos y retenciones', 'NO ENCONTRADO EN EL DOCUMENTO FUENTE']);
  if (!hasItems('inhabilidades_incompatibilidades')) checks.push(['R\u00e9gimen de inhabilidades e incompatibilidades', 'NO ENCONTRADO EN EL DOCUMENTO FUENTE']);
  const minuta = (data.minuta_condiciones_contractuales || {}) as AnyObj;
  const totalM = Object.values(minuta).reduce((a: number, v: unknown) => a + (Array.isArray(v) ? (v as unknown[]).length : 0), 0);
  if (totalM === 0) checks.push(['Minuta contractual completa', 'NO ENCONTRADO EN EL DOCUMENTO FUENTE']);

  const yaListados = new Set(checks.map(([t]) => t.toLowerCase()));
  const temasIA = Array.isArray(data.temas_no_encontrados_o_no_desarrollados) ? data.temas_no_encontrados_o_no_desarrollados as unknown[] : [];
  for (const tema of temasIA) {
    const t = String(tema || '').trim();
    if (t && !yaListados.has(t.toLowerCase())) { checks.push([t, 'NO ENCONTRADO EN EL DOCUMENTO FUENTE']); yaListados.add(t.toLowerCase()); }
  }

  if (!checks.length) return `<section>
    <div class="section-title" style="background:#166534">VALIDACI\u00d3N FINAL — COBERTURA COMPLETA</div>
    <div style="padding:10px 14px;background:#f0fdf4;font-size:10px;color:#166534;font-weight:600">\u2713 Todos los temas principales fueron identificados en los documentos analizados.</div>
  </section>`;

  const bgC: Record<string, string> = {
    'NO ENCONTRADO EN EL DOCUMENTO FUENTE': '#fef2f2',
    'NO DESARROLLADO EN EL DOCUMENTO FUENTE': '#fffbeb',
    'DOCUMENTO REFERENCIADO PERO NO SUMINISTRADO': '#eff6ff',
  };
  const txC: Record<string, string> = {
    'NO ENCONTRADO EN EL DOCUMENTO FUENTE': '#991b1b',
    'NO DESARROLLADO EN EL DOCUMENTO FUENTE': '#92400e',
    'DOCUMENTO REFERENCIADO PERO NO SUMINISTRADO': '#1e5799',
  };
  return `<section>
    <div class="section-title" style="background:#64748b">TEMAS NO ENCONTRADOS O NO DESARROLLADOS (${checks.length})</div>
    <div style="padding:5px 10px;font-size:8.5px;color:#64748b;font-style:italic">Temas buscados exhaustivamente en los documentos. No aparecen o no est\u00e1n desarrollados. Validar antes de ofertar.</div>
    <table><thead><tr><th style="width:22px">#</th><th>Tema</th><th style="width:42%">Clasificaci\u00f3n</th></tr></thead><tbody>
      ${checks.map(([tema, clasif], i) => `<tr>
        <td style="width:22px;text-align:center;color:#9ca3af;font-size:9px">${i + 1}</td>
        <td style="font-size:9.5px;color:#374151;font-weight:600">${esc(tema)}</td>
        <td><span style="background:${bgC[clasif]};color:${txC[clasif]};font-size:7.5px;font-weight:700;padding:2px 7px;border-radius:3px;display:inline-block">${esc(clasif)}</span></td>
      </tr>`).join('')}
    </tbody></table>
  </section>`;
}

// ── INFORME EXPERTO DE PLIEGO ──────────────────────────────────────────────────────────────────
function generateHtmlInformeExperto(data: AnyObj, nombre: string): string {
  const today = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
  const f = (data.ficha_general_proceso || {}) as AnyObj;
  const re = (data.resumen_ejecutivo_experto || {}) as AnyObj;
  const vf = (data.validacion_final || {}) as AnyObj;
  const alertas = arr(data.alertas);
  const minuta = (data.minuta_condiciones_contractuales || {}) as AnyObj;
  const totalMinutaItems = Object.values(minuta).reduce((a: number, v: unknown) => a + (Array.isArray(v) ? (v as unknown[]).length : 0), 0);

  const fichaRows: [string, string][] = [
    ['Entidad contratante', strVal(f.entidad_contratante || f.entidad || data.entidad) || '\u2014'],
    ['N.\u00b0 / C\u00f3digo de proceso', strVal(f.numero_proceso || f.codigo_proceso || data.codigo_proceso) || '\u2014'],
    ['Modalidad de selecci\u00f3n', strVal(f.modalidad_seleccion || f.tipo_proceso) || '\u2014'],
    ['Tipo de documento', strVal(f.tipo_documento) || '\u2014'],
    ['Objeto contractual', strVal(f.objeto_contractual || f.objeto || data.objeto) || '\u2014'],
    ['Presupuesto oficial', fmtCOP(f.presupuesto_oficial ?? f.presupuesto ?? data.presupuesto)],
    ['Plazo de ejecuci\u00f3n', strVal(f.plazo_ejecucion || f.plazo) || '\u2014'],
    ['Lugar de ejecuci\u00f3n', strVal(f.lugar_ejecucion) || '\u2014'],
    ['Factor de selecci\u00f3n', strVal(f.factor_seleccion) || '\u2014'],
    ['Plataforma', strVal(f.plataforma) || '\u2014'],
    ['Supervisi\u00f3n / Interventor\u00eda', strVal(f.supervision_interventoria) || '\u2014'],
    ['Forma de pago', strVal(f.forma_pago) || '\u2014'],
    ['Fecha l\u00edmite de ofertas', strVal(f.fecha_presentacion_ofertas || f.fecha_limite_ofertas) || '\u2014'],
    ['Documentos externos referenciados', strVal(f.documentos_externos_referenciados) || '\u2014'],
  ];

  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Informe Experto — ${esc(nombre)}</title><style>${CSS}</style></head><body>

<div class="doc-header">
  <div class="doc-header-top">
    <div><div class="brand">LICYCOLBA</div><div class="brand-sub">Plataforma de An\u00e1lisis de Licitaciones \u00b7 Grupo Colba</div></div>
    <div class="badge">AN\u00c1LISIS \u00daNICO EXPERTO</div>
  </div>
  <div class="doc-title">Informe Experto de An\u00e1lisis de Pliego</div>
  <div class="doc-subtitle">An\u00e1lisis \u00fanico experto \u2014 extracci\u00f3n completa con criterio de comit\u00e9 experto en contrataci\u00f3n estatal colombiana</div>
  <div class="doc-date">Generado: ${today} &nbsp;|&nbsp; Documento: ${esc(nombre)}${data.bloques_procesados ? ` &nbsp;|&nbsp; ${data.bloques_procesados} bloques procesados` : ''}</div>
</div>

<section><div class="section-title">EVALUACI\u00d3N INTEGRAL</div><div style="padding:8px 10px">${semaforoDesdeProf(data)}</div></section>

<section>
  <div class="section-title">1. IDENTIFICACI\u00d3N GENERAL DEL PROCESO</div>
  <table><tbody>${fichaRows.map(([l, v]) => `<tr><td class="ficha-label">${esc(l)}</td><td style="${v === '\u2014' ? 'color:#94a3b8;font-style:italic' : ''}">${esc(v)}</td></tr>`).join('')}</tbody></table>
</section>

${renderItems(arr(data.unspsc), 'CLASIFICACI\u00d3N UNSPSC', { showNivel: false })}

${(() => { const cs = (data.comunicaciones_secop || {}) as AnyObj; const vals = [strVal(cs.canal_oficial), strVal(cs.plataforma), strVal(cs.correo_notificaciones), strVal(cs.plazo_respuesta_preguntas)]; if (!vals.some(Boolean)) return ''; return `<section><div class="section-title">COMUNICACIONES Y SECOP</div><table><tbody>
  <tr><td class="ficha-label">Canal oficial</td><td>${esc(vals[0] || '\u2014')}</td></tr>
  <tr><td class="ficha-label">Plataforma</td><td>${esc(vals[1] || '\u2014')}</td></tr>
  <tr><td class="ficha-label">Correo notificaciones</td><td>${esc(vals[2] || '\u2014')}</td></tr>
  <tr><td class="ficha-label">Plazo respuesta preguntas</td><td>${esc(vals[3] || '\u2014')}</td></tr>
  </tbody></table></section>`; })()}

${buildResumenExperto(re)}

${buildCronograma(arr(data.cronograma))}

<div class="page-break"></div>

${renderItems(arr(data.requisitos_juridicos_habilitantes), '2. REQUISITOS JUR\u00cdDICOS HABILITANTES', { showClasif: true })}
${renderItems(arr(data.requisitos_financieros_habilitantes), '3. REQUISITOS FINANCIEROS HABILITANTES', { showClasif: true })}
${renderItems(arr(data.requisitos_tecnicos_habilitantes), '4. REQUISITOS T\u00c9CNICOS HABILITANTES', { showClasif: true })}
${renderItems(arr(data.requisitos_organizacionales_habilitantes), '5. REQUISITOS ORGANIZACIONALES HABILITANTES', { showClasif: true })}
${renderItems(arr(data.experiencia_habilitante), '6. EXPERIENCIA HABILITANTE', { showClasif: true })}

<div class="page-break"></div>

${renderItems(arr(data.especificaciones_tecnicas_servicio), '7. ESPECIFICACIONES T\u00c9CNICAS DEL SERVICIO', {})}

${renderItems(arr(data.reglas_subsanabilidad), '8. SUBSANABILIDAD \u2014 REGLAS Y CONSECUENCIAS', { showNivel: false })}

${buildCausalesRechazoExperto(arr(data.causales_rechazo))}

<div class="page-break"></div>

${buildGarantiasExperto(arr(data.garantias))}

${buildInhabilidades(arr(data.inhabilidades_incompatibilidades))}

<div class="page-break"></div>

${renderItems(arr(data.criterios_evaluacion_puntaje), '9. CRITERIOS DE EVALUACI\u00d3N Y PUNTAJE', { showNivel: false })}
${renderItems(arr(data.criterios_desempate), '10. CRITERIOS DE DESEMPATE', { showNivel: false })}

${buildEstampillas(arr(data.estampillas_impuestos_retenciones))}

${renderItems(arr(data.riesgos_contractuales), '11. RIESGOS CONTRACTUALES', { showClasif: true, showNivel: true })}
${renderItems(arr(data.declaratoria_desierta), '11B. DECLARATORIA DESIERTA', { showNivel: false })}

<div class="page-break"></div>

${totalMinutaItems > 0 ? buildMinutaCompleta(minuta) : '<section><div class="section-title" style="background:#dc2626">12. MINUTA CONTRACTUAL \u2014 NO ENCONTRADA EN EL DOCUMENTO FUENTE</div><div class="incompleto-warn" style="margin:0">La minuta contractual no fue encontrada en los documentos analizados. Puede estar referenciada como documento externo no suministrado. Validar en SECOP o solicitarla a la entidad antes de presentar oferta.</div></section>'}

${(() => { const fp = (data.forma_pago_reajuste_facturacion || {}) as AnyObj; const vals = [strVal(fp.forma_pago), strVal(fp.reajuste_aplica), strVal(fp.formula_reajuste), strVal(fp.periodicidad_facturacion), strVal(fp.valor_mensual_promedio_facturacion)]; if (!vals.some(Boolean)) return ''; return `<section><div class="section-title">12B. FORMA DE PAGO, REAJUSTE Y FACTURACI\u00d3N</div><table><tbody>
  <tr><td class="ficha-label">Forma de pago</td><td>${esc(vals[0] || '\u2014')}</td></tr>
  <tr><td class="ficha-label">\u00bfAplica reajuste?</td><td>${esc(vals[1] || '\u2014')}</td></tr>
  <tr><td class="ficha-label">F\u00f3rmula de reajuste</td><td>${esc(vals[2] || '\u2014')}</td></tr>
  <tr><td class="ficha-label">Periodicidad de facturaci\u00f3n</td><td>${esc(vals[3] || '\u2014')}</td></tr>
  <tr><td class="ficha-label">Valor mensual promedio de facturaci\u00f3n</td><td>${esc(vals[4] || '\u2014')}</td></tr>
  </tbody></table></section>`; })()}

<div class="page-break"></div>

${renderItems(arr(data.mano_obra_personal_perfiles), '12C. MANO DE OBRA, EQUIPO DE TRABAJO Y PERFILES', { showNivel: false })}
${renderItems(arr(data.insumos_equipos_dotacion_epp_examenes), '12D. INSUMOS, EQUIPOS, DOTACI\u00d3N, EPP Y EX\u00c1MENES M\u00c9DICOS', { showNivel: false })}
${renderItems(arr(data.supervision_ans_tiempos_respuesta), '12E. SUPERVISI\u00d3N, ANS Y TIEMPOS DE RESPUESTA', {})}

<div class="page-break"></div>

${renderItems(arr(data.anexos_formatos_matrices_formularios), '13. ANEXOS Y FORMATOS', { showNivel: false })}
${renderItems(arr(data.acuerdos_comerciales), '14. ACUERDOS COMERCIALES', {})}
${renderItems(arr(data.documentos_externos_referenciados), '14B. DOCUMENTOS EXTERNOS REFERENCIADOS', { showNivel: false })}

${alertas.length ? `<section><div class="section-title">15. ALERTAS Y ASPECTOS CR\u00cdTICOS (${alertas.length})</div><div style="padding:8px 10px">${alertas.map((a: AnyObj) => { const txt = String(getNombre(a) || a.descripcion_alerta || a); const anal = strVal(a.analisis_controlado || a.impacto_potencial); const accion = strVal(a.accion_recomendada); const fuente = a.fuente ? fmtPag(a.fuente as AnyObj) : ''; const nivel = strVal(a.nivel_riesgo); return `<div class="alert-box" style="border-color:${nivelColor(nivel)}"><div class="alert-title" style="color:${nivelColor(nivel)}">${esc(strVal(a.tipo_alerta) || 'Alerta')}${nivel ? ` \u2014 ${esc(nivel)}` : ''}</div><div class="alert-desc">${esc(txt)}</div>${anal ? `<div style="font-size:9px;color:#374151;margin-top:3px;line-height:1.5">${esc(anal.slice(0, 280))}</div>` : ''}${accion ? `<div style="font-size:8.5px;color:#065f46;background:#ecfdf5;padding:2px 5px;border-radius:3px;margin-top:2px"><b>Acci\u00f3n:</b> ${esc(accion.slice(0, 200))}</div>` : ''}${fuente ? `<div class="fuente-tag">${esc(fuente)}</div>` : ''}</div>`; }).join('')}</div></section>` : ''}

<div class="page-break"></div>

${buildTemasNoEncontrados(data)}

${buildValidacionContractual((data.validacion_contractual || {}) as AnyObj)}

${Object.keys(vf).length ? `<section>
  <div class="section-title">16. CONCLUSI\u00d3N EJECUTIVA</div>
  <div style="padding:10px 14px">
    ${vf.conclusion_viabilidad ? `<div class="conclusion"><div class="conclusion-title">Conclusi\u00f3n de viabilidad</div><div class="conclusion-item" style="font-size:10.5px;line-height:1.75">${esc(String(vf.conclusion_viabilidad))}</div></div>` : ''}
    ${(vf.resumen_ejecutivo || vf.observacion_final) ? `<div class="conclusion" style="margin-top:8px"><div class="conclusion-item" style="font-size:10px;line-height:1.6">${esc(String(vf.resumen_ejecutivo || vf.observacion_final || ''))}</div></div>` : ''}
  </div>
</section>` : ''}

</body></html>`;
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  let body: { resultado?: AnyObj; resultadoProfundo?: AnyObj; resultadoPC?: AnyObj; nombre?: string; analisisId?: number };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Body inválido' }, { status: 400 }); }

  let { resultado, resultadoProfundo, resultadoPC, nombre = 'Documento' } = body;
  let html: string;

  try {
    // Si viene analisisId, se lee el resultado desde la BD (evita mandar el JSON
    // completo del análisis desde el cliente, que puede superar límites de payload
    // en análisis únicos expertos con muchos documentos/bloques).
    if (body.analisisId) {
      const usuarioId = await resolveSessionUserId(session!);
      if (usuarioId === null) return NextResponse.json({ error: 'Sesión inválida.' }, { status: 401 });

      const registro = await prisma.lecturaAnalisis.findUnique({ where: { id: body.analisisId } });
      if (!registro) return NextResponse.json({ error: 'Análisis no encontrado.' }, { status: 404 });

      const modo = registro.modo || '';
      const res = registro.resultado as AnyObj;

      // Si el análisis trae un PDF de descarga incrustado (caso puntual: el usuario
      // subió su propio informe y pidió que "Descargar" entregue exactamente ese
      // archivo), se sirve directo sin pasar por Puppeteer/generación de HTML.
      const pdfDescargaBase64 = typeof res?.pdfDescargaBase64 === 'string' ? res.pdfDescargaBase64 as string : null;
      if (pdfDescargaBase64) {
        const nombreDescarga = (body.nombre || registro.nombreDocumento || 'Documento').replace(/[\\/:*?"<>|]/g, '_');
        void auditFromRequest(req, session, { accion: 'export_pdf', recurso: 'export_pdf', detalle: { nombre: nombreDescarga, modo: 'pdf_incrustado', analisisId: body.analisisId ?? null } });
        return new NextResponse(new Uint8Array(Buffer.from(pdfDescargaBase64, 'base64')), {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${nombreDescarga}.pdf"`,
          },
        });
      }

      if (modo === 'proceso_completo' || modo === 'analisis_unico_experto') resultadoPC = res;
      else if (modo === 'profundo') resultadoProfundo = res;
      else resultado = res;
      nombre = body.nombre || registro.nombreDocumento || nombre;
    } else {
      // Sin analisisId: se acepta el JSON directo en el body, limitado a 2 MB para evitar abuso.
      const contentLength = Number(req.headers.get('content-length') ?? 0);
      if (contentLength > 2 * 1024 * 1024) {
        return NextResponse.json({ error: 'Payload demasiado grande. Vuelve a intentar desde un análisis guardado.' }, { status: 413 });
      }
    }

    if (!resultado && !resultadoProfundo && !resultadoPC) {
      return NextResponse.json({ error: 'Sin resultado' }, { status: 400 });
    }

    // Prioridad: proceso_completo → profundo → normal
    if (resultadoPC && typeof resultadoPC === 'object') {
      html = generateHtmlInformeExperto(resultadoPC, nombre);
    } else if (resultadoProfundo && typeof resultadoProfundo === 'object') {
      html = generateHtmlProfundo(resultadoProfundo, nombre, 'profundo');
    } else {
      html = generateHtmlNormal(resultado!, nombre);
    }
  } catch (err) {
    console.error('[export-pdf] Error preparando el HTML:', err);
    return NextResponse.json({ error: err instanceof Error ? `Error preparando el informe: ${err.message}` : 'Error preparando el informe.' }, { status: 500 });
  }

  let pdfBuffer: Buffer;
  try {
    console.log(`[export-pdf] HTML generado: ${html.length} caracteres`);
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.default.launch({
      headless: true,
      protocolTimeout: 180_000,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load', timeout: 120_000 });
    pdfBuffer = Buffer.from(await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      timeout: 120_000,
    }));
    await browser.close();
  } catch (err) {
    console.error('[export-pdf] Error generando el PDF con Puppeteer:', err);
    return NextResponse.json({ error: err instanceof Error ? `Error generando el PDF: ${err.message}` : 'Error generando el PDF.' }, { status: 500 });
  }

  const nombreSafe = nombre.replace(/[\\/:*?"<>|]/g, '_');
  void auditFromRequest(req, session, { accion: 'export_pdf', recurso: 'export_pdf', detalle: { nombre, modo: resultadoPC ? 'proceso_completo' : resultadoProfundo ? 'profundo' : 'normal', analisisId: body.analisisId ?? null } });
  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Analisis_IA_${nombreSafe}.pdf"`,
    },
  });
}