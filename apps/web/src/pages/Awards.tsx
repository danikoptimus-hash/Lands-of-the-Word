import { useEffect, useState } from "react";
import { AWARDS, AWARD_BY_CODE, PERSONAL_AWARDS, TEAM_AWARDS, streakAward, type AwardDef } from "@lotw/domain";
import { api, apiReady, ready, type AdminAwardsDto, type AwardGrantDto, type AwardsDto, type TeamAwardsDto } from "../lib/api";
import { UserAvatar } from "../components/UserAvatar";
import { EmptyState, LoadingState } from "../components/State";
import { getLocale, t } from "../lib/i18n";
import { fmtDate, plural } from "../lib/format";
import { Icon } from "../components/Icon";
import { Tabs } from "../components/Tabs";
import { Sheet } from "../components/Sheet";
import { TeamAvatar } from "../components/TeamAvatar";

/**
 * Зал наград (решение владельца 29.10): две вкладки — награды команды (с просмотром других команд) и личные,
 * сверху у личных — серия дней. Значки — картинки `/img/awards/<code>.webp`; не взятые показаны серыми. Нажатие на
 * значок открывает лист с условием и датой; у повторяемых наград — счётчик на значке и даты первого и последнего раза.
 */
export const awardName = (a: AwardDef) => (getLocale() === "en" ? a.nameEn : a.nameRu);
export const awardCond = (a: AwardDef) => (getLocale() === "en" ? a.condEn : a.condRu);
const streakDaysText = (n: number) => plural(n, ["день подряд", "дня подряд", "дней подряд"]);

export function AwardBadge({ code, earned, count, size = "md", onClick, name = true }: { code: string; earned: boolean; count?: number; size?: "sm" | "md" | "lg"; onClick?: () => void; /** Подпись под значком. */ name?: boolean }) {
  const a = AWARD_BY_CODE.get(code);
  if (!a) return null;
  const label = awardName(a);
  const body = (
    <>
      <span className="award-img"><img src={`/img/awards/${code}.webp`} alt="" loading="lazy" decoding="async" />{earned && a.repeat && (count ?? 0) > 1 && <span className="award-count">×{count}</span>}</span>
      {name && <span className="award-name">{label}</span>}
    </>
  );
  const cls = "award" + (earned ? "" : " locked") + " " + size;
  if (!onClick) return <span className={cls} title={label}>{body}</span>;
  return <button type="button" className={cls} onClick={onClick} aria-label={earned ? label : t("{name} — ещё впереди", { name: label })}>{body}</button>;
}

