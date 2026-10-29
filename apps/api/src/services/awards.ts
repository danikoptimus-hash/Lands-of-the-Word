import { prisma } from "../db.js";
import { AWARDS, STREAK_MILESTONES, hexCorners, vertexKey, nextStreakMilestone } from "@lotw/domain";
import { rulesOf } from "./rules.js";
import { publish } from "./events.js";

/**
 * Награды и серия дней (решение владельца 29.10). Всё считается по истории игры, а не копится по событиям: дела,
 * открытые перекрёстки, города, высадки, проходы, мощение, испытания и стихи уже лежат в базе, поэтому при выкладке
 * участники и команды сразу видят заработанное за всю игру с настоящими датами (владелец: «не заново начали считаться,
 * а уже по факту показали награды и серии… посчитав это всё по базе данных»). Пересчёт идемпотентен: строки только
 * добавляются (уникальный ключ), однажды полученная награда не отбирается.
 *
 * Игровые сутки — от 07:00 до 07:00 по поясу игры (как лимит дел). Серия личная и строгая: один пропуск рвёт
 * (владелец: «я хочу строго, 1 пропуск рвёт серию; у команды серию убрать»). День засчитан, если участник в этот день
 * сдал дело, которое потом одобрено (пока на проверке — считается, возвращённое и не пересданное — нет), решил
 * расстановку районов или задание района, ввёл ключ от конверта (владелец: «участие в решении районов, заданий,
 * взятии шифров нужно учитывать»).
 */

const DAY = 86_400_000;
const H7 = 7 * 3_600_000;

