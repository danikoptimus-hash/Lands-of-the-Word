import { useState } from "react";
import { api, ApiError } from "../lib/api";
import { t } from "../lib/i18n";
import { useUi } from "../lib/ui";
import { Icon } from "./Icon";

/**
 * «Пригласить: Капитана / Участника» — администратору в профиле команды (решение владельца 04.11: «переносим тоже в профиль
 * команды»; до того — в списке команд). Приглашение одной кнопкой (решение владельца 21.09): нажатие создаёт ссылку и сразу
 * кладёт её в буфер. В Safari буфер доступен только из жеста, поэтому ссылка передаётся обещанием через ClipboardItem; где его
 * нет — дожидаемся ответа и пишем текст. Если буфер недоступен — ссылка показывается, чтобы выделить вручную.
 */
export function InviteButtons({ gameId, teamId, roles = ["CAPTAIN", "MEMBER"] }: { gameId: string; teamId: string; /** Администратор зовёт капитана и участников; капитан (решение владельца 04.11: «для капитана тоже перенести в профиль») — только участников. */ roles?: Array<"CAPTAIN" | "MEMBER"> }) {
  const { notify } = useUi();
  const [inviting, setInviting] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  async function inviteCopy(role: "CAPTAIN" | "MEMBER") {
    setInviting(role); setFallback(null);
    const url = api<{ invite: { path: string } }>(`/api/games/${gameId}/teams/${teamId}/invites`, { method: "POST", body: JSON.stringify({ role }) }).then((r) => window.location.origin + r.invite.path);
    const done = role === "CAPTAIN" ? t("Ссылка для капитана скопирована: действует 14 дней") : t("Ссылка для участников скопирована: действует 14 дней, до 20 человек");
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": url.then((u) => new Blob([u], { type: "text/plain" })) })]);
      } else {
        await navigator.clipboard.writeText(await url);
      }
      notify(done); setCopied(role); setTimeout(() => setCopied((k) => (k === role ? null : k)), 1500);
    } catch (err) {
      if (err instanceof ApiError) { notify(err.message, "bad"); return; }
      try { setFallback(await url); notify(t("Не удалось скопировать: выделите ссылку вручную"), "bad"); } catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    } finally { setInviting(null); }
  }
  return (
    <>
      <div className="row team-invites">
        {roles.length > 1
          ? <>
              <span className="muted small">{t("Пригласить")}:</span>
              <span className="invite-btns" role="group" aria-label={t("Пригласить")}>
                {roles.includes("CAPTAIN") && <button type="button" className="secondary sm" disabled={inviting === "CAPTAIN"} title={t("Скопировать ссылку для капитана")} onClick={() => void inviteCopy("CAPTAIN")}><Icon name={copied === "CAPTAIN" ? "check" : "link"} />{t("Капитана")}</button>}
                {roles.includes("MEMBER") && <button type="button" className="secondary sm" disabled={inviting === "MEMBER"} title={t("Скопировать ссылку для участников")} onClick={() => void inviteCopy("MEMBER")}><Icon name={copied === "MEMBER" ? "check" : "link"} />{t("Участника")}</button>}
              </span>
            </>
          : <button type="button" className="secondary sm" disabled={inviting === "MEMBER"} title={t("Скопировать ссылку для участников")} onClick={() => void inviteCopy("MEMBER")}><Icon name={copied === "MEMBER" ? "check" : "link"} />{t("Пригласить участника")}</button>}
      </div>
      {fallback && <p className="hint invite-fallback"><a href={fallback}>{fallback}</a></p>}
    </>
  );
}
