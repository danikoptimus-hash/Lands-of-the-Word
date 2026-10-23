#!/usr/bin/env node
/**
 * Генератор нагрузки для стенда (решение владельца 23.10: «давай замерим на стенде, потом сделаем выводы»).
 * Запускается из workflow `loadtest` на машине GitHub Actions, не на сервере. Каждый виртуальный участник ведёт себя
 * как страница команды: открывает карту и соседние ответы, держит поток событий (SSE) и на каждое событие перечитывает
 * то же, что перечитывает настоящая страница (со склейкой: несколько событий за 2,5 с — одно перечитывание, как в клиенте
 * с 23.10); раз в минуту перечитывает карту. Часть участников берёт и сдаёт дела,
 * администратор принимает сдачи — каждое решение рассылает событие всем, и это главная нагрузка.
 *
 * Переменные: LT_BASE (адрес стенда), LT_SESSIONS (файл сессий из scripts/loadtest.js seed), LT_USERS (сколько участников
 * из файла поднять), LT_DURATION (секунд под нагрузкой после разгона), LT_RAMP (секунд разгона), LT_APPROVE_PER_MIN
 * (решений администратора в минуту), LT_TAKE_PER_MIN (сдач дел в минуту). Итог — таблица задержек по запросам;
 * при GITHUB_STEP_SUMMARY она же пишется в сводку запуска.
 */
import { readFile, appendFile } from "node:fs/promises";

const BASE = (process.env.LT_BASE ?? "https://test.landsoftheword.com").replace(/\/$/, "");
const N = Number(process.env.LT_USERS ?? 300);
const DURATION = Number(process.env.LT_DURATION ?? 300) * 1000;
const RAMP = Number(process.env.LT_RAMP ?? 120) * 1000;
const APPROVE_PER_MIN = Number(process.env.LT_APPROVE_PER_MIN ?? 6);
const TAKE_PER_MIN = Number(process.env.LT_TAKE_PER_MIN ?? 10);

const lines = (await readFile(process.env.LT_SESSIONS ?? "lt-sessions.txt", "utf8")).split("\n").filter(Boolean).map((l) => l.split("\t"));
const gameId = lines.find((l) => l[0] === "game")[1];
const admin = lines.find((l) => l[0] === "admin");
const users = lines.filter((l) => l[0] === "user").slice(0, N).map((l) => ({ nick: l[1], team: Number(l[2]), cookie: l[3] }));
if (!users.length) throw new Error("нет участников в файле сессий");

// ---- метрики ----
const stats = new Map(); // ключ запроса → { n, err, lat[] }
const counters = { sse: 0, sseOpened: 0, events: 0, reloads: 0, approved: 0, submitted: 0, expected409: 0 };
const keyOf = (path) => path.replace(gameId, ":id").replace(/edge-tasks\/[^/]+/, "edge-tasks/:t").replace(/\?.*$/, "");
function record(key, ms, ok) {
  let s = stats.get(key);
  if (!s) { s = { n: 0, err: 0, lat: [] }; stats.set(key, s); }
  s.n++; if (!ok) s.err++; s.lat.push(ms);
}
const pct = (a, q) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((q / 100) * s.length))]; };

