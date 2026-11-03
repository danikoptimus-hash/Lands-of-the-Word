import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, type WallBlockDto, type WallBrickDto, type WallDto } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { fmtDate, plural } from "../lib/format";
import { Icon } from "../components/Icon";
import { Chip } from "../components/Chip";
import { Sheet } from "../components/Sheet";
import { Help } from "../components/Help";
import { BookMap, PlanSheet } from "./BookMap";

/**
 * Городская стена в своём городе (решение владельца 01.11): кладка из принятых блоков (каждый блок — участник выучил
 * `blockVerses` стихов книги подряд), блоки на проверке — пунктиром, кнопка «+» открывает лист сдачи: выбрать блок
 * книги и прикрепить видео. Текста минимум: толщину показывает чип в шапке города, здесь — сама кладка.
 * Надломленный блок (решение владельца 02.11: в ответ взяли только недостающие стихи) — камень с отколотым краем и
 * трещиной; нажатие на любой камень показывает, сколько в нём стихов; починка — досдать недостающие стихи в том же листе.
 */

const verses = (n: number) => plural(n, ["стих", "стиха", "стихов"]);
const blocksWord = (n: number) => plural(n, ["блок", "блока", "блоков"]);

type Brick = WallBlockDto & { key: string };

/** Отколотый край: доля откола — доля недостающих стихов (не меньше пятой части камня, чтобы было видно). */
const chip = (w: number, frac: number) => w * (1 - Math.max(0.2, Math.min(0.7, frac)));
const crackedShape = (x: number, y: number, w: number, h: number, frac: number) => {
  const cx = x + chip(w, frac);
  return `M${x} ${y}H${cx + 3}L${cx - 2} ${y + h * 0.3}L${cx + 2} ${y + h * 0.55}L${cx - 3} ${y + h * 0.78}L${cx + 1} ${y + h}H${x}Z`;
};
const crackLine = (x: number, y: number, w: number, h: number, frac: number) => {
  const cx = x + chip(w, frac);
  return `M${cx - 4} ${y + h * 0.45}l-5 -3l-4 3l-5 -2`;
};

/**
 * Кладка: ряды по 8 кирпичей снизу вверх с перевязкой, зубцы над верхним рядом принятых блоков; блоки на проверке —
 * пунктирные камни, сложенные рядом со стеной (в кладку они лягут после проверки). Нажатие на камень — подсказка со
 * стихами (решение владельца 02.11: «при нажатии на блок в стене должно показываться количество стихов»).
 */
