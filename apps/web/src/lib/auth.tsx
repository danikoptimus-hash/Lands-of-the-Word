import { Fragment, createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type User } from "./api";
import { readGuestLocale, saveGuestLocale, setLocale, type Locale } from "./i18n";
import { syncPush } from "./push";

/** Аккаунт на этом устройстве (решение владельца 05.10: несколько аккаунтов с быстрым переключением). */
export interface DeviceAccount { id: string; nickname: string; displayName: string | null; active: boolean }

interface AuthState {
  user: User | null;
  loading: boolean;
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [guestLocale, setGuest] = useState<Locale>(readGuestLocale());
  const locale: Locale = user ? (user.locale === "en" ? "en" : "ru") : guestLocale;
  // Синхронно перед отрисовкой детей: t() читает текущий язык при рендере.
  setLocale(locale);
  const setGuestLocale = useCallback((l: Locale) => { saveGuestLocale(l); setGuest(l); }, []);

  const [accounts, setAccounts] = useState<DeviceAccount[]>([]);
  const loadAccounts = useCallback(() => api<{ accounts: DeviceAccount[] }>("/api/auth/accounts").then((r) => setAccounts(r.accounts)).catch(() => setAccounts([])), []);
  useEffect(() => {
    api<{ user: User }>("/api/auth/me").then((r) => setUser(r.user)).catch(() => setUser(null)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { if (user) void loadAccounts(); else setAccounts([]); }, [user, loadAccounts]);

  const login = useCallback(async (nickname: string, password: string, add = false) => {
    const r = await api<{ user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify({ nickname, password, add }) });
    setUser(r.user);
    void syncPush();
  }, []);
  const switchAccount = useCallback(async (userId: string) => {
    await api("/api/auth/switch", { method: "POST", body: JSON.stringify({ userId }) });
    // Страницы держат данные прежнего аккаунта (игры, карта, события): проще начать с чистого листа.
    window.location.assign("/");
  }, []);
  const logoutAll = useCallback(async () => {
    await api("/api/auth/logout-all", { method: "POST" });
    setUser(null);
  }, []);
  // Язык, выбранный гостем на странице входа, становится языком новой учётки.
  const register = useCallback(async (nickname: string, password: string, email: string) => {
    const r = await api<{ user: User }>("/api/auth/register", { method: "POST", body: JSON.stringify({ nickname, password, email, locale: guestLocale }) });
    setUser(r.user);
  }, [guestLocale]);
  const refresh = useCallback(async () => {
    try { const r = await api<{ user: User }>("/api/auth/me"); setUser(r.user); } catch { setUser(null); }
  }, []);
  const logout = useCallback(async () => {
    const r = await api<{ ok: boolean; user: User | null }>("/api/auth/logout", { method: "POST" });
    if (r.user) { window.location.assign("/"); return; }
    setUser(null);
  }, []);

  return <Ctx.Provider value={{ user, loading, login, register, logout, logoutAll, refresh, accounts, switchAccount, locale, setGuestLocale }}><Fragment key={locale}>{children}</Fragment></Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
