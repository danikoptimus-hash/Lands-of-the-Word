import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { Layout } from "./pages/Layout";
import { LoginPage } from "./pages/LoginPage";
import { GamesPage } from "./pages/GamesPage";
import { GamePage } from "./pages/GamePage";
import { TeamPage } from "./pages/TeamPage";
import { JoinPage } from "./pages/JoinPage";
import "./styles.css";

function Private({ children }: { children: React.ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="container muted">Загрузка…</p>;
  return user ? children : <Navigate to="/login" replace />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<Private><GamesPage /></Private>} />
            <Route path="/games/:id" element={<Private><GamePage /></Private>} />
            <Route path="/games/:id/team" element={<Private><TeamPage /></Private>} />
            <Route path="/join/:token" element={<JoinPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
