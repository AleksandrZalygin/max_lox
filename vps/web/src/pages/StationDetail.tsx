import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { TankVisual } from "../components/TankVisual";
import { MoistureGauge } from "../components/MoistureGauge";
import { EventLog } from "../components/EventLog";
import { useWebSocket } from "../components/useWebSocket";
import { ApiEvent, StationState } from "../types";
import http from "../api";

function buildWsUrl(): string {
  const token = localStorage.getItem("token") ?? "";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/browser?token=${encodeURIComponent(token)}`;
}

const s: Record<string, React.CSSProperties> = {
  root: { padding: 24, maxWidth: 1100, margin: "0 auto" },
  header: { display: "flex", alignItems: "center", gap: 16, marginBottom: 24 },
  title: { fontSize: 22, fontWeight: 700, color: "#f1f5f9", flex: 1 },
  card: { background: "#1e293b", borderRadius: 16, padding: 20 },
  label: { fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  value: { fontSize: 24, fontWeight: 700, color: "#f1f5f9" },
  btn: {
    padding: "10px 20px", borderRadius: 10, border: "none",
    fontSize: 14, fontWeight: 600, cursor: "pointer", transition: "opacity 0.2s",
  },
};

export const StationDetail: React.FC = () => {
  const { stationId } = useParams<{ stationId: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<StationState | null>(null);
  const [events, setEvents] = useState<ApiEvent[]>([]);
  const [targetLevel, setTargetLevel] = useState(80);
  const { lastMessage, connected, send } = useWebSocket(buildWsUrl());

  useEffect(() => {
    if (!stationId) return;
    http.get<ApiEvent[]>(`/api/stations/${stationId}/events`).then((r) => setEvents(r.data));
  }, [stationId]);

  useEffect(() => {
    if (!lastMessage) return;
    const msg = lastMessage as StationState;
    if (msg.type === "state_update" && msg.station_id === stationId) {
      setState(msg);
      if (msg.target_level) setTargetLevel(msg.target_level);
    }
  }, [lastMessage, stationId]);

  const sendCommand = async (action: string, extra?: Record<string, unknown>) => {
    try {
      await http.post(`/api/stations/${stationId}/commands`, { action, ...extra });
    } catch (e) {
      console.error("Command failed:", e);
    }
  };

  if (!stationId) return null;

  const level = state?.level_pct ?? null;
  const pumpsOn = state?.pumps ?? false;
  const mode = state?.mode ?? "manual";
  const moisture = state?.moisture_pct ?? null;
  const volume = state?.volume_l ?? null;

  const pumpBtnDisabled = level !== null && level >= 100 && !pumpsOn;

  return (
    <div style={s.root}>
      <div style={s.header}>
        <button
          style={{ ...s.btn, background: "#334155", color: "#94a3b8", padding: "8px 14px" }}
          onClick={() => navigate("/stations")}
        >
          ← Stations
        </button>
        <div style={s.title}>{stationId}</div>
        <div style={{ fontSize: 12, color: connected ? "#4ade80" : "#f87171" }}>
          {connected ? "Live" : "Reconnecting..."}
        </div>
        <button
          style={{ ...s.btn, background: "#334155", color: "#94a3b8", padding: "8px 14px" }}
          onClick={() => navigate(`/stations/${stationId}/history`)}
        >
          History
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 20 }}>
        {/* Tank */}
        <div style={{ ...s.card, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <TankVisual levelPct={level} pumpsOn={pumpsOn} height={240} width={130} />
          <div style={{ textAlign: "center" }}>
            <div style={s.label}>Volume</div>
            <div style={s.value}>{volume !== null ? `${volume.toFixed(1)} L` : "—"}</div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Pump */}
          <div style={s.card}>
            <div style={s.label}>Pump Control</div>
            <div style={{ display: "flex", gap: 12, marginTop: 10, alignItems: "center" }}>
              <button
                style={{ ...s.btn, background: pumpBtnDisabled || pumpsOn || mode === "auto" ? "#334155" : "#22c55e", color: pumpBtnDisabled || pumpsOn || mode === "auto" ? "#475569" : "white" }}
                disabled={pumpBtnDisabled || pumpsOn || mode === "auto"}
                onClick={() => sendCommand("pumps_on")}
              >
                Start Filling
              </button>
              <button
                style={{ ...s.btn, background: !pumpsOn || mode === "auto" ? "#334155" : "#ef4444", color: !pumpsOn || mode === "auto" ? "#475569" : "white" }}
                disabled={!pumpsOn || mode === "auto"}
                onClick={() => sendCommand("pumps_off")}
              >
                Stop
              </button>
              <div style={{ color: pumpsOn ? "#4ade80" : "#64748b", fontWeight: 600 }}>
                Pumps: {pumpsOn ? "ON" : "OFF"}
              </div>
            </div>
          </div>

          {/* Auto mode */}
          <div style={s.card}>
            <div style={s.label}>Auto Mode</div>
            <div style={{ display: "flex", gap: 16, marginTop: 10, alignItems: "center" }}>
              <button
                style={{ ...s.btn, background: mode === "auto" ? "#ef4444" : "#22c55e", color: "white" }}
                onClick={() => sendCommand(mode === "auto" ? "set_manual_mode" : "set_auto_mode", { target_level: targetLevel })}
              >
                {mode === "auto" ? "Disable Auto" : "Enable Auto"}
              </button>
              {mode !== "auto" && (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ color: "#94a3b8", fontSize: 14 }}>Target:</span>
                  <input
                    type="range" min={10} max={95} value={targetLevel}
                    onChange={(e) => setTargetLevel(Number(e.target.value))}
                    style={{ width: 120 }}
                  />
                  <span style={{ color: "#f1f5f9", fontWeight: 600 }}>{targetLevel}%</span>
                </div>
              )}
              {mode === "auto" && (
                <span style={{ color: "#a78bfa", fontWeight: 600 }}>
                  Auto active — target: {state?.target_level ?? targetLevel}%
                </span>
              )}
            </div>
          </div>

          {/* Moisture */}
          <div style={{ ...s.card, display: "flex", alignItems: "center", gap: 20 }}>
            <MoistureGauge moisturePct={moisture} />
            <div>
              <div style={s.label}>Drain Status</div>
              <div style={{ color: (moisture ?? 0) > 30 ? "#3b82f6" : "#64748b", fontWeight: 600, fontSize: 15, marginTop: 4 }}>
                {(moisture ?? 0) > 30 ? "Water flowing" : "No flow"}
              </div>
            </div>
          </div>

          {/* Events */}
          <div style={{ ...s.card, flex: 1 }}>
            <div style={s.label}>Recent Events</div>
            <div style={{ marginTop: 8 }}>
              <EventLog events={events} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
