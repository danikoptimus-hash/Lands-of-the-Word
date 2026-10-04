import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { assertAwake } from "../services/daytime.js";
import { publish } from "../services/events.js";
import { requireUser } from "../auth.js";
import { requireActiveMember, requireMember } from "./teamMap.js";
import { transferCity } from "../services/siege.js";
import { bookWords } from "../services/bookWords.js";
import { notifyTeam } from "../services/notify.js";
import { err, msg } from "../services/i18n.js";
import { journal } from "../services/journal.js";
import { BOOKS } from "@lotw/domain";

/**
 * Обмен городами между послами (решение владельца 04.10). Только посол: выставляет свой город другой команде
 * (у города показано число слов в его книге), посол другой команды предлагает взамен свой город; первый либо меняется,
 * либо отклоняет встречный город и ждёт другого предложения; если переговоры зашли в тупик, любая сторона отменяет
 * сделку. Столицу и захваченную чужую столицу обменять нельзя; город в осаде или под вызовом — тоже.
 */
const BOOK_NAME = new Map(BOOKS.map((b) => [b.code, b.nameRu]));
const teamSelect = { select: { id: true, name: true, color: true } } as const;
const ACTIVE = ["OPEN", "COUNTERED"] as const;

interface CityRef { nodeKey: string; bookCode: string; bookName: string; words: number }

async function cityRef(gameId: string, nodeKey: string): Promise<CityRef> {
  const node = await prisma.mapNode.findUnique({ where: { gameId_key: { gameId, key: nodeKey } }, select: { bookCode: true } });
  const code = node?.bookCode ?? "";
  return { nodeKey, bookCode: code, bookName: BOOK_NAME.get(code) ?? "?", words: await bookWords(code) };
}

/** Города команды, которые можно обменять: взятые, не столица и не захваченная чужая столица, без идущей осады или вызова. */
async function tradable(gameId: string, teamId: string, nodeKey: string): Promise<string | null> {
  const st = await prisma.teamCityState.findUnique({ where: { teamId_nodeKey: { teamId, nodeKey } } });
  if (!st?.capturedAt) return "Этот город не принадлежит команде";
  if (st.isCapital || st.secondCapital) return "Столицу обменять нельзя";
  const node = await prisma.mapNode.findUnique({ where: { gameId_key: { gameId, key: nodeKey } }, select: { ruined: true } });
  if (!node) return "Город не найден";
  if (node.ruined) return "Руины обменять нельзя";
  const busy = await prisma.battle.count({ where: { gameId, nodeKey, status: { in: ["QUEUED", "ATTACK", "DEFENSE"] } } });
  const siege = await prisma.siege.count({ where: { gameId, nodeKey, status: "ACTIVE" } });
  if (busy || siege) return "Город под вызовом или в осаде: обмен после испытания";
  return null;
}

async function tradeView(gameId: string, teamId: string, t: { id: string; fromId: string; toId: string; offerKey: string; counterKey: string | null; declinedKeys: string[]; message: string; status: string; createdAt: Date; updatedAt: Date; closedAt: Date | null; closedById: string | null; from: { id: string; name: string; color: string }; to: { id: string; name: string; color: string } }) {
  return {
    id: t.id, status: t.status, from: t.from, to: t.to, mine: t.fromId === teamId, message: t.message,
    offer: await cityRef(gameId, t.offerKey), counter: t.counterKey ? await cityRef(gameId, t.counterKey) : null,
    declined: await Promise.all(t.declinedKeys.map((k) => cityRef(gameId, k))),
    createdAt: t.createdAt, updatedAt: t.updatedAt, closedAt: t.closedAt, closedByMe: t.closedById === teamId,
  };
}

