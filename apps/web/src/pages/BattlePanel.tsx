import { useEffect, useMemo, useState } from "react";
import { api, ApiError, type BattleDto, type BattleStatus, type BookTextDto, type PassageDto, type WarDto } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { fmtDate, fmtLeft, plural } from "../lib/format";
import { Icon } from "../components/Icon";
import { Chip, type ChipTone } from "../components/Chip";

/** Статусы испытания: средний род, единая палитра (DESIGN.md §1, §3). */
export const BATTLE_STATUS: Record<BattleStatus, string> = { get QUEUED() { return t("в очереди"); }, get ATTACK() { return t("вызов"); }, get DEFENSE() { return t("ответ"); }, get WON() { return t("город перешёл"); }, get REPELLED() { return t("город устоял"); }, get EXPIRED() { return t("вызов не завершён"); }, get CANCELLED() { return t("отменено"); } };
export function battleTone(s: BattleStatus, attacker: boolean): ChipTone {
  switch (s) {
    case "ATTACK": return "info";
    case "DEFENSE": return "warn";
    case "WON": return attacker ? "ok" : "bad";
    case "REPELLED": return attacker ? "bad" : "ok";
    case "EXPIRED": return "bad";
    default: return "neutral";
  }
}
/** Наш ход: претенденты во время вызова, хранители во время ответа — пока не отправили на проверку. */
export const isMyTurn = (b: BattleDto, teamId: string) => (b.attacker.id === teamId && b.status === "ATTACK" && !b.attackDoneAt) || (b.defender.id === teamId && b.status === "DEFENSE" && !b.defenseDoneAt);
export function leftText(deadline: string | null, now: number): string {
  if (!deadline) return "";
  const ms = Date.parse(deadline) - now;
  return ms <= 0 ? t("время вышло") : fmtLeft(ms);
}
const verses = (n: number) => plural(n, ["стих", "стиха", "стихов"]);

/**
 * Испытание города в попапе: уровень испытания, вызов (ставка — сколько стихов команда выучит
 * в сумме по участникам), карточки идущих испытаний, прошлые.
 */
