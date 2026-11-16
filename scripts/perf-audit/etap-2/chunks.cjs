// Части программы: что качает русский игрок, англоязычный, администратор; язык переключается без «русской вспышки».
const { chromium } = require('playwright');
const BASE = process.env.BASE, GAME = 'cmucujbgq0008s301ran0fnt4';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch();
  const run = async (name, { login, init, path, wait, after }) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ru-RU', serviceWorkers: 'block' });
    if (login) await ctx.request.post(BASE + '/api/auth/login', { data: { nickname: login, password: 'secret123' } });
    if (init) await ctx.addInitScript(init);
    const p = await ctx.newPage(); const js = [], errs = []; let bytes = 0;
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('response', async (r) => { const u = r.url(); if (/\/assets\/.*\.js$/.test(u)) { js.push(u.split('/').pop().replace(/-[\w-]{8}\.js$/, '')); const h = await r.allHeaders(); bytes += Number(h['content-length'] || 0); } });
    // Первые тексты на экране: не мелькнул ли русский у англоязычного.
    await p.addInitScript(() => { try { localStorage.setItem('lotw.intro.seen', '1'); } catch {} window.__seen = []; const tick = () => { const tx = document.body?.innerText?.replace(/\s+/g, ' ').slice(0, 120); if (tx && window.__seen[window.__seen.length - 1] !== tx) window.__seen.push(tx); requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    await p.goto(BASE + path, { waitUntil: 'commit' });
    await p.waitForSelector(wait, { timeout: 120000 }); await sleep(1500);
    const seen = await p.evaluate(() => window.__seen.slice(0, 4));
    let extra = '';
    if (after) extra = await after(p, js);
    console.log(`\n== ${name}\n  файлы: ${js.join(', ')} · по сети ${(bytes / 1024).toFixed(0)} КБ\n  первые тексты: ${JSON.stringify(seen).slice(0, 420)}${extra ? '\n  ' + extra : ''}${errs.length ? '\n  ОШИБКИ: ' + [...new Set(errs)].join(' | ') : ''}`);
    await ctx.close();
  };
  await run('игрок, русский: карта', { login: 'p1', path: `/games/${GAME}/team`, wait: '.m-label' });
  await run('гость, русский: вход', { path: '/login', wait: 'form' });
  await run('гость, английский: вход', { init: () => { try { localStorage.setItem('lotw.locale', 'en'); } catch {} }, path: '/login', wait: 'form' });
  await run('гость: переключение языка на странице входа', { path: '/login', wait: 'form', after: async (p, js) => {
    const before = await p.locator('h1, h2').first().innerText();
    const sw = p.locator('button:has-text("EN"), button:has-text("English"), [aria-label*="English"], select').first();
    const tag = await sw.evaluate((el) => el.tagName).catch(() => null);
    if (!tag) return 'переключателя языка не нашёл';
    if (tag === 'SELECT') await sw.selectOption('en'); else await sw.click();
    await sleep(1500);
    return `заголовок до: «${before}», после: «${await p.locator('h1, h2').first().innerText()}»; файлы после: ${js.join(', ')}`;
  } });
  await run('гость, английский: «Что нового»', { init: () => { try { localStorage.setItem('lotw.locale', 'en'); } catch {} }, path: '/whats-new', wait: '.changelog li', after: async (p) => 'первая запись: ' + (await p.locator('.changelog li').first().innerText()).slice(0, 110) });
  await run('гость, русский: «Что нового»', { path: '/whats-new', wait: '.changelog li', after: async (p) => 'первая запись: ' + (await p.locator('.changelog li').first().innerText()).slice(0, 110) });
  await run('администратор партии: страница игры', { login: 'admin1', path: `/games/${GAME}`, wait: '.m-label, canvas', after: async (p) => 'заголовок: ' + (await p.title()) });
  await b.close();
})().catch((e) => { console.error('ОШИБКА', e.message); process.exit(1); });
