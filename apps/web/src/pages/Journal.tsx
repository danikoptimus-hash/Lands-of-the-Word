import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BOOKS } from "@lotw/domain";
import { api, ApiError, type ActivityRowDto, type FeedItemDto, type JournalKind, type PeaceTeamDto, type SeasonBookDto, type ServiceStatsDto } from "../lib/api";
import { getLocale, t } from "../lib/i18n";
import { fmtDate, plural } from "../lib/format";
import { useUi } from "../lib/ui";
import { Icon } from "../components/Icon";
import { TeamAvatar } from "../components/TeamAvatar";
import { Back } from "../components/Back";
import { Help } from "../components/Help";
import { EmptyState, LoadingState } from "../components/State";

/**
 * Журнал событий у игроков и администратора (решения владельца 18.09, глава 4): лента команды «Что случилось» (E-04),
 * новости для всех команд об испытаниях без ставок (S-15), «Моё служение» (E-03), мир между командами (B-12),
 * доска активности и журнал для администратора, «Книга сезона» (E-10). Тексты — те же шаблоны, что на сервере.
 */

const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));
const bookName = (code: string) => { const b = BOOK_BY_CODE.get(code); return b ? (getLocale() === "en" ? b.nameEn : b.nameRu) : code; };

export const JOURNAL_TEXT: Record<JournalKind, string> = {
  deed_submitted: "{user} сдал(а) дело «{deed}» на проверку",
  deed_approved: "Дело «{deed}» принято{who}: перекрёсток открыт",
  deed_returned: "Дело «{deed}» возвращено на доработку",
  order_solved: "{user} собрал(а) порядок районов города {book}",
  task_solved: "{user} решил(а) район {n} города {book}",
  city_captured: "Команда «{team}» взяла город {book}{capital}",
  ruins_taken: "Команда «{team}» заняла руины города {book}",
  treasure: "Находка в руинах города {book}: знак шифра города {other}",
  trial_declared: "Команда «{team}» бросила вызов городу {book} команды «{other}»",
  trial_queued: "Команда «{team}» встала в очередь на город {book} команды «{other}»",
  trial_started: "Вызов команды «{team}» городу {book} команды «{other}» начался",
  trial_repelled: "Город {book} устоял: команда «{other}» отбила вызов команды «{team}»",
  trial_won: "Команда «{team}» взяла город {book} у команды «{other}»",
  trial_burnt: "Вызов команды «{team}» городу {book} команды «{other}» сгорел",
  trial_cancelled: "Вызов команды «{team}» городу {book} отменён",
  siege_declared: "Команда «{team}» объявила осаду делами городу {book} команды «{other}»",
  siege_won: "Осада удалась: город {book} перешёл команде «{team}» от команды «{other}»",
  siege_repelled: "Осада отбита: город {book} остаётся у команды «{other}»",
  passage_granted: "Команда «{other}» разрешила проход через город {book}",
  passage_denied: "Команда «{other}» не разрешила проход через город {book}",
  sea_landed: "{user} привёл(а) корабль к другому острову",
  penalty: "Штраф администратора: участок пути аннулирован",
  role_changed: "{user}: роль {role}",
  capital_moved: "Столица перенесена",
  peace_offered: "Команда «{team}» предложила мир команде «{other}»",
  peace_made: "Команды «{team}» и «{other}» заключили мир",
  peace_declined: "Команда «{other}» отклонила предложение мира",
  peace_broken: "Команда «{team}» расторгла мир с командой «{other}»",
  chronicle: "Летопись недели",
  game_finished: "Игра завершена{winner}",
};
const ICON: Partial<Record<JournalKind, string>> = { deed_submitted: "send", deed_approved: "check", deed_returned: "back", order_solved: "lock", task_solved: "book", city_captured: "city", ruins_taken: "city", treasure: "star", trial_declared: "wave", trial_queued: "list", trial_started: "wave", trial_repelled: "flag", trial_won: "trophy", trial_burnt: "clock", siege_declared: "scroll", siege_won: "trophy", siege_repelled: "flag", passage_granted: "handshake", passage_denied: "x", sea_landed: "ship", penalty: "alert", role_changed: "user", capital_moved: "crown", peace_offered: "handshake", peace_made: "handshake", peace_broken: "alert", chronicle: "scroll", game_finished: "trophy" };

