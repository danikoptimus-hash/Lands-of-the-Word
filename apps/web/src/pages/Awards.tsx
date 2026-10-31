import { useEffect, useState, type ReactNode } from "react";
import { AWARDS, AWARD_BY_CODE, PERSONAL_AWARDS, STREAK_MILESTONES, TEAM_AWARDS, streakAward, type AwardDef } from "@lotw/domain";
import { apiReady, ready, type AdminAwardsDto, type AwardGrantDto, type AwardsDto, type StreakDto } from "../lib/api";
import { UserAvatar } from "../components/UserAvatar";
import { EmptyState, LoadingState } from "../components/State";
import { getLocale, t } from "../lib/i18n";
import { fmtDate, plural } from "../lib/format";
import { Icon } from "../components/Icon";
import { Help, HelpPopup } from "../components/Help";
import { Tabs } from "../components/Tabs";
import { Sheet } from "../components/Sheet";
import { TeamAvatar } from "../components/TeamAvatar";

/**
 * Награды (решение владельца 29.10, раскладка 30.10): личные — во вкладке «Награды» раздела «Моё служение» (серия дней,
 * сетка своих значков, ниже рейтинг наград участников), командные — во вкладке «Награды команд» раздела «Команды»
 * (сетка своей команды, ниже рейтинг наград команд). В рейтингах значки идут одной строкой, которая листается пальцем,
 * на новую строку не переносятся. Значки — картинки `/img/awards/<code>.webp`; не взятые показаны серыми. Нажатие на
 * значок открывает лист с условием и датой; у повторяемых наград — счётчик на значке и даты первого и последнего раза.
 */
export const awardName = (a: AwardDef) => (getLocale() === "en" ? a.nameEn : a.nameRu);
export const awardCond = (a: AwardDef) => (getLocale() === "en" ? a.condEn : a.condRu);
const streakDaysText = (n: number) => plural(n, ["день подряд", "дня подряд", "дней подряд"]);

/** Картинки значков подгружаются заранее (просьба владельца 30.10: «награды в профиле подгружаются, это выглядит как глюк»). */
const warmed = new Set<string>();
export function preloadAwardImages(codes: Iterable<string>): void {
  for (const code of codes) { if (warmed.has(code)) continue; warmed.add(code); const im = new Image(); im.decoding = "async"; im.src = `/img/awards/${code}.webp`; }
}
/**
 * Все значки — в фоне, когда страница свободна (владелец 30.10: «они подгружаются, это выглядит как глюк»): любая
 * карточка участника или команды открывается с готовыми картинками. Service worker держит их в кэше, так что это
 * один раз на устройство (41 картинка, ~2 МБ).
 */
let allQueued = false;
export function preloadAllAwardImages(): void {
  if (allQueued) return; allQueued = true;
  const run = () => preloadAwardImages(AWARDS.map((a) => a.code));
  if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 4000 }); else setTimeout(run, 1500);
}
export function AwardBadge({ code, earned, count, size = "md", onClick, name = true, eager = false }: { code: string; earned: boolean; count?: number; size?: "sm" | "md" | "lg"; onClick?: () => void; /** Подпись под значком. */ name?: boolean; /** Грузить сразу, не лениво: в карточках и листах. */ eager?: boolean }) {
  const a = AWARD_BY_CODE.get(code);
  if (!a) return null;
  const label = awardName(a);
  const body = (
    <>
      <span className="award-img"><img src={`/img/awards/${code}.webp`} alt="" loading={eager ? "eager" : "lazy"} decoding="async" />{earned && a.repeat && (count ?? 0) > 1 && <span className="award-count">×{count}</span>}</span>
      {name && <span className="award-name">{label}</span>}
    </>
  );
  const cls = "award" + (earned ? "" : " locked") + " " + size;
  if (!onClick) return <span className={cls} title={label}>{body}</span>;
  return <button type="button" className={cls} onClick={onClick} aria-label={earned ? label : t("{name} — ещё впереди", { name: label })}>{body}</button>;
}

