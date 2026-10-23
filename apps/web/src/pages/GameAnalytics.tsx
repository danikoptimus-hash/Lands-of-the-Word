import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../lib/api";
import { t, getLocale } from "../lib/i18n";
import { Chart, baseOption, chartColors } from "../components/Chart";
import { ErrorState, LoadingState } from "../components/State";
import { Help } from "../components/Help";

/**
 * Темп партии для администратора игры (решение владельца 23.10; уточнение: «оставить только логистическую кривую,
 * факт и прогноз», «добавить график с количеством дел в день»). Первый график — города накопительно: сплошная — факт,
 * пунктир — медиана прогноза при текущем темпе, точечная — логистическая кривая. Второй — принятые дела в день, стеком по командам.
 */
interface Pt { day: number; value: number }
interface Pace {
  tz: string; startedAt: string; now: string; T: number; K: number; n: number; rate: number; rampDay: number; dailyTasksAvg: number; milestones: number[];
  teams: Array<{ id: string; name: string; color: string }>;
  fact: Array<Pt & { teamId: string | null }>;
  deeds: { days: string[]; teams: Array<{ id: string; name: string; color: string; values: number[] }> };
  logistic: { r: number; t0: number; curve: Pt[]; finish: Record<string, number | null> };
  scenarios: Array<{ name: string; curve: Pt[]; finish: Record<string, Array<number | null>> }>;
}
const locale = () => (getLocale() === "en" ? "en-GB" : "ru-RU");
const dayLabel = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString(locale(), { day: "numeric", month: "short", timeZone: "UTC" });

