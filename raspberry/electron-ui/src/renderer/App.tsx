import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Dashboard } from "./pages/Dashboard";
import { HistoryChart } from "./pages/HistoryChart";
import { CalibrationModal } from "./pages/CalibrationModal";

// Hash-based routing (no React Router needed for Electron)
function useHash() {
  const [hash, setHash] = useState(window.location.hash || "#/");
  useEffect(() => {
    const handler = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  return hash;
}

const App: React.FC = () => {
  const hash = useHash();

  if (hash === "#/history") return <HistoryChart />;
  if (hash === "#/calibration") return <CalibrationModal />;
  return <Dashboard />;
};

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
