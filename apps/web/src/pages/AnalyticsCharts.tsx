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
  cohorts: Array<{ week: string; size: number; weeks: Array<{ n: number; active: number; pct: number }> }>;
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
  const load = () => { setA(null); setError(null); api<Analytics>("/api/admin/analytics").then(setA).catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети"))); };
  useEffect(load, []);
  const c = useMemo(chartColors, []);
  const splitSeries = (rows: Array<{ key: string } & Split>, labelOf: (k: string) => string, title: string) => baseOption(c, {
    xAxis: { type: "category", data: rows.map((r) => labelOf(r.key)), axisLabel: { color: c.muted }, axisLine: { lineStyle: { color: c.border } } },
    yAxis: { type: "value", minInterval: 1, axisLabel: { color: c.muted }, splitLine: { lineStyle: { color: c.border, opacity: 0.6 } } },
    series: [
      { name: t("все"), type: "bar", data: rows.map((r) => r.all), itemStyle: { color: c.accent }, barMaxWidth: 28 },
      { name: t("участники"), type: "bar", data: rows.map((r) => r.players), itemStyle: { color: c.info }, barMaxWidth: 28 },
      { name: t("администраторы"), type: "bar", data: rows.map((r) => r.admins), itemStyle: { color: c.success }, barMaxWidth: 28 },
    ],
    title: undefined, aria: { label: { description: title } },
  });
  const dau = useMemo(() => (a ? splitSeries(a.dau, dayLabel, "DAU") : null), [a, c]); // eslint-disable-line react-hooks/exhaustive-deps
  const wau = useMemo(() => (a ? splitSeries(a.wau, weekLabel, "WAU") : null), [a, c]); // eslint-disable-line react-hooks/exhaustive-deps
  const mau = useMemo(() => (a ? splitSeries(a.mau, monthLabel, "MAU") : null), [a, c]); // eslint-disable-line react-hooks/exhaustive-deps
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
  // Удержание по когортам: тепловая карта «когорта × недели после регистрации» и линия «вернулись через неделю».
  const cohortRows = useMemo(() => (a ? a.cohorts.filter((k) => k.size > 0) : []), [a]);
  const maxN = cohortRows.reduce((m, k) => Math.max(m, k.weeks.length - 1), 0);
  const heat = useMemo(() => a && baseOption(c, {
    tooltip: { trigger: "item", backgroundColor: c.surface, borderColor: c.border, textStyle: { color: c.text, fontFamily: c.font }, formatter: (p: { value: [number, number, number] }) => { const k = cohortRows[p.value[1]]!; const w = k.weeks[p.value[0]]!; return `${weekLabel(k.week)} · ${t("когорта {n}", { n: k.size })}<br/>${t("через {n} нед.", { n: w.n })}: <b>${w.pct}%</b> (${w.active})`; } },
    legend: undefined, dataZoom: [{ type: "slider", yAxisIndex: 0, right: 4, width: 16, borderColor: c.border, fillerColor: "rgba(168,114,46,0.18)", handleStyle: { color: c.accent } }],
    grid: { left: 12, right: 40, top: 12, bottom: 64, containLabel: true },
    xAxis: { type: "category", data: Array.from({ length: maxN + 1 }, (_, n) => (n === 0 ? t("нед. 0") : `+${n}`)), axisLabel: { color: c.muted }, splitArea: { show: true } },
    yAxis: { type: "category", data: cohortRows.map((k) => `${dayLabel(k.week)} · ${k.size}`), axisLabel: { color: c.muted } },
    visualMap: { min: 0, max: 100, calculable: false, orient: "horizontal", left: "center", bottom: 0, text: ["100%", "0%"], textStyle: { color: c.muted }, inRange: { color: [c.surface, c.accent] } },
    series: [{ type: "heatmap", data: cohortRows.flatMap((k, y) => k.weeks.map((w) => [w.n, y, w.pct])), label: { show: true, color: c.text, formatter: (p: { value: [number, number, number] }) => `${p.value[2]}` }, itemStyle: { borderColor: c.surface, borderWidth: 2 } }],
  }), [a, c, cohortRows, maxN]);
  const week1 = useMemo(() => a && baseOption(c, {
    xAxis: { type: "category", data: cohortRows.filter((k) => k.weeks.length > 1).map((k) => dayLabel(k.week)), axisLabel: { color: c.muted } },
    yAxis: { type: "value", min: 0, max: 100, axisLabel: { color: c.muted, formatter: "{value}%" }, splitLine: { lineStyle: { color: c.border, opacity: 0.6 } } },
    legend: undefined,
    series: [{ name: t("вернулись через неделю"), type: "line", data: cohortRows.filter((k) => k.weeks.length > 1).map((k) => k.weeks[1]!.pct), itemStyle: { color: c.success }, lineStyle: { width: 2 }, label: { show: true, color: c.text, formatter: "{c}%" } }],
  }), [a, c, cohortRows]);

  if (error) return <div className="card"><ErrorState text={error} onRetry={load} /></div>;
  if (!a || !dau || !wau || !mau || !fresh || !total || !heat || !week1) return <div className="card"><LoadingState /></div>;
  const head = (title: string, help: string) => <div className="card-head"><h2>{title}<Help>{help}</Help></h2></div>;
  return (
    <div className="chart-grid">
      <div className="card">{head(t("Активные за день (DAU)"), t("Сколько разных людей открывали приложение в этот день. Любое открытие считается: посмотреть карту тоже. Сутки — по поясу {tz}. Тестовые аккаунты не считаются. Администратор — администратор хоть одной игры или платформы, участники — остальные. До 23 октября дни восстановлены из действий: кто только смотрел, в прошлом не учтён.", { tz: a.tz }))}<Chart option={dau} /></div>
      <div className="card">{head(t("Активные за неделю (WAU)"), t("Разные люди за календарную неделю с понедельника по воскресенье. Текущая неделя неполная."))}<Chart option={wau} /></div>
      <div className="card">{head(t("Активные за месяц (MAU)"), t("Разные люди за календарный месяц. Текущий месяц неполный."))}<Chart option={mau} /></div>
      <div className="card">
        <div className="card-head"><h2>{t("Новые")}<Help>{t("Регистрации по дате создания аккаунта.")}</Help></h2><Tabs<Grain> value={grain} onChange={setGrain} ariaLabel={t("Шаг")} items={[{ key: "D", label: t("Д") }, { key: "W", label: t("Н") }, { key: "M", label: t("М") }]} /></div>
        <Chart option={fresh} />
      </div>
      <div className="card">{head(t("Всего пользователей"), t("Накопительно по дате регистрации."))}<Chart option={total} /></div>
      <div className="card wide">{head(t("Удержание по когортам"), t("Строка — неделя регистрации и размер когорты. Столбец — сколько недель прошло: 0 — сама неделя регистрации, +1 — следующая и так далее. В ячейке — доля когорты, открывавшая приложение на той неделе."))}<Chart option={heat} height={Math.max(220, 40 + cohortRows.length * 34)} /></div>
      <div className="card">{head(t("Вернулись через неделю"), t("Доля когорты, активная на следующей неделе после регистрации. Когорты без следующей недели ещё не показаны."))}<Chart option={week1} height={240} /></div>
    </div>
  );
}
