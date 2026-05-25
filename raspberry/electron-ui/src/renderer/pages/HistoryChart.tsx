import React, { useEffect, useMemo, useState } from "react";
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
import { normalizeMoisture } from "../moisture";

const s: Record<string, React.CSSProperties> = {
  root: { padding: 24, display: "flex", flexDirection: "column", gap: 20, height: "100vh", overflow: "auto" },
  header: { display: "flex", alignItems: "center", gap: 16 },
  title: { fontSize: 22, fontWeight: 700, color: "#f1f5f9", flex: 1 },
  card: { background: "#1e293b", borderRadius: 16, padding: 20 },
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

// Format a Date as "YYYY-MM-DDTHH:MM" in LOCAL time
// (datetime-local input expects local; toISOString() returns UTC and would shift by tz offset).
const formatLocalInput = (d: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const HistoryChart: React.FC = () => {
  const [station, setStation] = useState<Station | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [from, setFrom] = useState(() => formatLocalInput(new Date(Date.now() - 24 * 60 * 60 * 1000)));
  const [to, setTo] = useState(() => formatLocalInput(new Date()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.api.call("GET", "/api/stations").then((data) => {
      const stations = data as Station[];
      if (stations.length > 0) setStation(stations[0]);
    });
  }, []);

  useEffect(() => {
    if (!station) return;
    setLoading(true);
    setError(null);
    // new Date(from) treats `from` as local time, then toISOString() → UTC for the API
    const fromISO = new Date(from).toISOString();
    const toISO = new Date(to).toISOString();
    window.api
      .call("GET", `/api/stations/${station.id}/measurements?from=${fromISO}&to=${toISO}&limit=1000`)
      .then((data) => {
        const list = (data as Measurement[]).slice().reverse();
        setMeasurements(list);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [station, from, to]);

  const { chartData, spansMultipleDays } = useMemo(() => {
    if (measurements.length === 0) {
      return { chartData: [] as ReturnType<typeof buildPoint>[], spansMultipleDays: false };
    }
    const firstDay = new Date(measurements[0].timestamp).toDateString();
    let multiDay = false;
    const pts = measurements.map((m) => {
      const d = new Date(m.timestamp);
      if (d.toDateString() !== firstDay) multiDay = true;
      return buildPoint(m, d);
    });
    return { chartData: pts, spansMultipleDays: multiDay };
  }, [measurements]);

  const tickFormatter = (ts: string) => {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, "0");
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return spansMultipleDays ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${time}` : time;
  };

  const tooltipLabelFormatter = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleString();
  };

  return (
    <div style={s.root}>
      <div style={s.header}>
        <div style={s.title}>История</div>
        <button style={s.btn} onClick={() => (window.location.href = "#/")}>
          ← Главная
        </button>
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <div>
          <div style={s.label}>С</div>
          <input style={s.input} type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <div style={s.label}>По</div>
          <input style={s.input} type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button
          style={s.btn}
          onClick={() => {
            setFrom(formatLocalInput(new Date(Date.now() - 24 * 60 * 60 * 1000)));
            setTo(formatLocalInput(new Date()));
          }}
        >
          Последние 24 ч
        </button>
        <div style={{ color: "#64748b", fontSize: 13, marginTop: 16 }}>
          {loading ? "Загрузка..." : error ? `Ошибка: ${error}` : `${measurements.length} записей`}
        </div>
      </div>

      <div style={s.card}>
        <div style={s.label}>Уровень % во времени</div>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="ts" tickFormatter={tickFormatter} tick={{ fill: "#64748b", fontSize: 11 }} interval="preserveStartEnd" minTickGap={40} />
            <YAxis domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 11 }} unit=" %" />
            <Tooltip
              contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8 }}
              labelStyle={{ color: "#94a3b8" }}
              labelFormatter={tooltipLabelFormatter}
              formatter={(v) => (typeof v === "number" ? v.toFixed(1) : String(v))}
            />
            <Line type="monotone" dataKey="level" stroke="#3b82f6" dot={false} strokeWidth={2} name="Уровень, %" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div style={s.card}>
        <div style={s.label}>Объём (Л) во времени</div>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="ts" tickFormatter={tickFormatter} tick={{ fill: "#64748b", fontSize: 11 }} interval="preserveStartEnd" minTickGap={40} />
            <YAxis tick={{ fill: "#64748b", fontSize: 11 }} unit=" Л" />
            <Tooltip
              contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8 }}
              labelStyle={{ color: "#94a3b8" }}
              labelFormatter={tooltipLabelFormatter}
              formatter={(v) => (typeof v === "number" ? v.toFixed(2) : String(v))}
            />
            <Line type="monotone" dataKey="volume" stroke="#22c55e" dot={false} strokeWidth={2} name="Объём, Л" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div style={s.card}>
        <div style={s.label}>Слив (нормализованная влажность, %)</div>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="ts" tickFormatter={tickFormatter} tick={{ fill: "#64748b", fontSize: 11 }} interval="preserveStartEnd" minTickGap={40} />
            <YAxis domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 11 }} unit=" %" />
            <Tooltip
              contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8 }}
              labelStyle={{ color: "#94a3b8" }}
              labelFormatter={tooltipLabelFormatter}
              formatter={(v) => (typeof v === "number" ? v.toFixed(0) : "—")}
            />
            <Line type="monotone" dataKey="moisture" stroke="#a78bfa" dot={false} strokeWidth={2} name="Слив, %" connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

interface ChartPoint {
  ts: string; // ISO timestamp — Recharts uses this as X-axis key
  level: number;
  volume: number;
  moisture: number | null;
}

function buildPoint(m: Measurement, d: Date): ChartPoint {
  return {
    ts: d.toISOString(),
    level: Number(m.level_pct),
    volume: Number(m.volume_l),
    moisture: normalizeMoisture(m.moisture_pct),
  };
}
