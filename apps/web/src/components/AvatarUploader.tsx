import { useRef, useState, type ReactNode } from "react";
import { ApiError, apiUpload, api } from "../lib/api";
import { t } from "../lib/i18n";
import { useUi } from "../lib/ui";
import { Icon } from "./Icon";

/**
 * Загрузка аватарки (решение владельца 24.10): одна и та же для участника и команды. Фото уменьшается ещё на телефоне
 * (до 512 px), чтобы не гонять мегабайты, сервер сжимает окончательно и проверяет на уместность. Предупреждение
 * про уместность и бан — всегда на виду рядом с кнопкой.
 */
export function AvatarUploader({ preview, url, hasAvatar, blocked, onChanged, hint }: {
  /** Как сейчас выглядит аватарка (кружок с буквой или фото). */
  preview: ReactNode;
  /** POST с файлом и DELETE — один адрес. */
  url: string;
  hasAvatar: boolean;
  /** Суперадмин запретил загрузку. */
  blocked?: boolean;
  onChanged: () => void | Promise<void>;
  hint?: string;
}) {
  const ui = useUi();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const blob = await shrink(file);
      await apiUpload(url, blob, file.name);
      await onChanged();
      ui.notify(t("Фото поставлено"));
    } catch (e) { ui.notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  async function remove() {
    setBusy(true);
    try { await api(url, { method: "DELETE" }); await onChanged(); ui.notify(t("Фото убрано")); }
    catch (e) { ui.notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusy(false); }
  }
  return (
    <div className="avatar-uploader">
      <div className="row">
        {preview}
        <div className="actions">
          <input ref={input} type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} />
          <button type="button" className="sm" disabled={busy || blocked} onClick={() => input.current?.click()}><Icon name="camera" />{hasAvatar ? t("Заменить фото") : t("Поставить фото")}</button>
          {hasAvatar && <button type="button" className="ghost sm" disabled={busy} onClick={() => void remove()}><Icon name="x" />{t("Убрать")}</button>}
        </div>
      </div>
      {blocked
        ? <p className="note warn"><Icon name="alert" /><span>{t("Загрузка фото вам закрыта администратором платформы.")}</span></p>
        : <p className="hint">{hint ?? t("Фото должно быть уместным. Каждое проверяется; за неуместное фото — бан.")}</p>}
    </div>
  );
}

/** Уменьшение на устройстве до 512 px по большей стороне; если холст недоступен — файл уходит как есть. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.size < 400_000) return file;
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("canvas"))), "image/jpeg", 0.9));
  } catch { return file; }
}