/** Лист с подробностями награды. */
export function AwardSheet({ code, grant, onClose }: { code: string; grant?: AwardGrantDto; onClose: () => void }) {
  const a = AWARD_BY_CODE.get(code);
  if (!a) return null;
  return (
    <Sheet size="sm" title={awardName(a)} onClose={onClose} className="award-sheet">
      <div className="award-detail">
        <AwardBadge code={code} earned={Boolean(grant)} count={grant?.count} size="lg" name={false} eager />
        <p className="award-cond">{awardCond(a)}</p>
        {grant
          ? a.repeat && grant.count > 1
            ? <p className="muted small">{t("Получена {n} раз: впервые {a}, последний раз {b}", { n: grant.count, a: fmtDate(grant.at, { time: false }), b: fmtDate(grant.last, { time: false }) })}</p>
            : <p className="muted small">{t("Получена {d}", { d: fmtDate(grant.at, { time: false }) })}</p>
          : <p className="muted small">{a.repeat ? t("Ещё не получена. Эту награду можно получать несколько раз.") : t("Ещё не получена.")}</p>}
      </div>
    </Sheet>
  );
}

/** Сетка значков по каталогу: полученные ярко, остальные серые. */
function AwardGrid({ defs, grants, onPick }: { defs: ReadonlyArray<AwardDef>; grants: AwardGrantDto[]; onPick: (code: string) => void }) {
  const got = new Map(grants.map((g) => [g.code, g]));
  return (
    <div className="award-grid">
      {defs.map((a) => { const g = got.get(a.code); return <AwardBadge key={a.code} code={a.code} earned={Boolean(g)} count={g?.count} onClick={() => onPick(a.code)} />; })}
    </div>
  );
}

/** Огонёк серии: горит, если сегодняшний день засчитан, иначе серый (по образцу Duolingo, решение владельца 31.10). */
export function FlameIcon({ lit, size = "md", ignite = false }: { lit: boolean; size?: "sm" | "md" | "xl"; /** Вспышка: день только что засчитан. */ ignite?: boolean }) {
  return <span className={"streak-flame " + size + (lit ? " lit" : "") + (ignite ? " ignite" : "")} aria-hidden="true"><img src="/img/awards/flame.webp" alt="" decoding="async" /></span>;
}
const WEEKDAY = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"] as const;
const weekdayOf = (key: string) => t(WEEKDAY[new Date(`${key}T12:00:00Z`).getUTCDay()]!);
/**
 * Полоса текущей недели с понедельника (решение владельца 31.10: «у них есть дни недели, сразу понятно, засчитался ли
 * сегодняшний день»; «день начать с пн, а не вс»): подпись дня недели сверху, кружок снизу. Засчитанные дни — галочка в
 * оранжевом кружке, соседние засчитанные соединены лентой; сегодня — подпись оранжевая, пока день не засчитан —
 * пунктирный пульсирующий кружок; будущие дни недели — бледные.
 */
export function WeekStrip({ days, todayKey, mini = false }: { days: StreakDto["days"]; todayKey: string; mini?: boolean }) {
  const n = days.length;
  return (
    <div className={"streak-week" + (mini ? " mini" : "")} role="list" aria-label={t("Эта неделя")}>
      {days.map((d, i) => i < n - 1 && d.done && days[i + 1]!.done ? <i key={"b" + d.key} className="wd-band" style={{ left: `${((i + 0.5) * 100) / n}%`, width: `${100 / n}%` }} /> : null)}
      {days.map((d) => {
        const today = d.key === todayKey, future = d.key > todayKey;
        return (
          <div key={d.key} role="listitem" className={"wd" + (d.done ? " on" : "") + (today ? " today" : "") + (future ? " future" : "")} title={today ? t("Сегодня") : fmtDate(`${d.key}T12:00:00Z`, { time: false })} aria-label={`${weekdayOf(d.key)}: ${d.done ? t("засчитан") : today ? t("ещё не засчитан") : future ? t("впереди") : t("пропущен")}`}>
            <span className="wd-label">{weekdayOf(d.key)}</span>
            <span className="wd-dot">{d.done ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /></svg> : null}</span>
          </div>
        );
      })}
    </div>
  );
}
const STREAK_HELP = "День засчитывается за сданное дело (и в Каменоломне), решённый район, собранный порядок районов, взятый город или руины. Игровой день длится с 7:00 до 7:00.";

