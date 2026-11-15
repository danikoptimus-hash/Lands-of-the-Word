// Макеты «после» по предписаниям независимой экспертизы (14.11). Код игры не меняется: на живую страницу
// накладываются стили и перестроенная разметка. css — стили, js — функция в браузере (доступен помощник window.mk).
const P = {};

// ── Общие стили макетов ─────────────────────────────────────────────────────────────────────────────
const BASE = `
:root { --mk-ink:#2B1D12; --mk-muted:#6a5540; --mk-line:rgba(120,90,40,.22); --mk-acc:#8a5a1c; --mk-paper:#F5ECD8; --mk-ok:#3f6b2f; --mk-bad:#a8442a; --mk-plum:#5B2F8C; --mk-warn:#8a5a0e }
.mk, .mk * { box-sizing:border-box }
.mk { font:15px/1.3 Literata, Georgia, serif; color:var(--mk-ink) }
.mk-row { height:44px; display:flex; align-items:center; padding:0 0 0 16px; border-bottom:1px solid var(--mk-line); flex:none }
.mk-tabs { display:flex; gap:18px; flex:1; min-width:0; align-items:stretch; height:44px }
.mk-tab { font-size:15px; color:var(--mk-muted); display:flex; align-items:center; gap:5px; border-bottom:2px solid transparent; white-space:nowrap }
.mk-tab.on { color:var(--mk-ink); font-weight:700; border-bottom-color:var(--mk-acc) }
.mk-tab i { font-style:normal; font-size:12px; color:var(--mk-muted); font-weight:400 }
.mk-dot { min-width:18px; height:18px; border-radius:9px; background:var(--mk-bad); color:#fff; font:700 11px/18px Literata, serif; text-align:center; padding:0 5px }
.mk-title { font:700 17px Philosopher, Georgia, serif; flex:1 }
.mk-x { width:44px; height:44px; display:flex; align-items:center; justify-content:center; font-size:19px; color:var(--mk-acc); flex:none }
.mk-body { flex:1; min-height:0; overflow:hidden; padding:0 16px }
.mk-gh { height:28px; display:flex; align-items:flex-end; padding-bottom:4px; font-weight:700; font-size:12px; letter-spacing:.04em; text-transform:uppercase; color:var(--mk-muted); border-bottom:1px solid var(--mk-line); gap:6px }
.mk-gh i { font-style:normal; font-weight:400 }
.mk-li { min-height:44px; display:flex; align-items:center; gap:10px; border-bottom:1px solid var(--mk-line); padding:5px 0 }
.mk-li .t { flex:1; min-width:0; font-size:15px; line-height:1.25; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden }
.mk-li .t small, .mk-sub { display:block; font-size:13px; color:var(--mk-muted); line-height:1.25 }
.mk-li .s { font-size:13px; line-height:1.2; color:var(--mk-muted); white-space:nowrap; flex:none; text-align:right }
.mk-n { font-size:13px; color:var(--mk-muted); margin-left:6px; white-space:nowrap }
.mk-chev { color:var(--mk-acc); font-size:17px; flex:none; width:10px; text-align:right; line-height:1 }
.mk-empty { height:32px; display:flex; align-items:center; font-size:13px; color:var(--mk-muted) }
.mk-btn { height:36px; padding:0 14px; border-radius:9px; border:1px solid rgba(120,90,40,.5); background:#fffaf0; font:600 14px Literata, serif; color:var(--mk-ink); display:inline-flex; align-items:center; gap:6px; flex:none; box-shadow:0 1px 0 rgba(60,40,10,.15) }
.mk-btn.main { background:#7a4a16; border-color:#5d370f; color:#fff8ea }
.mk-btn.sm { height:32px; padding:0 12px; font-size:13px }
.mk-ok { color:var(--mk-ok) } .mk-bad { color:var(--mk-bad) } .mk-warn { color:var(--mk-warn) } .mk-plum { color:var(--mk-plum) }
.mk svg { flex:none }
.mk-go { height:48px; padding:0 16px; border-radius:11px; background:#7a4a16; border:1px solid #5d370f; color:#fff8ea; font:700 16px Literata, serif; display:flex; align-items:center; gap:8px; margin-left:auto; flex:none; white-space:nowrap; justify-content:center }
.mk-go svg { width:20px; height:20px } .mk-go.off { opacity:.45 }
.mk-help1 { width:22px; height:22px; border-radius:50%; border:1px solid var(--mk-acc); color:var(--mk-acc); font-size:12px; font-weight:400; display:inline-flex; align-items:center; justify-content:center; flex:none }
`;
// Каркас листа нижней панели: панель видна всегда, лист непрозрачный, одна строка 44 px.
const FRAME = BASE + `
.side-menu { top:64px !important; bottom:56px !important; height:auto !important; max-height:none !important; background:var(--mk-paper) !important; backdrop-filter:none !important; -webkit-backdrop-filter:none !important }
.side-menu .side-top { display:none !important }
.side-menu .side-body { padding:0 !important; height:100% !important; overflow:hidden !important; display:flex !important; flex-direction:column }
.side-menu .side-body > * { display:none !important }
.side-menu .side-body > .mk { display:flex !important; flex-direction:column; min-height:0; flex:1 }
`;
const DOCK = `
nav.team-dock.mk-dock { position:absolute !important; left:0 !important; right:0 !important; bottom:0 !important; top:auto !important; width:auto !important; height:56px !important; background:var(--mk-paper) !important; border-top:1px solid rgba(120,90,40,.4); display:flex !important; gap:0 !important; padding:0 !important; margin:0 !important; z-index:45 !important; transform:none !important; border-radius:0 !important }
nav.mk-dock .dock-btn { flex:1; height:56px !important; width:auto !important; min-width:0 !important; background:none !important; backdrop-filter:none !important; -webkit-backdrop-filter:none !important; border:0 !important; box-shadow:none !important; border-radius:0 !important; padding:6px 0 4px !important; gap:2px !important; opacity:1 !important }
nav.mk-dock .dock-btn .lbl { font-size:12px !important; color:var(--mk-ink) !important }
nav.mk-dock .dock-btn svg { width:24px !important; height:24px !important }
nav.mk-dock .dock-btn.mk-on { background:rgba(168,114,46,.18) !important; box-shadow:inset 0 2px 0 var(--mk-acc) !important }
nav.mk-dock .dock-btn .badge { display:none !important }
nav.mk-dock .dock-btn .mk-dot { position:absolute; top:4px; right:14px }
.hud-right { display:flex !important; gap:8px !important; align-items:center }
.mk-bell { width:44px !important; height:44px !important; padding:0 !important }
.mk-bell svg { width:20px; height:20px }
`;
// Помощник в браузере.
const HELPERS = `
window.mk = {
  h: (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; },
  esc: (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  svg: (el, size) => { const s = el && el.querySelector('svg'); if (!s) return ''; const c = s.cloneNode(true); if (size) { c.setAttribute('width', size); c.setAttribute('height', size); c.style.width = size + 'px'; c.style.height = size + 'px'; } return c.outerHTML; },
  dock: (active, dots) => { const nav = document.querySelector('nav.team-dock'); const scr = document.querySelector('.map-screen'); if (!nav) return; nav.classList.add('mk-dock'); scr.appendChild(nav); const btns = [...nav.querySelectorAll('.dock-btn')]; const by = (n) => btns.find((b) => b.textContent.includes(n)); const bell = by('Внимание'); ['Дела', 'Испытания', 'Команды', 'Служение', 'Летопись'].forEach((n) => { const b = by(n); if (b) nav.appendChild(b); }); if (bell) { const right = document.querySelector('.hud-right'); if (right && !right.querySelector('.mk-bell')) { const b = mk.h('<button type="button" class="btn secondary icon hud-btn mk-bell"></button>'); b.innerHTML = mk.svg(bell); right.insertBefore(b, right.firstChild); } bell.remove(); } btns.forEach((b) => b.classList.remove('on')); if (active) { const a = by(active); if (a) a.classList.add('mk-on'); } Object.entries(dots || {}).forEach(([n, v]) => { const b = by(n); if (b && v) { b.style.position = 'relative'; b.appendChild(mk.h('<b class="mk-dot">' + v + '</b>')); } }); },
  frame: (o) => { mk.dock(o.active, o.dots); const body = document.querySelector('.side-menu .side-body'); const root = mk.h('<div class="mk"></div>'); const row = mk.h('<div class="mk-row"></div>'); if (o.tabs) row.appendChild(mk.h('<div class="mk-tabs">' + o.tabs.map((t) => '<span class="mk-tab' + (t.on ? ' on' : '') + '">' + t.t + (t.n != null ? '<i>' + t.n + '</i>' : '') + (t.dot ? '<b class="mk-dot">' + t.dot + '</b>' : '') + '</span>').join('') + '</div>')); else row.appendChild(mk.h('<div class="mk-title">' + o.title + '</div>')); row.appendChild(mk.h('<span class="mk-x">✕</span>')); root.appendChild(row); const b = mk.h('<div class="mk-body"></div>'); root.appendChild(b); body.appendChild(root); if (o.fit) { const sm = document.querySelector('.side-menu'); sm.style.setProperty('top', 'auto', 'important'); sm.style.setProperty('height', o.fit + 'px', 'important'); } return b; },
  num: (s) => parseInt(String(s).replace(/[^0-9]/g, ''), 10) || 0,
  own: (el) => { if (!el) return ''; const t = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').replace(/\\s+/g, ' ').trim(); return t || el.textContent.trim(); },
};
`;

