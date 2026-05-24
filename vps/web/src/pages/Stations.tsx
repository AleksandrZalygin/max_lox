import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TankVisual } from "../components/TankVisual";
import { useWebSocket } from "../components/useWebSocket";
import { StationState } from "../types";

function buildWsUrl(): string {
  const token = localStorage.getItem("token") ?? "";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/browser?token=${encodeURIComponent(token)}`;
}

const s: Record<string, React.CSSProperties> = {
  root: { minHeight: "100vh", padding: 24 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 },
  title: { fontSize: 26, fontWeight: 700, color: "#f1f5f9" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 20 },
  card: {
    background: "#1e293b", borderRadius: 20, padding: 24, cursor: "pointer",
    transition: "background 0.2s", display: "flex", flexDirection: "column", gap: 16, alignItems: "center",
  },
  badge: { padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600 },
  logoutBtn: {
    padding: "8px 18px", borderRadius: 10, border: "none",
    fontSize: 14, fontWeight: 600, cursor: "pointer", background: "#334155", color: "#94a3b8",
  },
};

export const Stations: React.FC = () => {
  const [stationMap, setStationMap] = useState<Record<string, StationState>>({});
  const navigate = useNavigate();
  const { lastMessage, connected } = useWebSocket(buildWsUrl());

  useEffect(() => {
    if (!lastMessage) return;
    const msg = lastMessage as StationState;
    if (msg.type === "state_update" && msg.station_id) {
      setStationMap((prev) => ({ ...prev, [msg.station_id]: msg }));
    }
  }, [lastMessage]);

  const handleLogout = () => {
    localStorage.removeItem("token");
    navigate("/login");
  };

  const stations = Object.values(stationMap);

  return (
    <div style={s.root}>
      <div style={s.header}>
        <div>
          <div style={s.title}>Stations</div>
          <div style={{ color: "#64748b", fontSize: 13 }}>
            {connected ? `${stations.length} station(s) online` : "Connecting..."}
          </div>
        </div>
        <button style={s.logoutBtn} onClick={handleLogout}>Logout</button>
      </div>

      {stations.length === 0 && (
        <div style={{ color: "#475569", fontSize: 15, textAlign: "center", marginTop: 60 }}>
          {connected ? "No stations online. Waiting for Raspberry Pi to connect..." : "Connecting to server..."}
        </div>
      )}

      <div style={s.grid}>
        {stations.map((st) => (
          <div
            key={st.station_id}
            style={s.card}
            onClick={() => navigate(`/stations/${st.station_id}`)}
          >
            <TankVisual levelPct={st.level_pct} pumpsOn={st.pumps} height={160} width={90} />
            <div style={{ textAlign: "center", width: "100%" }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#f1f5f9", marginBottom: 6 }}>
                {st.station_id}
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                <span
                  style={{
                    ...s.badge,
                    background: st.pumps ? "#14532d" : "#1e293b",
                    color: st.pumps ? "#4ade80" : "#64748b",
                    border: "1px solid",
                    borderColor: st.pumps ? "#16a34a" : "#334155",
                  }}
                >
                  Pumps {st.pumps ? "ON" : "OFF"}
                </span>
                <span
                  style={{
                    ...s.badge,
                    background: "#1e1b4b",
                    color: "#a78bfa",
                    border: "1px solid #4c1d95",
                    display: st.mode === "auto" ? "inline" : "none",
                  }}
                >
                  Auto
                </span>
              </div>
              <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 8 }}>
                {st.volume_l !== null ? `${st.volume_l.toFixed(1)} L` : "—"}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
