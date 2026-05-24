import React, { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Measurement, Station } from "../types";

const s: Record<string, React.CSSProperties> = {
  root: { padding: 24, display: "flex", flexDirection: "column", gap: 20, height: "100vh" },
  header: { display: "flex", alignItems: "center", gap: 16 },
  title: { fontSize: 22, fontWeight: 700, color: "#f1f5f9", flex: 1 },
  card: { background: "#1e293b", borderRadius: 16, padding: 20, flex: 1 },
  label: { fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 },
  input: {
    background: "#0f172a", border: "1px solid #334155", color: "#e2e8f0",
    padding: "6px 10px", borderRadius: 8, fontSize: 14,
  },
  btn: {
    padding: "8px 16px", borderRadius: 10, border: "none",
    fontSize: 14, fontWeight: 600, cursor: "pointer", background: "#334155", color: "#94a3b8",
  },
};

export const HistoryChart: React.FC = () => {
  const [station, setStation] = useState<Station | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() - 24);
    return d.toISOString().slice(0, 16);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    window.api.call("GET", "/api/stations").then((data) => {
      const stations = data as Station[];
      if (stations.length > 0) setStation(stations[0]);
    });
  }, []);

  useEffect(() => {
    if (!station) return;
    setLoading(true);
    const fromISO = new Date(from).toISOString();
    const toISO = new Date(to).toISOString();
    window.api
      .call("GET", `/api/stations/${station.id}/measurements?from=${fromISO}&to=${toISO}&limit=1000`)
      .then((data) => {
        const raw = (data as Measurement[]).slice().reverse();
        setMeasurements(raw);
      })
      .finally(() => setLoading(false));
  }, [station, from, to]);

  const chartData = measurements.map((m) => ({
    time: new Date(m.timestamp).toLocaleTimeString(),
    level: m.level_pct.toFixed(1),
    volume: m.volume_l.toFixed(2),
    moisture: m.moisture_pct?.toFixed(1) ?? null,
  }));

  return (
    <div style={s.root}>
      <div style={s.header}>
        <div style={s.title}>History</div>
        <button style={s.btn} onClick={() => (window.location.href = "#/")}>
          ← Dashboard
        </button>
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <div>
          <div style={s.label}>From</div>
          <input style={s.input} type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <div style={s.label}>To</div>
          <input style={s.input} type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div style={{ color: "#64748b", fontSize: 13, marginTop: 16 }}>
          {loading ? "Loading..." : `${measurements.length} records`}
        </div>
      </div>

      <div style={s.card}>
        <div style={s.label}>Level % over time</div>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="time" tick={{ fill: "#64748b", fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 11 }} unit="%" />
            <Tooltip
              contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8 }}
              labelStyle={{ color: "#94a3b8" }}
              itemStyle={{ color: "#3b82f6" }}
            />
            <Line type="monotone" dataKey="level" stroke="#3b82f6" dot={false} strokeWidth={2} name="Level %" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div style={s.card}>
        <div style={s.label}>Volume (L) over time</div>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="time" tick={{ fill: "#64748b", fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis tick={{ fill: "#64748b", fontSize: 11 }} unit=" L" />
            <Tooltip
              contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8 }}
              labelStyle={{ color: "#94a3b8" }}
            />
            <Line type="monotone" dataKey="volume" stroke="#22c55e" dot={false} strokeWidth={2} name="Volume L" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
