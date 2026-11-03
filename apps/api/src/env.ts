import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(8),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  WEB_DIST: z.string().optional(),
  /** Публичный адрес сайта для ссылок в письмах. */
  PUBLIC_URL: z.string().url().default("http://localhost:3000"),
  /** Почта. Без SMTP_HOST письма не отправляются (восстановление пароля — только через админа игры). */
  SMTP_HOST: z.string().optional().or(z.literal("").transform(() => undefined)),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional().or(z.literal("").transform(() => undefined)),
  SMTP_PASS: z.string().optional().or(z.literal("").transform(() => undefined)),
  MAIL_FROM: z.string().default("Земли Слова <noreply@landsoftheword.com>"),
  /** Вход через Google (OpenID Connect). Включается, только когда заданы оба значения; храним только почту и id (sub). */
  GOOGLE_CLIENT_ID: z.string().optional().or(z.literal("").transform(() => undefined)),
  GOOGLE_CLIENT_SECRET: z.string().optional().or(z.literal("").transform(() => undefined)),
  /** Ключ OpenAI для проверки аватарок на уместность (решение владельца 24.10). Без ключа загрузка аватарок закрыта. */
  OPENAI_API_KEY: z.string().optional().or(z.literal("").transform(() => undefined)),
});

export type Env = z.infer<typeof schema>;

/**
 * Вход за тестового бота без пароля (быстрое переключение на стенде) включён только когда сайт — стенд или локальная
 * разработка: хост PUBLIC_URL начинается с «test.» либо это localhost/127.0.0.1. На проде PUBLIC_URL — голый домен
 * (landsoftheword.com), поэтому там это всегда выключено: маршрутов /api/dev/* в проде нет вовсе, бэкдора не возникает.
 */
export function devLoginEnabled(env: Pick<Env, "PUBLIC_URL">): boolean {
  try {
    const host = new URL(env.PUBLIC_URL).hostname;
    return host === "localhost" || host === "127.0.0.1" || host.startsWith("test.");
  } catch { return false; }
}

export function loadEnv(overrides: Partial<Record<keyof Env, string>> = {}): Env {
  const parsed = schema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    throw new Error("Неверные переменные окружения: " + parsed.error.issues.map((i) => i.path.join(".") + ": " + i.message).join("; "));
  }
  return parsed.data;
}
