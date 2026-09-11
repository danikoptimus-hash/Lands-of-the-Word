import { useEffect, useState } from "react";
import { api, ApiError, type StandingsDto } from "../lib/api";
import { useUi } from "../lib/ui";
import { t, getLocale } from "../lib/i18n";

/** Итоги игры у админа: положение команд, срок окончания, кнопка «Завершить игру»; после завершения — победитель. */
export function FinishBlock({ gameId, status, version, onChanged }: { gameId: string; status: string; version: number; onChanged: () => void }) {
  const { confirm, notify } = useUi();
  const [data, setData] = useState<StandingsDto | null>(null);
  const [endsAt, setEndsAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = () => api<StandingsDto>(`/api/games/${gameId}/standings`).then((d) => { setData(d); setEndsAt(d.endsAt ? toLocalInput(d.endsAt) : ""); }).catch(() => setData(null));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [gameId, version, status]);
  if (!data || status === "DRAFT") return null;
  const winner = data.standings.find((tm) => tm.teamId === data.winnerTeamId);
  const leaderRow = data.standings.find((tm) => tm.teamId === data.leaderTeamId);

  async function saveDeadline() {
    setError(null);
    try { await api(`/api/games/${gameId}`, { method: "PATCH", body: JSON.stringify({ settings: { endsAt: endsAt ? new Date(endsAt).toISOString() : null } }) }); notify(endsAt ? t("Срок сохранён") : t("Срок снят")); onChanged(); }
    catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); }
  }
  async function finish() {
    const who = leaderRow ? t("Победителем станет «{name}» (больше всего городов).", { name: leaderRow.name }) : t("Победителя не будет.");
    if (!(await confirm(t("Завершить игру сейчас? {who} Все испытания будут отменены, действия команд остановятся.", { who }), { okLabel: t("Завершить игру"), danger: true }))) return;
    try { await api(`/api/games/${gameId}/finish`, { method: "POST", body: JSON.stringify({}) }); notify(t("Игра завершена")); onChanged(); }
    catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); }
  }
  return (
    <div className="card">
      <div className="card-head">
        <h2>{status === "FINISHED" ? t("Игра завершена") : t("Итоги и завершение")}</h2>
        {status === "FINISHED" && data.finishedAt && <span className="muted">{new Date(data.finishedAt).toLocaleString(getLocale())}</span>}
      </div>
      {status === "FINISHED" && (
        <p className="note ok" style={{ fontSize: "1rem" }}>
          🏆 {winner ? <>{t("Победила команда")} <strong>«{winner.name}»</strong></> : t("Победитель не определён")}
          {" · "}{data.finishReason === "last_team" ? t("в строю осталась одна команда") : data.finishReason === "time_limit" ? t("вышел срок игры") : t("завершена администратором")}
        </p>
      )}
      <div style={{ overflowX: "auto" }}>
        <table className="standings">
          <thead><tr><th>{t("Команда")}</th><th>{t("Городов")}</th><th>{t("Столиц")}</th><th>{t("Дел")}</th><th>{t("Узлов")}</th><th>{t("Испытания")}</th><th>{t("Статус")}</th></tr></thead>
          <tbody>
            {data.standings.map((tm, i) => (
              <tr key={tm.teamId} className={tm.teamId === data.winnerTeamId ? "winner" : tm.status === "defeated" ? "out" : ""}>
                <td><span className="avatar" style={{ background: tm.color, color: "#fff" }}>{tm.name.slice(0, 1)}</span> {tm.name}{status === "ACTIVE" && i === 0 && tm.status !== "defeated" ? <span className="badge accent" style={{ marginLeft: ".4rem" }}>{t("лидер")}</span> : null}</td>
                <td>{tm.cities}</td><td>{tm.capitals}</td><td>{tm.deedsApproved}</td><td>{tm.nodesRevealed}</td>
                <td title={t("перешло / устояли / потеряно")}>{tm.battlesWon} / {tm.battlesRepelled} / {tm.battlesLost}</td>
                <td>{tm.status === "defeated" ? t("выбыла") : tm.teamId === data.winnerTeamId ? t("победитель") : t("в игре")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">{t("Испытания: перешло / устояли / потеряно. Дела — одобренные сдачи, узлы — открытые перекрёстки.")}</p>
      {data.standings.some((tm) => tm.citiesOnPath.length > 0) && (
        <div className="path-list">
          {data.standings.map((tm) => tm.citiesOnPath.length > 0 && (
            <div key={tm.teamId} className="team-stripe" style={{ borderLeftColor: tm.color }}>
              <strong>{tm.name}</strong> <span className="muted">{t("· города на пути:")}</span>{" "}
              {tm.citiesOnPath.map((c) => <span key={c.nodeKey} className={"badge" + (c.current ? (c.isCapital ? " accent" : " ok") : " bad")} style={{ marginRight: ".3rem" }} title={new Date(c.at).toLocaleString(getLocale())}>{c.name}{c.isCapital ? " ★" : ""}{c.current ? "" : t(" (потерян)")}</span>)}
            </div>
          ))}
        </div>
      )}
      {status === "ACTIVE" && (
        <>
          <div className="row" style={{ marginTop: ".8rem", gap: ".5rem", alignItems: "flex-end", flexWrap: "wrap" }}>
            <div><label htmlFor="ends-at">{t("Срок окончания игры")}</label><input id="ends-at" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></div>
            <button className="secondary" onClick={() => void saveDeadline()}>{t("Сохранить срок")}</button>
            <button className="danger" onClick={() => void finish()}>{t("Завершить игру")}</button>
          </div>
          <p className="hint">{t("По сроку игра завершится сама: победит команда с наибольшим числом городов. Если столицы потеряли все команды, кроме одной, игра завершается сразу.")}</p>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
