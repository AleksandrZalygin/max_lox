import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Measurement } from "../types";
import http from "../api";

const s: Record<string, React.CSSProperties> = {
  root: { padding: 24, maxWidth: 1100, margin: "0 auto" },
  header: { display: "flex", alignItems: "center", gap: 16, marginBottom: 24 },
  title: { fontSize: 22, fontWeight: 700, color: "#f1f5f9", flex: 1 },
  card: { background: "#1e293b", borderRadius: 16, padding: 20, marginBottom: 20 },
  label: { fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 },
  input: { background: "#0f172a", border: "1px solid #334155", color: "#e2e8f0", padding: "8px 12px", borderRadius: 8, fontSize: 14 },
  btn: { padding: "8px 18px", borderRadius: 10, border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", background: "#334155", color: "#94a3b8" },
};

export const History: React.FC = () => {
  const { stationId } = useParams<{ stationId: string }>();
  const navigate = useNavigate();
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() - 24);
    return d.toISOString().slice(0, 16);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 16));

  const loadData = async () => {
    if (!stationId) return;
    setLoading(true);
    try {
      const fromISO = new Date(from).toISOString();
      const toISO = new Date(to).toISOString();
      const res = await http.get<Measurement[]>(
        `/api/stations/${stationId}/measurements?from=${fromISO}&to=${toISO}&limit=1000`
      );
      setMeasurements(res.data.slice().reverse());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [stationId]);

  const chartData = measurements.map((m) => ({
    time: new Date(m.timestamp).toLocaleString(),
    level: parseFloat(m.level_pct.toFixed(1)),
    volume: parseFloat(m.volume_l.toFixed(2)),
    moisture: m.moisture_pct !== null ? parseFloat(m.moisture_pct.toFixed(1)) : null,
  }));

  return (
    <div style={s.root}>
      <div style={s.header}>
        <button style={s.btn} onClick={() => navigate(`/stations/${stationId}`)}>← Back</button>
        <div style={s.title}>History — {stationId}</div>
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-end", marginBottom: 20, flexWrap: "wrap" }}>
        <div>
          <div style={s.label}>From</div>
          <input style={s.input} type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <div style={s.label}>To</div>
          <input style={s.input} type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button
          style={{ ...s.btn, background: "#3b82f6", color: "white" }}
          onClick={loadData}
          disabled={loading}
        >
          {loading ? "Loading..." : "Apply"}
        </button>
        <div style={{ color: "#64748b", fontSize: 13 }}>{measurements.length} records</div>
      </div>

      <div style={s.card}>
        <div style={s.label}>Level % over time</div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="time" tick={{ fill: "#64748b", fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 11 }} unit="%" />
            <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8 }} labelStyle={{ color: "#94a3b8" }} />
            <Line type="monotone" dataKey="level" stroke="#3b82f6" dot={false} strokeWidth={2} name="Level %" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div style={s.card}>
        <div style={s.label}>Volume (L) over time</div>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="time" tick={{ fill: "#64748b", fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fill: "#64748b", fontSize: 11 }} unit=" L" />
            <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8 }} />
            <Line type="monotone" dataKey="volume" stroke="#22c55e" dot={false} strokeWidth={2} name="Volume L" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {chartData.some((d) => d.moisture !== null) && (
        <div style={s.card}>
          <div style={s.label}>Moisture % over time</div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="time" tick={{ fill: "#64748b", fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 11 }} unit="%" />
              <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8 }} />
              <Line type="monotone" dataKey="moisture" stroke="#a78bfa" dot={false} strokeWidth={2} name="Moisture %" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};
