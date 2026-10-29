import { useState } from "react";
import { AvatarLightbox } from "./AvatarLightbox";

/**
 * Команда всегда показывается одинаково: кружок цвета команды с первой буквой (или фото команды, решение владельца 24.10)
 * + название рядом (по желанию). Нажатие на фото показывает его крупно (zoom; выключается внутри кнопок).
 */
export function TeamAvatar({ name, color, avatarId, size, withName = false, title, zoom = true, teamId, gameId }: { /** Команда игры: по нажатию карточка с её наградами (решение владельца 29.10), даже без фото. */ teamId?: string; /** Игра, если её нет в адресе страницы (список «Мои игры»). */ gameId?: string; name: string; color: string; /** Аватарка команды, если капитан её поставил. */ avatarId?: string | null; size?: "sm" | "lg"; withName?: boolean; /** Подсказка с названием команды, когда названия словами рядом нет. */ title?: string; zoom?: boolean }) {
  const [open, setOpen] = useState(false);
  const canZoom = (Boolean(avatarId) || Boolean(teamId)) && zoom;
  const a = (
    <span
      className={"avatar team" + (size ? " " + size : "") + (avatarId ? " photo" : "") + (canZoom ? " zoomable" : "")}
      style={{ ["--team" as string]: color }}
      aria-hidden={title || canZoom ? undefined : "true"} title={title} aria-label={canZoom ? name : title}
      role={canZoom ? "button" : undefined} tabIndex={canZoom ? 0 : undefined}
      onClick={canZoom ? (e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); } : undefined}
      onKeyDown={canZoom ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setOpen(true); } } : undefined}
    >
      {avatarId ? <img src={`/api/avatars/${avatarId}`} alt="" loading="lazy" decoding="async" /> : name.slice(0, 1).toUpperCase()}
    </span>
  );
  const box = open && canZoom ? <AvatarLightbox avatarId={avatarId ?? null} name={name} teamId={teamId} gameId={gameId} color={color} onClose={() => setOpen(false)} /> : null;
  if (!withName) return <>{a}{box}</>;
  return <span className="person">{a}<span className="name">{name}</span>{box}</span>;
}
