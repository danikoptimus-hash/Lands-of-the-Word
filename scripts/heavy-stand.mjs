/**
 * Тяжёлая тестовая партия для замера плавности карты (запрос владельца 04.11: «дополнительная сессия на тестовом
 * стенде с большим количеством ходов по карте и морских маршрутов»). Создаёт на стенде новую партию из тех же
 * тестовых ботов, что в scripts/seed-stand.mjs (три команды tg_m*, tg_b*, tg_p*), запускает её и быстро «проходит»
 * много сторон: боты берут дорожные дела, сдают, администратор одобряет; открытые города решаются и берутся, взятые
 * порты дают морские дела, после их приёма кормчий высаживается на другой остров — так появляются морские пути и
 * новые берега. Другие партии стенда («Осень (тест)») скрипт не трогает.
 *
 * Запуск (на стенде вход за бота идёт тем же /api/dev/become, что и панель тестового входа; пароль не нужен):
 *   HG_BASE=https://test.<домен> node scripts/heavy-stand.mjs
 * Локально (без /api/dev/*): HG_BASE=http://localhost:3000 HG_PASS=<пароль ботов> node scripts/heavy-stand.mjs
 * Переменные: HG_NAME — имя партии (по умолчанию «Замер плавности (тест)»), HG_SEED — зерно карты, HG_EDGES — сколько
 * дорожных сторон пройти каждой команде (70), HG_ROUNDS — предел кругов (300). Ники и пароль в репозитории не хранятся.
 * Сроки на время прохода ускорены и пояс сдвинут на «утро» (ночью дела не сдаются); в конце пояс возвращается к
 * обычному, остальные ускоренные сроки остаются — партия только для замера.
 */
import { readFileSync } from "node:fs";
const BASE = (process.env.HG_BASE ?? "https://test.landsoftheword.com").replace(/\/$/, "");
const NAME = process.env.HG_NAME ?? "Замер плавности (тест)";
const SEED = Number(process.env.HG_SEED ?? Math.floor(Math.random() * 1e9));
const EDGES = Number(process.env.HG_EDGES ?? 70), ROUNDS = Number(process.env.HG_ROUNDS ?? 300);
const PASS = process.env.HG_PASS;
const CONTENT = new URL("../content/cities/", import.meta.url).pathname;

const TEAMS = [
  { name: "Моряки", nicks: ["tg_m1", "tg_m2", "tg_m3", "tg_m4", "tg_m5", "tg_m6"] },
  { name: "Берег", nicks: ["tg_b1", "tg_b2", "tg_b3", "tg_b4", "tg_b5", "tg_b6"] },
  { name: "Пустыня", nicks: ["tg_p1", "tg_p2", "tg_p3", "tg_p4", "tg_p5", "tg_p6"] },
];
const ADMIN = "tg_admin";
const ALL = [ADMIN, ...TEAMS.flatMap((t) => t.nicks)];
const cookies = new Map();
const S = { gameId: "", nodes: [], edges: [], teams: new Map(), users: new Map(), skipCities: new Set() };

function zoneForLocalHour(hour, now = new Date()) { let n = ((hour - now.getUTCHours()) % 24 + 24) % 24; if (n > 14) n -= 24; return n === 0 ? "Etc/GMT" : n > 0 ? `Etc/GMT-${n}` : `Etc/GMT+${-n}`; }
const rulesFast = { timeZone: zoneForLocalHour(7), minBid: 10, attackDays: 0.02, burnPenalty: 5, minAnswerSeconds: 120, passageDays: 0.02, lockWeeks: 0.002, deedReturnDays: 0.02, roleChangeDays: 0, roleCooldownDays: 0.001, pauseSteps: [3, 5, 10], siegeDays: 0.02, siegeDeedPoints: 1, chronicleWeekday: 0, chronicleHourUtc: 0, adminDigest: "instant",
  // Ключ города — когда задания решила доля состава (решение владельца 05.10): для быстрого прохода достаточно одного решившего.
  keySolversPct: 10, keyTasksPct: 10 };

