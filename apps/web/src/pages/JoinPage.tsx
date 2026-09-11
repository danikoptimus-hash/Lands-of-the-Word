import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { Chip } from "../components/Chip";
import { TeamAvatar } from "../components/TeamAvatar";
import { LoadingState } from "../components/State";
import { GuestShell, errorText } from "./LoginPage";

interface InviteInfo { invite: { role: "CAPTAIN" | "MEMBER"; team: { id: string; name: string; color: string }; game: { id: string; name: string; org: { name: string } } }; alreadyIn: { id: string; name: string } | null }

/** Приглашение в команду по ссылке от капитана или администратора. Гостя сначала отправляем на вход. */
export function JoinPage() {
  const { token = "" } = useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    api<InviteInfo>(`/api/invites/${token}`).then(setInfo).catch((e) => setError(errorText(e)));
  }, [token, user]);

  if (!loading && !user) return <Navigate to={`/login?next=/join/${token}`} replace />;

  async function accept() {
    setBusy(true); setError(null);
    try {
      const r = await api<{ team: { gameId: string } }>(`/api/invites/${token}/accept`, { method: "POST" });
      navigate(`/games/${r.team.gameId}/team`);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }

  const mapUrl = info ? `/games/${info.invite.game.id}/team` : "/";
  return (
    <GuestShell title={t("Приглашение в команду")}>
      {!info && !error && <LoadingState rows={3} />}
      {!info && error && (
        <>
          <p className="note bad" role="alert">{error}</p>
          <p className="muted">{t("Попросите у капитана новую ссылку-приглашение.")}</p>
          <div className="actions"><Link to="/" className="btn secondary block">{t("На главную")}</Link></div>
        </>
      )}
      {info && (
        <div className="stack">
          <p><span className="muted">{t("Игра")}</span> <strong>{info.invite.game.name}</strong> · {info.invite.game.org.name}</p>
          <div className="invite-team">
            <TeamAvatar name={info.invite.team.name} color={info.invite.team.color} withName />
            {info.invite.role === "CAPTAIN" && <Chip icon="star">{t("капитан")}</Chip>}
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          {info.alreadyIn ? (
            <>
              <p className="muted">{t("Вы уже в команде «{name}» этой игры.", { name: info.alreadyIn.name })}</p>
              <div className="actions"><Link to={mapUrl} className="btn block">{t("Открыть карту")}</Link></div>
            </>
          ) : (
            <div className="actions"><button type="button" className="block" onClick={() => void accept()} disabled={busy}>{t("Вступить в команду")}</button></div>
          )}
        </div>
      )}
    </GuestShell>
  );
}
