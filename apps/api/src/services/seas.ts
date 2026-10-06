import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { BOOKS, INLAND_SEAS, hexCorners, hexToPixel, parseVertexKey, vertexKey, vertexToPixel } from "@lotw/domain";
import { prisma } from "../db.js";
import { loadBook, type BibleBook } from "./bible.js";
import { normalizeAnswer, opaqueId, seededShuffle } from "./cities.js";

/**
 * Моря Библии (решение владельца 06.10, вторая редакция вахт): у каждого моря десять вахт-головоломок по
 * Синодальному тексту — маяк, диск кормчего, две гарнитуры, что изменилось, обрывки карты, пеленги (командная),
 * счисление пути, разгрузка, прибор и устав (командная), судовая роль. Данные вахты у каждой команды свои
 * (семя: секрет игры + команда + море + номер вахты), ответы на клиент не уходят, проверяет сервер.
 * Командные вахты зачитываются всем, кто держал свой экран роли во время решения (решение владельца 06.10).
 */

const pt = z.tuple([z.number(), z.number()]);
const polygon = z.object({ name: z.string().optional(), points: z.array(pt).min(3) });
const place = z.object({ id: z.string().min(1), name: z.string().min(1), x: z.number(), y: z.number(), kind: z.string().optional() });
/** Карта моря: суша «вся» с водоёмами или острова на воде; места — в процентах ширины и высоты (100 × 75). */
const chartSchema = z.object({ land: z.literal("all").optional(), water: z.array(polygon).optional(), coast: z.array(polygon).optional(), places: z.array(place), rose: pt.optional() });
export type SeaChart = z.infer<typeof chartSchema>;

const refBase = { book: z.string().min(2), chapter: z.number().int().min(1) };
const wordPick = z.union([z.literal("first"), z.literal("last"), z.number().int().min(1)]);
const base = { title: z.string().min(1), prompt: z.string().min(1) };
export const LIGHT_KINDS = ["fl", "lfl", "oc", "iso", "fl2", "fl3"] as const;
const lightKind = z.enum(LIGHT_KINDS);
const panelWhen = z.object({ pennant: z.enum(["red", "white", "blue", "yellow"]).optional(), flashes: z.number().int().min(1).max(4).optional(), symbol: z.enum(["anchor", "fish", "star", "wave"]).optional(), needle: z.enum(["N", "E", "S", "W"]).optional() });
const taskSchema = z.discriminatedUnion("type", [
  // Маяк: огни с характеристиками; период названного огня — номер стиха; ответ — слово стиха.
  z.object({ ...base, type: z.literal("lights"), ...refBase, word: wordPick, lights: z.array(z.object({ name: z.string(), kind: lightKind, period: z.number().int().min(4) })).min(4), decoy: z.object({ kind: lightKind, period: z.number().int().min(4) }) }),
  // Диск кормчего: внутреннее кольцо своё у команды; расшифрованная фраза — вопрос, ответ — из Библии.
  z.object({ ...base, type: z.literal("disc"), text: z.string().regex(/^[А-Я ]+$/), answers: z.array(z.string().min(1)).min(1) }),
  // Две гарнитуры: слово спрятано в начертании букв отрывка (двоичный код по пять букв).
  z.object({ ...base, type: z.literal("fonts"), ...refBase, from: z.number().int().min(1), to: z.number().int().min(1), word: z.string().regex(/^[А-Я]+$/) }),
  // Что изменилось: два кадра сцены, отличия собираются из спрайтов; у команды свой набор отличий.
  z.object({ ...base, type: z.literal("diff"), scene: z.string().min(1), pick: z.number().int().min(3), changes: z.array(z.object({ id: z.string(), label: z.string(), x: z.number(), y: z.number(), w: z.number(), before: z.string().nullable(), after: z.string().nullable() })).min(4) }),
  // Обрывки карты: собрать клочки, потом нажать место из стиха.
  z.object({ ...base, type: z.literal("torn"), cols: z.number().int().min(2), rows: z.number().int().min(2), question: z.string(), place: z.string(), radius: z.number().min(2) }),
  // Пеленги (командная): карта у кормчего, пеленги у разведчика, ответ у капитана.
  z.object({ ...base, type: z.literal("bearings"), landmarks: z.array(z.string()).min(2), grid: z.object({ cols: z.number().int().min(4), rows: z.number().int().min(3) }), targets: z.array(pt).min(1), hint: z.string().optional() }),
  // Счисление пути: переходы по одному, ответ — точка на карте.
  z.object({ ...base, type: z.literal("reckoning"), starts: z.array(z.string()).min(1), mile: z.number().positive(), legs: z.array(z.object({ course: z.number(), miles: z.number().positive(), label: z.string() })).min(2), drifts: z.array(z.object({ course: z.number(), miles: z.number().positive(), label: z.string() })).default([]), question: z.string(), radius: z.number().min(2) }),
  // Разгрузка: сокобан с порядком видов; у команды свой уровень.
  z.object({ ...base, type: z.literal("unload"), kinds: z.record(z.object({ name: z.string(), sprite: z.string() })), levels: z.array(z.object({ map: z.array(z.string().min(3)).min(3), order: z.array(z.string()).min(1), solution: z.string().optional() })).min(1) }),
  // Прибор и устав (командная): панель у кормчего, устав у остальных, ввод у капитана; три раунда.
  z.object({ ...base, type: z.literal("panel"), rounds: z.number().int().min(1).max(5), manual: z.string(), rules: z.array(z.object({ when: panelWhen, ...refBase, verse: z.number().int().min(1), word: z.string().min(1), text: z.string() })).min(2) }),
  // Судовая роль: карточки с действиями из текста; подтверждение тройками.
  z.object({ ...base, type: z.literal("roster"), show: z.number().int().min(4), whos: z.array(z.string()).min(4), thens: z.array(z.string()).min(4), cards: z.array(z.object({ id: z.string(), clue: z.string(), who: z.string(), then: z.string(), figure: z.string() })).min(4) }),
]);
const contentSchema = z.object({
  code: z.string().min(2),
  name: z.string().min(1),
  nameEn: z.string().min(1),
  names: z.array(z.string()).default([]),
  intro: z.string().default(""),
  introEn: z.string().default(""),
  chart: chartSchema,
  tasks: z.array(taskSchema).length(10),
});
export type SeaContent = z.infer<typeof contentSchema>;
export type SeaTask = SeaContent["tasks"][number];
type TaskOf<T extends SeaTask["type"]> = Extract<SeaTask, { type: T }>;