let running = true;
async function req(cookie, method, path, body) {
  const t0 = performance.now();
  let ok = false, status = 0, json = null;
  try {
    const r = await fetch(BASE + path, { method, headers: { cookie, "content-type": "application/json", accept: "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
    status = r.status;
    const text = await r.text();
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    ok = r.status < 400;
  } catch { ok = false; }
  record(keyOf(path), performance.now() - t0, ok || status === 409);
  if (status === 409) counters.expected409++;
  return { ok, status, json };
}

// ---- виртуальный участник ----
const PAGE = ["/my-map", "/teams", "/standings", "/my-passages", "/peace", "/my-battles", "/feed"];
function reloadsFor(type) {
  const set = new Set();
  if (["teams", "game", "tasks"].includes(type)) set.add("/teams");
  if (type !== "deeds" && type !== "journal") set.add("/my-map");
  if (["cities", "game", "battles"].includes(type)) set.add("/my-passages");
  if (["battles", "game", "submissions"].includes(type)) set.add("/my-battles");
  if (["game", "cities", "battles", "teams"].includes(type)) set.add("/standings");
  if (["peace", "teams", "game"].includes(type)) set.add("/peace");
  if (["journal", "peace", "submissions", "cities", "battles", "game"].includes(type)) set.add("/feed");
  return [...set];
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const COALESCE_MS = Number(process.env.LT_COALESCE_MS ?? 2500);
async function runUser(u) {
  const g = (path) => req(u.cookie, "GET", `/api/games/${gameId}${path}`);
  // Склейка как в клиенте: по каждому пути один таймер; событие внутри окна новых запросов не добавляет.
  const timers = new Map();
  const later = (path) => { if (timers.has(path)) return; timers.set(path, setTimeout(() => { timers.delete(path); void g(path); }, COALESCE_MS)); };
  await Promise.all(PAGE.map(g));
  // Поток событий: держим, пока идёт прогон; при обрыве переподключаемся через 3 с, как браузер.
  const sse = (async () => {
    // id своей команды — из первого ответа /teams (в файле сессий только номер команды).
    const teams = await req(u.cookie, "GET", `/api/games/${gameId}/teams`);
    u.teamId = teams.json?.teams?.find((tm) => tm.members?.some((m) => m.user?.nickname === u.nick))?.id ?? null;
    while (running) {
      const ctrl = new AbortController();
      const stop = setTimeout(() => ctrl.abort(), Math.max(1000, DURATION + RAMP + 60_000));
      try {
        const r = await fetch(`${BASE}/api/games/${gameId}/events`, { headers: { cookie: u.cookie, accept: "text/event-stream" }, signal: ctrl.signal });
        if (!r.ok || !r.body) { record("/api/games/:id/events", 0, false); await sleep(3000); continue; }
        counters.sse++; counters.sseOpened++;
        const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
            const ev = /^event: (\w+)/m.exec(chunk)?.[1]; const data = /^data: (.*)$/m.exec(chunk)?.[1];
            if (ev === "change" && data) {
              counters.events++;
              let ev = { type: "game" }; try { ev = JSON.parse(data); } catch { /* как есть */ }
              if (ev.teamId && (ev.type === "tasks" || ev.type === "submissions" || ev.type === "journal") && ev.teamId !== u.teamId) continue;
              const paths = reloadsFor(ev.type); counters.reloads += paths.length;
              for (const p of paths) later(p);
            }
          }
        }
      } catch { /* обрыв */ }
      finally { clearTimeout(stop); counters.sse--; }
      if (running) await sleep(3000);
    }
  })();
  // Карта раз в минуту (как на странице команды), со сдвигом, чтобы участники не били одновременно.
  await sleep(Math.random() * 60_000);
  while (running) { await g("/my-map"); await sleep(60_000); }
  await sse;
}

// ---- действия: сдачи дел участниками и решения администратора ----
async function takeAndSubmit() {
  const u = users[Math.floor(Math.random() * users.length)];
  const map = await req(u.cookie, "GET", `/api/games/${gameId}/my-map`);
  const tasks = map.json?.tasks ?? [];
  const open = tasks.filter((t) => t.status === "OPEN" && !t.sea);
  if (!open.length) return;
  const t = open[Math.floor(Math.random() * open.length)];
  const taken = await req(u.cookie, "POST", `/api/games/${gameId}/edge-tasks/${t.id}/take`, {});
  if (!taken.ok) return;
  const sub = await req(u.cookie, "POST", `/api/games/${gameId}/edge-tasks/${t.id}/submit`, { links: ["https://example.com/photo"], note: "нагрузочный тест" });
  if (sub.ok) counters.submitted++;
}
async function approveOne() {
  const list = await req(admin[2], "GET", `/api/games/${gameId}/submissions`);
  const first = list.json?.tasks?.[0];
  if (!first) return;
  const r = await req(admin[2], "POST", `/api/games/${gameId}/edge-tasks/${first.id}/decide`, { approve: true, comment: "" });
  if (r.ok) counters.approved++;
}
async function loop(fn, perMin, startDelay) {
  if (perMin <= 0) return;
  await sleep(startDelay);
  while (running) { fn().catch(() => {}); await sleep(60_000 / perMin); }
}

// ---- ход прогона ----
const t0 = Date.now();
console.log(`стенд ${BASE}, участников ${users.length}, разгон ${RAMP / 1000} с, нагрузка ${DURATION / 1000} с, решений/мин ${APPROVE_PER_MIN}, сдач/мин ${TAKE_PER_MIN}`);
const vus = users.map((u, i) => sleep((RAMP * i) / users.length).then(() => runUser(u)));
const actions = [loop(takeAndSubmit, TAKE_PER_MIN, RAMP / 2), loop(approveOne, APPROVE_PER_MIN, RAMP)];
let lastN = 0, lastT = t0;
const progress = setInterval(() => {
  const now = Date.now(); const total = [...stats.values()].reduce((a, s) => a + s.n, 0); const errs = [...stats.values()].reduce((a, s) => a + s.err, 0);
  const rps = ((total - lastN) / ((now - lastT) / 1000)).toFixed(1); lastN = total; lastT = now;
  const map = stats.get("/api/games/:id/my-map");
  console.log(`${Math.round((now - t0) / 1000)} с · SSE ${counters.sse} · событий ${counters.events} · запросов ${total} (${rps}/с) · ошибок ${errs} · карта p95 ${map ? Math.round(pct(map.lat.slice(-2000), 95)) : 0} мс · сдано ${counters.submitted} · принято ${counters.approved}`);
}, 30_000);
await sleep(RAMP + DURATION);
running = false;
clearInterval(progress);
await Promise.race([Promise.all([...vus, ...actions]), sleep(10_000)]);

// ---- итог ----
const rows = [...stats.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, s]) => `| ${k} | ${s.n} | ${s.err} | ${Math.round(pct(s.lat, 50))} | ${Math.round(pct(s.lat, 95))} | ${Math.round(pct(s.lat, 99))} | ${Math.round(Math.max(...s.lat))} |`);
const total = [...stats.values()].reduce((a, s) => a + s.n, 0), errs = [...stats.values()].reduce((a, s) => a + s.err, 0);
const md = [
  `## Нагрузочный прогон: ${users.length} участников, ${DURATION / 1000} с`,
  "",
  `Запросов ${total}, в среднем ${(total / ((RAMP + DURATION) / 1000)).toFixed(1)}/с, ошибок ${errs} (${total ? ((100 * errs) / total).toFixed(2) : 0} %). Событий получено ${counters.events}, перечитываний по событиям ${counters.reloads}. Потоков SSE открыто за прогон ${counters.sseOpened}. Сдач ${counters.submitted}, решений администратора ${counters.approved}, ответов 409 (ожидаемых) ${counters.expected409}.`,
  "",
  "| Запрос | Всего | Ошибок | p50, мс | p95, мс | p99, мс | макс, мс |",
  "|---|---:|---:|---:|---:|---:|---:|",
  ...rows,
  "",
].join("\n");
console.log("\n" + md);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md + "\n");
process.exit(0);
