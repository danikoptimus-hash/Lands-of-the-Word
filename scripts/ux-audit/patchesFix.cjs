// Правки макетов по повторной независимой сверке (14.11): серьёзные и средние замечания.
// css дописывается к стилям макета, post выполняется в браузере после основной перестройки; js — замена целиком.
module.exports = (P, { HELPERS, BASE, FRAME, DOCK, SHEET }) => {
const add = (name, o) => { const p = P[name]; if (o.css) p.css += o.css; if (o.post) p.post = o.post; if (o.js) p.js = o.js; if (o.prep) p.prep = o.prep; if (o.helpers) p.helpers = (p.helpers || '') + o.helpers; };
// Во всех листах с панелью: стрелка у названия команды (оно открывает состав); зоны нажатия от 40 px.
for (const k of Object.keys(P)) if (typeof P[k] === 'object' && P[k].css && P[k].css.includes('mk-dock')) P[k].css += `\n.hud-team::after { content:'›'; margin-left:6px; color:var(--mk-acc); font-size:16px }\n`;
const TAP = `\n.mk-btn.sm { height:40px; padding:0 14px; font-size:14px }\n`;

add('karta', { post: () => { const h = document.querySelector('.mk-hist'); if (h) h.lastChild.textContent = 'Перемотка'; } });

add('delaKomanda', { css: `
.mk-li .pr { flex:none; display:flex; align-items:center; color:#c8561c } .mk-li .pr svg { width:16px; height:16px }
.mk-li .mk-n { margin-left:0; flex:none }
`, js: () => {
  const lists = document.querySelectorAll('.side-menu ul.list.interactive'); const rows = [...lists[0].children].map((li) => { const t = li.querySelector('.title'); return { t: mk.own(t), st: (li.querySelector('.chip') || {}).textContent || '', who: (li.querySelector('.taker') || {}).textContent || '', prio: t.firstElementChild ? mk.svg(t, 16) || '⚑' : '' }; });
  const freeN = mk.num((document.querySelector('.side-menu .list-title .count') || {}).textContent);
  const b = mk.frame({ active: 'Дела', tabs: [{ t: 'Мои' }, { t: 'Команда', n: rows.length, on: true }, { t: 'Свободные', n: freeN }] });
  const group = (name, list) => { if (!list.length) return ''; const m = new Map(); list.forEach((r) => { const k = r.t + '|' + r.who; const x = m.get(k); if (x) { x.n++; x.prio = x.prio || r.prio; } else m.set(k, { ...r, n: 1 }); }); const items = [...m.values()].sort((a, b2) => a.who.localeCompare(b2.who, 'ru', { numeric: true }) || a.t.localeCompare(b2.t, 'ru')); return '<div class="mk-gh">' + name + ' <i>· ' + list.length + '</i></div>' + items.map((r) => '<div class="mk-li">' + (r.prio ? '<span class="pr" title="приоритет капитана">' + r.prio + '</span>' : '') + '<span class="t">' + mk.esc(r.t) + '</span>' + (r.n > 1 ? '<span class="mk-n">×' + r.n + '</span>' : '') + '<span class="s">' + mk.esc(r.who) + '</span><span class="mk-chev">›</span></div>').join(''); };
  b.innerHTML = group('На проверке', rows.filter((r) => /провер/.test(r.st))) + group('В работе', rows.filter((r) => /работ/.test(r.st)));
} });

add('delaSvobodnye', { css: TAP + `
.mk-cnt { font-size:13px; font-weight:600; padding:1px 8px; border-radius:10px; background:rgba(120,90,40,.14); color:var(--mk-ink); flex:none }
.mk-li .mk-tags { display:block; font-size:12.5px; color:var(--mk-muted); line-height:1.25 } .mk-li .mk-tags b { color:#c8561c; font-weight:600 }
.mk-subli { min-height:52px !important; gap:10px !important }
.mk-subli .t small { display:block; font-size:12.5px; color:var(--mk-muted) } .mk-subli .t small b { color:#c8561c; font-weight:600 }
.mk-maplink { font-size:13px; color:var(--mk-acc); text-decoration:underline; white-space:nowrap; flex:none; height:40px; display:flex; align-items:center }
`, js: async () => {
  const lists = document.querySelectorAll('.side-menu ul.list.interactive'); const teamN = lists[0].children.length; const titles = [...lists[1].children].map((li) => mk.own(li.querySelector('.title')));
  const m = new Map(); titles.forEach((t) => m.set(t, (m.get(t) || 0) + 1)); const groups = [...m.entries()];
  const gid = location.pathname.split('/')[2]; const map = await fetch('/api/games/' + gid + '/my-map').then((r) => r.json()); const open = map.tasks.filter((x) => x.status === 'OPEN');
  const labels = [...document.querySelectorAll('.m-label:not(.scouted)')].map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.replace(/·.*$/, '').trim(), x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const near = (id) => { const el = document.querySelector('.m-deed[data-id="' + id + '"]'); if (!el) return ''; const r = el.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2; let best = null, bd = 1e9; labels.forEach((l) => { const d = Math.hypot(l.x - x, l.y - y); if (d < bd) { bd = d; best = l; } }); return best ? best.t : ''; };
  const b = mk.frame({ active: 'Дела', tabs: [{ t: 'Мои' }, { t: 'Команда', n: teamN }, { t: 'Свободные', n: titles.length, on: true }] });
  let html = '<div class="mk-search">⌕ <span>Найти дело</span></div>'; let opened = false;
  groups.forEach(([t, n]) => { const of = open.filter((x) => x.deed.title === t); const sea = of.filter((x) => x.sea).length, pr = of.filter((x) => x.priorityAt).length; const tags = (pr ? '<b>приоритет капитана' + (pr > 1 ? ': ' + pr : '') + '</b>' : '') + (pr && sea ? ' · ' : '') + (sea ? 'морем: ' + sea : '');
    const isOpen = !opened && n >= 3 && n <= 5; if (isOpen) opened = true;
    if (n === 1) html += '<div class="mk-li"><span class="t">' + mk.esc(t) + (tags ? '<span class="mk-tags">' + tags + '</span>' : '') + '</span><span class="mk-btn sm main">Взять</span></div>';
    else { html += '<div class="mk-li' + (isOpen ? ' open' : '') + '"><span class="t">' + mk.esc(t) + (tags ? '<span class="mk-tags">' + tags + '</span>' : '') + '</span><span class="mk-cnt">×' + n + '</span><span class="mk-chev">' + (isOpen ? '⌃' : '›') + '</span></div>';
      if (isOpen) of.slice(0, n).forEach((x) => { const c = near(x.id); html += '<div class="mk-subli"><span class="t">' + (c ? 'у города ' + mk.esc(c) : 'на карте') + ((x.sea || x.priorityAt) ? '<small>' + (x.priorityAt ? '<b>приоритет капитана</b>' : '') + (x.priorityAt && x.sea ? ' · ' : '') + (x.sea ? 'морем, на корабле' : '') + '</small>' : '') + '</span><span class="mk-maplink">На карте</span><span class="mk-btn sm main">Взять</span></div>'; }); } });
  b.innerHTML = html;
} });

add('sluzhenie', { css: `
.mk-th, .mk-tr { grid-template-columns:14px 26px 1fr 34px 30px 48px 44px 36px !important; column-gap:5px !important }
.mk-tr .nm { font-size:14px !important; padding-left:2px !important }
.mk-av, .mk-av .avatar:not(.team) { width:26px !important; height:26px !important }
.mk-th { height:30px !important; font-size:12px !important; align-items:center !important; padding-bottom:0 !important }
.mk-th span { flex-direction:row !important; align-items:center !important; justify-content:flex-end; gap:3px !important }
.mk-th span.l { justify-content:flex-start; font-size:12px !important }
.mk-th .mk-q { width:15px; height:15px; font-size:10px; flex:none }
.mk-th span { overflow:visible; white-space:nowrap }
`, post: () => { const th = document.querySelector('.mk-th'); th.innerHTML = '<span class="l">игроки всех команд</span><span><b class="mk-q">?</b>очки</span><span>дела</span><span>районы</span><span>города</span><span>стихи</span>'; } });

add('nagrady', { css: `
.mk-d { width:28px !important; height:28px !important; font-size:12px !important }
.mk-s1 img.zero { filter:grayscale(1) opacity(.55) }
.mk-grid { align-items:start }
`, post: () => {
  const card = document.querySelector('.streak-card'); const n = mk.num(card.querySelector('.streak-count b').textContent); if (!n) { const im = document.querySelector('.mk-s1 img'); if (im) im.classList.add('zero'); }
  const goal = card.querySelector('.streak-goal-badge img'); const orig = document.querySelector('.award-grid'); let name = '';
  const gb = card.querySelector('.streak-goal-badge .award'); if (gb) name = gb.getAttribute('title') || '';
  const s3 = document.querySelector('.mk-s3'); const segs = card.querySelectorAll('.streak-segs i').length; if (s3 && name) s3.lastChild.textContent = 'до награды «' + name + '» — ' + segs + ' дней подряд';
  const g = document.querySelector('.mk-grid'); g.innerHTML = ''; [...orig.children].forEach((a) => g.appendChild(a.cloneNode(true)));
} });

add('ispytaniya', { css: `.mk-li.tr .t small { display:flex; align-items:center; gap:6px; flex-wrap:wrap }`, post: () => {
  document.querySelectorAll('.mk-tab i').forEach((i) => i.remove());
  document.querySelectorAll('.mk-li.tr').forEach((li) => { const b = li.querySelector('.t b'); b.textContent = 'Город ' + b.textContent; const dots = li.querySelectorAll('.mk-dots i'); const ok = [...dots].filter((d) => d.classList.contains('ok')).length; const sm = li.querySelector('.t small'); sm.appendChild(document.createTextNode('этапы: ' + ok + ' из ' + dots.length)); });
} });

add('komandyRejting', { css: `
.mk-th, .mk-tr { grid-template-columns:20px 30px 1fr 68px 68px 84px 12px !important; column-gap:4px !important }
.mk-th { font-size:12px !important; height:30px !important } .mk-th span.l { grid-column:1 / 4 !important; white-space:nowrap }
.mk-tr { row-gap:0 !important; padding:8px 0 !important }
.mk-tr .nm { grid-column:3 / 7 !important } .mk-tr .rk, .mk-tr .avc { grid-row:1 / 3; align-self:start; padding-top:2px }
.mk-tr .who { grid-column:3 / 4; text-align:left !important; font-size:12.5px; color:var(--mk-muted); padding-left:4px }
.mk-tr .ln2 { grid-column:3 / 8 !important }
.mk-tr .chv { grid-row:1; grid-column:7; color:var(--mk-acc); font-size:17px }
.mk-tr .num { font-size:16px } .mk-tr .num.main { font-weight:700 }
.mk-note { display:none !important }
`, js: () => {
  const rows = [...document.querySelectorAll('.standings-list > li.standing')].map((li) => { const c = [...li.querySelectorAll(':scope > .body > .meta.chips .chip')].map((x) => mk.num(x.textContent)); const tag = li.querySelector(':scope > .body > .name > .chip'); return { rank: li.querySelector('.rank').textContent.trim(), av: li.querySelector('.avatar.team').outerHTML, name: li.querySelector('.name .name').textContent.trim(), tag: tag ? tag.textContent.trim() : '', c }; });
  const b = mk.frame({ active: 'Команды', tabs: [{ t: 'Рейтинг', on: true }, { t: 'Состав' }, { t: 'Проходы' }, { t: 'Награды' }] });
  const col = { 'мы': 'mk-warn', 'мир': 'mk-ok', 'выбыла': 'mk-bad' }; const word = { 'мы': 'наша команда', 'мир': 'у нас с ними мир', 'выбыла': 'выбыла' };
  b.innerHTML = '<div class="mk-th"><span class="l">место — по городам</span><span>города</span><span>дела</span><span>перекрёстки</span><span></span></div>' + rows.map((r) => '<div class="mk-tr"><span class="rk">' + r.rank + '</span><span class="avc">' + r.av + '</span><span class="nm"><b>' + mk.esc(r.name) + '</b></span><span class="chv">›</span><span class="who"></span><span class="num main">' + r.c[1] + '</span><span class="num">' + r.c[2] + '</span><span class="num">' + r.c[3] + '</span><span class="ln2">' + (r.tag ? '<b class="' + (col[r.tag] || '') + '">' + (word[r.tag] || r.tag) + '</b> · ' : '') + r.c[0] + ' игроков · испытания: выиграли ' + r.c[4] + ', устояли ' + r.c[5] + ', проиграли ' + r.c[6] + '</span></div>').join('');
} });

// Вкладка «Состав»: все команды группами; своя раскрыта. Общая часть — и для листа выбора роли.
const SOSTAV_CSS = `
.mk-li.pl { min-height:48px; padding:0 }
.mk-li.pl .avatar { width:32px !important; height:32px !important; flex:none }
.mk-li.pl .t { font-size:16px }
.mk-role { height:40px; padding:0 10px; border-radius:10px; border:1px solid rgba(120,90,40,.45); background:#fffaf0; display:inline-flex; align-items:center; gap:6px; font-size:14px; color:var(--mk-ink); flex:none }
.mk-role svg { width:16px; height:16px } .mk-role .ar { color:var(--mk-acc); font-size:12px }
.mk-role.cap { border:0; background:none; color:var(--mk-warn); font-weight:600; padding:0 }
.mk-team { min-height:48px; display:flex; align-items:center; gap:10px; border-bottom:1px solid var(--mk-line) }
.mk-team .avatar { width:28px !important; height:28px !important; flex:none; font-size:12px !important }
.mk-team b { font-size:16px } .mk-team small { font-size:13px; color:var(--mk-muted); margin-left:6px } .mk-team .mk-chev { margin-left:auto }
`;
const SOSTAV_JS = `
mk.sostav = () => {
  const teams = [...document.querySelectorAll('.standings-list > li.standing')].map((li) => ({ av: li.querySelector('.avatar.team').outerHTML, name: li.querySelector('.name .name').textContent.trim(), n: mk.num((li.querySelector(':scope > .body > .meta.chips .chip') || {}).textContent), own: !!li.querySelector('ul.roster'), rows: [...li.querySelectorAll('ul.roster > li')].map((r) => { const btn = r.querySelector('.role-slot button'); return { av: r.querySelector('.avatar').outerHTML, name: r.querySelector('.name').textContent.trim(), role: btn ? (btn.getAttribute('aria-label') || '').trim() : '', icon: btn ? mk.svg(btn, 16) : '', dep: !!r.querySelector('.deputy-star') }; }) }));
  const b = mk.frame({ active: 'Команды', tabs: [{ t: 'Рейтинг' }, { t: 'Состав', on: true }, { t: 'Проходы' }, { t: 'Награды' }] });
  b.innerHTML = teams.map((t) => '<div class="mk-team">' + t.av + '<b>' + mk.esc(t.name) + '</b><small>' + t.n + ' игроков</small><span class="mk-chev">' + (t.own ? '⌃' : '›') + '</span></div>' + t.rows.map((r) => { const cap = /капитан/i.test(r.role); return '<div class="mk-li pl">' + r.av + '<span class="t">' + mk.esc(r.name) + (r.dep && !cap ? '<small>заместитель капитана</small>' : '') + '</span><span class="mk-role' + (cap ? ' cap' : '') + '">' + r.icon + (cap ? 'Капитан' : mk.esc(r.role) + ' <span class="ar">▾</span>') + '</span></div>'; }).join('')).join('');
};
`;
add('komandySostav', { css: SOSTAV_CSS, helpers: SOSTAV_JS, js: () => { mk.sostav(); } });

P.rol.css = FRAME + DOCK + SOSTAV_CSS + `
.hud-team::after { content:'›'; margin-left:6px; color:var(--mk-acc); font-size:16px }
.mk-scrim { position:absolute; inset:0; background:rgba(30,20,10,.45); z-index:60 }
.mk-sheet { position:absolute; left:0; right:0; bottom:0; z-index:61; background:var(--mk-paper); border-radius:14px 14px 0 0; padding:0 16px 18px; box-shadow:0 -6px 24px rgba(30,20,10,.3) }
.mk-sheet .mk-row { padding-left:0 }
.mk-opt { min-height:60px; display:flex; align-items:center; gap:12px; border-bottom:1px solid var(--mk-line); padding:6px 0 }
.mk-opt:last-child { border-bottom:0 }
.mk-opt svg { width:22px; height:22px; flex:none }
.mk-opt .t { flex:1; min-width:0 } .mk-opt .t b { display:block; font-size:16px } .mk-opt .t span { display:block; font-size:13px; color:var(--mk-muted); line-height:1.25 }
.mk-radio { width:22px; height:22px; border-radius:50%; border:1.5px solid rgba(120,90,40,.6); flex:none; display:flex; align-items:center; justify-content:center }
.mk-opt.on .mk-radio { border-color:#7a4a16 } .mk-opt.on .mk-radio::after { content:''; width:11px; height:11px; border-radius:50%; background:#7a4a16 }
`;
P.rol.helpers = HELPERS + SOSTAV_JS;
P.rol.js = () => {
  const tray = document.querySelector('.role-tray'); const li = tray.closest('li'); const who = li ? li.querySelector('.name').textContent.trim() : '';
  const roles = ['Разведчик', 'Пророк', 'Посол', 'Летописец', 'Кормчий', 'Воин']; const seen = new Set();
  const opts = [...tray.querySelectorAll('.role-opt')].map((o) => { const d = o.querySelector('.desc').textContent.trim(); return { name: o.querySelector('.chip').textContent.trim(), icon: mk.svg(o.querySelector('.chip'), 22), on: o.classList.contains('on'), d }; }).filter((o) => roles.includes(o.name) && !seen.has(o.name) && seen.add(o.name)).sort((a, c) => (c.on ? 1 : 0) - (a.on ? 1 : 0));
  // Описание — до 90 знаков, по границе предложения или слова.
  const short = (d) => { if (d.length <= 92) return d; const cut = d.slice(0, 92); const dot = cut.lastIndexOf('. '); return dot > 40 ? cut.slice(0, dot + 1) : cut.replace(/[\s,:;—-]+\S*$/, '') + '…'; };
  mk.sostav();
  const scr = document.querySelector('.map-screen'); scr.appendChild(mk.h('<div class="mk-scrim"></div>'));
  scr.appendChild(mk.h('<div class="mk mk-sheet"><div class="mk-row"><div class="mk-title">Роль: ' + mk.esc(who) + '</div><span class="mk-x">✕</span></div>' + opts.map((o) => '<div class="mk-opt' + (o.on ? ' on' : '') + '">' + o.icon + '<span class="t"><b>' + o.name + '</b><span>' + mk.esc(short(o.d)) + '</span></span><span class="mk-radio"></span></div>').join('') + '</div>'));
};

add('letopis', { css: `
.mk-li.ev .t { display:block !important; -webkit-line-clamp:unset !important; overflow:visible !important }
.mk-kids { padding:0 0 0 32px !important } .mk-kids div { min-height:36px; align-items:center; border-top:1px solid var(--mk-line); color:var(--mk-ink) !important; font-size:14px !important; line-height:1.25 !important; padding:4px 0 }
.mk-kids div span { color:var(--mk-muted); font-size:12px; margin-left:auto; padding-left:8px } .mk-kids div i { font-style:normal; color:var(--mk-acc); font-size:16px; flex:none; width:10px; text-align:right; margin-left:6px }
`, post: () => {
  document.querySelectorAll('.mk-kids div').forEach((d) => { d.appendChild(mk.h('<i>›</i>')); });
  document.querySelectorAll('.mk-li.ev .mk-chev').forEach((c) => { if (c.textContent === '⌄') c.textContent = '⌃'; });
} });

add('deloSvob', { css: `.mk-what a { margin-left:auto; color:var(--mk-acc); text-decoration:underline; font-size:13px; height:32px; display:flex; align-items:center }`, post: () => { const w = document.querySelector('.mk-what'); if (w) w.appendChild(mk.h('<a>Кодекс дела</a>')); } });

add('deloSdacha', { css: `
.mk-state { margin:8px 0 8px !important }
.mk-wide.need { border-color:var(--mk-bad); box-shadow:0 0 0 1px var(--mk-bad) }
.mk-why { font-size:13px; color:var(--mk-bad); text-align:right; margin-top:6px }
.mk-links { margin-top:6px !important } .mk-links a { height:40px; display:flex; align-items:center }
`, post: () => {
  const req = document.querySelector('.mk-lab .req'); if (req) req.remove();
  const w = document.querySelector('.mk-wide'); if (w) w.classList.add('need');
  const line = document.querySelector('.mk-line span'); if (line) line.textContent = 'нет · отметить ›';
  const acts = document.querySelector('.mk-acts'); if (acts) acts.after(mk.h('<div class="mk-why">Чтобы сдать, вставьте ссылку на фото или видео</div>'));
} });

add('gorodSvoj', { css: `
.city-sheet .step-body > .row.mt-2 { order:70 !important; border-top:1px solid var(--mk-line); padding-top:10px; margin-top:0 !important; height:auto !important }
.mk-passed { order:60 !important }
.city-sheet .wall-bar button.icon { width:auto !important; padding:0 12px !important; font-size:14px !important; gap:6px }
.city-sheet .wall-bar > span.muted { display:flex; align-items:center; gap:6px }
`, post: () => {
  const plus = document.querySelector('.city-sheet .wall-bar button.icon'); if (plus) plus.appendChild(document.createTextNode(' Сдать блок стены'));
  [...document.querySelectorAll('.city-sheet details.disclose *')].forEach((e) => { if (!e.children.length && /^(Испытание города|Это ваш город)$/.test(e.textContent.trim())) e.style.display = 'none'; });
} });

add('zadanie', { css: `
.mk-back { justify-content:space-between }
.mk-back a { color:var(--mk-acc); font-size:14px; height:40px; display:flex; align-items:center }
.mk-ttl { font:700 18px/1.25 Philosopher, serif; margin:2px 0 8px } .mk-ttl small { font:400 13px Literata, serif; color:var(--mk-muted); margin-left:6px; white-space:nowrap }
`, post: () => {
  const h = document.querySelector('.city-sheet .task-view h3').textContent.trim(); const parts = h.split(' · ');
  const back = document.querySelector('.mk-back'); back.innerHTML = '<a>‹ К районам</a><a>Пересказ района ›</a>';
  back.after(mk.h('<div class="mk-ttl">' + mk.esc(parts[0].replace('Район ', '') + '. ' + (parts[1] || '')) + '<small>' + mk.esc(parts[2] || '') + '</small></div>'));
  document.querySelectorAll('.mk-ans.on').forEach((a) => a.classList.remove('on'));
  const go = document.querySelector('.mk-foot .mk-go'); if (go) go.classList.add('off');
  const note = document.querySelector('.city-sheet .answer .note'); const sign = note ? (note.textContent.match(/задания: (\S+?)\./) || [])[1] : ''; const n2 = document.querySelector('.mk-note2'); if (n2) n2.textContent = 'Команда это задание уже решила' + (sign ? ' и открыла его знак — «' + sign + '»' : '') + '. Решите сами — оно пойдёт в ваш счёт для ключа.';
} });

add('gorodPoryadok', { css: `
.mk-ring .ud { gap:8px !important } .mk-ring .ud span { width:40px !important; height:40px !important }
.mk-ring { align-items:center; flex-wrap:wrap; padding:4px 0 }
.mk-ring .ds { flex-basis:100%; font-size:13px; line-height:1.35; color:#d8c7a2; padding:0 4px 8px 58px }
.mk-hint { font-size:13px; color:var(--mk-muted); margin:-2px 0 6px }
`, post: () => {
  const first = document.querySelector('.city-sheet ol.rings li.ring small'); const r = document.querySelector('.mk-ring'); if (first && r) r.appendChild(mk.h('<span class="ds">' + mk.esc(first.textContent.trim()) + '</span>'));
  const t = document.querySelector('.mk-task'); if (t) t.after(mk.h('<div class="mk-hint">Нажмите на название — раскроется пересказ района.</div>'));
} });

add('gorodKonvert', { css: `
.mk-keylab { font-size:13px; color:var(--mk-muted); margin:10px 0 4px } .mk-keyrow { margin-top:0 !important }
.mk-allmemo { font-size:13px; color:var(--mk-acc); text-decoration:underline; height:36px; display:flex; align-items:center }
`, post: () => {
  const li = document.querySelectorAll('.mk-todo li'); const tx = ['Заранее договоритесь с семьёй о времени, когда им удобно вас принять.', 'Приезд — не «забрать конверт и уехать»: помолитесь вместе и благословите этот дом, привезите гостинец или помогите по дому — хотя бы одно из этого.', 'И только потом назовите шифр — получите конверт с ключом.', 'Капитан в тот же день сдаёт отчёт: кто ездил, что сделали, фото.']; li.forEach((x, i) => { if (tx[i]) x.textContent = tx[i]; });
  const key = document.querySelector('.mk-key'); if (key) key.textContent = '4–6 знаков'; const row = document.querySelector('.mk-keyrow'); if (row) row.before(mk.h('<div class="mk-keylab">Ключ из конверта</div>'));
} });

add('aProverka', { css: `
.mk-frow .r { display:flex; align-items:center; height:40px }
.mk-sel.plain { padding:0 10px !important }
.mk-c1 .k { color:var(--mk-acc); text-decoration:underline; height:28px; display:flex; align-items:center }
.mk-c1b { font-size:12.5px; color:var(--mk-muted); line-height:1.3 }
.mk-c4 { gap:6px !important; margin-top:10px !important } .mk-c4 .mk-btn.sm { height:40px !important; padding:0 14px !important; font-size:14px !important }
.mk-c4 .mk-btn.sm.main { margin-left:6px }
.mk-att { height:40px !important; padding:0 10px !important; font-size:13.5px !important }
`, post: () => {
  const sort = document.querySelector('.mk-sel.plain'); if (sort) sort.textContent = '↑';
  const metas = [...document.querySelectorAll('.admin-popup li.review-item .meta')].map((m) => m.textContent.replace(/\s+/g, ' '));
  document.querySelectorAll('.mk-card').forEach((c, i) => { const t = metas[i] || ''; const a = (t.match(/взято ([^·]+?)\s*·/) || [])[1], b = (t.match(/сдано ([^·]+?)\s*·/) || [])[1], ago = (t.match(/(\d+ (?:ч|мин|дн)\.?[^·]*?назад)/) || [''])[0]; const c1 = c.querySelector('.mk-c1'); c1.childNodes.forEach((n) => { if (n.nodeType === 3) n.textContent = n.textContent.replace(/ · [^·]*назад\s*$/, ''); });
    const k = c1.querySelector('.k'); if (k) k.textContent = 'На карте';
    if (a && b) c1.after(mk.h('<div class="mk-c1b">взято ' + a.trim() + ' → сдано ' + b.trim().replace(/^сегодня /, '') + ' · ' + ago + '</div>'));
    [...c.querySelectorAll('.mk-att')].forEach((x) => { if (/Карта/.test(x.textContent)) x.remove(); }); });
} });

add('aDela', { css: `
.mk-ed.more { color:var(--mk-muted); font-size:20px; width:32px }
`, post: () => {
  const src = [...document.querySelectorAll('.admin-popup li.deed-row')]; document.querySelectorAll('.mk-d').forEach((d, i) => { const li = src[i]; if (!li) return;
    const tags = [...new Set([...li.querySelectorAll('.chip')].map((c) => c.textContent.trim()).filter((t) => t && t !== 'выключено'))]; const sm = d.querySelector('.t small');
    if (tags.length) sm.insertBefore(document.createTextNode(tags.map((t) => (t === 'книга города' ? 'по книге города' : /^\d+ книг/.test(t) ? 'книги: ' + parseInt(t, 10) : t === 'издалека' ? 'можно издалека' : t)).join(' · ') + ' · '), sm.firstChild && sm.firstChild.nodeName === 'B' ? sm.firstChild.nextSibling : sm.firstChild);
    const om = li.querySelector('.on-map'); const nums = om ? om.textContent.replace(/[^0-9 ]/g, ' ').trim().split(/\s+/).map(Number) : []; if (nums[2]) sm.appendChild(document.createTextNode(', ' + nums[2] + ' в море'));
    d.appendChild(mk.h('<span class="mk-ed more">⋮</span>')); });
} });

add('novoe', { css: `
.mk-h span.bk { height:44px; padding:0 14px; border-radius:22px; border:1px solid rgba(120,90,40,.4); background:rgba(255,250,236,.85); display:inline-flex; align-items:center; gap:6px; font:14px Literata, serif; color:var(--mk-ink) }
.mk-it a { display:inline-block; padding:4px 0 }
`, post: () => { const h = document.querySelector('.mk-h'); h.innerHTML = '<span class="bk">‹ Назад</span><b>Что нового</b>'; } });

add('spisok', { post: () => { const two = document.querySelector('.mk-two'); two.innerHTML = '<span class="mk-btn main">Войти по приглашению</span><span class="mk-btn">+ Создать игру</span>'; two.style.gridTemplateColumns = '1.15fr .85fr'; } });

P.vhod.js = async () => {
  const x = [...document.querySelectorAll('button[aria-label="Закрыть"]')].find((b) => b.offsetParent); if (x) x.click(); await new Promise((r) => setTimeout(r, 800));
  const logo = document.querySelector('.auth-logo'); if (logo) logo.after(mk.h('<div class="mk mk-intro">▶ Об игре · ролик 2 минуты</div>'));
  const top = [...document.querySelectorAll('.guest-bar button')].find((e) => e.textContent.trim() === 'О игре'); if (top) top.style.display = 'none';
};
P.vhod.css += `\n.mk-intro { margin:0 0 12px !important }\n`;
};