const cache = new Map<string, SeaContent | null>();
const contentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../content/seas");

export async function loadSeaContent(code: string): Promise<SeaContent | null> {
  if (!/^[a-z]+$/.test(code)) return null;
  if (cache.has(code)) return cache.get(code)!;
  let content: SeaContent | null = null;
  try {
    content = contentSchema.parse(JSON.parse(await readFile(path.join(contentDir, `${code}.json`), "utf8")));
  } catch (e) {
    if (!(e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT")) throw e;
  }
  cache.set(code, content);
  return content;
}

export const seaKeyOf = (code: string) => `sea:${code}`;
/** Командные вахты: данные разложены по экранам ролей. */
export const TEAM_TYPES = new Set<SeaTask["type"]>(["bearings", "panel"]);
export const isTeamTask = (task: SeaTask) => TEAM_TYPES.has(task.type);

/** Детерминированный генератор по строке (xorshift; тот же приём, что seededShuffle). */
export function rngFrom(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
}
const pickOne = <T>(rng: () => number, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;

/** Слова стиха без знаков препинания; дефисы внутри имён остаются. */
export function verseWords(text: string): string[] {
  return text.split(/\s+/).map((tok) => tok.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).filter((w) => /\p{L}/u.test(w));
}
const verseOf = (book: BibleBook, chapter: number, verse: number): string | null => book.chapters?.[chapter - 1]?.[verse - 1] ?? null;
function pickWord(words: string[], which: "first" | "last" | number): string | null {
  if (which === "first") return words[0] ?? null;
  if (which === "last") return words[words.length - 1] ?? null;
  return words[which - 1] ?? null;
}
const bookNameRu = (code: string) => BOOKS.find((b) => b.code === code)?.nameRu ?? code;
/** Семя команды для вахты: у каждой команды свои данные, но постоянные между открытиями. */
const seedOf = (secret: string, scopeKey: string, index: number, kind: string) => `${secret.slice(0, 16)}|${scopeKey}|${kind}|${index}`;

/** Контекст участника для командных вахт: кто в команде и что команда уже сделала в этой вахте. */
export interface TaskCtx { userId: string; members: Array<{ userId: string; nickname: string; role: string; gameRole: string }>; progress: string[] }
/** Экраны командных вахт и кому они достаются в первую очередь. */
const SCREENS: Record<string, Array<{ screen: string; roles: string[] }>> = {
  bearings: [{ screen: "map", roles: ["HELMSMAN"] }, { screen: "table", roles: ["SCOUT", "PROPHET"] }, { screen: "input", roles: ["CAPTAIN", "DEPUTY"] }],
  panel: [{ screen: "panel", roles: ["HELMSMAN"] }, { screen: "manual", roles: ["CHRONICLER", "SCOUT", "PROPHET"] }, { screen: "input", roles: ["CAPTAIN", "DEPUTY"] }],
};
/**
 * Раздача экранов по ролям: кормчий — прибор или карта, разведчик (летописец, пророк) — таблица или устав,
 * капитан (заместитель) — ввод; остальные получают недостающие экраны по кругу. Никто не получает все экраны,
 * пока в команде больше одного человека: при двоих второй держит таблицу и ввод вместе.
 */
export function assignScreens(task: SeaTask, members: TaskCtx["members"], seed: string): Map<string, string[]> {
  const spec = SCREENS[task.type] ?? [];
  const out = new Map<string, string[]>();
  if (!spec.length || !members.length) return out;
  const order = seededShuffle(seed + "|screens", members.map((m) => m.userId));
  const sorted = members.slice().sort((a, b) => order.indexOf(a.userId) - order.indexOf(b.userId));
  if (sorted.length === 1) { out.set(sorted[0]!.userId, spec.map((s) => s.screen)); return out; }
  const taken = new Set<string>();
  const give = (userId: string, screen: string) => { out.set(userId, [...(out.get(userId) ?? []), screen]); taken.add(userId); };
  const screensLeft = spec.map((s) => s.screen);
  for (const s of spec) {
    const m = sorted.find((x) => !taken.has(x.userId) && (s.roles.includes(x.gameRole) || s.roles.includes(x.role)));
    if (m) { give(m.userId, s.screen); screensLeft.splice(screensLeft.indexOf(s.screen), 1); }
  }
  for (const m of sorted) { if (taken.has(m.userId) || !screensLeft.length) continue; give(m.userId, screensLeft.shift()!); }
  // Экраны остались без хозяина (команда меньше трёх): тот, кто видит прибор или карту, не должен видеть устав или
  // таблицу (иначе пропадает разговор), поэтому сначала те, у кого нет «спорного» экрана, затем — у кого экранов меньше.
  const conflict: Record<string, string> = { panel: "manual", manual: "panel", map: "table", table: "map" };
  for (const screen of screensLeft) {
    const m = sorted.slice().sort((a, b) => {
      const ca = (out.get(a.userId) ?? []).includes(conflict[screen] ?? "") ? 1 : 0, cb = (out.get(b.userId) ?? []).includes(conflict[screen] ?? "") ? 1 : 0;
      return ca - cb || (out.get(a.userId)?.length ?? 0) - (out.get(b.userId)?.length ?? 0);
    })[0]!;
    give(m.userId, screen);
  }
  // Остальные участники без экрана получают карту/устав по кругу (вводит один).
  const extra = spec.map((s) => s.screen).filter((s) => s !== "input");
  sorted.filter((m) => !taken.has(m.userId)).forEach((m, i) => give(m.userId, extra[i % extra.length]!));
  return out;
}

// ───────────────────────────── Вахты: данные команды ─────────────────────────────
export const ALPHABET = "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ"; // 32 буквы без Ё

const LIGHT_SPOTS = [[12, 40], [28, 31], [46, 27], [64, 30], [82, 36], [40, 46], [70, 44]] as const;
function lightsFor(task: TaskOf<"lights">, secret: string, scopeKey: string, index: number) {
  const seed = seedOf(secret, scopeKey, index, "lights");
  const rng = rngFrom(seed);
  const target = pickOne(rng, task.lights);
  const all = [...task.lights.map((l) => ({ ...l, decoy: false })), { name: "", kind: task.decoy.kind, period: task.decoy.period, decoy: true }];
  const spots = seededShuffle(seed + "|spots", [...LIGHT_SPOTS]).slice(0, all.length);
  const lights = seededShuffle(seed + "|order", all).map((l, i) => ({ id: opaqueId(secret, scopeKey, "light", index, l.name || "decoy"), x: spots[i]![0], y: spots[i]![1], kind: l.kind, period: l.period, phase: Math.round(rng() * 1000) / 1000, name: l.name, decoy: l.decoy }));
  return { target, lights };
}

/** Диск кормчего: внутреннее кольцо — перестановка азбуки команды; каждый промежуток между словами — поворот на одно деление по солнцу. */
function discFor(task: TaskOf<"disc">, secret: string, scopeKey: string, index: number) {
  const seed = seedOf(secret, scopeKey, index, "disc");
  const inner = seededShuffle(seed, ALPHABET.split("")).join("");
  let offset = 0;
  const cipher: Array<string | null> = [];
  for (const ch of task.text) {
    if (ch === " ") { offset = (offset + 1) % 32; cipher.push(null); continue; }
    const p = ALPHABET.indexOf(ch);
    cipher.push(inner[(p - offset + 32) % 32]!);
  }
  return { inner, cipher };
}

/** Две гарнитуры: буквы отрывка по порядку; с семенного места каждые пять букв кодируют букву слова (бит 1 — другое начертание). */
async function fontsFor(task: TaskOf<"fonts">, secret: string, scopeKey: string, index: number) {
  const book = await loadBook(task.book);
  const lines: Array<{ n: number; text: string }> = [];
  for (let v = task.from; v <= task.to; v++) { const t = book ? verseOf(book, task.chapter, v) : null; if (t) lines.push({ n: v, text: t }); }
  const letters: Array<[number, number]> = []; // [строка, позиция]
  lines.forEach((l, li) => { for (let i = 0; i < l.text.length; i++) if (/[А-Яа-яЁё]/.test(l.text[i]!)) letters.push([li, i]); });
  const need = task.word.length * 5;
  const rng = rngFrom(seedOf(secret, scopeKey, index, "fonts"));
  const start = Math.floor(rng() * Math.max(1, letters.length - need - 10)) + 5;
  const marked = new Set<string>();
  [...task.word].forEach((ch, j) => { const code = ALPHABET.indexOf(ch); for (let t = 0; t < 5; t++) if ((code >> (4 - t)) & 1) { const l = letters[start + j * 5 + t]; if (l) marked.add(`${l[0]},${l[1]}`); } });
  const page = lines.map((l, li) => ({ n: l.n, glyphs: [...l.text].map((ch, i) => [ch, marked.has(`${li},${i}`) ? 1 : 0] as [string, 0 | 1]) }));
  return { page };
}

function diffFor(task: TaskOf<"diff">, secret: string, scopeKey: string, index: number) {
  const seed = seedOf(secret, scopeKey, index, "diff");
  const chosen = seededShuffle(seed, task.changes).slice(0, task.pick);
  const ids = new Set(chosen.map((c) => c.id));
  const before = task.changes.filter((c) => c.before).map((c) => ({ x: c.x, y: c.y, w: c.w, sprite: c.before! }));
  const after = task.changes.map((c) => ({ x: c.x, y: c.y, w: c.w, sprite: ids.has(c.id) ? c.after : c.before })).filter((c) => c.sprite).map((c) => ({ ...c, sprite: c.sprite! }));
  return { chosen, before, after };
}

const tornCenters = (task: TaskOf<"torn">) => Array.from({ length: task.cols * task.rows }, (_, k) => ({ k, x: ((k % task.cols) + 0.5) * (100 / task.cols), y: (Math.floor(k / task.cols) + 0.5) * (75 / task.rows) }));
function tornFor(task: TaskOf<"torn">, secret: string, scopeKey: string, index: number) {
  const seed = seedOf(secret, scopeKey, index, "torn");
  const rng = rngFrom(seed);
  const pieces = seededShuffle(seed + "|order", tornCenters(task)).map((c) => ({ id: opaqueId(secret, scopeKey, "torn", index, c.k), k: c.k, rot: pickOne(rng, [0, 90, 180, 270, 30, 60, 300, 330]), sx: 10 + rng() * 80, sy: 10 + rng() * 55 }));
  return { seed: Math.floor(rngFrom(seed + "|cut")() * 1e9), pieces };
}

export const CELL_LETTERS = "АБВГДЕЖЗИК";
function cellOf(task: TaskOf<"bearings">, x: number, y: number): string {
  const c = Math.min(task.grid.cols - 1, Math.floor(x / (100 / task.grid.cols)));
  const r = Math.min(task.grid.rows - 1, Math.floor(y / (75 / task.grid.rows)));
  return `${CELL_LETTERS[c]}${r + 1}`;
}
/** Пеленг от ориентира на цель: от норда по часовой, карта — экран (y вниз). */
const bearingDeg = (from: { x: number; y: number }, to: { x: number; y: number }) => Math.round(((Math.atan2(to.x - from.x, -(to.y - from.y)) * 180) / Math.PI + 360) % 360);
function bearingsFor(task: TaskOf<"bearings">, chart: SeaChart, secret: string, scopeKey: string, index: number) {
  const rng = rngFrom(seedOf(secret, scopeKey, index, "bearings"));
  const [tx, ty] = pickOne(rng, task.targets);
  const places = task.landmarks.map((id) => chart.places.find((p) => p.id === id)).filter((p): p is SeaChart["places"][number] => !!p);
  return { target: { x: tx, y: ty }, cell: cellOf(task, tx, ty), bearings: places.map((p) => ({ name: p.name, bearing: bearingDeg(p, { x: tx, y: ty }) })) };
}

function reckoningFor(task: TaskOf<"reckoning">, chart: SeaChart, secret: string, scopeKey: string, index: number) {
  const rng = rngFrom(seedOf(secret, scopeKey, index, "reckoning"));
  const startId = pickOne(rng, task.starts);
  const start = chart.places.find((p) => p.id === startId) ?? { x: 50, y: 37, name: startId };
  const legs = task.legs.slice();
  if (task.drifts.length) legs.splice(Math.min(2, legs.length), 0, pickOne(rng, task.drifts));
  let x = start.x, y = start.y;
  for (const l of legs) { const a = (l.course * Math.PI) / 180; x += Math.sin(a) * l.miles * task.mile; y -= Math.cos(a) * l.miles * task.mile; }
  return { start: { id: startId, name: start.name, x: start.x, y: start.y }, legs, end: { x, y } };
}

function unloadFor(task: TaskOf<"unload">, secret: string, scopeKey: string, index: number) {
  const rng = rngFrom(seedOf(secret, scopeKey, index, "unload"));
  return pickOne(rng, task.levels);
}
/** Разгрузка: прогон ходов теми же правилами, что в scripts/gen-unload.py; true — все тюки на местах в правильном порядке видов. */
export function simulateUnload(level: { map: string[]; order: string[] }, kinds: Record<string, unknown>, moves: string): boolean {
  const walls = new Set<string>(); const boxes = new Map<string, string>(); const targets = new Map<string, string>(); let start: [number, number] | null = null;
  const key = (x: number, y: number) => `${x},${y}`;
  level.map.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === "#") walls.add(key(x, y));
    else if (ch === "@") start = [x, y];
    else if (ch in kinds) boxes.set(key(x, y), ch);
    else if (ch.toLowerCase() in kinds && ch !== ch.toLowerCase()) targets.set(key(x, y), ch.toLowerCase());
  }));
  if (!start) return false;
  const dirs: Record<string, [number, number]> = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };
  const kindList = Object.keys(kinds);
  const doneKinds = () => kindList.filter((k) => [...targets].filter(([, kk]) => kk === k).every(([p]) => boxes.get(p) === k));
  let stage = 0;
  let [px, py] = start as [number, number];
  for (const m of moves) {
    const d = dirs[m]; if (!d) return false;
    const nx = px + d[0], ny = py + d[1];
    if (walls.has(key(nx, ny))) continue;
    if (boxes.has(key(nx, ny))) {
      const tx = nx + d[0], ty = ny + d[1];
      if (walls.has(key(tx, ty)) || boxes.has(key(tx, ty))) continue;
      boxes.set(key(tx, ty), boxes.get(key(nx, ny))!); boxes.delete(key(nx, ny));
    }
    px = nx; py = ny;
    const done = doneKinds();
    if (stage < level.order.length && done.includes(level.order[stage]!)) stage++;
    if (level.order.slice(stage).some((k) => done.includes(k))) return false;
  }
  return stage === level.order.length && [...targets].every(([p, k]) => boxes.get(p) === k);
}

