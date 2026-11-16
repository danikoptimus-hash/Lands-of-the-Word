// Огонь на холсте: не остаётся ли следов после зума и протяжки. Считает точки холстов огня вне мест, где сейчас стоят
// приоритетные метки. Отметки ставит капитан локальной копии и в конце возвращает как были.
//   BASE=http://localhost:3001 node fire-ghost.cjs [ПАПКА_СНИМКОВ]
const { chromium } = require('playwright'); const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:3001', GAME = process.env.GAME || 'cmucujbgq0008s301ran0fnt4', OUT = process.argv[2] || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: Number(process.env.DSF || 2), isMobile: true, hasTouch: true, locale: 'ru-RU', serviceWorkers: 'block' });
  await ctx.request.post(BASE + '/api/auth/login', { data: { nickname: 'p1', password: 'secret123' } });
  await ctx.addInitScript(() => { try { localStorage.setItem('lotw.intro.seen', '1'); } catch {} });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
  const setPrio = async (id, on) => (await ctx.request.post(`${BASE}/api/games/${GAME}/edge-tasks/${id}/priority`, { data: { on } })).ok();
  await p.goto(`${BASE}/games/${GAME}/team`, { waitUntil: 'commit' }); await p.waitForSelector('.m-label', { timeout: 120000 }); await sleep(4000);
  if (await p.locator('.side-menu').count()) { await p.locator('.side-menu .menu-sub .ghost.icon').click(); await sleep(500); }
  const deeds = await p.evaluate(() => [...document.querySelectorAll('.m-deed[data-id]')].map((e) => { const q = e.getBoundingClientRect(); return { id: e.getAttribute('data-id'), prio: e.classList.contains('priority'), ok: !e.classList.contains('approved'), d: Math.hypot(q.x + q.width / 2 - innerWidth / 2, q.y + q.height / 2 - innerHeight / 2) }; }).sort((a, c) => a.d - c.d));
  const add = deeds.filter((x) => x.ok && !x.prio).slice(0, Number(process.env.N || 7)); const marked = [];
  const stray = (tag) => p.evaluate((tag) => {
    const marks = [...document.querySelectorAll('.m-deed.priority')].map((g) => { const c = g.querySelector('circle:not(.far)') || g.querySelector('circle'); const q = c.getBoundingClientRect(); return { cx: q.x + q.width / 2, cy: q.y + q.height / 2, r: q.width / 2, shown: getComputedStyle(g).display !== 'none' && q.width > 0 }; });
    const out = { метка: tag, 'приоритетных меток': marks.length, 'из них видимых': marks.filter((m) => m.shown).length };
    for (const cv of document.querySelectorAll('canvas.deed-fire')) {
      const part = cv.classList.contains('back') ? 'нижний' : 'верхний'; const host = cv.getBoundingClientRect(); const f = cv.width / host.width;
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let all = 0, bad = 0; const spots = [];
      const inside = (x, y) => marks.some((m) => { if (!m.shown) return false; const s = m.r / 12; return x >= (m.cx - host.x - 42 * s) * f - 3 && x <= (m.cx - host.x + 42 * s) * f + 3 && y >= (m.cy - host.y - 56 * s) * f - 3 && y <= (m.cy - host.y + 36 * s) * f + 3; });
      for (let y = 0; y < cv.height; y += 2) for (let x = 0; x < cv.width; x += 2) { if (d[(y * cv.width + x) * 4 + 3] > 24) { all++; if (!inside(x, y)) { bad++; if (spots.length < 4 && !spots.some((s) => Math.hypot(s[0] - x / f, s[1] - y / f) < 30)) spots.push([Math.round(x / f), Math.round(y / f)]); } } }
      out[part + ' холст: точек огня'] = all; out[part + ' холст: вне меток'] = bad; if (bad) out[part + ': где'] = spots.map((s) => s.join(',')).join(' ; ');
    }
    const m = document.querySelector('.map-svg.world.passthrough'); out['масштаб'] = m ? Number(getComputedStyle(m).getPropertyValue('--k')).toFixed(2) : '?';
    return out;
  }, tag);
  let n = 0; const shot = async (tag) => { const r = await stray(tag); console.log(JSON.stringify(r)); if (OUT) await p.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}.png` }); return r; };
  try {
    for (const x of add) { if (await setPrio(x.id, true)) marked.push(x.id); }
    await sleep(3000);
    await shot('исходный вид');
    await p.mouse.move(195, 420);
    for (let i = 0; i < 4; i++) { await p.mouse.wheel(0, -300); await sleep(120); } await sleep(1500); await shot('колесо: ближе ×4');
    for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, 300); await sleep(120); } await sleep(1500); await shot('колесо: дальше ×6');
    for (let i = 0; i < 3; i++) { await p.mouse.wheel(0, -300); await sleep(120); } await sleep(1500); await shot('колесо: ближе ×3');
    // щипок двумя пальцами (как на телефоне)
    const cdp = await ctx.newCDPSession(p);
    const pinch = async (from, to, steps = 14) => { const pts = (g) => [{ x: 195 - g, y: 420 - g * 0.6, id: 1 }, { x: 195 + g, y: 420 + g * 0.6, id: 2 }]; await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) }); for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(from + (to - from) * i / steps) }); await sleep(30); } await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
    await pinch(40, 150); await sleep(1500); await shot('щипок: ближе');
    await pinch(150, 50); await sleep(1500); await shot('щипок: дальше');
    // туда-сюда через пороги (метки видны с масштаба 0,9; полные подписи с 1,6), быстро и без пауз между жестами
    const seq = [[160, 40], [40, 170], [170, 60], [60, 140], [150, 30], [30, 160], [40, 180], [180, 90], [90, 150], [160, 70], [50, 130], [130, 45], [45, 175]];
    for (let i = 0; i < seq.length; i++) {
      await pinch(seq[i][0], seq[i][1], 6 + (i % 3) * 6); await sleep(i % 2 ? 250 : 900);
      if (i % 3 === 0) { await p.mouse.move(195, 420); await p.mouse.down(); await p.mouse.move(195 + (i % 2 ? 90 : -110), 420 + (i % 4 < 2 ? 120 : -100), { steps: 6 }); await p.mouse.up(); }
      await sleep(700); const r = await shot('жест ' + (i + 1));
    }
    await sleep(1500); await shot('в конце');
  } finally { for (const id of marked) await setPrio(id, false); }
  console.log(errs.length ? 'ОШИБКИ: ' + [...new Set(errs)].join(' | ') : 'ошибок страницы нет');
  await b.close();
})().catch((e) => { console.error('ОШИБКА', e); process.exit(1); });
