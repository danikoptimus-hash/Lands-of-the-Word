import { useEffect, useState, type FormEvent } from "react";
import { SocialLinks } from "../components/SocialLinks";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { reportPage } from "../lib/perf";
import { api, ApiError, apiReady, prefetch, ready, type GameSummary, type MyMapDto, type MyTeamDto } from "../lib/api";
import { warmTeamMap } from "./mapWarm";
import { useAuth } from "../lib/auth";
import { useUi } from "../lib/ui";
import { ActionMenu } from "../components/ActionMenu";
import { t } from "../lib/i18n";
import { plural } from "../lib/format";
import { Icon } from "../components/Icon";
import { Sheet } from "../components/Sheet";
import { Chip, type ChipTone } from "../components/Chip";
import { TeamAvatar } from "../components/TeamAvatar";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { warmMapImages } from "./MapLayers";

/** Пилюля статуса игры: черновик — warn, идёт — ok, завершена — нейтральная. Считается при рендере, чтобы язык менялся. */
function StatusChip({ status }: { status: string }) {
  const map: Record<string, [ChipTone, string]> = { DRAFT: ["warn", t("черновик")], ACTIVE: ["ok", t("идёт")], FINISHED: ["neutral", t("завершена")] };
  const [tone, label] = map[status] ?? ["neutral", status];
  return <Chip tone={tone}>{label}</Chip>;
}

function HomeSkeleton() {
  return (
    <section className="home-section" aria-busy="true">
      <h2><span className="ico"><Icon name="users" /></span>{t("Мои команды")}</h2>
      <div className="cards">
        {[0, 1].map((i) => (
          <div key={i} className="home-card team-card"><span className="skeleton skeleton-avatar" /><div className="main"><LoadingState rows={2} /></div></div>
        ))}
      </div>
    </section>
  );
}

/**
 * Главная. Игрок с одной командой и без своих игр при входе сразу попадает на карту. Иначе — «Мои команды» и,
 * только если есть свои игры, «Мои игры»; создание игры — отдельная страница.
 */
