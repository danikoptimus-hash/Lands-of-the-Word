// Место в игре после перезагрузки, маленькие значки наград, прогрев картинок по времени суток.
// BASE=http://localhost:3001 node place.cjs
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3001', GAME = 'cmucujbgq0008s301ran0fnt4';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch();
  const mk = async (opts = {}) => { const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ru-RU', serviceWorkers: 'block', ...opts }); await ctx.request.post(BASE + '/api/auth/login', { data: { nickname: 'p1', password: 'secret123' } }); return ctx; };
  const errs = [];
  // 1. Раздел и город в адресе; положение карты.
  {
    const ctx = await mk(); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${BASE}/games/${GAME}/team`, { waitUntil: 'commit' }); await p.waitForSelector('.m-label', { timeout: 120000 }); await sleep(2500);
    const btns = p.locator('.team-dock .dock-btn'); const n = await btns.count();
    // второй раздел панели
    const bb = await btns.nth(1).boundingBox(); await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(1200);
    const url1 = p.url(); const title1 = (await p.locator('.side-menu h2, .side-menu h1').first().textContent().catch(() => '')) || '';
    await p.reload({ waitUntil: 'commit' }); await p.waitForSelector('.m-label', { timeout: 120000 }); await sleep(2500);
    const title2 = (await p.locator('.side-menu h2, .side-menu h1').first().textContent().catch(() => '')) || '';
    console.log(`раздел: адрес «${url1.split('/team')[1]}» · до перезагрузки «${title1.trim().slice(0, 30)}» · после «${title2.trim().slice(0, 30)}» · кнопок панели ${n}`);
    // закрыть раздел, открыть город
    await p.goto(`${BASE}/games/${GAME}/team`, { waitUntil: 'commit' }); await p.waitForSelector('.m-label', { timeout: 120000 }); await sleep(2500);
    await p.evaluate(() => document.querySelector('.m-label[data-key="N:11,0"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))); await sleep(1500);
    const url2 = p.url();
    await p.reload({ waitUntil: 'commit' }); await p.waitForSelector('.city-sheet', { timeout: 60000 }).catch(() => {}); await sleep(1500);
    console.log(`город: адрес «${decodeURIComponent(url2.split('/team')[1])}» · после перезагрузки лист города: ${await p.locator('.city-sheet').count()} · заголовок «${await p.locator('#city-title').textContent().catch(() => '')}»`);
    await p.locator('button[aria-label="Закрыть"]:visible').last().click().catch(() => {}); await sleep(500);
    console.log(`после закрытия города адрес: «${p.url().split('/team')[1]}»`);
    // чужой город в адресе (команда не дошла) не открывается
    await p.goto(`${BASE}/games/${GAME}/team?city=N:99,99`, { waitUntil: 'commit' }); await p.waitForSelector('.m-label', { timeout: 120000 }); await sleep(2000);
    console.log(`несуществующий город в адресе: листов ${await p.locator('.city-sheet').count()} · адрес «${p.url().split('/team')[1]}»`);
    // положение карты: сдвигаем, «перезагрузка на новую версию», сравниваем место подписи города
    const pos = () => p.evaluate(() => { const r = document.querySelector('.m-label[data-key="N:11,0"]')?.getBoundingClientRect(); return r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width)] : null; });
    const p0 = await pos();
    await p.mouse.move(200, 400); await p.mouse.down(); await p.mouse.move(120, 300, { steps: 8 }); await p.mouse.up(); await sleep(400);
    await p.mouse.wheel(0, -400); await sleep(800);
    const p1 = await pos();
    await p.evaluate(() => window.dispatchEvent(new Event('lotw:before-reload')));
    await p.reload({ waitUntil: 'commit' }); await p.waitForSelector('.m-label', { timeout: 120000 }); await sleep(3000);
    const p2 = await pos();
    await p.reload({ waitUntil: 'commit' }); await p.waitForSelector('.m-label', { timeout: 120000 }); await sleep(3000);
    const p3 = await pos();
    console.log(`карта: у старта ${JSON.stringify(p0)} · после сдвига ${JSON.stringify(p1)} · после перезагрузки «на новую версию» ${JSON.stringify(p2)} · после обычной перезагрузки ${JSON.stringify(p3)}`);
    await ctx.close();
  }
  // 2. Значки наград: в рейтинге — маленькие, в листе награды — крупный.
  {
    const ctx = await mk(); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    const got = { small: 0, big: 0, smallBytes: 0, bigBytes: 0 };
    p.on('response', async (r) => { const u = r.url(); if (!u.includes('/img/awards/')) return; const len = Number((await r.allHeaders())['content-length'] || 0); if (u.includes('/img/awards/s/')) { got.small++; got.smallBytes += len; } else { got.big++; got.bigBytes += len; } });
    await p.goto(`${BASE}/games/${GAME}/team?view=service`, { waitUntil: 'commit' }); await p.waitForSelector('.m-label', { timeout: 120000 }); await sleep(6000);
    console.log(`награды, раздел «Служение» и прогрев: маленьких ${got.small} (${(got.smallBytes / 1024).toFixed(0)} КБ) · крупных ${got.big} (${(got.bigBytes / 1024).toFixed(0)} КБ)`);
    await p.screenshot({ path: process.env.OUT ? process.env.OUT + '/nagrady.png' : '/dev/null' }).catch(() => {});
    const badge = p.locator('.award:visible').first();
    if (await badge.count()) { await badge.click().catch(() => {}); await sleep(1500); console.log(`после открытия листа награды: крупных ${got.big} · лист: ${await p.locator('.award.lg').count()}`); }
    await ctx.close();
  }
  // 3. Прогрев картинок карты по времени суток (часы телефона — 20:10 и 13:00).
  for (const [name, hh, mm] of [['вечер 20:10', 20, 10], ['день 13:00', 13, 0], ['у границы 17:50', 17, 50]]) {
    const ctx = await mk({ timezoneId: 'Asia/Tashkent' }); const p = await ctx.newPage();
    const d = new Date(); d.setUTCHours(hh - 5, mm, 0, 0);
    await p.clock.install({ time: d });
    const seen = { day: 0, evening: 0, morning: 0, night: 0, bytes: 0 };
    p.on('response', async (r) => { const u = r.url(); if (!/\/img\/(terrain|city|start|islet)\//.test(u)) return; const ph = /-(evening|morning|night)\.webp/.exec(u)?.[1] ?? 'day'; seen[ph]++; seen.bytes += Number((await r.allHeaders())['content-length'] || 0); });
    await p.goto(`${BASE}/?stay=1`, { waitUntil: 'commit' }); await sleep(5000);
    console.log(`прогрев картинок, ${name}: ${JSON.stringify(seen)} (${(seen.bytes / 1024 / 1024).toFixed(2)} МБ)`);
    await ctx.close();
  }
  console.log(errs.length ? 'ОШИБКИ: ' + [...new Set(errs)].join(' | ') : 'ошибок страницы нет');
  await b.close();
})().catch((e) => { console.error('ОШИБКА', e.message); process.exit(1); });
