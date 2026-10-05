import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addAwakeMs, awakeMsBetween, dayLightAt, dayPhase, phaseAt } from "@lotw/domain";
import { readFile } from "node:fs/promises";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { cleanupFixtures, readyForStart, registerVerified, setGamePhase, zoneForLocalHour } from "./testAuth.js";
import { orderQueue, sumVerses } from "./services/battles.js";
import { nearZone } from "./services/teamMap.js";
import { pauseAfter, rulesOf } from "./services/rules.js";

/**
 * Решения владельца 18.09 по экспертному заключению: вызов только капитаном, стоп-часы на проверке,
 * уровень = ставка, автозачёт выученных стихов хранителям, закрепление только при максимуме,
 * очередь после сгорания, штраф администратора, подсказка пророка только пророку.
 */
const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now();
const adminNick = `radm_${stamp}`, p1Nick = `rp1_${stamp}`, p2Nick = `rp2_${stamp}`, p3Nick = `rp3_${stamp}`;
let adminCookie = "", p1Cookie = "", p2Cookie = "", p3Cookie = "", gameId = "", rutKey = "", genKey = "", team1 = "", team2 = "";
const content = JSON.parse(await readFile(new URL("../../../content/cities/rut.json", import.meta.url), "utf8")) as { tasks: unknown[] };
const allTasks = content.tasks.map((_, i) => i);

async function register(nickname: string) {
  const res = await registerVerified(app, { nickname, password: "secret123" });
  return res.headers["set-cookie"] as string;
}
async function joinTeam(name: string, cookie: string) {
  const t = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams`, headers: { cookie: adminCookie }, payload: { name } });
  const inv = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams/${t.json().team.id}/invites`, headers: { cookie: adminCookie }, payload: { role: "CAPTAIN" } });
  await app.inject({ method: "POST", url: `/api/invites/${inv.json().invite.token}/accept`, headers: { cookie } });
  return t.json().team.id as string;
}
const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });
const post = (url: string, cookie: string, payload?: unknown) => app.inject({ method: "POST", url, headers: { cookie }, payload });
const entriesOf = async (battleId: string) => (await get(`/api/games/${gameId}/battles`, adminCookie)).json().battles.find((b: { id: string }) => b.id === battleId).entries as Array<{ id: string; side: string; carried: boolean }>;

beforeAll(async () => {
  await app.ready();
  adminCookie = await register(adminNick);
  p1Cookie = await register(p1Nick);
  p2Cookie = await register(p2Nick);
  p3Cookie = await register(p3Nick);
  const g = await post("/api/games", adminCookie, { name: "Правила 18.09", teamCount: 2 });
  gameId = g.json().game.id;
  await post(`/api/games/${gameId}/generate`, adminCookie);
  team1 = await joinTeam("Моряки", p1Cookie);
  team2 = await joinTeam("Берег", p2Cookie);
  // Рядовой участник у «Берега».
  const inv = await post(`/api/games/${gameId}/teams/${team2}/invites`, adminCookie, { role: "MEMBER" });
  await post(`/api/invites/${inv.json().invite.token}/accept`, p3Cookie);
  await post(`/api/games/${gameId}/deeds/import-default`, adminCookie);
  await readyForStart(app, gameId, adminCookie);
  // Вызов отправляют на проверку только утром (решение владельца 03.10): в тестах у игры пояс, где сейчас утро.
  await setGamePhase(app, gameId, adminCookie, "morning");
  await post(`/api/games/${gameId}/start`, adminCookie);
  rutKey = (await prisma.mapNode.findFirstOrThrow({ where: { gameId, bookCode: "rut" } })).key;
  genKey = (await prisma.mapNode.findFirstOrThrow({ where: { gameId, bookCode: "gen" } })).key;
  await prisma.teamNodeState.createMany({ data: [{ teamId: team1, nodeKey: rutKey }, { teamId: team2, nodeKey: rutKey }, { teamId: team1, nodeKey: genKey }] });
  // «Моряки» владеют Руфью (не столица: столица — Бытие), «Берег» изучил Руфь.
  await prisma.teamCityState.createMany({ data: [
    { gameId, teamId: team1, nodeKey: genKey, orderSolved: true, doneTasks: [], capturedAt: new Date(), isCapital: true },
    { gameId, teamId: team1, nodeKey: rutKey, orderSolved: true, doneTasks: allTasks, capturedAt: new Date() },
    { gameId, teamId: team2, nodeKey: rutKey, orderSolved: true, doneTasks: allTasks },
  ] });
});

afterAll(async () => {
  await prisma.game.deleteMany({ where: { id: gameId } });
  await prisma.user.deleteMany({ where: { nickname: { in: [adminNick, p1Nick, p2Nick, p3Nick] } } });
  await cleanupFixtures(gameId);
  await app.close();
  await prisma.$disconnect();
});

