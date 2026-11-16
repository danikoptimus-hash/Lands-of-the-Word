/**
 * Перевод интерфейса. Ключ — русская строка как она написана в коде; t() возвращает перевод для текущего
 * языка или саму строку. Подстановки: t("Ход {n}", { n: 3 }). Язык ставит AuthProvider (из учётки или из
 * выбора на странице входа); при смене языка дерево перерисовывается через key.
 */
export type Locale = "ru" | "en";

/**
 * Английский словарь лежит отдельным файлом и грузится, только когда выбран английский (ревизия скорости, этап 2):
 * раньше его 360 КБ и ещё 300 КБ перевода «Что нового» были в главном файле программы у каждого русскоязычного игрока.
 * Пока словарь в пути, t() отдаёт русскую строку; кто ждёт словаря — см. AuthProvider и запуск в main.tsx.
 */
let EN: Record<string, string> = {};
let coreReady = false, core: Promise<void> | null = null;
let newsReady = false, news: Promise<void> | null = null;
export const englishReady = (): boolean => coreReady;
export function loadEnglish(): Promise<void> {
  return (core ??= import("./i18n.en").then((m) => { EN = { ...EN, ...m.EN }; coreReady = true; }).catch((e) => { core = null; throw e; }));
}
/** Перевод записей «Что нового» — ещё один отдельный файл: нужен только на этой странице. */
export const newsEnglishReady = (): boolean => newsReady;
export function loadNewsEnglish(): Promise<void> {
  return (news ??= import("./en/changelog").then((m) => { EN = { ...EN, ...m.CHANGELOG_EN }; newsReady = true; }).catch((e) => { news = null; throw e; }));
}

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
