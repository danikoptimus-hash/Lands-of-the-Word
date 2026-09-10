import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { publish } from "../services/events.js";
import { requireUser } from "../auth.js";
import { requireAdmin, requireMember } from "./teamMap.js";
import { closePassage, ensureFrontier, revealNode } from "../services/teamMap.js";
import { notifyTeam } from "../services/notify.js";
import { loadBook, verseText, formatRange, parseDistrictRange } from "../services/bible.js";
import { loadCityContent } from "../services/cities.js";
import { BOOKS } from "@lotw/domain";

const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));
const PASSAGE_TTL_MS = 3 * 86_400_000;
const WEEK_MS = 7 * 86_400_000;
const teamSelect = { select: { id: true, name: true, color: true } } as const;

/** Кто говорит от команды с другими командами: посол, если назначен, иначе капитан. */
async function canSpeak(teamId: string, userId: string): Promise<{ ok: boolean; why: string }> {
  const members = await prisma.membership.findMany({ where: { teamId }, select: { userId: true, role: true, gameRole: true } });
  const ambassador = members.find((m) => m.gameRole === "AMBASSADOR");
  const me = members.find((m) => m.userId === userId);
  if (!me) return { ok: false, why: "Вы не в команде" };
  if (ambassador) return ambassador.userId === userId ? { ok: true, why: "" } : { ok: false, why: "С другими командами говорит посол команды" };
  return me.role === "CAPTAIN" ? { ok: true, why: "" } : { ok: false, why: "Запросы другим командам отправляет капитан (или посол, если назначен)" };
}

const view = (r: { id: string; nodeKey: string; message: string; answer: string; status: string; createdAt: Date; expiresAt: Date; decidedAt: Date | null; requester: { id: string; name: string; color: string }; owner: { id: string; name: string; color: string } }, bookOf: Map<string, string>) =>
  ({ ...r, bookName: BOOK_BY_CODE.get(bookOf.get(r.nodeKey) ?? "")?.nameRu ?? "?" });

/** Просроченные запросы (3 дня без ответа) — отказ. */
export async function expirePassages(gameId?: string): Promise<void> {
  const rows = await prisma.passageRequest.findMany({ where: { ...(gameId ? { gameId } : {}), status: "PENDING", expiresAt: { lt: new Date() } } });
  for (const r of rows) {
    await prisma.passageRequest.update({ where: { id: r.id }, data: { status: "EXPIRED", decidedAt: new Date() } });
    publish(r.gameId, { type: "map", teamId: r.requesterId });
    notifyTeam(r.gameId, r.requesterId, "проход не разрешён", "Владелец города три дня не отвечал на запрос прохода: по правилам это отказ. Можно запросить снова.");
  }
}

/**
 * Дипломатия (2.14 А): запрос прохода через чужой город, ответ владельца, отзыв; роли (2.15): разведчик, пророк;
 * перенос столицы (2.9).
 */