type PanelState = { pennant: "red" | "white" | "blue" | "yellow"; flashes: number; symbol: "anchor" | "fish" | "star" | "wave"; needle: "N" | "E" | "S" | "W" };
function ruleFor(task: TaskOf<"panel">, s: PanelState) {
  return task.rules.findIndex((r) => Object.entries(r.when).every(([k, v]) => s[k as keyof PanelState] === v));
}
/** Приборы раунда: случайные показания, но так, чтобы в раундах сработали разные правила. */
function panelFor(task: TaskOf<"panel">, secret: string, scopeKey: string, index: number) {
  const rng = rngFrom(seedOf(secret, scopeKey, index, "panel"));
  const rounds: Array<{ state: PanelState; rule: number }> = [];
  const used = new Set<number>();
  for (let r = 0; r < task.rounds; r++) {
    let pick: { state: PanelState; rule: number } | null = null;
    for (let attempt = 0; attempt < 60 && !pick; attempt++) {
      const state: PanelState = { pennant: pickOne(rng, ["red", "white", "blue", "yellow"] as const), flashes: 1 + Math.floor(rng() * 4), symbol: pickOne(rng, ["anchor", "fish", "star", "wave"] as const), needle: pickOne(rng, ["N", "E", "S", "W"] as const) };
      const rule = ruleFor(task, state);
      if (rule >= 0 && (!used.has(rule) || attempt > 40)) pick = { state, rule };
    }
    const fallback: PanelState = { pennant: "blue", flashes: 1, symbol: "anchor", needle: "N" };
    pick ??= { state: fallback, rule: ruleFor(task, fallback) };
    used.add(pick.rule); rounds.push(pick);
  }
  return rounds;
}
const panelRound = (progress: string[]) => Number(progress.find((p) => p.startsWith("r:"))?.slice(2) ?? 0);