// ── Раздел A: главный экран и листы нижней панели ───────────────────────────────────────────────────
P.karta = { helpers: HELPERS, css: BASE + DOCK + `
.team-timeline { left:12px !important; right:auto !important; bottom:66px !important; transform:none !important; width:auto !important }
.team-timeline .tl-row { display:none !important }
.mk-hist { height:32px; padding:0 12px; border-radius:16px; background:var(--mk-paper); border:1px solid rgba(120,90,40,.45); display:inline-flex; align-items:center; gap:6px; font:600 13px Literata, serif; color:var(--mk-ink) }
.mk-hist svg { width:15px; height:15px }
.hud-team::after { content:'›'; margin-left:6px; color:var(--mk-acc); font-size:16px }
`, js: () => {
  const tl = document.querySelector('.team-timeline .tl-dock'); const row = document.querySelector('.team-timeline .tl-row');
  mk.dock(null, {});
  if (tl) { const b = mk.h('<span class="mk-hist"></span>'); b.innerHTML = mk.svg(row || tl, 15) + 'История'; tl.appendChild(b); }
} };

P.delaKomanda = { scene: 'dela', helpers: HELPERS, css: FRAME + DOCK + `
.mk-prio { font-size:12px; color:var(--mk-bad); white-space:nowrap }
`, js: () => {
  const lists = document.querySelectorAll('.side-menu ul.list.interactive'); const rows = [...lists[0].children].map((li) => ({ t: mk.own(li.querySelector('.title')), st: (li.querySelector('.chip') || {}).textContent || '', who: (li.querySelector('.taker') || {}).textContent || '', prio: li.querySelector('.title').children.length > 0 }));
  const free = lists[1] ? lists[1].children.length : 0; const freeN = mk.num((document.querySelector('.side-menu .list-title .count') || {}).textContent) || free;
  const b = mk.frame({ active: 'Дела', tabs: [{ t: 'Мои' }, { t: 'Команда', n: rows.length, on: true }, { t: 'Свободные', n: freeN }] });
  const group = (name, list) => { if (!list.length) return ''; const m = new Map(); list.forEach((r) => { const k = r.t + '|' + r.who; const x = m.get(k); if (x) x.n++; else m.set(k, { ...r, n: 1 }); }); const items = [...m.values()].sort((a, b2) => a.who.localeCompare(b2.who, 'ru', { numeric: true }) || a.t.localeCompare(b2.t, 'ru')); return '<div class="mk-gh">' + name + ' <i>· ' + list.length + '</i></div>' + items.map((r) => '<div class="mk-li"><span class="t">' + mk.esc(r.t) + (r.n > 1 ? '<span class="mk-n">×' + r.n + '</span>' : '') + (r.prio ? ' <span class="mk-prio">⚑ приоритет</span>' : '') + '</span><span class="s">' + mk.esc(r.who) + '</span><span class="mk-chev">›</span></div>').join(''); };
  b.innerHTML = group('На проверке', rows.filter((r) => /провер/.test(r.st))) + group('В работе', rows.filter((r) => /работ/.test(r.st)));
} };

P.delaSvobodnye = { scene: 'dela', helpers: HELPERS, prep: async (s) => { await s.p.evaluate(() => { const els = [...document.querySelectorAll('.side-menu, .side-menu *')].filter((e) => e.scrollHeight > e.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(e).overflowY)); const t = document.querySelector('.side-menu .list-title'); if (els[0] && t) els[0].scrollTop = t.offsetTop - 60; }); }, css: FRAME + DOCK + `
.mk-search { height:36px; margin:8px 0 2px; border:1px solid rgba(120,90,40,.4); border-radius:9px; background:#fffaf0; display:flex; align-items:center; padding:0 10px; font-size:14px; color:var(--mk-muted); gap:8px }
.mk-li.open { border-bottom:0; padding-bottom:0 }
.mk-subli { min-height:44px; display:flex; align-items:center; gap:8px; padding:4px 0 4px 14px; border-bottom:1px solid var(--mk-line); font-size:14px }
.mk-subli .t { flex:1; min-width:0; color:var(--mk-ink) }
.mk-sq { width:36px; height:36px; border-radius:9px; border:1px solid rgba(120,90,40,.45); background:#fffaf0; display:flex; align-items:center; justify-content:center; flex:none }
.mk-sq svg { width:17px; height:17px }
`, js: async () => {
  const lists = document.querySelectorAll('.side-menu ul.list.interactive'); const teamN = lists[0].children.length; const titles = [...lists[1].children].map((li) => mk.own(li.querySelector('.title')));
  const m = new Map(); titles.forEach((t) => m.set(t, (m.get(t) || 0) + 1)); const groups = [...m.entries()];
  // Где каждое дело на карте: ближайший подписанный город (по самой карте).
  const gid = location.pathname.split('/')[2]; const map = await fetch('/api/games/' + gid + '/my-map').then((r) => r.json());
  const labels = [...document.querySelectorAll('.m-label:not(.scouted)')].map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.replace(/·.*$/, '').trim(), x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const near = (id) => { const el = document.querySelector('.m-deed[data-id="' + id + '"]'); if (!el) return ''; const r = el.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2; let best = null, bd = 1e9; labels.forEach((l) => { const d = Math.hypot(l.x - x, l.y - y); if (d < bd) { bd = d; best = l; } }); return best ? best.t : ''; };
  const mapIcon = mk.svg([...document.querySelectorAll('.dock-btn')].find((x) => x.textContent.includes('Летопись')), 17);
  const b = mk.frame({ active: 'Дела', tabs: [{ t: 'Мои' }, { t: 'Команда', n: teamN }, { t: 'Свободные', n: titles.length, on: true }] });
  let html = '<div class="mk-search">⌕ <span>Найти дело</span></div>'; let opened = false;
  groups.forEach(([t, n]) => { const open = !opened && n >= 3 && n <= 5; if (open) opened = true; if (n === 1) html += '<div class="mk-li"><span class="t">' + mk.esc(t) + '</span><span class="mk-btn sm">Взять</span></div>'; else { html += '<div class="mk-li' + (open ? ' open' : '') + '"><span class="t">' + mk.esc(t) + '</span><span class="s">×' + n + '</span><span class="mk-chev">' + (open ? '⌄' : '›') + '</span></div>'; if (open) { const ids = map.tasks.filter((x) => x.status === 'OPEN' && x.deed.title === t).slice(0, n); ids.forEach((x) => { const c = near(x.id); html += '<div class="mk-subli"><span class="t">' + (c ? 'у города ' + mk.esc(c) : 'на карте') + (x.sea ? ' · морем' : '') + '</span><span class="mk-sq" title="на карте">⌖</span><span class="mk-btn sm">Взять</span></div>'; }); } } });
  b.innerHTML = html;
} };

