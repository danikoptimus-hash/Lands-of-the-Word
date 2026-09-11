import { useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { t } from "../lib/i18n";
import { Icon } from "../components/Icon";

interface GameDto { id: string; name: string; status: string; teamCount: number; settings: { nodeCount?: number; equidistantStarts?: boolean; maxStartDistanceDiff?: number; includeGenealogies?: boolean; donationMin?: number | null; donationCurrency?: string } }

export function SettingsBlock({ game, onSaved }: { game: GameDto; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(game.name);
  const [teamCount, setTeamCount] = useState(game.teamCount);
  const [nodeCount, setNodeCount] = useState(game.settings.nodeCount ?? 250);
  const [equidistant, setEquidistant] = useState(game.settings.equidistantStarts ?? false);
  const [maxDiff, setMaxDiff] = useState(game.settings.maxStartDistanceDiff ?? 3);
  const [genealogies, setGenealogies] = useState(game.settings.includeGenealogies ?? false);
  const [donationMin, setDonationMin] = useState(game.settings.donationMin ?? "");
  const [currency, setCurrency] = useState(game.settings.donationCurrency ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const draft = game.status === "DRAFT";
  if (game.status === "FINISHED") return null;

  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api(`/api/games/${game.id}`, { method: "PATCH", body: JSON.stringify({ ...(draft ? { name, teamCount } : {}), settings: draft ? { nodeCount, equidistantStarts: equidistant, maxStartDistanceDiff: maxDiff, includeGenealogies: genealogies, donationMin: donationMin === "" ? null : Number(donationMin), donationCurrency: currency } : { donationMin: donationMin === "" ? null : Number(donationMin), donationCurrency: currency } }) });
      setOpen(false); onSaved();
    } catch (err) { setError(err instanceof ApiError ? err.message : t("Ошибка сети")); }
    finally { setBusy(false); }
  }

  return (
    <div className="card" data-tone="plum">
      <div className="card-head">
        <h2><span className="ico"><Icon name="settings" /></span>{t("Настройки")}</h2>
        <button className="secondary sm" onClick={() => setOpen((v) => !v)}><Icon name={open ? "x" : "edit"} />{open ? t("Скрыть") : t("Изменить")}</button>
      </div>
      {!open && <p className="muted">{t("Команд: {n}", { n: game.teamCount })} · {t("узлов: {n}", { n: game.settings.nodeCount ?? 250 })} · {t("старты: {s}", { s: game.settings.equidistantStarts ? t("равноудалённые") : t("случайные") })} · {t("разница до первого города ≤ {n}", { n: game.settings.maxStartDistanceDiff ?? 3 })} · {t("родословия в испытаниях: {s}", { s: game.settings.includeGenealogies ? t("да") : t("нет") })} · {t("пожертвование вместо дела: {s}", { s: game.settings.donationMin ? t("от {n} {cur}", { n: game.settings.donationMin, cur: game.settings.donationCurrency ?? "" }) : t("выключено") })}</p>}
      {open && (
        <form onSubmit={save}>
          {draft && <><label htmlFor="s-name">{t("Название")}</label>
          <input id="s-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} /></>}
          {draft && (
          <div className="grid cols-3">
            <div><label htmlFor="s-teams">{t("Команд")}</label><input id="s-teams" type="number" min={2} max={12} value={teamCount} onChange={(e) => setTeamCount(Number(e.target.value))} /></div>
            <div><label htmlFor="s-nodes">{t("Узлов на карте")}</label><input id="s-nodes" type="number" min={200} max={600} step={10} value={nodeCount} onChange={(e) => setNodeCount(Number(e.target.value))} /></div>
            <div><label htmlFor="s-diff">{t("Разница до первого города")}</label><input id="s-diff" type="number" min={0} max={6} value={maxDiff} onChange={(e) => setMaxDiff(Number(e.target.value))} /></div>
          </div>)}
          {draft && <label className="check"><input type="checkbox" checked={equidistant} onChange={(e) => setEquidistant(e.target.checked)} />{t("Равноудалённые старты")}</label>}
          {draft && <label className="check"><input type="checkbox" checked={genealogies} onChange={(e) => setGenealogies(e.target.checked)} />{t("Включать родословия и списки в случайный отрывок для испытания")}</label>}
          <div className="grid cols-3">
            <div><label htmlFor="s-don">{t("Пожертвование вместо дела, минимум")}</label><input id="s-don" type="number" min={0} value={donationMin} onChange={(e) => setDonationMin(e.target.value === "" ? "" : Number(e.target.value))} placeholder={t("пусто — выключено")} /></div>
            <div><label htmlFor="s-cur">{t("Валюта")}</label><input id="s-cur" value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={10} placeholder={t("сум, ₽, $")} /></div>
          </div>
          {draft ? <p className="hint">{t("После изменения числа команд или узлов карту нужно сгенерировать заново.")}</p> : <p className="hint">{t("После старта можно менять только пожертвование: карта и команды зафиксированы.")}</p>}
          {error && <p className="error">{error}</p>}
          <div className="actions"><button type="submit" disabled={busy}>{t("Сохранить")}</button><button type="button" className="secondary" onClick={() => setOpen(false)}>{t("Отмена")}</button></div>
        </form>
      )}
    </div>
  );
}
