// Замеры скорости на локальной копии «Осени»: загрузка, простой, движение карты, открытие разделов.
// Запуск: node measure.cjs ПРОФИЛЬ ФАЙЛ.json   (профиль: pc — без замедления, phone — процессор ×4)
const { chromium } = require('playwright'); const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:3001', GAME = 'cmucujbgq0008s301ran0fnt4';
const PROFILE = process.argv[2] || 'pc', OUT = process.argv[3] || 'out.json';
const NICK = process.env.NICK || 'p4';
const CPU = PROFILE === 'phone' ? 4 : 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : 0; };

(async () => {
  const b = await chromium.launch({ args: ['--enable-precise-memory-info'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ru-RU', serviceWorkers: process.env.SW === '1' ? 'allow' : 'block' });
  const r = await ctx.request.post(BASE + '/api/auth/login', { data: { nickname: NICK, password: 'secret123' } }); if (!r.ok()) throw new Error('вход ' + r.status());
  await ctx.addInitScript(() => {
    window.__perf = { long: [], lcp: 0, cls: 0, frames: [], rafOn: false };
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch {}
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.lcp = Math.round(e.startTime); }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch {}
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch {}
    window.__frames = (on) => { const P = window.__perf; if (on) { P.frames = []; P.rafOn = true; let last = performance.now(); const tick = (t) => { if (!P.rafOn) return; P.frames.push(t - last); last = t; requestAnimationFrame(tick); }; requestAnimationFrame(tick); } else { P.rafOn = false; return P.frames.slice(1); } };
  });
  const p = await ctx.newPage(); p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Network.enable'); await cdp.send('Performance.enable');
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  // Сеть: все запросы со временем и размером.
  const reqs = new Map(); let net = [];
  cdp.on('Network.requestWillBeSent', (e) => reqs.set(e.requestId, { url: e.request.url.replace(BASE, ''), method: e.request.method, t0: e.timestamp, type: e.type }));
  cdp.on('Network.responseReceived', (e) => { const q = reqs.get(e.requestId); if (q) { q.status = e.response.status; q.ttfb = e.timestamp; q.fromCache = e.response.fromDiskCache || e.response.fromServiceWorker || false; } });
  cdp.on('Network.loadingFinished', (e) => { const q = reqs.get(e.requestId); if (q) { q.t1 = e.timestamp; q.bytes = e.encodedDataLength; net.push(q); } });
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const cpuDelta = (a, b2) => ({ task: +(b2.TaskDuration - a.TaskDuration).toFixed(3), script: +(b2.ScriptDuration - a.ScriptDuration).toFixed(3), layout: +(b2.LayoutDuration - a.LayoutDuration).toFixed(3), style: +(b2.RecalcStyleDuration - a.RecalcStyleDuration).toFixed(3), layouts: b2.LayoutCount - a.LayoutCount, styles: b2.RecalcStyleCount - a.RecalcStyleCount });
  const frameStats = (f) => ({ n: f.length, med: +med(f).toFixed(1), p95: +pct(f, 0.95).toFixed(1), max: +Math.max(0, ...f).toFixed(1), over33: f.filter((x) => x > 33.4).length, over50: f.filter((x) => x > 50).length, over100: f.filter((x) => x > 100).length });
  const longStats = (L) => ({ n: L.length, total: L.reduce((a, x) => a + x[1], 0), max: Math.max(0, ...L.map((x) => x[1])), tbt: L.reduce((a, x) => a + Math.max(0, x[1] - 50), 0) });
  const netSummary = (list) => {
    const api = list.filter((q) => q.url.startsWith('/api/'));
    const by = {}; for (const q of list) { const k = q.url.startsWith('/api/') ? 'api' : (q.type || 'other').toLowerCase(); by[k] = by[k] || { n: 0, bytes: 0 }; by[k].n++; by[k].bytes += q.bytes || 0; }
    return { n: list.length, bytes: list.reduce((a, q) => a + (q.bytes || 0), 0), by, api: api.map((q) => ({ url: q.method + ' ' + q.url.replace(GAME, ':id'), ms: Math.round((q.t1 - q.t0) * 1000), bytes: q.bytes })) };
  };
  const res = { profile: PROFILE, cpu: CPU, nick: NICK };

  // 1. Первая загрузка (пустой кэш): до карты.
  const t0 = Date.now(); net = [];
  await p.goto(BASE + '/games/' + GAME + '/team', { waitUntil: 'commit' });
  await p.waitForSelector('.team-dock', { timeout: 120000 }); const tDock = Date.now() - t0;
  await p.waitForSelector('.m-label', { timeout: 120000 }).catch(() => {}); const tMap = Date.now() - t0;
  await p.waitForLoadState('networkidle').catch(() => {}); const tIdle = Date.now() - t0;
  await sleep(1500);
  const nav = await p.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; const fcp = performance.getEntriesByName('first-contentful-paint')[0]; return { ttfb: Math.round(n.responseStart), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), fcp: fcp ? Math.round(fcp.startTime) : 0, lcp: window.__perf.lcp, cls: +window.__perf.cls.toFixed(4), long: window.__perf.long, dom: document.querySelectorAll('*').length, svg: document.querySelectorAll('svg *').length, canvases: [...document.querySelectorAll('canvas')].map((c) => c.width + 'x' + c.height), heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0, imgs: document.images.length }; });
  res.cold = { dockMs: tDock, mapMs: tMap, netIdleMs: tIdle, ...nav, long: longStats(nav.long), net: netSummary(net) };
  console.log('первая загрузка', JSON.stringify({ ...res.cold, net: { n: res.cold.net.n, bytes: res.cold.net.bytes, by: res.cold.net.by } }));

  // 2. Простой 10 секунд на карте.
  await p.evaluate(() => { window.__perf.long = []; }); net = [];
  let m0 = await metrics(); await p.evaluate(() => window.__frames(true)); await sleep(10000);
  let fr = await p.evaluate(() => window.__frames(false)); let m1 = await metrics();
  res.idle = { cpu: cpuDelta(m0, m1), frames: frameStats(fr), long: longStats(await p.evaluate(() => window.__perf.long)), net: netSummary(net) };
  console.log('простой 10 с', JSON.stringify(res.idle));

  // 3. Движение карты: три протяжки пальцем (через события касания).
  const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  const drag = async (x0, y0, x1, y1, steps = 40) => { await touch('touchStart', x0, y0); for (let i = 1; i <= steps; i++) { await touch('touchMove', x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await sleep(16); } await touch('touchEnd'); };
  await p.evaluate(() => { window.__perf.long = []; }); net = [];
  m0 = await metrics(); await p.evaluate(() => window.__frames(true));
  await drag(300, 500, 90, 300); await sleep(300); await drag(90, 300, 300, 520); await sleep(300); await drag(200, 300, 200, 560); await sleep(600);
  fr = await p.evaluate(() => window.__frames(false)); m1 = await metrics();
  res.pan = { cpu: cpuDelta(m0, m1), frames: frameStats(fr), long: longStats(await p.evaluate(() => window.__perf.long)), netN: net.length };
  console.log('движение карты', JSON.stringify(res.pan));

  // 4. Масштаб: щипок двумя пальцами.
  const pinch = async (from, to, steps = 30) => { const cx = 195, cy = 420; const pts = (d) => [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }]; await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) }); for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(from + (to - from) * i / steps) }); await sleep(16); } await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
  await p.evaluate(() => { window.__perf.long = []; });
  m0 = await metrics(); await p.evaluate(() => window.__frames(true));
  await pinch(40, 150); await sleep(400); await pinch(150, 50); await sleep(400); await pinch(50, 120); await sleep(600);
  fr = await p.evaluate(() => window.__frames(false)); m1 = await metrics();
  res.zoom = { cpu: cpuDelta(m0, m1), frames: frameStats(fr), long: longStats(await p.evaluate(() => window.__perf.long)) };
  console.log('масштаб', JSON.stringify(res.zoom));

  // 5. Разделы панели: нажатие → содержимое устоялось (300 мс без изменений DOM и без запросов).
  const settle = async (max = 15000) => p.evaluate((mx) => new Promise((done) => { const t0 = performance.now(); let last = performance.now(); const mo = new MutationObserver(() => { last = performance.now(); }); mo.observe(document.body, { childList: true, subtree: true, characterData: true }); const iv = setInterval(() => { const now = performance.now(); if (now - last > 400 || now - t0 > mx) { clearInterval(iv); mo.disconnect(); done(Math.round(last - t0)); } }, 50); }), max);
  res.sections = [];
  const n = await p.locator('.team-dock .dock-btn').count();
  for (let i = 0; i < n; i++) {
    const btn = p.locator('.team-dock .dock-btn').nth(i); const name = ((await btn.innerText().catch(() => '')) || (await btn.getAttribute('aria-label')) || String(i)).trim().replace(/\s+/g, ' ');
    await p.evaluate(() => { window.__perf.long = []; }); net = []; m0 = await metrics();
    const bb = await btn.boundingBox(); const ts = Date.now(); await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
    const first = await p.waitForSelector('.side-menu', { timeout: 8000 }).then(() => Date.now() - ts).catch(() => -1);
    const st = await settle(); await p.waitForLoadState('networkidle').catch(() => {}); const total = Date.now() - ts; m1 = await metrics();
    const row = { name, sheetMs: first, settledMs: st, totalMs: total, cpu: cpuDelta(m0, m1), long: longStats(await p.evaluate(() => window.__perf.long)), net: netSummary(net), dom: await p.evaluate(() => document.querySelectorAll('.side-menu *').length) };
    res.sections.push(row); console.log('раздел', JSON.stringify({ ...row, net: { n: row.net.n, bytes: row.net.bytes, api: row.net.api } }));
    // Повторное открытие — показывает, есть ли кэш.
    await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(700);
    if (!(await p.locator('.side-menu:visible').count())) { net = []; const ts2 = Date.now(); await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.waitForSelector('.side-menu', { timeout: 8000 }).catch(() => {}); const st2 = await settle(); row.again = { settledMs: st2, totalMs: Date.now() - ts2, netN: net.length, bytes: net.reduce((a, q) => a + (q.bytes || 0), 0) }; console.log('  повторно', JSON.stringify(row.again)); await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(700); }
  }

  // 6. Повторный заход (кэш браузера тёплый).
  net = []; const t1 = Date.now();
  await p.reload({ waitUntil: 'commit' });
  await p.waitForSelector('.team-dock', { timeout: 120000 }); const wDock = Date.now() - t1;
  await p.waitForSelector('.m-label', { timeout: 120000 }).catch(() => {}); const wMap = Date.now() - t1;
  await p.waitForLoadState('networkidle').catch(() => {}); const wIdle = Date.now() - t1; await sleep(1000);
  const nav2 = await p.evaluate(() => { const fcp = performance.getEntriesByName('first-contentful-paint')[0]; return { fcp: fcp ? Math.round(fcp.startTime) : 0, lcp: window.__perf.lcp, long: window.__perf.long }; });
  res.warm = { dockMs: wDock, mapMs: wMap, netIdleMs: wIdle, fcp: nav2.fcp, lcp: nav2.lcp, long: longStats(nav2.long), net: netSummary(net) };
  console.log('повторный заход', JSON.stringify({ ...res.warm, net: { n: res.warm.net.n, bytes: res.warm.net.bytes, by: res.warm.net.by } }));

  fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
  await b.close();
})().catch((e) => { console.error('ОШИБКА', e); process.exit(1); });
