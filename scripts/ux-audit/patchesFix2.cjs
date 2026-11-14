// Правки по второй независимой сверке (14.11): серьёзное замечание по листу ролей и средние по остальным макетам.
module.exports = (P) => {
// К уже заданной перестройке добавляется ещё один шаг (выполняется после неё, в браузере).
const chain = (name, fn, css) => { const p = P[name]; const prev = p.post; p.post = eval('(async () => { ' + (prev ? 'await (' + prev.toString() + ')(); ' : '') + 'await (' + fn.toString() + ')(); })'); if (css) p.css += css; };

// Шапка одинакова на всех макетах: колокольчик и стрелка у названия команды — и на листах дела и города.
const HUD_CSS = `\n.hud-team::after { content:'›'; margin-left:6px; color:var(--mk-acc); font-size:16px }\n.hud-right { display:flex !important; gap:8px !important; align-items:center }\n.mk-bell { width:44px !important; height:44px !important; padding:0 !important } .mk-bell svg { width:20px; height:20px }\n`;
const hud = () => { const dockBtn = [...document.querySelectorAll('.dock-btn')].find((b) => b.textContent.includes('Внимание')); const right = document.querySelector('.hud-right'); if (dockBtn && right && !right.querySelector('.mk-bell')) { const b = mk.h('<button type="button" class="btn secondary icon hud-btn mk-bell"></button>'); b.innerHTML = mk.svg(dockBtn); right.insertBefore(b, right.firstChild); } };
for (const k of ['deloSvob', 'deloSdacha', 'gorodSvoj', 'gorodRajony', 'gorodPoryadok', 'gorodKonvert', 'zadanie']) chain(k, hud, HUD_CSS);

chain('karta', () => { const h = document.querySelector('.mk-hist'); if (h) h.lastChild.textContent = 'История карты'; });

// Свободные дела: метки не обрезаются; «На карте» — отдельной строкой, подальше от «Взять».
chain('delaSvobodnye', () => { document.querySelectorAll('.mk-subli').forEach((r) => { const l = r.querySelector('.mk-maplink'); const t = r.querySelector('.t'); if (l && t) { t.appendChild(l); } }); }, `
.mk-body .mk-li .t { display:block !important; -webkit-line-clamp:unset !important; overflow:visible !important }
.mk-subli { min-height:60px !important }
.mk-subli .t .mk-maplink { display:flex; height:32px; margin-top:0 }
`);

// Рейтинг игроков: имя в две строки вместо обрезки, значок команды крупнее.
chain('sluzhenie', () => {}, `
.mk-tr .nm { white-space:normal !important; overflow:visible !important; text-overflow:clip !important; line-height:1.15 !important; font-size:14px !important }
.mk-av .avatar.team { width:17px !important; height:17px !important; font-size:10px !important; font-weight:700 !important; right:-5px !important; bottom:-4px !important }
`);

chain('nagrady', () => {}, `
.mk-grid { gap:8px 0 !important }
.mk-grid .award-name { padding:0 6px !important; text-wrap:balance; max-width:100% }
`);

// Рейтинг команд: числа в одной строке с названием, под подписями столбцов.
P.komandyRejting.css += `
.mk-th, .mk-tr { grid-template-columns:18px 28px 1fr 52px 44px 84px 10px !important; column-gap:4px !important }
.mk-tr .nm { grid-column:3 / 4 !important; grid-row:1; align-self:center; white-space:normal !important; line-height:1.15 } .mk-tr .nm b { font-size:16px }
.mk-tr .num.main { grid-column:4 } .mk-tr .num.main + .num { grid-column:5 } .mk-tr .num.main + .num + .num { grid-column:6 }
.mk-tr .rk, .mk-tr .avc { grid-row:1 / 2 !important; align-self:center !important; padding-top:0 !important }
.mk-tr .num { grid-row:1; align-self:center } .mk-tr .chv { grid-row:1; grid-column:7 !important; align-self:center }
.mk-tr .who { display:none !important }
.mk-tr .ln2 { grid-column:3 / 8 !important; grid-row:2 }
`;

// Районы: «решила команда, вы — нет» словами, а не контурной галочкой; глава подписана.
chain('gorodRajony', () => {
  document.querySelectorAll('.mk-li.dr').forEach((r) => { const st = r.querySelector('.mk-st'); if (st && st.classList.contains('team')) { st.classList.remove('team'); const t = r.querySelector('.t'); t.style.cssText = 'display:block;-webkit-line-clamp:unset;overflow:visible'; t.appendChild(mk.h('<small style="font-weight:400">решила команда, вы — ещё нет</small>')); }
    const s = r.querySelector('.s'); if (s && /^\d+$/.test(s.textContent.trim())) s.textContent = 'гл. ' + s.textContent.trim(); });
});

// Проверка: вторая ссылка со словом, порядок словами.
chain('aProverka', () => {
  const sort = document.querySelector('.mk-sel.plain'); if (sort) sort.textContent = '↑ старые';
  document.querySelectorAll('.mk-card').forEach((c) => { const atts = [...c.querySelectorAll('.mk-att')]; const first = atts[0]; if (!first) return; const word = (first.textContent.match(/[А-Яа-яё]+/) || ['Фото'])[0]; atts.slice(1).forEach((a, i) => { a.textContent = word + ' ' + (i + 2); }); });
}, `
.mk-sel { font-size:12.5px !important; padding:0 7px !important; gap:4px !important } .mk-sel.plain { padding:0 8px !important }
.mk-att { padding:0 8px !important; font-size:13px !important } .mk-c4 { gap:5px !important } .mk-c4 .mk-btn.sm { padding:0 11px !important }
`);

chain('aDela', () => { const add = document.querySelector('.mk-frow .mk-btn'); if (add) add.after(mk.h('<span class="mk-ed more" style="height:36px;display:flex;align-items:center;justify-content:center">⋮</span>')); }, `\n.mk-frow { gap:5px !important }\n`);

// «Мои игры»: главная кнопка во всю ширину, вторая — под ней.
chain('spisok', () => { const two = document.querySelector('.mk-two'); two.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-top:6px'; two.innerHTML = '<span class="mk-btn main" style="height:48px;justify-content:center;font-size:16px">Войти по приглашению</span><span class="mk-btn" style="height:44px;justify-content:center;font-size:15px">+ Создать игру</span>'; });

// Летопись: без рода — «на проверку сдано 7 дел».
chain('letopis', () => { document.querySelectorAll('.mk-li.ev .t').forEach((t) => { const m = t.textContent.match(/^(.+?) сдал на проверку (\d+) (дела|дел)$/); if (m) t.textContent = m[1] + ': на проверку сдано ' + m[2] + ' ' + m[3]; }); });

// Форма сдачи: то, что нужно именно при сдаче, — подсказками у полей.
chain('deloSdacha', () => {
  const desc = (document.querySelector('.deed-sheet .deed-desc') || {}).textContent || ''; const foto = (desc.match(/Фото\s*—\s*([^.]+)\./) || [])[1];
  const wide = document.querySelector('.mk-wide'); if (wide && foto) wide.after(mk.h('<div class="mk-fhint">На фото: ' + mk.esc(foto.trim()) + '.</div>'));
  if (/[Гг]руппой/.test(desc)) { const line = document.querySelector('.mk-line'); if (line) line.after(mk.h('<div class="mk-fhint">Группой — засчитывается всем, кого отметите.</div>')); }
}, `\n.mk-fhint { font-size:13px; color:var(--mk-muted); line-height:1.3; margin-top:4px }\n`);

// «Что нового»: «подробнее» — только там, где текст сокращён.
P.novoe.js = eval('(' + P.novoe.js.toString().replace("shown.map((t) => '<div class=\"mk-it\">' + short(t) + ' <a>подробнее ›</a></div>')", "shown.map((t) => '<div class=\"mk-it\">' + short(t) + (t.length > 125 ? ' <a>подробнее ›</a>' : '') + '</div>')") + ')');

// Лист ролей: описания целиком, как в игре.
P.rol.js = eval('(' + P.rol.js.toString().replace("mk.esc(short(o.d))", "mk.esc(o.d)") + ')');
P.rol.css += `\n.mk-opt { padding:8px 0 !important; align-items:flex-start !important } .mk-opt svg { margin-top:2px } .mk-opt .mk-radio { margin-top:2px }\n.mk-opt .t span { font-size:13px !important; line-height:1.3 !important }\n`;
};
