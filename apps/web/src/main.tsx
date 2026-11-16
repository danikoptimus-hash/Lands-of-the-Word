import React, { Suspense, lazy } from "react";
import { registerSW } from "virtual:pwa-register";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { UiProvider } from "./lib/ui";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Layout } from "./pages/Layout";
import { LoginPage } from "./pages/LoginPage";
import { GamesPage } from "./pages/GamesPage";
import { SeasonBookPage } from "./pages/Journal";
import { TeamPage } from "./pages/TeamPage";
import { JoinPage } from "./pages/JoinPage";
import { AccountPage } from "./pages/AccountPage";
import { ForgotPage } from "./pages/ForgotPage";
import { ResetPage } from "./pages/ResetPage";
import { VerifyPage, VerifyPendingPage } from "./pages/VerifyPage";
/** Аналитика грузится отдельно: графики (ECharts) нужны только администратору платформы. */
const AdminDashboard = lazy(() => import("./pages/AdminDashboard").then((m) => ({ default: m.AdminDashboard })));
// Экраны администратора и «Что нового» — отдельными файлами (ревизия скорости, этап 2): игроку на карте они не нужны,
// а вместе с английским словарём занимали больше половины главного файла программы. Грузятся, когда их открывают.
const GamePage = lazy(() => import("./pages/GamePage").then((m) => ({ default: m.GamePage })));
const LabelsPage = lazy(() => import("./pages/LabelsPage").then((m) => ({ default: m.LabelsPage })));
const SupportPage = lazy(() => import("./pages/SupportPage").then((m) => ({ default: m.SupportPage })));
const AllGamesPage = lazy(() => import("./pages/AllGamesPage").then((m) => ({ default: m.AllGamesPage })));
const AdminUsersPage = lazy(() => import("./pages/AdminUsersPage").then((m) => ({ default: m.AdminUsersPage })));
const NewGamePage = lazy(() => import("./pages/NewGamePage").then((m) => ({ default: m.NewGamePage })));
const WhatsNewPage = lazy(() => import("./pages/WhatsNewPage").then((m) => ({ default: m.WhatsNewPage })));
import { HowToPlayPage } from "./pages/HowToPlayPage";
import { GoogleNicknamePage } from "./pages/GoogleNicknamePage";
import { PrivacyPage } from "./pages/PrivacyPage";
import "./styles/index.css";
import { loadEnglish, readGuestLocale, t } from "./lib/i18n";
import { savedUser } from "./lib/persist";
import { pageBusy } from "./lib/calm";

/** Только для вошедших. Пока почта не подтверждена, вместо любой страницы — «Подтвердите почту». */
function Private({ children }: { children: React.ReactElement }) {
  const { user, loading, offline } = useAuth();
  if (loading) return <p className="container muted" role={offline ? "status" : undefined}>{offline ? t("Нет связи с сервером. Пробуем снова…") : t("Загрузка…")}</p>;
  if (!user) return <Navigate to="/login" replace />;
  return user.emailVerified ? children : <VerifyPendingPage />;
}

/** Пока кусок программы в пути: та же строка, что при проверке входа. */
const Wait = () => <p className="container muted">{t("Загрузка…")}</p>;

const start = () => ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
    <BrowserRouter>
      <AuthProvider>
        <UiProvider>
        <Suspense fallback={<Wait />}>
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
            <Route path="/admin/support" element={<Private><SupportPage /></Private>} />
            <Route path="/admin/games" element={<Private><AllGamesPage /></Private>} />
            <Route path="/admin/users" element={<Private><AdminUsersPage /></Private>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
        </Suspense>
        </UiProvider>
      </AuthProvider>
    </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
// Англоязычному игроку словарь нужен до первой отрисовки, иначе экран мигнул бы русским. Язык известен сразу: из
// запомненной учётки или из выбора гостя. Словарь лежит в запасе сервис-воркера и приходит за миллисекунды; из сети его
// ждём не дольше трёх секунд. Не пришёл (нет связи, медленная связь) — запускаемся как есть, AuthProvider дождётся его сам.
if ((savedUser<{ id: string; locale?: string }>()?.locale ?? readGuestLocale()) === "en") {
  let started = false;
  const once = () => { if (!started) { started = true; start(); } };
  void loadEnglish().catch(() => {}).finally(once);
  window.setTimeout(once, 3000);
} else start();

// Кусок программы не загрузился. Если на сервере уже другая сборка (открытая вкладка просит файл прежней, которого нет) —
// страница обновляется; если сборка та же, дело в связи: страницу не трогаем, ошибку обрабатывает тот, кто просил кусок
// (иначе на плохой связи у администратора страница перезагружалась бы сама и набранный текст пропадал — находка
// независимого разбора 15.11).
// Сервер спрашиваем по адресу с параметром: обычный адрес главной сервис-воркер отдаёт из своего запаса, и страница
// сравнивала бы себя с собой же. Под сервис-воркером перезагрузка вернула бы ту же прежнюю оболочку, поэтому там просим
// обновиться его самого — когда новая версия возьмёт страницу под управление, сработает перезагрузка ниже
// (сразу, если вкладка видна и ничего не печатают). Без сервис-воркера — перезагрузка, не чаще раза в минуту.
window.addEventListener("vite:preloadError", () => {
  const mine = document.querySelector('script[type="module"][src*="/assets/"]')?.getAttribute("src");
  if (!mine || navigator.onLine === false) return;
  void fetch("/index.html?v=" + Date.now(), { cache: "no-store" }).then((r) => (r.ok ? r.text() : "")).then(async (html) => {
    if (!html || !html.includes("/assets/") || html.includes(mine)) return;
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      const reg = await navigator.serviceWorker.getRegistration().catch(() => undefined);
      if (reg) { void reg.update().catch(() => {}); return; }
    }
    try { const k = "lotw.reloadAt", was = Number(sessionStorage.getItem(k) ?? 0); if (Date.now() - was < 60_000) return; sessionStorage.setItem(k, String(Date.now())); } catch { return; }
    location.reload();
  }).catch(() => {});
});

