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

type ProofType = "REPORT" | "PHOTO_LINK" | "VIDEO_LINK" | "CONFIRMATION";
interface DeedDto { id: string; title: string; description: string; direction: string; proofType: ProofType; canRepeat: boolean; bookCodes: string[]; difficulty: number; frequency: number; secret: boolean }
type Form = { title: string; description: string; direction: string; proofType: ProofType; canRepeat: boolean; bookCodes: string[]; difficulty: number; frequency: number; secret: boolean };
/** Частота появления дела: простой параметр в три ступени (решение владельца 15.09). */
const FREQUENCY: Record<number, string> = { 1: "редко", 2: "обычно", 3: "часто" };
const EMPTY: Form = { title: "", description: "", direction: "", proofType: "PHOTO_LINK", canRepeat: true, bookCodes: [], difficulty: 1, frequency: 2, secret: false };
const DIFFICULTY: Record<number, string> = { 1: "лёгкое", 2: "среднее", 3: "трудное" };

/** Вкладка «Дела»: список дел игры; добавление и изменение — в одной форме-шторке; стандартный набор — только пока список пуст. */
/**
 * В каталоге администратора дело — шаблон: «[Книга]» показываем плашкой. Команде на карте вместо неё
 * сервер подставляет книгу города, из которого выходит сторона (withDeedBook).
 */
function withBook(text: string) {
  const parts = text.split(/(\[книга\])/i);
  if (parts.length === 1) return text;
  return parts.map((p, i) => (/^\[книга\]$/i.test(p) ? <Chip key={i} tone="accent" icon="book" title={t("Подставится книга города, из которого выходит сторона")}>{t("книга города")}</Chip> : p));
}

