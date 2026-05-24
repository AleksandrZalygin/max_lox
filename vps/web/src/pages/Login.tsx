import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import http from "../api";

const s: Record<string, React.CSSProperties> = {
  root: {
    display: "flex", alignItems: "center", justifyContent: "center",
    minHeight: "100vh", background: "#0f172a",
  },
  card: {
    background: "#1e293b", borderRadius: 20, padding: 40,
    width: 380, display: "flex", flexDirection: "column", gap: 20,
  },
  title: { fontSize: 26, fontWeight: 700, color: "#f1f5f9", textAlign: "center" },
  subtitle: { fontSize: 14, color: "#64748b", textAlign: "center", marginTop: -10 },
  label: { fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 },
  input: {
    width: "100%", background: "#0f172a", border: "1px solid #334155",
    color: "#e2e8f0", padding: "12px 14px", borderRadius: 10, fontSize: 16,
  },
  btn: {
    width: "100%", padding: 14, borderRadius: 12, border: "none",
    fontSize: 16, fontWeight: 600, cursor: "pointer", background: "#3b82f6", color: "white",
  },
  error: { color: "#f87171", fontSize: 13, textAlign: "center" },
};

export const Login: React.FC = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await http.post<{ access_token: string }>("/auth/login", { username, password });
      localStorage.setItem("token", res.data.access_token);
      navigate("/stations");
    } catch {
      setError("Invalid username or password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.root}>
      <form style={s.card} onSubmit={handleLogin}>
        <div>
          <div style={s.title}>Water Tank</div>
          <div style={s.subtitle}>Management System</div>
        </div>

        <div>
          <div style={s.label}>Username</div>
          <input
            style={s.input}
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </div>

        <div>
          <div style={s.label}>Password</div>
          <input
            style={s.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        {error && <div style={s.error}>{error}</div>}

        <button style={{ ...s.btn, opacity: loading ? 0.7 : 1 }} type="submit" disabled={loading}>
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </form>
    </div>
  );
};
