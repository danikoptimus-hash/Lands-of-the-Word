import { useCallback, useState } from "react";
import { BOOKS } from "@lotw/domain";
import { api, ApiError, apiReady, ready, type VisitDto, type VisitStatus } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { fmtDate } from "../lib/format";
import { Icon } from "../components/Icon";
import { Chip } from "../components/Chip";
import { TeamAvatar } from "../components/TeamAvatar";
import { Tabs } from "../components/Tabs";
import { EmptyState } from "../components/State";
import { LinkList, ReturnBox, ReviewCard, useAutoRefresh } from "./SubmissionsBlock";

const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));
/** МАКЕТ 06.11: вариант карточки визита из адреса ?visits=1..4; картинка города — пока по книге (в настоящей версии придёт с сервера). */
const visitsView = (): number => Number(new URLSearchParams(window.location.search).get("visits") ?? 0) || 0;
const CITY_PIC: Record<string, string> = { php: "tent_camp", jon: "port", deu: "ruins", col: "port", rut: "village", ezk: "walled_city" };
const cityPic = (code: string) => `/img/city/${CITY_PIC[code] ?? "walled_city"}.webp`;
const timeOnly = (iso: string) => fmtDate(iso);
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
                const view = visitsView();
                const actions = v.status === "SUBMITTED" && (
                  <div className="side">
                    <button type="button" className="sm" onClick={() => void decide(v, true)} disabled={busyId === v.id}><Icon name="check" />{t("Принять")}</button>
                    {rejecting !== v.id && <button type="button" className="secondary sm" onClick={() => setRejecting(v.id)} disabled={busyId === v.id}><Icon name="x" />{t("Не принять")}</button>}
                  </div>
                );
                const returnBox = rejecting === v.id && <ReturnBox placeholder={t("Причина: команда её увидит")} okLabel={t("Не принять")} busy={busyId === v.id} onOk={(text) => void decide(v, false, text)} onCancel={() => setRejecting(null)} />;
                // Вариант 1 «Путёвка»: картинка города, название города заголовком, факты значками, отчёт цитатой.
                if (view === 1) return (
                  <li key={v.id} className="review-item visit-card">
                    <img className="v-pic" src={cityPic(v.bookCode)} alt="" />
                    <div className="main">
                      <div className="v-head"><span className="v-city">{city}</span><Chip tone={st.tone}>{st.text}</Chip></div>
                      <TeamAvatar name={v.team.name} color={v.team.color} avatarId={v.team.avatarId} size="sm" withName teamId={v.team.id} />
                      <div className="v-facts">
                        {v.members.length > 0 && <span className="fact" title={who.join(", ")}><Icon name="users" />{v.members.length} {t("из")} {v.people.length}</span>}
                        <span className="fact"><Icon name="clock" />{timeOnly(v.createdAt)}{v.submittedAt ? ` → ${timeOnly(v.submittedAt)}` : v.status === "PENDING" ? ` · ${t("до {time}", { time: timeOnly(v.dueAt) })}` : ""}</span>
                        {v.links.length > 0 && <span className="fact"><LinkList links={v.links} kind="photo" /></span>}
                      </div>
                      {v.text && <blockquote className="v-quote">{v.text}</blockquote>}
                      {who.length > 0 && <span className="v-people muted small">{who.join(" · ")}</span>}
                      {v.adminComment && <span className="meta">{t("Комментарий: {c}", { c: v.adminComment })}</span>}
                    </div>
                    {actions}{returnBox}
                  </li>
                );
                // Вариант 2 «Строка»: всё в одну строку, отчёт второй строкой.
                if (view === 2) return (
                  <li key={v.id} className="review-item visit-row">
                    <div className="main">
                      <div className="v-line">
                        <TeamAvatar name={v.team.name} color={v.team.color} avatarId={v.team.avatarId} size="sm" teamId={v.team.id} title={v.team.name} />
                        <span className="v-city">{city}</span>
                        <Chip tone={st.tone}>{st.text}</Chip>
                        {v.members.length > 0 && <span className="fact" title={who.join(", ")}><Icon name="users" />{v.members.length}/{v.people.length}</span>}
                        <span className="fact"><Icon name="clock" />{timeOnly(v.createdAt)}{v.submittedAt ? ` → ${timeOnly(v.submittedAt)}` : ""}</span>
                        {v.links.length > 0 && <span className="fact"><LinkList links={v.links} kind="photo" /></span>}
                      </div>
                      {(v.text || who.length > 0) && <div className="v-sub small">{v.text && <span className="v-q">«{v.text}»</span>}{who.length > 0 && <span className="muted"> — {who.join(", ")}</span>}</div>}
                      {v.adminComment && <span className="meta">{t("Комментарий: {c}", { c: v.adminComment })}</span>}
                    </div>
                    {actions}{returnBox}
                  </li>
                );
                // Вариант 3 «Письмо»: отчёт как письмо из города на листе, статус печатью.
                if (view === 3) return (
                  <li key={v.id} className="review-item visit-letter">
                    <div className="letter">
                      <div className="l-head">
                        <img className="l-pic" src={cityPic(v.bookCode)} alt="" />
                        <div className="l-titles"><span className="l-city">{city}</span><span className="l-from">{t("от команды")} <TeamAvatar name={v.team.name} color={v.team.color} avatarId={v.team.avatarId} size="sm" withName teamId={v.team.id} /></span></div>
                        <span className={"l-stamp " + st.tone}>{st.text}</span>
                      </div>
                      {v.text ? <p className="l-body">{v.text}</p> : <p className="l-body muted">{v.status === "PENDING" ? t("Команда ещё в пути: отчёт до {time}", { time: fmtDate(v.dueAt) }) : t("Без слов")}</p>}
                      <div className="l-foot">
                        {who.length > 0 && <span><Icon name="users" />{who.join(", ")} <span className="muted">· {v.members.length} {t("из")} {v.people.length}</span></span>}
                        <span className="muted"><Icon name="clock" />{timeOnly(v.createdAt)}{v.submittedAt ? ` → ${timeOnly(v.submittedAt)}` : ""}</span>
                        <LinkList links={v.links} kind="photo" />
                      </div>
                      {v.adminComment && <span className="meta">{t("Комментарий: {c}", { c: v.adminComment })}</span>}
                    </div>
                    {actions}{returnBox}
                  </li>
                );
                // Вариант 4 «Отряд»: как путёвка, но «кто ездил» — ряд фигурок: поехавшие яркие, остальные бледные.
                if (view === 4) return (
                  <li key={v.id} className="review-item visit-card squad">
                    <img className="v-pic" src={cityPic(v.bookCode)} alt="" />
                    <div className="main">
                      <div className="v-head"><span className="v-city">{city}</span><Chip tone={st.tone}>{st.text}</Chip></div>
                      <div className="v-facts">
                        <TeamAvatar name={v.team.name} color={v.team.color} avatarId={v.team.avatarId} size="sm" withName teamId={v.team.id} />
                        <span className="fact"><Icon name="clock" />{timeOnly(v.createdAt)}{v.submittedAt ? ` → ${timeOnly(v.submittedAt)}` : v.status === "PENDING" ? ` · ${t("до {time}", { time: timeOnly(v.dueAt) })}` : ""}</span>
                      </div>
                      {v.people.length > 0 && (
                        <div className="v-squad" title={who.join(", ")}>
                          {v.people.map((m) => <span key={m.id} className={"pip" + (v.members.includes(m.id) ? " went" : "")} title={m.name}>{m.name.slice(0, 1).toUpperCase()}</span>)}
                          <span className="small muted">{v.members.length} {t("из")} {v.people.length}{who.length > 0 ? `: ${who.join(", ")}` : ""}</span>
                        </div>
                      )}
                      {v.text && <blockquote className="v-quote">{v.text}</blockquote>}
                      <div className="v-facts">{v.links.length > 0 && <LinkList links={v.links} kind="photo" />}{v.adminComment && <span className="meta">{t("Комментарий: {c}", { c: v.adminComment })}</span>}</div>
                    </div>
                    {actions}{returnBox}
                  </li>
                );
                return (
                  <li key={v.id} className="review-item">
                    <div className="main">
                      <span className="row nowrap"><TeamAvatar name={v.team.name} color={v.team.color} avatarId={v.team.avatarId} size="sm" withName teamId={v.team.id} /><Chip tone={st.tone}>{st.text}</Chip></span>
                      <span className="title">{t("Визит · {city}", { city: BOOK_BY_CODE.get(v.bookCode)?.nameRu ?? v.bookCode })}</span>
                      <span className="meta">{t("город взят {date}", { date: fmtDate(v.createdAt) })}{v.status === "PENDING" ? ` · ${t("сдать до {time}", { time: fmtDate(v.dueAt) })}` : ""}{v.submittedAt ? ` · ${t("сдан {date}", { date: fmtDate(v.submittedAt) })}` : ""}{v.decidedAt && v.status !== "EXPIRED" ? ` · ${t("решено {date}", { date: fmtDate(v.decidedAt) })}` : ""}</span>
                      {v.members.length > 0 && <span className="meta"><Icon name="users" />{t("Ездили {n} из {m}", { n: v.members.length, m: v.people.length })}: {v.members.map((id) => nameOf(v, id)).join(", ")}</span>}
                      {v.text && <span className="report"><span className="muted">{t("Что сделали")}: </span>{v.text}</span>}
                      <LinkList links={v.links} kind="photo" />
                      {v.adminComment && <span className="meta">{t("Комментарий: {c}", { c: v.adminComment })}</span>}
                    </div>
                    {v.status === "SUBMITTED" && (
                      <div className="side">
                        <button type="button" className="sm" onClick={() => void decide(v, true)} disabled={busyId === v.id}><Icon name="check" />{t("Принять")}</button>
                        {rejecting !== v.id && <button type="button" className="secondary sm" onClick={() => setRejecting(v.id)} disabled={busyId === v.id}><Icon name="x" />{t("Не принять")}</button>}
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
