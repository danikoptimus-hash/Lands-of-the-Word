import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, type User, clearReady, setOwner } from "./api";
import { savedUser, saveUser } from "./persist";
import { englishReady, loadEnglish, readGuestLocale, saveGuestLocale, setLocale, type Locale } from "./i18n";
import { syncPush } from "./push";

/** Аккаунт на этом устройстве (решение владельца 05.10: несколько аккаунтов с быстрым переключением). */
export interface DeviceAccount { id: string; nickname: string; displayName: string | null; active: boolean }

interface AuthState {
  user: User | null;
  loading: boolean;
  /** Сервер не отвечает на «кто я»: это не выход из аккаунта, запрос повторяется сам. */
  offline: boolean;
  /** add — добавить аккаунт: текущий остаётся на устройстве, новый становится активным. */
  login: (nickname: string, password: string, add?: boolean) => Promise<void>;
  register: (nickname: string, password: string, email: string) => Promise<void>;
  /** Выход из активного аккаунта; если на устройстве есть другие, следующий становится активным. */
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Аккаунты на устройстве (активный первым) и переключение: после него страница перезагружается с главной. */
  accounts: DeviceAccount[];
  switchAccount: (userId: string) => Promise<void>;
  /** Язык интерфейса: из учётки, а для гостя — выбранный на странице входа. */
  locale: Locale;
  setGuestLocale: (l: Locale) => void;
}

