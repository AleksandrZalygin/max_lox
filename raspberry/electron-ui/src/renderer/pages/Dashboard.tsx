import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TankVisual } from "../components/TankVisual";
import { MoistureGauge } from "../components/MoistureGauge";
import { EventLog } from "../components/EventLog";
import { ApiEvent, Station, StationState } from "../types";
import {
  MOISTURE_DRAIN_THRESHOLD_PCT,
  normalizeMoisture,
} from "../moisture";

const API_BASE = "http://localhost:8000";
const WS_URL = "ws://localhost:8000/ws/clients";

// Сглаживание HC-SR04 (двухступенчатое: медиана + EMA).
// Медиана режет одиночные выбросы (типично для ультразвука), EMA приглаживает остаток.
const MEDIAN_WINDOW = 5;
const SMOOTHING_ALPHA = 0.25;
const CONSUMPTION_THRESHOLD_L = 0.15;
const FLOW_WINDOW_MS = 30_000;
const STALE_GAP_MS = 60_000;
// Лёгкое EMA-сглаживание для индикатора влажности (быстрее, чем для эхо-датчика —
// сенсор должен реагировать на старт/прекращение слива, но не дёргаться).
const MOISTURE_SMOOTH_ALPHA = 0.4;
const CONSUMED_STORAGE_KEY = "iot-water-ui:consumed-total-l";

const pushMedian = (buf: number[], v: number, window: number): number => {
  buf.push(v);
  while (buf.length > window) buf.shift();
  const sorted = buf.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

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
};

const readStoredConsumed = (): number => {
  try {
    const raw = localStorage.getItem(CONSUMED_STORAGE_KEY);
    if (!raw) return 0;
    const v = parseFloat(raw);
    return Number.isFinite(v) && v >= 0 ? v : 0;
  } catch {
    return 0;
  }
};

const ema = (prev: number | null, next: number, alpha: number): number =>
  prev === null ? next : prev + alpha * (next - prev);