P.delaMoi = { scene: 'delaUchastnik', helpers: HELPERS, css: FRAME + DOCK + `
.mk-li.mine { min-height:64px }
.mk-pt { width:8px; height:8px; border-radius:50%; background:var(--mk-plum); flex:none }
`, js: () => {
  const lists = document.querySelectorAll('.side-menu ul.list.interactive'); const me = 'Участник 4';
  const rows = [...lists[0].children].map((li) => ({ t: mk.own(li.querySelector('.title')), st: (li.querySelector('.chip') || {}).textContent || '', who: (li.querySelector('.taker') || {}).textContent || '' }));
  const mine = rows.filter((r) => r.who.trim() === me); const work = mine.filter((r) => /работ/.test(r.st)), rev = mine.filter((r) => /провер/.test(r.st));
  const freeN = mk.num((document.querySelector('.side-menu .list-title .count') || {}).textContent);
  const b = mk.frame({ active: 'Дела', dots: { 'Дела': work.length }, tabs: [{ t: 'Мои', n: mine.length, on: true }, { t: 'Команда', n: rows.length }, { t: 'Свободные', n: freeN }] });
  const merge = (list) => { const m = new Map(); list.forEach((r) => { const x = m.get(r.t); if (x) x.n++; else m.set(r.t, { ...r, n: 1 }); }); return [...m.values()]; };
  b.innerHTML = '<div class="mk-gh">В работе <i>· ' + work.length + '</i></div>' + work.map((r) => '<div class="mk-li mine"><span class="mk-pt"></span><span class="t">' + mk.esc(r.t) + '<small>взято сегодня · сдаётся отчёт</small></span><span class="mk-btn main">Сдать</span></div>').join('')
    + '<div class="mk-gh">На проверке <i>· ' + rev.length + '</i></div>' + merge(rev).map((r) => '<div class="mk-li"><span class="mk-pt"></span><span class="t">' + mk.esc(r.t) + (r.n > 1 ? '<span class="mk-n">×' + r.n + '</span>' : '') + '</span><span class="mk-chev">›</span></div>').join('');
} };

P.sluzhenie = { scene: 'sluzhenieUchastnik', helpers: HELPERS, css: FRAME + DOCK + `
.mk-th, .mk-tr { display:grid; grid-template-columns:18px 28px 1fr 34px 28px 44px 40px 32px; align-items:center; column-gap:5px }
.mk-th { height:38px; font-size:10px; color:var(--mk-muted); border-bottom:1px solid rgba(120,90,40,.4); align-items:end; padding-bottom:4px }
.mk-th span { text-align:right; display:flex; flex-direction:column; align-items:flex-end; gap:1px; line-height:1.1 } .mk-th span svg { width:13px; height:13px }
.mk-th span.l { text-align:left; grid-column:1 / 4; flex-direction:row; align-items:center; gap:6px; font-size:12px; align-self:center }
.mk-tr { height:40px; border-bottom:1px solid var(--mk-line); font-size:14px; font-variant-numeric:tabular-nums }
.mk-tr > span { text-align:right } .mk-tr .rk { text-align:right; color:var(--mk-muted); font-size:13px; padding-right:4px }
.mk-tr .nm { text-align:left; font-size:14.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; padding-left:4px }
.mk-tr .pts { font-weight:700; font-size:15px }
.mk-tr.me { background:rgba(91,47,140,.11); border-radius:6px; border-bottom-color:transparent }
.mk-av { position:relative; width:28px; height:28px }
.mk-av .avatar { width:28px !important; height:28px !important; font-size:12px !important; position:absolute; left:0; top:0 }
.mk-av .avatar.team { width:14px !important; height:14px !important; font-size:8px !important; left:auto; top:auto; right:-3px; bottom:-3px; box-shadow:0 0 0 1.5px var(--mk-paper); z-index:2 }
.mk-q { width:18px; height:18px; border-radius:50%; border:1px solid var(--mk-acc); color:var(--mk-acc); font-size:11px; display:inline-flex; align-items:center; justify-content:center }
`, js: async () => {
  const gid = location.pathname.split('/')[2]; const top = await fetch('/api/games/' + gid + '/top').then((r) => r.json()); const pts = new Map(top.rows.map((r) => [r.rank, r.deeds * 3 + r.tasks + r.cities * 2 + Math.ceil(r.verses / 5) + (r.trips || 0)]));
  const first = document.querySelector('.top-list li'); const icons = [...first.querySelectorAll('.chip')].map((c) => mk.svg(c, 13));
  const rows = [...document.querySelectorAll('.top-list li')].map((li) => { const c = [...li.querySelectorAll('.chip')].map((x) => mk.num(x.textContent)); const av = [...li.querySelectorAll(':scope > .avatar')]; const rank = mk.num(li.querySelector('.rank').textContent); return { rank, team: av[0] ? av[0].outerHTML : '', av: av[1] ? av[1].outerHTML : '', name: li.querySelector('.name').textContent.replace(' · это вы', '').trim(), me: li.classList.contains('me'), d: c[0], r: c[1], g: c[2], v: c[3], p: pts.get(rank) }; });
  const b = mk.frame({ active: 'Служение', tabs: [{ t: 'Рейтинг', on: true }, { t: 'Мои награды' }] });
  const tr = (x) => '<div class="mk-tr' + (x.me ? ' me' : '') + '"><span class="rk">' + x.rank + '</span><span class="mk-av">' + x.av + x.team + '</span><span class="nm">' + (x.me ? 'Вы' : mk.esc(x.name)) + '</span><span class="pts">' + x.p + '</span><span>' + x.d + '</span><span>' + x.r + '</span><span>' + x.g + '</span><span>' + x.v + '</span></div>';
  const me = rows.find((x) => x.me);
  b.innerHTML = '<div class="mk-th"><span class="l">все команды <b class="mk-q">?</b></span><span>очки</span><span>' + icons[0] + 'дела</span><span>' + icons[1] + 'районы</span><span>' + icons[2] + 'города</span><span>' + icons[3] + 'стихи</span></div>' + (me ? tr(me) : '') + rows.filter((x) => !x.me).map(tr).join('');
} };

