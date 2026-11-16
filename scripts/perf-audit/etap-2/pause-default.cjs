// «Пауза» под листом — у всех по умолчанию (решение владельца 16.11). На разных экранах: какую долю карты закрывает лист,
// рисуют ли слои под ним, оживают ли после закрытия. Замирать карта должна только там, где лист закрывает её почти целиком.
// BASE=http://localhost:3001 node pause-default.cjs
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3001', GAME = process.env.GAME || 'cmucujbgq0008s301ran0fnt4', CITY = process.env.CITY || 'N:11,0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const COUNT = () => {
  window.__draws = { c2d: 0, gl: 0 };
  const c = CanvasRenderingContext2D.prototype.clearRect; CanvasRenderingContext2D.prototype.clearRect = function (...a) { window.__draws.c2d++; return c.apply(this, a); };
  for (const P of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) { if (!P) continue; const d = P.prototype.drawArrays; P.prototype.drawArrays = function (...a) { window.__draws.gl++; return d.apply(this, a); }; }
  try { localStorage.setItem('lotw.intro.seen', '1'); } catch {}
};
(async () => {
  const b = await chromium.launch(); const errs = [];
  for (const [name, w, h, mobile] of [['телефон 390×844', 390, 844, true], ['малый телефон 360×640', 360, 640, true], ['планшет 768×1024', 768, 1024, true], ['ноутбук 1280×800', 1280, 800, false]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, locale: 'ru-RU', serviceWorkers: 'block' });
    await ctx.request.post(BASE + '/api/auth/login', { data: { nickname: process.env.NICK || 'p1', password: 'secret123' } });
    await ctx.addInitScript(COUNT);
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${BASE}/games/${GAME}/team`, { waitUntil: 'commit' }); await p.waitForSelector('.m-label', { timeout: 120000 }); await sleep(5000);
    const rate = async (sec) => { const d0 = await p.evaluate(() => ({ ...window.__draws })); await sleep(sec * 1000); const d1 = await p.evaluate(() => ({ ...window.__draws })); return `${((d1.c2d - d0.c2d) / sec).toFixed(0)} / ${((d1.gl - d0.gl) / sec).toFixed(0)}`; };
    const cover = () => p.evaluate(() => { const host = document.querySelector('.map-area') || document.querySelector('.team-map'); const m = host.getBoundingClientRect(), area = m.width * m.height; let most = 0; for (const el of document.querySelectorAll('.overlay, .side-menu')) { const r = el.getBoundingClientRect(); const ww = Math.min(r.right, m.right) - Math.max(r.left, m.left), hh = Math.min(r.bottom, m.bottom) - Math.max(r.top, m.top); if (ww > 0 && hh > 0) most = Math.max(most, (ww * hh) / area); } return Math.round(most * 100); });
    const free = await rate(4);
    await p.evaluate((k) => document.querySelector(`.m-label[data-key="${k}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true })), CITY);
    await p.waitForSelector('.city-sheet', { timeout: 30000 }); await sleep(1500);
    const cityCover = await cover(), city = await rate(4);
    await p.locator('button[aria-label="Закрыть"]:visible').last().click(); await sleep(300);
    const back = await rate(3);
    let side = '—', sideCover = '—';
    const btn = p.locator('.team-dock .dock-btn').first();
    if (await btn.count()) { await btn.click({ force: true }); await sleep(1500); sideCover = await cover() + ' %'; side = await rate(4); await btn.click({ force: true }); await sleep(400); }
    console.log(`${name}: карта открыта ${free} · лист города (${cityCover} % карты) ${city} · лист закрыли ${back} · раздел панели (${sideCover}) ${side}   [рисований в секунду: 2D / WebGL]`);
    console.log(`   запомнено на устройстве: ${await p.evaluate(() => localStorage.getItem('lotw.under2'))} (пусто — режим по умолчанию)`);
    await ctx.close();
  }
  console.log(errs.length ? 'ОШИБКИ: ' + [...new Set(errs)].join(' | ') : 'ошибок страницы нет');
  await b.close();
})().catch((e) => { console.error('ОШИБКА', e.message); process.exit(1); });
