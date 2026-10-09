#!/usr/bin/env python3
"""Разбор поведения участников в заданиях городов по выгрузке deploy/research-export.sh: признаки решения
с подсказкой извне (ИИ, поиск, чужие ответы). Запуск:
    python3 scripts/behavior-report.py <папка-выгрузки> [--out отчёт.html] [--tz 5]
В отчёте только ники и счётчики; настоящих имён и текстов ответов в выгрузке нет. Отчёт — не приговор: каждый признак
объясним и честной игрой, в тексте это сказано прямо.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import html
import os
import statistics as st
from collections import Counter, defaultdict

RU_MON = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]


def parse_ts(s: str) -> dt.datetime:
    return dt.datetime.fromisoformat(s)


def read(d: str, name: str) -> list[dict]:
    with open(os.path.join(d, name + ".csv"), encoding="utf-8") as f:
        return list(csv.DictReader(f))


def esc(s) -> str:
    return html.escape(str(s), quote=True)


def fmt(x: float, nd: int = 0) -> str:
    return f"{x:.{nd}f}".replace(".", ",")


def dfull(d: dt.date) -> str:
    return f"{d.day} {RU_MON[d.month - 1]} {d.year}"


# Пороги признаков (решение по данным «Осени» 09.10: медианы по всем участникам — ответ 50 с, выходы 45 %, ошибки 10 %).
FAST_S = 30        # медиана от открытия задания до верного ответа
AWAY_SHARE = 60    # доля верных ответов, перед которыми был выход из приложения
WRONG_MAX = 7      # доля неверных попыток
BURST_SHARE = 75   # доля верных ответов, идущих не дольше чем через 2 минуты после предыдущего
MIN_OK = 10        # меньше решённых — признаки не считаем


def analyse(d: str, tz_hours: float) -> dict:
    tz = dt.timedelta(hours=tz_hours)
    game = read(d, "game")[0]
    teams = {r["id"]: r["name"] for r in read(d, "teams")}
    members = {r["userId"]: (r["nickname"], r["teamId"]) for r in read(d, "members")}
    events = sorted(read(d, "task_events"), key=lambda r: r["createdAt"])
    if not events:
        raise SystemExit("в выгрузке нет task_events")
    first = parse_ts(events[0]["createdAt"]); last = parse_ts(events[-1]["createdAt"])

    by_task = defaultdict(list)
    for r in events:
        by_task[(r["userId"], r["nodeKey"], r["taskIndex"])].append(r)

    S = defaultdict(lambda: dict(ok=0, wrong=0, solve=[], away_before=0, away_sec=[], night=0, oks=[], days=set()))
    for (u, _n, _i), ev in by_task.items():
        s = S[u]
        open_t = None; aways: list[float] = []; wrongs = 0
        for r in ev:
            k = r["kind"]; t = parse_ts(r["createdAt"])
            if k == "open":
                if open_t is None:
                    open_t = t; aways = []
            elif k == "away":
                if open_t is not None:
                    aways.append(int(r["awayMs"] or 0) / 1000)
            elif k == "wrong":
                s["wrong"] += 1; wrongs += 1
            elif k == "ok":
                s["ok"] += 1; s["oks"].append(t); s["days"].add((t + tz).date())
                if open_t is not None:
                    s["solve"].append((t - open_t).total_seconds())
                    if aways:
                        s["away_before"] += 1; s["away_sec"].append(sum(aways))
                if (t + tz).hour < 7:
                    s["night"] += 1
                open_t = None; aways = []; wrongs = 0

    rows = []
    for u, s in S.items():
        if s["ok"] == 0:
            continue
        nick, tid = members.get(u, ("?", "?"))
        oks = sorted(s["oks"]); gaps = [(b - a).total_seconds() for a, b in zip(oks, oks[1:])]
        solved = len(s["solve"])
        row = dict(
            nick=nick, team=teams.get(tid, "?"), ok=s["ok"], wrong=s["wrong"],
            wrong_pct=s["wrong"] / (s["ok"] + s["wrong"]) * 100,
            med_solve=st.median(s["solve"]) if s["solve"] else None,
            away_share=s["away_before"] / solved * 100 if solved else None,
            med_away=st.median(s["away_sec"]) if s["away_sec"] else None,
            burst_share=sum(1 for g in gaps if g < 120) / len(gaps) * 100 if len(gaps) >= 3 else None,
            night=s["night"], days=len(s["days"]),
        )
        flags = []
        if row["ok"] >= MIN_OK:
            if row["med_solve"] is not None and row["med_solve"] < FAST_S: flags.append("быстро")
            if row["away_share"] is not None and row["away_share"] >= AWAY_SHARE: flags.append("выходы")
            if row["wrong_pct"] <= WRONG_MAX and row["ok"] >= 30: flags.append("без ошибок")
            if row["burst_share"] is not None and row["burst_share"] >= BURST_SHARE: flags.append("сериями")
        row["flags"] = flags
        rows.append(row)
    rows.sort(key=lambda r: (-len(r["flags"]), -r["ok"]))

    hours = Counter((parse_ts(r["createdAt"]) + tz).hour for r in events if r["kind"] == "ok")
    all_solve = [x for s in S.values() for x in s["solve"]]
    all_away = [x for s in S.values() for x in s["away_sec"]]
    totals = dict(
        users=len(rows), ok=sum(r["ok"] for r in rows), wrong=sum(r["wrong"] for r in rows),
        med_solve=st.median(all_solve) if all_solve else 0,
        away_share=sum(s["away_before"] for s in S.values()) / max(1, len(all_solve)) * 100,
        med_away=st.median(all_away) if all_away else 0,
        night=sum(r["night"] for r in rows),
    )
    return dict(game=game["name"], first=first + tz, last=last + tz, rows=rows, hours=hours, totals=totals, tz=tz_hours)


def bar_svg(items: list[tuple[str, float, str]], unit: str, vmax: float, color: str, h_row: int = 22) -> str:
    """Горизонтальные столбики: (подпись, значение, подсказка)."""
    w, lw = 760, 190
    h = h_row * len(items) + 10
    parts = [f'<svg class="chart" viewBox="0 0 {w} {h}" role="img" aria-label="столбики">']
    for i, (label, v, tip) in enumerate(items):
        y = 5 + i * h_row
        bw = max(0, (w - lw - 70) * min(v, vmax) / vmax)
        parts.append(f'<text class="tick" x="{lw - 8}" y="{y + 15}" text-anchor="end">{esc(label)}</text>')
        parts.append(f'<rect class="bar" x="{lw}" y="{y + 4}" width="{bw:.1f}" height="{h_row - 8}" rx="3" fill="{color}" data-tip="{esc(tip)}"/>')
        parts.append(f'<text class="dlabel" x="{lw + bw + 6:.1f}" y="{y + 15}">{esc(fmt(v))}{esc(unit)}</text>')
    parts.append("</svg>")
    return "".join(parts)


def page(A: dict) -> str:
    rows = A["rows"]; T = A["totals"]
    flagged = [r for r in rows if len(r["flags"]) >= 2]
    css = """