export function WarSection({ gameId, nodeKey, teamId, isCaptain, version, onChanged }: { gameId: string; nodeKey: string; teamId: string; isCaptain: boolean; version: number; onChanged: () => void }) {
  const { confirm, notify } = useUi();
  const [war, setWar] = useState<WarDto | null>(null);
  const [bid, setBid] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const load = () => api<WarDto>(`/api/games/${gameId}/my-city/${encodeURIComponent(nodeKey)}/war`).then((w) => { setWar(w); setError(null); if (bid === "") setBid(w.minBid); }).catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети")));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [gameId, nodeKey, version]);
  useEffect(() => { const tm = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(tm); }, []);
  if (!war) return error ? <p className="error" role="alert">{error}</p> : null;

  async function declare() {
    if (!war || bid === "") return;
    const ok = await confirm(t("Команда обязуется выучить {n} в сумме по участникам. Игра выдаст случайный отрывок; с этого момента идёт время вызова, не больше 14 дней.", { n: verses(bid) }), { title: t("Испытать город со ставкой {n}?", { n: verses(bid) }), okLabel: t("Испытать город"), danger: true });
    if (!ok) return;
    setBusy(true); setError(null);
    try {
      const r = await api<{ status: string }>(`/api/games/${gameId}/my-city/${encodeURIComponent(nodeKey)}/war`, { method: "POST", body: JSON.stringify({ bid }) });
      notify(r.status === "QUEUED" ? t("Вы в очереди: испытание города уже идёт") : t("Вызов брошен: отрывок выдан"));
      await load(); onChanged();
    } catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); }
    finally { setBusy(false); }
  }

  const active = war.battles.filter((b) => b.status === "QUEUED" || b.status === "ATTACK" || b.status === "DEFENSE");
  const past = war.battles.filter((b) => !active.includes(b)).slice(0, 3);
  return (
    <div className="war">
      <h3>{t("Испытание города")}</h3>
      <p className="muted small">{t("Уровень испытания: {n}", { n: verses(war.defenseLevel) })}{war.bookVerses ? ` · ${t("в книге {n}", { n: verses(war.bookVerses) })}` : ""}</p>
      {war.locked && <div className="note info"><Icon name="lock" /><span>{t("Город устоял окончательно: испытать его больше нельзя.")}</span></div>}
      {error && <p className="error" role="alert">{error}</p>}
      {war.canDeclare && (
        <div className="declare">
          <div className="field">
            <label htmlFor="war-bid">{t("Ставка, стихов")}</label>
            <div className="row nowrap">
              <input id="war-bid" type="number" inputMode="numeric" min={war.minBid} value={bid} onChange={(e) => setBid(e.target.value === "" ? "" : Number(e.target.value))} />
              <button type="button" disabled={busy || bid === "" || bid < war.minBid} onClick={() => void declare()}><Icon name="wave" />{t("Испытать город")}</button>
            </div>
            <p className="hint">{t("минимум {n}", { n: war.minBid })}{war.penalty ? ` · ${t("включая штраф {n} за незавершённые вызовы", { n: war.penalty })}` : ""}{war.queue > 0 ? ` · ${t("в очереди уже {n}", { n: war.queue })}` : ""}</p>
          </div>
          <details className="disclose sm">
            <summary><Icon name="help" />{t("Как проходит испытание")}<Icon name="chevron-down" className="chev" /></summary>
            <div className="stack-sm small muted">
              <p>{t("Ставка — сколько стихов команда выучит в сумме по участникам: каждый учит свою часть или весь отрывок. Отрывок выберет игра.")}</p>
              <p>{t("Каждый отмечает выученные стихи и прикладывает ссылку на видео. Когда сумма набрана, капитан отправляет вызов на проверку администратору.")}</p>
              <p>{t("Хранителям даётся столько же времени, сколько ушло у претендентов: они выбирают отрывок из книги и учат не меньше стихов. Ничья — в пользу хранителей.")}</p>
              <p>{t("Не завершённый за 14 дней вызов сгорает, и следующая ставка на этот город для команды растёт на 5 стихов.")}</p>
            </div>
          </details>
        </div>
      )}
      {!war.canDeclare && war.reason && !active.length && <p className="muted small mt-2">{war.reason}</p>}
      {active.map((b) => <BattleCard key={b.id} gameId={gameId} b={b} teamId={teamId} isCaptain={isCaptain} now={now} onChanged={() => { void load(); onChanged(); }} />)}
      {past.length > 0 && (
        <ul className="list mt-3">
          {past.map((b) => <li key={b.id}><span className="muted small">{fmtDate(b.declaredAt, { time: false })} · {b.attacker.name} → {b.defender.name} · {verses(b.bid)}</span><Chip tone={battleTone(b.status, b.attacker.id === teamId)}>{BATTLE_STATUS[b.status]}</Chip></li>)}
        </ul>
      )}
    </div>
  );
}

