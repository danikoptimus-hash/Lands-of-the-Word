import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { BOOKS } from "@lotw/domain";
import { api, ApiError, apiReady, prefetch, ready, type AwardsDto, type BattleDto, type DailyBirdDto, type EdgeTaskDto, type EdgeTaskStatus, type GameRole, type MapMarkDto, type MyMapDto, type PeaceTeamDto, type StandingsDto, type TeamDto } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useCoalesced, useGameEvents, type MapPush } from "../lib/useGameEvents";
import { applyPatch } from "fast-json-patch";
import { TeamMap, type MarkPoint, type ScoutReveal } from "./TeamMap";
import { AwardsSection, MilestoneCard, StreakBanner, awardsCached, preloadAwardImages } from "./Awards";
import { AWARD_BY_CODE } from "@lotw/domain";
import { previewPhase, useStorm } from "../lib/daytime";
import { TimelineDock } from "./Timeline";
import { mapAt, teamMoves } from "./TeamHistory";
import { CityPopup } from "./CityPopup";
import { QuarrySheet } from "./QuarrySheet";
import { BATTLE_STATUS, BattleCard, battleTone, isMyTurn, leftText } from "./BattlePanel";
import { DiplomacyMenu, type PassagesDto } from "./Diplomacy";
import { TradesSection } from "./Trades";
import { useUi } from "../lib/ui";
import { useMediaQuery } from "../lib/media";
import { t } from "../lib/i18n";
import { fmtDate, plural, setDisplayTimeZone } from "../lib/format";
import { Icon } from "../components/Icon";
import { LinksField } from "../components/LinksField";
import { PeoplePicker } from "../components/PeoplePicker";
import { Back } from "../components/Back";
import { Chip, type ChipTone } from "../components/Chip";
import { Sheet } from "../components/Sheet";
import { Help, HelpPopup } from "../components/Help";
import { ActionMenu, type MenuItem } from "../components/ActionMenu";
import { StatChip } from "../components/StatChip";
import { DeedBadgePopup, untilText } from "../components/DeedBadge";
import { FeedSection, MyServiceSection } from "./Journal";
import { TeamAvatar } from "../components/TeamAvatar";
import { UserAvatar } from "../components/UserAvatar";
import { AvatarUploader } from "../components/AvatarUploader";
import { EmptyState, ErrorState, LoadingState } from "../components/State";

/** Положение команд (меню и итоги): строка раскрывается, если есть испытания или города на пути. */
/** Таблица команд; у своей команды в раскрытой строке — состав (решение владельца 21.09: один раздел, а не два). */
type PeaceData = { canSpeak: boolean; teams: PeaceTeamDto[] };
type PeaceAction = "offer" | "accept" | "decline" | "break";
/** Срок мира словами (решение владельца 22.10): «до 29 окт.», «до конца игры»; у предложения — «на 7 дней». */
function peaceTerm(p: PeaceTeamDto): string {
  if (p.days === null || p.days === undefined) return "";
  if (p.days === 0) return t("до конца игры");
  if (p.state === "peace" && p.until) return t("до {d}", { d: fmtDate(p.until, { time: false }) });
  return t("на {n} дн.", { n: p.days });
}

