import { prisma } from "../db.js";
import { publish } from "./events.js";
import { notifyTeam } from "./notify.js";
import { msg, toLocale, type Locale } from "./i18n.js";
import { rulesOf } from "./rules.js";
import { standings } from "./game.js";

/**
 * Журнал событий игры (решения владельца 18.09, глава 4). Одна запись — одно событие: вид (kind), команда, участник,
 * подстановки. Из журнала собираются: лента команды «Что случилось» (E-04), новости для всех команд об испытаниях
 * без ставок и чисел стихов (S-15), воскресная летопись (E-01, без «слова администратора»), «Моё служение»
 * участника и доска активности администратора (E-03), «Книга сезона» (E-10).
 * Тексты — русские шаблоны с {подстановками}; клиент показывает их через свой словарь, письма — через msg().
 */

export type JournalKind =
  | "deed_submitted" | "deed_approved" | "deed_returned"
  | "order_solved" | "task_solved" | "city_captured" | "ruins_taken" | "treasure"
  | "trial_declared" | "trial_queued" | "trial_started" | "trial_repelled" | "trial_won" | "trial_burnt" | "trial_cancelled"
  | "siege_declared" | "siege_won" | "siege_repelled"
  | "passage_granted" | "passage_denied" | "sea_landed"
  | "penalty" | "role_changed" | "capital_moved"
  | "peace_offered" | "peace_made" | "peace_declined" | "peace_broken"
  | "chronicle" | "game_finished";

export type JournalVars = Record<string, string | number>;

/** Шаблоны текста по виду события. {team} — команда записи, {other} — другая команда, {book} — код книги (подставится название). */
export const JOURNAL_TEXT: Record<JournalKind, string> = {
  deed_submitted: "{user} сдал(а) дело «{deed}» на проверку",
  deed_approved: "Дело «{deed}» принято{who}: перекрёсток открыт",
  deed_returned: "Дело «{deed}» возвращено на доработку",
  order_solved: "{user} собрал(а) порядок районов города {book}",
  task_solved: "{user} решил(а) район {n} города {book}",
  city_captured: "Команда «{team}» взяла город {book}{capital}",
  ruins_taken: "Команда «{team}» заняла руины города {book}",
  treasure: "Находка в руинах города {book}: знак шифра города {other}",
  trial_declared: "Команда «{team}» бросила вызов городу {book} команды «{other}»",
  trial_queued: "Команда «{team}» встала в очередь на город {book} команды «{other}»",
  trial_started: "Вызов команды «{team}» городу {book} команды «{other}» начался",
  trial_repelled: "Город {book} устоял: команда «{other}» отбила вызов команды «{team}»",
  trial_won: "Команда «{team}» взяла город {book} у команды «{other}»",
  trial_burnt: "Вызов команды «{team}» городу {book} команды «{other}» сгорел",
  trial_cancelled: "Вызов команды «{team}» городу {book} отменён",
  siege_declared: "Команда «{team}» объявила осаду делами городу {book} команды «{other}»",
  siege_won: "Осада удалась: город {book} перешёл команде «{team}» от команды «{other}»",
  siege_repelled: "Осада отбита: город {book} остаётся у команды «{other}»",
  passage_granted: "Команда «{other}» разрешила проход через город {book}",
  passage_denied: "Команда «{other}» не разрешила проход через город {book}",
  sea_landed: "{user} привёл(а) корабль к другому острову",
  penalty: "Штраф администратора: участок пути аннулирован",
  role_changed: "{user}: роль {role}",
  capital_moved: "Столица перенесена",
  peace_offered: "Команда «{team}» предложила мир команде «{other}»",
  peace_made: "Команды «{team}» и «{other}» заключили мир",
  peace_declined: "Команда «{other}» отклонила предложение мира",
  peace_broken: "Команда «{team}» расторгла мир с командой «{other}»",
  chronicle: "Летопись недели",
  game_finished: "Игра завершена{winner}",
};

