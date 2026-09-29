import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BOOKS } from "@lotw/domain";
import { prisma } from "../db.js";
import { publish } from "../services/events.js";

/**
 * ВРЕМЕННЫЙ служебный модуль (инцидент 29.09, удалить после применения). Без общей проверки входа: доступ только по
 * токену, известному исполнителю; в коде хранится лишь его SHA-256.
 */
export async function opsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Одноразовый возврат шифров и ключей городов игры из напечатанных
   * ярлыков. Доступ — по токену, известному только исполнителю; в коде хранится лишь его SHA-256. Тело: игра (имя, ACTIVE)
   * и список «книга, шифр, ключ» для всех её городов; применяется целиком или никак; после успеха маршрут закрыт навсегда.
   */
  app.post("/api/ops/restore-codes", async (request, reply) => {
    const expected = process.env.RESTORE_TOKEN_SHA256 ?? "dfacefcff4eba530f4a01489a814b4b571951bd9da605c12c3d91c24a1f84d3a";
    const token = request.headers["x-restore-token"];
    const got = createHash("sha256").update(typeof token === "string" ? token : "").digest("hex");
    if (got.length !== expected.length || !timingSafeEqual(Buffer.from(got), Buffer.from(expected))) return reply.code(404).send({ error: "not_found" });
    if (await prisma.appSetting.findUnique({ where: { key: "ops.restoreCodes.done" } })) return reply.code(410).send({ error: "gone" });
    const body = z.object({ game: z.string().min(1), items: z.array(z.object({ book: z.string(), code: z.string(), key: z.string() })).min(1).max(66) }).parse(request.body);
    const games = await prisma.game.findMany({ where: { name: body.game, status: "ACTIVE" }, select: { id: true } });
    if (games.length !== 1) return reply.code(404).send({ error: "not_found", message: `игр с таким именем: ${games.length}` });
    const gameId = games[0]!.id;
    const nodes = await prisma.mapNode.findMany({ where: { gameId, kind: "CITY" }, select: { id: true, bookCode: true, cityCode: true } });
    const byBook = new Map(nodes.map((n) => [n.bookCode ?? "", n]));
    const bookByName = new Map<string, string>(); for (const b of BOOKS) { bookByName.set(b.code, b.code); bookByName.set(b.nameRu.toLowerCase(), b.code); }
    const problems: string[] = []; const updates: Array<{ id: string; key: string; code: string }> = []; const seen = new Set<string>();
    for (const it of body.items) {
      const node = byBook.get(bookByName.get(it.book.trim().toLowerCase()) ?? "");
      const key = it.key.trim().toUpperCase(), code = it.code.trim().toUpperCase();
      if (!node) { problems.push(`${it.book}: нет такого города`); continue; }
      if (seen.has(node.id)) { problems.push(`${it.book}: повтор`); continue; }
      if (!/^[A-Z2-9]{6}$/.test(key)) { problems.push(`${it.book}: ключ`); continue; }
      if (!/^[А-ЯЁ2-9]+$/.test(code) || (node.cityCode && code.length !== node.cityCode.length)) { problems.push(`${it.book}: длина шифра ${code.length} вместо ${node.cityCode?.length}`); continue; }
      seen.add(node.id); updates.push({ id: node.id, key, code });
    }
    if (problems.length || updates.length !== nodes.length) return reply.code(400).send({ error: "bad_request", message: `городов ${nodes.length}, годных строк ${updates.length}; ${problems.join("; ")}` });
    await prisma.$transaction([
      ...updates.map((u) => prisma.mapNode.update({ where: { id: u.id }, data: { cityKey: u.key, cityCode: u.code } })),
      prisma.appSetting.create({ data: { key: "ops.restoreCodes.done", value: new Date().toISOString() } }),
    ]);
    publish(gameId, { type: "cities" });
    return { ok: true, updated: updates.length };
  });

}
