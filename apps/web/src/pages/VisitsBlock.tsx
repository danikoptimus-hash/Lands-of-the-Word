import { useCallback, useState } from "react";
import { BOOKS } from "@lotw/domain";
import { api, ApiError, apiReady, ready, type VisitDto, type VisitStatus } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { Icon } from "../components/Icon";
import { Chip } from "../components/Chip";
import { TeamAvatar } from "../components/TeamAvatar";
import { Tabs } from "../components/Tabs";
import { EmptyState } from "../components/State";
import { ReturnBox, ReviewCard, useAutoRefresh } from "./SubmissionsBlock";
import { HelpPopup } from "../components/Help";

const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));
type Row = VisitDto & { team: { id: string; index: number; name: string; color: string; avatarId?: string | null } };
const STATUS: Record<VisitStatus, { text: string; tone: "neutral" | "info" | "ok" | "bad" | "warn" }> = {
  get PENDING() { return { text: t("ждёт отчёта"), tone: "warn" as const }; },
  get SUBMITTED() { return { text: t("на проверке"), tone: "info" as const }; },
  get APPROVED() { return { text: t("принят"), tone: "ok" as const }; },
  get REJECTED() { return { text: t("не принят"), tone: "bad" as const }; },
  get EXPIRED() { return { text: t("не сдан"), tone: "neutral" as const }; },
};

/** Отчёты о визитах к адресатам (решение владельца 22.10): принять или не принять; не принят — город свободен. */
export function VisitsBlock({ gameId, version = 0, onDecided }: { gameId: string; version?: number; onDecided: () => void }) {
  const { notify, confirm } = useUi();
  const [rows, setRows] = useState<Row[] | null>(() => ready<{ visits: Row[] }>(`/api/games/${gameId}/visits`)?.visits ?? null);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<"open" | "closed">("open");
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const load = useCallback(() => apiReady<{ visits: Row[] }>(`/api/games/${gameId}/visits`).then((r) => { setRows(r.visits); setLoadError(false); }).catch(() => setLoadError(true)), [gameId]);
  useAutoRefresh(load, version);

  async function decide(v: Row, approve: boolean, comment = "") {
    if (!approve) {
      const ok = await confirm(t("Город {city} станет свободным: команда «{team}» потеряет его и поедет к адресату заново.", { city: BOOK_BY_CODE.get(v.bookCode)?.nameRu ?? v.bookCode, team: v.team.name }), { title: t("Не принять отчёт?"), okLabel: t("Не принять"), danger: true });
      if (!ok) return;
    }
    setBusyId(v.id);
    try { await api(`/api/games/${gameId}/visits/${v.id}/decide`, { method: "POST", body: JSON.stringify({ approve, comment }) }); notify(approve ? t("Отчёт принят") : t("Отчёт не принят: город свободен")); setRejecting(null); await load(); onDecided(); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusyId(null); }
  }
  const all = rows ?? [];
  const open = all.filter((v) => v.status === "PENDING" || v.status === "SUBMITTED");
  const pending = all.filter((v) => v.status === "SUBMITTED").length;
  // Вторая вкладка — только решённые, без открытых (решение владельца 03.11).
  const closed = all.filter((v) => !open.includes(v));
  const shown = filter === "closed" ? closed : open;
  const nameOf = (v: Row, id: string) => v.people.find((m) => m.id === id)?.name ?? "?";

  return (
    <ReviewCard icon="users" title={t("Визиты")} count={pending} loading={!rows} error={loadError} onRetry={() => void load()}>
      {all.length > 0 && (
        <>
          {all.length > open.length && <Tabs value={filter} onChange={setFilter} ariaLabel={t("Какие визиты показывать")} items={[{ key: "open", label: t("Открытые"), count: open.length }, { key: "closed", label: t("Закрытые"), count: closed.length }]} />}
          {shown.length === 0 ? <EmptyState inline icon="users" text={t("Сейчас отчётов нет.")} /> : (
            <ul className="list">
              {shown.map((v) => {
                const st = STATUS[v.status];
                const city = BOOK_BY_CODE.get(v.bookCode)?.nameRu ?? v.bookCode;
                const who = v.members.map((id) => nameOf(v, id));
                // Карточка без лишнего (решение владельца 06.11): без слова «Визит», без дат взятия и сдачи — автоматика
                // сама закроет визит по сроку; кто ездил — число, список по нажатию; фото — квадратная кнопка перед «Принять».
                return (
                  <li key={v.id} className="review-item visit-item">
                    <div className="main">
                      <span className="row nowrap"><TeamAvatar name={v.team.name} color={v.team.color} avatarId={v.team.avatarId} size="sm" withName teamId={v.team.id} /><Chip tone={st.tone}>{st.text}</Chip></span>
                      <span className="title">{city}</span>
                      {v.members.length > 0 && (
                        <HelpPopup name={t("Кто ездил")} className="who-pop" buttonClassName="fact-btn" trigger={<><Icon name="users" />{t("{a} из {b}", { a: v.members.length, b: v.people.length })}</>}>
                          <ul className="who-list">{who.map((n, i) => <li key={i}>{n}</li>)}</ul>
                        </HelpPopup>
                      )}
                      {v.text && <span className="report">{v.text}</span>}
                      {v.adminComment && <span className="meta">{t("Комментарий: {c}", { c: v.adminComment })}</span>}
                    </div>
                    {(v.links.length > 0 || v.status === "SUBMITTED") && (
                      <div className="side">
                        {v.links.map((l, i) => (
                          <a key={l + i} className="btn secondary sm icon photo-btn" href={l} target="_blank" rel="noopener noreferrer" aria-label={v.links.length > 1 ? `${t("Фото")} ${i + 1}` : t("Фото")} title={v.links.length > 1 ? `${t("Фото")} ${i + 1}` : t("Фото")}>
                            <Icon name="camera" />{v.links.length > 1 && <i className="n">{i + 1}</i>}
                          </a>
                        ))}
                        {v.status === "SUBMITTED" && <button type="button" className="sm" onClick={() => void decide(v, true)} disabled={busyId === v.id}><Icon name="check" />{t("Принять")}</button>}
                        {v.status === "SUBMITTED" && rejecting !== v.id && <button type="button" className="secondary sm icon" aria-label={t("Не принять")} title={t("Не принять")} onClick={() => setRejecting(v.id)} disabled={busyId === v.id}><Icon name="x" /></button>}
                      </div>
                    )}
                    {rejecting === v.id && <ReturnBox placeholder={t("Причина: команда её увидит")} okLabel={t("Не принять")} busy={busyId === v.id} onOk={(text) => void decide(v, false, text)} onCancel={() => setRejecting(null)} />}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {all.length === 0 && rows && <EmptyState inline icon="users" text={t("Визитов пока нет: появятся, когда команда возьмёт город ключом.")} />}
    </ReviewCard>
  );
}