/** Карточка идущего испытания: отрывок с отметками по стихам, ссылки, суммы, отправка капитаном. */
export function BattleCard({ gameId, b, teamId, isCaptain, now, onChanged }: { gameId: string; b: BattleDto; teamId: string; isCaptain: boolean; now: number; onChanged: () => void }) {
  const { confirm, notify } = useUi();
  const attacker = b.attacker.id === teamId;
  const myTurn = isMyTurn(b, teamId);
  const [error, setError] = useState<string | null>(null);
  const [bid, setBid] = useState(b.bid);
  const need = attacker ? b.bid : b.attackApproved;
  const sum = attacker ? b.attackSum : b.defenseSum;
  const approved = attacker ? b.attackApproved : b.defenseApproved;
  const passage = attacker ? b.passage : b.defensePassage;

  async function raise() {
    try { await api(`/api/games/${gameId}/battles/${b.id}/bid`, { method: "POST", body: JSON.stringify({ bid }) }); notify(t("Ставка обновлена")); onChanged(); }
    catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); }
  }
  async function submit() {
    const ok = await confirm(attacker ? t("Выучено {a} из {b}. После отправки добавлять стихи нельзя; время вызова остановится.", { a: sum, b: need }) : t("Выучено {a} из {b}. После отправки добавлять стихи нельзя.", { a: sum, b: need }), { title: attacker ? t("Отправить вызов на проверку?") : t("Отправить ответ на проверку?"), okLabel: t("Отправить") });
    if (!ok) return;
    try { await api(`/api/games/${gameId}/battles/${b.id}/submit`, { method: "POST" }); notify(t("Отправлено на проверку администратору")); onChanged(); }
    catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); }
  }
  async function surrender() {
    if (!(await confirm(t("Город перейдёт претендентам. Если это столица — команда выбывает из игры."), { title: t("Уступить город?"), okLabel: t("Уступить город"), danger: true }))) return;
    try { await api(`/api/games/${gameId}/battles/${b.id}/surrender`, { method: "POST" }); onChanged(); }
    catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); }
  }

  const deadline = b.status === "ATTACK" ? b.attackDeadline : b.status === "DEFENSE" ? b.defenseDeadline : null;
  const attackTime = b.startedAt && b.attackDoneAt ? fmtLeft(Date.parse(b.attackDoneAt) - Date.parse(b.startedAt)) : "";
  return (
    <div className={"battle " + b.status.toLowerCase()}>
      <div className="row between nowrap">
        <div className="grow"><div className="strong"><Icon name="wave" /> {t("Испытание · {city}", { city: b.bookName })}</div><div className="muted small">{attacker ? t("Вы — претенденты, против «{team}»", { team: b.defender.name }) : t("Вы — хранители, вызов от «{team}»", { team: b.attacker.name })}</div></div>
        <Chip tone={myTurn ? "accent" : battleTone(b.status, attacker)}>{BATTLE_STATUS[b.status]}</Chip>
      </div>
      <p className="muted small mt-2">
        {t("Ставка: {n}", { n: verses(b.bid) })}
        {b.status === "DEFENSE" && ` · ${t("вызов: {n} за {time}", { n: verses(b.attackApproved), time: attackTime })}`}
        {deadline && ` · ${t("осталось {t}", { t: leftText(deadline, now) })}`}
        {b.status === "ATTACK" && b.attackDoneAt && ` · ${t("вызов на проверке")}`}
        {b.status === "DEFENSE" && b.defenseDoneAt && ` · ${t("ответ на проверке")}`}
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      {b.status === "QUEUED" && attacker && (
        <div className="field">
          <label htmlFor={"bid-" + b.id}>{t("Ставка, стихов")}</label>
          <div className="row nowrap">
            <input id={"bid-" + b.id} type="number" inputMode="numeric" value={bid} onChange={(e) => setBid(Number(e.target.value))} />
            <button type="button" className="secondary" onClick={() => void raise()}>{t("Изменить ставку")}</button>
          </div>
        </div>
      )}
      {!attacker && b.status === "ATTACK" && <p className="muted small mt-2">{t("Претенденты учат отрывок. Когда администратор примет их записи, у вас будет столько же времени на ответ.")}</p>}
      {(b.status === "ATTACK" || b.status === "DEFENSE") && (attacker || b.status === "DEFENSE") && (
        <>
          <div className="progress mt-2"><span style={{ width: `${Math.min(100, need ? (sum / need) * 100 : 0)}%` }} /></div>
          <div className="muted small mt-1">{t("Выучено {a} из {b} · принято {c}", { a: sum, b: need, c: approved })}</div>
          {!attacker && !passage && b.status === "DEFENSE" && !b.defenseDoneAt && (
            isCaptain ? <PassagePicker gameId={gameId} battleId={b.id} need={need} onChosen={onChanged} /> : <div className="note warn"><Icon name="clock" /><span>{t("Капитан выбирает отрывок ответа из книги. Как только выберет — здесь появится текст.")}</span></div>
          )}
          {passage && <VerseChecklist gameId={gameId} b={b} passage={passage} locked={!myTurn} onChanged={onChanged} />}
          {isCaptain && myTurn && sum < need && <p className="hint">{t("Не хватает {n}", { n: verses(need - sum) })}</p>}
          <div className="actions">
            {isCaptain && myTurn && <button type="button" disabled={sum < need} onClick={() => void submit()}><Icon name="send" />{attacker ? t("Отправить вызов на проверку") : t("Отправить ответ на проверку")}</button>}
            {!attacker && isCaptain && (b.status === "DEFENSE" || b.status === "ATTACK") && <button type="button" className="danger secondary" onClick={() => void surrender()}>{t("Уступить город")}</button>}
          </div>
        </>
      )}
    </div>
  );
}

