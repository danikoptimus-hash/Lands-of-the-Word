/**
 * Перевод интерфейса. Ключ — русская строка как она написана в коде; t() возвращает перевод для текущего
 * языка или саму строку. Подстановки: t("Ход {n}", { n: 3 }). Язык ставит AuthProvider (из учётки или из
 * выбора на странице входа); при смене языка дерево перерисовывается через key.
 */
import { EN } from "./i18n.en";

export type Locale = "ru" | "en";
let current: Locale = "ru";
const GUEST_KEY = "lotw.locale";

export function getLocale(): Locale { return current; }
export function setLocale(l: Locale): void { current = l; if (typeof document !== "undefined") document.documentElement.lang = l; }
export function readGuestLocale(): Locale { try { return localStorage.getItem(GUEST_KEY) === "en" ? "en" : "ru"; } catch { return "ru"; } }
export function saveGuestLocale(l: Locale): void { try { localStorage.setItem(GUEST_KEY, l); } catch { /* приватный режим */ } }

export function t(ru: string, vars?: Record<string, string | number>): string {
  const base = current === "en" ? EN[ru] ?? ru : ru;
  if (!vars) return base;
  return base.replace(/\{(\w+)\}/g, (m: string, k: string) => (k in vars ? String(vars[k]) : m));
}
