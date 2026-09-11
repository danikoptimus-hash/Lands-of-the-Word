import { useEffect, useState } from "react";
import { disablePush, enablePush, isIos, isStandalone, pushState, type PushState } from "../lib/push";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { Icon } from "./Icon";

/**
 * Уведомления на этом устройстве. compact — карточка в одну строку для настроек игры и меню команды:
 * показывается, только пока уведомления не включены (иначе — ничего, чтобы не оставлять пустую карточку).
 * Полный вид — карточка на странице аккаунта.
 */
export function PushToggle({ compact = false }: { compact?: boolean }) {
  const ui = useUi();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void pushState().then(setState); }, []);
  if (state === null) return null;
  const iosHint = isIos() && !isStandalone();

  async function toggle() {
    setBusy(true);
    try {
      const next = state === "on" ? await disablePush() : await enablePush();
      setState(next);
      if (next === "on") ui.notify(t("Уведомления включены"));
      else if (next === "off") ui.notify(t("Уведомления выключены"), "info");
      else if (next === "denied") ui.notify(t("Уведомления запрещены в настройках браузера"), "bad");
    } catch { ui.notify(t("Не удалось включить уведомления"), "bad"); }
    finally { setBusy(false); }
  }

  if (compact) {
    if (state === "on" || state === "unsupported") return null;
    return (
      <div className="card">
        <div className="card-head"><h2><span className="ico"><Icon name="bell" /></span>{t("Уведомления")}</h2></div>
        {iosHint ? <p className="muted small">{t("Чтобы получать уведомления на iPhone, добавьте сайт на экран «Домой» и включите их в аккаунте.")}</p> : (
          <div className="push-row">
            <span>{t("Уведомления о делах, испытаниях и проходах — на это устройство.")}</span>
            <button type="button" className="secondary sm" onClick={() => void toggle()} disabled={busy || state === "denied"}><Icon name="bell" />{state === "denied" ? t("Запрещены в браузере") : t("Включить")}</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head"><h2><span className="ico"><Icon name="bell" /></span>{t("Уведомления на этом устройстве")}</h2></div>
      {state === "unsupported" && <p className="muted">{iosHint ? t("На iPhone уведомления работают, только если сайт добавлен на экран «Домой» (Поделиться → На экран «Домой»). Откройте его оттуда и включите уведомления здесь.") : t("Этот браузер не поддерживает push-уведомления.")}</p>}
      {state === "denied" && <p className="note warn"><Icon name="alert" /><span>{t("Уведомления запрещены в настройках браузера для этого сайта. Разрешите их там и обновите страницу.")}</span></p>}
      {(state === "off" || state === "on") && (
        <>
          <p className="muted">{state === "on" ? t("Включены: уведомления о делах, испытаниях и проходах приходят сюда даже при закрытом сайте.") : t("Уведомления о делах, испытаниях и проходах будут приходить на это устройство даже при закрытом сайте. Письма на почту при этом остаются.")}</p>
          <div className="actions"><button type="button" className={state === "on" ? "secondary" : ""} disabled={busy} onClick={() => void toggle()}>{state === "on" ? t("Выключить") : t("Включить уведомления")}</button></div>
        </>
      )}
    </div>
  );
}
