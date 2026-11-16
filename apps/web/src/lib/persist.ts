/**
 * Память между запусками (ревизия скорости, этап 2; решение владельца 16.11: «апрув»). Телефон хранит последние ответы,
 * с которых начинается игра: кто вошёл, список игр и команд, состав и карту последней команды. При следующем запуске они
 * показываются сразу, а свежие ответы сервера тихо подменяют их — вместо трёх кругов запросов и трёх экранов загрузки.
 *
 * Чужого здесь не остаётся: каждый снимок помечен учёткой и показывается только ей; при входе, выходе и смене аккаунта
 * всё стирается. Снимок старше недели не показывается. Любая ошибка хранилища (место кончилось, режим «инкогнито»)
 * молча пропускается — игра тогда просто грузится по-прежнему.
 */
const ME = "lotw.me", GAME = "lotw.game", SNAP = "lotw.s:", REV = "lotw.rev:";
const MAX_CHARS = 1_500_000, MAX_AGE = 7 * 86_400_000;
type Snap = { u: string; t: number; off?: number; v: unknown };

const store = (): Storage | null => { try { return window.localStorage; } catch { return null; } };

/** Кто вошёл в прошлый раз (ответ «кто я»); null — никто или хранилище недоступно. */
export function savedUser<T extends { id: string }>(): T | null {
  try { const raw = store()?.getItem(ME); const u = raw ? (JSON.parse(raw) as T) : null; return u && typeof u.id === "string" ? u : null; } catch { return null; }
}
export function saveUser(u: { id: string } | null): void {
  try { if (u) store()?.setItem(ME, JSON.stringify(u)); else store()?.removeItem(ME); } catch { /* хранилище недоступно */ }
}

/** Какие ответы хранятся: список игр, мои команды, состав и карта команды. */
export function persistable(url: string): boolean {
  return url === "/api/games" || url === "/api/me/teams" || /^\/api\/games\/[^/?]+\/(teams|my-map)$/.test(url);
}
const gameOf = (url: string): string | null => /^\/api\/games\/([^/?]+)\/my-map$/.exec(url)?.[1] ?? null;

/** Смещение часов сервера в ответе карты: по нему при показе снимка «время сервера» ставится на сейчас, а не на вчера. */
function clockOffset(v: unknown): number | undefined {
  const m = v as { now?: number; daytime?: { now?: number } } | null;
  const at = m?.daytime?.now ?? m?.now;
  return typeof at === "number" ? at - Date.now() : undefined;
}

const pending = new Map<string, { userId: string; value: unknown; off: number | undefined; timer: ReturnType<typeof setTimeout> }>();
function write(url: string, userId: string, value: unknown, off: number | undefined): void {
  try {
    const raw = JSON.stringify({ u: userId, t: Date.now(), off, v: value } satisfies Snap);
    if (raw.length > MAX_CHARS) { store()?.removeItem(SNAP + url); return; }
    store()?.setItem(SNAP + url, raw);
    const g = gameOf(url), rev = (value as { rev?: number } | null)?.rev;
    if (g && typeof rev === "number") store()?.setItem(REV + g, `${userId}:${rev}`);
  } catch { try { store()?.removeItem(SNAP + url); } catch { /* хранилище недоступно */ } }
}
/**
 * Запомнить ответ. Запись отложена и склеена: карта меняется «разницами» часто, а перевод её в текст — десятки миллисекунд
 * на телефоне; пишем не чаще раза в `wait` мс и обязательно — когда приложение сворачивают (см. flushSnaps).
 */
export function saveSnap(url: string, userId: string, value: unknown, wait = 1500): void {
  if (!persistable(url)) return;
  const off = clockOffset(value), was = pending.get(url);
  if (was) { was.userId = userId; was.value = value; was.off = off; return; }
  const timer = setTimeout(() => { const p = pending.get(url); pending.delete(url); if (p) write(url, p.userId, p.value, p.off); }, wait);
  pending.set(url, { userId, value, off, timer });
}
export function flushSnaps(): void {
  for (const [url, p] of [...pending]) { clearTimeout(p.timer); pending.delete(url); write(url, p.userId, p.value, p.off); }
}

/** Достать снимок этой учётки; у карты «время сервера» переставляется на сейчас по запомненному смещению часов. */
export function loadSnap<T>(url: string, userId: string): T | null {
  if (!persistable(url)) return null;
  try {
    const raw = store()?.getItem(SNAP + url);
    if (!raw) return null;
    const s = JSON.parse(raw) as Snap;
    if (s.u !== userId || Date.now() - s.t > MAX_AGE) { store()?.removeItem(SNAP + url); return null; }
    const v = s.v as { now?: number; daytime?: { now?: number } } | null;
    if (v && typeof s.off === "number") { const now = Date.now() + s.off; if (typeof v.now === "number") v.now = now; if (v.daytime && typeof v.daytime.now === "number") v.daytime.now = now; }
    return s.v as T;
  } catch { return null; }
}

/** Игра, в которую главная в прошлый раз перевела сама (одна команда): её состав и карту запрашиваем ещё до запуска программы. */
export function saveLastGame(id: string | null): void {
  try { if (id) store()?.setItem(GAME, id); else store()?.removeItem(GAME); } catch { /* хранилище недоступно */ }
}

/** Стереть всё запомненное: вход, выход, смена аккаунта, «кто я» ответил другой учёткой. */
export function purgeSnaps(): void {
  for (const p of pending.values()) clearTimeout(p.timer);
  pending.clear();
  try {
    const s = store(); if (!s) return;
    const drop: string[] = [];
    for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k && (k === ME || k === GAME || k.startsWith(SNAP) || k.startsWith(REV))) drop.push(k); }
    for (const k of drop) s.removeItem(k);
  } catch { /* хранилище недоступно */ }
}

if (typeof window !== "undefined") {
  // Свернули или закрыли — дописываем отложенное: следующий запуск начнётся с самого свежего снимка.
  window.addEventListener("pagehide", flushSnaps);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushSnaps(); });
}