export function GamesPage() {
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [teams, setTeams] = useState<MyTeamDto[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { reportPage("other"); }, []);
  const [attempt, setAttempt] = useState(0);
  // Автопереход на карту — только при входе на сайт (первая запись истории). Если человек сам пришёл
  // на главную с карты («Мои игры»), показываем её: иначе игрок с одной командой и без своих игр
  // никогда не добрался бы до «Создать игру».
  const entry = useLocation().key === "default";
  const { user } = useAuth();
  const { confirm, notify } = useUi();

  /** Удаление из списка: те же права и тексты, что на странице игры; после удаления карточка просто исчезает. */
  const canDelete = (g: GameSummary) => g.status !== "ACTIVE" && (g.createdById === user?.id || user?.platformRole === "SUPERADMIN");
  async function removeGame(g: GameSummary) {
    const what = g.status === "DRAFT" ? t("Черновик «{name}» будет удалён вместе с командами и картой.", { name: g.name }) : t("Игра «{name}» исчезнет из ваших игр. У участников она останется: карта, команды, летопись, награды.", { name: g.name });
    if (!(await confirm(what, { title: t("Удалить игру?"), okLabel: t("Удалить"), danger: true }))) return;
    try { await api(`/api/games/${g.id}`, { method: "DELETE" }); notify(t("Игра удалена")); setGames((list) => list?.filter((x) => x.id !== g.id) ?? list); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
  }

  useEffect(() => { warmMapImages(); }, []);
  useEffect(() => {
    let alive = true;
    setFailed(false); setGames(null); setTeams(null);
    Promise.all([
      api<{ games: GameSummary[] }>("/api/games").then((r) => r.games),
      api<{ teams: MyTeamDto[] }>("/api/me/teams").then((r) => r.teams),
    ]).then(([g, tm]) => {
      if (!alive) return;
      setGames(g); setTeams(tm);
      // Страница игры и карта команды открываются сразу (решение владельца 24.10): их данные запрашиваются заранее, пока человек на главной.
      prefetch([...g.flatMap((x) => [`/api/games/${x.id}`, `/api/games/${x.id}/progress`]), ...tm.map((x) => `/api/games/${x.game.id}/teams`)]);
      // Карта команды: ответ заранее и заготовка геометрии в простое (решение владельца 24.10, уровень 1).
      for (const x of tm) { const u = `/api/games/${x.game.id}/my-map`; const have = ready<MyMapDto>(u); if (have) warmTeamMap(have); else void apiReady<MyMapDto>(u).then(warmTeamMap).catch(() => {}); }
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [attempt]);

  if (failed) return <ErrorState onRetry={() => setAttempt((n) => n + 1)} />;
  if (!games || !teams) return <HomeSkeleton />;
  if (entry && teams.length === 1 && games.length === 0) return <Navigate to={`/games/${teams[0]!.game.id}/team`} replace />;

  return (
    <>
      {teams.length > 0 && (
        <section className="home-section">
          <h2><span className="ico"><Icon name="users" /></span>{t("Мои команды")}</h2>
          <div className="cards">
            {teams.map((tm) => (
              <Link key={tm.team.id} to={`/games/${tm.game.id}/team`} className="home-card team-card">
                <TeamAvatar name={tm.team.name} color={tm.team.color} avatarId={tm.team.avatarId} size="lg" teamId={tm.team.id} gameId={tm.game.id} />
                <div className="main">
                  <div className="title"><span className="name">{tm.team.name}</span>{tm.role === "CAPTAIN" && <Chip icon="star">{t("капитан")}</Chip>}<StatusChip status={tm.game.status} /></div>
                  <div className="meta"><span>{tm.game.name}</span></div>
                </div>
                <div className="side"><Icon name="chevron" /></div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {games.length > 0 && (
        <section className="home-section">
          <h2><span className="ico"><Icon name="crown" /></span>{t("Мои игры")}</h2>
          <div className="cards">
            {games.map((g) => (
              <div key={g.id} className={"home-card game-card" + (canDelete(g) ? " has-menu" : "")}>
                <Link to={`/games/${g.id}`} className="card-link">
                  <div className="title"><span className="name">{g.name}</span><StatusChip status={g.status} /></div>
                  <div className="meta">
                    <span><Icon name="users" />{plural(g.teamCount, ["команда", "команды", "команд"])}</span>
                    {g.status === "DRAFT" && g.mapSeed == null && <span><Icon name="map" />{t("карта не создана")}</span>}
                  </div>
                </Link>
                {canDelete(g) && (
                  <div className="card-menu">
                    <ActionMenu label={t("Ещё")} items={[{ label: t("Удалить игру"), icon: "trash", danger: true, onSelect: () => void removeGame(g) }]} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {teams.length === 0 && games.length === 0 && (
        <EmptyState icon="users" text={t("Вас ещё не пригласили в команду. Попросите у капитана ссылку-приглашение.")} />
      )}


      <div className="home-foot"><JoinByLink /><Link to="/games/new" className="btn ghost"><Icon name="plus" />{t("Создать игру")}</Link><Link to="/how-to-play" className="btn ghost"><Icon name="help" />{t("Как играть?")}</Link><Link to="/whats-new" className="btn ghost"><Icon name="sparkle" />{t("Что нового")}</Link></div>
      <SocialLinks />
    </>
  );
}

/** Код приглашения из ссылки (…/join/<код>) или сам код: 24 знака base64url, как выдаёт сервер. */
export function inviteToken(raw: string): string | null {
  const v = raw.trim();
  const m = /\/join\/([A-Za-z0-9_-]{8,})/.exec(v);
  if (m) return m[1]!;
  return /^[A-Za-z0-9_-]{8,}$/.test(v) ? v : null;
}

/**
 * Вступить по приглашению прямо в приложении (решение владельца 03.11 по сообщению участника: ссылка из мессенджера
 * открывается в браузере, а не в сохранённом на экран приложении, и там приходится входить заново). Кнопка в ряду
 * кнопок главной (решение владельца 05.11: «кнопку „войти по приглашению“, стиль как у соседних… рамку вокруг значка
 * строки и кнопки вставить убрать»), по ней лист с полем: вставьте ссылку или код — откроется та же страница
 * приглашения, но внутри приложения, где вы уже вошли.
 */
function JoinByLink() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  function go(e: FormEvent) {
    e.preventDefault();
    const token = inviteToken(value);
    if (!token) { setError(t("Не похоже на приглашение: вставьте ссылку от капитана целиком")); return; }
    setOpen(false);
    navigate(`/join/${token}`);
  }
  /** Квадратная кнопка справа от поля (решение владельца 05.11): ссылка берётся из буфера обмена сама, как в поле ссылок у дел. */
  const paste = async () => {
    let text: string | null = null;
    try { text = (await navigator.clipboard.readText()).trim(); } catch { text = null; }
    if (!text) { setError(t("Не удалось прочитать буфер обмена: вставьте ссылку вручную")); return; }
    setValue(text); setError(null);
  };
  return (
    <>
      <button type="button" className="btn ghost" onClick={() => { setError(null); setOpen(true); }}><Icon name="link" />{t("Войти по приглашению")}</button>
      {open && (
        <Sheet size="sm" title={t("Войти по приглашению")} onClose={() => setOpen(false)}>
          <form className="join-form" onSubmit={go}>
            <p className="hint">{t("Вставьте ссылку-приглашение от капитана или код из неё: страница приглашения откроется прямо в приложении.")}</p>
            <div className="join-row">
              <input id="join-invite" value={value} onChange={(e) => { setValue(e.target.value); setError(null); }} placeholder={t("Ссылка-приглашение или код")} aria-label={t("Ссылка-приглашение или код")} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="go" autoFocus />
              <button type="button" className="secondary icon join-paste" onClick={() => void paste()} aria-label={t("Вставить из буфера")} title={t("Вставить из буфера")}><Icon name="paste" /></button>
            </div>
            {error && <p className="error">{error}</p>}
            <div className="actions"><button type="submit" disabled={!value.trim()}><Icon name="check" />{t("Вступить")}</button></div>
          </form>
        </Sheet>
      )}
    </>
  );
}
