import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { cleanupFixtures, readyForStart, registerVerified } from "./testAuth.js";
import { assignScreens, checkSeaAnswer, loadSeaContent, publicSeaTask, simulateUnload, verseWords, type SeaContent, type TaskCtx } from "./services/seas.js";
import { loadBook } from "./services/bible.js";

/**
 * Моря Библии (решение владельца 06.10): внутренние моря на карте, десять вахт-головоломок второй редакции
 * (у команды свои данные, ответы считает сервер), командные вахты по экранам ролей с зачётом всем, кто держал
 * экран, открытие моря по правилу «половина команды — половину вахт» и переправа один раз.
 */
const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now();
const adminNick = `wadm_${stamp}`, capNick = `wcap_${stamp}`, memNick = `wmem_${stamp}`, p2Nick = `wp2_${stamp}`;
let adminCookie = "", capCookie = "", memCookie = "", p2Cookie = "", gameId = "", team1 = "", capId = "", memId = "";
const secret = "test-secret-please";
const ctx = (userId = "u1", members: TaskCtx["members"] = [{ userId: "u1", nickname: "a", role: "CAPTAIN", gameRole: "NONE" }], progress: string[] = []): TaskCtx => ({ userId, members, progress });

async function register(nickname: string) {
  const res = await registerVerified(app, { nickname, password: "secret123" });
  return res.headers["set-cookie"] as string;
}
async function joinTeam(name: string, cookie: string, role: "CAPTAIN" | "MEMBER", teamId?: string) {
  const id = teamId ?? (await app.inject({ method: "POST", url: `/api/games/${gameId}/teams`, headers: { cookie: adminCookie }, payload: { name } })).json().team.id as string;
  const inv = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams/${id}/invites`, headers: { cookie: adminCookie }, payload: { role } });
  await app.inject({ method: "POST", url: `/api/invites/${inv.json().invite.token}/accept`, headers: { cookie } });
  return id;
}
const myMap = async (cookie = capCookie) => (await app.inject({ method: "GET", url: `/api/games/${gameId}/my-map`, headers: { cookie } })).json();
const mySea = async (code: string, cookie = capCookie) => app.inject({ method: "GET", url: `/api/games/${gameId}/my-sea/${code}`, headers: { cookie } });
const answer = (code: string, index: number, value: unknown, cookie = capCookie) => app.inject({ method: "POST", url: `/api/games/${gameId}/my-sea/${code}/tasks/${index}/answer`, headers: { cookie }, payload: { answer: value } });

beforeAll(async () => {
  await app.ready();
  adminCookie = await register(adminNick); capCookie = await register(capNick); memCookie = await register(memNick); p2Cookie = await register(p2Nick);
  await prisma.user.update({ where: { nickname: adminNick }, data: { platformRole: "SUPERADMIN" } });
  capId = (await prisma.user.findUniqueOrThrow({ where: { nickname: capNick } })).id;
  memId = (await prisma.user.findUniqueOrThrow({ where: { nickname: memNick } })).id;
  const g = await app.inject({ method: "POST", url: "/api/games", headers: { cookie: adminCookie }, payload: { name: "Моря", teamCount: 2 } });
  gameId = g.json().game.id;
  expect((await app.inject({ method: "POST", url: `/api/games/${gameId}/generate`, headers: { cookie: adminCookie } })).statusCode).toBe(200);
  team1 = await joinTeam("Моряки", capCookie, "CAPTAIN");
  await joinTeam("", memCookie, "MEMBER", team1);
  await joinTeam("Берег", p2Cookie, "CAPTAIN");
  await app.inject({ method: "POST", url: `/api/games/${gameId}/deeds/import-default`, headers: { cookie: adminCookie } });
  await readyForStart(app, gameId, adminCookie);
  expect((await app.inject({ method: "POST", url: `/api/games/${gameId}/start`, headers: { cookie: adminCookie } })).statusCode).toBe(200);
});
afterAll(async () => {
  await prisma.game.deleteMany({ where: { id: gameId } });
  await prisma.user.deleteMany({ where: { nickname: { in: [adminNick, capNick, memNick, p2Nick] } } });
  await cleanupFixtures(gameId);
  await app.close(); await prisma.$disconnect();
});

const ORDER = ["lights", "disc", "fonts", "diff", "torn", "bearings", "reckoning", "unload", "panel", "roster"];
type Pub = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const pub = (c: SeaContent, i: number, scope: string, cx = ctx()) => publicSeaTask(c.tasks[i]!, i, secret, scope, c.chart, cx) as Promise<Pub>;
const check = (c: SeaContent, i: number, scope: string, a: unknown, progress: string[] = []) => checkSeaAnswer(c.tasks[i]!, i, secret, scope, c.chart, a, progress);

describe("контент морей", () => {
  it("у пяти морей по десять вахт в одном порядке, карта с местами, ответы на клиент не уходят", async () => {
    for (const code of ["red", "salt", "merom", "galilee", "adria"]) {
      const c = await loadSeaContent(code);
      expect(c, code).not.toBeNull();
      expect(c!.tasks.map((t) => t.type)).toEqual(ORDER);
      expect(c!.chart.places.length).toBeGreaterThan(3);
      for (let i = 0; i < 10; i++) {
        const p = JSON.stringify(await pub(c!, i, "teamA|sea:" + code));
        expect(p, `${code} ${i}`).not.toMatch(/"answers?"|"solution"|"target":\{|"end"|"word":"[А-Яа-я]/);
      }
    }
    expect(verseWords("И простер Моисей руку свою на море, — и расступились воды.")).toEqual(["И", "простер", "Моисей", "руку", "свою", "на", "море", "и", "расступились", "воды"]);
  });

  it("маяк: названный огонь и слово стиха с номером, равным его периоду", async () => {
    const c = (await loadSeaContent("adria"))!;
    const p = await pub(c, 0, "A|sea:adria");
    const task = c.tasks[0] as Extract<SeaContent["tasks"][number], { type: "lights" }>;
    const target = task.lights.find((l) => l.name === p.target)!;
    const light = p.lights.find((l: Pub) => l.kind === target.kind && l.period === target.period)!;
    const book = (await loadBook("act"))!;
    const words = verseWords(book.chapters![27]![target.period - 1]!);
    expect((await check(c, 0, "A|sea:adria", { light: light.id, word: words[words.length - 1] })).done).toBe(true);
    const other = p.lights.find((l: Pub) => l.id !== light.id)!;
    expect((await check(c, 0, "A|sea:adria", { light: other.id, word: words[words.length - 1] })).done).toBe(false);
    expect((await check(c, 0, "A|sea:adria", { light: light.id, word: "нет" })).done).toBe(false);
    expect(p.lights.length).toBe(task.lights.length + 1);
  });

  it("диск и две гарнитуры: кольцо и место шифра у команды свои, ответ — слово из Библии", async () => {
    const c = (await loadSeaContent("red"))!;
    const a = await pub(c, 1, "A|sea:red"), b = await pub(c, 1, "B|sea:red");
    expect(a.inner).not.toBe(b.inner);
    expect(a.inner.split("").sort().join("")).toBe(a.outer.split("").sort().join(""));
    // Расшифровка: буква на внутреннем кольце → буква над ней на внешнем при повороте на число промежутков.
    let offset = 0; let plain = "";
    for (const ch of a.cipher as Array<string | null>) { if (ch == null) { offset = (offset + 1) % 32; plain += " "; continue; } plain += a.outer[(a.inner.indexOf(ch) + offset) % 32]; }
    expect(plain).toBe((c.tasks[1] as { text: string }).text);
    expect((await check(c, 1, "A|sea:red", "елим")).done).toBe(true);
    expect((await check(c, 1, "A|sea:red", "Мерра")).done).toBe(false);
    const f = await pub(c, 2, "A|sea:red");
    const bits: number[] = f.page.flatMap((l: Pub) => l.glyphs).filter((g: [string, number]) => /[А-Яа-яЁё]/.test(g[0])).map((g: [string, number]) => g[1]);
    const first = bits.indexOf(1);
    expect(first).toBeGreaterThan(0);
    const word = (c.tasks[2] as { word: string }).word;
    const ones = [...word].reduce((n, ch) => n + "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ".indexOf(ch).toString(2).split("").filter((b) => b === "1").length, 0);
    expect(bits.reduce((n, v) => n + v, 0)).toBe(ones);
    expect((await check(c, 2, "A|sea:red", word.toLowerCase())).done).toBe(true);
  });

  it("что изменилось, обрывки карты, пеленги, счисление: ответы по геометрии", async () => {
    const c = (await loadSeaContent("galilee"))!;
    const d = await pub(c, 3, "A|sea:galilee");
    const key = (s: Pub) => `${s.x},${s.y}`;
    const before = new Map<string, Pub>(d.before.map((s: Pub) => [key(s), s])), after = new Map<string, Pub>(d.after.map((s: Pub) => [key(s), s]));
    const taps: Array<{ x: number; y: number }> = [];
    for (const [k, s] of after) if (before.get(k)?.sprite !== s.sprite) taps.push({ x: s.x, y: s.y });
    for (const [k, s] of before) if (!after.has(k)) taps.push({ x: s.x, y: s.y });
    expect(taps.length).toBe(d.count);
    expect((await check(c, 3, "A|sea:galilee", { taps })).done).toBe(true);
    expect((await check(c, 3, "A|sea:galilee", { taps: taps.slice(1) })).done).toBe(false);
    const t = await pub(c, 4, "A|sea:galilee");
    const pieces: Record<string, { x: number; y: number; rot: number }> = Object.fromEntries(t.pieces.map((p: Pub) => [p.id, { x: (p.col + 0.5) * (100 / t.cols), y: (p.row + 0.5) * (75 / t.rows), rot: 0 }]));
    const place = c.chart.places.find((p) => p.id === (c.tasks[4] as { place: string }).place)!;
    expect((await check(c, 4, "A|sea:galilee", { pieces, tap: { x: place.x, y: place.y } })).done).toBe(true);
    expect((await check(c, 4, "A|sea:galilee", { pieces, tap: { x: place.x + 30, y: place.y } })).done).toBe(false);
    const firstId = t.pieces[0].id as string;
    expect((await check(c, 4, "A|sea:galilee", { pieces: { ...pieces, [firstId]: { ...pieces[firstId]!, rot: 90 } }, tap: { x: place.x, y: place.y } })).done).toBe(false);
    // Пеленги: пересечение линий от ориентиров даёт клетку; у капитана экран ввода.
    const members: TaskCtx["members"] = [{ userId: "h", nickname: "h", role: "MEMBER", gameRole: "HELMSMAN" }, { userId: "s", nickname: "s", role: "MEMBER", gameRole: "SCOUT" }, { userId: "c", nickname: "c", role: "CAPTAIN", gameRole: "NONE" }];
    const bs = await pub(c, 5, "A|sea:galilee", ctx("s", members));
    expect(bs.screens).toEqual(["table"]);
    expect(bs.bearings.length).toBe(3);
    const bh = await pub(c, 5, "A|sea:galilee", ctx("h", members));
    expect(bh.screens).toEqual(["map"]); expect(bh.bearings).toEqual([]);
    const bc = await pub(c, 5, "A|sea:galilee", ctx("c", members));
    expect(bc.screens).toEqual(["input"]);
    const task5 = c.tasks[5] as Extract<SeaContent["tasks"][number], { type: "bearings" }>;
    const [l1, l2] = task5.landmarks.map((id) => c.chart.places.find((p) => p.id === id)!);
    const [b1, b2] = bs.bearings.map((b: Pub) => b.bearing as number);
    const dir = (deg: number) => ({ dx: Math.sin((deg * Math.PI) / 180), dy: -Math.cos((deg * Math.PI) / 180) });
    const d1 = dir(b1!), d2 = dir(b2!);
    const det = d1.dx * -d2.dy - -d2.dx * d1.dy;
    const k = ((l2!.x - l1!.x) * -d2.dy - -d2.dx * (l2!.y - l1!.y)) / det;
    const tx = l1!.x + d1.dx * k, ty = l1!.y + d1.dy * k;
    const cell = `${bs.letters[Math.floor(tx / (100 / task5.grid.cols))]}${Math.floor(ty / (75 / task5.grid.rows)) + 1}`;
    expect((await check(c, 5, "A|sea:galilee", { cell })).done).toBe(true);
    expect((await check(c, 5, "A|sea:galilee", { cell: "А1" })).done).toBe(cell === "А1");
    // Счисление: конец пути по переходам с сервера.
    const r = await pub(c, 6, "A|sea:galilee");
    let x = r.start.x, y = r.start.y;
    for (const leg of r.legs) { const a = (leg.course * Math.PI) / 180; x += Math.sin(a) * leg.miles * r.mile; y -= Math.cos(a) * leg.miles * r.mile; }
    expect((await check(c, 6, "A|sea:galilee", { x, y })).done).toBe(true);
    expect((await check(c, 6, "A|sea:galilee", { x: x + 20, y })).done).toBe(false);
  });

  it("разгрузка, прибор и устав, судовая роль: решение из контента, раунды и тройки", async () => {
    const c = (await loadSeaContent("merom"))!;
    const u = await pub(c, 7, "A|sea:merom");
    const task7 = c.tasks[7] as Extract<SeaContent["tasks"][number], { type: "unload" }>;
    const level = task7.levels.find((l) => l.map.join() === u.map.join())!;
    expect(simulateUnload(level, task7.kinds, level.solution!)).toBe(true);
    expect((await check(c, 7, "A|sea:merom", { moves: level.solution })).done).toBe(true);
    expect((await check(c, 7, "A|sea:merom", { moves: [...level.solution!].reverse().join("") })).done).toBe(false);
    expect((await check(c, 7, "A|sea:merom", { moves: "" })).done).toBe(false);
    // Прибор: раунды подряд, слово по первому подходящему правилу.
    const members: TaskCtx["members"] = [{ userId: "h", nickname: "h", role: "MEMBER", gameRole: "HELMSMAN" }, { userId: "c", nickname: "c", role: "CAPTAIN", gameRole: "NONE" }];
    const task8 = c.tasks[8] as Extract<SeaContent["tasks"][number], { type: "panel" }>;
    let progress: string[] = [];
    for (let round = 0; round < task8.rounds; round++) {
      const ph = await pub(c, 8, "A|sea:merom", ctx("h", members, progress));
      expect(ph.screens).toEqual(["panel"]); expect(ph.round).toBe(round); expect(ph.manual).toBeNull();
      const pc = await pub(c, 8, "A|sea:merom", ctx("c", members, progress));
      expect([...pc.screens].sort()).toEqual(["input", "manual"]); expect(pc.state).toBeNull();
      const rule = task8.rules.find((r) => Object.entries(r.when).every(([k, v]) => (ph.state as Pub)[k] === v))!;
      expect((await check(c, 8, "A|sea:merom", { word: "нет" }, progress)).ok).toBe(false);
      const res = await check(c, 8, "A|sea:merom", { word: rule.word }, progress);
      expect(res.ok).toBe(true);
      expect(res.done).toBe(round + 1 === task8.rounds);
      progress = res.progress ?? progress;
    }
    // Судовая роль: верные тройки подтверждаются без паузы, всё верно — вахта отстояна.
    const ro = await pub(c, 9, "A|sea:merom");
    const task9 = c.tasks[9] as Extract<SeaContent["tasks"][number], { type: "roster" }>;
    const right: Record<string, { who: string; then: string }> = Object.fromEntries(ro.cards.map((card: Pub) => { const src = task9.cards.find((x) => x.clue === card.clue)!; return [card.id, { who: src.who, then: src.then }]; }));
    const ids = Object.keys(right);
    const partial = Object.fromEntries(ids.map((id, i) => [id, i < 3 ? right[id] : { who: "x", then: "y" }]));
    const r1 = await check(c, 9, "A|sea:merom", { assign: partial });
    expect(r1).toMatchObject({ ok: true, done: false });
    expect(r1.progress).toHaveLength(3);
    const two = Object.fromEntries(ids.map((id, i) => [id, i < 2 ? right[id] : { who: "x", then: "y" }]));
    expect((await check(c, 9, "A|sea:merom", { assign: two })).ok).toBe(false);
    expect((await check(c, 9, "A|sea:merom", { assign: right }, r1.progress)).done).toBe(true);
    const seen = await pub(c, 9, "A|sea:merom", ctx("u", undefined, r1.progress));
    expect(seen.cards.filter((x: Pub) => x.confirmed).length).toBe(3);
  });

  it("экраны ролей: кормчему прибор, капитану ввод, двоим — никому не всё, одному — всё", () => {
    const task = { type: "panel" } as SeaContent["tasks"][number];
    const three = assignScreens(task, [{ userId: "a", nickname: "a", role: "CAPTAIN", gameRole: "NONE" }, { userId: "b", nickname: "b", role: "MEMBER", gameRole: "HELMSMAN" }, { userId: "c", nickname: "c", role: "MEMBER", gameRole: "CHRONICLER" }], "s");
    expect(three.get("b")).toEqual(["panel"]); expect(three.get("c")).toEqual(["manual"]); expect(three.get("a")).toEqual(["input"]);
    const two = assignScreens(task, [{ userId: "a", nickname: "a", role: "CAPTAIN", gameRole: "NONE" }, { userId: "b", nickname: "b", role: "MEMBER", gameRole: "SCOUT" }], "s");
    expect(two.get("b")).toEqual(["manual"]); expect([...two.get("a")!].sort()).toEqual(["input", "panel"]);
    const twoPlain = assignScreens(task, [{ userId: "a", nickname: "a", role: "CAPTAIN", gameRole: "NONE" }, { userId: "b", nickname: "b", role: "MEMBER", gameRole: "NONE" }], "s");
    expect([...twoPlain.values()].flat().sort()).toEqual(["input", "manual", "panel"]);
    expect([...twoPlain.values()].every((s) => !(s.includes("panel") && s.includes("manual")))).toBe(true);
    const one = assignScreens(task, [{ userId: "a", nickname: "a", role: "CAPTAIN", gameRole: "NONE" }], "s");
    expect(one.get("a")!.sort()).toEqual(["input", "manual", "panel"]);
    const five = assignScreens(task, ["a", "b", "c", "d", "e"].map((u) => ({ userId: u, nickname: u, role: u === "a" ? "CAPTAIN" : "MEMBER", gameRole: "NONE" })), "s");
    expect([...five.values()].filter((s) => s.includes("input")).length).toBe(1);
    expect(five.size).toBe(5);
  });
});

describe("моря на карте, вахты и переправа", () => {
  let seaCode = "", shoreKey = "";
  it("карта: море видно после выхода на берег; вахты закрыты, пока берег не достигнут", async () => {
    const hexes = await prisma.mapHex.findMany({ where: { gameId, sea: { not: null } }, select: { sea: true } });
    expect(hexes).toHaveLength(5);
    const map = await myMap();
    const startShore = await prisma.mapNode.findFirst({ where: { gameId, key: map.team.startNodeKey }, select: { sea: true } });
    expect(map.seas.map((s: { code: string }) => s.code).sort()).toEqual((startShore?.sea ? [startShore.sea] : []).sort());
    const shore = await prisma.mapNode.findFirst({ where: { gameId, island: "OT", sea: { not: null, ...(startShore?.sea ? { not: startShore.sea } : {}) }, kind: "EMPTY" } });
    expect(shore).not.toBeNull();
    seaCode = shore!.sea!; shoreKey = shore!.key;
    expect((await mySea(seaCode)).json().reached).toBe(false);
    expect((await answer(seaCode, 1, "x")).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/api/games/${gameId}/teams/${team1}/reveal`, headers: { cookie: adminCookie }, payload: { nodeKey: shoreKey } })).statusCode).toBe(200);
    const map2 = await myMap();
    const sea = map2.seas.find((s: { code: string }) => s.code === seaCode);
    expect(sea.reached).toBe(true);
    expect(sea.total).toBe(10);
    const s = (await mySea(seaCode)).json();
    expect(s.reached).toBe(true);
    expect(s.content.tasks).toHaveLength(10);
    expect(s.sea.chart.places.length).toBeGreaterThan(3);
    expect(JSON.stringify(s.content)).not.toMatch(/"answers?"|"solution"/);
  });

  it("одиночная вахта: неверно — пауза, верно — зачёт команде и личный зачёт каждому", async () => {
    const content = (await loadSeaContent(seaCode))!;
    const ok = (content.tasks[1] as { answers: string[] }).answers[0]!;
    const wrong = await answer(seaCode, 1, "нет");
    expect(wrong.json().correct).toBe(false);
    expect(wrong.json().retryAt).toBeGreaterThan(Date.now());
    expect((await answer(seaCode, 1, ok)).statusCode).toBe(429);
    await prisma.teamTaskLock.updateMany({ where: { teamId: team1, nodeKey: `sea:${seaCode}` }, data: { lockedUntil: null } });
    expect((await answer(seaCode, 1, ok)).json()).toMatchObject({ correct: true, personal: false, opened: false });
    expect((await answer(seaCode, 1, ok, memCookie)).json()).toMatchObject({ correct: true, personal: true });
    const s2 = (await mySea(seaCode, memCookie)).json();
    expect(s2.state.doneTasks).toEqual([1]);
    expect(s2.state.mySolved).toEqual([1]);
  });

  it("командная вахта: ввод только с экрана ввода, зачёт всем, кто держал экран", async () => {
    const content = (await loadSeaContent(seaCode))!;
    const sCap = (await mySea(seaCode)).json(), sMem = (await mySea(seaCode, memCookie)).json();
    const tCap = sCap.content.tasks[8], tMem = sMem.content.tasks[8];
    expect(tCap.team).toBe(true);
    expect(tCap.screens).toContain("input");
    // Двое: участник-разведчик держит устав, капитан — прибор и ввод (видящий прибор не читает устав).
    expect(tMem.screens).toEqual(["manual"]);
    expect([...tCap.screens].sort()).toEqual(["input", "panel"]);
    expect(tMem.manual).toBeTruthy(); expect(tMem.state).toBeNull(); expect(tCap.state).toBeTruthy();
    expect((await answer(seaCode, 8, { word: "x" }, memCookie)).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: `/api/games/${gameId}/my-sea/${seaCode}/hold`, headers: { cookie: memCookie }, payload: { taskIndex: 8 } })).json().ok).toBe(true);
    expect((await mySea(seaCode)).json().content.tasks[8].holders).toEqual([memNick]);
    const task8 = content.tasks[8] as Extract<SeaContent["tasks"][number], { type: "panel" }>;
    for (let round = 0; round < task8.rounds; round++) {
      const state = (await mySea(seaCode)).json().content.tasks[8].state;
      const rule = task8.rules.find((r) => Object.entries(r.when).every(([k, v]) => state[k] === v))!;
      const r = (await answer(seaCode, 8, { word: rule.word })).json();
      if (round + 1 < task8.rounds) expect(r).toMatchObject({ correct: false, accepted: true, round: round + 1 });
      else expect(r).toMatchObject({ correct: true, credited: 2 });
    }
    const events = await prisma.taskEvent.findMany({ where: { gameId, teamId: team1, nodeKey: `sea:${seaCode}`, taskIndex: 8, kind: "ok" }, select: { userId: true } });
    expect(events.map((e) => e.userId).sort()).toEqual([capId, memId].sort());
    expect((await mySea(seaCode, memCookie)).json().state.mySolved).toEqual([1, 8]);
    expect((await answer(seaCode, 8, { word: "x" })).statusCode).toBe(409);
  });

  it("переправа: только из открытого моря, кормчий или капитан, со своего берега на противоположный, один раз", async () => {
    const forbidden = await app.inject({ method: "POST", url: `/api/games/${gameId}/my-sea/${seaCode}/cross`, headers: { cookie: capCookie }, payload: { from: shoreKey, to: shoreKey } });
    expect(forbidden.statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: `/api/games/${gameId}/seas/${seaCode}/study`, headers: { cookie: adminCookie }, payload: { teamId: team1 } })).statusCode).toBe(200);
    const s = (await mySea(seaCode)).json();
    expect(s.state.openedAt).not.toBeNull();
    expect(s.crossing.canCross).toBe(true);
    const candidates: string[] = s.crossing.candidates[shoreKey];
    expect(candidates.length).toBeGreaterThan(0);
    expect((await app.inject({ method: "POST", url: `/api/games/${gameId}/my-sea/${seaCode}/cross`, headers: { cookie: memCookie }, payload: { from: shoreKey, to: candidates[0] } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/api/games/${gameId}/my-sea/${seaCode}/cross`, headers: { cookie: capCookie }, payload: { from: shoreKey, to: candidates[0] } })).statusCode).toBe(200);
    const map = await myMap();
    expect(map.revealed.some((n: { key: string }) => n.key === candidates[0])).toBe(true);
    expect((await app.inject({ method: "POST", url: `/api/games/${gameId}/my-sea/${seaCode}/cross`, headers: { cookie: capCookie }, payload: { from: shoreKey, to: candidates[1] ?? candidates[0] } })).statusCode).toBe(409);
    const adminView = await app.inject({ method: "GET", url: `/api/games/${gameId}/seas/${seaCode}`, headers: { cookie: adminCookie } });
    expect(adminView.statusCode).toBe(200);
    expect(adminView.json().content.tasks[1].answers).toBeTruthy();
    expect((await app.inject({ method: "GET", url: `/api/games/${gameId}/seas`, headers: { cookie: adminCookie } })).json().seas.length).toBe(5);
  });

  it("старые карты: озёрные гексы без кода получают имена морей по острову, берег помечается", async () => {
    await prisma.mapHex.updateMany({ where: { gameId }, data: { sea: null } });
    await prisma.mapNode.updateMany({ where: { gameId }, data: { sea: null } });
    const list = await app.inject({ method: "GET", url: `/api/games/${gameId}/seas`, headers: { cookie: adminCookie } });
    expect(list.json().seas.map((s: { code: string }) => s.code).sort()).toEqual(["adria", "galilee", "merom", "red", "salt"]);
    for (const sea of list.json().seas) expect(sea.shore.length).toBe(6);
  });
});
