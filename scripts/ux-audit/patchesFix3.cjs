// Правки по третьей независимой сверке (14.11): обрезанное название района и средние замечания.
module.exports = (P) => {
const chain = (name, fn, css) => { const p = P[name]; const prev = p.post; p.post = eval('(async () => { ' + (prev ? 'await (' + prev.toString() + ')(); ' : '') + 'await (' + fn.toString() + ')(); })'); if (css) p.css += css; };

// Районы: название переносится на вторую строку, а не обрезается.
chain('gorodRajony', () => { document.querySelectorAll('.mk-li.dr .t').forEach((t) => { t.style.cssText = 'display:block;-webkit-line-clamp:unset;overflow:visible;white-space:normal'; }); }, `\n.mk-li.dr { padding:6px 0 !important; align-items:center }\n.mk-li.dr .t { line-height:1.2 !important }\n`);

// Свободные дела: метка моря — словами.
chain('delaSvobodnye', () => { document.querySelectorAll('.mk-tags').forEach((t) => { t.innerHTML = t.innerHTML.replace(/морем: (\d+)/, (m, n) => 'из них морем, на корабле: ' + n); }); });

// Рейтинг игроков: значок команды читается.
chain('sluzhenie', () => {}, `\n.mk-av .avatar.team { width:18px !important; height:18px !important; font-size:11px !important; right:-8px !important; bottom:-5px !important }\n.mk-th, .mk-tr { grid-template-columns:14px 28px 1fr 34px 30px 48px 44px 36px !important; column-gap:4px !important }\n.mk-tr .nm { white-space:nowrap !important; padding-left:6px !important }\n`);

// Рейтинг команд: название в одну строку, под ним числа со словами.
P.komandyRejting.js = () => {
  const rows = [...document.querySelectorAll('.standings-list > li.standing')].map((li) => { const c = [...li.querySelectorAll(':scope > .body > .meta.chips .chip')].map((x) => mk.num(x.textContent)); const tag = li.querySelector(':scope > .body > .name > .chip'); return { rank: li.querySelector('.rank').textContent.trim(), av: li.querySelector('.avatar.team').outerHTML, name: li.querySelector('.name .name').textContent.trim(), tag: tag ? tag.textContent.trim() : '', c }; });
  const b = mk.frame({ active: 'Команды', tabs: [{ t: 'Рейтинг', on: true }, { t: 'Состав' }, { t: 'Проходы' }, { t: 'Награды' }] });
  const pl = (n, a, b2, c) => n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b2 : c);
  const col = { 'мы': 'mk-warn', 'мир': 'mk-ok', 'выбыла': 'mk-bad' }; const word = { 'мы': 'наша команда', 'мир': 'у нас с ними мир', 'выбыла': 'выбыла' };
  b.innerHTML = '<div class="mk-cap">Место — по числу городов</div>' + rows.map((r) => '<div class="mk-tm"><span class="rk">' + r.rank + '</span>' + r.av + '<span class="bd"><b>' + mk.esc(r.name) + '</b>' + (r.tag ? '<i class="' + (col[r.tag] || '') + '">' + (word[r.tag] || r.tag) + '</i>' : '') + '<span class="nums"><b>' + pl(r.c[1], 'город', 'города', 'городов') + '</b> · ' + pl(r.c[2], 'дело', 'дела', 'дел') + ' · ' + pl(r.c[3], 'перекрёсток', 'перекрёстка', 'перекрёстков') + '</span><small>' + pl(r.c[0], 'игрок', 'игрока', 'игроков') + ' · испытания: выиграли ' + r.c[4] + ', устояли ' + r.c[5] + ', проиграли ' + r.c[6] + '</small></span><span class="mk-chev">›</span></div>').join('');
};
P.komandyRejting.css += `
.mk-cap { height:30px; display:flex; align-items:center; font-size:12.5px; color:var(--mk-muted); border-bottom:1px solid rgba(120,90,40,.4) }
.mk-tm { display:flex; align-items:flex-start; gap:8px; padding:9px 0; border-bottom:1px solid var(--mk-line) }
.mk-tm .rk { width:16px; text-align:right; color:var(--mk-muted); font-size:13px; padding-top:5px; flex:none }
.mk-tm .avatar { width:30px !important; height:30px !important; font-size:13px !important; flex:none }
.mk-tm .bd { flex:1; min-width:0 } .mk-tm .bd > b { font-size:17px } .mk-tm .bd > i { font-style:normal; font-size:12.5px; margin-left:8px; font-weight:600 }
.mk-tm .nums { display:block; font-size:13.5px; line-height:1.4; font-variant-numeric:tabular-nums; white-space:nowrap } .mk-tm .nums b { font-size:15px } .mk-tm small { display:block; font-size:12.5px; color:var(--mk-muted); line-height:1.3 }
.mk-tm .mk-chev { padding-top:6px }
`;

// Проверка: «Описание» — ссылкой со словом.
chain('aProverka', () => { document.querySelectorAll('.mk-card').forEach((c) => { const i = c.querySelector('.mk-c2 i'); if (i) i.remove(); const b = c.querySelector('.mk-c1b'); if (b) { b.style.cssText = 'display:flex;align-items:center;gap:8px'; b.appendChild(mk.h('<a style="margin-left:auto;color:var(--mk-acc);text-decoration:underline;white-space:nowrap;height:28px;display:flex;align-items:center">Описание</a>')); } }); });

// Дела администратора: сведения переносятся только между частями, шрифт 13 px.
chain('aDela', () => { document.querySelectorAll('.mk-d .t small').forEach((sm) => { const off = sm.querySelector('b'); const txt = sm.textContent.replace(/^выключено\s*·\s*/, ''); const parts = txt.split(' · ').map((x) => x.trim()).filter(Boolean); sm.innerHTML = (off ? '<b class="mk-warn">выключено</b> · ' : '') + parts.map((x) => '<span style="white-space:nowrap">' + x + '</span>').join(' · '); }); }, `\n.mk-d .t small { font-size:13px !important; line-height:1.35 !important }\n`);

// «Что нового»: «подробнее» — отдельной строкой с нормальной зоной нажатия.
chain('novoe', () => {}, `\n.mk-it a { display:block !important; height:32px; line-height:32px; padding:0 !important; font-size:13.5px !important }\n`);

// «Мои игры»: игра — самое заметное на экране; вход по приглашению — вторая кнопка.
chain('spisok', () => {
  const two = document.querySelector('.mk-two'); two.innerHTML = '<span class="mk-btn" style="height:46px;justify-content:center;font-size:15px">Войти по приглашению</span>';
  const tl = document.querySelector('.mk-tl'); tl.innerHTML = '<a>+ Создать игру</a><a>Как играть?</a><a>Что нового</a>';
  document.querySelectorAll('.mk-game').forEach((g) => { g.appendChild(mk.h('<span class="mk-btn main sm" style="margin-left:10px">Открыть</span>')); const ch = g.querySelector('.mk-chev'); if (ch) ch.remove(); });
}, `\n.mk-game { height:76px !important; background:#fffaf0 !important; border-color:rgba(120,90,40,.5) !important; box-shadow:0 2px 8px rgba(60,40,10,.14) } .mk-game b { font-size:21px !important } .mk-game .st { margin-left:auto; font-weight:600 }\n.mk-tl { gap:16px !important; font-size:14.5px !important } .mk-tl a { height:40px; display:flex; align-items:center }\n`);
};