:root{--paper:#f7f3ea;--surface:#fffdf8;--ink:#2b2117;--ink-2:#5b4d3f;--ink-3:#8a7b6a;--line:#e3dccd;--accent:#8a5a1c;--band:#efe7d6;--warn:#b7791f}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--paper:#1a1713;--surface:#221e18;--ink:#f1e9dc;--ink-2:#cdbfa9;--ink-3:#9a8c78;--line:#3a332a;--accent:#d9a45b;--band:#2c261e;--warn:#e0a23a}}
:root[data-theme="dark"]{--paper:#1a1713;--surface:#221e18;--ink:#f1e9dc;--ink-2:#cdbfa9;--ink-3:#9a8c78;--line:#3a332a;--accent:#d9a45b;--band:#2c261e;--warn:#e0a23a}
body{background:var(--paper);color:var(--ink);font-family:"PT Sans","Segoe UI",system-ui,sans-serif;font-size:1.02rem;line-height:1.5;margin:0}
.wrap{max-width:900px;margin:0 auto;padding-block:28px 60px;padding-inline:16px}
h1,h2{font-family:"PT Serif",Georgia,serif;text-wrap:balance;line-height:1.2}h1{font-size:1.9rem;margin:0 0 6px}h2{font-size:1.25rem;margin:36px 0 10px;padding-top:14px;border-top:1px solid var(--line)}
p{margin:8px 0;max-width:70ch}.eyebrow{font-size:.86rem;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin:18px 0}
.tile{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:12px 14px}.tile .n{font-family:"PT Serif",Georgia,serif;font-size:1.7rem;line-height:1.1;font-variant-numeric:tabular-nums}.tile .l{font-size:.86rem;color:var(--ink-2)}
.note{background:var(--band);border-left:3px solid var(--accent);padding:10px 14px;border-radius:0 6px 6px 0;margin:14px 0;max-width:72ch}
figure{margin:14px 0 22px;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:10px}figcaption{font-size:.86rem;color:var(--ink-2);padding:4px 4px 2px}
svg.chart{width:100%;height:auto;display:block;font-family:"PT Sans",system-ui,sans-serif}svg .tick{font-size:11px;fill:var(--ink-3)}svg .dlabel{font-size:11px;fill:var(--ink-2)}svg .bar:hover{opacity:.8}
.tbl{overflow-x:auto;margin:10px 0}table{border-collapse:collapse;width:100%;font-size:.86rem;background:var(--surface);border:1px solid var(--line)}
th,td{padding:6px 8px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top;font-variant-numeric:tabular-nums;white-space:nowrap}th{color:var(--ink-2);font-weight:600;background:var(--band)}
td.num,th.num{text-align:right}.flag{display:inline-block;background:var(--band);border:1px solid var(--line);border-radius:999px;padding:0 8px;margin:1px 2px 1px 0;font-size:.8rem}
tr.hot td{background:color-mix(in srgb,var(--warn) 10%,transparent)}
ul{padding-left:20px;max-width:72ch}li{margin:4px 0}.muted{color:var(--ink-3)}
.tip{position:fixed;pointer-events:none;background:var(--ink);color:var(--paper);font-size:.82rem;padding:5px 8px;border-radius:5px;max-width:280px;z-index:9;display:none}
"""
    js = """(function(){var tip=document.createElement('div');tip.className='tip';document.body.appendChild(tip);
function show(e){var t=e.target.getAttribute('data-tip');if(!t){tip.style.display='none';return;}tip.textContent=t;tip.style.display='block';var x=e.clientX+12,y=e.clientY+14;if(x+tip.offsetWidth>window.innerWidth-8)x=e.clientX-tip.offsetWidth-8;tip.style.left=x+'px';tip.style.top=y+'px';}
document.querySelectorAll('svg.chart').forEach(function(s){s.addEventListener('mousemove',show);s.addEventListener('mouseleave',function(){tip.style.display='none';});});})();"""

    def cell(v, nd=0, unit=""):
        return "—" if v is None else fmt(v, nd) + unit

    trs = []
    for r in rows:
        trs.append(
            f'<tr class="{"hot" if len(r["flags"]) >= 2 else ""}"><td>{esc(r["nick"])}</td><td>{esc(r["team"])}</td>'
            f'<td class="num">{r["ok"]}</td><td class="num">{cell(r["wrong_pct"])}%</td><td class="num">{cell(r["med_solve"])} с</td>'
            f'<td class="num">{cell(r["away_share"])}%</td><td class="num">{cell(r["med_away"])} с</td><td class="num">{cell(r["burst_share"])}%</td>'
            f'<td class="num">{r["night"]}</td><td class="num">{r["days"]}</td><td>{"".join(f"<span class=flag>{esc(f)}</span>" for f in r["flags"]) or "<span class=muted>—</span>"}</td></tr>')

    top = [r for r in rows if r["ok"] >= MIN_OK and r["med_solve"] is not None]
    solve_chart = bar_svg([(r["nick"], r["med_solve"], f"{r['nick']}: медиана {fmt(r['med_solve'])} с, решено {r['ok']}") for r in sorted(top, key=lambda r: r["med_solve"])], " с", max(r["med_solve"] for r in top) if top else 1, "#2a78d6")
    away_chart = bar_svg([(r["nick"], r["away_share"] or 0, f"{r['nick']}: выход перед {fmt(r['away_share'] or 0)}% верных ответов, медиана выхода {fmt(r['med_away'] or 0)} с") for r in sorted(top, key=lambda r: -(r["away_share"] or 0))], "%", 100, "#eb6834")
    hours = A["hours"]; hmax = max(hours.values()) if hours else 1
    hour_svg = ['<svg class="chart" viewBox="0 0 760 170" role="img" aria-label="ответы по часам">']
    for h in range(24):
        v = hours.get(h, 0); bh = 120 * v / hmax; x = 30 + h * 30
        hour_svg.append(f'<rect class="bar" x="{x}" y="{135 - bh:.1f}" width="22" height="{bh:.1f}" rx="3" fill="{"#8a7b6a" if h < 7 else "#2a78d6"}" data-tip="{h:02d}:00 — {v} верных ответов"/>')
        hour_svg.append(f'<text class="tick" x="{x + 11}" y="152" text-anchor="middle">{h:02d}</text>')
    hour_svg.append("</svg>")

    return f"""<title>Решения «{esc(A['game'])}»</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=PT+Serif:wght@400;700&family=PT+Sans:wght@400;700&display=swap">
<style>{css}</style>
<div class="wrap">
<div class="eyebrow">Исследование · партия «{esc(A['game'])}» · события заданий с {esc(dfull(A['first'].date()))} по {esc(dfull(A['last'].date()))}</div>
<h1>Кто решает задания с подсказкой извне</h1>
<p>Игра пишет события по каждому заданию города: открыл, вышел из приложения (и на сколько), ответил верно или неверно. Текстов ответов и настоящих имён в выгрузке нет, здесь только ники и счётчики. Время — по поясу игры (UTC+{int(A['tz'])}).</p>
<div class="tiles">
 <div class="tile"><div class="n">{T['users']}</div><div class="l">участников с ответами</div></div>
 <div class="tile"><div class="n">{T['ok']}</div><div class="l">верных ответов, неверных {T['wrong']}</div></div>
 <div class="tile"><div class="n">{esc(fmt(T['med_solve']))} с</div><div class="l">медиана от открытия задания до верного ответа</div></div>
 <div class="tile"><div class="n">{esc(fmt(T['away_share']))}%</div><div class="l">ответов после выхода из приложения, выход в среднем {esc(fmt(T['med_away']))} с</div></div>
</div>
<div class="note"><b>Как читать.</b> Ни один признак сам по себе не доказывает ИИ: выход из приложения может быть в Библию, быстрый ответ — потому что текст уже прочитан, серия ответов — потому что команда решает вместе и диктует. Признаки складываются: у кого два и больше, на того стоит посмотреть внимательнее, например попросить решить одно задание при вас. Таких участников сейчас <b>{len(flagged)}</b>.</div>

<h2>1. Признаки</h2>
<ul>
<li><b>Быстро</b> — медиана от открытия задания до верного ответа меньше {FAST_S} с. Прочитать район и найти стих за это время трудно, если ответ не известен заранее.</li>
<li><b>Выходы</b> — перед {AWAY_SHARE} % и больше верных ответов человек выходил из приложения. Куда — игра не знает: Библия, поиск, чат команды или ИИ.</li>
<li><b>Без ошибок</b> — неверных попыток не больше {WRONG_MAX} % при 30 и больше решённых. Честная игра обычно даёт 10–25 % промахов.</li>
<li><b>Сериями</b> — {BURST_SHARE} % и больше верных ответов идут не дольше чем через две минуты после предыдущего.</li>
<li>Признаки считаются только у тех, кто решил {MIN_OK} и больше заданий.</li>
</ul>

<h2>2. Участники</h2>
<div class="tbl"><table><thead><tr><th>Ник</th><th>Команда</th><th class="num">Решил</th><th class="num">Ошибок</th><th class="num">Ответ</th><th class="num">С выходом</th><th class="num">Выход</th><th class="num">Сериями</th><th class="num">Ночью</th><th class="num">Дней</th><th>Признаки</th></tr></thead><tbody>{''.join(trs)}</tbody></table></div>
<p class="muted">«Ответ» — медиана от открытия задания до верного ответа. «С выходом» — доля верных ответов, перед которыми был выход из приложения; «Выход» — медианная длительность такого выхода. «Сериями» — доля верных ответов через меньше чем 2 минуты после предыдущего. «Ночью» — верные ответы с 00:00 до 07:00 (с 3 октября ночью задания закрыты). Подсвечены строки с двумя и больше признаками.</p>

<h2>3. Графики</h2>
<figure>{solve_chart}<figcaption>Медиана времени от открытия задания до верного ответа, по участникам (от 10 решённых). Короткие столбики слева — главный повод присмотреться.</figcaption></figure>
<figure>{away_chart}<figcaption>Доля верных ответов, перед которыми был выход из приложения.</figcaption></figure>
<figure>{''.join(hour_svg)}<figcaption>Верные ответы по часам местного времени. Серым — ночь (00:00–07:00), сейчас задания в это время закрыты.</figcaption></figure>

<h2>4. Что с этим делать</h2>
<ul>
<li>Не называть никого вслух по отчёту: признаки косвенные. Разумный шаг — попросить подсвеченных решить одно задание при капитане или служителе.</li>
<li>Через неделю повторить выгрузку: если «быстро» и «без ошибок» держатся, а при решении вслух человек путается, это уже разговор.</li>
<li>Для следующей партии можно обсудить правило: задание открывается только после чтения района в игре, а не в другом приложении. Это снизит долю выходов и сделает признак точнее.</li>
</ul>
</div>
<script>{js}</script>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("export_dir"); ap.add_argument("--out", default=None); ap.add_argument("--tz", type=float, default=5.0)
    a = ap.parse_args()
    A = analyse(a.export_dir, a.tz)
    out = a.out or f"behavior-{A['game']}-{A['last'].date()}.html"
    with open(out, "w", encoding="utf-8") as f:
        f.write(page(A))
    flagged = [r["nick"] for r in A["rows"] if len(r["flags"]) >= 2]
    print(f"{out}: участников {A['totals']['users']}, с двумя и больше признаками {len(flagged)}")


if __name__ == "__main__":
    main()
