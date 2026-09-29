import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { t } from "../lib/i18n";
import { Icon } from "../components/Icon";
import { Back } from "../components/Back";
import { LoadingState } from "../components/State";
import { useAuth } from "../lib/auth";
import { useUi } from "../lib/ui";

interface Row { nodeKey: string; bookCode: string; number: number; name: string; cityKey: string; cityCode: string; recipient: { label: string; kind: "FAMILY" | "WIDOW" | "ELDER" | "OTHER" } | null }

/**
 * Ярлыки для конвертов: на каждый город — наружный ярлык (кому, город, шифр) и вкладыш (поздравление и ключ).
 * Это предпросмотр; для печати сервер отдаёт один PDF со всеми ярлыками.
 */
export function LabelsPage() {
  const { id = "" } = useParams();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [game, setGame] = useState("");
  const [error, setError] = useState<string | null>(null);
  const superadmin = useAuth().user?.platformRole === "SUPERADMIN";
  const { notify } = useUi();
  const [restoreText, setRestoreText] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api<{ game: { name: string }; labels: Row[] }>(`/api/games/${id}/labels`).then((r) => { setRows(r.labels); setGame(r.game.name); }).catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети")));
  /** Возврат шифров и ключей из напечатанных ярлыков (инцидент 29.09): только администратор платформы. */
  async function restore() {
    setBusy(true);
    try {
      const r = await api<{ updated: number; total: number }>(`/api/games/${id}/labels/restore`, { method: "POST", body: JSON.stringify({ text: restoreText }) });
      notify(t("Возвращено: {n} из {total} городов", { n: r.updated, total: r.total }), "info"); setRestoreText(""); await load();
    } catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    void load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="labels-page">
      <div className="no-print">
        <Back to={`/games/${id}`} label={game || t("К игре")} />
        <div className="page-head">
          <h1><span className="ico"><Icon name="printer" /></span>{t("Ярлыки для конвертов")} {rows && <span className="count-chip">{rows.length}</span>}</h1>
          {rows && <a href={`/api/games/${id}/labels.pdf`} download className="btn"><Icon name="printer" />{t("Скачать PDF")}</a>}
        </div>
        {rows && <p className="muted small">{t("Наружный ярлык — на конверт, вкладыш — внутрь; разрежьте по пунктиру.")}</p>}
        {rows && superadmin && (
          <details className="fold">
            <summary><Icon name="alert" />{t("Вернуть шифры и ключи из напечатанных ярлыков")}<Icon name="chevron-down" className="chev" /></summary>
            <p className="muted small">{t("Если ярлыки напечатали, а шифры и ключи в игре потом изменились: вставьте строки «книга, шифр, ключ» (через табуляцию или «|»), по строке на город. Применится всё сразу или ничего.")}</p>
            <textarea rows={8} value={restoreText} onChange={(e) => setRestoreText(e.target.value)} spellCheck={false} placeholder={t("Руфь | ШИФР | КЛЮЧ")} />
            <div className="actions"><button type="button" disabled={busy || !restoreText.trim()} onClick={() => void restore()}><Icon name="check" />{t("Вернуть")}</button></div>
          </details>
        )}
        {error && <p className="note warn"><Icon name="alert" /><span>{error} · <Link to={`/games/${id}`}>{t("Добавить адресатов")}</Link></span></p>}
        {!rows && !error && <LoadingState />}
      </div>
      {rows && (
        <div className="labels">
          {rows.map((r) => (
            <div className="label-row" key={r.nodeKey}>
              <div className="label outer">
                <div className="lbl-top"><span className="lbl-brand">{t("Земли Слова")} · {game}</span><span className="lbl-num">{r.number}</span></div>
                <div className="lbl-city">{t("Город {name}", { name: r.name })}</div>
                {r.recipient && <div className="lbl-to">{t("Кому")}: <strong>{r.recipient.label}</strong></div>}
                <div className="lbl-code"><span className="muted">{t("Шифр")}</span><strong>{r.cityCode}</strong></div>
                <div className="lbl-hint">{t("Отдайте конверт команде, которая назовёт этот шифр.")}</div>
              </div>
              <div className="label inner">
                <div className="lbl-top"><span className="lbl-brand">{t("Земли Слова")}</span><span className="lbl-num">{r.number}</span></div>
                <div className="lbl-congrats">{t("Поздравляем! Город {name} ваш.", { name: r.name })}</div>
                <div className="lbl-code"><span className="muted">{t("Ключ")}</span><strong className="key">{r.cityKey}</strong></div>
                <div className="lbl-hint">{t("Введите ключ в игре, чтобы взять город. Ключ секретный: не показывайте его другим командам.")}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