function StandingsList({ standings, teamId, open, setOpen, roster, peace, onPeace, onTrade }: { standings: StandingsDto | null; teamId: string; open: string | null; setOpen: (v: string) => void; roster?: React.ReactNode; /** Мир: знак напротив каждой чужой команды (решение владельца 21.09) */ peace?: PeaceData | null; onPeace?: (p: PeaceTeamDto, action: PeaceAction) => void; /** Посол: «Предложить обмен» этой команде в меню «⋯» (решение владельца 24.10). */ onTrade?: (teamId: string) => void }) {
  const stop = { onClick: (e: React.SyntheticEvent) => e.stopPropagation(), onKeyDown: (e: React.SyntheticEvent) => e.stopPropagation() };
  if (!standings) return <LoadingState rows={2} />;
  if (standings.standings.length === 0) return <EmptyState inline icon="crown" text={t("Пока нечего показать.")} />;
  return (
    <ol className="standings-list">
      {standings.standings.map((st, i) => {
        const trials = st.battlesWon + st.battlesRepelled + st.battlesLost;
        const mine = st.teamId === teamId;
        const pc = !mine ? peace?.teams.find((p) => p.team.id === st.teamId) ?? null : null;
        const canPeace = Boolean(peace?.canSpeak && onPeace && pc && pc.team.status !== "defeated" && st.status !== "defeated");
        // Меню «⋯» напротив чужой команды (решение владельца 24.10 вместо отдельных кнопок): мир, расторжение, обмен.
        const actions: MenuItem[] = [];
        if (canPeace && pc?.state === "none") actions.push({ label: t("Предложить мир"), icon: "handshake", onSelect: () => onPeace!(pc!, "offer") });
        if (canPeace && pc?.state === "peace" && pc.breakable) actions.push({ label: t("Расторгнуть мир"), icon: "x", danger: true, onSelect: () => onPeace!(pc!, "break") });
        if (!mine && onTrade && st.status !== "defeated") actions.push({ label: t("Предложить обмен"), icon: "handshake", onSelect: () => onTrade(st.teamId) });
        const details = st.citiesOnPath.length > 0 || (mine && Boolean(roster)) || (canPeace && pc?.state === "peace");
        const opened = open ?? teamId;
        const shown = details && opened === st.teamId;
        const toggle = () => setOpen(opened === st.teamId ? "" : st.teamId);
        return (
          <li key={st.teamId} className={"standing" + (details ? " expandable" : "")} role={details ? "button" : undefined} tabIndex={details ? 0 : undefined} aria-expanded={details ? shown : undefined}
            onClick={details ? toggle : undefined} onKeyDown={details ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } } : undefined}>
            <span className="rank">{st.teamId === standings.winnerTeamId ? <Icon name="trophy" /> : i + 1}</span>
            <div className="body">
              <div className="name">
                <TeamAvatar name={st.name} color={st.color} avatarId={st.avatarId} size="sm" withName teamId={st.teamId} />
                {st.status === "defeated" ? <Chip tone="bad">{t("выбыла")}</Chip> : st.teamId === standings.winnerTeamId ? <Chip tone="ok" icon="trophy">{t("победитель")}</Chip> : st.teamId === teamId ? <Chip tone="accent">{t("мы")}</Chip> : null}
                {pc?.state === "peace" && <Chip tone="ok" icon="handshake">{peaceTerm(pc) ? `${t("мир")} ${peaceTerm(pc)}` : t("мир")}</Chip>}
                {pc?.state === "offered" && <Chip tone="info" icon="handshake">{peaceTerm(pc) ? `${t("мир предложен")} ${peaceTerm(pc)}` : t("мир предложен")}</Chip>}
                {pc?.state === "incoming" && <Chip tone="warn" icon="handshake">{peaceTerm(pc) ? `${t("предлагает мир")} ${peaceTerm(pc)}` : t("предлагает мир")}</Chip>}
                {actions.length > 0 && <span className="peace-slot" {...stop}><ActionMenu items={actions} label={t("Действия с командой «{team}»", { team: st.name })} /></span>}
                {details && <Icon name="chevron-down" className="chev" />}
              </div>
              {/* Значки вместо слов (решение владельца 07.10): города, дела, перекрёстки. */}
              {/* Значки вместо слов (решение владельца 07.10): участники (решение 24.10: как у администратора, у всех команд), города, дела, перекрёстки. */}
              <div className="meta chips" {...stop}>{st.members !== undefined && <StatChip icon="users" label={t("Участников")} value={st.members} />}<StatChip icon="city" label={t("Городов")} value={st.cities} /><StatChip icon="scroll" label={t("Принятых дел")} value={st.deedsApproved} /><StatChip icon="pin" label={t("Открытых перекрёстков")} value={st.nodesRevealed} />
                {/* Испытания значками, как у администратора (решение владельца 24.10): выиграли, устояли, потеряли. */}
                {trials > 0 && <><StatChip icon="trophy" label={t("Испытаний выиграли")} value={st.battlesWon} /><StatChip icon="shield" label={t("Испытаний устояли")} value={st.battlesRepelled} /><StatChip icon="flag" label={t("Испытаний потеряли")} value={st.battlesLost} /></>}</div>
              {canPeace && pc?.state === "incoming" && (
                <div className="row peace-row" {...stop}>
                  <button type="button" className="sm" onClick={() => onPeace!(pc!, "accept")}><Icon name="check" />{t("Принять")}</button>
                  <button type="button" className="secondary sm" onClick={() => onPeace!(pc!, "decline")}>{t("Отклонить")}</button>
                </div>
              )}
              {shown && st.citiesOnPath.length > 0 && <div className="meta">{t("Города")}: {st.citiesOnPath.map((c) => c.name + (c.current ? "" : ` (${t("потерян")})`)).join(", ")}</div>}
              {/* Мир на срок расторгнуть нельзя (решение владельца 22.10): кнопка «Расторгнуть» только у старого мира без срока. */}
              {shown && canPeace && pc?.state === "peace" && <div className="meta">{pc.since ? t("мир с {d}", { d: fmtDate(pc.since, { time: false }) }) : ""}{peaceTerm(pc) ? ` · ${peaceTerm(pc)}` : ""}</div>}
              {shown && mine && roster && <div className="standing-roster" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>{roster}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Почему игра завершилась — одинаково у участников и администратора. */
export function finishReasonLabel(reason: string | null): string {
  return reason === "last_team" ? t("осталась одна команда") : reason === "time_limit" ? t("вышел срок") : t("завершена администратором");
}

/** Разделы меню команды (решение владельца 21.09): на главном экране меню — только то, что требует внимания, и значки разделов. Состав, проходы и мир — внутри «Команд»; лента событий называется «Летопись». */
type MenuView = "home" | "attention" | "deeds" | "battles" | "standings" | "feed" | "service" | "awards";
/** Колокольчик — такая же плитка, как остальные (просьба участника 05.10): внутри всё, что требует внимания. */
const MENU_ITEMS: Array<{ key: Exclude<MenuView, "home">; icon: string; label: () => string; /** Короткая подпись для плитки дока на телефоне (ширина плитки как у администратора). */ short?: () => string; hot?: boolean }> = [
  { key: "attention", icon: "bell", label: () => t("Внимание"), hot: true },
  { key: "deeds", icon: "scroll", label: () => t("Дела") },
  { key: "battles", icon: "wave", label: () => t("Испытания"), hot: true },
  { key: "standings", icon: "crown", label: () => t("Команды"), hot: true },
  { key: "feed", icon: "feather", label: () => t("Летопись") },
  { key: "service", icon: "user", label: () => t("Моё служение"), short: () => t("Служение") },
  { key: "awards", icon: "trophy", label: () => t("Награды") },
];

const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));
const bookName = (code: string) => BOOK_BY_CODE.get(code)?.nameRu ?? "";

/** Статусы дела: одна палитра для меток на карте, карточки и списка (DESIGN.md §3). */
export function deedStatus(s: EdgeTaskStatus): { label: string; tone: ChipTone; icon: string } {
  switch (s) {
    case "TAKEN": return { label: t("в работе"), tone: "info", icon: "user" };
    case "SUBMITTED": return { label: t("на проверке"), tone: "warn", icon: "clock" };
    case "APPROVED": return { label: t("принято"), tone: "ok", icon: "check" };
    case "REJECTED": return { label: t("возвращено"), tone: "bad", icon: "alert" };
    default: return { label: t("свободно"), tone: "neutral", icon: "scroll" };
  }
}
const PROOF: Record<EdgeTaskDto["deed"]["proofType"], { icon: string; label: () => string }> = {
  PHOTO_LINK: { icon: "camera", label: () => t("Фото") }, VIDEO_LINK: { icon: "video", label: () => t("Видео") }, AUDIO_LINK: { icon: "play", label: () => t("Аудиозапись") }, WITNESS: { icon: "user", label: () => t("Свидетель") },
  REPORT: { icon: "edit", label: () => t("Отчёт") },
};
/**
 * Кодекс дела (решение владельца 18.09): пять правил, свёрнуты под значком, чтобы не занимать место.
 * Для дел в доме молитвы — уборка, починка, труд (решение владельца 19.10) — шестое правило: согласовать с диаконом.
 */
const PRAYER_HOUSE = /дом[еа]? молитвы/i;
const CODEX = (deed?: { title: string; description?: string | null }) => [
  t("Дело делается ради человека, а не ради стороны на карте: не для галочки."),
  t("Людей фотографировать только с их согласия; лучше снимать предмет, результат или записку."),
  t("Угощать, помогать и навещать — не участников этой игры."),
  t("В отчёте честно: что сделал, кому и как."),
  t("Чужое дело как своё не сдаётся; если делали группой — отметьте всех участников."),
  ...(deed && PRAYER_HOUSE.test(`${deed.title} ${deed.description ?? ""}`) ? [t("Уборку, починку или любую работу в доме молитвы сначала согласуйте с диаконом: что, когда и как делать.")] : []),
];
/** Роли: подпись, иконка и одно предложение из правил (2.15) — показывается по нажатию на пилюлю. */
const ROLE: Record<GameRole | "CAPTAIN" | "DEPUTY", { icon: string; label: () => string; hint: () => string }> = {
  CAPTAIN: { icon: "crown", label: () => t("капитан"), hint: () => t("Бросает вызов и отвечает на испытания, переносит столицу, назначает заместителя и просит роли у администратора.") },
  DEPUTY: { icon: "star", label: () => t("заместитель"), hint: () => t("Всё, что может капитан, кроме назначения ролей: вызов, ответ, столица.") },
  SCOUT: { icon: "telescope", label: () => t("Разведчик"), hint: () => t("Раз в неделю может разведать, что за стороной: город или развилка.") },
  PROPHET: { icon: "sparkle", label: () => t("Пророк"), hint: () => t("Раз в неделю зажигает свечу к заданию города и один раз видит письмо с подсказкой.") },
  AMBASSADOR: { icon: "handshake", label: () => t("Посол"), hint: () => t("Просит проходы через чужие города, отвечает на чужие запросы, предлагает мир.") },
  CHRONICLER: { icon: "edit", label: () => t("Летописец"), hint: () => t("Сдаёт дела за команду и следит, чтобы ссылки и фото были приложены.") },
  HELMSMAN: { icon: "ship", label: () => t("Кормчий"), hint: () => t("Ведёт корабль: выбирает место высадки на любом береговом узле другого острова. Где там город, заранее не видно. Капитан и команда ему советуют.") },
  WARRIOR: { icon: "sword", label: () => t("Воин"), hint: () => t("Его выученные стихи в испытаниях считаются вдвое.") },
  NONE: { icon: "user", label: () => t("Без роли"), hint: () => "" },
};

/** Страница команды: карта во весь экран, карточка дела, боковое меню (на широком экране — постоянная колонка). */
export function TeamPage() {
  const { id = "" } = useParams();
  const { user, logout } = useAuth();
  const { notify, confirm } = useUi();
  const wide = useMediaQuery("(min-width: 1024px)");
  // Готовые ответы с главной (решение владельца 24.10): состав и карта рисуются сразу, свежие придут следом.
  type TeamsResp = { isAdmin: boolean; teams: TeamDto[] };
  type MapResp = MyMapDto & { gameName?: string; donation?: { currency: string } | null };
  const firstTeams = ready<TeamsResp>(`/api/games/${id}/teams`), firstMap = ready<MapResp>(`/api/games/${id}/my-map`);
  const [team, setTeam] = useState<TeamDto | null>(() => firstTeams?.teams.find((tm) => tm.members.some((mm) => mm.user.id === user?.id)) ?? firstTeams?.teams[0] ?? null);
  const [isAdmin, setIsAdmin] = useState(firstTeams?.isAdmin ?? false);
  const [map, setMap] = useState<MyMapDto | null>(firstMap);
  // Сначала кадр с оболочкой, потом тяжёлая карта (замер 24.10 на телефоне: с готовыми данными карта строилась прямо в
  // нажатии и экран замирал на секунды; оболочка за один кадр возвращает мгновенный отклик, карта приходит следом).
  const [painted, setPainted] = useState(false);
  useEffect(() => { const raf = requestAnimationFrame(() => setPainted(true)); return () => cancelAnimationFrame(raf); }, []);
  /** Ползунок истории (решение владельца 05.10): null — сейчас, иначе карта команды на момент выбранного хода. */
  const [historyAt, setHistoryAt] = useState<Date | null>(null);
  const moves = useMemo(() => (map ? teamMoves(map) : []), [map]);
  const shownMap = useMemo(() => (map && historyAt ? mapAt(map, historyAt) : map), [map, historyAt]);
  // Шторм (решение владельца 24.10): по расписанию из ответа сервера; в шторм — только карта с бурей, без кнопок и действий.
  const stormReload = useRef<() => void>(() => {});
  const storm = useStorm(map?.daytime, map?.now, () => stormReload.current());
  const stormWas = useRef(storm.active);
  const [error, setError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** «Посмотреть на карте» (просьба владельца 10.10): подвести карту к стороне дела вблизи. Из списков дел и состава команды. */
  const [focusTask, setFocusTask] = useState<{ id: string; nonce: number } | null>(null);
  /** Режим высадки: id одобренного морского дела, для которого капитан выбирает узел на другом острове. */
  const [landingId, setLandingId] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [cityKey, setCityKey] = useState<string | null>(null);
  /** Каменоломня (решение владельца 04.10): лист общих дел и камней. */
  const [quarryOpen, setQuarryOpen] = useState(false);
  const [cityVersion, setCityVersion] = useState(0);
  /** Лента, «Моё служение» и мир перезагружаются по событиям журнала, дел, городов и испытаний. */
  const [feedVersion, setFeedVersion] = useState(0);
  // Награды и серия (решение владельца 29.10): сводка нужна и для плашки над картой, и для раздела «Награды».
  const [awards, setAwards] = useState<AwardsDto | null>(() => awardsCached(id));
  const [awardsVersion, setAwardsVersion] = useState(0);
  const [streakShow, setStreakShow] = useState(false);
  const [milestone, setMilestone] = useState<string | null>(null);
  const [awardsSeen, setAwardsSeen] = useState(() => { try { return Number(localStorage.getItem(`lotw.awards.seen.${id}`) ?? 0); } catch { return 0; } });
  useEffect(() => { apiReady<AwardsDto>(`/api/games/${id}/awards`).then((d) => { setAwards(d); preloadAwardImages(["p_streak_10", ...d.team.map((g) => g.code), ...d.mine.map((g) => g.code)]); }).catch(() => {}); }, [id, awardsVersion]);
  useEffect(() => {
    if (!awards) return;
    const s = awards.streak;
    try {
      // Рубеж серии, взятый в последние полтора суток и ещё не отпразднованный на этом устройстве.
      const shown = (localStorage.getItem(`lotw.milestone.${id}`) ?? "").split(",");
      const fresh = awards.mine.find((g) => AWARD_BY_CODE.get(g.code)?.streakDays && Date.now() - new Date(g.at).getTime() < 36 * 3_600_000 && !shown.includes(g.code));
      if (fresh) { setMilestone(fresh.code); return; }
      if (s.current > 0 && localStorage.getItem(`lotw.streak.${id}`) !== s.todayKey) setStreakShow(true);
    } catch { /* приватный режим: покажем и так */ }
  }, [awards?.streak.todayKey, awards?.mine.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const closeStreak = useCallback(() => { setStreakShow(false); try { if (awards) localStorage.setItem(`lotw.streak.${id}`, awards.streak.todayKey); } catch { /* ничего */ } }, [awards, id]);
  const closeMilestone = useCallback(() => { if (milestone) { try { const k = `lotw.milestone.${id}`; localStorage.setItem(k, [...(localStorage.getItem(k) ?? "").split(",").filter(Boolean), milestone].join(",")); } catch { /* ничего */ } } setMilestone(null); }, [milestone, id]);
  const awardsTotal = awards ? awards.team.reduce((a, g) => a + g.count, 0) + awards.mine.reduce((a, g) => a + g.count, 0) : 0;
  const [battles, setBattles] = useState<BattleDto[]>([]);
  const [standings, setStandings] = useState<StandingsDto | null>(null);
  const [passages, setPassages] = useState<PassagesDto | null>(null);
  const [now, setNow] = useState(Date.now());
  const [gameName, setGameName] = useState(firstMap?.gameName ?? "");
  /** Валюта пожертвований игры; минимум — у каждого дела свой (deed.donationMin). */
  const [currency, setCurrency] = useState(firstMap?.donation?.currency ?? "");
  const [busy, setBusy] = useState(false);
  const [mapEl, setMapEl] = useState<HTMLDivElement | null>(null);
  const [markAt, setMarkAt] = useState<MarkPoint | null>(null);
  /** Своя метка по нажатию (решение владельца 16.10): лист с подписью — изменить или убрать. */
  const [editMark, setEditMark] = useState<MapMarkDto | null>(null);
  const [editNote, setEditNote] = useState("");
  /** Точка на краю тумана без дороги с делом: лист с разведкой (решение владельца 02.10). */
  const [frontierKey, setFrontierKey] = useState<string | null>(null);
  const [markNote, setMarkNote] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteDone, setInviteDone] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const seenBattles = useRef<Map<string, string> | null>(null);
  /** Описание дела свёрнуто до двух строк («Подробнее»), пока дело не взято мной; при смене дела сворачивается снова. */
  const [descOpen, setDescOpen] = useState(false);
  // Полёт клина (решение владельца 05.10): карта отдаёт только момент, узел города приходит отдельным запросом к назначенной
  // минуте, а после окна полёта — момент следующего полёта. Так в ответе карты нет координат города в тумане.
  const [bird, setBird] = useState<DailyBirdDto | null>(null);
  const birdOf = map?.dailyBird;
  useEffect(() => {
    setBird(birdOf ?? null);
    if (!birdOf || !id) return;
    const offset = map?.now ? map.now - Date.now() : 0;
    const serverNow = () => Date.now() + offset;
    const PERIOD = 2 * 3_600_000, AFTER = 300_000;
    const fetchBird = () => api<{ bird: DailyBirdDto | null }>(`/api/games/${id}/my-map/bird`).then((r) => setBird(r.bird)).catch(() => undefined);
    let delay: number;
    if (!birdOf.key && birdOf.at > serverNow()) delay = Math.max(0, birdOf.at - serverNow() - 10_000);
    else if (birdOf.at + AFTER < serverNow() || (!birdOf.key && birdOf.at <= serverNow())) delay = (Math.floor(serverNow() / PERIOD) + 1) * PERIOD - serverNow() + 3_000;
    else delay = birdOf.at + AFTER - serverNow() + 3_000;
    const timer = window.setTimeout(() => void fetchBird(), Math.min(delay, 2_147_000_000));
    return () => window.clearTimeout(timer);
  }, [birdOf, id, map?.now]);
  useEffect(() => { setDescOpen(false); }, [selectedId]);
  /** Положение команд: подробности (испытания, города) раскрыты у одной команды; по умолчанию — у нашей. */
  const [openStanding, setOpenStanding] = useState<string | null>(null);
  const [menuView, setMenuView] = useState<MenuView>("home");
  /**
   * Дело открыто из списка меню (просьба участников 25.10: «посмотрел дело, нажал назад и вернулся в список туда, где листал»):
   * запоминаем раздел и прокрутку меню; закрытие листа дела возвращает в меню на то же место. На компьютере панель и так не закрывается.
   */
  const [backTo, setBackTo] = useState<{ view: MenuView; top: number; bodyTop: number } | null>(null);
  const [restore, setRestore] = useState<{ top: number; bodyTop: number } | null>(null);
  const sideRef = useRef<HTMLElement | null>(null);
  const sideBodyRef = useRef<HTMLDivElement | null>(null);
  // Прокрутка восстанавливается, когда меню снова на экране (до отрисовки кадра, чтобы список не прыгал).
  useLayoutEffect(() => {
    if (!restore || !menu) return;
    if (sideRef.current) sideRef.current.scrollTop = restore.top;
    if (sideBodyRef.current) sideBodyRef.current.scrollTop = restore.bodyTop;
    setRestore(null);
  }, [restore, menu]);

  const loadStandings = useCallback(() => api<StandingsDto>(`/api/games/${id}/standings`).then(setStandings).catch(() => {}), [id]);
  const loadPassages = useCallback(() => api<PassagesDto>(`/api/games/${id}/my-passages`).then(setPassages).catch(() => {}), [id]);
  const [peace, setPeace] = useState<PeaceData | null>(null);
  const loadPeace = useCallback(() => api<PeaceData>(`/api/games/${id}/peace`).then(setPeace).catch(() => {}), [id]);
  /** Мир из строки команды: предложение — только после подтверждения «Да / Нет» (решение владельца 21.09). */
  /** Предложение мира — с выбором срока (решение владельца 22.10): шторка с вариантами вместо «Да / Нет». */
  const [peaceOffer, setPeaceOffer] = useState<PeaceTeamDto | null>(null);
  /** Срок в днях выбирает сама команда (уточнение владельца 22.10), не из готовых кнопок. */
  const [peaceDays, setPeaceDays] = useState(7);
  const offerPeace = useCallback(async (p: PeaceTeamDto, days: number) => {
    setPeaceOffer(null);
    try { await api(`/api/games/${id}/peace`, { method: "POST", body: JSON.stringify({ teamId: p.team.id, days }) }); notify(t("Мир предложен")); await loadPeace(); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
  }, [id, notify, loadPeace]);
  /** Обмен городами из меню «⋯» строки команды (решение владельца 24.10): форма посла открывается с этой командой. */
  const [tradeFor, setTradeFor] = useState<{ teamId: string; nonce: number } | null>(null);
  const [canTrade, setCanTrade] = useState(false);
  const onPeace = useCallback(async (p: PeaceTeamDto, action: PeaceAction) => {
    const name = p.team.name;
    let path = `/api/games/${id}/peace`, body: unknown = { teamId: p.team.id }, ok = t("Мир предложен");
    if (action === "offer") { setPeaceOffer(p); return; }
    else if (action === "accept") { path = `/api/games/${id}/peace/${p.peaceId}/accept`; body = {}; ok = t("Мир заключён"); }
    else if (action === "decline") { path = `/api/games/${id}/peace/${p.peaceId}/decline`; body = {}; ok = t("Предложение отклонено"); }
    else {
      if (!(await confirm(t("Расторжение вступает в силу сразу, об этом узнают все команды."), { title: t("Расторгнуть мир с «{team}»?", { team: name }), okLabel: t("Расторгнуть") }))) return;
      path = `/api/games/${id}/peace/${p.peaceId}/break`; body = {}; ok = t("Мир расторгнут");
    }
    try { await api(path, { method: "POST", body: JSON.stringify(body) }); notify(ok); await loadPeace(); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
  }, [id, confirm, notify, loadPeace]);
  const loadBattles = useCallback(() => api<{ battles: BattleDto[] }>(`/api/games/${id}/my-battles`).then((r) => {
    // Живые оповещения: новый вызов нашему городу, старт ответа, итог испытания.
    const prev = seenBattles.current;
    if (prev) for (const b of r.battles) {
      const was = prev.get(b.id);
      if (was === b.status) continue;
      const mine = team && b.defender.id === team.id;
      if (!was && mine && b.status === "ATTACK") notify(t("Вашему городу {city} брошен вызов: {n} стихов", { city: bookName(b.bookCode), n: b.bid }), "bad");
      else if (was && mine && b.status === "DEFENSE") notify(t("Вызов городу {city} принят: пошло время ответа", { city: bookName(b.bookCode) }), "bad");
      else if (was && (b.status === "WON" || b.status === "REPELLED" || b.status === "EXPIRED")) notify(t("Испытание города {city}: {status}", { city: bookName(b.bookCode), status: BATTLE_STATUS[b.status] }), b.status === "WON" ? (mine ? "bad" : "ok") : mine ? "ok" : "bad");
    }
    seenBattles.current = new Map(r.battles.map((b) => [b.id, b.status]));
    setBattles(r.battles);
  }).catch(() => {}), [id, team, notify]);
  useEffect(() => { const tm = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(tm); }, []);

  // Свайп от левого края открывает меню (дополнение к кнопке «Меню»); браузерный «назад» по этому жесту гасим.
  const swipe = useRef<{ x: number; y: number; edge: boolean } | null>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = screenRef.current;
    if (!el) return;
    const onMove = (e: TouchEvent) => {
      const st = swipe.current;
      if (!st) return;
      const tp = e.touches[0]!;
      if (st.edge && Math.abs(tp.clientX - st.x) > Math.abs(tp.clientY - st.y) && e.cancelable) e.preventDefault();
    };
    el.addEventListener("touchmove", onMove, { passive: false });
    return () => el.removeEventListener("touchmove", onMove);
  }, [team?.id]);

  const loadTeam = useCallback(() => apiReady<TeamsResp>(`/api/games/${id}/teams`).then((r) => { setError(null); setIsAdmin(r.isAdmin); setTeam(r.teams.find((tm) => tm.members.some((mm) => mm.user.id === user?.id)) ?? r.teams[0] ?? null); }).catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети"))), [id, user?.id]);
  const loadMap = useCallback(() => apiReady<MapResp>(`/api/games/${id}/my-map`).then((m) => { setMap(m); setMapError(null); setDisplayTimeZone(m.daytime?.timeZone); if (m.gameName) setGameName(m.gameName); setCurrency(m.donation?.currency ?? ""); }).catch((e) => setMapError(e instanceof ApiError ? e.message : t("Ошибка сети"))), [id]);
  useEffect(() => { void loadTeam(); void loadMap(); }, [loadTeam, loadMap]);
  stormReload.current = () => { void loadMap(); };
  // Разделы меню («Моё служение», «Лента») открываются сразу (решение владельца 24.10): их ответы запрашиваются заранее.
  useEffect(() => { if (team && !isAdmin) prefetch([`/api/games/${id}/my-service`, `/api/games/${id}/top`, `/api/games/${id}/feed`]); }, [id, team?.id, isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps
  // Смена шторма: на входе закрываются меню и все листы, на выходе всё возвращается; карта перечитывается в обоих случаях.
  useEffect(() => {
    if (stormWas.current === storm.active) return;
    stormWas.current = storm.active;
    if (storm.active) { setMenu(false); setMenuView("home"); setSelectedId(null); setCityKey(null); setQuarryOpen(false); setFrontierKey(null); setMarkAt(null); setEditMark(null); setLandingId(null); setHistoryAt(null); }
    void loadMap();
  }, [storm.active, loadMap]);
  useEffect(() => { if (team) { void loadBattles(); void loadStandings(); void loadPassages(); void loadPeace(); } }, [team, loadBattles, loadStandings, loadPassages, loadPeace]);
  // Перечитывания по событиям склеиваются (решение владельца 23.10): несколько событий за 2,5 с — одно перечитывание.
  const teamLater = useCoalesced(loadTeam), mapLater = useCoalesced(loadMap), passagesLater = useCoalesced(loadPassages), battlesLater = useCoalesced(loadBattles), standingsLater = useCoalesced(loadStandings), peaceLater = useCoalesced(loadPeace);
  const cityLater = useCoalesced(() => setCityVersion((v) => v + 1)), feedLater = useCoalesced(() => setFeedVersion((v) => v + 1));
  const awardsLater = useCoalesced(() => setAwardsVersion((v) => v + 1));
  // Карта приходит разницей от сервера (решение владельца 24.10): применяем к своей версии; если версии разошлись — перечитываем.
  const mapRef = useRef(map); mapRef.current = map;
  const onMapPush = (m: MapPush) => {
    const cur = mapRef.current;
    if (m.kind === "stale" || !cur || cur.rev !== m.base) { mapLater(); return; }
    try {
      const next = applyPatch(structuredClone(cur), m.patch as Parameters<typeof applyPatch>[1], true, false).newDocument as MyMapDto;
      // Тайные дела: сервер не шлёт ссылки и текст сдачи, свои оставляем как были.
      next.tasks = next.tasks.map((t) => { const old = cur.tasks.find((o) => o.id === t.id); return t.deed.secret && old && !t.links.length && !t.note ? { ...t, links: old.links, note: old.note } : t; });
      setMap({ ...next, rev: m.rev });
    } catch { mapLater(); }
  };
  useGameEvents(id, (e) => {
    // Дела другой команды на моей карте не видны: такие события пропускаем (сервер их и не шлёт, это страховка для старых клиентов).
    if (e.teamId && team && e.teamId !== team.id && (e.type === "tasks" || e.type === "submissions" || e.type === "journal")) return;
    if (e.type === "teams" || e.type === "game" || e.type === "tasks") teamLater(); // tasks: таймеры дел у участников в составе
    // Сама карта приходит разницей (map-patch); здесь перечитываем только то, что к карте добавляет маршрут:
    // статус игры, камни Каменоломни в шапке, визиты, заморозку дел.
    if (e.type === "game" || e.type === "quarry" || e.type === "cities" || e.type === "teams") mapLater();
    if (e.type === "cities" || e.type === "game" || e.type === "battles") { cityLater(); passagesLater(); }
    if (e.type === "battles" || e.type === "game" || e.type === "submissions") battlesLater();
    if (e.type === "game" || e.type === "cities" || e.type === "battles" || e.type === "teams") standingsLater();
    if (e.type === "peace" || e.type === "teams" || e.type === "game") peaceLater();
    if (e.type === "journal" || e.type === "peace" || e.type === "submissions" || e.type === "cities" || e.type === "battles" || e.type === "game") feedLater();
    if (e.type === "awards" || e.type === "submissions" || e.type === "game") awardsLater();
  }, onMapPush);
  useEffect(() => {
    const tm = setInterval(() => void loadMap(), 60000);
    const onFocus = () => void loadMap();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(tm); window.removeEventListener("focus", onFocus); };
  }, [loadMap]);

  const me = team?.members.find((m) => m.user.id === user?.id);
  const isCaptain = me?.role === "CAPTAIN";
  /** Фото команды ставит капитан (решение владельца 24.10): блок над составом. */
  const avatarEditor = team && isCaptain ? <AvatarUploader preview={<TeamAvatar name={team.name} color={team.color} avatarId={team.avatarId} size="lg" zoom={false} />} url={`/api/games/${id}/teams/${team.id}/avatar`} hasAvatar={Boolean(team.avatarId)} blocked={user?.avatarBlocked} onChanged={loadTeam} /> : undefined;
  /** Капитан или заместитель: вызов, ответ, столица. */
  const isLeader = isCaptain || me?.role === "DEPUTY";
  // Место высадки выбирает кормчий, капитан и команда советуют (решение владельца 03.10); без кормчего в команде — капитан или заместитель.
  const hasHelmsman = (team?.members ?? []).some((mm) => mm.gameRole === "HELMSMAN");
  const canLand = me?.gameRole === "HELMSMAN" || (isLeader && !hasHelmsman);
  const task = useMemo(() => (map?.tasks ?? []).find((tk) => tk.id === selectedId) ?? null, [map, selectedId]);
  const memberName = (userId: string | null) => { const m = team?.members.find((mm) => mm.user.id === userId); return m ? m.user.displayName ?? m.user.nickname : ""; };

  async function act(path: string, body?: unknown): Promise<boolean> {
    setBusy(true); setError(null);
    try { await api(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }); await loadMap(); return true; }
    catch (e) { setError(e instanceof ApiError ? (e.issues?.map((i) => i.message).join("; ") || e.message) : t("Ошибка сети")); return false; }
    finally { setBusy(false); }
  }
  const peekedKind = (key: string) => map?.peeked?.find((p) => p.key === key)?.kind ?? null;
  /** Разведка (решение владельца 29.10): вместо слов карта на пять секунд раздвигает туман вокруг перекрёстка и показывает, что там; листы закрываются, чтобы карту было видно. */
  const [scout, setScout] = useState<ScoutReveal | null>(null);
  async function peek(nodeKey: string) {
    setBusy(true); setError(null);
    try {
      const r = await api<{ kind: string; bookCode?: string | null; cityType?: string | null; hexes?: ScoutReveal["hexes"] }>(`/api/games/${id}/my-map/peek`, { method: "POST", body: JSON.stringify({ nodeKey }) });
      setFrontierKey(null); setSelectedId(null); setBackTo(null); setMenu(false);
      setScout({ key: nodeKey, kind: r.kind, bookCode: r.bookCode, cityType: r.cityType, hexes: r.hexes, nonce: Date.now() });
      await loadMap();
    }
    catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); }
    finally { setBusy(false); }
  }
  async function release(tk: EdgeTaskDto) {
    if (!(await confirm(t("Дело снова станет свободным, набранный текст пропадёт."), { title: t("Отказаться от дела?"), okLabel: t("Отказаться") }))) return;
    if (await act(`/api/games/${id}/edge-tasks/${tk.id}/release`)) notify(t("Дело снова свободно"), "info");
  }
  async function land(nodeKey: string) {
    if (!landingId) return;
    if (!(await confirm(t("Узел откроется, и с него пойдут дела по другому острову. Вернуться назад можно только с портом."), { title: t("Высадиться здесь?"), okLabel: t("Высадиться") }))) return;
    try { await api(`/api/games/${id}/edge-tasks/${landingId}/land`, { method: "POST", body: JSON.stringify({ nodeKey }) }); setLandingId(null); notify(t("Команда высадилась на другом острове")); await loadMap(); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
  }
  async function setGameRole(userId: string, gameRole: GameRole) {
    setError(null);
    try {
      await api(`/api/games/${id}/teams/${team!.id}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ gameRole }) });
      notify(gameRole === "NONE" ? t("Роль снята") : t("Роль назначена"), "info");
      await loadTeam();
    }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
  }
  /**
   * Ссылка для участников от капитана (решение владельца 22.09): одна кнопка, ссылка сразу в буфере.
   * В Safari буфер доступен только из жеста — ссылка передаётся обещанием через ClipboardItem; где его нет, ждём ответ и пишем текст.
   */
  async function inviteCopy() {
    setInviteBusy(true); setInviteUrl(null);
    const url = api<{ invite: { path: string } }>(`/api/games/${id}/teams/${team!.id}/invites`, { method: "POST", body: JSON.stringify({ role: "MEMBER" }) }).then((r) => window.location.origin + r.invite.path);
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": url.then((u) => new Blob([u], { type: "text/plain" })) })]);
      } else {
        await navigator.clipboard.writeText(await url);
      }
      notify(t("Ссылка для участников скопирована: действует 14 дней, до 20 человек")); setInviteDone(true); setTimeout(() => setInviteDone(false), 1500);
    } catch (e) {
      if (e instanceof ApiError) { notify(e.message, "bad"); return; }
      try { setInviteUrl(await url); notify(t("Не удалось скопировать: выделите ссылку вручную"), "bad"); } catch (e2) { notify(e2 instanceof ApiError ? e2.message : t("Ошибка сети"), "bad"); }
    } finally { setInviteBusy(false); }
  }
  async function putMark() {
    if (!markAt) return;
    setBusy(true);
    try {
      await api(`/api/games/${id}/my-map/marks`, { method: "POST", body: JSON.stringify({ q: markAt.q, r: markAt.r, qf: markAt.qf, rf: markAt.rf, note: markNote.trim() }) });
      setMarkAt(null); setMarkNote(""); notify(t("Метка поставлена: её видит вся команда"), "info"); await loadMap();
    } catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusy(false); }
  }
  async function saveMark() {
    if (!editMark) return;
    setBusy(true);
    try { await api(`/api/games/${id}/my-map/marks/${editMark.id}`, { method: "PATCH", body: JSON.stringify({ note: editNote.trim() }) }); setEditMark(null); notify(t("Подпись метки изменена"), "info"); await loadMap(); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusy(false); }
  }
  function tapMark(mk: MapMarkDto) {
    if (mk.by && user && mk.by.id === user.id) { setEditMark(mk); setEditNote(mk.note); return; }
    void removeMark(mk);
  }
  async function removeMark(mk: MapMarkDto) {
    const by = mk.by?.name ?? "";
    // Убрать метку может только автор (решение владельца 29.09): чужая метка по нажатию лишь подсказывает, чья она.
    const when = mk.createdAt ? fmtDate(mk.createdAt) : "";
    if (mk.by && user && mk.by.id !== user.id) { notify(mk.note ? t("Метка «{note}» — её поставил {name} ({when}), убрать может только он.", { note: mk.note, name: by, when }) : t("Метку поставил {name} ({when}), убрать может только он.", { name: by, when }), "info"); return; }
    const text = mk.note
      ? (by ? t("Метка «{note}» (автор {name}, {when}) исчезнет у всей команды.", { note: mk.note, name: by, when }) : t("Метка «{note}» исчезнет у всей команды.", { note: mk.note }))
      : (by ? t("Метка (автор {name}, {when}) исчезнет у всей команды.", { name: by, when }) : t("Метка исчезнет у всей команды."));
    if (!(await confirm(text, { title: t("Убрать метку?"), okLabel: t("Убрать") }))) return;
    try { await api(`/api/games/${id}/my-map/marks/${mk.id}`, { method: "DELETE" }); await loadMap(); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
  }
  async function setDeputy(userId: string, on: boolean) {
    setError(null);
    try { await api(`/api/games/${id}/teams/${team!.id}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ role: on ? "DEPUTY" : "MEMBER" }) }); notify(on ? t("Заместитель назначен") : t("Заместитель снят"), "info"); await loadTeam(); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
  }

  // Служебные состояния: всегда с навигацией, никогда тупик.
  if (error && !team) {
    return (
      <main className="container narrow bare">
        <Back to="/" label={t("Мои игры")} />
        <div className="card">
          <h1>{t("Не удалось открыть команду")}</h1>
          <p className="muted mt-2">{error}</p>
          <div className="actions"><button type="button" onClick={() => { setError(null); void loadTeam(); void loadMap(); }}><Icon name="refresh" />{t("Повторить")}</button><Link className="btn secondary" to="/">{t("Мои игры")}</Link></div>
        </div>
      </main>
    );
  }
  if (!team || !painted) {
    return (
      <div className="map-screen loading">
        <div className="hud-left"><Link to="/" className="btn secondary icon hud-btn" aria-label={t("Мои игры")} title={t("Мои игры")}><Icon name="back" /></Link></div>
        <div className="map-loading" aria-busy="true"><LoadingState rows={3} /><span>{t("Загружаем карту…")}</span></div>
      </div>
    );
  }
  if (isAdmin && !me) {
    return (
      <main className="container narrow">
        <Back to={`/games/${id}`} label={t("К странице игры")} />
        <div className="card">
          <h1 className="row"><TeamAvatar name={team.name} color={team.color} avatarId={team.avatarId} size="lg" />{team.name}</h1>
          <p className="muted mt-3">{t("Вы администратор этой игры, а не участник команды. Карта команды с туманом видна только её участникам; вся карта и ход всех команд — на странице игры.")}</p>
          <div className="actions"><Link className="btn" to={`/games/${id}`}><Icon name="map" />{t("К странице игры")}</Link></div>
        </div>
      </main>
    );
  }
  if (!map) {
    return (
      <main className="container narrow bare">
        <Back to="/" label={t("Мои игры")} />
        <div className="card">
          <h1 className="row"><TeamAvatar name={team.name} color={team.color} avatarId={team.avatarId} size="lg" />{team.name}</h1>
          <div className="mt-3">{mapError ? <ErrorState text={mapError} onRetry={() => void loadMap()} /> : <LoadingState rows={3} />}</div>
        </div>
      </main>
    );
  }
  const winner = standings?.winnerTeamId ? standings.standings.find((s) => s.teamId === standings.winnerTeamId)?.name ?? "" : "";
  if (map.status !== "ACTIVE") {
    return (
      <main className="container narrow bare">
        <Back to="/" label={t("Мои игры")} />
        <div className="card">
          <h1 className="row"><TeamAvatar name={team.name} color={team.color} avatarId={team.avatarId} size="lg" />{team.name}</h1>
          {gameName && <p className="muted mt-1">{gameName}</p>}
          {map.status === "FINISHED" ? (
            <>
              <p className={"note mt-3 " + (winner ? "ok" : "")}><Icon name="trophy" /><span>{winner ? <>{t("Победила команда")} <strong>«{winner}»</strong></> : t("Победитель не определён")} · {finishReasonLabel(standings?.finishReason ?? null)}{standings?.finishedAt ? ` · ${fmtDate(standings.finishedAt)}` : ""}</span></p>
              <div className="actions"><Link className="btn secondary" to={`/games/${id}/book`}><Icon name="book" />{t("Книга сезона")}</Link></div>
            </>
          ) : (
            <>
              <p className="mt-3">{t("Игра ещё не началась. Когда администратор начнёт её, здесь появится карта.")}</p>
              {isCaptain && <p className="muted mt-2">{t("Раздайте роли всем участникам: они дают команде разведку, подсказки и переговоры. Пока у кого-то нет роли, администратор не сможет начать игру.")}</p>}
              <div className="actions"><Link className="btn secondary" to="/how-to-play"><Icon name="help" />{t("Как играть")}</Link></div>
            </>
          )}
        </div>
        {map.status === "FINISHED" && (
          <div className="card">
            <h2><Icon name="crown" />{t("Итоги")}</h2>
            <StandingsList standings={standings} teamId={team.id} open={openStanding} setOpen={setOpenStanding} roster={<Roster embedded team={team} isCaptain={false} onRole={setGameRole} onDeputy={setDeputy} />} />
          </div>
        )}
        {map.status !== "FINISHED" && <div className="card"><Roster avatarEditor={avatarEditor} team={team} isCaptain={isCaptain} onRole={setGameRole} onDeputy={setDeputy} onInvite={isCaptain ? () => void inviteCopy() : undefined} inviteBusy={inviteBusy} inviteDone={inviteDone} inviteUrl={inviteUrl} /></div>}
      </main>
    );
  }

  const activeBattles = battles.filter((b) => b.status === "QUEUED" || b.status === "ATTACK" || b.status === "DEFENSE");
  // В списке дела по алфавиту названий (решение владельца 24.10) — и взятые, и свободные.
  const byTitle = (a: { deed: { title: string } }, b: { deed: { title: string } }) => a.deed.title.localeCompare(b.deed.title, "ru");
  const ourTasks = map.tasks.filter((tk) => tk.status === "TAKEN" || tk.status === "SUBMITTED" || tk.status === "REJECTED").sort(byTitle);
  // Свободные дела на карте — в разделе «Дела» с кнопкой «Взять» у каждого, чтобы не искать метку на карте (решение владельца 05.10).
  const freeTasks = map.tasks.filter((tk) => tk.status === "OPEN").sort(byTitle);
  // Фаза для подписей: предпросмотр `?tod=` (снимки инструкции) перекрывает серверную, правила считает сервер.
  const phase = previewPhase() ?? map.daytime?.phase;
  const canTakeNow = phase !== "night" || Boolean(map.daytime?.tasksOpen);
  const donationText = (dm: number | null | undefined) => dm ? `${t("пожертвование от {min} {cur}", { min: dm, cur: currency })}`.trim() : "";
  const landingTask = landingId ? map.tasks.find((tk) => tk.id === landingId && tk.landing) ?? null : null;
  const incoming = passages?.incoming.filter((r) => r.status === "PENDING") ?? [];
  // Бейдж на кнопке меню — только то, что требует действия: возвращённое дело, входящий запрос прохода, наш ход в испытании.
  const peaceOffers = peace?.canSpeak ? peace.teams.filter((p) => p.state === "incoming") : [];
  // Просьба о защитном союзе (решение владельца 22.10) ждёт ответа капитана, заместителя или посла.
  const allyAsks = activeBattles.filter((b) => b.myAlliance?.status === "PROPOSED").length;
  // Отчёт о визите (решение владельца 22.10) ждёт капитана или заместителя до полуночи.
  const visitsDue = (map.visits ?? []).filter((v) => v.status === "PENDING");
  const attention = ourTasks.filter((tk) => tk.status === "REJECTED").length + incoming.length + peaceOffers.length + activeBattles.filter((b) => isMyTurn(b, team.id)).length + allyAsks + (isLeader ? visitsDue.length : 0);
  const rejectedTasks = ourTasks.filter((tk) => tk.status === "REJECTED");
  const myTurnBattles = activeBattles.filter((b) => isMyTurn(b, team.id));
  const menuCounts: Partial<Record<MenuView, number>> = { attention, deeds: ourTasks.length, battles: activeBattles.length, standings: incoming.length + peaceOffers.length, awards: Math.max(0, awardsTotal - awardsSeen) };
  /** На компьютере (решение владельца 05.10, вечер): плитки разделов висят над картой, панель открыта только пока выбран раздел; «home» — панель закрыта. */
  const view: MenuView = menuView;
  const toggleView = (key: MenuView) => setMenuView((v) => (wide && v === key ? "home" : key));

  const onTouchStart = (e: React.TouchEvent) => {
    if (wide) return;
    // Полоса, которая сама листается вбок (чипы команд в «Наградах», вкладки), свайп не отдаёт панели (владелец 29.10:
    // «двигаю табы команд в наградах — закрывается вкладка и выходит на карту»).
    for (let el = e.target as HTMLElement | null; el && el !== e.currentTarget; el = el.parentElement) {
      if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) { swipe.current = null; return; }
    }
    const tp = e.touches[0]!;
    swipe.current = { x: tp.clientX, y: tp.clientY, edge: false };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const st = swipe.current; swipe.current = null;
    if (!st || wide) return;
    const tp = e.changedTouches[0]!;
    const dx = tp.clientX - st.x, dy = tp.clientY - st.y;
    if (Math.abs(dy) > Math.abs(dx)) return;
    if (menuView !== "home" && dx < -60) closeMenu();
  };
  async function pave(taskId: string) {
    const ok = await confirm(t("Потратить один тёсаный камень: сторона откроется как пройденная, дело делать не нужно. Камней у команды: {n}.", { n: map?.team.stones ?? 0 }), { title: t("Вымостить дорогу?"), okLabel: t("Вымостить") });
    if (!ok) return;
    if (await act(`/api/games/${id}/edge-tasks/${taskId}/pave`)) { notify(t("Дорога вымощена: перекрёсток открыт")); setSelectedId(null); }
  }
  const openCity = (key: string) => { setCityKey(key); setSelectedId(null); setFrontierKey(null); setMenu(false); };
  const openTask = (tid: string | null) => { setSelectedId(tid); setBackTo(null); if (tid) { setMenu(false); setFrontierKey(null); } };
  const showOnMap = (tid: string) => {
    const from = !wide && menu ? { view: menuView, top: sideRef.current?.scrollTop ?? 0, bodyTop: sideBodyRef.current?.scrollTop ?? 0 } : null;
    openTask(tid);
    setBackTo(from);
    setFocusTask({ id: tid, nonce: Date.now() });
  };
  const closeTask = () => {
    setSelectedId(null);
    if (!backTo) return;
    setMenuView(backTo.view); setMenu(true); setRestore({ top: backTo.top, bodyTop: backTo.bodyTop }); setBackTo(null);
  };
  // Телефон по схеме администратора (решение владельца 29.10): бокового меню нет, разделы открываются из дока внизу
  // листом над картой; стрелка слева вверху ведёт в «Мои игры». Состояние `menu` осталось для совместимости вызовов.
  const menuOpen = !storm.active && menuView !== "home";
  const closeMenu = () => setMenuView("home");
  // Порядок плиток дока (решение владельца 30.10, слева направо): испытания, внимание, служение, команды, летопись, дела.
  const DOCK_ORDER: MenuView[] = ["battles", "attention", "service", "standings", "feed", "deeds"];
  const dockItems = DOCK_ORDER.map((k) => MENU_ITEMS.find((m) => m.key === k)!);

  return (
    <div className="map-screen" ref={screenRef} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {menuOpen && !wide && <div className="side-backdrop" onClick={closeMenu} />}
      {/* На компьютере (решение владельца 05.10, вечер): колонка плиток висит полупрозрачно над картой; нажатие открывает панель
          раздела рядом, повторное нажатие на ту же плитку или нажатие на карту закрывает её. */}
      {wide && !storm.active && (
        <nav className="menu-rail floating" aria-label={t("Разделы")}>
          {MENU_ITEMS.map((m) => { const n = menuCounts[m.key] ?? 0; return (
            <button key={m.key} type="button" className={view === m.key ? "on" : undefined} aria-pressed={view === m.key} onClick={() => toggleView(m.key)}>
              <Icon name={m.icon} />{m.label()}{n > 0 && <span className={"count-chip" + (m.hot ? " hot" : "")}>{n}</span>}
            </button>
          ); })}
          <span className="rail-gap" />
          <Link to="/"><Icon name="home" />{t("Мои игры")}</Link>
          <Link to="/account"><Icon name="user" />{t("Аккаунт")}</Link>
          <Link to="/how-to-play"><Icon name="help" />{t("Как играть")}</Link>
          <Link to="/whats-new"><Icon name="sparkle" />{t("Что нового")}</Link>
          <button type="button" onClick={() => void logout()}><Icon name="logout" />{t("Выйти")}</button>
        </nav>
      )}
      {menuOpen && (
        <aside ref={sideRef} className={"side-menu" + (wide ? " with-rail" : "")} role={wide ? undefined : "dialog"} aria-modal={wide ? undefined : true} aria-label={t("Меню команды")}>
          <div className="side-body" ref={sideBodyRef}>
          {/* Шапка команды и заголовок раздела прилипают вместе одним блоком (решение владельца 24.10: «листаю список внизу, а заголовок и подзаголовок видны так же, как до того»). */}
          <div className="side-top">
          <div className="side-head" style={{ ["--team" as string]: team.color }}>
            <TeamAvatar name={team.name} color={team.color} avatarId={team.avatarId} size="lg" teamId={team.id} />
            <div className="grow"><div className="side-name">{team.name}</div>{isCaptain && <div className="muted small">{t("вы капитан")}</div>}</div>
            {(map?.team.stones ?? 0) > 0 && <button type="button" className="chip-btn" title={t("Тёсаные камни Каменоломни: один камень мостит одну дорогу")} aria-label={t("Камней: {n}", { n: map?.team.stones ?? 0 })} onClick={() => { setQuarryOpen(true); setMenu(false); }}><Chip tone="accent" icon="stone">{map?.team.stones}</Chip></button>}
            <button type="button" className="ghost icon" onClick={closeMenu} aria-label={t("Закрыть")}><Icon name="x" /></button>
          </div>

          {view !== "home" && (
            <div className="menu-sub">
              <h2><Icon name={MENU_ITEMS.find((m) => m.key === view)?.icon ?? "map"} />{MENU_ITEMS.find((m) => m.key === view)?.label()}</h2>
            </div>
          )}
          </div>
          {view === "attention" && (
            rejectedTasks.length > 0 || incoming.length > 0 || peaceOffers.length > 0 || myTurnBattles.length > 0 || visitsDue.length > 0 ? (
                <section className="section attention">
                  <ul className="list interactive">
                    {rejectedTasks.map((tk) => (
                      <li key={tk.id} role="button" tabIndex={0} onClick={() => showOnMap(tk.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showOnMap(tk.id); } }}>
                        <div className="main"><span className="title">{t("Дело возвращено: {title}", { title: tk.deed.title })}</span>{tk.adminComment && <span className="meta">{tk.adminComment}</span>}</div><Icon name="chevron" className="chev" />
                      </li>
                    ))}
                    {incoming.map((r) => (
                      <li key={r.id} role="button" tabIndex={0} onClick={() => setMenuView("standings")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setMenuView("standings"); } }}>
                        <div className="main"><span className="title">{t("Запрос прохода через {book}", { book: r.bookName })}</span><span className="meta">{t("от команды «{team}»", { team: r.requester.name })}</span></div><Icon name="chevron" className="chev" />
                      </li>
                    ))}
                    {peaceOffers.map((p) => (
                      <li key={p.team.id} role="button" tabIndex={0} onClick={() => setMenuView("standings")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setMenuView("standings"); } }}>
                        <div className="main"><span className="title">{t("Команда «{team}» предлагает мир", { team: p.team.name })}</span></div><Icon name="chevron" className="chev" />
                      </li>
                    ))}
                    {myTurnBattles.map((b) => (
                      <li key={b.id} role="button" tabIndex={0} onClick={() => openCity(b.nodeKey)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCity(b.nodeKey); } }}>
                        <div className="main"><span className="title">{t("Испытание · {city}", { city: bookName(b.bookCode) })}</span><span className="meta">{t("ваш ход")}</span></div><Icon name="chevron" className="chev" />
                      </li>
                    ))}
                    {visitsDue.map((v) => (
                      <li key={v.id} role="button" tabIndex={0} onClick={() => openCity(v.nodeKey)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCity(v.nodeKey); } }}>
                        <div className="main"><span className="title">{t("Отчёт о визите · {city}", { city: bookName(v.bookCode) })}</span><span className="meta">{t("сдать до {time}", { time: fmtDate(v.dueAt) })}</span></div><Icon name="chevron" className="chev" />
                      </li>
                    ))}
                  </ul>
                </section>
            ) : <section className="section"><EmptyState inline icon="bell" text={t("Ничего не требует внимания.")} /></section>
          )}
          {menuView === "deeds" && (
            <section className="section">
            {ourTasks.length === 0 && freeTasks.length === 0 ? <EmptyState inline icon="scroll" text={t("Возьмите дело: нажмите метку на карте.")} /> : (
              <ul className="list interactive">
                {ourTasks.map((tk) => { const st = deedStatus(tk.status); return (
                  <li key={tk.id} role="button" tabIndex={0} onClick={() => showOnMap(tk.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showOnMap(tk.id); } }}>
                    <div className="main"><span className="title">{tk.deed.title}</span><span className="meta">{[tk.person ? t("кому: {name}", { name: tk.person.name }) : "", tk.status === "REJECTED" && tk.adminComment ? tk.adminComment : ""].filter(Boolean).join(" · ")}</span></div>
                    {/* Под состоянием — кто взял дело (просьба участников 03.10: видно, у кого дело в работе). */}
                    <div className="side col"><Chip tone={st.tone} icon={st.icon}>{st.label}</Chip>{tk.takenById && tk.status !== "APPROVED" && <span className="muted small taker">{memberName(tk.takenById)}</span>}</div>
                  </li>
                ); })}
              </ul>
            )}
            {freeTasks.length > 0 && (<>
              <h3 className="list-title mt-2"><Icon name="scroll" />{t("Свободные на карте")}<span className="count">{freeTasks.length}</span></h3>
              {error && <p className="error" role="alert">{error}</p>}
              {limitFull(map) && <p className="hint">{t("В сутки можно взять не больше {n} дел. Следующее — через {when}.", { n: map.deedLimit?.max ?? 0, when: untilText(map.deedLimit?.nextAt ?? Date.now()) })}</p>}
              {map.deedsFrozenUntil && <p className="hint"><Icon name="lock" />{t("Администратор закрыл вам взятие дел до {date}", { date: fmtDate(map.deedsFrozenUntil, { time: false }) })}{map.deedsFrozenReason ? ` · ${map.deedsFrozenReason}` : ""}</p>}
              <ul className="list interactive">
                {freeTasks.map((tk) => (
                  <li key={tk.id} role="button" tabIndex={0} onClick={() => showOnMap(tk.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showOnMap(tk.id); } }}>
                    <div className="main"><span className="title">{tk.deed.title}</span><span className="meta">{tk.person ? t("кому: {name}", { name: tk.person.name }) : ""}</span></div>
                    {/* Ночью «Взять» не висит с текстом над списком, а по нажатию показывает подсказку окошком (решение владельца 24.10). */}
                    {/* Корабельное дело — маленький значок корабля на углу кнопки «Взять», как звезда заместителя на значке роли (решение владельца 24.10), без слова. */}
                    <div className="side" onClick={(e) => e.stopPropagation()}><span className="take-slot">{tk.sea && <span className="sea-badge" title={t("корабль")} aria-label={t("корабль")}><Icon name="ship" /></span>}{!canTakeNow
                      ? <HelpPopup name={t("Взять")} buttonClassName="sm" trigger={<><Icon name="scroll" />{t("Взять")}</>}><p><Icon name="moon" /> {t("Ночь: дела ждут утра. С 7:00 по местному времени дело можно взять, сдать или разведать.")}</p></HelpPopup>
                      : <button type="button" className="sm" disabled={busy || limitFull(map) || Boolean(map.deedsFrozenUntil)} onClick={(e) => { e.stopPropagation(); void act(`/api/games/${id}/edge-tasks/${tk.id}/take`).then((ok) => { if (ok) notify(t("Дело взято")); }); }}><Icon name="scroll" />{t("Взять")}</button>}</span></div>
                  </li>
                ))}
              </ul>
            </>)}
            </section>
          )}
          {menuView === "battles" && (
            <section className="section">
            {activeBattles.length === 0 ? <EmptyState inline icon="wave" text={t("Сейчас испытаний нет.")} /> : (
              <ul className="list interactive">
                {activeBattles.map((b) => {
                  const attacker = b.attacker.id === team.id;
                  const deadline = b.status === "ATTACK" ? b.attackDeadline : b.status === "DEFENSE" ? b.defenseDeadline : null;
                  // Союзник хранителей: до чужого города команда могла не дойти, поэтому карточка испытания — прямо здесь.
                  if (b.myAlliance && !attacker && b.defender.id !== team.id) return <li key={b.id} className="plain"><BattleCard gameId={id} b={b} teamId={team.id} isCaptain={isCaptain || me?.role === "DEPUTY"} canAlly={isLeader || me?.gameRole === "AMBASSADOR"} now={now} daytime={map.daytime} onChanged={() => void loadBattles()} /></li>;
                  return (
                    <li key={b.id} role="button" tabIndex={0} onClick={() => openCity(b.nodeKey)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCity(b.nodeKey); } }}>
                      <div className="main">
                        <span className="title">{t("Испытание · {city}", { city: bookName(b.bookCode) })}</span>
                        <span className="meta">{attacker ? t("Вы — претенденты") : t("Вы — хранители")}{deadline ? ` · ${t("осталось {t}", { t: leftText(deadline, now) })}` : ""}{isMyTurn(b, team.id) ? ` · ${t("ваш ход")}` : ""}</span>
                      </div>
                      <Chip tone={battleTone(b.status, attacker)}>{BATTLE_STATUS[b.status]}</Chip>
                    </li>
                  );
                })}
              </ul>
            )}
          
            </section>
          )}
          {menuView === "standings" && (
            <section className="section">
            <StandingsList standings={standings} teamId={team.id} open={openStanding} setOpen={setOpenStanding} peace={peace} onPeace={(p, a) => void onPeace(p, a)} onTrade={canTrade ? (tid) => setTradeFor({ teamId: tid, nonce: Date.now() }) : undefined} roster={<Roster avatarEditor={avatarEditor} onShowOnMap={showOnMap} embedded team={team} isCaptain={isCaptain} onRole={setGameRole} onDeputy={setDeputy} onInvite={isCaptain ? () => void inviteCopy() : undefined} inviteBusy={inviteBusy} inviteDone={inviteDone} inviteUrl={inviteUrl} />} />

            {peaceOffer && (
              <Sheet size="sm" title={t("Предложить мир команде «{team}»", { team: peaceOffer.team.name })} onClose={() => setPeaceOffer(null)}>
                <p className="hint">{t("Пока мир действует, команды не бросают вызов городам друг друга и не объявляют осад. Расторгнуть мир раньше срока нельзя.")}</p>
                <form className="peace-terms" onSubmit={(e) => { e.preventDefault(); if (peaceDays >= 1 && peaceDays <= 365) void offerPeace(peaceOffer, peaceDays); }}>
                <label htmlFor="peace-days">{t("На сколько дней")}</label>
                <input id="peace-days" type="number" inputMode="numeric" min={1} max={365} value={peaceDays} onChange={(e) => setPeaceDays(Number(e.target.value))} autoFocus />
                <button type="submit" disabled={!(peaceDays >= 1 && peaceDays <= 365)}><Icon name="handshake" />{t("Предложить мир на {n} дн.", { n: peaceDays })}</button>
              </form>
              </Sheet>
            )}
            </section>
          )}
          {menuView === "standings" && <DiplomacyMenu gameId={id} data={passages} onChanged={() => { void loadPassages(); void loadMap(); }} />}
          {menuView === "standings" && me?.gameRole === "AMBASSADOR" && <TradesSection gameId={id} openFor={tradeFor} onCanTrade={setCanTrade} onChanged={() => { void loadMap(); void loadStandings(); }} />}
          {menuView === "feed" && <FeedSection gameId={id} version={feedVersion} onOpenTask={(tid) => { if (map.tasks.some((tk) => tk.id === tid)) showOnMap(tid); else notify(t("Дело уже не на карте"), "info"); }} />}
          {menuView === "service" && <MyServiceSection gameId={id} version={feedVersion} />}
          {menuView === "awards" && <AwardsSection gameId={id} version={awardsVersion} data={awards} onLoaded={(d) => { setAwards(d); const n = d.team.reduce((a, g) => a + g.count, 0) + d.mine.reduce((a, g) => a + g.count, 0); setAwardsSeen(n); try { localStorage.setItem(`lotw.awards.seen.${id}`, String(n)); } catch { /* ничего */ } }} />}
          </div>
        </aside>
      )}

      <div className={"map-area" + (storm.active ? " storm" : "")} ref={setMapEl} onPointerDownCapture={(e) => {
        // Нажатие по самой карте закрывает панель раздела на компьютере; нажатия внутри листа (дело, город, метка) и по его
        // фону панель не трогают (владелец 25.10: «закрываю дело на крестик — список слева тоже закрывается, так не нужно»).
        if (wide && menuView !== "home" && !(e.target as HTMLElement).closest(".overlay-backdrop")) setMenuView("home");
      }}>
        {storm.active ? (
          /* Шторм: карта без действий — ни дел, ни городов, ни меток, ни высадки (решение владельца 24.10). Единственная кнопка — назад в «Мои игры». */
          <>
            <TeamMap map={map} bird={bird} teamIndex={team.index} selectedTaskId={null} onSelect={() => {}} onSelectCity={() => {}} storm={storm} />
            <Link to="/" className="secondary icon hud-btn storm-back" aria-label={t("Мои игры")} title={t("Мои игры")}><Icon name="back" /></Link>
          </>
        ) : (
        <TeamMap map={shownMap ?? map} bird={historyAt ? null : bird} teamIndex={team.index} selectedTaskId={selectedId} onSelect={openTask} onSelectCity={openCity} focusTask={focusTask} storm={storm}
          landing={landingTask ? { taskId: landingTask.id, candidates: landingTask.candidates ?? [] } : null} onLand={(key) => void land(key)}
          onMark={(at) => { setMarkAt(at); setMarkNote(""); }} onMarkTap={tapMark} onAwards={() => { setMenu(true); setMenuView("awards"); setSelectedId(null); }}
          onFrontierTap={/* серые точки края тумана видит только разведчик (решение владельца 05.10): остальным они не нужны и мешают */ me?.gameRole === "SCOUT" ? (key) => { setFrontierKey(key); setSelectedId(null); setMenu(false); } : undefined}
          onSelectQuarry={() => { setQuarryOpen(true); setSelectedId(null); setCityKey(null); setFrontierKey(null); setMenu(false); }} scout={scout} />
        )}
        {quarryOpen && <QuarrySheet gameId={id} container={mapEl} onClose={() => setQuarryOpen(false)} />}
        {!wide && (
          <nav className="admin-dock team-dock" aria-label={t("Разделы")}>
            {dockItems.map((m) => { const n = menuCounts[m.key] ?? 0; return (
              <button key={m.key} type="button" className={"dock-btn" + (menuView === m.key ? " on" : "")} aria-pressed={menuView === m.key} onClick={() => { setSelectedId(null); setMenuView((v) => (v === m.key ? "home" : m.key)); }}>
                <Icon name={m.icon} /><span className="lbl">{(m.short ?? m.label)()}</span>
                {n > 0 && <span className={"badge" + (m.hot ? " hot" : "")}>{n}</span>}
              </button>
            ); })}
          </nav>
        )}
        {map.startedAt && <div className="team-timeline"><TimelineDock moves={moves} startedAt={map.startedAt} at={historyAt} onChange={(d) => { setHistoryAt(d); setSelectedId(null); }} /></div>}
        {landingTask && (
          <div className="finish-banner landing-banner" role="status">
            <Icon name="ship" /><span>{canLand ? t("Выберите береговой узел другого острова: где там город, заранее не видно") : t("Кормчий выбирает место высадки")}</span>
            <button type="button" className="ghost sm" onClick={() => setLandingId(null)}>{t("Позже")}</button>
          </div>
        )}
        <div className="hud-left">
          {!wide && <Link to="/" className="btn secondary icon hud-btn" aria-label={t("Мои игры")} title={t("Мои игры")}><Icon name="back" /></Link>}
          <button type="button" className="hud-team" aria-label={team.name}>
            <TeamAvatar name={team.name} color={team.color} avatarId={team.avatarId} /><span className="name">{team.name}</span>
          </button>
          {/* Время суток (решение владельца 03.10): ночью только карта, утром отправляют вызов — подсказка у названия команды. */}
          {phase === "night" && <span className="hud-tod night" title={t("Ночь: города спят, дела и испытания ждут утра")}><Icon name="moon" />{t("Ночь до 7:00")}</span>}
          {phase === "morning" && <span className="hud-tod morning" title={t("Утро: вызов на город отправляют на проверку до 9:00")}><Icon name="sun" />{t("Утро до 9:00")}</span>}
        </div>
        {/* Серия дней (решение владельца 29.10): плашка при заходе раз в игровые сутки; в день рубежа — праздник со значком. */}
        {streakShow && awards && !milestone && !selectedId && <StreakBanner streak={awards.streak} onOpen={() => { closeStreak(); setMenu(true); setMenuView("awards"); }} onClose={closeStreak} />}
        {milestone && <MilestoneCard code={milestone} onOpen={() => { closeMilestone(); setMenu(true); setMenuView("awards"); }} onClose={closeMilestone} />}
        {standings?.status === "FINISHED" && (
          <div className="finish-banner" role="status"><Icon name="trophy" /><span>{winner ? t("Игра завершена: победила «{team}»", { team: winner }) : t("Игра завершена")}</span></div>
        )}

        {markAt && (
          <Sheet size="sm" container={mapEl} title={t("Метка на карте")} onClose={() => setMarkAt(null)} foot={<><button type="button" className="ghost" onClick={() => setMarkAt(null)}>{t("Отмена")}</button><button type="button" disabled={busy} onClick={() => void putMark()}><Icon name="pin" />{t("Поставить")}</button></>}>
            <p className="muted">{t("Метку увидят все в команде, с вашим именем. Изменить подпись или убрать её сможете только вы, нажатием на флажок.")}</p>
            <div className="field"><label htmlFor="mark-note">{t("Подпись")} <span className="opt">{t("необязательно")}</span></label><input id="mark-note" maxLength={40} value={markNote} onChange={(e) => setMarkNote(e.target.value)} placeholder={t("птицы сели здесь")} /></div>
          </Sheet>
        )}
        {editMark && (
          <Sheet size="sm" container={mapEl} title={t("Метка на карте")} onClose={() => setEditMark(null)} foot={<><button type="button" className="secondary" disabled={busy} onClick={() => { const mk = editMark; setEditMark(null); void removeMark(mk); }}><Icon name="trash" />{t("Убрать")}</button><button type="button" disabled={busy} onClick={() => void saveMark()}><Icon name="check" />{t("Сохранить")}</button></>}>
            <p className="muted">{editMark.createdAt ? t("Ваша метка, поставлена {when}.", { when: fmtDate(editMark.createdAt) }) : t("Ваша метка.")}</p>
            <div className="field"><label htmlFor="mark-edit-note">{t("Подпись")} <span className="opt">{t("необязательно")}</span></label><input id="mark-edit-note" maxLength={40} value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder={t("птицы сели здесь")} /></div>
          </Sheet>
        )}
        {frontierKey && (() => {
          const pk = peekedKind(frontierKey);
          return (
            <Sheet size="sm" container={mapEl} title={t("Край тумана")} onClose={() => setFrontierKey(null)}>
              <p className="muted">{t("Дороги с делом сюда пока нет.")}</p>
              {pk && <div className="note info"><Icon name="telescope" /><span>{pk === "CITY" ? t("Разведано: там город.") : t("Разведано: там развилка.")}</span></div>}
              {error && <p className="error" role="alert">{error}</p>}
              {phase === "night" && <div className="note info night-note"><Icon name="moon" /><span>{t("Ночь: разведка ждёт утра, с 7:00 по местному времени.")}</span></div>}
              {me?.gameRole === "SCOUT" && !pk && phase !== "night" && <div className="actions"><button type="button" className="secondary" disabled={busy} onClick={() => void peek(frontierKey)}><Icon name="telescope" />{t("Разведать")}</button><Help>{t("раз в неделю")}</Help></div>}
              {me?.gameRole !== "SCOUT" && !pk && <p className="hint">{t("Разведать этот перекрёсток может разведчик команды.")}</p>}
            </Sheet>
          );
        })()}
        {cityKey && <CityPopup gameId={id} nodeKey={cityKey} teamId={team.id} isCaptain={isCaptain || me?.role === "DEPUTY"} canAlly={isLeader || me?.gameRole === "AMBASSADOR"} version={cityVersion} container={mapEl} onClose={() => setCityKey(null)} onChanged={() => { void loadMap(); void loadBattles(); void loadPassages(); }} />}

        {task && (() => {
          const st = deedStatus(task.status);
          const proof = PROOF[task.deed.proofType];
          const taker = task.takenById ? memberName(task.takenById) : "";
          const peeked = peekedKind(task.toKey);
          // Разведчик открывает любую точку на краю тумана, взято дело на сторону или нет (решение владельца 02.10).
          const canScout = me?.gameRole === "SCOUT" && !peeked && !(map?.revealed ?? []).some((n) => n.key === task.toKey);
          const night = phase === "night";
          // Взять дело можно до полуночи, как и решать задания города (решение владельца 04.10); сдача и разведка — с 7:00.
          const canTake = !night || Boolean(map?.daytime?.tasksOpen);
          const scoutBtn = canScout && !night && <><button type="button" className="secondary" disabled={busy} onClick={() => void peek(task.toKey)}><Icon name="telescope" />{t("Разведать")}</button><Help>{t("раз в неделю")}</Help></>;
          // Порядок листа (решение владельца 18.09): суть → как сдать → состояние → действие → правила (кодекс).
          const mine = Boolean(task.takenById) && task.takenById === user?.id;
          const longDesc = (task.deed.description?.length ?? 0) > 140 && !mine;
          return (
            <Sheet size="sm" container={mapEl} onClose={closeTask} closeLabel={backTo ? t("Назад к списку") : undefined} className="deed-sheet" head={<div className="sheet-title"><h2>{task.deed.title}</h2><Chip tone={st.tone} icon={st.icon}>{st.label}</Chip><button type="button" className="secondary sm icon" aria-label={t("Посмотреть на карте")} title={t("Посмотреть на карте")} onClick={() => { /* Значок карты, как в отчёте у администратора (владелец 25.10): лист закрывается, карта центрируется на стороне дела. */ setBackTo(null); setSelectedId(null); setFocusTask({ id: task.id, nonce: Date.now() }); }}><Icon name="map" /></button></div>}>
              {task.person && <p className="meta-line mt-2 person-line"><Icon name="user" />{t("Кому: {name}", { name: task.person.name })}</p>}
              <p className="meta-line mt-2">
                <Icon name={proof.icon} />{t("Сдать")}: {proof.label()}
                {taker && <> · <Icon name="user" />{t("Взял: {name}", { name: taker })}</>}
                {task.deed.remote && <Chip icon="send">{t("можно издалека")}</Chip>}
                {/* Ценник пожертвования виден до взятия дела (решение владельца 05.10); в форме сдачи он повторяется галочкой. */}
                {task.deed.donationMin && !(task.status === "TAKEN" && !night) ? <><Chip icon="star">{donationText(task.deed.donationMin)}</Chip><Help>{t("Вместо дела можно пожертвовать в кассу церкви не меньше этой суммы: чек — ссылкой.")}</Help></> : null}
                {task.deed.secret && <><Chip icon="lock">{t("тайное")}</Chip><Help>{t("Сдачу видят только вы и проверяющий.")}</Help></>}
                {task.sea && <><Chip icon="ship">{t("корабль")}</Chip><Help>{t("После одобрения кормчий выберет место высадки на любом береговом узле другого острова. Где там город, заранее не видно. Капитан и команда ему советуют.")}</Help></>}
              </p>
              {task.deed.description && <p className={"deed-desc mt-2" + (longDesc && !descOpen ? " clamp" : "")}>{task.deed.description}</p>}
              {longDesc && <button type="button" className="ghost sm desc-more" aria-expanded={descOpen} onClick={() => setDescOpen((v) => !v)}><Icon name={descOpen ? "chevron-up" : "chevron-down"} />{descOpen ? t("Свернуть") : t("Подробнее")}</button>}
              {task.landing && (canLand
                ? <div className="actions"><button type="button" onClick={() => { setLandingId(task.id); setSelectedId(null); }}><Icon name="anchor" />{t("Выбрать место высадки")}</button></div>
                : <div className="note info"><Icon name="anchor" /><span>{t("Дело одобрено: кормчий выбирает место высадки. Капитан и команда ему советуют.")}</span></div>)}
              {/* Сдача дела: кто участвовал, ссылки, текст, даты — видно по нажатию на пройденную сторону (решение владельца 30.09). */}
              {task.submittedAt && task.status !== "OPEN" && task.status !== "TAKEN" && (() => {
                const names = (task.participants ?? []).filter((pid) => pid !== task.takenById).map(memberName).filter(Boolean);
                return (
                  <div className="report-block mt-2">
                    {names.length > 0 && <p className="meta-line"><Icon name="users" />{t("Участвовали: {names}", { names: names.join(", ") })}</p>}
                    <p className="meta-line small muted"><Icon name="clock" />{t("Сдано")}: {fmtDate(task.submittedAt)}{task.status === "APPROVED" && task.decidedAt && <> · {t("Одобрено")}: {fmtDate(task.decidedAt)}</>}</p>
                    {task.links.length > 0 && <ul className="links">{task.links.map((l) => <li key={l}><a href={l} target="_blank" rel="noreferrer">{l}</a></li>)}</ul>}
                    {task.note && <p className="report-text">{task.note}</p>}
                  </div>
                );
              })()}
              {task.status === "REJECTED" && <div className="note bad"><Icon name="alert" /><span>{task.adminComment ? t("Администратор вернул дело: «{comment}». Исправьте и сдайте снова.", { comment: task.adminComment }) : t("Администратор вернул дело. Исправьте и сдайте снова.")}</span></div>}
              {task.status === "SUBMITTED" && <div className="note info"><Icon name="clock" /><span>{t("На проверке у администратора.")}</span></div>}
              {peeked && <div className="note info"><Icon name="telescope" /><span>{peeked === "CITY" ? t("Разведано: там город.") : t("Разведано: там развилка.")}</span></div>}
              {error && <p className="error" role="alert">{error}</p>}
              {night && !canTake && task.status !== "APPROVED" && task.status !== "SUBMITTED" && <div className="note info night-note"><Icon name="moon" /><span>{t("Ночь: дела ждут утра. С 7:00 по местному времени дело можно взять, сдать или разведать.")}</span></div>}
              {night && canTake && (task.status === "OPEN" || task.status === "REJECTED") && <div className="note info night-note"><Icon name="moon" /><span>{t("До 0:00 дело можно взять; сдать и разведать — с 7:00 по местному времени.")}</span></div>}
              {night && canTake && task.status === "TAKEN" && <div className="note info night-note"><Icon name="moon" /><span>{t("Ночь: сдать дело можно с 7:00 по местному времени.")}</span></div>}
              {canTake && (task.status === "OPEN" || task.status === "REJECTED") && (
                <div className="actions">
                  <button type="button" disabled={busy || limitFull(map) || Boolean(map?.deedsFrozenUntil)} onClick={() => void act(`/api/games/${id}/edge-tasks/${task.id}/take`)}><Icon name="scroll" />{t("Взять дело")}</button>
                  {/* Каменоломня (решение владельца 04.10): камень мостит свободную сухопутную сторону — капитан, заместитель или летописец. */}
                  {task.status === "OPEN" && !task.sea && (map?.team.stones ?? 0) > 0 && (isCaptain || me?.role === "DEPUTY" || me?.gameRole === "CHRONICLER") && (
                    <button type="button" className="secondary" disabled={busy} onClick={() => void pave(task.id)}><Icon name="stone" />{t("Вымостить дорогу")}<span className="count-chip">{map?.team.stones}</span></button>
                  )}
                  {limitFull(map) && <p className="hint">{t("В сутки можно взять не больше {n} дел. Следующее — через {when}.", { n: map?.deedLimit?.max ?? 0, when: untilText(map?.deedLimit?.nextAt ?? Date.now()) })}</p>}
                  {map?.deedsFrozenUntil && <p className="hint"><Icon name="lock" />{t("Администратор закрыл вам взятие дел до {date}", { date: fmtDate(map.deedsFrozenUntil, { time: false }) })}{map.deedsFrozenReason ? ` · ${map.deedsFrozenReason}` : ""}</p>}
                  {scoutBtn}
                </div>
              )}
              {task.status !== "OPEN" && task.status !== "REJECTED" && scoutBtn && <div className="actions">{scoutBtn}</div>}
              {/* Форма сдачи только у взявшего, капитана, заместителя и летописца (замечание владельца 10.10: остальные видели чужую сдачу). */}
              {!night && task.status === "TAKEN" && !mine && !isLeader && me?.gameRole !== "CHRONICLER" && (
                <p className="hint"><Icon name="user" />{t("Дело у другого участника: сдать или отказаться может тот, кто взял, капитан, заместитель или летописец.")}</p>
              )}
              {!night && task.status === "TAKEN" && (mine || isLeader || me?.gameRole === "CHRONICLER") && (
                <DeedForm key={task.id} donationCfg={task.deed.donationMin ? { min: task.deed.donationMin, currency } : null} busy={busy} proofType={task.deed.proofType}
                  members={(team.members ?? []).filter((mm) => mm.user.id !== (task.takenById ?? user?.id)).map((mm) => ({ id: mm.user.id, name: mm.user.displayName ?? mm.user.nickname }))}
                  main={isLeader || me?.gameRole === "CHRONICLER" ? { options: (team.members ?? []).map((mm) => ({ id: mm.user.id, name: mm.user.displayName ?? mm.user.nickname })), initial: task.takenById ?? user?.id ?? "" } : undefined}
                  onSubmit={(body) => act(`/api/games/${id}/edge-tasks/${task.id}/submit`, body).then((ok) => { if (ok) notify(t("Сдано на проверку")); return ok; })}
                  onRelease={() => void release(task)} />
              )}
              <details className="disclose sm codex">
                <summary><Icon name="info" />{t("Кодекс дела")}<Icon name="chevron-down" className="chev" /></summary>
                <ol className="small muted">{CODEX(task.deed).map((c, i) => <li key={i}>{c}</li>)}</ol>
              </details>
            </Sheet>
          );
        })()}
      </div>
    </div>
  );
}

