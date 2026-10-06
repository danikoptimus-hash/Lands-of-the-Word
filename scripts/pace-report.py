#!/usr/bin/env python3
"""Исследование темпа партии по выгрузке deploy/research-export.sh: графики по дням, разбор нелинейности, прогноз даты,
когда карта будет занята (все города взяты). Запуск:
    python3 scripts/pace-report.py <папка-выгрузки> [--out отчёт.html] [--tz 5]
Отчёт — одна HTML-страница со встроенными SVG. Имён участников в отчёте нет: только команды, даты и счётчики.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import html
import json
import math
import os
import statistics as st
from collections import Counter, defaultdict

import numpy as np

# ---------- данные ----------


def parse_ts(s: str) -> dt.datetime | None:
    return dt.datetime.fromisoformat(s) if s else None


def read(d: str, name: str) -> list[dict]:
    with open(os.path.join(d, name + ".csv"), encoding="utf-8") as f:
        return list(csv.DictReader(f))


class Data:
    def __init__(self, d: str, tz_hours: float):
        self.tz = dt.timedelta(hours=tz_hours)
        g = read(d, "game")[0]
        self.game_name = g["name"]
        self.start = parse_ts(g["startedAt"])
        self.settings = json.loads(g["settings"])
        teams = read(d, "teams")
        self.teams = [(r["id"], r["name"]) for r in sorted(teams, key=lambda r: int(r["index"]))]
        self.team_name = dict(self.teams)
        self.members = Counter(r["teamId"] for r in read(d, "members"))
        self.journal = [r for r in read(d, "journal") if parse_ts(r["createdAt"]) >= self.start]
        self.city_states = read(d, "city_states")
        self.nodes = {r["key"]: r for r in read(d, "nodes")}
        self.node_states = read(d, "node_states")
        self.edge_tasks = read(d, "edge_tasks")
        self.battles = read(d, "battles")
        # конец выгрузки — последнее событие любого рода
        last = max(parse_ts(r["createdAt"]) for r in self.journal)
        for r in self.node_states:
            last = max(last, parse_ts(r["revealedAt"]))
        self.end = last
        self.cities_total = sum(1 for n in self.nodes.values() if n["kind"] == "CITY")
        self.nodes_total = len(self.nodes)

    def local(self, t: dt.datetime) -> dt.datetime:
        return t + self.tz

    def day(self, t: dt.datetime) -> float:
        """Сутки от старта партии (дробные)."""
        return (t - self.start).total_seconds() / 86400

    def ldate(self, t: dt.datetime) -> dt.date:
        return self.local(t).date()


# ---------- расчёты ----------

RU_WD = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]
RU_MON = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]


def dshort(d: dt.date) -> str:
    return f"{d.day} {RU_MON[d.month - 1]}"


def dfull(d: dt.date) -> str:
    return f"{d.day} {RU_MON[d.month - 1]} {d.year}"


def fmt(x: float, nd: int = 1) -> str:
    s = f"{x:.{nd}f}".replace(".", ",")
    return s


def analyse(D: Data) -> dict:
    J = D.journal
    tid = [t for t, _ in D.teams]
    days = []
    d0 = D.ldate(D.start)
    d1 = D.ldate(D.end)
    cur = d0
    while cur <= d1:
        days.append(cur)
        cur += dt.timedelta(days=1)
    daily = {d: {"tasks": Counter(), "deeds": Counter(), "captures": Counter(), "reveals": Counter(), "active": defaultdict(set)} for d in days}
    for r in J:
        d = D.ldate(parse_ts(r["createdAt"]))
        k = r["kind"]
        if k == "task_solved":
            daily[d]["tasks"][r["teamId"]] += 1
        elif k == "deed_approved":
            daily[d]["deeds"][r["teamId"]] += 1
        elif k == "city_captured":
            daily[d]["captures"][r["teamId"]] += 1
        if k in ("task_solved", "deed_submitted", "order_solved") and r["userId"]:
            daily[d]["active"][r["teamId"]].add(r["userId"])
    for r in D.node_states:
        daily[D.ldate(parse_ts(r["revealedAt"]))]["reveals"][r["teamId"]] += 1

    # события взятий по времени (сутки от старта)
    caps = sorted(((D.day(parse_ts(r["createdAt"])), r["teamId"]) for r in J if r["kind"] == "city_captured"))
    T_end = D.day(D.end)
    n_caps = len(caps)
    K = D.cities_total

    # кумулятивная кривая на сетке часов
    grid = np.arange(0, T_end + 1e-9, 1 / 24)
    cum = np.array([sum(1 for t, _ in caps if t <= g) for g in grid])

    # устойчивый участок: после разгона — с первого дня, когда взяли ≥2 городов, иначе вся история
    ramp_end = 0.0
    for d in days:
        if sum(daily[d]["captures"].values()) >= 2:
            ramp_end = D.day(dt.datetime.combine(d, dt.time()) - D.tz)
            break
    ramp_end = max(ramp_end, 0.0)
    steady_days = [d for d in days[1:-1] if D.day(dt.datetime.combine(d, dt.time()) - D.tz) >= ramp_end]  # полные сутки
    if not steady_days:
        steady_days = days[1:-1] or days
    caps_steady = sum(1 for t, _ in caps if t >= ramp_end)
    rate_now = caps_steady / max(T_end - ramp_end, 0.5)  # городов в сутки

    # стоимость города: решённых заданий и часы от первого задания до взятия
    cost = []
    for r in D.city_states:
        if not r["capturedAt"]:
            continue
        cap = parse_ts(r["capturedAt"])
        created = parse_ts(r["createdAt"])
        cost.append({"team": r["teamId"], "node": r["nodeKey"], "tasks": int(r["done"]), "hours": (cap - created).total_seconds() / 3600, "at": D.day(cap), "capital": r["isCapital"] == "t"})
    cost.sort(key=lambda c: c["at"])
    tasks_per_city = st.median([c["tasks"] for c in cost]) if cost else 17
    in_progress = [r for r in D.city_states if not r["capturedAt"]]

    # часы суток решения заданий (местные)
    hours = Counter(D.local(parse_ts(r["createdAt"])).hour for r in J if r["kind"] == "task_solved")
    # дни недели (всего заданий)
    wd = Counter(D.local(parse_ts(r["createdAt"])).weekday() for r in J if r["kind"] == "task_solved")

    # дела: сколько часов от взятия до сдачи, проверка админом
    take_to_submit = [(parse_ts(r["submittedAt"]) - parse_ts(r["takenAt"])).total_seconds() / 3600 for r in D.edge_tasks if r["status"] == "APPROVED" and r["takenAt"] and r["submittedAt"]]
    review_min = [(parse_ts(r["decidedAt"]) - parse_ts(r["submittedAt"])).total_seconds() / 60 for r in D.edge_tasks if r["status"] == "APPROVED" and r["submittedAt"] and r["decidedAt"]]

    revealed_union = {r["nodeKey"] for r in D.node_states}
    revealed_cities = {k for k in revealed_union if D.nodes[k]["kind"] == "CITY"}
    islands = Counter(D.nodes[k]["island"] for k in D.nodes if D.nodes[k]["kind"] == "CITY")
    captured_keys = {r["nodeKey"] for r in D.city_states if r["capturedAt"]}
    captured_by_island = Counter(D.nodes[k]["island"] for k in captured_keys)
    sea_landed = [(D.day(parse_ts(r["createdAt"])), r["teamId"]) for r in J if r["kind"] == "sea_landed"]
    night_rule_day = None
    # ночные задания (00:00–07:00 местного) до и после: признак структурного изменения
    night_tasks = Counter()
    for r in J:
        if r["kind"] == "task_solved":
            lt = D.local(parse_ts(r["createdAt"]))
            if lt.hour < 7:
                night_tasks[lt.date()] += 1

    # ---- модели прогноза ----
    # A. как сейчас: линейно по устойчивому темпу
    rem = K - n_caps
    lin_days = {m: (m - n_caps) / rate_now if rate_now > 0 else math.inf for m in (K // 2, int(K * 0.95), K)}

    # B. логистика с потолком K: C(t) = K / (1 + exp(-r (t - t0)))
    best = None
    for r_ in np.linspace(0.05, 1.5, 146):
        for t0 in np.linspace(0, 60, 241):
            pred = K / (1 + np.exp(-r_ * (grid - t0)))
            sse = float(np.sum((pred - cum) ** 2))
            if best is None or sse < best[0]:
                best = (sse, r_, t0)
    _, lr, lt0 = best
    log_days = {}
    for m in (K // 2, int(K * 0.95), K - 1):
        frac = min(m / K, 0.999)
        log_days[m] = lt0 - math.log(1 / frac - 1) / lr
    log_curve = K / (1 + np.exp(-lr * (np.arange(0, 120, 0.25) - lt0)))

    # C. пропускная способность с сопротивлением карты и, в худшем случае, угасанием (Монте-Карло)
    team_tasks = {t: [daily[d]["tasks"][t] for d in steady_days] for t in tid}
    cost_pool = [c["tasks"] for c in cost if not c["capital"]] or [int(tasks_per_city)]
    rng = np.random.default_rng(7)
    cap_total = sum(np.mean(v) if v else 0 for v in team_tasks.values())
    scen = {}
    for name, gamma, decay in (("Как сейчас", 0.0, 1.0), ("Карта сопротивляется", 1.0, 1.0), ("Запал гаснет", 1.0, 0.85)):
        finish = {m: [] for m in (K // 2, int(K * 0.95), K)}
        paths = []
        for run in range(1500):
            c = n_caps
            t = T_end
            pool = 0.0  # накопленные задания
            next_cost = float(rng.choice(cost_pool))
            path = [(t, c)]
            guard = 0
            while c < K and guard < 365:  # дальше года не считаем: такие даты всё равно ничего не значат
                guard += 1
                week = (t - T_end) / 7
                mult = decay ** week
                day_tasks = 0.0
                for v in team_tasks.values():
                    if v:
                        day_tasks += float(rng.choice(v))
                # сопротивление: доля свободных городов в степени gamma
                free = (K - c) / K
                eff = free ** gamma if gamma > 0 else 1.0
                pool += day_tasks * mult * eff
                t += 1
                while pool >= next_cost and c < K:
                    pool -= next_cost
                    c += 1
                    next_cost = float(rng.choice(cost_pool))
                    for m in finish:
                        if c == m:
                            finish[m].append(t)
                path.append((t, c))
            for m in finish:
                if len(finish[m]) < run + 1:
                    finish[m].append(math.inf)  # не достигнуто за год
            if run < 60:
                paths.append(path)
        scen[name] = {"gamma": gamma, "decay": decay, "finish": {m: tuple(float(np.percentile(v, q)) for q in (10, 50, 90)) for m, v in finish.items()}, "paths": paths}
    # медианная кривая каждого сценария по сетке
    for s in scen.values():
        grid2 = np.arange(T_end, T_end + 120, 1.0)
        med = []
        for g in grid2:
            vals = []
            for path in s["paths"]:
                v = n_caps
                for (pt, pc) in path:
                    if pt <= g:
                        v = pc
                    else:
                        break
                vals.append(v)
            med.append(float(np.median(vals)))
        s["curve"] = (grid2, np.array(med))

    return dict(days=days, daily=daily, caps=caps, grid=grid, cum=cum, T_end=T_end, K=K, n_caps=n_caps, rate_now=rate_now, ramp_end=ramp_end, steady_days=steady_days,
                cost=cost, tasks_per_city=tasks_per_city, in_progress=in_progress, hours=hours, wd=wd, take_to_submit=take_to_submit, review_min=review_min,
                revealed_union=revealed_union, revealed_cities=revealed_cities, islands=islands, captured_by_island=captured_by_island, sea_landed=sea_landed,
                night_tasks=night_tasks, lin_days=lin_days, lr=lr, lt0=lt0, log_days=log_days, log_curve=log_curve, scen=scen, cap_total=cap_total, team_tasks=team_tasks, cost_pool=cost_pool)


# ---------- SVG ----------

SLOTS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"]  # проверенные категориальные цвета (слоты 1–4)


def esc(s: str) -> str:
    return html.escape(str(s), quote=True)


class Chart:
    """Простой SVG-график: одна ось Y, подписи, сетка, серии. Размеры в единицах viewBox, страница масштабирует."""

    def __init__(self, w=760, h=300, ml=44, mr=16, mt=16, mb=34):
        self.w, self.h, self.ml, self.mr, self.mt, self.mb = w, h, ml, mr, mt, mb
        self.parts: list[str] = []

    @property
    def pw(self):
        return self.w - self.ml - self.mr

    @property
    def ph(self):
        return self.h - self.mt - self.mb

    def scales(self, x0, x1, y0, y1):
        self.x0, self.x1, self.y0, self.y1 = x0, x1, y0, y1

    def X(self, x):
        return self.ml + (x - self.x0) / (self.x1 - self.x0) * self.pw

    def Y(self, y):
        return self.mt + self.ph - (y - self.y0) / (self.y1 - self.y0) * self.ph

    def grid_y(self, ticks, fmt_=lambda v: str(int(v))):
        for v in ticks:
            y = self.Y(v)
            self.parts.append(f'<line class="grid" x1="{self.ml}" x2="{self.w - self.mr}" y1="{y:.1f}" y2="{y:.1f}"/>')
            self.parts.append(f'<text class="tick" x="{self.ml - 6}" y="{y + 4:.1f}" text-anchor="end">{esc(fmt_(v))}</text>')

    def ticks_x(self, items, rotate=False):
        """items: (x, label)."""
        yb = self.mt + self.ph
        self.parts.append(f'<line class="axis" x1="{self.ml}" x2="{self.w - self.mr}" y1="{yb:.1f}" y2="{yb:.1f}"/>')
        for x, label in items:
            px = self.X(x)
            self.parts.append(f'<text class="tick" x="{px:.1f}" y="{yb + 16}" text-anchor="middle">{esc(label)}</text>')

    def vline(self, x, label=None, cls="marker"):
        px = self.X(x)
        self.parts.append(f'<line class="{cls}" x1="{px:.1f}" x2="{px:.1f}" y1="{self.mt}" y2="{self.mt + self.ph}"/>')
        if label:
            self.parts.append(f'<text class="tick note" x="{px + 4:.1f}" y="{self.mt + 10}">{esc(label)}</text>')

    def band(self, xa, xb, y_lo, y_hi, color):
        self.parts.append(f'<rect x="{self.X(xa):.1f}" y="{self.Y(y_hi):.1f}" width="{self.X(xb) - self.X(xa):.1f}" height="{self.Y(y_lo) - self.Y(y_hi):.1f}" fill="{color}" opacity=".12"/>')

    def step(self, pts, color, width=2, dash=None, label=None):
        if not pts:
            return
        d = f"M{self.X(pts[0][0]):.1f},{self.Y(pts[0][1]):.1f}"
        for i in range(1, len(pts)):
            d += f" H{self.X(pts[i][0]):.1f} V{self.Y(pts[i][1]):.1f}"
        dash_a = f' stroke-dasharray="{dash}"' if dash else ""
        self.parts.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linejoin="round"{dash_a}/>')
        if label:
            x, y = pts[-1]
            self.parts.append(f'<text class="dlabel" x="{self.X(x) + 5:.1f}" y="{self.Y(y) + 4:.1f}">{esc(label)}</text>')

    def line(self, xs, ys, color, width=2, dash=None, label=None, label_at=None):
        pts = [(x, y) for x, y in zip(xs, ys) if self.x0 <= x <= self.x1 and y <= self.y1 * 1.001]
        if not pts:
            return
        d = " ".join(("M" if i == 0 else "L") + f"{self.X(x):.1f},{self.Y(y):.1f}" for i, (x, y) in enumerate(pts))
        dash_a = f' stroke-dasharray="{dash}"' if dash else ""
        self.parts.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linejoin="round"{dash_a}/>')
        if label:
            x, y = pts[-1] if label_at is None else min(pts, key=lambda p: abs(p[0] - label_at))
            self.parts.append(f'<text class="dlabel" x="{self.X(x) + 5:.1f}" y="{self.Y(y) + 4:.1f}">{esc(label)}</text>')

    def bars(self, items, color, bw, tip=None):
        """items: (x, value, tooltip)."""
        yb = self.Y(self.y0)
        for x, v, t in items:
            px = self.X(x) - bw / 2
            top = self.Y(v)
            hgt = max(yb - top, 0)
            r = min(4, hgt / 2, bw / 2)
            self.parts.append(f'<rect class="bar" x="{px:.1f}" y="{top:.1f}" width="{bw:.1f}" height="{hgt:.1f}" rx="{r:.1f}" fill="{color}" data-tip="{esc(t)}"/>')
            if hgt > r:  # прямой угол у основания
                self.parts.append(f'<rect x="{px:.1f}" y="{yb - r:.1f}" width="{bw:.1f}" height="{r:.1f}" fill="{color}"/>')

    def dots(self, items, color, r=4):
        for x, y, t in items:
            self.parts.append(f'<circle class="dot" cx="{self.X(x):.1f}" cy="{self.Y(y):.1f}" r="{r}" fill="{color}" stroke="var(--surface)" stroke-width="2" data-tip="{esc(t)}"/>')

    def hover_columns(self, items):
        """Невидимые колонки для наведения на графиках по дням: (x_from, x_to, tooltip)."""
        for xa, xb, t in items:
            self.parts.append(f'<rect class="hover" x="{self.X(xa):.1f}" y="{self.mt}" width="{self.X(xb) - self.X(xa):.1f}" height="{self.ph}" fill="transparent" data-tip="{esc(t)}"/>')

    def render(self, title: str, aria: str) -> str:
        return (f'<svg class="chart" viewBox="0 0 {self.w} {self.h}" role="img" aria-label="{esc(aria)}"><title>{esc(title)}</title>' + "".join(self.parts) + "</svg>")


# ---------- страница ----------


def page(D: Data, A: dict) -> str:
    K, n = A["K"], A["n_caps"]
    T_end = A["T_end"]
    tid = [t for t, _ in D.teams]
    color = {t: SLOTS[i] for i, t in enumerate(tid)}
    start_local = D.local(D.start)
    end_local = D.local(D.end)

    def date_of_day(day: float) -> dt.date:
        return (D.start + dt.timedelta(days=min(day, 3650)) + D.tz).date()

    def dday(day: float) -> str:
        return "больше года" if not math.isfinite(day) else dshort(date_of_day(day))

    def day_tick(day: float) -> str:
        return dshort(date_of_day(day))

    days = A["days"]
    daily = A["daily"]
    # ---- график 1: города, накопительно, факт + модели ----
    worst = A["scen"]["Запал гаснет"]["finish"][int(K * 0.95)][1]
    horizon = max((worst if math.isfinite(worst) else 90) + 7, 30)
    horizon = min(horizon, 120)
    c1 = Chart(h=320)
    c1.scales(0, horizon, 0, K + 2)
    c1.grid_y(range(0, K + 1, 11 if K > 40 else 5))
    c1.band(0, T_end, 0, K + 2, "var(--ink)")
    ticks = []
    step = 7 if horizon > 35 else 3
    for d in range(0, int(horizon) + 1, step):
        ticks.append((d, day_tick(d)))
    c1.ticks_x(ticks)
    c1.parts.append(f'<line class="grid strong" x1="{c1.ml}" x2="{c1.w - c1.mr}" y1="{c1.Y(K):.1f}" y2="{c1.Y(K):.1f}"/>')
    c1.parts.append(f'<text class="tick note" x="{c1.ml + 4}" y="{c1.Y(K) - 4:.1f}">все {K} городов</text>')
    scen_colors = {"Как сейчас": SLOTS[0], "Карта сопротивляется": SLOTS[1], "Запал гаснет": SLOTS[2]}
    for name, s in A["scen"].items():
        gx, gy = s["curve"]
        c1.line(list(gx), list(gy), scen_colors[name], width=2, dash="5 4", label=name, label_at=horizon - 1)
    # логистика по факту
    lx = np.arange(0, horizon, 0.25)
    ly = K / (1 + np.exp(-A["lr"] * (lx - A["lt0"])))
    c1.line(list(lx), list(ly), "var(--ink-3)", width=1.5, dash="2 3", label="логистика по факту", label_at=min(horizon - 2, A["log_days"][K - 1] if A["log_days"][K - 1] < horizon else horizon - 2))
    pts = [(0, 0)] + [(t, i + 1) for i, (t, _) in enumerate(A["caps"])] + [(T_end, n)]
    c1.step(pts, "var(--ink)", width=2.5, label=f"факт: {n}")
    c1.vline(T_end, "выгрузка")
    chart1 = c1.render("Города, накопительно: факт и сценарии", f"Взято {n} из {K} городов за {fmt(T_end)} суток; пунктиром сценарии до заполнения карты")

    # ---- график 2: по дням — задания, дела, активные ----
    def daily_chart(key, title, ylabel, per_team=True):
        c = Chart(h=220, ml=40)
        nd = len(days)
        vals = [sum(len(v) if key == "active" else v for v in daily[d][key].values()) if key == "active" else sum(daily[d][key].values()) for d in days]
        ymax = max(vals + [1])
        ymax = math.ceil(ymax / 5) * 5 if ymax > 10 else math.ceil(ymax) + 1
        c.scales(-0.5, nd - 0.5, 0, ymax)
        tick_step = max(1, ymax // 5)
        c.grid_y(range(0, ymax + 1, tick_step))
        c.ticks_x([(i, f"{dshort(d)} {RU_WD[d.weekday()]}") for i, d in enumerate(days)])
        slot = c.pw / nd
        bw = min(slot * 0.7 / (len(tid) if per_team else 1), 40)
        for i, d in enumerate(days):
            if per_team:
                for j, t in enumerate(tid):
                    v = len(daily[d][key][t]) if key == "active" else daily[d][key][t]
                    x = i + (j - (len(tid) - 1) / 2) * (bw / slot)
                    c.bars([(x, v, f"{dshort(d)} · {D.team_name[t]}: {v}")], color[t], bw - 2)
            else:
                v = vals[i]
                c.bars([(i, v, f"{dshort(d)}: {v}")], SLOTS[0], bw)
        tail = " · неполный день" if days and days[-1] == end_local.date() else ""
        head = " · старт вечером" if days else ""
        c.hover_columns([(i - 0.5, i + 0.5, f"{dfull(d)} ({RU_WD[d.weekday()]}): " + ", ".join(f"{D.team_name[t]} {len(daily[d][key][t]) if key == 'active' else daily[d][key][t]}" for t in tid) + (tail if d == days[-1] else head if i == 0 else "")) for i, d in enumerate(days)])
        return c.render(title, f"{title}: {ylabel} по дням")

    chart_tasks = daily_chart("tasks", "Решённых заданий в городах за день", "заданий")
    chart_deeds = daily_chart("deeds", "Одобренных дел за день", "дел")
    chart_active = daily_chart("active", "Участников, которые что-то решали или сдавали за день", "человек")
    chart_caps = daily_chart("captures", "Взятых городов за день", "городов")

    # ---- график 3: часы суток ----
    c3 = Chart(h=200, ml=40)
    hours = A["hours"]
    hmax = max(hours.values()) if hours else 1
    hmax = math.ceil(hmax / 10) * 10
    c3.scales(-0.5, 23.5, 0, hmax)
    c3.grid_y(range(0, hmax + 1, max(10, hmax // 4)))
    c3.ticks_x([(h, f"{h:02d}") for h in range(0, 24, 3)])
    c3.band(-0.5, 6.5, 0, hmax, "var(--ink)")
    c3.band(21.5, 23.5, 0, hmax, "var(--ink)")
    c3.parts.append(f'<text class="tick note" x="{c3.X(3):.1f}" y="{c3.mt + 12}" text-anchor="middle">ночь: задания закрыты</text>')
    c3.bars([(h, hours.get(h, 0), f"{h:02d}:00–{h:02d}:59 · {hours.get(h, 0)} заданий") for h in range(24)], SLOTS[0], c3.pw / 24 * 0.7)
    chart_hours = c3.render("Решённые задания по часам суток", "Распределение решённых заданий по часам местного времени")

    # ---- график 4: стоимость города ----
    cost = A["cost"]
    c4 = Chart(h=220, ml=40)
    hmax4 = max([c["hours"] for c in cost] + [24])
    hmax4 = math.ceil(hmax4 / 24) * 24
    c4.scales(-0.5, max(len(cost) - 0.5, 0.5), 0, hmax4)
    c4.grid_y(range(0, hmax4 + 1, 24), lambda v: f"{int(v)} ч")
    c4.ticks_x([(i, f"{int(c['at']) + 1}-й день") for i, c in enumerate(cost) if i % max(1, len(cost) // 6) == 0])
    bw4 = c4.pw / max(len(cost), 1) * 0.6
    for i, c in enumerate(cost):
        tip = f"{dfull(date_of_day(c['at']))} · {D.team_name[c['team']]} · {c['tasks']} заданий · {fmt(c['hours'], 0)} ч от первого задания до взятия" + (" · столица" if c["capital"] else "")
        c4.bars([(i, c["hours"], tip)], color[c["team"]], bw4)
    chart_cost = c4.render("Сколько часов занял каждый взятый город", "Часы от начала работы над городом до взятия, в порядке взятия; цвет — команда")

    # ---- гистограмма дат заполнения (Монте-Карло, базовый сценарий) ----
    legend_teams = "".join(f'<span class="lg"><i style="background:{color[t]}"></i>{esc(D.team_name[t])}</span>' for t in tid)
    legend_scen = "".join(f'<span class="lg"><i style="background:{scen_colors[s]}"></i>{esc(s)}</span>' for s in A["scen"]) + '<span class="lg"><i style="background:var(--ink)"></i>факт</span><span class="lg"><i style="background:var(--ink-3)"></i>логистика по факту</span>'

    # ---- таблицы ----
    def rows_days():
        out = []
        for d in days:
            dd = daily[d]
            out.append("<tr><td>" + esc(f"{dfull(d)} ({RU_WD[d.weekday()]})") + "</td>" + "".join(f"<td>{sum(dd[k].values()) if k != 'active' else len(set().union(*dd[k].values())) if dd[k] else 0}</td>" for k in ("captures", "tasks", "deeds", "reveals", "active")) + "</tr>")
        return "".join(out)

    milestones = [(K // 2, f"половина карты ({K // 2})"), (int(K * 0.95), f"почти вся карта ({int(K * 0.95)})"), (K, f"все города ({K})")]

    def scen_rows():
        out = []
        for name, s in A["scen"].items():
            cells = []
            for m, _ in milestones:
                lo, med, hi = s["finish"][m]
                cells.append(f"<td><b>{esc(dday(med))}</b><br><span class='muted'>{esc(dday(lo))} – {esc(dday(hi))}</span></td>")
            out.append(f"<tr><td><i class='sw' style='background:{scen_colors[name]}'></i>{esc(name)}</td>" + "".join(cells) + "</tr>")
        # линейная и логистическая оценки
        lin = A["lin_days"]
        out.append("<tr><td>Прямая по темпу последних дней</td>" + "".join(f"<td>{esc(dshort(date_of_day(T_end + lin[m])))}</td>" if lin[m] < 1e6 else "<td>—</td>" for m, _ in milestones) + "</tr>")
        lg = A["log_days"]
        out.append("<tr><td>Логистика по факту</td>" + "".join(f"<td>{esc(dshort(date_of_day(lg[m if m != K else K - 1])))}</td>" for m, _ in milestones) + "</tr>")
        return "".join(out)

    base = A["scen"]["Карта сопротивляется"]["finish"]
    opt = A["scen"]["Как сейчас"]["finish"]
    pes = A["scen"]["Запал гаснет"]["finish"]
    m95 = int(K * 0.95)
    forecast_line = f"{dday(opt[m95][1])} – {dday(pes[m95][1])}"
    base_line = dshort(date_of_day(base[int(K * 0.95)][1]))

    steady = A["steady_days"]
    steady_txt = f"{dshort(steady[0])} – {dshort(steady[-1])}" if steady else "—"
    team_cap = ", ".join(f"{D.team_name[t]} {fmt(np.mean(v) if v else 0, 0)}" for t, v in A["team_tasks"].items())
    ramp_days = A["ramp_end"]
    active_ever = {t: len(set().union(*[daily[d]["active"][t] for d in days])) for t in tid}
    night_before = sum(v for d, v in A["night_tasks"].items())
    islands = A["islands"]
    cap_isl = A["captured_by_island"]
    deadline = D.settings.get("endsAt")
    deadline_txt = dfull(dt.datetime.fromisoformat(deadline.replace("Z", "+00:00")).date()) if deadline else "не задан"
    review_med = st.median(A["review_min"]) if A["review_min"] else 0
    tts_med = st.median(A["take_to_submit"]) if A["take_to_submit"] else 0
    members_total = sum(D.members.values())
    export_stamp = f"{dfull(end_local.date())}, {end_local.strftime('%H:%M')}"

    css = """
