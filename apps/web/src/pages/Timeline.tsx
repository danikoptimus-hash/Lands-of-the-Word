import { useMemo } from "react";
import type { CityProgress, TeamProgress } from "./AdminMap";
import { t, getLocale } from "../lib/i18n";

/** Состояние команд на момент `at`: только узлы и стороны, открытые не позже этого момента. */
export function progressAt(teams: TeamProgress[], at: Date): TeamProgress[] {
  const t = at.getTime();
  return teams.map((team) => ({
    ...team,
    revealed: team.revealed.filter((_, i) => { const d = team.revealedAt?.[i]; return !d || Date.parse(d) <= t; }),
    traversed: team.traversed.filter((e) => !e.at || Date.parse(e.at) <= t),
  }));
}

export interface Move { at: number; label: string }

/** Ходы всех команд по времени: открытие узла, пройденная сторона, взятый город. Старт не считается ходом. */
export function collectMoves(teams: TeamProgress[], cities: CityProgress[] | null, startedAt: string): Move[] {
  const start = Date.parse(startedAt);
  const moves: Move[] = [];
  for (const team of teams) {
    team.revealed.forEach((key, i) => { const d = team.revealedAt?.[i]; if (d && key !== team.startNodeKey && Date.parse(d) > start) moves.push({ at: Date.parse(d), label: `${team.name}: ${t("открыт узел")}` }); });
    for (const e of team.traversed) if (e.at) moves.push({ at: Date.parse(e.at), label: `${team.name}: ${t("пройдена сторона")}` });
    for (const c of cities ?? []) if (c.teamId === team.id && c.capturedAt) moves.push({ at: Date.parse(c.capturedAt), label: `${team.name}: ${t("взят город")}${c.isCapital ? t(" (столица)") : ""}` });
  }
  moves.sort((a, b) => a.at - b.at);
  // Одобрение дела открывает узел в ту же секунду: это один ход.
  return moves.filter((m, i) => i === 0 || m.at - moves[i - 1]!.at > 1500 || !m.label.endsWith(t("открыт узел")));
}

function fmt(ms: number) { return new Date(ms).toLocaleString(getLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }

/**
 * Ползунок под картой админа с шагом в один ход. Крайнее правое положение — «сейчас»
 * (живое состояние, обновляется само); левее — карта сразу после выбранного хода; 0 — старт игры.
 */
export function Timeline({ moves, startedAt, at, onChange }: { moves: Move[]; startedAt: string; at: Date | null; onChange: (d: Date | null) => void }) {
  const n = moves.length;
  const pos = useMemo(() => {
    if (!at) return n;
    const t = at.getTime();
    let i = 0;
    while (i < n && moves[i]!.at <= t) i++;
    return i;
  }, [at, moves, n]);
  const set = (i: number) => onChange(i >= n ? null : i === 0 ? new Date(Date.parse(startedAt)) : new Date(moves[i - 1]!.at));
  const label = !at ? t("Сейчас · ходов {n}", { n }) : pos === 0 ? `${t("Старт")} · ${fmt(Date.parse(startedAt))}` : `${t("Ход {a} из {b}", { a: pos, b: n })} · ${fmt(moves[pos - 1]!.at)} · ${moves[pos - 1]!.label}`;
  return (
    <div className="timeline">
      <div className="row between">
        <span className={at ? "badge" : "badge accent"}>{label}</span>
        <span className="muted">{t("Старт")} {fmt(Date.parse(startedAt))}</span>
      </div>
      <input type="range" min={0} max={n} step={1} value={pos} onChange={(e) => set(Number(e.target.value))} aria-label={t("Ход игры")} />
      <div className="row between muted" style={{ fontSize: ".8rem" }}><span>{t("старт")}</span><span>{t("сейчас")}</span></div>
    </div>
  );
}