/** Серия дней (раскладка владельца 31.10 по образцу Duolingo): большой огонёк и число, состояние дня, полоса недели, рекорд и шкала до рубежа. */
export function StreakCard({ streak }: { streak: AwardsDto["streak"] }) {
  const next = streak.next, nextDef = next === null ? null : streakAward(next);
  // Предыдущий рубеж: секции шкалы — дни между рубежами (5 → 10 → … → 30 → 40 → 50).
  const prev = next === null ? streak.current : (STREAK_MILESTONES.filter((m) => m < next).pop() ?? 0);
  const lit = streak.today;
  return (
    <div className={"streak-card" + (lit ? " lit" : "")}>
      <div className="streak-hero">
        <FlameIcon lit={lit} size="xl" />
        <div className="streak-count">
          <b>{streak.current}</b>
          <span>{streak.current === 0 && !lit ? t("Серии пока нет") : plural(streak.current, ["день подряд", "дня подряд", "дней подряд"]).replace(/^\d+\s*/, "")}</span>
        </div>
        <Help>{t(STREAK_HELP)}</Help>
      </div>
      {/* Подсказка про время спрятана за значком часов (решение владельца 31.10: «чтоб было меньше текста»). */}
      <p className={"streak-state" + (lit ? " ok" : "")}>
        {lit
          ? <Icon name="check" />
          : <HelpPopup name={t("Когда сдать")} trigger={<Icon name="clock" />} buttonClassName="streak-when">{streak.current > 0 ? t("Сдайте дело до 7:00 утра, и серия продолжится. Игровой день длится с 7:00 до 7:00.") : t("Сдайте дело сегодня, и серия начнётся. Игровой день длится с 7:00 до 7:00.")}</HelpPopup>}
        {lit ? t("Сегодня засчитан") : t("Сегодня ещё не засчитан")}
      </p>
      <WeekStrip days={streak.days} todayKey={streak.todayKey} />
      <div className="streak-foot">
        <span className="streak-best"><Icon name="trophy" />{t("Рекорд: {n}", { n: streakDaysText(streak.best) })}</span>
      </div>
      {/* Шкала до рубежа секциями по дням, значок рубежа в конце, текст «ещё N дней» за значком (решение владельца 31.10). */}
      {next !== null && nextDef && (
        <div className="streak-goal">
          <div className="streak-segs" role="img" aria-label={t("До «{name}» ещё {n}", { name: awardName(nextDef), n: plural(streak.toNext ?? 0, ["день", "дня", "дней"]) })}>
            {Array.from({ length: next - prev }, (_, i) => <i key={i} className={i < streak.current - prev ? "on" : ""} />)}
          </div>
          <HelpPopup name={t("Следующий рубеж")} trigger={<AwardBadge code={nextDef.code} earned={false} size="sm" name={false} eager />} buttonClassName="streak-goal-badge">
            {t("«{name}» — {d}. Ещё {n}.", { name: awardName(nextDef), d: streakDaysText(next), n: plural(streak.toNext ?? 0, ["день", "дня", "дней"]) })}
          </HelpPopup>
        </div>
      )}
    </div>
  );
}

/** Число наград с повторами. */
export const awardsTotal = (grants: AwardGrantDto[]) => grants.reduce((a, g) => a + g.count, 0);

/** Личные награды: серия дней и сетка по каталогу. */
export function MyAwardsBlock({ data }: { data: AwardsDto }) {
  const [pick, setPick] = useState<string | null>(null);
  const got = data.mine.filter((g) => PERSONAL_AWARDS.some((d) => d.code === g.code)).length;
  return (
    <div className="awards">
      <StreakCard streak={data.streak} />
      <div className="award-head"><b>{t("Получено {n} из {m}", { n: got, m: PERSONAL_AWARDS.length })}</b><small className="muted">{t("нажмите значок — условие и дата")}</small></div>
      <AwardGrid defs={PERSONAL_AWARDS} grants={data.mine} onPick={setPick} />
      {pick && <AwardSheet code={pick} grant={data.mine.find((g) => g.code === pick)} onClose={() => setPick(null)} />}
    </div>
  );
}

/** Награды своей команды: сетка по каталогу. */
export function TeamAwardsBlock({ data }: { data: AwardsDto }) {
  const [pick, setPick] = useState<string | null>(null);
  const got = data.team.filter((g) => TEAM_AWARDS.some((d) => d.code === g.code)).length;
  return (
    <div className="awards">
      <div className="award-head"><b>{t("Получено {n} из {m}", { n: got, m: TEAM_AWARDS.length })}</b><small className="muted">{t("нажмите значок — условие и дата")}</small></div>
      <AwardGrid defs={TEAM_AWARDS} grants={data.team} onPick={setPick} />
      {pick && <AwardSheet code={pick} grant={data.team.find((g) => g.code === pick)} onClose={() => setPick(null)} />}
    </div>
  );
}

