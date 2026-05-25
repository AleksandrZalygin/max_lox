import React from "react";

interface MoistureGaugeProps {
  moisturePct: number | null;
}

export const MoistureGauge: React.FC<MoistureGaugeProps> = ({ moisturePct }) => {
  const pct = moisturePct ?? 0;
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  const color = pct > 30 ? "#3b82f6" : "#94a3b8";

  return (
    <div style={{ textAlign: "center" }}>
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle
          cx="50" cy="50" r={radius}
          fill="none"
          stroke="#1e293b"
          strokeWidth="10"
        />
        <circle
          cx="50" cy="50" r={radius}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
          style={{ transition: "stroke-dashoffset 0.5s ease" }}
        />
        <text
          x="50" y="50"
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#e2e8f0"
          fontSize="16"
          fontWeight="bold"
        >
          {moisturePct !== null ? `${pct.toFixed(0)}%` : "—"}
        </text>
      </svg>
      <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>
        {pct > 30 ? "Зафиксирован проток" : "Нет потока"}
      </div>
    </div>
  );
};