P.nagrady = { helpers: HELPERS, css: FRAME + DOCK + `
.mk-streak { margin:10px 0 6px; border:1px solid rgba(120,90,40,.35); border-radius:12px; background:#fffaf0; padding:8px 12px }
.mk-s1 { height:44px; display:flex; align-items:center; gap:10px }
.mk-s1 img { width:36px; height:36px }
.mk-s1 b { font:700 24px Philosopher, serif } .mk-s1 .w { font-size:15px } .mk-s1 .r { margin-left:auto; font-size:13px; color:var(--mk-muted) }
.mk-s2 { height:34px; display:flex; align-items:center; gap:5px }
.mk-d { width:24px; height:24px; border-radius:50%; border:1.5px solid rgba(120,90,40,.4); font-size:10px; display:flex; align-items:center; justify-content:center; color:var(--mk-muted) }
.mk-d.ok { background:#d98324; border-color:#d98324; color:#fff } .mk-d.today { border:1.5px dashed #d98324; color:#b96a12 } .mk-d.future { opacity:.5 }
.mk-s2 .tx { margin-left:auto; font-size:12.5px; color:var(--mk-muted); white-space:nowrap }
.mk-s3 { font-size:13px; color:var(--mk-muted); padding-top:2px; display:flex; align-items:center; gap:6px }
.mk-s3 img { width:22px; height:22px }
.mk-ah { font-weight:700; font-size:14px; margin:8px 0 4px }
.mk-grid { display:grid; grid-template-columns:repeat(4, 1fr); gap:6px 4px }
.mk-grid .award { width:auto !important; height:auto !important; padding:0 !important; display:flex; flex-direction:column; align-items:center; gap:2px; background:none; border:0 }
.mk-grid .award-img, .mk-grid .award-img img { width:60px !important; height:60px !important }
.mk-grid .award-name { font-size:12px !important; line-height:1.15 !important; color:var(--mk-ink) !important; text-align:center; height:auto !important; width:auto !important }
`, js: () => {
  const card = document.querySelector('.streak-card'); const flame = card.querySelector('.streak-flame img'); const n = card.querySelector('.streak-count b').textContent.trim(); const best = mk.num(card.querySelector('.streak-best').textContent);
  const days = [...card.querySelectorAll('.streak-week .wd')].map((d) => ({ l: d.querySelector('.wd-label').textContent.trim(), cls: d.className, on: /done|ok|hit|on\b/.test(d.className + ' ' + d.querySelector('.wd-dot').className) }));
  const segs = card.querySelectorAll('.streak-segs i').length; const goal = card.querySelector('.streak-goal-badge img'); const head = document.querySelector('.award-head b').textContent; const grid = document.querySelector('.award-grid');
  const b = mk.frame({ active: 'Служение', tabs: [{ t: 'Рейтинг' }, { t: 'Мои награды', on: true }] });
  b.innerHTML = '<div class="mk-streak"><div class="mk-s1"><img src="' + flame.src + '"><b>' + n + '</b><span class="w">дней подряд</span><span class="r">рекорд ' + best + ' &nbsp;<b class="mk-q" style="width:18px;height:18px;border-radius:50%;border:1px solid var(--mk-acc);color:var(--mk-acc);font-size:11px;display:inline-flex;align-items:center;justify-content:center">?</b></span></div>'
    + '<div class="mk-s2">' + days.map((d) => '<span class="mk-d' + (d.on ? ' ok' : /today/.test(d.cls) ? ' today' : /future/.test(d.cls) ? ' future' : '') + '">' + (d.on ? '✓' : d.l) + '</span>').join('') + '<span class="tx">сегодня не засчитан</span></div>'
    + (goal ? '<div class="mk-s3"><img src="' + goal.src + '">до следующей награды — ' + segs + ' дней подряд</div>' : '') + '</div><div class="mk-ah">' + head + '</div>';
  const g = mk.h('<div class="mk-grid"></div>'); [...grid.children].sort((a, c) => (a.classList.contains('locked') || a.querySelector('.locked') ? 1 : 0) - (c.classList.contains('locked') || c.querySelector('.locked') ? 1 : 0)).forEach((a) => g.appendChild(a.cloneNode(true))); b.appendChild(g);
} };

P.ispytaniya = { helpers: HELPERS, css: FRAME + DOCK + `
.mk-li.tr { min-height:52px; align-items:center }
.mk-li.tr .t b { font-size:16px; font-weight:700 }
.mk-dots { display:inline-flex; gap:4px; margin-left:8px; vertical-align:middle }
.mk-dots i { width:8px; height:8px; border-radius:50%; background:#b9ab8f } .mk-dots i.ok { background:var(--mk-ok) } .mk-dots i.bad { background:var(--mk-bad) }
`, js: () => {
  const rows = [...document.querySelectorAll('.side-menu ul.list.interactive > li')].map((li) => ({ t: li.querySelector('.title').textContent.replace('Испытание · ', '').trim(), d: li.querySelector('.meta').textContent.trim(), res: (li.querySelector(':scope > .chip') || {}).textContent || '', steps: [...li.querySelectorAll('.trial-steps > li')].map((s) => (s.querySelector('.mark.ok') ? 'ok' : s.querySelector('.mark') ? 'bad' : s.classList.contains('done') ? 'ok' : '')) }));
  const b = mk.frame({ active: 'Испытания', tabs: [{ t: 'Оборона', n: rows.length, on: true }, { t: 'Вызовы', n: 5 }] });
  b.innerHTML = '<div class="mk-gh">Идут</div><div class="mk-empty">Сейчас никто не штурмует ваши города.</div><div class="mk-gh">Завершённые <i>· ' + rows.length + '</i></div>'
    + rows.map((r) => '<div class="mk-li tr"><span class="t"><b>' + mk.esc(r.t) + '</b><small>' + r.d + '<span class="mk-dots">' + r.steps.map((s) => '<i class="' + s + '"></i>').join('') + '</span></small></span><span class="s mk-ok">✓ ' + mk.esc(r.res) + '</span><span class="mk-chev">›</span></div>').join('');
} };

P.komandyRejting = { scene: 'komandy', helpers: HELPERS, css: FRAME + DOCK + `
.mk-th, .mk-tr { display:grid; grid-template-columns:20px 30px 1fr 46px 40px 76px; align-items:center; column-gap:4px }
.mk-th { height:28px; font-size:11px; color:var(--mk-muted); border-bottom:1px solid rgba(120,90,40,.4) } .mk-th span { text-align:right } .mk-th span.l { text-align:left; grid-column:1 / 4 }
.mk-tr { min-height:56px; border-bottom:1px solid var(--mk-line); font-size:15px; font-variant-numeric:tabular-nums; padding:6px 0; row-gap:1px }
.mk-tr .ln2 { grid-column:3 / 7; text-align:left !important; font-size:12.5px; color:var(--mk-muted); padding-left:4px; line-height:1.25 }
.mk-tr > span { text-align:right } .mk-tr .rk { color:var(--mk-muted); font-size:13px; padding-right:4px }
.mk-tr .nm { text-align:left; padding-left:4px; min-width:0; white-space:nowrap } .mk-tr .nm b { font-size:16px }
.mk-tr .avatar { width:28px !important; height:28px !important; font-size:12px !important }
.mk-tr .main { font-weight:700 }
.mk-tag { font-size:12px; font-weight:400; margin-left:6px }
.mk-note { font-size:13px; color:var(--mk-muted); padding:10px 0 }
`, js: () => {
  const rows = [...document.querySelectorAll('.standings-list > li.standing')].map((li) => { const c = [...li.querySelectorAll(':scope > .body > .meta.chips .chip')].map((x) => mk.num(x.textContent)); const tag = li.querySelector(':scope > .body > .name > .chip'); return { rank: li.querySelector('.rank').textContent.trim(), av: li.querySelector('.avatar.team').outerHTML, name: li.querySelector('.name .name').textContent.trim(), tag: tag ? tag.textContent.trim() : '', c }; });
  const b = mk.frame({ active: 'Команды', tabs: [{ t: 'Рейтинг', on: true }, { t: 'Состав' }, { t: 'Проходы' }, { t: 'Награды' }] });
  const col = { 'мы': 'mk-warn', 'мир': 'mk-ok', 'выбыла': 'mk-bad' };
  b.innerHTML = '<div class="mk-th"><span class="l">место по числу городов</span><span>города</span><span>дела</span><span>перекрёстки</span></div>' + rows.map((r) => '<div class="mk-tr"><span class="rk">' + r.rank + '</span><span>' + r.av + '</span><span class="nm"><b>' + mk.esc(r.name) + '</b></span><span class="main">' + r.c[1] + '</span><span>' + r.c[2] + '</span><span>' + r.c[3] + '</span><span class="ln2">' + (r.tag ? '<b class="' + (col[r.tag] || '') + '">' + ({ 'мы': 'наша команда', 'мир': 'у нас с ними мир', 'выбыла': 'выбыла' }[r.tag] || r.tag) + '</b> · ' : '') + r.c[0] + ' игроков · испытания: выиграли ' + r.c[4] + ', устояли ' + r.c[5] + ', проиграли ' + r.c[6] + '</span></div>').join('') + '<div class="mk-note">Состав команды и роли — на вкладке «Состав», запросы проходов — на вкладке «Проходы».</div>';
} };

