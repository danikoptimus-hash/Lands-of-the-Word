import { useCallback, useState } from "react";
import { BOOKS } from "@lotw/domain";
import { api, ApiError, apiReady, ready, type BattleDto, type PassageDto, type BattleEntryDto } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { fmtDate, plural } from "../lib/format";
import { Icon } from "../components/Icon";
import { Chip } from "../components/Chip";
import { TeamAvatar } from "../components/TeamAvatar";
import { Tabs } from "../components/Tabs";
import { Sheet } from "../components/Sheet";
import { EmptyState } from "../components/State";
import { LinkList, ReturnBox, ReviewCard, useAutoRefresh } from "./SubmissionsBlock";
import { TrialFlow, type StepKey } from "./TrialFlow";

const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));
const verses = (n: number) => plural(n, ["стих", "стиха", "стихов"]);
const bookName = (code: string) => BOOK_BY_CODE.get(code)?.nameRu ?? code;

/** Стрелка «претенденты → хранители» со знаком испытания над ней (решение владельца 01.11). */
function TrialArrow() {
  // По эскизу владельца 01.11: знак испытания (две волны), к концу которых прикреплён наконечник стрелки; без древка.
  return (
    <svg className="trial-arrow" viewBox="0 0 30 24" width="30" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 9c2-3 4-3 6 0s4 3 6 0 4-3 6 0M2 15c2-3 4-3 6 0s4 3 6 0 4-3 6 0" />
      <path d="M22.5 7.5 27.5 12l-5 4.5" />
    </svg>
  );
}

/**
 * Испытания за города и проверка записей обеих сторон (переделка по решению владельца 01.11): в карточке — город,
 * аватарки сторон со стрелкой и шкала этапов. Медальоны шкалы нажимаются: «Стихи» и «Ответ» открывают отрывок
 * с раскладкой, «Проверка» — записи стороны с «Принять»/«Вернуть»; счётчик на медальоне — записи на проверке.
 * Счётчик карточки — все записи на проверке.
 */
export function BattlesBlock({ gameId, version = 0, onDecided }: { gameId: string; version?: number; onDecided: () => void }) {
  const { notify } = useUi();
  const [rows, setRows] = useState<BattleDto[] | null>(() => ready<{ battles: BattleDto[] }>(`/api/games/${gameId}/battles`)?.battles ?? null);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<"active" | "done">("active");
  const [returning, setReturning] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null); // гаснут кнопки только у решаемой записи (04.10)
  const [sheet, setSheet] = useState<{ battleId: string; step: StepKey } | null>(null);
  const load = useCallback(() => apiReady<{ battles: BattleDto[] }>(`/api/games/${gameId}/battles`).then((r) => { setRows(r.battles); setLoadError(false); }).catch(() => setLoadError(true)), [gameId]);
  useAutoRefresh(load, version);

  async function decide(battleId: string, entryId: string, approve: boolean, comment = "") {
    setBusyId(entryId);
    try { await api(`/api/games/${gameId}/battles/${battleId}/entries/${entryId}/decide`, { method: "POST", body: JSON.stringify({ approve, comment }) }); notify(approve ? t("Запись принята") : t("Запись возвращена")); setReturning(null); await load(); onDecided(); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusyId(null); }
  }
  const all = rows ?? [];
  const active = all.filter((b) => b.status === "ATTACK" || b.status === "DEFENSE" || b.status === "QUEUED");
  const pending = all.reduce((n, b) => n + b.entries.filter((e) => e.status === "SUBMITTED").length, 0);
  // Вторая вкладка — только завершённые, без идущих (решение владельца 03.11: «„все“ меня запутывает»).
  const done = all.filter((b) => !active.includes(b));
  const shown = filter === "done" ? done : active;
  const open = sheet ? all.find((b) => b.id === sheet.battleId) ?? null : null;
  const sheetSide = sheet?.step === "check2" || sheet?.step === "answer" ? "DEFENSE" : "ATTACK";

  return (
    <ReviewCard icon="wave" title={t("Испытания")} count={pending} loading={!rows} error={loadError} onRetry={() => void load()}>
      {all.length > 0 && (
        <>
          {all.length > active.length && <Tabs value={filter} onChange={setFilter} ariaLabel={t("Какие испытания показывать")} items={[{ key: "active", label: t("Идут"), count: active.length }, { key: "done", label: t("Завершённые"), count: done.length }]} />}
          {shown.length === 0 ? <EmptyState inline icon="wave" text={t("Сейчас испытаний нет.")} /> : shown.map((b) => {
            const pendingA = b.entries.filter((e) => e.side === "ATTACK" && e.status === "SUBMITTED").length;
            const pendingD = b.entries.filter((e) => e.side === "DEFENSE" && e.status === "SUBMITTED").length;
            return (
              <div key={b.id} className="trial">
                <div className="trial-head">
                  <span className="city"><Icon name="city" />{bookName(b.bookCode)}</span>
                  <TeamAvatar name={b.attacker.name} color={b.attacker.color} avatarId={b.attacker.avatarId} size="sm" title={b.attacker.name} teamId={b.attacker.id} />
                  <TrialArrow />
                  <TeamAvatar name={b.defender.name} color={b.defender.color} avatarId={b.defender.avatarId} size="sm" title={b.defender.name} teamId={b.defender.id} />
                </div>
                <TrialFlow b={b} teamId={null} turn={false} admin
                  onStep={(step) => setSheet({ battleId: b.id, step })}
                  canOpen={{ learn: Boolean(b.passage), answer: Boolean(b.defensePassage), check1: b.entries.some((e) => e.side === "ATTACK"), check2: b.entries.some((e) => e.side === "DEFENSE") }}
                  badges={{ check1: pendingA, check2: pendingD }} />
              </div>
            );
          })}
        </>
      )}
      {open && sheet && (sheet.step === "learn" || sheet.step === "answer") && (
        <Sheet size="md" onClose={() => setSheet(null)} title={`${sheet.step === "learn" ? t("Вызов") : t("Ответ")} · ${bookName(open.bookCode)} ${(sheet.step === "learn" ? open.passage : open.defensePassage)?.ref ?? ""}`}>
          <PassageBody passage={sheet.step === "learn" ? open.passage : open.defensePassage} entries={open.entries.filter((e) => e.side === sheetSide)} />
        </Sheet>
      )}
      {open && sheet && (sheet.step === "check1" || sheet.step === "check2") && (
        <Sheet size="md" onClose={() => setSheet(null)} title={`${t("Проверка")} · ${sheetSide === "ATTACK" ? t("вызов") : t("ответ")} · ${bookName(open.bookCode)}`}>
          <ul className="list">
            {open.entries.filter((e) => e.side === sheetSide).map((e) => (
              <li key={e.id} className="review-item">
                <div className="main">
                  <span className="title">{e.ref}</span>
                  <span className="meta"><span>{verses(e.verses)}</span><span>· {e.nickname}</span><span>· {fmtDate(e.createdAt)}</span></span>
                  {e.note && <span className="report">{e.note}</span>}
                  <LinkList links={e.links} kind="video" />
                </div>
                <div className="side">
                  {e.status === "SUBMITTED" ? (
                    <>
                      <button type="button" className="sm" onClick={() => void decide(open.id, e.id, true)} disabled={busyId === e.id}><Icon name="check" />{t("Принять")}</button>
                      {returning !== e.id && <button type="button" className="secondary sm" onClick={() => setReturning(e.id)} disabled={busyId === e.id}><Icon name="x" />{t("Вернуть")}</button>}
                    </>
                  ) : <Chip tone={e.status === "APPROVED" ? "ok" : "bad"}>{e.status === "APPROVED" ? t("принято") : t("возвращено")}</Chip>}
                </div>
                {returning === e.id && <ReturnBox placeholder={t("Причина возврата: команда её увидит")} okLabel={t("Вернуть")} busy={busyId === e.id} onOk={(text) => void decide(open.id, e.id, false, text)} onCancel={() => setReturning(null)} />}
              </li>
            ))}
          </ul>
        </Sheet>
      )}
    </ReviewCard>
  );
}

