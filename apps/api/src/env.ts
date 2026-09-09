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
});

export type Env = z.infer<typeof schema>;

export function loadEnv(overrides: Partial<Record<keyof Env, string>> = {}): Env {
  const parsed = schema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    throw new Error("Неверные переменные окружения: " + parsed.error.issues.map((i) => i.path.join(".") + ": " + i.message).join("; "));
  }
  return parsed.data;
}