export async function tradeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireUser);

  /** Посол, который ведёт обмен: только игровая роль «посол» (решение владельца 04.10: это только для послов). */
  async function requireAmbassador(request: FastifyRequest, reply: FastifyReply, gameId: string) {
    const m = await requireActiveMember(request, reply, gameId);
    if (!m) return null;
    if (!(await assertAwake(request, reply, gameId))) return null;
    if (m.gameRole !== "AMBASSADOR") { await reply.code(403).send({ error: "forbidden", message: err(request, "Обмен городами ведёт посол команды") }); return null; }
    return m;
  }
  async function loadTrade(request: FastifyRequest, reply: FastifyReply, gameId: string, tradeId: string) {
    const t = await prisma.cityTrade.findFirst({ where: { id: tradeId, gameId }, include: { from: teamSelect, to: teamSelect } });
    if (!t) { await reply.code(404).send({ error: "not_found", message: err(request, "Сделка не найдена") }); return null; }
    return t;
  }

  /** Обмены моей команды: идущие и последние закрытые, мои города для обмена, другие команды. */
  app.get("/api/games/:id/my-trades", async (request, reply) => {
    const { id } = request.params as { id: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    const rows = await prisma.cityTrade.findMany({ where: { gameId: id, OR: [{ fromId: m.team.id }, { toId: m.team.id }] }, orderBy: { updatedAt: "desc" }, include: { from: teamSelect, to: teamSelect }, take: 30 });
    const active = rows.filter((r) => r.status === "OPEN" || r.status === "COUNTERED"), closed = rows.filter((r) => r.status === "DONE" || r.status === "CANCELLED").slice(0, 10);
    const owned = await prisma.teamCityState.findMany({ where: { teamId: m.team.id, capturedAt: { not: null } }, select: { nodeKey: true, isCapital: true, secondCapital: true } });
    const myCities = [];
    for (const c of owned) myCities.push({ ...(await cityRef(id, c.nodeKey)), capital: c.isCapital || c.secondCapital, reason: await tradable(id, m.team.id, c.nodeKey) });
    const teams = await prisma.team.findMany({ where: { gameId: id, NOT: { id: m.team.id }, status: { not: "defeated" } }, select: { id: true, name: true, color: true }, orderBy: { index: "asc" } });
    return { canTrade: m.gameRole === "AMBASSADOR", teams, myCities, trades: await Promise.all([...active, ...closed].map((t) => tradeView(id, m.team.id, t))) };
  });

  /** Посол выставляет свой город другой команде. */
  app.post("/api/games/:id/trades", async (request, reply) => {
    const { id } = request.params as { id: string };
    const m = await requireAmbassador(request, reply, id);
    if (!m) return;
    const body = z.object({ toTeamId: z.string().min(1), offerKey: z.string().min(1), message: z.string().trim().max(500).default("") }).parse(request.body ?? {});
    const other = await prisma.team.findFirst({ where: { id: body.toTeamId, gameId: id, NOT: { id: m.team.id } }, select: { id: true, name: true, status: true } });
    if (!other || other.status === "defeated") return reply.code(404).send({ error: "not_found", message: err(request, "Команда не найдена") });
    const why = await tradable(id, m.team.id, body.offerKey);
    if (why) return reply.code(409).send({ error: "conflict", message: err(request, why) });
    const dup = await prisma.cityTrade.findFirst({ where: { gameId: id, status: { in: [...ACTIVE] }, OR: [{ fromId: m.team.id, toId: other.id }, { fromId: other.id, toId: m.team.id }] } });
    if (dup) return reply.code(409).send({ error: "conflict", message: err(request, "С этой командой уже идёт сделка: закончите или отмените её") });
    const t = await prisma.cityTrade.create({ data: { gameId: id, fromId: m.team.id, toId: other.id, offerKey: body.offerKey, message: body.message }, include: { from: teamSelect, to: teamSelect } });
    const offer = await cityRef(id, body.offerKey);
    journal(id, "trade_proposed", { teamId: m.team.id, vars: { team: m.team.name, other: other.name, book: offer.bookCode } });
    journal(id, "trade_proposed", { teamId: other.id, vars: { team: m.team.name, other: other.name, book: offer.bookCode } });
    notifyTeam(id, other.id, "предложение обмена городами", (locale) => msg(locale, "Посол команды «{team}» предлагает обмен: отдаёт город {book} ({words} слов в книге) и ждёт, какой город вы предложите взамен.{message}", { team: m.team.name, book: offer.bookName, words: offer.words, message: body.message ? msg(locale, " Сообщение: «{m}»", { m: body.message }) : "" }));
    publish(id, { type: "trades", teamId: other.id });
    publish(id, { type: "trades", teamId: m.team.id });
    return reply.code(201).send({ trade: await tradeView(id, m.team.id, t) });
  });

  /** Посол второй команды предлагает взамен свой город. */
  app.post("/api/games/:id/trades/:tradeId/counter", async (request, reply) => {
    const { id, tradeId } = request.params as { id: string; tradeId: string };
    const m = await requireAmbassador(request, reply, id);
    if (!m) return;
    const t = await loadTrade(request, reply, id, tradeId);
    if (!t) return;
    if (t.toId !== m.team.id) return reply.code(403).send({ error: "forbidden", message: err(request, "Встречный город предлагает посол второй команды") });
    if (t.status !== "OPEN") return reply.code(409).send({ error: "conflict", message: err(request, t.status === "COUNTERED" ? "Ваше предложение уже ждёт ответа" : "Сделка закрыта") });
    const body = z.object({ nodeKey: z.string().min(1) }).parse(request.body ?? {});
    const why = await tradable(id, m.team.id, body.nodeKey);
    if (why) return reply.code(409).send({ error: "conflict", message: err(request, why) });
    if (t.declinedKeys.includes(body.nodeKey)) return reply.code(409).send({ error: "conflict", message: err(request, "Этот город уже отклонён: предложите другой") });
    await prisma.cityTrade.update({ where: { id: t.id }, data: { counterKey: body.nodeKey, status: "COUNTERED", updatedAt: new Date() } });
    const counter = await cityRef(id, body.nodeKey);
    journal(id, "trade_countered", { teamId: t.fromId, vars: { team: t.from.name, other: m.team.name, book: counter.bookCode } });
    journal(id, "trade_countered", { teamId: m.team.id, vars: { team: t.from.name, other: m.team.name, book: counter.bookCode } });
    notifyTeam(id, t.fromId, "встречное предложение обмена", "Команда «{team}» предлагает взамен город {book} ({words} слов в книге). Посол может обменяться или отклонить.", { team: m.team.name, book: counter.bookName, words: counter.words });
    publish(id, { type: "trades", teamId: t.fromId });
    publish(id, { type: "trades", teamId: m.team.id });
    return { ok: true };
  });

  /** Посол первой команды меняется: города переходят друг другу. */
  app.post("/api/games/:id/trades/:tradeId/accept", async (request, reply) => {
    const { id, tradeId } = request.params as { id: string; tradeId: string };
    const m = await requireAmbassador(request, reply, id);
    if (!m) return;
    const t = await loadTrade(request, reply, id, tradeId);
    if (!t) return;
    if (t.fromId !== m.team.id) return reply.code(403).send({ error: "forbidden", message: err(request, "Обмен подтверждает посол, который выставил город") });
    if (t.status !== "COUNTERED" || !t.counterKey) return reply.code(409).send({ error: "conflict", message: err(request, "Встречного города ещё нет") });
    const whyMine = await tradable(id, t.fromId, t.offerKey), whyTheirs = await tradable(id, t.toId, t.counterKey);
    if (whyMine || whyTheirs) {
      await prisma.cityTrade.update({ where: { id: t.id }, data: { status: "CANCELLED", closedAt: new Date(), updatedAt: new Date() } });
      publish(id, { type: "trades" });
      return reply.code(409).send({ error: "conflict", message: err(request, "Сделка отменена: {why}", { why: err(request, whyMine ?? whyTheirs ?? "") }) });
    }
    const offer = await cityRef(id, t.offerKey), counter = await cityRef(id, t.counterKey);
    await transferCity(id, t.offerKey, t.fromId, t.toId, 0);
    await transferCity(id, t.counterKey, t.toId, t.fromId, 0);
    await prisma.cityTrade.update({ where: { id: t.id }, data: { status: "DONE", closedAt: new Date(), closedById: m.team.id, updatedAt: new Date() } });
    journal(id, "trade_done", { everyone: true, teamId: t.fromId, vars: { team: t.from.name, other: t.to.name, book: offer.bookCode, book2: counter.bookCode } });
    notifyTeam(id, t.toId, "обмен городами состоялся", "Команда «{team}» приняла обмен: город {book} теперь ваш, город {book2} перешёл к ним.", { team: t.from.name, book: offer.bookName, book2: counter.bookName });
    notifyTeam(id, t.fromId, "обмен городами состоялся", "Город {book2} теперь ваш, город {book} перешёл команде «{team}».", { team: t.to.name, book: offer.bookName, book2: counter.bookName });
    publish(id, { type: "trades" });
    publish(id, { type: "map" });
    publish(id, { type: "cities" });
    return { ok: true };
  });

  /** Посол первой команды отклоняет встречный город: ждём другого предложения. */
  app.post("/api/games/:id/trades/:tradeId/decline", async (request, reply) => {
    const { id, tradeId } = request.params as { id: string; tradeId: string };
    const m = await requireAmbassador(request, reply, id);
    if (!m) return;
    const t = await loadTrade(request, reply, id, tradeId);
    if (!t) return;
    if (t.fromId !== m.team.id) return reply.code(403).send({ error: "forbidden", message: err(request, "Встречный город отклоняет посол, который выставил город") });
    if (t.status !== "COUNTERED" || !t.counterKey) return reply.code(409).send({ error: "conflict", message: err(request, "Встречного города ещё нет") });
    await prisma.cityTrade.update({ where: { id: t.id }, data: { status: "OPEN", counterKey: null, declinedKeys: { push: t.counterKey }, updatedAt: new Date() } });
    const counter = await cityRef(id, t.counterKey);
    notifyTeam(id, t.toId, "встречный город не подошёл", "Команда «{team}» не приняла город {book} в обмен. Посол может предложить другой город или отменить сделку.", { team: m.team.name, book: counter.bookName });
    publish(id, { type: "trades", teamId: t.toId });
    publish(id, { type: "trades", teamId: m.team.id });
    return { ok: true };
  });

  /** Любая сторона отменяет сделку: переговоры зашли в тупик. */
  app.post("/api/games/:id/trades/:tradeId/cancel", async (request, reply) => {
    const { id, tradeId } = request.params as { id: string; tradeId: string };
    const m = await requireAmbassador(request, reply, id);
    if (!m) return;
    const t = await loadTrade(request, reply, id, tradeId);
    if (!t) return;
    if (t.fromId !== m.team.id && t.toId !== m.team.id) return reply.code(403).send({ error: "forbidden", message: err(request, "Это сделка других команд") });
    if (t.status !== "OPEN" && t.status !== "COUNTERED") return reply.code(409).send({ error: "conflict", message: err(request, "Сделка уже закрыта") });
    await prisma.cityTrade.update({ where: { id: t.id }, data: { status: "CANCELLED", closedAt: new Date(), closedById: m.team.id, updatedAt: new Date() } });
    const otherId = t.fromId === m.team.id ? t.toId : t.fromId;
    journal(id, "trade_cancelled", { teamId: t.fromId, vars: { team: t.from.name, other: t.to.name } });
    journal(id, "trade_cancelled", { teamId: t.toId, vars: { team: t.from.name, other: t.to.name } });
    notifyTeam(id, otherId, "обмен городами отменён", "Команда «{team}» отменила сделку об обмене городами.", { team: m.team.name });
    publish(id, { type: "trades", teamId: otherId });
    publish(id, { type: "trades", teamId: m.team.id });
    return { ok: true };
  });
}