/** Отрывок с отметками: участник отмечает выученные стихи и прикрепляет ссылку на видео. */
function VerseChecklist({ gameId, b, passage, locked, onChanged }: { gameId: string; b: BattleDto; passage: PassageDto; locked: boolean; onChanged: () => void }) {
  const { notify } = useUi();
  const mine = useMemo(() => new Set(b.myVerses), [b.myVerses]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [links, setLinks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (idx: number) => { if (locked || mine.has(idx)) return; setSel((s) => { const n = new Set(s); if (n.has(idx)) n.delete(idx); else n.add(idx); return n; }); };
  const selectAll = () => setSel(new Set((passage.verses ?? []).map((v) => v.idx).filter((i) => !mine.has(i))));
  async function send() {
    setBusy(true); setError(null);
    try {
      const r = await api<{ added: number; sum: number }>(`/api/games/${gameId}/battles/${b.id}/entries`, { method: "POST", body: JSON.stringify({ verses: [...sel], links: links.split(/\s+/).filter(Boolean) }) });
      notify(t("Засчитано {a}. Команда выучила {s}", { a: verses(r.added), s: r.sum })); setSel(new Set()); setLinks(""); onChanged();
    } catch (e) { setError(e instanceof ApiError ? (e.issues?.map((i) => i.message).join("; ") || e.message) : t("Ошибка сети")); }
    finally { setBusy(false); }
  }
  const entries = b.entries.filter((e) => e.side === (b.mySide ?? "ATTACK"));
  return (
    <div className="passage mt-3">
      <div className="row between"><span className="strong">{t("Отрывок {ref}", { ref: passage.ref })}</span><span className="muted small">{t("вы выучили {a} из {b}", { a: mine.size, b: passage.end - passage.start + 1 })}</span></div>
      {!locked && <p className="hint">{t("Отметьте стихи, которые выучили и записали на видео, вставьте ссылку и нажмите «Засчитать». Можно частями.")}</p>}
      {!locked && <button type="button" className="ghost sm" onClick={selectAll}>{t("Выбрать все оставшиеся")}</button>}
      <ul className="verses">
        {(passage.verses ?? []).map((v) => {
          const done = mine.has(v.idx), on = sel.has(v.idx);
          return (
            <li key={v.idx} className={done ? "done" : on ? "on" : ""}>
              <button type="button" role="checkbox" aria-checked={done || on} disabled={locked || done} onClick={() => toggle(v.idx)}>
                <span className="box">{(done || on) && <Icon name="check" />}</span>
                <span className="ref">{v.ref}</span>
                <span className="text">{v.text ?? ""}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {!locked && (
        <div className="entry-form">
          <div className="field">
            <label htmlFor={"links-" + b.id}>{t("Ссылки на видео")} <span className="opt">{t("по одной на строку")}</span></label>
            <textarea id={"links-" + b.id} rows={2} value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://…" />
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="actions"><button type="button" disabled={busy || sel.size === 0 || !links.trim()} onClick={() => void send()}><Icon name="check" />{sel.size ? t("Засчитать {n}", { n: verses(sel.size) }) : t("Засчитать")}</button></div>
        </div>
      )}
      {entries.length > 0 && (
        <ul className="list mt-2">
          {entries.map((e) => (
            <li key={e.id}>
              <div className="main">
                <span className="title">{e.ref} <span className="muted small">· {verses(e.verses)} · {e.nickname}</span></span>
                {e.adminComment && <span className="meta">{t("Комментарий: {c}", { c: e.adminComment })}</span>}
                {e.links.length > 0 && <span className="meta">{e.links.map((l, i) => <a key={l} href={l} target="_blank" rel="noopener noreferrer">{t("видео")}{e.links.length > 1 ? ` ${i + 1}` : ""}</a>)}</span>}
              </div>
              <Chip tone={e.status === "APPROVED" ? "ok" : e.status === "REJECTED" ? "bad" : "warn"} icon={e.status === "APPROVED" ? "check" : e.status === "REJECTED" ? "alert" : "clock"}>{e.status === "APPROVED" ? t("принято") : e.status === "REJECTED" ? t("возвращено") : t("на проверке")}</Chip>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Капитан хранителей выбирает последовательный отрывок из всей книги: нажатие на первый и последний стих. */
function PassagePicker({ gameId, battleId, need, onChosen }: { gameId: string; battleId: string; need: number; onChosen: () => void }) {
  const { notify } = useUi();
  const [book, setBook] = useState<BookTextDto | null>(null);
  const [chapter, setChapter] = useState(0);
  const [a, setA] = useState<{ c: number; v: number } | null>(null);
  const [z, setZ] = useState<{ c: number; v: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<BookTextDto>(`/api/games/${gameId}/battles/${battleId}/book`).then(setBook).catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети"))); }, [gameId, battleId]);
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!book) return <p className="muted small mt-2">{t("Загружаем книгу…")}</p>;
  const lin = (c: number, v: number) => book.verseCounts.slice(0, c).reduce((s, n) => s + n, 0) + v;
  const inRange = (c: number, v: number) => a && z && lin(c, v) >= lin(a.c, a.v) && lin(c, v) <= lin(z.c, z.v);
  const click = (c: number, v: number) => {
    if (!a || (a && z)) { setA({ c, v }); setZ(null); return; }
    if (lin(c, v) < lin(a.c, a.v)) { setZ(a); setA({ c, v }); } else setZ({ c, v });
  };
  const count = a && z ? lin(z.c, z.v) - lin(a.c, a.v) + 1 : 0;
  async function confirmPassage() {
    if (!a || !z) return;
    try { await api(`/api/games/${gameId}/battles/${battleId}/defense-passage`, { method: "POST", body: JSON.stringify({ from: `${a.c + 1}:${a.v + 1}`, to: `${z.c + 1}:${z.v + 1}` }) }); notify(t("Отрывок ответа утверждён")); onChosen(); }
    catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); }
  }
  const status = a ? (z ? `${a.c + 1}:${a.v + 1} — ${z.c + 1}:${z.v + 1} · ${verses(count)}` : t("начало {ref}, выберите конец", { ref: `${a.c + 1}:${a.v + 1}` })) : t("ничего не выбрано");
  return (
    <div className="picker mt-3">
      <p className="hint">{t("Нажмите первый и последний стих отрывка из книги {name}. Нужно не меньше {n} на команду.", { name: book.name, n: verses(need) })}</p>
      <div className="field">
        <label htmlFor={"chapter-" + battleId}>{t("Глава")}</label>
        <select id={"chapter-" + battleId} className="chapter-select" value={chapter} onChange={(e) => setChapter(Number(e.target.value))}>
          {book.verseCounts.map((_, c) => <option key={c} value={c}>{c + 1}</option>)}
        </select>
      </div>
      <ul className="verses">
        {(book.chapters?.[chapter] ?? []).map((text, v) => {
          const on = inRange(chapter, v) || (a && a.c === chapter && a.v === v);
          return (
            <li key={v} className={on ? "on" : ""}>
              <button type="button" aria-pressed={Boolean(on)} onClick={() => click(chapter, v)}><span className="ref">{chapter + 1}:{v + 1}</span><span className="text">{text}</span></button>
            </li>
          );
        })}
      </ul>
      <p className="hint" aria-live="polite">{status}</p>
      <div className="actions"><button type="button" disabled={!a || !z} onClick={() => void confirmPassage()}><Icon name="check" />{t("Утвердить отрывок")}</button></div>
    </div>
  );
}
