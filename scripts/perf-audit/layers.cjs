// Какие слои карты рисуются в каждом кадре: счётчики команд рисования по холстам (простой, движение, открытый лист).
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3001', GAME = 'cmucujbgq0008s301ran0fnt4';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ru-RU', serviceWorkers: 'block' });
  const r = await ctx.request.post(BASE + '/api/auth/login', { data: { nickname: process.env.NICK || 'p4', password: 'secret123' } }); if (!r.ok()) throw new Error('вход');
  await ctx.addInitScript(() => {
    const C = (window.__cnt = { ops: {}, raf: 0, rafMs: 0, frames: 0, timers: 0, timerMs: 0, on: false });
    const key = (ctx) => { const c = ctx.canvas; if (!c) return '?'; const k = c.isConnected ? (c.className || 'холст') : 'вне экрана ' + c.width + 'x' + c.height; return k; };
    const wrap = (proto, names, tag) => { if (!proto) return; for (const n of names) { const f = proto[n]; if (typeof f !== 'function') continue; proto[n] = function (...a) { if (C.on) { const k = key(this); const o = (C.ops[k] = C.ops[k] || {}); o[tag + n] = (o[tag + n] || 0) + 1; } return f.apply(this, a); }; } };
    wrap(window.WebGLRenderingContext && WebGLRenderingContext.prototype, ['drawArrays', 'drawElements', 'clear', 'readPixels', 'texImage2D', 'texSubImage2D', 'bufferData', 'bufferSubData'], 'gl.');
    wrap(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype, ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'clear', 'readPixels', 'texImage2D', 'texSubImage2D', 'bufferData', 'bufferSubData'], 'gl.');
    wrap(CanvasRenderingContext2D.prototype, ['clearRect', 'drawImage', 'fill', 'stroke', 'fillRect', 'fillText', 'getImageData', 'putImageData', 'createPattern'], '2d.');
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((t) => { const s = performance.now(); try { cb(t); } finally { if (C.on) { C.raf++; C.rafMs += performance.now() - s; } } });
    const si = window.setInterval.bind(window); window.setInterval = (cb, ms, ...a) => si((...x) => { const s = performance.now(); try { return typeof cb === 'function' ? cb(...x) : undefined; } finally { if (C.on) { C.timers++; C.timerMs += performance.now() - s; } } }, ms, ...a);
    const st = window.setTimeout.bind(window); window.setTimeout = (cb, ms, ...a) => st((...x) => { const s = performance.now(); try { return typeof cb === 'function' ? cb(...x) : undefined; } finally { if (C.on) { C.timers++; C.timerMs += performance.now() - s; } } }, ms, ...a);
    const loop = () => { if (C.on) C.frames++; raf(loop); }; raf(loop);
    window.__cntStart = () => { C.ops = {}; C.raf = 0; C.rafMs = 0; C.frames = 0; C.timers = 0; C.timerMs = 0; C.on = true; };
    window.__cntStop = () => { C.on = false; return JSON.parse(JSON.stringify(C)); };
  });
  const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p); p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.goto(BASE + '/games/' + GAME + '/team?perf=1', { waitUntil: 'commit' });
  await p.waitForSelector('.m-label', { timeout: 120000 }); await sleep(5000);
  const show = (label, c, wall) => {
    console.log(`\n== ${label}: ${wall} мс, кадров ${c.frames} (${(c.frames / wall * 1000).toFixed(1)} в секунду), вызовов «на кадр» ${c.raf} (${(c.raf / Math.max(1, c.frames)).toFixed(1)} на кадр, ${c.rafMs.toFixed(0)} мс скрипта), таймеров ${c.timers} (${c.timerMs.toFixed(0)} мс)`);
    for (const [k, o] of Object.entries(c.ops).sort()) console.log('   ', k.padEnd(28), Object.entries(o).map(([n, v]) => `${n} ${(v / Math.max(1, c.frames)).toFixed(1)}/кадр`).join(' · '));
  };
  const run = async (label, act) => { await p.evaluate(() => window.__cntStart()); const t0 = Date.now(); await act(); const wall = Date.now() - t0; const c = await p.evaluate(() => window.__cntStop()); show(label, c, wall); return c; };
  const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  const drag = async (x0, y0, x1, y1, steps = 30) => { await touch('touchStart', x0, y0); for (let i = 1; i <= steps; i++) { await touch('touchMove', x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await sleep(16); } await touch('touchEnd'); };
  await run('простой, карта на экране', async () => { await sleep(5000); });
  await run('движение карты', async () => { await drag(300, 500, 90, 300); await sleep(200); await drag(90, 300, 300, 520); });
  // Лист раздела закрывает карту целиком (телефон): рисуется ли карта под ним.
  const btn = p.locator('.team-dock .dock-btn').nth(3); const bb = await btn.boundingBox(); await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(2500);
  const covered = await p.evaluate(() => { const s = document.querySelector('.side-menu'); if (!s) return null; const r2 = s.getBoundingClientRect(); return { x: r2.x, y: r2.y, w: r2.width, h: r2.height, bg: getComputedStyle(s).backgroundColor }; });
  console.log('\nлист раздела:', JSON.stringify(covered));
  await run('простой, карта закрыта листом «Летопись»', async () => { await sleep(5000); });
  // Вкладка скрыта.
  const marks = await p.evaluate(() => { const L = window.__perf && window.__perf.log; if (!L) return null; const o = {}; for (const [k, a] of L) { const s = [...a].sort((x, y) => x - y); o[k] = { n: a.length, med: +s[Math.floor(s.length / 2)].toFixed(2), max: +s[s.length - 1].toFixed(1), sum: +a.reduce((x, y) => x + y, 0).toFixed(0) }; } return o; });
  console.log('\nметки слоёв (?perf=1), мс:'); for (const [k, v] of Object.entries(marks || {})) console.log('   ', k.padEnd(28), JSON.stringify(v));
  await b.close();
})().catch((e) => { console.error('ОШИБКА', e); process.exit(1); });
