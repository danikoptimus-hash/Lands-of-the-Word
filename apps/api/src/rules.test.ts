import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { cleanupFixtures, readyForStart, registerVerified } from "./testAuth.js";
import { orderQueue } from "./services/battles.js";
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

  it("администратор меняет правила в идущей игре через продвинутые настройки", async () => {
    const r = await app.inject({ method: "PATCH", url: `/api/games/${gameId}`, headers: { cookie: adminCookie }, payload: { settings: { rules: { attackDays: 21 } } } });
    expect(r.statusCode).toBe(200);
    expect(r.json().game.settings.rules.attackDays).toBe(21);
    const back = await app.inject({ method: "PATCH", url: `/api/games/${gameId}`, headers: { cookie: adminCookie }, payload: { settings: { rules: { attackDays: 14 } } } });
    expect(back.json().game.settings.rules.attackDays).toBe(14);
    expect(back.json().game.settings.rules.minBid).toBe(10);
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
    await post(`/api/games/${gameId}/battles/${battleId}/entries`, p3Cookie, { verses, links: ["https://example.com/b"] });
    expect((await post(`/api/games/${gameId}/battles/${battleId}/submit`, p2Cookie)).statusCode).toBe(200);
    const before = await prisma.battle.findUniqueOrThrow({ where: { id: battleId } });
    // Отправка была «десять минут назад»: возврат записи вернёт эти десять минут.
    await prisma.battle.update({ where: { id: battleId }, data: { attackDoneAt: new Date(Date.now() - 600_000), startedAt: new Date(Date.now() - 3_600_000) } });
    const entries = await entriesOf(battleId);
    const rej = await post(`/api/games/${gameId}/battles/${battleId}/entries/${entries[0]!.id}/decide`, adminCookie, { approve: false, comment: "плохо слышно" });
    expect(rej.statusCode).toBe(200);
    const after = await prisma.battle.findUniqueOrThrow({ where: { id: battleId } });
    expect(after.attackDoneAt).toBeNull();
    expect(after.attackPausedMs).toBeGreaterThan(590_000);
    expect(after.attackDeadline!.getTime() - before.attackDeadline!.getTime()).toBeGreaterThan(590_000);
    // Уступить город нельзя — такого действия нет.
    expect((await post(`/api/games/${gameId}/battles/${battleId}/surrender`, p1Cookie)).statusCode).toBe(404);
    // Пересдача и отправка: T = (отправка − старт) − пауза ≈ 60 мин − 10 мин.
    await post(`/api/games/${gameId}/battles/${battleId}/entries`, p2Cookie, { verses, links: ["https://example.com/a2"] });
    expect((await post(`/api/games/${gameId}/battles/${battleId}/submit`, p2Cookie)).statusCode).toBe(200);
    for (const e of await entriesOf(battleId)) await post(`/api/games/${gameId}/battles/${battleId}/entries/${e.id}/decide`, adminCookie, { approve: true });
    const def = await prisma.battle.findUniqueOrThrow({ where: { id: battleId } });
    expect(def.status).toBe("DEFENSE");
    const T = def.defenseDeadline!.getTime() - def.attackApprovedAt!.getTime();
    expect(Math.abs(T - 3_000_000)).toBeLessThan(10_000);
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
    const node = await prisma.mapNode.findUniqueOrThrow({ where: { gameId_key: { gameId, key: rutKey } } });
    expect(node.defenseLevel).toBe(10);
    expect((await prisma.team.findUniqueOrThrow({ where: { id: team1 } })).status).toBe("active");
  });

  it("выученные раньше стихи засчитываются хранителям сами; закрепления без максимума нет", async () => {
    // «Моряки» бросают вызов «Берегу» на Руфь: ставка 11. У «Берега» уже принято 20 единиц этой книги (по 10 у двоих).
    const res = await post(`/api/games/${gameId}/my-city/${rutKey}/war`, p1Cookie, { bid: 11 });
    expect(res.statusCode).toBe(201);
    const id = res.json().id as string;
    await prisma.mapNode.update({ where: { gameId_key: { gameId, key: rutKey } }, data: { sumMode: true } });
    await prisma.battle.update({ where: { id }, data: { sumMode: true } });
    const w = await get(`/api/games/${gameId}/my-city/${rutKey}/war`, p1Cookie);
    const { start } = w.json().battles[0].passage as { start: number };
    await post(`/api/games/${gameId}/battles/${id}/entries`, p1Cookie, { verses: Array.from({ length: 11 }, (_, i) => start + i), links: ["https://example.com/m"] });
    await post(`/api/games/${gameId}/battles/${id}/submit`, p1Cookie);
    for (const e of await entriesOf(id)) await post(`/api/games/${gameId}/battles/${id}/entries/${e.id}/decide`, adminCookie, { approve: true });
    const b = await prisma.battle.findUniqueOrThrow({ where: { id }, include: { entries: true } });
    // Зачтённых стихов (20) хватило на ставку 11: ответ дан без единого нового стиха.
    expect(b.status).toBe("REPELLED");
    expect(b.defenseBid).toBe(20);
    expect(b.entries.filter((e) => e.side === "DEFENSE" && e.carried)).toHaveLength(2);
    const node = await prisma.mapNode.findUniqueOrThrow({ where: { gameId_key: { gameId, key: rutKey } } });
    expect(node.defenseLevel).toBe(20);
    expect(node.lockedUntil).toBeNull(); // максимум — 2 участника × 85 стихов — не достигнут
  });

  it("сгоревший вызов помечает следующий как «после сгорания»; письмо и штраф", async () => {
    const res = await post(`/api/games/${gameId}/my-city/${rutKey}/war`, p1Cookie, { bid: 21 });
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
    const hint = await post(`/api/games/${gameId}/my-city/${rutKey}/hint`, p3Cookie, { index: 0 });
    expect(hint.statusCode).toBe(200);
    const prophetView = await get(`/api/games/${gameId}/my-city/${rutKey}`, p3Cookie);
    expect(prophetView.json().state.hintTasks).toEqual([0]);
    const captainView = await get(`/api/games/${gameId}/my-city/${rutKey}`, p2Cookie);
    expect(captainView.json().state.hintTasks).toEqual([]);
    expect((await get(`/api/games/${gameId}/my-city/${rutKey}/hint/0`, p2Cookie)).statusCode).toBe(403);
    expect((await get(`/api/games/${gameId}/my-city/${rutKey}/hint/0`, p3Cookie)).json().text.length).toBeGreaterThan(0);
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
    const created = await post(`/api/games/${gameId}/deeds`, adminCookie, { title: "Дело издалека", direction: "Посещение", proofType: "CONFIRMATION", remote: true, siegePoints: 3 });
    expect(created.statusCode).toBe(201);
    expect(created.json().deed).toMatchObject({ proofType: "REPORT", remote: true, siegePoints: 3 });
    // Среди свободных сторон всегда есть дело «издалека».
    const map2 = await get(`/api/games/${gameId}/my-map`, p2Cookie);
    expect((map2.json().tasks as Array<{ status: string; deed: { remote?: boolean } }>).some((x) => x.status === "OPEN" && x.deed.remote)).toBe(true);
  });
});
