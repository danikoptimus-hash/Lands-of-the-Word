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

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

/** HTML-версия письма: логотип и название в шапке, текст с сохранением строк, ссылки кликабельны. */
export function renderHtml(text: string, publicUrl: string): string {
  const base = publicUrl.replace(/\/$/, "");
  const body = escapeHtml(text).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:#C7742A">${u}</a>`).replace(/\n/g, "<br>");
  return `<!doctype html><html><body style="margin:0;background:#F6F4EF;font-family:Inter,Arial,sans-serif;color:#1F1B16">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px"><img src="${base}/img/brand/logo-128.png" width="40" height="40" alt="" style="display:block"><strong style="font-size:18px">Земли Слова</strong> <span style="color:#6B645A">· Lands of the Word</span></div>
<div style="background:#fff;border:1px solid #E6E1D6;border-radius:12px;padding:20px;font-size:15px;line-height:1.5">${body}</div>
<p style="color:#6B645A;font-size:12px;margin-top:16px"><a href="${base}" style="color:#6B645A">${base.replace(/^https?:\/\//, "")}</a></p>
</div></body></html>`;
}

export function mailEnabled(): boolean {
  return env?.NODE_ENV === "test" || transporter !== null;
}

/** Отправляет письмо; возвращает false, если почта не настроена. Ошибки SMTP пробрасываются. */
export async function sendMail(mail: Mail): Promise<boolean> {
  if (env?.NODE_ENV === "test") { outbox.push(mail); return true; }
  if (!transporter || !env) return false;
  try {
    await transporter.sendMail({ from: env.MAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text, html: renderHtml(mail.text, env.PUBLIC_URL) });
    mailStats.sent++;
    return true;
  } catch (e) { mailStats.failed++; throw e; }
}
