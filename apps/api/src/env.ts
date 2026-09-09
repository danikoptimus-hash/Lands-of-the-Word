import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(8),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  WEB_DIST: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(overrides: Partial<Record<keyof Env, string>> = {}): Env {
  const parsed = schema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    throw new Error("Неверные переменные окружения: " + parsed.error.issues.map((i) => i.path.join(".") + ": " + i.message).join("; "));
  }
  return parsed.data;
}
