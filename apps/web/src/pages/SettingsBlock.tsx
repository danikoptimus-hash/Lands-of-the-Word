import { useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";

interface GameDto { id: string; name: string; status: string; teamCount: number; settings: { nodeCount?: number; equidistantStarts?: boolean; maxStartDistanceDiff?: number; includeGenealogies?: boolean } }

export function SettingsBlock({ game, onSaved }: { game: GameDto; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(game.name);
  const [teamCount, setTeamCount] = useState(game.teamCount);
  const [nodeCount, setNodeCount] = useState(game.settings.nodeCount ?? 250);
  const [equidistant, setEquidistant] = useState(game.settings.equidistantStarts ?? false);
  const [maxDiff, setMaxDiff] = useState(game.settings.maxStartDistanceDiff ?? 3);
  const [genealogies, setGenealogies] = useState(game.settings.includeGenealogies ?? false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (game.status !== "DRAFT") return null;

  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api(`/api/games/${game.id}`, { method: "PATCH", body: JSON.stringify({ name, teamCount, settings: { nodeCount, equidistantStarts: equidistant, maxStartDistanceDiff: maxDiff, includeGenealogies: genealogies } }) });
      setOpen(false); onSaved();
    } catch (err) { setError(err instanceof ApiError ? err.message : "Ошибка сети"); }
    finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>Настройки</h2>
        <button className="secondary sm" onClick={() => setOpen((v) => !v)}>{open ? "Скрыть" : "Изменить"}</button>
      </div>
      {!open && <p className="muted">Команд: {game.teamCount} · узлов: {game.settings.nodeCount ?? 250} · старты: {game.settings.equidistantStarts ? "равноудалённые" : "случайные"} · разница до первого города ≤ {game.settings.maxStartDistanceDiff ?? 3} · родословия в битвах: {game.settings.includeGenealogies ? "да" : "нет"}</p>}
      {open && (
        <form onSubmit={save}>
          <label htmlFor="s-name">Название</label>
          <input id="s-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} />
          <div className="grid cols-3">
            <div><label htmlFor="s-teams">Команд</label><input id="s-teams" type="number" min={2} max={12} value={teamCount} onChange={(e) => setTeamCount(Number(e.target.value))} /></div>
            <div><label htmlFor="s-nodes">Узлов на карте</label><input id="s-nodes" type="number" min={200} max={600} step={10} value={nodeCount} onChange={(e) => setNodeCount(Number(e.target.value))} /></div>
            <div><label htmlFor="s-diff">Разница до первого города</label><input id="s-diff" type="number" min={0} max={6} value={maxDiff} onChange={(e) => setMaxDiff(Number(e.target.value))} /></div>
          </div>
          <label className="check"><input type="checkbox" checked={equidistant} onChange={(e) => setEquidistant(e.target.checked)} />Равноудалённые старты</label>
          <label className="check"><input type="checkbox" checked={genealogies} onChange={(e) => setGenealogies(e.target.checked)} />Включать родословия и списки в случайный отрывок для битвы</label>
          <p className="hint">После изменения числа команд или узлов карту нужно сгенерировать заново.</p>
          {error && <p className="error">{error}</p>}
          <div className="actions"><button type="submit" disabled={busy}>Сохранить</button><button type="button" className="secondary" onClick={() => setOpen(false)}>Отмена</button></div>
        </form>
      )}
    </div>
  );
}
