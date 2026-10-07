"use client";

import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

export interface EmpresaData {
  name: string;
  value: number;
  color: string;
}

export default function ProcesosEmpresa({ data }: { data: EmpresaData[] }) {
  const total = data.reduce((s, e) => s + e.value, 0);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(16,24,40,0.06)] p-6">
      <h2 className="text-[11px] font-semibold tracking-wider text-gray-400 uppercase mb-4">
        Procesos por empresa
      </h2>

      <div className="flex items-center gap-6">
        {/* Dona */}
        <div className="relative w-44 h-44 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                innerRadius={58}
                outerRadius={82}
                paddingAngle={3}
                cornerRadius={6}
                startAngle={90}
                endAngle={-270}
                strokeWidth={0}
              >
                {data.map((e) => (
                  <Cell key={e.name} fill={e.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-3xl font-bold text-gray-900">{total}</span>
            <span className="text-xs text-gray-400">procesos</span>
          </div>
        </div>

        {/* Leyenda */}
        <div className="flex flex-col gap-3 flex-1">
          {data.map((e) => {
            const pct = total > 0 ? `${((e.value / total) * 100).toFixed(1)}%` : "0%";
            return (
              <div key={e.name} className="flex items-center gap-3">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: e.color }}
                />
                <span className="text-sm text-gray-600 flex-1">{e.name}</span>
                <span className="text-sm font-bold text-gray-900">{e.value}</span>
                <span className="text-xs text-gray-400 w-12 text-right">{pct}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}