import { useEffect, useRef, useState, type ReactNode } from "react";
import { AVATAR_CODES, AVATAR_GROUPS, CREST_CODES, avatarGroupOf, avatarImage } from "@lotw/domain";
import { ApiError, api } from "../lib/api";
import { t } from "../lib/i18n";
import { useUi } from "../lib/ui";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";
import { Tabs } from "./Tabs";

type Group = (typeof AVATAR_GROUPS)[number]["key"];
/**
 * Крупные картинки набора подгружаются заранее — для тех, что видны в наборе, и для соседей открытой (владелец 16.11:
 * «когда выбираю аватарку для просмотра, она подгружается, а когда листаю на следующие, они сразу отображаются…
 * поправь, чтобы не нужно было подгружать»). Картинки лежат в своём кэше приложения, так что качаются один раз.
 */
const warmed = new Set<string>();
function warm(code: string): void {
  const src = avatarImage(code, "lg");
  if (!src || warmed.has(src)) return;
  warmed.add(src);
  const im = new Image(); im.decoding = "async"; im.src = src;
}
const GROUP_TITLE: Record<Group, () => string> = { people: () => t("Люди"), animals: () => t("Животные"), things: () => t("Предметы") };

/**
 * Выбор аватарки участника или герба команды из готового набора игры (решение владельца 14.11: своих фото игра не
 * принимает и не хранит). Нажатие на саму аватарку открывает лист с набором. Нажатие на картинку набора показывает её
 * крупно в том же листе (решение владельца 16.11: «добавить возможность просматривать их крупно, а то сейчас при
 * нажатии она сразу ставится в профиль»): стрелки и свайп листают соседние картинки раздела, ставит картинку только
 * кнопка «Выбрать». Пока картинка открыта крупно, кнопка в шапке листа — стрелка «назад» к набору (как у листа дела),
 * а не крестик: тот, кто хочет вернуться к набору, не вылетает из выбора. Нажатие мимо листа и Esc — тоже к набору.
 * Аватарки разложены по вкладкам «Люди», «Животные», «Предметы» (решение владельца 14.11: «разделение… через табы»),
 * лист открывается на вкладке выбранной аватарки; гербы идут одним списком. Убрать выбранную картинку нельзя — только
 * сменить на другую (решение владельца 14.11: кнопку «Убрать аватарку» убрать); кружок с буквой — у тех, кто не выбирал.
 */
