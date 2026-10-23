import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../lib/api";
import { t, getLocale } from "../lib/i18n";
import { Chart, baseOption, chartColors } from "../components/Chart";
import { Tabs } from "../components/Tabs";
import { ErrorState, LoadingState } from "../components/State";
import { Help } from "../components/Help";

/**
 * Графики аналитики (решение владельца 23.10): полноразмерные, с ползунком масштаба под каждым.
 * Активность — любое открытие приложения. WAU и MAU календарные (понедельник–воскресенье, месяц). Разрезы: все,
 * администраторы, участники. Удержание — по когортам недели регистрации.
 */
interface Split { all: number; admins: number; players: number }
interface Analytics {
  tz: string; today: string;
  dau: Array<{ key: string } & Split>; wau: Array<{ key: string } & Split>; mau: Array<{ key: string } & Split>;
  newUsers: Array<{ key: string; total: Split } & Split>;
  cohorts: Array<{ week: string; size: number; d7: number | null; d30: number | null; d90: number | null }>;
  retention: Array<{ day: number; pct: number | null; base: number }>;
  users: Split;
}
type Grain = "D" | "W" | "M";
const locale = () => (getLocale() === "en" ? "en-GB" : "ru-RU");
const dayLabel = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString(locale(), { day: "numeric", month: "short", timeZone: "UTC" });
const weekLabel = (iso: string) => t("нед. с {d}", { d: dayLabel(iso) });
const monthLabel = (ym: string) => new Date(ym + "-01T00:00:00Z").toLocaleDateString(locale(), { month: "short", year: "2-digit", timeZone: "UTC" });
const weekOf = (iso: string) => { const d = new Date(iso + "T00:00:00Z"); const dow = (d.getUTCDay() + 6) % 7; return new Date(d.getTime() - dow * 86_400_000).toISOString().slice(0, 10); };

