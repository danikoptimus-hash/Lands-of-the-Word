import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { cleanupFixtures, readyForStart, registerVerified } from "./testAuth.js";
import { checkSeaAnswer, countStem, loadSeaContent, publicSeaTask, verseWords } from "./services/seas.js";
import { loadBook } from "./services/bible.js";

/**
 * Моря Библии (решение владельца 06.10): внутренние моря на карте, вахты-головоломки с личным зачётом, открытие
 * моря по правилу «половина команды — половину вахт» и переправа на противоположный берег один раз.
 */
const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now();
const adminNick = `wadm_${stamp}`, capNick = `wcap_${stamp}`, memNick = `wmem_${stamp}`, p2Nick = `wp2_${stamp}`;
let adminCookie = "", capCookie = "", memCookie = "", p2Cookie = "", gameId = "", team1 = "";
const secret = "test-secret-please";

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

beforeAll(async () => {
  await app.ready();
  adminCookie = await register(adminNick); capCookie = await register(capNick); memCookie = await register(memNick); p2Cookie = await register(p2Nick);
  await prisma.user.update({ where: { nickname: adminNick }, data: { platformRole: "SUPERADMIN" } });
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

describe("контент морей", () => {
  it("у всех шести морей по десять вахт, ответы считаются по Синодальному тексту", async () => {
    for (const code of ["great", "red", "salt", "merom", "galilee", "adria"]) {
      const c = await loadSeaContent(code);
      expect(c, code).not.toBeNull();
      expect(c!.tasks).toHaveLength(10);
      const types = new Set(c!.tasks.map((t) => t.type));
      for (const need of ["beacon", "wordpath", "flags", "storm", "count"]) expect(types.has(need), `${code}: ${need}`).toBe(true);
    }
    const red = (await loadSeaContent("red"))!;
    const count = red.tasks.find((t) => t.type === "count")!;
    expect(await countStem(count as never)).toBeGreaterThanOrEqual(3);
    expect(verseWords("И простер Моисей руку свою на море, — и расступились воды.")).toEqual(["И", "простер", "Моисей", "руку", "свою", "на", "море", "и", "расступились", "воды"]);
  });

  it("маяк, флаги, курс и шторм: у команды свои данные, а верный ответ сходится с текстом", async () => {
    const red = (await loadSeaContent("red"))!;
    const scopeA = "teamA|sea:red", scopeB = "teamB|sea:red";
    const beaconIdx = red.tasks.findIndex((t) => t.type === "beacon"), beacon = red.tasks[beaconIdx]! as Extract<typeof red.tasks[number], { type: "beacon" }>;
    const pa = await publicSeaTask(beacon, beaconIdx, secret, scopeA) as { signal: { long: number; short: number } };
    const verse = pa.signal.long * 10 + pa.signal.short;
    expect(beacon.verses).toContain(verse);
    const book = (await loadBook("exo"))!;
    const words = verseWords(book.chapters![13]![verse - 1]!);
    expect(await checkSeaAnswer(beacon, beaconIdx, secret, scopeA, words[words.length - 1]!.toUpperCase())).toBe(true);
    expect(await checkSeaAnswer(beacon, beaconIdx, secret, scopeA, "нет")).toBe(false);
    // Флаги: сообщение и азбука у команды, ответ — слово стиха, на который они указывают.
    const flagsIdx = red.tasks.findIndex((t) => t.type === "flags"), flags = red.tasks[flagsIdx]!;
    const pf = await publicSeaTask(flags, flagsIdx, secret, scopeA) as { cribs: Array<{ label: string; flags: Array<string | null> }>; message: Array<string | null> };
    expect(pf.cribs.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(pf)).not.toMatch(/"digit"|"key"/);
    // Азбука восстанавливается по подписанным сигналам: подпись «Исход 15:4» и вымпелы дают цифру каждого вымпела.
    const alphabet = new Map<string, string>();
    for (const c of pf.cribs) { const digits = c.label.replace(/^\D+/, "").replace(":", ""); c.flags.filter((f) => f).forEach((f, i) => alphabet.set(f!, digits[i]!)); }
    const digits = pf.message.map((f) => (f ? alphabet.get(f) ?? "?" : ":")).join("");
    expect(digits).not.toContain("?");
    const [ch, v] = digits.split(":").map(Number);
    expect(ch).toBe(15);
    const fw = verseWords(book.chapters![ch! - 1]![v! - 1]!);
    expect(await checkSeaAnswer(flags, flagsIdx, secret, scopeA, fw[0]!)).toBe(true);
    // Курс по словам: путь из соседних клеток, у другой команды другая сетка.
    const wpIdx = red.tasks.findIndex((t) => t.type === "wordpath"), wp = red.tasks[wpIdx]!;
    const pw = await publicSeaTask(wp, wpIdx, secret, scopeA) as { rows: number; cols: number; count: number; cells: Array<{ id: string; text: string }> };
    const pw2 = await publicSeaTask(wp, wpIdx, secret, scopeB) as { cells: Array<{ id: string; text: string }> };
    expect(pw.cells).toHaveLength(pw.rows * pw.cols);
    expect(pw.cells.map((c) => c.text).join()).not.toBe(pw2.cells.map((c) => c.text).join());
    const target = verseWords(book.chapters![13]![20]!).slice(0, 10);
    expect(pw.count).toBe(10);
    // Восстанавливаем путь по словам стиха: с первого слова, каждое следующее — в соседней клетке.
    const idx = (id: string) => pw.cells.findIndex((c) => c.id === id);
    const adj = (a: number, b: number) => Math.abs(Math.floor(a / pw.cols) - Math.floor(b / pw.cols)) + Math.abs((a % pw.cols) - (b % pw.cols)) === 1;
    const walk = (path: string[]): string[] | null => {
      if (path.length === target.length) return path;
      const want = target[path.length]!;
      for (const c of pw.cells) {
        if (c.text !== want || path.includes(c.id)) continue;
        if (path.length && !adj(idx(path[path.length - 1]!), idx(c.id))) continue;
        const r = walk([...path, c.id]); if (r) return r;
      }
      return null;
    };
    const path = walk([]);
    expect(path).not.toBeNull();
    expect(await checkSeaAnswer(wp, wpIdx, secret, scopeA, path)).toBe(true);
    expect(await checkSeaAnswer(wp, wpIdx, secret, scopeA, [...path!].reverse())).toBe(false);
    // Шторм: слова стиха по порядку, одинаковые слова взаимозаменяемы.
    const stIdx = red.tasks.findIndex((t) => t.type === "storm"), st = red.tasks[stIdx]!;
    const ps = await publicSeaTask(st, stIdx, secret, scopeA) as { items: Array<{ id: string; text: string }> };
    const exoWords = verseWords(book.chapters![14]![0]!);
    const ordered: string[] = [];
    for (const w of exoWords) ordered.push(ps.items.find((i) => i.text === w && !ordered.includes(i.id))!.id);
    expect(await checkSeaAnswer(st, stIdx, secret, scopeA, ordered)).toBe(true);
    expect(await checkSeaAnswer(st, stIdx, secret, scopeA, ps.items.map((i) => i.id))).toBe(ps.items.every((i, k) => i.text === exoWords[k]));
  });
});

describe("моря на карте и переправа", () => {
  let seaCode = "", shoreKey = "";
  it("карта: Великое море видно сразу, внутреннее — после выхода на берег; вахты закрыты, пока берег не достигнут", async () => {
    const hexes = await prisma.mapHex.findMany({ where: { gameId, sea: { not: null } }, select: { sea: true } });
    expect(hexes).toHaveLength(5);
    const map = await myMap();
    // Великое море видно всегда; внутреннее — только если старт команды оказался на его берегу.
    const startShore = await prisma.mapNode.findFirst({ where: { gameId, key: map.team.startNodeKey }, select: { sea: true } });
    expect(map.seas.map((s: { code: string }) => s.code).sort()).toEqual(["great", ...(startShore?.sea ? [startShore.sea] : [])].sort());
    // Берег внутреннего моря на острове Ветхого Завета, которого команда ещё не видела, — открываем узел администратором (тестовое действие).
    const shore = await prisma.mapNode.findFirst({ where: { gameId, island: "OT", sea: { not: null, ...(startShore?.sea ? { not: startShore.sea } : {}) }, kind: "EMPTY" } });
    expect(shore).not.toBeNull();
    seaCode = shore!.sea!; shoreKey = shore!.key;
    expect((await mySea(seaCode)).json().reached).toBe(false);
    const r = await app.inject({ method: "POST", url: `/api/games/${gameId}/my-sea/${seaCode}/tasks/0/answer`, headers: { cookie: capCookie }, payload: { answer: "x" } });
    expect(r.statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/api/games/${gameId}/teams/${team1}/reveal`, headers: { cookie: adminCookie }, payload: { nodeKey: shoreKey } })).statusCode).toBe(200);
    const map2 = await myMap();
    const sea = map2.seas.find((s: { code: string }) => s.code === seaCode);
    expect(sea).toBeTruthy();
    expect(sea.reached).toBe(true);
    expect(sea.total).toBe(10);
    const s = (await mySea(seaCode)).json();
    expect(s.reached).toBe(true);
    expect(s.content.tasks).toHaveLength(10);
    expect(JSON.stringify(s.content)).not.toMatch(/"answers?"|"correct"|"path"/);
  });

  it("вахты: верный ответ засчитывает вахту команде, личный зачёт у каждого; море открывается по доле состава", async () => {
    const s = (await mySea(seaCode)).json();
    const numberTask = s.content.tasks.find((x: { type: string }) => x.type === "number");
    const content = (await loadSeaContent(seaCode))!;
    const answer = (content.tasks[numberTask.index] as { answer: number }).answer;
    const wrong = await app.inject({ method: "POST", url: `/api/games/${gameId}/my-sea/${seaCode}/tasks/${numberTask.index}/answer`, headers: { cookie: capCookie }, payload: { answer: answer + 1 } });
    expect(wrong.json().correct).toBe(false);
    expect(wrong.json().retryAt).toBeGreaterThan(Date.now());
    // Пауза: сразу второй ответ не принимается.
    expect((await app.inject({ method: "POST", url: `/api/games/${gameId}/my-sea/${seaCode}/tasks/${numberTask.index}/answer`, headers: { cookie: capCookie }, payload: { answer } })).statusCode).toBe(429);
    await prisma.teamTaskLock.updateMany({ where: { teamId: team1, nodeKey: `sea:${seaCode}` }, data: { lockedUntil: null } });
    const ok = await app.inject({ method: "POST", url: `/api/games/${gameId}/my-sea/${seaCode}/tasks/${numberTask.index}/answer`, headers: { cookie: capCookie }, payload: { answer } });
    expect(ok.json()).toMatchObject({ correct: true, personal: false, opened: false });
    // Участник решает ту же вахту для своего зачёта.
    const ok2 = await app.inject({ method: "POST", url: `/api/games/${gameId}/my-sea/${seaCode}/tasks/${numberTask.index}/answer`, headers: { cookie: memCookie }, payload: { answer } });
    expect(ok2.json()).toMatchObject({ correct: true, personal: true });
    const s2 = (await mySea(seaCode, memCookie)).json();
    expect(s2.state.doneTasks).toEqual([numberTask.index]);
    expect(s2.state.mySolved).toEqual([numberTask.index]);
    expect(s2.state.openedAt).toBeNull();
  });

  it("переправа: только из открытого моря, кормчий или капитан, со своего берега на противоположный, один раз", async () => {
    const forbidden = await app.inject({ method: "POST", url: `/api/games/${gameId}/my-sea/${seaCode}/cross`, headers: { cookie: capCookie }, payload: { from: shoreKey, to: shoreKey } });
    expect(forbidden.statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: `/api/games/${gameId}/seas/${seaCode}/study`, headers: { cookie: adminCookie }, payload: { teamId: team1 } })).statusCode).toBe(200);
    const s = (await mySea(seaCode)).json();
    expect(s.state.openedAt).not.toBeNull();
    expect(s.crossing.canCross).toBe(true);
    expect(s.crossing.from).toContain(shoreKey);
    const candidates: string[] = s.crossing.candidates[shoreKey];
    expect(candidates.length).toBeGreaterThan(0);
    for (const k of candidates) { const n = await prisma.mapNode.findUniqueOrThrow({ where: { gameId_key: { gameId, key: k } } }); expect(n.sea).toBe(seaCode); }
    // Свой же берег — нельзя; участник без роли — нельзя.
    const same = await app.inject({ method: "POST", url: `/api/games/${gameId}/my-sea/${seaCode}/cross`, headers: { cookie: capCookie }, payload: { from: shoreKey, to: shoreKey } });
    expect(same.statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: `/api/games/${gameId}/my-sea/${seaCode}/cross`, headers: { cookie: memCookie }, payload: { from: shoreKey, to: candidates[0] } })).statusCode).toBe(403);
    const ok = await app.inject({ method: "POST", url: `/api/games/${gameId}/my-sea/${seaCode}/cross`, headers: { cookie: capCookie }, payload: { from: shoreKey, to: candidates[0] } });
    expect(ok.statusCode).toBe(200);
    const map = await myMap();
    expect(map.revealed.some((n: { key: string }) => n.key === candidates[0])).toBe(true);
    expect(map.seas.find((x: { code: string }) => x.code === seaCode).crossed).toBe(true);
    const again = await app.inject({ method: "POST", url: `/api/games/${gameId}/my-sea/${seaCode}/cross`, headers: { cookie: capCookie }, payload: { from: shoreKey, to: candidates[1] ?? candidates[0] } });
    expect(again.statusCode).toBe(409);
    const adminView = await app.inject({ method: "GET", url: `/api/games/${gameId}/seas/${seaCode}`, headers: { cookie: adminCookie } });
    expect(adminView.statusCode).toBe(200);
    expect(adminView.json().teams.find((x: { id: string }) => x.id === team1).crossTo).toBe(candidates[0]);
    const list = await app.inject({ method: "GET", url: `/api/games/${gameId}/seas`, headers: { cookie: adminCookie } });
    expect(list.json().seas.length).toBeGreaterThanOrEqual(6);
  });
});
