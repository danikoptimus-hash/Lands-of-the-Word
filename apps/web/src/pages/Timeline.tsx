import { useMemo } from "react";
import type { TeamProgress } from "./AdminMap";

const DAY = 86_400_000;

/** Состояние команд на момент `at`: только узлы и стороны, открытые не позже этого момента. */
export function progressAt(teams: TeamProgress[], at: Date): TeamProgress[] {
  const t = at.getTime();
  return teams.map((team) => ({
    ...team,
    revealed: team.revealed.filter((_, i) => { const d = team.revealedAt?.[i]; return !d || Date.parse(d) <= t; }),
    traversed: team.traversed.filter((e) => !e.at || Date.parse(e.at) <= t),
  }));
}

function fmt(d: Date) { return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }); }

/**
 * Ползунок под картой админа с шагом в один день. Крайнее правое положение — «сейчас»
 * (живое состояние, обновляется само); левее — состояние на конец выбранного дня.
 */
export function Timeline({ startedAt, at, onChange }: { startedAt: string; at: Date | null; onChange: (d: Date | null) => void }) {
  const start = useMemo(() => { const d = new Date(startedAt); d.setHours(0, 0, 0, 0); return d; }, [startedAt]);
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const days = Math.max(0, Math.round((today.getTime() - start.getTime()) / DAY));
  // Позиция i (0..days-1) — конец i-го дня игры; позиция days — «сейчас».
  const pos = at ? Math.min(days, Math.max(0, Math.round((at.getTime() - start.getTime()) / DAY) - 1)) : days;
  const set = (i: number) => onChange(i >= days ? null : new Date(start.getTime() + (i + 1) * DAY));
  const label = at ? `День ${pos + 1} · ${fmt(new Date(start.getTime() + pos * DAY))}` : `Сейчас · день ${days + 1}`;
  return (
    <div className="timeline">
      <div className="row between">
        <span className={at ? "badge" : "badge accent"}>{label}</span>
        <span className="muted">Начало {fmt(start)}</span>
      </div>
      <input type="range" min={0} max={days} step={1} value={pos} onChange={(e) => set(Number(e.target.value))} aria-label="День игры" />
      <div className="row between muted" style={{ fontSize: ".8rem" }}><span>день 1</span><span>сейчас</span></div>
    </div>
  );
}
