import { useEffect, useState } from "react";
import { api, ApiError, PROOF_LABEL, type AdminTaskDto } from "../lib/api";
import { t } from "../lib/i18n";
import { fmtDate } from "../lib/format";
import { Icon } from "../components/Icon";
import { Chip } from "../components/Chip";
import { Sheet } from "../components/Sheet";
import { TeamAvatar } from "../components/TeamAvatar";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { deedStatus } from "./TeamPage";

/**
 * Отчёты по делам для администратора (решение владельца 30.09): к старому отчёту нужно возвращаться.
 * TaskReportSheet — полная сдача одного дела (из летописи или из списка на стороне); EdgeTasksSheet — все дела на стороне
 * у всех команд (нажатие на дорогу на карте администратора), нажатие на дело открывает отчёт.
 */
export function TaskReportSheet({ gameId, taskId, container, onClose, onReview }: { gameId: string; taskId: string; container?: HTMLElement | null; onClose: () => void; onReview?: () => void }) {
  const [task, setTask] = useState<AdminTaskDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setTask(null); setError(null); api<{ task: AdminTaskDto }>(`/api/games/${gameId}/edge-tasks/${taskId}`).then((r) => setTask(r.task)).catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети"))); }, [gameId, taskId]);
  const st = task ? deedStatus(task.status) : null;
  return (
    <Sheet size="sm" container={container} onClose={onClose} className="deed-sheet task-report" head={<div className="sheet-title"><h2>{task?.deed.title ?? t("Отчёт по делу")}</h2>{st && <Chip tone={st.tone} icon={st.icon}>{st.label}</Chip>}</div>}>
      {error ? <ErrorState text={error} /> : !task ? <LoadingState rows={3} /> : (
        <>
          <p className="meta-line"><TeamAvatar name={task.team.name} color={task.team.color} size="sm" withName /></p>
          <p className="muted small">{PROOF_LABEL[task.deed.proofType]}</p>
          {task.deed.description && <p className="mt-2 small">{task.deed.description}</p>}
          <p className="meta-line mt-2">
            {task.takenBy && <><Icon name="user" />{t("Взял: {name}", { name: task.takenBy.name })}</>}
            {task.participants.some((p) => p.id !== task.takenBy?.id) && <> · <Icon name="users" />{t("Участвовали: {names}", { names: task.participants.filter((p) => p.id !== task.takenBy?.id).map((p) => p.name).join(", ") })}</>}
          </p>
          <p className="meta-line small muted">
            {task.submittedAt && <><Icon name="clock" />{t("Сдано")}: {fmtDate(task.submittedAt)}</>}
            {task.decidedAt && <> · {task.status === "APPROVED" ? t("Одобрено") : t("Возвращено")}: {fmtDate(task.decidedAt)}{task.decidedBy ? ` · ${task.decidedBy}` : ""}</>}
          </p>
          {task.sea && <div className="note info"><Icon name="ship" /><span>{t("Морской путь: корабль из порта.")}</span></div>}
          {task.deed.secret && <div className="note info"><Icon name="lock" /><span>{t("Тайное дело: команда сдачу не видит, только вы.")}</span></div>}
          {task.donation && <div className="note info"><Icon name="star" /><span>{t("Дело заменено пожертвованием{amount}.", { amount: task.donationAmount ? ` · ${task.donationAmount}` : "" })}</span></div>}
          {task.links.length > 0 && <ul className="links">{task.links.map((l) => <li key={l}><a href={l} target="_blank" rel="noreferrer">{l}</a></li>)}</ul>}
          {task.note ? <p className="mt-2 report-text">{task.note}</p> : task.status !== "TAKEN" && task.links.length === 0 && <p className="muted small mt-2">{t("Текста отчёта нет.")}</p>}
          {task.status === "REJECTED" && task.adminComment && <div className="note bad"><Icon name="alert" /><span>{t("Возвращено с комментарием: «{comment}»", { comment: task.adminComment })}</span></div>}
          {task.status === "SUBMITTED" && onReview && <div className="actions"><button type="button" className="secondary" onClick={() => { onClose(); onReview(); }}><Icon name="check" />{t("Открыть в Проверке")}</button></div>}
        </>
      )}
    </Sheet>
  );
}

export function EdgeTasksSheet({ gameId, aKey, bKey, container, onClose, onOpenTask }: { gameId: string; aKey: string; bKey: string; container?: HTMLElement | null; onClose: () => void; onOpenTask: (taskId: string) => void }) {
  const [tasks, setTasks] = useState<AdminTaskDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setTasks(null); setError(null); api<{ tasks: AdminTaskDto[] }>(`/api/games/${gameId}/edge-tasks?a=${encodeURIComponent(aKey)}&b=${encodeURIComponent(bKey)}`).then((r) => setTasks(r.tasks)).catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети"))); }, [gameId, aKey, bKey]);
  return (
    <Sheet size="sm" container={container} onClose={onClose} title={t("Дела на этой стороне")}>
      {error ? <ErrorState text={error} /> : !tasks ? <LoadingState rows={2} /> : tasks.length === 0 ? <EmptyState inline icon="scroll" text={t("На этой стороне ещё никто не брал дело.")} /> : (
        <ul className="list edge-tasks">
          {tasks.map((tk) => { const st = deedStatus(tk.status); return (
            <li key={tk.id}>
              <button type="button" className="row-btn" onClick={() => onOpenTask(tk.id)}>
                <TeamAvatar name={tk.team.name} color={tk.team.color} size="sm" />
                <span className="body">
                  <span className="title">{tk.deed.title}</span>
                  <span className="meta">{tk.team.name}{tk.takenBy ? ` · ${tk.takenBy.name}` : ""}{tk.submittedAt ? ` · ${fmtDate(tk.submittedAt)}` : ""}</span>
                </span>
                <Chip tone={st.tone} icon={st.icon}>{st.label}</Chip>
                <Icon name="chevron-down" className="chev right" />
              </button>
            </li>
          ); })}
        </ul>
      )}
    </Sheet>
  );
}
