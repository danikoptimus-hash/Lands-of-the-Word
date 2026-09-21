import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BOOKS } from "@lotw/domain";
import { api, ApiError, type BattleDto, type EdgeTaskDto, type EdgeTaskStatus, type GameRole, type MyMapDto, type StandingsDto, type TeamDto } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useGameEvents } from "../lib/useGameEvents";
import { TeamMap } from "./TeamMap";
import { CityPopup } from "./CityPopup";
import { BATTLE_STATUS, battleTone, isMyTurn, leftText } from "./BattlePanel";
import { DiplomacyMenu, type PassagesDto } from "./Diplomacy";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { fmtDate, plural } from "../lib/format";
import { Icon } from "../components/Icon";
import { Back } from "../components/Back";
import { Chip, type ChipTone } from "../components/Chip";
import { Sheet } from "../components/Sheet";
import { Help } from "../components/Help";
import { FeedSection, MyServiceSection, PeaceSection } from "./Journal";
import { TeamAvatar } from "../components/TeamAvatar";
import { EmptyState, ErrorState, LoadingState } from "../components/State";

/** Положение команд (меню и итоги): строка раскрывается, если есть испытания или города на пути. */
/** Таблица команд; у своей команды в раскрытой строке — состав (решение владельца 21.09: один раздел, а не два). */
function StandingsList({ standings, teamId, open, setOpen, roster }: { standings: StandingsDto | null; teamId: string; open: string | null; setOpen: (v: string) => void; roster?: React.ReactNode }) {
  if (!standings) return <LoadingState rows={2} />;
  if (standings.standings.length === 0) return <EmptyState inline icon="crown" text={t("Пока нечего показать.")} />;
  return (
    <ol className="standings-list">
      {standings.standings.map((st, i) => {
        const trials = st.battlesWon + st.battlesRepelled + st.battlesLost;
        const mine = st.teamId === teamId;
        const details = trials > 0 || st.citiesOnPath.length > 0 || (mine && Boolean(roster));
        const opened = open ?? teamId;
        const shown = details && opened === st.teamId;
        const toggle = () => setOpen(opened === st.teamId ? "" : st.teamId);
        return (
          <li key={st.teamId} className={"standing" + (details ? " expandable" : "")} role={details ? "button" : undefined} tabIndex={details ? 0 : undefined} aria-expanded={details ? shown : undefined}
            onClick={details ? toggle : undefined} onKeyDown={details ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } } : undefined}>
            <span className="rank">{st.teamId === standings.winnerTeamId ? <Icon name="trophy" /> : i + 1}</span>
            <div className="body">
              <div className="name">
                <TeamAvatar name={st.name} color={st.color} size="sm" withName />
                {st.status === "defeated" ? <Chip tone="bad">{t("выбыла")}</Chip> : st.teamId === standings.winnerTeamId ? <Chip tone="ok" icon="trophy">{t("победитель")}</Chip> : st.teamId === teamId ? <Chip tone="accent">{t("мы")}</Chip> : null}
                {details && <Icon name="chevron-down" className="chev" />}
              </div>
              <div className="meta">{plural(st.cities, ["город", "города", "городов"])} · {plural(st.deedsApproved, ["дело", "дела", "дел"])} · {plural(st.nodesRevealed, ["перекрёсток", "перекрёстка", "перекрёстков"])}</div>
              {shown && trials > 0 && <div className="meta">{t("Испытания {a} · {b} · {c}", { a: st.battlesWon, b: st.battlesRepelled, c: st.battlesLost })}<span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}><Help>{t("выиграли · устояли · потеряли")}</Help></span></div>}
              {shown && st.citiesOnPath.length > 0 && <div className="meta">{t("Города")}: {st.citiesOnPath.map((c) => c.name + (c.current ? "" : ` (${t("потерян")})`)).join(", ")}</div>}
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
type MenuView = "home" | "deeds" | "battles" | "standings" | "feed" | "service";
const MENU_ITEMS: Array<{ key: Exclude<MenuView, "home">; icon: string; label: () => string; hot?: boolean }> = [
  { key: "deeds", icon: "scroll", label: () => t("Дела") },
  { key: "battles", icon: "wave", label: () => t("Испытания"), hot: true },
  { key: "standings", icon: "crown", label: () => t("Команды"), hot: true },
  { key: "feed", icon: "feather", label: () => t("Летопись") },
  { key: "service", icon: "user", label: () => t("Моё служение") },
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
  PHOTO_LINK: { icon: "camera", label: () => t("Фото") }, VIDEO_LINK: { icon: "video", label: () => t("Видео") },
  REPORT: { icon: "edit", label: () => t("Отчёт") },
};
/** Кодекс дела (решение владельца 18.09): пять правил, свёрнуты под значком, чтобы не занимать место. */
const CODEX = () => [
  t("Дело делается ради человека, а не ради стороны на карте: не для галочки."),
  t("Людей фотографировать только с их согласия; лучше снимать предмет, результат или записку."),
  t("Угощать, помогать и навещать — не участников этой игры."),
  t("В отчёте честно: что сделал, кому и как, что тебя тронуло."),
  t("Чужое дело как своё не сдаётся; если делали группой — отметьте всех участников."),
];
/** Роли: подпись, иконка и одно предложение из правил (2.15) — показывается по нажатию на пилюлю. */
const ROLE: Record<GameRole | "CAPTAIN" | "DEPUTY", { icon: string; label: () => string; hint: () => string }> = {
  CAPTAIN: { icon: "crown", label: () => t("капитан"), hint: () => t("Бросает вызов и отвечает на испытания, переносит столицу, назначает заместителя и просит роли у администратора.") },
  DEPUTY: { icon: "star", label: () => t("заместитель"), hint: () => t("Всё, что может капитан, кроме назначения ролей: вызов, ответ, столица, высадка.") },
  SCOUT: { icon: "telescope", label: () => t("Разведчик"), hint: () => t("Раз в неделю может разведать, что за стороной: город или развилка.") },
  PROPHET: { icon: "sparkle", label: () => t("Пророк"), hint: () => t("Раз в неделю открывает подсказку к одному заданию города — текст района.") },
  AMBASSADOR: { icon: "handshake", label: () => t("Посол"), hint: () => t("Отправляет запросы прохода другим командам и отвечает на их запросы.") },
  CHRONICLER: { icon: "edit", label: () => t("Летописец"), hint: () => t("Сдаёт дела за команду и следит, чтобы ссылки и фото были приложены.") },
  HELMSMAN: { icon: "ship", label: () => t("Кормчий"), hint: () => t("Ведёт корабль: выбирает место высадки на другом острове.") },
  NONE: { icon: "user", label: () => t("Без роли"), hint: () => "" },
};

function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => { const mq = window.matchMedia(q); const on = () => setM(mq.matches); mq.addEventListener("change", on); return () => mq.removeEventListener("change", on); }, [q]);
  return m;
}

/** Страница команды: карта во весь экран, карточка дела, боковое меню (на широком экране — постоянная колонка). */
export function TeamPage() {
  const { id = "" } = useParams();
  const { user, logout } = useAuth();
  const { notify, confirm } = useUi();
  const wide = useMediaQuery("(min-width: 1024px)");
  const [team, setTeam] = useState<TeamDto | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [map, setMap] = useState<MyMapDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Режим высадки: id одобренного морского дела, для которого капитан выбирает узел на другом острове. */
  const [landingId, setLandingId] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [cityKey, setCityKey] = useState<string | null>(null);
  const [cityVersion, setCityVersion] = useState(0);
  /** Лента, «Моё служение» и мир перезагружаются по событиям журнала, дел, городов и испытаний. */
  const [feedVersion, setFeedVersion] = useState(0);
  const [battles, setBattles] = useState<BattleDto[]>([]);
  const [standings, setStandings] = useState<StandingsDto | null>(null);
  const [passages, setPassages] = useState<PassagesDto | null>(null);
  const [now, setNow] = useState(Date.now());
  const [gameName, setGameName] = useState("");
  const [donationCfg, setDonationCfg] = useState<{ min: number; currency: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [mapEl, setMapEl] = useState<HTMLDivElement | null>(null);
  const seenBattles = useRef<Map<string, string> | null>(null);
  /** Описание дела свёрнуто до двух строк («Подробнее»), пока дело не взято мной; при смене дела сворачивается снова. */
  const [descOpen, setDescOpen] = useState(false);
  useEffect(() => { setDescOpen(false); }, [selectedId]);
  /** Положение команд: подробности (испытания, города) раскрыты у одной команды; по умолчанию — у нашей. */
  const [openStanding, setOpenStanding] = useState<string | null>(null);
  const [menuView, setMenuView] = useState<MenuView>("home");

  const loadStandings = useCallback(() => api<StandingsDto>(`/api/games/${id}/standings`).then(setStandings).catch(() => {}), [id]);
  const loadPassages = useCallback(() => api<PassagesDto>(`/api/games/${id}/my-passages`).then(setPassages).catch(() => {}), [id]);
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

  const loadTeam = useCallback(() => api<{ isAdmin: boolean; teams: TeamDto[] }>(`/api/games/${id}/teams`).then((r) => { setError(null); setIsAdmin(r.isAdmin); setTeam(r.teams.find((tm) => tm.members.some((mm) => mm.user.id === user?.id)) ?? r.teams[0] ?? null); }).catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети"))), [id, user?.id]);
  const loadMap = useCallback(() => api<MyMapDto & { gameName?: string; donation?: { min: number; currency: string } | null }>(`/api/games/${id}/my-map`).then((m) => { setMap(m); setMapError(null); if (m.gameName) setGameName(m.gameName); setDonationCfg(m.donation ?? null); }).catch((e) => setMapError(e instanceof ApiError ? e.message : t("Ошибка сети"))), [id]);
  useEffect(() => { void loadTeam(); void loadMap(); }, [loadTeam, loadMap]);
  useEffect(() => { if (team) { void loadBattles(); void loadStandings(); void loadPassages(); } }, [team, loadBattles, loadStandings, loadPassages]);
  useGameEvents(id, (e) => {
    if (e.type === "teams" || e.type === "game") void loadTeam();
    if (e.type !== "deeds") void loadMap();
    if (e.type === "cities" || e.type === "game" || e.type === "battles") { setCityVersion((v) => v + 1); void loadPassages(); }
    if (e.type === "battles" || e.type === "game" || e.type === "submissions") void loadBattles();
    if (e.type === "game" || e.type === "cities" || e.type === "battles" || e.type === "teams") void loadStandings();
    if (e.type === "journal" || e.type === "peace" || e.type === "submissions" || e.type === "cities" || e.type === "battles" || e.type === "game") setFeedVersion((v) => v + 1);
  });
  useEffect(() => {
    const tm = setInterval(() => void loadMap(), 60000);
    const onFocus = () => void loadMap();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(tm); window.removeEventListener("focus", onFocus); };
  }, [loadMap]);

  const me = team?.members.find((m) => m.user.id === user?.id);
  const isCaptain = me?.role === "CAPTAIN";
  /** Капитан или заместитель: вызов, ответ, столица, высадка. */
  const isLeader = isCaptain || me?.role === "DEPUTY" || me?.gameRole === "HELMSMAN";
  const task = useMemo(() => (map?.tasks ?? []).find((tk) => tk.id === selectedId) ?? null, [map, selectedId]);
  const memberName = (userId: string | null) => { const m = team?.members.find((mm) => mm.user.id === userId); return m ? m.user.displayName ?? m.user.nickname : ""; };

  async function act(path: string, body?: unknown): Promise<boolean> {
    setBusy(true); setError(null);
    try { await api(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }); await loadMap(); return true; }
    catch (e) { setError(e instanceof ApiError ? (e.issues?.map((i) => i.message).join("; ") || e.message) : t("Ошибка сети")); return false; }
    finally { setBusy(false); }
  }
  const peekedKind = (key: string) => map?.peeked?.find((p) => p.key === key)?.kind ?? null;
  async function peek(nodeKey: string) {
    setBusy(true); setError(null);
    try { const r = await api<{ kind: string }>(`/api/games/${id}/my-map/peek`, { method: "POST", body: JSON.stringify({ nodeKey }) }); notify(r.kind === "CITY" ? t("Разведка: там город") : t("Разведка: там развилка"), "info"); await loadMap(); }
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
      const r = await api<{ pending?: boolean }>(`/api/games/${id}/teams/${team!.id}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ gameRole }) });
      if (r.pending) notify(t("Запрос отправлен администратору: роль назначится после одобрения"), "info");
      await loadTeam();
    }
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
      <main className="container narrow">
        <Back to="/" label={t("Мои игры")} />
        <div className="card">
          <h1>{t("Не удалось открыть команду")}</h1>
          <p className="muted mt-2">{error}</p>
          <div className="actions"><button type="button" onClick={() => { setError(null); void loadTeam(); void loadMap(); }}><Icon name="refresh" />{t("Повторить")}</button><Link className="btn secondary" to="/">{t("Мои игры")}</Link></div>
        </div>
      </main>
    );
  }
  if (!team) {
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
          <h1 className="row"><TeamAvatar name={team.name} color={team.color} size="lg" />{team.name}</h1>
          <p className="muted mt-3">{t("Вы администратор этой игры, а не участник команды. Карта команды с туманом видна только её участникам; вся карта и ход всех команд — на странице игры.")}</p>
          <div className="actions"><Link className="btn" to={`/games/${id}`}><Icon name="map" />{t("К странице игры")}</Link></div>
        </div>
      </main>
    );
  }
  if (!map) {
    return (
      <main className="container narrow">
        <Back to="/" label={t("Мои игры")} />
        <div className="card">
          <h1 className="row"><TeamAvatar name={team.name} color={team.color} size="lg" />{team.name}</h1>
          <div className="mt-3">{mapError ? <ErrorState text={mapError} onRetry={() => void loadMap()} /> : <LoadingState rows={3} />}</div>
        </div>
      </main>
    );
  }
  const winner = standings?.winnerTeamId ? standings.standings.find((s) => s.teamId === standings.winnerTeamId)?.name ?? "" : "";
  if (map.status !== "ACTIVE") {
    return (
      <main className="container narrow">
        <Back to="/" label={t("Мои игры")} />
        <div className="card">
          <h1 className="row"><TeamAvatar name={team.name} color={team.color} size="lg" />{team.name}</h1>
          {gameName && <p className="muted mt-1">{gameName}</p>}
          {map.status === "FINISHED" ? (
            <>
              <p className={"note mt-3 " + (winner ? "ok" : "")}><Icon name="trophy" /><span>{winner ? <>{t("Победила команда")} <strong>«{winner}»</strong></> : t("Победитель не определён")} · {finishReasonLabel(standings?.finishReason ?? null)}{standings?.finishedAt ? ` · ${fmtDate(standings.finishedAt)}` : ""}</span></p>
              <div className="actions"><Link className="btn secondary" to={`/games/${id}/book`}><Icon name="book" />{t("Книга сезона")}</Link></div>
            </>
          ) : (
            <>
              <p className="mt-3">{t("Игра ещё не началась. Когда администратор начнёт её, здесь появится карта.")}</p>
              {isCaptain && <p className="muted mt-2">{t("Пока можно назначить роли участникам: они дают команде разведку, подсказки и переговоры.")}</p>}
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
  const ourTasks = map.tasks.filter((tk) => tk.status === "TAKEN" || tk.status === "SUBMITTED" || tk.status === "REJECTED");
  const landingTask = landingId ? map.tasks.find((tk) => tk.id === landingId && tk.landing) ?? null : null;
  const incoming = passages?.incoming.filter((r) => r.status === "PENDING") ?? [];
  // Бейдж на кнопке меню — только то, что требует действия: возвращённое дело, входящий запрос прохода, наш ход в испытании.
  const attention = ourTasks.filter((tk) => tk.status === "REJECTED").length + incoming.length + activeBattles.filter((b) => isMyTurn(b, team.id)).length;
  const rejectedTasks = ourTasks.filter((tk) => tk.status === "REJECTED");
  const myTurnBattles = activeBattles.filter((b) => isMyTurn(b, team.id));
  const menuCounts: Partial<Record<MenuView, number>> = { deeds: ourTasks.length, battles: activeBattles.length, standings: incoming.length };

  const onTouchStart = (e: React.TouchEvent) => {
    if (wide) return;
    const tp = e.touches[0]!;
    swipe.current = { x: tp.clientX, y: tp.clientY, edge: tp.clientX < 40 || menu };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const st = swipe.current; swipe.current = null;
    if (!st || wide) return;
    const tp = e.changedTouches[0]!;
    const dx = tp.clientX - st.x, dy = tp.clientY - st.y;
    if (Math.abs(dy) > Math.abs(dx)) return;
    if (!menu && st.edge && dx > 40) setMenu(true);
    if (menu && dx < -60) setMenu(false);
  };
  const openCity = (key: string) => { setCityKey(key); setSelectedId(null); setMenu(false); };
  const openTask = (tid: string | null) => { setSelectedId(tid); if (tid) setMenu(false); };
  const menuOpen = wide || menu;

  return (
    <div className="map-screen" ref={screenRef} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {menuOpen && !wide && <div className="side-backdrop" onClick={() => setMenu(false)} />}
      {menuOpen && (
        <aside className="side-menu" role={wide ? undefined : "dialog"} aria-modal={wide ? undefined : true} aria-label={t("Меню команды")}>
          <div className="side-head" style={{ ["--team" as string]: team.color }}>
            <TeamAvatar name={team.name} color={team.color} size="lg" />
            <div className="grow"><div className="side-name">{team.name}</div><div className="muted small">{gameName || t("Игра")}{isCaptain ? ` · ${t("вы капитан")}` : ""}</div></div>
            {!wide && <button type="button" className="ghost icon" onClick={() => setMenu(false)} aria-label={t("Закрыть")}><Icon name="x" /></button>}
          </div>

          {menuView !== "home" && (
            <div className="menu-sub">
              <button type="button" className="ghost sm" onClick={() => setMenuView("home")}><Icon name="back" />{t("Меню")}</button>
              <h2>{MENU_ITEMS.find((m) => m.key === menuView)?.label()}</h2>
            </div>
          )}
          {menuView === "home" && (
            <>
              {(rejectedTasks.length > 0 || incoming.length > 0 || myTurnBattles.length > 0) && (
                <section className="section attention">
                  <h2><Icon name="bell" />{t("Требует внимания")}</h2>
                  <ul className="list interactive">
                    {rejectedTasks.map((tk) => (
                      <li key={tk.id} role="button" tabIndex={0} onClick={() => openTask(tk.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openTask(tk.id); } }}>
                        <div className="main"><span className="title">{t("Дело возвращено: {title}", { title: tk.deed.title })}</span>{tk.adminComment && <span className="meta">{tk.adminComment}</span>}</div><Icon name="chevron" className="chev" />
                      </li>
                    ))}
                    {incoming.map((r) => (
                      <li key={r.id} role="button" tabIndex={0} onClick={() => setMenuView("standings")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setMenuView("standings"); } }}>
                        <div className="main"><span className="title">{t("Запрос прохода через {book}", { book: r.bookName })}</span><span className="meta">{t("от команды «{team}»", { team: r.requester.name })}</span></div><Icon name="chevron" className="chev" />
                      </li>
                    ))}
                    {myTurnBattles.map((b) => (
                      <li key={b.id} role="button" tabIndex={0} onClick={() => openCity(b.nodeKey)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCity(b.nodeKey); } }}>
                        <div className="main"><span className="title">{t("Испытание · {city}", { city: bookName(b.bookCode) })}</span><span className="meta">{t("ваш ход")}</span></div><Icon name="chevron" className="chev" />
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <nav className="menu-grid" aria-label={t("Разделы")}>
                {MENU_ITEMS.map((m) => { const n = menuCounts[m.key] ?? 0; return (
                  <button key={m.key} type="button" onClick={() => setMenuView(m.key)}>
                    <Icon name={m.icon} />{m.label()}{n > 0 && <span className={"count-chip" + (m.hot && n > 0 ? " hot" : "")}>{n}</span>}
                  </button>
                ); })}
              </nav>
              {standings?.status === "ACTIVE" && standings.endsAt && <p className="hint menu-hint">{t("Игра идёт до {d}", { d: fmtDate(standings.endsAt) })}</p>}
            </>
          )}
          {menuView === "deeds" && (
            <section className="section">
            {ourTasks.length === 0 ? <EmptyState inline icon="scroll" text={t("Возьмите дело: нажмите метку на карте.")} /> : (
              <ul className="list interactive">
                {ourTasks.map((tk) => { const st = deedStatus(tk.status); return (
                  <li key={tk.id} role="button" tabIndex={0} onClick={() => openTask(tk.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openTask(tk.id); } }}>
                    <div className="main"><span className="title">{tk.deed.title}</span><span className="meta">{tk.deed.direction}{tk.status === "REJECTED" && tk.adminComment ? ` · ${tk.adminComment}` : ""}</span></div>
                    <Chip tone={st.tone} icon={st.icon}>{st.label}</Chip>
                  </li>
                ); })}
              </ul>
            )}
          
            </section>
          )}
          {menuView === "battles" && (
            <section className="section">
            {activeBattles.length === 0 ? <EmptyState inline icon="wave" text={t("Сейчас испытаний нет.")} /> : (
              <ul className="list interactive">
                {activeBattles.map((b) => {
                  const attacker = b.attacker.id === team.id;
                  const deadline = b.status === "ATTACK" ? b.attackDeadline : b.status === "DEFENSE" ? b.defenseDeadline : null;
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
            <StandingsList standings={standings} teamId={team.id} open={openStanding} setOpen={setOpenStanding} roster={<Roster embedded team={team} isCaptain={isCaptain} onRole={setGameRole} onDeputy={setDeputy} />} />
            {standings?.status === "ACTIVE" && standings.endsAt && <p className="hint">{t("Игра идёт до {d}", { d: fmtDate(standings.endsAt) })}</p>}
            </section>
          )}
          {menuView === "standings" && <DiplomacyMenu gameId={id} data={passages} onChanged={() => { void loadPassages(); void loadMap(); }} />}
          {menuView === "standings" && <PeaceSection gameId={id} version={feedVersion} />}
          {menuView === "feed" && <FeedSection gameId={id} version={feedVersion} />}
          {menuView === "service" && <MyServiceSection gameId={id} version={feedVersion} />}
          {menuView === "home" && (
            <nav className="menu-tiles" aria-label={t("Навигация")}>
            <Link to="/"><Icon name="home" />{t("Мои игры")}</Link>
            <Link to="/account"><Icon name="user" />{t("Аккаунт")}</Link>
            <Link to="/how-to-play"><Icon name="help" />{t("Как играть")}</Link>
            <Link to="/whats-new"><Icon name="sparkle" />{t("Что нового")}</Link>
            <button type="button" onClick={() => void logout()}><Icon name="logout" />{t("Выйти")}</button>
          </nav>
          )}
        </aside>
      )}

      <div className="map-area" ref={setMapEl}>
        <TeamMap map={map} teamIndex={team.index} selectedTaskId={selectedId} onSelect={openTask} onSelectCity={openCity}
          landing={landingTask ? { taskId: landingTask.id, candidates: landingTask.candidates ?? [] } : null} onLand={(key) => void land(key)} />
        {landingTask && (
          <div className="finish-banner landing-banner" role="status">
            <Icon name="ship" /><span>{isLeader ? t("Выберите на другом острове место высадки") : t("Капитан или кормчий выбирает место высадки")}</span>
            <button type="button" className="ghost sm" onClick={() => setLandingId(null)}>{t("Позже")}</button>
          </div>
        )}
        <div className="hud-left">
          {!wide && (
            <button type="button" className="secondary icon hud-btn" onClick={() => { setMenu(true); setSelectedId(null); }} aria-label={attention > 0 ? t("Меню · требует внимания: {n}", { n: attention }) : t("Меню")} title={t("Меню")}>
              <Icon name="menu" />{attention > 0 && <span className="count-chip hot">{attention}</span>}
            </button>
          )}
          <button type="button" className="hud-team" onClick={() => { if (!wide) { setMenu(true); setSelectedId(null); } }} aria-label={team.name}>
            <TeamAvatar name={team.name} color={team.color} /><span className="name">{team.name}</span>
          </button>
        </div>
        {standings?.status === "FINISHED" && (
          <div className="finish-banner" role="status"><Icon name="trophy" /><span>{winner ? t("Игра завершена: победила «{team}»", { team: winner }) : t("Игра завершена")}</span></div>
        )}

        {cityKey && <CityPopup gameId={id} nodeKey={cityKey} teamId={team.id} isCaptain={isCaptain || me?.role === "DEPUTY"} version={cityVersion} container={mapEl} onClose={() => setCityKey(null)} onChanged={() => { void loadMap(); void loadBattles(); void loadPassages(); }} />}

        {task && (() => {
          const st = deedStatus(task.status);
          const proof = PROOF[task.deed.proofType];
          const taker = task.takenById ? memberName(task.takenById) : "";
          const peeked = peekedKind(task.toKey);
          // Порядок листа (решение владельца 18.09): суть → как сдать → состояние → действие → правила (кодекс).
          const mine = Boolean(task.takenById) && task.takenById === user?.id;
          const longDesc = (task.deed.description?.length ?? 0) > 140 && !mine;
          return (
            <Sheet size="sm" container={mapEl} onClose={() => setSelectedId(null)} className="deed-sheet" head={<div className="sheet-title"><h2>{task.deed.title}</h2><Chip tone={st.tone} icon={st.icon}>{st.label}</Chip></div>}>
              <p className="direction">{task.deed.direction}</p>
              <p className="meta-line mt-2">
                <Icon name={proof.icon} />{t("Сдать")}: {proof.label()}
                {taker && <> · <Icon name="user" />{t("Взял: {name}", { name: taker })}</>}
                {task.deed.remote && <Chip icon="send">{t("можно издалека")}</Chip>}
                {task.deed.secret && <><Chip icon="lock">{t("тайное")}</Chip><Help>{t("Сдачу видят только вы и проверяющий.")}</Help></>}
                {task.sea && <><Chip icon="ship">{t("корабль")}</Chip><Help>{t("После одобрения капитан или кормчий выберет место высадки на другом острове.")}</Help></>}
              </p>
              {task.deed.description && <p className={"deed-desc mt-2" + (longDesc && !descOpen ? " clamp" : "")}>{task.deed.description}</p>}
              {longDesc && <button type="button" className="ghost sm desc-more" aria-expanded={descOpen} onClick={() => setDescOpen((v) => !v)}><Icon name={descOpen ? "chevron-up" : "chevron-down"} />{descOpen ? t("Свернуть") : t("Подробнее")}</button>}
              {task.landing && (isLeader
                ? <div className="actions"><button type="button" onClick={() => { setLandingId(task.id); setSelectedId(null); }}><Icon name="anchor" />{t("Выбрать место высадки")}</button></div>
                : <div className="note info"><Icon name="anchor" /><span>{t("Дело одобрено: капитан выбирает место высадки.")}</span></div>)}
              {task.status === "REJECTED" && <div className="note bad"><Icon name="alert" /><span>{task.adminComment ? t("Администратор вернул дело: «{comment}». Исправьте и сдайте снова.", { comment: task.adminComment }) : t("Администратор вернул дело. Исправьте и сдайте снова.")}</span></div>}
              {task.status === "SUBMITTED" && <div className="note info"><Icon name="clock" /><span>{t("На проверке у администратора.")}</span></div>}
              {peeked && <div className="note info"><Icon name="telescope" /><span>{peeked === "CITY" ? t("Разведано: там город.") : t("Разведано: там развилка.")}</span></div>}
              {error && <p className="error" role="alert">{error}</p>}
              {(task.status === "OPEN" || task.status === "REJECTED") && (
                <div className="actions">
                  <button type="button" disabled={busy} onClick={() => void act(`/api/games/${id}/edge-tasks/${task.id}/take`)}><Icon name="scroll" />{t("Взять дело")}</button>
                  {me?.gameRole === "SCOUT" && !peeked && <><button type="button" className="secondary" disabled={busy} onClick={() => void peek(task.toKey)}><Icon name="telescope" />{t("Разведать")}</button><Help>{t("раз в неделю")}</Help></>}
                </div>
              )}
              {task.status === "TAKEN" && (
                <DeedForm key={task.id} donationCfg={donationCfg} busy={busy} proofType={task.deed.proofType}
                  members={(team.members ?? []).filter((mm) => mm.user.id !== (task.takenById ?? user?.id)).map((mm) => ({ id: mm.user.id, name: mm.user.displayName ?? mm.user.nickname }))}
                  onSubmit={(body) => act(`/api/games/${id}/edge-tasks/${task.id}/submit`, body).then((ok) => { if (ok) notify(t("Сдано на проверку")); return ok; })}
                  onRelease={() => void release(task)} />
              )}
              <details className="disclose sm codex">
                <summary><Icon name="info" />{t("Кодекс дела")}<Icon name="chevron-down" className="chev" /></summary>
                <ol className="small muted">{CODEX().map((c, i) => <li key={i}>{c}</li>)}</ol>
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
function DeedForm({ donationCfg, busy, proofType, members, onSubmit, onRelease }: { donationCfg: { min: number; currency: string } | null; busy: boolean; proofType: EdgeTaskDto["deed"]["proofType"]; members: Array<{ id: string; name: string }>; onSubmit: (body: { links: string[]; note: string; donation: boolean; donationAmount?: number; participants: string[] }) => Promise<boolean>; onRelease: () => void }) {
  const [links, setLinks] = useState("");
  const [note, setNote] = useState("");
  const [q, setQ] = useState({ what: "", who: "", touched: "" });
  const [donation, setDonation] = useState(false);
  const [amount, setAmount] = useState("");
  const [participants, setParticipants] = useState<string[]>([]);
  const report = proofType === "REPORT" && !donation;
  const noteOut = report ? [q.what && `${t("Что сделал")}: ${q.what}`, q.who && `${t("Кому и как")}: ${q.who}`, q.touched && `${t("Что тронуло")}: ${q.touched}`].filter(Boolean).join("\n") : note;
  return (
    <>
      {donationCfg && <div className="row nowrap mt-2"><label className="check grow"><input type="checkbox" checked={donation} onChange={(e) => setDonation(e.target.checked)} />{t("Вместо дела — пожертвование (от {min} {cur})", { min: donationCfg.min, cur: donationCfg.currency })}</label><Help>{t("В кассу церкви. Сдаётся ссылка на чек или подтверждение перевода.")}</Help></div>}
      {donation && donationCfg && (
        <div className="field">
          <label htmlFor="deed-amount">{t("Сумма")}, {donationCfg.currency}</label>
          <input id="deed-amount" type="number" inputMode="numeric" min={donationCfg.min} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
      )}
      <div className="field">
        <label htmlFor="deed-links">{donation ? t("Ссылка на чек или подтверждение перевода") : t("Ссылки на фото или видео")}</label>
        <textarea id="deed-links" rows={2} value={links} onChange={(e) => setLinks(e.target.value)} placeholder={t("https://… — по одной на строку")} />
      </div>
      {report ? (
        <>
          <div className="field"><label htmlFor="deed-q1">{t("Что сделал?")}</label><textarea id="deed-q1" rows={2} value={q.what} onChange={(e) => setQ({ ...q, what: e.target.value })} /></div>
          <div className="field"><label htmlFor="deed-q2">{t("Кому и как?")} <span className="opt">{t("без фамилий")}</span></label><textarea id="deed-q2" rows={2} value={q.who} onChange={(e) => setQ({ ...q, who: e.target.value })} /></div>
          <div className="field"><label htmlFor="deed-q3">{t("Что тебя тронуло?")}</label><textarea id="deed-q3" rows={2} value={q.touched} onChange={(e) => setQ({ ...q, touched: e.target.value })} /></div>
        </>
      ) : (
        <div className="field">
          <label htmlFor="deed-note">{donation ? t("Комментарий") : t("Что сделали")}</label>
          <textarea id="deed-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}
      {!donation && members.length > 0 && (
        <div className="field">
          <span className="label">{t("Кто ещё участвовал")} <span className="opt">{t("если делали группой")}</span></span>
          <div className="chips">
            {members.map((mm) => <label key={mm.id} className="check inline"><input type="checkbox" checked={participants.includes(mm.id)} onChange={(e) => setParticipants(e.target.checked ? [...participants, mm.id] : participants.filter((x) => x !== mm.id))} />{mm.name}</label>)}
          </div>
        </div>
      )}
      <div className="actions">
        <button type="button" disabled={busy || (donation && !amount)} onClick={() => void onSubmit({ links: links.split(/\s+/).filter(Boolean), note: noteOut, donation, donationAmount: donation ? Number(amount) : undefined, participants })}><Icon name="send" />{donation ? t("Сдать пожертвование") : t("Сдать на проверку")}</button>
        <button type="button" className="secondary" disabled={busy} onClick={onRelease}>{t("Отказаться от дела")}</button>
      </div>
    </>
  );
}

/** Состав команды: роль — пилюля с объяснением по нажатию; капитан назначает роли выбором. */
/** embedded — внутри строки таблицы команд: вместо заголовка раздела — строка «Состав · N». */
function Roster({ team, isCaptain, onRole, onDeputy, embedded = false }: { team: TeamDto; isCaptain: boolean; onRole: (userId: string, role: GameRole) => void; onDeputy: (userId: string, on: boolean) => void; embedded?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const nextChange = team.roleChangeAvailableAt && Date.parse(team.roleChangeAvailableAt) > Date.now() ? team.roleChangeAvailableAt : null;
  return (
    <>
      {embedded
        ? <div className="meta roster-head"><Icon name="users" />{t("Состав")} · {team.members.length}{isCaptain && <Help>{t("Роли назначает капитан, одобряет администратор. Менять — не чаще раза в неделю.")}</Help>}</div>
        : <h2><Icon name="users" />{t("Состав")}<span className="count">{team.members.length}</span>{isCaptain && <Help>{t("Роли назначает капитан, одобряет администратор. Менять — не чаще раза в неделю.")}</Help>}</h2>}
      {isCaptain && nextChange && <p className="hint">{t("Следующая смена ролей — {d}.", { d: fmtDate(nextChange, { time: false }) })}</p>}
      <ul className="list roster">
        {team.members.map((m) => {
          const name = m.user.displayName ?? m.user.nickname;
          const roleKey: GameRole | "CAPTAIN" | "DEPUTY" = m.role === "CAPTAIN" ? "CAPTAIN" : m.role === "DEPUTY" && m.gameRole === "NONE" ? "DEPUTY" : m.gameRole;
          const r = ROLE[roleKey];
          const shown = open === m.user.id;
          const canEdit = m.role !== "CAPTAIN" && isCaptain;
          return (
            <li key={m.user.id}>
              <div className="main">
                <div className="person"><span className="avatar">{name.slice(0, 1).toUpperCase()}</span><span className="name">{name}</span>{m.role === "DEPUTY" && m.gameRole !== "NONE" && <Chip tone="accent" icon="star">{t("заместитель")}</Chip>}</div>
                {m.pendingRole && <p className="mt-1"><Chip tone="warn" icon="clock">{t("{role} · ждёт одобрения", { role: ROLE[m.pendingRole].label() })}</Chip></p>}
                {shown && r.hint() && <p className="hint">{r.hint()}</p>}
              </div>
              <div className="side">
                {canEdit ? (
                  <select className="role-select" value={m.gameRole} aria-label={t("Роль: {name}", { name })} onChange={(e) => onRole(m.user.id, e.target.value as GameRole)}>
                    {(Object.keys(ROLE).filter((k) => k !== "CAPTAIN" && k !== "DEPUTY") as GameRole[]).map((k) => <option key={k} value={k}>{ROLE[k].label()}</option>)}
                  </select>
                ) : roleKey !== "NONE" ? (
                  <button type="button" className="chip-btn" aria-expanded={shown} onClick={() => setOpen(shown ? null : m.user.id)}><Chip tone={roleKey === "CAPTAIN" || roleKey === "DEPUTY" ? "accent" : "info"} icon={r.icon}>{r.label()}</Chip></button>
                ) : null}
                {canEdit && <button type="button" className={"ghost icon sm" + (m.role === "DEPUTY" ? " on" : "")} aria-label={m.role === "DEPUTY" ? t("Снять заместителя") : t("Сделать заместителем")} title={m.role === "DEPUTY" ? t("Снять заместителя") : t("Сделать заместителем")} onClick={() => onDeputy(m.user.id, m.role !== "DEPUTY")}><Icon name="star" /></button>}
                {canEdit && m.gameRole !== "NONE" && <button type="button" className="ghost icon sm" aria-label={t("Что даёт роль")} aria-expanded={shown} onClick={() => setOpen(shown ? null : m.user.id)}><Icon name="help" /></button>}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