export interface AwardRatingRow { key: string; who: ReactNode; name: string; awards: AwardGrantDto[]; /** Своя строка — подсветка. */ me?: boolean; /** Подпись после имени: «это вы», «ваша команда». */ tag?: string; /** Выбывшая команда. */ muted?: boolean }
/**
 * Рейтинг наград (решение владельца 30.10): строки как в рейтинге игроков, но вместо значков-счётчиков — сами награды
 * одной строкой; если не умещаются, строка листается пальцем, на новую строку не переносится. Порядок — по числу наград
 * с повторами (сервер). Нажатие на награду открывает её лист.
 */
export function AwardRating({ title, help, rows, empty }: { title: string; help?: string; rows: AwardRatingRow[]; empty: string }) {
  const [pick, setPick] = useState<{ code: string; grant: AwardGrantDto } | null>(null);
  return (
    <div className="top-board award-rating">
      <h3><Icon name="trophy" />{title}{help && <Help>{help}</Help>}</h3>
      {rows.length === 0 ? <EmptyState inline icon="trophy" text={empty} /> : (
        <ol className="top-list">
          {rows.map((r, i) => (
            <li key={r.key} className={(r.me ? "me" : "") + (r.muted ? " out" : "")}>
              <span className="rank">{i + 1}</span>
              {r.who}
              <span className="body">
                <span className="name">{r.name}{r.tag ? ` · ${r.tag}` : ""}<span className="muted"> · {awardsTotal(r.awards)}</span></span>
                {r.awards.length === 0
                  ? <span className="meta">{t("Наград пока нет")}</span>
                  : <span className="award-strip">{r.awards.map((g) => <AwardBadge key={g.code} code={g.code} earned count={g.count} size="sm" name={false} eager onClick={() => setPick({ code: g.code, grant: g })} />)}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
      {pick && <AwardSheet code={pick.code} grant={pick.grant} onClose={() => setPick(null)} />}
    </div>
  );
}

/**
 * Плашка серии над картой (решение владельца 29.10, вид 31.10): при заходе раз в игровые сутки и в момент, когда день
 * засчитан (огонёк вспыхивает). Огонёк, число, состояние дня и полоса недели; уходит сама через несколько секунд или по
 * крестику; нажатие открывает награды.
 */
export function StreakBanner({ streak, onOpen, onClose, celebrate = false }: { streak: AwardsDto["streak"]; onOpen: () => void; onClose: () => void; /** День только что засчитан: вспышка огонька и «Серия продлена». */ celebrate?: boolean }) {
  useEffect(() => { const tm = setTimeout(onClose, celebrate ? 6000 : 7000); return () => clearTimeout(tm); }, [onClose, celebrate]);
  return (
    <div className={"streak-banner" + (streak.today ? " lit" : "")} role="status">
      <button type="button" className="streak-main" onClick={onOpen}>
        <FlameIcon lit={streak.today} size="md" ignite={celebrate} />
        <span className="grow">
          <b>{celebrate ? t("Серия продлена: {n}", { n: streakDaysText(streak.current) }) : streak.current > 0 ? t("Серия: {n}", { n: streakDaysText(streak.current) }) : t("Серии пока нет")}</b>
          <small>{streak.today ? t("Сегодня засчитан") : t("Сегодня ещё не засчитан")}</small>
          <WeekStrip days={streak.days} todayKey={streak.todayKey} mini />
        </span>
      </button>
      <button type="button" className="ghost icon sm" onClick={onClose} aria-label={t("Закрыть")}><Icon name="x" /></button>
    </div>
  );
}

/** Праздник рубежа серии: карточка со значком над картой в день, когда рубеж взят. */
export function MilestoneCard({ code, onOpen, onClose }: { code: string; onOpen: () => void; onClose: () => void }) {
  const a = AWARD_BY_CODE.get(code);
  if (!a) return null;
  const next = a.streakDays ? AWARDS.find((x) => x.streakDays && x.streakDays > a.streakDays!) : undefined;
  return (
    <div className="milestone-backdrop" onClick={onClose}>
      <div className="milestone" role="dialog" aria-modal="true" aria-label={awardName(a)} onClick={(e) => e.stopPropagation()}>
        <span className="milestone-rays" aria-hidden="true" />
        <span className="milestone-confetti" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ ["--i" as string]: i }} />)}</span>
        <div className="milestone-kicker">{t("Рубеж серии")}</div>
        <AwardBadge code={code} earned size="lg" name={false} eager />
        <h3>{t("«{name}» — {n}", { name: awardName(a), n: streakDaysText(a.streakDays ?? 0) })}</h3>
        <p>{awardCond(a)}{next ? `. ${t("Следующий рубеж — «{name}», {n}", { name: awardName(next), n: streakDaysText(next.streakDays ?? 0) })}` : ""}</p>
        <div className="row">
          <button type="button" onClick={onOpen}><Icon name="trophy" />{t("В зал наград")}</button>
          <button type="button" className="secondary" onClick={onClose}>{t("Закрыть")}</button>
        </div>
      </div>
    </div>
  );
}

/** Сводка из кэша (для первого кадра страницы). */
export function awardsCached(gameId: string): AwardsDto | null { return ready<AwardsDto>(`/api/games/${gameId}/awards`); }

/**
 * Награды у администратора (решение владельца 29.10): плитка «Награды» в доке. Вкладка «Команды» — чипы команд и сетка
 * значков выбранной; «Участники» — все участники игры: серия, значки, нажатие на аватарку открывает карточку.
 */
export function AdminAwards({ gameId, version }: { gameId: string; version: number }) {
  const url = `/api/games/${gameId}/awards/admin`;
  const [data, setData] = useState<AdminAwardsDto | null>(() => ready<AdminAwardsDto>(url));
  const [tab, setTab] = useState<"teams" | "members">("teams");
  const [teamId, setTeamId] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [memberPick, setMemberPick] = useState<{ code: string; grant?: AwardGrantDto } | null>(null);
  useEffect(() => { apiReady<AdminAwardsDto>(url).then((d) => { setData(d); preloadAwardImages(d.members.flatMap((m) => m.awards.map((g) => g.code))); }).catch(() => {}); }, [url, version]);
  if (!data) return <div className="card"><LoadingState rows={2} /></div>;
  const team = data.teams.find((t) => t.id === teamId) ?? data.teams[0] ?? null;
  const got = team ? team.awards.filter((g) => TEAM_AWARDS.some((d) => d.code === g.code)).length : 0;
  return (
    <div className="card awards">
      <Tabs items={[{ key: "teams", label: t("Команды"), icon: "users" }, { key: "members", label: t("Участники"), icon: "user" }]} value={tab} onChange={setTab} ariaLabel={t("Награды")} />
      {tab === "teams" && (team ? (
        <>
          <div className="award-teams" role="tablist" aria-label={t("Чьи награды")}>
            {data.teams.map((tm) => (
              <button key={tm.id} type="button" role="tab" aria-selected={tm.id === team.id} className={"chip-btn" + (tm.id === team.id ? " on" : "")} onClick={() => setTeamId(tm.id)}>
                <TeamAvatar name={tm.name} color={tm.color} avatarId={tm.avatarId} size="sm" zoom={false} /><span>{tm.name}</span><span className="count-chip">{tm.awards.reduce((a, g) => a + g.count, 0)}</span>
              </button>
            ))}
          </div>
          <div className="award-head"><b>{t("Получено {n} из {m}", { n: got, m: TEAM_AWARDS.length })}</b><small className="muted">{t("нажмите значок — условие и дата")}</small></div>
          <AwardGrid defs={TEAM_AWARDS} grants={team.awards} onPick={setPick} />
          {pick && <AwardSheet code={pick} grant={team.awards.find((g) => g.code === pick)} onClose={() => setPick(null)} />}
        </>
      ) : <EmptyState inline icon="users" text={t("Команд пока нет.")} />)}
      {tab === "members" && (data.members.length === 0 ? <EmptyState inline icon="users" text={t("Участников пока нет.")} /> : (
        <ul className="list award-members">
          {data.members.map((m) => (
            <li key={m.userId}>
              <div className="main">
                <span className="person"><UserAvatar name={m.name} avatarId={m.avatarId} userId={m.userId} /><span className="name">{m.name}</span></span>
                <span className="meta chips">
                  {m.team && <TeamAvatar name={m.team.name} color={m.team.color} avatarId={m.team.avatarId} size="sm" title={m.team.name} zoom={false} />}
                  {m.streak.current > 0 && <span className="streak-chip" title={t("Серия: {n}", { n: streakDaysText(m.streak.current) })}><img src="/img/awards/p_streak_10.webp" alt="" />{m.streak.current}</span>}
                </span>
              </div>
              <div className="side award-row">{m.awards.length ? m.awards.map((g) => <AwardBadge key={g.code} code={g.code} earned count={g.count} size="sm" name={false} eager onClick={() => setMemberPick({ code: g.code, grant: g })} />) : <span className="muted small">{t("Наград пока нет")}</span>}</div>
            </li>
          ))}
        </ul>
      ))}
      {memberPick && <AwardSheet code={memberPick.code} grant={memberPick.grant} onClose={() => setMemberPick(null)} />}
    </div>
  );
}
