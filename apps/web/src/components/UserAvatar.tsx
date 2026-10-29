import { useState } from "react";
import { AvatarLightbox } from "./AvatarLightbox";

/**
 * Аватарка участника (решение владельца 24.10): фото, если участник его поставил, иначе кружок с первой буквой —
 * как и раньше. Один вид во всех списках. Нажатие на фото показывает его крупно (zoom; выключается там, где
 * аватарка уже внутри кнопки).
 */
export function UserAvatar({ name, avatarId, size, className, zoom = true, userId }: { name: string; avatarId?: string | null; size?: "sm" | "lg"; className?: string; zoom?: boolean; /** Участник игры: по нажатию открывается карточка с ником и личными наградами (решение владельца 29.10), даже без фото. */ userId?: string }) {
  const [open, setOpen] = useState(false);
  const cls = "avatar" + (size ? " " + size : "") + (className ? " " + className : "");
  if (!avatarId && !(zoom && userId)) return <span className={cls} aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>;
  if (!avatarId) return (
    <>
      <span className={cls + " zoomable"} role="button" tabIndex={0} aria-label={name} onClick={(e) => { e.stopPropagation(); setOpen(true); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setOpen(true); } }}>{name.slice(0, 1).toUpperCase()}</span>
      {open && <AvatarLightbox avatarId={null} name={name} userId={userId} onClose={() => setOpen(false)} />}
    </>
  );
  if (!zoom) return <span className={cls + " photo"} aria-hidden="true"><img src={`/api/avatars/${avatarId}`} alt="" loading="lazy" decoding="async" /></span>;
  return (
    <>
      <span className={cls + " photo zoomable"} role="button" tabIndex={0} aria-label={name} onClick={(e) => { e.stopPropagation(); setOpen(true); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setOpen(true); } }}>
        <img src={`/api/avatars/${avatarId}`} alt="" loading="lazy" decoding="async" />
      </span>
      {open && <AvatarLightbox avatarId={avatarId} name={name} userId={userId} onClose={() => setOpen(false)} />}
    </>
  );
}