describe("правила и настройки", () => {
  it("правила из настроек с умолчаниями; растущая пауза по ступеням", () => {
    const r = rulesOf({ rules: { minBid: 12 } });
    expect(r.minBid).toBe(12);
    expect(r.attackDays).toBe(14);
    expect(pauseAfter(r, 1)).toBe(20_000);
    expect(pauseAfter(r, 3)).toBe(300_000);
    expect(pauseAfter(r, 99)).toBe(3_600_000);
  });

  it("воин: его стихи считаются вдвое; вес берётся по участнику, стихи не дублируются", () => {
    const e = (userId: string, startIdx: number, endIdx: number, weight: number) => ({ userId, side: "ATTACK", status: "PENDING", startIdx, endIdx, weight }) as unknown as Parameters<typeof sumVerses>[0][number];
    expect(sumVerses([e("a", 0, 4, 2), e("a", 3, 6, 2), e("b", 0, 2, 1)], "ATTACK", false)).toBe(7 * 2 + 3);
    expect(sumVerses([e("a", 0, 4, 1)], "ATTACK", false)).toBe(5);
  });

  it("очередь: по ставке, но сгоревшая команда — после всех, кто встал раньше", () => {
    const d = (m: number) => new Date(1_000_000 + m * 60_000);
    const q = orderQueue([
      { id: "a", bid: 40, declaredAt: d(1), afterBurn: false },
      { id: "burn", bid: 1000, declaredAt: d(2), afterBurn: true },
      { id: "c", bid: 30, declaredAt: d(3), afterBurn: false },
    ]);
    expect(q.map((x) => x.id)).toEqual(["a", "burn", "c"]);
    const later = orderQueue([{ id: "burn", bid: 1000, declaredAt: d(2), afterBurn: true }, { id: "c", bid: 30, declaredAt: d(1), afterBurn: false }]);
    expect(later.map((x) => x.id)).toEqual(["c", "burn"]);
  });

  it("лимит дел в сутки: сверх лимита дело взять нельзя, лист дела знает об этом", async () => {
    const on = await app.inject({ method: "PATCH", url: `/api/games/${gameId}`, headers: { cookie: adminCookie }, payload: { settings: { rules: { maxDeedsPerDay: 1 } } } });
    expect(on.statusCode).toBe(200);
    const map = (await get(`/api/games/${gameId}/my-map`, p1Cookie)).json();
    const open = map.tasks.filter((t: { status: string; sea?: boolean }) => t.status === "OPEN" && !t.sea);
    expect(open.length).toBeGreaterThanOrEqual(2);
    expect(map.deedLimit).toEqual({ max: 1, taken: 0, nextAt: null });
    const first = await post(`/api/games/${gameId}/edge-tasks/${open[0].id}/take`, p1Cookie);
    expect(first.statusCode).toBe(200);
    const second = await post(`/api/games/${gameId}/edge-tasks/${open[1].id}/take`, p1Cookie);
    expect(second.statusCode).toBe(409);
    expect(second.json().message).toContain("не больше 1 дел");
    const after = (await get(`/api/games/${gameId}/my-map`, p1Cookie)).json();
    expect(after.deedLimit.taken).toBe(1);
    expect(after.deedLimit.nextAt).toBeGreaterThan(Date.now());
    // Вся команда видит таймер каждого участника в составе (решение владельца 04.10).
    const roster = (await get(`/api/games/${gameId}/teams`, p1Cookie)).json().teams[0].members as Array<{ user: { nickname: string }; deedLimit: { max: number; taken: number; nextAt: number | null } | null; activeDeeds: Array<{ id: string; status: string }> }>;
    const me = roster.find((x) => x.user.nickname === p1Nick)!;
    expect(me.deedLimit).toMatchObject({ max: 1, taken: 1 });
    // И дела на руках каждого участника видит вся команда, не только администратор (решение владельца 05.10).
    expect(me.activeDeeds).toEqual([expect.objectContaining({ id: open[0].id, status: "TAKEN" })]);
    expect(me.deedLimit!.nextAt).toBeGreaterThan(Date.now());
    expect(roster.find((x) => x.user.nickname !== p1Nick)!.deedLimit).toEqual({ max: 1, taken: 0, nextAt: null });
    // Товарищ по команде лимитом первого не ограничен — пусть берут другие.
    await post(`/api/games/${gameId}/edge-tasks/${open[0].id}/release`, p1Cookie);
    const off = await app.inject({ method: "PATCH", url: `/api/games/${gameId}`, headers: { cookie: adminCookie }, payload: { settings: { rules: { maxDeedsPerDay: 0 } } } });
    expect(off.statusCode).toBe(200);
  });

  it("свидетель: дело без ссылок, в сдаче обязателен человек, который может подтвердить", async () => {
    const created = await post(`/api/games/${gameId}/deeds`, adminCookie, { title: "Помолиться вслух в церкви (тест)", description: "Назвать свидетеля", direction: "Молитва", proofType: "WITNESS", canRepeat: true, bookCodes: [], chance: 60 });
    expect(created.statusCode).toBe(201);
    const map = (await get(`/api/games/${gameId}/my-map`, p1Cookie)).json();
    const open = map.tasks.find((t: { status: string; sea?: boolean }) => t.status === "OPEN" && !t.sea);
    await prisma.teamEdgeTask.update({ where: { id: open.id }, data: { deedId: created.json().deed.id } });
    expect((await post(`/api/games/${gameId}/edge-tasks/${open.id}/take`, p1Cookie)).statusCode).toBe(200);
    const empty = await post(`/api/games/${gameId}/edge-tasks/${open.id}/submit`, p1Cookie, { links: [], note: "", participants: [] });
    expect(empty.statusCode).toBe(400); expect(empty.json().message).toContain("кто может подтвердить");
    const ok = await post(`/api/games/${gameId}/edge-tasks/${open.id}/submit`, p1Cookie, { links: [], note: "Свидетель: служитель", participants: [] });
    expect(ok.statusCode).toBe(200); expect(ok.json().task.status).toBe("SUBMITTED");
  });

  it("администратор меняет правила в идущей игре через продвинутые настройки", async () => {
    const r = await app.inject({ method: "PATCH", url: `/api/games/${gameId}`, headers: { cookie: adminCookie }, payload: { settings: { rules: { attackDays: 21 } } } });
    expect(r.statusCode).toBe(200);
    expect(r.json().game.settings.rules.attackDays).toBe(21);
    const back = await app.inject({ method: "PATCH", url: `/api/games/${gameId}`, headers: { cookie: adminCookie }, payload: { settings: { rules: { attackDays: 14 } } } });
    expect(back.json().game.settings.rules.attackDays).toBe(14);
    expect(back.json().game.settings.rules.minBid).toBe(10);
  });
});

