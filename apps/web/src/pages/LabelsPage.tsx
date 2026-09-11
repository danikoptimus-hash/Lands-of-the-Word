import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { t } from "../lib/i18n";
import { Icon } from "../components/Icon";
import { kindLabel } from "./RecipientsBlock";

interface Row { nodeKey: string; bookCode: string; number: number; name: string; cityKey: string; cityCode: string; recipient: { label: string; kind: "FAMILY" | "WIDOW" | "ELDER" | "OTHER" } | null }

/**
 * Ярлыки для конвертов: на каждый город — наружный ярлык (кому, город, шифр для семьи) и вкладыш
 * (поздравление и ключ). Печать браузером: «Сохранить как PDF» на компьютере и телефоне.
 */
export function LabelsPage() {
  const { id = "" } = useParams();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [game, setGame] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ game: { name: string }; labels: Row[] }>(`/api/games/${id}/labels`).then((r) => { setRows(r.labels); setGame(r.game.name); }).catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети")));
  }, [id]);
  return (
    <div className="labels-page">
      <div className="no-print">
        <Link to={`/games/${id}#deeds`} className="crumb"><Icon name="back" />{t("К игре")}</Link>
        <div className="page-head">
          <h1>{t("Ярлыки для конвертов")} {rows && <span className="muted" style={{ fontSize: "1rem" }}>· {rows.length}</span>}</h1>
          {rows && <button onClick={() => window.print()}><Icon name="scroll" />{t("Печать / сохранить PDF")}</button>}
        </div>
        {rows && <p className="muted">{t("Каждая полоса — один конверт: левый ярлык клеится снаружи, правый вкладывается внутрь. Разрежьте по пунктиру. В окне печати выберите «Сохранить как PDF».")}</p>}
        {error && <p className="note warn">{error} · <Link to={`/games/${id}#deeds`}>{t("открыть настройки")}</Link></p>}
        {!rows && !error && <p className="muted">{t("Загрузка…")}</p>}
      </div>
      {rows && (
        <div className="labels">
          {rows.map((r) => (
            <div className="label-row" key={r.nodeKey}>
              <div className="label outer">
                <div className="lbl-top"><span className="lbl-brand">{t("Земли Слова")} · {game}</span><span className="lbl-num">{r.number}</span></div>
                <div className="lbl-city">{t("Город {name}", { name: r.name })}</div>
                {r.recipient && <div className="lbl-to">{t("Кому")}: <strong>{r.recipient.label}</strong> <span className="muted">({kindLabel(r.recipient.kind)})</span></div>}
                <div className="lbl-code"><span className="muted">{t("Шифр для семьи")}</span><strong>{r.cityCode}</strong></div>
                <div className="lbl-hint">{t("Отдайте конверт команде, которая назовёт этот шифр.")}</div>
              </div>
              <div className="label inner">
                <div className="lbl-top"><span className="lbl-brand">{t("Земли Слова")}</span><span className="lbl-num">{r.number}</span></div>
                <div className="lbl-congrats">{t("Поздравляем с открытием города {name}!", { name: r.name })}</div>
                <div className="lbl-code"><span className="muted">{t("Ключ города")}</span><strong className="key">{r.cityKey}</strong></div>
                <div className="lbl-hint">{t("Введите ключ в игре, чтобы занять город. Ключ секретный: не показывайте его другим командам.")}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