:root{--paper:#f7f3ea;--surface:#fffdf8;--ink:#2b2117;--ink-2:#5b4d3f;--ink-3:#8a7b6a;--line:#e3dccd;--accent:#8a5a1c;--band:#efe7d6;--good:#1b7f4b;--warn:#b7791f;
 --fs-sm:.86rem;--fs:1.02rem;--fs-lg:1.25rem;--fs-xl:1.9rem}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--paper:#1a1713;--surface:#221e18;--ink:#f1e9dc;--ink-2:#cdbfa9;--ink-3:#9a8c78;--line:#3a332a;--accent:#d9a45b;--band:#2c261e;--good:#4cbf7f;--warn:#e0a23a}}
:root[data-theme="dark"]{--paper:#1a1713;--surface:#221e18;--ink:#f1e9dc;--ink-2:#cdbfa9;--ink-3:#9a8c78;--line:#3a332a;--accent:#d9a45b;--band:#2c261e;--good:#4cbf7f;--warn:#e0a23a}
body{background:var(--paper);color:var(--ink);font-family:"PT Sans","Segoe UI",system-ui,sans-serif;font-size:var(--fs);line-height:1.5;margin:0}
.wrap{max-width:860px;margin:0 auto;padding-block:28px 60px;padding-inline:16px}
h1,h2,h3{font-family:"PT Serif",Georgia,serif;font-weight:700;text-wrap:balance;line-height:1.2}
h1{font-size:var(--fs-xl);margin:0 0 6px}
h2{font-size:var(--fs-lg);margin:38px 0 10px;padding-top:14px;border-top:1px solid var(--line)}
h3{font-size:1.05rem;margin:22px 0 6px}
p{margin:8px 0;max-width:68ch}
.lead{color:var(--ink-2);margin-bottom:18px}
.eyebrow{font-size:var(--fs-sm);letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:18px 0}
.tile{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:12px 14px}
.tile .n{font-family:"PT Serif",Georgia,serif;font-size:1.7rem;line-height:1.1;font-variant-numeric:tabular-nums}
.tile .l{font-size:var(--fs-sm);color:var(--ink-2)}
.tile .s{font-size:var(--fs-sm);color:var(--ink-3)}
figure{margin:14px 0 22px;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:10px 10px 6px;position:relative}
figcaption{font-size:var(--fs-sm);color:var(--ink-2);padding:0 4px 6px}
figcaption b{color:var(--ink)}
svg.chart{width:100%;height:auto;display:block;font-family:"PT Sans",system-ui,sans-serif}
svg .grid{stroke:var(--line);stroke-width:1}
svg .grid.strong{stroke:var(--ink-3);stroke-dasharray:3 3}
svg .axis{stroke:var(--ink-3);stroke-width:1}
svg .marker{stroke:var(--ink-3);stroke-width:1;stroke-dasharray:4 3}
svg .tick{font-size:11px;fill:var(--ink-3)}
svg .tick.note{fill:var(--ink-2)}
svg .dlabel{font-size:11px;fill:var(--ink-2)}
svg .bar:hover,svg .dot:hover{opacity:.8}
.legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:var(--fs-sm);color:var(--ink-2);padding:4px 4px 2px}
.lg i,.sw{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-1px}
.tip{position:fixed;pointer-events:none;background:var(--ink);color:var(--paper);font-size:.82rem;padding:5px 8px;border-radius:5px;max-width:280px;z-index:9;display:none}
table{border-collapse:collapse;width:100%;font-size:var(--fs-sm);background:var(--surface);border:1px solid var(--line);border-radius:8px;overflow:hidden}
th,td{padding:7px 9px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top;font-variant-numeric:tabular-nums}
th{color:var(--ink-2);font-weight:600;background:var(--band)}
tr:last-child td{border-bottom:0}
.tbl{overflow-x:auto;margin:10px 0}
.muted{color:var(--ink-3)}
ul{padding-left:20px;max-width:70ch}li{margin:4px 0}
.note{background:var(--band);border-left:3px solid var(--accent);padding:10px 14px;border-radius:0 6px 6px 0;margin:14px 0;max-width:70ch}
code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.9em;background:var(--band);padding:1px 5px;border-radius:4px}
pre{background:var(--band);padding:10px 12px;border-radius:6px;overflow-x:auto;font-size:.86rem}
.two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media (max-width:640px){.two{grid-template-columns:1fr}}
@media (prefers-reduced-motion:no-preference){svg .bar{transition:opacity .15s}}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
"""
    js = """
