import { useRef, useState, type ReactNode } from "react";
import { ApiError, apiUpload, api } from "../lib/api";
import { t } from "../lib/i18n";
import { useUi } from "../lib/ui";
import { Icon } from "./Icon";
import { AvatarCropper } from "./AvatarCropper";

/**
 * Аватарка (решение владельца 24.10): одна и та же для участника и команды. Нажатие на само фото открывает выбор
 * файла (отдельной кнопки нет — замечание владельца), затем кадрирование в круге; сервер сжимает и проверяет на
 * уместность. Предупреждение про уместность и бан — всегда на виду под фото.
 */
export function AvatarUploader({ preview, url, hasAvatar, blocked, onChanged, hint, label }: {
  /** Как сейчас выглядит аватарка (кружок с буквой или фото). */
  preview: ReactNode;
  /** POST с файлом и DELETE — один адрес. */
  url: string;
  hasAvatar: boolean;
  /** Суперадмин запретил загрузку. */
  blocked?: boolean;
  onChanged: () => void | Promise<void>;
  hint?: string;
  /** Подпись для читалок у кнопки-фото. */
  label?: string;
}) {
  const ui = useUi();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<File | null>(null);
  async function send(blob: Blob) {
    setPicked(null); setBusy(true);
    try { await apiUpload(url, blob, "avatar.jpg"); await onChanged(); ui.notify(t("Фото поставлено")); }
    catch (e) { ui.notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!(await ui.confirm(t("Убрать фото?"), { okLabel: t("Убрать") }))) return;
    setBusy(true);
    try { await api(url, { method: "DELETE" }); await onChanged(); ui.notify(t("Фото убрано")); }
    catch (e) { ui.notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusy(false); }
  }
  return (
    <div className="avatar-uploader">
      <div className="row">
        <button type="button" className="avatar-btn" disabled={busy || blocked} onClick={() => input.current?.click()} aria-label={label ?? (hasAvatar ? t("Заменить фото") : t("Поставить фото"))} title={hasAvatar ? t("Заменить фото") : t("Поставить фото")}>
          {preview}
          <span className="badge" aria-hidden="true"><Icon name="camera" /></span>
        </button>
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setPicked(f); e.target.value = ""; }} />
        {hasAvatar && <button type="button" className="ghost icon sm" disabled={busy} onClick={() => void remove()} aria-label={t("Убрать фото")} title={t("Убрать фото")}><Icon name="trash" /></button>}
      </div>
      {blocked
        ? <p className="note warn"><Icon name="alert" /><span>{t("Загрузка фото вам закрыта администратором платформы.")}</span></p>
        : <p className="hint">{hint ?? t("Фото должно быть уместным. Каждое проверяется; за неуместное фото — бан.")}</p>}
      {picked && <AvatarCropper file={picked} onDone={(b) => void send(b)} onCancel={() => setPicked(null)} />}
    </div>
  );
}
