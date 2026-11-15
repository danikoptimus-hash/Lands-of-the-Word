// Разбор главного потока по видам работы: простой и движение карты. node trace.cjs [phone]
const { chromium } = require('playwright'); const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:3001', GAME = 'cmucujbgq0008s301ran0fnt4';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ru-RU', serviceWorkers: 'block' });
  const r = await ctx.request.post(BASE + '/api/auth/login', { data: { nickname: process.env.NICK || 'p4', password: 'secret123' } }); if (!r.ok()) throw new Error('вход');
  const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
  if (process.env.HIDE) await ctx.addInitScript((css) => { const add = () => { const s = document.createElement('style'); s.textContent = css; document.documentElement.appendChild(s); }; if (document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add); }, process.env.HIDE);
  await p.goto(BASE + '/games/' + GAME + '/team', { waitUntil: 'commit' });
  await p.waitForSelector('.m-label', { timeout: 120000 }); await sleep(4000);
  // Что на странице: холсты, анимации CSS, фильтры.
  const info = await p.evaluate(() => {
    const cv = [...document.querySelectorAll('canvas')].map((c) => { let kind = '?'; try { kind = c.getContext('webgl2') ? 'webgl2' : c.getContext('webgl') ? 'webgl' : '2d'; } catch { kind = 'занят'; } const cs = getComputedStyle(c); const par = c.parentElement; return { cls: (c.className || '') + ' < ' + (par && par.className || ''), size: c.width + 'x' + c.height, css: Math.round(c.clientWidth) + 'x' + Math.round(c.clientHeight), kind, filter: cs.filter, blend: cs.mixBlendMode, op: cs.opacity, disp: cs.display }; });
    const anims = document.getAnimations().map((a) => { const t = a.effect && a.effect.target; return { name: a.animationName || a.transitionProperty || a.constructor.name, el: t ? (t.tagName + '.' + (t.getAttribute('class') || '')).slice(0, 60) : '', state: a.playState, iter: a.effect && a.effect.getComputedTiming().iterations }; });
    const by = {}; for (const a of anims) { const k = a.name + ' @ ' + a.el.replace(/\s.*/, '') + (a.iter === Infinity ? ' ∞' : ''); by[k] = (by[k] || 0) + 1; }
    let bf = 0, fl = 0, mask = 0; const bfEls = [];
    for (const e of document.querySelectorAll('*')) { const s = getComputedStyle(e); if (s.backdropFilter && s.backdropFilter !== 'none') { bf++; bfEls.push((e.tagName + '.' + (e.getAttribute('class') || '')).slice(0, 50)); } if (s.filter && s.filter !== 'none') fl++; if ((s.maskImage && s.maskImage !== 'none') || (s.webkitMaskImage && s.webkitMaskImage !== 'none')) mask++; }
    return { cv, animsTotal: anims.length, anims: by, backdrop: bf, bfEls: bfEls.slice(0, 20), filters: fl, masks: mask, svgFilters: document.querySelectorAll('svg filter').length, svgNodes: document.querySelectorAll('svg *').length };
  });
  console.log('холсты:'); for (const c of info.cv) console.log('  ', JSON.stringify(c));
  console.log('анимаций:', info.animsTotal, JSON.stringify(info.anims, null, 0).slice(0, 2500));
  console.log('backdrop-filter:', info.backdrop, info.bfEls.join(' | '), '· filter:', info.filters, '· маски:', info.masks, '· фильтров svg:', info.svgFilters, '· узлов svg:', info.svgNodes);
  if (process.argv[2] === 'phone') await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  const trace = async (label, act) => {
    const events = []; const onData = (d) => events.push(...d.value); cdp.on('Tracing.dataCollected', onData);
    await cdp.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'toplevel', 'gpu', 'cc', 'blink'] } });
    const t0 = Date.now(); await act(); const wall = Date.now() - t0;
    const done = new Promise((res) => cdp.once('Tracing.tracingComplete', res)); await cdp.send('Tracing.end'); await done; cdp.off('Tracing.dataCollected', onData);
    // Главный поток страницы.
    const names = events.filter((e) => e.ph === 'M' && e.name === 'thread_name');
    const main = names.find((e) => e.args.name === 'CrRendererMain'); if (!main) { console.log('нет главного потока'); return; }
    const threadName = new Map(names.map((e) => [e.pid + ':' + e.tid, e.args.name]));
    const byThread = {}; const self = {}; let fnTotal = 0;
    const perThreadEvents = new Map();
    for (const e of events) { if (e.ph !== 'X' || !e.dur) continue; const k = e.pid + ':' + e.tid; if (!perThreadEvents.has(k)) perThreadEvents.set(k, []); perThreadEvents.get(k).push(e); }
    for (const [k, list] of perThreadEvents) {
      list.sort((a, b2) => a.ts - b2.ts || b2.dur - a.dur);
      const stack = []; let top = 0; const isMain = k === main.pid + ':' + main.tid;
      for (const e of list) {
        while (stack.length && stack[stack.length - 1].end <= e.ts) stack.pop();
        if (!stack.length) top += e.dur;
        if (isMain) { if (stack.length) stack[stack.length - 1].child += Math.min(e.dur, stack[stack.length - 1].end - e.ts); }
        const fr = { end: e.ts + e.dur, child: 0, e }; stack.push(fr);
        if (isMain) fr.done = () => {};
        e.__fr = fr;
      }
      byThread[threadName.get(k) || k] = (byThread[threadName.get(k) || k] || 0) + top;
      if (isMain) for (const e of list) { const s = e.dur - e.__fr.child; self[e.name] = (self[e.name] || 0) + s; if (e.name === 'FunctionCall' || e.name === 'EvaluateScript' || e.name === 'v8.callFunction' || e.name === 'TimerFire' || e.name === 'FireAnimationFrame') fnTotal += s; }
    }
    const ms = (us) => Math.round(us / 1000);
    console.log(`\n== ${label}: ${wall} мс по часам`);
    console.log('  потоки (занятость, мс):', Object.entries(byThread).sort((a, b2) => b2[1] - a[1]).slice(0, 8).map(([n, v]) => n + ' ' + ms(v)).join(' · '));
    console.log('  главный поток по видам работы (собственное время, мс):');
    for (const [n, v] of Object.entries(self).sort((a, b2) => b2[1] - a[1]).slice(0, 22)) console.log('     ', String(ms(v)).padStart(6), n);
    const frames = events.filter((e) => e.name === 'DrawFrame' || e.name === 'BeginFrame'); const cnt = {}; for (const e of frames) cnt[e.name] = (cnt[e.name] || 0) + 1; console.log('  кадры:', JSON.stringify(cnt));
    if (process.env.SAVE) fs.writeFileSync(process.env.SAVE + '-' + label + '.json', JSON.stringify(events));
  };
  const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  const drag = async (x0, y0, x1, y1, steps = 30) => { await touch('touchStart', x0, y0); for (let i = 1; i <= steps; i++) { await touch('touchMove', x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await sleep(16); } await touch('touchEnd'); };
  await trace('простой', async () => { await sleep(5000); });
  if (!process.env.IDLEONLY) await trace('движение', async () => { await drag(300, 500, 90, 300); await sleep(200); await drag(90, 300, 300, 520); });
  await b.close();
})().catch((e) => { console.error('ОШИБКА', e); process.exit(1); });
