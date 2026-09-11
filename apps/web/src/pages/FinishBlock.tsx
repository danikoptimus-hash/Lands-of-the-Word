import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import { Chip } from "../components/Chip";
import { TeamAvatar } from "../components/TeamAvatar";
import { ErrorState, LoadingState } from "../components/State";
import { api, ApiError, type StandingRow, type StandingsDto } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { fmtDate, plural } from "../lib/format";

/**
 * Итоги у администратора. В игре: положение команд → (слот between: конверты) → срок окончания → отдельная карточка «Завершить игру».
 * После завершения: победитель, положение команд, взятые города.
 */
export function FinishBlock({ gameId, status, version, onChanged, between }: { gameId: string; status: string; version: number; onChanged: () => void; between?: ReactNode }) {
  const { confirm, notify } = useUi();
  const [data, setData] = useState<StandingsDto | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [endsAt, setEndsAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<StandingsDto>(`/api/games/${gameId}/standings`).then((d) => { setData(d); setEndsAt(d.endsAt ? toLocalInput(d.endsAt) : ""); setLoadError(false); }).catch(() => setLoadError(true)), [gameId]);
  useEffect(() => { void load(); }, [load, version, status]);
  if (status === "DRAFT") return null;
  if (loadError) return <div className="card"><ErrorState onRetry={() => void load()} /></div>;
  if (!data) return <div className="card"><LoadingState /></div>;
  const finished = status === "FINISHED";
  const winner = data.standings.find((tm) => tm.teamId === data.winnerTeamId);
  const leader = data.standings.find((tm) => tm.teamId === data.leaderTeamId);

  async function saveDeadline(clear = false) {
    setError(null); setBusy(true);
    const value = clear ? "" : endsAt;
    try { await api(`/api/games/${gameId}`, { method: "PATCH", body: JSON.stringify({ settings: { endsAt: value ? new Date(value).toISOString() : null } }) }); notify(value ? t("Срок сохранён") : t("Срок убран")); if (clear) setEndsAt(""); onChanged(); }
    catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); }
    finally { setBusy(false); }
  }
  async function finish() {
    const who = leader ? t("Победителем станет «{name}»: больше всего городов.", { name: leader.name }) : t("Победителя не будет.");
    if (!(await confirm(`${who} ${t("Испытания будут отменены, действия команд остановятся.")}`, { title: t("Завершить игру?"), okLabel: t("Завершить"), danger: true }))) return;
    setBusy(true);
    try { await api(`/api/games/${gameId}/finish`, { method: "POST", body: JSON.stringify({}) }); notify(t("Игра завершена")); onChanged(); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusy(false); }
  }
  const reason = data.finishReason === "last_team" ? t("осталась одна команда") : data.finishReason === "time_limit" ? t("вышел срок") : t("завершена администратором");

  return (
    <>
      {finished && (
        <div className="card">
          <div className="card-head">
            <h2><span className="ico"><Icon name="trophy" /></span>{t("Итоги")}</h2>
            {data.finishedAt && <span className="muted small">{fmtDate(data.finishedAt)}</span>}
          </div>
          <p className={"note " + (winner ? "ok" : "")}>
            <Icon name="trophy" />
            <span>{winner ? <>{t("Победила команда")} <strong>«{winner.name}»</strong></> : t("Победитель не определён")} · {reason}</span>
          </p>
          <Standings rows={data.standings} winnerId={data.winnerTeamId} leaderId={null} />
        </div>
      )}
      {!finished && (
        <div className="card">
          <div className="card-head"><h2><span className="ico"><Icon name="users" /></span>{t("Положение команд")}</h2></div>
          <Standings rows={data.standings} winnerId={null} leaderId={data.leaderTeamId} />
        </div>
      )}
      {finished && data.standings.some((tm) => tm.citiesOnPath.length > 0) && (
        <div className="card">
          <div className="card-head"><h2><span className="ico"><Icon name="city" /></span>{t("Взятые города")}</h2></div>
          <div className="taken-cities">
            {data.standings.map((tm) => tm.citiesOnPath.length > 0 && (
              <div key={tm.teamId} className="row">
                <TeamAvatar name={tm.name} color={tm.color} size="sm" withName />
                {tm.citiesOnPath.map((c) => <Chip key={c.nodeKey} tone={c.current ? (c.isCapital ? "accent" : "ok") : "neutral"} icon={c.isCapital ? "star" : undefined} title={c.current ? fmtDate(c.at) : t("потерян") + " · " + fmtDate(c.at)}><span className={c.current ? "" : "lost"}>{c.name}</span></Chip>)}
              </div>
            ))}
          </div>
        </div>
      )}
      {between}
      {!finished && (
        <>
          <div className="card">
            <div className="card-head"><h2><span className="ico"><Icon name="clock" /></span>{t("Срок окончания")}</h2></div>
            <label htmlFor="ends-at">{t("Дата и время")}</label>
            <input id="ends-at" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            <p className="hint">{t("В этот момент игра завершится сама: победит команда с наибольшим числом городов.")}</p>
            {error && <p className="error">{error}</p>}
            <div className="actions">
              <button type="button" onClick={() => void saveDeadline()} disabled={busy || !endsAt}>{t("Сохранить")}</button>
              {data.endsAt && <button type="button" className="secondary" onClick={() => void saveDeadline(true)} disabled={busy}>{t("Убрать срок")}</button>}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h2><span className="ico"><Icon name="flag" /></span>{t("Завершить игру")}</h2></div>
            <p className="muted small">{t("Необратимо: испытания отменятся, действия команд остановятся, победитель — по числу городов.")}</p>
            <div className="actions"><button type="button" className="danger" onClick={() => void finish()} disabled={busy}>{t("Завершить игру")}</button></div>
          </div>
        </>
      )}
    </>
  );
}

/** Положение команд: одна разметка для телефона и компьютера — строки с аватаром и числами словами. */
function Standings({ rows, winnerId, leaderId }: { rows: StandingRow[]; winnerId: string | null; leaderId: string | null }) {
  return (
    <div>
      {rows.map((tm, i) => {
        const out = tm.status === "defeated";
        return (
          <div key={tm.teamId} className={"standing-row" + (out ? " out" : "")}>
            <span className="rank">{i + 1}</span>
            <TeamAvatar name={tm.name} color={tm.color} />
            <div className="body">
              <div className="name">
                {tm.name}
                {tm.teamId === winnerId ? <Chip tone="ok" icon="trophy">{t("победитель")}</Chip> : out ? <Chip tone="bad">{t("выбыла")}</Chip> : tm.teamId === leaderId ? <Chip tone="accent">{t("лидер")}</Chip> : null}
              </div>
              <div className="nums">{plural(tm.cities, ["город", "города", "городов"])} · {plural(tm.capitals, ["столица", "столицы", "столиц"])} · {plural(tm.deedsApproved, ["дело", "дела", "дел"])}</div>
              <div className="nums">{t("Испытания: {a} выиграли · {b} устояли · {c} потеряли", { a: tm.battlesWon, b: tm.battlesRepelled, c: tm.battlesLost })}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
