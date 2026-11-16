/**
 * Память между запусками (ревизия скорости, этап 2; решение владельца 16.11: «апрув»). Телефон хранит последние ответы,
 * с которых начинается игра: кто вошёл, список игр и команд, состав и карту последней команды. При следующем запуске они
 * показываются сразу, а свежие ответы сервера тихо подменяют их — вместо трёх кругов запросов и трёх экранов загрузки.
 *
 * Чужого здесь не остаётся: каждый снимок помечен учёткой и показывается только ей; при входе, выходе и смене аккаунта
 * всё стирается. Снимок старше недели не показывается. Любая ошибка хранилища (место кончилось, режим «инкогнито»)
 * молча пропускается — игра тогда просто грузится по-прежнему.
 *
 * У снимка есть номер формы данных (`FORM`): программа показывает только снимки своей формы. Номер увеличивают, когда
 * меняется то, что экраны читают из этих ответов, — иначе новая программа упала бы на старом снимке, а «Обновить» читало
 * бы его же (находка независимого разбора 16.11). На тот же случай экран ошибки стирает всё запомненное.
 */
const ME = "lotw.me", GAME = "lotw.game", SNAP = "lotw.s:", REV = "lotw.rev:";
const MAX_CHARS = 1_500_000, MAX_AGE = 7 * 86_400_000;
/** Номер формы снимков; 2 — карта со справочником текстов дел (этап 2). */
export const FORM = 2;
// Порядок полей важен: срок и форму чужих снимков уборка читает по началу строки, не разбирая сотни килобайт.
type Snap = { f: number; u: string; t: number; off?: number; v: unknown };
const HEAD = /^\{"f":(\d+),"u":"[^"]*","t":(\d+)/;

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
/** Стереть один снимок (и номер версии карты при нём). */
function drop(s: Storage, key: string): void {
  s.removeItem(key);
  const g = gameOf(key.slice(SNAP.length));
  if (g) s.removeItem(REV + g);
}
/** Снимки по возрасту, старые первыми; чужой формы и просроченные — с возрастом «бесконечность». */
function aged(s: Storage, except?: string): Array<{ key: string; t: number }> {
  const out: Array<{ key: string; t: number }> = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (!k || !k.startsWith(SNAP) || k === except) continue;
    const h = HEAD.exec((s.getItem(k) ?? "").slice(0, 160));
    out.push({ key: k, t: h && Number(h[1]) === FORM ? Number(h[2]) : 0 });
  }
  return out.sort((a, b) => a.t - b.t);
}
function write(url: string, userId: string, value: unknown, off: number | undefined): void {
  // Хранилища нет (режим «инкогнито») — не тратим время и на перевод карты в текст.
  const s = store(); if (!s) return;
  const key = SNAP + url;
  try {
    const raw = JSON.stringify({ f: FORM, u: userId, t: Date.now(), off, v: value } satisfies Snap);
    if (raw.length > MAX_CHARS) { drop(s, key); return; }
    try { s.setItem(key, raw); }
    catch {
      // Место кончилось: карты игр, куда давно не заходили, уступают его текущей — по одной, самые старые первыми.
      let saved = false;
      for (const old of aged(s, key)) { drop(s, old.key); try { s.setItem(key, raw); saved = true; break; } catch { /* мало — стираем следующий */ } }
      if (!saved) { drop(s, key); return; }
    }
    const g = gameOf(url), rev = (value as { rev?: number } | null)?.rev;
    if (g && typeof rev === "number") s.setItem(REV + g, `${userId}:${rev}`);
  } catch { try { drop(s, key); } catch { /* хранилище недоступно */ } }
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
    if (s.f !== FORM || s.u !== userId || Date.now() - s.t > MAX_AGE) { dropSnap(url); return null; }
    const v = s.v as { now?: number; daytime?: { now?: number } } | null;
    if (v && typeof s.off === "number") { const now = Date.now() + s.off; if (typeof v.now === "number") v.now = now; if (v.daytime && typeof v.daytime.now === "number") v.daytime.now = now; }
    return s.v as T;
  } catch { return null; }
}

/** Стереть снимок одного ответа: сервер ответил, что его больше нет или он не наш (исключили из команды, игру удалили). */
export function dropSnap(url: string): void {
  const p = pending.get(url);
  if (p) { clearTimeout(p.timer); pending.delete(url); }
  try { const s = store(); if (s) drop(s, SNAP + url); } catch { /* хранилище недоступно */ }
}
/** Уборка при запуске: просроченные снимки и снимки прежней формы стираются, а не лежат до переполнения. */
export function sweepSnaps(): void {
  try {
    const s = store(); if (!s) return;
    const now = Date.now();
    for (const { key, t } of aged(s)) if (now - t > MAX_AGE) drop(s, key);
  } catch { /* хранилище недоступно */ }
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
  // Уборка — когда запуск уже позади: она читает начало каждого снимка.
  setTimeout(sweepSnaps, 8000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushSnaps(); });
}
