import { fieldBoundsOf, generateIslets, hexToPixel, pickWreckHex, vertexToPixel, parseVertexKey } from "@lotw/domain";
import { prisma } from "../db.js";
import { publish } from "./events.js";
import { journal } from "./journal.js";
import { notifyTeam } from "./notify.js";
import { msg } from "./i18n.js";

/**
 * Разбитые бурей корабли с грузом (решение владельца 04.11): администратор помечает дело как срочное — на карте всех
 * команд у берега появляется разбитый корабль (один на все команды, несколько команд могут сдать одновременно). Корабль
 * везёт тёсаные камни или блоки для стен; команде показан возможный груз, но что выпадет — узнаёт после проверки
 * (одно из двух, 50/50, числа из самого дела `Deed.wreckStones` / `Deed.wreckBlocks` — решение владельца 05.11: «для каждого дела индивидуально»). После одобрения корабль у этой команды
 * чинится и уплывает за край карты. Если дело удалено, флажок снят или корабль отпущен — корабль тонет: у команд без
 * одобренной сдачи он ещё две минуты уходит под воду, открытые сдачи закрываются («Корабль затонул»).
 *
 * Владелец просил «в радиусе 50 гексов», но карты сейчас 20–30 гексов в поперечнике, а вид не уходит дальше пояса моря:
 * место выбирается в 2–6 гексах от берега (см. `pickWreckHex` в домене).
 */
/** Радиус гекса в единицах карты — как `HEX_SIZE` в вебе: от него зависят островки и стоянки кораблей. */
export const HEX_SIZE = 26;
/** Сколько корабль ещё отдаётся команде после решения или гибели, чтобы доиграть анимацию ухода или погружения. */
export const WRECK_LINGER_MS = 120_000;
/** Ночь мира живности: модель корабля и семя ракет. */
const MODELS = 3;

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Место корабля по карте игры: вода в 2–6 гексах от суши, не на островке, не у стоянок кораблей морских дел. */
export async function wreckSite(gameId: string, seed: number): Promise<{ q: number; r: number } | null> {
  const [hexes, ports] = await Promise.all([
    prisma.mapHex.findMany({ where: { gameId }, select: { q: true, r: true, island: true } }),
    prisma.mapNode.findMany({ where: { gameId, kind: "CITY", coastal: true }, select: { key: true, island: true } }),
  ]);
  if (!hexes.length) return null;
  const islets = generateIslets(hexes, HEX_SIZE, fieldBoundsOf(hexes, HEX_SIZE)).map((i) => ({ x: i.x, y: i.y, r: i.r, shape: i.shape }));
  // Стоянка корабля морского дела — 1,6 гекса от порта в сторону от центра острова (как `ships` в TeamMap.tsx).
  const centers = new Map<string, { x: number; y: number; n: number }>();
  for (const h of hexes) { const c = hexToPixel(h, HEX_SIZE), a = centers.get(h.island) ?? { x: 0, y: 0, n: 0 }; a.x += c.x; a.y += c.y; a.n++; centers.set(h.island, a); }
  const ships = ports.map((p) => {
    const v = vertexToPixel(parseVertexKey(p.key), HEX_SIZE), c = centers.get(p.island) ?? { x: 0, y: 0, n: 1 };
    const cx = c.x / c.n, cy = c.y / c.n, dx = v.x - cx, dy = v.y - cy, d = Math.hypot(dx, dy) || 1;
    return { x: v.x + (dx / d) * HEX_SIZE * 1.6, y: v.y + (dy / d) * HEX_SIZE * 1.6 };
  });
  return pickWreckHex(hexes, HEX_SIZE, seed, islets, ships);
}