/** Ключ игровых суток «YYYY-MM-DD» по поясу игры: момент минус семь часов, затем календарная дата. */
export function gameDayKey(d: Date | number, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(+d - H7));
  const n = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${n("year")}-${n("month")}-${n("day")}`;
}
/** Час по поясу игры (0–23). */
function localHour(d: Date, tz: string): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(d);
  return Number(h) % 24;
}
const dayIndex = (key: string) => Math.round(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10))) / DAY);
const keyOfIndex = (i: number) => new Date(i * DAY).toISOString().slice(0, 10);
/** Понедельник недели (ключ дня). */
const weekOf = (key: string) => { const i = dayIndex(key); const dow = (new Date(i * DAY).getUTCDay() + 6) % 7; return keyOfIndex(i - dow); };

export interface StreakInfo {
  /** Текущая серия (дней подряд, включая сегодня, если день уже засчитан). */
  current: number;
  /** Лучшая серия за игру. */
  best: number;
  /** Сегодняшний день уже засчитан. */
  today: boolean;
  /** Ближайший рубеж и сколько до него дней (null — рубежи пройдены). */
  next: number | null;
  toNext: number | null;
  /** Ключ сегодняшних игровых суток. */
  todayKey: string;
}

/** Серия по множеству засчитанных дней. Если сегодня ещё нет дела, серия со вчерашнего дня жива до конца суток. */
export function streakOf(days: ReadonlySet<string>, todayKey: string): StreakInfo {
  const today = days.has(todayKey);
  const t = dayIndex(todayKey);
  let current = 0;
  let i = today ? t : t - 1;
  while (days.has(keyOfIndex(i))) { current++; i--; }
  if (!today && current === 0) current = 0;
  const sorted = [...days].map(dayIndex).sort((a, b) => a - b);
  let best = 0, run = 0, prev = Number.NaN;
  for (const d of sorted) { run = d === prev + 1 ? run + 1 : 1; prev = d; if (run > best) best = run; }
  const next = nextStreakMilestone(current);
  return { current, best, today, next, toNext: next === null ? null : next - current, todayKey };
}

/** Серии (подряд идущие дни) из множества дней: [первый индекс, длина]. */
function runsOf(days: ReadonlySet<string>): Array<{ start: number; len: number }> {
  const sorted = [...days].map(dayIndex).sort((a, b) => a - b);
  const out: Array<{ start: number; len: number }> = [];
  for (const d of sorted) { const last = out[out.length - 1]; if (last && d === last.start + last.len) last.len++; else out.push({ start: d, len: 1 }); }
  return out;
}

interface TaskRow { id: string; teamId: string; status: string; takenById: string | null; participants: string[]; takenAt: Date | null; submittedAt: Date | null; decidedAt: Date | null; sea: boolean; paved: boolean; toKey: string }
interface WorkRow { teamId: string; byId: string; participants: string[]; status: string; submittedAt: Date; decidedAt: Date | null }
interface JournalRow { teamId: string | null; userId: string | null; kind: string; vars: unknown; createdAt: Date }

/** Кому засчитывается дело лично: взявший и отмеченные участники (как в «Моём служении»). */
const doers = (t: { takenById: string | null; participants: string[] }) => new Set([...(t.takenById ? [t.takenById] : []), ...t.participants]);
const ACTIVE_KINDS = new Set(["task_solved", "order_solved", "city_captured", "ruins_taken"]);

/** Засчитанные дни участников: userId → (день → первый момент активности в этот день). */
function activeDays(tasks: TaskRow[], works: WorkRow[], journal: JournalRow[], tz: string): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  const mark = (userId: string, at: Date) => {
    const key = gameDayKey(at, tz);
    let m = out.get(userId); if (!m) { m = new Map(); out.set(userId, m); }
    const prev = m.get(key); if (prev === undefined || at.getTime() < prev) m.set(key, at.getTime());
  };
  for (const t of tasks) if ((t.status === "APPROVED" || t.status === "SUBMITTED") && !t.paved && t.submittedAt) for (const u of doers(t)) mark(u, t.submittedAt);
  for (const w of works) if (w.status === "APPROVED" || w.status === "SUBMITTED") for (const u of new Set([w.byId, ...w.participants])) mark(u, w.submittedAt);
  for (const j of journal) if (j.userId && ACTIVE_KINDS.has(j.kind)) mark(j.userId, j.createdAt);
  return out;
}

interface Grant { teamId: string; userId: string; code: string; key: string; at: Date }

/** Все награды игры по её истории. Чистая функция от выгруженных данных (для тестов). */
export function computeAwards(data: {
  tz: string; now: Date;
  teams: Array<{ id: string; members: string[] }>;
  tasks: TaskRow[]; works: WorkRow[]; journal: JournalRow[];
  nodes: Array<{ key: string; kind: string; island: string }>;
  hexes: Array<{ q: number; r: number }>;
  nodeStates: Array<{ teamId: string; nodeKey: string; revealedAt: Date }>;
  cityStates: Array<{ teamId: string; nodeKey: string; capturedAt: Date | null; firstCapturedAt: Date | null }>;
  battles: Array<{ id: string; attackerId: string; defenderId: string; status: string; resolvedAt: Date | null }>;
  entries: Array<{ userId: string; teamId: string; startIdx: number; endIdx: number; carried: boolean; decidedAt: Date | null; createdAt: Date }>;
  passages: Array<{ id: string; requesterId: string; ownerId: string; status: string; decidedAt: Date | null }>;
  peeks: Array<{ teamId: string; createdAt: Date }>;
}): Grant[] {
  const { tz, now } = data;
  const out: Grant[] = [];
  const team = (teamId: string, code: string, at: Date, key = "once") => out.push({ teamId, userId: "", code, key, at });
  const person = (teamId: string, userId: string, code: string, at: Date, key = "once") => out.push({ teamId, userId, code, key, at });
  const todayKey = gameDayKey(now, tz);
  const nodeByKey = new Map(data.nodes.map((n) => [n.key, n]));
  const cityKeys = new Set(data.nodes.filter((n) => n.kind === "CITY").map((n) => n.key));
  const islandCities = new Map<string, Set<string>>();
  for (const n of data.nodes) if (n.kind === "CITY") { let s = islandCities.get(n.island); if (!s) { s = new Set(); islandCities.set(n.island, s); } s.add(n.key); }
  const returnedTasks = new Set<string>();
  for (const j of data.journal) if (j.kind === "deed_returned") { const id = (j.vars as { taskId?: unknown }).taskId; if (typeof id === "string") returnedTasks.add(id); }
  for (const t of data.tasks) if (t.status === "REJECTED") returnedTasks.add(t.id);
  const byTs = <T extends { at: Date }>(rows: T[]) => rows.sort((a, b) => a.at.getTime() - b.at.getTime());
  const days = activeDays(data.tasks, data.works, data.journal, tz);

  for (const tm of data.teams) {
    const tasks = data.tasks.filter((t) => t.teamId === tm.id);
    const approved = byTs(tasks.filter((t) => t.status === "APPROVED" && !t.paved).map((t) => ({ ...t, at: t.decidedAt ?? t.submittedAt ?? new Date(0) })));
    const travelled = byTs(tasks.filter((t) => t.status === "APPROVED").map((t) => ({ ...t, at: t.decidedAt ?? t.submittedAt ?? new Date(0) })));
    const journal = data.journal.filter((j) => j.teamId === tm.id);
    const held = data.cityStates.filter((c) => c.teamId === tm.id && c.capturedAt).map((c) => ({ ...c, at: c.capturedAt! }));
    // Командные
    if (approved[0]) team(tm.id, "t_first_deed", approved[0].at);
    if (approved[49]) team(tm.id, "t_fifty", approved[49].at);
    if (approved[99]) team(tm.id, "t_hundred", approved[99].at);
    if (travelled[49]) team(tm.id, "t_long_road", travelled[49].at);
    const firstCity = data.cityStates.filter((c) => c.teamId === tm.id && c.firstCapturedAt).map((c) => c.firstCapturedAt!).sort((a, b) => a.getTime() - b.getTime())[0];
    if (firstCity) team(tm.id, "t_first_city", firstCity);
    byTs(held);
    if (held[2]) team(tm.id, "t_three_towers", held[2].at);
    for (const [island, keys] of islandCities) {
      const mine = held.filter((c) => keys.has(c.nodeKey));
      if (keys.size > 0 && mine.length === keys.size) team(tm.id, "t_island_lords", mine[mine.length - 1]!.at, island);
    }
    const perIsland = [...islandCities.keys()].map((isl) => held.find((c) => nodeByKey.get(c.nodeKey)?.island === isl)?.at ?? null);
    if (perIsland.length >= 2 && perIsland.every(Boolean)) team(tm.id, "t_ot_nt", new Date(Math.max(...perIsland.map((d) => d!.getTime()))));
    const landed = byTs(journal.filter((j) => j.kind === "sea_landed").map((j) => ({ at: j.createdAt })))[0];
    if (landed) team(tm.id, "t_landing", landed.at);
    const paved = byTs(journal.filter((j) => j.kind === "paved").map((j) => ({ at: j.createdAt })))[0];
    if (paved) team(tm.id, "t_masons", paved.at);
    if (tm.members.length > 0) {
      const firsts = tm.members.map((u) => approved.find((t) => doers(t).has(u))?.at ?? null);
      if (firsts.every(Boolean)) team(tm.id, "t_full_crew", new Date(Math.max(...firsts.map((d) => d!.getTime()))));
    }
    // Книжники: задания районов в трёх городах (трёх книгах) за один день.
    const booksByDay = new Map<string, Map<string, Date>>();
    for (const j of journal) if (j.kind === "task_solved" || j.kind === "order_solved") {
      const book = String((j.vars as { book?: unknown }).book ?? ""); if (!book) continue;
      const day = gameDayKey(j.createdAt, tz);
      let m = booksByDay.get(day); if (!m) { m = new Map(); booksByDay.set(day, m); }
      if (!m.has(book)) m.set(book, j.createdAt);
    }
    for (const [day, books] of booksByDay) if (books.size >= 3) team(tm.id, "t_three_books_day", [...books.values()].sort((a, b) => a.getTime() - b.getTime())[2]!, day);
    for (const b of data.battles) {
      if (b.status === "WON" && b.attackerId === tm.id) team(tm.id, "t_trial_won", b.resolvedAt ?? now, b.id);
      if (b.status === "REPELLED" && b.defenderId === tm.id) team(tm.id, "t_city_shield", b.resolvedAt ?? now, b.id);
    }
    for (const p of data.passages) if (p.status === "APPROVED") {
      if (p.requesterId === tm.id) team(tm.id, "t_envoys", p.decidedAt ?? now, p.id);
      if (p.ownerId === tm.id) team(tm.id, "t_hosts", p.decidedAt ?? now, p.id);
    }
    const peeks = data.peeks.filter((p) => p.teamId === tm.id).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    if (peeks[4]) team(tm.id, "t_team_eyes", peeks[4].createdAt);
    // Без возвратов: 20 дел подряд (по времени сдачи), ни одно из которых не возвращалось.
    let run = 0;
    for (const t of byTs(tasks.filter((t) => t.status === "APPROVED" && !t.paved && t.submittedAt).map((t) => ({ ...t, at: t.submittedAt! })))) {
      run = returnedTasks.has(t.id) ? 0 : run + 1;
      if (run === 20) { team(tm.id, "t_no_returns", t.decidedAt ?? t.at); break; }
    }
    // Без единого облака: каждый гекс освещён (хотя бы один угол открыт).
    const revealed = new Map(data.nodeStates.filter((s) => s.teamId === tm.id).map((s) => [s.nodeKey, s.revealedAt]));
    if (data.hexes.length > 0) {
      let litAt = 0, all = true;
      for (const h of data.hexes) {
        const corners = hexCorners(h).map((c) => revealed.get(vertexKey(c))).filter((d): d is Date => Boolean(d));
        if (!corners.length) { all = false; break; }
        litAt = Math.max(litAt, Math.min(...corners.map((d) => d.getTime())));
      }
      if (all) team(tm.id, "t_open_all", new Date(litAt));
    }
    // Личные
    const weekly = new Map<string, Map<string, { n: number; last: Date }>>();
    for (const u of tm.members) {
      const mine = byTs([
        ...tasks.filter((t) => t.status === "APPROVED" && !t.paved && doers(t).has(u)).map((t) => ({ at: t.decidedAt ?? t.submittedAt ?? new Date(0) })),
        ...data.works.filter((w) => w.teamId === tm.id && w.status === "APPROVED" && (w.byId === u || w.participants.includes(u))).map((w) => ({ at: w.decidedAt ?? w.submittedAt })),
      ]);
      if (mine[0]) person(tm.id, u, "p_first_deed", mine[0].at);
      if (mine[9]) person(tm.id, u, "p_ten", mine[9].at);
      if (mine[29]) person(tm.id, u, "p_thirty", mine[29].at);
      if (mine[99]) person(tm.id, u, "p_hundred", mine[99].at);
      const own = byTs(tasks.filter((t) => t.status === "APPROVED" && !t.paved && t.takenById === u && t.submittedAt).map((t) => ({ ...t, at: t.submittedAt! })));
      // Ранняя птица: одно дело, взятое и сданное в те же игровые сутки между 7 и 9 утра (владелец 29.10: «если взял вчера,
      // а сдал утром — не то»; 30.10: «сделать одно дело взятое утром сданное также утром. Было 5, нужно сделать 1»).
      const early = own.filter((t) => t.takenAt && gameDayKey(t.takenAt, tz) === gameDayKey(t.at, tz) && localHour(t.takenAt, tz) >= 7 && localHour(t.at, tz) >= 7 && localHour(t.at, tz) < 9);
      if (early[0]) person(tm.id, u, "p_early_bird", early[0].decidedAt ?? early[0].at);
      let ok = 0;
      for (const t of own) { ok = returnedTasks.has(t.id) ? 0 : ok + 1; if (ok === 10) { person(tm.id, u, "p_first_try", t.decidedAt ?? t.at); break; } }
      // Следопыт и ключник: перекрёстки, открытые своими делами (узел открылся в минуту одобрения), дорога в город.
      const opened = own.filter((t) => { const r = revealed.get(t.toKey); const d = t.decidedAt; return r && d && Math.abs(r.getTime() - d.getTime()) < 120_000; });
      if (opened[9]) person(tm.id, u, "p_pathfinder", opened[9].decidedAt!);
      for (const t of own) if (cityKeys.has(t.toKey)) person(tm.id, u, "p_keyholder", t.decidedAt ?? t.at, t.toKey);
      for (const t of tasks) if (t.status === "APPROVED" && t.sea && doers(t).has(u)) person(tm.id, u, "p_sea_wolf", t.decidedAt ?? t.submittedAt ?? now, t.id);
      // Стихи: зачтённые записи испытаний без перенесённых из прошлых.
      let verses = 0;
      for (const e of byTs(data.entries.filter((e) => e.userId === u && e.teamId === tm.id && !e.carried).map((e) => ({ ...e, at: e.decidedAt ?? e.createdAt })))) {
        const before = verses; verses += e.endIdx - e.startIdx + 1;
        for (const [n, code] of [[10, "p_verses_10"], [30, "p_verses_30"], [60, "p_verses_60"], [100, "p_verses_100"]] as const) if (before < n && verses >= n) person(tm.id, u, code, e.at);
      }
      // Недельный счёт для «Опоры команды».
      for (const t of own) { const wk = weekOf(gameDayKey(t.at, tz)); let m = weekly.get(wk); if (!m) { m = new Map(); weekly.set(wk, m); } const c = m.get(u) ?? { n: 0, last: t.at }; c.n++; if (t.at > c.last) c.last = t.at; m.set(u, c); }
      // Серия: рубежи по каждой непрерывной серии; награда одна (первое достижение).
      const my = days.get(u);
      if (my) for (const r of runsOf(new Set(my.keys()))) for (const m of STREAK_MILESTONES) if (r.len >= m) person(tm.id, u, `p_streak_${m}`, new Date(my.get(keyOfIndex(r.start + m - 1)) ?? now));
    }
    // Опора команды: больше всех дел за завершившуюся неделю (при равенстве — все лидеры).
    for (const [wk, m] of weekly) {
      if (dayIndex(wk) + 7 > dayIndex(todayKey)) continue;
      const max = Math.max(...[...m.values()].map((c) => c.n));
      for (const [u, c] of m) if (c.n === max && max > 0) person(tm.id, u, "p_team_pillar", c.last, wk);
    }
  }
  return out;
}

/** Выгрузка истории игры и сохранение новых наград. Возвращает число добавленных строк. */
export async function recomputeAwards(gameId: string): Promise<number> {
  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { settings: true, status: true } });
  if (!game) return 0;
  const tz = rulesOf(game.settings).timeZone;
  const [teams, tasks, works, journal, nodes, hexes, nodeStates, cityStates, battles, entries, passages, peeks] = await Promise.all([
    prisma.team.findMany({ where: { gameId }, select: { id: true, members: { select: { userId: true } } } }),
    prisma.teamEdgeTask.findMany({ where: { gameId, status: { not: "OPEN" } }, select: { id: true, teamId: true, status: true, takenById: true, participants: true, takenAt: true, submittedAt: true, decidedAt: true, sea: true, paved: true, toKey: true } }),
    prisma.quarryWork.findMany({ where: { gameId }, select: { teamId: true, byId: true, participants: true, status: true, submittedAt: true, decidedAt: true } }),
    prisma.journal.findMany({ where: { gameId, kind: { in: ["task_solved", "order_solved", "city_captured", "ruins_taken", "deed_returned", "sea_landed", "paved"] } }, select: { teamId: true, userId: true, kind: true, vars: true, createdAt: true } }),
    prisma.mapNode.findMany({ where: { gameId }, select: { key: true, kind: true, island: true } }),
    prisma.mapHex.findMany({ where: { gameId }, select: { q: true, r: true } }),
    prisma.teamNodeState.findMany({ where: { team: { gameId } }, select: { teamId: true, nodeKey: true, revealedAt: true } }),
    prisma.teamCityState.findMany({ where: { gameId }, select: { teamId: true, nodeKey: true, capturedAt: true, firstCapturedAt: true } }),
    prisma.battle.findMany({ where: { gameId, status: { in: ["WON", "REPELLED"] } }, select: { id: true, attackerId: true, defenderId: true, status: true, resolvedAt: true } }),
    prisma.battleEntry.findMany({ where: { battle: { gameId }, status: "APPROVED" }, select: { userId: true, teamId: true, startIdx: true, endIdx: true, carried: true, decidedAt: true, createdAt: true } }),
    prisma.passageRequest.findMany({ where: { gameId, status: "APPROVED" }, select: { id: true, requesterId: true, ownerId: true, status: true, decidedAt: true } }),
    prisma.teamPeek.findMany({ where: { team: { gameId } }, select: { teamId: true, createdAt: true } }),
  ]);
  const grants = computeAwards({ tz, now: new Date(), teams: teams.map((t) => ({ id: t.id, members: t.members.map((m) => m.userId) })), tasks, works, journal, nodes, hexes, nodeStates, cityStates, battles, entries, passages, peeks });
  if (!grants.length) return 0;
  const res = await prisma.awardGrant.createMany({ data: grants.map((g) => ({ gameId, ...g })), skipDuplicates: true });
  if (res.count > 0) publish(gameId, { type: "awards" });
  return res.count;
}

const pending = new Map<string, NodeJS.Timeout>();
/** Пересчёт наград игры с задержкой: события идут пачками (одобрение нескольких дел подряд), считаем один раз. */
export function scheduleAwards(gameId: string, delayMs = 4_000): void {
  const prev = pending.get(gameId); if (prev) clearTimeout(prev);
  pending.set(gameId, setTimeout(() => { pending.delete(gameId); recomputeAwards(gameId).catch(() => { /* следующий пересчёт догонит */ }); }, delayMs));
}

/** Пересчёт всех идущих игр: при старте сервера и раз в час (страховка на случай пропущенного события). */
export async function recomputeActiveGames(): Promise<void> {
  const games = await prisma.game.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
  for (const g of games) await recomputeAwards(g.id).catch(() => undefined);
}

/** Серия участника по истории: засчитанные дни из дел, районов и ключей. */
export async function userStreak(gameId: string, userId: string): Promise<StreakInfo> {
  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { settings: true } });
  const tz = rulesOf(game?.settings).timeZone;
  const [tasks, works, journal] = await Promise.all([
    prisma.teamEdgeTask.findMany({ where: { gameId, paved: false, status: { in: ["APPROVED", "SUBMITTED"] }, OR: [{ takenById: userId }, { participants: { has: userId } }] }, select: { id: true, teamId: true, status: true, takenById: true, participants: true, takenAt: true, submittedAt: true, decidedAt: true, sea: true, paved: true, toKey: true } }),
    prisma.quarryWork.findMany({ where: { gameId, status: { in: ["APPROVED", "SUBMITTED"] }, OR: [{ byId: userId }, { participants: { has: userId } }] }, select: { teamId: true, byId: true, participants: true, status: true, submittedAt: true, decidedAt: true } }),
    prisma.journal.findMany({ where: { gameId, userId, kind: { in: [...ACTIVE_KINDS] } }, select: { teamId: true, userId: true, kind: true, vars: true, createdAt: true } }),
  ]);
  const days = activeDays(tasks, works, journal, tz).get(userId) ?? new Map<string, number>();
  return streakOf(new Set(days.keys()), gameDayKey(Date.now(), tz));
}

/** Серии всех участников игры одним проходом (для раздела наград администратора). */
export async function allStreaks(gameId: string): Promise<Map<string, StreakInfo>> {
  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { settings: true } });
  const tz = rulesOf(game?.settings).timeZone;
  const [tasks, works, journal] = await Promise.all([
    prisma.teamEdgeTask.findMany({ where: { gameId, paved: false, status: { in: ["APPROVED", "SUBMITTED"] } }, select: { id: true, teamId: true, status: true, takenById: true, participants: true, takenAt: true, submittedAt: true, decidedAt: true, sea: true, paved: true, toKey: true } }),
    prisma.quarryWork.findMany({ where: { gameId, status: { in: ["APPROVED", "SUBMITTED"] } }, select: { teamId: true, byId: true, participants: true, status: true, submittedAt: true, decidedAt: true } }),
    prisma.journal.findMany({ where: { gameId, kind: { in: [...ACTIVE_KINDS] } }, select: { teamId: true, userId: true, kind: true, vars: true, createdAt: true } }),
  ]);
  const today = gameDayKey(Date.now(), tz);
  const out = new Map<string, StreakInfo>();
  for (const [userId, days] of activeDays(tasks, works, journal, tz)) out.set(userId, streakOf(new Set(days.keys()), today));
  return out;
}

export interface GrantSummary { code: string; count: number; /** Первое получение. */ at: string; /** Последнее получение (для повторяемых). */ last: string }
/** Сводка наград по кодам: сколько раз и когда. */
export function summarize(rows: Array<{ code: string; at: Date }>): GrantSummary[] {
  const m = new Map<string, GrantSummary>();
  for (const r of rows.sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const s = m.get(r.code);
    if (s) { s.count++; s.last = r.at.toISOString(); } else m.set(r.code, { code: r.code, count: 1, at: r.at.toISOString(), last: r.at.toISOString() });
  }
  const order = new Map(AWARDS.map((a, i) => [a.code, i]));
  return [...m.values()].sort((a, b) => (order.get(a.code) ?? 0) - (order.get(b.code) ?? 0));
}
