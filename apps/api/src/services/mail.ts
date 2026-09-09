import nodemailer, { type Transporter } from "nodemailer";
import type { Env } from "../env.js";

/**
 * Письма (SMTP через nodemailer). Если SMTP не настроен, письма не уходят: mailEnabled() = false,
 * и интерфейс предлагает восстановление через админа игры. В тестах письма складываются в outbox.
 */
export interface Mail { to: string; subject: string; text: string }
export const outbox: Mail[] = [];

let transporter: Transporter | null = null;
let env: Env | null = null;

export function initMail(config: Env): void {
  env = config;
  transporter = config.SMTP_HOST
    ? nodemailer.createTransport({ host: config.SMTP_HOST, port: config.SMTP_PORT, secure: config.SMTP_PORT === 465, auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS ?? "" } : undefined })
    : null;
}

export function mailEnabled(): boolean {
  return env?.NODE_ENV === "test" || transporter !== null;
}

/** Отправляет письмо; возвращает false, если почта не настроена. Ошибки SMTP пробрасываются. */
export async function sendMail(mail: Mail): Promise<boolean> {
  if (env?.NODE_ENV === "test") { outbox.push(mail); return true; }
  if (!transporter || !env) return false;
  await transporter.sendMail({ from: env.MAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text });
  return true;
}