export function DeedsBlock({ gameId, version = 0, onChange }: { gameId: string; version?: number; onChange?: () => void }) {
  const [deeds, setDeeds] = useState<DeedDto[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [directions, setDirections] = useState<string[]>([]);
  const [recommended, setRecommended] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { confirm, notify } = useUi();
  /** Открытая форма: null — закрыта; { id: null } — новое дело; { id } — изменение. */
  const [sheet, setSheet] = useState<{ id: string | null; form: Form } | null>(null);
  const form = sheet?.form ?? EMPTY;
  const setForm = (patch: Partial<Form>) => setSheet((s) => (s ? { ...s, form: { ...s.form, ...patch } } : s));

  const load = useCallback(() => api<{ deeds: DeedDto[]; directions: string[]; recommendedMin: number }>(`/api/games/${gameId}/deeds`)
    .then((r) => { setDeeds(r.deeds); setDirections(r.directions); setRecommended(r.recommendedMin); setLoadError(false); })
    .catch(() => setLoadError(true)), [gameId]);
  const reload = async () => { await load(); onChange?.(); };
  useEffect(() => { void load(); }, [load, version]);

  const openNew = () => { setError(null); setSheet({ id: null, form: { ...EMPTY, direction: directions[0] ?? "" } }); };
  const openEdit = (d: DeedDto) => { setError(null); setSheet({ id: d.id, form: { title: d.title, description: d.description, direction: d.direction, proofType: d.proofType, canRepeat: d.canRepeat, bookCodes: d.bookCodes ?? [], difficulty: d.difficulty, frequency: d.frequency ?? 2, secret: d.secret ?? false } }); };
  const close = () => setSheet(null);

  async function save(e: FormEvent) {
    e.preventDefault(); if (!sheet) return;
    setError(null); setBusy(true);
    try {
      const body = JSON.stringify(sheet.form);
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

  return (
    <div className="card">
      <div className="card-head">
        <h2><span className="ico"><Icon name="scroll" /></span>{t("Дела")} {deeds && <span className="count">{deeds.length}</span>}</h2>
        <div className="row">
          {deeds && deeds.length > 0 && <ActionMenu label={t("Стандартный набор")} items={[
            { label: t("Добавить недостающие из стандартного набора"), icon: "sparkle", onSelect: () => void importDefault("add") },
            { label: t("Заменить список стандартным набором"), icon: "refresh", danger: true, onSelect: () => void importDefault("replace") },
          ]} />}
          <button type="button" className="sm" onClick={openNew} disabled={!deeds}><Icon name="plus" />{t("Новое дело")}</button>
        </div>
      </div>
      {deeds && deeds.length > 0 && deeds.length < recommended && <p className="note warn"><Icon name="alert" /><span>{t("Рекомендуется не меньше {n} дел, иначе они начнут повторяться.", { n: recommended })}</span></p>}
      {loadError ? <ErrorState onRetry={() => void load()} /> : !deeds ? <LoadingState /> : deeds.length === 0 ? (
        <EmptyState icon="scroll" text={t("Дел пока нет. Возьмите стандартный набор как заготовку или добавьте свои.")} action={<button type="button" className="secondary" onClick={() => void importDefault()} disabled={busy}><Icon name="sparkle" />{t("Стандартный набор")}</button>} />
      ) : (
        <ul className="list">
          {deeds.map((d) => (
            <li key={d.id}>
              <div className="main">
                <span className="title">{withBook(d.title)} {d.canRepeat && <Chip>{t("повторяемое")}</Chip>} {d.secret && <Chip icon="lock">{t("тайное")}</Chip>}</span>
                {d.description && <span className="deed-desc small">{withBook(d.description)}</span>}
                <span className="meta">
                  <span>{PROOF_LABEL[d.proofType]}</span>
                  <span>· {t("сложность {n}", { n: d.difficulty })}</span>
                  {d.frequency !== 2 && <span>· {t(FREQUENCY[d.frequency] ?? "обычно")}</span>}
                  {d.bookCodes.length > 0 && <span>· {d.bookCodes.slice(0, 4).map((c) => BOOKS.find((b) => b.code === c)?.nameRu ?? c).join(", ")}{d.bookCodes.length > 4 ? t(" и ещё {n}", { n: d.bookCodes.length - 4 }) : ""}</span>}
                  <span>· {d.direction}</span>
                </span>
              </div>
              <div className="side">
                <button type="button" className="ghost sm icon" onClick={() => openEdit(d)} aria-label={t("Изменить дело")} title={t("Изменить")}><Icon name="edit" /></button>
                <ActionMenu label={t("Ещё")} items={[{ label: t("Удалить дело"), icon: "trash", danger: true, onSelect: () => void remove(d) }]} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {sheet && (
        <Sheet title={sheet.id ? t("Изменить дело") : t("Новое дело")} onClose={close} size="md"
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
              <div>
                <label htmlFor="d-diff">{t("Сложность")}</label>
                <select id="d-diff" value={form.difficulty} onChange={(e) => setForm({ difficulty: Number(e.target.value) })}>{[1, 2, 3].map((n) => <option key={n} value={n}>{n} — {t(DIFFICULTY[n]!)}</option>)}</select>
              </div>
              <div>
                <label htmlFor="d-freq">{t("Как часто выпадает")}</label>
                <select id="d-freq" value={form.frequency} onChange={(e) => setForm({ frequency: Number(e.target.value) })}>{[1, 2, 3].map((n) => <option key={n} value={n}>{t(FREQUENCY[n]!)}</option>)}</select>
              </div>
            </div>
            <label htmlFor="d-book">{t("Книги по теме")} <span className="opt">{t("(необязательно)")}</span></label>
            <select id="d-book" value="" onChange={(e) => { const c = e.target.value; if (c && !form.bookCodes.includes(c)) setForm({ bookCodes: [...form.bookCodes, c] }); }}>
              <option value="">{form.bookCodes.length ? t("Добавить книгу…") : t("Любая книга")}</option>
              {BOOKS.filter((b) => !form.bookCodes.includes(b.code)).map((b) => <option key={b.code} value={b.code}>{b.nameRu}</option>)}
            </select>
            {form.bookCodes.length > 0 && (
              <div className="chips mt-2">
                {form.bookCodes.map((c) => <button key={c} type="button" className="chip-btn" onClick={() => setForm({ bookCodes: form.bookCodes.filter((x) => x !== c) })} aria-label={t("Убрать книгу {name}", { name: BOOKS.find((b) => b.code === c)?.nameRu ?? c })}>{BOOKS.find((b) => b.code === c)?.nameRu ?? c} ×</button>)}
              </div>
            )}
            <p className="hint">{t("На сторонах из взятого города сначала выпадают дела с этой книгой. В названии и описании можно написать [Книга] — подставится книга города.")}</p>
            <label className="check mt-3"><input type="checkbox" checked={form.canRepeat} onChange={(e) => setForm({ canRepeat: e.target.checked })} />{t("Повторяемое: можно выдавать нескольким командам")}</label>
            <label className="check mt-2"><input type="checkbox" checked={form.secret} onChange={(e) => setForm({ secret: e.target.checked })} />{t("Тайное: ссылку и описание сдачи видит только проверяющий (сюрприз без раскрытия адресата)")}</label>
            {error && <p className="error">{error}</p>}
          </form>
        </Sheet>
      )}
    </div>
  );
}