export async function diplomacyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireUser);

  async function bookOf(gameId: string, keys: string[]) {
    const nodes = await prisma.mapNode.findMany({ where: { gameId, key: { in: keys } }, select: { key: true, bookCode: true } });
    return new Map(nodes.map((n) => [n.key, n.bookCode ?? ""]));
  }

  /** Запросы прохода моей команды: исходящие и входящие. */
  app.get("/api/games/:id/my-passages", async (request, reply) => {
    const { id } = request.params as { id: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    await expirePassages(id);
    const rows = await prisma.passageRequest.findMany({ where: { gameId: id, OR: [{ requesterId: m.team.id }, { ownerId: m.team.id }] }, orderBy: { createdAt: "desc" }, include: { requester: teamSelect, owner: teamSelect }, take: 50 });
    const books = await bookOf(id, rows.map((r) => r.nodeKey));
    const speak = await canSpeak(m.team.id, request.user!.id);
    return { canSpeak: speak.ok, outgoing: rows.filter((r) => r.requesterId === m.team.id).map((r) => view(r, books)), incoming: rows.filter((r) => r.ownerId === m.team.id).map((r) => view(r, books)) };
  });

  /** Запросить проход через чужой город. */
  app.post("/api/games/:id/my-city/:nodeKey/passage", async (request, reply) => {
    const { id, nodeKey } = request.params as { id: string; nodeKey: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    const speak = await canSpeak(m.team.id, request.user!.id);
    if (!speak.ok) return reply.code(403).send({ error: "forbidden", message: speak.why });
    const reached = await prisma.teamNodeState.findUnique({ where: { teamId_nodeKey: { teamId: m.team.id, nodeKey } } });
    if (!reached) return reply.code(403).send({ error: "forbidden", message: "Ваша команда ещё не дошла до этого города" });
    const owner = await prisma.teamCityState.findFirst({ where: { gameId: id, nodeKey, capturedAt: { not: null } } });
    if (!owner || owner.teamId === m.team.id) return reply.code(409).send({ error: "conflict", message: "Город не занят другой командой: проход свободен" });
    const existing = await prisma.passageRequest.findFirst({ where: { gameId: id, nodeKey, requesterId: m.team.id, status: { in: ["PENDING", "APPROVED"] } } });
    if (existing) return reply.code(409).send({ error: "conflict", message: existing.status === "APPROVED" ? "Проход уже разрешён" : "Запрос уже отправлен, ждём ответа (3 дня)" });
    const body = z.object({ message: z.string().trim().max(500).default("") }).parse(request.body ?? {});
    const r = await prisma.passageRequest.create({ data: { gameId: id, nodeKey, requesterId: m.team.id, ownerId: owner.teamId, message: body.message, expiresAt: new Date(Date.now() + PASSAGE_TTL_MS) } });
    publish(id, { type: "map", teamId: owner.teamId });
    publish(id, { type: "map", teamId: m.team.id });
    const books = await bookOf(id, [nodeKey]);
    notifyTeam(id, owner.teamId, `запрос прохода через ${BOOK_BY_CODE.get(books.get(nodeKey) ?? "")?.nameRu ?? "ваш город"}`, `Команда «${m.team.name}» просит разрешить проход через ваш город.${body.message ? ` Сообщение: ${body.message}` : ""} На ответ три дня; молчание — отказ.`);
    return reply.code(201).send({ id: r.id, expiresAt: r.expiresAt });
  });

  /** Ответ владельца: разрешить или отказать. */
  app.post("/api/games/:id/passages/:reqId/decide", async (request, reply) => {
    const { id, reqId } = request.params as { id: string; reqId: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    const r = await prisma.passageRequest.findFirst({ where: { id: reqId, gameId: id, ownerId: m.team.id } });
    if (!r) return reply.code(404).send({ error: "not_found", message: "Запрос не найден" });
    const speak = await canSpeak(m.team.id, request.user!.id);
    if (!speak.ok) return reply.code(403).send({ error: "forbidden", message: speak.why });
    if (r.status !== "PENDING") return reply.code(409).send({ error: "conflict", message: "Запрос уже рассмотрен" });
    const body = z.object({ approve: z.boolean(), answer: z.string().trim().max(500).default("") }).parse(request.body);
    await prisma.passageRequest.update({ where: { id: r.id }, data: { status: body.approve ? "APPROVED" : "DECLINED", answer: body.answer, decidedAt: new Date() } });
    if (body.approve) await ensureFrontier(id, r.requesterId);
    publish(id, { type: "map", teamId: r.requesterId });
    publish(id, { type: "map", teamId: m.team.id });
    notifyTeam(id, r.requesterId, body.approve ? "проход разрешён" : "в проходе отказано", `Команда «${m.team.name}» ${body.approve ? "разрешила" : "не разрешила"} проход через свой город.${body.answer ? ` Ответ: ${body.answer}` : ""}`);
    return { ok: true };
  });

  /** Владелец закрывает ранее выданный проход. Команду назад не откатывает: убираются только незанятые дела из города. */
  app.post("/api/games/:id/passages/:reqId/revoke", async (request, reply) => {
    const { id, reqId } = request.params as { id: string; reqId: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    const r = await prisma.passageRequest.findFirst({ where: { id: reqId, gameId: id, ownerId: m.team.id, status: "APPROVED" } });
    if (!r) return reply.code(404).send({ error: "not_found", message: "Действующее разрешение не найдено" });
    const speak = await canSpeak(m.team.id, request.user!.id);
    if (!speak.ok) return reply.code(403).send({ error: "forbidden", message: speak.why });
    await prisma.passageRequest.update({ where: { id: r.id }, data: { status: "REVOKED", decidedAt: new Date() } });
    await closePassage(id, r.requesterId, r.nodeKey);
    publish(id, { type: "map", teamId: r.requesterId });
    publish(id, { type: "tasks", teamId: r.requesterId });
    notifyTeam(id, r.requesterId, "проход закрыт", `Команда «${m.team.name}» закрыла проход через свой город. Уже взятые дела остаются.`);
    return { ok: true };
  });

  /** Админ: все запросы прохода в игре. */
  app.get("/api/games/:id/passages", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireAdmin(request, reply, id))) return;
    const rows = await prisma.passageRequest.findMany({ where: { gameId: id }, orderBy: { createdAt: "desc" }, include: { requester: teamSelect, owner: teamSelect }, take: 100 });
    const books = await bookOf(id, rows.map((r) => r.nodeKey));
    return { passages: rows.map((r) => view(r, books)) };
  });

  /** Разведчик: раз в неделю заглянуть за одно ребро фронтира — город там или развилка. */
  app.post("/api/games/:id/my-map/peek", async (request, reply) => {
    const { id } = request.params as { id: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    if (m.gameRole !== "SCOUT") return reply.code(403).send({ error: "forbidden", message: "Заглянуть за ребро может только разведчик команды" });
    const body = z.object({ nodeKey: z.string().min(3).max(40) }).parse(request.body);
    const frontier = await prisma.teamEdgeTask.findFirst({ where: { teamId: m.team.id, toKey: body.nodeKey, status: { not: "APPROVED" } } });
    if (!frontier) return reply.code(400).send({ error: "validation", message: "Разведать можно только узел за стороной с меткой дела" });
    if (m.team.lastPeekAt && Date.now() - m.team.lastPeekAt.getTime() < WEEK_MS) {
      const next = new Date(m.team.lastPeekAt.getTime() + WEEK_MS);
      return reply.code(429).send({ error: "cooldown", message: `Разведка раз в неделю: следующая ${next.toLocaleDateString("ru-RU")}` });
    }
    const node = await prisma.mapNode.findUniqueOrThrow({ where: { gameId_key: { gameId: id, key: body.nodeKey } } });
    await prisma.$transaction([
      prisma.teamPeek.upsert({ where: { teamId_nodeKey: { teamId: m.team.id, nodeKey: body.nodeKey } }, create: { teamId: m.team.id, nodeKey: body.nodeKey }, update: {} }),
      prisma.team.update({ where: { id: m.team.id }, data: { lastPeekAt: new Date() } }),
    ]);
    publish(id, { type: "map", teamId: m.team.id });
    return { kind: node.kind };
  });

  /** Пророк: раз в неделю открыть подсказку к заданию города — текст стихов района. */
  app.post("/api/games/:id/my-city/:nodeKey/hint", async (request, reply) => {
    const { id, nodeKey } = request.params as { id: string; nodeKey: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    if (m.gameRole !== "PROPHET") return reply.code(403).send({ error: "forbidden", message: "Подсказку открывает только пророк команды" });
    const body = z.object({ index: z.number().int().min(0) }).parse(request.body);
    const state = await prisma.teamCityState.findUnique({ where: { teamId_nodeKey: { teamId: m.team.id, nodeKey } } });
    if (!state?.orderSolved) return reply.code(409).send({ error: "conflict", message: "Сначала расставьте районы по порядку" });
    if (state.hintTasks.includes(body.index)) return reply.code(409).send({ error: "conflict", message: "Подсказка к этому заданию уже открыта" });
    if (m.team.lastHintAt && Date.now() - m.team.lastHintAt.getTime() < WEEK_MS) {
      const next = new Date(m.team.lastHintAt.getTime() + WEEK_MS);
      return reply.code(429).send({ error: "cooldown", message: `Подсказка раз в неделю: следующая ${next.toLocaleDateString("ru-RU")}` });
    }
    await prisma.$transaction([
      prisma.teamCityState.update({ where: { id: state.id }, data: { hintTasks: { push: body.index } } }),
      prisma.team.update({ where: { id: m.team.id }, data: { lastHintAt: new Date() } }),
    ]);
    publish(id, { type: "cities", teamId: m.team.id });
    return { ok: true };
  });

  /** Капитан переносит столицу на другой свой город: один раз за игру, даже во время войны. Вторую столицу переносить нельзя. */
  app.post("/api/games/:id/my-city/:nodeKey/make-capital", async (request, reply) => {
    const { id, nodeKey } = request.params as { id: string; nodeKey: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    if (m.role !== "CAPTAIN") return reply.code(403).send({ error: "forbidden", message: "Столицу переносит капитан" });
    if (m.team.capitalMovedAt) return reply.code(409).send({ error: "conflict", message: "Перенос столицы уже использован: он один за игру" });
    const target = await prisma.teamCityState.findUnique({ where: { teamId_nodeKey: { teamId: m.team.id, nodeKey } } });
    if (!target?.capturedAt) return reply.code(409).send({ error: "conflict", message: "Это не ваш город" });
    if (target.isCapital) return reply.code(409).send({ error: "conflict", message: "Это уже столица" });
    const capital = await prisma.teamCityState.findFirst({ where: { teamId: m.team.id, isCapital: true, secondCapital: false } });
    if (!capital) return reply.code(409).send({ error: "conflict", message: "Первой столицы нет: переносить нечего" });
    await prisma.$transaction([
      prisma.teamCityState.update({ where: { id: capital.id }, data: { isCapital: false } }),
      prisma.teamCityState.update({ where: { id: target.id }, data: { isCapital: true } }),
      prisma.team.update({ where: { id: m.team.id }, data: { capitalMovedAt: new Date() } }),
    ]);
    publish(id, { type: "cities", teamId: m.team.id });
    publish(id, { type: "map" });
    return { ok: true };
  });

  /** Текст района для подсказки пророка. */
  app.get("/api/games/:id/my-city/:nodeKey/hint/:index", async (request, reply) => {
    const { id, nodeKey, index } = request.params as { id: string; nodeKey: string; index: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    const i = Number(index);
    const state = await prisma.teamCityState.findUnique({ where: { teamId_nodeKey: { teamId: m.team.id, nodeKey } } });
    if (!state?.hintTasks.includes(i)) return reply.code(403).send({ error: "forbidden", message: "Подсказка не открыта" });
    const node = await prisma.mapNode.findUniqueOrThrow({ where: { gameId_key: { gameId: id, key: nodeKey } } });
    const [content, book] = await Promise.all([loadCityContent(node.bookCode ?? ""), loadBook(node.bookCode ?? "")]);
    const d = content?.districts[i];
    if (!d || !book) return reply.code(404).send({ error: "not_found", message: "Район не найден" });
    // Подсказка — текст района. Длинные районы (главы) обрезаются: пророк даёт направление, а не всю книгу.
    const range = parseDistrictRange(book, d.verses);
    if (!range) return { verses: d.verses, text: [] };
    const HINT_MAX = 60;
    const a = range.start, b = Math.min(range.end, range.start + HINT_MAX - 1);
    const text = Array.from({ length: b - a + 1 }, (_, k) => `${formatRange(book, a + k, a + k)} ${verseText(book, a + k) ?? ""}`);
    if (b < range.end) text.push(`… (дальше до ${formatRange(book, range.end, range.end)} — читайте сами)`);
    return { verses: d.verses, text };
  });

  void revealNode;
}
