import { useEffect, useMemo, useState } from "react";
import { ApiError, apiReady, ready } from "../lib/api";
import { plural } from "../lib/format";
import { t, getLocale } from "../lib/i18n";
import { Chart, baseOption, chartColors } from "../components/Chart";
import { ErrorState, LoadingState } from "../components/State";
import { Help } from "../components/Help";
import { StatChip } from "../components/StatChip";

/**
 * Темп партии для администратора игры (решение владельца 23.10; уточнение: «оставить только логистическую кривую,
 * факт и прогноз», затем «уберём зелёную линию, оставим только логистическую кривую», «добавить график с количеством дел
 * в день»). Первый график — города накопительно: сплошная — факт, точечная — логистическая кривая. Второй — принятые дела
 * в день, стеком по командам, с прямой тренда по полным дням. Третий — выученные стихи в день, точно такой же (решение владельца
 * 04.11). Таблица вех и текст под первым графиком убраны («убрать весь этот текст»),
 * как и подписи «сегодня» и «все K городов» с горизонталью: потолок оси Y — само число городов.
 */
interface Pt { day: number; value: number }
/** Столбики по дням стеком по командам; fitDays — сколько полных дней идёт в прямую тренда. */
interface Daily { days: string[]; teams: Array<{ id: string; name: string; color: string; values: number[] }>; fitDays: number; /** Разных стихов за партию (05.11): стих у нескольких участников считается один раз. */ unique?: number }
interface Pace {
  tz: string; startedAt: string; now: string; T: number; K: number; n: number; rate: number; rampDay: number; dailyTasksAvg: number; dailyDeedsAvg: number; milestones: number[];
  teams: Array<{ id: string; name: string; color: string }>;
  fact: Array<Pt & { teamId: string | null }>;
  /** Переходы городов по испытаниям и осадам: день, кто отдал, кто взял. */ transfers?: Array<{ day: number; from: string; to: string }>;
  deeds: Daily;
  /** Выученные стихи в день: у каждого участника стих один раз, один стих у двоих — два (решение владельца 04.11). */
  verses?: Daily;
  logistic: { /** Подобранный потолок: до стольких городов идёт кривая при нынешнем темпе. */ K?: number; r: number; t0: number; curve: Pt[]; finish: Record<string, number | null> };
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

export function GameAnalytics({ gameId, version = 0 }: { gameId: string; /** Растёт с каждым событием игры: взятие города, одобрение дела, район — тренды и логистическая кривая перечитываются (проверка владельца 30.10). */ version?: number }) {
  const [p, setP] = useState<Pace | null>(() => ready<Pace>(`/api/games/${gameId}/analytics/pace`));
  const [error, setError] = useState<string | null>(null);
  // Готовый ответ показывается сразу, свежий тихо подменяет (решение владельца 24.10); заглушка — только когда данных ещё не было.
  const load = () => { setError(null); apiReady<Pace>(`/api/games/${gameId}/analytics/pace`).then(setP).catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети"))); };
  useEffect(load, [gameId, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const c = useMemo(chartColors, []);
  const dateOf = (day: number) => { if (!p) return ""; const d = new Date(Date.parse(p.startedAt) + Math.min(day, 3650) * 86_400_000); return d.toLocaleDateString(locale(), { day: "numeric", month: "short", timeZone: p.tz }); };
  const option = useMemo(() => {
    if (!p) return null;
    // Правый край — день, когда логистическая кривая округляется до числа городов: дальше пустое место («можно поставить уже край графика»).
    const touch = p.logistic.curve.find((q) => q.value >= (p.logistic.K ?? p.K) - 0.5)?.day ?? null;
    const horizon = Math.min(Math.max(touch ?? p.T + 30, p.T + 7), p.T + 120);
    const fact: Array<[number, number]> = [[0, 0], ...p.fact.map((f) => [f.day, f.value] as [number, number]), [p.T, p.n]];
    // Линии команд (решение владельца 25.10): города каждой команды накопительно, без логистических кривых.
    // Линии команд: взятые города плюс переходы по испытаниям и осадам (замечание владельца 01.11: отвоёванные города не отображались).
    const teamLines = p.teams.map((tm) => {
      const ev = [...p.fact.filter((f) => f.teamId === tm.id).map((f) => ({ day: f.day, d: 1 })), ...(p.transfers ?? []).flatMap((x) => [...(x.to === tm.id ? [{ day: x.day, d: 1 }] : []), ...(x.from === tm.id ? [{ day: x.day, d: -1 }] : [])])].sort((a, b) => a.day - b.day);
      let k = 0; const pts: Array<[number, number]> = [[0, 0]]; for (const e of ev) pts.push([e.day, (k += e.d)]); pts.push([p.T, k]); return { tm, pts };
    });
    return baseOption(c, {
      legend: { show: false },
      tooltip: { trigger: "axis", backgroundColor: c.surface, borderColor: c.border, textStyle: { color: c.text, fontFamily: c.font }, formatter: (ps: Array<{ seriesName: string; value: [number, number]; marker: string }>) => { const d = ps[0]?.value[0] ?? 0; return `${dateOf(d)}<br/>${ps.map((x) => `${x.marker} ${x.seriesName}: <b>${Math.round(x.value[1])}</b>`).join("<br/>")}`; } },
      xAxis: { type: "value", min: 0, max: horizon, interval: horizon > 90 ? 14 : 7, axisLabel: { color: c.muted, formatter: (v: number) => dateOf(v) }, axisLine: { lineStyle: { color: c.border } }, splitLine: { show: false } },
      yAxis: { type: "value", min: 0, max: p.K, minInterval: 1, axisLabel: { color: c.muted }, splitLine: { lineStyle: { color: c.border, opacity: 0.6 } } },
      grid: { left: 12, right: 12, top: 12, bottom: 8, containLabel: true },
      dataZoom: [],
      series: [
        { name: t("факт"), type: "line", step: "end", data: fact, itemStyle: { color: c.text }, lineStyle: { width: 2.5, color: c.text }, showSymbol: false, z: 5 },
        ...teamLines.map(({ tm, pts }) => ({ name: tm.name, type: "line", step: "end", data: pts, itemStyle: { color: tm.color }, lineStyle: { width: 1.5, color: tm.color }, showSymbol: false, z: 4 })),
        { name: "today", type: "line", data: [[p.T, 0], [p.T, p.K]], itemStyle: { color: c.accent }, lineStyle: { width: 1, color: c.accent }, showSymbol: false, silent: true, tooltip: { show: false } },
        { name: t("логистическая кривая"), type: "line", data: p.logistic.curve.map((q) => [q.day, q.value]), itemStyle: { color: c.muted }, lineStyle: { width: 1.5, type: "dotted", color: c.muted }, showSymbol: false },
      ],
    });
  }, [p, c]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <div className="card"><ErrorState text={error} onRetry={load} /></div>;
  if (!p || !option) return <div className="card"><LoadingState /></div>;
  const fmt1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString(locale());
  return (
    <>
      <div className="card">
        <div className="card-head"><h2>{t("Города, накопительно: факт и прогноз")}<Help>{t("Чёрная линия — взятые города по дням, все команды; цветные — каждая команда отдельно. Точечная — логистическая кривая, подобранная по факту методом наименьших квадратов: подбираются потолок, крутизна и середина, поэтому при замедлении кривая выходит на потолок ниже числа городов на карте.")}</Help></h2></div>
        {/* Значки вместо плиток (решение владельца 25.10: «фактоиды на телефоне слишком крупно, текст спрятать в вопросительный знак, значение передать через значок»). */}
        <div className="meta chips pace-chips mt-2">
          <StatChip icon="city" label={t("городов взято")} value={`${p.n} ${t("из {n}", { n: p.K })}`} />
          <StatChip icon="city" label={`${t("городов в сутки")} · ${t("после разгона, с {d}", { d: dateOf(p.rampDay) })}`} value={`${fmt1(p.rate)} ${t("в сутки")}`} />
          <StatChip icon="scroll" label={t("дел в сутки, все команды")} value={`${fmt1(p.dailyDeedsAvg)} ${t("в сутки")}`} />
        </div>
        <Chart option={option} height={380} />
      </div>
      <DailyBars data={p.deeds} title={t("Дел в день")} help={t("Принятые администратором дела за каждый день партии: дела на сторонах и общие дела Каменоломни. Столбик — день, цвета — команды. Пунктир — прямая тренда по полным дням для включённых в легенде команд.")} />
      {p.verses && <DailyBars data={p.verses} title={t("Стихов в день")} facts={versesFacts(p.verses)} help={t("Выученные стихи, принятые администратором за каждый день партии: записи испытаний и блоки стены. Каждый участник считается отдельно: если двое выучили один и тот же стих, это два стиха. Свой стих второй раз и стихи, перенесённые из прошлого вызова, не считаются. Столбик — день, цвета — команды. Пунктир — прямая тренда по полным дням для включённых в легенде команд.")} />}
    </>
  );
}

/**
 * Столбики по дням стеком по командам с пунктиром тренда: «Дел в день» и такой же «Стихов в день» (решение владельца 04.11:
 * «вот точно такой же, в таком же виде, только по выученным стихам»). Легенда у каждого графика своя: тренд пересчитывается
 * под включённые команды («тренд должен пересчитываться под выбранную комбинацию команд»).
 */
/** Значки над «Стихов в день» (решения владельца 05.11: «фактоид общего накопленного кол-ва стихов», «метрику уникальных стихов»). */
function versesFacts(d: Daily): Array<{ icon: string; label: string; value: string }> {
  // Сумма за все дни партии и все команды — независимо от выбора в легенде и видимого отрезка графика.
  const all = d.teams.reduce((a, tm) => a + tm.values.reduce((x, y) => x + y, 0), 0);
  return [
    { icon: "book", label: t("стихов выучено за всю партию, все команды: каждый участник считается отдельно"), value: plural(all, ["стих", "стиха", "стихов"]) },
    ...(d.unique != null ? [{ icon: "sparkle", label: t("разных стихов за всю партию: стих, выученный несколькими участниками или командами, считается один раз"), value: plural(d.unique, ["уникальный стих", "уникальных стиха", "уникальных стихов"]) }] : []),
  ];
}

function DailyBars({ data, title, help, facts }: { data: Daily; title: string; help: string; /** Значки-фактоиды над графиком. */ facts?: Array<{ icon: string; label: string; value: string }> }) {
  const c = useMemo(chartColors, []);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const option = useMemo(() => {
    const shown = data.teams.filter((tm) => sel[tm.name] !== false);
    const totals = data.days.map((_, i) => shown.reduce((a, tm) => a + (tm.values[i] ?? 0), 0));
    const trend = shown.length ? trendLine(totals, Math.min(data.fitDays, totals.length)) : [];
    return baseOption(c, {
      legend: { top: 0, textStyle: { color: c.muted }, selected: sel },
      tooltip: { trigger: "axis", backgroundColor: c.surface, borderColor: c.border, textStyle: { color: c.text, fontFamily: c.font }, formatter: (ps: Array<{ axisValue: string; seriesName: string; seriesIndex: number; value: number; marker: string }>) => { const bars = ps.filter((x) => x.seriesIndex < data.teams.length); return `${ps[0]?.axisValue ?? ""}<br/>${ps.map((x) => `${x.marker} ${x.seriesName}: <b>${x.value}</b>`).join("<br/>")}${bars.length > 1 ? `<br/>${t("все")}: <b>${bars.reduce((a, x) => a + (x.value || 0), 0)}</b>` : ""}`; } },
      xAxis: { type: "category", data: data.days.map(dayLabel), axisLabel: { color: c.muted }, axisLine: { lineStyle: { color: c.border } } },
      yAxis: { type: "value", minInterval: 1, axisLabel: { color: c.muted }, splitLine: { lineStyle: { color: c.border, opacity: 0.6 } } },
      series: [
        ...data.teams.map((tm) => ({ name: tm.name, type: "bar", stack: "daily", data: tm.values, itemStyle: { color: tm.color }, barMaxWidth: 36 })),
        { name: t("тренд"), type: "line", data: trend, itemStyle: { color: c.text }, lineStyle: { width: 2, type: "dashed", color: c.text }, showSymbol: false, z: 5 },
      ],
    });
  }, [data, c, sel]);
  return (
    <div className="card">
      <div className="card-head"><h2>{title}<Help>{help}</Help></h2></div>
      {facts && facts.length > 0 && <div className="meta chips pace-chips mt-2">{facts.map((f) => <StatChip key={f.label} icon={f.icon} label={f.label} value={f.value} />)}</div>}
      <Chart option={option} height={320} onLegend={setSel} />
    </div>
  );
}
