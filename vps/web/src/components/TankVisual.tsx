import React from "react";

interface TankVisualProps {
  levelPct: number | null;
  pumpsOn: boolean;
  height?: number;
  width?: number;
}

export const TankVisual: React.FC<TankVisualProps> = ({
  levelPct,
  pumpsOn,
  height = 200,
  width = 110,
}) => {
  const level = levelPct ?? 0;
  const fillHeight = Math.max(0, Math.min(1, level / 100)) * (height - 16);

  const fillColor =
    level >= 100 ? "#22c55e" : level >= 80 ? "#eab308" : level >= 20 ? "#3b82f6" : "#ef4444";

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width={width - 6} height={height - 6} rx="10" ry="10" fill="#1e293b" stroke="#475569" strokeWidth="2.5" />
      <clipPath id={`clip-${width}`}>
        <rect x="5.5" y="5.5" width={width - 11} height={height - 11} rx="7" ry="7" />
      </clipPath>
      <rect
        x="5.5" y={height - 5.5 - fillHeight} width={width - 11} height={fillHeight}
        fill={fillColor} opacity="0.85"
        clipPath={`url(#clip-${width})`}
        style={{ transition: "y 0.5s ease, height 0.5s ease, fill 0.3s ease" }}
      />
      {pumpsOn && (
        <circle cx={width / 2} cy={height - 5.5 - fillHeight - 8} r="5" fill="white" opacity="0.4">
          <animate attributeName="r" from="3" to="10" dur="1s" repeatCount="indefinite" />
          <animate attributeName="opacity" from="0.5" to="0" dur="1s" repeatCount="indefinite" />
        </circle>
      )}
      <text x={width / 2} y={height / 2} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize="14" fontWeight="bold">
        {levelPct !== null ? `${level.toFixed(0)}%` : "—"}
      </text>
    </svg>
  );
};
