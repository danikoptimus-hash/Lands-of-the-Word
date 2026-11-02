import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, type WallBlockDto, type WallBrickDto, type WallDto } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { fmtDate, plural } from "../lib/format";
import { Icon } from "../components/Icon";
import { Chip } from "../components/Chip";
import { Sheet } from "../components/Sheet";
import { Help } from "../components/Help";

/**
 * Городская стена в своём городе (решение владельца 01.11): кладка из принятых блоков (каждый блок — участник выучил
 * `blockVerses` стихов книги подряд), блоки на проверке — пунктиром, кнопка «+» открывает лист сдачи: выбрать блок
 * книги и прикрепить видео. Текста минимум: толщину показывает чип в шапке города, здесь — сама кладка.
 */

const verses = (n: number) => plural(n, ["стих", "стиха", "стихов"]);
const blocksWord = (n: number) => plural(n, ["блок", "блока", "блоков"]);

/**
 * Кладка: ряды по 8 кирпичей снизу вверх с перевязкой, зубцы над верхним рядом принятых блоков; блоки на проверке —
 * пунктирные камни, сложенные рядом со стеной (в кладку они лягут после проверки).
 */
function Masonry({ blocks, fresh }: { blocks: WallBlockDto[]; fresh: Set<string> }) {
  const PER = 8, BW = 40, BH = 18, GAP = 2, MAXROWS = 10, PILE = 2;
  // Блок воина — два кирпича (решение владельца 02.11): раскладываем по весу, ключ — id блока и номер кирпича.
  const bricksOf = (st: WallBlockDto["status"]) => blocks.filter((b) => b.status === st && !b.used).flatMap((b) => Array.from({ length: Math.max(1, b.weight) }, (_, i) => ({ ...b, key: `${b.id}:${i}` })));
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
  return (
    <svg className="masonry" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={approved.length ? t("Стена: {n}", { n: blocksWord(approved.length) }) : t("Стены ещё нет")}>
      {Array.from({ length: rows }, (_, r) => {
        const y = H - ground - (r + 1) * (BH + GAP);
        return Array.from({ length: PER }, (_, c) => {
          const i = r * PER + c;
          const b = shown[i];
          const x = GAP + c * (BW + GAP) + shiftOf(r);
          if (!b) return r === 0 && approved.length === 0 ? <rect key={i} className="brick ghost" x={x} y={y} width={BW} height={BH} rx={1.5} /> : null;
          const cls = "brick" + ((r + c) % 3 === 1 ? " alt" : "") + (b.mine ? " mine" : "") + (fresh.has(b.id) ? " new" : "");
          return <rect key={b.key} className={cls} x={x} y={y} width={BW} height={BH} rx={1.5}><title>{`${b.ref} · ${b.nickname}${b.weight > 1 ? ` · ${t("воин ×{k}", { k: b.weight })}` : ""}`}</title></rect>;
        });
      })}
      {/* зубцы — над заполненными колонками верхнего ряда */}
      {approved.length > 0 && Array.from({ length: Math.ceil(PER / 2) }, (_, i) => (2 * i < filledTop ? <rect key={"m" + i} className="brick merlon" x={GAP + i * 2 * (BW + GAP) + shiftOf(topRow)} y={H - ground - rows * (BH + GAP) - merlon} width={BW * 0.6} height={merlon} rx={1} /> : null))}
      {/* камни на проверке — рядом со стеной */}
      {pileShown.map((b, i) => {
        const r = Math.floor(i / PILE), c = i % PILE;
        return <rect key={b.key} className={"brick pending" + (b.mine ? " mine" : "")} x={wallW + GAP * 2 + c * (BW + GAP) + (r % 2 ? (BW + GAP) / 4 : 0)} y={H - ground - (r + 1) * (BH + GAP)} width={BW} height={BH} rx={1.5}><title>{`${b.ref} · ${b.nickname} · ${t("на проверке")}`}</title></rect>;
      })}
      <line className="ground" x1={0} x2={W} y1={H - ground + 1} y2={H - ground + 1} />
      {approved.length > shown.length && <text className="more" x={wallW - 4} y={merlon + 14} textAnchor="end">+{approved.length - shown.length}</text>}
      {pending.length > pileShown.length && <text className="more" x={W - 2} y={H - ground - pileRows * (BH + GAP) - 3} textAnchor="end">+{pending.length - pileShown.length}</text>}
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
  return (
    <div className="wall">
      <Masonry blocks={d.blocks} fresh={fresh} />
      <div className="row between nowrap wall-bar">
        <span className="muted small">
          {d.blockCount > 0 ? `${blocksWord(d.blockCount)} · ${verses(d.verses)}` : t("Стены ещё нет")}
          {d.pending > 0 && <> · <Chip tone="warn" icon="clock">{d.pending}</Chip></>}
          <Help>{t("Блок — {n} стихов книги подряд, которые выучил один участник. Принятые блоки сами ложатся в ответ за минуту до конца времени ответа: до этого хранители отвечают сами. Другие команды видят стену, но не её толщину.", { n: d.blockVerses })}</Help>
        </span>
        <span className="row nowrap">
          {d.blocks.length > 0 && <button type="button" className="ghost icon" aria-label={t("Блоки стены")} title={t("Блоки стены")} aria-expanded={list} onClick={() => setList((v) => !v)}><Icon name="list" /></button>}
          <button type="button" className="icon" aria-label={t("Сдать блок стены")} title={canBuild ? t("Сдать блок стены") : whyNot} disabled={!canBuild} onClick={() => setBuild(true)}><Icon name="plus" /></button>
        </span>
      </div>
      {!canBuild && whyNot && <p className="hint">{whyNot}</p>}
      {d.returned.length > 0 && d.returned.map((r) => <p key={r.id} className="hint warn"><Icon name="back" /> {t("Блок {ref} возвращён", { ref: r.ref })}{r.adminComment ? `: ${r.adminComment}` : ""}</p>)}
      {list && (
        <ul className="list mt-2 wall-list">
          {[...d.blocks].reverse().map((b) => (
            <li key={b.id}>
              <div className="main"><span className="title">{b.ref} <span className="muted small">· {b.nickname}</span>{b.weight > 1 && <Chip tone="accent" icon="sword">{t("воин ×{k}", { k: b.weight })}</Chip>}</span>{b.adminComment && <span className="meta">{b.adminComment}</span>}</div>
              <span className="row nowrap">
                {b.used ? <Chip tone="bad" icon="wave" title={b.usedAt ? t("Лёг в ответ {d}", { d: fmtDate(b.usedAt, { time: false }) }) : undefined}>{t("сгорел")}</Chip> : <Chip tone={b.status === "APPROVED" ? "ok" : "warn"} icon={b.status === "APPROVED" ? "check" : "clock"}>{b.status === "APPROVED" ? t("принят") : t("на проверке")}</Chip>}
                {b.mine && b.status === "SUBMITTED" && <button type="button" className="ghost icon sm" aria-label={t("Убрать блок")} title={t("Убрать блок")} onClick={() => void remove(b)}><Icon name="x" /></button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {build && <BuildSheet gameId={gameId} nodeKey={nodeKey} bricks={d.bricks} n={d.blockVerses} mineCount={mine.length} onClose={() => setBuild(false)} onDone={() => { setBuild(false); void load(); onChanged(); }} />}
    </div>
  );
}

/** Лист сдачи блока: кирпичи книги (свободные, сданные, выученные в испытаниях), ссылка на видео. */
function BuildSheet({ gameId, nodeKey, bricks, n, mineCount, onClose, onDone }: { gameId: string; nodeKey: string; bricks: WallBrickDto[]; n: number; mineCount: number; onClose: () => void; onDone: () => void }) {
  const { notify } = useUi();
  const [k, setK] = useState<number | null>(null);
  const [links, setLinks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = useMemo(() => bricks.find((b) => b.k === k) ?? null, [bricks, k]);
  const urls = links.split(/\s+/).filter(Boolean);
  async function send() {
    if (k === null) return;
    setBusy(true); setError(null);
    try {
      const r = await api<{ ref: string }>(`/api/games/${gameId}/my-city/${encodeURIComponent(nodeKey)}/wall`, { method: "POST", body: JSON.stringify({ block: k, links: urls }) });
      notify(t("Блок {ref} сдан на проверку", { ref: r.ref })); onDone();
    } catch (e) { setError(e instanceof ApiError ? (e.issues?.map((i) => i.message).join("; ") || e.message) : t("Ошибка сети")); }
    finally { setBusy(false); }
  }
  const stateTitle = (s: WallBrickDto["state"]) => s === "approved" ? t("принят") : s === "submitted" ? t("на проверке") : s === "learned" ? t("стихи сданы в испытании") : s === "used" ? t("сгорел в испытании") : "";
  return (
    <Sheet size="md" title={t("Блок стены")} onClose={onClose} foot={<button type="button" disabled={busy || k === null || urls.length === 0} onClick={() => void send()}><Icon name="check" />{chosen ? t("Сдать {ref}", { ref: chosen.ref }) : t("Сдать блок")}</button>}>
      <p className="hint">{t("Выучите {n} стихов одного блока наизусть, запишите видео и прикрепите ссылку.", { n })}{mineCount > 0 ? ` ${t("Ваших блоков в стене: {n}.", { n: mineCount })}` : ""}</p>
      <div className="brick-grid" role="radiogroup" aria-label={t("Блоки книги")}>
        {bricks.map((b) => (
          <button key={b.k} type="button" role="radio" aria-checked={k === b.k} className={"brick-btn " + b.state + (k === b.k ? " on" : "")} disabled={b.state !== "free"} title={stateTitle(b.state)} onClick={() => setK(b.k)}>
            <span className="ref">{b.ref}</span>
            {b.state === "approved" && <Icon name="check" />}
            {b.state === "submitted" && <Icon name="clock" />}
            {b.state === "learned" && <Icon name="lock" />}
            {b.state === "used" && <Icon name="wave" />}
          </button>
        ))}
      </div>
      <div className="field mt-3">
        <label htmlFor="wall-links">{t("Ссылки на видео")}</label>
        <textarea id="wall-links" rows={2} value={links} onChange={(e) => setLinks(e.target.value)} placeholder={t("https://… — по одной на строку")} />
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </Sheet>
  );
}