function rosterFor(task: TaskOf<"roster">, secret: string, scopeKey: string, index: number) {
  const seed = seedOf(secret, scopeKey, index, "roster");
  const cards = seededShuffle(seed, task.cards).slice(0, task.show).map((c) => ({ ...c, pid: opaqueId(secret, scopeKey, "card", index, c.id) }));
  return { cards, whos: seededShuffle(seed + "|whos", task.whos), thens: seededShuffle(seed + "|thens", task.thens) };
}
const rosterConfirmed = (progress: string[]) => progress.filter((p) => p.startsWith("c:")).map((p) => p.slice(2));

/** Вахта глазами участника: без ответов, с данными своей команды; командные — только свои экраны. */
export async function publicSeaTask(task: SeaTask, index: number, secret: string, scopeKey: string, chart: SeaChart, ctx: TaskCtx) {
  const common = { index, type: task.type, title: task.title, prompt: task.prompt, team: isTeamTask(task) };
  switch (task.type) {
    case "lights": {
      const l = lightsFor(task, secret, scopeKey, index);
      return { ...common, book: bookNameRu(task.book), chapter: task.chapter, word: task.word, target: l.target.name, list: seededShuffle(seedOf(secret, scopeKey, index, "list"), task.lights.map((x) => ({ name: x.name, kind: x.kind, period: x.period }))), lights: l.lights.map(({ name: _n, decoy: _d, ...x }) => x) };
    }
    case "disc": { const d = discFor(task, secret, scopeKey, index); return { ...common, outer: ALPHABET, inner: d.inner, cipher: d.cipher }; }
    case "fonts": { const f = await fontsFor(task, secret, scopeKey, index); return { ...common, ref: `${bookNameRu(task.book)} ${task.chapter}:${task.from}–${task.to}`, page: f.page, length: task.word.length }; }
    case "diff": { const d = diffFor(task, secret, scopeKey, index); return { ...common, scene: task.scene, count: d.chosen.length, before: d.before, after: d.after }; }
    case "torn": { const t = tornFor(task, secret, scopeKey, index); return { ...common, cols: task.cols, rows: task.rows, seed: t.seed, pieces: t.pieces.map(({ k, ...p }) => ({ ...p, col: k % task.cols, row: Math.floor(k / task.cols) })), question: task.question }; }
    case "bearings": {
      const screens = assignScreens(task, ctx.members, seedOf(secret, scopeKey, index, "team"));
      const mine = screens.get(ctx.userId) ?? [];
      const b = bearingsFor(task, chart, secret, scopeKey, index);
      const crew = [...screens].map(([userId, s]) => ({ nickname: ctx.members.find((m) => m.userId === userId)?.nickname ?? "", screens: s }));
      return { ...common, screens: mine, crew, grid: task.grid, landmarks: mine.includes("map") ? task.landmarks : [], bearings: mine.includes("table") ? b.bearings : [], hint: mine.includes("table") ? task.hint ?? "" : "", letters: CELL_LETTERS.slice(0, task.grid.cols) };
    }
    case "reckoning": { const r = reckoningFor(task, chart, secret, scopeKey, index); return { ...common, start: r.start, legs: r.legs, mile: task.mile, question: task.question, radius: task.radius }; }
    case "unload": { const l = unloadFor(task, secret, scopeKey, index); return { ...common, kinds: task.kinds, map: l.map, order: l.order }; }
    case "panel": {
      const screens = assignScreens(task, ctx.members, seedOf(secret, scopeKey, index, "team"));
      const mine = screens.get(ctx.userId) ?? [];
      const rounds = panelFor(task, secret, scopeKey, index);
      const round = Math.min(panelRound(ctx.progress), task.rounds - 1);
      const crew = [...screens].map(([userId, s]) => ({ nickname: ctx.members.find((m) => m.userId === userId)?.nickname ?? "", screens: s }));
      return { ...common, screens: mine, crew, rounds: task.rounds, round, state: mine.includes("panel") ? rounds[round]!.state : null, manual: mine.includes("manual") ? { intro: task.manual, rules: task.rules.map((r) => r.text) } : null };
    }
    case "roster": {
      const r = rosterFor(task, secret, scopeKey, index);
      const confirmed = new Set(rosterConfirmed(ctx.progress));
      return { ...common, cards: r.cards.map((c) => ({ id: c.pid, clue: c.clue, figure: c.figure, confirmed: confirmed.has(c.pid) ? { who: c.who, then: c.then } : null })), whos: r.whos, thens: r.thens };
    }
  }
}

