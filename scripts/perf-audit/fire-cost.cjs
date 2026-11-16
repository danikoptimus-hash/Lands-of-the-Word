// Цена огня на приоритетных делах «в чистом виде»: циклы кадров холстов карты остановлены (requestAnimationFrame
// заглушён после загрузки), поэтому всё, что остаётся на главном потоке в покое, — работа браузера над движением огня.
// Капитан локальной копии отмечает K дел; в конце все отметки возвращаются как были.
//   BASE=http://localhost:3001 node fire-cost.cjs [K,K,…]     варианты: в кадре, за кадром, под листом города
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3001', GAME = process.env.GAME || 'cmucujbgq0008s301ran0fnt4', CITY = process.env.CITY || 'N:11,0';
const KS = (process.argv[2] || '0,1,3,8').split(',').map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ru-RU', serviceWorkers: 'block' });
  const r = await ctx.request.post(BASE + '/api/auth/login', { data: { nickname: process.env.NICK || 'p1', password: 'secret123' } }); if (!r.ok()) throw new Error('вход');
  await ctx.addInitScript(() => { try { localStorage.setItem('lotw.intro.seen', '1'); } catch {} });
  const setPrio = async (id, on) => { const x = await ctx.request.post(`${BASE}/api/games/${GAME}/edge-tasks/${id}/priority`, { data: { on } }); return x.ok(); };
  const was = [], marked = [];
  const measure = async (label, { sheet = false, still = false } = {}) => {
    const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
    await p.goto(`${BASE}/games/${GAME}/team`, { waitUntil: 'commit' }); await p.waitForSelector('.m-label', { timeout: 120000 }); await sleep(6000);
    if (sheet) { await p.evaluate((k) => document.querySelector(`.m-label[data-key="${k}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true })), CITY); await p.waitForSelector('.city-sheet', { timeout: 30000 }); await sleep(2000); }
    if (still) await p.addStyleTag({ content: '.deed-fire .tongue, .deed-fire .glow, .deed-fire .spark { animation: none !important; }' });
    const info = await p.evaluate(() => {
      const vis = (e) => { const q = e.getBoundingClientRect(); return q.right > 0 && q.left < innerWidth && q.bottom > 0 && q.top < innerHeight; };
      const all = [...document.querySelectorAll('.m-deed.priority')];
      window.requestAnimationFrame = () => 0; // холсты карты больше не рисуют
      return { all: all.length, seen: all.filter(vis).length, anims: document.getAnimations().filter((a) => a.playState === 'running').length };
    });
    await sleep(700);
    const events = []; const onData = (d) => events.push(...d.value); cdp.on('Tracing.dataCollected', onData);
    await cdp.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'toplevel', 'cc'] } });
    const t0 = Date.now(); await sleep(5000); const sec = (Date.now() - t0) / 1000;
    const done = new Promise((res) => cdp.once('Tracing.tracingComplete', res)); await cdp.send('Tracing.end'); await done;
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
    const per1 = (us) => +((us || 0) / 1000 / sec).toFixed(1);
    const style = (self.UpdateLayoutTree || 0) + (self.RecalculateStyles || 0), paint = (self.Paint || 0) + (self.PrePaint || 0) + (self.Layerize || 0) + (self.Commit || 0) + (self.UpdateLayerTree || 0) + (self.Layout || 0);
    const paints = events.filter((e) => e.name === 'Paint'), area = paints.reduce((s, e) => { const c = e.args && e.args.data && e.args.data.clip; return c && c.length >= 8 ? s + Math.abs((c[2] - c[0]) * (c[5] - c[1])) : s; }, 0);
    const top = Object.entries(self).sort((a, c) => c[1] - a[1]).slice(0, 5).map(([n, v]) => `${n} ${per1(v)}`).join(', ');
    console.log(`${label}: огней ${info.all}, в кадре ${info.seen}, анимаций CSS ${info.anims} · главный поток ${per1(thr.CrRendererMain)} мс/с (стили ${per1(style)}, отрисовка ${per1(paint)}) · растеризация ${per1((thr.CompositorTileWorker || 0) + (thr.ThreadPoolForegroundWorker || 0))} мс/с · перерисовок ${(paints.length / sec).toFixed(0)}/с${paints.length ? `, по ${Math.round(area / paints.length)} точек` : ''} · кадров ${(events.filter((e) => e.name === 'DrawFrame').length / sec).toFixed(0)}/с`);
    console.log(`      главный поток, первые пять: ${top}`);
    await p.close();
  };
  try {
    const p0 = await ctx.newPage(); await p0.goto(`${BASE}/games/${GAME}/team`, { waitUntil: 'commit' }); await p0.waitForSelector('.m-label', { timeout: 120000 }); await sleep(4000);
    const ids = await p0.evaluate(() => [...document.querySelectorAll('.m-deed[data-id]')].map((e) => { const q = e.getBoundingClientRect(); const cx = q.x + q.width / 2, cy = q.y + q.height / 2; return { id: e.getAttribute('data-id'), d: Math.hypot(cx - innerWidth / 2, cy - innerHeight / 2), seen: cx > 20 && cx < innerWidth - 20 && cy > 90 && cy < innerHeight - 110, prio: e.classList.contains('priority'), ok: !e.classList.contains('approved') }; }).sort((a, c) => a.d - c.d));
    await p0.close();
    for (const x of ids.filter((x) => x.prio)) { if (await setPrio(x.id, false)) was.push(x.id); }
    console.log(`дел на карте ${ids.length}, в кадре ${ids.filter((x) => x.seen).length}; прежних отметок снято на время замера: ${was.length}\n`);
    const near = ids.filter((x) => x.ok && x.seen), far = ids.filter((x) => x.ok && !x.seen).reverse();
    for (const k of KS) {
      while (marked.length < k && near.length) { const x = near.shift(); if (await setPrio(x.id, true)) marked.push(x.id); }
      await measure(`в кадре, огней ${k}`);
    }
    await measure('те же огни, движение выключено', { still: true });
    await measure('те же огни под листом города', { sheet: true });
    for (const id of marked.splice(0)) await setPrio(id, false);
    const off = []; while (off.length < 3 && far.length) { const x = far.shift(); if (await setPrio(x.id, true)) off.push(x.id); }
    marked.push(...off);
    await measure('три огня за пределами экрана');
  } finally {
    for (const id of marked) await setPrio(id, false);
    for (const id of was) await setPrio(id, true);
    console.log(`\nотметки возвращены как были (${was.length})`);
    await b.close();
  }
})().catch((e) => { console.error('ОШИБКА', e); process.exit(1); });
