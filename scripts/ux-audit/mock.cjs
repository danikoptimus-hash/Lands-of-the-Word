// Макеты «до / после»: сцена снимается как есть, затем на живую страницу накладывается правка (стили и перестановка), снимается «после».
// Код игры не меняется. Запуск: node mock.cjs ПАПКА сцена [сцена…]
const { open } = require('./lib.cjs'); const { S } = require('./scenes.cjs'); const P = require('./patches.cjs'); const fs = require('fs');
(async () => {
  const out = process.argv[2], names = process.argv.slice(3).length ? process.argv.slice(3) : Object.keys(P).filter((k) => typeof P[k] === 'object');
  const by = {}; for (const n of names) { if (typeof P[n] !== 'object') continue; const sc = P[n].scene || n; (by[S[sc].who || ''] = by[S[sc].who || ''] || []).push(n); }
  for (const who of Object.keys(by)) { const s = await open(who || null, out);
    for (const n of by[who]) { const sc = S[P[n].scene || n]; try {
      await sc.reach(s); if (P[n].prep) await P[n].prep(s); await s.p.waitForTimeout(400);
      await s.p.screenshot({ path: `${out}/${n}-do.png` });
      if (P[n].helpers) await s.p.addScriptTag({ content: P[n].helpers });
      if (P[n].css) await s.p.addStyleTag({ content: P[n].css });
      if (P[n].js) await s.p.evaluate(P[n].js);
      if (P[n].post) await s.p.evaluate(P[n].post);
      await s.p.waitForTimeout(500);
      await s.p.screenshot({ path: `${out}/${n}-posle.png` });
      console.log('макет', n, '—', sc.note);
      if (sc.after) await sc.after(s);
    } catch (e) { console.log('! ', n, String(e.message).split('\n')[0].slice(0, 200)); } }
    await s.b.close(); }
})();
