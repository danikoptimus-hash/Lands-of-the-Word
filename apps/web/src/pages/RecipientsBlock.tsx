import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { plural } from "../lib/format";
import { Icon } from "../components/Icon";
import { Chip } from "../components/Chip";
import { ActionMenu } from "../components/ActionMenu";
import { EmptyState, ErrorState, LoadingState } from "../components/State";

type Kind = "FAMILY" | "WIDOW" | "ELDER" | "OTHER";
interface RecipientDto { id: string; label: string; kind: Kind; envelopes: number }
const KIND_RU: Record<Kind, string> = { FAMILY: "семья", WIDOW: "вдова", ELDER: "пожилой человек", OTHER: "другой адресат" };
export const kindLabel = (k: Kind) => t(KIND_RU[k]);

/** Адресаты конвертов: кому команды несут шифр. Только подпись и тип, без адресов; список стирается при завершении игры. */
export function RecipientsBlock({ gameId, status, version = 0 }: { gameId: string; status: string; version?: number }) {
  const [rows, setRows] = useState<RecipientDto[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [cities, setCities] = useState(0);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<Kind>("FAMILY");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { confirm, notify } = useUi();
  const load = useCallback(() => api<{ recipients: RecipientDto[]; cities: number }>(`/api/games/${gameId}/recipients`).then((r) => { setRows(r.recipients); setCities(r.cities); setLoadError(false); }).catch(() => setLoadError(true)), [gameId]);
  useEffect(() => { void load(); }, [load, version]);

  async function add(e: FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    try { await api(`/api/games/${gameId}/recipients`, { method: "POST", body: JSON.stringify({ label: label.trim(), kind }) }); setLabel(""); notify(t("Адресат добавлен")); await load(); }
    catch (err) { setError(err instanceof ApiError ? err.message : t("Ошибка сети")); }
    finally { setBusy(false); }
  }
  async function remove(r: RecipientDto) {
    if (!(await confirm(t("Его города получат другого адресата при следующей печати ярлыков."), { title: t("Убрать адресата «{label}»?", { label: r.label }), okLabel: t("Убрать"), danger: true }))) return;
    try { await api(`/api/games/${gameId}/recipients/${r.id}`, { method: "DELETE" }); notify(t("Адресат убран")); await load(); }
    catch (err) { notify(err instanceof ApiError ? err.message : t("Ошибка сети"), "bad"); }
  }
  const finished = status === "FINISHED";
  const canPrint = (rows?.length ?? 0) > 0 && cities > 0;
  return (
    <div className="card" id="recipients">
      <div className="card-head">
        <h2><span className="ico"><Icon name="mail" /></span>{t("Адресаты конвертов")} {rows && <span className="count">{rows.length}</span>}</h2>
        {canPrint && <Link to={`/games/${gameId}/labels`} className="btn secondary sm"><Icon name="printer" />{t("Ярлыки")}</Link>}
      </div>
      <p className="muted small">{t("Кому команды понесут шифр за конвертом. Только подпись без имён и адресов — список стирается после игры.")}</p>
      {loadError ? <ErrorState onRetry={() => void load()} /> : !rows ? <LoadingState rows={2} /> : rows.length === 0 ? (
        <EmptyState inline icon="mail" text={finished ? t("Игра завершена: список адресатов стёрт.") : t("Адресатов пока нет.")} />
      ) : (
        <ul className="list">
          {rows.map((r) => (
            <li key={r.id}>
              <div className="main">
                <span className="title">{r.label} <Chip>{kindLabel(r.kind)}</Chip></span>
                <span className="meta">{plural(r.envelopes, ["конверт", "конверта", "конвертов"])}</span>
              </div>
              {!finished && <div className="side"><ActionMenu items={[{ label: t("Убрать"), icon: "trash", danger: true, onSelect: () => void remove(r) }]} /></div>}
            </li>
          ))}
        </ul>
      )}
      {!finished && rows && (
        <div className="add-row">
          <form onSubmit={add} className="inline-form">
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("Как назвать адресата, например «семья у рынка»")} maxLength={60} aria-label={t("Адресат")} />
            <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} aria-label={t("Кто это")}>
              {(Object.keys(KIND_RU) as Kind[]).map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
            </select>
            <button type="submit" className="sm" disabled={busy || label.trim().length < 2}><Icon name="plus" />{t("Добавить")}</button>
          </form>
          {error && <p className="error">{error}</p>}
          <p className="hint">{t("Спросите согласие человека заранее.")}</p>
        </div>
      )}
    </div>
  );
}
