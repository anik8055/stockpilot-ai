"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const compact = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(1)}Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)}L` : n >= 1e3 ? `₹${(n / 1e3).toFixed(0)}k` : `₹${n}`);

export function MonthlySalesChart({ data }: { data: { label: string; value: number; partial: boolean }[] }) {
  return (
    <div className="h-56 w-full" role="img" aria-label={`Monthly sales value: ${data.map((d) => `${d.label} ${inr.format(d.value)}`).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="#dfe4ec" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} stroke="#5a6a80" />
          <YAxis tickFormatter={compact} tickLine={false} axisLine={false} fontSize={12} stroke="#5a6a80" width={56} />
          <Tooltip formatter={(v) => [inr.format(Number(v)), "Sales value"]} cursor={{ fill: "#eef2f7" }} />
          <Bar dataKey="value" radius={[3, 3, 0, 0]} fill="#2563c9" isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function WeeklyUnitsChart({ data, unit }: { data: { week: string; qty: number }[]; unit: string }) {
  return (
    <div className="h-44 w-full" role="img" aria-label={`Units sold per week over ${data.length} weeks`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="#dfe4ec" />
          <XAxis dataKey="week" tickLine={false} axisLine={false} fontSize={11} stroke="#5a6a80" minTickGap={24} />
          <YAxis tickLine={false} axisLine={false} fontSize={11} stroke="#5a6a80" width={40} allowDecimals={false} />
          <Tooltip formatter={(v) => [`${v} ${unit}`, "Sold"]} />
          <Line type="monotone" dataKey="qty" stroke="#10233f" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
