// Запуск игры: первый раз (в памяти телефона пусто) и повторно (карта с прошлого раза). Что видно и когда, какие запросы.
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3001', NICK = process.env.NICK || 'p4', SLOW = Number(process.env.SLOW || 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ru-RU', serviceWorkers: 'block' });
  const r = await ctx.request.post(BASE + '/api/auth/login', { data: { nickname: NICK, password: 'secret123' } }); if (!r.ok()) throw new Error('вход');
  const run = async (name) => {
    const p = await ctx.newPage(); const errs = [], reqs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    if (SLOW) await p.route('**/api/**', async (route) => { await sleep(SLOW); await route.continue(); });
    p.on('request', (q) => { const u = new URL(q.url()); if (u.pathname.startsWith('/api/')) reqs.push({ u: u.pathname.replace(/games\/[a-z0-9]+/, 'games/:id') + (u.search ? '?…' : ''), t: Date.now() }); });
    const sizes = {}; p.on('response', async (x) => { const u = new URL(x.url()); if (u.pathname.endsWith('/my-map')) { try { sizes[u.search ? 'my-map?have' : 'my-map'] = (await x.body()).length; } catch {} } });
    const t0 = Date.now();
    await p.goto(BASE + '/', { waitUntil: 'commit' });
    await p.waitForSelector('.m-label', { timeout: 120000 }); const tMap = Date.now() - t0;
    const firstReq = reqs.length ? reqs[0].t - t0 : null;
    await sleep(4000);
    const cnt = reqs.reduce((a, q) => (a[q.u] = (a[q.u] || 0) + 1, a), {});
    const dup = Object.entries(cnt).filter(([, n]) => n > 1).map(([u, n]) => u + '×' + n);
    console.log(`${name}: карта на экране через ${tMap} мс · первый запрос через ${firstReq} мс · запросов ${reqs.length} · повторы: ${dup.join(', ') || 'нет'} · ответ карты: ${JSON.stringify(sizes)}`);
    console.log('   порядок первых:', reqs.slice(0, 7).map((q) => q.u.replace('/api/', '') + '@' + (q.t - t0)).join(' '));
    const ls = await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('lotw.')).map((k) => k + ':' + localStorage.getItem(k).length));
    console.log('   в памяти телефона:', ls.join(' '));
    if (errs.length) console.log('   ОШИБКИ:', [...new Set(errs)].join(' | '));
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await sleep(300);
    await p.close();
  };
  await run('первый запуск');
  await sleep(500);
  await run('второй запуск');
  await run('третий запуск');
  // выход стирает запомненное
  const p = await ctx.newPage(); await p.goto(BASE + '/', { waitUntil: 'commit' }); await p.waitForSelector('.m-label', { timeout: 120000 });
  await p.evaluate(() => fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }));
  await p.reload({ waitUntil: 'commit' }); await sleep(3000);
  console.log('после выхода на сервере: адрес', p.url().replace(BASE, ''), '· в памяти:', (await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('lotw.')))).join(' ') || 'пусто');
  await b.close();
})().catch((e) => { console.error('ОШИБКА', e.message); process.exit(1); });
