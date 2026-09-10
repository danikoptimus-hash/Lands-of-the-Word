import { prisma } from "../db.js";
import { mailEnabled, sendMail } from "./mail.js";

/**
 * Письма-уведомления. Уходят в фоне и никогда не ломают запрос: ошибка только в лог.
 * Кому что: команде — атака на её город, старт обороны, итог битвы, возврат дела;
 * админам игры — новые сдачи (дело, запись битвы), которые надо проверить.
 */

let publicUrl = "http://localhost:3000";
let log: (e: unknown, msg: string) => void = () => {};
export function initNotify(url: string, logger: (e: unknown, msg: string) => void): void { publicUrl = url.replace(/\/$/, ""); log = logger; }

async function sendAll(emails: string[], subject: string, text: string): Promise<void> {
  if (!mailEnabled()) return;
  const unique = [...new Set(emails.filter(Boolean))];
  await Promise.all(unique.map((to) => sendMail({ to, subject: `Земли Слова: ${subject}`, text }).catch((e) => log(e, `notify mail to ${to} failed`))));
}

/** Всем участникам команды с почтой. */
export function notifyTeam(gameId: string, teamId: string, subject: string, body: string): void {
  void (async () => {
    const rows = await prisma.membership.findMany({ where: { teamId }, select: { user: { select: { email: true } } } });
    await sendAll(rows.map((r) => r.user.email ?? ""), subject, `${body}\n\nОткрыть карту команды: ${publicUrl}/games/${gameId}/team`);
  })().catch((e) => log(e, "notifyTeam failed"));
}

/** Одному человеку. */
export function notifyUser(gameId: string, userId: string, subject: string, body: string): void {
  void (async () => {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (u?.email) await sendAll([u.email], subject, `${body}\n\nОткрыть карту команды: ${publicUrl}/games/${gameId}/team`);
  })().catch((e) => log(e, "notifyUser failed"));
}

/** Всем администраторам игры с почтой. */
export function notifyAdmins(gameId: string, subject: string, body: string): void {
  void (async () => {
    const rows = await prisma.gameAdmin.findMany({ where: { gameId }, select: { user: { select: { email: true } } } });
    await sendAll(rows.map((r) => r.user.email ?? ""), subject, `${body}\n\nПроверить: ${publicUrl}/games/${gameId}`);
  })().catch((e) => log(e, "notifyAdmins failed"));
}
