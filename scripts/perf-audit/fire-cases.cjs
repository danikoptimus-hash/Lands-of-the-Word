// Огонь приоритетных дел на холсте: случаи. Сколько раз в секунду рисуют холсты огня — в покое, под листом города,
// когда огонь за краем экрана, при «уменьшить движение»; появляется и исчезает ли огонь вместе с отметкой.
//   BASE=http://localhost:3001 node fire-cases.cjs
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3001', GAME = process.env.GAME || 'cmucujbgq0008s301ran0fnt4', CITY = process.env.CITY || 'N:11,0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROBE = () => {
  try { localStorage.setItem('lotw.intro.seen', '1'); } catch {}
  const st = (window.__fire = { fills: 0, clears: 0 });
  const P = CanvasRenderingContext2D.prototype, fill = P.fill, clear = P.clearRect;
  const mine = (c) => c.canvas && c.canvas.classList && c.canvas.classList.contains('deed-fire');
  P.fill = function (...a) { if (mine(this)) st.fills++; return fill.apply(this, a); };
  P.clearRect = function (...a) { if (mine(this)) st.clears++; return clear.apply(this, a); };
};
(async () => {
  const b = await chromium.launch(); const errs = [];
  const mk = async (opts = {}) => { const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ru-RU', serviceWorkers: 'block', ...opts }); await ctx.request.post(BASE + '/api/auth/login', { data: { nickname: process.env.NICK || 'p1', password: 'secret123' } }); await ctx.addInitScript(PROBE); return ctx; };
  const ctx = await mk(); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
  const setPrio = async (id, on) => (await ctx.request.post(`${BASE}/api/games/${GAME}/edge-tasks/${id}/priority`, { data: { on } })).ok();
  await p.goto(`${BASE}/games/${GAME}/team`, { waitUntil: 'commit' }); await p.waitForSelector('.m-label', { timeout: 120000 }); await sleep(4000);
  const ids = await p.evaluate(() => [...document.querySelectorAll('.m-deed[data-id]')].map((e) => { const q = e.getBoundingClientRect(); const cx = q.x + q.width / 2, cy = q.y + q.height / 2; return { id: e.getAttribute('data-id'), d: Math.hypot(cx - innerWidth / 2, cy - innerHeight / 2), prio: e.classList.contains('priority'), ok: !e.classList.contains('approved'), seen: cx > 30 && cx < innerWidth - 30 && cy > 100 && cy < innerHeight - 120 }; }).sort((a, c) => a.d - c.d));
  const was = ids.filter((x) => x.prio).map((x) => x.id); for (const id of was) await setPrio(id, false);
  const rate = async (sec) => { await p.evaluate(() => { window.__fire.fills = 0; window.__fire.clears = 0; }); await sleep(sec * 1000); const s = await p.evaluate(() => ({ ...window.__fire })); return `заливок ${(s.fills / sec).toFixed(0)}/с`; };
  const canv = () => p.evaluate(() => document.querySelectorAll('canvas.deed-fire').length);
  const marked = [];
  try {
    await sleep(1500);
    console.log(`без отметок: холстов огня ${await canv()} · ${await rate(3)}`);
    const near = ids.filter((x) => x.ok && x.seen)[0]; await setPrio(near.id, true); marked.push(near.id); await sleep(2500);
    console.log(`отметили дело в кадре: холстов огня ${await canv()} · ${await rate(4)} (один огонь — 15 заливок за кадр)`);
    // выбранное дело: кружок крупнее, огонь тоже
    await p.evaluate((id) => document.querySelector(`.m-deed[data-id="${id}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true })), near.id); await sleep(1500);
    console.log(`дело выбрано (лист дела открыт): ${await rate(3)}`);
    await p.locator('button[aria-label="Закрыть"]:visible').last().click().catch(() => {}); await sleep(800);
    // под листом города
    await p.evaluate((k) => document.querySelector(`.m-label[data-key="${k}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true })), CITY); await p.waitForSelector('.city-sheet', { timeout: 30000 }); await sleep(1500);
    console.log(`под листом города: ${await rate(4)}`);
    await p.locator('button[aria-label="Закрыть"]:visible').last().click(); await sleep(800);
    console.log(`лист закрыли: ${await rate(3)}`);
    // огонь за краем экрана: уводим карту
    await p.mouse.move(195, 420); await p.mouse.down(); await p.mouse.move(195 + 330, 420 + 500, { steps: 12 }); await p.mouse.up(); await sleep(800);
    const still = await p.evaluate((id) => { const e = document.querySelector(`.m-deed[data-id="${id}"]`); if (!e) return 'метки нет'; const q = e.getBoundingClientRect(); return (q.right < 0 || q.left > innerWidth || q.bottom < 0 || q.top > innerHeight) ? 'за краем' : 'в кадре'; }, near.id);
    console.log(`карту увели, метка ${still}: ${await rate(3)}`);
    await setPrio(near.id, false); marked.length = 0; await sleep(2500);
    console.log(`отметку сняли: холстов огня ${await canv()}`);
  } finally { for (const id of marked) await setPrio(id, false); for (const id of was) await setPrio(id, true); }
  await ctx.close();
  // «уменьшить движение»: огонь стоит
  const c2 = await mk({ reducedMotion: 'reduce' }); const p2 = await c2.newPage(); p2.on('pageerror', (e) => errs.push(e.message));
  await p2.goto(`${BASE}/games/${GAME}/team`, { waitUntil: 'commit' }); await p2.waitForSelector('.m-label', { timeout: 120000 }); await sleep(5000);
  await p2.evaluate(() => { window.__fire.fills = 0; }); await sleep(3000);
  console.log(`«уменьшить движение»: холстов огня ${await p2.evaluate(() => document.querySelectorAll('canvas.deed-fire').length)} · заливок ${(await p2.evaluate(() => window.__fire.fills) / 3).toFixed(0)}/с (огонь стоит)`);
  await c2.close();
  console.log(errs.length ? 'ОШИБКИ: ' + [...new Set(errs)].join(' | ') : 'ошибок страницы нет');
  await b.close();
})().catch((e) => { console.error('ОШИБКА', e); process.exit(1); });
