import React from "react";
import { ApiEvent } from "../types";

const EVENT_ICONS: Record<string, string> = {
  fill_start: "▶",
  fill_stop: "■",
  leak_detected: "⚠",
  auto_mode_on: "⚙",
  auto_mode_off: "⚙",
  pumps_on: "▲",
  pumps_off: "▼",
};

const EVENT_COLORS: Record<string, string> = {
  leak_detected: "#ef4444",
  fill_start: "#22c55e",
  fill_stop: "#94a3b8",
  auto_mode_on: "#a78bfa",
  auto_mode_off: "#94a3b8",
  pumps_on: "#3b82f6",
  pumps_off: "#94a3b8",
};

const EVENT_LABELS: Record<string, string> = {
  fill_start: "Начало наполнения",
  fill_stop: "Конец наполнения",
  leak_detected: "Обнаружена утечка",
  auto_mode_on: "Автомат включён",
  auto_mode_off: "Автомат выключен",
  pumps_on: "Насосы включены",
  pumps_off: "Насосы выключены",
};

interface EventLogProps {
  events: ApiEvent[];
}

export const EventLog: React.FC<EventLogProps> = ({ events }) => {
  return (
    <div style={{ overflow: "auto", maxHeight: 200 }}>
      {events.length === 0 && (
        <div style={{ color: "#64748b", padding: "8px 0", fontSize: 13 }}>Событий пока нет</div>
      )}
      {events.map((ev) => (
        <div
          key={ev.id}
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            padding: "4px 0",
            borderBottom: "1px solid #1e293b",
            fontSize: 13,
          }}
        >
          <span style={{ color: EVENT_COLORS[ev.type] ?? "#e2e8f0", minWidth: 16 }}>
            {EVENT_ICONS[ev.type] ?? "•"}
          </span>
          <span style={{ color: "#94a3b8", whiteSpace: "nowrap" }}>
            {new Date(ev.timestamp).toLocaleTimeString()}
          </span>
          <span style={{ color: EVENT_COLORS[ev.type] ?? "#e2e8f0" }}>
            {EVENT_LABELS[ev.type] ?? ev.type.replace(/_/g, " ")}
          </span>
          {ev.payload && Object.keys(ev.payload).length > 0 && (
            <span style={{ color: "#64748b", fontSize: 11 }}>
              {JSON.stringify(ev.payload)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
};
