import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type QuarryDto, type QuarryWorkDto } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { fmtDate } from "../lib/format";
import { Icon } from "../components/Icon";
import { Chip } from "../components/Chip";
import { Sheet } from "../components/Sheet";
import { Help } from "../components/Help";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { useGameEvents } from "../lib/useGameEvents";

/**
 * Каменоломня (решение владельца 04.10): скалистый островок в море, один и тот же во всех партиях. Команда «добывает»
 * тёсаные камни общими делами — вся команда на спевке, собрании, стройке, молитвенной группе; сдаёт капитан, заместитель
 * или летописец, фото всей команды; принимает администратор. Один камень мостит одну свободную дорогу на карте
 * (кнопка в карточке свободного дела). Ограничений по частоте нет.
 */
export function QuarrySheet({ gameId, container, onClose }: { gameId: string; container: HTMLElement | null; onClose: () => void }) {
  const { notify } = useUi();
  const [data, setData] = useState<QuarryDto | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [links, setLinks] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<QuarryDto>(`/api/games/${gameId}/quarry`).then((d) => { setData(d); setLoadError(false); }).catch(() => setLoadError(true)), [gameId]);
  useEffect(() => { void load(); }, [load]);
  useGameEvents(gameId, (e) => { if (e.type === "quarry" || e.type === "teams" || e.type === "deeds") void load(); });

  async function submit(deedId: string) {
    const ls = links.split(/\s+/).filter(Boolean);
    if (ls.length === 0) { notify(t("Приложите ссылку на фото всей команды"), "bad"); return; }
    setBusy(true);
    try {
      await api(`/api/games/${gameId}/quarry/${deedId}/submit`, { method: "POST", body: JSON.stringify({ links: ls, note }) });
      notify(t("Сдано на проверку")); setOpen(null); setLinks(""); setNote(""); await load();
    } catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusy(false); }
  }
  const statusChip = (w: QuarryWorkDto) => w.status === "APPROVED" ? <Chip tone="ok" icon="check">{t("принято")}</Chip> : w.status === "REJECTED" ? <Chip tone="bad" icon="alert">{t("возвращено")}</Chip> : <Chip tone="info" icon="clock">{t("на проверке")}</Chip>;

  return (
    <Sheet size="md" container={container} onClose={onClose} className="quarry-sheet" head={<div className="sheet-title"><h2><Icon name="stone" />{t("Каменоломня")}</h2>{data && <Chip tone="accent" icon="stone" title={t("Тёсаные камни команды")}>{data.stones}</Chip>}</div>}>
      <p className="muted small">{t("Здесь команда добывает тёсаный камень общими делами: вся команда вместе. Один камень мостит одну свободную дорогу на карте.")}<Help>{t("Общее дело сдаёт капитан, заместитель или летописец: фото, где видна вся команда. Администратор принимает — команде начисляются камни. Чтобы вымостить дорогу, откройте свободное дело на карте и нажмите «Вымостить дорогу». Вымощенная сторона открывает перекрёсток, но в счёт дел не идёт. Камни не сгорают.")}</Help></p>
      {loadError ? <ErrorState onRetry={() => void load()} /> : !data ? <LoadingState rows={3} /> : (
        <>
          <h3 className="mt-3">{t("Общие дела")}</h3>
          {data.deeds.length === 0 ? <EmptyState inline icon="stone" text={t("Общих дел пока нет: администратор добавляет их в «Делах».")} /> : (
            <ul className="list quarry-deeds">
              {data.deeds.map((d) => {
                const pending = data.works.some((w) => w.deedId === d.id && w.status === "SUBMITTED");
                const picking = open === d.id;
                return (
                  <li key={d.id}>
                    <div className="main">
                      <span className="title">{d.title}<Chip tone="accent" icon="stone" title={t("Камней за дело")}>{d.stones}</Chip></span>
                      <span className="small muted">{d.description}</span>
                      {pending && <span className="meta"><Icon name="clock" />{t("на проверке у администратора")}</span>}
                      {picking && (
                        <div className="stack-sm mt-2">
                          <div className="field"><label htmlFor={"q-links-" + d.id}>{t("Ссылки на фото всей команды")}</label><textarea id={"q-links-" + d.id} rows={2} value={links} onChange={(e) => setLinks(e.target.value)} placeholder={t("https://… — по одной на строку")} /></div>
                          <div className="field"><label htmlFor={"q-note-" + d.id}>{t("Коротко")} <span className="opt">{t("необязательно")}</span></label><textarea id={"q-note-" + d.id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Кого не было и почему, что было на встрече")} /></div>
                          <div className="actions row">
                            <button type="button" disabled={busy} onClick={() => void submit(d.id)}><Icon name="send" />{t("Сдать на проверку")}</button>
                            <button type="button" className="secondary" disabled={busy} onClick={() => setOpen(null)}>{t("Отмена")}</button>
                          </div>
                        </div>
                      )}
                    </div>
                    {data.canWork && !pending && !picking && <div className="side"><button type="button" className="sm" onClick={() => { setOpen(d.id); setLinks(""); setNote(""); }}><Icon name="camera" />{t("Сдать")}</button></div>}
                  </li>
                );
              })}
            </ul>
          )}
          {!data.canWork && <p className="hint">{t("Сдаёт капитан, заместитель или летописец.")}</p>}
          {data.works.length > 0 && (
            <>
              <h3 className="mt-3">{t("Сдачи команды")}</h3>
              <ul className="list quarry-works">
                {data.works.map((w) => (
                  <li key={w.id}>
                    <div className="main">
                      <span className="title">{w.title}</span>
                      <span className="meta">{statusChip(w)} · {w.by} · {fmtDate(w.submittedAt)}{w.status === "APPROVED" && <> · <Icon name="stone" />{w.stones}</>}</span>
                      {w.status === "REJECTED" && w.adminComment && <span className="small muted">{t("Администратор")}: {w.adminComment}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

/** Каменоломня глазами администратора: камни у команд и сколько сдач ждёт проверки (сами сдачи — в «Проверке»). */
export function AdminQuarrySheet({ gameId, container, onClose, onReview }: { gameId: string; container: HTMLElement | null; onClose: () => void; onReview?: () => void }) {
  const [teams, setTeams] = useState<Array<{ id: string; name: string; color: string; stones?: number }> | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const load = useCallback(() => Promise.all([
    api<{ teams: Array<{ id: string; name: string; color: string; stones?: number }> }>(`/api/games/${gameId}/teams`).then((r) => setTeams(r.teams)),
    api<{ works: unknown[] }>(`/api/games/${gameId}/quarry/submissions`).then((r) => setPending(r.works.length)),
  ]).catch(() => {}), [gameId]);
  useEffect(() => { void load(); }, [load]);
  useGameEvents(gameId, (e) => { if (e.type === "quarry" || e.type === "teams") void load(); });
  return (
    <Sheet size="sm" container={container} onClose={onClose} className="quarry-sheet" head={<div className="sheet-title"><h2><Icon name="stone" />{t("Каменоломня")}</h2></div>}>
      <p className="muted small">{t("Общие дела команд: вся команда на спевке, собрании, стройке, молитвенной группе. Принятое дело даёт тёсаные камни, камень мостит свободную дорогу.")}</p>
      {!teams ? <LoadingState rows={3} /> : (
        <ul className="list">
          {teams.map((tm) => <li key={tm.id}><div className="main"><span className="title" style={{ ["--team" as string]: tm.color }}>{tm.name}</span></div><div className="side"><Chip tone="accent" icon="stone">{tm.stones ?? 0}</Chip></div></li>)}
        </ul>
      )}
      {pending != null && pending > 0 && <div className="actions mt-2"><button type="button" className="secondary sm" onClick={onReview}><Icon name="check" />{t("На проверке: {n}", { n: pending })}</button></div>}
    </Sheet>
  );
}
