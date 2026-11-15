// Раздел C: администратор и страницы вне карты. Подключается из patches.cjs.
module.exports = (P, { HELPERS, BASE, SHEET }) => {
const ADMIN = SHEET + `
.admin-popup .overlay-head { display:none !important }
.admin-popup .overlay-body { padding:0 !important; overflow:hidden !important }
.admin-popup .overlay-body > * { display:none !important }
.admin-popup .overlay-body > .mk { display:block !important }
.mk-sel { height:34px; border-radius:9px; border:1px solid rgba(120,90,40,.45); background:#fffdf6; display:inline-flex; align-items:center; gap:5px; padding:0 8px; font-size:13px; white-space:nowrap }
.mk-sel::after { content:'▾'; color:var(--mk-acc); font-size:12px }
.mk-sel.plain::after { content:none }
.mk-frow { display:flex; gap:6px; align-items:center; padding:8px 16px; border-bottom:1px solid var(--mk-line) }
.mk-frow .r { margin-left:auto; font-size:13.5px; color:var(--mk-acc) }
`;
P.aProverka = { helpers: HELPERS, css: ADMIN + `
.mk-card { padding:9px 16px 10px; border-bottom:1px solid var(--mk-line) }
.mk-c1 { height:20px; display:flex; align-items:center; gap:6px; font-size:13px; color:var(--mk-muted) } .mk-c1 .avatar { width:18px !important; height:18px !important } .mk-c1 .k { margin-left:auto }
.mk-c2 { font-size:16px; font-weight:700; line-height:1.25; margin:3px 0 } .mk-c2 i { font-style:normal; font-weight:400; color:var(--mk-acc); font-size:14px; margin-left:4px }
.mk-c3 { font-size:15px; line-height:1.3; border-left:3px solid rgba(120,90,40,.35); padding-left:8px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden }
.mk-c4 { display:flex; align-items:center; gap:5px; margin-top:8px }
.mk-c4 .mk-btn.sm { padding:0 9px; height:34px; font-size:13px }
.admin-popup .overlay-body > .mk { width:100%; max-width:390px; overflow:hidden }
.mk-att { height:34px; padding:0 7px; border-radius:9px; border:1px solid rgba(120,90,40,.45); background:#fffaf0; font-size:12.5px; display:inline-flex; align-items:center; gap:4px; white-space:nowrap } .mk-att svg { width:15px; height:15px }
.mk-c4 .sp { flex:1 }
`, js: () => {
  const items = [...document.querySelectorAll('.admin-popup li.review-item')].map((li) => { const meta = li.querySelector('.meta').textContent.replace(/\s+/g, ' '); const side = [...li.querySelectorAll('.side > *')]; const rep = li.querySelector('.report'); return { team: li.querySelector('.person .name').textContent.trim(), av: li.querySelector('.avatar.team').outerHTML, title: li.querySelector('.title').textContent.trim(), kind: (meta.match(/^\s*(фото|видео|аудио|отчёт)/) || ['', ''])[1], who: (meta.match(/·\s*([^·]+?)\s*·\s*взято/) || ['', ''])[1].trim(), ago: (meta.match(/(\d+ (?:ч|мин|дн)\.?[^·]*?назад)/) || [''])[0], report: rep ? mk.own(rep) : '', nLinks: side.filter((x) => x.tagName === 'A').length, mapIcon: mk.svg(side[0], 15), camIcon: mk.svg(side.find((x) => x.tagName === 'A'), 15) }; });
  const body = document.querySelector('.admin-popup .overlay-body'); const root = mk.h('<div class="mk"></div>');
  root.innerHTML = '<div class="mk-row"><div class="mk-tabs"><span class="mk-tab on">Дела<i>' + items.length + '</i></span><span class="mk-tab">Корабли<i>0</i></span><span class="mk-tab">Возвращённые</span></div><span class="mk-x">✕</span></div>'
    + '<div class="mk-frow"><span class="mk-sel">Все команды</span><span class="mk-sel">Любой вид</span><span class="mk-sel plain">↑ старые</span><span class="r">Выбрать</span></div>'
    + items.map((it) => '<div class="mk-card"><div class="mk-c1">' + it.av + mk.esc(it.team) + ' · ' + mk.esc(it.who) + ' · ' + it.ago + '<span class="k">' + it.kind + '</span></div><div class="mk-c2">' + mk.esc(it.title) + '<i>ⓘ</i></div>' + (it.report ? '<div class="mk-c3">' + mk.esc(it.report) + '</div>' : '') + '<div class="mk-c4">' + Array.from({ length: it.nLinks }, (_, i) => '<span class="mk-att">' + (i === 0 ? it.camIcon + (it.kind === 'видео' ? 'Видео' : it.kind === 'аудио' ? 'Запись' : 'Фото') + (it.nLinks > 1 ? ' 1' : '') : String(i + 1)) + '</span>').join('') + '<span class="mk-att">' + it.mapIcon + 'Карта</span><span class="sp"></span><span class="mk-btn sm">Вернуть</span><span class="mk-btn sm main">Принять</span></div></div>').join('');
  body.appendChild(root);
} };
P.aDela = { helpers: HELPERS, css: ADMIN + `
.mk-search { height:36px; flex:1; min-width:0; border:1px solid rgba(120,90,40,.4); border-radius:9px; background:#fffdf6; display:flex; align-items:center; padding:0 10px; font-size:14px; color:#9a8a72; gap:8px; white-space:nowrap }
.mk-d { padding:8px 8px 8px 16px; border-bottom:1px solid var(--mk-line); display:flex; align-items:center; gap:8px; min-height:60px }
.mk-d .t { flex:1; min-width:0 } .mk-d .t b { display:block; font-size:15.5px; line-height:1.25; font-weight:700 } .mk-d .t small { display:block; font-size:12.5px; color:var(--mk-muted); line-height:1.3; margin-top:2px }
.mk-d.off .t > b { color:var(--mk-muted) }
.mk-ed { width:40px; height:40px; border-radius:9px; display:flex; align-items:center; justify-content:center; flex:none; color:var(--mk-acc) } .mk-ed svg { width:17px; height:17px }
`, js: () => {
  const kindW = { 'видео': 'сдаётся видео', 'фото': 'сдаётся фото', 'отчёт': 'сдаётся текст', 'аудио': 'сдаётся запись', 'свидетель': 'нужен свидетель' };
  const rows = [...document.querySelectorAll('.admin-popup li.deed-row')].map((li) => { const spans = [...li.querySelectorAll('.meta > span')].map((x) => x.textContent.replace(/\s+/g, ' ').trim()); const om = li.querySelector('.on-map'); const nums = om ? om.textContent.replace(/[^0-9 ]/g, ' ').trim().split(/\s+/).map(Number) : []; return { t: mk.own(li.querySelector('.title')), kind: spans[0] || '', pct: (spans[1] || '').replace('· ', '').replace(' %', '%'), free: nums[0], taken: nums[1], off: li.classList.contains('off'), pen: mk.svg(li.querySelector('.side > button.icon:not(.deed-chev)'), 17) }; });
  const total = mk.num((document.querySelector('.admin-popup .card-head .count') || {}).textContent) || rows.length;
  const body = document.querySelector('.admin-popup .overlay-body'); const root = mk.h('<div class="mk"></div>');
  root.innerHTML = '<div class="mk-row"><div class="mk-tabs"><span class="mk-tab on">Дела на суше<i>' + total + '</i></span><span class="mk-tab">Разбитый корабль<i>0</i></span></div><span class="mk-x">✕</span></div>'
    + '<div class="mk-frow"><span class="mk-search">⌕ Найти дело</span><span class="mk-sel">Все</span><span class="mk-btn sm main">+ Дело</span></div>'
    + rows.map((r) => '<div class="mk-d' + (r.off ? ' off' : '') + '"><span class="t"><b>' + mk.esc(r.t) + '</b><small>' + (r.off ? '<b class="mk-warn">выключено</b> · ' : '') + (kindW[r.kind] || r.kind) + ' · выпадает: ' + r.pct + (r.free != null && !isNaN(r.free) ? ' · на картах: ' + r.free + ' свободно, ' + r.taken + ' в работе' : '') + '</small></span><span class="mk-ed">' + r.pen + '</span></div>').join('');
  body.appendChild(root);
} };
P.novoe = { helpers: HELPERS, css: BASE + `
main.container .how-to > * { display:none !important }
main.container .how-to > .mk { display:block !important }
.mk-h { display:flex; align-items:center; gap:10px; height:44px } .mk-h b { font:700 22px Philosopher, serif } .mk-h span { color:var(--mk-acc); font-size:20px }
.mk-date { border:1px solid rgba(120,90,40,.3); border-radius:12px; background:rgba(255,250,236,.8); padding:4px 14px 8px; margin-top:8px }
.mk-date h3 { font:700 16px Philosopher, serif; margin:8px 0 4px }
.mk-it { padding:7px 0; border-top:1px solid var(--mk-line); font-size:15px; line-height:1.35 } .mk-date h3 + .mk-it { border-top:0 }
.mk-it a { color:var(--mk-acc); font-size:13px; white-space:nowrap }
.mk-fold { height:48px; display:flex; align-items:center; border:1px solid rgba(120,90,40,.3); border-radius:12px; background:rgba(255,250,236,.8); padding:0 14px; margin-top:8px; font-size:15px } .mk-fold b { font-family:Philosopher, serif; font-size:16px } .mk-fold i { font-style:normal; color:var(--mk-muted); font-size:13px; margin-left:8px } .mk-fold span { margin-left:auto; color:var(--mk-acc); font-size:17px }
.mk-moreb { display:flex; justify-content:center; margin-top:12px }
`, js: () => {
  const secs = [...document.querySelectorAll('main.container .how-to > section.card')].map((sec) => ({ d: sec.querySelector('h2').textContent.replace(' г.', '').trim(), items: [...sec.querySelectorAll('ul.changelog > li')].map((li) => li.textContent.trim()) }));
  const root = mk.h('<div class="mk"></div>'); const short = (t) => { const i = t.indexOf(':'); const head = i > 0 && i < 40 ? t.slice(0, i) : ''; let rest = head ? t.slice(i + 1).trim() : t; const dot = rest.search(/[.!?](\s|$)/); let one = dot > 20 ? rest.slice(0, dot + 1) : rest; if (one.length > 110) one = one.slice(0, 107).replace(/\s+\S*$/, '') + '…'; return (head ? '<b>' + mk.esc(head) + '.</b> ' : '') + mk.esc(one.charAt(0).toUpperCase() + one.slice(1)); };
  const plural = (n) => n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? 'изменение' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'изменения' : 'изменений');
  const first = secs[0]; const shown = first.items.slice(0, 6);
  root.innerHTML = '<div class="mk-h"><span>‹</span><b>Что нового</b></div><div class="mk-date"><h3>' + first.d + '</h3>' + shown.map((t) => '<div class="mk-it">' + short(t) + ' <a>подробнее ›</a></div>').join('') + (first.items.length > 6 ? '<div class="mk-it" style="color:var(--mk-acc)">ещё ' + (first.items.length - 6) + ' ›</div>' : '') + '</div>'
    + secs.slice(1, 3).map((x) => '<div class="mk-fold"><b>' + x.d + '</b><i>' + plural(x.items.length) + '</i><span>›</span></div>').join('') + '<div class="mk-moreb"><span class="mk-btn">Показать раньше</span></div>';
  document.querySelector('main.container .how-to').appendChild(root);
} };
P.spisok = { helpers: HELPERS, css: BASE + `
main.container > * { display:none !important }
main.container > .mk { display:flex !important; flex-direction:column }
main.container > nav.home-social { display:flex !important; position:fixed; left:16px; right:16px; bottom:14px; justify-content:space-between; border-top:1px solid var(--mk-line); padding-top:10px; height:auto !important }
nav.home-social .social-help { display:none !important }
nav.home-social .social-item { display:flex !important; align-items:center; gap:6px; width:auto !important; height:auto !important; font:13px Literata, serif; color:var(--mk-ink) }
nav.home-social .social-tile { width:30px !important; height:30px !important; min-height:0 !important }
.mk-h2 { font:700 20px Philosopher, serif; margin:4px 0 8px }
.mk-game { height:64px; display:flex; align-items:center; gap:10px; border:1px solid rgba(120,90,40,.3); border-radius:12px; background:rgba(255,250,236,.85); padding:0 14px; margin-bottom:8px }
.mk-game b { font-size:18px; font-family:Philosopher, serif } .mk-game small { font-size:13px; color:var(--mk-muted); margin-left:4px } .mk-game .st { margin-left:auto; font-size:13px; color:var(--mk-ok) } .mk-game .mk-chev { margin-left:8px }
.mk-two { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:6px } .mk-two { grid-template-columns:.85fr 1.15fr !important } .mk-two .mk-btn { height:44px; justify-content:center; padding:0 4px; font-size:13.5px; white-space:nowrap }
.mk-tl { display:flex; gap:22px; justify-content:center; margin-top:16px; font-size:15px; color:var(--mk-acc) } .mk-tl a { text-decoration:underline }
.mk-soc { margin-top:auto; display:flex; justify-content:space-between; gap:8px; padding:12px 0 4px; border-top:1px solid var(--mk-line) } .mk-soc span { display:flex; align-items:center; gap:6px; font-size:13px; color:var(--mk-ink) } .mk-soc svg, .mk-soc img { width:20px !important; height:20px !important }
`, js: () => {
  const games = [...document.querySelectorAll('.home-card.game-card')].map((c) => ({ n: c.querySelector('.name').textContent.trim(), st: (c.querySelector('.chip') || {}).textContent || '', meta: c.querySelector('.meta').textContent.trim() }));
  const names = ['Канал игры', '«В начале было Слово»', 'Instagram']; [...document.querySelectorAll('nav.home-social .social-item')].forEach((it, i) => { it.appendChild(document.createTextNode(names[i] || '')); });
  const root = mk.h('<div class="mk"></div>');
  root.innerHTML = '<div class="mk-h2">Мои игры</div>' + games.map((g) => '<div class="mk-game"><b>' + mk.esc(g.n) + '</b><small>' + mk.esc(g.meta) + '</small><span class="st">' + mk.esc(g.st) + '</span><span class="mk-chev">›</span></div>').join('')
    + '<div class="mk-two"><span class="mk-btn main">+ Создать игру</span><span class="mk-btn">Войти по приглашению</span></div><div class="mk-tl"><a>Как играть?</a><a>Что нового</a></div>';
  document.querySelector('main.container').appendChild(root);
} };
P.vhod = { scene: 'vhodAvto', helpers: HELPERS, css: BASE + `
.mk-intro { height:44px; border-radius:10px; border:1px solid rgba(120,90,40,.5); background:#fffaf0; display:flex; align-items:center; justify-content:center; gap:8px; font:600 15px Literata, serif; margin:12px 0 4px; box-shadow:0 1px 0 rgba(60,40,10,.15) }
`, js: async () => {
  const x = [...document.querySelectorAll('button[aria-label="Закрыть"]')].find((b) => b.offsetParent); if (x) x.click(); await new Promise((r) => setTimeout(r, 800));
  const fp = [...document.querySelectorAll('a, button')].find((e) => /Забыли пароль/.test(e.textContent));
  const b = mk.h('<div class="mk mk-intro">▶ Об игре · ролик 2 минуты</div>'); if (fp && fp.parentElement) fp.parentElement.parentElement.insertBefore(b, fp.parentElement.nextSibling);
  const top = [...document.querySelectorAll('a, button')].find((e) => e.textContent.trim() === 'О игре'); if (top) top.style.display = 'none';
} };
};
