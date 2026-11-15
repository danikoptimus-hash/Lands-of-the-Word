// Правки по пятой независимой проверке (15.11): серьёзных нет, средние по трём макетам.
module.exports = (P) => {
const chain = (name, fn, css) => { const p = P[name]; const prev = p.post; p.post = eval('(async () => { ' + (prev ? 'await (' + prev.toString() + ')(); ' : '') + 'await (' + fn.toString() + ')(); })'); if (css) p.css += css; };

// Рейтинг игроков: столбцы жёсткие, длинное имя — с многоточием; переправа в правиле названа отдельно.
chain('sluzhenie', () => { const r = document.querySelector('.mk-rule'); if (r) r.innerHTML = 'Очки: <span>дело — 3</span> · <span>город — 2</span> · <span>район — 1</span> · <span>переправа — 1</span> · <span>5 стихов — 1</span>'; }, `
.mk-th, .mk-tr { grid-template-columns:18px 28px minmax(0,1fr) 34px 30px 46px 42px 40px !important; column-gap:3px !important }
.mk-tr .nm { overflow:hidden !important; text-overflow:ellipsis !important }
`);

// Проверка: кнопки высотой 44 px, между ними 8 px; у каждого вложения значок.
chain('aProverka', () => { document.querySelectorAll('.mk-card').forEach((c) => { const atts = [...c.querySelectorAll('.mk-att')]; const ic = atts[0] && atts[0].querySelector('svg'); if (ic) atts.slice(1).forEach((a) => { if (!a.querySelector('svg')) a.innerHTML = ic.outerHTML + a.textContent; }); }); }, `
.mk-c4 { gap:8px !important } .mk-c4 .mk-btn.sm, .mk-att { height:44px !important } .mk-c4 .mk-btn.sm.main { margin-left:0 !important }
`);

// Дела администратора: отбор назван, карандаш и стрелка разнесены, поле справа как у остального содержимого.
chain('aDela', () => { const sel = document.querySelector('.mk-frow .mk-sel'); if (sel) sel.textContent = 'Любой вид'; }, `
.mk-d { padding-right:16px !important } .mk-d .mk-ed { width:44px !important; height:44px !important } .mk-d .mk-chev { margin-left:6px !important }
`);
};
