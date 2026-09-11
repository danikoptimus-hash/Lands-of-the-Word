import { prisma } from "../db.js";
import { mailEnabled, sendMail } from "./mail.js";
import { msg, toLocale, type Locale } from "./i18n.js";
import { sendPush } from "./push.js";

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

interface Recipient { id: string; email: string | null; locale: string }

/** Письмо (если настроена почта) и push (на подписанные устройства) каждому получателю на его языке. */
async function sendAll(people: Recipient[], subject: string, body: Text, vars: Vars | undefined, footer: string, link: string): Promise<void> {
  const seen = new Set<string>();
  const jobs: Promise<unknown>[] = [];
  const byUser = new Map<string, { title: string; body: string }>();
  for (const p of people) {
    const locale = toLocale(p.locale);
    const title = msg(locale, subject, vars);
    const text = typeof body === "function" ? body(locale) : msg(locale, body, vars);
    byUser.set(p.id, { title, body: text });
    if (mailEnabled() && p.email && !seen.has(p.email)) {
      seen.add(p.email);
      jobs.push(sendMail({ to: p.email, subject: `${msg(locale, "Земли Слова")}: ${title}`, text: `${text}\n\n${msg(locale, footer)}: ${link}` }).catch((e) => log(e, `notify mail to ${p.email} failed`)));
    }
  }
  jobs.push(sendPush([...byUser.keys()], (id) => ({ ...byUser.get(id)!, url: link })).catch((e) => log(e, "notify push failed")));
  await Promise.all(jobs);
}

/** Всем участникам команды с почтой. */
export function notifyTeam(gameId: string, teamId: string, subject: string, body: Text, vars?: Vars): void {
  void (async () => {
    const rows = await prisma.membership.findMany({ where: { teamId }, select: { user: { select: { id: true, email: true, locale: true } } } });
    await sendAll(rows.map((r) => r.user), subject, body, vars, "Открыть карту команды", `${publicUrl}/games/${gameId}/team`);
  })().catch((e) => log(e, "notifyTeam failed"));
}

/** Одному человеку. */
export function notifyUser(gameId: string, userId: string, subject: string, body: Text, vars?: Vars): void {
  void (async () => {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, locale: true } });
    if (u) await sendAll([u], subject, body, vars, "Открыть карту команды", `${publicUrl}/games/${gameId}/team`);
  })().catch((e) => log(e, "notifyUser failed"));
}

/** Всем администраторам игры с почтой. */
export function notifyAdmins(gameId: string, subject: string, body: Text, vars?: Vars): void {
  void (async () => {
    const rows = await prisma.gameAdmin.findMany({ where: { gameId }, select: { user: { select: { id: true, email: true, locale: true } } } });
    await sendAll(rows.map((r) => r.user), subject, body, vars, "Проверить", `${publicUrl}/games/${gameId}`);
  })().catch((e) => log(e, "notifyAdmins failed"));
}