export interface CheckResult { /** Ответ принят (без паузы). */ ok: boolean; /** Вахта решена целиком. */ done: boolean; /** Новое состояние прогресса вахты (раунды, подтверждённые карточки). */ progress?: string[]; /** Что показать команде (подтверждённые карточки, следующий раунд). */ info?: Record<string, unknown> }
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
const near = (a: { x: number; y: number }, b: { x: number; y: number }, r: number) => Math.hypot(a.x - b.x, a.y - b.y) <= r;
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Проверка ответа вахты (ответы никогда не уходят на клиент). */
export async function checkSeaAnswer(task: SeaTask, index: number, secret: string, scopeKey: string, chart: SeaChart, answer: unknown, progress: string[] = []): Promise<CheckResult> {
  const no = { ok: false, done: false };
  const yes = { ok: true, done: true };
  switch (task.type) {
    case "lights": {
      const a = obj(answer); if (!a || typeof a.word !== "string") return no;
      const l = lightsFor(task, secret, scopeKey, index);
      const chosen = l.lights.find((x) => x.id === a.light);
      if (!chosen || chosen.name !== l.target.name) return no;
      const book = await loadBook(task.book);
      const want = pickWord(verseWords((book ? verseOf(book, task.chapter, l.target.period) : null) ?? ""), task.word);
      return want != null && normalizeAnswer(a.word) === normalizeAnswer(want) ? yes : no;
    }
    case "disc":
      return typeof answer === "string" && task.answers.some((x) => normalizeAnswer(x) === normalizeAnswer(answer)) ? yes : no;
    case "fonts":
      return typeof answer === "string" && normalizeAnswer(answer) === normalizeAnswer(task.word) ? yes : no;
    case "diff": {
      const a = obj(answer); const taps = Array.isArray(a?.taps) ? (a!.taps as unknown[]) : null; if (!taps || taps.length > 40) return no;
      const d = diffFor(task, secret, scopeKey, index);
      const pts = taps.map(obj).filter((p): p is Record<string, unknown> => !!p).map((p) => ({ x: num(p.x), y: num(p.y) }));
      return d.chosen.every((c) => pts.some((p) => near(p, c, Math.max(6, c.w / 2 + 3)))) ? yes : no;
    }
    case "torn": {
      const a = obj(answer); const pieces = obj(a?.pieces); const tap = obj(a?.tap); if (!pieces || !tap) return no;
      const t = tornFor(task, secret, scopeKey, index);
      const centers = tornCenters(task);
      for (const p of t.pieces) {
        const got = obj(pieces[p.id]); if (!got) return no;
        const c = centers[p.k]!;
        const rot = ((num(got.rot) % 360) + 360) % 360;
        if (!(Math.abs(num(got.x) - c.x) <= 4 && Math.abs(num(got.y) - c.y) <= 4 && (rot <= 12 || rot >= 348))) return no;
      }
      const place = chart.places.find((x) => x.id === task.place);
      return place && near({ x: num(tap.x), y: num(tap.y) }, place, task.radius) ? yes : no;
    }
    case "bearings": {
      const a = obj(answer); if (!a || typeof a.cell !== "string") return no;
      return normalizeAnswer(a.cell) === normalizeAnswer(bearingsFor(task, chart, secret, scopeKey, index).cell) ? yes : no;
    }
    case "reckoning": {
      const a = obj(answer); if (!a) return no;
      return near({ x: num(a.x), y: num(a.y) }, reckoningFor(task, chart, secret, scopeKey, index).end, task.radius) ? yes : no;
    }
    case "unload": {
      const a = obj(answer); if (!a || typeof a.moves !== "string" || a.moves.length > 4000) return no;
      return simulateUnload(unloadFor(task, secret, scopeKey, index), task.kinds, a.moves) ? yes : no;
    }
    case "panel": {
      const a = obj(answer); if (!a || typeof a.word !== "string") return no;
      const round = Math.min(panelRound(progress), task.rounds - 1);
      const rounds = panelFor(task, secret, scopeKey, index);
      const rule = task.rules[rounds[round]!.rule]!;
      if (normalizeAnswer(a.word) !== normalizeAnswer(rule.word)) return no;
      if (round + 1 >= task.rounds) return yes;
      return { ok: true, done: false, progress: [`r:${round + 1}`], info: { round: round + 1 } };
    }
    case "roster": {
      const a = obj(answer); const assign = obj(a?.assign); if (!assign) return no;
      const r = rosterFor(task, secret, scopeKey, index);
      const confirmed = new Set(rosterConfirmed(progress));
      const newly: string[] = [];
      let allRight = true;
      for (const c of r.cards) {
        if (confirmed.has(c.pid)) continue;
        const got = obj(assign[c.pid]);
        const right = !!got && got.who === c.who && got.then === c.then;
        if (right) newly.push(c.pid); else allRight = false;
      }
      if (allRight) return yes;
      if (newly.length >= 3) return { ok: true, done: false, progress: [...confirmed, ...newly].map((id) => `c:${id}`), info: { confirmed: newly } };
      return no;
    }
  }
}

