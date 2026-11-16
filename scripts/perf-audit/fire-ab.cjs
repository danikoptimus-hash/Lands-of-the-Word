// Огонь приоритетных дел «до / после»: прежняя сборка (огонь в слое меток, CSS) и новая (огонь на холсте) по очереди,
// без огней и с K огнями в кадре. Окно маленькое (260×420, плотность 1), чтобы остальная карта не занимала процессор
// целиком и разница была видна: без видеокарты холсты карты рисует процессор.
//   OLD=http://localhost:3003 NEW=http://localhost:3001 node fire-ab.cjs [K]
const { chromium } = require('playwright');
const OLD = process.env.OLD || 'http://localhost:3003', NEW = process.env.NEW || 'http://localhost:3001', GAME = process.env.GAME || 'cmucujbgq0008s301ran0fnt4', K = Number(process.argv[2] || 3);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch();
  const mk = async (base) => { const ctx = await b.newContext({ viewport: { width: 260, height: 420 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: 'ru-RU', serviceWorkers: 'block' }); const r = await ctx.request.post(base + '/api/auth/login', { data: { nickname: process.env.NICK || 'p1', password: 'secret123' } }); if (!r.ok()) throw new Error('вход'); await ctx.addInitScript(() => { try { localStorage.setItem('lotw.intro.seen', '1'); } catch {} window.__ft = []; const tick = (t) => { window.__ft.push(t); requestAnimationFrame(tick); }; requestAnimationFrame(tick); }); return ctx; };
  const c0 = await mk(NEW); const setPrio = async (id, on) => (await c0.request.post(`${NEW}/api/games/${GAME}/edge-tasks/${id}/priority`, { data: { on } })).ok();
  const p0 = await c0.newPage(); await p0.goto(`${NEW}/games/${GAME}/team`, { waitUntil: 'commit' }); await p0.waitForSelector('.m-label', { timeout: 120000 }); await sleep(4000);
  const ids = await p0.evaluate(() => [...document.querySelectorAll('.m-deed[data-id]')].map((e) => { const q = e.getBoundingClientRect(); const cx = q.x + q.width / 2, cy = q.y + q.height / 2; return { id: e.getAttribute('data-id'), d: Math.hypot(cx - innerWidth / 2, cy - innerHeight / 2), prio: e.classList.contains('priority'), ok: !e.classList.contains('approved') }; }).sort((a, c) => a.d - c.d));
  await p0.close();
  const was = [], marked = [];
  const measure = async (name, base) => {
    const ctx = await mk(base); const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
    await p.goto(`${base}/games/${GAME}/team`, { waitUntil: 'commit' }); await p.waitForSelector('.m-label', { timeout: 120000 }); await sleep(6000);
    const seen = await p.evaluate(() => [...document.querySelectorAll('.m-deed.priority')].filter((e) => { const q = e.getBoundingClientRect(); return q.right > 0 && q.left < innerWidth && q.bottom > 0 && q.top < innerHeight; }).length);
    const trace = async (act) => {
      const events = []; const onData = (d) => events.push(...d.value); cdp.on('Tracing.dataCollected', onData);
      await cdp.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'toplevel'] } });
      await p.evaluate(() => { window.__ft.length = 0; }); const t0 = Date.now(); await act(); const sec = (Date.now() - t0) / 1000; const ft = await p.evaluate(() => window.__ft.slice());
      const done = new Promise((res) => cdp.once('Tracing.tracingComplete', res)); await cdp.send('Tracing.end'); await done; cdp.off('Tracing.dataCollected', onData);
      const names = events.filter((e) => e.ph === 'M' && e.name === 'thread_name'); const main = names.find((e) => e.args.name === 'CrRendererMain'); const key = main.pid + ':' + main.tid;
      const list = events.filter((e) => e.ph === 'X' && e.dur && e.pid + ':' + e.tid === key).sort((a, c) => a.ts - c.ts || c.dur - a.dur); const st = []; let top = 0; const self = {};
      for (const e of list) { while (st.length && st[st.length - 1].end <= e.ts) st.pop(); if (!st.length) top += e.dur; else st[st.length - 1].child += Math.min(e.dur, st[st.length - 1].end - e.ts); const fr = { end: e.ts + e.dur, child: 0 }; e.__fr = fr; st.push(fr); }
      for (const e of list) self[e.name] = (self[e.name] || 0) + e.dur - e.__fr.child;
      const per1 = (us) => +((us || 0) / 1000 / sec).toFixed(0);
      const d = []; for (let i = 1; i < ft.length; i++) d.push(ft[i] - ft[i - 1]); d.sort((a, c) => a - c); const q = (x) => d.length ? d[Math.min(d.length - 1, Math.floor(d.length * x))] : 0;
      return { main: per1(top), style: per1((self.UpdateLayoutTree || 0) + (self.RecalculateStyles || 0)), paint: per1((self.Paint || 0) + (self.PrePaint || 0) + (self.Layerize || 0) + (self.Commit || 0) + (self.UpdateLayerTree || 0)), script: per1((self.FunctionCall || 0) + (self.FireAnimationFrame || 0) + (self.TimerFire || 0) + (self.EventDispatch || 0) + (self['v8.callFunction'] || 0)), paints: (events.filter((e) => e.name === 'Paint').length / sec).toFixed(0), fps: (d.length / sec).toFixed(0), med: q(0.5).toFixed(0), p95: q(0.95).toFixed(0), long: d.filter((x) => x > 50).length };
    };
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const drag = async (x0, y0, x1, y1, steps = 40) => { await touch('touchStart', [{ x: x0, y: y0, id: 1 }]); for (let i = 1; i <= steps; i++) { await touch('touchMove', [{ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps, id: 1 }]); await sleep(16); } await touch('touchEnd', []); };
    const idle = await trace(() => sleep(6000));
    const pan = await trace(async () => { for (let i = 0; i < 3; i++) { await drag(180, 260, 110, 200); await sleep(120); await drag(110, 200, 180, 260); await sleep(120); } });
    const line = (n, m) => `${n}: главный поток ${m.main} мс/с (стили ${m.style}, отрисовка ${m.paint}, код ${m.script}) · перерисовок слоёв страницы ${m.paints}/с · кадров ${m.fps}/с, кадр обычно ${m.med} мс, 95 % — ${m.p95} мс, дольше 50 мс: ${m.long}`;
    console.log(`\n${name} · огней в кадре ${seen}`); console.log('  ' + line('покой   ', idle)); console.log('  ' + line('протяжка', pan));
    await ctx.close();
  };
  try {
    for (const x of ids.filter((x) => x.prio)) if (await setPrio(x.id, false)) was.push(x.id);
    await measure('ПРЕЖНЯЯ, без огней', OLD); await measure('НОВАЯ, без огней', NEW);
    const near = ids.filter((x) => x.ok); while (marked.length < K && near.length) { const x = near.shift(); if (await setPrio(x.id, true)) marked.push(x.id); }
    await measure(`ПРЕЖНЯЯ, огней ${K}`, OLD); await measure(`НОВАЯ, огней ${K}`, NEW);
  } finally { for (const id of marked) await setPrio(id, false); for (const id of was) await setPrio(id, true); await b.close(); }
})().catch((e) => { console.error('ОШИБКА', e); process.exit(1); });
