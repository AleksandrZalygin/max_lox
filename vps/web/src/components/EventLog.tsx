import React from "react";
import { ApiEvent } from "../types";

const ICONS: Record<string, string> = {
  fill_start: "▶", fill_stop: "■", leak_detected: "⚠",
  auto_mode_on: "⚙", auto_mode_off: "⚙", pumps_on: "↑", pumps_off: "↓",
};
const COLORS: Record<string, string> = {
  leak_detected: "#ef4444", fill_start: "#22c55e", fill_stop: "#94a3b8",
  auto_mode_on: "#a78bfa", auto_mode_off: "#64748b", pumps_on: "#3b82f6", pumps_off: "#64748b",
};

export const EventLog: React.FC<{ events: ApiEvent[] }> = ({ events }) => (
  <div style={{ overflow: "auto", maxHeight: 200 }}>
    {events.length === 0 && <div style={{ color: "#475569", fontSize: 13, padding: "8px 0" }}>No events</div>}
    {events.map((ev) => (
      <div key={ev.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0", borderBottom: "1px solid #1e293b", fontSize: 13 }}>
        <span style={{ color: COLORS[ev.type] ?? "#e2e8f0", minWidth: 14 }}>{ICONS[ev.type] ?? "•"}</span>
        <span style={{ color: "#64748b", whiteSpace: "nowrap" }}>{new Date(ev.timestamp).toLocaleString()}</span>
        <span style={{ color: COLORS[ev.type] ?? "#e2e8f0" }}>{ev.type.replace(/_/g, " ")}</span>
      </div>
    ))}
  </div>
);
