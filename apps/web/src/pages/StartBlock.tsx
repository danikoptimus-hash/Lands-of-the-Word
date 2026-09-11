import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { plural } from "../lib/format";
import { Icon } from "../components/Icon";
import { ErrorState, LoadingState } from "../components/State";

interface Item { key: string; vars?: Record<string, string | number> }
interface Readiness { canStart: boolean; problems: string[]; warnings: string[]; problemItems: Item[]; warningItems: Item[] }
export interface MapStats { nodeCount: number; cityCount: number; startDistances: number[]; minCityGap: number }
type Tab = "teams" | "deeds";

/** Куда ведёт проблема готовности: по ключу сервера — про команды или про дела. Карту чинит кнопка в первом шаге, ссылка ей не нужна. */
const PROBLEM_TAB: Record<string, Tab | undefined> = new Proxy({}, { get: (_t, key: string) => (/оманд/.test(key) ? "teams" : /\bдел/.test(key) ? "deeds" : undefined) });

/**
 * Чек-лист подготовки в черновике: карта → команды и приглашения → дела → адресаты конвертов → «Начать игру».
 * Готовность проверяет сервер; список обновляется при любом изменении на странице (version), при возврате на вкладку и раз в 15 секунд.
 */
export function StartBlock({ gameId, version, onStarted, hasMap, nodeCount, cityCount, stats, onGenerate, generating, generateError, teams, teamCount, deeds, recipients, goTo, goToRecipients }: {
  gameId: string; version: number; onStarted: () => void;
  hasMap: boolean; nodeCount: number; cityCount: number; stats: MapStats | null; onGenerate: () => void; generating: boolean; generateError: string | null;
  teams: number; teamCount: number; deeds: number; recipients: number;
  goTo: (tab: Tab) => void; goToRecipients: () => void;
}) {
  const [r, setR] = useState<Readiness | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ui = useUi();
  const load = useCallback(() => api<Readiness>(`/api/games/${gameId}/readiness`).then((x) => { setR(x); setLoadError(false); }).catch(() => setLoadError(true)), [gameId]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { clearInterval(timer); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); };
  }, [load, version]);

  async function start() {
    if (!(await ui.confirm(t("После старта карту изменить нельзя. Команды получат стартовые точки и первые дела."), { title: t("Начать игру?"), okLabel: t("Начать") }))) return;
    setBusy(true); setError(null);
    try { await api(`/api/games/${gameId}/start`, { method: "POST" }); ui.notify(t("Игра началась")); onStarted(); }
    catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); }
    finally { setBusy(false); }
  }

  const tabLink = (tab: Tab | undefined) => tab && <a href={"#" + tab} onClick={(e) => { e.preventDefault(); goTo(tab); }}>{tab === "teams" ? t("Команды") : t("Дела")}</a>;
  const fixLink = (tab: Tab | undefined) => tab && <a className="fix" href={"#" + tab} onClick={(e) => { e.preventDefault(); goTo(tab); }}>{tab === "teams" ? t("Открыть «Команды»") : t("Открыть «Дела»")}</a>;
  const mapStatus = hasMap
    ? `${plural(cityCount, ["город", "города", "городов"])}, ${plural(nodeCount, ["перекрёсток", "перекрёстка", "перекрёстков"])}` + (stats ? ` · ${t("от старта до ближайшего города: {d} ходов", { d: stats.startDistances.join(" / ") })}` : "")
    : t("Ещё не создана");

  return (
    <div className="card">
      <div className="card-head"><h2><span className="ico"><Icon name="play" /></span>{t("Подготовка")}</h2></div>
      <ol className="checklist">
        <Step n={1} done={hasMap} title={t("Карта")} status={mapStatus} action={<button type="button" className={hasMap ? "secondary sm" : "sm"} onClick={onGenerate} disabled={generating}><Icon name="refresh" />{hasMap ? t("Заново") : t("Сгенерировать карту")}</button>} error={generateError} />
        <Step n={2} done={teams >= teamCount && teams > 0} title={t("Команды и приглашения")} status={t("{a} из {b}", { a: teams, b: teamCount })} action={tabLink("teams")} />
        <Step n={3} done={deeds > 0} title={t("Дела")} status={plural(deeds, ["дело", "дела", "дел"])} action={tabLink("deeds")} />
        <Step n={4} done={recipients > 0} title={t("Адресаты конвертов и ярлыки")} status={recipients > 0 ? plural(recipients, ["адресат", "адресата", "адресатов"]) : t("Желательно до старта, но можно добавить и позже")} action={<a href="#recipients" onClick={(e) => { e.preventDefault(); goToRecipients(); }}>{t("Ниже")}</a>} />
      </ol>
      {loadError ? <ErrorState text={t("Не удалось проверить готовность")} onRetry={() => void load()} /> : !r ? <LoadingState rows={1} /> : (
        <div className="problems">
          {r.problemItems.map((p) => <p key={p.key} className="note bad"><Icon name="alert" /><span>{t(p.key, p.vars)}{fixLink(PROBLEM_TAB[p.key])}</span></p>)}
          {r.warningItems.map((w) => <p key={w.key} className="note warn"><Icon name="alert" /><span>{t(w.key, w.vars)}{fixLink(PROBLEM_TAB[w.key])}</span></p>)}
          {r.canStart && <p className="note ok"><Icon name="check" /><span>{t("Можно начинать.")}</span></p>}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <div className="actions"><button type="button" onClick={() => void start()} disabled={!r?.canStart || busy}><Icon name="play" />{t("Начать игру")}</button></div>
    </div>
  );
}

function Step({ n, done, title, status, action, error }: { n: number; done: boolean; title: string; status: string; action?: ReactNode; error?: string | null }) {
  return (
    <li>
      <span className={"step" + (done ? " done" : "")} aria-label={done ? t("готово") : undefined}>{done ? <Icon name="check" /> : n}</span>
      <div className="body">
        <span className="title">{title}</span>
        <span className="muted small">{status}</span>
        {error && <span className="error">{error}</span>}
      </div>
      {action && <div className="act">{action}</div>}
    </li>
  );
}
