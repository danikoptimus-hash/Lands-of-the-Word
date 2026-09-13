import { prisma } from "../db.js";

const KEY = "support.email";

/** Адрес, куда уходят обращения: настройка суперадмина, иначе почта первого администратора платформы. */
export async function supportEmail(): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
  if (row?.value) return row.value;
  const sa = await prisma.user.findFirst({ where: { platformRole: "SUPERADMIN", email: { not: null } }, orderBy: { createdAt: "asc" }, select: { email: true } });
  return sa?.email ?? null;
}

export async function supportSettings(): Promise<{ supportEmail: string | null; fallback: string | null }> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
  const sa = await prisma.user.findFirst({ where: { platformRole: "SUPERADMIN", email: { not: null } }, orderBy: { createdAt: "asc" }, select: { email: true } });
  return { supportEmail: row?.value || null, fallback: sa?.email ?? null };
}

export async function setSupportEmail(email: string | null): Promise<void> {
  if (!email) { await prisma.appSetting.deleteMany({ where: { key: KEY } }); return; }
  await prisma.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: email }, update: { value: email } });
}
