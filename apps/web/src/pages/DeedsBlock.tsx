import { useEffect, useState, type FormEvent } from "react";
import { BOOKS } from "@lotw/domain";
import { api, ApiError } from "../lib/api";

type ProofType = "REPORT" | "PHOTO_LINK" | "VIDEO_LINK" | "CONFIRMATION";
interface DeedDto { id: string; title: string; description: string; direction: string; proofType: ProofType; canRepeat: boolean; bookCode: string | null; difficulty: number }
const PROOF_LABEL: Record<ProofType, string> = { REPORT: "отчёт текстом", PHOTO_LINK: "ссылка на фото", VIDEO_LINK: "ссылка на видео", CONFIRMATION: "подтверждение человека" };

/** Блок «Дела» для админа игры: список дел этой игры, добавление, стандартный набор. */
export function DeedsBlock({ gameId, version = 0, onChange }: { gameId: string; version?: number; onChange?: () => void }) {
  const [deeds, setDeeds] = useState<DeedDto[]>([]);
  const [directions, setDirections] = useState<string[]>([]);
  const [recommended, setRecommended] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", direction: "", proofType: "PHOTO_LINK" as ProofType, canRepeat: true, bookCode: "", difficulty: 1 });

  const load = () => api<{ deeds: DeedDto[]; directions: string[]; recommendedMin: number }>(`/api/games/${gameId}/deeds`)
    .then((r) => { setDeeds(r.deeds); setDirections(r.directions); setRecommended(r.recommendedMin); if (!form.direction) setForm((f) => ({ ...f, direction: r.directions[0] ?? "" })); })
    .catch((e) => setError(e instanceof ApiError ? e.message : "Ошибка сети"));
  const reload = async () => { await load(); onChange?.(); };
  useEffect(() => { void load(); }, [gameId, version]);

  async function add(e: FormEvent) {
    e.preventDefault(); setError(null);
    try {
      await api(`/api/games/${gameId}/deeds`, { method: "POST", body: JSON.stringify({ ...form, bookCode: form.bookCode || null }) });
      setForm((f) => ({ ...f, title: "", description: "" }));
      await reload();
    } catch (err) { setError(err instanceof ApiError ? (err.issues?.map((i) => i.message).join("; ") || err.message) : "Ошибка сети"); }
  }
  async function importDefault() {
    try { const r = await api<{ added: number }>(`/api/games/${gameId}/deeds/import-default`, { method: "POST" }); await reload(); alert(`Добавлено дел: ${r.added}`); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Ошибка сети"); }
  }
  async function toggleRepeat(d: DeedDto) {
    await api(`/api/games/${gameId}/deeds/${d.id}`, { method: "PUT", body: JSON.stringify({ canRepeat: !d.canRepeat }) }); await reload();
  }
  async function remove(d: DeedDto) {
    if (!confirm(`Удалить дело «${d.title}»?`)) return;
    await api(`/api/games/${gameId}/deeds/${d.id}`, { method: "DELETE" }); await reload();
  }

  const unique = deeds.filter((d) => !d.canRepeat).length;
  return (
    <div className="card">
      <div className="card-head">
        <h2>Дела <span className="muted">{deeds.length} · уникальных {unique}</span></h2>
        <div className="row">
          <button className="secondary sm" onClick={() => void importDefault()}>Стандартный набор</button>
          <button className="sm" onClick={() => setOpen((o) => !o)}>{open ? "Скрыть форму" : "+ Новое дело"}</button>
        </div>
      </div>
      {deeds.length < recommended && <p className="note warn">Рекомендуется не меньше {recommended} дел на эту карту, иначе дела будут повторяться. Дела с пометкой «можно дублировать» выдаются повторно.</p>}
      {error && <p className="error">{error}</p>}
      {open && (
        <form onSubmit={add} style={{ marginBottom: "1rem" }}>
          <label htmlFor="d-title">Название</label>
          <input id="d-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required minLength={2} maxLength={120} />
          <label htmlFor="d-desc">Описание (что именно сделать)</label>
          <input id="d-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={2000} />
          <div className="grid cols-2">
            <div>
              <label>Направление</label>
              <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>{directions.map((d) => <option key={d}>{d}</option>)}</select>
            </div>
            <div>
              <label>Что сдать</label>
              <select value={form.proofType} onChange={(e) => setForm({ ...form, proofType: e.target.value as ProofType })}>{(Object.keys(PROOF_LABEL) as ProofType[]).map((p) => <option key={p} value={p}>{PROOF_LABEL[p]}</option>)}</select>
            </div>
            <div>
              <label>Тематическая книга (необязательно)</label>
              <select value={form.bookCode} onChange={(e) => setForm({ ...form, bookCode: e.target.value })}><option value="">—</option>{BOOKS.map((b) => <option key={b.code} value={b.code}>{b.nameRu}</option>)}</select>
            </div>
            <div>
              <label>Тяжесть 1–3</label>
              <input type="number" min={1} max={3} value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: Number(e.target.value) })} />
            </div>
          </div>
          <label className="check"><input type="checkbox" checked={form.canRepeat} onChange={(e) => setForm({ ...form, canRepeat: e.target.checked })} />Можно дублировать</label>
          <div className="actions"><button type="submit">Добавить дело</button></div>
        </form>
      )}
      {deeds.length === 0 ? <p className="muted">Список пуст. Добавь стандартный набор как заготовку или создай свои дела.</p> : (
        <ul className="list">
          {deeds.map((d) => (
            <li key={d.id}>
              <div className="main"><strong>{d.title}</strong> <span className="badge">{d.direction}</span><div className="muted">{PROOF_LABEL[d.proofType]} · тяжесть {d.difficulty}{d.bookCode ? ` · ${BOOKS.find((b) => b.code === d.bookCode)?.nameRu}` : ""}{d.description ? ` · ${d.description}` : ""}</div></div>
              <div className="side">
                <button className="secondary sm" onClick={() => void toggleRepeat(d)}>{d.canRepeat ? "дублируется" : "уникальное"}</button>
                <button className="ghost sm" onClick={() => void remove(d)}>Удалить</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