/** Контент без ответов — администратору игры (ответы видит только администратор платформы). */
export function stripSeaAnswers(content: SeaContent) {
  return { ...content, tasks: content.tasks.map((t) => {
    const b = { type: t.type, title: t.title, prompt: t.prompt };
    switch (t.type) {
      case "lights": return { ...b, book: t.book, chapter: t.chapter, lights: t.lights.map((l) => l.name) };
      case "fonts": return { ...b, book: t.book, chapter: t.chapter, from: t.from, to: t.to };
      case "diff": return { ...b, scene: t.scene, pick: t.pick };
      case "torn": return { ...b, question: t.question };
      case "bearings": return { ...b, landmarks: t.landmarks };
      case "reckoning": return { ...b, legs: t.legs.map((l) => l.label) };
      case "unload": return { ...b, kinds: Object.values(t.kinds).map((k) => k.name) };
      case "panel": return { ...b, rounds: t.rounds, rules: t.rules.map((r) => r.text) };
      case "roster": return { ...b, whos: t.whos };
      default: return b;
    }
  }) };
}

// ───────────────────────────── География морей ─────────────────────────────
export interface SeaGeo { code: string; name: string; nameEn: string; hexes: Array<{ q: number; r: number }>; /** Берег: ключи узлов. */ shore: string[]; /** Центр моря в единицах карты (размер гекса 1). */ center: { x: number; y: number } }

