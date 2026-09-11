import { useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { Icon } from "../components/Icon";

interface GameDto { id: string; name: string; status: string; teamCount: number; mapSeed: number | null; settings: { nodeCount?: number; equidistantStarts?: boolean; maxStartDistanceDiff?: number; includeGenealogies?: boolean; donationMin?: number | null; donationCurrency?: string } }

/** Настройки игры: форма всегда открыта, поля сгруппированы. В игре можно менять только пожертвование. */
export function SettingsBlock({ game, onSaved }: { game: GameDto; onSaved: () => void }) {
  const { notify } = useUi();
  const [name, setName] = useState(game.name);
  const [teamCount, setTeamCount] = useState(game.teamCount);
  const [nodeCount, setNodeCount] = useState(game.settings.nodeCount ?? 250);
  const [equidistant, setEquidistant] = useState(game.settings.equidistantStarts ?? false);
  const [maxDiff, setMaxDiff] = useState(game.settings.maxStartDistanceDiff ?? 3);
  const [genealogies, setGenealogies] = useState(game.settings.includeGenealogies ?? false);
  const [donationMin, setDonationMin] = useState<number | "">(game.settings.donationMin ?? "");
  const [currency, setCurrency] = useState(game.settings.donationCurrency ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const draft = game.status === "DRAFT";
  if (game.status === "FINISHED") return null;

  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    const donation = { donationMin: donationMin === "" ? null : Number(donationMin), donationCurrency: currency };
    try {
      await api(`/api/games/${game.id}`, { method: "PATCH", body: JSON.stringify({ ...(draft ? { name, teamCount } : {}), settings: draft ? { nodeCount, equidistantStarts: equidistant, maxStartDistanceDiff: maxDiff, includeGenealogies: genealogies, ...donation } : donation }) });
      notify(t("Настройки сохранены"));
      if (draft && game.mapSeed && (teamCount !== game.teamCount || nodeCount !== (game.settings.nodeCount ?? 250))) notify(t("Карту нужно сгенерировать заново"), "info");
      onSaved();
    } catch (err) { setError(err instanceof ApiError ? err.message : t("Ошибка сети")); }
    finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="card-head"><h2><span className="ico"><Icon name="settings" /></span>{t("Настройки")}</h2></div>
      <form onSubmit={save}>
        {draft && (
          <>
            <div className="settings-group">
              <h3>{t("Игра")}</h3>
              <label htmlFor="s-name">{t("Название")}</label>
              <input id="s-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} />
              <label htmlFor="s-teams">{t("Команд")}</label>
              <input id="s-teams" type="number" min={2} max={12} value={teamCount} onChange={(e) => setTeamCount(Number(e.target.value))} />
            </div>
            <div className="settings-group">
              <h3>{t("Карта и старты")}</h3>
              <label htmlFor="s-nodes">{t("Перекрёстков на карте")}</label>
              <input id="s-nodes" type="number" min={200} max={600} step={10} value={nodeCount} onChange={(e) => setNodeCount(Number(e.target.value))} />
              <p className="hint">{t("После изменения числа команд или перекрёстков карту нужно сгенерировать заново.")}</p>
              <label className="check mt-3"><input type="checkbox" checked={equidistant} onChange={(e) => setEquidistant(e.target.checked)} />{t("Выровнять расстояние от стартов до первого города")}</label>
              {equidistant && (
                <div className="sub">
                  <label htmlFor="s-diff">{t("Допустимая разница, ходов")}</label>
                  <input id="s-diff" type="number" min={0} max={6} value={maxDiff} onChange={(e) => setMaxDiff(Number(e.target.value))} />
                </div>
              )}
            </div>
            <div className="settings-group">
              <h3>{t("Испытания")}</h3>
              <label className="check"><input type="checkbox" checked={genealogies} onChange={(e) => setGenealogies(e.target.checked)} />{t("Отрывки могут содержать родословия и списки имён")}</label>
            </div>
          </>
        )}
        <div className="settings-group">
          <h3>{t("Пожертвование вместо дела")}</h3>
          <div className="money">
            <div>
              <label htmlFor="s-don">{t("Минимум")}</label>
              <input id="s-don" type="number" min={0} value={donationMin} onChange={(e) => setDonationMin(e.target.value === "" ? "" : Number(e.target.value))} />
            </div>
            <div>
              <label htmlFor="s-cur">{t("Валюта")}</label>
              <input id="s-cur" className="cur" value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={10} placeholder="₽" />
            </div>
          </div>
          <p className="hint">{draft ? t("Пусто — пожертвование выключено.") : t("После старта можно менять только пожертвование: карта и команды зафиксированы.")}</p>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="actions"><button type="submit" disabled={busy}>{t("Сохранить")}</button></div>
      </form>
    </div>
  );
}
