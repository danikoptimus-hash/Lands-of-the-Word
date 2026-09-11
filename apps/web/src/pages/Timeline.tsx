import { useMemo } from "react";
import type { CityProgress, TeamProgress } from "./AdminMap";
import { t } from "../lib/i18n";
import { fmtDate, plural } from "../lib/format";
import { Icon } from "../components/Icon";

/** Состояние команд на момент `at`: только перекрёстки и стороны, открытые не позже этого момента. */
export function progressAt(teams: TeamProgress[], at: Date): TeamProgress[] {
  const ms = at.getTime();
  return teams.map((team) => ({
    ...team,
    revealed: team.revealed.filter((_, i) => { const d = team.revealedAt?.[i]; return !d || Date.parse(d) <= ms; }),
    traversed: team.traversed.filter((e) => !e.at || Date.parse(e.at) <= ms),
  }));
}

export type MoveKind = "reveal" | "traverse" | "capture" | "capital";
export interface Move { at: number; team: string; kind: MoveKind }
const KIND_TEXT: Record<MoveKind, string> = { reveal: "открыл перекрёсток", traverse: "прошёл сторону", capture: "взял город", capital: "взял город (столица)" };

/** Ходы всех команд по времени: открытие перекрёстка, пройденная сторона, взятый город. Старт не считается ходом. */
export function collectMoves(teams: TeamProgress[], cities: CityProgress[] | null, startedAt: string): Move[] {
  const start = Date.parse(startedAt);
  const moves: Move[] = [];
  for (const team of teams) {
    team.revealed.forEach((key, i) => { const d = team.revealedAt?.[i]; if (d && key !== team.startNodeKey && Date.parse(d) > start) moves.push({ at: Date.parse(d), team: team.name, kind: "reveal" }); });
    for (const e of team.traversed) if (e.at) moves.push({ at: Date.parse(e.at), team: team.name, kind: "traverse" });
    for (const c of cities ?? []) if (c.teamId === team.id && c.capturedAt) moves.push({ at: Date.parse(c.capturedAt), team: team.name, kind: c.isCapital ? "capital" : "capture" });
  }
  moves.sort((a, b) => a.at - b.at);
  // Принятие дела открывает перекрёсток в ту же секунду: это один ход.
  return moves.filter((m, i) => i === 0 || m.at - moves[i - 1]!.at > 1500 || m.kind !== "reveal");
}

/**
 * История ходов под картой администратора: ползунок с шагом в один ход. Крайнее правое положение — «сейчас»
 * (живое состояние, обновляется само); левее — карта сразу после выбранного хода; 0 — старт игры.
 */
export function Timeline({ moves, startedAt, at, onChange }: { moves: Move[]; startedAt: string; at: Date | null; onChange: (d: Date | null) => void }) {
  const n = moves.length;
  const pos = useMemo(() => {
    if (!at) return n;
    const ms = at.getTime();
    let i = 0;
    while (i < n && moves[i]!.at <= ms) i++;
    return i;
  }, [at, moves, n]);
  const set = (i: number) => onChange(i >= n ? null : i === 0 ? new Date(Date.parse(startedAt)) : new Date(moves[i - 1]!.at));
  const current = pos > 0 ? moves[pos - 1] : undefined;
  return (
    <div className="timeline">
      <h3><span className="ico"><Icon name="clock" /></span>{t("История ходов")}</h3>
      <div className={"tl-now" + (at ? "" : " live")} aria-live="polite">
        {!at ? <strong>{t("Сейчас")} · {plural(n, ["ход", "хода", "ходов"])}</strong> : pos === 0 ? <strong>{t("Старт")} · {fmtDate(startedAt)}</strong> : (
          <>
            <strong>{t("Ход {a} из {b}", { a: pos, b: n })} · {fmtDate(current!.at)}</strong>
            <span>{current!.team}: {t(KIND_TEXT[current!.kind])}</span>
          </>
        )}
      </div>
      <input type="range" min={0} max={n} step={1} value={pos} onChange={(e) => set(Number(e.target.value))} aria-label={t("Ход игры")} />
      <div className="row between muted xs"><span>{t("Старт")} · {fmtDate(startedAt)}</span><span>{t("Сейчас")}</span></div>
    </div>
  );
}
