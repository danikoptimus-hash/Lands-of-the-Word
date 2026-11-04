import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { apiReady, ready, GAME_ROLE_ICON, GAME_ROLE_LABEL, TEAM_ROLE_LABEL, type MemberCardDto, type TeamAwardsDto } from "../lib/api";
import { t } from "../lib/i18n";
import { plural } from "../lib/format";
import { Icon } from "./Icon";
import { AwardBadge, AwardSheet, preloadAwardImages } from "../pages/Awards";
import { AvatarUploader } from "./AvatarUploader";
import { InviteButtons } from "./InviteButtons";
import { PeaceActions } from "./PeaceActions";
import { useAuth } from "../lib/auth";
import type { AwardGrantDto } from "../lib/api";

/**
 * Крупный показ аватарки по нажатию (решение владельца 24.10: «отобразиться по центру экрана крупнее»).
 * Внутри игры (решение владельца 29.10) — карточка участника: фото крупно, игровой ник, команда и роль, серия и личные
 * награды; данные берутся по id участника и игре из адреса страницы. Закрывается нажатием в любом месте или Esc.
 * Профиль команды (решение владельца 04.11): капитан ставит или меняет фото команды нажатием на само фото здесь же;
 * отдельного блока в составе больше нет.
 */
export function AvatarLightbox({ avatarId, name, userId, teamId, color, gameId: gameIdProp, onClose }: { avatarId: string | null; name: string; userId?: string; /** Команда игры: карточка с её наградами. */ teamId?: string; color?: string; /** Игра, если её нет в адресе страницы. */ gameId?: string; onClose: () => void }) {
  const gameId = gameIdProp ?? (typeof window !== "undefined" ? /\/games\/([^/]+)/.exec(window.location.pathname)?.[1] : undefined);
  // Карточка из памяти показывается сразу, свежая подгружается следом (просьба владельца 29.10: «каждый раз при открытии
  // подгружается заново»): как у разделов страницы команды.
  const url = gameId && userId ? `/api/games/${gameId}/members/${userId}/card` : null;
  const teamUrl = gameId && teamId ? `/api/games/${gameId}/awards/teams/${teamId}` : null;
  const [card, setCard] = useState<MemberCardDto | null>(() => (url ? ready<MemberCardDto>(url) : null));
  const [teamCard, setTeamCard] = useState<TeamAwardsDto | null>(() => (teamUrl ? ready<TeamAwardsDto>(teamUrl) : null));
  // Описание награды по нажатию на значок (решение владельца 30.10) — и у участников, и у администратора.
  const [pick, setPick] = useState<AwardGrantDto | null>(null);
  const { user } = useAuth();
  const loadTeam = () => (teamUrl ? apiReady<TeamAwardsDto>(teamUrl).then((d) => { setTeamCard(d); preloadAwardImages(d.awards.map((g) => g.code)); }).catch(() => {}) : Promise.resolve());
  useEffect(() => { void loadTeam(); }, [teamUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Пока карточка открыта, листы и окна подтверждения из её кнопок (мир, фото, награда) поднимаются над ней
  // (замечание владельца 04.11: «нажимаю предложить мир, окно вылетает под профилем»): класс на body, правило в components.css.
  useEffect(() => { document.body.classList.add("has-lightbox"); return () => document.body.classList.remove("has-lightbox"); }, []);
  useEffect(() => { if (url) apiReady<MemberCardDto>(url).then((d) => { setCard(d); preloadAwardImages(d.awards.map((g) => g.code)); }).catch(() => {}); }, [url]);
  const photo = avatarId ? <img src={`/api/avatars/${avatarId}`} alt={name} /> : <span className="letter" aria-hidden="true" style={color ? { background: color, color: "#FFF6E3" } : undefined}>{name.slice(0, 1).toUpperCase()}</span>;
  if (teamUrl) {
    // Свежая аватарка — из карточки (после замены родитель узнаёт о ней позже, по событию «состав»).
    const teamAvatarId = teamCard ? teamCard.team.avatarId ?? null : avatarId;
    const teamPhoto = teamAvatarId ? <img src={`/api/avatars/${teamAvatarId}`} alt={name} /> : <span className="letter" aria-hidden="true" style={color ? { background: color, color: "#FFF6E3" } : undefined}>{name.slice(0, 1).toUpperCase()}</span>;
    return createPortal(
      <div className="avatar-lightbox" role="dialog" aria-label={name} onClick={(e) => { e.stopPropagation(); onClose(); }}>
        {teamCard?.canEdit && gameId && teamId
          ? <div className="team-photo-edit" onClick={(e) => e.stopPropagation()}><AvatarUploader preview={teamPhoto} url={`/api/games/${gameId}/teams/${teamId}/avatar`} hasAvatar={Boolean(teamAvatarId)} blocked={user?.avatarBlocked} onChanged={loadTeam} label={teamAvatarId ? t("Заменить фото команды") : t("Поставить фото команды")} /></div>
          : teamPhoto}
        <div className="card" onClick={(e) => e.stopPropagation()}>
          <div className="name" style={{ color: "inherit" }}>{name}</div>
          {teamCard && (teamCard.awards.length
            ? <div className="awards-row">{teamCard.awards.map((g) => <AwardBadge key={g.code} code={g.code} earned count={g.count} size="sm" eager onClick={() => setPick(g)} />)}</div>
            : <div className="none">{t("Наград пока нет")}</div>)}
          {/* Приглашения: администратору — капитана и участников, капитану — участников (решение владельца 04.11). Кнопки «Закрыть» нет: закрывается нажатием мимо карточки или Esc. */}
          {gameId && teamId && (teamCard?.canInvite ? <InviteButtons gameId={gameId} teamId={teamId} /> : teamCard?.canEdit ? <InviteButtons gameId={gameId} teamId={teamId} roles={["MEMBER"]} /> : null)}
          {/* Мир с другой командой — отсюда (решение владельца 04.11); у своей команды компонент ничего не показывает. */}
          {gameId && teamId && !teamCard?.canEdit && <PeaceActions gameId={gameId} teamId={teamId} />}
        </div>
        {pick && <AwardSheet code={pick.code} grant={pick} onClose={() => setPick(null)} />}
      </div>,
      document.body,
    );
  }
  if (!gameId || !userId) {
    return createPortal(
      <div className="avatar-lightbox" role="dialog" aria-label={name} onClick={(e) => { e.stopPropagation(); onClose(); }}>
        {photo}
        <div className="name">{name}</div>
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
          ? <div className="awards-row">{card.awards.map((g) => <AwardBadge key={g.code} code={g.code} earned count={g.count} size="sm" eager onClick={() => setPick(g)} />)}</div>
          : <div className="none">{t("Наград пока нет")}</div>)}
      </div>
      {pick && <AwardSheet code={pick.code} grant={pick} onClose={() => setPick(null)} />}
    </div>,
    document.body,
  );
}
