import { useCallback, useEffect, useState, type FormEvent } from "react";
import { BOOKS } from "@lotw/domain";
import { api, ApiError, PROOF_LABEL } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { Icon } from "../components/Icon";
import { Chip } from "../components/Chip";
import { Sheet } from "../components/Sheet";
import { ActionMenu } from "../components/ActionMenu";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { Help } from "../components/Help";
import { plural } from "../lib/format";

type ProofType = "REPORT" | "PHOTO_LINK" | "VIDEO_LINK" | "AUDIO_LINK" | "WITNESS";
interface DeedDto { id: string; title: string; description: string; direction: string; proofType: ProofType; canRepeat: boolean; bookCodes: string[]; chance: number; secret: boolean; remote: boolean; siegePoints: number | null; /** Минимальное пожертвование вместо дела; null — нельзя (ценник у каждого дела свой, решение владельца 02.10). */ donationMin: number | null ; /** На картах команд сейчас: свободных и в работе (взято, на проверке, возвращено). */ onMap?: { free: number; taken: number; /** Сколько из свободных — морские рейсы (на карте корабль, а не свиток). */ sea?: number; /** Разбивка по командам: сверять с картой «глазами команды». */ teams?: Array<{ index: number; name: string; color: string; free: number; taken: number }> }; /** Общее дело Каменоломни и сколько камней даёт. */ quarry?: boolean; stones?: number }
type Form = { quarry: boolean; stones: number; title: string; description: string; direction: string; proofType: ProofType; canRepeat: boolean; bookCodes: string[]; chance: number; secret: boolean; remote: boolean; siegePoints: number | ""; donationMin: number | "" };
/** Вероятность появления дела на новой дороге: проценты с шагом 20 (решение владельца 04.10). */
const CHANCES = [20, 40, 60, 80, 100];
const EMPTY: Form = { quarry: false, stones: 1, title: "", description: "", direction: "", proofType: "PHOTO_LINK", canRepeat: true, bookCodes: [], chance: 60, secret: false, remote: false, siegePoints: "", donationMin: "" };

/** Вкладка «Дела»: список дел игры; добавление и изменение — в одной форме-шторке; стандартный набор — только пока список пуст. */
/**
 * В каталоге администратора дело — шаблон: «[Книга]» показываем плашкой. Команде на карте вместо неё
 * сервер подставляет книгу города, из которого выходит сторона (withDeedBook).
 */
function withBook(text: string) {
  const parts = text.split(/(\[книга\]|\[главы\])/i);
  if (parts.length === 1) return text;
  return parts.map((p, i) => (/^\[книга\]$/i.test(p) ? <Chip key={i} tone="accent" icon="book" title={t("Подставится книга города, из которого выходит сторона")}>{t("книга города")}</Chip>
    : /^\[главы\]$/i.test(p) ? <Chip key={i} tone="accent" icon="book" title={t("Подставятся книга и пять глав подряд, которые выдаёт игра")}>{t("главы от игры")}</Chip> : p));
}

