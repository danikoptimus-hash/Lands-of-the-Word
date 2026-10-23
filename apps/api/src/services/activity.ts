import { prisma } from "../db.js";
import { TEST_USER_WHERE } from "./metrics.js";

/**
 * Активность по дням для аналитики (решение владельца 23.10): любое открытие приложения считается, одна строка на
 * пользователя в день. Пояс отчётности — Asia/Tashkent: сутки у всех графиков заканчиваются в местную полночь.
 * Из этой таблицы считаются DAU (по дням), WAU (календарные недели с понедельника), MAU (календарные месяцы)
 * и удержание по когортам недели регистрации. Разрезы: все, администраторы (администратор хоть одной игры или
 * администратор платформы), участники (остальные). Тестовые аккаунты исключены.
 */
export const REPORT_TZ = "Asia/Tashkent";
const DAY = 86_400_000;

/** «YYYY-MM-DD» по поясу отчётности. */
export function dayKey(d: Date, tz = REPORT_TZ): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const n = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${n("year")}-${n("month")}-${n("day")}`;
}
const toDate = (key: string) => new Date(key + "T00:00:00Z");
const addDays = (key: string, n: number) => toDate(key).getTime() + n * DAY;
const keyOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Понедельник недели, в которую входит день. */
export function weekStart(key: string): string {
  const d = toDate(key); const dow = (d.getUTCDay() + 6) % 7; return keyOf(d.getTime() - dow * DAY);
}
const monthKey = (key: string) => key.slice(0, 7);

const seen = new Set<string>();
let seenDay = "";
/** Отметить активность пользователя сегодня (вызывается из авторизации, не чаще раза в 10 минут; в базу — раз в день). */
export function touchUserDay(userId: string): void {
  const key = dayKey(new Date());
  if (key !== seenDay) { seen.clear(); seenDay = key; }
  const mark = `${userId}|${key}`;
  if (seen.has(mark)) return;
  seen.add(mark);
  prisma.userDay.createMany({ data: [{ userId, day: toDate(key) }], skipDuplicates: true }).catch(() => seen.delete(mark));
}

/**
 * Разово при первом запуске с таблицей: прошлое восстанавливается из действий — регистрация и последний визит,
 * входы в аккаунт, ответы на задания, взятия и сдачи дел, стихи в испытаниях, записи журнала, вступление в команды.
 * Кто только смотрел карту, в прошлые дни не попадёт: это недосчёт, о нём сказано владельцу.
 */
export async function backfillUserDays(log: { info: (o: object, msg: string) => void }): Promise<number> {
  if ((await prisma.userDay.count()) > 0) return 0;
  const pairs = new Set<string>();
  const add = (userId: string | null | undefined, at: Date | null | undefined) => { if (userId && at) pairs.add(`${userId}|${dayKey(at)}`); };
  const [users, sessions, events, tasks, entries, journal, members] = await Promise.all([
    prisma.user.findMany({ select: { id: true, createdAt: true, lastSeenAt: true } }),
    prisma.session.findMany({ select: { userId: true, createdAt: true } }),
    prisma.taskEvent.findMany({ select: { userId: true, createdAt: true } }),
    prisma.teamEdgeTask.findMany({ where: { takenById: { not: null } }, select: { takenById: true, takenAt: true, submittedAt: true } }),
    prisma.battleEntry.findMany({ select: { userId: true, createdAt: true } }),
    prisma.journal.findMany({ where: { userId: { not: null } }, select: { userId: true, createdAt: true } }),
    prisma.membership.findMany({ select: { userId: true, joinedAt: true } }),
  ]);
  for (const u of users) { add(u.id, u.createdAt); add(u.id, u.lastSeenAt); }
  for (const s of sessions) add(s.userId, s.createdAt);
  for (const e of events) add(e.userId, e.createdAt);
  for (const t of tasks) { add(t.takenById, t.takenAt); add(t.takenById, t.submittedAt); }
  for (const e of entries) add(e.userId, e.createdAt);
  for (const j of journal) add(j.userId, j.createdAt);
  for (const m of members) add(m.userId, m.joinedAt);
  const rows = [...pairs].map((p) => { const [userId, key] = p.split("|") as [string, string]; return { userId, day: toDate(key) }; });
  for (let i = 0; i < rows.length; i += 1000) await prisma.userDay.createMany({ data: rows.slice(i, i + 1000), skipDuplicates: true });
  log.info({ rows: rows.length }, "дни активности восстановлены из действий");
  return rows.length;
}

export interface Split { all: number; admins: number; players: number }

/** Данные для графиков аналитики: DAU по дням, WAU по неделям, MAU по месяцам, новые, всего, когорты. */
export async function analytics() {
  const today = dayKey(new Date());
  const testIds = new Set((await prisma.user.findMany({ where: TEST_USER_WHERE, select: { id: true } })).map((u) => u.id));
  const users = (await prisma.user.findMany({ select: { id: true, createdAt: true, platformRole: true } })).filter((u) => !testIds.has(u.id));
  const adminRows = await prisma.gameAdmin.findMany({ select: { userId: true } });
  const admins = new Set([...adminRows.map((a) => a.userId), ...users.filter((u) => u.platformRole === "SUPERADMIN").map((u) => u.id)]);
  const isAdmin = (id: string) => admins.has(id);
  const split = (ids: Iterable<string>): Split => { let all = 0, a = 0; for (const id of ids) { all++; if (isAdmin(id)) a++; } return { all, admins: a, players: all - a }; };

  const rows = (await prisma.userDay.findMany({ select: { userId: true, day: true } })).filter((r) => !testIds.has(r.userId));
  const firstUser = users.reduce((m, u) => Math.min(m, u.createdAt.getTime()), Date.now());
  const start = rows.reduce((m, r) => Math.min(m, r.day.getTime()), toDate(dayKey(new Date(firstUser))).getTime());
  const days: string[] = []; for (let t = start; t <= toDate(today).getTime(); t += DAY) days.push(keyOf(t));

  const byDay = new Map<string, Set<string>>(days.map((d) => [d, new Set()]));
  const byWeek = new Map<string, Set<string>>(); const byMonth = new Map<string, Set<string>>();
  for (const d of days) { if (!byWeek.has(weekStart(d))) byWeek.set(weekStart(d), new Set()); if (!byMonth.has(monthKey(d))) byMonth.set(monthKey(d), new Set()); }
  for (const r of rows) {
    const k = r.day.toISOString().slice(0, 10);
    byDay.get(k)?.add(r.userId); byWeek.get(weekStart(k))?.add(r.userId); byMonth.get(monthKey(k))?.add(r.userId);
  }
  const series = (m: Map<string, Set<string>>) => [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, set]) => ({ key, ...split(set) }));

  // Новые по дням и всего накопительно (по дате регистрации, в поясе отчётности).
  const regDay = new Map<string, string>(users.map((u) => [u.id, dayKey(u.createdAt)]));
  const newByDay = new Map<string, string[]>(days.map((d) => [d, []]));
  for (const u of users) newByDay.get(regDay.get(u.id)!)?.push(u.id);
  let total: Split = { all: 0, admins: 0, players: 0 };
  const newUsers = days.map((d) => { const s = split(newByDay.get(d) ?? []); total = { all: total.all + s.all, admins: total.admins + s.admins, players: total.players + s.players }; return { key: d, ...s, total: { ...total } }; });

  // Когорты по неделе регистрации: доля когорты, активная через n недель (n = 0 — неделя регистрации).
  const thisWeek = weekStart(today);
  const cohortMap = new Map<string, string[]>();
  for (const u of users) { const w = weekStart(regDay.get(u.id)!); cohortMap.set(w, [...(cohortMap.get(w) ?? []), u.id]); }
  const activeWeeks = new Map<string, Set<string>>(); // userId → недели активности
  for (const r of rows) { const w = weekStart(r.day.toISOString().slice(0, 10)); if (!activeWeeks.has(r.userId)) activeWeeks.set(r.userId, new Set()); activeWeeks.get(r.userId)!.add(w); }
  const cohorts = [...cohortMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, ids]) => {
    const maxN = Math.floor((toDate(thisWeek).getTime() - toDate(week).getTime()) / (7 * DAY));
    const weeks: Array<{ n: number; active: number; pct: number }> = [];
    for (let n = 0; n <= maxN; n++) { const wk = keyOf(addDays(week, 7 * n)); const active = ids.filter((id) => activeWeeks.get(id)?.has(wk)).length; weeks.push({ n, active, pct: ids.length ? Math.round((active / ids.length) * 1000) / 10 : 0 }); }
    return { week, size: ids.length, weeks };
  });

  return { tz: REPORT_TZ, today, dau: series(byDay), wau: series(byWeek), mau: series(byMonth), newUsers, cohorts, users: split(users.map((u) => u.id)) };
}

