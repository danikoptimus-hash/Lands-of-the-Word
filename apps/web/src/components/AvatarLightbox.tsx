import { useEffect } from "react";
import { createPortal } from "react-dom";
import { t } from "../lib/i18n";

/**
 * Крупный показ аватарки по нажатию (решение владельца 24.10: «отобразиться по центру экрана крупнее»).
 * Закрывается нажатием в любом месте или Esc.
 */
export function AvatarLightbox({ avatarId, name, onClose }: { avatarId: string; name: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="avatar-lightbox" role="dialog" aria-label={name} onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <img src={`/api/avatars/${avatarId}`} alt={name} />
      <div className="name">{name}</div>
      <button type="button" className="secondary" onClick={onClose}>{t("Закрыть")}</button>
    </div>,
    document.body,
  );
}
