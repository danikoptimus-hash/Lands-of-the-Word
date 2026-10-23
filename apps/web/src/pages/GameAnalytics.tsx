import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../lib/api";
import { t, getLocale } from "../lib/i18n";
import { Chart, baseOption, chartColors } from "../components/Chart";
import { ErrorState, LoadingState } from "../components/State";
import { Help } from "../components/Help";

/**
 * Темп партии для администратора игры (решение владельца 23.10): один график — города накопительно, факт и прогноз,
 * когда карта будет занята. Сплошная — факт, пунктир — медианы трёх сценариев, точечная — логистическая кривая.
 */
interface Pt { day: number; value: number }
interface Pace {
  tz: string; startedAt: string; now: string; T: number; K: number; n: number; rate: number; rampDay: number; dailyTasksAvg: number; milestones: number[];
  teams: Array<{ id: string; name: string; color: string }>;
  fact: Array<Pt & { teamId: string | null }>;
  linear: Record<string, number | null>;
  logistic: { r: number; t0: number; curve: Pt[]; finish: Record<string, number | null> };
  scenarios: Array<{ name: string; curve: Pt[]; finish: Record<string, Array<number | null>> }>;
}
const SCEN_LABEL: Record<string, () => string> = { "Как сейчас": () => t("Как сейчас"), "Карта сопротивляется": () => t("Карта сопротивляется"), "Запал гаснет": () => t("Запал гаснет") };