/** Текст записи на языке получателя (для писем и летописи). */
export function journalText(locale: Locale, kind: JournalKind, vars: JournalVars): string {
  return msg(locale, JOURNAL_TEXT[kind], vars);
}

/** Имя участника для записей: отображаемое имя или ник. */
export async function nick(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { nickname: true, displayName: true } });
  return u?.displayName || u?.nickname || "";
}
/** Названия команд по id. */
export async function teamNames(...ids: string[]): Promise<string[]> {
  const rows = await prisma.team.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return ids.map((id) => rows.find((r) => r.id === id)?.name ?? "");
}
export const ROLE_RU: Record<string, string> = { NONE: "без роли", SCOUT: "разведчик", PROPHET: "пророк", AMBASSADOR: "посол", CHRONICLER: "летописец", HELMSMAN: "кормчий" };

/** Записать событие. Не ломает запрос: ошибка только в консоль. */
export function journal(gameId: string, kind: JournalKind, o: { teamId?: string | null; userId?: string | null; everyone?: boolean; vars?: JournalVars; text?: string } = {}): void {
  void prisma.journal.create({ data: { gameId, kind, teamId: o.teamId ?? null, userId: o.userId ?? null, everyone: o.everyone ?? false, vars: o.vars ?? {}, text: o.text ?? "" } })
    .then(() => publish(gameId, { type: "journal", teamId: o.teamId ?? undefined }))
    .catch((e) => console.error("journal failed", e));
}

/** Лента команды: свои записи и новости для всех, новые сверху. */
export async function feed(gameId: string, teamId: string, limit = 60) {
  const rows = await prisma.journal.findMany({ where: { gameId, OR: [{ teamId }, { everyone: true }] }, orderBy: { createdAt: "desc" }, take: limit });
  return rows.map((r) => ({ id: r.id, kind: r.kind as JournalKind, vars: r.vars as JournalVars, text: r.text, everyone: r.everyone, mine: r.teamId === teamId, at: r.createdAt.getTime() }));
}

/** Сводка участника: дела, районы, стихи, переправы (E-03 «Моё служение»). */
export interface ServiceStats { deeds: number; deedsPending: number; tasks: number; orders: number; cities: number; verses: number; trips: number; lastActiveAt: number | null }
export async function serviceStats(gameId: string, userId: string, teamId: string): Promise<ServiceStats> {
  const [deeds, deedsPending, entries, rows] = await Promise.all([
    prisma.teamEdgeTask.count({ where: { gameId, teamId, status: "APPROVED", OR: [{ takenById: userId }, { participants: { has: userId } }] } }),
    prisma.teamEdgeTask.count({ where: { gameId, teamId, status: { in: ["TAKEN", "SUBMITTED"] }, OR: [{ takenById: userId }, { participants: { has: userId } }] } }),
    prisma.battleEntry.findMany({ where: { userId, teamId, status: "APPROVED", battle: { gameId } }, select: { startIdx: true, endIdx: true } }),
    prisma.journal.findMany({ where: { gameId, userId }, select: { kind: true, createdAt: true } }),
  ]);
  const count = (k: JournalKind) => rows.filter((r) => r.kind === k).length;
  const last = rows.reduce<number | null>((a, r) => (a === null || r.createdAt.getTime() > a ? r.createdAt.getTime() : a), null);
  return { deeds, deedsPending, tasks: count("task_solved"), orders: count("order_solved"), cities: count("city_captured") + count("ruins_taken"), verses: entries.reduce((a, e) => a + (e.endIdx - e.startIdx + 1), 0), trips: count("sea_landed"), lastActiveAt: last };
}

