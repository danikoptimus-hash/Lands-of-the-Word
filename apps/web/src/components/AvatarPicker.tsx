import { useRef, useState, type ReactNode } from "react";
import { AVATAR_CODES, AVATAR_GROUPS, CREST_CODES, avatarImage } from "@lotw/domain";
import { ApiError, api } from "../lib/api";
import { t } from "../lib/i18n";
import { useUi } from "../lib/ui";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";
import { Tabs } from "./Tabs";

type Group = (typeof AVATAR_GROUPS)[number]["key"];
const GROUP_TITLE: Record<Group, () => string> = { people: () => t("Люди"), animals: () => t("Звери"), things: () => t("Предметы") };

/**
 * Выбор аватарки участника или герба команды из готового набора игры (решение владельца 14.11: своих фото игра не
 * принимает и не хранит). Нажатие на саму аватарку открывает лист с набором; нажатие на картинку сразу ставит её.
 * Аватарки разложены по вкладкам «Люди», «Звери», «Предметы» (решение владельца 14.11: «разделение… через табы»),
 * лист открывается на вкладке выбранной аватарки; гербы идут одним списком. Первая ячейка — «без картинки»:
 * кружок с буквой, как у тех, кто ничего не выбирал.
 */
export function AvatarPicker({ preview, url, kind, current, letter, color, onChanged }: {
  /** Как сейчас выглядит аватарка (кружок с буквой или картинка). */
  preview: ReactNode;
  /** PUT { avatarId } — код картинки или null. */
  url: string;
  /** Набор: аватарки участников или гербы команд. */
  kind: "user" | "team";
  current: string | null;
  /** Буква для ячейки «без картинки» и цвет кружка команды. */
  letter: string; color?: string;
  onChanged: () => void | Promise<void>;
}) {
  const ui = useUi();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const team = kind === "team";
  const groupOf = (code: string | null): Group => AVATAR_GROUPS.find((g) => { const n = code ? AVATAR_CODES.indexOf(code) + 1 : 0; return n >= g.from && n <= g.to; })?.key ?? "people";
  const [tab, setTab] = useState<Group>("people");
  const gridRef = useRef<HTMLDivElement>(null);
  const range = AVATAR_GROUPS.find((g) => g.key === tab)!;
  const codes = team ? CREST_CODES.map((c, i) => ({ c, n: i + 1 })) : AVATAR_CODES.map((c, i) => ({ c, n: i + 1 })).filter((x) => x.n >= range.from && x.n <= range.to);
  async function choose(avatarId: string | null) {
    if (avatarId === current) { setOpen(false); return; }
    setBusy(true);
    try {
      await api(url, { method: "PUT", body: JSON.stringify({ avatarId }) });
      await onChanged(); setOpen(false);
      ui.notify(avatarId ? (team ? t("Герб выбран") : t("Аватарка выбрана")) : (team ? t("Герб убран") : t("Аватарка убрана")));
    }
    catch (e) { ui.notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusy(false); }
  }
  const title = team ? t("Выбрать герб команды") : t("Выбрать аватарку");
  return (
    <div className="avatar-picker">
      <button type="button" className="avatar-btn" onClick={() => { setTab(groupOf(current)); setOpen(true); }} aria-label={title} title={title}>
        {preview}
        <span className="badge" aria-hidden="true"><Icon name="edit" /></span>
      </button>
      {open && (
        <Sheet title={team ? t("Герб команды") : t("Аватарка")} onClose={() => setOpen(false)} size="md" className="avatar-pick-sheet">
          {!team && <Tabs<Group> swipeArea={gridRef} value={tab} onChange={setTab} ariaLabel={t("Раздел набора")} items={AVATAR_GROUPS.map((g) => ({ key: g.key, label: GROUP_TITLE[g.key]() }))} />}
          <div className="avatar-pick-grid" ref={gridRef}>
            <button type="button" className={"avatar-opt none" + (current ? "" : " on")} disabled={busy} aria-pressed={!current} onClick={() => void choose(null)} aria-label={t("Без картинки: кружок с буквой")} title={t("Без картинки: кружок с буквой")}>
              <span className="letter" style={color ? { background: color, color: "#FFF6E3" } : undefined}>{letter}</span>
            </button>
            {codes.map(({ c, n }) => (
              <button key={c} type="button" className={"avatar-opt" + (c === current ? " on" : "")} disabled={busy} aria-pressed={c === current} onClick={() => void choose(c)} aria-label={team ? t("Герб {n}", { n }) : t("Аватарка {n}", { n })}>
                <img src={avatarImage(c) ?? undefined} alt="" loading="lazy" decoding="async" width={128} height={128} />
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}