const Ctx = createContext<AuthState | null>(null);
/** Сервер ответил, что входа нет (а не просто не ответил). */
const signedOut = (e: unknown) => e instanceof ApiError && (e.status === 401 || e.status === 403);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Кто вошёл в прошлый раз, помнится между запусками (ревизия скорости, этап 2): игра открывается сразу, не дожидаясь ответа
  // «кто я». Ответ всё равно запрашивается; если сервер скажет «не вошёл» или назовёт другую учётку — запомненное стирается.
  const [user, setUser] = useState<User | null>(() => { const was = savedUser<User>(); if (was) setOwner(was.id); return was; });
  const [loading, setLoading] = useState(() => user === null);
  /** Принять ответ сервера «кто я». */
  /** Чьи ответы сейчас в памяти этой вкладки (null — ничьи: не вошёл, только что вышел или входит заново). */
  const current = useRef<string | null>(user?.id ?? null);
  const accept = useCallback((u: User | null) => {
    if (!u) { clearReady(); current.current = null; setUser(null); return; }
    const was = savedUser<User>();
    // Сервер назвал другую учётку: аккаунт сменили в соседней вкладке. На устройстве лежат снимки прежней, а в памяти этой
    // вкладки — её ответы: стираем и начинаем с чистого листа. Владельца снимков до перезагрузки не назначаем — иначе ответ
    // прежней учётки, пришедший в эти мгновения, записался бы под именем новой (находка независимого разбора 16.11).
    if ((was && was.id !== u.id) || (current.current && current.current !== u.id)) { clearReady(); saveUser(u); window.location.reload(); return; }
    current.current = u.id; setOwner(u.id); saveUser(u); setUser(u);
  }, []);
  const [offline, setOffline] = useState(false);
  const [guestLocale, setGuest] = useState<Locale>(readGuestLocale());
  const want: Locale = user ? (user.locale === "en" ? "en" : "ru") : guestLocale;
  // Английский словарь — отдельный файл (ревизия скорости, этап 2). Пока он в пути, экран остаётся на русском и
  // переключается, когда словарь пришёл; при сбое связи — повтор с растущей паузой. При запуске словарь ждут ещё до первой
  // отрисовки (main.tsx), так что сюда попадает только смена языка на ходу: вход англоязычной учётки, выбор на странице входа.
  const [, dictCame] = useState(0);
  useEffect(() => {
    if (want !== "en" || englishReady()) return;
    let live = true, tm: ReturnType<typeof setTimeout> | undefined, tries = 0;
    const go = () => { loadEnglish().then(() => { if (live) dictCame((n) => n + 1); }).catch(() => { if (live) tm = setTimeout(go, Math.min(30_000, 2000 * 2 ** tries++)); }); };
    go();
    return () => { live = false; clearTimeout(tm); };
  }, [want]);
  const locale: Locale = want === "en" && !englishReady() ? "ru" : want;
  // Синхронно перед отрисовкой детей: t() читает текущий язык при рендере.
  setLocale(locale);
  const setGuestLocale = useCallback((l: Locale) => { saveGuestLocale(l); setGuest(l); }, []);

  const [accounts, setAccounts] = useState<DeviceAccount[]>([]);
  const loadAccounts = useCallback(() => api<{ accounts: DeviceAccount[] }>("/api/auth/accounts").then((r) => setAccounts(r.accounts)).catch(() => setAccounts([])), []);
  // «Кто я». Ответ сервера «не вошёл» (401) — это ответ: показываем вход. А вот сбой связи, перезапуск сервера при выкладке или
  // отказ ограничителя запросов — не ответ: сессия жива, и раньше игрока в такой момент зря выбрасывало на страницу входа
  // (ревизия 15.11). Теперь запрос повторяется с растущей паузой, а экран честно говорит, что нет связи.
  // Вход, регистрация и «обновить» отвечают на тот же вопрос сами: после них повторы прекращаются, а ответ запроса, начатого
  // раньше, не учитывается — иначе запоздалое «не вошёл» выбросило бы только что вошедшего (находка повторного разбора 15.11).
  const answered = useRef(0);
  useEffect(() => {
    let alive = true, tries = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const ask = () => {
      const was = answered.current;
      api<{ user: User }>("/api/auth/me").then((r) => { if (!alive || was !== answered.current) return; accept(r.user); setOffline(false); setLoading(false); }).catch((e) => {
        if (!alive || was !== answered.current) return;
        if (signedOut(e)) { accept(null); setOffline(false); setLoading(false); return; }
        tries++; setOffline(true);
        timer = setTimeout(ask, Math.min(10_000, 1000 * 2 ** Math.min(tries - 1, 4)));
      });
    };
    ask();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, []);
  // По номеру учётки, а не по объекту: «кто я» подтверждает запомненного пользователя новым объектом, и список запрашивался дважды.
  const userId = user?.id;
  useEffect(() => { if (userId) void loadAccounts(); else setAccounts([]); }, [userId, loadAccounts]);

  const login = useCallback(async (nickname: string, password: string, add = false) => {
    const r = await api<{ user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify({ nickname, password, add }) });
    answered.current++; clearReady(); current.current = null; accept(r.user); setOffline(false); setLoading(false);
    void syncPush();
  }, []);
  const switchAccount = useCallback(async (userId: string) => {
    await api("/api/auth/switch", { method: "POST", body: JSON.stringify({ userId }) });
    clearReady();
    // Страницы держат данные прежнего аккаунта (игры, карта, события): проще начать с чистого листа.
    window.location.assign("/");
  }, []);
  const logoutAll = useCallback(async () => {
    await api("/api/auth/logout-all", { method: "POST" });
    clearReady(); current.current = null; setUser(null);
  }, []);
  // Язык, выбранный гостем на странице входа, становится языком новой учётки.
  const register = useCallback(async (nickname: string, password: string, email: string) => {
    const r = await api<{ user: User }>("/api/auth/register", { method: "POST", body: JSON.stringify({ nickname, password, email, locale: guestLocale }) });
    answered.current++; clearReady(); current.current = null; accept(r.user); setOffline(false); setLoading(false);
  }, [guestLocale, accept]);
  const refresh = useCallback(async () => {
    // Сбой связи пользователя не сбрасывает: только ответ сервера «не вошёл».
    try { const r = await api<{ user: User }>("/api/auth/me"); answered.current++; accept(r.user); setOffline(false); setLoading(false); } catch (e) { if (signedOut(e)) { answered.current++; accept(null); setOffline(false); setLoading(false); } }
  }, [accept]);
  const logout = useCallback(async () => {
    const r = await api<{ ok: boolean; user: User | null }>("/api/auth/logout", { method: "POST" });
    clearReady();
    if (r.user) { window.location.assign("/"); return; }
    current.current = null; setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, offline, login, register, logout, logoutAll, refresh, accounts, switchAccount, locale, setGuestLocale }), [user, loading, offline, login, register, logout, logoutAll, refresh, accounts, switchAccount, locale, setGuestLocale]);
  return <Ctx.Provider value={value}><Fragment key={locale}>{children}</Fragment></Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
