import React, { useEffect, useState } from "react";
import { Station } from "../types";

const s: Record<string, React.CSSProperties> = {
  root: { padding: 24, display: "flex", flexDirection: "column", gap: 20, height: "100vh" },
  header: { display: "flex", alignItems: "center", gap: 16 },
  title: { fontSize: 22, fontWeight: 700, color: "#f1f5f9", flex: 1 },
  card: { background: "#1e293b", borderRadius: 16, padding: 24 },
  row: { display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" },
  field: { display: "flex", flexDirection: "column", gap: 6, minWidth: 180 },
  label: { fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 },
  input: {
    background: "#0f172a", border: "1px solid #334155", color: "#e2e8f0",
    padding: "10px 14px", borderRadius: 10, fontSize: 16, width: "100%",
  },
  btn: {
    padding: "12px 24px", borderRadius: 12, border: "none",
    fontSize: 16, fontWeight: 600, cursor: "pointer",
  },
  formula: {
    background: "#0f172a", borderRadius: 10, padding: 16,
    fontFamily: "monospace", fontSize: 13, color: "#94a3b8", lineHeight: 2,
  },
};

export const CalibrationModal: React.FC = () => {
  const [station, setStation] = useState<Station | null>(null);
  const [form, setForm] = useState({
    distance_empty: 50,
    distance_full: 5,
    length_cm: 100,
    width_cm: 60,
    height_cm: 45,
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    window.api.call("GET", "/api/stations").then((data) => {
      const stations = data as Station[];
      if (stations.length > 0) {
        const s = stations[0];
        setStation(s);
        if (s.calibration) {
          setForm({
            distance_empty: s.calibration.distance_empty ?? 50,
            distance_full: s.calibration.distance_full ?? 5,
            length_cm: s.calibration.length_cm ?? 100,
            width_cm: s.calibration.width_cm ?? 60,
            height_cm: s.calibration.height_cm ?? 45,
          });
        }
      }
    });
  }, []);

  const handleSave = async () => {
    if (!station) return;
    setError("");
    try {
      await window.api.call("PATCH", `/api/stations/${station.id}`, {
        calibration: form,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(String(e));
    }
  };

  const field = (key: keyof typeof form, label: string, unit: string) => (
    <div style={s.field}>
      <label style={s.label}>{label} ({unit})</label>
      <input
        style={s.input}
        type="number"
        step="0.1"
        value={form[key]}
        onChange={(e) => setForm((prev) => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
      />
    </div>
  );

  const previewLevel = form.distance_empty !== form.distance_full
    ? Math.max(0, Math.min(100, (form.distance_empty - form.distance_empty * 0.5) / (form.distance_empty - form.distance_full) * 100))
    : 0;

  return (
    <div style={s.root}>
      <div style={s.header}>
        <div style={s.title}>Калибровка</div>
        <button
          style={{ ...s.btn, background: "#334155", color: "#94a3b8" }}
          onClick={() => (window.location.href = "#/")}
        >
          ← Главная
        </button>
      </div>

      <div style={s.card}>
        <div style={s.row}>
          {field("distance_empty", "Расстояние (пустой бак)", "см")}
          {field("distance_full", "Расстояние (полный бак)", "см")}
        </div>
        <div style={s.row}>
          {field("length_cm", "Длина бака", "см")}
          {field("width_cm", "Ширина бака", "см")}
          {field("height_cm", "Высота бака", "см")}
        </div>

        <div style={s.formula}>
          <div>уровень% = (расст_пусто − текущее_расст) / (расст_пусто − расст_полно) × 100</div>
          <div>объём_Л = длина × ширина × (высота × уровень% / 100) / 1000</div>
          <div style={{ color: "#3b82f6", marginTop: 8 }}>
            Макс. объём = {((form.length_cm * form.width_cm * form.height_cm) / 1000).toFixed(1)} Л
          </div>
        </div>

        <div style={{ marginTop: 20, display: "flex", gap: 12, alignItems: "center" }}>
          <button
            style={{ ...s.btn, background: saved ? "#22c55e" : "#3b82f6", color: "white" }}
            onClick={handleSave}
          >
            {saved ? "Сохранено!" : "Сохранить калибровку"}
          </button>
          {error && <span style={{ color: "#ef4444", fontSize: 13 }}>{error}</span>}
        </div>
      </div>

      <div style={{ ...s.card, color: "#94a3b8", fontSize: 14, lineHeight: 1.8 }}>
        <div style={{ fontWeight: 600, color: "#f1f5f9", marginBottom: 8 }}>Процедура калибровки</div>
        <ol style={{ paddingLeft: 20 }}>
          <li>Полностью опорожните бак. Запишите показание HC-SR04 — введите как «Расстояние (пустой бак)».</li>
          <li>Заполните бак до максимально безопасного уровня. Запишите показание HC-SR04 — введите как «Расстояние (полный бак)».</li>
          <li>Измерьте внутренние размеры бака и введите их.</li>
          <li>Нажмите «Сохранить». Система сразу начнёт использовать новые значения.</li>
        </ol>
        <div style={{ marginTop: 12, color: "#64748b", fontSize: 12 }}>
          Подсказка: HC-SR04 закреплён на крышке и направлен вниз. Пустой бак = большее расстояние. Полный бак = меньшее расстояние.
        </div>
      </div>
    </div>
  );
};
