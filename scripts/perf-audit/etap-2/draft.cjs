// Расстановка районов и «прежнее сразу». Игрок двигает районы, закрывает город и открывает снова на медленной связи:
// 1) на экране сразу та расстановка, которую он оставил (а не та, что была до его ходов);
// 2) пока свежий ответ в пути, районы и замок не нажимаются — устаревшей расстановкой нельзя затереть сохранённую;
// 3) на сервере лежит ровно то, что оставил игрок.
// BASE=http://localhost:3001 CITY=N:14,2 node draft.cjs   (CITY — город с нерешённым порядком районов)
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3001', GAME = process.env.GAME || 'cmucujbgq0008s301ran0fnt4', CITY = process.env.CITY || 'N:14,2', SLOW = Number(process.env.SLOW || 3000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ru-RU', serviceWorkers: 'block' });
  await ctx.request.post(BASE + '/api/auth/login', { data: { nickname: process.env.NICK || 'p1', password: 'secret123' } });
  const cityUrl = `${BASE}/api/games/${GAME}/my-city/${encodeURIComponent(CITY)}`;
  const server = async () => (await (await ctx.request.get(cityUrl)).json()).state.orderDraft;
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  let slow = 0;
  await p.route('**/api/games/*/my-city/*', async (route) => { if (slow && route.request().method() === 'GET') await sleep(slow); await route.continue(); });
  await p.goto(`${BASE}/games/${GAME}/team`, { waitUntil: 'commit' }); await p.waitForSelector('.m-label', { timeout: 120000 }); await sleep(2500);
  const open = () => p.evaluate((key) => document.querySelector(`.m-label[data-key="${key}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true })), CITY);
  const close = async () => { await p.locator('button[aria-label="Закрыть"]:visible').last().click(); await sleep(500); };
  const rings = () => p.evaluate(() => [...document.querySelectorAll('.city-sheet .rings .ring .cur')].map((e) => e.firstChild.textContent.trim()));
  const off = () => p.evaluate(() => { const bs = [...document.querySelectorAll('.city-sheet .rings .ring button.turn')]; return bs.length ? bs.every((x) => x.disabled) : null; });
  const lockOff = () => p.evaluate(() => { const x = [...document.querySelectorAll('.city-sheet .step-body .actions button')][0]; return x ? x.disabled : null; });

  await open(); await p.waitForSelector('.city-sheet .rings .ring', { timeout: 30000 }); await sleep(800);
  const start = await rings();
  // три хода: первый район вниз трижды
  for (let i = 0; i < 3; i++) { await p.locator('.city-sheet .rings .ring').nth(i).locator('button.turn').last().click(); await sleep(250); }
  const moved = await rings(); await sleep(900);
  const saved1 = await server();
  console.log(`районов ${start.length}; до ходов первым стоял «${start[0]}», после трёх ходов он на месте ${moved.indexOf(start[0]) + 1}`);
  console.log(`на сервере сохранена расстановка из ${saved1.length} районов`);
  await close();

  // повторное открытие на медленной связи: ответ города задержан
  slow = SLOW; await open(); await p.waitForSelector('.city-sheet .rings .ring', { timeout: 30000 }); await sleep(300);
  const shown = await rings(), blocked = await off(), lockBlocked = await lockOff();
  console.log(`повторно, свежий ответ ещё в пути (${SLOW} мс): на экране расстановка игрока — ${JSON.stringify(shown) === JSON.stringify(moved)}; районы не нажимаются — ${blocked}; замок не нажимается — ${lockBlocked}`);
  // попытка хода в это окно ничего не меняет
  await p.locator('.city-sheet .rings .ring').nth(5).locator('button.turn').last().click({ force: true }).catch(() => {}); await sleep(300);
  console.log(`ход в этом окне не прошёл — ${JSON.stringify(await rings()) === JSON.stringify(moved)}`);
  await sleep(SLOW + 600);
  const after = await rings(), free = await off();
  console.log(`свежий ответ пришёл: расстановка та же — ${JSON.stringify(after) === JSON.stringify(moved)}; районы снова нажимаются — ${free === false}`);
  const saved2 = await server();
  console.log(`на сервере расстановка не изменилась — ${JSON.stringify(saved2) === JSON.stringify(saved1)}`);
  // возвращаем как было: первый район обратно наверх
  slow = 0;
  for (let i = 3; i > 0; i--) { await p.locator('.city-sheet .rings .ring').nth(i).locator('button.turn').first().click(); await sleep(250); }
  await sleep(900);
  console.log(`расстановка возвращена к исходной — ${JSON.stringify(await rings()) === JSON.stringify(start)}`);
  console.log(errs.length ? 'ОШИБКИ: ' + [...new Set(errs)].join(' | ') : 'ошибок страницы нет');
  await b.close();
})().catch((e) => { console.error('ОШИБКА', e.message); process.exit(1); });
