import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { Back } from "../components/Back";
import { errorText } from "./LoginPage";

/** Создание игры: только название, церковь и число команд. Остальное — в настройках игры. */
export function NewGamePage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [teamCount, setTeamCount] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await api<{ game: { id: string } }>("/api/games", { method: "POST", body: JSON.stringify({ name, orgName: orgName || undefined, teamCount }) });
      navigate(`/games/${r.game.id}`);
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }

  return (
    <div className="narrow-page">
      <Back to="/" label={t("Мои игры")} />
      <div className="page-head"><h1>{t("Новая игра")}</h1></div>
      <div className="card">
        <form onSubmit={create}>
          <label htmlFor="gname">{t("Название игры")}</label>
          <input id="gname" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} placeholder={t("Например: Земли Слова — осень")} autoFocus />
          <label htmlFor="org">{t("Церковь")}</label>
          <input id="org" value={orgName} onChange={(e) => setOrgName(e.target.value)} maxLength={80} placeholder={t("Моя церковь")} />
          <label htmlFor="teams">{t("Команд")}</label>
          <input id="teams" type="number" inputMode="numeric" min={2} max={12} value={teamCount} onChange={(e) => setTeamCount(Number(e.target.value))} required />
          <p className="hint">{t("Карту, старты и остальное настроите на странице игры.")}</p>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="actions"><button type="submit" disabled={busy}>{t("Создать игру")}</button></div>
        </form>
      </div>
    </div>
  );
}
