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
import { SeasonBookPage } from "./pages/Journal";
import { TeamPage } from "./pages/TeamPage";
import { JoinPage } from "./pages/JoinPage";
import { AccountPage } from "./pages/AccountPage";
import { ForgotPage } from "./pages/ForgotPage";
import { ResetPage } from "./pages/ResetPage";
import { VerifyPage, VerifyPendingPage } from "./pages/VerifyPage";
import { AdminDashboard } from "./pages/AdminDashboard";
import { NewGamePage } from "./pages/NewGamePage";
import { HowToPlayPage } from "./pages/HowToPlayPage";
import { WhatsNewPage } from "./pages/WhatsNewPage";
import { GoogleNicknamePage } from "./pages/GoogleNicknamePage";
import { PrivacyPage } from "./pages/PrivacyPage";
import "./styles/index.css";
import { t } from "./lib/i18n";

/** Только для вошедших. Пока почта не подтверждена, вместо любой страницы — «Подтвердите почту». */
function Private({ children }: { children: React.ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="container muted">{t("Загрузка…")}</p>;
  if (!user) return <Navigate to="/login" replace />;
  return user.emailVerified ? children : <VerifyPendingPage />;
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
            <Route path="/google/nickname" element={<GoogleNicknamePage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/reset/:token" element={<ResetPage />} />
            <Route path="/verify/:token" element={<VerifyPage />} />
            <Route path="/" element={<Private><GamesPage /></Private>} />
            <Route path="/games/new" element={<Private><NewGamePage /></Private>} />
            <Route path="/how-to-play" element={<HowToPlayPage />} />
            <Route path="/whats-new" element={<WhatsNewPage />} />
            <Route path="/games/:id" element={<Private><GamePage /></Private>} />
            <Route path="/games/:id/labels" element={<Private><LabelsPage /></Private>} />
            <Route path="/games/:id/book" element={<Private><SeasonBookPage /></Private>} />
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
// Когда новая версия взяла страницу под управление, открытая вкладка всё ещё выполняет старую сборку (владелец
// видел «старое море» до перезагрузки) — перезагружаем её сами: сразу, если вкладка видна и ничего не печатают,
// иначе — как только в неё вернутся.
registerSW({ immediate: true });
if ("serviceWorker" in navigator) {
  let had = Boolean(navigator.serviceWorker.controller), done = false;
  const typing = () => { const el = document.activeElement; return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement; };
  const reload = () => { if (done) return; done = true; location.reload(); };
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!had) { had = true; return; } // первая установка: страница уже свежая
    if (document.visibilityState === "visible" && !typing()) reload();
    else document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && !typing()) reload(); });
  });
}