/**
 * Форма сдачи дела. Живёт под key=task.id: у каждого дела свой набранный текст. Отчёт — три вопроса вместо «сделано»
 * (решение владельца 18.09); участники дела группой отмечаются галочками, каждому засчитывается в личное служение.
 */
function DeedForm({ donationCfg, busy, proofType, members, main, onSubmit, onRelease }: { /** На кого записать дело (решение владельца 22.10): капитан, заместитель и летописец выбирают основного из состава; у остальных поля нет. */ main?: { options: Array<{ id: string; name: string }>; initial: string }; donationCfg: { min: number; currency: string } | null; busy: boolean; proofType: EdgeTaskDto["deed"]["proofType"]; members: Array<{ id: string; name: string }>; onSubmit: (body: { links: string[]; note: string; donation: boolean; donationAmount?: number; participants: string[]; mainId?: string }) => Promise<boolean>; onRelease: () => void }) {
  const [links, setLinks] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [q, setQ] = useState({ what: "", who: "" });
  const [donation, setDonation] = useState(false);
  const [amount, setAmount] = useState("");
  const [participants, setParticipants] = useState<string[]>([]);
  const [mainId, setMainId] = useState(main?.initial ?? "");
  const others = main ? main.options.filter((m) => m.id !== mainId) : members;
  const [witness, setWitness] = useState("");
  const report = proofType === "REPORT" && !donation;
  // Свидетель (решение владельца 04.10): дело подтверждает человек, который это видел; ссылки не нужны.
  const byWitness = proofType === "WITNESS" && !donation;
  const noteOut = report ? [q.what && `${t("Что сделал")}: ${q.what}`, q.who && `${t("Кому и как")}: ${q.who}`].filter(Boolean).join("\n")
    : byWitness ? [witness.trim() && `${t("Свидетель")}: ${witness.trim()}`, note.trim()].filter(Boolean).join("\n") : note;
  return (
    <>
      {donationCfg && <div className="row nowrap mt-2"><label className="check grow"><input type="checkbox" checked={donation} onChange={(e) => setDonation(e.target.checked)} />{t("Вместо дела — пожертвование (от {min} {cur})", { min: donationCfg.min, cur: donationCfg.currency })}</label><Help>{t("В кассу церкви. Сдаётся ссылка на чек или подтверждение перевода.")}</Help></div>}
      {donation && donationCfg && (
        <div className="field">
          <label htmlFor="deed-amount">{t("Сумма")}, {donationCfg.currency}</label>
          <input id="deed-amount" type="number" inputMode="numeric" min={donationCfg.min} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
      )}
      {byWitness && (
        <div className="field">
          <label htmlFor="deed-witness">{t("Кто может подтвердить")} <span className="opt">{t("свидетель: кто это видел или слышал")}</span></label>
          <input id="deed-witness" value={witness} onChange={(e) => setWitness(e.target.value)} maxLength={120} placeholder={t("имя и кто это, например служитель")} />
        </div>
      )}
      {main && (
        <div className="field">
          <label htmlFor="deed-main">{t("На кого записать дело")} <span className="opt">{t("кто делал: идёт в его лимит")}</span></label>
          <select id="deed-main" value={mainId} onChange={(e) => { setMainId(e.target.value); setParticipants((p) => p.filter((x) => x !== e.target.value)); }}>
            {main.options.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
      )}
      {/* Ссылки слева, участники справа — в один ряд (решение владельца 16.10: «не этажерка»). */}
      {(!byWitness || others.length > 0) && (
        <div className={"deed-pair" + (!byWitness && others.length > 0 ? " two" : "")}>
          {!byWitness && (
            <LinksField label={donation ? t("Ссылка на чек или подтверждение перевода") : proofType === "AUDIO_LINK" ? t("Ссылка на аудиозапись чтения целиком") : t("Ссылки на фото или видео")} links={links} onChange={setLinks} />
          )}
          {others.length > 0 && (
            <div className="field">
              <label className="label" htmlFor="deed-people">{t("Кто ещё участвовал")} <span className="opt">{donation ? t("если жертвовали вместе") : t("если делали группой")}</span></label>
              <PeoplePicker id="deed-people" people={others} value={participants} onChange={setParticipants} empty={t("никого: делал один")} />
            </div>
          )}
        </div>
      )}
      {report ? (
        <>
          <div className="field"><label htmlFor="deed-q1">{t("Что сделал?")}</label><textarea id="deed-q1" rows={2} value={q.what} onChange={(e) => setQ({ ...q, what: e.target.value })} /></div>
          <div className="field"><label htmlFor="deed-q2">{t("Кому и как?")}</label><textarea id="deed-q2" rows={2} value={q.who} onChange={(e) => setQ({ ...q, who: e.target.value })} /></div>
        </>
      ) : (
        <div className="field">
          <label htmlFor="deed-note">{donation ? t("Комментарий") : t("Что сделали")}</label>
          <textarea id="deed-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}
      {/* «Отказаться» слева, «Сдать» справа, в один ряд (решение владельца 16.10). */}
      <div className="actions deed-actions">
        <button type="button" className="secondary" disabled={busy} onClick={onRelease}>{t("Отказаться от дела")}</button>
        <button type="button" disabled={busy || (donation && !amount) || (byWitness && !witness.trim())} onClick={() => void onSubmit({ links, note: noteOut, donation, donationAmount: donation ? Number(amount) : undefined, participants, mainId: main ? mainId : undefined })}><Icon name="send" />{donation ? t("Сдать пожертвование") : t("Сдать на проверку")}</button>
      </div>
    </>
  );
}

/** Состав команды: роль — пилюля с объяснением по нажатию; капитан назначает роли выбором. */
/** embedded — внутри строки таблицы команд: без заголовка (численность — значком в строке команды, решение владельца 24.10), только кнопка приглашения. */
function Roster({ team, isCaptain, onRole, onDeputy, embedded = false, onInvite, inviteBusy, inviteDone, inviteUrl, onShowOnMap, avatarEditor }: { /** Блок «фото команды» капитана над составом (решение владельца 24.10). */ avatarEditor?: ReactNode; /** «Посмотреть на карте» у дела на руках участника (просьба владельца 10.10). */ onShowOnMap?: (taskId: string) => void; team: TeamDto; isCaptain: boolean; onRole: (userId: string, role: GameRole) => void; onDeputy: (userId: string, on: boolean) => void; embedded?: boolean; /** Капитан: кнопка «Пригласить участника» кладёт ссылку в буфер (решение владельца 22.09). */ onInvite?: () => void; inviteBusy?: boolean; inviteDone?: boolean; inviteUrl?: string | null }) {
  // Таймеры «следующее дело через…» тикают раз в полминуты.
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(i); }, []);
  const [open, setOpen] = useState<string | null>(null);
  /** Кому раскрыт ряд ролей (вариант 1, решение владельца 23.09): выбор пилюлей назначает роль сразу, повторное нажатие снимает. */
  const [pick, setPick] = useState<string | null>(null);
  // Лимит смены роли — на каждого участника (решение владельца 19.10): в подсказке перечислены те, кому роль пока не сменить.
  const GAME_ROLES = (Object.keys(ROLE).filter((k) => k !== "CAPTAIN" && k !== "DEPUTY" && k !== "NONE") as GameRole[]);
  const invite = onInvite && <button type="button" className="secondary sm roster-invite" disabled={inviteBusy} title={t("Скопировать ссылку для участников")} onClick={onInvite}><Icon name={inviteDone ? "check" : "link"} />{t("Пригласить участника")}</button>;
  return (
    <>
      {embedded
        ? (invite ? <div className="meta roster-head">{invite}</div> : null)
        : <div className="roster-title"><h2><Icon name="users" />{team.name}<span className="count">{team.members.length}</span></h2>{invite}</div>}
      {inviteUrl && <p className="hint invite-fallback"><a href={inviteUrl}>{inviteUrl}</a></p>}
      {avatarEditor}
      <ul className="list roster">
        {team.members.map((m) => {
          const name = m.user.displayName ?? m.user.nickname;
          const roleKey: GameRole | "CAPTAIN" | "DEPUTY" = m.role === "CAPTAIN" ? "CAPTAIN" : m.role === "DEPUTY" && m.gameRole === "NONE" ? "DEPUTY" : m.gameRole;
          const r = ROLE[roleKey];
          const shown = open === m.user.id;
          const canEdit = m.role !== "CAPTAIN" && isCaptain;
          const picking = canEdit && pick === m.user.id;
          return (
            <li key={m.user.id} className={picking ? "picking" : undefined}>
              <div className="main">
                <div className="person"><UserAvatar name={name} avatarId={m.user.avatarId} userId={m.user.id} /><span className="name">{name}</span></div>
                {shown && r.hint() && <p className="hint">{r.hint()}</p>}
              </div>
              <div className="side">
                {/* Слева только имя; значок лимита дел и роли — справа, только значками (решение владельца 04.10). Название роли — в подсказке
                    и для читалок; нажатие на роль у капитана открывает ряд ролей, у остальных — пояснение роли. */}
                <DeedBadgePopup limit={m.deedLimit} now={now} deeds={m.activeDeeds} frozenUntil={m.deedsFrozenUntil} onShowOnMap={onShowOnMap ? (d) => onShowOnMap(d.id) : undefined} />
                {/* Заместитель — маленькая звезда над значком роли (решение владельца 24.10), без отдельного столбца. */}
                <span className="role-slot">{m.role === "DEPUTY" && m.gameRole !== "NONE" && <span className="deputy-star" title={t("заместитель")}><Icon name="star" /><span className="sr-only">{t("заместитель")}</span></span>}
                {canEdit ? (
                  <button type="button" className={"chip-btn role-pick icon-only" + (m.gameRole === "NONE" ? " none" : "")} aria-label={m.gameRole === "NONE" ? t("без роли") : ROLE[m.gameRole].label()} title={m.gameRole === "NONE" ? t("без роли") : ROLE[m.gameRole].label()} aria-expanded={picking} onClick={() => setPick(picking ? null : m.user.id)}>
                    <Chip tone={m.gameRole === "NONE" ? "neutral" : "info"} icon={m.gameRole === "NONE" ? "user" : ROLE[m.gameRole].icon}><Icon name="chevron" className="chev" /></Chip>
                  </button>
                ) : roleKey !== "NONE" ? (
                  <button type="button" className="chip-btn icon-only" aria-label={r.label()} title={r.label()} aria-expanded={shown} onClick={() => setOpen(shown ? null : m.user.id)}><Chip tone={roleKey === "CAPTAIN" || roleKey === "DEPUTY" ? "accent" : "info"} icon={r.icon}><span className="sr-only">{r.label()}</span></Chip></button>
                ) : null}</span>
              </div>
              {picking && (
                <div className="role-tray" role="group" aria-label={t("Роль: {name}", { name })}>
                  {GAME_ROLES.map((k) => (
                    <button key={k} type="button" className={"role-opt" + (k === m.gameRole ? " on" : "")} aria-pressed={k === m.gameRole} onClick={() => { setPick(null); onRole(m.user.id, k === m.gameRole ? "NONE" : k); }}>
                      <Chip tone={k === m.gameRole ? "solid" : "neutral"} icon={ROLE[k].icon}>{ROLE[k].label()}</Chip>
                      <span className="desc">{ROLE[k].hint()}</span>
                    </button>
                  ))}
                  <button type="button" className={"role-opt" + (m.role === "DEPUTY" ? " on" : "")} aria-pressed={m.role === "DEPUTY"} onClick={() => { setPick(null); onDeputy(m.user.id, m.role !== "DEPUTY"); }}>
                    <Chip tone={m.role === "DEPUTY" ? "solid" : "neutral"} icon="star">{t("заместитель")}</Chip>
                    <span className="desc">{t("Ведёт команду вместе с капитаном: вызовы, ставки, столица, высадка.")}</span>
                  </button>
                  <p className="hint">{t("Нажмите роль — она назначится сразу. Повторное нажатие на выданную роль снимает её.")}</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Лимит дел в сутки исчерпан: кнопка «Взять дело» гаснет, подсказка говорит, когда можно снова. */
const limitFull = (m: { deedLimit?: { max: number; taken: number } | null } | null): boolean => Boolean(m?.deedLimit && m.deedLimit.taken >= m.deedLimit.max);