function Masonry({ blocks, fresh }: { blocks: WallBlockDto[]; fresh: Set<string> }) {
  const PER = 8, BW = 40, BH = 18, GAP = 2, MAXROWS = 10, PILE = 2;
  const [pick, setPick] = useState<string | null>(null);
  // Блок воина — два кирпича (решение владельца 02.11): раскладываем по весу, ключ — id блока и номер кирпича.
  const bricksOf = (st: WallBlockDto["status"]): Brick[] => blocks.filter((b) => b.status === st && !b.used).flatMap((b) => Array.from({ length: Math.max(1, b.weight) }, (_, i) => ({ ...b, key: `${b.id}:${i}` })));
  const approved = bricksOf("APPROVED"), pending = bricksOf("SUBMITTED");
  const shown = approved.slice(0, PER * MAXROWS);
  const rows = Math.max(1, Math.ceil(shown.length / PER));
  const merlon = 8, ground = 4;
  const wallW = PER * (BW + GAP) + GAP;
  const pileShown = pending.slice(0, PILE * 3);
  const pileRows = Math.ceil(pileShown.length / PILE);
  const W = wallW + (pending.length ? (BW + GAP) * PILE + GAP * 3 : 0);
  const H = Math.max(rows * (BH + GAP), pileRows * (BH + GAP)) + merlon + ground + 2;
  const topRow = rows - 1, filledTop = shown.length - topRow * PER;
  const shiftOf = (r: number) => (r % 2 === 1 ? (BW + GAP) / 2 : 0);
  const placed = shown.map((b, i) => { const r = Math.floor(i / PER), c = i % PER; return { b, x: GAP + c * (BW + GAP) + shiftOf(r), y: H - ground - (r + 1) * (BH + GAP), r, c }; });
  const pile = pileShown.map((b, i) => { const r = Math.floor(i / PILE), c = i % PILE; return { b, x: wallW + GAP * 2 + c * (BW + GAP) + (r % 2 ? (BW + GAP) / 4 : 0), y: H - ground - (r + 1) * (BH + GAP) }; });
  const lines = (b: Brick): [string, string] => {
    const total = b.verses, intact = total - b.missing;
    const who = `${b.ref} · ${b.nickname}${b.weight > 1 ? ` · ${t("воин ×{k}", { k: b.weight })}` : ""}`;
    const what = b.missing > 0 ? `${t("{n} из {m} стихов", { n: intact, m: total })} · ${t("не хватает {n}", { n: b.missing })}` : b.status === "SUBMITTED" ? `${verses(total)} · ${t("на проверке")}` : b.repairPending ? `${verses(total)} · ${t("починка на проверке")}` : verses(total);
    return [who, what];
  };
  const toggle = (key: string) => setPick((v) => (v === key ? null : key));
  const brick = (b: Brick, x: number, y: number, cls: string) => {
    const on = pick === b.key;
    const [l1, l2] = lines(b);
    const common = { tabIndex: 0, role: "button", "aria-label": `${l1}, ${l2}`, onClick: (e: React.MouseEvent) => { e.stopPropagation(); toggle(b.key); }, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(b.key); } } };
    if (b.missing > 0) {
      const frac = b.missing / Math.max(1, b.verses);
      return <g key={b.key} className={cls + " cracked" + (on ? " pick" : "")} {...common}><title>{`${l1} · ${l2}`}</title><path className="shape" d={crackedShape(x, y, BW, BH, frac)} /><path className="crack" d={crackLine(x, y, BW, BH, frac)} /></g>;
    }
    return <rect key={b.key} className={cls + (on ? " pick" : "")} x={x} y={y} width={BW} height={BH} rx={1.5} {...common}><title>{`${l1} · ${l2}`}</title></rect>;
  };
  const picked = [...placed, ...pile].find((p) => p.b.key === pick) ?? null;
  const tip = picked ? (() => {
    const [l1, l2] = lines(picked.b);
    const tw = Math.min(W - 2, Math.max(l1.length, l2.length) * 5.1 + 12), th = 26;
    const tx = Math.max(1, Math.min(W - tw - 1, picked.x + BW / 2 - tw / 2));
    const above = picked.y - th - 4 >= -merlon;
    const ty = above ? picked.y - th - 4 : picked.y + BH + 4;
    return { l1, l2, tx, ty, tw, th };
  })() : null;
  return (
    <svg className="masonry" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={approved.length ? t("Стена: {n}", { n: blocksWord(approved.length) }) : t("Стены ещё нет")} onClick={() => setPick(null)}>
      {/* Текстуры кирпичей (решение владельца 02.11: «на стену в городе тоже нужно сгенерить текстуры»): узор на каждый камень по его рамке. */}
      <defs>
        {[["bm-sand", "brick-sand"], ["bm-sand2", "brick-sand2"], ["bm-dark", "brick-dark"]].map(([id, f]) => (
          <pattern key={id} id={id} patternUnits="objectBoundingBox" patternContentUnits="objectBoundingBox" width={1} height={1}><image href={`/img/props/${f}.webp`} width={1} height={1} preserveAspectRatio="none" /></pattern>
        ))}
      </defs>
      {placed.map(({ b, x, y, r, c }) => brick(b, x, y, "brick" + ((r + c) % 3 === 1 ? " alt" : "") + (b.mine ? " mine" : "") + (fresh.has(b.id) ? " new" : "")))}
      {approved.length === 0 && Array.from({ length: PER }, (_, c) => <rect key={"g" + c} className="brick ghost" x={GAP + c * (BW + GAP)} y={H - ground - (BH + GAP)} width={BW} height={BH} rx={1.5} />)}
      {/* зубцы — над заполненными колонками верхнего ряда */}
      {approved.length > 0 && Array.from({ length: Math.ceil(PER / 2) }, (_, i) => (2 * i < filledTop ? <rect key={"m" + i} className="brick merlon" x={GAP + i * 2 * (BW + GAP) + shiftOf(topRow)} y={H - ground - rows * (BH + GAP) - merlon} width={BW * 0.6} height={merlon} rx={1} /> : null))}
      {/* камни на проверке — рядом со стеной */}
      {pile.map(({ b, x, y }) => brick(b, x, y, "brick pending" + (b.mine ? " mine" : "")))}
      <line className="ground" x1={0} x2={W} y1={H - ground + 1} y2={H - ground + 1} />
      {approved.length > shown.length && <text className="more" x={wallW - 4} y={merlon + 14} textAnchor="end">+{approved.length - shown.length}</text>}
      {pending.length > pileShown.length && <text className="more" x={W - 2} y={H - ground - pileRows * (BH + GAP) - 3} textAnchor="end">+{pending.length - pileShown.length}</text>}
      {tip && (
        <g className="tip" pointerEvents="none">
          <rect x={tip.tx} y={tip.ty} width={tip.tw} height={tip.th} rx={4} />
          <text x={tip.tx + 6} y={tip.ty + 10.5}>{tip.l1}</text>
          <text x={tip.tx + 6} y={tip.ty + 21}>{tip.l2}</text>
        </g>
      )}
    </svg>
  );
}