/** Непрерывные отрезки стихов → подписи «8:25–8:30» по ссылкам стихов отрывка. */
function rangesOf(idxs: number[], refOf: (i: number) => string): string[] {
  const sorted = [...new Set(idxs)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    out.push(i === j ? refOf(sorted[i]!) : `${refOf(sorted[i]!)}–${refOf(sorted[j]!)}`);
    i = j;
  }
  return out;
}

/**
 * Отрывок для администратора (решение владельца 04.10): текст выданного отрывка целиком и раскладка — кому какие стихи
 * достались, сколько у каждого принято, какие стихи ещё никто не отметил. Открывается с медальона «Стихи» или «Ответ»
 * на шкале испытания (решение владельца 01.11).
 */
function PassageBody({ passage, entries }: { passage: PassageDto | null; entries: BattleEntryDto[] }) {
  if (!passage) return null;
  const refOf = (i: number) => passage.verses?.find((v) => v.idx === i)?.ref ?? String(i);
  const byUser = new Map<string, { verses: Set<number>; approved: Set<number>; weight: number }>();
  const covered = new Set<number>();
  for (const e of entries) {
    const u = byUser.get(e.nickname) ?? { verses: new Set<number>(), approved: new Set<number>(), weight: e.weight ?? 1 };
    for (let i = e.start; i <= e.end; i++) { u.verses.add(i); covered.add(i); if (e.status === "APPROVED") u.approved.add(i); }
    byUser.set(e.nickname, u);
  }
  const free: number[] = [];
  for (let i = passage.start; i <= passage.end; i++) if (!covered.has(i)) free.push(i);
  const total = passage.end - passage.start + 1;
  return (
    <div className="passage-body">
      <p className="muted small">{t("Отрывок")} · {verses(total)}</p>
      <ul className="list compact">
        {[...byUser.entries()].map(([nick, u]) => (
          <li key={nick}><div className="main"><span className="title">{nick}{u.weight > 1 && <Chip tone="info" icon="sword">×{u.weight}</Chip>}</span><span className="meta"><span>{rangesOf([...u.verses], refOf).join(", ")}</span><span>· {verses(u.verses.size)}</span><span>· {t("принято {n}", { n: u.approved.size })}</span></span></div></li>
        ))}
        {byUser.size === 0 && <li><div className="main"><span className="muted small">{t("Стихи ещё никто не отметил.")}</span></div></li>}
        {free.length > 0 && byUser.size > 0 && <li><div className="main"><span className="title muted">{t("Никем не отмечены")}</span><span className="meta"><span>{rangesOf(free, refOf).join(", ")}</span><span>· {verses(free.length)}</span></span></div></li>}
      </ul>
      {passage.verses ? (
        <ol className="passage-text">
          {passage.verses.map((v) => <li key={v.idx} className={covered.has(v.idx) ? "covered" : undefined}><b>{v.ref}</b> {v.text ?? ""}</li>)}
        </ol>
      ) : <p className="hint">{t("Текст отрывка недоступен.")}</p>}
    </div>
  );
}