async function raw(nick, method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json", cookie: cookies.get(nick) ?? "" }, body: body === undefined ? (method === "POST" ? "{}" : undefined) : JSON.stringify(body) });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
}
async function api(nick, method, path, body) {
  const r = await raw(nick, method, path, body);
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${typeof r.body === "string" ? r.body.slice(0, 160) : r.body?.message ?? JSON.stringify(r.body).slice(0, 200)}`);
  return r.body;
}
const get = (n, p) => api(n, "GET", p);
const post = (n, p, b) => api(n, "POST", p, b);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function login(nick, attempt = 0) {
  const r = PASS
    ? await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nickname: nick, password: PASS }) })
    : await fetch(BASE + "/api/dev/become", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nickname: nick }) });
  // Вход ограничен по частоте (429): ждём и пробуем снова, между входами — пауза.
  if (r.status === 429 && attempt < 8) { await sleep(3000 * (attempt + 1)); return login(nick, attempt + 1); }
  if (r.status !== 200) throw new Error(`вход за ${nick}: ${r.status}${PASS ? "" : " (/api/dev/become есть только на стенде; локально задайте HG_PASS)"}`);
  await sleep(400);
  cookies.set(nick, (r.headers.get("set-cookie") ?? "").split(";")[0]);
}
const say = (s) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`);

/* ---------- Мир ---------- */
async function loadWorld() { const g = await get(ADMIN, `/api/games/${S.gameId}`); S.nodes = g.nodes; S.edges = g.edges; }
const nodeOf = (key) => S.nodes.find((n) => n.key === key);
const content = (book) => JSON.parse(readFileSync(`${CONTENT}${book}.json`, "utf8"));
async function refreshTeams() {
  const r = await get(ADMIN, `/api/games/${S.gameId}/teams`);
  for (const t of r.teams) { const spec = TEAMS.find((x) => x.name === t.name); if (spec) { S.teams.set(spec.name, t); for (const m of t.members) S.users.set(m.user.nickname, m.user.id); } }
}
const cap = (T) => T.nicks[0], helm = (T) => T.nicks[5];
const myMap = (nick) => get(nick, `/api/games/${S.gameId}/my-map`);

