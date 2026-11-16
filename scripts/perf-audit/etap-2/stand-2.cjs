// Стенд после этапа 2: город одним запросом, переключатель «карта под листом», формат карты, события.
const { chromium } = require('playwright');
const BASE = 'https://test.landsoftheword.com', GAME = 'cmw10wkta004uuz013e998u98', OUT = process.argv[2]; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ru-RU', serviceWorkers: 'block' });
  const r = await ctx.request.post(BASE + '/api/dev/become', { data: { nickname: 'tg_m1' } }); if (!r.ok()) throw new Error('вход ботом: ' + r.status());
  await ctx.addInitScript(() => { window.__draws = { c2d: 0, gl: 0 }; const c = CanvasRenderingContext2D.prototype.clearRect; CanvasRenderingContext2D.prototype.clearRect = function (...a) { window.__draws.c2d++; return c.apply(this, a); }; for (const P of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) { if (!P) continue; const d = P.prototype.drawArrays; P.prototype.drawArrays = function (...a) { window.__draws.gl++; return d.apply(this, a); }; } });
  // формат карты
  for (const h of [{}, { 'x-lotw-wire': '2' }]) { const m = await ctx.request.get(`${BASE}/api/games/${GAME}/my-map`, { headers: h }); const t = await m.text(); const j = JSON.parse(t); console.log(`карта стенда ${h['x-lotw-wire'] ? 'со справочником' : 'в прежнем виде'}: ${t.length} знаков · сторон ${j.tasks.length} · справочник ${j.deedTexts ? Object.keys(j.deedTexts).length + ' текстов' : 'нет'}`); }
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
  let log = []; p.on('request', (q) => { const u = new URL(q.url()); if (u.pathname.startsWith('/api/') && !u.pathname.endsWith('/events') && !u.pathname.startsWith('/api/dev/')) log.push(q.method() + ' ' + u.pathname.replace(`/api/games/${GAME}`, '') + (u.search ? '?…' : '')); });
  await p.goto(`${BASE}/games/${GAME}/team`, { waitUntil: 'commit' }); await p.waitForSelector('.m-label', { timeout: 120000 }); await sleep(5000);
  const map = await (await ctx.request.get(`${BASE}/api/games/${GAME}/my-map`)).json();
  const own = map.cities.find((c) => c.captured), other = map.cities.find((c) => !c.captured);
  // панель стенда: переключатель режимов
  const sw = await p.evaluate(() => [...document.querySelectorAll('button')].filter((x) => ['Как сейчас', 'Редко', 'Пауза'].includes(x.textContent.trim())).map((x) => x.textContent.trim()));
  console.log('переключатель в панели стенда:', sw.join(' · ') || 'не найден (панель свёрнута?)');
  const draws = () => p.evaluate(() => ({ ...window.__draws }));
  const hidePanel = (hide) => p.evaluate((h) => { const x = document.querySelector('button[title="Тестовое переключение за бота"]'); const w = x?.parentElement ?? [...document.querySelectorAll('div')].find((d) => d.style.zIndex === '4000'); if (w) w.style.display = h ? 'none' : ''; }, hide);
  for (const [name, c] of [['свой', own], ['другой', other]]) {
    if (!c) { console.log('город', name, '— нет'); continue; }
    log = []; await hidePanel(true);
    const ok = await p.evaluate((k) => { const el = document.querySelector(`.m-label[data-key="${k}"]`); if (!el) return false; el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; }, c.nodeKey);
    await sleep(150); const first = await p.evaluate(() => ({ title: document.querySelector('#city-title')?.textContent, status: document.querySelector('.city-head .status')?.textContent?.trim().slice(0, 50) }));
    await sleep(2500); await p.screenshot({ path: `${OUT}/gorod-${name}.png` });
    console.log(`город ${name} ${c.nodeKey} (на карте: ${ok}): сразу «${first.title}» · «${first.status}» · запросов при открытии: ${log.length} ${log.join(' · ')}`);
    // режимы под листом
    await hidePanel(false);
    for (const mode of ['Как сейчас', 'Редко', 'Пауза']) {
      const btn = p.locator(`button:text-is("${mode}")`).first(); if (!(await btn.count())) continue;
      await btn.click({ force: true }); await sleep(1200);
      const d0 = await draws(); await sleep(5000); const d1 = await draws();
      console.log(`   под листом, режим «${mode}»: рисований в секунду 2D ${((d1.c2d - d0.c2d) / 5).toFixed(0)}, WebGL ${((d1.gl - d0.gl) / 5).toFixed(0)}`);
    }
    await p.locator(`button:text-is("Как сейчас")`).first().click({ force: true }).catch(() => {});
    await hidePanel(true);
    await p.locator('button[aria-label="Закрыть"]:visible').last().click().catch(() => {}); await sleep(800);
    const d0 = await draws(); await sleep(3000); const d1 = await draws();
    console.log(`   лист закрыт: рисований в секунду 2D ${((d1.c2d - d0.c2d) / 3).toFixed(0)}, WebGL ${((d1.gl - d0.gl) / 3).toFixed(0)}`);
    break;
  }
  console.log(errs.length ? 'ОШИБКИ: ' + [...new Set(errs)].join(' | ') : 'ошибок страницы нет');
  await b.close();
})().catch((e) => { console.error('ОШИБКА', e.message); process.exit(1); });
