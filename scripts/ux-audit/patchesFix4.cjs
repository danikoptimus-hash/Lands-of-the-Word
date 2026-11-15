// Правки по четвёртой независимой проверке (15.11): средние замечания по пяти макетам.
module.exports = (P) => {
const chain = (name, fn, css) => { const p = P[name]; const prev = p.post; p.post = eval('(async () => { ' + (prev ? 'await (' + prev.toString() + ')(); ' : '') + 'await (' + fn.toString() + ')(); })'); if (css) p.css += css; };

// Дела администратора: строка открывается (описание и размещение), сведения — без висящих точек.
chain('aDela', () => {
  document.querySelectorAll('.mk-d').forEach((d) => { const sm = d.querySelector('.t small'); if (sm) { const off = sm.querySelector('b.mk-warn'); const parts = [...sm.querySelectorAll('span')].map((x) => x.textContent.trim()); sm.innerHTML = (off ? '<b class="mk-warn" style="margin-right:10px">выключено</b>' : '') + parts.map((x) => '<span style="white-space:nowrap;margin-right:10px">' + x + '</span>').join(' '); }
    const more = d.querySelector('.mk-ed.more'); if (more) more.remove(); d.appendChild(mk.h('<span class="mk-chev" style="margin-left:2px">›</span>')); });
}, `\n.mk-d .t small { line-height:1.4 !important }\n`);

// Проверка: вкладка называется «Сдачи»; одна ссылка «О деле» вместо двух мелких.
chain('aProverka', () => {
  const first = document.querySelector('.mk-tab.on'); if (first) first.firstChild.textContent = 'Сдачи';
  document.querySelectorAll('.mk-card').forEach((c) => { const k = c.querySelector('.mk-c1 .k'); if (k) k.textContent = 'О деле ›'; const a = c.querySelector('.mk-c1b a'); if (a) a.remove(); });
});

// Рейтинг команд: число не отрывается от слова.
chain('komandyRejting', () => { document.querySelectorAll('.mk-tm small').forEach((s) => { s.innerHTML = s.innerHTML.replace(/(выиграли|устояли|проиграли) (\d+)/g, '$1&nbsp;$2').replace(/(\d+) (игрок)/, '$1&nbsp;$2'); }); });

// Рейтинг игроков: правило очков одной строкой, место не касается аватарки.
chain('sluzhenie', () => { const th = document.querySelector('.mk-th'); if (th) { th.before(mk.h('<div class="mk-rule">Очки: <span>дело — 3</span> · <span>город — 2</span> · <span>район, переправа — 1</span> · <span>5 стихов — 1</span></div>')); const q = th.querySelector('.mk-q'); if (q) q.remove(); } }, `
.mk-rule { font-size:12.5px; color:var(--mk-muted); padding:8px 0 2px; line-height:1.3 }
.mk-rule span { white-space:nowrap }
.mk-th, .mk-tr { grid-template-columns:20px 28px 1fr 34px 30px 46px 42px 40px !important; column-gap:4px !important }
.mk-tr .rk { padding-right:2px !important }
`);

// «Что нового»: текст не мельче нынешнего, «ещё» названо словами.
chain('novoe', () => { document.querySelectorAll('.mk-it').forEach((x) => { const m = x.textContent.trim().match(/^ещё (\d+) ›$/); if (m) x.textContent = 'ещё ' + m[1] + ' изменений за этот день ›'; }); }, `\n.mk-it { font-size:16px !important }\n`);
};