/** Лист с подробностями награды. */
function AwardSheet({ code, grant, onClose }: { code: string; grant?: AwardGrantDto; onClose: () => void }) {
  const a = AWARD_BY_CODE.get(code);
  if (!a) return null;
  return (
    <Sheet size="sm" title={awardName(a)} onClose={onClose} className="award-sheet">
      <div className="award-detail">
        <AwardBadge code={code} earned={Boolean(grant)} count={grant?.count} size="lg" name={false} />
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

/** Серия дней: огонёк, число, рекорд и шкала до следующего рубежа. */
export function StreakCard({ streak }: { streak: AwardsDto["streak"] }) {
  const next = streak.next, prev = next === null ? streak.current : Math.max(0, next - 5);
  const pct = next === null ? 100 : Math.round(((streak.current - prev) / (next - prev)) * 100);
  const nextDef = next === null ? null : streakAward(next);
  return (
    <div className="streak-card">
      <span className={"streak-flame" + (streak.current > 0 ? " lit" : "")}><img src="/img/awards/p_streak_10.webp" alt="" /></span>
      <div className="grow">
        <b>{streak.current > 0 ? t("Серия: {n}", { n: streakDaysText(streak.current) }) : t("Серии пока нет")}</b>
        <small>{streak.best > 0 ? t("Рекорд: {n}", { n: streakDaysText(streak.best) }) : t("Сдайте дело сегодня — серия начнётся")}{!streak.today && streak.current > 0 ? ` · ${t("сегодня ещё нет дела")}` : ""}</small>
        {next !== null && nextDef && <><div className="streak-bar"><i style={{ width: `${Math.max(4, Math.min(100, pct))}%` }} /></div><small>{t("До «{name}» ещё {n}", { name: awardName(nextDef), n: plural(streak.toNext ?? 0, ["день", "дня", "дней"]) })}</small></>}
      </div>
    </div>
  );
}

export function AwardsSection({ gameId, version, data, onLoaded }: { gameId: string; version: number; /** Уже загруженная сводка (страница команды держит её для плашки серии). */ data: AwardsDto | null; onLoaded: (d: AwardsDto) => void }) {
  const [tab, setTab] = useState<"team" | "mine">("team");
  const [teamId, setTeamId] = useState<string | null>(null);
  const [other, setOther] = useState<Record<string, TeamAwardsDto>>({});
  const [pick, setPick] = useState<string | null>(null);
  useEffect(() => { apiReady<AwardsDto>(`/api/games/${gameId}/awards`).then(onLoaded).catch(() => {}); }, [gameId, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownTeam = teamId ?? data?.teamId ?? null;
  useEffect(() => {
    if (!shownTeam || !data || shownTeam === data.teamId || other[shownTeam]) return;
    api<TeamAwardsDto>(`/api/games/${gameId}/awards/teams/${shownTeam}`).then((r) => setOther((o) => ({ ...o, [shownTeam]: r }))).catch(() => {});
  }, [shownTeam, data, gameId, other, version]);
  if (!data) return <section className="section"><LoadingState rows={2} /></section>;
  const teamGrants = shownTeam === data.teamId ? data.team : other[shownTeam ?? ""]?.awards ?? null;
  const grants = tab === "team" ? teamGrants ?? [] : data.mine;
  const defs = tab === "team" ? TEAM_AWARDS : PERSONAL_AWARDS;
  const gotCount = grants.filter((g) => defs.some((d) => d.code === g.code)).length;
  return (
    <section className="section awards">
      <Tabs items={[{ key: "team", label: t("Команда"), icon: "users" }, { key: "mine", label: t("Мои"), icon: "user" }]} value={tab} onChange={setTab} ariaLabel={t("Награды")} />
      {tab === "team" && (
        <div className="award-teams" role="tablist" aria-label={t("Чьи награды")}>
          {[...data.teams].sort((a, b) => Number(b.id === data.teamId) - Number(a.id === data.teamId)).map((tm) => (
            <button key={tm.id} type="button" role="tab" aria-selected={tm.id === shownTeam} className={"chip-btn" + (tm.id === shownTeam ? " on" : "")} onClick={() => setTeamId(tm.id)}>
              <TeamAvatar name={tm.name} color={tm.color} avatarId={tm.avatarId} size="sm" zoom={false} /><span>{tm.name}</span><span className="count-chip">{tm.awards}</span>
            </button>
          ))}
        </div>
      )}
      {tab === "mine" && <StreakCard streak={data.streak} />}
      {tab === "team" && teamGrants === null ? <LoadingState rows={2} /> : (
        <>
          <div className="award-head"><b>{t("Получено {n} из {m}", { n: gotCount, m: defs.length })}</b><small className="muted">{t("нажмите значок — условие и дата")}</small></div>
          <AwardGrid defs={defs} grants={grants} onPick={setPick} />
        </>
      )}
      {pick && <AwardSheet code={pick} grant={grants.find((g) => g.code === pick)} onClose={() => setPick(null)} />}
    </section>
  );
}

/**
 * Плашка серии над картой при заходе (решение владельца 29.10): огонёк, длина серии, точки до рубежа. Уходит сама
 * через несколько секунд или по крестику; нажатие открывает зал наград. Показывается раз в игровые сутки на устройстве.
 */
export function StreakBanner({ streak, onOpen, onClose }: { streak: AwardsDto["streak"]; onOpen: () => void; onClose: () => void }) {
  useEffect(() => { const tm = setTimeout(onClose, 7000); return () => clearTimeout(tm); }, [onClose]);
  const next = streak.next, prev = next === null ? 0 : Math.max(0, next - 5);
  const nextDef = next === null ? null : streakAward(next);
  return (
    <div className="streak-banner" role="status">
      <button type="button" className="streak-main" onClick={onOpen}>
        <span className="streak-flame lit"><img src="/img/awards/p_streak_10.webp" alt="" /></span>
        <span className="grow">
          <b>{t("Серия: {n}", { n: streakDaysText(streak.current) })}</b>
          <small>{nextDef && streak.toNext !== null ? t("До «{name}» ещё {n}", { name: awardName(nextDef), n: plural(streak.toNext, ["день", "дня", "дней"]) }) : t("Все рубежи серии пройдены")}</small>
          {next !== null && <span className="streak-dots" aria-hidden="true">{Array.from({ length: next - prev }, (_, i) => <i key={i} className={prev + i < streak.current ? "on" : ""} />)}</span>}
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
        <AwardBadge code={code} earned size="lg" name={false} />
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
  useEffect(() => { apiReady<AdminAwardsDto>(url).then(setData).catch(() => {}); }, [url, version]);
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
              <div className="side award-row">{m.awards.length ? m.awards.map((g) => <AwardBadge key={g.code} code={g.code} earned count={g.count} size="sm" name={false} />) : <span className="muted small">{t("Наград пока нет")}</span>}</div>
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}