export const Dashboard: React.FC = () => {
  const [station, setStation] = useState<Station | null>(null);
  const [liveState, setLiveState] = useState<StationState | null>(null);
  const [events, setEvents] = useState<ApiEvent[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [targetLevel, setTargetLevel] = useState(80);
  const [consumedTotal, setConsumedTotal] = useState<number>(readStoredConsumed);
  const [flowRate, setFlowRate] = useState<number>(0);
  const [smoothedVolume, setSmoothedVolume] = useState<number | null>(null);
  const [smoothedLevel, setSmoothedLevel] = useState<number | null>(null);
  const [smoothedMoisture, setSmoothedMoisture] = useState<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const smoothedVolumeRef = useRef<number | null>(null);
  const smoothedLevelRef = useRef<number | null>(null);
  const smoothedMoistureRef = useRef<number | null>(null);
  const trackHighRef = useRef<number | null>(null);
  const volumeSamplesRef = useRef<{ ts: number; v: number }[]>([]);
  const lastUpdateTsRef = useRef<number>(0);
  const volumeMedianBufRef = useRef<number[]>([]);
  const levelMedianBufRef = useRef<number[]>([]);

  // Load station and events
  useEffect(() => {
    window.api.call("GET", "/api/stations").then((data) => {
      const stations = data as Station[];
      if (stations.length > 0) {
        const s = stations[0];
        setStation(s);
        setTargetLevel(s.target_level ?? 80);
        window.api.call("GET", `/api/stations/${s.id}/events`).then((evts) => {
          setEvents(evts as ApiEvent[]);
        });
      }
    });
  }, []);

  // Persist accumulated consumption
  useEffect(() => {
    try {
      localStorage.setItem(CONSUMED_STORAGE_KEY, consumedTotal.toString());
    } catch {
      // ignore storage errors
    }
  }, [consumedTotal]);

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
      if (data.type !== "state_update") {
        // ignore other message types (incl. leak alerts — see user request)
        return;
      }

      setLiveState(data as StationState);

      const rawVolume: number | null = data.volume_l;
      const rawLevel: number | null = data.level_pct;
      const pumpsOn: boolean = !!data.pumps;
      const now = Date.now();

      // Reset filters on long gap (reconnect after offline period)
      if (
        lastUpdateTsRef.current !== 0 &&
        now - lastUpdateTsRef.current > STALE_GAP_MS
      ) {
        smoothedVolumeRef.current = null;
        smoothedLevelRef.current = null;
        smoothedMoistureRef.current = null;
        trackHighRef.current = null;
        volumeSamplesRef.current = [];
        volumeMedianBufRef.current = [];
        levelMedianBufRef.current = [];
      }
      lastUpdateTsRef.current = now;

      // Smooth moisture (separately — no median, just EMA)
      const moistNorm = normalizeMoisture(data.moisture_pct);
      if (moistNorm !== null) {
        const sm = ema(smoothedMoistureRef.current, moistNorm, MOISTURE_SMOOTH_ALPHA);
        smoothedMoistureRef.current = sm;
        setSmoothedMoisture(sm);
      }

      if (typeof rawLevel === "number" && Number.isFinite(rawLevel)) {
        const med = pushMedian(levelMedianBufRef.current, rawLevel, MEDIAN_WINDOW);
        const sm = ema(smoothedLevelRef.current, med, SMOOTHING_ALPHA);
        smoothedLevelRef.current = sm;
        setSmoothedLevel(sm);
      }

      if (typeof rawVolume === "number" && Number.isFinite(rawVolume)) {
        const med = pushMedian(volumeMedianBufRef.current, rawVolume, MEDIAN_WINDOW);
        const smV = ema(smoothedVolumeRef.current, med, SMOOTHING_ALPHA);
        smoothedVolumeRef.current = smV;
        setSmoothedVolume(smV);

        // Cumulative consumption (high-water-mark on smoothed volume)
        if (pumpsOn) {
          // While pumps are filling, just track the new peak
          if (trackHighRef.current === null || smV > trackHighRef.current) {
            trackHighRef.current = smV;
          }
        } else if (trackHighRef.current === null) {
          trackHighRef.current = smV;
        } else if (smV > trackHighRef.current) {
          // Volume rose without pumps (manual fill, refill from elsewhere) — reset peak
          trackHighRef.current = smV;
        } else {
          const drop = trackHighRef.current - smV;
          if (drop > CONSUMPTION_THRESHOLD_L) {
            setConsumedTotal((prev) => prev + drop);
            trackHighRef.current = smV;
          }
        }

        // Sliding window for instantaneous flow rate (smoothed samples)
        const samples = volumeSamplesRef.current;
        samples.push({ ts: now, v: smV });
        while (samples.length > 0 && now - samples[0].ts > FLOW_WINDOW_MS) {
          samples.shift();
        }

        if (samples.length >= 2 && !pumpsOn) {
          const first = samples[0];
          const last = samples[samples.length - 1];
          const dtMin = (last.ts - first.ts) / 60_000;
          const dv = first.v - last.v;
          setFlowRate(dtMin > 0 && dv > 0 ? dv / dtMin : 0);
        } else {
          setFlowRate(0);
        }
      }

      // Refresh events occasionally
      if (station && Math.random() < 0.05) {
        window.api.call("GET", `/api/stations/${station.id}/events`).then((evts) => {
          setEvents(evts as ApiEvent[]);
        });
      }
    };
    ws.onerror = () => ws.close();
  }, [station]);

  useEffect(() => {
    connectWs();
    return () => wsRef.current?.close();
  }, [connectWs]);

  // Display values: prefer smoothed (renderer-side), fall back to last known
  const level =
    smoothedLevel ?? liveState?.level_pct ?? station?.level_pct ?? null;
  const volume =
    smoothedVolume ?? liveState?.volume_l ?? station?.volume_l ?? null;
  const moistureRaw = liveState?.moisture_pct ?? station?.moisture_pct ?? null;
  // Prefer EMA-smoothed value (live, builds up after first WS message);
  // fall back to raw → normalized if smoothing hasn't kicked in yet.
  const moisture = smoothedMoisture ?? normalizeMoisture(moistureRaw);
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

  const handleResetConsumed = () => {
    setConsumedTotal(0);
  };

  const pumpBtnDisabled = level !== null && level >= 100 && !pumpsOn;
  const drainOpen = (moisture ?? 0) > MOISTURE_DRAIN_THRESHOLD_PCT;

  const visibleEvents = useMemo(
    () => events.filter((ev) => ev.type !== "leak_detected"),
    [events]
  );

  return (
    <div style={s.root}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.title}>Бак с водой</div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div
            style={{
              ...s.wsStatus,
              background: wsConnected ? "#14532d" : "#450a0a",
              color: wsConnected ? "#4ade80" : "#f87171",
            }}
          >
            {wsConnected ? "В сети" : "Переподключение..."}
          </div>
          <button
            style={{ ...s.btn, padding: "8px 16px", fontSize: 13, background: "#334155", color: "#94a3b8" }}
            onClick={() => (window.location.href = "#/history")}
          >
            История
          </button>
          <button
            style={{ ...s.btn, padding: "8px 16px", fontSize: 13, background: "#334155", color: "#94a3b8" }}
            onClick={() => (window.location.href = "#/calibration")}
          >
            Калибровка
          </button>
        </div>
      </div>

      {/* Main content */}
      <div style={s.row}>
        {/* Tank visual */}
        <div style={{ ...s.card, display: "flex", flexDirection: "column", alignItems: "center", gap: 16, minWidth: 180 }}>
          <TankVisual levelPct={level} pumpsOn={pumpsOn} height={280} width={150} />
          <div style={{ textAlign: "center" }}>
            <div style={s.label}>Объём</div>
            <div style={s.value}>{volume !== null ? `${volume.toFixed(1)} Л` : "—"}</div>
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, flex: 1 }}>
          {/* Pump control */}
          <div style={s.card}>
            <div style={s.label}>Управление насосами</div>
            <div style={{ display: "flex", gap: 12, marginTop: 12, alignItems: "center" }}>
              <button
                style={{ ...s.btn, ...(pumpBtnDisabled || pumpsOn || mode === "auto" ? s.btnDisabled : s.btnGreen) }}
                disabled={pumpBtnDisabled || pumpsOn || mode === "auto"}
                onClick={() => handlePump("on")}
              >
                Начать наполнение
              </button>
              <button
                style={{ ...s.btn, ...(!pumpsOn || mode === "auto" ? s.btnDisabled : s.btnRed) }}
                disabled={!pumpsOn || mode === "auto"}
                onClick={() => handlePump("off")}
              >
                Остановить
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
                Насосы: {pumpsOn ? "ВКЛ" : "ВЫКЛ"}
              </div>
            </div>
          </div>

          {/* Auto mode */}
          <div style={s.card}>
            <div style={s.label}>Автоматический режим</div>
            <div style={{ display: "flex", gap: 16, marginTop: 12, alignItems: "center" }}>
              <button
                style={{ ...s.btn, ...(mode === "auto" ? s.btnRed : s.btnGreen) }}
                onClick={handleModeToggle}
              >
                {mode === "auto" ? "Выключить авто" : "Включить авто"}
              </button>
              {mode !== "auto" && (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ color: "#94a3b8", fontSize: 14 }}>Цель:</span>
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
                  Авто-режим активен — цель: {liveState?.target_level ?? targetLevel}%
                </div>
              )}
            </div>
          </div>

          {/* Consumption */}
          <div style={{ ...s.card, display: "flex", alignItems: "center", gap: 16 }}>
            <MoistureGauge moisturePct={moisture} />
            <div style={{ flex: 1 }}>
              <div style={s.label}>Расход воды</div>
              <div style={{ display: "flex", gap: 32, marginTop: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>Сейчас</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "#f1f5f9", marginTop: 2 }}>
                    {flowRate >= 0.01 ? `${flowRate.toFixed(2)} Л/мин` : "0 Л/мин"}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>Всего</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "#3b82f6", marginTop: 2 }}>
                    {consumedTotal.toFixed(2)} Л
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: drainOpen ? "#3b82f6" : "#64748b", marginTop: 8 }}>
                {moisture === null
                  ? "Сток: нет данных"
                  : `Сток: ${moisture.toFixed(0)} % (датчик влажности)`}
              </div>
            </div>
            <button
              style={{
                padding: "8px 14px",
                borderRadius: 10,
                border: "none",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                background: "#334155",
                color: "#e2e8f0",
                alignSelf: "flex-start",
              }}
              onClick={handleResetConsumed}
              title="Обнулить накопленный расход"
            >
              Сброс
            </button>
          </div>

          {/* Event log */}
          <div style={{ ...s.card, flex: 1 }}>
            <div style={s.label}>Последние события</div>
            <div style={{ marginTop: 8 }}>
              <EventLog events={visibleEvents} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