(function(){var tip=document.createElement('div');tip.className='tip';document.body.appendChild(tip);
function show(e){var t=e.target.getAttribute('data-tip');if(!t){tip.style.display='none';return;}tip.textContent=t;tip.style.display='block';
 var x=e.clientX+12,y=e.clientY+14;if(x+tip.offsetWidth>window.innerWidth-8)x=e.clientX-tip.offsetWidth-8;if(y+tip.offsetHeight>window.innerHeight-8)y=e.clientY-tip.offsetHeight-8;tip.style.left=x+'px';tip.style.top=y+'px';}
document.querySelectorAll('svg.chart').forEach(function(s){s.addEventListener('mousemove',show);s.addEventListener('mouseleave',function(){tip.style.display='none';});s.addEventListener('touchstart',function(e){var t=e.target.getAttribute('data-tip');if(t){show({target:e.target,clientX:e.touches[0].clientX,clientY:e.touches[0].clientY});}},{passive:true});});})();
"""

    def team_list():
        return ", ".join(f"{esc(nm)} ({D.members[t]} чел.)" for t, nm in D.teams)

    html_out = f"""<title>Темп «{esc(D.game_name)}»</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=PT+Serif:wght@400;700&family=PT+Sans:wght@400;700&display=swap">
<style>{css}</style>
<div class="wrap">
<div class="eyebrow">Исследование · партия «{esc(D.game_name)}» · выгрузка {esc(export_stamp)}</div>
<h1>Как быстро идёт игра и когда закончится карта</h1>
<p class="lead">Партия стартовала {esc(dfull(start_local.date()))} в {start_local.strftime('%H:%M')}; данных — {esc(fmt(T_end))} суток. Команды: {team_list()}. На карте {K} городов ({islands.get('OT', 0)} на ветхозаветном острове, {islands.get('NT', 0)} на новозаветном) и {D.nodes_total} узлов. Срок окончания в настройках — {esc(deadline_txt)}.</p>