/** Доска активности для администратора: все участники игры с той же сводкой, самые активные сверху. */
export async function activityBoard(gameId: string) {
  const members = await prisma.membership.findMany({ where: { team: { gameId } }, select: { userId: true, teamId: true, role: true, gameRole: true, user: { select: { nickname: true, displayName: true } }, team: { select: { name: true, color: true } } } });
  const rows = await Promise.all(members.map(async (m) => ({ userId: m.userId, nickname: m.user.nickname, displayName: m.user.displayName, team: m.team.name, color: m.team.color, role: m.role, gameRole: m.gameRole, ...(await serviceStats(gameId, m.userId, m.teamId)) })));
  const score = (r: ServiceStats) => r.deeds * 3 + r.tasks + r.orders + r.cities * 2 + Math.ceil(r.verses / 5) + r.trips;
  return rows.sort((a, b) => score(b) - score(a) || (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0));
}

/** Строки летописи за период: дела по командам, города, испытания без ставок, положение. */
export async function chronicleLines(gameId: string, from: Date, to: Date, locale: Locale): Promise<string[]> {
  const [rows, teams, table] = await Promise.all([
    prisma.journal.findMany({ where: { gameId, createdAt: { gte: from, lt: to }, kind: { not: "chronicle" } }, orderBy: { createdAt: "asc" } }),
    prisma.team.findMany({ where: { gameId }, select: { id: true, name: true } }),
    standings(gameId),
  ]);
  const name = new Map(teams.map((t) => [t.id, t.name]));
  const lines: string[] = [];
  const deeds = teams.map((t) => ({ name: t.name, n: rows.filter((r) => r.kind === "deed_approved" && r.teamId === t.id).length })).filter((d) => d.n > 0);
  lines.push(deeds.length ? msg(locale, "Дела за неделю: {list}.", { list: deeds.map((d) => `«${d.name}» — ${d.n}`).join(", ") }) : msg(locale, "Дел за неделю не принято."));
  const cities = rows.filter((r) => r.kind === "city_captured" || r.kind === "ruins_taken" || r.kind === "trial_won" || r.kind === "siege_won");
  if (cities.length) lines.push(msg(locale, "Города: {list}.", { list: cities.map((r) => journalText(locale, r.kind as JournalKind, r.vars as JournalVars)).join("; ") }));
  const trials = rows.filter((r) => ["trial_declared", "trial_repelled", "trial_won", "trial_burnt", "siege_declared", "siege_won", "siege_repelled"].includes(r.kind));
  if (trials.length) lines.push(msg(locale, "Испытания: {list}.", { list: trials.map((r) => journalText(locale, r.kind as JournalKind, r.vars as JournalVars)).join("; ") }));
  const peace = rows.filter((r) => r.kind === "peace_made" || r.kind === "peace_broken");
  if (peace.length) lines.push(msg(locale, "Мир: {list}.", { list: peace.map((r) => journalText(locale, r.kind as JournalKind, r.vars as JournalVars)).join("; ") }));
  lines.push(msg(locale, "Положение: {list}.", { list: table.map((s, i) => `${i + 1}. «${name.get(s.teamId) ?? s.name}» — ${msg(locale, "{n} гор.", { n: s.cities })}, ${msg(locale, "{n} дел", { n: s.deedsApproved })}`).join("; ") }));
  return lines;
}

/** Воскресная летопись: раз в неделю по правилам игры (день недели и час UTC) всем командам; записывается в журнал как новость. */
export async function sweepChronicles(now = new Date()): Promise<void> {
  const games = await prisma.game.findMany({ where: { status: "ACTIVE" }, select: { id: true, settings: true } });
  for (const g of games) {
    const rules = rulesOf(g.settings);
    const st = (g.settings as { lastChronicleAt?: string }) ?? {};
    const last = st.lastChronicleAt ? Date.parse(st.lastChronicleAt) : 0;
    if (now.getUTCDay() !== rules.chronicleWeekday || now.getUTCHours() < rules.chronicleHourUtc) continue;
    if (now.getTime() - last < 6 * 86_400_000) continue;
    await sendChronicle(g.id, now);
  }
}