/** Открыть корабль по срочному делу: если открытого ещё нет. Уведомляет все команды, пишет новость, рассылает событие. */
export async function openWreck(gameId: string, deed: { id: string; title: string; wreckStones: number; wreckBlocks: number; wreckSinkAt: Date | null }): Promise<{ id: string } | null> {
  const open = await prisma.wreck.findFirst({ where: { gameId, deedId: deed.id, closedAt: null }, select: { id: true, stones: true, blocks: true, title: true, sinkAt: true } });
  const sinkMs = deed.wreckSinkAt?.getTime() ?? null;
  if (open) {
    // Числа груза и название правят в деле — открытый корабль подхватывает их, чтобы команды видели свежие.
    if (open.stones !== deed.wreckStones || open.blocks !== deed.wreckBlocks || open.title !== deed.title || (open.sinkAt?.getTime() ?? null) !== sinkMs) { await prisma.wreck.update({ where: { id: open.id }, data: { stones: deed.wreckStones, blocks: deed.wreckBlocks, title: deed.title, sinkAt: deed.wreckSinkAt } }); publish(gameId, { type: "wrecks" }); publish(gameId, { type: "map" }); }
    return null;
  }
  // Срок затопления уже прошёл (05.11): корабль не поднимается заново при правке дела.
  if (sinkMs !== null && sinkMs <= Date.now()) return null;
  const n = await prisma.wreck.count({ where: { gameId } });
  const seed = fnv(`${gameId}:${deed.id}:${n}`);
  const site = await wreckSite(gameId, seed);
  if (!site) return null;
  const wreck = await prisma.wreck.create({ data: { gameId, deedId: deed.id, title: deed.title, q: site.q, r: site.r, model: seed % MODELS, seed: seed % 2_000_000_000, stones: deed.wreckStones, blocks: deed.wreckBlocks, sinkAt: deed.wreckSinkAt } });
  journal(gameId, "wreck_appeared", { everyone: true, vars: { deed: deed.title } });
  const teams = await prisma.team.findMany({ where: { gameId, status: "active" }, select: { id: true } });
  for (const t of teams) notifyTeam(gameId, t.id, "Разбитый бурей корабль просит помощи", (locale) => msg(locale, "У берега разбитый бурей корабль. Срочное задание «{deed}»: выполните его — капитан корабля и команда отблагодарят вас чем-то из груза. Корабль на карте, нажмите на него.", { deed: deed.title }));
  publish(gameId, { type: "wrecks" });
  publish(gameId, { type: "map" });
  return { id: wreck.id };
}

/**
 * Корабль тонет (решение владельца 04.11): дело удалено, флажок срочности снят или корабль отпущен. Открытые сдачи
 * и взятые, но не сданные задания закрываются как возвращённые с комментарием «Корабль затонул», командам — уведомление;
 * команды с одобренной сдачей уже видели, как он уплыл.
 */
export async function sinkWreck(gameId: string, where: { wreckId?: string; deedId?: string }): Promise<number> {
  const wrecks = await prisma.wreck.findMany({ where: { gameId, closedAt: null, ...(where.wreckId ? { id: where.wreckId } : {}), ...(where.deedId ? { deedId: where.deedId } : {}) }, select: { id: true, title: true } });
  if (!wrecks.length) return 0;
  const now = new Date();
  for (const w of wrecks) {
    const pending = await prisma.wreckWork.findMany({ where: { wreckId: w.id, status: { in: ["SUBMITTED", "TAKEN"] } }, select: { id: true, teamId: true, userId: true, status: true } });
    await prisma.$transaction([
      prisma.wreck.update({ where: { id: w.id }, data: { closedAt: now, sunk: true } }),
      ...(pending.length ? [prisma.wreckWork.updateMany({ where: { id: { in: pending.map((p) => p.id) } }, data: { status: "REJECTED", decidedAt: now, adminComment: "Корабль затонул" } })] : []),
    ]);
    journal(gameId, "wreck_sunk", { everyone: true, vars: { deed: w.title } });
    for (const p of pending) {
      // Взятое, но не сданное задание — не сдача: в летопись о возврате не пишем, команде только уведомление.
      if (p.status === "SUBMITTED") journal(gameId, "wreck_returned", { teamId: p.teamId, userId: p.userId, vars: { deed: w.title, comment: ": корабль затонул" } });
      notifyTeam(gameId, p.teamId, "Корабль затонул, не дождавшись помощи", (locale) => msg(locale, p.status === "SUBMITTED" ? "Разбитый корабль с срочным заданием «{deed}» затонул: сдача команды закрыта, груз пропал вместе с ним." : "Разбитый корабль с срочным заданием «{deed}» затонул: взятое задание закрыто, груз пропал вместе с ним.", { deed: w.title }));
      publish(gameId, { type: "submissions", teamId: p.teamId });
    }
  }
  publish(gameId, { type: "wrecks" });
  publish(gameId, { type: "map" });
  return wrecks.length;
}

