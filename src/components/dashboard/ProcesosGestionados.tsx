"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export interface GestionadoPoint {
  mes: string;
  publicos: number;
  privados: number;
}

export default function ProcesosGestionados({ data }: { data: GestionadoPoint[] }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(16,24,40,0.06)] p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-bold text-gray-900">Procesos gestionados</h2>
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#06b6d4]" /> Públicos
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#6366f1]" /> Privados
          </span>
        </div>
      </div>

      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="gPub" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.18} />
                <stop offset="100%" stopColor="#06b6d4" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gPriv" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity={0.18} />
                <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="#f1f5f9" />
            <XAxis
              dataKey="mes"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12, fill: "#94a3b8" }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12, fill: "#94a3b8" }}
            />
            <Tooltip
              contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 13 }}
            />
            <Area
              type="monotone"
              dataKey="publicos"
              name="Públicos"
              stroke="#06b6d4"
              strokeWidth={2.5}
              fill="url(#gPub)"
              dot={{ r: 3, strokeWidth: 2, fill: "#fff", stroke: "#06b6d4" }}
            />
            <Area
              type="monotone"
              dataKey="privados"
              name="Privados"
              stroke="#6366f1"
              strokeWidth={2.5}
              fill="url(#gPriv)"
              dot={{ r: 3, strokeWidth: 2, fill: "#fff", stroke: "#6366f1" }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}