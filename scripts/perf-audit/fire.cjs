// Огонь на приоритетных делах: во что он обходится карте. Капитан локальной копии отмечает K дел в кадре приоритетными,
// затем меряется главный поток браузера в покое и плавность при протяжке и щипке; в конце отметки снимаются.
// Контроль: те же K дел, но движение огня выключено (animation: none) — так видно, что стоит именно движение.
//   BASE=http://localhost:3001 node fire.cjs [K,K,…]      (по умолчанию 0,1,3,8)   STILL=1 — добавить контроль без движения
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3001', GAME = process.env.GAME || 'cmucujbgq0008s301ran0fnt4';
const KS = (process.argv[2] || '0,1,3,8').split(',').map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ru-RU', serviceWorkers: 'block' });
  const r = await ctx.request.post(BASE + '/api/auth/login', { data: { nickname: process.env.NICK || 'p1', password: 'secret123' } }); if (!r.ok()) throw new Error('вход');
  await ctx.addInitScript(() => { try { localStorage.setItem('lotw.intro.seen', '1'); } catch {} window.__ft = []; const tick = (t) => { window.__ft.push(t); requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  const setPrio = async (id, on) => { const x = await ctx.request.post(`${BASE}/api/games/${GAME}/edge-tasks/${id}/priority`, { data: { on } }); if (!x.ok()) throw new Error('приоритет ' + x.status() + ' ' + (await x.text()).slice(0, 120)); };
  const marked = [];
  const run = async (k, still) => {
    const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    if (still) await p.addInitScript(() => { const add = () => { const s = document.createElement('style'); s.textContent = '.deed-fire .tongue, .deed-fire .glow, .deed-fire .spark { animation: none !important; }'; document.documentElement.appendChild(s); }; if (document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add); });
    await p.goto(`${BASE}/games/${GAME}/team`, { waitUntil: 'commit' }); await p.waitForSelector('.m-label', { timeout: 120000 }); await sleep(5000);
    const fires = await p.evaluate(() => { const vis = (e) => { const q = e.getBoundingClientRect(); return q.right > 0 && q.left < innerWidth && q.bottom > 0 && q.top < innerHeight; }; const all = [...document.querySelectorAll('.m-deed.priority')]; return { all: all.length, seen: all.filter(vis).length, anims: document.getAnimations().filter((a) => a.playState === 'running').length, svgNodes: document.querySelectorAll('svg *').length }; });
    const trace = async (act) => {
      const events = []; const onData = (d) => events.push(...d.value); cdp.on('Tracing.dataCollected', onData);
      await cdp.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'toplevel', 'cc'] } });
      await p.evaluate(() => { window.__ft.length = 0; });
      const t0 = Date.now(); await act(); const wall = Date.now() - t0;
      const ft = await p.evaluate(() => window.__ft.slice());
      const done = new Promise((res) => cdp.once('Tracing.tracingComplete', res)); await cdp.send('Tracing.end'); await done; cdp.off('Tracing.dataCollected', onData);
      const names = events.filter((e) => e.ph === 'M' && e.name === 'thread_name'); const main = names.find((e) => e.args.name === 'CrRendererMain');
      const tn = new Map(names.map((e) => [e.pid + ':' + e.tid, e.args.name]));
      const self = {}, thr = {}; const per = new Map();
      for (const e of events) { if (e.ph !== 'X' || !e.dur) continue; const key = e.pid + ':' + e.tid; if (!per.has(key)) per.set(key, []); per.get(key).push(e); }
      for (const [key, list] of per) {
        list.sort((a, c) => a.ts - c.ts || c.dur - a.dur); const st = []; let top = 0; const isMain = main && key === main.pid + ':' + main.tid;
        for (const e of list) { while (st.length && st[st.length - 1].end <= e.ts) st.pop(); if (!st.length) top += e.dur; else if (isMain) st[st.length - 1].child += Math.min(e.dur, st[st.length - 1].end - e.ts); const fr = { end: e.ts + e.dur, child: 0 }; e.__fr = fr; st.push(fr); }
        const n = (tn.get(key) || '').replace(/\d+$/, ''); thr[n] = (thr[n] || 0) + top;
        if (isMain) for (const e of list) self[e.name] = (self[e.name] || 0) + e.dur - e.__fr.child;
      }
      const sec = wall / 1000, per1 = (us) => +(us / 1000 / sec).toFixed(0);
      const style = (self.UpdateLayoutTree || 0) + (self.RecalculateStyles || 0) + (self.ScheduleStyleRecalculation || 0);
      const paint = (self.Paint || 0) + (self.PrePaint || 0) + (self.Layerize || 0) + (self.Commit || 0) + (self.UpdateLayerTree || 0) + (self['Layout'] || 0);
      const d = []; for (let i = 1; i < ft.length; i++) d.push(ft[i] - ft[i - 1]); d.sort((a, c) => a - c);
      const q = (x) => d.length ? d[Math.min(d.length - 1, Math.floor(d.length * x))] : 0;
      return { main: per1(main ? thr.CrRendererMain || 0 : 0), style: per1(style), paint: per1(paint), raster: per1((thr.CompositorTileWorker || 0) + (thr.ThreadPoolForegroundWorker || 0)), compositor: per1(thr.Compositor || 0), paints: +(((events.filter((e) => e.name === 'Paint').length) / sec).toFixed(0)), fps: +((d.length) / sec).toFixed(0), med: +q(0.5).toFixed(0), p95: +q(0.95).toFixed(0), worst: +(d[d.length - 1] || 0).toFixed(0), long: d.filter((x) => x > 50).length };
    };
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const drag = async (x0, y0, x1, y1, steps = 40) => { await touch('touchStart', [{ x: x0, y: y0, id: 1 }]); for (let i = 1; i <= steps; i++) { await touch('touchMove', [{ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps, id: 1 }]); await sleep(16); } await touch('touchEnd', []); };
    const pinch = async (from, to, steps = 40) => { const cx = 195, cy = 430; const pts = (g) => [{ x: cx - g, y: cy, id: 1 }, { x: cx + g, y: cy, id: 2 }]; await touch('touchStart', pts(from)); for (let i = 1; i <= steps; i++) { await touch('touchMove', pts(from + (to - from) * i / steps)); await sleep(16); } await touch('touchEnd', []); };
    const idle = await trace(() => sleep(6000));
    const pan = await trace(async () => { await drag(300, 500, 120, 330); await sleep(150); await drag(120, 330, 300, 500); await sleep(150); await drag(300, 500, 120, 330); await sleep(150); await drag(120, 330, 300, 500); });
    const zoom = process.env.SKIP_ZOOM ? null : await trace(async () => { await pinch(60, 110); await sleep(150); await pinch(110, 60); await sleep(150); await pinch(60, 110); await sleep(150); await pinch(110, 60); });
    await p.close();
    return { k, still, fires, idle, pan, zoom, errs };
  };
  const line = (name, m) => m ? `${name}: главный поток ${m.main} мс/с (стили ${m.style}, отрисовка ${m.paint}) · растеризация ${m.raster} мс/с · перерисовок ${m.paints}/с · кадров ${m.fps}/с, кадр обычно ${m.med} мс, 95 % ${m.p95} мс, худший ${m.worst} мс, дольше 50 мс: ${m.long}` : '';
  try {
    // какие дела в кадре: берём ближайшие к середине экрана
    const p0 = await ctx.newPage(); await p0.goto(`${BASE}/games/${GAME}/team`, { waitUntil: 'commit' }); await p0.waitForSelector('.m-label', { timeout: 120000 }); await sleep(4000);
    const ids = await p0.evaluate(() => [...document.querySelectorAll('.m-deed[data-id]')].filter((e) => !e.classList.contains('approved')).map((e) => { const q = e.getBoundingClientRect(); return { id: e.getAttribute('data-id'), d: Math.hypot(q.x + q.width / 2 - innerWidth / 2, q.y + q.height / 2 - innerHeight / 2), cls: e.getAttribute('class') }; }).sort((a, c) => a.d - c.d));
    const already = ids.filter((x) => /priority/.test(x.cls)).length;
    console.log(`дел на карте: ${ids.length}, из них уже приоритетных: ${already}`);
    await p0.close();
    for (const k of KS) {
      while (marked.length < k && ids.length) { const x = ids.shift(); try { await setPrio(x.id, true); marked.push(x.id); } catch (e) { /* принятое дело — пропускаем */ } }
      const variants = k > 0 && process.env.STILL ? [false, true] : [false];
      for (const still of variants) {
        const res = await run(k, still);
        console.log(`\n== огней: ${k}${still ? ' (движение выключено)' : ''} · в кадре ${res.fires.seen} из ${res.fires.all} · идущих анимаций CSS: ${res.fires.anims} · узлов svg: ${res.fires.svgNodes}`);
        console.log('  ' + line('покой  ', res.idle)); console.log('  ' + line('протяжка', res.pan)); if (res.zoom) console.log('  ' + line('щипок  ', res.zoom));
        if (res.errs.length) console.log('  ОШИБКИ: ' + [...new Set(res.errs)].join(' | '));
      }
    }
  } finally {
    for (const id of marked) { try { await setPrio(id, false); } catch { /* уже снята */ } }
    console.log(`\nотметки сняты: ${marked.length}`);
    await b.close();
  }
})().catch((e) => { console.error('ОШИБКА', e); process.exit(1); });