/**
 * Карты, созданные до морей (например, «Осень»): их одиночные озёрные гексы получают имена морей по острову — на Ветхом
 * Завете Чермное, Солёное, воды Меромские, на Новом Галилейское и Адриатическое (по порядку обхода гексов); лишние
 * озёра остаются безымянными. Берег (узлы вокруг гекса) помечается тут же. Делается один раз, при первом обращении.
 */
export async function ensureSeaCodes(gameId: string): Promise<void> {
  const free = await prisma.mapHex.findMany({ where: { gameId, terrain: "water", sea: null }, select: { q: true, r: true, island: true }, orderBy: [{ r: "asc" }, { q: "asc" }] });
  if (!free.length) return;
  const taken = new Set((await prisma.mapHex.findMany({ where: { gameId, sea: { not: null } }, select: { sea: true } })).map((h) => h.sea!));
  for (const island of ["OT", "NT"] as const) {
    const names = INLAND_SEAS.filter((s) => s.island === island && !taken.has(s.code)).map((s) => s.code);
    for (const h of free.filter((x) => x.island === island)) {
      const code = names.shift();
      if (!code) break;
      await prisma.mapHex.update({ where: { gameId_q_r: { gameId, q: h.q, r: h.r } }, data: { sea: code } });
      await prisma.mapNode.updateMany({ where: { gameId, key: { in: hexCorners(h).map(vertexKey) }, sea: null }, data: { sea: code } });
    }
  }
}

