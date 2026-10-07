"use client";

import { AreaChart, Area, ResponsiveContainer } from "recharts";
import { TrendingUp, TrendingDown } from "lucide-react";

export interface KpiCardData {
  label: string;
  value: string;
  badge: string;
  badgeTone: "red" | "green" | "amber" | "gray";
  icon: React.ComponentType<{ style?: React.CSSProperties; strokeWidth?: number }>;
  iconBg: string;
  iconColor: string;
  sparkColor: string;
  sparkData: number[];
  sparkId: string;
}

const badgeTones: Record<string, string> = {
  red:   "bg-red-50 text-red-600",
  green: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  gray:  "bg-gray-100 text-gray-600",
};

function Sparkline({ data, color, id }: { data: number[]; color: string; id: string }) {
  const chartData = data.map((v, i) => ({ i, v }));
  return (
    <div className="h-16 -mx-2 -mb-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={2.5}
            fill={`url(#${id})`}
            dot={false}
            isAnimationActive
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function KpiCard({ data }: { data: KpiCardData }) {
  const Icon = data.icon;
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(16,24,40,0.06)] p-5 flex flex-col gap-3 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <span className="text-[11px] font-semibold tracking-wider text-gray-400 uppercase">
          {data.label}
        </span>
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: data.iconBg }}
        >
          <Icon style={{ color: data.iconColor, width: 18, height: 18 }} strokeWidth={2} />
        </div>
      </div>

      <div className="text-[32px] leading-none font-bold text-gray-900 tracking-tight">
        {data.value}
      </div>

      <div className={`inline-flex items-center gap-1 self-start px-2 py-0.5 rounded-full text-xs font-semibold ${badgeTones[data.badgeTone]}`}>
        {data.badgeTone === "red"   && <TrendingDown size={13} />}
        {data.badgeTone === "green" && <TrendingUp   size={13} />}
        {data.badge}
      </div>

      <Sparkline data={data.sparkData} color={data.sparkColor} id={data.sparkId} />
    </div>
  );
}

export default function KpiCards({ cards }: { cards: KpiCardData[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
      {cards.map((card) => (
        <KpiCard key={card.label} data={card} />
      ))}
    </div>
  );
}