import { useRef, useState, type ReactNode } from "react";
import { AVATAR_CODES, AVATAR_GROUPS, CREST_CODES, avatarGroupOf, avatarImage } from "@lotw/domain";
import { ApiError, api } from "../lib/api";
import { t } from "../lib/i18n";
import { useUi } from "../lib/ui";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";
import { Tabs } from "./Tabs";

type Group = (typeof AVATAR_GROUPS)[number]["key"];
const GROUP_TITLE: Record<Group, () => string> = { people: () => t("Люди"), animals: () => t("Животные"), things: () => t("Предметы") };

/**
 * Выбор аватарки участника или герба команды из готового набора игры (решение владельца 14.11: своих фото игра не
 * принимает и не хранит). Нажатие на саму аватарку открывает лист с набором; нажатие на картинку сразу ставит её.
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
  // Картинки вкладки — по отрезкам номеров раздела, в порядке отрезков (новые картинки раздела стоят в его конце).
  const codes = team ? CREST_CODES.map((c, i) => ({ c, n: i + 1 }))
    : AVATAR_GROUPS.find((g) => g.key === tab)!.ranges.flatMap(([from, to]) => AVATAR_CODES.slice(from - 1, to).map((c, i) => ({ c, n: from + i })));
  async function choose(avatarId: string) {
    if (avatarId === current) { setOpen(false); return; }
    setBusy(true);
    try {
      await api(url, { method: "PUT", body: JSON.stringify({ avatarId }) });
      await onChanged(); setOpen(false);
      ui.notify(team ? t("Герб выбран") : t("Аватарка выбрана"));
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
          {/* Листается только эта область: вкладки стоят на месте. Кнопки «убрать картинку» нет (решение владельца 14.11). */}
          <div className="avatar-pick-scroll" ref={gridRef}>
          <div className="avatar-pick-grid">
            {codes.map(({ c, n }) => (
              <button key={c} type="button" className={"avatar-opt" + (c === current ? " on" : "")} disabled={busy} aria-pressed={c === current} onClick={() => void choose(c)} aria-label={team ? t("Герб {n}", { n }) : t("Аватарка {n}", { n })}>
                <img src={avatarImage(c) ?? undefined} alt="" loading="lazy" decoding="async" width={128} height={128} />
              </button>
            ))}
          </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}