/** Моря игры по карте: гексы воды с кодом моря, их берег и центр. */
export async function gameSeas(gameId: string): Promise<SeaGeo[]> {
  await ensureSeaCodes(gameId);
  const [hexes, nodes] = await Promise.all([
    prisma.mapHex.findMany({ where: { gameId, sea: { not: null } }, select: { q: true, r: true, sea: true } }),
    prisma.mapNode.findMany({ where: { gameId, sea: { not: null } }, select: { key: true, sea: true } }),
  ]);
  const out: SeaGeo[] = [];
  for (const spec of INLAND_SEAS) {
    const mine = hexes.filter((h) => h.sea === spec.code);
    if (!mine.length) continue;
    const pts = mine.map((h) => hexToPixel(h, 1));
    out.push({ code: spec.code, name: spec.name, nameEn: spec.nameEn, hexes: mine.map((h) => ({ q: h.q, r: h.r })), shore: nodes.filter((n) => n.sea === spec.code).map((n) => n.key), center: { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length } });
  }
  return out;
}

/**
 * Противоположный берег: узлы берега, направление на которые от центра моря отличается от направления на узел
 * отплытия не меньше чем на 90°.
 */
export function oppositeShore(sea: SeaGeo, fromKey: string): string[] {
  const ang = (k: string) => { const p = vertexToPixel(parseVertexKey(k), 1); return Math.atan2(p.y - sea.center.y, p.x - sea.center.x); };
  const a0 = ang(fromKey);
  return sea.shore.filter((k) => { let d = Math.abs(ang(k) - a0); if (d > Math.PI) d = 2 * Math.PI - d; return d >= Math.PI / 2; });
}
