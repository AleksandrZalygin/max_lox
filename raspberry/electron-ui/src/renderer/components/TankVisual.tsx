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
  height = 260,
  width = 140,
}) => {
  const level = levelPct ?? 0;
  const fillHeight = Math.max(0, Math.min(1, level / 100)) * (height - 20);

  const fillColor =
    level >= 100
      ? "#22c55e"
      : level >= 80
      ? "#eab308"
      : level >= 20
      ? "#3b82f6"
      : "#ef4444";

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Tank outline */}
      <rect
        x="4"
        y="4"
        width={width - 8}
        height={height - 8}
        rx="12"
        ry="12"
        fill="#1e293b"
        stroke="#475569"
        strokeWidth="3"
      />

      {/* Water fill — clipped to tank interior */}
      <clipPath id="tank-clip">
        <rect x="7" y="7" width={width - 14} height={height - 14} rx="9" ry="9" />
      </clipPath>
      <rect
        x="7"
        y={height - 7 - fillHeight}
        width={width - 14}
        height={fillHeight}
        fill={fillColor}
        opacity="0.85"
        clipPath="url(#tank-clip)"
        style={{ transition: "y 0.5s ease, height 0.5s ease, fill 0.3s ease" }}
      />

      {/* Pump activity ripple (shown when pumps are on) */}
      {pumpsOn && (
        <circle
          cx={width / 2}
          cy={height - 7 - fillHeight - 10}
          r="6"
          fill="white"
          opacity="0.4"
        >
          <animate attributeName="r" from="4" to="14" dur="1s" repeatCount="indefinite" />
          <animate attributeName="opacity" from="0.5" to="0" dur="1s" repeatCount="indefinite" />
        </circle>
      )}

      {/* Level text */}
      <text
        x={width / 2}
        y={height / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="white"
        fontSize="18"
        fontWeight="bold"
        style={{ textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}
      >
        {levelPct !== null ? `${level.toFixed(1)}%` : "—"}
      </text>
    </svg>
  );
};