describe("одинаковые дела не рядом (03.10)", () => {
  it("зона «рядом» — концы стороны и соседние с ними перекрёстки", () => {
    const edges = [{ aKey: "A", bKey: "B" }, { aKey: "B", bKey: "C" }, { aKey: "C", bKey: "D" }, { aKey: "A", bKey: "E" }, { aKey: "E", bKey: "F" }];
    expect([...nearZone(edges, "A", "B")].sort()).toEqual(["A", "B", "C", "E"]);
    // Касающиеся рёбра ищутся отдельно: лишние рёбра зону не расширяют.
    expect(nearZone(edges, "C", "D").has("A")).toBe(false);
  });
});

describe("ночью таймеры испытаний стоят (03.10)", () => {
  const tz = "Asia/Tashkent"; // UTC+5, без летнего времени
  it("дневное время между моментами не считает ночь", () => {
    // 20:00 → 8:00 следующего дня: 2 часа вечера + 1 час утра.
    expect(awakeMsBetween(tz, new Date("2026-10-03T15:00:00Z"), new Date("2026-10-04T03:00:00Z"))).toBe(3 * 3_600_000);
    expect(awakeMsBetween(tz, new Date("2026-10-03T05:00:00Z"), new Date("2026-10-03T06:00:00Z"))).toBe(3_600_000);
    expect(awakeMsBetween(tz, new Date("2026-10-03T18:00:00Z"), new Date("2026-10-03T20:00:00Z"))).toBe(0);
  });
  it("дедлайн через дневное время пропускает ночь, одобрение ночью запускает отсчёт с 7:00", () => {
    // 21:30 + 1 час дневного → 7:30 следующего дня.
    expect(addAwakeMs(tz, new Date("2026-10-03T16:30:00Z"), 3_600_000).toISOString()).toBe("2026-10-04T02:30:00.000Z");
    // 3:00 ночи + 2 часа → 9:00 того же дня.
    expect(addAwakeMs(tz, new Date("2026-10-02T22:00:00Z"), 7_200_000).toISOString()).toBe("2026-10-03T04:00:00.000Z");
    // Днём без ночи между — обычное сложение.
    expect(addAwakeMs(tz, new Date("2026-10-03T05:00:00Z"), 1_800_000).toISOString()).toBe("2026-10-03T05:30:00.000Z");
  });
});

