"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronDown, CalendarDays } from "lucide-react";

// ─────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────
export type TipoEvento = "cierre" | "audiencia" | "entrega" | "visita" | "otro";

export interface EventoCronograma {
  id: string;
  titulo: string;
  /** ISO string: "2026-06-12T09:00:00" */
  inicio: string;
  /** ISO string */
  fin: string;
  tipo: TipoEvento;
  empresa: "Aseocolba" | "Vigicolba" | "Tempocolba" | "Transcolba";
  responsable?: string;
  completado?: boolean;
}

type Vista = "dia" | "semana" | "mes";

// ─────────────────────────────────────────────────────────────
// Configuración visual
// ─────────────────────────────────────────────────────────────
const COLOR_EMPRESA: Record<string, string> = {
  Aseocolba: "#1e3a8a",
  Vigicolba: "#dc2626",
  Tempocolba: "#2563eb",
  Transcolba: "#0e9488",
};

const TIPOS: { id: TipoEvento | "todos"; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "cierre", label: "Cierres" },
  { id: "audiencia", label: "Audiencias" },
  { id: "entrega", label: "Entregas" },
  { id: "visita", label: "Visitas" },
];

const HORA_INICIO = 6;
const HORA_FIN = 19;
const ALTO_HORA = 64;

const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

