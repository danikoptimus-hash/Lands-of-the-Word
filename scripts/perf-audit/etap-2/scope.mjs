// Адресная рассылка вживую: команда A действует, команда B слушает канал событий. Что доходит до B.
const BASE = process.env.BASE || 'http://localhost:3001', GAME = 'cmucujbgq0008s301ran0fnt4';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (n) => { const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname: n, password: 'secret123' }) }); return r.ok ? r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') : null; };
const listen = async (cookie, bag) => { const ctl = new AbortController(); const r = await fetch(`${BASE}/api/games/${GAME}/events`, { headers: { cookie }, signal: ctl.signal }); const rd = r.body.getReader(); const dec = new TextDecoder(); (async () => { let buf = ''; try { for (;;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const blk = buf.slice(0, i); buf = buf.slice(i + 2); const ev = /event: (\S+)/.exec(blk)?.[1]; const data = /data: (.*)/.exec(blk)?.[1]; if (ev === 'change') bag.push(JSON.parse(data).type); else if (ev && ev !== 'hello' && ev !== 'hb') bag.push(ev); } } } catch {} })(); return () => ctl.abort(); };
(async () => {
  const admin = await login('admin1'), a = await login('p1');
  const teams = (await (await fetch(`${BASE}/api/games/${GAME}/teams`, { headers: { cookie: admin } })).json()).teams;
  const mine = teams.find((t) => t.members.some((m) => m.user.nickname === 'p1'));
  let b = null, bTeam = null;
  b = await login('p11'); bTeam = teams.find((t) => t.members.some((m) => m.user.nickname === 'p11'))?.name;
  if (!b) throw new Error('нет участника другой команды с рабочим входом');
  const gotA = [], gotB = [], gotAdmin = [];
  const stop = [await listen(a, gotA), await listen(b, gotB), await listen(admin, gotAdmin)];
  await sleep(500);
  const hA = { cookie: a, 'content-type': 'application/json' };
  const map = await (await fetch(`${BASE}/api/games/${GAME}/my-map`, { headers: hA })).json();
  const task = map.tasks.find((t) => t.status === 'OPEN' && !t.priorityAt && !t.sea);
  const post = (u, body) => fetch(BASE + u, { method: 'POST', headers: hA, body: JSON.stringify(body) }).then((r) => r.status);
  const acts = [];
  acts.push('приоритет: ' + await post(`/api/games/${GAME}/edge-tasks/${task.id}/priority`, { on: true })); await sleep(700);
  acts.push('снять приоритет: ' + await post(`/api/games/${GAME}/edge-tasks/${task.id}/priority`, { on: false })); await sleep(700);
  // метка на карте (событие map своей команды) — ставим и убираем
  const hex = map.hexes[0];
  const mk = await fetch(`${BASE}/api/games/${GAME}/my-map/marks`, { method: 'POST', headers: hA, body: JSON.stringify({ q: hex.q, r: hex.r, note: 'проверка' }) });
  acts.push('метка: ' + mk.status); const mkJson = await mk.json().catch(() => ({}));
  await sleep(700);
  const mid = mkJson.mark?.id ?? mkJson.id; if (mid) acts.push('убрать метку: ' + (await fetch(`${BASE}/api/games/${GAME}/my-map/marks/${mid}`, { method: 'DELETE', headers: { cookie: a } })).status);
  await sleep(1500);
  stop.forEach((f) => f());
  const count = (xs) => JSON.stringify(xs.reduce((o, x) => (o[x] = (o[x] || 0) + 1, o), {}));
  console.log('действия команды «' + mine.name + '»:', acts.join(', '));
  console.log('дошло своей команде:', count(gotA));
  console.log('дошло команде «' + bTeam + '»:', count(gotB));
  console.log('дошло администратору:', count(gotAdmin));
  process.exit(0);
})().catch((e) => { console.error('ОШИБКА', e.message); process.exit(1); });