/** Текст записи: шаблон вида через словарь, код книги подставляется названием, служебные подстановки переводятся. */
export function journalLine(kind: JournalKind, vars: Record<string, string | number>): string {
  const v: Record<string, string | number> = { ...vars };
  if (typeof v.book === "string") v.book = bookName(v.book);
  if (typeof v.other === "string" && kind === "treasure") v.other = bookName(v.other);
  // Служебные подстановки — сами шаблоны (например {winner} = «: победила команда «{team}»»): переводятся и заполняются теми же переменными.
  for (const k of ["capital", "who", "winner", "role"]) if (typeof v[k] === "string" && v[k]) v[k] = t(v[k] as string, v);
  return t(JOURNAL_TEXT[kind] ?? kind, v);
}

/** Лента команды «Что случилось»: свои события и новости для всех команд. */
export function FeedSection({ gameId, version }: { gameId: string; version: number }) {
  const [items, setItems] = useState<FeedItemDto[] | null>(null);
  const [all, setAll] = useState(false);
  const load = useCallback(() => api<{ items: FeedItemDto[] }>(`/api/games/${gameId}/feed`).then((r) => setItems(r.items)).catch(() => {}), [gameId]);
  useEffect(() => { void load(); }, [load, version]);
  /** По умолчанию шесть записей — меню укладывается в экран телефона; дальше «Показать всё». */
  const shown = items ? (all ? items : items.slice(0, 6)) : [];
  return (
    <section className="section">
      <h2><Icon name="scroll" />{t("Что случилось")}</h2>
      {!items ? <LoadingState rows={2} /> : items.length === 0 ? <EmptyState inline icon="scroll" text={t("Пока тихо. Первые события — после первого дела.")} /> : (
        <ul className="feed">
          {shown.map((it) => (
            <li key={it.id} className={it.everyone && !it.mine ? "news" : ""}>
              <span className="ico"><Icon name={ICON[it.kind] ?? "info"} /></span>
              <div className="body">
                {it.kind === "chronicle" ? <details><summary>{t("Летопись недели")} · {fmtDate(it.at, { time: false })}</summary>{it.text.split("\n").map((l, i) => <p key={i} className="small">{l}</p>)}</details> : <span>{journalLine(it.kind, it.vars)}</span>}
                <span className="meta">{fmtDate(it.at)}{it.everyone && !it.mine ? ` · ${t("новость")}` : ""}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {items && items.length > 6 && !all && <p className="mt-2"><button type="button" className="ghost sm" onClick={() => setAll(true)}>{t("Показать всё ({n})", { n: items.length })}</button></p>}
    </section>
  );
}

/** «Моё служение»: сводка участника. */
export function MyServiceSection({ gameId, version }: { gameId: string; version: number }) {
  const [s, setS] = useState<ServiceStatsDto | null>(null);
  useEffect(() => { api<ServiceStatsDto>(`/api/games/${gameId}/my-service`).then(setS).catch(() => {}); }, [gameId, version]);
  return (
    <section className="section">
      <h2><Icon name="user" />{t("Моё служение")}</h2>
      {!s ? <LoadingState rows={1} /> : (
        <div className="service">
          <div className="svc-stat"><b>{s.deeds}</b><span>{plural(s.deeds, ["дело", "дела", "дел"]).replace(/^\d+\s*/, "")}</span></div>
          <div className="svc-stat"><b>{s.tasks}</b><span>{t("районов")}</span></div>
          <div className="svc-stat"><b>{s.verses}</b><span>{t("стихов")}</span></div>
          <div className="svc-stat"><b>{s.cities}</b><span>{t("городов")}</span></div>
          {s.trips > 0 && <div className="svc-stat"><b>{s.trips}</b><span>{t("переправ")}</span></div>}
        </div>
      )}
      {s && s.deedsPending > 0 && <p className="hint">{t("В работе или на проверке: {n}", { n: s.deedsPending })}</p>}
    </section>
  );
}

/** Мир между командами. */
export function PeaceSection({ gameId, version }: { gameId: string; version: number }) {
  const { notify, confirm } = useUi();
  const [data, setData] = useState<{ canSpeak: boolean; teams: PeaceTeamDto[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => api<{ canSpeak: boolean; teams: PeaceTeamDto[] }>(`/api/games/${gameId}/peace`).then(setData).catch(() => {}), [gameId]);
  useEffect(() => { void load(); }, [load, version]);
  async function act(teamId: string, path: string, body?: unknown, ok?: string) {
    setBusy(teamId);
    try { await api(path, { method: "POST", body: JSON.stringify(body ?? {}) }); if (ok) notify(ok); await load(); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusy(null); }
  }
  async function breakPeace(p: PeaceTeamDto) {
    if (!(await confirm(t("Расторжение вступает в силу сразу, об этом узнают все команды."), { title: t("Расторгнуть мир с «{team}»?", { team: p.team.name }), okLabel: t("Расторгнуть") }))) return;
    await act(p.team.id, `/api/games/${gameId}/peace/${p.peaceId}/break`, {}, t("Мир расторгнут"));
  }
  if (!data || data.teams.length === 0) return null;
  return (
    <section className="section">
      <h2><Icon name="handshake" />{t("Мир")}{data.teams.some((p) => p.state === "incoming") && <span className="count-chip hot">{data.teams.filter((p) => p.state === "incoming").length}</span>}<Help>{t("В мире команды не испытывают города друг друга и не объявляют осад. Мир бессрочный: держится, пока одна из сторон его не расторгнет.")}</Help></h2>
      <ul className="list">
        {data.teams.map((p) => (
          <li key={p.team.id}>
            <div className="main"><TeamAvatar name={p.team.name} color={p.team.color} size="sm" withName /><span className="meta">{p.state === "peace" ? t("мир с {d}", { d: fmtDate(p.since, { time: false }) }) : p.state === "offered" ? t("предложение отправлено") : p.state === "incoming" ? t("предлагает мир") : p.team.status === "defeated" ? t("выбыла") : t("мира нет")}</span></div>
            {data.canSpeak && p.team.status !== "defeated" && (
              <div className="row">
                {p.state === "none" && <button type="button" className="secondary sm" disabled={busy === p.team.id} onClick={() => void act(p.team.id, `/api/games/${gameId}/peace`, { teamId: p.team.id }, t("Мир предложен"))}><Icon name="handshake" />{t("Предложить мир")}</button>}
                {p.state === "incoming" && <><button type="button" className="sm" disabled={busy === p.team.id} onClick={() => void act(p.team.id, `/api/games/${gameId}/peace/${p.peaceId}/accept`, {}, t("Мир заключён"))}><Icon name="check" />{t("Принять")}</button><button type="button" className="secondary sm" disabled={busy === p.team.id} onClick={() => void act(p.team.id, `/api/games/${gameId}/peace/${p.peaceId}/decline`, {}, t("Отклонено"))}>{t("Отклонить")}</button></>}
                {p.state === "peace" && <button type="button" className="secondary sm" disabled={busy === p.team.id} onClick={() => void breakPeace(p)}>{t("Расторгнуть")}</button>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Администратор: доска активности участников. */
export function ActivityBoard({ gameId, version }: { gameId: string; version: number }) {
  const [rows, setRows] = useState<ActivityRowDto[] | null>(null);
  useEffect(() => { api<{ rows: ActivityRowDto[] }>(`/api/games/${gameId}/activity`).then((r) => setRows(r.rows)).catch(() => {}); }, [gameId, version]);
  if (!rows) return <LoadingState rows={2} />;
  if (rows.length === 0) return <EmptyState inline icon="users" text={t("Участников пока нет.")} />;
  return (
    <div className="scroll">
      <table className="table activity">
        <thead><tr><th>#</th><th>{t("Участник")}</th><th>{t("Команда")}</th><th>{t("Дела")}</th><th>{t("Районы")}</th><th>{t("Стихи")}</th><th>{t("Города")}</th><th>{t("Последняя активность")}</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.userId}>
              <td>{i + 1}</td>
              <td>{r.displayName || r.nickname}</td>
              <td><TeamAvatar name={r.team} color={r.color} size="sm" withName /></td>
              <td>{r.deeds}</td><td>{r.tasks + r.orders}</td><td>{r.verses}</td><td>{r.cities}</td>
              <td className="muted small">{r.lastActiveAt ? fmtDate(r.lastActiveAt) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Администратор: журнал событий и кнопка летописи. */
export function JournalAdmin({ gameId, version, active }: { gameId: string; version: number; active: boolean }) {
  const { notify, confirm } = useUi();
  const [items, setItems] = useState<Array<FeedItemDto & { teamId: string | null }> | null>(null);
  const [teams, setTeams] = useState<Array<{ id: string; name: string; color: string }>>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<{ items: Array<FeedItemDto & { teamId: string | null }>; teams: Array<{ id: string; name: string; color: string }> }>(`/api/games/${gameId}/journal`).then((r) => { setItems(r.items); setTeams(r.teams); }).catch(() => {}), [gameId]);
  useEffect(() => { void load(); }, [load, version]);
  async function chronicle() {
    if (!(await confirm(t("Летопись за последние 7 дней уйдёт всем участникам всех команд письмом и уведомлением."), { title: t("Отправить летопись сейчас?"), okLabel: t("Отправить") }))) return;
    setBusy(true);
    try { await api(`/api/games/${gameId}/chronicle`, { method: "POST", body: "{}" }); notify(t("Летопись отправлена")); await load(); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusy(false); }
  }
  const teamOf = (id: string | null) => teams.find((tm) => tm.id === id);
  return (
    <div className="card">
      <div className="card-head">
        <h2><span className="ico"><Icon name="scroll" /></span>{t("Журнал событий")}<Help>{t("Летопись уходит сама раз в неделю (день и час — в продвинутых настройках): дела, города, испытания без ставок, положение команд.")}</Help></h2>
        {active && <button type="button" className="secondary sm" disabled={busy} onClick={() => void chronicle()}><Icon name="send" />{t("Отправить летопись сейчас")}</button>}
      </div>
      {!items ? <LoadingState rows={2} /> : items.length === 0 ? <EmptyState inline icon="scroll" text={t("Событий пока нет.")} /> : (
        <ul className="feed compact">
          {items.slice(0, 80).map((it) => { const tm = teamOf(it.teamId); return (
            <li key={it.id} className={it.everyone ? "news" : ""}>
              <span className="ico"><Icon name={ICON[it.kind] ?? "info"} /></span>
              <div className="body">
                <span>{it.kind === "chronicle" ? it.text.split("\n")[0] : journalLine(it.kind, it.vars)}</span>
                <span className="meta">{fmtDate(it.at)}{tm ? ` · ${tm.name}` : ""}{it.everyone ? ` · ${t("всем командам")}` : ""}</span>
              </div>
            </li>
          ); })}
        </ul>
      )}
    </div>
  );
}

/** «Книга сезона»: страница для показа и печати. */
export function SeasonBookPage() {
  const { id = "" } = useParams();
  const [book, setBook] = useState<SeasonBookDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<SeasonBookDto>(`/api/games/${id}/season-book`).then(setBook).catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети"))); }, [id]);
  if (error) return <div className="season-book"><Back to={`/games/${id}`} label={t("К игре")} /><p className="error">{error}</p></div>;
  if (!book) return <div className="season-book"><LoadingState rows={4} /></div>;
  const winner = book.standings.find((s) => s.teamId === book.game.winnerTeamId);
  const kinds: JournalKind[] = ["trial_declared", "trial_repelled", "trial_won", "trial_burnt", "siege_declared", "siege_won", "siege_repelled", "peace_made", "peace_broken", "city_captured", "ruins_taken"];
  const events = book.events.filter((e) => kinds.includes(e.kind));
  const chronicles = book.events.filter((e) => e.kind === "chronicle");
  return (
    <div className="season-book">
      <div className="no-print">
        <Back to={`/games/${id}`} label={t("К игре")} />
        <div className="page-head">
          <h1><span className="ico"><Icon name="book" /></span>{t("Книга сезона")}</h1>
          <button type="button" className="btn" onClick={() => window.print()}><Icon name="printer" />{t("Печать")}</button>
        </div>
        <p className="hint">{t("Итоги для показа на собрании. Кнопка «Печать» — для бумаги.")}</p>
      </div>
      <header className="book-head">
        <h1>{book.game.name}</h1>
        <div className="dates">{book.game.startedAt ? fmtDate(book.game.startedAt, { time: false }) : ""}{book.game.finishedAt ? ` — ${fmtDate(book.game.finishedAt, { time: false })}` : ` — ${t("идёт")}`}</div>
        {winner && <div className="winner"><Icon name="trophy" /> {t("Победила команда")} «{winner.name}»</div>}
      </header>
      <section>
        <h2>{t("Положение команд")}</h2>
        <ol className="book-standings">
          {book.standings.map((s, i) => <li key={s.teamId}><span className="rank">{i + 1}</span><TeamAvatar name={s.name} color={s.color} size="sm" withName /><span className="meta">{plural(s.cities, ["город", "города", "городов"])} · {plural(s.deedsApproved, ["дело", "дела", "дел"])}{s.status === "defeated" ? ` · ${t("выбыла")}` : ""}</span></li>)}
        </ol>
      </section>
      {book.teams.map((tm) => (
        <section key={tm.id} className="book-team">
          <h2><TeamAvatar name={tm.name} color={tm.color} size="sm" withName /></h2>
          <div className="book-cols">
            <div>
              <h3>{t("Участники")}</h3>
              <ul className="plain">{tm.members.map((m) => <li key={m.userId}><b>{m.name}</b>{m.role === "CAPTAIN" ? ` · ${t("капитан")}` : m.role === "DEPUTY" ? ` · ${t("заместитель")}` : ""} — {t("дел: {a}, районов: {b}, стихов: {c}", { a: m.deeds, b: m.tasks + m.orders, c: m.verses })}</li>)}</ul>
            </div>
            <div>
              <h3>{t("Города")}</h3>
              {tm.cities.length === 0 ? <p className="muted">{t("Городов нет.")}</p> : <ul className="plain">{tm.cities.map((c) => <li key={c.nodeKey}>{bookName(c.book)}{c.isCapital ? ` · ${t("столица")}` : ""} <span className="muted">{fmtDate(c.capturedAt, { time: false })}</span></li>)}</ul>}
            </div>
          </div>
          <h3>{t("Дела")} <span className="muted">({tm.deeds.length})</span></h3>
          {tm.deeds.length === 0 ? <p className="muted">{t("Принятых дел нет.")}</p> : <ul className="plain deeds">{tm.deeds.map((d, i) => <li key={i}>{d.title} <span className="muted">· {d.direction} · {fmtDate(d.decidedAt, { time: false })}{d.by.length ? ` · ${d.by.join(", ")}` : ""}</span></li>)}</ul>}
        </section>
      ))}
      {events.length > 0 && (
        <section>
          <h2>{t("Испытания и события")}</h2>
          <ul className="plain">{events.map((e) => <li key={e.id}><span className="muted">{fmtDate(e.at, { time: false })}</span> — {journalLine(e.kind, e.vars)}</li>)}</ul>
        </section>
      )}
      {chronicles.length > 0 && (
        <section>
          <h2>{t("Летописи недель")}</h2>
          {chronicles.map((c) => <div key={c.id} className="book-chronicle"><div className="muted">{fmtDate(c.at, { time: false })}</div>{c.text.split("\n").map((l, i) => <p key={i}>{l}</p>)}</div>)}
        </section>
      )}
      <p className="no-print mt-3"><Link to={`/games/${id}`}>{t("К игре")}</Link></p>
    </div>
  );
}