/* ---------- Дела ---------- */
const links = (t) => (t.deed.proofType === "VIDEO_LINK" ? [`https://example.com/video/${t.id}`] : [`https://example.com/photo/${t.id}`]);
const note = (t) => (t.deed.proofType === "REPORT" ? "Что сделали: сходили и помогли. Кому: соседям. Что услышали: благодарность." : "Сделали вместе, фото приложено.");
/** Взять дело участником, сдать с двумя товарищами, администратор одобряет. Неподходящее дело отпускается. */
async function doTask(T, t, i) {
  const who = T.nicks[1 + (i % 5)];
  const mates = T.nicks.filter((n) => n !== who).slice(0, 2).map((n) => S.users.get(n));
  try {
    await post(who, `/api/games/${S.gameId}/edge-tasks/${t.id}/take`);
    await post(who, `/api/games/${S.gameId}/edge-tasks/${t.id}/submit`, { links: links(t), note: note(t), participants: mates });
    await post(ADMIN, `/api/games/${S.gameId}/edge-tasks/${t.id}/decide`, { approve: true });
    return true;
  } catch (e) {
    say(`  ${T.name}: дело ${t.id} (${t.deed?.title ?? "?"}) не прошло: ${e.message.slice(0, 120)}`);
    await raw(who, "POST", `/api/games/${S.gameId}/edge-tasks/${t.id}/release`);
    return false;
  }
}
/** Дорожное дело: предпочитаем сторону к ещё не открытому перекрёстку — так фронтир растёт, а не топчется. */
async function roadStep(T, m, i) {
  const revealed = new Set(m.revealed.map((n) => n.key));
  const open = m.tasks.filter((t) => t.status === "OPEN" && !t.sea);
  if (!open.length) return false;
  open.sort((a, b) => Number(revealed.has(a.toKey)) - Number(revealed.has(b.toKey)));
  for (const t of open.slice(0, 3)) if (await doTask(T, t, i)) return true;
  return false;
}
/* ---------- Города ---------- */
function answerFor(src, pub) {
  if (src.type === "number") return String(src.answer);
  if (src.type === "text") return src.answers[0];
  if (src.type === "choice") return pub.options.indexOf(src.options[src.correct]);
  if (src.type === "order") return src.items.map((text) => pub.items.find((i) => i.text === text).id);
  if (src.type === "crossword") return pub.words.map((w) => src.words.find((x) => x.clue === w.clue).answer);
  return "";
}
const cityView = (nick, key) => get(nick, `/api/games/${S.gameId}/my-city/${encodeURIComponent(key)}`);
/** Решить открытый свободный город (порядок районов и все задания) и взять его. */
async function takeCity(T, key) {
  const node = nodeOf(key); if (!node?.bookCode) return false;
  let src; try { src = content(node.bookCode); } catch { S.skipCities.add(key); return false; }
  let c = await cityView(cap(T), key);
  if (!c.content) { S.skipCities.add(key); return false; }
  if (!c.state.orderSolved) {
    const ids = src.districts.map((d) => c.content.districts.find((x) => x.title === d.title)?.id);
    if (ids.some((x) => !x)) { S.skipCities.add(key); return false; }
    await post(cap(T), `/api/games/${S.gameId}/my-city/${encodeURIComponent(key)}/order`, { ids });
    c = await cityView(cap(T), key);
  }
  for (const pub of c.content.tasks) {
    if (c.state.doneTasks.includes(pub.index)) continue;
    const who = T.nicks[pub.index % T.nicks.length];
    await post(who, `/api/games/${S.gameId}/my-city/${encodeURIComponent(key)}/tasks/${pub.index}/answer`, { answer: answerFor(src.tasks[pub.index], pub) });
  }
  const cityKey = (await get(ADMIN, `/api/games/${S.gameId}/cities/${encodeURIComponent(key)}`)).node.cityKey;
  await post(cap(T), `/api/games/${S.gameId}/my-city/${encodeURIComponent(key)}/capture`, { key: cityKey });
  return true;
}
async function cityStep(T, m) {
  const owned = new Set((m.cities ?? []).filter((c) => c.owner).map((c) => c.nodeKey));
  const free = m.revealed.find((n) => n.kind === "CITY" && !owned.has(n.key) && !S.skipCities.has(n.key));
  if (!free) return false;
  try { const ok = await takeCity(T, free.key); if (ok) say(`  ${T.name}: взят город ${free.key} (${nodeOf(free.key)?.bookCode})`); return ok; }
  catch (e) { say(`  ${T.name}: город ${free.key} не взят: ${e.message.slice(0, 120)}`); S.skipCities.add(free.key); return false; }
}
/* ---------- Море ---------- */
async function seaStep(T, m, i) {
  const open = m.tasks.find((t) => t.sea && t.status === "OPEN");
  if (open && !(await doTask(T, open, i))) return false;
  const m2 = open ? await myMap(cap(T)) : m;
  const ready = m2.tasks.find((t) => t.sea && t.status === "APPROVED" && t.candidates?.length && t.toKey.startsWith("sea:"));
  if (!ready) return Boolean(open);
  const target = ready.candidates[Math.floor(Math.random() * ready.candidates.length)];
  try { await post(helm(T), `/api/games/${S.gameId}/edge-tasks/${ready.id}/land`, { nodeKey: target }); say(`  ${T.name}: высадка ${ready.fromKey} → ${target}`); return true; }
  catch (e) { say(`  ${T.name}: высадка не удалась: ${e.message.slice(0, 120)}`); return Boolean(open); }
}

