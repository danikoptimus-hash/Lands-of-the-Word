import { useEffect, useState } from "react";
import { disablePush, enablePush, isIos, isStandalone, pushState, type PushState } from "../lib/push";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { Icon } from "./Icon";

/**
 * Включение push-уведомлений на этом устройстве. compact — одна строка для бокового меню и настроек игры
 * (показывается, только пока уведомления не включены); полный вид — карточка на странице аккаунта.
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
      else if (next === "denied") ui.notify(t("Уведомления запрещены в настройках браузера"));
    } catch { ui.notify(t("Не удалось включить уведомления")); }
    finally { setBusy(false); }
  }

  if (compact) {
    if (state === "on" || state === "unsupported") return null;
    if (iosHint) return <p className="hint"><Icon name="bell" />{t("Чтобы получать уведомления на iPhone, добавьте сайт на экран «Домой» и включите их в аккаунте.")}</p>;
    return (
      <div className="push-prompt">
        <span>{t("Вести о делах, испытаниях и проходах — сразу на это устройство.")}</span>
        <button className="sm" onClick={() => void toggle()} disabled={busy || state === "denied"}><Icon name="bell" />{state === "denied" ? t("Запрещены в браузере") : t("Включить уведомления")}</button>
      </div>
    );
  }

  return (
    <div className="card auth" style={{ margin: "1rem auto 0" }}>
      <h2><span className="ico"><Icon name="bell" /></span>{t("Уведомления на этом устройстве")}</h2>
      {state === "unsupported" && <p className="muted">{iosHint ? t("На iPhone уведомления работают, только если сайт добавлен на экран «Домой» (Поделиться → На экран «Домой»). Откройте его оттуда и включите уведомления здесь.") : t("Этот браузер не поддерживает push-уведомления.")}</p>}
      {state === "denied" && <p className="note warn">{t("Уведомления запрещены в настройках браузера для этого сайта. Разрешите их там и обновите страницу.")}</p>}
      {(state === "off" || state === "on") && (
        <>
          <p className="muted">{state === "on" ? t("Включены: вести о делах, испытаниях и проходах приходят сюда даже при закрытом сайте.") : t("Вести о делах, испытаниях и проходах будут приходить на это устройство даже при закрытом сайте. Письма на почту при этом остаются.")}</p>
          <div className="actions"><button className={state === "on" ? "secondary" : ""} disabled={busy} onClick={() => void toggle()}>{state === "on" ? t("Выключить") : t("Включить уведомления")}</button></div>
        </>
      )}
    </div>
  );
}
