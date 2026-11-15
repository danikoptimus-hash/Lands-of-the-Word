// Кто занимает процессор: профиль скрипта по исходным файлам и функциям (несжатая сборка с картой исходников).
// node profile.cjs СЦЕНАРИЙ  (load — первая загрузка, pan — движение карты, idle — простой, sheets — открытие разделов)
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const { SourceMapConsumer } = require(path.join(__dirname, '../../node_modules/source-map-js'));
const BASE = 'http://localhost:3001', GAME = 'cmucujbgq0008s301ran0fnt4', DEV = process.env.DEV_DIST || path.join(require('os').tmpdir(), 'lotw-dist-dev');
const SCEN = process.argv[2] || 'load';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ru-RU', serviceWorkers: 'block' });
  const r = await ctx.request.post(BASE + '/api/auth/login', { data: { nickname: process.env.NICK || 'p4', password: 'secret123' } }); if (!r.ok()) throw new Error('вход');
  const html = fs.readFileSync(path.join(DEV, 'index.html'));
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith('/assets/')) { const f = path.join(DEV, u.pathname); if (fs.existsSync(f)) return route.fulfill({ body: fs.readFileSync(f), contentType: f.endsWith('.css') ? 'text/css' : 'application/javascript' }); }
    if (route.request().resourceType() === 'document') return route.fulfill({ body: html, contentType: 'text/html' });
    return route.continue();
  });
  const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p); p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
  const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  const drag = async (x0, y0, x1, y1, steps = 30) => { await touch('touchStart', x0, y0); for (let i = 1; i <= steps; i++) { await touch('touchMove', x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await sleep(16); } await touch('touchEnd'); };
  const openMap = async () => { await p.goto(BASE + '/games/' + GAME + '/team', { waitUntil: 'commit' }); await p.waitForSelector('.m-label', { timeout: 120000 }); };
  let wall = 0;
  if (SCEN === 'load') { await cdp.send('Profiler.start'); const t0 = Date.now(); await openMap(); await sleep(1500); wall = Date.now() - t0; }
  else {
    await openMap(); await sleep(4000); await cdp.send('Profiler.start'); const t0 = Date.now();
    if (SCEN === 'idle') await sleep(6000);
    if (SCEN === 'minute') await sleep(66000);
    if (SCEN === 'pan') { await drag(300, 500, 90, 300); await sleep(200); await drag(90, 300, 300, 520); await sleep(500); }
    if (SCEN === 'sheets') { const n = await p.locator('.team-dock .dock-btn').count(); for (let i = 0; i < n; i++) { const bb = await p.locator('.team-dock .dock-btn').nth(i).boundingBox(); await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(1500); await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(700); } }
    wall = Date.now() - t0;
  }
  const { profile } = await cdp.send('Profiler.stop'); await b.close();
  // Карта исходников главного файла.
  const mainJs = fs.readdirSync(path.join(DEV, 'assets')).find((f) => /^index-.*\.js$/.test(f));
  const smc = new SourceMapConsumer(JSON.parse(fs.readFileSync(path.join(DEV, 'assets', mainJs + '.map'), 'utf8')));
  const self = new Map(); for (let i = 0; i < profile.samples.length; i++) self.set(profile.samples[i], (self.get(profile.samples[i]) || 0) + (profile.timeDeltas[i] || 0));
  const byFile = {}, byFn = {}; let total = 0, idle = 0;
  const src = (cf) => { if (!cf.url) return '(движок браузера)'; if (!cf.url.includes('/assets/index-')) return cf.url.replace(BASE, '').slice(0, 60); const o = smc.originalPositionFor({ line: cf.lineNumber + 1, column: cf.columnNumber }); if (!o.source) return '(сборка, без исходника)'; return o.source.replace(/^(\.\.\/)+/, '').replace(/^.*node_modules\//, 'nm:').replace(/^nm:(@[^/]+\/[^/]+|[^/]+).*/, 'библиотека $1'); };
  for (const n of profile.nodes) {
    const t = self.get(n.id) || 0; if (!t) continue; const cf = n.callFrame; const name = cf.functionName || '(безымянная)';
    if (name === '(idle)') { idle += t; continue; }
    total += t; const file = name === '(garbage collector)' ? '(сборка мусора)' : name === '(program)' ? '(браузер: отрисовка и прочее)' : src(cf);
    byFile[file] = (byFile[file] || 0) + t; const k = name + ' — ' + file; byFn[k] = (byFn[k] || 0) + t;
  }
  const ms = (us) => (us / 1000).toFixed(0).padStart(6);
  console.log(`== сценарий ${SCEN}: ${wall} мс по часам; занято ${ms(total)} мс, простой ${ms(idle)} мс`);
  console.log('по исходным файлам (собственное время, мс):'); for (const [k, v] of Object.entries(byFile).sort((a, c) => c[1] - a[1]).slice(0, 28)) console.log('  ', ms(v), k);
  console.log('по функциям:'); for (const [k, v] of Object.entries(byFn).sort((a, c) => c[1] - a[1]).slice(0, 34)) console.log('  ', ms(v), k);
})().catch((e) => { console.error('ОШИБКА', e); process.exit(1); });
