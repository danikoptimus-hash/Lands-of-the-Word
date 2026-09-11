import { useEffect, useMemo, useState } from "react";
import { api, ApiError, BATTLE_STATUS_LABEL, type BattleDto, type BookTextDto, type PassageDto, type WarDto } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";

function left(deadline: string | null, now: number): string {
  if (!deadline) return "";
  const ms = Date.parse(deadline) - now;
  if (ms <= 0) return t("время вышло");
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1000);
  if (h >= 48) return t("{d} дн {h} ч", { d: Math.floor(h / 24), h: h % 24 });
  return h > 0 ? t("{h} ч {m} мин", { h, m }) : t("{m} мин {s} с", { m, s });
}
function dur(from: string | null, to: string | null): string {
  if (!from || !to) return "";
  const ms = Date.parse(to) - Date.parse(from);
  const h = Math.floor(ms / 3_600_000), m = Math.round((ms % 3_600_000) / 60_000);
  return h > 0 ? t("{h} ч {m} мин", { h, m }) : t("{m} мин", { m });
}

/**
 * Война за город в попапе города: уровень защиты, объявление войны (ставка — сколько стихов
 * команда выучит в сумме по участникам), карточки активных битв.
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
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!war) return error ? <p className="error">{error}</p> : null;

  async function declare() {
    if (!war || bid === "") return;
    const ok = await confirm(`Испытать город со ставкой ${bid} стихов? Команда обязуется выучить столько стихов в сумме по участникам. Игра выдаст случайный отрывок; с этого момента идёт время вызова (лимит 14 дней).`, { okLabel: t("Испытать город"), danger: true });
    if (!ok) return;
    setBusy(true); setError(null);
    try {
      const r = await api<{ status: string }>(`/api/games/${gameId}/my-city/${encodeURIComponent(nodeKey)}/war`, { method: "POST", body: JSON.stringify({ bid }) });
      notify(r.status === "QUEUED" ? t("Вы в очереди: испытание города уже идёт") : t("Вызов брошен! Отрывок выдан"));
      await load(); onChanged();
    } catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); }
    finally { setBusy(false); }
  }

  const active = war.battles.filter((b) => b.status === "QUEUED" || b.status === "ATTACK" || b.status === "DEFENSE");
  const past = war.battles.filter((b) => !active.includes(b)).slice(0, 3);
  return (
    <div className="war">
      <div className="row between" style={{ alignItems: "baseline" }}>
        <strong>{t("Ответ города")}</strong>
        <span className="muted">уровень {war.defenseLevel}{war.locked ? t(" · закреплён навсегда") : ""}{war.bookVerses ? ` · в книге ${war.bookVerses} ст.` : ""}</span>
      </div>
      {error && <p className="error">{error}</p>}
      {war.canDeclare && (
        <div className="declare">
          <p className="muted" style={{ margin: ".3rem 0" }}>Ставка — сколько стихов команда выучит в сумме по участникам (каждый учит свою часть или весь отрывок). Минимум {war.minBid}{war.penalty ? ` (включая штраф ${war.penalty} за незавершённые вызовы)` : ""}. Отрывок выберет игра.{war.queue > 0 ? ` В очереди уже ${war.queue}.` : ""}</p>
          <div className="row">
            <input type="number" min={war.minBid} value={bid} onChange={(e) => setBid(e.target.value === "" ? "" : Number(e.target.value))} style={{ width: 110 }} />
            <button className="danger" disabled={busy || bid === "" || bid < war.minBid} onClick={() => void declare()}>{t("Испытать город")}</button>
          </div>
        </div>
      )}
      {!war.canDeclare && war.reason && !active.length && <p className="muted" style={{ margin: ".3rem 0" }}>{war.reason}</p>}
      {active.map((b) => <BattleCard key={b.id} gameId={gameId} b={b} teamId={teamId} isCaptain={isCaptain} now={now} onChanged={() => { void load(); onChanged(); }} />)}
      {past.length > 0 && <ul className="list" style={{ marginTop: ".4rem" }}>{past.map((b) => <li key={b.id}><span className="muted">{new Date(b.declaredAt).toLocaleDateString("ru")} · {b.attacker.name} → {b.defender.name} · {b.bid} ст.</span><span className="badge">{BATTLE_STATUS_LABEL[b.status]}</span></li>)}</ul>}
    </div>
  );
}

/** Карточка активной битвы для участника: отрывок с галочками по стихам, ссылки, суммы, отправка капитаном. */
export function BattleCard({ gameId, b, teamId, isCaptain, now, onChanged, compact }: { gameId: string; b: BattleDto; teamId: string; isCaptain: boolean; now: number; onChanged: () => void; compact?: boolean }) {
  const { confirm, notify } = useUi();
  const attacker = b.attacker.id === teamId;
  const myTurn = (attacker && b.status === "ATTACK" && !b.attackDoneAt) || (!attacker && b.status === "DEFENSE" && !b.defenseDoneAt);
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
    if (!(await confirm(attacker ? `Отправить вызов на проверку? Выучено ${sum} из ${need}. После отправки добавлять стихи нельзя; время вызова остановится.` : `Отправить ответ на проверку? Выучено ${sum} из ${need}. После отправки добавлять стихи нельзя.`, { okLabel: t("Отправить") }))) return;
    try { await api(`/api/games/${gameId}/battles/${b.id}/submit`, { method: "POST" }); notify(t("Отправлено на проверку админу")); onChanged(); }
    catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); }
  }
  async function surrender() {
    if (!(await confirm(t("Уступить город? Он перейдёт претендентам. Если это столица — команда выбывает из игры."), { okLabel: "Уступить город", danger: true }))) return;
    try { await api(`/api/games/${gameId}/battles/${b.id}/surrender`, { method: "POST" }); onChanged(); }
    catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); }
  }

  const head = attacker ? t("🌊 Вы бросили вызов «{team}»", { team: b.defender.name }) : t("🌊 «{team}» бросает вызов вашему городу", { team: b.attacker.name });
  return (
    <div className={"battle " + (attacker ? "att " : "def ") + b.status.toLowerCase()}>
      <div className="row between"><strong>{head}</strong><span className={"badge" + (myTurn ? " accent" : "")}>{BATTLE_STATUS_LABEL[b.status]}</span></div>
      <div className="muted" style={{ fontSize: ".9rem" }}>
        {t("Ставка")} {b.bid} {t("ст.")}
        {b.status === "ATTACK" && <> · вызов до {new Date(b.attackDeadline!).toLocaleDateString("ru")} ({left(b.attackDeadline, now)}){b.attackDoneAt ? t(" · отправлена на проверку") : ""}</>}
        {b.status === "DEFENSE" && <> · вызов: {b.attackApproved} ст. за {dur(b.startedAt, b.attackDoneAt)} · на ответ осталось <strong>{left(b.defenseDeadline, now)}</strong>{b.defenseDoneAt ? t(" · отправлена на проверке") : ""}</>}
      </div>
      {error && <p className="error">{error}</p>}
      {b.status === "QUEUED" && attacker && (
        <div className="row" style={{ marginTop: ".3rem" }}>
          <input type="number" value={bid} onChange={(e) => setBid(Number(e.target.value))} style={{ width: 100 }} />
          <button className="secondary sm" onClick={() => void raise()}>{t("Изменить ставку")}</button>
        </div>
      )}
      {!attacker && b.status === "ATTACK" && <p className="muted" style={{ margin: ".3rem 0" }}>{t("Претенденты учат отрывок. Когда админ одобрит их записи, у вас будет ровно столько же времени, сколько ушло у них, чтобы выучить не меньше стихов: капитан выберет отрывок из книги, каждый отметит выученное.")}</p>}
      {(b.status === "ATTACK" || b.status === "DEFENSE") && (attacker || b.status === "DEFENSE") && (
        <>
          <div className="progress"><span style={{ width: `${Math.min(100, need ? (sum / need) * 100 : 0)}%` }} /></div>
          <div className="muted" style={{ fontSize: ".85rem" }}>{t("Выучено командой:")} <strong>{sum}</strong> из {need} · одобрено {approved}</div>
          {!compact && !attacker && !passage && b.status === "DEFENSE" && !b.defenseDoneAt && (
            isCaptain ? <PassagePicker gameId={gameId} battleId={b.id} need={need} onChosen={onChanged} /> : <p className="note warn">{t("Капитан выбирает отрывок ответа из книги. Как только выберет — здесь появится текст.")}</p>
          )}
          {!compact && passage && <VerseChecklist gameId={gameId} b={b} passage={passage} locked={!myTurn} onChanged={onChanged} />}
          {!compact && (
            <div className="actions">
              {isCaptain && myTurn && <button disabled={sum < need} onClick={() => void submit()}>{attacker ? t("Отправить вызов на проверку") : t("Отправить ответ на проверку")}{sum < need ? ` (не хватает ${need - sum})` : ""}</button>}
              {!attacker && isCaptain && (b.status === "DEFENSE" || b.status === "ATTACK") && <button className="ghost" onClick={() => void surrender()}>{t("Уступить город")}</button>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Отрывок с галочками: участник отмечает выученные стихи и прикрепляет ссылку на видео. */
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
      notify(t("Засчитано {a} ст. Команда выучила {s}", { a: r.added, s: r.sum })); setSel(new Set()); setLinks(""); onChanged();
    } catch (e) { setError(e instanceof ApiError ? (e.issues?.map((i) => i.message).join("; ") || e.message) : t("Ошибка сети")); }
    finally { setBusy(false); }
  }
  const myCount = mine.size;
  return (
    <div className="passage">
      <div className="row between"><strong>{t("Отрывок")} {passage.ref}</strong><span className="muted">{t("вы выучили")} {myCount} {t("из")} {passage.end - passage.start + 1}</span></div>
      {!locked && <p className="muted" style={{ margin: ".2rem 0" }}>{t("Отметьте стихи, которые выучили и записали на видео, вставьте ссылку и нажмите «Засчитать». Можно частями.")} <a href="#" onClick={(e) => { e.preventDefault(); selectAll(); }}>{t("Выбрать все оставшиеся")}</a></p>}
      <ul className="verses">
        {(passage.verses ?? []).map((v) => {
          const done = mine.has(v.idx), on = sel.has(v.idx);
          return (
            <li key={v.idx} className={done ? "done" : on ? "on" : ""} onClick={() => toggle(v.idx)}>
              <span className="box">{done ? "✓" : on ? "•" : ""}</span>
              <span className="ref">{v.ref}</span>
              <span className="text">{v.text ?? ""}</span>
            </li>
          );
        })}
      </ul>
      {!locked && (
        <div className="entry-form">
          <textarea rows={2} placeholder={t("Ссылки на видео (по одной на строку)")} value={links} onChange={(e) => setLinks(e.target.value)} />
          {error && <p className="error">{error}</p>}
          <div className="actions"><button disabled={busy || sel.size === 0 || !links.trim()} onClick={() => void send()}>{t("Засчитать")} {sel.size ? `${sel.size} ${t("ст.")}` : ""}</button></div>
        </div>
      )}
      {b.entries.filter((e) => e.side === (b.mySide ?? "ATTACK")).length > 0 && (
        <ul className="list" style={{ marginTop: ".4rem" }}>
          {b.entries.filter((e) => e.side === (b.mySide ?? "ATTACK")).map((e) => (
            <li key={e.id}>
              <div className="main"><strong>{e.ref}</strong> <span className="muted">· {e.verses} ст. · {e.nickname}</span>{e.adminComment && <div className="muted">Комментарий: {e.adminComment}</div>}<div>{e.links.map((l) => <a key={l} href={l} target="_blank" rel="noopener noreferrer" style={{ marginRight: ".5rem" }}>{t("видео")}</a>)}</div></div>
              <span className={"badge" + (e.status === "APPROVED" ? " ok" : e.status === "REJECTED" ? " bad" : "")}>{e.status === "APPROVED" ? t("одобрено") : e.status === "REJECTED" ? t("вернули") : t("на проверке")}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Капитан защитников выбирает последовательный отрывок из всей книги: клик по первому и последнему стиху. */
function PassagePicker({ gameId, battleId, need, onChosen }: { gameId: string; battleId: string; need: number; onChosen: () => void }) {
  const { notify } = useUi();
  const [book, setBook] = useState<BookTextDto | null>(null);
  const [chapter, setChapter] = useState(0);
  const [a, setA] = useState<{ c: number; v: number } | null>(null);
  const [z, setZ] = useState<{ c: number; v: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<BookTextDto>(`/api/games/${gameId}/battles/${battleId}/book`).then(setBook).catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети"))); }, [gameId, battleId]);
  if (error) return <p className="error">{error}</p>;
  if (!book) return <p className="muted">{t("Загружаем книгу…")}</p>;
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
  return (
    <div className="picker">
      <p className="muted" style={{ margin: ".3rem 0" }}>Выберите последовательный отрывок из книги {book.name}: нажмите на первый стих, затем на последний. Надо выучить не меньше {need} ст. в сумме по участникам — отрывок может быть короче, если его выучат несколько человек.</p>
      <div className="row" style={{ flexWrap: "wrap", gap: ".3rem" }}>
        {book.verseCounts.map((_, c) => <button key={c} type="button" className={"sm " + (c === chapter ? "" : "secondary")} onClick={() => setChapter(c)}>{c + 1}</button>)}
      </div>
      <ul className="verses">
        {(book.chapters?.[chapter] ?? []).map((text, v) => (
          <li key={v} className={inRange(chapter, v) ? "on" : a && a.c === chapter && a.v === v ? "on" : ""} onClick={() => click(chapter, v)}>
            <span className="ref">{chapter + 1}:{v + 1}</span><span className="text">{text}</span>
          </li>
        ))}
      </ul>
      <div className="actions">
        <span className="muted">{a ? (z ? `${a.c + 1}:${a.v + 1} — ${z.c + 1}:${z.v + 1} · ${count} ст.` : `начало ${a.c + 1}:${a.v + 1}, выберите конец`) : t("ничего не выбрано")}</span>
        <button disabled={!a || !z} onClick={() => void confirmPassage()}>{t("Утвердить отрывок")}</button>
      </div>
    </div>
  );
}
