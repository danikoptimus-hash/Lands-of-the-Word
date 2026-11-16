// Простой 200 секунд: сколько раз и чем приложение сверяется с сервером, сколько соединений событий держит.
const { chromium } = require('playwright');
const BASE = 'http://localhost:3001', GAME = 'cmucujbgq0008s301ran0fnt4'; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ru-RU', serviceWorkers: 'block' });
  await ctx.request.post(BASE + '/api/auth/login', { data: { nickname: 'p1', password: 'secret123' } });
  const p = await ctx.newPage(); const errs = []; const reqs = []; let bytes = 0;
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('request', (q) => { const u = new URL(q.url()); if (u.pathname.startsWith('/api/')) reqs.push({ u: u.pathname.replace(GAME, ':id') + (u.search ? '?…' : ''), t: Date.now() }); });
  p.on('response', async (x) => { const u = new URL(x.url()); if (u.pathname.endsWith('/my-map')) { try { bytes += (await x.body()).length; } catch {} } });
  await p.goto(`${BASE}/games/${GAME}/team`, { waitUntil: 'commit' }); await p.waitForSelector('.m-label', { timeout: 120000 }); await sleep(4000);
  const streams0 = reqs.filter((q) => q.u.endsWith('/events')).length;
  // открыть лист Каменоломни (раньше он открывал своё соединение событий) — через «Дела» не трогаем, просто считаем соединения до и после разделов
  const n = await p.locator('.team-dock .dock-btn').count();
  for (let i = 0; i < n; i++) { const bb = await p.locator('.team-dock .dock-btn').nth(i).boundingBox(); await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(900); await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(400); }
  reqs.length = 0; bytes = 0; const t0 = Date.now();
  await sleep(200000);
  const cnt = reqs.reduce((a, q) => (a[q.u] = (a[q.u] || 0) + 1, a), {});
  console.log('соединений событий при открытии:', streams0);
  console.log('за 200 с простоя запросы:', JSON.stringify(cnt), '· байт карты:', bytes, '· моменты сверки, с:', reqs.filter((q) => q.u.includes('my-map')).map((q) => Math.round((q.t - t0) / 1000)).join(', '));
  // возврат из фона: 8 секунд «свёрнуто»
  reqs.length = 0;
  await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(8000);
  await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(3000);
  console.log('после возврата из фона (8 с):', JSON.stringify(reqs.reduce((a, q) => (a[q.u] = (a[q.u] || 0) + 1, a), {})));
  console.log(errs.length ? 'ОШИБКИ: ' + [...new Set(errs)].join(' | ') : 'ошибок страницы нет');
  await b.close();
})().catch((e) => { console.error('ОШИБКА', e.message); process.exit(1); });
