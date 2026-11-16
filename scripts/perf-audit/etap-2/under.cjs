// Карта под листом: три режима (как сейчас / редко / пауза). Сколько работает процессор при открытом листе города,
// сколько раз рисуют слои, и стоит ли живность на своих местах сразу после закрытия листа.
// BASE=http://localhost:3001 node under.cjs [ПАПКА]
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3001', GAME = 'cmucujbgq0008s301ran0fnt4', OUT = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const COUNT = () => {
  // Счётчики рисования: очистка холста (2D-слои) и вызовы отрисовки WebGL.
  window.__draws = { c2d: 0, gl: 0 };
  const c = CanvasRenderingContext2D.prototype.clearRect; CanvasRenderingContext2D.prototype.clearRect = function (...a) { window.__draws.c2d++; return c.apply(this, a); };
  for (const P of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) { if (!P) continue; const d = P.prototype.drawArrays; P.prototype.drawArrays = function (...a) { window.__draws.gl++; return d.apply(this, a); }; }
  try { localStorage.setItem('lotw.intro.seen', '1'); } catch {}
};
(async () => {
  if (OUT) require('fs').mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const open = async (mode) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ru-RU', serviceWorkers: 'block' });
    await ctx.request.post(BASE + '/api/auth/login', { data: { nickname: 'p1', password: 'secret123' } });
    await ctx.addInitScript(COUNT);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${BASE}/games/${GAME}/team?under=${mode}`, { waitUntil: 'commit' }); await p.waitForSelector('.m-label', { timeout: 120000 }); await sleep(6000);
    const cdp = await ctx.newCDPSession(p); await cdp.send('Performance.enable');
    const metrics = async () => { const m = (await cdp.send('Performance.getMetrics')).metrics; const g = (n) => m.find((x) => x.name === n)?.value ?? 0; return { task: g('TaskDuration'), script: g('ScriptDuration') }; };
    const draws = () => p.evaluate(() => ({ ...window.__draws }));
    return { ctx, p, errs, metrics, draws };
  };
  const fauna = (p) => p.evaluate(() => [...document.querySelectorAll('canvas.fauna')].map((c) => c.toDataURL('image/png')));
  const { PNG } = (() => { try { return require('pngjs'); } catch { return {}; } })();
  const openCity = (p) => p.evaluate(() => document.querySelector('.m-label[data-key="N:11,0"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const rows = [];
  for (const mode of process.env.SKIP_MODES ? [] : ['now', 'slow', 'pause']) {
    const s = await open(mode);
    // карта открыта, листа нет: 8 секунд
    let m0 = await s.metrics(), d0 = await s.draws(); await sleep(8000); let m1 = await s.metrics(), d1 = await s.draws();
    const free = { cpu: (m1.task - m0.task) / 8, c2d: (d1.c2d - d0.c2d) / 8, gl: (d1.gl - d0.gl) / 8 };
    await openCity(s.p); await s.p.waitForSelector('.city-sheet', { timeout: 30000 }); await sleep(1500);
    if (OUT) await s.p.screenshot({ path: `${OUT}/${mode}-pod-listom.png` });
    m0 = await s.metrics(); d0 = await s.draws(); await sleep(8000); m1 = await s.metrics(); d1 = await s.draws();
    const under = { cpu: (m1.task - m0.task) / 8, c2d: (d1.c2d - d0.c2d) / 8, gl: (d1.gl - d0.gl) / 8 };
    rows.push({ mode, free, under, errs: s.errs });
    console.log(`режим ${mode}: карта открыта — процессор ${(free.cpu * 100).toFixed(0)} %, рисований в секунду: 2D ${free.c2d.toFixed(0)}, WebGL ${free.gl.toFixed(0)} · под листом города — процессор ${(under.cpu * 100).toFixed(0)} %, 2D ${under.c2d.toFixed(0)}, WebGL ${under.gl.toFixed(0)}${s.errs.length ? ' · ОШИБКИ ' + s.errs.join(' | ') : ''}`);
    await s.ctx.close();
  }
  // Живность после закрытия листа: страница А (пауза, лист был открыт 20 с) и страница Б (как сейчас, листа не было) — в один миг.
  const A = await open('pause'), B = await open('now');
  const same = async (label) => {
    const [fa, fb] = await Promise.all([fauna(A.p), fauna(B.p)]);
    const eq = fa.map((x, i) => x === fb[i]);
    // доля различающихся точек считается в браузере страницы Б
    const diff = await B.p.evaluate(async ([a, c]) => {
      const load = (u) => new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.src = u; });
      const out = [];
      for (let i = 0; i < a.length; i++) {
        const [x, y] = await Promise.all([load(a[i]), load(c[i])]);
        const cv = document.createElement('canvas'); cv.width = x.width; cv.height = x.height; const g = cv.getContext('2d');
        g.drawImage(x, 0, 0); const dx = g.getImageData(0, 0, cv.width, cv.height).data; g.clearRect(0, 0, cv.width, cv.height); g.drawImage(y, 0, 0); const dy = g.getImageData(0, 0, cv.width, cv.height).data;
        let n = 0, filledA = 0, filledB = 0, both = 0, any = 0; for (let k = 3; k < dx.length; k += 4) { const fa = dx[k] > 8, fb2 = dy[k] > 8; if (fa) filledA++; if (fb2) filledB++; if (fa && fb2) both++; if (fa || fb2) any++; if (Math.abs(dx[k] - dy[k]) > 24 || Math.abs(dx[k - 1] - dy[k - 1]) > 24 || Math.abs(dx[k - 2] - dy[k - 2]) > 24 || Math.abs(dx[k - 3] - dy[k - 3]) > 24) n++; }
        out.push({ razl: +(100 * n / (dx.length / 4)).toFixed(3), a: filledA, b: filledB, iou: any ? +(both / any).toFixed(2) : 1 });
      }
      return out;
    }, [fa, fb]);
    console.log(`${label}: совпадение силуэтов живности (1 — одно и то же): ${diff.map((d) => d.iou).join(' / ')} · закрашено точек А/Б: ${diff.map((d) => d.a + '/' + d.b).join(' ')}`);
    return diff;
  };
  const view = (p) => p.evaluate(() => { const r = document.querySelector('.m-label[data-key="N:11,0"]').getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)]; });
  // Отдаляем обе карты одинаково: в кадре должно быть море с кораблями и зверями.
  for (const pg of [A.p, B.p]) { await pg.mouse.move(195, 420); for (let i = 0; i < 6; i++) { await pg.mouse.wheel(0, 500); await sleep(150); } }
  await sleep(2500);
  console.log('вид карты А и Б:', JSON.stringify(await view(A.p)), JSON.stringify(await view(B.p)));
  for (let i = 0; i < 3; i++) { await same('точка отсчёта: обе страницы без листа'); await sleep(700); }
  await openCity(A.p); await A.p.waitForSelector('.city-sheet', { timeout: 30000 }); await sleep(20000);
  await same('лист открыт 20 с (А на паузе, Б живёт)');
  // закрываем лист и снимаем сразу: через 120 мс, 400 мс и 1,5 с
  await A.p.locator('button[aria-label="Закрыть"]:visible').last().click();
  await sleep(120); await same('через 0,12 с после закрытия листа');
  await sleep(280); await same('через 0,4 с');
  await sleep(1100); await same('через 1,5 с');
  if (OUT) { await A.p.screenshot({ path: `${OUT}/A-posle-zakrytiya.png` }); await B.p.screenshot({ path: `${OUT}/B-bez-lista.png` }); }
  console.log([...A.errs, ...B.errs].length ? 'ОШИБКИ: ' + [...A.errs, ...B.errs].join(' | ') : 'ошибок страницы нет');
  await b.close();
})().catch((e) => { console.error('ОШИБКА', e.message); process.exit(1); });
