import { prisma } from "../db.js";
import { rulesOf } from "./rules.js";

/**
 * Разовые операции владельца при запуске сервера (идемпотентно, отметка в AppSetting). Удаляются после применения.
 * 02.10: в идущей партии «Осень» лимит дел в сутки на участника = 2 (решение владельца; настройка появилась после старта партии).
 */
export async function runOwnerOps(log: { info: (o: object, msg: string) => void }): Promise<void> {
  const key = "ops.maxDeedsPerDay.osen";
  if (await prisma.appSetting.findUnique({ where: { key } })) return;
  const games = await prisma.game.findMany({ where: { status: "ACTIVE", name: "Осень" }, select: { id: true, settings: true } });
  for (const g of games) {
    const prev = (g.settings ?? {}) as Record<string, unknown>;
    const rules = rulesOf(prev);
    if (rules.maxDeedsPerDay) continue;
    await prisma.game.update({ where: { id: g.id }, data: { settings: { ...prev, rules: { ...rules, maxDeedsPerDay: 2 } } } });
    log.info({ gameId: g.id }, "ops: лимит дел в сутки = 2");
  }
  await prisma.appSetting.create({ data: { key, value: new Date().toISOString() } });
}