describe("испытание по решениям 18.09", () => {
  let battleId = "";
  it("вызов бросает только капитан; претенденты не видят счёт хранителей", async () => {
    const member = await post(`/api/games/${gameId}/my-city/${rutKey}/war`, p3Cookie, { bid: 10 });
    expect(member.statusCode).toBe(403);
    const res = await post(`/api/games/${gameId}/my-city/${rutKey}/war`, p2Cookie, { bid: 10 });
    expect(res.statusCode).toBe(201);
    battleId = res.json().id;
    const w = await get(`/api/games/${gameId}/my-city/${rutKey}/war`, p2Cookie);
    expect(w.json().battles[0].status).toBe("ATTACK");
    expect(w.json().battles[0].defenseSum).toBe(0);
    expect(w.json().attackDays).toBe(14);
  });

  it("стоп-часы: время на проверке не входит в T и сдвигает срок вызова; уступки нет", async () => {
    const w = await get(`/api/games/${gameId}/my-city/${rutKey}/war`, p2Cookie);
    const { start } = w.json().battles[0].passage as { start: number };
    const verses = Array.from({ length: 10 }, (_, i) => start + i);
    // Два участника учат по 10: сумма 20 при ставке 10 — лишние стихи не считаются.
    await post(`/api/games/${gameId}/battles/${battleId}/entries`, p2Cookie, { verses, links: ["https://example.com/a"] });
    // Стих сдаётся один раз (03.10): два стиха отрывка у третьего участника уже приняты в прошлом испытании этой книги.
    const p3 = await prisma.user.findUniqueOrThrow({ where: { nickname: p3Nick } });
    const past = await prisma.battle.create({ data: { gameId, nodeKey: rutKey, bookCode: "rut", attackerId: team2, defenderId: team1, bid: 10, status: "EXPIRED", resolvedAt: new Date() } });
    await prisma.battleEntry.create({ data: { battleId: past.id, side: "ATTACK", teamId: team2, userId: p3.id, startIdx: start, endIdx: start + 1, links: ["https://example.com/old"], status: "APPROVED", decidedAt: new Date() } });
    const again = await post(`/api/games/${gameId}/battles/${battleId}/entries`, p3Cookie, { verses: [start, start + 1], links: ["https://example.com/b0"] });
    expect(again.statusCode).toBe(409);
    expect(again.json().message).toContain("прошлом испытании");
    const p3Post = await post(`/api/games/${gameId}/battles/${battleId}/entries`, p3Cookie, { verses, links: ["https://example.com/b"] });
    expect(p3Post.json()).toMatchObject({ added: 8 });
    const listed = (await get(`/api/games/${gameId}/my-battles`, p3Cookie)).json().battles as Array<{ id: string; learnedVerses: number[] }>;
    expect(listed.find((x) => x.id === battleId)!.learnedVerses).toEqual([start, start + 1]);
    // Подставной прошлый бой убираем, чтобы не влиял на очередь и «после сгорания» дальше.
    await prisma.battle.delete({ where: { id: past.id } });
    expect((await post(`/api/games/${gameId}/battles/${battleId}/submit`, p2Cookie)).statusCode).toBe(200);
    // Арифметика таймеров — в поясе, где сейчас день: сдвинутые назад отметки не попадают в ночь (ночью таймеры стоят, 03.10).
    await setGamePhase(app, gameId, adminCookie, "day");
    const before = await prisma.battle.findUniqueOrThrow({ where: { id: battleId } });
    // Отправка была «десять минут назад»: возврат записи вернёт эти десять минут.
    await prisma.battle.update({ where: { id: battleId }, data: { attackDoneAt: new Date(Date.now() - 600_000), startedAt: new Date(Date.now() - 3_600_000) } });
    const entries = await entriesOf(battleId);
    const rej = await post(`/api/games/${gameId}/battles/${battleId}/entries/${entries[0]!.id}/decide`, adminCookie, { approve: false, comment: "плохо слышно" });
    expect(rej.statusCode).toBe(200);
    const after = await prisma.battle.findUniqueOrThrow({ where: { id: battleId } });
    expect(after.attackDoneAt).toBeNull();
    // Стоп-часы — дневным временем (ночь не считается, 03.10); срок вызова сдвигается на всё время проверки.
    const tz = rulesOf((await prisma.game.findUniqueOrThrow({ where: { id: gameId } })).settings).timeZone;
    const pausedAwake = awakeMsBetween(tz, new Date(Date.now() - 600_000), new Date());
    expect(Math.abs(after.attackPausedMs - pausedAwake)).toBeLessThan(5_000);
    expect(after.attackDeadline!.getTime() - before.attackDeadline!.getTime()).toBeGreaterThan(590_000);
    // Уступить город нельзя — такого действия нет.
    expect((await post(`/api/games/${gameId}/battles/${battleId}/surrender`, p1Cookie)).statusCode).toBe(404);
    // Пересдача и отправка (утром): T = (отправка − старт) − пауза ≈ 60 мин − 10 мин; одобрение — снова днём.
    await post(`/api/games/${gameId}/battles/${battleId}/entries`, p2Cookie, { verses, links: ["https://example.com/a2"] });
    await setGamePhase(app, gameId, adminCookie, "morning");
    expect((await post(`/api/games/${gameId}/battles/${battleId}/submit`, p2Cookie)).statusCode).toBe(200);
    await setGamePhase(app, gameId, adminCookie, "day");
    for (const e of await entriesOf(battleId)) await post(`/api/games/${gameId}/battles/${battleId}/entries/${e.id}/decide`, adminCookie, { approve: true });
    const def = await prisma.battle.findUniqueOrThrow({ where: { id: battleId } });
    expect(def.status).toBe("DEFENSE");
    // T — дневное время от старта до отправки минус стоп-часы; дедлайн ответа — через T дневного времени.
    const expectedT = awakeMsBetween(tz, def.startedAt!, def.attackDoneAt!) - def.attackPausedMs;
    expect(Math.abs(def.defenseDeadline!.getTime() - addAwakeMs(tz, def.attackApprovedAt!, expectedT).getTime())).toBeLessThan(5_000);
    expect(expectedT).toBeGreaterThan(0);
    // Претенденты не видят отрывок и суммы хранителей, хранителям нужно ровно 10.
    const mine = await get(`/api/games/${gameId}/my-battles`, p2Cookie);
    expect(mine.json().battles[0]).toMatchObject({ defensePassage: null, defenseSum: 0, defenseBid: null });
  });

  it("возврат ответа сдвигает дедлайн, а не отдаёт город; не ответили в срок → уровень = ставка", async () => {
    await post(`/api/games/${gameId}/battles/${battleId}/defense-passage`, p1Cookie, { from: "1:1", to: "1:10" });
    await post(`/api/games/${gameId}/battles/${battleId}/entries`, p1Cookie, { verses: Array.from({ length: 10 }, (_, i) => i), links: ["https://example.com/d"] });
    expect((await post(`/api/games/${gameId}/battles/${battleId}/submit`, p1Cookie)).statusCode).toBe(200);
    // Дедлайн уже прошёл, пока запись лежала на проверке: возврат не отдаёт город, а сдвигает срок.
    await prisma.battle.update({ where: { id: battleId }, data: { defenseDoneAt: new Date(Date.now() - 300_000), defenseDeadline: new Date(Date.now() - 60_000) } });
    const e = (await entriesOf(battleId)).find((x) => x.side === "DEFENSE")!;
    await post(`/api/games/${gameId}/battles/${battleId}/entries/${e.id}/decide`, adminCookie, { approve: false, comment: "не тот отрывок" });
    const b = await prisma.battle.findUniqueOrThrow({ where: { id: battleId } });
    expect(b.status).toBe("DEFENSE");
    expect(b.defenseDoneAt).toBeNull();
    expect(b.defenseDeadline!.getTime()).toBeGreaterThan(Date.now() + 200_000);
    // Хранители так и не ответили: город перешёл, уровень = ставка 10, хотя претенденты выучили 20.
    await prisma.battle.update({ where: { id: battleId }, data: { defenseDeadline: new Date(Date.now() - 1000) } });
    const after = await get(`/api/games/${gameId}/my-battles`, p1Cookie);
    expect(after.json().battles[0].status).toBe("WON");
    // Дальше вызовы снова отправляются утром.
    await setGamePhase(app, gameId, adminCookie, "morning");
    const node = await prisma.mapNode.findUniqueOrThrow({ where: { gameId_key: { gameId, key: rutKey } } });
    expect(node.defenseLevel).toBe(10);
    expect((await prisma.team.findUniqueOrThrow({ where: { id: team1 } })).status).toBe("active");
  });

  it("выученные раньше стихи засчитываются хранителям сами; закрепления без максимума нет", async () => {
    // «Моряки» бросают вызов «Берегу» на Руфь: ставка 15 (уровень 10 + 5). У «Берега» уже принято 18 единиц этой книги (10 у одного и 8 у другого: два стиха он сдавал раньше).
    const res = await post(`/api/games/${gameId}/my-city/${rutKey}/war`, p1Cookie, { bid: 15 });
    expect(res.statusCode).toBe(201);
    const id = res.json().id as string;
    await prisma.mapNode.update({ where: { gameId_key: { gameId, key: rutKey } }, data: { sumMode: true } });
    await prisma.battle.update({ where: { id }, data: { sumMode: true } });
    const w = await get(`/api/games/${gameId}/my-city/${rutKey}/war`, p1Cookie);
    const { start } = w.json().battles[0].passage as { start: number };
    await post(`/api/games/${gameId}/battles/${id}/entries`, p1Cookie, { verses: Array.from({ length: 15 }, (_, i) => start + i), links: ["https://example.com/m"] });
    await post(`/api/games/${gameId}/battles/${id}/submit`, p1Cookie);
    for (const e of await entriesOf(id)) await post(`/api/games/${gameId}/battles/${id}/entries/${e.id}/decide`, adminCookie, { approve: true });
    const b = await prisma.battle.findUniqueOrThrow({ where: { id }, include: { entries: true } });
    // Зачтённых стихов (18) хватило на ставку 15: ответ дан без единого нового стиха.
    expect(b.status).toBe("REPELLED");
    expect(b.defenseBid).toBe(18);
    expect(b.entries.filter((e) => e.side === "DEFENSE" && e.carried)).toHaveLength(2);
    const node = await prisma.mapNode.findUniqueOrThrow({ where: { gameId_key: { gameId, key: rutKey } } });
    expect(node.defenseLevel).toBe(18);
    expect(node.lockedUntil).toBeNull(); // максимум — 2 участника × 85 стихов — не достигнут
  });

  it("сгоревший вызов помечает следующий как «после сгорания»; письмо и штраф", async () => {
    const res = await post(`/api/games/${gameId}/my-city/${rutKey}/war`, p1Cookie, { bid: 23 });
    expect(res.statusCode).toBe(201);
    await prisma.battle.update({ where: { id: res.json().id }, data: { attackDeadline: new Date(Date.now() - 1000) } });
    const w = await get(`/api/games/${gameId}/my-city/${rutKey}/war`, p1Cookie);
    expect(w.json().battles[0].status).toBe("EXPIRED");
    expect(w.json().penalty).toBe(5);
    const again = await post(`/api/games/${gameId}/my-city/${rutKey}/war`, p1Cookie, { bid: 26 });
    expect(again.statusCode).toBe(201);
    expect((await prisma.battle.findUniqueOrThrow({ where: { id: again.json().id } })).afterBurn).toBe(true);
    await prisma.battle.update({ where: { id: again.json().id }, data: { status: "CANCELLED", resolvedAt: new Date() } });
  });

  it("перенос столицы невозможен, пока на неё брошен вызов", async () => {
    // Столица «Моряков» — Бытие; «Берег» дошёл до него и изучил; вызов в очереди/идёт — переезд закрыт.
    await prisma.teamNodeState.create({ data: { teamId: team2, nodeKey: genKey } });
    await prisma.teamCityState.create({ data: { gameId, teamId: team2, nodeKey: genKey, orderSolved: true, doneTasks: (JSON.parse(await readFile(new URL("../../../content/cities/gen.json", import.meta.url), "utf8")) as { tasks: unknown[] }).tasks.map((_, i) => i) } });
    const res = await post(`/api/games/${gameId}/my-city/${genKey}/war`, p2Cookie, { bid: 10 });
    expect(res.statusCode).toBe(201);
    const move = await post(`/api/games/${gameId}/my-city/${rutKey}/make-capital`, p1Cookie);
    expect(move.statusCode).toBe(409);
    await prisma.battle.update({ where: { id: res.json().id }, data: { status: "CANCELLED", resolvedAt: new Date() } });
  });
});

