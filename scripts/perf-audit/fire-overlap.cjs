// Сколько меток дел перекрываются с подписями городов (там малые языки огня теперь легли бы поверх подписи).
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3001', GAME = 'cmucujbgq0008s301ran0fnt4';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch();
  for (const [w, h, mobile] of [[390, 844, true], [1366, 768, false]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, locale: 'ru-RU', serviceWorkers: 'block' });
    await ctx.request.post(BASE + '/api/auth/login', { data: { nickname: 'p1', password: 'secret123' } });
    await ctx.addInitScript(() => { try { localStorage.setItem('lotw.intro.seen', '1'); } catch {} });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/games/${GAME}/team`, { waitUntil: 'commit' }); await p.waitForSelector('.m-label', { timeout: 120000 }); await sleep(3500);
    const probe = () => p.evaluate(() => {
      const labels = [...document.querySelectorAll('.m-label')].map((e) => e.getBoundingClientRect()).filter((q) => q.width > 0);
      const deeds = [...document.querySelectorAll('.m-deed')].map((e) => { const c = e.querySelector('circle:not(.far)'); return c ? c.getBoundingClientRect() : null; }).filter(Boolean).filter((q) => q.right > 0 && q.left < innerWidth && q.bottom > 0 && q.top < innerHeight);
      let hit = 0, low = 0;
      for (const d of deeds) {
        const r = d.width / 2, cx = d.left + r, cy = d.top + r;
        // зона малых языков: нижняя половина кружка с запасом в сторону и вниз
        const fx0 = cx - r * 1.1, fx1 = cx + r * 1.1, fy0 = cy, fy1 = cy + r * 1.25;
        const any = labels.some((l) => l.left < d.right && l.right > d.left && l.top < d.bottom && l.bottom > d.top);
        const lo = labels.some((l) => l.left < fx1 && l.right > fx0 && l.top < fy1 && l.bottom > fy0);
        if (any) hit++; if (lo) low++;
      }
      const m = document.querySelector('.map-svg.world.passthrough'); const k = m ? getComputedStyle(m).getPropertyValue('--k') : '?';
      return { k: Number(k).toFixed(2), deeds: deeds.length, labels: labels.length, hit, low };
    });
    console.log(`экран ${w}×${h}`);
    console.log('  исходный масштаб', JSON.stringify(await probe()));
    for (const dz of [-300, -300, -300, 300, 300, 300, 300, 300, 300, 300, 300]) { await p.mouse.move(w / 2, h / 2); await p.mouse.wheel(0, -dz); await sleep(900); console.log('  колесо', dz > 0 ? 'ближе' : 'дальше', JSON.stringify(await probe())); }
    await ctx.close();
  }
  await b.close();
})().catch((e) => { console.error('ОШИБКА', e); process.exit(1); });
