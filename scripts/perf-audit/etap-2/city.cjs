// Карточка города: сколько запросов уходит при открытии, что видно в первый момент, повторное открытие, разделы.
// BASE=http://localhost:3001 node city.cjs ПАПКА [задержка_мс]
const { chromium } = require('playwright');
const BASE = process.env.BASE, GAME = 'cmucujbgq0008s301ran0fnt4', OUT = process.argv[2], DELAY = Number(process.argv[3] || 600);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ru-RU', serviceWorkers: 'block' });
  await ctx.request.post(BASE + '/api/auth/login', { data: { nickname: 'p1', password: 'secret123' } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  let log = [];
  p.on('request', (r) => { const u = r.url(); if (u.includes('/api/') && !u.includes('/events')) log.push(r.method() + ' ' + u.replace(BASE, '').replace(/\/api\/games\/[^/]+/, '')); });
  await p.goto(`${BASE}/games/${GAME}/team`, { waitUntil: 'commit' }); await p.waitForSelector('.m-label', { timeout: 120000 }); await sleep(3000);
  const map = await (await ctx.request.get(`${BASE}/api/games/${GAME}/my-map`)).json();
  const foreign = map.cities.find((c) => c.owner && c.owner.name !== map.team.name);
  const free = map.cities.find((c) => !c.owner && !c.captured && c.hasContent);
  // Ответы городов задерживаем: так видно, что на экране до ответа сервера.
  await p.route('**/api/games/*/my-city/**', async (route) => { await sleep(DELAY); await route.continue(); });
  const click = (k) => p.evaluate((key) => { const el = document.querySelector(`.m-label[data-key="${key}"]`); if (!el) return false; el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; }, k);
  const head = () => p.evaluate(() => ({ title: document.querySelector('#city-title')?.textContent ?? null, status: document.querySelector('.city-head .status')?.textContent?.trim().slice(0, 60) ?? null, img: (document.querySelector('.city-head img')?.getAttribute('src') ?? '').split('/').pop(), skeleton: Boolean(document.querySelector('.city-sheet .skeleton, .city-sheet [aria-busy="true"]')), sections: [...document.querySelectorAll('.city-sheet details.disclose > summary')].map((s) => s.textContent.trim()) }));
  const close = async () => { const c = p.locator('button[aria-label="Закрыть"]:visible').last(); if (await c.count()) { await c.click().catch(() => {}); await sleep(400); } };
  for (const [name, key] of [['svoi', 'N:11,0'], ['chuzhoi', foreign && foreign.nodeKey], ['svobodnyi', free && free.nodeKey]]) {
    if (!key) { console.log(name, '— нет такого города'); continue; }
    log = []; const ok = await click(key); await sleep(120);
    const first = await head(); await p.screenshot({ path: `${OUT}/${name}-1-srazu.png` });
    await sleep(DELAY + 1800);
    const loaded = await head(); await p.screenshot({ path: `${OUT}/${name}-2-gotovo.png` });
    console.log(`\n== ${name} ${key} (найден: ${ok})`);
    console.log('  через 0,1 с:', JSON.stringify(first));
    console.log('  готово:     ', JSON.stringify(loaded));
    console.log('  запросов при открытии:', log.length, log.join(' · '));
    // Разделы: раскрываем по одному.
    const n = await p.locator('.city-sheet details.disclose > summary').count();
    for (let i = 0; i < n; i++) {
      const s = p.locator('.city-sheet details.disclose > summary').nth(i); const title = (await s.textContent()).trim();
      const wasOpen = await s.evaluate((el) => el.parentElement.open);
      log = []; if (!wasOpen) { await s.click(); await sleep(DELAY + 1200); }
      const body = await s.evaluate((el) => el.parentElement.innerText.replace(/\s+/g, ' ').slice(0, 90));
      console.log(`  раздел «${title}»${wasOpen ? ' (уже раскрыт)' : ''}: запросов ${log.length} ${log.join(' · ')} | ${body}`);
    }
    await p.screenshot({ path: `${OUT}/${name}-3-razdely.png`, fullPage: false });
    await close();
    // Повторное открытие.
    log = []; await click(key); await sleep(120);
    const again = await head(); const hasBody = await p.evaluate(() => document.querySelectorAll('.city-sheet .step-body, .city-sheet .steps, .city-sheet details.disclose').length);
    await p.screenshot({ path: `${OUT}/${name}-4-povtorno.png` });
    await sleep(DELAY + 1200);
    console.log('  повторно через 0,1 с:', JSON.stringify(again), '· частей листа на экране:', hasBody, '· запросов:', log.length, log.join(' · '));
    await close();
  }
  console.log(errs.length ? '\nОШИБКИ: ' + [...new Set(errs)].join(' | ') : '\nошибок страницы нет');
  await b.close();
})().catch((e) => { console.error('ОШИБКА', e.message); process.exit(1); });
