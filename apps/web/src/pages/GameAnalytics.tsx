import { useEffect, useMemo, useState } from "react";
import { ApiError, apiReady, ready } from "../lib/api";
import { t, getLocale } from "../lib/i18n";
import { Chart, baseOption, chartColors } from "../components/Chart";
import { ErrorState, LoadingState } from "../components/State";
import { Help } from "../components/Help";

/**
 * Темп партии для администратора игры (решение владельца 23.10; уточнение: «оставить только логистическую кривую,
 * факт и прогноз», затем «уберём зелёную линию, оставим только логистическую кривую», «добавить график с количеством дел
 * в день»). Первый график — города накопительно: сплошная — факт, точечная — логистическая кривая. Второй — принятые дела
 * в день, стеком по командам, с прямой тренда по полным дням. Таблица вех и текст под первым графиком убраны («убрать весь этот текст»),
 * как и подписи «сегодня» и «все K городов» с горизонталью: потолок оси Y — само число городов.
 */
interface Pt { day: number; value: number }
interface Pace {
  tz: string; startedAt: string; now: string; T: number; K: number; n: number; rate: number; rampDay: number; dailyTasksAvg: number; dailyDeedsAvg: number; milestones: number[];
  teams: Array<{ id: string; name: string; color: string }>;
  fact: Array<Pt & { teamId: string | null }>;
  deeds: { days: string[]; teams: Array<{ id: string; name: string; color: string; values: number[] }>; fitDays: number };
  logistic: { r: number; t0: number; curve: Pt[]; finish: Record<string, number | null> };
}
const locale = () => (getLocale() === "en" ? "en-GB" : "ru-RU");
/** Прямая тренда по методу наименьших квадратов по первым fitN точкам, продлённая на все дни; пусто, если точек мало. */
function trendLine(totals: number[], fitN: number): number[] {
  if (fitN < 2) return [];
  const mx = (fitN - 1) / 2; const my = totals.slice(0, fitN).reduce((a, b) => a + b, 0) / fitN;
  let sxy = 0, sxx = 0; for (let x = 0; x < fitN; x++) { sxy += (x - mx) * (totals[x]! - my); sxx += (x - mx) ** 2; }
  const slope = sxx ? sxy / sxx : 0;
  return totals.map((_, i) => Math.round(Math.max(0, my + slope * (i - mx)) * 10) / 10);
}
const dayLabel = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString(locale(), { day: "numeric", month: "short", timeZone: "UTC" });

