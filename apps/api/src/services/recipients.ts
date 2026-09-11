import { prisma } from "../db.js";
import { loadCityContent, makeCityCode, makeCityKey } from "./cities.js";

/**
 * Адресаты конвертов: семьи, вдовы, старицы, к которым команда несёт шифр города.
 * Храним только короткую подпись и тип; список стирается при завершении игры.
 */

/** У каждого города должны быть ключ конверта и шифр — нужны и для ярлыков до старта, и для игры. */
export async function ensureCityCodes(gameId: string): Promise<void> {
  const nodes = await prisma.mapNode.findMany({ where: { gameId, kind: "CITY", OR: [{ cityKey: null }, { cityCode: null }] }, select: { id: true, bookCode: true, cityKey: true, cityCode: true } });
  for (const n of nodes) {
    const len = (await loadCityContent(n.bookCode ?? ""))?.tasks.length ?? 12;
    await prisma.mapNode.update({ where: { id: n.id }, data: { cityKey: n.cityKey ?? makeCityKey(), cityCode: n.cityCode ?? makeCityCode(len) } });
  }
}

/**
 * Раздаёт адресатов городам без адресата по кругу, начиная с тех, у кого конвертов меньше всего.
 * Уже назначенные пары не трогает, поэтому напечатанные ярлыки остаются верными.
 */
export async function assignRecipients(gameId: string): Promise<number> {
  const recipients = await prisma.recipient.findMany({ where: { gameId }, orderBy: { createdAt: "asc" }, include: { _count: { select: { nodes: true } } } });
  if (recipients.length === 0) return 0;
  const free = await prisma.mapNode.findMany({ where: { gameId, kind: "CITY", recipientId: null }, orderBy: { key: "asc" }, select: { id: true } });
  if (free.length === 0) return 0;
  const load = recipients.map((r) => ({ id: r.id, n: r._count.nodes }));
  // Детерминированное перемешивание городов по id, чтобы соседние города не уходили одному адресату подряд.
  const shuffled = [...free].sort((a, b) => hash(a.id) - hash(b.id));
  const updates = shuffled.map((node) => {
    load.sort((a, b) => a.n - b.n);
    const r = load[0]!; r.n += 1;
    return prisma.mapNode.update({ where: { id: node.id }, data: { recipientId: r.id } });
  });
  await prisma.$transaction(updates);
  return updates.length;
}

/** Завершение игры: адресаты стираются, у городов снимается привязка (персональные данные не живут дольше игры). */
export async function purgeRecipients(gameId: string): Promise<void> {
  await prisma.$transaction([
    prisma.mapNode.updateMany({ where: { gameId, recipientId: { not: null } }, data: { recipientId: null } }),
    prisma.recipient.deleteMany({ where: { gameId } }),
  ]);
}

function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

export const RECIPIENT_KIND_LABEL: Record<string, string> = { FAMILY: "семья", WIDOW: "вдова", ELDER: "старец / старица", OTHER: "другой адресат" };