<div class="tiles">
 <div class="tile"><div class="n">{n} <span class="muted">из {K}</span></div><div class="l">городов взято</div><div class="s">{cap_isl.get('OT', 0)} на ВЗ, {cap_isl.get('NT', 0)} на НЗ</div></div>
 <div class="tile"><div class="n">{esc(fmt(A['rate_now']))}</div><div class="l">городов в сутки сейчас</div><div class="s">после разгона, с {esc(dshort(date_of_day(ramp_days)))}</div></div>
 <div class="tile"><div class="n">{esc(fmt(A['cap_total'], 0))}</div><div class="l">заданий в сутки, все команды</div><div class="s">средний полный день ({esc(steady_txt)})</div></div>
 <div class="tile"><div class="n">{esc(forecast_line)}</div><div class="l">почти вся карта ({m95} городов)</div><div class="s">медианы лучшего и худшего сценария</div></div>
</div>

<div class="note"><b>Главное.</b> Темп не линейный: первые двое суток команды почти не брали городов (строили дороги делами), затем взятия пошли сериями. Дальше темп будет падать: свободные города дальше от команд, часть — за морем, за одни и те же города начнут бороться, а с 3 октября ночью задания закрыты. Поэтому прямая по сегодняшнему темпу даёт самую раннюю дату, а реалистичнее — базовый сценарий «карта сопротивляется»: почти вся карта к <b>{esc(base_line)}</b>. Данных пока {esc(fmt(T_end, 0))} дней, разброс большой; после каждой новой выгрузки отчёт пересчитывается одной командой.</div>

