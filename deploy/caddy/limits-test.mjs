// Проверка ограничения запросов на настоящем Caddy с настройками из репозитория (запускает limits-test.sh в конвейере
// выкладки). Считает ответы: пороги те же, что в Caddyfile; счёт «по игроку» — по номеру сессии; потолок на адрес;
// файлы сайта не считаются; смена настроек аккаунта — в строгой зоне, чтение «кто я» — нет.
// node limits-test.mjs [порт]   — прокси слушает https://localhost:ПОРТ со своим сертификатом (только эта проверка).
import https from "node:https";

const PORT = Number(process.argv[2] || 8443);
const agent = new https.Agent({ keepAlive: true, maxSockets: 16, rejectUnauthorized: false });
const ask = (path, { cookie, method = "GET" } = {}) => new Promise((resolve, reject) => {
  const req = https.request({ host: "127.0.0.1", port: PORT, servername: "localhost", path, method, agent, headers: { Host: "localhost", ...(cookie ? { Cookie: cookie } : {}) } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
  req.on("error", reject); req.end();
});
const many = async (n, path, opts) => { const out = []; for (let i = 0; i < n; i += 16) out.push(...await Promise.all(Array.from({ length: Math.min(16, n - i) }, () => ask(path, opts)))); return out; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Номер сессии — 43 знака, подпись после точки. Номера A и B различаются только последним знаком: если бы ключом счётчика
// оказалась часть номера, B упёрся бы в лимит A.
const id = (tail) => "Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE".slice(0, 42) + tail;
const session = (tail, sig = "c2lnbmF0dXJlLXNpZ25hdHVyZS1zaWduYXR1cmUtc2lnbg") => `lotw_sessions=xyz; lotw_session=${id(tail)}.${sig}`;

let failed = 0;
const check = (name, ok, got) => { console.log(`${ok ? "верно" : "ОШИБКА"} · ${name}${ok ? "" : " · получено: " + JSON.stringify(got)}`); if (!ok) failed++; };
const count = (list, code) => list.filter((c) => c === code).length;

// Ждём, пока прокси поднимется.
for (let i = 0; ; i++) { try { await ask("/"); break; } catch (e) { if (i > 60) { console.error("прокси не отвечает:", e.message); process.exit(1); } await sleep(500); } }

const t0 = Date.now();
let r = await many(300, "/api/games", { cookie: session("1") });
check("игрок А: 300 запросов за 10 секунд проходят", count(r, 200) === 300, { 200: count(r, 200), 429: count(r, 429) });
check("игрок А: 301-й запрос — отказ 429", (r = await ask("/api/games", { cookie: session("1") })) === 429, r);
check("игрок А с другой подписью — тот же счёт (ключ — номер сессии)", (r = await ask("/api/games", { cookie: session("1", "ZHJ1Z2F5YS1wb2RwaXMtZHJ1Z2F5YS1wb2RwaXMtZHJ1Z2F5YQ") })) === 429, r);
check("игрок Б с того же адреса — свой счёт", (r = await ask("/api/games", { cookie: session("2") })) === 200, r);
r = await many(300, "/api/games");
check("гость: 300 запросов проходят", count(r, 200) === 300, { 200: count(r, 200), 429: count(r, 429) });
check("гость: 301-й — отказ 429", (r = await ask("/api/games")) === 429, r);
check("cookie сессии неправильного вида считается по адресу, как гость", (r = await ask("/api/games", { cookie: "lotw_session=abc" })) === 429, r);
check("номер сессии без подписи считается по адресу", (r = await ask("/api/games", { cookie: `lotw_session=${id("3")}` })) === 429, r);
check("номер длиннее 43 знаков считается по адресу", (r = await ask("/api/games", { cookie: `lotw_session=${id("3")}xxxxxxxx.sig` })) === 429, r);
r = await many(40, "/assets/index-abc.js");
check("файлы сайта не считаются", count(r, 200) === 40, { 200: count(r, 200), 429: count(r, 429) });
// Потолок на адрес: до сих пор ушло 607 запросов игры; ещё 300 и 93 — ровно 1000.
r = await many(300, "/api/games", { cookie: session("4") });
check("игрок В: 300 запросов проходят (потолок на адрес ещё не достигнут)", count(r, 200) === 300, { 200: count(r, 200), 429: count(r, 429) });
r = await many(93, "/api/games", { cookie: session("5") });
check("игрок Г: 93 запроса проходят — на адресе ровно 1000", count(r, 200) === 93, { 200: count(r, 200), 429: count(r, 429) });
check("потолок на адрес: 1001-й запрос игры — отказ даже новому игроку", (r = await ask("/api/games", { cookie: session("6") })) === 429, r);
check("файлы сайта проходят и при достигнутом потолке", (r = await ask("/img/map.webp")) === 200, r);
const took = Date.now() - t0;
check(`первая часть уложилась в окно счёта (${took} мс из 9000)`, took < 9000, took);

await sleep(11_000); // окна в 10 секунд истекли
r = await many(30, "/api/auth/login", { method: "POST" });
check("вход: 30 запросов в минуту проходят", count(r, 200) === 30, { 200: count(r, 200), 429: count(r, 429) });
check("вход: 31-й — отказ 429", (r = await ask("/api/auth/login", { method: "POST" })) === 429, r);
check("чтение «кто я» в строгую зону не входит", (r = await ask("/api/auth/me", { cookie: session("7") })) === 200, r);
check("чтение «аккаунты на устройстве» в строгую зону не входит", (r = await ask("/api/auth/accounts", { cookie: session("7") })) === 200, r);
check("чтение «способы входа» в строгую зону не входит", (r = await ask("/api/auth/providers")) === 200, r);
check("смена настроек аккаунта (PATCH) — в строгой зоне", (r = await ask("/api/auth/me", { cookie: session("7"), method: "PATCH" })) === 429, r);
check("сброс пароля — в строгой зоне", (r = await ask("/api/auth/forgot", { method: "POST" })) === 429, r);

agent.destroy();
console.log(failed ? `\nНе сошлось проверок: ${failed}` : "\nВсе проверки сошлись");
process.exit(failed ? 1 : 0);
