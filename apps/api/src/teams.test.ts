import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";

const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now();
const adminNick = `adm_${stamp}`, playerNick = `pl_${stamp}`, otherNick = `ot_${stamp}`;
let adminCookie = "", playerCookie = "", otherCookie = "", gameId = "", teamId = "", token = "";

async function register(nickname: string) {
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nickname, password: "secret123" } });
  return res.headers["set-cookie"] as string;
}

beforeAll(async () => {
  await app.ready();
  adminCookie = await register(adminNick);
  playerCookie = await register(playerNick);
  otherCookie = await register(otherNick);
  const g = await app.inject({ method: "POST", url: "/api/games", headers: { cookie: adminCookie }, payload: { name: "Командная", teamCount: 2 } });
  gameId = g.json().game.id;
});

afterAll(async () => {
  await prisma.game.deleteMany({ where: { id: gameId } });
  await prisma.user.deleteMany({ where: { nickname: { in: [adminNick, playerNick, otherNick] } } });
  await app.close();
  await prisma.$disconnect();
});

describe("команды и приглашения", () => {
  it("админ создаёт команду; не больше teamCount; имена уникальны", async () => {
    const t1 = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams`, headers: { cookie: adminCookie }, payload: { name: "Иерусалим" } });
    expect(t1.statusCode).toBe(201);
    teamId = t1.json().team.id;
    expect(t1.json().team.index).toBe(0);
    const dup = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams`, headers: { cookie: adminCookie }, payload: { name: "иерусалим" } });
    expect(dup.statusCode).toBe(409);
    const t2 = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams`, headers: { cookie: adminCookie }, payload: { name: "Вифлеем" } });
    expect(t2.statusCode).toBe(201);
    const t3 = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams`, headers: { cookie: adminCookie }, payload: { name: "Третья" } });
    expect(t3.statusCode).toBe(409);
  });

  it("не админ не может создавать команды", async () => {
    const res = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams`, headers: { cookie: playerCookie }, payload: { name: "Чужая" } });
    expect(res.statusCode).toBe(403);
  });

  it("приглашение: создать, посмотреть, принять; повторно — 409", async () => {
    const inv = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams/${teamId}/invites`, headers: { cookie: adminCookie }, payload: { role: "CAPTAIN", uses: 2 } });
    expect(inv.statusCode).toBe(201);
    token = inv.json().invite.token;
    const info = await app.inject({ method: "GET", url: `/api/invites/${token}`, headers: { cookie: playerCookie } });
    expect(info.statusCode).toBe(200);
    expect(info.json().invite.team.name).toBe("Иерусалим");
    const acc = await app.inject({ method: "POST", url: `/api/invites/${token}/accept`, headers: { cookie: playerCookie } });
    expect(acc.statusCode).toBe(201);
    expect(acc.json().role).toBe("CAPTAIN");
    const again = await app.inject({ method: "POST", url: `/api/invites/${token}/accept`, headers: { cookie: playerCookie } });
    expect(again.statusCode).toBe(409);
    const bad = await app.inject({ method: "GET", url: `/api/invites/nope`, headers: { cookie: playerCookie } });
    expect(bad.statusCode).toBe(404);
  });

  it("участник видит только свою команду, админ — все", async () => {
    const mine = await app.inject({ method: "GET", url: `/api/games/${gameId}/teams`, headers: { cookie: playerCookie } });
    expect(mine.json().isAdmin).toBe(false);
    expect(mine.json().teams).toHaveLength(1);
    const all = await app.inject({ method: "GET", url: `/api/games/${gameId}/teams`, headers: { cookie: adminCookie } });
    expect(all.json().teams).toHaveLength(2);
    const none = await app.inject({ method: "GET", url: `/api/games/${gameId}/teams`, headers: { cookie: otherCookie } });
    expect(none.statusCode).toBe(403);
  });

  it("капитан раздаёт игровые роли, одна роль — один человек", async () => {
    await app.inject({ method: "POST", url: `/api/invites/${token}/accept`, headers: { cookie: otherCookie } });
    const other = await prisma.user.findUniqueOrThrow({ where: { nickname: otherNick } });
    const player = await prisma.user.findUniqueOrThrow({ where: { nickname: playerNick } });
    // other вступил по капитанской ссылке — админ делает его рядовым участником.
    const demote = await app.inject({ method: "PATCH", url: `/api/games/${gameId}/teams/${teamId}/members/${other.id}`, headers: { cookie: adminCookie }, payload: { role: "MEMBER" } });
    expect(demote.statusCode).toBe(200);
    // Капитан (player) сам роль не получает: капитан — уже роль.
    const r1 = await app.inject({ method: "PATCH", url: `/api/games/${gameId}/teams/${teamId}/members/${player.id}`, headers: { cookie: playerCookie }, payload: { gameRole: "SCOUT" } });
    expect(r1.statusCode).toBe(409);
    const r2 = await app.inject({ method: "PATCH", url: `/api/games/${gameId}/teams/${teamId}/members/${other.id}`, headers: { cookie: playerCookie }, payload: { gameRole: "SCOUT" } });
    expect(r2.statusCode).toBe(200);
    const r3 = await app.inject({ method: "PATCH", url: `/api/games/${gameId}/teams/${teamId}/members/${other.id}`, headers: { cookie: playerCookie }, payload: { gameRole: "PROPHET" } });
    expect(r3.statusCode).toBe(200);
    const teams = await app.inject({ method: "GET", url: `/api/games/${gameId}/teams`, headers: { cookie: adminCookie } });
    const members = teams.json().teams[0].members as Array<{ user: { nickname: string }; gameRole: string }>;
    expect(members.filter((m) => m.gameRole === "SCOUT")).toHaveLength(0);
    expect(members.filter((m) => m.gameRole === "PROPHET")).toHaveLength(1);
    // Рядовой участник не может назначать капитана.
    const forb = await app.inject({ method: "PATCH", url: `/api/games/${gameId}/teams/${teamId}/members/${other.id}`, headers: { cookie: otherCookie }, payload: { role: "CAPTAIN" } });
    expect(forb.statusCode).toBe(403);
  });

  it("мои команды", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me/teams", headers: { cookie: playerCookie } });
    expect(res.json().teams[0].team.name).toBe("Иерусалим");
    expect(res.json().teams[0].role).toBe("CAPTAIN");
  });
});