describe("штраф, роли, пророк", () => {
  it("штраф администратора аннулирует концевой участок пути", async () => {
    await prisma.user.update({ where: { nickname: adminNick }, data: { platformRole: "SUPERADMIN" } });
    const map0 = await get(`/api/games/${gameId}/my-map`, p2Cookie);
    const first = (map0.json().tasks as Array<{ toKey: string; sea: boolean }>).find((t) => !t.sea)!;
    const reveal = await post(`/api/games/${gameId}/teams/${team2}/reveal`, adminCookie, { nodeKey: first.toKey });
    expect(reveal.statusCode).toBe(200);
    const map1 = await get(`/api/games/${gameId}/my-map`, p2Cookie);
    expect((map1.json().revealed as Array<{ key: string }>).some((n) => n.key === first.toKey)).toBe(true);
    const pen = await post(`/api/games/${gameId}/teams/${team2}/penalty`, adminCookie);
    expect(pen.statusCode).toBe(200);
    expect(pen.json().toKey).toBe(first.toKey);
    const map2 = await get(`/api/games/${gameId}/my-map`, p2Cookie);
    expect((map2.json().revealed as Array<{ key: string }>).some((n) => n.key === first.toKey)).toBe(false);
    const task = (map2.json().tasks as Array<{ toKey: string; status: string }>).find((t) => t.toKey === first.toKey)!;
    expect(task.status).toBe("OPEN");
    expect(await prisma.teamPenalty.count({ where: { gameId, teamId: team2 } })).toBe(1);
    // Не на что штрафовать — 409.
    expect((await post(`/api/games/${gameId}/teams/${team2}/penalty`, adminCookie)).statusCode).toBe(409);
  });

  it("штраф закрывает и ещё не взятый город на конце пути: задания города начинаются заново (уточнение владельца 19.09)", async () => {
    // Команда 2 дошла до города и частично изучила его: сторона в город одобрена, район решён, подсказка пророка открыта.
    const map0 = await get(`/api/games/${gameId}/my-map`, p2Cookie);
    const toCity = (map0.json().tasks as Array<{ id: string; toKey: string; sea: boolean; status: string }>).find((t) => !t.sea && t.status === "OPEN")!;
    const cityKey = toCity.toKey;
    await prisma.mapNode.update({ where: { gameId_key: { gameId, key: cityKey } }, data: { kind: "CITY", bookCode: "jon" } });
    await prisma.teamEdgeTask.update({ where: { id: toCity.id }, data: { status: "APPROVED", decidedAt: new Date() } });
    await prisma.teamNodeState.create({ data: { teamId: team2, nodeKey: cityKey } });
    await prisma.teamCityState.create({ data: { gameId, teamId: team2, nodeKey: cityKey, orderSolved: true, doneTasks: [0], hintTasks: [1], attackPenalty: 5 } });
    const pen = await post(`/api/games/${gameId}/teams/${team2}/penalty`, adminCookie);
    expect(pen.statusCode).toBe(200);
    expect(pen.json().toKey).toBe(cityKey);
    expect(pen.json().city).toBe(true);
    const map1 = await get(`/api/games/${gameId}/my-map`, p2Cookie);
    expect((map1.json().revealed as Array<{ key: string }>).some((n) => n.key === cityKey)).toBe(false);
    const st = await prisma.teamCityState.findUniqueOrThrow({ where: { teamId_nodeKey: { teamId: team2, nodeKey: cityKey } } });
    expect(st.orderSolved).toBe(false);
    expect(st.doneTasks).toEqual([]);
    expect(st.hintTasks).toEqual([]);
    expect(st.attackPenalty).toBe(5);
    // У команды 1 пройденных концевых участков нет (Руфь взята, старт не трогается) — штрафовать не на что.
    expect((await post(`/api/games/${gameId}/teams/${team1}/penalty`, adminCookie)).statusCode).toBe(409);
  });

  it("подсказку пророка видит только пророк; заместитель бросает вызов", async () => {
    const p3 = await prisma.user.findUniqueOrThrow({ where: { nickname: p3Nick } });
    await app.inject({ method: "PATCH", url: `/api/games/${gameId}/teams/${team2}/members/${p3.id}`, headers: { cookie: adminCookie }, payload: { gameRole: "PROPHET" } });
    // В идущей игре сменить уже выданную роль капитан может не чаще раза в неделю; администратор — без ограничения.
    const swap = await app.inject({ method: "PATCH", url: `/api/games/${gameId}/teams/${team2}/members/${p3.id}`, headers: { cookie: p2Cookie }, payload: { gameRole: "SCOUT" } });
    expect(swap.statusCode).toBe(429);
    expect((await post(`/api/games/${gameId}/my-city/${rutKey}/hint`, p2Cookie, { index: 0 })).statusCode).toBe(403);
    // Письмо пророка приходит один раз, в ответ на зажжённую свечу; отдельного маршрута чтения нет (решение владельца 22.09).
    const hint = await post(`/api/games/${gameId}/my-city/${rutKey}/hint`, p3Cookie, { index: 0 });
    expect(hint.statusCode).toBe(200);
    expect(hint.json().text.length).toBeGreaterThan(0);
    expect(hint.json().verses).toBeTruthy();
    const prophetView = await get(`/api/games/${gameId}/my-city/${rutKey}`, p3Cookie);
    expect(prophetView.json().state.hintTasks).toEqual([0]);
    const captainView = await get(`/api/games/${gameId}/my-city/${rutKey}`, p2Cookie);
    expect(captainView.json().state.hintTasks).toEqual([]);
    expect((await get(`/api/games/${gameId}/my-city/${rutKey}/hint/0`, p3Cookie)).statusCode).toBe(404);
    // Заместитель капитана может бросить вызов.
    const dep = await app.inject({ method: "PATCH", url: `/api/games/${gameId}/teams/${team2}/members/${p3.id}`, headers: { cookie: p2Cookie }, payload: { role: "DEPUTY" } });
    expect(dep.json().member.role).toBe("DEPUTY");
    const res = await post(`/api/games/${gameId}/my-city/${genKey}/war`, p3Cookie, { bid: 10 });
    expect(res.statusCode).toBe(201);
  });
});