/** Собрать и разослать летопись за последние 7 дней (по расписанию или по кнопке администратора). */
export async function sendChronicle(gameId: string, now = new Date()): Promise<string[]> {
  const from = new Date(now.getTime() - 7 * 86_400_000);
  const ru = await chronicleLines(gameId, from, now, "ru");
  const game = await prisma.game.findUniqueOrThrow({ where: { id: gameId }, select: { settings: true } });
  await prisma.game.update({ where: { id: gameId }, data: { settings: { ...(game.settings as object), lastChronicleAt: now.toISOString() } } });
  journal(gameId, "chronicle", { everyone: true, text: ru.join("\n"), vars: { from: from.toISOString(), to: now.toISOString() } });
  const en = await chronicleLines(gameId, from, now, "en");
  const teams = await prisma.team.findMany({ where: { gameId }, select: { id: true } });
  for (const t of teams) notifyTeam(gameId, t.id, "летопись недели", (locale) => (locale === "en" ? en : ru).join("\n"));
  return ru;
}

/** «Книга сезона»: итоги, города, дела по командам и участникам, испытания и летописи — для показа на собрании. */
export async function seasonBook(gameId: string) {
  const game = await prisma.game.findUniqueOrThrow({ where: { id: gameId }, include: { org: { select: { name: true } } } });
  const [table, teams, deeds, rows] = await Promise.all([
    standings(gameId),
    prisma.team.findMany({ where: { gameId }, include: { members: { include: { user: { select: { id: true, nickname: true, displayName: true } } } }, cityStates: { where: { capturedAt: { not: null } } } }, orderBy: { index: "asc" } }),
    prisma.teamEdgeTask.findMany({ where: { gameId, status: "APPROVED" }, include: { deed: { select: { title: true, direction: true } } }, orderBy: { decidedAt: "asc" } }),
    prisma.journal.findMany({ where: { gameId, OR: [{ everyone: true }, { kind: { in: ["trial_declared", "trial_repelled", "trial_won", "trial_burnt"] } }] }, orderBy: { createdAt: "asc" } }),
  ]);
  const nodes = await prisma.mapNode.findMany({ where: { gameId, bookCode: { not: null } }, select: { key: true, bookCode: true } });
  const bookOf = new Map(nodes.map((n) => [n.key, n.bookCode!]));
  const users = new Map(teams.flatMap((t) => t.members.map((m) => [m.user.id, m.user.displayName || m.user.nickname] as const)));
  return {
    game: { name: game.name, org: game.org.name, startedAt: game.startedAt, finishedAt: game.finishedAt, winnerTeamId: game.winnerTeamId, status: game.status },
    standings: table,
    teams: await Promise.all(teams.map(async (t) => ({
      id: t.id, name: t.name, color: t.color, status: t.status,
      members: await Promise.all(t.members.map(async (m) => ({ userId: m.userId, name: m.user.displayName || m.user.nickname, role: m.role, gameRole: m.gameRole, ...(await serviceStats(gameId, m.userId, t.id)) }))),
      cities: t.cityStates.map((c) => ({ nodeKey: c.nodeKey, book: bookOf.get(c.nodeKey) ?? "", capturedAt: c.capturedAt, firstCapturedAt: c.firstCapturedAt, isCapital: c.isCapital })),
      deeds: deeds.filter((d) => d.teamId === t.id).map((d) => ({ title: d.deed.title, direction: d.deed.direction, decidedAt: d.decidedAt, by: [...new Set([d.takenById, ...d.participants])].filter((x): x is string => !!x).map((u) => users.get(u) ?? "") })),
    }))),
    events: rows.map((r) => ({ id: r.id, kind: r.kind as JournalKind, vars: r.vars as JournalVars, text: r.text, at: r.createdAt })),
  };
}

export { toLocale };
