import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type User } from "./api";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (nickname: string, password: string) => Promise<void>;
  register: (nickname: string, password: string, email?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ user: User }>("/api/auth/me").then((r) => setUser(r.user)).catch(() => setUser(null)).finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (nickname: string, password: string) => {
    const r = await api<{ user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify({ nickname, password }) });
    setUser(r.user);
  }, []);
  const register = useCallback(async (nickname: string, password: string, email?: string) => {
    const r = await api<{ user: User }>("/api/auth/register", { method: "POST", body: JSON.stringify({ nickname, password, email }) });
    setUser(r.user);
  }, []);
  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
  }, []);

  return <Ctx.Provider value={{ user, loading, login, register, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
