/**
 * Партия «Осень (тест)» на стенде, укомплектованная ТОЛЬКО тестовыми ботами (решение владельца 03.11: поднять осень
 * в копии на тесте и переключаться между ботами). Реальных людей в партии нет — три команды из ботов tg_*, как в
 * scripts/sim-game.mjs. Скрипт не играет и не делает скриншотов: только заводит ботов, создаёт игру, карту, команды,
 * адресатов, дела и (по умолчанию) запускает игру с ускоренными сроками, чтобы всё можно было проверить быстро.
 *
 * Запуск на сервере стенда (пароль ботов в репозитории не хранится):
 *   SEED_BASE=https://test.<домен> SIM_PASS=<пароль ботов> node scripts/seed-stand.mjs
 * Переменные: SEED_START=0 — оставить черновиком; SEED_NAME="…" — имя игры; SEED_SEED=<число> — зерно карты.
 *
 * tg_admin должен быть суперадмином платформы (иначе игру не создать). На свежей базе первый зарегистрированный
 * становится суперадмином; на копии прода выдать роль один раз в базе стенда:
 *   docker exec lotw-db-test psql -U lotw -d lotw -c "UPDATE \"User\" SET \"platformRole\"='SUPERADMIN' WHERE nickname='tg_admin';"
 */
const BASE = (process.env.SEED_BASE ?? "https://test.landsoftheword.com").replace(/\/$/, "");
const PASS = process.env.SIM_PASS;
const NAME = process.env.SEED_NAME ?? "Осень (тест)";
const START = process.env.SEED_START !== "0";
const SEED = Number(process.env.SEED_SEED ?? Math.floor(Math.random() * 1e9));
if (!PASS) { console.error("Нужен SIM_PASS (пароль тестовых ботов)."); process.exit(1); }

const TEAMS = [
  { name: "Моряки", nicks: ["tg_m1", "tg_m2", "tg_m3", "tg_m4", "tg_m5", "tg_m6"] },
  { name: "Берег", nicks: ["tg_b1", "tg_b2", "tg_b3", "tg_b4", "tg_b5", "tg_b6"] },
  { name: "Пустыня", nicks: ["tg_p1", "tg_p2", "tg_p3", "tg_p4", "tg_p5", "tg_p6"] },
];
const ADMIN = "tg_admin";
const ALL = [ADMIN, ...TEAMS.flatMap((t) => t.nicks)];
const cookies = new Map();

/** Пояс, где сейчас местный час равен hour (как в scripts/testAuth): даёт предсказуемое время суток. */
function zoneForLocalHour(hour, now = new Date()) {
  let n = ((hour - now.getUTCHours()) % 24 + 24) % 24;
  if (n > 14) n -= 24;
  return n === 0 ? "Etc/GMT" : n > 0 ? `Etc/GMT-${n}` : `Etc/GMT+${-n}`;
}
const rulesFast = { timeZone: zoneForLocalHour(7), minBid: 10, attackDays: 0.02, burnPenalty: 5, minAnswerSeconds: 120, passageDays: 0.02, lockWeeks: 0.002, fatigueAfterDays: 0.05, fatigueStepDays: 0.01, fatigueStep: 1, deedReturnDays: 0.02, roleChangeDays: 0, roleCooldownDays: 0.001, pauseSteps: [3, 5, 10], siegeDays: 0.02, siegeDeedPoints: 1, adminDigest: "instant" };

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
async function login(nick) {
  const r = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nickname: nick, password: PASS }) });
  if (r.status !== 200) throw new Error(`вход ${nick}: ${r.status}`);
  cookies.set(nick, (r.headers.get("set-cookie") ?? "").split(";")[0]);
}

async function main() {
  console.log(`Стенд: ${BASE}`);
  for (const n of ALL) {
    const r = await fetch(BASE + "/api/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nickname: n, password: PASS, email: `${n}@example.com` }) });
    if (r.status !== 201 && r.status !== 409) console.log(`  регистрация ${n}: ${r.status}`);
  }
  for (const n of ALL) await login(n);
  const me = await get(ADMIN, "/api/auth/me");
  if (me.user?.platformRole !== "SUPERADMIN") {
    console.error(`\ntg_admin не суперадмин — игру создать нельзя. Выдайте роль на стенде один раз:\n  docker exec lotw-db-test psql -U lotw -d lotw -c "UPDATE \\"User\\" SET \\"platformRole\\"='SUPERADMIN' WHERE nickname='tg_admin';"\nи запустите скрипт снова.`);
    process.exit(2);
  }

  const g = await post(ADMIN, "/api/games", { name: NAME, teamCount: 3, settings: { equidistantStarts: true, maxStartDistanceDiff: 2 } });
  const gameId = g.game.id;
  console.log(`Игра «${NAME}»: ${gameId}`);
  await post(ADMIN, `/api/games/${gameId}/generate`, { seed: SEED });
  for (const t of TEAMS) {
    const team = (await post(ADMIN, `/api/games/${gameId}/teams`, { name: t.name })).team;
    const capInv = await post(ADMIN, `/api/games/${gameId}/teams/${team.id}/invites`, { role: "CAPTAIN" });
    await post(t.nicks[0], `/api/invites/${capInv.invite.token}/accept`);
    const memInv = await post(ADMIN, `/api/games/${gameId}/teams/${team.id}/invites`, { role: "MEMBER" });
    for (const n of t.nicks.slice(1)) await post(n, `/api/invites/${memInv.invite.token}/accept`);
    console.log(`  команда ${t.name}: капитан ${t.nicks[0]}, ещё ${t.nicks.length - 1}`);
  }
  for (const [label, kind] of [["Семья у вокзала", "FAMILY"], ["Бабушка с третьего этажа", "WIDOW"], ["Дедушка у рынка", "ELDER"]]) await post(ADMIN, `/api/games/${gameId}/recipients`, { label, kind });
  await post(ADMIN, `/api/games/${gameId}/deeds/import-default`);
  await api(ADMIN, "PATCH", `/api/games/${gameId}`, { settings: { rules: rulesFast } });
  if (START) { await post(ADMIN, `/api/games/${gameId}/start`); console.log("  игра запущена (ускоренные сроки)"); }
  else console.log("  игра оставлена черновиком (SEED_START=0)");

  console.log(`\nГотово. Открыть: ${BASE}/games/${gameId}`);
  console.log("Переключаться между ботами — панелью «🧪 боты» внизу слева на стенде.");
}
main().catch((e) => { console.error("Ошибка:", e.message); process.exit(1); });