async function main() {
  say(`Сервер: ${BASE}`);
  if (!PASS) for (const n of ALL) { const r = await fetch(BASE + "/api/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nickname: n, password: Math.random().toString(36).slice(2) + "Aa1", email: `${n}@example.com` }) }); if (r.status !== 201 && r.status !== 409) say(`  регистрация ${n}: ${r.status}`); }
  for (const n of ALL) await login(n);
  const g = await post(ADMIN, "/api/games", { name: NAME, teamCount: 3, settings: { equidistantStarts: true, maxStartDistanceDiff: 2 } });
  S.gameId = g.game.id; say(`Партия «${NAME}»: ${S.gameId}, зерно ${SEED}`);
  await post(ADMIN, `/api/games/${S.gameId}/generate`, { seed: SEED });
  for (const t of TEAMS) {
    const team = (await post(ADMIN, `/api/games/${S.gameId}/teams`, { name: t.name })).team;
    const capInv = await post(ADMIN, `/api/games/${S.gameId}/teams/${team.id}/invites`, { role: "CAPTAIN" });
    await post(t.nicks[0], `/api/invites/${capInv.invite.token}/accept`);
    const memInv = await post(ADMIN, `/api/games/${S.gameId}/teams/${team.id}/invites`, { role: "MEMBER" });
    for (const n of t.nicks.slice(1)) await post(n, `/api/invites/${memInv.invite.token}/accept`);
  }
  await refreshTeams();
  for (const t of TEAMS) {
    const team = S.teams.get(t.name);
    await api(cap(t), "PATCH", `/api/games/${S.gameId}/teams/${team.id}/members/${S.users.get(t.nicks[1])}`, { role: "DEPUTY" });
    for (const [gr, nick] of [["SCOUT", t.nicks[2]], ["PROPHET", t.nicks[3]], ["AMBASSADOR", t.nicks[4]], ["HELMSMAN", t.nicks[5]]]) await api(cap(t), "PATCH", `/api/games/${S.gameId}/teams/${team.id}/members/${S.users.get(nick)}`, { gameRole: gr });
  }
  for (const [label, kind] of [["Семья у вокзала", "FAMILY"], ["Бабушка с третьего этажа", "WIDOW"], ["Дедушка у рынка", "ELDER"]]) await post(ADMIN, `/api/games/${S.gameId}/recipients`, { label, kind });
  await post(ADMIN, `/api/games/${S.gameId}/deeds/import-default`);
  await api(ADMIN, "PATCH", `/api/games/${S.gameId}`, { settings: { rules: rulesFast } });
  await post(ADMIN, `/api/games/${S.gameId}/start`);
  await loadWorld(); await refreshTeams();
  say(`Старт: ${S.nodes.length} перекрёстков, ${S.edges.length} сторон, ${S.nodes.filter((n) => n.kind === "CITY").length} городов`);

  const done = new Set();
  for (let round = 0; round < ROUNDS && done.size < TEAMS.length; round++) {
    let progress = false;
    for (const T of TEAMS) {
      if (done.has(T.name)) continue;
      const m = await myMap(cap(T));
      const roads = m.tasks.filter((t) => t.status === "APPROVED" && !t.sea).length;
      if (roads >= EDGES) { done.add(T.name); continue; }
      const moved = (await seaStep(T, m, round)) || (await cityStep(T, m)) || (await roadStep(T, m, round));
      if (moved) progress = true; else { say(`  ${T.name}: ходов больше нет (${roads} сторон)`); done.add(T.name); }
    }
    if (round % 10 === 9) {
      const parts = [];
      for (const T of TEAMS) { const m = await myMap(cap(T)); parts.push(`${T.name}: дорог ${m.tasks.filter((t) => t.status === "APPROVED" && !t.sea).length}, морских ${m.tasks.filter((t) => t.sea && t.status === "APPROVED" && !t.toKey.startsWith("sea:")).length}, городов ${(m.cities ?? []).filter((c) => c.captured).length}`); }
      say(`круг ${round + 1}: ${parts.join(" · ")}`);
    }
    if (!progress) break;
  }
  await api(ADMIN, "PATCH", `/api/games/${S.gameId}`, { settings: { rules: { timeZone: "Asia/Tashkent" } } });
  const parts = [];
  for (const T of TEAMS) { const m = await myMap(cap(T)); parts.push(`${T.name}: дорог ${m.tasks.filter((t) => t.status === "APPROVED" && !t.sea).length}, морских путей ${m.tasks.filter((t) => t.sea && t.status === "APPROVED" && !t.toKey.startsWith("sea:")).length}, городов ${(m.cities ?? []).filter((c) => c.captured).length}, открыто перекрёстков ${m.revealed.length}`); }
  say(`Готово. ${parts.join(" · ")}`);
  say(`Карта команды: ${BASE}/games/${S.gameId}/team · администратор: ${BASE}/games/${S.gameId}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