P.komandySostav = { scene: 'komandy', helpers: HELPERS, css: FRAME + DOCK + `
.mk-li.pl { min-height:48px; padding:0 }
.mk-li.pl .avatar { width:32px !important; height:32px !important; flex:none }
.mk-li.pl .t { font-size:16px }
.mk-role { height:44px; display:inline-flex; align-items:center; gap:6px; font-size:14px; color:var(--mk-ink); flex:none }
.mk-role svg { width:16px; height:16px } .mk-role .ar { color:var(--mk-acc); font-size:12px }
.mk-role.cap { color:var(--mk-warn); font-weight:600 }
`, js: () => {
  const own = document.querySelector('.standings-list > li.standing'); const name = own.querySelector('.name .name').textContent.trim();
  const rows = [...own.querySelectorAll('ul.roster > li')].map((li) => { const btn = li.querySelector('.role-slot button'); return { av: li.querySelector('.avatar').outerHTML, name: li.querySelector('.name').textContent.trim(), role: btn ? (btn.getAttribute('aria-label') || '').trim() : '', icon: btn ? mk.svg(btn, 16) : '', dep: !!li.querySelector('.role-slot .star, .role-slot sup, .role-slot .deputy, .role-slot i') || /Участник 3$/.test(li.querySelector('.name').textContent.trim()) }; });
  const b = mk.frame({ active: 'Команды', tabs: [{ t: 'Рейтинг' }, { t: 'Состав', on: true }, { t: 'Проходы' }, { t: 'Награды' }] });
  b.innerHTML = '<div class="mk-gh">' + mk.esc(name) + ' <i>· ' + rows.length + ' игроков</i></div>' + rows.map((r) => { const cap = /капитан/i.test(r.role); return '<div class="mk-li pl">' + r.av + '<span class="t">' + mk.esc(r.name) + (r.dep && !cap ? '<small>заместитель капитана</small>' : '') + '</span><span class="mk-role' + (cap ? ' cap' : '') + '">' + r.icon + (cap ? 'Капитан' : mk.esc(r.role) + ' <span class="ar">▾</span>') + '</span></div>'; }).join('');
} };

P.rol = { helpers: HELPERS, css: BASE + `
.mk-scrim { position:absolute; inset:0; background:rgba(30,20,10,.45); z-index:60 }
.mk-sheet { position:absolute; left:0; right:0; bottom:0; z-index:61; background:var(--mk-paper); border-radius:14px 14px 0 0; padding:0 16px 10px; box-shadow:0 -6px 24px rgba(30,20,10,.3) }
.mk-sheet .mk-row { padding-left:0 }
.mk-opt { min-height:52px; display:flex; align-items:center; gap:12px; border-bottom:1px solid var(--mk-line) }
.mk-opt svg { width:22px; height:22px; flex:none }
.mk-opt .t b { display:block; font-size:16px } .mk-opt .t span { display:block; font-size:13px; color:var(--mk-muted); line-height:1.2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
.mk-opt .t { flex:1; min-width:0 }
.mk-radio { width:20px; height:20px; border-radius:50%; border:1.5px solid rgba(120,90,40,.6); flex:none; display:flex; align-items:center; justify-content:center }
.mk-opt.on .mk-radio { border-color:#7a4a16 } .mk-opt.on .mk-radio::after { content:''; width:10px; height:10px; border-radius:50%; background:#7a4a16 }
.role-tray { display:none !important }
`, js: () => {
  const short = { 'Разведчик': 'раз в неделю узнаёт, что за стороной', 'Пророк': 'раз в неделю — свеча и письмо-подсказка', 'Посол': 'проходы, ответы на запросы, мир', 'Летописец': 'сдаёт дела за команду, следит за фото', 'Кормчий': 'выбирает место высадки на другом острове', 'Воин': 'его стихи в испытаниях считаются вдвойне' };
  const opts = [...document.querySelectorAll('.role-tray .role-opt')].map((o) => ({ name: o.querySelector('.chip').textContent.trim(), icon: mk.svg(o.querySelector('.chip'), 22), on: o.classList.contains('on') }));
  const seen = new Set(); const list = opts.filter((o) => short[o.name] && !seen.has(o.name) && seen.add(o.name)).sort((a, c) => (c.on ? 1 : 0) - (a.on ? 1 : 0));
  const scr = document.querySelector('.map-screen'); scr.appendChild(mk.h('<div class="mk-scrim"></div>'));
  const sh = mk.h('<div class="mk mk-sheet"><div class="mk-row"><div class="mk-title">Роль: Участник 2</div><span class="mk-x">✕</span></div>' + list.map((o) => '<div class="mk-opt' + (o.on ? ' on' : '') + '">' + o.icon + '<span class="t"><b>' + o.name + '</b><span>' + (short[o.name] || '') + '</span></span><span class="mk-radio"></span></div>').join('') + '</div>'); scr.appendChild(sh);
} };

P.letopis = { helpers: HELPERS, prep: async (s) => { await s.p.locator('.side-menu button', { hasText: 'Показать ещё' }).first().click().catch(() => {}); await s.p.waitForTimeout(1500); }, css: FRAME + DOCK + `
.mk-day { height:28px; display:flex; align-items:flex-end; padding-bottom:4px; font-weight:700; font-size:12px; letter-spacing:.04em; text-transform:uppercase; color:var(--mk-muted); border-bottom:1px solid var(--mk-line) }
.mk-li.ev { align-items:flex-start; padding:7px 0; min-height:44px }
.mk-li.ev .ic { width:22px; height:22px; flex:none; display:flex; align-items:center; justify-content:center; color:var(--mk-acc) } .mk-li.ev .ic svg { width:16px; height:16px }
.mk-li.ev .t { font-size:15px } .mk-li.ev .tm { font-size:12px; color:var(--mk-muted); flex:none; padding-top:2px; font-variant-numeric:tabular-nums }
.mk-li.ev .mk-chev { padding-top:1px }
.mk-kids { padding:0 0 4px 32px; border-bottom:1px solid var(--mk-line) } .mk-kids div { font-size:13px; color:var(--mk-muted); line-height:1.5; display:flex; gap:8px } .mk-kids div span { margin-left:auto; flex:none }
`, js: () => {
  const ev = [...document.querySelectorAll('.side-menu ul.feed > li')].map((li) => { const b = li.querySelector('.body'); const link = b.querySelector('button.linkish'); const txt = (link || b.querySelector('span')).textContent.replace(/\s+/g, ' ').trim(); const meta = b.querySelector('.meta').textContent.trim(); const m = meta.match(/^(сегодня|вчера|\d+ [а-яё.]+),? ?(\d\d:\d\d)?/i) || []; return { ic: mk.svg(li.querySelector('.ico'), 16), txt, link: !!link, day: (m[1] || meta).replace(/^./, (c) => c.toUpperCase()), time: m[2] || '' }; });
  const b = mk.frame({ active: 'Летопись', title: 'Летопись' });
  let html = '', day = null; const out = [];
  ev.forEach((e) => { const sm = e.txt.match(/^(.+?) сдал\(а\) дело «(.+)» на проверку$/); const last = out[out.length - 1]; if (sm && last && last.who === sm[1] && last.day === e.day && last.kind === 'sub') { last.items.push({ t: sm[2], time: e.time }); } else out.push(sm ? { kind: 'sub', who: sm[1], day: e.day, ic: e.ic, time: e.time, items: [{ t: sm[2], time: e.time }] } : { kind: 'one', ...e }); });
  let opened = false;
  out.forEach((e) => { if (e.day !== day) { day = e.day; html += '<div class="mk-day">' + day + '</div>'; }
    if (e.kind === 'sub' && e.items.length > 1) { const open = !opened; opened = true; html += '<div class="mk-li ev" style="' + (open ? 'border-bottom:0' : '') + '"><span class="ic">' + e.ic + '</span><span class="t">' + mk.esc(e.who) + ' сдал на проверку ' + e.items.length + ' ' + (e.items.length < 5 ? 'дела' : 'дел') + '</span><span class="tm">' + e.items[e.items.length - 1].time + '–' + e.items[0].time + '</span><span class="mk-chev">' + (open ? '⌄' : '›') + '</span></div>'; if (open) html += '<div class="mk-kids">' + e.items.map((i) => '<div>«' + mk.esc(i.t.replace('[Книга]', 'Иакова')) + '»<span>' + i.time + '</span></div>').join('') + '</div>'; }
    else if (e.kind === 'sub') html += '<div class="mk-li ev"><span class="ic">' + e.ic + '</span><span class="t">' + mk.esc(e.who) + ': «' + mk.esc(e.items[0].t) + '» — на проверку</span><span class="tm">' + e.time + '</span><span class="mk-chev">›</span></div>';
    else html += '<div class="mk-li ev"><span class="ic">' + e.ic + '</span><span class="t">' + mk.esc(e.txt.replace(/\(а\)/g, '').replace(/\(ась\)/g, '')) + '</span><span class="tm">' + e.time + '</span>' + (e.link ? '<span class="mk-chev">›</span>' : '<span class="mk-chev"></span>') + '</div>'; });
  b.innerHTML = html;
} };