describe("осада делами и дела этапа 2", () => {
  it("город с максимумом защиты берётся осадой делами: у кого больше одобренных дел за срок, тот владеет", async () => {
    // Руфь у «Берега» (взята выше в испытании), максимум достигнут, закрепление кончилось.
    await prisma.mapNode.update({ where: { gameId_key: { gameId, key: rutKey } }, data: { maxReachedAt: new Date(Date.now() - 30 * 86_400_000), lockedUntil: new Date(Date.now() - 1000) } });
    await prisma.battle.updateMany({ where: { gameId, nodeKey: rutKey, status: { in: ["QUEUED", "ATTACK", "DEFENSE"] } }, data: { status: "CANCELLED", resolvedAt: new Date() } });
    // Руфь для «Берега» — не столица (иначе проигрыш осады выбьет команду из игры).
    await prisma.teamCityState.updateMany({ where: { teamId: team2, nodeKey: rutKey }, data: { isCapital: false } });
    const w = await get(`/api/games/${gameId}/my-city/${rutKey}/war`, p1Cookie);
    expect(w.json().canDeclare).toBe(false);
    expect(w.json().siege.available).toBe(true);
    expect(w.json().siege.canDeclare).toBe(true);
    const own = await post(`/api/games/${gameId}/my-city/${rutKey}/siege`, p2Cookie);
    expect(own.statusCode).toBe(409); // свой город
    const res = await post(`/api/games/${gameId}/my-city/${rutKey}/siege`, p1Cookie);
    expect(res.statusCode).toBe(201);
    const again = await post(`/api/games/${gameId}/my-city/${rutKey}/siege`, p1Cookie);
    expect(again.statusCode).toBe(409);
    // «Моряки» за время осады сдали два дела, «Берег» — одно.
    const deed = await prisma.deed.findFirstOrThrow({ where: { gameId } });
    const mk = (teamId: string, n: number) => Promise.all(Array.from({ length: n }, (_, i) => prisma.teamEdgeTask.create({ data: { gameId, teamId, fromKey: `siege-${teamId}-${i}`, toKey: `siege-to-${teamId}-${i}`, deedId: deed.id, status: "APPROVED", decidedAt: new Date(Date.now() - 5000) } })));
    await mk(team1, 2); await mk(team2, 1);
    await prisma.siege.update({ where: { id: res.json().id }, data: { startedAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() - 1000) } });
    const after = await get(`/api/games/${gameId}/my-city/${rutKey}/war`, p1Cookie);
    const s = after.json().siege.list[0];
    expect(s).toMatchObject({ status: "WON", attackerPoints: 2, defenderPoints: 1 });
    expect(after.json().owner.id).toBe(team1);
    const node = await prisma.mapNode.findUniqueOrThrow({ where: { gameId_key: { gameId, key: rutKey } } });
    expect(node.maxReachedAt).toBeNull();
    expect(node.defenseLevel).toBe(0);
  });

  it("дело сдаётся с участниками группой; «подтверждение» читается как отчёт; тяжести нет", async () => {
    const map = await get(`/api/games/${gameId}/my-map`, p2Cookie);
    const task = (map.json().tasks as Array<{ id: string; status: string; sea: boolean; deed: { proofType: string; remote?: boolean } }>).find((x) => x.status === "OPEN" && !x.sea)!;
    expect(task.deed).not.toHaveProperty("difficulty");
    await post(`/api/games/${gameId}/edge-tasks/${task.id}/take`, p2Cookie);
    const p3 = await prisma.user.findUniqueOrThrow({ where: { nickname: p3Nick } });
    const sub = await post(`/api/games/${gameId}/edge-tasks/${task.id}/submit`, p2Cookie, { links: ["https://example.com/x"], note: "Что сделал: помогли", participants: [p3.id, "чужой-id"] });
    expect(sub.statusCode).toBe(200);
    const row = await prisma.teamEdgeTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.participants).toHaveLength(2);
    expect(row.participants).toContain(p3.id);
    // В очереди проверки видны имена участников дела группой (замечание владельца 30.09), без взявшего.
    const queue = (await get(`/api/games/${gameId}/submissions`, adminCookie)).json().tasks as Array<{ id: string; participantNames: string[] }>;
    const queued = queue.find((x) => x.id === task.id)!;
    expect(queued.participantNames).toHaveLength(1);
    expect(queued.participantNames[0]).toBe(p3Nick);
    // Отчёт по делу для администратора (решение владельца 30.09): по id, по стороне и из летописи; участникам — 403.
    const one = await get(`/api/games/${gameId}/edge-tasks/${task.id}`, adminCookie);
    expect(one.statusCode).toBe(200);
    expect(one.json().task).toMatchObject({ id: task.id, status: "SUBMITTED", note: "Что сделал: помогли", links: ["https://example.com/x"] });
    expect(one.json().task.takenBy.name).toBeTruthy();
    expect(one.json().task.participants.map((x: { id: string }) => x.id)).toContain(p3.id);
    const full = (await get(`/api/games/${gameId}/my-map`, p2Cookie)).json().tasks.find((x: { id: string }) => x.id === task.id) as { fromKey: string; toKey: string };
    const onEdge = await get(`/api/games/${gameId}/edge-tasks?a=${encodeURIComponent(full.toKey)}&b=${encodeURIComponent(full.fromKey)}`, adminCookie);
    expect(onEdge.statusCode).toBe(200);
    expect((onEdge.json().tasks as Array<{ id: string }>).some((x) => x.id === task.id)).toBe(true);
    expect((await get(`/api/games/${gameId}/edge-tasks/${task.id}`, p2Cookie)).statusCode).toBe(403);
    // Запись в журнал пишется асинхронно после ответа — ждём её недолго.
    let found = false;
    for (let i = 0; i < 20 && !found; i++) {
      const journalItems = (await get(`/api/games/${gameId}/journal`, adminCookie)).json().items as Array<{ kind: string; taskId: string | null }>;
      found = journalItems.some((it) => it.kind === "deed_submitted" && it.taskId === task.id);
      if (!found) await new Promise((r) => setTimeout(r, 100));
    }
    expect(found).toBe(true);
    const created = await post(`/api/games/${gameId}/deeds`, adminCookie, { title: "Дело издалека", direction: "Посещение", proofType: "CONFIRMATION", remote: true, siegePoints: 3 });
    expect(created.statusCode).toBe(201);
    expect(created.json().deed).toMatchObject({ proofType: "REPORT", remote: true, siegePoints: 3 });
    // Свободные дела следуют за настройками (решение владельца 04.10): после нового дела свободные стороны перераздаются,
    // а взятые и сданные остаются с прежним делом; у каждой стороны по-прежнему есть дело.
    const map2 = await get(`/api/games/${gameId}/my-map`, p2Cookie);
    type Tk = { id: string; status: string; deed: { id: string } | null };
    const before = new Map((map.json().tasks as Tk[]).map((x) => [x.id, x.deed?.id]));
    for (const x of map2.json().tasks as Tk[]) if (x.status !== "OPEN" && before.has(x.id)) expect(x.deed?.id).toBe(before.get(x.id));
    expect((map2.json().tasks as Tk[]).every((x) => x.deed)).toBe(true);
  });
  it("метки команды на карте: ставит любой участник, видит вся команда, чужие не видят; убирает только автор", async () => {
    const hex = (await get(`/api/games/${gameId}/my-map`, p3Cookie)).json().hexes[0] as { q: number; r: number };
    const bad = await post(`/api/games/${gameId}/my-map/marks`, p3Cookie, { q: 150, r: 150, note: "" });
    expect(bad.statusCode).toBe(404);
    const put = await post(`/api/games/${gameId}/my-map/marks`, p3Cookie, { q: hex.q, r: hex.r, note: "птицы сели здесь" });
    expect(put.statusCode).toBe(201);
    const markId = put.json().mark.id as string;
    const mates = (await get(`/api/games/${gameId}/my-map`, p2Cookie)).json().marks as Array<{ id: string; q: number; r: number; qf: number; rf: number; note: string; by: { id: string; name: string } }>;
    expect(mates).toMatchObject([{ id: markId, q: hex.q, r: hex.r, note: "птицы сели здесь" }]);
    const others = (await get(`/api/games/${gameId}/my-map`, p1Cookie)).json().marks as unknown[];
    expect(others.some((m) => (m as { id: string }).id === markId)).toBe(false);
    // Автор метки виден команде; точка — там, куда нажали (дробные координаты внутри гекса), на одном гексе может быть несколько меток.
    expect(mates[0]!.by.name).toBeTruthy();
    expect(mates[0]!.qf).toBe(hex.q); expect(mates[0]!.rf).toBe(hex.r);
    const far = await post(`/api/games/${gameId}/my-map/marks`, p3Cookie, { q: hex.q, r: hex.r, qf: hex.q + 2, rf: hex.r, note: "" });
    expect(far.statusCode).toBe(400);
    const again = await post(`/api/games/${gameId}/my-map/marks`, p3Cookie, { q: hex.q, r: hex.r, qf: hex.q + 0.3, rf: hex.r - 0.2, note: "" });
    expect(again.statusCode).toBe(201);
    expect(again.json().mark.qf).toBeCloseTo(hex.q + 0.3);
    expect((await get(`/api/games/${gameId}/my-map`, p2Cookie)).json().marks).toHaveLength(2);
    expect((await app.inject({ method: "DELETE", url: `/api/games/${gameId}/my-map/marks/${again.json().mark.id}`, headers: { cookie: p3Cookie } })).statusCode).toBe(200);
    expect(again.statusCode).toBe(201);
    expect((await get(`/api/games/${gameId}/my-map`, p2Cookie)).json().marks).toHaveLength(1);
    expect((await app.inject({ method: "DELETE", url: `/api/games/${gameId}/my-map/marks/${markId}`, headers: { cookie: p1Cookie } })).statusCode).toBe(404);
    // Убрать метку может только автор (решение владельца 29.09): участник своей команды получает 403.
    expect((await app.inject({ method: "DELETE", url: `/api/games/${gameId}/my-map/marks/${markId}`, headers: { cookie: p2Cookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: `/api/games/${gameId}/my-map/marks/${markId}`, headers: { cookie: p3Cookie } })).statusCode).toBe(200);
    expect((await get(`/api/games/${gameId}/my-map`, p3Cookie)).json().marks).toHaveLength(0);
  });
});

