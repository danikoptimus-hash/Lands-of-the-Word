// Сверка вида огня: прежний (в слое меток, CSS) и новый (на холсте) — одно и то же дело, один и тот же момент мерцания.
// Время в обеих версиях остановлено на T: кадрам холстов отдаётся постоянная отметка времени, анимации CSS ставятся на паузу.
//   OLD=http://localhost:3003 NEW=http://localhost:3001 node fire-look.cjs ПАПКА
const { chromium } = require('playwright'); const fs = require('fs');
const OLD = process.env.OLD || 'http://localhost:3003', NEW = process.env.NEW || 'http://localhost:3001', GAME = process.env.GAME || 'cmucujbgq0008s301ran0fnt4', OUT = process.argv[2] || 'fire-look';
const TS = (process.env.TS || '200,900,1700,2600').split(',').map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const login = async (ctx, base) => { const r = await ctx.request.post(base + '/api/auth/login', { data: { nickname: process.env.NICK || 'p1', password: 'secret123' } }); if (!r.ok()) throw new Error('вход ' + base); };
  // отметка приоритета на ближайшем к середине экрана деле (локальная копия; в конце снимается)
  const c0 = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ru-RU', serviceWorkers: 'block' }); await login(c0, NEW);
  const p0 = await c0.newPage(); await p0.addInitScript(() => { try { localStorage.setItem('lotw.intro.seen', '1'); } catch {} });
  await p0.goto(`${NEW}/games/${GAME}/team`, { waitUntil: 'commit' }); await p0.waitForSelector('.m-label', { timeout: 120000 }); await sleep(4000);
  // OVER=1 — дело, нижний край метки которого закрыт подписью города (подпись должна остаться выше огня); без приближения.
  const OVER = process.env.OVER === '1';
  const pick = await p0.evaluate((over) => { const labels = [...document.querySelectorAll('.m-label rect')].map((e) => e.getBoundingClientRect()); return [...document.querySelectorAll('.m-deed[data-id]')].filter((e) => !e.classList.contains('approved') && !e.classList.contains('sea')).map((e) => { const q = e.querySelector('circle').getBoundingClientRect(); const r = q.width / 2, cx = q.x + r, cy = q.y + r; return { id: e.getAttribute('data-id'), d: Math.hypot(cx - innerWidth / 2, cy - innerHeight / 2), prio: e.classList.contains('priority'), low: labels.some((l) => l.left < cx + r * 1.1 && l.right > cx - r * 1.1 && l.top < cy + r * 1.25 && l.bottom > cy + r * 0.2), seen: cx > 40 && cx < innerWidth - 40 && cy > 120 && cy < innerHeight - 140 }; }).filter((x) => !over || (x.low && x.seen)).sort((a, c) => a.d - c.d)[0]; }, OVER);
  if (!pick) throw new Error('подходящего дела в кадре нет');
  const setPrio = (on) => c0.request.post(`${NEW}/api/games/${GAME}/edge-tasks/${pick.id}/priority`, { data: { on } });
  if (!pick.prio) await setPrio(true);
  await p0.close();
  try {
    for (const T of TS) {
      for (const [name, base] of [['bylo', OLD], ['stalo', NEW]]) {
        const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ru-RU', serviceWorkers: 'block' }); await login(ctx, base);
        await ctx.addInitScript((t) => { try { localStorage.setItem('lotw.intro.seen', '1'); } catch {} const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => raf(() => cb(t)); }, T);
        const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
        await p.goto(`${base}/games/${GAME}/team`, { waitUntil: 'commit' }); await p.waitForSelector('.m-label', { timeout: 120000 }); await sleep(3500);
        // приближаем к метке: знак в полном размере
        const at = async () => p.evaluate((id) => { const q = document.querySelector(`.m-deed[data-id="${id}"] circle`).getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2, r: q.width / 2 }; }, pick.id);
        let c = await at(); await p.mouse.move(c.x, c.y); for (let i = 0; i < (OVER ? Number(process.env.ZOOM || 0) : 6); i++) { await p.mouse.wheel(0, -400); await sleep(250); }
        await sleep(1500); c = await at();
        await p.evaluate((t) => { for (const a of document.getAnimations()) { try { a.pause(); a.currentTime = t; } catch {} } }, T);
        await sleep(900);
        const clip = OVER ? { x: Math.max(0, Math.round(c.x - 50)), y: Math.max(0, Math.round(c.y - 50)), width: 100, height: 90 } : { x: Math.max(0, Math.round(c.x - 60)), y: Math.max(0, Math.round(c.y - 90)), width: 120, height: 140 };
        await p.screenshot({ path: `${OUT}/${name}-${T}.png`, clip });
        console.log(`${name}, момент ${T} мс: метка в (${c.x.toFixed(0)}, ${c.y.toFixed(0)}), радиус ${c.r.toFixed(1)} · холстов огня: ${await p.evaluate(() => document.querySelectorAll('canvas.deed-fire').length)} · частей огня в слое меток: ${await p.evaluate(() => document.querySelectorAll('.deed-fire .tongue').length)}${errs.length ? ' · ОШИБКИ ' + errs.join(' | ') : ''}`);
        await ctx.close();
      }
    }
  } finally { if (!pick.prio) await setPrio(false); await b.close(); }
})().catch((e) => { console.error('ОШИБКА', e); process.exit(1); });
