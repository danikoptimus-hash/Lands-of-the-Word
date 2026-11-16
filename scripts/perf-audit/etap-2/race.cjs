// Живая проверка: несколько изменений карты подряд при медленной отрисовке (процессор ×6).
// Капитан в соседнем соединении отмечает приоритет у трёх дел и снимает у двух с малыми паузами;
// страница должна показать ровно то, что на сервере, и не перечитывать карту целиком на каждое изменение.
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3001', GAME = 'cmucujbgq0008s301ran0fnt4';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch(); const errs = []; const reqs = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU', serviceWorkers: 'block' });
  const r = await ctx.request.post(BASE + '/api/auth/login', { data: { nickname: 'p1', password: 'secret123' } }); if (!r.ok()) throw new Error('вход');
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  p.on('request', (q) => { const u = q.url().replace(BASE, ''); if (u.includes('/my-map') && !u.includes('/my-map/')) reqs.push(Date.now()); });
  await p.goto(BASE + '/games/' + GAME + '/team', { waitUntil: 'commit' });
  await p.waitForSelector('.m-label', { timeout: 120000 }); await sleep(4000);
  const prioOnPage = () => p.evaluate(() => [...document.querySelectorAll('.m-deed.priority')].map((g) => g.getAttribute('data-id')).sort());
  const map0 = await (await ctx.request.get(`${BASE}/api/games/${GAME}/my-map`)).json();
  const open = map0.tasks.filter((t) => t.status !== 'APPROVED' && !t.paved && !t.priorityAt);
  const onPage = new Set(await p.evaluate(() => [...document.querySelectorAll('.m-deed')].map((g) => g.getAttribute('data-id'))));
  const pick = open.filter((t) => onPage.has(t.id)).slice(0, 3);
  if (pick.length < 3) throw new Error('мало дел на карте для проверки: ' + pick.length);
  const before = await prioOnPage(); console.log('приоритетных до:', before.length, '· выбрано дел:', pick.length);
  const cdp = await ctx.newCDPSession(p); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  reqs.length = 0;
  const set = (t, on) => ctx.request.post(`${BASE}/api/games/${GAME}/edge-tasks/${t.id}/priority`, { data: { on } }).then((x) => { if (!x.ok()) throw new Error('priority ' + x.status()); });
  // пять изменений с паузами 350–450 мс: каждое уходит отдельной «разницей» (сервер копит 300 мс)
  await set(pick[0], true); await sleep(380); await set(pick[1], true); await sleep(350); await set(pick[2], true); await sleep(450); await set(pick[0], false); await sleep(360); await set(pick[1], false);
  await sleep(6000);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const after = await prioOnPage();
  const map1 = await (await ctx.request.get(`${BASE}/api/games/${GAME}/my-map`)).json();
  const server = map1.tasks.filter((t) => t.priorityAt).map((t) => t.id).filter((id) => onPage.has(id)).sort();
  const expect = [...before, pick[2].id].sort();
  console.log('на странице приоритетных:', after.length, '· на сервере (из видимых):', server.length, '· ожидалось:', expect.length);
  console.log('страница = сервер:', JSON.stringify(after) === JSON.stringify(server), '· страница = ожидание:', JSON.stringify(after) === JSON.stringify(expect));
  console.log('полных запросов карты за пять изменений:', reqs.length);
  await set(pick[2], false); await sleep(2500);
  const back = await prioOnPage(); console.log('после возврата как было:', JSON.stringify(back) === JSON.stringify(before));
  console.log(errs.length ? 'ОШИБКИ: ' + [...new Set(errs)].join(' | ') : 'ошибок страницы нет');
  await b.close();
})().catch((e) => { console.error('ОШИБКА', e.message); process.exit(1); });
