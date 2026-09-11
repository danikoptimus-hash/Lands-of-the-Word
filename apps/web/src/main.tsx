import React from "react";
import { registerSW } from "virtual:pwa-register";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { UiProvider } from "./lib/ui";
import { Layout } from "./pages/Layout";
import { LoginPage } from "./pages/LoginPage";
import { GamesPage } from "./pages/GamesPage";
import { GamePage } from "./pages/GamePage";
import { LabelsPage } from "./pages/LabelsPage";
import { TeamPage } from "./pages/TeamPage";
import { JoinPage } from "./pages/JoinPage";
import { AccountPage } from "./pages/AccountPage";
import { ForgotPage } from "./pages/ForgotPage";
import { ResetPage } from "./pages/ResetPage";
import { AdminDashboard } from "./pages/AdminDashboard";
import { NewGamePage } from "./pages/NewGamePage";
import { HowToPlayPage } from "./pages/HowToPlayPage";
import "./styles/index.css";

function Private({ children }: { children: React.ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="container muted">Загрузка…</p>;
  return user ? children : <Navigate to="/login" replace />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <UiProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot" element={<ForgotPage />} />
            <Route path="/reset/:token" element={<ResetPage />} />
            <Route path="/" element={<Private><GamesPage /></Private>} />
            <Route path="/games/new" element={<Private><NewGamePage /></Private>} />
            <Route path="/how-to-play" element={<HowToPlayPage />} />
            <Route path="/games/:id" element={<Private><GamePage /></Private>} />
            <Route path="/games/:id/labels" element={<Private><LabelsPage /></Private>} />
            <Route path="/games/:id/team" element={<Private><TeamPage /></Private>} />
            <Route path="/join/:token" element={<JoinPage />} />
            <Route path="/account" element={<Private><AccountPage /></Private>} />
            <Route path="/admin" element={<Private><AdminDashboard /></Private>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
        </UiProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);

// Сервис-воркер PWA: обновляется сам при новом деплое, картинки карты и сборка берутся из кеша устройства.
registerSW({ immediate: true });
