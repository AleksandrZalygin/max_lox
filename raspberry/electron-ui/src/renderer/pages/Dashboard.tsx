import React, { useCallback, useEffect, useRef, useState } from "react";
import { TankVisual } from "../components/TankVisual";
import { MoistureGauge } from "../components/MoistureGauge";
import { EventLog } from "../components/EventLog";
import { ApiEvent, Station, StationState } from "../types";

const API_BASE = "http://localhost:8000";
const WS_URL = "ws://localhost:8000/ws/clients";

const s: Record<string, React.CSSProperties> = {
  root: { display: "flex", flexDirection: "column", height: "100vh", padding: 20, gap: 16 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 22, fontWeight: 700, color: "#f1f5f9" },
  wsStatus: { fontSize: 12, padding: "2px 8px", borderRadius: 12 },
  row: { display: "flex", gap: 20, flex: 1 },
  card: { background: "#1e293b", borderRadius: 16, padding: 20 },
  label: { fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  value: { fontSize: 28, fontWeight: 700, color: "#f1f5f9" },
  subvalue: { fontSize: 14, color: "#94a3b8" },
  btn: {
    padding: "12px 24px", borderRadius: 12, border: "none",
    fontSize: 16, fontWeight: 600, cursor: "pointer", transition: "opacity 0.2s",
  },
  btnGreen: { background: "#22c55e", color: "white" },
  btnRed: { background: "#ef4444", color: "white" },
  btnDisabled: { background: "#334155", color: "#64748b", cursor: "not-allowed" },
  alert: {
    background: "#7f1d1d", border: "1px solid #ef4444", borderRadius: 12,
    padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center",
  },
};

export const Dashboard: React.FC = () => {
  const [station, setStation] = useState<Station | null>(null);
  const [liveState, setLiveState] = useState<StationState | null>(null);
  const [events, setEvents] = useState<ApiEvent[]>([]);
  const [leakAlert, setLeakAlert] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [targetLevel, setTargetLevel] = useState(80);
  const wsRef = useRef<WebSocket | null>(null);

  // Load station and events
  useEffect(() => {
    window.api.call("GET", "/api/stations").then((data) => {
      const stations = data as Station[];
      if (stations.length > 0) {
        const s = stations[0];
        setStation(s);
        setTargetLevel(s.target_level ?? 80);
        // Load events
        window.api.call("GET", `/api/stations/${s.id}/events`).then((evts) => {
          setEvents(evts as ApiEvent[]);
        });
      }
    });
  }, []);

  const connectWs = useCallback(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => {
      setWsConnected(false);
      setTimeout(connectWs, 3000);
    };
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "state_update") {
        setLiveState(data as StationState);
        // Refresh events periodically on state update
        if (station && Math.random() < 0.05) {
          window.api.call("GET", `/api/stations/${station.id}/events`).then((evts) => {
            setEvents(evts as ApiEvent[]);
          });
        }
      }
      if (data.type === "alert" && data.alert === "leak_detected") {
        setLeakAlert(true);
      }
    };
    ws.onerror = () => ws.close();
  }, [station]);

  useEffect(() => {
    connectWs();
    return () => wsRef.current?.close();
  }, [connectWs]);

  const level = liveState?.level_pct ?? station?.level_pct ?? null;
  const volume = liveState?.volume_l ?? station?.volume_l ?? null;
  const moisture = liveState?.moisture_pct ?? station?.moisture_pct ?? null;
  const pumpsOn = liveState?.pumps ?? station?.pumps ?? false;
  const mode = liveState?.mode ?? station?.mode ?? "manual";
  const stationId = station?.id ?? "";

  const handlePump = async (action: "on" | "off") => {
    await window.api.call("POST", `/api/stations/${stationId}/pumps`, { action });
  };

  const handleModeToggle = async () => {
    if (mode === "auto") {
      await window.api.call("POST", `/api/stations/${stationId}/mode`, { mode: "manual" });
    } else {
      await window.api.call("POST", `/api/stations/${stationId}/mode`, {
        mode: "auto",
        target_level: targetLevel,
      });
    }
  };

  const pumpBtnDisabled = level !== null && level >= 100 && !pumpsOn;

  return (
    <div style={s.root}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.title}>Water Tank</div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div
            style={{
              ...s.wsStatus,
              background: wsConnected ? "#14532d" : "#450a0a",
              color: wsConnected ? "#4ade80" : "#f87171",
            }}
          >
            {wsConnected ? "Live" : "Reconnecting..."}
          </div>
          <button
            style={{ ...s.btn, padding: "8px 16px", fontSize: 13, background: "#334155", color: "#94a3b8" }}
            onClick={() => (window.location.href = "#/history")}
          >
            History
          </button>
          <button
            style={{ ...s.btn, padding: "8px 16px", fontSize: 13, background: "#334155", color: "#94a3b8" }}
            onClick={() => (window.location.href = "#/calibration")}
          >
            Calibration
          </button>
        </div>
      </div>

      {/* Leak alert */}
      {leakAlert && (
        <div style={s.alert}>
          <span style={{ color: "#fca5a5", fontWeight: 600 }}>⚠ Leak detected! Level dropping without drain flow.</span>
          <button
            style={{ ...s.btn, padding: "6px 14px", fontSize: 13, background: "#991b1b", color: "white" }}
            onClick={() => setLeakAlert(false)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main content */}
      <div style={s.row}>
        {/* Tank visual */}
        <div style={{ ...s.card, display: "flex", flexDirection: "column", alignItems: "center", gap: 16, minWidth: 180 }}>
          <TankVisual levelPct={level} pumpsOn={pumpsOn} height={280} width={150} />
          <div style={{ textAlign: "center" }}>
            <div style={s.label}>Volume</div>
            <div style={s.value}>{volume !== null ? `${volume.toFixed(1)} L` : "—"}</div>
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, flex: 1 }}>
          {/* Pump control */}
          <div style={s.card}>
            <div style={s.label}>Pump Control</div>
            <div style={{ display: "flex", gap: 12, marginTop: 12, alignItems: "center" }}>
              <button
                style={{ ...s.btn, ...(pumpBtnDisabled || pumpsOn || mode === "auto" ? s.btnDisabled : s.btnGreen) }}
                disabled={pumpBtnDisabled || pumpsOn || mode === "auto"}
                onClick={() => handlePump("on")}
              >
                Start Filling
              </button>
              <button
                style={{ ...s.btn, ...(!pumpsOn || mode === "auto" ? s.btnDisabled : s.btnRed) }}
                disabled={!pumpsOn || mode === "auto"}
                onClick={() => handlePump("off")}
              >
                Stop
              </button>
              <div
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  background: pumpsOn ? "#14532d" : "#1e293b",
                  color: pumpsOn ? "#4ade80" : "#64748b",
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                Pumps: {pumpsOn ? "ON" : "OFF"}
              </div>
            </div>
          </div>

          {/* Auto mode */}
          <div style={s.card}>
            <div style={s.label}>Auto Mode</div>
            <div style={{ display: "flex", gap: 16, marginTop: 12, alignItems: "center" }}>
              <button
                style={{ ...s.btn, ...(mode === "auto" ? s.btnRed : s.btnGreen) }}
                onClick={handleModeToggle}
              >
                {mode === "auto" ? "Disable Auto" : "Enable Auto"}
              </button>
              {mode !== "auto" && (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ color: "#94a3b8", fontSize: 14 }}>Target:</span>
                  <input
                    type="range"
                    min={10}
                    max={95}
                    value={targetLevel}
                    onChange={(e) => setTargetLevel(Number(e.target.value))}
                    style={{ width: 140 }}
                  />
                  <span style={{ color: "#f1f5f9", fontWeight: 600, minWidth: 40 }}>{targetLevel}%</span>
                </div>
              )}
              {mode === "auto" && (
                <div style={{ color: "#a78bfa", fontWeight: 600 }}>
                  Auto active — target: {liveState?.target_level ?? targetLevel}%
                </div>
              )}
            </div>
          </div>

          {/* Moisture / drain */}
          <div style={{ ...s.card, display: "flex", alignItems: "center", gap: 24 }}>
            <MoistureGauge moisturePct={moisture} />
            <div>
              <div style={s.label}>Drain Status</div>
              <div style={{ fontSize: 16, color: (moisture ?? 0) > 30 ? "#3b82f6" : "#64748b", fontWeight: 600, marginTop: 4 }}>
                {(moisture ?? 0) > 30 ? "Water flowing" : "No flow"}
              </div>
            </div>
          </div>

          {/* Event log */}
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
