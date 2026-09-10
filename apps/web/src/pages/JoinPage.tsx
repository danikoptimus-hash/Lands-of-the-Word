import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { api, ApiError } from "../lib/api";
import { t } from "../lib/i18n";

interface InviteInfo { invite: { role: "CAPTAIN" | "MEMBER"; team: { id: string; name: string; color: string }; game: { id: string; name: string; org: { name: string } } }; alreadyIn: { id: string; name: string } | null }

export function JoinPage() {
  const { token = "" } = useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    api<InviteInfo>(`/api/invites/${token}`).then(setInfo).catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети")));
  }, [token, user]);

  if (loading) return <p className="muted">{t("Загрузка…")}</p>;
  if (!user) return <Navigate to={`/login?next=/join/${token}`} replace />;

  async function accept() {
    setBusy(true); setError(null);
    try {
      const r = await api<{ team: { gameId: string } }>(`/api/invites/${token}/accept`, { method: "POST" });
      navigate(`/games/${r.team.gameId}/team`);
    } catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); }
    finally { setBusy(false); }
  }

  return (
    <div className="card auth">
      <h1>{t("Приглашение")}</h1>
      {error && <p className="error">{error}</p>}
      {info && (
        <>
          <p>{t("Игра")} <strong>{info.invite.game.name}</strong> · {info.invite.game.org.name}</p>
          <p>{t("Команда")} <strong style={{ color: info.invite.team.color }}>{info.invite.team.name}</strong>, роль: {info.invite.role === "CAPTAIN" ? t("капитан") : t("участник")}</p>
          {info.alreadyIn ? (
            <p className="muted">Вы уже в команде «{info.alreadyIn.name}» этой игры. <Link to={`/games/${info.invite.game.id}/team`}>{t("Открыть")}</Link></p>
          ) : (
            <div className="actions"><button onClick={() => void accept()} disabled={busy} style={{ width: "100%" }}>{t("Вступить в команду")}</button></div>
          )}
        </>
      )}
    </div>
  );
}
