// Значки наград на экране тройной плотности: прежняя версия (крупные файлы) и новая (уменьшенные копии).
const { chromium } = require('playwright');
const GAME = 'cmucujbgq0008s301ran0fnt4', OUT = process.argv[2]; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  for (const [name, base] of [['do', 'http://localhost:3002'], ['posle', 'http://localhost:3001']]) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ru-RU', serviceWorkers: 'block' });
    await ctx.request.post(base + '/api/auth/login', { data: { nickname: 'p1', password: 'secret123' } });
    const p = await ctx.newPage();
    await p.goto(`${base}/games/${GAME}/team`, { waitUntil: 'commit' }); await p.waitForSelector('.m-label', { timeout: 120000 }); await sleep(2500);
    const btn = p.locator('.team-dock .dock-btn').nth(1); const bb = await btn.boundingBox(); await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(1500);
    // вкладка «Награды», если есть
    const tab = p.locator('button:has-text("Награды"), [role="tab"]:has-text("Награды")').first(); if (await tab.count()) { await tab.click().catch(() => {}); await sleep(2500); }
    await p.screenshot({ path: `${OUT}/${name}-razdel.png` });
    const grid = p.locator('.award-grid').first(); if (await grid.count()) await grid.screenshot({ path: `${OUT}/${name}-setka.png` });
    const strip = p.locator('.award-strip').first(); if (await strip.count()) await strip.screenshot({ path: `${OUT}/${name}-lenta.png` });
    console.log(name, 'сетка:', await grid.count(), 'лента:', await strip.count(), 'значков на экране:', await p.locator('.award-img img').count(), 'адрес первого:', await p.locator('.award-img img').first().getAttribute('src').catch(() => null));
    await ctx.close();
  }
  await b.close();
})().catch((e) => { console.error('ОШИБКА', e.message); process.exit(1); });
