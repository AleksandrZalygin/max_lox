import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Login } from "./pages/Login";
import { Stations } from "./pages/Stations";
import { StationDetail } from "./pages/StationDetail";
import { History } from "./pages/History";

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const token = localStorage.getItem("token");
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

const App: React.FC = () => (
  <Routes>
    <Route path="/login" element={<Login />} />
    <Route
      path="/stations"
      element={<ProtectedRoute><Stations /></ProtectedRoute>}
    />
    <Route
      path="/stations/:stationId"
      element={<ProtectedRoute><StationDetail /></ProtectedRoute>}
    />
    <Route
      path="/stations/:stationId/history"
      element={<ProtectedRoute><History /></ProtectedRoute>}
    />
    <Route path="*" element={<Navigate to="/stations" replace />} />
  </Routes>
);

export default App;
