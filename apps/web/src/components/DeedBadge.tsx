import { Icon } from "./Icon";
import { HelpPopup } from "./Help";
import { t } from "../lib/i18n";
import { fmtDate } from "../lib/format";

export interface DeedLimitDto { max: number; taken: number; nextAt: number | null }

/**
 * Значок лимита дел в сутки у участника (решение владельца 04.10: значки, а не фразы): песочные часы и обратный отсчёт
 * «ч:мм», пока лимит исчерпан; свиток и ячейки (точки) — сколько взято из лимита. Один и тот же в составе команды
 * и у администратора в блоке «Команды» (решение владельца 04.10). Без лимита в игре ничего не рисуется.
 */
export function DeedBadge({ limit, now }: { limit: DeedLimitDto | null | undefined; now: number }) {
  if (!limit) return null;
  if (limit.nextAt && limit.nextAt > now) {
    const text = t("Следующее дело через {when}", { when: untilText(limit.nextAt) });
    return <span className="deed-badge wait" title={text} aria-label={text}><Icon name="hourglass" /><span className="num">{hmText(limit.nextAt - now)}</span></span>;
  }
  const text = t("Дел за сутки: {a} из {b}, можно взять", { a: limit.taken, b: limit.max });
  return (
    <span className="deed-badge free" title={text} aria-label={text}><Icon name="scroll" />{limit.max <= 5
      ? <span className="pips">{Array.from({ length: limit.max }, (_, i) => <i key={i} className={i < limit.taken ? "on" : undefined} />)}</span>
      : <span className="num">{limit.taken}/{limit.max}</span>}</span>
  );
}

export interface ActiveDeedDto { id: string; title: string; status: string; takenAt: string | null; submittedAt: string | null }

/**
 * Значок лимита, а по нажатию — окошко с делами на руках: взятые с датой, «на проверке», возвращённые. Видит администратор
 * в блоке «Команды» и вся команда в составе (решение владельца 05.10). Без дел на руках — просто значок.
 */
export function DeedBadgePopup({ limit, now, deeds }: { limit: DeedLimitDto | null | undefined; now: number; deeds: ActiveDeedDto[] | undefined }) {
  if (!limit) return null;
  if (!deeds || deeds.length === 0) return <DeedBadge limit={limit} now={now} />;
  return (
    <HelpPopup name={t("Дела на руках: {n}", { n: deeds.length })} trigger={<DeedBadge limit={limit} now={now} />}>
      <ul className="member-deeds">
        {deeds.map((d) => (
          <li key={d.id}><Icon name={d.status === "SUBMITTED" ? "clock" : d.status === "REJECTED" ? "alert" : "scroll"} /><span className="title">{d.title}</span><span className="muted">{d.status === "SUBMITTED" ? t("на проверке") : d.status === "REJECTED" ? t("возвращено") : d.takenAt ? t("взято {d}", { d: fmtDate(d.takenAt) }) : t("взято")}</span></li>
        ))}
      </ul>
    </HelpPopup>
  );
}

/** Обратный отсчёт «ч:мм» для значка. */
export function hmText(ms: number): string {
  const mins = Math.max(1, Math.ceil(ms / 60_000)), h = Math.floor(mins / 60), m = mins % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}
/** «3 ч 20 мин» / «15 мин» до освобождения места под дело. */
export function untilText(at: number): string {
  const mins = Math.max(1, Math.ceil((at - Date.now()) / 60_000)), h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? t("{h} ч {m} мин", { h, m }) : t("{m} мин", { m });
}