export function AnalyticsCharts() {
  const [a, setA] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grain, setGrain] = useState<Grain>("D");
  const [activeGrain, setActiveGrain] = useState<Grain>("D");
  const grainTabs = (value: Grain, onChange: (g: Grain) => void) => <Tabs<Grain> value={value} onChange={onChange} ariaLabel={t("Шаг")} items={[{ key: "D", label: "D" }, { key: "W", label: "W" }, { key: "M", label: "M" }]} />;
  const load = () => { setA(null); setError(null); api<Analytics>("/api/admin/analytics").then(setA).catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети"))); };
  useEffect(load, []);
  const c = useMemo(chartColors, []);
  const splitSeries = (rows: Array<{ key: string } & Split>, labelOf: (k: string) => string, title: string) => baseOption(c, {
    xAxis: { type: "category", data: rows.map((r) => labelOf(r.key)), axisLabel: { color: c.muted }, axisLine: { lineStyle: { color: c.border } } },
    yAxis: { type: "value", minInterval: 1, axisLabel: { color: c.muted }, splitLine: { lineStyle: { color: c.border, opacity: 0.6 } } },
    // Стеком (решение владельца 23.10): участники + администраторы, высота столбца — все; «все» в подсказке.
    tooltip: { trigger: "axis", backgroundColor: c.surface, borderColor: c.border, textStyle: { color: c.text, fontFamily: c.font }, formatter: (ps: Array<{ axisValue: string; seriesName: string; value: number; marker: string }>) => { const total = ps.reduce((a, p) => a + (p.value || 0), 0); return `${ps[0]?.axisValue ?? ""}<br/>${ps.map((p) => `${p.marker} ${p.seriesName}: <b>${p.value}</b>`).join("<br/>")}<br/>${t("все")}: <b>${total}</b>`; } },
    series: [
      { name: t("участники"), type: "bar", stack: "users", data: rows.map((r) => r.players), itemStyle: { color: c.info }, barMaxWidth: 36 },
      { name: t("администраторы"), type: "bar", stack: "users", data: rows.map((r) => r.admins), itemStyle: { color: c.success }, barMaxWidth: 36 },
    ],
    title: undefined, aria: { label: { description: title } },
  });
  // Активные одним графиком (решение владельца 23.10): D — по дням (DAU), W — по календарным неделям (WAU), M — по месяцам (MAU).
  const active = useMemo(() => (a ? (activeGrain === "D" ? splitSeries(a.dau, dayLabel, "DAU") : activeGrain === "W" ? splitSeries(a.wau, weekLabel, "WAU") : splitSeries(a.mau, monthLabel, "MAU")) : null), [a, c, activeGrain]); // eslint-disable-line react-hooks/exhaustive-deps
  // Новые: по дням, неделям или месяцам — переключатель Д/Н/М.
  const fresh = useMemo(() => {
    if (!a) return null;
    const groups = new Map<string, Split>();
    for (const r of a.newUsers) { const k = grain === "D" ? r.key : grain === "W" ? weekOf(r.key) : r.key.slice(0, 7); const g = groups.get(k) ?? { all: 0, admins: 0, players: 0 }; groups.set(k, { all: g.all + r.all, admins: g.admins + r.admins, players: g.players + r.players }); }
    const rows = [...groups.entries()].map(([key, s]) => ({ key, ...s }));
    return splitSeries(rows, grain === "D" ? dayLabel : grain === "W" ? weekLabel : monthLabel, t("Новые"));
  }, [a, grain, c]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = useMemo(() => a && baseOption(c, {
    xAxis: { type: "category", data: a.newUsers.map((r) => dayLabel(r.key)), axisLabel: { color: c.muted }, axisLine: { lineStyle: { color: c.border } } },
    yAxis: { type: "value", minInterval: 1, axisLabel: { color: c.muted }, splitLine: { lineStyle: { color: c.border, opacity: 0.6 } } },
    series: [
      { name: t("все"), type: "line", data: a.newUsers.map((r) => r.total.all), itemStyle: { color: c.accent }, lineStyle: { width: 2 }, showSymbol: false, areaStyle: { opacity: 0.12 } },
      { name: t("участники"), type: "line", data: a.newUsers.map((r) => r.total.players), itemStyle: { color: c.info }, showSymbol: false },
      { name: t("администраторы"), type: "line", data: a.newUsers.map((r) => r.total.admins), itemStyle: { color: c.success }, showSymbol: false },
    ],
  }), [a, c]);
  // Удержание в среднем (уточнение владельца 23.10): по горизонтали дни после регистрации, по вертикали доля вернувшихся спустя столько дней или позже.
  const retention = useMemo(() => a && baseOption(c, {
    xAxis: { type: "category", data: a.retention.map((r) => String(r.day)), name: t("дней после регистрации"), nameLocation: "middle", nameGap: 28, nameTextStyle: { color: c.muted }, axisLabel: { color: c.muted, interval: 6 } },
    yAxis: { type: "value", min: 0, max: 100, axisLabel: { color: c.muted, formatter: "{value}%" }, splitLine: { lineStyle: { color: c.border, opacity: 0.6 } } },
    legend: undefined,
    tooltip: { trigger: "axis", backgroundColor: c.surface, borderColor: c.border, textStyle: { color: c.text, fontFamily: c.font }, formatter: (ps: Array<{ dataIndex: number }>) => { const r = a.retention[ps[0]?.dataIndex ?? 0]!; return `${t("через {n} дней", { n: r.day })}: <b>${r.pct == null ? "—" : r.pct + "%"}</b><br/>${t("из {n} чел.", { n: r.base })}`; } },
    series: [{ name: t("вернулись"), type: "line", data: a.retention.map((r) => r.pct), itemStyle: { color: c.success }, lineStyle: { width: 2 }, showSymbol: false, areaStyle: { opacity: 0.12 }, connectNulls: false,
      markPoint: { symbol: "circle", symbolSize: 12, itemStyle: { color: c.accent }, label: { show: true, color: c.text, fontWeight: "bold", position: "top", distance: 8, formatter: (p: { value: number | null }) => (p.value == null ? "" : `${p.value}%`) }, data: [7, 30, 90].map((d) => ({ coord: [String(d), a.retention[d - 1]?.pct ?? null], value: a.retention[d - 1]?.pct ?? null })).filter((m) => m.value != null) } }],
  }), [a, c]);

  if (error) return <div className="card"><ErrorState text={error} onRetry={load} /></div>;
  if (!a || !active || !fresh || !total || !retention) return <div className="card"><LoadingState /></div>;
  const head = (title: string, help: string) => <div className="card-head"><h2>{title}<Help>{help}</Help></h2></div>;
  return (
    <div className="chart-grid">
      <div className="card">
        <div className="card-head"><h2>{t("Активные")}<Help>{t("Сколько разных людей открывали приложение. D — за день (DAU), W — за календарную неделю с понедельника по воскресенье (WAU), M — за календарный месяц (MAU); текущие неделя и месяц неполные. Любое открытие считается: посмотреть карту тоже. Сутки — по поясу {tz}. Тестовые аккаунты не считаются. Администратор — администратор хоть одной игры или платформы, участники — остальные. До 23 октября дни восстановлены из действий: кто только смотрел, в прошлом не учтён.", { tz: a.tz })}</Help></h2>{grainTabs(activeGrain, setActiveGrain)}</div>
        <Chart option={active} />
      </div>
      <div className="card">
        <div className="card-head"><h2>{t("Новые")}<Help>{t("Регистрации по дате создания аккаунта.")}</Help></h2>{grainTabs(grain, setGrain)}</div>
        <Chart option={fresh} />
      </div>
      <div className="card">{head(t("Всего пользователей"), t("Накопительно по дате регистрации."))}<Chart option={total} /></div>
      <div className="card">{head(t("Удержание"), t("Как читать: точка «7» — из всех, кто зарегистрировался не меньше 7 дней назад, столько процентов открывали приложение спустя 7 дней или позже. Точка «30» — то же про 30 дней. Чем правее, тем меньше людей успели дожить до этого срока: в подсказке показано, из скольких человек считается; меньше пяти — точки нет."))}<Chart option={retention} /></div>
    </div>
  );
}