<h2>1. Что считали</h2>
<p>Источник — выгрузка одной партии скриптом на сервере (<code>deploy/research-export.sh</code>): летопись событий, состояние городов, дела на сторонах, открытые узлы. Имена участников в отчёт не попадают, только команды, время и счётчики. Время в базе хранится в UTC; здесь всё переведено в пояс игры (UTC+{int(D.tz.total_seconds() // 3600)}).</p>
<ul>
<li><b>Город взят</b> — событие летописи «взяла город» (первый взятый город команды становится столицей и тоже считается).</li>
<li><b>Задание решено</b> — событие «задание решено» в городе; это главный расход сил: на город уходит {esc(fmt(A['tasks_per_city'], 0))} заданий (медиана по взятым).</li>
<li><b>Дело одобрено</b> — администратор принял сдачу дела на стороне; дело открывает дорогу к следующему узлу.</li>
<li><b>Активный участник</b> — за день решал задание, сдавал дело или открыл порядок города. За всё время активны {sum(active_ever.values())} из {members_total} записанных в команды.</li>
</ul>

<h2>2. Ход игры по дням</h2>
<figure><div class="legend">{legend_teams}</div>{chart_caps}<figcaption>Взятые города по дням. Цвет — команда. Первый полный день ушёл на дороги, взятия начались сериями.</figcaption></figure>
<figure><div class="legend">{legend_teams}</div>{chart_tasks}<figcaption>Решённые задания — основная «работа» команд. Серии по выходным видны уже сейчас, но будни первой недели были ещё и разгоном (раздел 3).</figcaption></figure>
<div class="two">
<figure><div class="legend">{legend_teams}</div>{chart_deeds}<figcaption>Одобренные дела: {len([r for r in D.edge_tasks if r['status'] == 'APPROVED'])} за всё время. От взятия дела до сдачи — медиана {esc(fmt(tts_med, 0))} ч; проверка администратором — медиана {esc(fmt(review_med, 0))} мин.</figcaption></figure>
<figure><div class="legend">{legend_teams}</div>{chart_active}<figcaption>Сколько человек в день реально что-то делали. Это ранний признак угасания: если число падает две недели подряд, темп упадёт следом.</figcaption></figure>
</div>
<div class="tbl"><table><thead><tr><th>День</th><th>Городов</th><th>Заданий</th><th>Дел</th><th>Открыто узлов</th><th>Активных</th></tr></thead><tbody>{rows_days()}</tbody></table></div>

<h2>3. Почему скорость не линейная</h2>
<p>Ход партии — конвейер: <b>дело → дорога → город → {esc(fmt(A['tasks_per_city'], 0))} заданий → взятие</b>. Каждое звено ограничено по-своему, и ограничения меняются по ходу игры.</p>
<ul>
<li><b>Разгон.</b> До {esc(dshort(date_of_day(ramp_days)))} команды только строили дороги: {sum(sum(daily[d]['deeds'].values()) for d in days if D.day(dt.datetime.combine(d, dt.time()) - D.tz) < ramp_days)} дел и 1 город. Потом города пошли серией: взятие открывает соседей, и у команды сразу несколько целей.</li>
<li><b>Ночь.</b> С 3 октября задания в городах закрыты с 00:00 до 07:00 по поясу игры. До правила ночью решили {night_before} заданий (график ниже), теперь это окно пропадает.</li>
<li><b>Неделя.</b> Пятница–воскресенье дали {A['wd'].get(4, 0) + A['wd'].get(5, 0) + A['wd'].get(6, 0)} решённых заданий, понедельник–четверг — {sum(A['wd'].get(i, 0) for i in range(4))}. Пока это наложилось на разгон, так что чистый вес выходных станет виден со второй недели.</li>
<li><b>Море.</b> Все три старта на ветхозаветном острове; из {islands.get('NT', 0)} новозаветных городов открыто {len([k for k in A['revealed_cities'] if D.nodes[k]['island'] == 'NT'])}, высадок было {len(A['sea_landed'])}. Переправа и дорога от пристани — лишние звенья, вторая половина карты будет идти медленнее.</li>
<li><b>Столкновения.</b> Уже {len(A['in_progress'])} городов в работе одновременно, и есть города, где одна команда решила все задания, а взяла другая. Чем меньше свободных городов, тем больше сил уходит впустую или на испытания, которые город не прибавляют.</li>
<li><b>Лимит дел.</b> Не больше одного дела в день на человека: при {members_total} участниках и {esc(fmt(D.settings.get('mapStats', {}).get('avgCityGap', 2), 1))} сторонах между городами это потолок порядка {esc(fmt(members_total / float(D.settings.get('mapStats', {}).get('avgCityGap', 2) or 2), 0))} новых городов в сутки, но реальный темп ограничен заданиями: {esc(fmt(A['cap_total'], 0))} заданий в сутки ≈ {esc(fmt(A['cap_total'] / A['tasks_per_city']))} города.</li>
</ul>
<figure>{chart_hours}<figcaption>Задания по часам местного времени за всё время. Пики — обед и вечер; ночные решения были до запрета.</figcaption></figure>
<figure><div class="legend">{legend_teams}</div>{chart_cost}<figcaption>Сколько часов занял каждый взятый город (от первого задания до взятия), в порядке взятия. Если столбики растут слева направо — города дорожают.</figcaption></figure>

<h2>4. Прогноз</h2>
<p>Прогноз — когда все {K} городов будут у кого-то из команд, то есть карта занята. Это не конец партии по правилам: дальше идут испытания за города и столицы, а их темп по {len(D.battles)} испытаниям предсказать нельзя. Срок окончания в настройках ({esc(deadline_txt)}) — отдельная граница.</p>
<p>Три сценария считаются одинаково: каждый день каждая команда решает столько заданий, сколько в случайный полный день после разгона, город стоит случайное число заданий из уже взятых; так прогоняется 1500 раз, и берутся медиана и коридор 10–90 %. Отличия:</p>
<ul>
<li><b>Как сейчас</b> — темп не меняется. Это нижняя граница по времени.</li>
<li><b>Карта сопротивляется</b> (базовый) — отдача падает пропорционально доле свободных городов: чем их меньше, тем они дальше, за морем и спорнее.</li>
<li><b>Запал гаснет</b> — то же плюс активность снижается на 15 % в неделю. Это допущение, не наблюдение: по {esc(fmt(T_end, 0))} дням угасания ещё не видно.</li>
</ul>
<figure><div class="legend">{legend_scen}</div>{chart1}<figcaption>Города накопительно. Сплошная — факт; пунктир — медианы сценариев; точечная — логистическая кривая с потолком {K}, подобранная по факту.</figcaption></figure>
<div class="tbl"><table><thead><tr><th>Сценарий</th>{''.join(f'<th>{esc(l)}</th>' for _, l in milestones)}</tr></thead><tbody>{scen_rows()}</tbody></table></div>
<p class="muted">В строках сценариев: медиана и коридор 10–90 % по прогонам. «Прямая» — остаток делится на темп после разгона ({esc(fmt(A['rate_now']))} города в сутки). Логистика подобрана по {n} точкам — на старте кривой она доверия не заслуживает и показана только для сравнения формы.</p>

<h2>5. Что нужно, чтобы прогноз стал точнее</h2>
<ul>
<li><b>Свежая выгрузка раз в неделю.</b> На сервере: <code>bash /opt/lotw/deploy/research-export.sh "{esc(D.game_name)}"</code>, затем скачать архив и передать. Отчёт пересобирается командой <code>python3 scripts/pace-report.py &lt;папка&gt;</code>. Через две недели будет видно вес выходных и угасание, через четыре — море и столкновения.</li>
<li><b>Данные о море.</b> Пока {len(A['sea_landed'])} высадки: когда наберётся десяток, можно оценить, насколько новозаветные города дороже.</li>
<li><b>Испытания.</b> Их {len(D.battles)}; чтобы прогнозировать конец партии по правилам (столицы), нужны их частота и исход, это другая модель.</li>
</ul>
</div>
<script>{js}</script>
"""
    return html_out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("export_dir")
    ap.add_argument("--out", default=None)
    ap.add_argument("--tz", type=float, default=5.0, help="смещение пояса игры от UTC в часах")
    a = ap.parse_args()
    D = Data(a.export_dir, a.tz)
    A = analyse(D)
    out = a.out or f"pace-{D.game_name}-{D.local(D.end).date()}.html"
    with open(out, "w", encoding="utf-8") as f:
        f.write(page(D, A))
    base = A["scen"]["Карта сопротивляется"]["finish"]
    print(f"{out}: взято {A['n_caps']} из {A['K']}, темп {A['rate_now']:.2f}/сут, базовый сценарий — все города через {base[A['K']][1] - A['T_end']:.0f} дней")


if __name__ == "__main__":
    main()