// Сервис-воркер PWA: обновляется сам при новом деплое, картинки карты и сборка берутся из кеша устройства.
// Когда новая версия взяла страницу под управление, открытая вкладка всё ещё выполняет старую сборку (владелец
// видел «старое море» до перезагрузки) — перезагружаем её сами: сразу, если вкладка видна и ничего не печатают,
// иначе — как только в неё вернутся.
// Открытое приложение (особенно установленное на телефон) не узнаёт о новой сборке само: проверка идёт только при
// регистрации. Поэтому спрашиваем сервер о новой версии при каждом возвращении в приложение и раз в 10 минут
// (замечание владельца 21.10: после выкладки на телефоне ещё долго старая версия).
// onNeedReload пуст намеренно: без него модуль сервис-воркера сам перезагружает страницу в ту же секунду, как только новая
// версия, найденная позже минуты после запуска, взяла страницу под управление, — с открытым листом и набранным текстом
// (нашёл независимый разбор 16.11). Когда перезагружать, решает обработчик controllerchange ниже.
registerSW({ immediate: true, onNeedReload() { /* см. выше */ }, onRegisteredSW(_url, r) {
  if (!r) return;
  let last = Date.now();
  const check = () => { if (Date.now() - last < 30_000) return; last = Date.now(); void r.update().catch(() => {}); };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
  window.addEventListener("focus", check);
  window.setInterval(check, 10 * 60_000);
} });
if ("serviceWorker" in navigator) {
  let had = Boolean(navigator.serviceWorker.controller), done = false, waiting = false;
  // Перезагрузка — в спокойный момент (решение владельца 16.11: «да»): никто не печатает и не открыт лист или окно (дело,
  // задание города, форма сдачи, подтверждение) — lib/calm.ts. Раньше страница перезагружалась сразу, как только вкладка
  // видна и курсор не в поле ввода, — даже если игрок читал задание или собирал расстановку районов. Открытый раздел нижней
  // панели перезагрузке не мешает: раздел, открытый город и положение карты запоминаются и возвращаются (TeamPage, useViewport).
  const busy = pageBusy;
  const reload = () => {
    if (done || !waiting || busy()) return;
    done = true;
    // Карта запоминает, куда смотрел игрок: после перезагрузки она откроется там же.
    try { window.dispatchEvent(new Event("lotw:before-reload")); } catch { /* старый браузер */ }
    location.reload();
  };
  const arm = () => {
    if (waiting) return;
    waiting = true;
    reload();
    // Момент ещё не спокойный: пробуем снова — когда закрыли лист или ушли из поля, вернулись в приложение, и раз в пять секунд.
    document.addEventListener("visibilitychange", reload);
    document.addEventListener("focusout", () => setTimeout(reload, 400));
    document.addEventListener("click", () => setTimeout(reload, 400));
    window.setInterval(reload, 5000);
  };
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (had) { arm(); return; }
    had = true;
    // Страница открыта без управляющего сервис-воркера: первая установка (страница свежая) или жёсткая перезагрузка, после
    // которой вышла новая версия. Отличаем по главной странице сайта: если в ней уже другой файл программы — перезагрузка
    // нужна, иначе страница так и осталась бы на старой версии до ручного обновления.
    const mine = document.querySelector('script[type="module"][src*="/assets/"]')?.getAttribute("src");
    if (!mine) return;
    void fetch("/index.html?v=" + Date.now(), { cache: "no-store" }).then((r) => (r.ok ? r.text() : "")).then((html) => { if (html && html.includes("/assets/") && !html.includes(mine)) arm(); }).catch(() => {});
  });
}