/**
 * Срок затопления вышел (решение владельца 05.11: «поставить таймер заранее, когда корабль утонет»): корабль тонет сам,
 * как при снятом флажке. Зовётся из общего обхода раз в минуту.
 */
export async function sinkDueWrecks(gameId?: string, now = new Date()): Promise<void> {
  const due = await prisma.wreck.findMany({ where: { ...(gameId ? { gameId } : {}), closedAt: null, sinkAt: { lte: now } }, select: { id: true, gameId: true, deedId: true } });
  for (const w of due) {
    await sinkWreck(w.gameId, { wreckId: w.id });
    // Корабль утонул по сроку — дело удаляется само (решение владельца 06.11); строка корабля остаётся с названием для истории.
    if (w.deedId) {
      const deed = await prisma.deed.findUnique({ where: { id: w.deedId }, select: { wreck: true } });
      if (deed?.wreck) { await prisma.deed.delete({ where: { id: w.deedId } }); publish(w.gameId, { type: "deeds" }); }
    }
  }
}

/** Корабли на карте команды: открытые — всем; одобренный для этой команды и затонувший — ещё две минуты, на анимацию. */
export async function wrecksForTeam(gameId: string, teamId: string) {
  const since = new Date(Date.now() - WRECK_LINGER_MS);
  const [rows] = await Promise.all([
    prisma.wreck.findMany({ where: { gameId, OR: [{ closedAt: null }, { closedAt: { gte: since } }] }, orderBy: { createdAt: "asc" }, include: { deed: { select: { description: true, proofType: true, disabled: true } }, works: { where: { OR: [{ status: { in: ["TAKEN", "SUBMITTED", "REJECTED"] } }, { status: "APPROVED" }] }, orderBy: { submittedAt: "desc" }, select: { teamId: true, status: true, userId: true, takenAt: true, submittedAt: true, decidedAt: true, adminComment: true, cargo: true, amount: true } } } }),
  ]);
  const out = [];
  for (const w of rows) {
    const mineRows = w.works.filter((x) => x.teamId === teamId);
    const approved = mineRows.find((x) => x.status === "APPROVED");
    const mine = approved ?? mineRows[0] ?? null;
    // Одобрено: корабль у этой команды чинится и уходит; потом его нет, даже если другим он ещё виден.
    if (approved?.decidedAt && approved.decidedAt.getTime() < Date.now() - WRECK_LINGER_MS) continue;
    // Затонул: тем, кто его не спас, две минуты видно, как он уходит под воду.
    if (w.closedAt && !approved && (!w.sunk || w.closedAt.getTime() < Date.now() - WRECK_LINGER_MS)) continue;
    out.push({
      id: w.id, deedId: w.deedId, title: w.title, description: w.deed?.description ?? "", proofType: w.deed?.proofType ?? "PHOTO_LINK",
      model: w.model, q: w.q, r: w.r, seed: w.seed,
      cargo: { stones: w.stones, blocks: w.blocks },
      // Кто взял или сдал (решение владельца 05.11): по userId клиент пишет «Взял: имя», как у обычного дела.
      mine: mine ? { status: mine.status, userId: mine.userId, takenAt: mine.takenAt?.toISOString() ?? null, submittedAt: mine.submittedAt.toISOString(), adminComment: mine.adminComment, cargo: mine.cargo, amount: mine.amount, decidedAt: mine.decidedAt?.toISOString() ?? null } : null,
      doneTeams: new Set(w.works.filter((x) => x.status === "APPROVED").map((x) => x.teamId)).size,
      sunkAt: w.sunk && w.closedAt && !approved ? w.closedAt.toISOString() : null,
      // Срок затопления и появление (05.11): по ним у команды тикает таймер и растёт вода в силуэте корабля.
      sinkAt: w.sinkAt?.toISOString() ?? null, appearedAt: w.createdAt.toISOString(),
    });
  }
  return out;
}

/** Груз по жребию: 50/50, числа — из корабля (снимок дела) на момент решения. `random` подменяется в тестах. */
export function rollCargo(w: { stones: number; blocks: number }, random: () => number = Math.random): { cargo: "STONES" | "BLOCKS"; amount: number } {
  return random() < 0.5 ? { cargo: "STONES", amount: w.stones } : { cargo: "BLOCKS", amount: w.blocks };
}