export function AvatarPicker({ preview, url, kind, current, onChanged }: {
  /** Как сейчас выглядит аватарка (кружок с буквой или картинка). */
  preview: ReactNode;
  /** PUT { avatarId } — код картинки. */
  url: string;
  /** Набор: аватарки участников или гербы команд. */
  kind: "user" | "team";
  current: string | null;
  onChanged: () => void | Promise<void>;
}) {
  const ui = useUi();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const team = kind === "team";
  const groupOf = (code: string | null): Group => avatarGroupOf(code ? AVATAR_CODES.indexOf(code) + 1 : 0);
  const [tab, setTab] = useState<Group>("people");
  const gridRef = useRef<HTMLDivElement>(null);
  /** Картинка, которую сейчас смотрят крупно; null — на экране набор. */
  const [look, setLook] = useState<string | null>(null);
  const swipeX = useRef<number | null>(null);
  // Картинки вкладки — по отрезкам номеров раздела, в порядке отрезков (новые картинки раздела стоят в его конце).
  const codes = team ? CREST_CODES.map((c, i) => ({ c, n: i + 1 }))
    : AVATAR_GROUPS.find((g) => g.key === tab)!.ranges.flatMap(([from, to]) => AVATAR_CODES.slice(from - 1, to).map((c, i) => ({ c, n: from + i })));
  async function choose(avatarId: string) {
    if (avatarId === current) { setOpen(false); return; }
    setBusy(true);
    try {
      await api(url, { method: "PUT", body: JSON.stringify({ avatarId }) });
      await onChanged(); setOpen(false); setLook(null);
      ui.notify(team ? t("Герб выбран") : t("Аватарка выбрана"));
    }
    catch (e) { ui.notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusy(false); }
  }
  const title = team ? t("Выбрать герб команды") : t("Выбрать аватарку");
  // Крупный просмотр: соседние картинки того же раздела, по кругу.
  const at = look ? codes.findIndex((x) => x.c === look) : -1;
  const seen = at >= 0 ? codes[at]! : null;
  const step = (d: number) => { if (at >= 0) setLook(codes[(at + d + codes.length) % codes.length]!.c); };
  // Соседние крупные картинки подгружаются заранее: листание без пустого кружка.
  useEffect(() => {
    if (at < 0) return;
    for (const d of [-2, -1, 1, 2]) warm(codes[(at + d + codes.length) % codes.length]!.c);
  }, [look]); // eslint-disable-line react-hooks/exhaustive-deps
  // Пока открыт набор, заранее подгружаются крупные картинки тех, что видны на экране: нажатие открывает картинку сразу.
  // Начинаем чуть погодя, чтобы не мешать самим картинкам набора; при прокрутке подгружаются вновь показавшиеся.
  useEffect(() => {
    const root = gridRef.current;
    if (!open || look || !root || typeof IntersectionObserver === "undefined") return;
    let io: IntersectionObserver | null = null;
    const timer = window.setTimeout(() => {
      io = new IntersectionObserver((entries) => { for (const e of entries) if (e.isIntersecting) { const c = (e.target as HTMLElement).dataset.code; if (c) warm(c); io?.unobserve(e.target); } }, { root, rootMargin: "80px 0px" });
      for (const el of root.querySelectorAll<HTMLElement>(".avatar-opt")) io.observe(el);
    }, 250);
    return () => { window.clearTimeout(timer); io?.disconnect(); };
  }, [open, look, tab, team]);
  useEffect(() => {
    if (!open || at < 0) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "ArrowLeft") step(-1); else if (e.key === "ArrowRight") step(1); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, look]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="avatar-picker">
      <button type="button" className="avatar-btn" onClick={() => { setTab(groupOf(current)); setLook(null); setOpen(true); }} aria-label={title} title={title}>
        {preview}
        <span className="badge" aria-hidden="true"><Icon name="edit" /></span>
      </button>
      {open && (
        <Sheet title={team ? t("Герб команды") : t("Аватарка")} onClose={() => (seen ? setLook(null) : setOpen(false))} closeLabel={seen ? (team ? t("Все гербы") : t("Все аватарки")) : undefined} size="md" className="avatar-pick-sheet">
          {seen ? (
            // Крупно: картинка во всю ширину листа, под ней — листание и единственная залитая кнопка «Выбрать».
            <div className="avatar-look" onTouchStart={(e) => { swipeX.current = e.touches[0]?.clientX ?? null; }} onTouchEnd={(e) => { const x0 = swipeX.current, x1 = e.changedTouches[0]?.clientX; swipeX.current = null; if (x0 != null && x1 != null && Math.abs(x1 - x0) > 48) step(x1 < x0 ? 1 : -1); }}>
              {/* Под крупной картинкой — уже загруженная малая из набора: пока крупная едет (если не успела подгрузиться заранее), кружок не пустой. */}
              <img className="big" key={seen.c} src={avatarImage(seen.c, "lg") ?? undefined} style={{ backgroundImage: `url(${avatarImage(seen.c) ?? ""})` }} alt={team ? t("Герб {n}", { n: seen.n }) : t("Аватарка {n}", { n: seen.n })} width={320} height={320} decoding="sync" />
              {/* Где мы в наборе: раздел и место в нём — стрелки листают только этот раздел. */}
              <p className="look-where">{team ? t("Герб {n} из {m}", { n: at + 1, m: codes.length }) : t("{group} · {n} из {m}", { group: GROUP_TITLE[tab](), n: at + 1, m: codes.length })}</p>
              <div className="look-row">
                <button type="button" className="secondary look-nav prev" onClick={() => step(-1)} aria-label={t("Предыдущая картинка")} title={t("Предыдущая картинка")}><Icon name="chevron" /></button>
                {seen.c === current
                  ? <span className="look-now">{team ? t("Это герб вашей команды") : t("Это ваша аватарка")}</span>
                  : <button type="button" className="look-pick" disabled={busy} onClick={() => void choose(seen.c)}><Icon name="check" />{team ? t("Выбрать этот герб") : t("Выбрать эту аватарку")}</button>}
                <button type="button" className="secondary look-nav" onClick={() => step(1)} aria-label={t("Следующая картинка")} title={t("Следующая картинка")}><Icon name="chevron" /></button>
              </div>
            </div>
          ) : (<>
          {!team && <Tabs<Group> swipeArea={gridRef} value={tab} onChange={setTab} ariaLabel={t("Раздел набора")} items={AVATAR_GROUPS.map((g) => ({ key: g.key, label: GROUP_TITLE[g.key]() }))} />}
          {/* Листается только эта область: вкладки стоят на месте. Кнопки «убрать картинку» нет (решение владельца 14.11). */}
          <div className="avatar-pick-scroll" ref={gridRef}>
          <div className="avatar-pick-grid">
            {codes.map(({ c, n }) => (
              <button key={c} type="button" data-code={c} className={"avatar-opt" + (c === current ? " on" : "")} aria-pressed={c === current} onPointerDown={() => warm(c)} onClick={() => setLook(c)} aria-label={team ? t("Герб {n}", { n }) : t("Аватарка {n}", { n })}>
                <img src={avatarImage(c) ?? undefined} alt="" loading="lazy" decoding="async" width={128} height={128} />
              </button>
            ))}
          </div>
          </div>
          </>)}
        </Sheet>
      )}
    </div>
  );
}