describe("времена суток (решение владельца 03.10)", () => {
  it("утро 7–9, день 9–18, вечер 18–22, ночь 22–7", () => {
    expect(phaseAt(6 * 60 + 59)).toBe("night");
    expect(phaseAt(7 * 60)).toBe("morning");
    expect(phaseAt(8 * 60 + 59)).toBe("morning");
    expect(phaseAt(9 * 60)).toBe("day");
    expect(phaseAt(17 * 60 + 59)).toBe("day");
    expect(phaseAt(18 * 60)).toBe("evening");
    expect(phaseAt(21 * 60 + 59)).toBe("evening");
    expect(phaseAt(22 * 60)).toBe("night");
  });
  it("плавный переход ±15 минут вокруг границы, правила переключаются ровно на границе", () => {
    expect(dayLightAt(12 * 60)).toMatchObject({ phase: "day", from: "day", to: "day", t: 0 });
    expect(dayLightAt(17 * 60 + 45)).toMatchObject({ phase: "day", from: "day", to: "evening", t: 0 });
    expect(dayLightAt(18 * 60)).toMatchObject({ phase: "evening", from: "day", to: "evening", t: 0.5 });
    expect(dayLightAt(18 * 60 + 15)).toMatchObject({ phase: "evening", from: "evening", to: "evening", t: 0 });
    expect(dayLightAt(6 * 60 + 50).to).toBe("morning");
    expect(dayLightAt(6 * 60 + 50).phase).toBe("night");
  });
  it("фаза по поясу игры; неизвестный пояс — по UTC", () => {
    // 05:30 UTC = 10:30 в Ташкенте — день; 17:30 UTC = 22:30 — ночь; 02:00 UTC = 07:00 — утро.
    expect(dayPhase("Asia/Tashkent", new Date("2026-10-03T05:30:00Z"))).toBe("day");
    expect(dayPhase("Asia/Tashkent", new Date("2026-10-03T17:30:00Z"))).toBe("night");
    expect(dayPhase("Asia/Tashkent", new Date("2026-10-03T02:00:00Z"))).toBe("morning");
    expect(dayPhase("Nowhere/Nope", new Date("2026-10-03T12:00:00Z"))).toBe("day");
    expect(dayPhase(zoneForLocalHour(23))).toBe("night");
    expect(dayPhase(zoneForLocalHour(12))).toBe("day");
  });
});

