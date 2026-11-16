// Условие владельца: когда лист закрывается и карта видна, живность сразу стоит по часам сервера — без догона.
// Читаем у слоя живности (?perf=1), насколько её мир отстаёт от часов сервера: до листа, под листом, сразу после закрытия.
// BASE=http://localhost:3001 node under-lag.cjs
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3001', GAME = 'cmucujbgq0008s301ran0fnt4';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch();
  for (const mode of ['pause', 'slow', 'now']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ru-RU', serviceWorkers: 'block' });
    await ctx.request.post(BASE + '/api/auth/login', { data: { nickname: 'p1', password: 'secret123' } });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${BASE}/games/${GAME}/team?perf=1&under=${mode}`, { waitUntil: 'commit' }); await p.waitForSelector('.m-label', { timeout: 120000 }); await sleep(7000);
    // Каждый кадр записываем отставание мира живности и признак догона (пустой слой).
    await p.evaluate(() => { window.__lag = []; const tick = () => { const f = window.__perf && window.__perf.fauna && window.__perf.fauna(); if (f) window.__lag.push({ t: performance.now(), lag: f.lag, catching: f.catching, covered: f.covered, drawnAt: f.drawnAt, sheet: Boolean(document.querySelector('.city-sheet')) }); requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    await sleep(3000);
    const tOpen = await p.evaluate(() => { document.querySelector('.m-label[data-key="N:11,0"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); return performance.now(); });
    await p.waitForSelector('.city-sheet', { timeout: 30000 }); await sleep(20000);
    const tClose = await p.evaluate(() => performance.now());
    await p.locator('button[aria-label="Закрыть"]:visible').last().click(); await sleep(3000);
    const r = await p.evaluate(([o, c]) => {
      const L = window.__lag, max = (a) => a.length ? Math.max(...a.map((x) => x.lag ?? 0)) : null, any = (a) => a.some((x) => x.catching);
      const before = L.filter((x) => x.t < o), under = L.filter((x) => x.t > o + 1500 && x.t < c);
      // первый кадр, на котором листа города уже нет на странице
      const i = L.findIndex((x) => x.t > c && !x.sheet), after = i < 0 ? [] : L.slice(i, i + 60);
      const frame = (x) => x ? { lag: +(x.lag ?? -1).toFixed(3), covered: x.covered, drawnAgo: Math.round(x.t - x.drawnAt) } : null;
      return { before: max(before), under: max(under), lastUnder: frame(L[i - 1]), first: after.slice(0, 4).map(frame), max1s: max(after), catchBefore: any(before), catchUnder: any(under), catchAfter: any(L.filter((x) => x.t > c)), coveredUnder: under.filter((x) => x.covered).length + '/' + under.length };
    }, [tOpen, tClose]);
    console.log(`режим ${mode}: мир живности отстаёт от часов сервера, с — до листа ${r.before?.toFixed(2)}, под листом ${r.under?.toFixed(2)} (кадров «карта закрыта»: ${r.coveredUnder})\n   последний кадр с листом: ${JSON.stringify(r.lastUnder)}\n   первые кадры без листа: ${JSON.stringify(r.first)}\n   за первую секунду без листа — не больше ${r.max1s?.toFixed(2)} с · догон с пустым слоем: до ${r.catchBefore}, под листом ${r.catchUnder}, после ${r.catchAfter}${errs.length ? ' · ОШИБКИ ' + errs.join(' | ') : ''}`);
    await ctx.close();
  }
  await b.close();
})().catch((e) => { console.error('ОШИБКА', e.message); process.exit(1); });