/** mode — раздел без переключателя: «roads» в разделе «Дела», «quarry» в листе Каменоломни у администратора (решение владельца 05.10). */
export function DeedsBlock({ gameId, version = 0, onChange, mode }: { gameId: string; version?: number; onChange?: () => void; mode?: "roads" | "quarry" }) {
  const [deeds, setDeeds] = useState<DeedDto[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [directions, setDirections] = useState<string[]>([]);
  const [recommended, setRecommended] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { confirm, notify } = useUi();
  /** Открытая форма: null — закрыта; { id: null } — новое дело; { id } — изменение. */
  const [sheet, setSheet] = useState<{ id: string | null; form: Form } | null>(null);
  /** Два раздела (решение владельца 04.10): обычные дела дорог и общие дела Каменоломни; переключатель вверху. */
  const [section, setSection] = useState<"roads" | "quarry">(mode ?? "roads");
  const inQuarry = (mode ?? section) === "quarry";
  const form = sheet?.form ?? EMPTY;
  const setForm = (patch: Partial<Form>) => setSheet((s) => (s ? { ...s, form: { ...s.form, ...patch } } : s));
  /** Описание дела в списке свёрнуто в одну строку; полностью — по нажатию на строку (решение владельца 18.09). */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpanded((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const bookName = (c: string) => BOOKS.find((b) => b.code === c)?.nameRu ?? c;

  const load = useCallback(() => api<{ deeds: DeedDto[]; directions: string[]; recommendedMin: number }>(`/api/games/${gameId}/deeds`)
    .then((r) => { setDeeds(r.deeds); setDirections(r.directions); setRecommended(r.recommendedMin); setLoadError(false); })
    .catch(() => setLoadError(true)), [gameId]);
  const reload = async () => { await load(); onChange?.(); };
  useEffect(() => { void load(); }, [load, version]);

  const openNew = () => { setError(null); setSheet({ id: null, form: { ...EMPTY, quarry: inQuarry, direction: directions[0] ?? "" } }); };
  const formOf = (d: DeedDto): Form => ({ quarry: d.quarry ?? false, stones: d.stones ?? 1, title: d.title, description: d.description, direction: d.direction, proofType: d.proofType, canRepeat: d.canRepeat, bookCodes: d.bookCodes ?? [], chance: d.chance ?? 60, secret: d.secret ?? false, remote: d.remote ?? false, siegePoints: d.siegePoints ?? "", donationMin: d.donationMin ?? "" });
  const openEdit = (d: DeedDto) => { setError(null); setSheet({ id: d.id, form: formOf(d) }); };
  /** Дубликат дела (решение владельца 04.10): форма нового дела, заполненная полями исходного; сохраняется как отдельное дело. */
  const openDuplicate = (d: DeedDto) => { setError(null); setSheet({ id: null, form: { ...formOf(d), title: t("{title} (копия)", { title: d.title }) } }); };
  const close = () => setSheet(null);

  async function save(e: FormEvent) {
    e.preventDefault(); if (!sheet) return;
    setError(null); setBusy(true);
    try {
      const f = sheet.form.quarry ? { ...sheet.form, canRepeat: true, bookCodes: [], secret: false, remote: false, siegePoints: "" as const, donationMin: "" as const } : sheet.form;
      const body = JSON.stringify({ ...f, siegePoints: f.siegePoints === "" ? null : Number(f.siegePoints), donationMin: f.donationMin === "" ? null : Number(f.donationMin) });
      if (sheet.id) { await api(`/api/games/${gameId}/deeds/${sheet.id}`, { method: "PUT", body }); notify(t("Дело сохранено")); }
      else { await api(`/api/games/${gameId}/deeds`, { method: "POST", body }); notify(t("Дело добавлено")); }
      close();
      await reload();
    } catch (err) { setError(err instanceof ApiError ? (err.issues?.map((i) => i.message).join("; ") || err.message) : t("Ошибка сети")); }
    finally { setBusy(false); }
  }
  async function importDefault(mode: "add" | "replace" = "add") {
    if (mode === "replace" && !(await confirm(t("Дела, которые команды ещё не получали, будут удалены, а список станет стандартным набором. Дела, уже выданные командам, останутся."), { title: t("Заменить стандартным набором?"), okLabel: t("Заменить"), danger: true }))) return;
    setBusy(true);
    try {
      const r = await api<{ added: number; removed: number; updated: number }>(`/api/games/${gameId}/deeds/import-default`, { method: "POST", body: JSON.stringify({ mode }) });
      await reload();
      notify(mode === "replace" ? t("Список заменён: добавлено {a}, убрано {r}, обновлено {u}", { a: r.added, r: r.removed, u: r.updated }) : r.added ? t("Добавлено дел: {n}", { n: r.added }) : t("Стандартный набор уже добавлен"));
    }
    catch (err) { notify(err instanceof ApiError ? err.message : t("Ошибка сети"), "bad"); }
    finally { setBusy(false); }
  }
  async function remove(d: DeedDto) {
    if (!(await confirm(t("Дело «{title}» будет удалено из списка.", { title: d.title }), { title: t("Удалить дело?"), okLabel: t("Удалить"), danger: true }))) return;
    try { await api(`/api/games/${gameId}/deeds/${d.id}`, { method: "DELETE" }); notify(t("Дело удалено")); await reload(); }
    catch (err) { notify(err instanceof ApiError ? err.message : t("Ошибка сети"), "bad"); }
  }

  const roads = deeds?.filter((d) => !d.quarry) ?? null;
  const quarry = deeds?.filter((d) => d.quarry) ?? null;
  const shown = inQuarry ? quarry : roads;
  return (
    <div className="card">
      <div className="card-head">
        <h2><span className="ico"><Icon name={inQuarry ? "stone" : "scroll"} /></span>{inQuarry ? t("Дела Каменоломни") : t("Дела")} {shown && <span className="count">{shown.length}</span>}</h2>
        <div className="row">
          {deeds && deeds.length > 0 && <ActionMenu label={t("Стандартный набор")} items={[
            { label: t("Добавить недостающие из стандартного набора"), icon: "sparkle", onSelect: () => void importDefault("add") },
            { label: t("Заменить список стандартным набором"), icon: "refresh", danger: true, onSelect: () => void importDefault("replace") },
          ]} />}
          <button type="button" className="sm" onClick={openNew} disabled={!deeds}><Icon name="plus" />{t("Новое дело")}</button>
        </div>
      </div>
      {!mode && <div className="tabs deed-sections mt-2" role="tablist">
        <button type="button" role="tab" aria-selected={!inQuarry} className={inQuarry ? undefined : "active"} onClick={() => setSection("roads")}><Icon name="scroll" /><span>{t("Обычные дела")}</span>{roads && <span className="count-chip">{roads.length}</span>}</button>
        <button type="button" role="tab" aria-selected={inQuarry} className={inQuarry ? "active" : undefined} onClick={() => setSection("quarry")}><Icon name="stone" /><span>{t("Дела Каменоломни")}</span>{quarry && <span className="count-chip">{quarry.length}</span>}</button>
      </div>}
      {inQuarry && <p className="hint mt-2">{t("Общие дела всей команды: сдаёт капитан, заместитель или летописец в Каменоломне на карте, всегда доступны. Принятое дело даёт камни, камень мостит одну свободную дорогу — куда, решает команда.")}</p>}
      {!inQuarry && roads && roads.length > 0 && roads.length < recommended && <p className="note warn"><Icon name="alert" /><span>{t("Рекомендуется не меньше {n} дел, иначе они начнут повторяться.", { n: recommended })}</span></p>}
      {loadError ? <ErrorState onRetry={() => void load()} /> : !shown ? <LoadingState /> : shown.length === 0 ? (
        inQuarry
          ? <EmptyState icon="stone" text={t("Общих дел пока нет. Они есть в стандартном наборе, или добавьте свои.")} action={<button type="button" className="secondary" onClick={() => void importDefault()} disabled={busy}><Icon name="sparkle" />{t("Стандартный набор")}</button>} />
          : <EmptyState icon="scroll" text={t("Дел пока нет. Возьмите стандартный набор как заготовку или добавьте свои.")} action={<button type="button" className="secondary" onClick={() => void importDefault()} disabled={busy}><Icon name="sparkle" />{t("Стандартный набор")}</button>} />
      ) : (
        <ul className="list">
          {shown.map((d) => { const open = expanded.has(d.id); return (
            <li key={d.id} className={"deed-row" + (open ? " open" : "")}>
              <div className="main" onClick={() => toggle(d.id)}>
                <span className="title">{withBook(d.title)} {d.quarry && <Chip tone="accent" icon="stone" title={t("Камней за дело")}>{d.stones ?? 1}</Chip>} {!d.canRepeat && <Chip>{t("одно на игру")}</Chip>} {d.secret && <Chip icon="lock">{t("тайное")}</Chip>} {d.remote && <Chip icon="send">{t("издалека")}</Chip>}</span>
                {d.description && <span className={"deed-desc small" + (open ? " open" : "")}>{withBook(d.description)}</span>}
                <span className="meta">
                  <span>{PROOF_LABEL[d.proofType]}</span>
                  {d.siegePoints != null && <span>· {t("осада: {n} б.", { n: d.siegePoints })}</span>}
                  {d.donationMin != null && <span>· {t("пожертвование от {n}", { n: d.donationMin })}</span>}
                  {!d.quarry && <span title={t("Вероятность появления на новой дороге")}>· {d.chance}%</span>}
                  {/* Две цифры по делу (решение владельца 04.10): сколько таких дел сейчас свободно на картах команд и сколько взято в работу. */}
                  {!d.quarry && d.onMap && <span className="on-map" title={t("На картах команд: свободных {a}, в работе {b}", { a: d.onMap.free, b: d.onMap.taken }) + (d.onMap.sea ? ` · ${t("из них в море (корабль у порта): {n}", { n: d.onMap.sea })}` : "")}>· <Icon name="scroll" />{d.onMap.free} <Icon name="user" />{d.onMap.taken}{d.onMap.sea ? <> <Icon name="ship" />{d.onMap.sea}</> : null}</span>}
                  {d.bookCodes.length > 0 && <span>· <Chip icon="book" title={d.bookCodes.map(bookName).join(", ")}>{plural(d.bookCodes.length, [t("книга"), t("книги"), t("книг")])}</Chip></span>}
                  {/* Направление в списке не показывается (решение владельца 05.10): поле остаётся в форме и в данных. */}
                </span>
              </div>
              <div className="side">
                {d.description && <button type="button" className="ghost sm icon deed-chev" onClick={() => toggle(d.id)} aria-expanded={open} aria-label={t("Описание")} title={t("Описание")}><Icon name="chevron-down" /></button>}
                <button type="button" className="ghost sm icon" onClick={() => openEdit(d)} aria-label={t("Изменить дело")} title={t("Изменить")}><Icon name="edit" /></button>
                <ActionMenu label={t("Ещё")} items={[
                  { label: t("Дублировать дело"), icon: "copy", onSelect: () => openDuplicate(d) },
                  { label: t("Удалить дело"), icon: "trash", danger: true, onSelect: () => void remove(d) },
                ]} />
              </div>
            </li>
          ); })}
        </ul>
      )}
      {sheet && (
        <Sheet title={form.quarry ? (sheet.id ? t("Изменить дело Каменоломни") : t("Новое дело Каменоломни")) : sheet.id ? t("Изменить дело") : t("Новое дело")} onClose={close} size="md"
          foot={<><button type="button" className="secondary" onClick={close}>{t("Отмена")}</button><button type="submit" form="deed-form" disabled={busy}>{sheet.id ? t("Сохранить") : t("Добавить дело")}</button></>}>
          <form id="deed-form" onSubmit={save}>
            {sheet.id && <p className="hint">{t("Изменения увидят команды, у которых дело ещё не сдано.")}</p>}
            <label htmlFor="d-title">{t("Название")}</label>
            <input id="d-title" value={form.title} onChange={(e) => setForm({ title: e.target.value })} required minLength={2} maxLength={120} autoFocus />
            <label htmlFor="d-desc">{t("Описание")} <span className="opt">{t("(что именно сделать)")}</span></label>
            <textarea id="d-desc" value={form.description} onChange={(e) => setForm({ description: e.target.value })} maxLength={2000} rows={3} />
            <div className="grid cols-2">
              <div>
                <label htmlFor="d-dir">{t("Направление")}</label>
                <select id="d-dir" value={form.direction} onChange={(e) => setForm({ direction: e.target.value })}>{directions.map((d) => <option key={d}>{d}</option>)}</select>
              </div>
              <div>
                <label htmlFor="d-proof">{t("Что сдать")}</label>
                <select id="d-proof" value={form.proofType} onChange={(e) => setForm({ proofType: e.target.value as ProofType })}>{(Object.keys(PROOF_LABEL) as ProofType[]).map((p) => <option key={p} value={p}>{PROOF_LABEL[p]}</option>)}</select>
              </div>
              {form.quarry && (
                <div>
                  <label htmlFor="d-stones">{t("Камней за дело")}</label>
                  <input id="d-stones" type="number" min={1} max={20} value={form.stones} onChange={(e) => setForm({ stones: Math.max(1, Number(e.target.value) || 1) })} />
                  <p className="hint">{t("Один камень мостит одну свободную дорогу. Вся команда вместе; сдаёт капитан, заместитель или летописец; на дороги такое дело не ставится.")}</p>
                </div>
              )}
              {!form.quarry && <div>
                <label htmlFor="d-siege">{t("Баллы при осаде")} <span className="opt">{t("(пусто — по правилам)")}</span></label>
                <input id="d-siege" type="number" min={0} max={100} value={form.siegePoints} onChange={(e) => setForm({ siegePoints: e.target.value === "" ? "" : Number(e.target.value) })} />
              </div>}
              {!form.quarry && <div>
                <label htmlFor="d-don">{t("Пожертвование вместо дела, от")} <span className="opt">{t("(пусто — нельзя)")}</span></label>
                <input id="d-don" type="number" inputMode="numeric" min={0} value={form.donationMin} onChange={(e) => setForm({ donationMin: e.target.value === "" ? "" : Number(e.target.value) })} />
              </div>}
              {!form.quarry && <div>
                <label htmlFor="d-chance">{t("Вероятность появления на новой дороге")}</label>
                <select id="d-chance" value={form.chance} onChange={(e) => setForm({ chance: Number(e.target.value) })}>{CHANCES.map((n) => <option key={n} value={n}>{n}%</option>)}</select>
                <p className="hint">{t("Вес при розыгрыше: дело на 100% выпадает в пять раз чаще дела на 20%. Дела до 60% не ставятся рядом с таким же делом, от 80% — могут.")}</p>
              </div>}
            </div>
            {!form.quarry && <>
            <div className="with-help">
              <label htmlFor="d-book">{t("Книги по теме")} <span className="opt">{t("(необязательно)")}</span></label>
              <Help>{t("Из взятого города сначала выпадают дела с его книгой. Напишите [Книга] в названии или описании — подставится книга города.")}</Help>
            </div>
            <select id="d-book" value="" onChange={(e) => { const c = e.target.value; if (c && !form.bookCodes.includes(c)) setForm({ bookCodes: [...form.bookCodes, c] }); }}>
              <option value="">{form.bookCodes.length ? t("Добавить книгу…") : t("Любая книга")}</option>
              {BOOKS.filter((b) => !form.bookCodes.includes(b.code)).map((b) => <option key={b.code} value={b.code}>{b.nameRu}</option>)}
            </select>
            {form.bookCodes.length > 0 && (
              <div className="chips mt-2">
                {form.bookCodes.map((c) => <button key={c} type="button" className="chip-btn" onClick={() => setForm({ bookCodes: form.bookCodes.filter((x) => x !== c) })} aria-label={t("Убрать книгу {name}", { name: BOOKS.find((b) => b.code === c)?.nameRu ?? c })}>{BOOKS.find((b) => b.code === c)?.nameRu ?? c} ×</button>)}
              </div>
            )}
            <div className="with-help mt-3"><label className="check"><input type="checkbox" checked={form.canRepeat} onChange={(e) => setForm({ canRepeat: e.target.checked })} />{t("Повторяемое")}</label><Help>{t("Можно выдавать нескольким командам.")}</Help></div>
            <div className="with-help mt-2"><label className="check"><input type="checkbox" checked={form.secret} onChange={(e) => setForm({ secret: e.target.checked })} />{t("Тайное")}</label><Help>{t("Сдачу видит только проверяющий — сюрприз без раскрытия адресата.")}</Help></div>
            <div className="with-help mt-2"><label className="check"><input type="checkbox" checked={form.remote} onChange={(e) => setForm({ remote: e.target.checked })} />{t("Можно издалека")}</label><Help>{t("Для уехавших и болеющих. Такое дело всегда есть среди свободных сторон.")}</Help></div>
            </>}
            {error && <p className="error">{error}</p>}
          </form>
        </Sheet>
      )}
    </div>
  );
}