describe("ночью всё закрыто, вызов — только утром (решение владельца 03.10)", () => {
  it("глубокой ночью дело не берётся (409 night), в 23:00 — можно (решение владельца 04.10); карта отдаёт фазу", async () => {
    await setGamePhase(app, gameId, adminCookie, "night"); // 23:00
    const map = await get(`/api/games/${gameId}/my-map`, p1Cookie);
    expect(map.json().daytime).toMatchObject({ phase: "night", tasksOpen: true });
    const open = (map.json().tasks as Array<{ id: string; status: string; sea: boolean }>).find((tk) => tk.status === "OPEN" && !tk.sea);
    if (open) {
      expect((await post(`/api/games/${gameId}/edge-tasks/${open.id}/take`, p1Cookie)).statusCode).toBe(200);
      expect((await post(`/api/games/${gameId}/edge-tasks/${open.id}/release`, p1Cookie)).statusCode).toBe(200);
      await app.inject({ method: "PATCH", url: `/api/games/${gameId}`, headers: { cookie: adminCookie }, payload: { settings: { rules: { timeZone: zoneForLocalHour(3) } } } });
      const r = await post(`/api/games/${gameId}/edge-tasks/${open.id}/take`, p1Cookie);
      expect(r.statusCode).toBe(409);
      expect(r.json().error).toBe("night");
    }
    await setGamePhase(app, gameId, adminCookie, "evening");
    expect((await get(`/api/games/${gameId}/my-map`, p1Cookie)).json().daytime.phase).toBe("evening");
    await setGamePhase(app, gameId, adminCookie, "morning");
  });
});
