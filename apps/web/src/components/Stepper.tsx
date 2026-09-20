import { Icon } from "./Icon";
import { t } from "../lib/i18n";

/**
 * Числовое поле со стрелками вверх/вниз (решение владельца 20.09: вместо «прямых» полей). Число можно и набрать,
 * и накрутить стрелками; границы min/max соблюдаются, шаг — step.
 */
export function Stepper({ id, value, onChange, min, max, step = 1, required, ariaLabel }: {
  id: string; value: number | ""; onChange: (v: number | "") => void; min?: number; max?: number; step?: number; required?: boolean; ariaLabel?: string;
}) {
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const round = (v: number) => { const d = String(step).split(".")[1]?.length ?? 0; return Number(v.toFixed(Math.min(6, d))); };
  const bump = (dir: 1 | -1) => onChange(round(clamp((value === "" ? (min ?? 0) : value) + dir * step)));
  const atMin = value !== "" && min !== undefined && value <= min, atMax = value !== "" && max !== undefined && value >= max;
  return (
    <div className="stepper">
      <input id={id} type="number" inputMode="decimal" step={step} min={min} max={max} value={value} required={required} aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} onBlur={() => { if (value !== "") onChange(round(clamp(value))); }} />
      <div className="arrows">
        <button type="button" className="ghost" tabIndex={-1} aria-label={t("Больше")} disabled={atMax} onClick={() => bump(1)}><Icon name="chevron-up" /></button>
        <button type="button" className="ghost" tabIndex={-1} aria-label={t("Меньше")} disabled={atMin} onClick={() => bump(-1)}><Icon name="chevron-down" /></button>
      </div>
    </div>
  );
}
