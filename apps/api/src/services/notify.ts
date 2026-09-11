import { prisma } from "../db.js";
import { mailEnabled, sendMail } from "./mail.js";
import { msg, toLocale, type Locale } from "./i18n.js";

/**
 * Письма-уведомления. Уходят в фоне и никогда не ломают запрос: ошибка только в лог.
 * Кому что: команде — вызов её городу, старт ответа, итог испытания, возврат дела;
 * админам игры — новые сдачи (дело, запись испытания), которые надо проверить.
 * Тема и текст — русские шаблоны с подстановками {x}; каждому получателю письмо собирается на его языке
 * (User.locale), см. services/i18n.ts. Значение переменной book — код книги, подставится её название.
 */
export type Vars = Record<string, string | number>;
/** Текст с подстановками; функция — когда часть текста зависит от языка (например дата или вложенный шаблон). */
export type Text = string | ((locale: Locale) => string);

let publicUrl = "http://localhost:3000";
let log: (e: unknown, msg: string) => void = () => {};
export function initNotify(url: string, logger: (e: unknown, msg: string) => void): void { publicUrl = url.replace(/\/$/, ""); log = logger; }

interface Recipient { email: string | null; locale: string }

async function sendAll(people: Recipient[], subject: string, body: Text, vars: Vars | undefined, footer: string, link: string): Promise<void> {
  if (!mailEnabled()) return;
  const seen = new Set<string>();
  const jobs: Promise<unknown>[] = [];
  for (const p of people) {
    if (!p.email || seen.has(p.email)) continue;
    seen.add(p.email);
    const locale = toLocale(p.locale);
    const text = typeof body === "function" ? body(locale) : msg(locale, body, vars);
    jobs.push(sendMail({ to: p.email, subject: `${msg(locale, "Земли Слова")}: ${msg(locale, subject, vars)}`, text: `${text}\n\n${msg(locale, footer)}: ${link}` }).catch((e) => log(e, `notify mail to ${p.email} failed`)));
  }
  await Promise.all(jobs);
}

/** Всем участникам команды с почтой. */
export function notifyTeam(gameId: string, teamId: string, subject: string, body: Text, vars?: Vars): void {
  void (async () => {
    const rows = await prisma.membership.findMany({ where: { teamId }, select: { user: { select: { email: true, locale: true } } } });
    await sendAll(rows.map((r) => r.user), subject, body, vars, "Открыть карту команды", `${publicUrl}/games/${gameId}/team`);
  })().catch((e) => log(e, "notifyTeam failed"));
}

/** Одному человеку. */
export function notifyUser(gameId: string, userId: string, subject: string, body: Text, vars?: Vars): void {
  void (async () => {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, locale: true } });
    if (u?.email) await sendAll([u], subject, body, vars, "Открыть карту команды", `${publicUrl}/games/${gameId}/team`);
  })().catch((e) => log(e, "notifyUser failed"));
}

/** Всем администраторам игры с почтой. */
export function notifyAdmins(gameId: string, subject: string, body: Text, vars?: Vars): void {
  void (async () => {
    const rows = await prisma.gameAdmin.findMany({ where: { gameId }, select: { user: { select: { email: true, locale: true } } } });
    await sendAll(rows.map((r) => r.user), subject, body, vars, "Проверить", `${publicUrl}/games/${gameId}`);
  })().catch((e) => log(e, "notifyAdmins failed"));
}