// ─────────────────────────────────────────────────────────────
// Utilidades de fecha
// ─────────────────────────────────────────────────────────────
function inicioSemana(d: Date): Date {
  const r = new Date(d);
  r.setDate(r.getDate() - r.getDay());
  r.setHours(0, 0, 0, 0);
  return r;
}
function mismoDia(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function fmtHora(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

// ─────────────────────────────────────────────────────────────
// Datos de ejemplo — reemplazar con datos de Prisma
// ─────────────────────────────────────────────────────────────
function demoEventos(): EventoCronograma[] {
  const hoy = new Date();
  const base = inicioSemana(hoy);
  const mk = (dia: number, h: number, m: number, durMin: number) => {
    const i = new Date(base);
    i.setDate(i.getDate() + dia);
    i.setHours(h, m, 0, 0);
    const f = new Date(i.getTime() + durMin * 60000);
    return { inicio: i.toISOString(), fin: f.toISOString() };
  };
  return [
    { id: "1", titulo: "Cierre SECOP — Aseo hospitalario", tipo: "cierre", empresa: "Aseocolba", responsable: "juan.davila", ...mk(1, 9, 0, 60) },
    { id: "2", titulo: "Audiencia adjudicación — Vigilancia CCTV", tipo: "audiencia", empresa: "Vigicolba", responsable: "nicole.ortiz", ...mk(1, 11, 0, 90) },
    { id: "3", titulo: "Entrega propuesta — Temporales planta", tipo: "entrega", empresa: "Tempocolba", responsable: "juan.davila", ...mk(2, 8, 30, 60) },
    { id: "4", titulo: "Visita técnica obligatoria", tipo: "visita", empresa: "Vigicolba", responsable: "nicole.ortiz", ...mk(3, 10, 0, 120) },
    { id: "5", titulo: "Cierre proceso NC-2026-114", tipo: "cierre", empresa: "Transcolba", responsable: "juan.davila", ...mk(3, 14, 0, 60) },
    { id: "6", titulo: "Subsanación documentos", tipo: "entrega", empresa: "Aseocolba", responsable: "juan.davila", ...mk(4, 9, 0, 90), completado: true },
    { id: "7", titulo: "Audiencia de riesgos", tipo: "audiencia", empresa: "Aseocolba", responsable: "juan.davila", ...mk(5, 8, 0, 60) },
    { id: "8", titulo: "Cierre — Transporte especial", tipo: "cierre", empresa: "Transcolba", responsable: "juan.davila", ...mk(5, 16, 0, 60) },
  ];
}

// ─────────────────────────────────────────────────────────────
// Chip de evento dentro de la grilla
// ─────────────────────────────────────────────────────────────
function EventoChip({ ev, compacto }: { ev: EventoCronograma; compacto?: boolean }) {
  const color = COLOR_EMPRESA[ev.empresa];
  return (
    <div
      style={{
        backgroundColor: "#fff",
        border: "1px solid #eef2f6",
        borderRadius: 8,
        padding: compacto ? "2px 6px" : "4px 8px",
        boxShadow: "0 1px 3px rgba(16,24,40,0.08)",
        display: "flex",
        alignItems: "center",
        gap: 6,
        overflow: "hidden",
        cursor: "pointer",
        height: "100%",
      }}
      title={`${ev.titulo} · ${ev.empresa}${ev.responsable ? " · " + ev.responsable : ""}`}
    >
      <span
        style={{
          width: 3,
          alignSelf: "stretch",
          borderRadius: 2,
          backgroundColor: color,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontSize: 11.5,
          fontWeight: 600,
          color: ev.completado ? "#94a3b8" : "#1e293b",
          textDecoration: ev.completado ? "line-through" : "none",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          overflow: "hidden",
        }}
      >
        {ev.titulo}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Vista semana / día (grilla horaria)
// ─────────────────────────────────────────────────────────────
function GrillaHoraria({
  eventos,
  dias,
}: {
  fecha: Date;
  eventos: EventoCronograma[];
  dias: Date[];
}) {
  const ahora = new Date();
  const horas = Array.from({ length: HORA_FIN - HORA_INICIO + 1 }, (_, i) => HORA_INICIO + i);
  const lineaAhoraTop =
    (ahora.getHours() + ahora.getMinutes() / 60 - HORA_INICIO) * ALTO_HORA;
  const mostrarLinea =
    lineaAhoraTop >= 0 && lineaAhoraTop <= (HORA_FIN - HORA_INICIO) * ALTO_HORA;

  return (
    <div style={{ display: "flex", flex: 1, overflow: "auto", position: "relative" }}>
      {/* Columna de horas */}
      <div style={{ width: 64, flexShrink: 0 }}>
        <div style={{ height: 44 }} />
        {horas.map((h) => (
          <div
            key={h}
            style={{
              height: ALTO_HORA,
              fontSize: 11,
              color: "#94a3b8",
              textAlign: "right",
              paddingRight: 10,
              transform: "translateY(-6px)",
            }}
          >
            {h % 12 === 0 ? 12 : h % 12} {h >= 12 ? "PM" : "AM"}
          </div>
        ))}
      </div>

      {/* Columnas de días */}
      <div style={{ display: "flex", flex: 1, minWidth: dias.length * 130 }}>
        {dias.map((dia, di) => {
          const esHoy = mismoDia(dia, ahora);
          const esFinde = dia.getDay() === 0 || dia.getDay() === 6;
          const evsDia = eventos.filter((e) => mismoDia(new Date(e.inicio), dia));

          return (
            <div
              key={di}
              style={{ flex: 1, borderLeft: "1px solid #eef2f6", position: "relative" }}
            >
              {/* Encabezado del día */}
              <div
                style={{
                  height: 44,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  position: "sticky",
                  top: 0,
                  backgroundColor: "#fff",
                  zIndex: 5,
                  borderBottom: "1px solid #eef2f6",
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: esHoy ? 800 : 600,
                    color: esHoy ? "#1e3a8a" : "#475569",
                  }}
                >
                  {DIAS[dia.getDay()]} {dia.getDate()}
                </span>
                {esHoy && (
                  <span
                    style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: "#1e3a8a" }}
                  />
                )}
              </div>

              {/* Fondo de horas */}
              <div
                style={{
                  position: "relative",
                  backgroundImage: esFinde
                    ? "repeating-linear-gradient(45deg, #fafbfc 0px, #fafbfc 6px, #f4f6f8 6px, #f4f6f8 7px)"
                    : "none",
                }}
              >
                {horas.map((h) => (
                  <div key={h} style={{ height: ALTO_HORA, borderBottom: "1px solid #f4f6f8" }} />
                ))}

                {/* Línea de hora actual */}
                {esHoy && mostrarLinea && (
                  <div
                    style={{
                      position: "absolute",
                      top: lineaAhoraTop,
                      left: 0,
                      right: 0,
                      height: 2,
                      backgroundColor: "#dc2626",
                      zIndex: 4,
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        left: -4,
                        top: -3,
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        backgroundColor: "#dc2626",
                      }}
                    />
                  </div>
                )}

                {/* Eventos */}
                {evsDia.map((ev) => {
                  const i = new Date(ev.inicio);
                  const f = new Date(ev.fin);
                  const top = (i.getHours() + i.getMinutes() / 60 - HORA_INICIO) * ALTO_HORA;
                  const alto = Math.max(
                    26,
                    ((f.getTime() - i.getTime()) / 3600000) * ALTO_HORA - 4
                  );
                  return (
                    <div
                      key={ev.id}
                      style={{ position: "absolute", top, left: 4, right: 4, height: alto, zIndex: 3 }}
                    >
                      <EventoChip ev={ev} compacto={alto < 40} />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Vista mes
// ─────────────────────────────────────────────────────────────
function VistaMes({ fecha, eventos }: { fecha: Date; eventos: EventoCronograma[] }) {
  const ahora = new Date();
  const primerDia = new Date(fecha.getFullYear(), fecha.getMonth(), 1);
  const inicio = inicioSemana(primerDia);
  const celdas = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(inicio);
    d.setDate(d.getDate() + i);
    return d;
  });

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto" }}>
      {/* Encabezados */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
        {DIAS.map((d) => (
          <div
            key={d}
            style={{
              padding: "10px 0",
              textAlign: "center",
              fontSize: 12,
              fontWeight: 700,
              color: "#94a3b8",
              borderBottom: "1px solid #eef2f6",
            }}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Celdas */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gridAutoRows: "minmax(96px, 1fr)",
          flex: 1,
        }}
      >
        {celdas.map((d, i) => {
          const otroMes = d.getMonth() !== fecha.getMonth();
          const esHoy = mismoDia(d, ahora);
          const evs = eventos.filter((e) => mismoDia(new Date(e.inicio), d));
          return (
            <div
              key={i}
              style={{
                borderBottom: "1px solid #f4f6f8",
                borderRight: "1px solid #f4f6f8",
                padding: 6,
                backgroundColor: otroMes ? "#fafbfc" : "#fff",
                display: "flex",
                flexDirection: "column",
                gap: 3,
                minHeight: 0,
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: esHoy ? 800 : 600,
                  color: esHoy ? "#fff" : otroMes ? "#cbd5e1" : "#475569",
                  backgroundColor: esHoy ? "#1e3a8a" : "transparent",
                  borderRadius: "50%",
                  width: 22,
                  height: 22,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {d.getDate()}
              </span>
              {evs.slice(0, 3).map((ev) => (
                <div key={ev.id} style={{ height: 22 }}>
                  <EventoChip ev={ev} compacto />
                </div>
              ))}
              {evs.length > 3 && (
                <span style={{ fontSize: 10, color: "#94a3b8", paddingLeft: 4 }}>
                  +{evs.length - 3} más
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Panel lateral — Próximos eventos
// ─────────────────────────────────────────────────────────────
function ProximosEventos({ eventos }: { eventos: EventoCronograma[] }) {
  const ahora = new Date();
  const proximos = eventos
    .filter((e) => new Date(e.fin) >= ahora || e.completado)
    .sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime())
    .slice(0, 10);

  return (
    <div
      style={{
        width: 300,
        flexShrink: 0,
        borderLeft: "1px solid #eef2f6",
        padding: "20px 16px",
        overflowY: "auto",
        backgroundColor: "#fff",
      }}
    >
      <h3 style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", margin: "0 0 14px" }}>
        Próximos eventos
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {proximos.map((ev) => {
          const color = COLOR_EMPRESA[ev.empresa];
          const i = new Date(ev.inicio);
          return (
            <div
              key={ev.id}
              style={{
                border: "1px solid #eef2f6",
                borderRadius: 12,
                padding: "12px 14px",
                display: "flex",
                gap: 10,
                backgroundColor: ev.completado ? "#fafbfc" : "#fff",
              }}
            >
              <span
                style={{ width: 3, borderRadius: 2, backgroundColor: color, flexShrink: 0 }}
              />
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13.5,
                    fontWeight: 700,
                    color: ev.completado ? "#94a3b8" : "#0f172a",
                    textDecoration: ev.completado ? "line-through" : "none",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {ev.titulo}
                </div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>
                  {DIAS[i.getDay()]} {i.getDate()} · {fmtHora(i)}
                </div>
                <div
                  style={{
                    fontSize: 11.5,
                    color: "#94a3b8",
                    marginTop: 2,
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <span
                    style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: color }}
                  />
                  {ev.empresa}
                  {ev.responsable ? ` · ${ev.responsable}` : ""}
                </div>
              </div>
            </div>
          );
        })}
        {proximos.length === 0 && (
          <span style={{ fontSize: 13, color: "#94a3b8" }}>
            No hay eventos próximos. Crea uno desde un proceso.
          </span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Módulo principal
// Uso: <ModuloCronograma eventos={eventosDesdeAPI} />
// ─────────────────────────────────────────────────────────────
export default function ModuloCronograma({
  eventos = demoEventos(),
}: {
  eventos?: EventoCronograma[];
}) {
  const [fecha, setFecha] = useState(new Date());
  const [vista, setVista] = useState<Vista>("semana");
  const [filtro, setFiltro] = useState<TipoEvento | "todos">("todos");
  const [dropOpen, setDropOpen] = useState(false);

  const eventosFiltrados = useMemo(
    () => (filtro === "todos" ? eventos : eventos.filter((e) => e.tipo === filtro)),
    [eventos, filtro]
  );

  const dias = useMemo(() => {
    if (vista === "dia") return [new Date(fecha)];
    const ini = inicioSemana(fecha);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(ini);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [fecha, vista]);

  const navegar = (dir: 1 | -1) => {
    const d = new Date(fecha);
    if (vista === "dia") d.setDate(d.getDate() + dir);
    else if (vista === "semana") d.setDate(d.getDate() + dir * 7);
    else d.setMonth(d.getMonth() + dir);
    setFecha(d);
  };

  const vistaLabel: Record<Vista, string> = { dia: "Día", semana: "Semana", mes: "Mes" };

  return (
    <div
      style={{
        backgroundColor: "#fff",
        borderRadius: 18,
        border: "1px solid #e8edf3",
        boxShadow: "0 1px 4px rgba(16,24,40,0.06)",
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 140px)",
        overflow: "hidden",
      }}
    >
      {/* Barra superior */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "16px 20px",
          borderBottom: "1px solid #eef2f6",
          flexWrap: "wrap",
        }}
      >
        {/* Título mes */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <CalendarDays size={18} color="#1e3a8a" />
          <span style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
            {MESES[fecha.getMonth()]} {fecha.getFullYear()}
          </span>
        </div>

        {/* Navegación */}
        <div style={{ display: "flex", gap: 6 }}>
          {[
            { icon: ChevronLeft, onClick: () => navegar(-1) },
            { icon: ChevronRight, onClick: () => navegar(1) },
          ].map(({ icon: Icon, onClick }, i) => (
            <button
              key={i}
              onClick={onClick}
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                border: "1px solid #e2e8f0",
                backgroundColor: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <Icon size={15} color="#475569" />
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        {/* Filtros por tipo */}
        <div
          style={{
            display: "flex",
            gap: 2,
            backgroundColor: "#f4f6f8",
            borderRadius: 10,
            padding: 3,
          }}
        >
          {TIPOS.map((t) => (
            <button
              key={t.id}
              onClick={() => setFiltro(t.id)}
              style={{
                padding: "6px 13px",
                borderRadius: 8,
                border: "none",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                backgroundColor: filtro === t.id ? "#fff" : "transparent",
                color: filtro === t.id ? "#0f172a" : "#64748b",
                boxShadow: filtro === t.id ? "0 1px 3px rgba(16,24,40,0.1)" : "none",
                transition: "all 0.15s",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Selector de vista */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setDropOpen(!dropOpen)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 14px",
              borderRadius: 10,
              border: dropOpen ? "2px solid #6366f1" : "1px solid #e2e8f0",
              backgroundColor: "#fff",
              fontSize: 13,
              fontWeight: 700,
              color: "#0f172a",
              cursor: "pointer",
            }}
          >
            {vistaLabel[vista]}
            <ChevronDown
              size={14}
              style={{
                transform: dropOpen ? "rotate(180deg)" : "none",
                transition: "transform 0.15s",
              }}
            />
          </button>
          {dropOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                right: 0,
                backgroundColor: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: 12,
                boxShadow: "0 8px 24px rgba(16,24,40,0.12)",
                padding: 6,
                zIndex: 50,
                minWidth: 130,
              }}
            >
              {(["dia", "semana", "mes"] as Vista[]).map((v) => (
                <button
                  key={v}
                  onClick={() => { setVista(v); setDropOpen(false); }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "9px 12px",
                    borderRadius: 8,
                    border: "none",
                    fontSize: 13.5,
                    fontWeight: vista === v ? 700 : 500,
                    color: "#0f172a",
                    backgroundColor: vista === v ? "#f4f6f8" : "transparent",
                    cursor: "pointer",
                  }}
                >
                  {vistaLabel[v]}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Botón Hoy */}
        <button
          onClick={() => setFecha(new Date())}
          style={{
            padding: "8px 16px",
            borderRadius: 10,
            border: "1px solid #e2e8f0",
            backgroundColor: "#fff",
            fontSize: 13,
            fontWeight: 700,
            color: "#0f172a",
            cursor: "pointer",
          }}
        >
          Hoy
        </button>
      </div>

      {/* Contenido */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {vista === "mes" ? (
          <VistaMes fecha={fecha} eventos={eventosFiltrados} />
        ) : (
          <GrillaHoraria fecha={fecha} eventos={eventosFiltrados} dias={dias} />
        )}
        <ProximosEventos eventos={eventosFiltrados} />
      </div>
    </div>
  );
}