export function WallSection({ gameId, nodeKey, version, asleep = false, onChanged }: { gameId: string; nodeKey: string; version: number; /** Ночь или шторм: сдать блок нельзя (сервер всё равно откажет), кнопка выключена. */ asleep?: boolean; onChanged: () => void }) {
  const { notify, confirm } = useUi();
  const [d, setD] = useState<WallDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [build, setBuild] = useState(false);
  const [list, setList] = useState(false);
  const known = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const load = () => api<WallDto>(`/api/games/${gameId}/my-city/${encodeURIComponent(nodeKey)}/wall`).then((w) => {
    // Новый блок в кладке появляется с анимацией: помним, какие уже видели.
    const ids = new Set(w.blocks.map((b) => b.id));
    if (known.current) setFresh(new Set([...ids].filter((id) => !known.current!.has(id)))); else setFresh(new Set());
    known.current = ids;
    setD(w); setError(null);
  }).catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети")));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [gameId, nodeKey, version]);
  async function remove(b: WallBlockDto) {
    if (!(await confirm(t("Убрать блок {ref} с проверки?", { ref: b.ref }), { okLabel: t("Убрать") }))) return;
    try { await api(`/api/games/${gameId}/my-city/${encodeURIComponent(nodeKey)}/wall/${b.id}`, { method: "DELETE" }); await load(); onChanged(); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
  }
  if (!d) return error ? <p className="error" role="alert">{error}</p> : null;
  const mine = d.blocks.filter((b) => b.mine);
  const canBuild = d.canBuild && !asleep;
  const whyNot = asleep ? t("Ночью и в шторм стену не строят") : d.why ?? "";
  const cracked = d.blocks.filter((b) => b.status === "APPROVED" && !b.used && b.missing > 0).length;
  return (
    <div className="wall">
      <Masonry blocks={d.blocks} fresh={fresh} />
      <div className="row between nowrap wall-bar">
        <span className="muted small">
          {d.blockCount > 0 ? `${blocksWord(d.blockCount)} · ${verses(d.verses)}` : t("Стены ещё нет")}
          {cracked > 0 && <> · <Chip tone="warn" icon="alert" title={t("Надломленных блоков: {n}", { n: cracked })}>{cracked}</Chip></>}
          {d.pending > 0 && <> · <Chip tone="warn" icon="clock">{d.pending}</Chip></>}
          <Help>{t("Блок — {n} стихов книги подряд, которые выучил один участник. Принятые блоки сами ложатся в ответ за минуту до конца времени ответа: до этого хранители отвечают сами. В ответ из блока берутся только недостающие стихи: такой блок надломлен, пока хозяин не досдаст их. Другие команды видят стену, но не её толщину.", { n: d.blockVerses })}</Help>
        </span>
        <span className="row nowrap">
          {d.blocks.length > 0 && <button type="button" className="ghost icon" aria-label={t("Блоки стены")} title={t("Блоки стены")} aria-expanded={list} onClick={() => setList((v) => !v)}><Icon name="list" /></button>}
          <button type="button" className="icon" aria-label={t("Сдать блок стены")} title={canBuild ? t("Сдать блок стены") : whyNot} disabled={!canBuild} onClick={() => setBuild(true)}><Icon name="plus" /></button>
        </span>
      </div>
      {!canBuild && whyNot && <p className="hint">{whyNot}</p>}
      {d.returned.length > 0 && d.returned.map((r) => <p key={r.id} className="hint warn"><Icon name="back" /> {r.repair ? t("Починка {ref} возвращена", { ref: r.ref }) : t("Блок {ref} возвращён", { ref: r.ref })}{r.adminComment ? `: ${r.adminComment}` : ""}</p>)}
      {list && (
        <ul className="list mt-2 wall-list">
          {[...d.blocks].reverse().map((b) => (
            <li key={b.id}>
              <div className="main"><span className="title">{b.ref} <span className="muted small">· {b.nickname} · {b.missing > 0 && !b.used ? t("{n} из {m} стихов", { n: b.verses - b.missing, m: b.verses }) : verses(b.verses)}</span>{b.weight > 1 && <Chip tone="accent" icon="sword">{t("воин ×{k}", { k: b.weight })}</Chip>}</span>{b.adminComment && <span className="meta">{b.adminComment}</span>}</div>
              <span className="row nowrap">
                {b.used ? <Chip tone="bad" icon="wave" title={b.usedAt ? t("Лёг в ответ {d}", { d: fmtDate(b.usedAt, { time: false }) }) : undefined}>{t("сгорел")}</Chip>
                  : b.status === "APPROVED" && b.missing > 0 ? <Chip tone="warn" icon={b.repairPending ? "clock" : "alert"}>{b.repairPending ? t("починка на проверке") : t("надломлен")}</Chip>
                  : <Chip tone={b.status === "APPROVED" ? "ok" : "warn"} icon={b.status === "APPROVED" ? "check" : "clock"}>{b.status === "APPROVED" ? t("принят") : t("на проверке")}</Chip>}
                {b.mine && b.status === "SUBMITTED" && <button type="button" className="ghost icon sm" aria-label={t("Убрать блок")} title={t("Убрать блок")} onClick={() => void remove(b)}><Icon name="x" /></button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {/* Карта книги (решение владельца 02.11: «и в блоках города, чтобы капитан понимал, кому что»). */}
      <details className="disclose sm book-map-fold">
        <summary><Icon name="book" />{t("Книга")}<Icon name="chevron-down" className="chev" /></summary>
        <BookMap gameId={gameId} bookCode={d.bookCode} version={version + d.blocks.length} look="bricks" />
      </details>
      {build && <BuildSheet gameId={gameId} nodeKey={nodeKey} bookCode={d.bookCode} bricks={d.bricks} members={d.members} canPlan={d.canPlan} n={d.blockVerses} mineCount={mine.length} onClose={() => setBuild(false)} onDone={() => { setBuild(false); void load(); onChanged(); }} />}
    </div>
  );
}

/**
 * Лист сдачи блока: кирпичи книги с текстурами (моё состояние: свободен, сдан, принят, сгорел, надломлен — к починке);
 * на каждом — сколько человек в команде могут его взять (решение владельца 02.11: «чтобы капитан понимал, сколько
 * человек может взять, какие полностью свободны»), полностью свободные выделены. Выбранный блок показывает имена,
 * капитан поручает блок чипами (план заучивания). Ссылка на видео — для своей сдачи.
 */
function BuildSheet({ gameId, nodeKey, bookCode, bricks, members, canPlan, n, mineCount, onClose, onDone }: { gameId: string; nodeKey: string; bookCode: string; bricks: WallBrickDto[]; members: WallDto["members"]; canPlan: boolean; n: number; mineCount: number; onClose: () => void; onDone: () => void }) {
  const { notify } = useUi();
  const [k, setK] = useState<number | null>(null);
  /** Блок, для которого открыт лист «кто будет учить» (капитану; решение владельца 03.11). */
  const [who, setWho] = useState<WallBrickDto | null>(null);
  const [links, setLinks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planned, setPlanned] = useState<Map<number, Set<string>>>(() => new Map(bricks.map((b) => [b.k, new Set(b.planned)])));
  const chosen = useMemo(() => bricks.find((b) => b.k === k) ?? null, [bricks, k]);
  const repair = chosen?.state === "cracked" ? chosen : null;
  const canSubmit = chosen != null && (chosen.state === "free" || chosen.state === "cracked");
  const urls = links.split(/\s+/).filter(Boolean);
  const nameOf = (id: string) => members.find((m) => m.userId === id)?.name ?? "?";
  async function send() {
    if (k === null || !canSubmit) return;
    setBusy(true); setError(null);
    try {
      const r = await api<{ ref: string; repair?: boolean }>(`/api/games/${gameId}/my-city/${encodeURIComponent(nodeKey)}/wall`, { method: "POST", body: JSON.stringify({ block: k, links: urls }) });
      notify(r.repair ? t("Починка {ref} сдана на проверку", { ref: r.ref }) : t("Блок {ref} сдан на проверку", { ref: r.ref })); onDone();
    } catch (e) { setError(e instanceof ApiError ? (e.issues?.map((i) => i.message).join("; ") || e.message) : t("Ошибка сети")); }
    finally { setBusy(false); }
  }
  async function plan(b: WallBrickDto, userId: string, on: boolean) {
    setPlanned((m) => { const next = new Map(m); const set = new Set(next.get(b.k) ?? []); if (on) set.add(userId); else set.delete(userId); next.set(b.k, set); return next; });
    try { await api(`/api/games/${gameId}/book-plan`, { method: "POST", body: JSON.stringify({ book: bookCode, from: b.start, to: b.end, userId, on }) }); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
  }
  const stateTitle = (b: WallBrickDto) => b.state === "approved" ? t("принят") : b.state === "submitted" ? t("на проверке") : b.state === "learned" ? t("стихи сданы в испытании") : b.state === "used" ? t("сгорел в испытании") : b.state === "cracked" ? t("надломлен: не хватает {n} стихов", { n: b.missing ?? 0 }) : "";
  const all = members.length;
  return (
    <Sheet size="md" title={t("Блок стены")} onClose={onClose} foot={<button type="button" disabled={busy || !canSubmit || urls.length === 0} onClick={() => void send()}><Icon name="check" />{repair ? t("Починить {ref}", { ref: repair.ref }) : chosen && canSubmit ? t("Сдать {ref}", { ref: chosen.ref }) : t("Сдать блок")}</button>}>
      <p className="hint">{repair ? t("Починка {ref}: досдайте {n} стихов ({part}).", { ref: repair.ref, n: repair.missing ?? 0, part: repair.repairRef ?? "" }) : t("Выучите {n} стихов одного блока наизусть, запишите видео и прикрепите ссылку.", { n })}{!repair && mineCount > 0 ? ` ${t("Ваших блоков в стене: {n}.", { n: mineCount })}` : ""}<Help>{t("Число на кирпиче — сколько человек в команде ещё могут его взять; «все» — блок полностью свободен. Нажмите на блок — увидите имена; капитан поручает блок.")}</Help></p>
      <div className="brick-grid bricks-tex" role="radiogroup" aria-label={t("Блоки книги")}>
        {bricks.map((b) => {
          const takers = b.takers.length, pl = (planned.get(b.k) ?? new Set()).size;
          return (
            <button key={b.k} type="button" role="radio" aria-checked={k === b.k} className={"brick-btn " + b.state + (k === b.k ? " on" : "") + (takers === all && all > 0 ? " whole" : takers === 0 ? " none" : "")} disabled={!canPlan && b.state !== "free" && b.state !== "cracked"} title={stateTitle(b)} onClick={() => { setK(b.k); if (canPlan) setWho(b); }}>
              <span className="ref">{b.ref}</span>
              {b.state === "approved" && <Icon name="check" />}
              {b.state === "submitted" && <Icon name="clock" />}
              {b.state === "learned" && <Icon name="lock" />}
              {b.state === "used" && <Icon name="wave" />}
              {b.state === "cracked" && <Icon name="alert" />}
              <span className="cnt" title={t("Могут взять: {n}", { n: takers })}>{takers === all && all > 0 ? t("все") : takers}</span>
              {pl > 0 && <span className="pl" title={t("Поручен: {n}", { n: pl })}>{pl}</span>}
            </button>
          );
        })}
      </div>
      {canSubmit && (
        <div className="field mt-3">
          <label htmlFor="wall-links">{t("Ссылки на видео")}</label>
          <textarea id="wall-links" rows={2} value={links} onChange={(e) => setLinks(e.target.value)} placeholder={t("https://… — по одной на строку")} />
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {who && (
        <PlanSheet
          title={`${who.ref} · ${plural(who.end - who.start + 1, ["стих", "стиха", "стихов"])}`}
          taken={{ marked: [], learned: members.filter((m) => !who.takers.includes(m.userId)).map((m) => m.name) }}
          free={who.takers.map((uid) => ({ userId: uid, name: nameOf(uid), x2: members.find((m) => m.userId === uid)?.role === "WARRIOR" }))}
          planned={planned.get(who.k) ?? new Set()}
          canPlan={canPlan}
          emptyText={t("Этот блок уже некому взять: у каждого в команде часть его стихов сдана.")}
          onToggle={(uid, on) => void plan(who, uid, on)}
          onClose={() => setWho(null)}
        />
      )}
    </Sheet>
  );
}
