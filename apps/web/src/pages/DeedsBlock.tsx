import { useEffect, useState, type FormEvent } from "react";
import { BOOKS } from "@lotw/domain";
import { api, ApiError } from "../lib/api";

type ProofType = "REPORT" | "PHOTO_LINK" | "VIDEO_LINK" | "CONFIRMATION";
interface DeedDto { id: string; title: string; description: string; direction: string; proofType: ProofType; canRepeat: boolean; bookCode: string | null; difficulty: number }
const PROOF_LABEL: Record<ProofType, string> = { REPORT: "отчёт текстом", PHOTO_LINK: "ссылка на фото", VIDEO_LINK: "ссылка на видео", CONFIRMATION: "подтверждение человека" };

/** Блок «Дела» для админа игры: список дел этой игры, добавление, стандартный набор. */
export function DeedsBlock({ gameId }: { gameId: string }) {
  const [deeds, setDeeds] = useState<DeedDto[]>([]);
  const [directions, setDirections] = useState<string[]>([]);
  const [recommended, setRecommended] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", direction: "", proofType: "PHOTO_LINK" as ProofType, canRepeat: true, bookCode: "", difficulty: 1 });

  const load = () => api<{ deeds: DeedDto[]; directions: string[]; recommendedMin: number }>(`/api/games/${gameId}/deeds`)
    .then((r) => { setDeeds(r.deeds); setDirections(r.directions); setRecommended(r.recommendedMin); if (!form.direction) setForm((f) => ({ ...f, direction: r.directions[0] ?? "" })); })
    .catch((e) => setError(e instanceof ApiError ? e.message : "Ошибка сети"));
  useEffect(() => { void load(); }, [gameId]);

  async function add(e: FormEvent) {
    e.preventDefault(); setError(null);
    try {
      await api(`/api/games/${gameId}/deeds`, { method: "POST", body: JSON.stringify({ ...form, bookCode: form.bookCode || null }) });
      setForm((f) => ({ ...f, title: "", description: "" }));
      await load();
    } catch (err) { setError(err instanceof ApiError ? (err.issues?.map((i) => i.message).join("; ") || err.message) : "Ошибка сети"); }
  }
  async function importDefault() {
    try { const r = await api<{ added: number }>(`/api/games/${gameId}/deeds/import-default`, { method: "POST" }); await load(); alert(`Добавлено дел: ${r.added}`); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Ошибка сети"); }
  }
  async function toggleRepeat(d: DeedDto) {
    await api(`/api/games/${gameId}/deeds/${d.id}`, { method: "PUT", body: JSON.stringify({ canRepeat: !d.canRepeat }) }); await load();
  }
  async function remove(d: DeedDto) {
    if (!confirm(`Удалить дело «${d.title}»?`)) return;
    await api(`/api/games/${gameId}/deeds/${d.id}`, { method: "DELETE" }); await load();
  }

  const unique = deeds.filter((d) => !d.canRepeat).length;
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Дела <span className="muted">({deeds.length}, из них уникальных {unique})</span></h2>
        <span className="row">
          <button className="secondary" onClick={() => void importDefault()}>Добавить стандартный набор</button>
          <button className="secondary" onClick={() => setOpen((o) => !o)}>{open ? "Скрыть форму" : "Новое дело"}</button>
        </span>
      </div>
      {deeds.length < recommended && <p className="muted">Рекомендуется не меньше {recommended} дел на эту карту, иначе дела будут повторяться. Дела с пометкой «можно дублировать» выдаются повторно.</p>}
      {error && <p className="error">{error}</p>}
      {open && (
        <form onSubmit={add} style={{ marginBottom: "1rem" }}>
          <label htmlFor="d-title">Название</label>
          <input id="d-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required minLength={2} maxLength={120} />
          <label htmlFor="d-desc">Описание (что именно сделать)</label>
          <input id="d-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={2000} />
          <div className="row">
            <div style={{ flex: 1 }}>
              <label>Направление</label>
              <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>{directions.map((d) => <option key={d}>{d}</option>)}</select>
            </div>
            <div style={{ flex: 1 }}>
              <label>Что сдать</label>
              <select value={form.proofType} onChange={(e) => setForm({ ...form, proofType: e.target.value as ProofType })}>{(Object.keys(PROOF_LABEL) as ProofType[]).map((p) => <option key={p} value={p}>{PROOF_LABEL[p]}</option>)}</select>
            </div>
            <div style={{ flex: 1 }}>
              <label>Тематическая книга (необязательно)</label>
              <select value={form.bookCode} onChange={(e) => setForm({ ...form, bookCode: e.target.value })}><option value="">—</option>{BOOKS.map((b) => <option key={b.code} value={b.code}>{b.nameRu}</option>)}</select>
            </div>
            <div style={{ width: 120 }}>
              <label>Тяжесть 1–3</label>
              <input type="number" min={1} max={3} value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: Number(e.target.value) })} />
            </div>
          </div>
          <label><input type="checkbox" checked={form.canRepeat} onChange={(e) => setForm({ ...form, canRepeat: e.target.checked })} style={{ width: "auto", marginRight: 8 }} />Можно дублировать</label>
          <button type="submit" style={{ marginTop: ".75rem" }}>Добавить дело</button>
        </form>
      )}
      {deeds.length === 0 ? <p className="muted">Список пуст. Добавь стандартный набор как заготовку или создай свои дела.</p> : (
        <ul className="list">
          {deeds.map((d) => (
            <li key={d.id}>
              <span><strong>{d.title}</strong> <span className="muted">· {d.direction} · {PROOF_LABEL[d.proofType]} · тяжесть {d.difficulty}{d.bookCode ? ` · ${BOOKS.find((b) => b.code === d.bookCode)?.nameRu}` : ""}</span>{d.description && <><br /><span className="muted">{d.description}</span></>}</span>
              <span className="row" style={{ flexShrink: 0 }}>
                <button className="secondary" onClick={() => void toggleRepeat(d)}>{d.canRepeat ? "дублируется" : "уникальное"}</button>
                <button className="secondary" onClick={() => void remove(d)}>✕</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
