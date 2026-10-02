import { prisma } from "../db.js";
import { rulesOf } from "./rules.js";

/**
 * Разовые операции владельца при запуске сервера (идемпотентно, отметка в AppSetting). Удаляются после применения.
 * 02.10 (вечер): в идущей партии «Осень» лимит дел в сутки на участника = 1 (решение владельца; утром ставили 2).
 */
export async function runOwnerOps(log: { info: (o: object, msg: string) => void }): Promise<void> {
  const key = "ops.maxDeedsPerDay.osen.1";
  if (await prisma.appSetting.findUnique({ where: { key } })) return;
  const games = await prisma.game.findMany({ where: { status: "ACTIVE", name: "Осень" }, select: { id: true, settings: true } });
  for (const g of games) {
    const prev = (g.settings ?? {}) as Record<string, unknown>;
    const rules = rulesOf(prev);
    if (rules.maxDeedsPerDay === 1) continue;
    await prisma.game.update({ where: { id: g.id }, data: { settings: { ...prev, rules: { ...rules, maxDeedsPerDay: 1 } } } });
    log.info({ gameId: g.id }, "ops: лимит дел в сутки = 1");
  }
  await prisma.appSetting.create({ data: { key, value: new Date().toISOString() } });
}
