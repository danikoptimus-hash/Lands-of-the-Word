import { Icon } from "./Icon";
import { HelpPopup } from "./Help";
import { t } from "../lib/i18n";
import { fmtDate } from "../lib/format";

export interface DeedLimitDto { max: number; taken: number; nextAt: number | null }

/**
 * Значок дел у участника (решение владельца 19.10: «возле свитка — сколько дел взято, и если 0, значит 0»): свиток и
 * число дел на руках (взятые, на проверке, возвращённые). Пока суточный лимит исчерпан — песочные часы и обратный
 * отсчёт «ч:мм» (решение владельца 04.10). Один и тот же в составе команды и у администратора в блоке «Команды».
 * Без лимита в игре ничего не рисуется.
 */
export function DeedBadge({ limit, now, inHand = 0, frozenUntil, frozenReason }: { limit: DeedLimitDto | null | undefined; now: number; /** Дел на руках. */ inHand?: number; /** Администратор закрыл взятие дел до этой даты (решение владельца 21.10): замок и дата вместо свитка. */ frozenUntil?: string | null; /** Причина заморозки — в подсказке (видит администратор). */ frozenReason?: string | null }) {
  if (frozenUntil && Date.parse(frozenUntil) > now) {
    const text = t("Взятие дел закрыто администратором до {date}", { date: fmtDate(frozenUntil, { time: false }) }) + (frozenReason ? " · " + frozenReason : "");
    return <span className="deed-badge frozen" title={text} aria-label={text}><Icon name="lock" /><span className="num">{fmtDate(frozenUntil, { time: false })}</span></span>;
  }
  if (!limit) return null;
  if (limit.nextAt && limit.nextAt > now) {
    const text = t("Следующее дело через {when}", { when: untilText(limit.nextAt) });
    return <span className="deed-badge wait" title={text} aria-label={text}><Icon name="hourglass" /><span className="num">{hmText(limit.nextAt - now)}</span></span>;
  }
  const text = t("Дел на руках: {n}", { n: inHand }) + " · " + t("Дел за сутки: {a} из {b}, можно взять", { a: limit.taken, b: limit.max });
  return <span className="deed-badge free" title={text} aria-label={text}><Icon name="scroll" /><span className="num">{inHand}</span></span>;
}

export interface ActiveDeedDto { id: string; title: string; status: string; takenAt: string | null; submittedAt: string | null; /** Сторона дела: откуда и куда (для кнопки «Посмотреть на карте»). */ fromKey?: string; toKey?: string }

/**
 * Значок лимита, а по нажатию — окошко с делами на руках: взятые с датой, «на проверке», возвращённые. Видит администратор
 * в блоке «Команды» и вся команда в составе (решение владельца 05.10). Без дел на руках — просто значок.
 */
export function DeedBadgePopup({ limit, now, deeds, onShowOnMap, frozenUntil, frozenReason }: { frozenUntil?: string | null; frozenReason?: string | null; limit: DeedLimitDto | null | undefined; now: number; deeds: ActiveDeedDto[] | undefined; /** «Посмотреть на карте» у каждого дела (просьба владельца 10.10): карта центрируется на стороне дела. */ onShowOnMap?: (deed: ActiveDeedDto) => void }) {
  if (!limit && !frozenUntil) return null;
  if (!deeds || deeds.length === 0) return <DeedBadge limit={limit} now={now} frozenUntil={frozenUntil} frozenReason={frozenReason} />;
  return (
    <HelpPopup name={t("Дела на руках: {n}", { n: deeds.length })} trigger={<DeedBadge limit={limit} now={now} inHand={deeds.length} frozenUntil={frozenUntil} frozenReason={frozenReason} />}>
      <ul className="member-deeds">
        {deeds.map((d) => (
          <li key={d.id}><Icon name={d.status === "SUBMITTED" ? "clock" : d.status === "REJECTED" ? "alert" : "scroll"} /><span className="title">{d.title}</span><span className="muted">{d.status === "SUBMITTED" ? t("на проверке") : d.status === "REJECTED" ? t("возвращено") : d.takenAt ? t("взято {d}", { d: fmtDate(d.takenAt) }) : t("взято")}</span>{onShowOnMap && d.fromKey && <button type="button" className="ghost sm icon map-btn" data-popup-close aria-label={t("Посмотреть на карте")} title={t("Посмотреть на карте")} onClick={() => onShowOnMap(d)}><Icon name="map" /></button>}</li>
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
