import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import bcrypt from "bcryptjs";
import { sign } from "@fastify/cookie";
import { buildApp } from "../app.js";
import { prisma } from "../db.js";
import { SESSION_COOKIE } from "../auth.js";
import { readyForStart } from "../testAuth.js";

/**
 * Нагрузочный прогон стенда (решение владельца 23.10: «давай замерим на стенде, потом сделаем выводы»).
 * Запускается внутри контейнера стенда (workflow `loadtest`):
 *   node apps/api/dist/scripts/loadtest.js seed   — тестовые учётки test_lt_*, их сессии и запущенная партия «Нагрузочный тест»;
 *   node apps/api/dist/scripts/loadtest.js clean  — всё это убирается.
 * Сессии создаются прямо в базе, а не входом по паролю: вход ограничен 20 попытками в минуту с адреса, а генератор
 * нагрузки работает с одного адреса. Файл сессий (LT_OUT) забирает workflow и удаляет; в журнал он не попадает.
 * Ники test_* и почта @example.com не считаются аналитикой платформы (TEST_USER_WHERE).
 */
const PREFIX = "test_lt_";
const ADMIN = `${PREFIX}admin`;
const GAME_NAME = "Нагрузочный тест";

async function clean(): Promise<void> {
  const admin = await prisma.user.findFirst({ where: { nickname: ADMIN }, select: { id: true } });
  if (admin) {
    const games = await prisma.game.findMany({ where: { createdById: admin.id }, select: { id: true } });
    for (const g of games) {
      // Стороны и общие дела ссылаются на дела без каскада в базе стенда: убираем их до удаления партии.
      await prisma.teamEdgeTask.deleteMany({ where: { gameId: g.id } });
      await prisma.quarryWork.deleteMany({ where: { gameId: g.id } });
      await prisma.game.delete({ where: { id: g.id } });
    }
    console.error(`games removed: ${games.length}`);
  }
  const u = await prisma.user.deleteMany({ where: { nickname: { startsWith: PREFIX } } });
  console.error(`users removed: ${u.count}`);
}

async function seed(): Promise<void> {
  const users = Math.max(2, Number(process.env.LT_USERS ?? 300));
  const teamCount = Math.min(12, Math.max(2, Number(process.env.LT_TEAMS ?? 6)));
  const out = process.env.LT_OUT ?? "/tmp/lt-sessions.txt";
  await clean();
  const passwordHash = await bcrypt.hash(randomBytes(18).toString("base64url"), 4); // паролем никто не входит
  const nick = (i: number) => `${PREFIX}${String(i).padStart(4, "0")}`;
  await prisma.user.createMany({ data: [ADMIN, ...Array.from({ length: users }, (_, i) => nick(i + 1))].map((n) => ({ nickname: n, email: `${n}@example.com`, passwordHash, emailVerified: true })) });
  const rows = await prisma.user.findMany({ where: { nickname: { startsWith: PREFIX } }, select: { id: true, nickname: true }, orderBy: { nickname: "asc" } });
  const byNick = new Map(rows.map((r) => [r.nickname, r.id]));
  const expiresAt = new Date(Date.now() + 2 * 24 * 3600 * 1000);
  const sessions = rows.map((r) => ({ id: randomBytes(32).toString("base64url"), userId: r.id, expiresAt }));
  await prisma.session.createMany({ data: sessions });
  const secret = process.env.SESSION_SECRET ?? "";
  const cookieOf = new Map(sessions.map((s) => [s.userId, `${SESSION_COOKIE}=${encodeURIComponent(sign(s.id, secret))}`]));
  const adminId = byNick.get(ADMIN)!;
  const adminCookie = cookieOf.get(adminId)!;

  const app = await buildApp();
  await app.ready();
  const post = async (url: string, payload: unknown = {}) => {
    const r = await app.inject({ method: "POST", url, headers: { cookie: adminCookie }, payload: payload as Record<string, unknown> });
    if (r.statusCode >= 300) throw new Error(`${url}: ${r.statusCode} ${r.body}`);
    return r.json();
  };
  const gameId = (await post("/api/games", { name: GAME_NAME, teamCount })).game.id as string;
  // Генерация карты случайна и иногда не находит места стартам (422): пробуем несколько зёрен.
  let generated = false;
  for (let seed = 1; seed <= 8 && !generated; seed++) {
    try { await post(`/api/games/${gameId}/generate`, { seed }); generated = true; } catch (e) { if (seed === 8) throw e; console.error(`generate: попытка ${seed} не удалась, пробую дальше`); }
  }
  const teamIds: string[] = [];
  for (let i = 0; i < teamCount; i++) teamIds.push((await post(`/api/games/${gameId}/teams`, { name: `Нагрузка ${i + 1}` })).team.id);
  const members = rows.filter((r) => r.nickname !== ADMIN);
  await prisma.membership.createMany({ data: members.map((m, i) => ({ teamId: teamIds[i % teamCount]!, userId: m.id, role: i < teamCount ? "CAPTAIN" : "MEMBER", gameRole: i < teamCount ? "NONE" : "SCOUT" })) });
  await post(`/api/games/${gameId}/deeds/import-default`);
  await readyForStart(app, gameId, adminCookie);
  await post(`/api/games/${gameId}/start`);
  const lines = [`game\t${gameId}`, `admin\t${ADMIN}\t${adminCookie}`, ...members.map((m, i) => `user\t${m.nickname}\t${i % teamCount}\t${cookieOf.get(m.id)!}`)];
  await writeFile(out, lines.join("\n") + "\n", { mode: 0o600 });
  console.error(`seeded: game ${gameId}, teams ${teamCount}, users ${members.length}, sessions -> ${out}`);
  await app.close();
}

const mode = process.argv[2];
(mode === "seed" ? seed() : mode === "clean" ? clean() : Promise.reject(new Error("usage: loadtest.js seed|clean")))
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
