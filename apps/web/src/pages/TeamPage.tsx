import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Picker } from "../components/Picker";
import { nodePos } from "../lib/hexmap";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { BOOKS } from "@lotw/domain";
import { api, ApiError, apiReady, deedAssignee, deedPriority, prefetch, ready, type AwardsDto, type BattleDto, type DailyBirdDto, type EdgeTaskDto, type EdgeTaskStatus, type GameRole, type MapMarkDto, type MyMapDto, type PeaceTeamDto, type StandingsDto, type TeamDto } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useCoalesced, useGameEvents, type MapPush } from "../lib/useGameEvents";
import { keepSame, useNow } from "../lib/stable";
import { applyPatch } from "fast-json-patch";
import { TeamMap, type MarkPoint } from "./TeamMap";
import { AwardRating, FlameIcon, MilestoneCard, StreakBanner, TeamAwardsBlock, awardsCached, preloadAllAwardImages, preloadAwardImages } from "./Awards";
import { AWARD_BY_CODE } from "@lotw/domain";
import { previewPhase, useStorm } from "../lib/daytime";
import { TimelineClock } from "./Timeline";
import { mapAt, teamMoves } from "./TeamHistory";
import { CityPopup } from "./CityPopup";
import { QuarrySheet } from "./QuarrySheet";
import { WreckSheet } from "./WreckSheet";
import { BATTLE_STATUS, BattleCard, battleTone, isLaunching, isMyTurn, leftText } from "./BattlePanel";
import { TrialFlow } from "./TrialFlow";
import { type PassagesDto } from "./Diplomacy";
import { TradesSection, TradeProposeSheet } from "./Trades";
import { useUi } from "../lib/ui";
import { useMediaQuery } from "../lib/media";
import { t } from "../lib/i18n";
import { fmtDate, plural, setDisplayTimeZone } from "../lib/format";
import { Icon } from "../components/Icon";
import { LinkList, linkKind } from "../components/LinkList";
import { AutoGrow } from "../components/AutoGrow";
import { LinksField } from "../components/LinksField";
import { PeoplePicker } from "../components/PeoplePicker";
import { Back } from "../components/Back";
import { Chip, type ChipTone } from "../components/Chip";
import { Sheet } from "../components/Sheet";
import { Help, HelpPopup } from "../components/Help";
import { SquareAction } from "../components/SquareAction";
import { ActionMenu, type MenuItem } from "../components/ActionMenu";
import { StatChip } from "../components/StatChip";
import { DeedBadgePopup, untilText } from "../components/DeedBadge";
import { FeedSection, MyServiceSection, ServiceTabs, type ServiceTab } from "./Journal";
import { TeamAvatar } from "../components/TeamAvatar";
import { AvatarLightbox } from "../components/AvatarLightbox";
import { peaceTerm } from "../components/PeaceActions";
import { Tabs } from "../components/Tabs";
import { UserAvatar } from "../components/UserAvatar";
import { EmptyState, ErrorState, LoadingState } from "../components/State";

/** Положение команд (меню и итоги): строка раскрывается, если есть испытания или города на пути. */
/** Таблица команд; у своей команды в раскрытой строке — состав (решение владельца 21.09: один раздел, а не два). */
type PeaceData = { canSpeak: boolean; teams: PeaceTeamDto[] };