describe("дела и старт игры", () => {
  it("готовность показывает проблемы, старт с ними запрещён", async () => {
    const r = await app.inject({ method: "GET", url: `/api/games/${gameId}/readiness`, headers: { cookie: adminCookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json().canStart).toBe(false);
    expect(r.json().problems.join(" ")).toContain("Карта");
    const s = await app.inject({ method: "POST", url: `/api/games/${gameId}/start`, headers: { cookie: adminCookie } });
    expect(s.statusCode).toBe(409);
  });

  it("стандартный набор дел добавляется один раз; дела редактируются", async () => {
    const imp = await app.inject({ method: "POST", url: `/api/games/${gameId}/deeds/import-default`, headers: { cookie: adminCookie } });
    expect(imp.statusCode).toBe(200);
    expect(imp.json().added).toBeGreaterThan(5);
    const again = await app.inject({ method: "POST", url: `/api/games/${gameId}/deeds/import-default`, headers: { cookie: adminCookie } });
    expect(again.json().added).toBe(0);
    const created = await app.inject({ method: "POST", url: `/api/games/${gameId}/deeds`, headers: { cookie: adminCookie }, payload: { title: "Своё дело", direction: "Посещение", canRepeat: true } });
    expect(created.statusCode).toBe(201);
    const deedId = created.json().deed.id;
    const upd = await app.inject({ method: "PUT", url: `/api/games/${gameId}/deeds/${deedId}`, headers: { cookie: adminCookie }, payload: { difficulty: 3 } });
    expect(upd.json().deed.difficulty).toBe(3);
    const list = await app.inject({ method: "GET", url: `/api/games/${gameId}/deeds`, headers: { cookie: adminCookie } });
    expect(list.json().deeds.length).toBeGreaterThan(6);
    expect(list.json().recommendedMin).toBeGreaterThan(0);
    const forb = await app.inject({ method: "GET", url: `/api/games/${gameId}/deeds`, headers: { cookie: playerCookie } });
    expect(forb.statusCode).toBe(403);
  });

  it("старт: карта, команды с людьми, дела → ACTIVE и стартовые точки", async () => {
    await app.inject({ method: "POST", url: `/api/games/${gameId}/generate`, headers: { cookie: adminCookie }, payload: { seed: 5 } });
    // Вторая команда без участников — старт запрещён.
    const notReady = await app.inject({ method: "POST", url: `/api/games/${gameId}/start`, headers: { cookie: adminCookie } });
    expect(notReady.statusCode).toBe(409);
    const teams = await prisma.team.findMany({ where: { gameId }, orderBy: { index: "asc" } });
    const inv = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams/${teams[1]!.id}/invites`, headers: { cookie: adminCookie }, payload: {} });
    const third = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nickname: "th_" + stamp, password: "secret123" } });
    await app.inject({ method: "POST", url: `/api/invites/${inv.json().invite.token}/accept`, headers: { cookie: third.headers["set-cookie"] as string } });
    const ok = await app.inject({ method: "POST", url: `/api/games/${gameId}/start`, headers: { cookie: adminCookie } });
    expect(ok.statusCode).toBe(200);
    const after = await prisma.team.findMany({ where: { gameId }, orderBy: { index: "asc" } });
    expect(after.every((t) => t.startNodeKey)).toBe(true);
    expect(new Set(after.map((t) => t.startNodeKey)).size).toBe(2);
    const game = await prisma.game.findUniqueOrThrow({ where: { id: gameId } });
    expect(game.status).toBe("ACTIVE");
    // После старта карту не перегенерировать.
    const gen = await app.inject({ method: "POST", url: `/api/games/${gameId}/generate`, headers: { cookie: adminCookie }, payload: {} });
    expect(gen.statusCode).toBe(409);
    await prisma.user.deleteMany({ where: { nickname: "th_" + stamp } });
  });
});

describe("настройки игры", () => {
  it("число команд меняется до старта, после — нет; капитану роль не даётся", async () => {
    const g = await app.inject({ method: "POST", url: "/api/games", headers: { cookie: adminCookie }, payload: { name: "Настройки", teamCount: 3 } });
    const gid = g.json().game.id as string;
    const ok = await app.inject({ method: "PATCH", url: `/api/games/${gid}`, headers: { cookie: adminCookie }, payload: { teamCount: 2, settings: { equidistantStarts: true } } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().game.teamCount).toBe(2);
    expect(ok.json().game.settings.equidistantStarts).toBe(true);
    // Стартов на карте 3 (сгенерировано до смены) → готовность требует перегенерации.
    await app.inject({ method: "POST", url: `/api/games/${gid}/generate`, headers: { cookie: adminCookie }, payload: { seed: 9 } });
    await app.inject({ method: "PATCH", url: `/api/games/${gid}`, headers: { cookie: adminCookie }, payload: { teamCount: 3 } });
    const r = await app.inject({ method: "GET", url: `/api/games/${gid}/readiness`, headers: { cookie: adminCookie } });
    expect(r.json().problems.join(" ")).toContain("перегенерируйте");
    // Начатая игра (gameId из предыдущих тестов) настройки не меняет.
    const locked = await app.inject({ method: "PATCH", url: `/api/games/${gameId}`, headers: { cookie: adminCookie }, payload: { teamCount: 4 } });
    expect(locked.statusCode).toBe(409);
    // Капитану игровую роль не назначить.
    const player = await prisma.user.findUniqueOrThrow({ where: { nickname: playerNick } });
    const cap = await app.inject({ method: "PATCH", url: `/api/games/${gameId}/teams/${teamId}/members/${player.id}`, headers: { cookie: adminCookie }, payload: { gameRole: "PROPHET" } });
    expect(cap.statusCode).toBe(409);
    await prisma.game.deleteMany({ where: { id: gid } });
  });
});

describe("карта команды и дела", () => {
  let taskId = "";
  it("после старта команда видит стартовый узел, туман и дела на рёбрах", async () => {
    const res = await app.inject({ method: "GET", url: `/api/games/${gameId}/my-map`, headers: { cookie: playerCookie } });
    expect(res.statusCode).toBe(200);
    const m = res.json();
    expect(m.status).toBe("ACTIVE");
    expect(m.revealed).toHaveLength(1);
    expect(m.revealed[0].kind).toBe("START");
    // Старт — перекрёсток трёх гексов: три стороны с делами; вся карта видна силуэтом, освещены три гекса.
    expect(m.tasks.length).toBe(3);
    expect(m.hexes.filter((h: { lit: boolean }) => h.lit)).toHaveLength(3);
    expect(m.hexes.length).toBeGreaterThan(50);
    expect(m.hexes.find((h: { lit: boolean; terrain?: string }) => !h.lit)?.terrain).toBeUndefined();
    expect(m.tasks.every((t: { status: string }) => t.status === "OPEN")).toBe(true);
    // Дела на рёбрах не повторяются, пока хватает уникальных.
    expect(new Set(m.tasks.map((t: { deedId: string }) => t.deedId)).size).toBe(m.tasks.length);
    taskId = m.tasks[0].id;
    // Чужой не видит.
    const other = await app.inject({ method: "GET", url: `/api/games/${gameId}/my-map`, headers: { cookie: adminCookie } });
    expect(other.statusCode).toBe(403);
  });

  it("взять, сдать ссылкой, отклонить, пересдать, одобрить → узел открылся", async () => {
    const take = await app.inject({ method: "POST", url: `/api/games/${gameId}/edge-tasks/${taskId}/take`, headers: { cookie: playerCookie } });
    expect(take.statusCode).toBe(200);
    expect(take.json().task.status).toBe("TAKEN");
    const bad = await app.inject({ method: "POST", url: `/api/games/${gameId}/edge-tasks/${taskId}/submit`, headers: { cookie: playerCookie }, payload: { links: ["not a url"] } });
    expect(bad.statusCode).toBe(400);
    const sub = await app.inject({ method: "POST", url: `/api/games/${gameId}/edge-tasks/${taskId}/submit`, headers: { cookie: playerCookie }, payload: { links: ["https://example.com/photo1"], note: "Сделали" } });
    expect([200, 400]).toContain(sub.statusCode);
    if (sub.statusCode === 400) {
      // дело требует ссылку — уже дали; значит проверка на текст; добавим текст
      const sub2 = await app.inject({ method: "POST", url: `/api/games/${gameId}/edge-tasks/${taskId}/submit`, headers: { cookie: playerCookie }, payload: { links: ["https://example.com/photo1"], note: "Сделали как надо" } });
      expect(sub2.statusCode).toBe(200);
    }
    const queue = await app.inject({ method: "GET", url: `/api/games/${gameId}/submissions`, headers: { cookie: adminCookie } });
    expect(queue.json().tasks.map((t: { id: string }) => t.id)).toContain(taskId);
    const rej = await app.inject({ method: "POST", url: `/api/games/${gameId}/edge-tasks/${taskId}/decide`, headers: { cookie: adminCookie }, payload: { approve: false, comment: "Фото нечёткое" } });
    expect(rej.json().task.status).toBe("REJECTED");
    const again = await app.inject({ method: "POST", url: `/api/games/${gameId}/edge-tasks/${taskId}/submit`, headers: { cookie: playerCookie }, payload: { links: ["https://example.com/photo2"], note: "Переснял" } });
    expect(again.statusCode).toBe(200);
    const ok = await app.inject({ method: "POST", url: `/api/games/${gameId}/edge-tasks/${taskId}/decide`, headers: { cookie: adminCookie }, payload: { approve: true } });
    expect(ok.json().task.status).toBe("APPROVED");
    const twice = await app.inject({ method: "POST", url: `/api/games/${gameId}/edge-tasks/${taskId}/decide`, headers: { cookie: adminCookie }, payload: { approve: true } });
    expect(twice.statusCode).toBe(409);
    const map = await app.inject({ method: "GET", url: `/api/games/${gameId}/my-map`, headers: { cookie: playerCookie } });
    const m = map.json();
    expect(m.revealed).toHaveLength(2);
    expect(m.tasks.filter((t: { status: string }) => t.status === "APPROVED")).toHaveLength(1);
    // Открылась развилка: к трём делам добавились два новых (степень 3, одно ребро уже пройдено).
    expect(m.tasks.filter((t: { status: string }) => t.status === "OPEN").length).toBe(4);
    expect(m.hexes.filter((h: { lit: boolean }) => h.lit).length).toBeGreaterThanOrEqual(4);
    const progress = await app.inject({ method: "GET", url: `/api/games/${gameId}/progress`, headers: { cookie: adminCookie } });
    expect(progress.json().teams[0].revealed).toHaveLength(2);
    expect(progress.json().teams[0].traversed).toHaveLength(1);
    expect(progress.json().teams[0].revealedAt).toHaveLength(2);
    expect(progress.json().teams[0].traversed[0].at).toBeTruthy();
    expect(progress.json().startedAt).toBeTruthy();
  });
});
