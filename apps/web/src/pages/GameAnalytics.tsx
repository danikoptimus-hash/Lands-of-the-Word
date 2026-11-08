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
interface Daily { days: string[]; teams: Array<{ id: string; name: string; color: string; values: number[] }>; fitDays: number; /** Разных стихов за партию (05.11): стих у нескольких участников считается один раз. */ unique?: number; /** Номера стихов каждой команды (05.11): объединение по выбранным в легенде командам. */ uniqueIds?: Record<string, number[]> }
interface Pace {
  tz: string; startedAt: string; now: string; T: number; K: number; n: number; rate: number; rampDay: number; dailyTasksAvg: number; dailyDeedsAvg: number; milestones: number[];
  teams: Array<{ id: string; name: string; color: string; /** Участников в команде (05.11): для «дел на участника». */ members?: number }>;
  fact: Array<Pt & { teamId: string | null }>;
  /** Движение городов между командами без изменения общего счёта: переходы по испытаниям и осадам (кто отдал, кто взял), руины выбывшей
   *  команды (отдала — выбывшая, взяла — никто) и их занятие (взяла — команда, отдал — никто) (08.11). */ transfers?: Array<{ day: number; from: string | null; to: string | null }>;
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
const fmt1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString(locale());
/** Подпись значка: по выбранным в легенде командам — с пометкой (решение владельца 05.11: «фактоиды пересчитывались в зависимости от выбранных легенд»). */
const facLabel = (label: string, all: boolean) => (all ? label : `${label} · ${t("выбранные команды")}`);
type Fact = { icon: string; label: string; value: string };
/** Значки над «Дел в день» (решение владельца 05.11: «общего кол-ва дел и дел на человека в среднем»), по включённым командам. */
function deedsFacts(p: Pace): (ids: string[], all: boolean) => Fact[] {
  return (ids, all) => {
    const total = p.deeds.teams.filter((tm) => ids.includes(tm.id)).reduce((a, tm) => a + tm.values.reduce((x, y) => x + y, 0), 0);
    const members = p.teams.filter((tm) => ids.includes(tm.id)).reduce((a, tm) => a + (tm.members ?? 0), 0);
    return [
      { icon: "scroll", label: facLabel(t("дел принято за всю партию"), all), value: plural(total, ["дело", "дела", "дел"]) },
      { icon: "users", label: facLabel(t("дел на участника в среднем: принятые дела на число участников команд"), all), value: members > 0 ? `${fmt1(total / members)} ${t("на участника")}` : "—" },
    ];
  };
}

export function GameAnalytics({ gameId, version = 0 }: { gameId: string; /** Растёт с каждым событием игры: взятие города, одобрение дела, район — тренды и логистическая кривая перечитываются (проверка владельца 30.10). */ version?: number }) {
  const [p, setP] = useState<Pace | null>(() => ready<Pace>(`/api/games/${gameId}/analytics/pace`));
  const [error, setError] = useState<string | null>(null);
  // Готовый ответ показывается сразу, свежий тихо подменяет (решение владельца 24.10); заглушка — только когда данных ещё не было.
  const load = () => { setError(null); apiReady<Pace>(`/api/games/${gameId}/analytics/pace`).then(setP).catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети"))); };
  useEffect(load, [gameId, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const c = useMemo(chartColors, []);
  const dateOf = (day: number) => { if (!p) return ""; const d = new Date(Date.parse(p.startedAt) + Math.min(day, 3650) * 86_400_000); return d.toLocaleDateString(locale(), { day: "numeric", month: "short", timeZone: p.tz }); };
  /** Легенда графика городов (решение владельца 05.11): выключенные команды не входят в чёрную линию факта и в значки. */
  const [citySel, setCitySel] = useState<Record<string, boolean>>({});
  const cityShown = useMemo(() => {
    if (!p) return { ids: new Set<string>(), all: true, caps: [] as Pace["fact"] };
    const shown = p.teams.filter((tm) => citySel[tm.name] !== false), ids = new Set(shown.map((tm) => tm.id)), all = shown.length === p.teams.length;
    const caps = all ? p.fact : p.fact.filter((f) => f.teamId != null && ids.has(f.teamId));
    return { ids, all, caps };
  }, [p, citySel]);
  const option = useMemo(() => {
    if (!p) return null;
    // Правый край — день, когда логистическая кривая округляется до числа городов: дальше пустое место («можно поставить уже край графика»).
    const touch = p.logistic.curve.find((q) => q.value >= (p.logistic.K ?? p.K) - 0.5)?.day ?? null;
    const horizon = Math.min(Math.max(touch ?? p.T + 30, p.T + 7), p.T + 120);
    const fact: Array<[number, number]> = cityShown.all
      ? [[0, 0], ...p.fact.map((f) => [f.day, f.value] as [number, number]), [p.T, p.n]]
      : [[0, 0], ...cityShown.caps.map((f, i) => [f.day, i + 1] as [number, number]), [p.T, cityShown.caps.length]];
    // Линии команд (решение владельца 25.10): города каждой команды накопительно, без логистических кривых.
    // Линии команд: взятые города плюс переходы по испытаниям и осадам (замечание владельца 01.11: отвоёванные города не отображались).
    const teamLines = p.teams.map((tm) => {
      const ev = [...p.fact.filter((f) => f.teamId === tm.id).map((f) => ({ day: f.day, d: 1 })), ...(p.transfers ?? []).flatMap((x) => [...(x.to === tm.id ? [{ day: x.day, d: 1 }] : []), ...(x.from === tm.id ? [{ day: x.day, d: -1 }] : [])])].sort((a, b) => a.day - b.day);
      let k = 0; const pts: Array<[number, number]> = [[0, 0]]; for (const e of ev) pts.push([e.day, (k += e.d)]); pts.push([p.T, k]); return { tm, pts };
    });
    return baseOption(c, {
      // Легенда — только команды (решение владельца 05.11): факт, сегодня и кривая в ней не участвуют.
      legend: { show: true, top: 0, data: p.teams.map((tm) => tm.name), textStyle: { color: c.muted }, selected: citySel },
      tooltip: { trigger: "axis", backgroundColor: c.surface, borderColor: c.border, textStyle: { color: c.text, fontFamily: c.font }, formatter: (ps: Array<{ seriesName: string; value: [number, number]; marker: string }>) => { const d = ps[0]?.value[0] ?? 0; return `${dateOf(d)}<br/>${ps.map((x) => `${x.marker} ${x.seriesName}: <b>${Math.round(x.value[1])}</b>`).join("<br/>")}`; } },
      xAxis: { type: "value", min: 0, max: horizon, interval: horizon > 90 ? 14 : 7, axisLabel: { color: c.muted, formatter: (v: number) => dateOf(v) }, axisLine: { lineStyle: { color: c.border } }, splitLine: { show: false } },
      yAxis: { type: "value", min: 0, max: p.K, minInterval: 1, axisLabel: { color: c.muted }, splitLine: { lineStyle: { color: c.border, opacity: 0.6 } } },
      grid: { left: 12, right: 12, top: 36, bottom: 8, containLabel: true },
      dataZoom: [],
      series: [
        { name: t("факт"), type: "line", step: "end", data: fact, itemStyle: { color: c.text }, lineStyle: { width: 2.5, color: c.text }, showSymbol: false, z: 5 },
        ...teamLines.map(({ tm, pts }) => ({ name: tm.name, type: "line", step: "end", data: pts, itemStyle: { color: tm.color }, lineStyle: { width: 1.5, color: tm.color }, showSymbol: false, z: 4 })),
        { name: "today", type: "line", data: [[p.T, 0], [p.T, p.K]], itemStyle: { color: c.accent }, lineStyle: { width: 1, color: c.accent }, showSymbol: false, silent: true, tooltip: { show: false } },
        { name: t("логистическая кривая"), type: "line", data: p.logistic.curve.map((q) => [q.day, q.value]), itemStyle: { color: c.muted }, lineStyle: { width: 1.5, type: "dotted", color: c.muted }, showSymbol: false },
      ],
    });
  }, [p, c, cityShown, citySel]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <div className="card"><ErrorState text={error} onRetry={load} /></div>;
  if (!p || !option) return <div className="card"><LoadingState /></div>;
  // Значки первого графика по включённым командам (решение владельца 05.11): города, темп после разгона, дела в сутки.
  const cityN = cityShown.all ? p.n : cityShown.caps.length;
  const cityRate = cityShown.all ? p.rate : cityShown.caps.filter((f) => f.day >= p.rampDay).length / Math.max(p.T - p.rampDay, 0.5);
  const deedsAvg = cityShown.all ? p.dailyDeedsAvg : (() => { const fit = p.deeds.fitDays; if (fit <= 0) return 0; let s = 0; for (const tm of p.deeds.teams) if (cityShown.ids.has(tm.id)) for (let i = 0; i < fit; i++) s += tm.values[i] ?? 0; return s / fit; })();
  return (
    <>
      <div className="card">
        <div className="card-head"><h2>{t("Города, накопительно: факт и прогноз")}<Help>{t("Чёрная линия — взятые города по дням, все команды; цветные — каждая команда отдельно. Точечная — логистическая кривая, подобранная по факту методом наименьших квадратов: подбираются потолок, крутизна и середина, поэтому при замедлении кривая выходит на потолок ниже числа городов на карте.")}</Help></h2></div>
        {/* Значки вместо плиток (решение владельца 25.10: «фактоиды на телефоне слишком крупно, текст спрятать в вопросительный знак, значение передать через значок»). */}
        <div className="meta chips pace-chips mt-2">
          <StatChip icon="city" label={facLabel(t("городов взято"), cityShown.all)} value={`${cityN} ${t("из {n}", { n: p.K })}`} />
          <StatChip icon="city" label={facLabel(`${t("городов в сутки")} · ${t("после разгона, с {d}", { d: dateOf(p.rampDay) })}`, cityShown.all)} value={`${fmt1(cityRate)} ${t("в сутки")}`} />
          <StatChip icon="scroll" label={cityShown.all ? t("дел в сутки, все команды") : facLabel(t("дел в сутки"), false)} value={`${fmt1(deedsAvg)} ${t("в сутки")}`} />
        </div>
        <Chart option={option} height={380} onLegend={setCitySel} />
      </div>
      <DailyBars data={p.deeds} title={t("Дел в день")} facts={deedsFacts(p)} help={t("Принятые администратором дела за каждый день партии: дела на сторонах и общие дела Каменоломни. Столбик — день, цвета — команды. Пунктир — прямая тренда по полным дням для включённых в легенде команд.")} />
      {p.verses && <DailyBars data={p.verses} title={t("Стихов в день")} facts={versesFacts(p.verses)} help={t("Выученные стихи, принятые администратором за каждый день партии: записи испытаний и блоки стены. Каждый участник считается отдельно: если двое выучили один и тот же стих, это два стиха. Свой стих второй раз и стихи, перенесённые из прошлого вызова, не считаются. Столбик — день, цвета — команды. Пунктир — прямая тренда по полным дням для включённых в легенде команд.")} />}
    </>
  );
}

/**
 * Столбики по дням стеком по командам с пунктиром тренда: «Дел в день» и такой же «Стихов в день» (решение владельца 04.11:
 * «вот точно такой же, в таком же виде, только по выученным стихам»). Легенда у каждого графика своя: тренд пересчитывается
 * под включённые команды («тренд должен пересчитываться под выбранную комбинацию команд»).
 */
/** Значки над «Стихов в день» (решения владельца 05.11: «фактоид общего накопленного кол-ва стихов», «метрику уникальных стихов»), по включённым командам. */
function versesFacts(d: Daily): (ids: string[], all: boolean) => Fact[] {
  return (ids, all) => {
    // Сумма за все дни партии по включённым в легенде командам — независимо от видимого отрезка графика.
    const total = d.teams.filter((tm) => ids.includes(tm.id)).reduce((a, tm) => a + tm.values.reduce((x, y) => x + y, 0), 0);
    // Уникальные: объединение номеров стихов выбранных команд; для всех команд — число с сервера.
    const unique = all || !d.uniqueIds ? d.unique : new Set(ids.flatMap((id) => d.uniqueIds![id] ?? [])).size;
    return [
      { icon: "book", label: facLabel(t("стихов выучено за всю партию: каждый участник считается отдельно"), all), value: plural(total, ["стих", "стиха", "стихов"]) },
      ...(unique != null ? [{ icon: "sparkle", label: facLabel(t("разных стихов за всю партию: стих, выученный несколькими участниками или командами, считается один раз"), all), value: plural(unique, ["уникальный стих", "уникальных стиха", "уникальных стихов"]) }] : []),
    ];
  };
}

function DailyBars({ data, title, help, facts }: { data: Daily; title: string; help: string; /** Значки-фактоиды над графиком — по командам, включённым в легенде. */ facts?: (ids: string[], all: boolean) => Fact[] }) {
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
      {facts && (() => {
        const shown = data.teams.filter((tm) => sel[tm.name] !== false);
        const list = facts(shown.map((tm) => tm.id), shown.length === data.teams.length);
        return list.length > 0 ? <div className="meta chips pace-chips mt-2">{list.map((f) => <StatChip key={f.label} icon={f.icon} label={f.label} value={f.value} />)}</div> : null;
      })()}
      <Chart option={option} height={320} onLegend={setSel} />
    </div>
  );
}