export function GameAnalytics({ gameId }: { gameId: string }) {
  const [p, setP] = useState<Pace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => { setP(null); setError(null); api<Pace>(`/api/games/${gameId}/analytics/pace`).then(setP).catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети"))); };
  useEffect(load, [gameId]); // eslint-disable-line react-hooks/exhaustive-deps
  const c = useMemo(chartColors, []);
  const dateOf = (day: number) => { if (!p) return ""; const d = new Date(Date.parse(p.startedAt) + Math.min(day, 3650) * 86_400_000); return d.toLocaleDateString(getLocale() === "en" ? "en-GB" : "ru-RU", { day: "numeric", month: "short", timeZone: p.tz }); };
  const fmtDay = (day: number | null | undefined) => (day == null || !Number.isFinite(day) ? t("больше года") : dateOf(day));
  const option = useMemo(() => {
    if (!p) return null;
    const worst = p.scenarios[2]?.finish[String(p.milestones[1])]?.[1] ?? null;
    const horizon = Math.min(Math.max((worst ?? 90) + 7, p.T + 14, 30), p.T + 120);
    const fact: Array<[number, number]> = [[0, 0], ...p.fact.map((f) => [f.day, f.value] as [number, number]), [p.T, p.n]];
    const scenColors = [c.success, c.info, c.danger];
    return baseOption(c, {
      legend: { top: 0, textStyle: { color: c.muted }, data: [t("факт"), ...p.scenarios.map((s) => SCEN_LABEL[s.name]?.() ?? s.name), t("логистическая кривая")] },
      tooltip: { trigger: "axis", backgroundColor: c.surface, borderColor: c.border, textStyle: { color: c.text, fontFamily: c.font }, formatter: (ps: Array<{ seriesName: string; value: [number, number]; marker: string }>) => { const d = ps[0]?.value[0] ?? 0; return `${dateOf(d)}<br/>${ps.map((x) => `${x.marker} ${x.seriesName}: <b>${Math.round(x.value[1])}</b>`).join("<br/>")}`; } },
      xAxis: { type: "value", min: 0, max: horizon, interval: horizon > 60 ? 14 : 7, axisLabel: { color: c.muted, formatter: (v: number) => dateOf(v) }, axisLine: { lineStyle: { color: c.border } }, splitLine: { show: false } },
      yAxis: { type: "value", min: 0, max: p.K + 2, minInterval: 1, axisLabel: { color: c.muted }, splitLine: { lineStyle: { color: c.border, opacity: 0.6 } } },
      dataZoom: [{ type: "inside", filterMode: "none" }, { type: "slider", filterMode: "none", height: 22, bottom: 10, borderColor: c.border, fillerColor: "rgba(168,114,46,0.18)", handleStyle: { color: c.accent }, textStyle: { color: c.muted }, labelFormatter: (v: number) => dateOf(v) }],
      series: [
        { name: t("факт"), type: "line", step: "end", data: fact, itemStyle: { color: c.text }, lineStyle: { width: 2.5, color: c.text }, showSymbol: false, z: 5 },
        { name: t("все {n} городов", { n: p.K }), type: "line", data: [[0, p.K], [horizon, p.K]], itemStyle: { color: c.muted }, lineStyle: { width: 1, color: c.muted }, showSymbol: false, silent: true, tooltip: { show: false }, endLabel: { show: true, formatter: t("все {n} городов", { n: p.K }), color: c.muted, offset: [-8, -10], align: "right" } },
        { name: t("сегодня"), type: "line", data: [[p.T, 0], [p.T, p.K + 2]], itemStyle: { color: c.accent }, lineStyle: { width: 1, color: c.accent }, showSymbol: false, silent: true, tooltip: { show: false }, endLabel: { show: true, formatter: t("сегодня"), color: c.accent, offset: [6, 8] } },
        ...p.scenarios.map((s, i) => ({ name: SCEN_LABEL[s.name]?.() ?? s.name, type: "line", data: s.curve.map((q) => [q.day, q.value]), itemStyle: { color: scenColors[i] }, lineStyle: { width: 2, type: "dashed", color: scenColors[i] }, showSymbol: false, smooth: true })),
        { name: t("логистическая кривая"), type: "line", data: p.logistic.curve.map((q) => [q.day, q.value]), itemStyle: { color: c.muted }, lineStyle: { width: 1.5, type: "dotted", color: c.muted }, showSymbol: false },
      ],
    });
  }, [p, c]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <div className="card"><ErrorState text={error} onRetry={load} /></div>;
  if (!p || !option) return <div className="card"><LoadingState /></div>;
  const m95 = p.milestones[1]!;
  const best = p.scenarios[0]?.finish[String(m95)]?.[1] ?? null, worst = p.scenarios[2]?.finish[String(m95)]?.[1] ?? null;
  const fmt1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString(getLocale() === "en" ? "en-GB" : "ru-RU");
  return (
    <div className="card">
      <div className="card-head"><h2>{t("Города, накопительно: факт и сценарии")}<Help>{t("Когда все города карты будут у кого-то из команд. Сплошная линия — взятые города по дням. Пунктир — медианы трёх сценариев: «как сейчас» — темп не меняется; «карта сопротивляется» — чем меньше свободных городов, тем они дальше и спорнее, отдача падает пропорционально их доле; «запал гаснет» — то же плюс активность минус 15 % в неделю. Точечная — логистическая кривая, подобранная по факту с потолком в число городов. Каждый сценарий прогоняется 400 раз: каждый день каждая команда решает столько заданий, сколько в случайный полный день после разгона, город стоит столько заданий, сколько стоил случайный уже взятый.")}</Help></h2></div>
      <div className="tiles mt-2">
        <div className="tile"><div className="value">{p.n} <span className="muted">{t("из {n}", { n: p.K })}</span></div><div className="cap">{t("городов взято")}</div></div>
        <div className="tile"><div className="value">{fmt1(p.rate)}</div><div className="cap">{t("городов в сутки")}</div><div className="hint">{t("после разгона, с {d}", { d: dateOf(p.rampDay) })}</div></div>
        <div className="tile"><div className="value">{Math.round(p.dailyTasksAvg)}</div><div className="cap">{t("заданий в сутки, все команды")}</div></div>
        <div className="tile"><div className="value">{p.n >= m95 ? t("уже") : `${fmtDay(best)} – ${fmtDay(worst)}`}</div><div className="cap">{t("почти вся карта ({n} городов)", { n: m95 })}</div><div className="hint">{t("лучший и худший сценарий")}</div></div>
      </div>
      <Chart option={option} height={380} />
      <div className="table-wrap mt-3">
        <table className="data-table">
          <thead><tr><th>{t("Сценарий")}</th>{p.milestones.map((m) => <th key={m}>{m === p.K ? t("все {n}", { n: m }) : t("{n} городов", { n: m })}</th>)}</tr></thead>
          <tbody>
            {p.scenarios.map((s) => <tr key={s.name}><td>{SCEN_LABEL[s.name]?.() ?? s.name}</td>{p.milestones.map((m) => { const f = s.finish[String(m)] ?? [null, null, null]; return <td key={m}>{m <= p.n ? t("уже") : <>{fmtDay(f[1])}<span className="muted small"> · {fmtDay(f[0])} – {fmtDay(f[2])}</span></>}</td>; })}</tr>)}
            <tr><td>{t("Прямая по темпу")}</td>{p.milestones.map((m) => <td key={m}>{m <= p.n ? t("уже") : fmtDay(p.linear[String(m)])}</td>)}</tr>
            <tr><td>{t("Логистическая кривая")}</td>{p.milestones.map((m) => <td key={m}>{m <= p.n ? t("уже") : fmtDay(p.logistic.finish[String(m)])}</td>)}</tr>
          </tbody>
        </table>
      </div>
      <p className="hint">{t("В строках сценариев: медиана и коридор 10–90 % по прогонам. Это не конец партии по правилам, а момент, когда карта занята.")}</p>
    </div>
  );
}
