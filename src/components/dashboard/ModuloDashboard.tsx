"use client";

import { Monitor, DollarSign, Clock, TrendingUp, RefreshCw, Download, LayoutGrid } from "lucide-react";
import KpiCards, { type KpiCardData } from "./KpiCards";
import ProcesosEmpresa, { type EmpresaData } from "./ProcesosEmpresa";
import ProcesosGestionados, { type GestionadoPoint } from "./ProcesosGestionados";

// ─────────────────────────────────────────────────────────────
// Props — reemplaza DEMO con datos reales de tu API / Prisma
// ─────────────────────────────────────────────────────────────
export interface DashboardProps {
  totalProcesos: number;
  badgeProcesos?: string;
  badgeToneProcesos?: "red" | "green" | "amber" | "gray";
  sparkProcesos?: number[];

  valorTotal: string;
  badgeValor?: string;
  badgeToneValor?: "red" | "green" | "amber" | "gray";
  sparkValor?: number[];

  enCurso: number;
  badgeEnCurso?: string;
  badgeToneEnCurso?: "red" | "green" | "amber" | "gray";
  sparkEnCurso?: number[];

  tasaAdjudicacion: string;
  badgeTasa?: string;
  badgeToneTasa?: "red" | "green" | "amber" | "gray";
  sparkTasa?: number[];

  empresas: EmpresaData[];
  gestionados: GestionadoPoint[];
}

// ─────────────────────────────────────────────────────────────
// Datos de ejemplo — elimina cuando conectes datos reales
// ─────────────────────────────────────────────────────────────
const DEMO: DashboardProps = {
  totalProcesos: 118,
  badgeProcesos: "MoM: -68 | -75%",
  badgeToneProcesos: "red",
  sparkProcesos: [12, 18, 30, 42, 38, 25, 14],

  valorTotal: "$146,186 M",
  badgeValor: "prom. $1,238 M / proceso",
  badgeToneValor: "green",
  sparkValor: [20, 35, 48, 60, 52, 44, 50],

  enCurso: 114,
  badgeEnCurso: "15 con observación",
  badgeToneEnCurso: "amber",
  sparkEnCurso: [10, 22, 40, 55, 48, 38, 30],

  tasaAdjudicacion: "0%",
  badgeTasa: "0 adj. / 4 cerrados",
  badgeToneTasa: "gray",
  sparkTasa: [5, 12, 28, 45, 40, 35, 38],

  empresas: [
    { name: "Aseocolba",  value: 76, color: "#1e3a8a" },
    { name: "Vigicolba",  value: 33, color: "#dc2626" },
    { name: "Tempocolba", value: 9,  color: "#2563eb" },
  ],
  gestionados: [
    { mes: "abr.", publicos: 2,  privados: 1  },
    { mes: "",     publicos: 18, privados: 12 },
    { mes: "may.", publicos: 42, privados: 36 },
    { mes: "",     publicos: 28, privados: 20 },
    { mes: "jun.", publicos: 8,  privados: 5  },
  ],
};

// ─────────────────────────────────────────────────────────────
// Módulo Dashboard
// Uso en page.tsx:
//   import ModuloDashboard from "@/components/dashboard/ModuloDashboard";
//   <ModuloDashboard data={tusDatos} />
// ─────────────────────────────────────────────────────────────
export default function ModuloDashboard({
  data = DEMO,
  onRefresh,
  onExportPublico,
  onExportPrivado,
}: {
  data?: DashboardProps;
  onRefresh?: () => void;
  onExportPublico?: () => void;
  onExportPrivado?: () => void;
}) {
  const sp = [0, 1];
  const cards: KpiCardData[] = [
    {
      label: "Total procesos",
      value: String(data.totalProcesos),
      badge: data.badgeProcesos ?? "",
      badgeTone: data.badgeToneProcesos ?? "gray",
      icon: Monitor,
      iconBg: "#eef0ff",
      iconColor: "#6366f1",
      sparkColor: "#6366f1",
      sparkData: data.sparkProcesos ?? sp,
      sparkId: "sp1",
    },
    {
      label: "Valor total",
      value: data.valorTotal,
      badge: data.badgeValor ?? "",
      badgeTone: data.badgeToneValor ?? "green",
      icon: DollarSign,
      iconBg: "#e6faf5",
      iconColor: "#10b981",
      sparkColor: "#10b981",
      sparkData: data.sparkValor ?? sp,
      sparkId: "sp2",
    },
    {
      label: "En curso",
      value: String(data.enCurso),
      badge: data.badgeEnCurso ?? "",
      badgeTone: data.badgeToneEnCurso ?? "amber",
      icon: Clock,
      iconBg: "#fef5e7",
      iconColor: "#f59e0b",
      sparkColor: "#f59e0b",
      sparkData: data.sparkEnCurso ?? sp,
      sparkId: "sp3",
    },
    {
      label: "Tasa adjudicación",
      value: data.tasaAdjudicacion,
      badge: data.badgeTasa ?? "",
      badgeTone: data.badgeToneTasa ?? "gray",
      icon: TrendingUp,
      iconBg: "#e8f7ee",
      iconColor: "#16a34a",
      sparkColor: "#16a34a",
      sparkData: data.sparkTasa ?? sp,
      sparkId: "sp4",
    },
  ];

  return (
    <div className="min-h-screen bg-[#f6f8fb] p-8 font-sans">
      <div className="max-w-7xl mx-auto flex flex-col gap-6">

        {/* Encabezado */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-[#1e3a8a]">
            <LayoutGrid size={20} />
            <h1 className="text-xl font-bold">Panel de control</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onRefresh}
              className="inline-flex items-center gap-2 px-4 h-10 rounded-xl border border-gray-200 bg-white text-sm font-semibold text-[#1e3a8a] hover:bg-gray-50 transition-colors"
            >
              <RefreshCw size={15} /> Actualizar
            </button>
            <button
              onClick={onExportPublico}
              className="inline-flex items-center gap-2 px-4 h-10 rounded-xl bg-[#1e3a8a] text-sm font-semibold text-white hover:bg-[#16306f] transition-colors"
            >
              <Download size={15} /> Exportar Público
            </button>
            <button
              onClick={onExportPrivado}
              className="inline-flex items-center gap-2 px-4 h-10 rounded-xl bg-[#c81e3a] text-sm font-semibold text-white hover:bg-[#a8182f] transition-colors"
            >
              <Download size={15} /> Exportar Privado
            </button>
          </div>
        </div>

        {/* KPIs */}
        <KpiCards cards={cards} />

        {/* Fila inferior */}
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-5">
          <ProcesosEmpresa data={data.empresas} />
          <ProcesosGestionados data={data.gestionados} />
        </div>

      </div>
    </div>
  );
}