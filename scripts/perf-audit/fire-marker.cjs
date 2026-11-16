// Кружок метки без единого огня на карте: прежняя (огонь в слое меток) и новая сборка должны рисовать его одинаково.
// Так найдено, что прежний огонь портил вид всех меток слоя. Отметки приоритета снимаются и в конце возвращаются;
// прежнюю сборку после снятия надо перезапустить (она помнит карту): RESTART="команда перезапуска" node fire-marker.cjs
const { chromium } = require('playwright'); const fs = require('fs'); const { execSync } = require('child_process');
const OLD = 'http://localhost:3003', NEW = 'http://localhost:3001', GAME = 'cmucujbgq0008s301ran0fnt4', OUT = 'fire-krug', T = 200, ID = 'cmuo6fz3d0063sy011q717kn0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch();
  const mk = async (base, dsf) => { const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: dsf, isMobile: true, hasTouch: true, locale: 'ru-RU', serviceWorkers: 'block' }); const r = await ctx.request.post(base + '/api/auth/login', { data: { nickname: 'p1', password: 'secret123' } }); if (!r.ok()) throw new Error('вход'); await ctx.addInitScript((t) => { try { localStorage.setItem('lotw.intro.seen', '1'); } catch {} const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => raf(() => cb(t)); }, T); return ctx; };
  const c0 = await mk(NEW, 1); const p0 = await c0.newPage();
  await p0.goto(`${NEW}/games/${GAME}/team`, { waitUntil: 'commit' }); await p0.waitForSelector('.m-label', { timeout: 120000 }); await sleep(4000);
  const was = await p0.evaluate(() => [...document.querySelectorAll('.m-deed.priority[data-id]')].map((e) => e.getAttribute('data-id')));
  console.log('отметок приоритета было:', was.length);
  const setPrio = (id, on) => c0.request.post(`${NEW}/api/games/${GAME}/edge-tasks/${id}/priority`, { data: { on } });
  await p0.close();
  try {
    for (const id of was) await setPrio(id, false);
    execSync(process.env.RESTART, { stdio: 'ignore', shell: '/bin/bash' });
    for (const [name, base] of [['bylo', OLD], ['stalo', NEW]]) {
      const ctx = await mk(base, 3); const p = await ctx.newPage();
      await p.goto(`${base}/games/${GAME}/team`, { waitUntil: 'commit' }); await p.waitForSelector('.m-label', { timeout: 120000 }); await sleep(4500);
      const info = await p.evaluate((id) => { const g = document.querySelector(`.m-deed[data-id="${id}"]`); const q = g.querySelector('circle').getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2, cls: g.getAttribute('class'), anim: document.getAnimations().length, prio: document.querySelectorAll('.m-deed.priority').length }; }, ID);
      await p.evaluate((t) => { for (const a of document.getAnimations()) { try { a.pause(); a.currentTime = t; } catch {} } }, T); await sleep(800);
      await p.screenshot({ path: `${OUT}/${name}-pusto.png`, clip: { x: Math.round(info.x - 20), y: Math.round(info.y - 20), width: 40, height: 40 } });
      console.log(name, 'без единого огня на карте', JSON.stringify(info));
      await ctx.close();
    }
  } finally { for (const id of was) await setPrio(id, true); await b.close(); }
})().catch((e) => { console.error('ОШИБКА', e); process.exit(1); });
