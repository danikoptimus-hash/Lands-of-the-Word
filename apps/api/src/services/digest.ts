import { prisma } from "../db.js";
import { notifyAdmins } from "./notify.js";
import { rulesOf } from "./rules.js";

/**
 * Дайджест сдач для администраторов (решение владельца 18.09, A-13): вместо письма на каждую сдачу — одно письмо
 * раз в 3 часа или раз в день (по выбору в продвинутых настройках), только если есть что проверять.
 * Время последнего письма хранится в settings.lastDigestAt.
 */
export async function sweepDigests(now = new Date()): Promise<void> {
  const games = await prisma.game.findMany({ where: { status: "ACTIVE" }, select: { id: true, settings: true } });
  for (const g of games) {
    const rules = rulesOf(g.settings);
    if (rules.adminDigest === "instant") continue;
    const st = g.settings as { lastDigestAt?: string };
    const last = st.lastDigestAt ? Date.parse(st.lastDigestAt) : 0;
    const interval = rules.adminDigest === "3h" ? 3 * 3_600_000 : 24 * 3_600_000;
    if (now.getTime() - last < interval) continue;
    const [deeds, sides] = await Promise.all([
      prisma.teamEdgeTask.count({ where: { gameId: g.id, status: "SUBMITTED" } }),
      prisma.battle.count({ where: { gameId: g.id, status: { in: ["ATTACK", "DEFENSE"] }, entries: { some: { status: "SUBMITTED" } } } }),
    ]);
    await prisma.game.update({ where: { id: g.id }, data: { settings: { ...(g.settings as object), lastDigestAt: now.toISOString() } } });
    if (deeds + sides === 0) continue;
    notifyAdmins(g.id, "сдачи ждут проверки", "На проверке: дел — {deeds}, сторон испытаний — {sides}. Откройте раздел «Проверка».", { deeds, sides });
  }
}