// ── Раздел B: карточка дела, форма сдачи, город ────────────────────────────────────────────────────
const SHEET = BASE + `
.overlay.deed-sheet, .overlay.city-sheet, .overlay.admin-popup { background:var(--mk-paper) !important; backdrop-filter:none !important; -webkit-backdrop-filter:none !important }
nav.team-dock, nav.admin-dock { visibility:hidden !important }
`;
const DEED = SHEET + `
.deed-sheet .overlay-head { padding:10px 8px 2px 16px !important; min-height:0 !important; height:auto !important }
.deed-sheet .sheet-title { display:block !important } .deed-sheet .sheet-title h2 { font-size:19px !important; line-height:1.2 !important }
.deed-sheet .sheet-title .chip { display:none !important }
.deed-sheet .overlay-body { padding:0 16px 12px !important }
.deed-sheet .overlay-body > * { display:none !important }
.deed-sheet .overlay-body > .mk { display:block !important; width:100%; max-width:100%; overflow:hidden }
.mk-state { font-size:13px; color:var(--mk-muted); display:flex; align-items:center; gap:6px; margin:2px 0 6px }
.mk-pill { font-size:12px; padding:1px 8px; border-radius:10px; background:#dbe8f4; color:#234a6b; font-weight:600 }
.mk-desc { font-size:15px; line-height:1.4; margin:0 0 8px }
.mk-more { color:var(--mk-acc); white-space:nowrap }
.mk-acts { display:flex; align-items:flex-start; gap:0; margin-top:6px; width:100% }
.mk-act { width:62px; display:flex; flex-direction:column; align-items:center; gap:3px; flex:none }
.mk-act .sq { width:48px; height:48px; border-radius:11px; border:1px solid rgba(120,90,40,.5); background:#fffaf0; display:flex; align-items:center; justify-content:center; box-shadow:0 1px 0 rgba(60,40,10,.15) }
.mk-act .sq svg { width:22px; height:22px; color:var(--mk-ink) } .mk-act .sq svg * { stroke:currentColor }
.mk-acts.four { display:grid; grid-template-columns:repeat(4, 1fr) } .mk-acts.four .mk-act { width:auto }
.mk-go.full { width:100%; margin:10px 0 0 }
.mk-act span { font-size:12px; line-height:1.15; color:var(--mk-muted); text-align:center }
.mk-what { display:flex; justify-content:flex-start; align-items:center; gap:6px; font-size:12px; color:var(--mk-muted); margin-top:8px }
`;
P.deloSvob = { helpers: HELPERS, css: DEED, js: () => {
  const sheet = document.querySelector('.deed-sheet'); const body = sheet.querySelector('.overlay-body'); const desc = sheet.querySelector('.deed-desc').textContent.trim();
  const acts = [...sheet.querySelectorAll('.deed-acts .sq-act')].map((a) => { const b = a.querySelector('.sq-btn'); return { label: b.getAttribute('aria-label'), icon: mk.svg(b, 22), n: (a.querySelector('.n, .badge, .count') || {}).textContent || '' }; });
  const names = { 'Посмотреть на карте': 'Карта', 'Поручить дело': 'Поручить', 'Отметить приоритетным': 'Приоритет', 'Снять приоритет': 'Приоритет', 'Вымостить дорогу': 'Вымостить', 'Разведать': 'Разведать' };
  const main = acts.find((a) => a.label === 'Взять дело'); const rest = acts.filter((a) => a !== main);
  const root = mk.h('<div class="mk"></div>');
  root.innerHTML = '<p class="mk-desc">' + mk.esc(desc) + '</p><div class="mk-what"><span class="mk-help1" style="width:20px;height:20px;font-size:11px">?</span>что делают кнопки</div><div class="mk-acts four">' + rest.map((a) => '<span class="mk-act"><span class="sq">' + a.icon + '</span><span>' + (names[a.label] || a.label) + (a.label === 'Вымостить дорогу' ? '<br>1 камень' : '') + '</span></span>').join('') + '</div>' + (main ? '<span class="mk-go full">' + main.icon + 'Взять дело</span>' : '');
  body.appendChild(root);
} };
P.deloSdacha = { helpers: HELPERS, css: DEED + `
.mk-lab { font-size:13px; color:var(--mk-muted); display:flex; align-items:baseline; gap:8px; margin:10px 0 4px }
.mk-lab b { color:var(--mk-ink); font-weight:600 } .mk-lab .req { color:var(--mk-bad) } .mk-lab a { margin-left:auto; color:var(--mk-acc); text-decoration:underline; font-size:13px }
.mk-wide { height:44px; border-radius:10px; border:1px solid rgba(120,90,40,.5); background:#fffaf0; display:flex; align-items:center; justify-content:center; gap:8px; font:600 15px Literata, serif; box-shadow:0 1px 0 rgba(60,40,10,.15) }
.mk-wide svg { width:18px; height:18px }
.mk-area { height:76px; border-radius:10px; border:1px solid rgba(120,90,40,.45); background:#fffdf6; padding:8px 10px; font-size:14px; color:#9a8a72; box-shadow:inset 0 1px 2px rgba(60,40,10,.12) }
.mk-line { height:44px; display:flex; align-items:center; border-bottom:1px solid var(--mk-line); border-top:1px solid var(--mk-line); margin-top:10px; font-size:15px }
.mk-line span { margin-left:auto; color:var(--mk-acc); font-size:14px }
.mk-drop { font-size:14px; color:var(--mk-muted); text-decoration:underline; align-self:center; margin-top:14px; white-space:nowrap }
.mk-links { display:flex; justify-content:space-between; margin-top:12px } .mk-links a { font-size:13px; color:var(--mk-muted); text-decoration:underline }
`, js: () => {
  const sheet = document.querySelector('.deed-sheet'); const body = sheet.querySelector('.overlay-body'); const desc = sheet.querySelector('.deed-desc').textContent.trim();
  const acts = [...sheet.querySelectorAll('.deed-acts .sq-act')].map((a) => { const b = a.querySelector('.sq-btn'); return { label: b.getAttribute('aria-label'), icon: mk.svg(b, 22) }; });
  const names = { 'Посмотреть на карте': 'Карта', 'Разведать': 'Разведать' };
  const link = mk.svg(sheet.querySelector('.link-add-btn'), 18); const send = mk.svg(sheet.querySelector('.deed-actions button:not(.secondary)'), 20);
  // Три первые строки описания и «ещё».
  const words = desc.split(' '); let cut = ''; for (const w of words) { if ((cut + ' ' + w).length > 118) break; cut += (cut ? ' ' : '') + w; }
  const root = mk.h('<div class="mk"></div>');
  root.innerHTML = '<div class="mk-state"><span class="mk-pill">в работе</span>· отчёт: фото</div><p class="mk-desc">' + mk.esc(cut) + '… <span class="mk-more">ещё</span></p>'
    + '<div class="mk-lab"><b>Фото или видео</b><span class="req">обязательно</span><a>Где взять ссылку?</a></div><div class="mk-wide">' + link + 'Вставить ссылку</div>'
    + '<div class="mk-lab"><b>Что сделали и для кого</b></div><div class="mk-area">Например: полдня помогали на кухне перед свадьбой — готовили и мыли посуду</div>'
    + '<div class="mk-line">Делали группой?<span>один · отметить участников ›</span></div>'
    + '<div class="mk-acts">' + acts.map((a) => '<span class="mk-act"><span class="sq">' + a.icon + '</span><span>' + (names[a.label] || a.label) + '</span></span>').join('') + '<span class="mk-go off" style="width:200px">' + send + 'Сдать на проверку</span></div><div class="mk-links"><a>Отпустить дело</a><a>Кодекс дела</a></div>';
  body.appendChild(root);
} };
// Город: шапка 60 px одной строкой слов, шаги 40 px.
const CITY = SHEET + `
.city-sheet .overlay-head, .city-sheet .city-head { height:64px !important; min-height:0 !important; padding-top:0 !important; padding-bottom:0 !important }
.city-sheet .city-head { background:#3b2a17 !important; background-image:none !important; align-items:center !important }
.city-sheet .city-head::before, .city-sheet .city-head::after { display:none !important }
.city-sheet .city-head img { width:44px !important; height:44px !important }
.city-sheet .city-head h2 { font-size:19px !important; line-height:1.1 !important }
.city-sheet .city-head .status { font-size:12.5px !important; line-height:1.25 !important; height:auto !important; white-space:pre-line }
.city-sheet .city-head h2 { margin:0 !important }
.city-sheet .city-head .status.visitors, .city-sheet .city-head .chip { display:none !important }
.city-sheet .city-head .title { height:auto !important }
.city-sheet .overlay-body { padding:0 16px 12px !important }
.city-sheet ol.steps { display:none !important }
.mk-steps { height:40px; display:flex; align-items:stretch; gap:18px; border-bottom:1px solid var(--mk-line); margin-bottom:8px }
.mk-step { display:flex; align-items:center; gap:6px; font-size:14px; color:var(--mk-muted); border-bottom:2px solid transparent }
.mk-step i { width:22px; height:22px; border-radius:50%; font-style:normal; font-size:12px; display:flex; align-items:center; justify-content:center; border:1.5px solid rgba(120,90,40,.5) }
.mk-step.done i { background:var(--mk-ok); border-color:var(--mk-ok); color:#fff }
.mk-step.cur { color:var(--mk-ink); font-weight:700; border-bottom-color:var(--mk-acc) }
`;
const cityHead = `(o) => { const st = document.querySelector('.city-sheet .city-head .status'); if (st && o.status) st.textContent = o.status; const steps = [...document.querySelectorAll('.city-sheet ol.steps li')].map((li, i) => ({ t: li.textContent.replace(/^\\d+/, '').trim(), done: li.classList.contains('done'), cur: li.classList.contains('current') })); const bar = mk.h('<div class="mk mk-steps">' + steps.map((x, i) => { const cur = o.cur != null ? i === o.cur : x.cur; const done = o.cur != null ? i < o.cur : x.done; return '<span class="mk-step' + (done ? ' done' : '') + (cur ? ' cur' : '') + '"><i>' + (done ? '✓' : i + 1) + '</i>' + x.t + '</span>'; }).join('') + '</div>'); const body = document.querySelector('.city-sheet .overlay-body'); if (!o.nosteps) body.insertBefore(bar, body.firstChild); return body; }`;
P.gorodSvoj = { helpers: HELPERS + 'window.mkCity = ' + cityHead + ';', css: CITY + `
.city-sheet .step-body > .capture { display:none !important }
.city-sheet .step-body { min-height:0 !important; height:auto !important; display:contents }
.city-sheet .step-body > .row.mt-2 { order:50; margin-top:10px !important }
.city-sheet .overlay-body { display:flex !important; flex-direction:column }
.city-sheet .step-body > .row.mt-2 button.secondary { height:36px !important; min-height:0 !important; font-size:14px !important; padding:0 12px !important }
.city-sheet details.disclose > summary { height:40px !important; min-height:0 !important; font-size:17px !important; font-weight:700 }
.city-sheet details.disclose .book-map-fold > summary { font-size:14px !important; font-weight:400 !important; height:36px !important }
.mk-passed { order:60; height:44px; display:flex; align-items:center; font-size:14px; color:var(--mk-muted); border-top:1px solid var(--mk-line); margin-top:8px }
.mk-passed span { margin-left:auto; color:var(--mk-acc); font-size:17px }
`, js: () => {
  const body = window.mkCity({ status: 'Ваш город', nosteps: true });
  document.querySelectorAll('.city-sheet .overlay-body > details.disclose').forEach((d) => { d.open = true; });
  body.appendChild(mk.h('<div class="mk mk-passed">Задания города пройдены: порядок, районы, конверт<span>›</span></div>'));
} };
P.gorodRajony = { helpers: HELPERS + 'window.mkCity = ' + cityHead + ';', css: CITY + `
.city-sheet .step-body > * { display:none !important }
.city-sheet .step-body > .mk { display:block !important }
.mk-score { font-size:14px; line-height:1.35; margin-bottom:4px }
.mk-seg { display:inline-flex; border:1px solid rgba(120,90,40,.45); border-radius:9px; overflow:hidden; font-size:13px; height:30px; margin:2px 0 4px }
.mk-seg span { padding:0 12px; display:flex; align-items:center } .mk-seg span.on { background:#7a4a16; color:#fff8ea }
.mk-li.dr { min-height:52px; padding:0 }
.mk-li.dr .t { font-size:16px; font-weight:700; -webkit-line-clamp:1 }
.mk-st { width:24px; height:24px; border-radius:50%; flex:none; display:flex; align-items:center; justify-content:center; font-size:13px; border:1.5px solid rgba(120,90,40,.5); color:transparent }
.mk-st.me { background:var(--mk-ok); border-color:var(--mk-ok); color:#fff } .mk-st.team { border-color:var(--mk-ok); color:var(--mk-ok) }
.mk-leg { font-size:12px; color:var(--mk-muted); display:flex; gap:12px; align-items:center; padding:6px 0 }
.mk-leg .mk-st { width:16px; height:16px; font-size:9px }
`, js: () => {
  const rows = [...document.querySelectorAll('.city-sheet ul.districts .district')].map((d) => { const ref = d.querySelector('.d-title .muted'); return { n: d.querySelector('.num').textContent.trim(), t: mk.own(d.querySelector('.d-title')), ref: ref ? ref.textContent.trim() : '', me: d.classList.contains('done'), team: d.classList.contains('team-done') }; });
  const mine = rows.filter((r) => r.me).length;
  window.mkCity({ status: 'Владеет: Живые камни\nШтурмует: Небесный легион', cur: 1 });
  const sb = document.querySelector('.city-sheet .step-body'); const root = mk.h('<div class="mk"></div>');
  root.innerHTML = '<div class="mk-score"><b>Ваш счёт: ' + mine + ' из ' + rows.length + '.</b> Решайте сами — это идёт в счёт для ключа. <b class="mk-help1" style="width:18px;height:18px;font-size:10px;vertical-align:1px">?</b></div><div class="mk-seg"><span class="on">Все ' + rows.length + '</span><span>Нерешённые ' + (rows.length - mine) + '</span></div>'
    + rows.map((r) => '<div class="mk-li dr"><span class="mk-st' + (r.me ? ' me' : r.team ? ' team' : '') + '">✓</span><span class="t">' + r.n + '. ' + mk.esc(r.t) + '</span><span class="s">' + r.ref + '</span><span class="mk-chev">›</span></div>').join('');
  sb.appendChild(root);
} };
P.gorodPoryadok = { helpers: HELPERS + 'window.mkCity = ' + cityHead + ';', css: CITY + `
.city-sheet .step-body > *, .city-sheet .overlay-body > details { display:none !important }
.city-sheet .step-body > .mk { display:block !important }
.mk-task { font-size:15px; font-weight:700; display:flex; align-items:center; gap:8px; margin-bottom:6px }
.mk-lock { background:#33271b; border-radius:12px; padding:2px 10px; color:#f3e7cf }
.mk-ring { min-height:52px; display:flex; align-items:center; gap:8px; border-bottom:1px solid rgba(243,231,207,.14) }
.mk-ring:last-child { border-bottom:0 }
.mk-ring .hd { width:28px; text-align:center; font-size:18px; color:#c9b48c; flex:none }
.mk-ring .no { width:22px; font-size:13px; color:#c9b48c; flex:none; text-align:right }
.mk-ring .t { flex:1; min-width:0; font-size:15px; font-weight:700; line-height:1.2 }
.mk-ring .ud { display:flex; gap:4px; flex:none } .mk-ring .ud span { width:34px; height:34px; border-radius:8px; background:rgba(243,231,207,.12); display:flex; align-items:center; justify-content:center; font-size:12px; color:#f3e7cf }
.mk-pin { position:absolute; left:0; right:0; bottom:0; padding:8px 16px 12px; background:var(--mk-paper); border-top:1px solid var(--mk-line); z-index:5 }
.mk-pin .mk-go { margin:0; width:100% }
`, js: () => {
  const rows = [...document.querySelectorAll('.city-sheet ol.rings li.ring')].map((r) => mk.own(r.querySelector('.cur')));
  window.mkCity({ status: 'Владеет: Живые камни', cur: 0 });
  const sb = document.querySelector('.city-sheet .step-body'); const root = mk.h('<div class="mk"></div>');
  root.innerHTML = '<div class="mk-task">Расставьте районы по порядку книги <b class="mk-help1" style="width:18px;height:18px;font-size:10px">?</b></div><div class="mk-lock">' + rows.map((t, i) => '<div class="mk-ring"><span class="hd">≡</span><span class="no">' + (i + 1) + '.</span><span class="t">' + mk.esc(t) + '</span><span class="ud"><span>▲</span><span>▼</span></span></div>').join('') + '</div>';
  sb.appendChild(root); const ov = document.querySelector('.city-sheet'); ov.appendChild(mk.h('<div class="mk mk-pin"><span class="mk-go">Проверить порядок</span></div>'));
} };
P.gorodKonvert = { helpers: HELPERS + 'window.mkCity = ' + cityHead + ';', css: CITY + `
.city-sheet .step-body > * { display:none !important }
.city-sheet .step-body > .mk { display:block !important }
.mk-cipher { height:96px; border-radius:12px; border:1px solid rgba(120,90,40,.4); background:#fffaf0; display:flex; align-items:center; gap:12px; padding:0 12px }
.mk-cipher .env { width:48px; height:48px; flex:none; position:relative } .mk-cipher .env .seal-wrap { transform:scale(.52); transform-origin:0 0; position:absolute; left:0; top:0 }
.mk-cipher .c { flex:1; min-width:0 } .mk-cipher .c small { display:block; font-size:13px; color:var(--mk-muted) } .mk-cipher .c b { font:700 20px Philosopher, serif; letter-spacing:1.5px; white-space:nowrap }
.mk-kline { height:44px; display:flex; align-items:center; border-bottom:1px solid var(--mk-line); font-size:15px }
.mk-cnt { font-size:14px; line-height:1.35; padding:8px 0 2px }
.mk-todo { margin:6px 0 0; padding:0; list-style:none; counter-reset:n } .mk-todo li { font-size:14px; line-height:1.3; padding:5px 0 5px 24px; position:relative; counter-increment:n } .mk-todo li::before { content:counter(n) '.'; position:absolute; left:0; font-weight:700 }
.mk-keyrow { display:flex; gap:8px; align-items:center; margin-top:10px }
.mk-key { flex:1; height:44px; border-radius:10px; border:1px solid rgba(120,90,40,.45); background:#fffdf6; box-shadow:inset 0 1px 2px rgba(60,40,10,.12); display:flex; align-items:center; padding:0 12px; font-size:14px; color:#9a8a72 }
`, js: () => {
  const cipher = document.querySelector('.city-sheet .cipher-text').textContent.trim(); const seal = document.querySelector('.city-sheet .envelope .seal-wrap');
  window.mkCity({ status: 'Свободный город', cur: 2 });
  const sb = document.querySelector('.city-sheet .step-body'); const root = mk.h('<div class="mk"></div>');
  root.innerHTML = '<div class="mk-cipher"><span class="env"></span><span class="c"><small>Шифр для адресата</small><b>' + cipher + '</b></span><span class="mk-btn sm">Скопировать</span></div>'
    + '<div class="mk-kline">Кому: «Адресат 7» (семья)</div>'
    + '<div class="mk-cnt">Свою часть заданий решили 5 участников из 10 — для ключа достаточно. <b>Вы: всё решено.</b></div>'
    + '<div class="mk-gh" style="margin-top:6px">Что делать</div><ol class="mk-todo"><li>Договоритесь с семьёй о времени.</li><li>В гостях помолитесь вместе; привезите гостинец или помогите по дому.</li><li>Назовите шифр — получите конверт с ключом.</li><li>Капитан в тот же день сдаёт отчёт с фото.</li></ol>'
    + '<div class="mk-keyrow"><span class="mk-key">Ключ из конверта, 4–6 знаков</span><span class="mk-go off" style="margin:0;height:44px;font-size:15px">Сломать печать</span></div>';
  sb.appendChild(root); if (seal) root.querySelector('.env').appendChild(seal.cloneNode(true));
} };
P.zadanie = { helpers: HELPERS + 'window.mkCity = ' + cityHead + ';', prep: async (s) => { const p = s.p; const opts = []; for (let i = 0; i < 4; i++) { opts.push((await p.locator('.city-sheet .answer .drum .cur').first().innerText()).trim()); await p.locator('.city-sheet .answer .ring .turn').last().click().catch(() => {}); await p.waitForTimeout(350); } await p.evaluate((o) => { window.mkOpts = o; }, [...new Set(opts)]); }, css: CITY + `
.city-sheet .task-view > * { display:none !important }
.city-sheet .task-view > .mk { display:block !important }
.mk-back { height:40px; display:flex; align-items:center; gap:10px; font-size:14px; color:var(--mk-acc); border-bottom:1px solid var(--mk-line); margin-bottom:8px }
.mk-back b { color:var(--mk-ink); font-size:15px; flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis } .mk-back span { color:var(--mk-muted); font-size:13px; white-space:nowrap }
.mk-q1 { font-size:17px; line-height:1.4; margin:0 0 10px }
.mk-ans { min-height:48px; display:flex; align-items:center; gap:12px; border:1px solid rgba(120,90,40,.4); border-radius:10px; padding:0 12px; margin-bottom:8px; background:#fffaf0; font-size:16px }
.mk-ans.on { border-color:#7a4a16; box-shadow:inset 0 0 0 1px #7a4a16 }
.mk-ans .mk-radio { width:20px; height:20px; border-radius:50%; border:1.5px solid rgba(120,90,40,.6); flex:none; display:flex; align-items:center; justify-content:center }
.mk-ans.on .mk-radio::after { content:''; width:10px; height:10px; border-radius:50%; background:#7a4a16 }
.mk-foot { display:flex; align-items:center; gap:12px; margin-top:4px } .mk-foot a { font-size:13px; color:var(--mk-acc); text-decoration:underline }
.mk-foot .mk-go { margin-left:auto }
.mk-note2 { font-size:13px; color:var(--mk-muted); margin-top:10px; line-height:1.35 }
`, js: () => {
  const h = document.querySelector('.city-sheet .task-view h3').textContent.trim(); const parts = h.split(' · '); const q = document.querySelector('.city-sheet .prompt').textContent.trim(); const opts = window.mkOpts || [];
  window.mkCity({ status: 'Владеет: Живые камни\nШтурмует: Небесный легион', nosteps: true });
  const tv = document.querySelector('.city-sheet .task-view'); const root = mk.h('<div class="mk"></div>');
  root.innerHTML = '<div class="mk-back">‹ К районам <b>' + mk.esc(parts.slice(0, 2).join(' · ').replace('Район ', '')) + '</b><span>' + (parts[2] || '') + ' · пересказ ›</span></div><p class="mk-q1">' + mk.esc(q) + '</p>'
    + opts.map((o, i) => '<div class="mk-ans' + (i === 0 ? ' on' : '') + '"><span class="mk-radio"></span>' + mk.esc(o) + '</div>').join('')
    + '<div class="mk-foot"><a>Ошибка в задании?</a><span class="mk-go">Ответить</span></div><div class="mk-note2">Команда это задание уже решила. Решите сами — оно пойдёт в ваш счёт для ключа.</div>';
  tv.appendChild(root);
} };

require('./patchesC.cjs')(P, { HELPERS, BASE, SHEET });
require('./patchesFix.cjs')(P, { HELPERS, BASE, FRAME, DOCK, SHEET });
require('./patchesFix2.cjs')(P);
require('./patchesFix3.cjs')(P);
module.exports = P;
