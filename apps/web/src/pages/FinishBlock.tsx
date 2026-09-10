import { useEffect, useState } from "react";
import { api, ApiError, type StandingsDto } from "../lib/api";
import { useUi } from "../lib/ui";

/** Итоги игры у админа: положение команд, срок окончания, кнопка «Завершить игру»; после завершения — победитель. */
export function FinishBlock({ gameId, status, version, onChanged }: { gameId: string; status: string; version: number; onChanged: () => void }) {
  const { confirm, notify } = useUi();
  const [data, setData] = useState<StandingsDto | null>(null);
  const [endsAt, setEndsAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = () => api<StandingsDto>(`/api/games/${gameId}/standings`).then((d) => { setData(d); setEndsAt(d.endsAt ? toLocalInput(d.endsAt) : ""); }).catch(() => setData(null));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [gameId, version, status]);
  if (!data || status === "DRAFT") return null;
  const winner = data.standings.find((t) => t.teamId === data.winnerTeamId);
  const leaderRow = data.standings.find((t) => t.teamId === data.leaderTeamId);

  async function saveDeadline() {
    setError(null);
    try { await api(`/api/games/${gameId}`, { method: "PATCH", body: JSON.stringify({ settings: { endsAt: endsAt ? new Date(endsAt).toISOString() : null } }) }); notify(endsAt ? "Срок сохранён" : "Срок снят"); onChanged(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Ошибка сети"); }
  }
  async function finish() {
    const who = leaderRow ? `Победителем станет «${leaderRow.name}» (больше всего городов).` : "Победителя не будет.";
    if (!(await confirm(`Завершить игру сейчас? ${who} Все битвы будут отменены, действия команд остановятся.`, { okLabel: "Завершить игру", danger: true }))) return;
    try { await api(`/api/games/${gameId}/finish`, { method: "POST", body: JSON.stringify({}) }); notify("Игра завершена"); onChanged(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Ошибка сети"); }
  }
  return (
    <div className="card">
      <div className="card-head">
        <h2>{status === "FINISHED" ? "Игра завершена" : "Итоги и завершение"}</h2>
        {status === "FINISHED" && data.finishedAt && <span className="muted">{new Date(data.finishedAt).toLocaleString("ru")}</span>}
      </div>
      {status === "FINISHED" && (
        <p className="note ok" style={{ fontSize: "1rem" }}>
          🏆 {winner ? <>Победила команда <strong>«{winner.name}»</strong></> : "Победитель не определён"}
          {" · "}{data.finishReason === "last_team" ? "в строю осталась одна команда" : data.finishReason === "time_limit" ? "вышел срок игры" : "завершена администратором"}
        </p>
      )}
      <table className="standings">
        <thead><tr><th>Команда</th><th>Городов</th><th>Столиц</th><th>Статус</th></tr></thead>
        <tbody>
          {data.standings.map((t, i) => (
            <tr key={t.teamId} className={t.teamId === data.winnerTeamId ? "winner" : t.status === "defeated" ? "out" : ""}>
              <td><span className="avatar" style={{ background: t.color, color: "#fff" }}>{t.name.slice(0, 1)}</span> {t.name}{status === "ACTIVE" && i === 0 && t.status !== "defeated" ? <span className="badge accent" style={{ marginLeft: ".4rem" }}>лидер</span> : null}</td>
              <td>{t.cities}</td><td>{t.capitals}</td>
              <td>{t.status === "defeated" ? "выбыла" : t.teamId === data.winnerTeamId ? "победитель" : "в игре"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {status === "ACTIVE" && (
        <>
          <div className="row" style={{ marginTop: ".8rem", gap: ".5rem", alignItems: "flex-end", flexWrap: "wrap" }}>
            <div><label htmlFor="ends-at">Срок окончания игры</label><input id="ends-at" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></div>
            <button className="secondary" onClick={() => void saveDeadline()}>Сохранить срок</button>
            <button className="danger" onClick={() => void finish()}>Завершить игру</button>
          </div>
          <p className="hint">По сроку игра завершится сама: победит команда с наибольшим числом городов. Если столицы потеряли все команды, кроме одной, игра завершается сразу.</p>
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
