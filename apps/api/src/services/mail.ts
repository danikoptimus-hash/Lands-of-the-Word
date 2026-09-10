import nodemailer, { type Transporter } from "nodemailer";
import type { Env } from "../env.js";

/**
 * Письма (SMTP через nodemailer). Если SMTP не настроен, письма не уходят: mailEnabled() = false,
 * и интерфейс предлагает восстановление через админа игры. В тестах письма складываются в outbox.
 */
export interface Mail { to: string; subject: string; text: string }
export const outbox: Mail[] = [];
/** Счётчики с момента запуска процесса (для дашборда суперадмина). */
export const mailStats = { sent: 0, failed: 0, startedAt: Date.now() };

let transporter: Transporter | null = null;
let env: Env | null = null;

export function initMail(config: Env): void {
  env = config;
  transporter = config.SMTP_HOST
    ? nodemailer.createTransport({
        host: config.SMTP_HOST, port: config.SMTP_PORT, secure: config.SMTP_PORT === 465,
        auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS ?? "" } : undefined,
        // Не ждать минутами, если порт закрыт: быстрая понятная ошибка.
        connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
      })
    : null;
}

/** Проверка соединения с SMTP (для кнопки суперадмина). */
export async function verifyMail(): Promise<{ ok: boolean; error?: string; host?: string; port?: number }> {
  if (!transporter || !env) return { ok: false, error: "SMTP не настроен: нет SMTP_HOST в deploy/.env" };
  try { await transporter.verify(); return { ok: true, host: env.SMTP_HOST, port: env.SMTP_PORT }; }
  catch (e) { return { ok: false, error: describeMailError(e), host: env.SMTP_HOST, port: env.SMTP_PORT }; }
}

/** Человеческое описание ошибки SMTP. */
export function describeMailError(e: unknown): string {
  const err = e as { code?: string; responseCode?: number; message?: string; command?: string };
  if (err.code === "ETIMEDOUT" || err.code === "ESOCKET" || err.code === "ECONNECTION") return `Сервер не смог подключиться к SMTP (${err.code}). Похоже, исходящий порт закрыт хостингом: у Hetzner для новых аккаунтов закрыты порты 25 и 465 — попробуйте SMTP_PORT=587.`;
  if (err.code === "EAUTH" || err.responseCode === 535) return "SMTP отверг логин или пароль (EAUTH). Для Gmail нужен пароль приложения, а не пароль от ящика.";
  if (err.code === "EDNS" || err.code === "ENOTFOUND") return `Не найден адрес SMTP-сервера (${err.code}): проверьте SMTP_HOST.`;
  return err.message ?? String(e);
}

export function mailEnabled(): boolean {
  return env?.NODE_ENV === "test" || transporter !== null;
}

/** Отправляет письмо; возвращает false, если почта не настроена. Ошибки SMTP пробрасываются. */
export async function sendMail(mail: Mail): Promise<boolean> {
  if (env?.NODE_ENV === "test") { outbox.push(mail); return true; }
  if (!transporter || !env) return false;
  try {
    await transporter.sendMail({ from: env.MAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text });
    mailStats.sent++;
    return true;
  } catch (e) { mailStats.failed++; throw e; }
}
