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

  // Удержание по когортам недели регистрации (решение владельца 23.10): доля когорты, открывавшая приложение через
  // 7, 30 и 90 дней после регистрации — в окне недели от этого дня (дни N…N+6 от регистрации каждого). Показывается,
  // когда окно закрылось у всей когорты; иначе null — линия обрывается.
  const cohortMap = new Map<string, string[]>();
  for (const u of users) { const w = weekStart(regDay.get(u.id)!); cohortMap.set(w, [...(cohortMap.get(w) ?? []), u.id]); }
  const offsets = new Map<string, Set<number>>(); // userId → дни от регистрации, когда был активен
  for (const r of rows) { const reg = regDay.get(r.userId); if (!reg) continue; const off = Math.round((r.day.getTime() - toDate(reg).getTime()) / DAY); if (!offsets.has(r.userId)) offsets.set(r.userId, new Set()); offsets.get(r.userId)!.add(off); }
  const todayMs = toDate(today).getTime();
  const returned = (ids: string[], n: number, week: string): number | null => {
    if (toDate(week).getTime() + (6 + n + 6) * DAY >= todayMs) return null; // окно ещё не закрылось у всей когорты
    const back = ids.filter((id) => { const o = offsets.get(id); return o ? [...o].some((d) => d >= n && d <= n + 6) : false; }).length;
    return Math.round((back / ids.length) * 1000) / 10;
  };
  const cohorts = [...cohortMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, ids]) => ({ week, size: ids.length, d7: returned(ids, 7, week), d30: returned(ids, 30, week), d90: returned(ids, 90, week) }));
  // Кривая удержания «в среднем» (уточнение владельца 23.10: «понимать возвращаемость в среднем»): для каждого n = 1…90
  // берутся все, кто зарегистрировался не меньше n дней назад, и считается доля открывавших приложение спустя n дней
  // или позже. Одна убывающая линия: «через 7 дней возвращаются X %, через 30 — Y %».
  const retention: Array<{ day: number; pct: number | null; base: number }> = [];
  for (let n = 1; n <= 90; n++) {
    const base = users.filter((u) => toDate(regDay.get(u.id)!).getTime() + n * DAY <= todayMs);
    const back = base.filter((u) => { const o = offsets.get(u.id); return o ? [...o].some((d) => d >= n) : false; }).length;
    // Меньше пяти человек в расчёте — точки нет: по двум-трём людям кривая прыгает и вводит в заблуждение.
    retention.push({ day: n, base: base.length, pct: base.length >= 5 ? Math.round((back / base.length) * 1000) / 10 : null });
  }

  return { tz: REPORT_TZ, today, dau: series(byDay), wau: series(byWeek), mau: series(byMonth), newUsers, cohorts, retention, users: split(users.map((u) => u.id)) };
}