export function GameAnalytics({ gameId }: { gameId: string }) {
  const [p, setP] = useState<Pace | null>(() => ready<Pace>(`/api/games/${gameId}/analytics/pace`));
  const [error, setError] = useState<string | null>(null);
  /** Что включено в легенде графика дел: тренд пересчитывается под выбранные команды («тренд должен пересчитываться под выбранную комбинацию команд»). */
  const [sel, setSel] = useState<Record<string, boolean>>({});
  // Готовый ответ показывается сразу, свежий тихо подменяет (решение владельца 24.10); заглушка — только когда данных ещё не было.
  const load = () => { setError(null); apiReady<Pace>(`/api/games/${gameId}/analytics/pace`).then(setP).catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети"))); };
  useEffect(load, [gameId]); // eslint-disable-line react-hooks/exhaustive-deps
  const c = useMemo(chartColors, []);
  const dateOf = (day: number) => { if (!p) return ""; const d = new Date(Date.parse(p.startedAt) + Math.min(day, 3650) * 86_400_000); return d.toLocaleDateString(locale(), { day: "numeric", month: "short", timeZone: p.tz }); };
  const option = useMemo(() => {
    if (!p) return null;
    // Правый край — день, когда логистическая кривая округляется до числа городов: дальше пустое место («можно поставить уже край графика»).
    const touch = p.logistic.curve.find((q) => q.value >= p.K - 0.5)?.day ?? null;
    const horizon = Math.min(Math.max(touch ?? p.T + 30, p.T + 7), p.T + 120);
    const fact: Array<[number, number]> = [[0, 0], ...p.fact.map((f) => [f.day, f.value] as [number, number]), [p.T, p.n]];
    return baseOption(c, {
      legend: { show: false },
      tooltip: { trigger: "axis", backgroundColor: c.surface, borderColor: c.border, textStyle: { color: c.text, fontFamily: c.font }, formatter: (ps: Array<{ seriesName: string; value: [number, number]; marker: string }>) => { const d = ps[0]?.value[0] ?? 0; return `${dateOf(d)}<br/>${ps.map((x) => `${x.marker} ${x.seriesName}: <b>${Math.round(x.value[1])}</b>`).join("<br/>")}`; } },
      xAxis: { type: "value", min: 0, max: horizon, interval: horizon > 90 ? 14 : 7, axisLabel: { color: c.muted, formatter: (v: number) => dateOf(v) }, axisLine: { lineStyle: { color: c.border } }, splitLine: { show: false } },
      yAxis: { type: "value", min: 0, max: p.K, minInterval: 1, axisLabel: { color: c.muted }, splitLine: { lineStyle: { color: c.border, opacity: 0.6 } } },
      grid: { left: 12, right: 12, top: 12, bottom: 8, containLabel: true },
      dataZoom: [],
      series: [
        { name: t("факт"), type: "line", step: "end", data: fact, itemStyle: { color: c.text }, lineStyle: { width: 2.5, color: c.text }, showSymbol: false, z: 5 },
        { name: "today", type: "line", data: [[p.T, 0], [p.T, p.K]], itemStyle: { color: c.accent }, lineStyle: { width: 1, color: c.accent }, showSymbol: false, silent: true, tooltip: { show: false } },
        { name: t("логистическая кривая"), type: "line", data: p.logistic.curve.map((q) => [q.day, q.value]), itemStyle: { color: c.muted }, lineStyle: { width: 1.5, type: "dotted", color: c.muted }, showSymbol: false },
      ],
    });
  }, [p, c]); // eslint-disable-line react-hooks/exhaustive-deps
  const deedsOption = useMemo(() => {
    if (!p) return null;
    const shown = p.deeds.teams.filter((tm) => sel[tm.name] !== false);
    const totals = p.deeds.days.map((_, i) => shown.reduce((a, tm) => a + (tm.values[i] ?? 0), 0));
    const trend = shown.length ? trendLine(totals, Math.min(p.deeds.fitDays, totals.length)) : [];
    return baseOption(c, {
      legend: { top: 0, textStyle: { color: c.muted }, selected: sel },
      tooltip: { trigger: "axis", backgroundColor: c.surface, borderColor: c.border, textStyle: { color: c.text, fontFamily: c.font }, formatter: (ps: Array<{ axisValue: string; seriesName: string; seriesIndex: number; value: number; marker: string }>) => { const bars = ps.filter((x) => x.seriesIndex < p.deeds.teams.length); return `${ps[0]?.axisValue ?? ""}<br/>${ps.map((x) => `${x.marker} ${x.seriesName}: <b>${x.value}</b>`).join("<br/>")}${bars.length > 1 ? `<br/>${t("все")}: <b>${bars.reduce((a, x) => a + (x.value || 0), 0)}</b>` : ""}`; } },
      xAxis: { type: "category", data: p.deeds.days.map(dayLabel), axisLabel: { color: c.muted }, axisLine: { lineStyle: { color: c.border } } },
      yAxis: { type: "value", minInterval: 1, axisLabel: { color: c.muted }, splitLine: { lineStyle: { color: c.border, opacity: 0.6 } } },
      series: [
        ...p.deeds.teams.map((tm) => ({ name: tm.name, type: "bar", stack: "deeds", data: tm.values, itemStyle: { color: tm.color }, barMaxWidth: 36 })),
        { name: t("тренд"), type: "line", data: trend, itemStyle: { color: c.text }, lineStyle: { width: 2, type: "dashed", color: c.text }, showSymbol: false, z: 5 },
      ],
    });
  }, [p, c, sel]);
  if (error) return <div className="card"><ErrorState text={error} onRetry={load} /></div>;
  if (!p || !option || !deedsOption) return <div className="card"><LoadingState /></div>;
  const fmt1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString(locale());
  return (
    <>
      <div className="card">
        <div className="card-head"><h2>{t("Города, накопительно: факт и прогноз")}<Help>{t("Когда все города карты будут у кого-то из команд. Сплошная линия — взятые города по дням. Точечная — логистическая кривая, подобранная по факту с потолком в число городов.")}</Help></h2></div>
        <div className="tiles mt-2">
          <div className="tile"><div className="value">{p.n} <span className="muted">{t("из {n}", { n: p.K })}</span></div><div className="cap">{t("городов взято")}</div></div>
          <div className="tile"><div className="value">{fmt1(p.rate)}</div><div className="cap">{t("городов в сутки")}</div><div className="hint">{t("после разгона, с {d}", { d: dateOf(p.rampDay) })}</div></div>
          <div className="tile"><div className="value">{fmt1(p.dailyDeedsAvg)}</div><div className="cap">{t("дел в сутки, все команды")}</div></div>
        </div>
        <Chart option={option} height={380} />
      </div>
      <div className="card">
        <div className="card-head"><h2>{t("Дел в день")}<Help>{t("Принятые администратором дела за каждый день партии: дела на сторонах и общие дела Каменоломни. Столбик — день, цвета — команды. Пунктир — прямая тренда по полным дням для включённых в легенде команд.")}</Help></h2></div>
        <Chart option={deedsOption} height={320} onLegend={setSel} />
      </div>
    </>
  );
}
