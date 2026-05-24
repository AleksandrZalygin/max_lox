import React from "react";

export const MoistureGauge: React.FC<{ moisturePct: number | null }> = ({ moisturePct }) => {
  const pct = moisturePct ?? 0;
  const radius = 30;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (pct / 100) * circ;
  const color = pct > 30 ? "#3b82f6" : "#475569";

  return (
    <div style={{ textAlign: "center" }}>
      <svg width="80" height="80" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={radius} fill="none" stroke="#1e293b" strokeWidth="8" />
        <circle
          cx="40" cy="40" r={radius} fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          transform="rotate(-90 40 40)"
          style={{ transition: "stroke-dashoffset 0.5s ease" }}
        />
        <text x="40" y="40" textAnchor="middle" dominantBaseline="middle" fill="#e2e8f0" fontSize="13" fontWeight="bold">
          {moisturePct !== null ? `${pct.toFixed(0)}%` : "—"}
        </text>
      </svg>
      <div style={{ color: "#64748b", fontSize: 11 }}>{pct > 30 ? "Flowing" : "No flow"}</div>
    </div>
  );
};
