// Цена окон разведки в тумане: сколько времени занимает один кадр слоя тумана с окнами и без них.
// Окна убираются подменой ответа карты (peeked: []); время кадра — от очистки холста тумана до конца рисования.
//   BASE=http://localhost:3001 node fog-cost.cjs
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3001', GAME = process.env.GAME || 'cmucujbgq0008s301ran0fnt4';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROBE = () => {
  try { localStorage.setItem('lotw.intro.seen', '1'); } catch {}
  const st = (window.__fog = { draws: 0, ms: 0, grads: 0, t0: 0, on: false });
  const P = CanvasRenderingContext2D.prototype, clear = P.clearRect, restore = P.restore, grad = P.createRadialGradient;
  const isFog = (c) => c.canvas && c.canvas.classList && c.canvas.classList.contains('fog');
  P.clearRect = function (...a) { if (isFog(this)) { st.t0 = performance.now(); st.on = true; } return clear.apply(this, a); };
  P.createRadialGradient = function (...a) { if (st.on && isFog(this)) st.grads++; return grad.apply(this, a); };
  P.restore = function () { const end = st.on && isFog(this) && this.globalCompositeOperation === 'destination-out'; const r = restore.apply(this); if (end) { st.ms += performance.now() - st.t0; st.draws++; st.on = false; } return r; };
};
(async () => {
  const b = await chromium.launch();
  for (const [name, strip] of [['с окнами разведки', false], ['без окон разведки', true]]) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ru-RU', serviceWorkers: 'block' });
    await ctx.request.post(BASE + '/api/auth/login', { data: { nickname: process.env.NICK || 'p1', password: 'secret123' } });
    await ctx.addInitScript(PROBE);
    const p = await ctx.newPage(); let peeked = 0;
    await p.route('**/api/games/*/my-map*', async (route) => { const res = await route.fetch(); let j; try { j = await res.json(); } catch { return route.fulfill({ response: res }); } if (Array.isArray(j.peeked)) { peeked = j.peeked.length; if (strip) j.peeked = []; } await route.fulfill({ response: res, json: j }); });
    await p.goto(`${BASE}/games/${GAME}/team`, { waitUntil: 'commit' }); await p.waitForSelector('.m-label', { timeout: 120000 }); await sleep(6000);
    const run = async (label, act) => { await p.evaluate(() => { const s = window.__fog; s.draws = 0; s.ms = 0; s.grads = 0; }); const t0 = Date.now(); await act(); const sec = (Date.now() - t0) / 1000; const s = await p.evaluate(() => ({ ...window.__fog })); console.log(`${name}, ${label}: кадров тумана ${(s.draws / sec).toFixed(0)}/с · кадр ${s.draws ? (s.ms / s.draws).toFixed(1) : '—'} мс · на туман ${(s.ms / sec).toFixed(0)} мс/с · окон в кадре ${s.draws ? (s.grads / s.draws / 10).toFixed(1) : 0} (кругов с размытым краем за кадр: ${s.draws ? (s.grads / s.draws).toFixed(0) : 0})`); };
    console.log(`разведанных мест у команды: ${peeked}`);
    await run('вид при входе', () => sleep(6000));
    // отдаляем карту: в кадре больше окон
    await p.mouse.move(195, 420); for (let i = 0; i < 5; i++) { await p.mouse.wheel(0, 500); await sleep(200); } await sleep(1500);
    await run('карта отдалена', () => sleep(6000));
    await ctx.close();
  }
  await b.close();
})().catch((e) => { console.error('ОШИБКА', e); process.exit(1); });
