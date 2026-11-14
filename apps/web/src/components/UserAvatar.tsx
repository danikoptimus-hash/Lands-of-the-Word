import { useState } from "react";
import { avatarImage } from "@lotw/domain";
import { AvatarLightbox } from "./AvatarLightbox";
import { apiReady, ready, type MemberCardDto } from "../lib/api";
import { preloadAwardImages } from "../pages/Awards";

/** Карточка участника запрашивается заранее, как только палец или курсор коснулся аватарки: к открытию она уже в памяти. */
function warm(userId?: string): void {
  if (!userId) return;
  const gameId = /\/games\/([^/]+)/.exec(window.location.pathname)?.[1];
  if (!gameId) return;
  const url = `/api/games/${gameId}/members/${userId}/card`;
  const got = ready<MemberCardDto>(url);
  if (got) preloadAwardImages(got.awards.map((g) => g.code));
  else void apiReady<MemberCardDto>(url).then((d) => preloadAwardImages(d.awards.map((g) => g.code))).catch(() => {});
}

/**
 * Аватарка участника: картинка из готового набора игры, если участник её выбрал (решение владельца 14.11), иначе
 * кружок с первой буквой. Один вид во всех списках. Нажатие на аватарку показывает её крупно (zoom; выключается там, где
 * аватарка уже внутри кнопки).
 */
export function UserAvatar({ name, avatarId, size, className, zoom = true, userId }: { name: string; avatarId?: string | null; size?: "sm" | "lg"; className?: string; zoom?: boolean; /** Участник игры: по нажатию открывается карточка с ником и личными наградами (решение владельца 29.10), даже без фото. */ userId?: string }) {
  const [open, setOpen] = useState(false);
  // Картинка — из готового набора игры (решение владельца 14.11); кода не из набора — как без аватарки.
  const src = avatarImage(avatarId);
  if (!src) avatarId = null;
  const cls = "avatar" + (size ? " " + size : "") + (className ? " " + className : "");
  if (!avatarId && !(zoom && userId)) return <span className={cls} aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>;
  if (!avatarId) return (
    <>
      <span className={cls + " zoomable"} role="button" tabIndex={0} aria-label={name} onPointerEnter={() => warm(userId)} onPointerDown={() => warm(userId)} onFocus={() => warm(userId)} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setOpen(true); } }}>{name.slice(0, 1).toUpperCase()}</span>
      {open && <AvatarLightbox avatarId={null} name={name} userId={userId} onClose={() => setOpen(false)} />}
    </>
  );
  if (!zoom) return <span className={cls + " photo"} aria-hidden="true"><img src={src ?? undefined} alt="" loading="lazy" decoding="async" /></span>;
  return (
    <>
      <span className={cls + " photo zoomable"} role="button" tabIndex={0} aria-label={name} onPointerEnter={() => warm(userId)} onPointerDown={() => warm(userId)} onFocus={() => warm(userId)} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setOpen(true); } }}>
        <img src={src ?? undefined} alt="" loading="lazy" decoding="async" />
      </span>
      {open && <AvatarLightbox avatarId={avatarId} name={name} userId={userId} onClose={() => setOpen(false)} />}
    </>
  );
}
