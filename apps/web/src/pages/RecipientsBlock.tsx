import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { Icon } from "../components/Icon";

type Kind = "FAMILY" | "WIDOW" | "ELDER" | "OTHER";
interface RecipientDto { id: string; label: string; kind: Kind; envelopes: number }
const KIND_RU: Record<Kind, string> = { FAMILY: "семья", WIDOW: "вдова", ELDER: "старец / старица", OTHER: "другой адресат" };
export const kindLabel = (k: Kind) => t(KIND_RU[k]);

/** Адресаты конвертов: кому команды несут шифр. Только подпись и тип, без адресов; список стирается при завершении игры. */
export function RecipientsBlock({ gameId, status, version = 0 }: { gameId: string; status: string; version?: number }) {
  const [rows, setRows] = useState<RecipientDto[]>([]);
  const [cities, setCities] = useState(0);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<Kind>("FAMILY");
  const [error, setError] = useState<string | null>(null);
  const ui = useUi();
  const load = () => api<{ recipients: RecipientDto[]; cities: number }>(`/api/games/${gameId}/recipients`).then((r) => { setRows(r.recipients); setCities(r.cities); }).catch(() => setRows([]));
  useEffect(() => { void load(); }, [gameId, version]); // eslint-disable-line react-hooks/exhaustive-deps

  async function add(e: FormEvent) {
    e.preventDefault(); setError(null);
    try { await api(`/api/games/${gameId}/recipients`, { method: "POST", body: JSON.stringify({ label: label.trim(), kind }) }); setLabel(""); await load(); }
    catch (err) { setError(err instanceof ApiError ? err.message : t("Ошибка сети")); }
  }
  async function remove(r: RecipientDto) {
    if (!(await ui.confirm(t("Убрать адресата «{label}»? Его города получат другого адресата при следующей печати ярлыков.", { label: r.label }), { okLabel: t("Убрать"), danger: true }))) return;
    await api(`/api/games/${gameId}/recipients/${r.id}`, { method: "DELETE" }); await load();
  }
  const finished = status === "FINISHED";
  return (
    <div className="card" data-tone="green">
      <div className="card-head">
        <h2><span className="ico"><Icon name="mail" /></span>{t("Адресаты конвертов")} <span className="muted">{rows.length}</span></h2>
        {rows.length > 0 && cities > 0 && <>
          <a href={`/api/games/${gameId}/labels.pdf`} download className="btn sm" style={{ textDecoration: "none" }}><Icon name="scroll" />{t("Скачать ярлыки (PDF)")}</a>
          <Link to={`/games/${gameId}/labels`} className="btn ghost sm" style={{ textDecoration: "none" }}><Icon name="eye" />{t("Предпросмотр")}</Link>
        </>}
      </div>
      <p className="muted" style={{ marginTop: 0 }}>{t("Команда, решившая все задания города, несёт шифр адресату и получает конверт с ключом. Игра раздаёт адресатов по городам поровну: {cities} городов на {n} адресатов.", { cities, n: rows.length || "…" })}</p>
      {finished ? <p className="note ok">{t("Игра завершена: список адресатов стёрт.")}</p> : (
        <form onSubmit={add} className="inline-form" style={{ flexWrap: "wrap" }}>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("Подпись: например, «бабушка с улицы Садовой»")} maxLength={60} aria-label={t("Адресат")} style={{ flex: "1 1 220px" }} />
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} style={{ width: "auto", minHeight: 40 }}>
            {(Object.keys(KIND_RU) as Kind[]).map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
          </select>
          <button type="submit" className="secondary sm" disabled={label.trim().length < 2}><Icon name="plus" />{t("Добавить")}</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
      {rows.length > 0 && (
        <ul className="list">
          {rows.map((r) => (
            <li key={r.id}>
              <div className="main"><strong>{r.label}</strong> <span className="badge">{kindLabel(r.kind)}</span> <span className="muted">· {t("конвертов: {n}", { n: r.envelopes })}</span></div>
              {!finished && <button className="ghost sm icon" onClick={() => void remove(r)} aria-label={t("Убрать адресата")} title={t("Убрать")}><Icon name="trash" /></button>}
            </li>
          ))}
        </ul>
      )}
      <p className="hint">{t("Храним только подпись и тип: без фамилий, адресов и телефонов. Спросите согласие человека заранее. Список виден только админам и стирается при завершении игры.")}</p>
    </div>
  );
}
