import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { apiReady, ready, GAME_ROLE_ICON, GAME_ROLE_LABEL, TEAM_ROLE_LABEL, type MemberCardDto, type TeamAwardsDto } from "../lib/api";
import { t } from "../lib/i18n";
import { plural } from "../lib/format";
import { Icon } from "./Icon";
import { AwardBadge } from "../pages/Awards";

/**
 * Крупный показ аватарки по нажатию (решение владельца 24.10: «отобразиться по центру экрана крупнее»).
 * Внутри игры (решение владельца 29.10) — карточка участника: фото крупно, игровой ник, команда и роль, серия и личные
 * награды; данные берутся по id участника и игре из адреса страницы. Закрывается нажатием в любом месте или Esc.
 */
export function AvatarLightbox({ avatarId, name, userId, teamId, color, onClose }: { avatarId: string | null; name: string; userId?: string; /** Команда игры: карточка с её наградами. */ teamId?: string; color?: string; onClose: () => void }) {
  const gameId = typeof window !== "undefined" ? /\/games\/([^/]+)/.exec(window.location.pathname)?.[1] : undefined;
  // Карточка из памяти показывается сразу, свежая подгружается следом (просьба владельца 29.10: «каждый раз при открытии
  // подгружается заново»): как у разделов страницы команды.
  const url = gameId && userId ? `/api/games/${gameId}/members/${userId}/card` : null;
  const teamUrl = gameId && teamId ? `/api/games/${gameId}/awards/teams/${teamId}` : null;
  const [card, setCard] = useState<MemberCardDto | null>(() => (url ? ready<MemberCardDto>(url) : null));
  const [teamCard, setTeamCard] = useState<TeamAwardsDto | null>(() => (teamUrl ? ready<TeamAwardsDto>(teamUrl) : null));
  useEffect(() => { if (teamUrl) apiReady<TeamAwardsDto>(teamUrl).then(setTeamCard).catch(() => {}); }, [teamUrl]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => { if (url) apiReady<MemberCardDto>(url).then(setCard).catch(() => {}); }, [url]);
  const photo = avatarId ? <img src={`/api/avatars/${avatarId}`} alt={name} /> : <span className="letter" aria-hidden="true" style={color ? { background: color, color: "#FFF6E3" } : undefined}>{name.slice(0, 1).toUpperCase()}</span>;
  if (teamUrl) {
    return createPortal(
      <div className="avatar-lightbox" role="dialog" aria-label={name} onClick={(e) => { e.stopPropagation(); onClose(); }}>
        {photo}
        <div className="card" onClick={(e) => e.stopPropagation()}>
          <div className="name" style={{ color: "inherit" }}>{name}</div>
          {teamCard && (teamCard.awards.length
            ? <div className="awards-row">{teamCard.awards.map((g) => <AwardBadge key={g.code} code={g.code} earned count={g.count} size="sm" />)}</div>
            : <div className="none">{t("Наград пока нет")}</div>)}
          <button type="button" className="secondary sm" onClick={onClose}>{t("Закрыть")}</button>
        </div>
      </div>,
      document.body,
    );
  }
  if (!gameId || !userId) {
    return createPortal(
      <div className="avatar-lightbox" role="dialog" aria-label={name} onClick={(e) => { e.stopPropagation(); onClose(); }}>
        {photo}
        <div className="name">{name}</div>
        <button type="button" className="secondary" onClick={onClose}>{t("Закрыть")}</button>
      </div>,
      document.body,
    );
  }
  return createPortal(
    <div className="avatar-lightbox" role="dialog" aria-label={name} onClick={(e) => { e.stopPropagation(); onClose(); }}>
      {photo}
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="name" style={{ color: "inherit" }}>{card?.name ?? name}</div>
        {card && <div className="sub"><Icon name={card.gameRole !== "NONE" ? GAME_ROLE_ICON[card.gameRole] : card.role === "CAPTAIN" ? "crown" : "user"} />{card.team.name} · {card.gameRole !== "NONE" ? GAME_ROLE_LABEL[card.gameRole] : TEAM_ROLE_LABEL[card.role]}</div>}
        {card && card.streak.current > 0 && <div className="sub"><Icon name="sparkle" />{t("Серия: {n}", { n: plural(card.streak.current, ["день подряд", "дня подряд", "дней подряд"]) })}</div>}
        {card && (card.awards.length
          ? <div className="awards-row">{card.awards.map((g) => <AwardBadge key={g.code} code={g.code} earned count={g.count} size="sm" />)}</div>
          : <div className="none">{t("Наград пока нет")}</div>)}
        <button type="button" className="secondary sm" onClick={onClose}>{t("Закрыть")}</button>
      </div>
    </div>,
    document.body,
  );
}