function StandingsList({ standings, teamId, open, setOpen, roster, peace }: { standings: StandingsDto | null; teamId: string; open: string | null; setOpen: (v: string) => void; roster?: React.ReactNode; /** Мир: знак напротив каждой чужой команды (решение владельца 21.09); принять или отклонить — в профиле команды (решение владельца 05.11). */ peace?: PeaceData | null }) {
  const stop = { onClick: (e: React.SyntheticEvent) => e.stopPropagation(), onKeyDown: (e: React.SyntheticEvent) => e.stopPropagation() };
  if (!standings) return <LoadingState rows={2} />;
  if (standings.standings.length === 0) return <EmptyState inline icon="crown" text={t("Пока нечего показать.")} />;
  return (
    <ol className="standings-list">
      {standings.standings.map((st, i) => {
        const trials = st.battlesWon + st.battlesRepelled + st.battlesLost;
        const mine = st.teamId === teamId;
        const pc = !mine ? peace?.teams.find((p) => p.team.id === st.teamId) ?? null : null;
        const canPeace = Boolean(peace?.canSpeak && pc && pc.team.status !== "defeated" && st.status !== "defeated");
        // Меню «⋯» напротив чужой команды больше нет: мир, расторжение, принять и отклонить предложение — в профиле команды
        // по нажатию на аватарку (решения владельца 04.11 и 05.11), обмен городами — из карточки своего города (04.11).
        const actions: MenuItem[] = [];
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
type MenuView = "home" | "attention" | "deeds" | "battles" | "standings" | "feed" | "service";
/** Поля ответа карты, которые меняются сами по себе и в сравнении «изменилась ли карта» не участвуют: часы сервера и номер версии. */
const MAP_VOLATILE = ["now", "rev"] as const;
const NOOP = () => {};
/** Секундные часы для одного блока: перерисовывается только он, а не вся страница с картой (ревизия 15.11). */
function WithNow({ children }: { children: (now: number) => ReactNode }) { return <>{children(useNow())}</>; }
/** Колокольчик — такая же плитка, как остальные (просьба участника 05.10): внутри всё, что требует внимания. */
const MENU_ITEMS: Array<{ key: Exclude<MenuView, "home">; icon: string; label: () => string; /** Короткая подпись для плитки дока на телефоне (ширина плитки как у администратора). */ short?: () => string; hot?: boolean }> = [
  { key: "attention", icon: "bell", label: () => t("Внимание"), hot: true },
  { key: "deeds", icon: "scroll", label: () => t("Дела") },
  { key: "battles", icon: "wave", label: () => t("Испытания"), hot: true },
  { key: "standings", icon: "crown", label: () => t("Команды"), hot: true },
  { key: "feed", icon: "feather", label: () => t("Летопись") },
  { key: "service", icon: "user", label: () => t("Моё служение"), short: () => t("Служение") },
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
  SCOUT: { icon: "telescope", label: () => t("Разведчик"), hint: () => t("Раз в неделю может разведать, что за стороной: город или развилка. И раз в неделю, отдельно, — есть ли стена у чужого города.") },
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
  const { user } = useAuth();
  const { notify, confirm } = useUi();
  const wide = useMediaQuery("(min-width: 1024px)");
  // Готовые ответы с главной (решение владельца 24.10): состав и карта рисуются сразу, свежие придут следом.
  type TeamsResp = { isAdmin: boolean; teams: TeamDto[] };
  type MapResp = MyMapDto & { gameName?: string };
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
  // Часы сервера для шторма — время самого ответа (daytime.now): map.now — момент расчёта карты, а она лежит в памяти
  // сервера до минуты, и шторм начинался бы у части игроков с таким же опозданием.
  const storm = useStorm(map?.daytime, map?.daytime?.now ?? map?.now, () => stormReload.current());
  const stormWas = useRef(storm.active);
  // Карта обёрнута в memo и получает обработчики с постоянной «личностью»: сами функции объявлены ниже и создаются заново при
  // каждой отрисовке страницы, а обёртки вызывают их последнюю версию. Так карта перерисовывается только от своих данных,
  // а не от каждой буквы в поле поиска или всплывающего сообщения (ревизия 15.11).
  const mapActs = useRef<{ openTask: (tid: string | null) => void; openCity: (key: string) => void; land: (key: string) => void; mark: (at: MarkPoint) => void; tapMark: (mk: MapMarkDto) => void; frontier: (key: string) => void; quarry: () => void; wreck: (wid: string) => void } | null>(null);
  const mapOn = useMemo(() => ({
    select: (tid: string | null) => mapActs.current?.openTask(tid),
    city: (key: string) => mapActs.current?.openCity(key),
    land: (key: string) => mapActs.current?.land(key),
    mark: (at: MarkPoint) => mapActs.current?.mark(at),
    markTap: (mk: MapMarkDto) => mapActs.current?.tapMark(mk),
    frontier: (key: string) => mapActs.current?.frontier(key),
    quarry: () => mapActs.current?.quarry(),
    wreck: (wid: string) => mapActs.current?.wreck(wid),
  }), []);
  const [error, setError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** «Посмотреть на карте» (просьба владельца 10.10): подвести карту к стороне дела вблизи. Из списков дел и состава команды. */
  const [focusTask, setFocusTask] = useState<{ id: string; nonce: number } | null>(null);
  /** Режим высадки: id одобренного морского дела, для которого капитан выбирает узел на другом острове. */
  const [landingId, setLandingId] = useState<string | null>(null);
  const landingTasks = map?.tasks;
  const landing = useMemo(() => { const tk = landingId ? landingTasks?.find((x) => x.id === landingId && x.landing) : undefined; return tk ? { taskId: tk.id, candidates: tk.candidates ?? [] } : null; }, [landingId, landingTasks]);
  const [menu, setMenu] = useState(false);
  const [cityKey, setCityKey] = useState<string | null>(null);
  /** Каменоломня (решение владельца 04.10): лист общих дел и камней. */
  const [quarryOpen, setQuarryOpen] = useState(false);
  /** Открытый лист разбитого корабля (решение владельца 04.11). */
  const [wreckId, setWreckId] = useState<string | null>(null);
  const [cityVersion, setCityVersion] = useState(0);
  /** Лента, «Моё служение» и мир перезагружаются по событиям журнала, дел, городов и испытаний. */
  const [feedVersion, setFeedVersion] = useState(0);
  // Награды и серия (решение владельца 29.10): сводка нужна и для плашки над картой, и для раздела «Награды».
  const [awards, setAwards] = useState<AwardsDto | null>(() => awardsCached(id));
  const [awardsVersion, setAwardsVersion] = useState(0);
  const [streakShow, setStreakShow] = useState(false);
  /** День только что засчитан (решение владельца 31.10): плашка с вспышкой огонька. */
  const [streakLit, setStreakLit] = useState(false);
  const todayWas = useRef<boolean | null>(null);
  useEffect(() => {
    const now = awards?.streak.today ?? null;
    if (now !== null && todayWas.current === false && now === true) { setStreakLit(true); setStreakShow(true); }
    if (now !== null) todayWas.current = now;
  }, [awards?.streak.today]);
  const [milestone, setMilestone] = useState<string | null>(null);
  // Награды живут во вкладках разделов (раскладка владельца 30.10): личные — в «Моём служении», командные — в «Командах».
  const [serviceTab, setServiceTab] = useState<ServiceTab>("service");
  const [standingsTab, setStandingsTab] = useState<"rating" | "awards">("rating");
  /** Вкладки «Дел» (решение владельца 15.11): свои, дела команды, свободные; пока не выбрано — та, где есть что показать. */
  const [deedsTab, setDeedsTab] = useState<"mine" | "team" | "free" | null>(null);
  const [deedQuery, setDeedQuery] = useState("");
  const [deedOpen, setDeedOpen] = useState<Set<string>>(() => new Set());
  const [battlesTab, setBattlesTab] = useState<"defense" | "challenge">("defense");
  /** История испытаний (решение владельца 03.11: «почему бы у участников не сделать закрытые? Пусть будет история»): «Идут» / «Завершённые». */
  const [battlesPhase, setBattlesPhase] = useState<"active" | "done" | null>(null);
  useEffect(() => { apiReady<AwardsDto>(`/api/games/${id}/awards`).then((d) => { setAwards(d); preloadAwardImages(["flame", "p_streak_10", ...d.team.map((g) => g.code), ...d.mine.map((g) => g.code)]); preloadAllAwardImages(); }).catch(() => {}); }, [id, awardsVersion]);
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
  const closeStreak = useCallback(() => { setStreakShow(false); setStreakLit(false); try { if (awards) localStorage.setItem(`lotw.streak.${id}`, awards.streak.todayKey); } catch { /* ничего */ } }, [awards, id]);
  const closeMilestone = useCallback(() => { if (milestone) { try { const k = `lotw.milestone.${id}`; localStorage.setItem(k, [...(localStorage.getItem(k) ?? "").split(",").filter(Boolean), milestone].join(",")); } catch { /* ничего */ } } setMilestone(null); }, [milestone, id]);
  // Испытания, положение, проходы и мир берутся из памяти ответов сразу, свежие приходят следом (ревизия 15.11): при возврате
  // на страницу счётчики на плитках и колокольчике больше не показывают ноль, пока идёт запрос.
  const [battles, setBattles] = useState<BattleDto[]>(() => ready<{ battles: BattleDto[] }>(`/api/games/${id}/my-battles`)?.battles ?? []);
  const [standings, setStandings] = useState<StandingsDto | null>(() => ready<StandingsDto>(`/api/games/${id}/standings`));
  const [passages, setPassages] = useState<PassagesDto | null>(() => ready<PassagesDto>(`/api/games/${id}/my-passages`));
  const [gameName, setGameName] = useState(firstMap?.gameName ?? "");
  const [busy, setBusy] = useState(false);
  /** Идёт запрос «отметить / снять приоритет»: блокируется только сама кнопка приоритета (замечание владельца 14.11: от неё мигали «Взять дело» и «Вымостить дорогу» — общий флаг busy блокировал все кнопки карточки). */
  const [prioBusy, setPrioBusy] = useState(false);
  /** Поручение дела (решение владельца 14.11): для какого дела открыт список «кому поручить». */
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [assignBusy, setAssignBusy] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [mapEl, setMapEl] = useState<HTMLDivElement | null>(null);
  const [markAt, setMarkAt] = useState<MarkPoint | null>(null);
  /** Своя метка по нажатию (решение владельца 16.10): лист с подписью — изменить или убрать. */
  const [editMark, setEditMark] = useState<MapMarkDto | null>(null);
  const [editNote, setEditNote] = useState("");
  /** Флажок «убрать, когда здесь откроются облака» (решение владельца 11.11): у новой метки и у своей метки при правке. */
  const [markDrop, setMarkDrop] = useState(false);
  const [editDrop, setEditDrop] = useState(false);
  /** Место под облаками: гекс ещё не открыт командой. Только там флажку есть чего ждать. */
  const underClouds = (at: { q: number; r: number } | null) => Boolean(at && map?.hexes.some((h) => h.q === at.q && h.r === at.r && h.lit === false));
  /** Точка на краю тумана без дороги с делом: лист с разведкой (решение владельца 02.10). */
  const [frontierKey, setFrontierKey] = useState<string | null>(null);
  const [markNote, setMarkNote] = useState("");
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
  // Прокрутка восстанавливается, когда панель раздела снова на экране (до отрисовки кадра, чтобы список не прыгал).
  useLayoutEffect(() => {
    if (!restore || menuView === "home") return;
    if (sideRef.current) sideRef.current.scrollTop = restore.top;
    if (sideBodyRef.current) sideBodyRef.current.scrollTop = restore.bodyTop;
    setRestore(null);
  }, [restore, menuView]);
  // Где остановился в каждом разделе (решение владельца 30.10: «если я опять нажму на плитку дела, то я должен оказаться
  // на том же месте списка дел, где остановился в прошлый раз»): прокрутка запоминается при листании и возвращается при
  // следующем открытии раздела с плитки.
  const scrollMemo = useRef<Partial<Record<MenuView, { top: number; bodyTop: number }>>>({});
  const rememberScroll = () => { if (menuView !== "home") scrollMemo.current[menuView] = { top: sideRef.current?.scrollTop ?? 0, bodyTop: sideBodyRef.current?.scrollTop ?? 0 }; };
  // Лист раздела на телефоне не сжимается, пока открыт (решение владельца 31.10: «когда сворачиваешь свою команду, окно
  // сокращается и прыгает вниз — оставим его размер, а список подтянется к верху»): наибольшая высота листа держится
  // как min-height до смены раздела; поворот экрана или клавиатура сбрасывают замок.
  useEffect(() => {
    const el = sideRef.current;
    if (menuView === "home" || !el || !window.matchMedia("(max-width: 1023px)").matches) return;
    let floor = 0;
    const hold = () => { const h = el.offsetHeight; if (h > floor) { floor = h; el.style.minHeight = `${h}px`; } };
    const ro = new ResizeObserver(hold);
    ro.observe(el);
    const reset = () => { floor = 0; el.style.minHeight = ""; };
    window.addEventListener("resize", reset);
    return () => { ro.disconnect(); window.removeEventListener("resize", reset); el.style.minHeight = ""; };
  }, [menuView]);
  const openView = (key: MenuView) => { setSelectedId(null); setMenuView(key); const m = scrollMemo.current[key]; if (m) setRestore(m); };

  const loadStandings = useCallback(() => apiReady<StandingsDto>(`/api/games/${id}/standings`).then(setStandings).catch(() => {}), [id]);
  const loadPassages = useCallback(() => apiReady<PassagesDto>(`/api/games/${id}/my-passages`).then(setPassages).catch(() => {}), [id]);
  const [peace, setPeace] = useState<PeaceData | null>(() => ready<PeaceData>(`/api/games/${id}/peace`));
  const loadPeace = useCallback(() => apiReady<PeaceData>(`/api/games/${id}/peace`).then(setPeace).catch(() => {}), [id]);
  /** Мир из строки команды: предложение — только после подтверждения «Да / Нет» (решение владельца 21.09). */
  /** Профиль команды из «Внимания» (решение владельца 05.11): предложение мира принимают или отклоняют в нём. */
  const [profileTeam, setProfileTeam] = useState<Pick<PeaceTeamDto["team"], "id" | "name" | "color" | "avatarId"> | null>(null);
  /** Обмен городами из карточки своего города (решение владельца 04.11): ключ города, выставляемого на обмен. */
  const [tradeCity, setTradeCity] = useState<string | null>(null);
  const loadBattles = useCallback(() => apiReady<{ battles: BattleDto[] }>(`/api/games/${id}/my-battles`).then((r) => {
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
  // Часы раз в секунду нужны только строкам испытаний — они тикают там (WithNow), а не в корне страницы (ревизия 15.11).
  // Здесь же стоял обработчик touchmove на весь экран «для свайпа от края»: условие в нём не выполнялось никогда, а браузер
  // из-за него ждал скрипт перед каждой прокруткой листа — убран.
  const swipe = useRef<{ x: number; y: number } | null>(null);

  const fetchTeam = useCallback((join: boolean) => apiReady<TeamsResp>(`/api/games/${id}/teams`, { join }).then((r) => { setError(null); setIsAdmin(r.isAdmin); const mine = r.teams.find((tm) => tm.members.some((mm) => mm.user.id === user?.id)) ?? r.teams[0] ?? null; setTeam((prev) => (mine ? keepSame(prev, mine) : null)); }).catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети"))), [id, user?.id]);
  const loadTeam = useCallback(() => fetchTeam(false), [fetchTeam]);
  // Карта принимается через acceptMap: части, содержимое которых не изменилось, остаются прежними объектами, и то, что от них
  // зависит (морские пути, сцена, списки), не считается заново. Раньше каждый ответ — раз в минуту и после каждого события —
  // пересобирал карту целиком, даже когда в игре ничего не происходило (ревизия 15.11). Номер версии хранится отдельно:
  // он нужен только для сверки «разниц» и не должен перерисовывать экран.
  // Последняя принятая карта и её номер версии хранятся рядом и обновляются одновременно, сразу — не дожидаясь перерисовки:
  // две «разницы», пришедшие подряд (телефон вернулся из фона), накладываются по очереди на свежую карту. Если бы карта
  // бралась из состояния React, вторая «разница» легла бы на устаревший объект при уже новом номере, и изменение
  // потерялось бы молча (находка независимого разбора 15.11).
  const mapRev = useRef<number | undefined>(firstMap?.rev);
  const mapRef = useRef<MyMapDto | null>(firstMap);
  const putMap = useCallback((next: MyMapDto | null) => { mapRef.current = next; setMap(next); }, []);
  // Счётчик принятых карт — чтобы узнать опоздавший ответ: пока полный запрос был в пути (плохая связь), могла прийти и
  // примениться более новая «разница» или другой полный ответ. Такой опоздавший ответ старее того, что уже на экране, и
  // раньше затирал его — чужое взятое дело снова выглядело свободным до следующего перечитывания (находка повторного
  // разбора 15.11). Теперь он отбрасывается, а карта перечитывается заново.
  const mapSeq = useRef(0), mapAgain = useRef<() => void>(NOOP);
  const acceptMap = useCallback((m: MyMapDto) => { mapSeq.current++; mapRev.current = m.rev; putMap(keepSame(mapRef.current, m, MAP_VOLATILE)); }, [putMap]);
  const fetchMap = useCallback((join: boolean) => {
    const seq = mapSeq.current;
    return apiReady<MapResp>(`/api/games/${id}/my-map`, { join }).then((m) => {
      if (mapSeq.current !== seq && mapRev.current !== undefined && m.rev !== undefined && m.rev < mapRev.current) { mapAgain.current(); return; }
      acceptMap(m); setMapError(null); setDisplayTimeZone(m.daytime?.timeZone); if (m.gameName) setGameName(m.gameName);
    }).catch((e) => setMapError(e instanceof ApiError ? e.message : t("Ошибка сети")));
  }, [id, acceptMap]);
  const loadMap = useCallback(() => fetchMap(false), [fetchMap]);
  // Первый показ берёт ответы, которые главная уже запросила заранее и которые ещё в пути.
  useEffect(() => { void fetchTeam(true); void fetchMap(true); }, [fetchTeam, fetchMap]);
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
  // По номеру команды, а не по объекту (ревизия 15.11): состав перечитывается при каждом деле в команде, и раньше каждый такой
  // ответ тянул за собой ещё четыре запроса у каждого игрока. Сами эти данные обновляются по своим событиям ниже.
  const loadBattlesRef = useRef(loadBattles); loadBattlesRef.current = loadBattles;
  useEffect(() => { if (team?.id) { void loadBattlesRef.current(); void loadStandings(); void loadPassages(); void loadPeace(); } }, [team?.id, loadStandings, loadPassages, loadPeace]);
  // Перечитывания по событиям склеиваются (решение владельца 23.10): несколько событий за 2,5 с — одно перечитывание.
  const teamLater = useCoalesced(loadTeam), mapLater = useCoalesced(loadMap), passagesLater = useCoalesced(loadPassages), battlesLater = useCoalesced(loadBattles), standingsLater = useCoalesced(loadStandings), peaceLater = useCoalesced(loadPeace);
  mapAgain.current = mapLater;
  const cityLater = useCoalesced(() => setCityVersion((v) => v + 1)), feedLater = useCoalesced(() => setFeedVersion((v) => v + 1));
  const awardsLater = useCoalesced(() => setAwardsVersion((v) => v + 1));
  // Карта приходит разницей от сервера (решение владельца 24.10): применяем к своей версии; если версии разошлись — перечитываем.
  const onMapPush = (m: MapPush) => {
    const cur = mapRef.current;
    // Эта версия уже есть: после своего действия карта перечитывается сразу, а «разница» к ней приходит следом. Раньше она
    // считалась расхождением, и карта качалась ещё раз (ревизия 15.11).
    if (m.kind !== "stale" && cur && mapRev.current === m.rev) return;
    if (m.kind === "stale" || !cur || mapRev.current !== m.base) { mapLater(); return; }
    try {
      // Копия нужна одна: applyPatch с последним параметром false сам копирует документ.
      const next = applyPatch(cur, m.patch as Parameters<typeof applyPatch>[1], true, false).newDocument as MyMapDto;
      // Тайные дела: сервер не шлёт ссылки и текст сдачи, свои оставляем как были.
      next.tasks = next.tasks.map((t) => { const old = cur.tasks.find((o) => o.id === t.id); return t.deed.secret && old && !t.links.length && !t.note ? { ...t, links: old.links, note: old.note } : t; });
      acceptMap({ ...next, rev: m.rev });
    } catch { mapLater(); }
  };
  useGameEvents(id, (e) => {
    // Дела другой команды на моей карте не видны: такие события пропускаем (сервер их и не шлёт, это страховка для старых клиентов).
    if (e.teamId && team && e.teamId !== team.id && (e.type === "tasks" || e.type === "submissions" || e.type === "journal")) return;
    if (e.type === "teams" || e.type === "game" || e.type === "tasks") teamLater(); // tasks: таймеры дел у участников в составе
    // Сама карта приходит разницей (map-patch); здесь перечитываем только то, что к карте добавляет маршрут:
    // статус игры, камни Каменоломни в шапке, визиты, заморозку дел.
    if (e.type === "game" || e.type === "quarry" || e.type === "cities" || e.type === "teams" || e.type === "wrecks") mapLater();
    if (e.type === "cities" || e.type === "game" || e.type === "battles") { cityLater(); passagesLater(); }
    // Запрос прохода и ответ на него приходят событием карты своей команды; положение меняется с каждым принятым делом.
    // Раньше то и другое обновлялось «заодно» с каждым перечитыванием состава (находка независимого разбора 15.11).
    if (e.type === "map" && (!e.teamId || e.teamId === team?.id)) passagesLater();
    if (e.type === "tasks" || e.type === "submissions") standingsLater();
    if (e.type === "deeds") mapLater();
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
  /** Капитан или заместитель: вызов, ответ, столица. */
  const isLeader = isCaptain || me?.role === "DEPUTY";
  // Место высадки выбирает кормчий, капитан и команда советуют (решение владельца 03.10); без кормчего в команде — капитан или заместитель.
  const hasHelmsman = (team?.members ?? []).some((mm) => mm.gameRole === "HELMSMAN");
  const canLand = me?.gameRole === "HELMSMAN" || (isLeader && !hasHelmsman);
  const task = useMemo(() => (map?.tasks ?? []).find((tk) => tk.id === selectedId) ?? null, [map, selectedId]);
  // Ссылка на дело (решение владельца 14.11): уведомление о поручении ведёт на «…/team?task=…» — открывается карточка именно
  // этого дела, карта показывает его сторону. Параметр сразу убирается из адреса, чтобы дело не открывалось снова.
  const linkTask = searchParams.get("task");
  const mapReady = Boolean(map);
  useEffect(() => {
    if (!linkTask || !map) return;
    if (map.tasks.some((tk) => tk.id === linkTask)) { setSelectedId(linkTask); setBackTo(null); setMenuView("home"); setFrontierKey(null); setFocusTask({ id: linkTask, nonce: Date.now() }); }
    const next = new URLSearchParams(searchParams); next.delete("task"); setSearchParams(next, { replace: true });
  }, [linkTask, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps
  const memberName = (userId: string | null) => { const m = team?.members.find((mm) => mm.user.id === userId); return m ? m.user.displayName ?? m.user.nickname : ""; };
  /** Состав для «Отметить за» в испытании (решение владельца 07.11); отмечать за других могут капитан, заместитель и летописец. */
  const forMembers = useMemo(() => (team?.members ?? []).map((mm) => ({ userId: mm.user.id, name: mm.user.displayName ?? mm.user.nickname })), [team?.members]);
  const canMarkFor = isLeader || me?.gameRole === "CHRONICLER";

  async function act(path: string, body?: unknown): Promise<boolean> {
    setBusy(true); setError(null);
    try { await api(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }); await loadMap(); return true; }
    catch (e) { setError(e instanceof ApiError ? (e.issues?.map((i) => i.message).join("; ") || e.message) : t("Ошибка сети")); return false; }
    finally { setBusy(false); }
  }
  /** Приоритет капитана: отметить или снять. Своё состояние запроса и своя ошибка (уведомлением) — карточка дела и её кнопки не трогаются. */
  async function setPriority(taskId: string, on: boolean): Promise<void> {
    setPrioBusy(true);
    try {
      await api(`/api/games/${id}/edge-tasks/${taskId}/priority`, { method: "POST", body: JSON.stringify({ on }) });
      await loadMap();
      notify(on ? t("Дело отмечено приоритетным: его свиток на карте горит") : t("Приоритет снят"));
    } catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setPrioBusy(false); }
  }
  /** Поручение дела (решение владельца 14.11): капитан или заместитель поручает свободное дело участнику; null — снять. */
  async function assign(taskId: string, userId: string | null): Promise<void> {
    setAssignBusy(true);
    try {
      await api(`/api/games/${id}/edge-tasks/${taskId}/assign`, { method: "POST", body: JSON.stringify({ userId }) });
      await loadMap();
      setAssignFor(null);
      notify(userId ? t("Дело поручено: {name}. Сутки взять его может только он", { name: memberName(userId) }) : t("Поручение снято: дело снова свободно"));
    } catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setAssignBusy(false); }
  }
  /** Отказ от поручения: дело снова свободно для всей команды, поручивший узнаёт об отказе. */
  async function declineAssign(taskId: string, by: string): Promise<void> {
    if (!(await confirm(by ? t("Дело снова станет свободным для всей команды. {name} узнает, что вы не можете его взять.", { name: by }) : t("Дело снова станет свободным для всей команды."), { title: t("Не можете взять это дело?"), okLabel: t("Не могу взять") }))) return;
    if (await act(`/api/games/${id}/edge-tasks/${taskId}/assign/decline`)) notify(t("Поручение снято: дело снова свободно"), "info");
  }
  const peekedKind = (key: string) => map?.peeked?.find((p) => p.key === key)?.kind ?? null;
  /**
   * Разведка (решения владельца 29.10 и 14.11): вместо слов карта раздвигает туман вокруг перекрёстка и показывает, что там;
   * место остаётся открытым насовсем. Листы закрываются, чтобы карту было видно; само окно рисует карта по ответу сервера.
   */
  async function peek(nodeKey: string) {
    setBusy(true); setError(null);
    try {
      await api(`/api/games/${id}/my-map/peek`, { method: "POST", body: JSON.stringify({ nodeKey }) });
      setFrontierKey(null); setSelectedId(null); setBackTo(null); setMenu(false);
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
  async function putMark() {
    if (!markAt) return;
    setBusy(true);
    try {
      const drop = markDrop && underClouds(markAt);
      await api(`/api/games/${id}/my-map/marks`, { method: "POST", body: JSON.stringify({ q: markAt.q, r: markAt.r, qf: markAt.qf, rf: markAt.rf, note: markNote.trim(), dropOnReveal: drop }) });
      setMarkAt(null); setMarkNote(""); setMarkDrop(false);
      notify(drop ? t("Метка поставлена: её видит вся команда. Она исчезнет сама, когда здесь откроются облака.") : t("Метка поставлена: её видит вся команда"), "info"); await loadMap();
    } catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusy(false); }
  }
  async function saveMark() {
    if (!editMark) return;
    setBusy(true);
    try { await api(`/api/games/${id}/my-map/marks/${editMark.id}`, { method: "PATCH", body: JSON.stringify({ note: editNote.trim(), dropOnReveal: editDrop && underClouds(editMark) }) }); setEditMark(null); notify(t("Метка изменена"), "info"); await loadMap(); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusy(false); }
  }
  function tapMark(mk: MapMarkDto) {
    if (mk.by && user && mk.by.id === user.id) { setEditMark(mk); setEditNote(mk.note); setEditDrop(Boolean(mk.dropOnReveal)); return; }
    void removeMark(mk);
  }
  async function removeMark(mk: MapMarkDto) {
    const by = mk.by?.name ?? "";
    // Убрать метку может только автор (решение владельца 29.09): чужая метка по нажатию лишь подсказывает, чья она.
    const when = mk.createdAt ? fmtDate(mk.createdAt) : "";
    // Метка с флажком «убрать, когда откроются облака» (решение владельца 11.11): команда видит, что она временная.
    const auto = mk.dropOnReveal ? ` ${t("Она исчезнет сама, когда здесь откроются облака.")}` : "";
    if (mk.by && user && mk.by.id !== user.id) { notify((mk.note ? t("Метка «{note}» — её поставил {name} ({when}), убрать может только он.", { note: mk.note, name: by, when }) : t("Метку поставил {name} ({when}), убрать может только он.", { name: by, when })) + auto, "info"); return; }
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
          <h1 className="row"><TeamAvatar name={team.name} color={team.color} avatarId={team.avatarId} size="lg" teamId={team.id} />{team.name}</h1>
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
          <h1 className="row"><TeamAvatar name={team.name} color={team.color} avatarId={team.avatarId} size="lg" teamId={team.id} />{team.name}</h1>
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
          <h1 className="row"><TeamAvatar name={team.name} color={team.color} avatarId={team.avatarId} size="lg" teamId={team.id} />{team.name}</h1>
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
        {map.status !== "FINISHED" && <div className="card"><Roster team={team} isCaptain={isCaptain} onRole={setGameRole} onDeputy={setDeputy} /></div>}
      </main>
    );
  }

  const activeBattles = battles.filter((b) => b.status === "QUEUED" || b.status === "ATTACK" || b.status === "DEFENSE");
  // В списке дела по алфавиту названий (решение владельца 24.10) — и взятые, и свободные.
  // Приоритетные дела капитана — первыми в своём списке (решение владельца 14.11), дальше по алфавиту.
  const byTitle = (a: EdgeTaskDto, b: EdgeTaskDto) => Number(deedPriority(b)) - Number(deedPriority(a)) || a.deed.title.localeCompare(b.deed.title, "ru");
  const ourTasks = map.tasks.filter((tk) => tk.status === "TAKEN" || tk.status === "SUBMITTED" || tk.status === "REJECTED").sort(byTitle);
  // Свободные дела на карте — в разделе «Дела» с кнопкой «Взять» у каждого, чтобы не искать метку на карте (решение владельца 05.10).
  // Порученные мне дела — первыми среди свободных (решение владельца 14.11).
  const forMe = (tk: EdgeTaskDto) => deedAssignee(tk) === user?.id;
  const freeTasks = map.tasks.filter((tk) => tk.status === "OPEN").sort((a, b) => Number(forMe(b)) - Number(forMe(a)) || byTitle(a, b));
  const assignedToMe = freeTasks.filter(forMe);
  // Раздел «Дела» (решение владельца 15.11): вкладки «Мои · Команда · Свободные», внутри — группы по состоянию;
  // свободные — одинаковые дела одной строкой «×N» и поиск по названию.
  const mineTasks = ourTasks.filter((tk) => tk.takenById === user?.id);
  const deedsShown = deedsTab ?? (mineTasks.length > 0 ? "mine" : ourTasks.length > 0 ? "team" : "free");
  const DEED_GROUPS: Array<{ status: EdgeTaskStatus; label: string; icon: string }> = [{ status: "REJECTED", label: t("Возвращены"), icon: "alert" }, { status: "TAKEN", label: t("В работе"), icon: "user" }, { status: "SUBMITTED", label: t("На проверке"), icon: "clock" }];
  const deedQ = deedQuery.trim().toLocaleLowerCase("ru");
  const freeGroups = (() => { const m = new Map<string, EdgeTaskDto[]>(); for (const tk of freeTasks) { if (deedQ && !tk.deed.title.toLocaleLowerCase("ru").includes(deedQ)) continue; const g = m.get(tk.deed.title); if (g) g.push(tk); else m.set(tk.deed.title, [tk]); } return [...m.entries()].map(([title, items]) => ({ title, items })); })();
  // Где стоит одно из одинаковых дел: ближайший к его стороне город, который команда уже открыла.
  const knownCities = map.revealed.filter((n) => n.kind === "CITY" && n.bookCode).map((n) => ({ name: bookName(n.bookCode!), ...nodePos(n.key) }));
  const deedWhere = (tk: EdgeTaskDto) => { const a = nodePos(tk.fromKey), b = nodePos(tk.toKey); const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2; let best = "", bd = Infinity; for (const c of knownCities) { const d = (c.x - x) ** 2 + (c.y - y) ** 2; if (d < bd) { bd = d; best = c.name; } } return best ? t("у города {city}", { city: best }) : t("на карте"); };
  // Фаза для подписей: предпросмотр `?tod=` (снимки инструкции) перекрывает серверную, правила считает сервер.
  const phase = previewPhase() ?? map.daytime?.phase;
  const canTakeNow = phase !== "night" || Boolean(map.daytime?.tasksOpen);
  const landingTask = landingId ? map.tasks.find((tk) => tk.id === landingId && tk.landing) ?? null : null;
  const incoming = passages?.incoming.filter((r) => r.status === "PENDING") ?? [];
  // Бейдж на кнопке меню — только то, что требует действия: возвращённое дело, входящий запрос прохода, наш ход в испытании.
  const peaceOffers = peace?.canSpeak ? peace.teams.filter((p) => p.state === "incoming") : [];
  // Просьба о защитном союзе (решение владельца 22.10) ждёт ответа капитана, заместителя или посла.
  const allyAsks = activeBattles.filter((b) => b.myAlliance?.status === "PROPOSED").length;
  // Отчёт о визите (решение владельца 22.10) ждёт капитана или заместителя до полуночи.
  const visitsDue = (map.visits ?? []).filter((v) => v.status === "PENDING");
  // Возвращённые администратором записи (решение владельца 04.11: «когда админ возвращает стихи при проверке — нужно
  // уведомление… в раздел с колокольчиком»): мои записи в идущих испытаниях, пока сторона не отправлена заново, и мои
  // блоки стены, пока блок не сдан заново (с сервера, my-map).
  const returnedEntries = activeBattles.flatMap((b) => b.entries.filter((e) => e.userId === user?.id && e.status === "REJECTED" && e.side === b.mySide && (e.side === "ATTACK" ? !b.attackDoneAt : !b.defenseDoneAt)).map((e) => ({ battle: b, entry: e })));
  const returnedBlocks = map.returnedBlocks ?? [];
  // Новый разбитый корабль и новое дело Каменоломни (решение владельца 06.11: «чтобы приходило в плитку „Внимание“»):
  // корабль — пока открыт, команда его не брала и не прошло трёх суток; дело — из my-map (quarryNew).
  const newWrecks = (map.wrecks ?? []).filter((w) => !w.sunkAt && !w.mine && w.appearedAt && Date.now() - Date.parse(w.appearedAt) < 3 * 86_400_000 && !(map.seenWrecks ?? []).includes(w.id));
  const newQuarry = map.quarryNew ?? [];
  // К нашему городу подошла чужая команда (решение владельца 07.11: вместо шатров на карте — пункт «Внимание», push и уведомление).
  const arrivals = map.arrivals ?? [];
  /** Пункт прочитан (решение владельца 07.11): исчезает сразу и только у меня; отметка хранится на сервере. */
  const markSeen = (kind: "quarry" | "wreck" | "arrival", refId: string) => {
    const m = mapRef.current;
    if (m) putMap({ ...m, quarryNew: kind === "quarry" ? (m.quarryNew ?? []).filter((d) => d.id !== refId) : m.quarryNew, seenWrecks: kind === "wreck" ? [...(m.seenWrecks ?? []), refId] : m.seenWrecks, arrivals: kind === "arrival" ? (m.arrivals ?? []).filter((a) => a.id !== refId) : m.arrivals });
    void api(`/api/games/${id}/attention/seen`, { method: "POST", body: JSON.stringify({ kind, refId }) }).catch(() => {});
  };
  const attention = ourTasks.filter((tk) => tk.status === "REJECTED").length + incoming.length + peaceOffers.length + activeBattles.filter((b) => isMyTurn(b, team.id)).length + allyAsks + (isLeader ? visitsDue.length : 0) + returnedEntries.length + returnedBlocks.length + newWrecks.length + newQuarry.length + arrivals.length + assignedToMe.length;
  const rejectedTasks = ourTasks.filter((tk) => tk.status === "REJECTED");
  const myTurnBattles = activeBattles.filter((b) => isMyTurn(b, team.id));
  // Две вкладки испытаний (решение владельца 31.10: «вместо того, чтобы писать, кто претендент, а кто хранитель, — две табы»):
  // «Оборона» — вызовы нашим городам и защитные союзы, «Вызовы» — наши вызовы чужим городам. Пустая вкладка уступает непустой.
  const defending = activeBattles.filter((b) => b.attacker.id !== team.id);
  const challenging = activeBattles.filter((b) => b.attacker.id === team.id);
  const battlesShown = battlesTab === "defense" && defending.length === 0 && challenging.length > 0 ? "challenge" : battlesTab === "challenge" && challenging.length === 0 && defending.length > 0 ? "defense" : battlesTab;
  const finishedBattles = battles.filter((b) => !activeBattles.includes(b));
  const defendingDone = finishedBattles.filter((b) => b.attacker.id !== team.id), challengingDone = finishedBattles.filter((b) => b.attacker.id === team.id);
  const battlesActive = battlesShown === "defense" ? defending : challenging, battlesDone = battlesShown === "defense" ? defendingDone : challengingDone;
  const battlesPhaseShown: "active" | "done" = battlesPhase ?? (battlesActive.length > 0 ? "active" : "done");
  const battlesList = battlesPhaseShown === "active" ? battlesActive : battlesDone;
  const menuCounts: Partial<Record<MenuView, number>> = { attention, deeds: ourTasks.length, battles: activeBattles.length, standings: peaceOffers.length };
  /** На компьютере (решение владельца 05.10, вечер): плитки разделов висят над картой, панель открыта только пока выбран раздел; «home» — панель закрыта. */
  const view: MenuView = menuView;

  const onTouchStart = (e: React.TouchEvent) => {
    if (wide) return;
    // Полоса, которая сама листается вбок (чипы команд в «Наградах», вкладки), свайп не отдаёт панели (владелец 29.10:
    // «двигаю табы команд в наградах — закрывается вкладка и выходит на карту»).
    for (let el = e.target as HTMLElement | null; el && el !== e.currentTarget; el = el.parentElement) {
      if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) { swipe.current = null; return; }
    }
    const tp = e.touches[0]!;
    swipe.current = { x: tp.clientX, y: tp.clientY };
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
  // На телефоне открытие дела прячет панель раздела: карта и лист дела должны быть видны (владелец 30.10: «нажимаю на
  // «посмотреть на карте» и ничего не происходит!!! нужно, чтобы все менюшки прятались и на карте показалось дело»).
  const openTask = (tid: string | null) => { setSelectedId(tid); setBackTo(null); if (tid) { rememberScroll(); setMenuView("home"); setFrontierKey(null); } };
  mapActs.current = {
    openTask, openCity, tapMark,
    land: (key) => void land(key),
    mark: (at) => { setMarkAt(at); setMarkNote(""); setMarkDrop(false); },
    frontier: (key) => { setFrontierKey(key); setSelectedId(null); setMenu(false); },
    quarry: () => { setQuarryOpen(true); setSelectedId(null); setCityKey(null); setFrontierKey(null); setMenu(false); },
    wreck: (wid) => { setWreckId(wid); setQuarryOpen(false); setSelectedId(null); setCityKey(null); setFrontierKey(null); setMenu(false); },
  };
  const showOnMap = (tid: string) => {
    const from = menuView !== "home" ? { view: menuView, top: sideRef.current?.scrollTop ?? 0, bodyTop: sideBodyRef.current?.scrollTop ?? 0 } : null;
    openTask(tid);
    setBackTo(from);
    setFocusTask({ id: tid, nonce: Date.now() });
  };
  const closeTask = () => {
    setSelectedId(null);
    if (!backTo) return;
    setMenuView(backTo.view); setRestore({ top: backTo.top, bodyTop: backTo.bodyTop }); setBackTo(null);
  };
  /** Нажатие по карте мимо листа дела — сразу на карту, без возврата в список (жалоба участника 31.10: «невозможно выйти из карточки дела на карту»); стрелка в листе по-прежнему ведёт в список на то же место. */
  const dismissTask = () => { setSelectedId(null); setBackTo(null); };
  // Телефон по схеме администратора (решение владельца 29.10): бокового меню нет, разделы открываются из дока внизу
  // листом над картой; стрелка слева вверху ведёт в «Мои игры». Состояние `menu` осталось для совместимости вызовов.
  const menuOpen = !storm.active && menuView !== "home";
  const closeMenu = () => { rememberScroll(); setMenuView("home"); };
  // Порядок плиток дока (решение владельца 30.10, слева направо): внимание, испытания, служение, команды, летопись, дела.
  // Колокольчик «Внимание» — в шапке карты, в панели остаются пять разделов в прежнем порядке (решение владельца 15.11).
  const DOCK_ORDER: MenuView[] = ["battles", "service", "standings", "feed", "deeds"];
  const dockItems = DOCK_ORDER.map((k) => MENU_ITEMS.find((m) => m.key === k)!);
  /** Плашка серии и праздник рубежа открывают «Моё служение» на вкладке «Награды» (кнопки наград над картой нет — решение владельца 30.10). */
  const openAwards = () => { setMenu(true); setMenuView("service"); setServiceTab("awards"); setSelectedId(null); };

  return (
    <div className="map-screen" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {menuOpen && <div className="side-backdrop" onClick={closeMenu} />}
      {profileTeam && <AvatarLightbox avatarId={profileTeam.avatarId ?? null} name={profileTeam.name} teamId={profileTeam.id} color={profileTeam.color} onClose={() => setProfileTeam(null)} />}
      {/* На компьютере (решение владельца 05.10, вечер): колонка плиток висит полупрозрачно над картой; нажатие открывает панель
          раздела рядом, повторное нажатие на ту же плитку или нажатие на карту закрывает её. */}
      {menuOpen && (
        <aside ref={sideRef} className="side-menu" role="dialog" aria-modal={true} aria-label={t("Меню команды")} onScroll={rememberScroll}>
          {/* Заголовок панели (решение владельца 30.10: «на его месте оставить только значок раздела и название раздела,
              что гораздо экономнее по месту и минималистичнее»): значок, название раздела, крестик. Шапки команды нет.
              Верх панели закреплён целиком (правка 14.11, по замечаниям игроков: «вкладки наползают на шапку», «пусть весь
              верх будет закреплён, а листаются только награды»): заголовок и главные вкладки раздела стоят над областью
              прокрутки, листается только содержимое. Раньше заголовок и вкладки прилипали к одной точке, и вкладки
              ложились поверх заголовка. Подложки у вкладок нет — под ними фон панели, как раньше (владелец 14.11).
              Свайп по содержимому переключает вкладки, как и прежде (область — .side-body). */}
          <div className={"side-top" + (view === "battles" || view === "standings" || view === "service" || view === "deeds" ? " with-tabs" : "")}>
            <div className="menu-sub">
              <h2><Icon name={MENU_ITEMS.find((m) => m.key === view)?.icon ?? "map"} />{MENU_ITEMS.find((m) => m.key === view)?.label()}</h2>
              <button type="button" className="ghost icon" onClick={closeMenu} aria-label={t("Закрыть")}><Icon name="x" /></button>
            </div>
            {view === "battles" && (
              <div className="side-tabs">
                <Tabs items={[{ key: "defense", label: t("Оборона"), icon: "shield", count: defending.length }, { key: "challenge", label: t("Вызовы"), icon: "wave", count: challenging.length }]} value={battlesShown} onChange={setBattlesTab} ariaLabel={t("Испытания")} swipeArea={sideBodyRef} />
                <Tabs items={[{ key: "active", label: t("Идут"), count: battlesActive.length || undefined }, { key: "done", label: t("Завершённые"), count: battlesDone.length || undefined }]} value={battlesPhaseShown} onChange={setBattlesPhase} ariaLabel={t("Какие испытания показывать")} swipe={false} />
              </div>
            )}
            {/* Две вкладки (раскладка владельца 30.10): рейтинг команд с составом, проходами и миром; награды команд — сетка своей и рейтинг наград. */}
            {view === "standings" && (
              <div className="side-tabs">
                <Tabs items={[{ key: "rating", label: t("Рейтинг команд"), icon: "crown" }, { key: "awards", label: t("Награды команд"), icon: "trophy" }]} value={standingsTab} onChange={setStandingsTab} ariaLabel={t("Команды")} swipeArea={sideBodyRef} />
              </div>
            )}
            {view === "service" && <div className="side-tabs"><ServiceTabs tab={serviceTab} onTab={setServiceTab} swipeArea={sideBodyRef} /></div>}
            {view === "deeds" && (
              <div className="side-tabs">
                <Tabs items={[{ key: "mine", label: t("Мои"), count: mineTasks.length || undefined }, { key: "team", label: t("Команда"), count: ourTasks.length || undefined }, { key: "free", label: t("Свободные"), count: freeTasks.length || undefined }]} value={deedsShown} onChange={setDeedsTab} ariaLabel={t("Дела")} swipeArea={sideBodyRef} />
              </div>
            )}
          </div>
          <div className="side-body" ref={sideBodyRef} onScroll={rememberScroll}>
          {view === "attention" && (
            rejectedTasks.length > 0 || incoming.length > 0 || peaceOffers.length > 0 || myTurnBattles.length > 0 || visitsDue.length > 0 || returnedEntries.length > 0 || returnedBlocks.length > 0 || newWrecks.length > 0 || newQuarry.length > 0 || arrivals.length > 0 || assignedToMe.length > 0 ? (
                <section className="section attention">
                  <ul className="list interactive">
                    {/* Поручение (решение владельца 14.11): пункт открывает карточку именно этого дела; висит, пока дело не взято, не отклонено и бронь не истекла. */}
                    {assignedToMe.map((tk) => (
                      <li key={"asg-" + tk.id} role="button" tabIndex={0} onClick={() => showOnMap(tk.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showOnMap(tk.id); } }}>
                        <div className="main"><span className="title">{t("Вам поручено дело: {title}", { title: tk.deed.title })}</span><span className="meta">{[memberName(tk.assignedById ?? null) ? t("поручил: {name}", { name: memberName(tk.assignedById ?? null) }) : "", tk.assignedUntil ? t("взять до {time}", { time: fmtDate(tk.assignedUntil) }) : ""].filter(Boolean).join(" · ")}</span></div><Icon name="chevron" className="chev" />
                      </li>
                    ))}
                    {arrivals.map((a) => (
                      <li key={"arr-" + a.id} role="button" tabIndex={0} onClick={() => { markSeen("arrival", a.id); openCity(a.nodeKey); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); markSeen("arrival", a.id); openCity(a.nodeKey); } }}>
                        <div className="main"><span className="title">{t("К городу {book} подошла команда «{team}»", { book: a.book, team: a.team.name })}</span><span className="meta">{a.sea ? t("морем") : t("по дороге")} · {fmtDate(a.at)}</span></div><Icon name="chevron" className="chev" />
                      </li>
                    ))}
                    {newWrecks.map((w) => (
                      <li key={"wreck-" + w.id} role="button" tabIndex={0} onClick={() => { markSeen("wreck", w.id); setWreckId(w.id); setQuarryOpen(false); setSelectedId(null); setCityKey(null); setFrontierKey(null); setMenu(false); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); markSeen("wreck", w.id); setWreckId(w.id); setMenu(false); } }}>
                        <div className="main"><span className="title">{t("Разбитый корабль просит помощи: {title}", { title: w.title })}</span><span className="meta">{w.sinkAt ? t("утонет {d}", { d: fmtDate(w.sinkAt) }) : t("срочное задание на карте, груз — тому, кто поможет")}</span></div><Icon name="chevron" className="chev" />
                      </li>
                    ))}
                    {newQuarry.map((d) => (
                      <li key={"quarry-" + d.id} role="button" tabIndex={0} onClick={() => { markSeen("quarry", d.id); setQuarryOpen(true); setWreckId(null); setSelectedId(null); setCityKey(null); setMenu(false); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); markSeen("quarry", d.id); setQuarryOpen(true); setMenu(false); } }}>
                        <div className="main"><span className="title">{t("Новое дело в Каменоломне: {title}", { title: d.title })}</span><span className="meta">{t("сдаёт капитан, заместитель или летописец")}</span></div><Icon name="chevron" className="chev" />
                      </li>
                    ))}
                    {rejectedTasks.map((tk) => (
                      <li key={tk.id} role="button" tabIndex={0} onClick={() => showOnMap(tk.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showOnMap(tk.id); } }}>
                        <div className="main"><span className="title">{t("Дело возвращено: {title}", { title: tk.deed.title })}</span>{tk.adminComment && <span className="meta">{tk.adminComment}</span>}</div><Icon name="chevron" className="chev" />
                      </li>
                    ))}
                    {incoming.map((r) => (
                      <li key={r.id} role="button" tabIndex={0} onClick={() => { rememberScroll(); setMenuView("home"); openCity(r.nodeKey); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); rememberScroll(); setMenuView("home"); openCity(r.nodeKey); } }}>
                        <div className="main"><span className="title">{t("Запрос прохода через {book}", { book: r.bookName })}</span><span className="meta">{t("от команды «{team}»", { team: r.requester.name })}</span></div><Icon name="chevron" className="chev" />
                      </li>
                    ))}
                    {/* Открывает профиль команды: принять или отклонить — там (решение владельца 05.11). */}
                    {peaceOffers.map((p) => (
                      <li key={p.team.id} role="button" tabIndex={0} onClick={() => setProfileTeam(p.team)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setProfileTeam(p.team); } }}>
                        <div className="main"><span className="title">{t("Команда «{team}» предлагает мир", { team: p.team.name })}</span>{peaceTerm(p) && <span className="meta">{peaceTerm(p)}</span>}</div><Icon name="chevron" className="chev" />
                      </li>
                    ))}
                    {myTurnBattles.map((b) => (
                      <li key={b.id} role="button" tabIndex={0} onClick={() => openCity(b.nodeKey)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCity(b.nodeKey); } }}>
                        <div className="main"><span className="title">{t("Испытание · {city}", { city: bookName(b.bookCode) })}</span><span className="meta">{t("ваш ход")}</span></div><Icon name="chevron" className="chev" />
                      </li>
                    ))}
                    {returnedEntries.map(({ battle: b, entry: e }) => (
                      <li key={e.id} role="button" tabIndex={0} onClick={() => openCity(b.nodeKey)} onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openCity(b.nodeKey); } }}>
                        <div className="main"><span className="title">{t("Запись возвращена · {city} · {ref}", { city: bookName(b.bookCode), ref: e.ref })}</span><span className="meta">{e.adminComment || t("переснимите и прикрепите заново")}</span></div><Icon name="chevron" className="chev" />
                      </li>
                    ))}
                    {returnedBlocks.map((r) => (
                      <li key={r.id} role="button" tabIndex={0} onClick={() => openCity(r.nodeKey)} onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openCity(r.nodeKey); } }}>
                        <div className="main"><span className="title">{t("Блок стены возвращён · {city} · {ref}", { city: bookName(r.bookCode), ref: r.ref })}</span><span className="meta">{r.comment || t("сдайте блок заново")}</span></div><Icon name="chevron" className="chev" />
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
          {menuView === "deeds" && (() => {
            const open = (tk: EdgeTaskDto) => ({ role: "button" as const, tabIndex: 0, onClick: () => showOnMap(tk.id), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showOnMap(tk.id); } } });
            // «Мои» и «Команда»: группы по состоянию; значка состояния в строке нет — его называет заголовок группы.
            const byStatus = (list: EdgeTaskDto[], withTaker: boolean) => DEED_GROUPS.map((g) => { const items = list.filter((tk) => tk.status === g.status); if (items.length === 0) return null; return (
              <Fragment key={g.status}>
                <h3 className="list-title"><Icon name={g.icon} />{g.label}<span className="count">{items.length}</span></h3>
                <ul className="list interactive">
                  {items.map((tk) => (
                    <li key={tk.id} {...open(tk)}>
                      <div className="main"><span className="title">{deedPriority(tk) && <Icon name="flame" className="prio-flame" title={t("Приоритет капитана")} />}{tk.deed.title}</span><span className="meta">{[tk.person ? t("кому: {name}", { name: tk.person.name }) : "", tk.status === "REJECTED" && tk.adminComment ? tk.adminComment : ""].filter(Boolean).join(" · ")}</span></div>
                      {/* Кто взял дело (просьба участников 03.10: видно, у кого дело в работе) — на вкладке команды. */}
                      {withTaker && tk.takenById && <div className="side"><span className="muted small taker">{memberName(tk.takenById)}</span></div>}
                    </li>
                  ))}
                </ul>
              </Fragment>
            ); });
            // Свободное дело: строка с кнопкой «Взять»; у одного из сложенных одинаковых дел вместо названия — где оно стоит.
            const freeRow = (tk: EdgeTaskDto, sub: boolean) => (
              <li key={tk.id} className={sub ? "deed-sub" : undefined} {...open(tk)}>
                <div className="main"><span className="title">{deedPriority(tk) && <Icon name="flame" className="prio-flame" title={t("Приоритет капитана")} />}{sub ? deedWhere(tk) : tk.deed.title}</span><span className="meta">{forMe(tk) && <b className="assign-tag">{t("поручено вам")}</b>}{[deedAssignee(tk) && !forMe(tk) ? t("поручено: {name}", { name: memberName(deedAssignee(tk)) }) : "", tk.person ? t("кому: {name}", { name: tk.person.name }) : ""].filter(Boolean).map((x, i) => <span key={i}>{(i > 0 || forMe(tk)) && " · "}{x}</span>)}</span></div>
                {/* Ночью «Взять» не висит с текстом над списком, а по нажатию показывает подсказку окошком (решение владельца 24.10). */}
                {/* Корабельное дело — маленький значок корабля на углу кнопки «Взять», как звезда заместителя на значке роли (решение владельца 24.10), без слова. */}
                <div className="side" onClick={(e) => e.stopPropagation()}><span className="take-slot">{tk.sea && <span className="sea-badge" title={t("корабль")} aria-label={t("корабль")}><Icon name="ship" /></span>}{!canTakeNow
                  ? <HelpPopup name={t("Взять")} buttonClassName="sm" trigger={<><Icon name="scroll" />{t("Взять")}</>}><p><Icon name="moon" /> {t("Ночь: дела ждут утра. С 7:00 по местному времени дело можно взять, сдать или разведать.")}</p></HelpPopup>
                  : <button type="button" className="sm" disabled={busy || limitFull(map) || Boolean(map.deedsFrozenUntil) || Boolean(deedAssignee(tk) && !forMe(tk))} title={deedAssignee(tk) && !forMe(tk) ? t("Дело поручено другому участнику") : undefined} onClick={(e) => { e.stopPropagation(); void act(`/api/games/${id}/edge-tasks/${tk.id}/take`).then((ok) => { if (ok) notify(t("Дело взято")); }); }}><Icon name="scroll" />{t("Взять")}</button>}</span></div>
              </li>
            );
            return (
            <section className="section deeds-section">
              {deedsShown === "mine" && (mineTasks.length === 0 ? <EmptyState inline icon="scroll" text={t("Своих дел нет. Возьмите дело на вкладке «Свободные» или на карте.")} /> : byStatus(mineTasks, false))}
              {deedsShown === "team" && (ourTasks.length === 0 ? <EmptyState inline icon="scroll" text={t("У команды нет дел в работе.")} /> : byStatus(ourTasks, true))}
              {deedsShown === "free" && (freeTasks.length === 0 ? <EmptyState inline icon="scroll" text={t("Свободных дел на карте нет.")} /> : (<>
                {/* Крестик очистки — свой, в цвете игры: браузерный значок поля поиска синий (замечание владельца 15.11: «откуда этот цвет? сделать в стиле игры»). */}
                <div className="deed-search"><Icon name="search" /><input type="search" value={deedQuery} onChange={(e) => setDeedQuery(e.target.value)} placeholder={t("Найти дело")} aria-label={t("Найти дело")} enterKeyHint="search" />{deedQuery && <button type="button" className="deed-search-clear" aria-label={t("Очистить поиск")} title={t("Очистить поиск")} onClick={() => setDeedQuery("")}><Icon name="x" /></button>}</div>
                {error && <p className="error" role="alert">{error}</p>}
                {limitFull(map) && <p className="hint">{t("В сутки можно взять не больше {n} дел. Следующее — через {when}.", { n: map.deedLimit?.max ?? 0, when: untilText(map.deedLimit?.nextAt ?? Date.now()) })}</p>}
                {map.deedsFrozenUntil && <p className="hint"><Icon name="lock" />{t("Администратор закрыл вам взятие дел до {date}", { date: fmtDate(map.deedsFrozenUntil, { time: false }) })}{map.deedsFrozenReason ? ` · ${map.deedsFrozenReason}` : ""}</p>}
                {freeGroups.length === 0 ? <EmptyState inline icon="search" text={t("Ничего не найдено")} /> : (
                  <ul className="list interactive">
                    {freeGroups.map((g) => { if (g.items.length === 1) return freeRow(g.items[0]!, false); const isOpen = deedOpen.has(g.title); const toggle = () => setDeedOpen((prev) => { const next = new Set(prev); if (next.has(g.title)) next.delete(g.title); else next.add(g.title); return next; }); return (
                      <Fragment key={g.title}>
                        {/* Одинаковые дела — одной строкой со счётчиком «×N»; нажатие раскрывает их по местам на карте. */}
                        <li className={"deed-group" + (isOpen ? " open" : "")} role="button" tabIndex={0} aria-expanded={isOpen} onClick={toggle} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}>
                          <div className="main"><span className="title">{g.items.some(deedPriority) && <Icon name="flame" className="prio-flame" title={t("Приоритет капитана")} />}{g.title}</span>{g.items.some(forMe) && <span className="meta"><b className="assign-tag">{t("поручено вам")}</b></span>}</div>
                          <div className="side"><span className="count-chip">×{g.items.length}</span><Icon name={isOpen ? "chevron-up" : "chevron-down"} className="chev" /></div>
                        </li>
                        {isOpen && g.items.map((tk) => freeRow(tk, true))}
                      </Fragment>
                    ); })}
                  </ul>
                )}
              </>))}
            </section>
            );
          })()}
          {menuView === "battles" && (
            <section className="section">
            {battlesList.length === 0 ? <EmptyState inline icon={battlesShown === "defense" ? "shield" : "wave"} text={battlesPhaseShown === "done" ? (battlesShown === "defense" ? t("Завершённых испытаний ваших городов нет.") : t("Завершённых вызовов нет.")) : battlesShown === "defense" ? t("Вызовов нашим городам сейчас нет.") : t("Наших вызовов сейчас нет.")} /> : (
              <WithNow>{(now) => (
              <ul className="list interactive">
                {battlesList.map((b) => {
                  const attacker = b.attacker.id === team.id;
                  // Отсчёт идёт только пока сторона учит: после «Отправить на проверку» часы стоят (стоп-часы на сервере), и срок не показывается.
                  const deadline = b.status === "ATTACK" && (!b.attackDoneAt || isLaunching(b)) ? b.attackDeadline : b.status === "DEFENSE" && !b.defenseDoneAt ? b.defenseDeadline : null;
                  const meta = [deadline ? t("осталось {t}", { t: leftText(deadline, now) }) : "", isMyTurn(b, team.id) ? t("ваш ход") : "", !deadline && b.resolvedAt ? fmtDate(b.resolvedAt, { time: false }) : ""].filter(Boolean).join(" · ");
                  // Союзник хранителей: до чужого города команда могла не дойти, поэтому карточка испытания — прямо здесь.
                  if (b.myAlliance && !attacker && b.defender.id !== team.id) return <li key={b.id} className="plain"><BattleCard gameId={id} b={b} teamId={team.id} isCaptain={isCaptain || me?.role === "DEPUTY"} canAlly={isLeader || me?.gameRole === "AMBASSADOR"} now={now} daytime={map.daytime} members={forMembers} meId={user?.id} canFor={canMarkFor} onChanged={() => void loadBattles()} /></li>;
                  return (
                    <li key={b.id} role="button" tabIndex={0} onClick={() => openCity(b.nodeKey)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCity(b.nodeKey); } }}>
                      <div className="main">
                        <span className="title">{t("Испытание · {city}", { city: bookName(b.bookCode) })}</span>
                        {meta && <span className="meta">{meta}</span>}
                        <TrialFlow b={b} teamId={team.id} now={now} compact />
                      </div>
                      <Chip tone={battleTone(b.status, attacker)}>{BATTLE_STATUS[b.status]}</Chip>
                    </li>
                  );
                })}
              </ul>
              )}</WithNow>
            )}
          
            </section>
          )}
          {menuView === "standings" && (
            <section className="section">
            {standingsTab === "awards" && (!awards ? <LoadingState rows={2} /> : (<>
              <TeamAwardsBlock data={awards} />
              <AwardRating
                title={t("Рейтинг наград команд")}
                help={t("Все команды игры по числу наград с повторами. Строку значков можно листать. Нажмите значок — условие и дата.")}
                empty={t("Наград пока нет.")}
                rows={awards.teams.map((tm) => ({ key: tm.id, name: tm.name, awards: tm.awards, me: tm.id === awards.teamId, tag: tm.id === awards.teamId ? t("ваша команда") : tm.out ? t("выбыла") : undefined, muted: tm.out, who: <TeamAvatar name={tm.name} color={tm.color} avatarId={tm.avatarId} size="sm" title={tm.name} teamId={tm.id} /> }))} />
            </>))}
            {standingsTab === "rating" && <StandingsList standings={standings} teamId={team.id} open={openStanding} setOpen={setOpenStanding} peace={peace} roster={<Roster onShowOnMap={showOnMap} embedded team={team} isCaptain={isCaptain} onRole={setGameRole} onDeputy={setDeputy} />} />}

            </section>
          )}
          {/* Проходов в «Командах» больше нет (решение владельца 15.11): запросы через наш город — в профиле этого города, раздел
              «Проходы»; наши запросы — в чужом городе, раздел «Проход»; счёт запросов между командами — в профиле команды. */}
          {menuView === "standings" && standingsTab === "rating" && me?.gameRole === "AMBASSADOR" && <TradesSection gameId={id} onChanged={() => { void loadMap(); void loadStandings(); }} />}
          {menuView === "feed" && <FeedSection gameId={id} version={feedVersion} onOpenTask={(tid) => { if (map.tasks.some((tk) => tk.id === tid)) showOnMap(tid); else notify(t("Дело уже не на карте"), "info"); }} />}
          {menuView === "service" && <MyServiceSection gameId={id} version={feedVersion} awards={awards} tab={serviceTab} />}
          </div>
        </aside>
      )}

      <div className={"map-area" + (storm.active ? " storm" : "")} ref={setMapEl} onPointerDownCapture={(e) => {
        // Нажатие по самой карте закрывает панель раздела на компьютере; нажатия внутри листа (дело, город, метка) и по его
        // фону панель не трогают (владелец 25.10: «закрываю дело на крестик — список слева тоже закрывается, так не нужно»).
        // Панель разделов и шапка — не карта: их кнопки сами переключают раздел (решение владельца 15.11: разделы видны всегда).
        if (wide && menuView !== "home" && !(e.target as HTMLElement).closest(".overlay-backdrop, .team-dock, .hud-left, .hud-right")) setMenuView("home");
      }}>
        {storm.active ? (
          /* Шторм: карта без действий — ни дел, ни городов, ни меток, ни высадки (решение владельца 24.10). Единственная кнопка — назад в «Мои игры». */
          <>
            <TeamMap map={map} bird={bird} teamIndex={team.index} selectedTaskId={null} onSelect={NOOP} onSelectCity={NOOP} storm={storm} />
            <Link to="/" className="secondary icon hud-btn storm-back" aria-label={t("Мои игры")} title={t("Мои игры")}><Icon name="back" /></Link>
          </>
        ) : (
        <TeamMap myId={user?.id} map={shownMap ?? map} bird={historyAt ? null : bird} teamIndex={team.index} selectedTaskId={selectedId} onSelect={mapOn.select} onSelectCity={mapOn.city} focusTask={focusTask} storm={storm}
          landing={landing} onLand={mapOn.land}
          onMark={mapOn.mark} onMarkTap={mapOn.markTap}
          onFrontierTap={/* серые точки края тумана видит только разведчик (решение владельца 05.10): остальным они не нужны и мешают */ me?.gameRole === "SCOUT" ? mapOn.frontier : undefined}
          onSelectQuarry={mapOn.quarry}
          onSelectWreck={mapOn.wreck} />
        )}
        {quarryOpen && <QuarrySheet gameId={id} container={mapEl} onClose={() => setQuarryOpen(false)} />}
        {wreckId && !storm.active && (() => {
          const w = (map.wrecks ?? []).find((x) => x.id === wreckId);
          if (!w) return null;
          return <WreckSheet gameId={id} wreck={w} container={mapEl} canWork={isLeader || me?.gameRole === "CHRONICLER"} canTake={phase !== "night" || Boolean(map?.daytime?.tasksOpen)} asleep={phase === "night"} members={(team.members ?? []).map((mm) => ({ id: mm.user.id, name: mm.user.displayName ?? mm.user.nickname }))} onClose={() => setWreckId(null)} onChanged={() => void loadMap()} />;
        })()}
        {!storm.active && (
          <nav className="admin-dock team-dock" aria-label={t("Разделы")}>
            {dockItems.map((m) => { const n = menuCounts[m.key] ?? 0; return (
              <button key={m.key} type="button" className={"dock-btn" + (menuView === m.key ? " on" : "")} aria-pressed={menuView === m.key} onClick={() => { if (menuView === m.key) { rememberScroll(); setMenuView("home"); } else openView(m.key); }}>
                <Icon name={m.icon} /><span className="lbl">{(m.short ?? m.label)()}</span>
                {n > 0 && <span className={"badge" + (m.hot ? " hot" : "")}>{n}</span>}
              </button>
            ); })}
          </nav>
        )}
        {map.startedAt && <div className="team-timeline"><TimelineClock moves={moves} startedAt={map.startedAt} at={historyAt} onChange={(d) => { setHistoryAt(d); setSelectedId(null); }} /></div>}
        {landingTask && (
          <div className="finish-banner landing-banner" role="status">
            <Icon name="ship" /><span>{canLand ? t("Выберите береговой узел другого острова: где там город, заранее не видно") : t("Кормчий выбирает место высадки")}</span>
            <button type="button" className="ghost sm" onClick={() => setLandingId(null)}>{t("Позже")}</button>
          </div>
        )}
        <div className="hud-left">
          <Link to="/" className="btn secondary icon hud-btn" aria-label={t("Мои игры")} title={t("Мои игры")}><Icon name="back" /></Link>
          {/* Кнопка команды открывает профиль команды; маленькая стрелка показывает, что она нажимается (решение владельца 15.11). */}
          <button type="button" className="hud-team" aria-label={team.name} onClick={() => setProfileTeam({ id: team.id, name: team.name, color: team.color, avatarId: team.avatarId })}>
            <TeamAvatar name={team.name} color={team.color} avatarId={team.avatarId} zoom={false} /><span className="name">{team.name}</span><Icon name="chevron" className="go" />
          </button>
          {/* Время суток (решение владельца 03.10): ночью только карта, утром отправляют вызов — подсказка у названия команды. */}
          {/* Время суток в шапке — только на компьютере, плашкой с текстом. На телефоне знака ночи и дня в шапке нет (решение
              владельца 15.11: «убрать вообще оттуда значок ночи и дня, тем более наползают друг на друга»): ночь видна по карте,
              а что сейчас нельзя сделать, говорит подсказка у кнопки. */}
          {wide && phase === "night" && <span className="hud-tod night" title={t("Ночь: города спят, дела и испытания ждут утра")}><Icon name="moon" />{t("Ночь до 7:00")}</span>}
          {wide && phase === "morning" && <span className="hud-tod morning" title={t("Утро: вызов на город отправляют на проверку до 9:00")}><Icon name="sun" />{t("Утро до 9:00")}</span>}
        </div>
        {/* Серия дней (решение владельца 29.10): плашка при заходе раз в игровые сутки; в день рубежа — праздник со значком. */}
        {streakShow && awards && !milestone && !selectedId && <StreakBanner streak={awards.streak} celebrate={streakLit} onOpen={() => { closeStreak(); openAwards(); }} onClose={closeStreak} />}
        {/* Огонёк серии в шапке карты (решение владельца 31.10): горит, если сегодняшний день засчитан; нажатие открывает награды. */}
        {/* Колокольчик «Внимание» — в шапке, прозрачный, как остальные кнопки над картой (решение владельца 15.11); число — сколько ждёт действия. */}
        <div className="hud-right">
          <button type="button" className={"btn secondary icon hud-btn hud-bell" + (menuView === "attention" ? " on" : "")} aria-pressed={menuView === "attention"} aria-label={attention > 0 ? t("Внимание: {n}", { n: attention }) : t("Внимание")} title={t("Внимание")} onClick={() => { if (menuView === "attention") closeMenu(); else openView("attention"); }}>
            <Icon name="bell" />{attention > 0 && <span className="count-chip hot">{attention}</span>}
          </button>
          {awards && (
            <button type="button" className={"hud-streak" + (awards.streak.today ? " lit" : "")} onClick={openAwards} aria-label={t("Серия: {n}", { n: plural(awards.streak.current, ["день подряд", "дня подряд", "дней подряд"]) })} title={awards.streak.today ? t("Сегодня засчитан") : t("Сегодня ещё не засчитан")}>
              <FlameIcon lit={awards.streak.today} size="sm" /><b>{awards.streak.current}</b>
            </button>
          )}
        </div>
        {milestone && <MilestoneCard code={milestone} onOpen={() => { closeMilestone(); openAwards(); }} onClose={closeMilestone} />}
        {standings?.status === "FINISHED" && (
          <div className="finish-banner" role="status"><Icon name="trophy" /><span>{winner ? t("Игра завершена: победила «{team}»", { team: winner }) : t("Игра завершена")}</span></div>
        )}

        {markAt && (
          <Sheet size="sm" container={mapEl} title={t("Метка на карте")} onClose={() => setMarkAt(null)} foot={<><button type="button" className="ghost icon" aria-label={t("Отмена")} title={t("Отмена")} onClick={() => setMarkAt(null)}><Icon name="x" /></button><button type="button" disabled={busy} onClick={() => void putMark()}><Icon name="pin" />{t("Поставить")}</button></>}>
            <p className="muted">{t("Метку увидят все в команде, с вашим именем. Изменить подпись или убрать её сможете только вы, нажатием на флажок.")}</p>
            <div className="field"><label htmlFor="mark-note">{t("Подпись")} <span className="opt">{t("необязательно")}</span></label><input id="mark-note" maxLength={40} value={markNote} onChange={(e) => setMarkNote(e.target.value)} placeholder={t("птицы сели здесь")} /></div>
            {underClouds(markAt) && <label className="check mark-drop" htmlFor="mark-drop"><input id="mark-drop" type="checkbox" checked={markDrop} onChange={(e) => setMarkDrop(e.target.checked)} /><span>{t("Убрать метку, когда здесь откроются облака")}</span></label>}
          </Sheet>
        )}
        {editMark && (
          <Sheet size="sm" container={mapEl} title={t("Метка на карте")} onClose={() => setEditMark(null)} foot={<><button type="button" className="secondary" disabled={busy} onClick={() => { const mk = editMark; setEditMark(null); void removeMark(mk); }}><Icon name="trash" />{t("Убрать")}</button><button type="button" disabled={busy} onClick={() => void saveMark()}><Icon name="check" />{t("Сохранить")}</button></>}>
            <p className="muted">{editMark.createdAt ? t("Ваша метка, поставлена {when}.", { when: fmtDate(editMark.createdAt) }) : t("Ваша метка.")}</p>
            <div className="field"><label htmlFor="mark-edit-note">{t("Подпись")} <span className="opt">{t("необязательно")}</span></label><input id="mark-edit-note" maxLength={40} value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder={t("птицы сели здесь")} /></div>
            {underClouds(editMark) && <label className="check mark-drop" htmlFor="mark-edit-drop"><input id="mark-edit-drop" type="checkbox" checked={editDrop} onChange={(e) => setEditDrop(e.target.checked)} /><span>{t("Убрать метку, когда здесь откроются облака")}</span></label>}
          </Sheet>
        )}
        {/* Кому поручить дело (решение владельца 14.11): состав команды; у каждого — сколько дел сейчас в работе. Нажатие поручает сразу. */}
        {assignFor && (() => {
          const tk = map.tasks.find((x) => x.id === assignFor);
          if (!tk || tk.status !== "OPEN") return null;
          const cur = deedAssignee(tk);
          return (
            <Sheet size="sm" container={mapEl} title={t("Кому поручить дело")} onClose={() => setAssignFor(null)} className="assign-sheet"
              foot={cur ? <button type="button" className="secondary" disabled={assignBusy} onClick={() => void assign(tk.id, null)}><Icon name="x" />{t("Снять поручение")}</button> : undefined}>
              <p className="muted">{t("«{title}» — участнику придёт уведомление, и сутки взять это дело сможет только он.", { title: tk.deed.title })}</p>
              <ul className="list assign-list">
                {(team.members ?? []).filter((mm) => mm.user.id !== user?.id).map((mm) => {
                  const name = mm.user.displayName ?? mm.user.nickname, n = mm.activeDeeds?.length ?? 0, full = limitFull(mm);
                  return (
                    <li key={mm.user.id}>
                      <div className="main"><div className="person"><UserAvatar name={name} avatarId={mm.user.avatarId} zoom={false} />
                        <span className="who"><span className="name">{name}</span>
                          <span className="meta">{[n > 0 ? t("дел в работе: {n}", { n }) : t("дел в работе нет"), full ? t("лимит дел на сегодня исчерпан") : "", mm.deedsFrozenUntil && Date.parse(mm.deedsFrozenUntil) > Date.now() ? t("взятие дел закрыто администратором") : ""].filter(Boolean).join(" · ")}</span></span></div></div>
                      {/* Нажатие поручает сразу, поэтому у каждого — явная кнопка, а не стрелка «дальше» (замечание сверки 14.11). */}
                      <div className="side">{cur === mm.user.id ? <Chip tone="solid" icon="user-plus">{t("поручено")}</Chip>
                        : <button type="button" className="secondary sm" disabled={assignBusy} onClick={() => void assign(tk.id, mm.user.id)}><Icon name="user-plus" />{t("Поручить")}</button>}</div>
                    </li>
                  );
                })}
              </ul>
            </Sheet>
          );
        })()}
        {frontierKey && (() => {
          const pk = peekedKind(frontierKey);
          return (
            <Sheet size="sm" container={mapEl} title={t("Край тумана")} onClose={() => setFrontierKey(null)}>
              <p className="muted">{t("Дороги с делом сюда пока нет.")}</p>
              {error && <p className="error" role="alert">{error}</p>}
              {/* Ночью кнопка на месте, по нажатию — подсказка о ночи; отдельной строки со знаком месяца нет (решение владельца 15.11). */}
              {me?.gameRole === "SCOUT" && !pk && <div className="actions deed-acts"><SquareAction icon="telescope" disabled={busy} asleep={phase === "night" ? t("Ночь: разведка ждёт утра, с 7:00 по местному времени.") : undefined} label={t("Разведать")} help={SCOUT_HELP()} onClick={() => void peek(frontierKey)} /></div>}
              {me?.gameRole !== "SCOUT" && !pk && <p className="hint">{t("Разведать этот перекрёсток может разведчик команды.")}</p>}
            </Sheet>
          );
        })()}
        {cityKey && <CityPopup gameId={id} nodeKey={cityKey} teamId={team.id} onTrade={me?.gameRole === "AMBASSADOR" && map.status === "ACTIVE" ? () => setTradeCity(cityKey) : undefined} isCaptain={isCaptain || me?.role === "DEPUTY"} canAlly={isLeader || me?.gameRole === "AMBASSADOR"} members={forMembers} meId={user?.id} canFor={canMarkFor} version={cityVersion} container={mapEl} onClose={() => setCityKey(null)} onChanged={() => { void loadMap(); void loadBattles(); void loadPassages(); }} />}
        {tradeCity && <TradeProposeSheet gameId={id} offerKey={tradeCity} container={mapEl} onClose={() => setTradeCity(null)} onDone={() => { void loadMap(); void loadStandings(); }} />}

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
          // «Разведать» — такая же квадратная кнопка со значком и «?», как остальные действия дела (решение владельца 14.11).
          // Ночью кнопки те же, что днём (решение владельца 15.11): нажатие показывает подсказку о ночи, строки со знаком месяца нет.
          const NIGHT_ALL = t("Ночь: дела ждут утра. С 7:00 по местному времени дело можно взять, сдать или разведать.");
          const NIGHT_EVENING = t("До 0:00 дело можно взять; сдать и разведать — с 7:00 по местному времени.");
          const scoutBtn = canScout && <SquareAction icon="telescope" disabled={busy} asleep={night ? (canTake ? NIGHT_EVENING : NIGHT_ALL) : undefined} label={t("Разведать")} help={SCOUT_HELP()} onClick={() => void peek(task.toKey)} />;
          // Порядок листа (решение владельца 18.09): суть → как сдать → состояние → действие → правила (кодекс).
          const mine = Boolean(task.takenById) && task.takenById === user?.id;
          // Поручение (решение владельца 14.11): кому поручено свободное дело, пока держится бронь.
          const assignee = deedAssignee(task), assignedToMe = assignee !== null && assignee === user?.id;
          const longDesc = (task.deed.description?.length ?? 0) > 140 && !mine;
          return (
            <Sheet size="sm" container={mapEl} onClose={closeTask} onDismiss={backTo ? dismissTask : undefined} closeLabel={backTo ? t("Назад к списку") : undefined} className="deed-sheet" head={<div className="sheet-title"><h2>{task.deed.title}</h2>{/* Приоритет капитана (решение владельца 14.11): огонёк в шапке карточки, пояснение и кто отметил — по нажатию на него («текст спрятать и показывать только при нажатии на огонёк»). */}{deedPriority(task) && <HelpPopup name={t("Приоритет капитана")} className="prio-mark" trigger={<Icon name="flame" />}><p>{t("Приоритет капитана: это дело — в первую очередь")}{task.priorityById && memberName(task.priorityById) ? <> · {t("отметил: {name}", { name: memberName(task.priorityById) })}</> : null}</p></HelpPopup>}{/* У свободного дела значка состояния нет (решение владельца 14.11: «это и так понятно» — по кнопке «Взять дело»); в работе, на проверке, принято, возвращено — показываются. */}{task.status !== "OPEN" && <Chip tone={st.tone} icon={st.icon}>{st.label}</Chip>}</div>}>
              {/* Приоритет капитана (решение владельца 14.11): капитан или заместитель отмечает дело — его свиток на карте горит у всей команды. */}
              {task.person && <p className="meta-line mt-2 person-line"><Icon name="user" />{t("Кому: {name}", { name: task.person.name })}</p>}
              {/* Поручение (решение владельца 14.11): одна строка — кому поручено и до какого времени держится бронь; адресату — кто поручил. */}
              {assignee && <p className={"meta-line mt-2 assign-line" + (assignedToMe ? " me" : "")}><Icon name="user-plus" /><span>{assignedToMe
                ? <>{t("Поручено вам")}{memberName(task.assignedById ?? null) ? <> · {t("поручил: {name}", { name: memberName(task.assignedById ?? null) })}</> : null}</>
                : t("Поручено: {name}", { name: memberName(assignee) })}{task.assignedUntil && <> · {assignedToMe ? t("взять до {time}", { time: fmtDate(task.assignedUntil) }) : t("до {time} взять может только он", { time: fmtDate(task.assignedUntil) })}</>}</span></p>}
              {/* Чем сдавать — только у взятого дела (решение владельца 14.11): у свободного это лишнее; «можно издалека» убрано совсем. */}
              {(task.status !== "OPEN" || taker || task.deed.secret || task.sea) && (
              <p className="meta-line mt-2">
                {task.status !== "OPEN" && <><Icon name={proof.icon} />{t("Сдать")}: {proof.label()}</>}
                {taker && <>{task.status !== "OPEN" && " · "}<Icon name="user" />{t("Взял: {name}", { name: taker })}</>}
                {task.deed.secret && <><Chip icon="lock">{t("тайное")}</Chip><Help>{t("Сдачу видят только вы и проверяющий.")}</Help></>}
                {task.sea && <><Chip icon="ship">{t("корабль")}</Chip><Help>{t("После одобрения кормчий выберет место высадки на любом береговом узле другого острова. Где там город, заранее не видно. Капитан и команда ему советуют.")}</Help></>}
              </p>
              )}
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
                    {task.links.length > 0 && <div className="proof-links"><LinkList links={task.links} kind={linkKind(task.deed.proofType)} /></div>}
                    {task.note && <p className="report-text">{task.note}</p>}
                  </div>
                );
              })()}
              {task.status === "REJECTED" && <div className="note bad"><Icon name="alert" /><span>{task.adminComment ? t("Администратор вернул дело: «{comment}». Исправьте и сдайте снова.", { comment: task.adminComment }) : t("Администратор вернул дело. Исправьте и сдайте снова.")}</span></div>}
              {/* Плашек «На проверке у администратора» и «Разведано…» нет (решение владельца 14.11): первое повторяет значок
                  состояния в шапке, второе видно на карте — разведанное место остаётся открытым. */}
              {error && <p className="error" role="alert">{error}</p>}
              {/* Действия дела — ряд квадратных кнопок со значками внизу справа (решение владельца 14.11): слева направо «на карте»,
                  «приоритет» (капитан и заместитель), «вымостить», «взять дело»; у каждой в правом верхнем углу маленький «?» —
                  что делает кнопка. Каменоломня (решение владельца 04.10): камень мостит свободную сухопутную сторону — капитан,
                  заместитель или летописец; возвращённое дело — тоже (05.11). Кнопки друг от друга не зависят. */}
              {(() => {
                const free = task.status === "OPEN" || task.status === "REJECTED";
                // Порученное дело, пока держится бронь, берёт только адресат.
                const showTake = free && (!assignee || assignedToMe);
                // Поручить свободное дело может капитан или заместитель; у порученного кнопка нажата — по ней сменить адресата или снять.
                const showAssign = isLeader && task.status === "OPEN";
                const showPave = showTake && !task.sea && (map?.team.stones ?? 0) > 0 && (isCaptain || me?.role === "DEPUTY" || me?.gameRole === "CHRONICLER");
                const showPrio = isLeader && task.status !== "APPROVED" && !task.paved;
                const prioOn = Boolean(task.priorityAt);
                const mapBtn = <SquareAction icon="map" label={t("Посмотреть на карте")} help={t("Карточка закроется, а карта покажет сторону, на которой стоит это дело.")}
                  onClick={() => { /* лист закрывается, карта центрируется на стороне дела (владелец 25.10) */ setBackTo(null); setSelectedId(null); setFocusTask({ id: task.id, nonce: Date.now() }); }} />;
                const prioBtn = showPrio && <SquareAction icon="flame" className="prio" on={prioOn} disabled={prioBusy} label={prioOn ? t("Снять приоритет") : t("Отметить приоритетным")}
                  help={t("Приоритетное дело видит вся команда: его свиток на карте горит. Отметить и снять может капитан или заместитель. Когда дело примут, отметка снимется сама.")}
                  onClick={() => void setPriority(task.id, !prioOn)} />;
                // Взятое дело с формой сдачи (решение владельца 15.11): «кто ещё участвовал» и «вставить ссылку» — квадратные кнопки
                // в этом же ряду, справа от карты и разведки; ряд рисует сама форма (у неё выбранные участники и ссылки).
                // Форма только у взявшего, капитана, заместителя и летописца (замечание владельца 10.10: остальные видели чужую сдачу).
                if (task.status === "TAKEN" && (mine || isLeader || me?.gameRole === "CHRONICLER")) return (
                  <DeedForm key={task.id} busy={busy} proofType={task.deed.proofType} lead={<>{mapBtn}{scoutBtn}{prioBtn}</>} asleep={night ? t("Ночь: сдать дело можно с 7:00 по местному времени.") : undefined}
                    asleepRelease={!canTake ? t("Ночь: отказаться от дела можно до 0:00 и снова с 7:00 по местному времени.") : undefined}
                    members={(team.members ?? []).filter((mm) => mm.user.id !== (task.takenById ?? user?.id)).map((mm) => ({ id: mm.user.id, name: mm.user.displayName ?? mm.user.nickname }))}
                    main={isLeader || me?.gameRole === "CHRONICLER" ? { options: (team.members ?? []).map((mm) => ({ id: mm.user.id, name: mm.user.displayName ?? mm.user.nickname })), initial: task.takenById ?? user?.id ?? "" } : undefined}
                    onSubmit={(body) => act(`/api/games/${id}/edge-tasks/${task.id}/submit`, body).then((ok) => { if (ok) notify(t("Сдано на проверку")); return ok; })}
                    onRelease={() => void release(task)} />
                );
                return (
                  <div className="actions deed-acts">
                    {/* Порядок (решение владельца 15.11): карта, разведка, затем остальные; крайней справа остаётся «Взять дело». */}
                    {mapBtn}
                    {scoutBtn}
                    {assignedToMe && <SquareAction icon="user-x" disabled={busy} label={t("Не могу взять")}
                      help={t("Поручение снимется, дело снова станет свободным для всей команды. Тот, кто поручил, узнает об отказе.")}
                      onClick={() => void declineAssign(task.id, memberName(task.assignedById ?? null))} />}
                    {showAssign && <SquareAction icon="user-plus" on={Boolean(assignee)} disabled={assignBusy} label={assignee ? t("Сменить или снять поручение") : t("Поручить дело")}
                      help={t("Выберите участника: ему придёт уведомление, которое откроет именно это дело. Сутки взять его сможет только он; если он откажется или сутки пройдут, дело снова свободно. Поручает капитан или заместитель.")}
                      onClick={() => setAssignFor(task.id)} />}
                    {prioBtn}
                    {showPave && <SquareAction icon="stone" badge={map?.team.stones} disabled={busy} asleep={night ? t("Ночь: вымостить дорогу можно с 7:00 по местному времени.") : undefined} label={t("Вымостить дорогу")}
                      help={t("Потратить один тёсаный камень из Каменоломни: сторона откроется как пройденная, дело делать не нужно. Камней у команды: {n}.", { n: map?.team.stones ?? 0 })}
                      onClick={() => void pave(task.id)} />}
                    {showTake && <SquareAction icon="scroll" primary disabled={busy || limitFull(map) || Boolean(map?.deedsFrozenUntil)} asleep={!canTake ? NIGHT_ALL : undefined} label={t("Взять дело")}
                      help={t("Дело записывается за вами: другие его взять не смогут, пока вы его не сдадите или не отпустите.")}
                      onClick={() => void act(`/api/games/${id}/edge-tasks/${task.id}/take`)} />}
                    {showTake && limitFull(map) && <p className="hint">{t("В сутки можно взять не больше {n} дел. Следующее — через {when}.", { n: map?.deedLimit?.max ?? 0, when: untilText(map?.deedLimit?.nextAt ?? Date.now()) })}</p>}
                    {showTake && map?.deedsFrozenUntil && <p className="hint"><Icon name="lock" />{t("Администратор закрыл вам взятие дел до {date}", { date: fmtDate(map.deedsFrozenUntil, { time: false }) })}{map.deedsFrozenReason ? ` · ${map.deedsFrozenReason}` : ""}</p>}
                  </div>
                );
              })()}
              {task.status === "TAKEN" && !mine && !isLeader && me?.gameRole !== "CHRONICLER" && (
                <p className="hint"><Icon name="user" />{t("Дело у другого участника: сдать или отказаться может тот, кто взял, капитан, заместитель или летописец.")}</p>
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
 * Форма сдачи дела. Живёт под key=task.id: у каждого дела свой набранный текст. Отчёт — одно поле «Что сделал и кому?»
 * (решение владельца 05.11: «объединить в одно поле… убрать „как“»; до того два вопроса, с 18.09 — три); участники дела
 * группой отмечаются галочками, каждому засчитывается в личное служение.
 */
/** Подсказка кнопки «Разведать»: что она делает и как часто. */
const SCOUT_HELP = () => t("Туман вокруг перекрёстка раздвинется, и вся команда увидит, что там: город или развилка. Место останется открытым. Разведка — раз в неделю.");

function DeedForm({ busy, proofType, members, main, lead, asleep, asleepRelease, onSubmit, onRelease }: { /** Глубокая ночь (с 0:00 до 7:00): отказаться от дела нельзя — кнопка на месте, по нажатию эта подсказка. До полуночи отказ открыт, как и взятие (решение владельца 15.11). */ asleepRelease?: string; /** Ночь: форма на месте, как днём, но «Сдать на проверку» по нажатию показывает эту подсказку (решение владельца 15.11). */ asleep?: string; /** Квадратные кнопки карточки (карта, разведка, приоритет): в одном ряду с ними стоят «кто ещё участвовал» и «вставить ссылку». */ lead?: ReactNode; /** На кого записать дело (решение владельца 22.10): капитан, заместитель и летописец выбирают основного из состава; у остальных поля нет. */ main?: { options: Array<{ id: string; name: string }>; initial: string }; busy: boolean; proofType: EdgeTaskDto["deed"]["proofType"]; members: Array<{ id: string; name: string }>; onSubmit: (body: { links: string[]; note: string; participants: string[]; mainId?: string }) => Promise<boolean>; onRelease: () => void }) {
  const [links, setLinks] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [what, setWhat] = useState("");
  const [participants, setParticipants] = useState<string[]>([]);
  const [mainId, setMainId] = useState(main?.initial ?? "");
  const others = main ? main.options.filter((m) => m.id !== mainId) : members;
  const [witness, setWitness] = useState("");
  const report = proofType === "REPORT";
  // Свидетель (решение владельца 04.10): дело подтверждает человек, который это видел; ссылки не нужны.
  const byWitness = proofType === "WITNESS";
  const noteOut = report ? what.trim()
    : byWitness ? [witness.trim() && `${t("Свидетель")}: ${witness.trim()}`, note.trim()].filter(Boolean).join("\n") : note;
  // Обязательные поля (решение владельца 14.11): пока не добавлено то, чего требует дело, сдать нельзя.
  // Фото, видео и аудиозапись — ссылка; отчёт — текст; свидетель — кто подтвердит. Сервер проверяет то же.
  const needLink = proofType === "PHOTO_LINK" || proofType === "VIDEO_LINK" || proofType === "AUDIO_LINK";
  const missing = needLink && links.length === 0 ? (proofType === "AUDIO_LINK" ? t("ссылку на аудиозапись") : t("ссылку на фото или видео"))
    : byWitness && !witness.trim() ? t("кто может подтвердить")
    : report && what.trim().length < 5 ? t("что сделали и кому")
    : null;
  // Слова «обязательно» нет (решение владельца 15.11): красная звёздочка, по нажатию на неё — объяснение.
  const must = <HelpPopup name={t("Обязательно")} className="req-star" trigger={<span aria-hidden="true">*</span>}><p>{t("Обязательное поле: без него дело не сдать.")}</p></HelpPopup>;
  return (
    <>
      {/* Ряд квадратных кнопок, по правому краю (решение владельца 15.11): карта, разведка, кто ещё участвовал, вставить ссылку. */}
      <div className="actions deed-acts">
        {lead}
        {others.length > 0 && <PeoplePicker id="deed-people" people={others} value={participants} onChange={setParticipants} empty={t("никого: делал один")}
          square={{ label: t("Кто ещё участвовал"), help: t("Отметьте тех, кто делал дело вместе с вами: оно засчитается каждому в личное служение. Делали один — никого не отмечайте.") }} />}
        {!byWitness && <LinksField label={proofType === "AUDIO_LINK" ? t("Ссылка на аудиозапись чтения целиком") : t("Ссылки на фото или видео")} links={links} onChange={setLinks}
          square={{ required: needLink, help: needLink ? t("Обязательно: без ссылки дело не сдать. Скопируйте ссылку и нажмите кнопку — она вставится из буфера обмена.") : t("Скопируйте ссылку и нажмите кнопку — она вставится из буфера обмена.") }} />}
      </div>
      {byWitness && (
        <div className="field">
          <label htmlFor="deed-witness">{t("Кто может подтвердить")} {must} <span className="opt">{t("свидетель: кто это видел или слышал")}</span></label>
          <input id="deed-witness" value={witness} onChange={(e) => setWitness(e.target.value)} maxLength={120} placeholder={t("имя и кто это, например служитель")} />
        </div>
      )}
      {main && (
        <div className="field">
          <label htmlFor="deed-main">{t("На кого записать дело")} <span className="opt">{t("кто делал: идёт в его лимит")}</span></label>
          <Picker id="deed-main" value={mainId} onChange={(v) => { setMainId(v); setParticipants((p) => p.filter((x) => x !== v)); }} options={main.options.map((m) => ({ value: m.id, label: m.name }))} />
        </div>
      )}
      {report ? (
        <div className="field"><label htmlFor="deed-q1">{t("Что сделал и кому?")} {must}</label><AutoGrow id="deed-q1" value={what} onChange={(e) => setWhat(e.target.value)} /></div>
      ) : (
        <div className="field">
          <label htmlFor="deed-note">{t("Что сделали")}</label>
          <AutoGrow id="deed-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}
      {/* «Отказаться» слева, «Сдать» справа, в один ряд (решение владельца 16.10). */}
      {missing && <p className="hint deed-missing"><Icon name="info" />{t("Чтобы сдать дело, добавьте: {what}.", { what: missing })}</p>}
      <div className="actions deed-actions">
        {asleepRelease
          ? <HelpPopup name={t("Отказаться от дела")} className="submit-asleep" buttonClassName="secondary icon asleep" trigger={<Icon name="x" />}><p className="night-pop"><Icon name="moon" /><span>{asleepRelease}</span></p></HelpPopup>
          : <button type="button" className="secondary icon" aria-label={t("Отказаться от дела")} title={t("Отказаться от дела")} disabled={busy} onClick={onRelease}><Icon name="x" /></button>}
        {asleep
          ? <HelpPopup name={t("Сдать на проверку")} className="submit-asleep" buttonClassName="asleep" trigger={<><Icon name="send" />{t("Сдать на проверку")}</>}><p className="night-pop"><Icon name="moon" /><span>{asleep}</span></p></HelpPopup>
          : <button type="button" disabled={busy || !!missing} onClick={() => void onSubmit({ links, note: noteOut, participants, mainId: main ? mainId : undefined })}><Icon name="send" />{t("Сдать на проверку")}</button>}
      </div>
    </>
  );
}

/** Состав команды: роль — пилюля с объяснением по нажатию; капитан назначает роли выбором. */
/** embedded — внутри строки таблицы команд: без заголовка (численность — значком в строке команды, решение владельца 24.10), только кнопка приглашения. */
function Roster({ team, isCaptain, onRole, onDeputy, embedded = false, onShowOnMap }: { /** «Посмотреть на карте» у дела на руках участника (просьба владельца 10.10). */ onShowOnMap?: (taskId: string) => void; team: TeamDto; isCaptain: boolean; onRole: (userId: string, role: GameRole) => void; onDeputy: (userId: string, on: boolean) => void; embedded?: boolean; }) {
  // Таймеры «следующее дело через…» тикают раз в полминуты.
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(i); }, []);
  const [open, setOpen] = useState<string | null>(null);
  /** Кому выбирают роль. Роли — на отдельном вылетающем листе (решение владельца 15.11: «выбор роли делаем через отдельный
   *  вылетающий экран с ролями»; до того ряд ролей раскрывался в строке участника). Нажатие назначает роль сразу, повторное — снимает. */
  const [pick, setPick] = useState<string | null>(null);
  const pickM = isCaptain ? team.members.find((x) => x.user.id === pick && x.role !== "CAPTAIN") : undefined;
  // Лимит смены роли — на каждого участника (решение владельца 19.10): в подсказке перечислены те, кому роль пока не сменить.
  const GAME_ROLES = (Object.keys(ROLE).filter((k) => k !== "CAPTAIN" && k !== "DEPUTY" && k !== "NONE") as GameRole[]);
  // Кнопки «Пригласить участника» здесь нет: ссылка — в профиле команды по нажатию на аватарку (решение владельца 04.11).
  return (
    <>
      {!embedded && <div className="roster-title"><h2><Icon name="users" />{team.name}<span className="count">{team.members.length}</span></h2></div>}
      <ul className="list roster">
        {team.members.map((m) => {
          const name = m.user.displayName ?? m.user.nickname;
          const roleKey: GameRole | "CAPTAIN" | "DEPUTY" = m.role === "CAPTAIN" ? "CAPTAIN" : m.role === "DEPUTY" && m.gameRole === "NONE" ? "DEPUTY" : m.gameRole;
          const r = ROLE[roleKey];
          const shown = open === m.user.id;
          const canEdit = m.role !== "CAPTAIN" && isCaptain;
          const picking = canEdit && pick === m.user.id;
          return (
            <li key={m.user.id}>
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
            </li>
          );
        })}
      </ul>
      {pickM && (
        <Sheet size="sm" className="role-sheet" title={t("Роль: {name}", { name: pickM.user.displayName ?? pickM.user.nickname })} onClose={() => setPick(null)}>
          {/* Лист ролей (замечание владельца 15.11): плашка роли с «?» в правом верхнем углу — что за роль; справа кружок,
              заполненный у выданной роли и пустой у остальных. Описаний в строке и нижней подсказки про нажатия нет.
              Нажатие на строку назначает роль сразу, повторное — снимает. */}
          <div className="role-list" role="group" aria-label={t("Роль: {name}", { name: pickM.user.displayName ?? pickM.user.nickname })}>
            {[...GAME_ROLES.map((k) => ({ key: k as string, icon: ROLE[k].icon, label: ROLE[k].label(), hint: ROLE[k].hint(), on: k === pickM.gameRole, act: () => onRole(pickM.user.id, k === pickM.gameRole ? "NONE" : k) })),
              { key: "DEPUTY", icon: "star", label: (() => { const w = t("заместитель"); return w.charAt(0).toLocaleUpperCase() + w.slice(1); })(), hint: t("Ведёт команду вместе с капитаном: вызовы, ставки, столица, высадка."), on: pickM.role === "DEPUTY", act: () => onDeputy(pickM.user.id, pickM.role !== "DEPUTY") }].map((o) => (
              <div key={o.key} className={"role-row" + (o.on ? " on" : "") + (o.key === "DEPUTY" ? " extra" : "")} role="button" tabIndex={0} aria-pressed={o.on} aria-label={o.label}
                onClick={() => { setPick(null); o.act(); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPick(null); o.act(); } }}>
                <span className="role-chip"><Chip tone={o.on ? "solid" : "neutral"} icon={o.icon}>{o.label}</Chip><HelpPopup name={o.label} className="chip-help"><p><b>{o.label}.</b> {o.hint}</p></HelpPopup></span>
                <span className="radio" aria-hidden="true" />
              </div>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}

/** Лимит дел в сутки исчерпан: кнопка «Взять дело» гаснет, подсказка говорит, когда можно снова. */
const limitFull = (m: { deedLimit?: { max: number; taken: number } | null } | null): boolean => Boolean(m?.deedLimit && m.deedLimit.taken >= m.deedLimit.max);