export function GameAnalytics({ gameId }: { gameId: string }) {
  const [p, setP] = useState<Pace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => { setP(null); setError(null); api<Pace>(`/api/games/${gameId}/analytics/pace`).then(setP).catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети"))); };
  useEffect(load, [gameId]); // eslint-disable-line react-hooks/exhaustive-deps
  const c = useMemo(chartColors, []);
  const dateOf = (day: number) => { if (!p) return ""; const d = new Date(Date.parse(p.startedAt) + Math.min(day, 3650) * 86_400_000); return d.toLocaleDateString(locale(), { day: "numeric", month: "short", timeZone: p.tz }); };
  const fmtDay = (day: number | null | undefined) => (day == null || !Number.isFinite(day) ? t("больше года") : dateOf(day));
  const forecast = p?.scenarios[0] ?? null;
  const option = useMemo(() => {
    if (!p) return null;
    const last = forecast?.finish[String(p.K)]?.[2] ?? forecast?.finish[String(p.milestones[1])]?.[1] ?? null;
    const horizon = Math.min(Math.max((last ?? 90) + 7, p.T + 14, 30), p.T + 120);
    const fact: Array<[number, number]> = [[0, 0], ...p.fact.map((f) => [f.day, f.value] as [number, number]), [p.T, p.n]];
    return baseOption(c, {
      legend: { top: 0, textStyle: { color: c.muted }, data: [t("факт"), t("Прогноз"), t("логистическая кривая")] },
      tooltip: { trigger: "axis", backgroundColor: c.surface, borderColor: c.border, textStyle: { color: c.text, fontFamily: c.font }, formatter: (ps: Array<{ seriesName: string; value: [number, number]; marker: string }>) => { const d = ps[0]?.value[0] ?? 0; return `${dateOf(d)}<br/>${ps.map((x) => `${x.marker} ${x.seriesName}: <b>${Math.round(x.value[1])}</b>`).join("<br/>")}`; } },
      xAxis: { type: "value", min: 0, max: horizon, interval: horizon > 60 ? 14 : 7, axisLabel: { color: c.muted, formatter: (v: number) => dateOf(v) }, axisLine: { lineStyle: { color: c.border } }, splitLine: { show: false } },
      yAxis: { type: "value", min: 0, max: p.K + 2, minInterval: 1, axisLabel: { color: c.muted }, splitLine: { lineStyle: { color: c.border, opacity: 0.6 } } },
      dataZoom: [{ type: "inside", filterMode: "none" }, { type: "slider", filterMode: "none", height: 22, bottom: 10, borderColor: c.border, fillerColor: "rgba(168,114,46,0.18)", handleStyle: { color: c.accent }, textStyle: { color: c.muted }, labelFormatter: (v: number) => dateOf(v) }],
      series: [
        { name: t("факт"), type: "line", step: "end", data: fact, itemStyle: { color: c.text }, lineStyle: { width: 2.5, color: c.text }, showSymbol: false, z: 5 },
        { name: t("все {n} городов", { n: p.K }), type: "line", data: [[0, p.K], [horizon, p.K]], itemStyle: { color: c.muted }, lineStyle: { width: 1, color: c.muted }, showSymbol: false, silent: true, tooltip: { show: false }, endLabel: { show: true, formatter: t("все {n} городов", { n: p.K }), color: c.muted, offset: [-8, -10], align: "right" } },
        { name: t("сегодня"), type: "line", data: [[p.T, 0], [p.T, p.K + 2]], itemStyle: { color: c.accent }, lineStyle: { width: 1, color: c.accent }, showSymbol: false, silent: true, tooltip: { show: false }, endLabel: { show: true, formatter: t("сегодня"), color: c.accent, offset: [6, 8] } },
        ...(forecast ? [{ name: t("Прогноз"), type: "line", data: forecast.curve.map((q) => [q.day, q.value]), itemStyle: { color: c.success }, lineStyle: { width: 2, type: "dashed", color: c.success }, showSymbol: false, smooth: true }] : []),
        { name: t("логистическая кривая"), type: "line", data: p.logistic.curve.map((q) => [q.day, q.value]), itemStyle: { color: c.muted }, lineStyle: { width: 1.5, type: "dotted", color: c.muted }, showSymbol: false },
      ],
    });
  }, [p, c]); // eslint-disable-line react-hooks/exhaustive-deps
  const deedsOption = useMemo(() => {
    if (!p) return null;
    return baseOption(c, {
      tooltip: { trigger: "axis", backgroundColor: c.surface, borderColor: c.border, textStyle: { color: c.text, fontFamily: c.font }, formatter: (ps: Array<{ axisValue: string; seriesName: string; value: number; marker: string }>) => `${ps[0]?.axisValue ?? ""}<br/>${ps.map((x) => `${x.marker} ${x.seriesName}: <b>${x.value}</b>`).join("<br/>")}<br/>${t("все")}: <b>${ps.reduce((a, x) => a + (x.value || 0), 0)}</b>` },
      xAxis: { type: "category", data: p.deeds.days.map(dayLabel), axisLabel: { color: c.muted }, axisLine: { lineStyle: { color: c.border } } },
      yAxis: { type: "value", minInterval: 1, axisLabel: { color: c.muted }, splitLine: { lineStyle: { color: c.border, opacity: 0.6 } } },
      series: p.deeds.teams.map((tm) => ({ name: tm.name, type: "bar", stack: "deeds", data: tm.values, itemStyle: { color: tm.color }, barMaxWidth: 36 })),
    });
  }, [p, c]);
  if (error) return <div className="card"><ErrorState text={error} onRetry={load} /></div>;
  if (!p || !option || !deedsOption) return <div className="card"><LoadingState /></div>;
  const fmt1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString(locale());
  return (
    <>
      <div className="card">
        <div className="card-head"><h2>{t("Города, накопительно: факт и прогноз")}<Help>{t("Когда все города карты будут у кого-то из команд. Сплошная линия — взятые города по дням. Пунктир — медиана прогноза при текущем темпе: 400 прогонов, каждый день каждая команда решает столько заданий, сколько в случайный полный день после разгона, город стоит столько заданий, сколько стоил случайный уже взятый. Точечная — логистическая кривая, подобранная по факту с потолком в число городов.")}</Help></h2></div>
        <div className="tiles mt-2">
          <div className="tile"><div className="value">{p.n} <span className="muted">{t("из {n}", { n: p.K })}</span></div><div className="cap">{t("городов взято")}</div></div>
          <div className="tile"><div className="value">{fmt1(p.rate)}</div><div className="cap">{t("городов в сутки")}</div><div className="hint">{t("после разгона, с {d}", { d: dateOf(p.rampDay) })}</div></div>
          <div className="tile"><div className="value">{Math.round(p.dailyTasksAvg)}</div><div className="cap">{t("заданий в сутки, все команды")}</div></div>
        </div>
        <Chart option={option} height={380} />
        <div className="table-wrap mt-3">
          <table className="data-table">
            <thead><tr><th />{p.milestones.map((m) => <th key={m}>{m === p.K ? t("все {n}", { n: m }) : t("{n} городов", { n: m })}</th>)}</tr></thead>
            <tbody>
              {forecast && <tr><td>{t("Прогноз")}</td>{p.milestones.map((m) => { const f = forecast.finish[String(m)] ?? [null, null, null]; return <td key={m}>{m <= p.n ? t("уже") : <>{fmtDay(f[1])}<span className="muted small"> · {fmtDay(f[0])} – {fmtDay(f[2])}</span></>}</td>; })}</tr>}
              <tr><td>{t("Логистическая кривая")}</td>{p.milestones.map((m) => <td key={m}>{m <= p.n ? t("уже") : fmtDay(p.logistic.finish[String(m)])}</td>)}</tr>
            </tbody>
          </table>
        </div>
        <p className="hint">{t("В строке прогноза: медиана и коридор 10–90 % по прогонам. Это не конец партии по правилам, а момент, когда карта занята.")}</p>
      </div>
      <div className="card">
        <div className="card-head"><h2>{t("Дел в день")}<Help>{t("Принятые администратором дела за каждый день партии: дела на сторонах и общие дела Каменоломни. Столбик — день, цвета — команды.")}</Help></h2></div>
        <Chart option={deedsOption} height={320} />
      </div>
    </>
  );
}
