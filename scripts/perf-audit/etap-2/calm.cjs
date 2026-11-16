// Новая версия при открытом листе: страница не перезагружается, пока лист открыт; после закрытия — перезагружается,
// карта остаётся на том же месте. BASE=http://localhost:3001 node calm.cjs  (во время теста пересобирает apps/web)
const { chromium } = require('playwright'); const { execSync } = require('child_process');
const BASE = process.env.BASE || 'http://localhost:3001', GAME = 'cmucujbgq0008s301ran0fnt4', WEB = process.env.WEB;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ru-RU' });
  await ctx.request.post(BASE + '/api/auth/login', { data: { nickname: 'p1', password: 'secret123' } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`${BASE}/games/${GAME}/team`, { waitUntil: 'commit' }); await p.waitForSelector('.m-label', { timeout: 120000 });
  await p.waitForFunction(() => Boolean(navigator.serviceWorker && navigator.serviceWorker.controller), null, { timeout: 60000 });
  await sleep(2500);
  const pos = () => p.evaluate(() => { const r = document.querySelector('.m-label[data-key="N:11,0"]')?.getBoundingClientRect(); return r ? [Math.round(r.x), Math.round(r.y)] : null; });
  await p.mouse.move(200, 400); await p.mouse.down(); await p.mouse.move(110, 330, { steps: 8 }); await p.mouse.up(); await sleep(500);
  const before = await pos();
  await p.evaluate(() => { window.__mark = 1; document.querySelector('.m-label[data-key="N:11,0"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await p.waitForSelector('.city-sheet', { timeout: 30000 }); await sleep(800);
  console.log('лист города открыт; собираю новую версию…');
  execSync('npx vite build', { cwd: WEB, stdio: 'ignore' });
  await p.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r && r.update()));
  // ждём, пока новая версия возьмёт страницу под управление, и ещё 8 секунд
  await sleep(12000);
  const still = await p.evaluate(() => ({ mark: window.__mark === 1, sheet: Boolean(document.querySelector('.city-sheet')) })).catch(() => ({ mark: false, sheet: false }));
  console.log(`через 12 с после выхода новой версии: страница не перезагружена — ${still.mark}, лист города на месте — ${still.sheet}`);
  const t0 = Date.now();
  await p.locator('button[aria-label="Закрыть"]:visible').last().click();
  let reloaded = false;
  for (let i = 0; i < 80; i++) { await sleep(250); const m = await p.evaluate(() => window.__mark === 1).catch(() => false); if (!m) { reloaded = true; break; } }
  console.log(`после закрытия листа страница перезагрузилась: ${reloaded} (через ${Date.now() - t0} мс)`);
  await p.waitForSelector('.m-label', { timeout: 120000 }); await sleep(3500);
  console.log(`карта до перезагрузки ${JSON.stringify(before)} · после ${JSON.stringify(await pos())} · лист города: ${await p.locator('.city-sheet').count()} · адрес «${p.url().split('/team')[1]}»`);
  console.log(errs.length ? 'ОШИБКИ: ' + [...new Set(errs)].join(' | ') : 'ошибок страницы нет');
  await b.close();
})().catch((e) => { console.error('ОШИБКА', e.message); process.exit(1); });
