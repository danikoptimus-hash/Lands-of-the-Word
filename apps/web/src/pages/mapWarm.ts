import { fieldBounds, HEX_SIZE } from "../lib/hexmap";
import type { MyMapDto } from "../lib/api";
import { coastCached, fogMaskCached } from "./MapLayers";
import { isletsCached } from "./Islets";
import { seabedCached } from "./Seabed";
import { teamFogInputs } from "./TeamMap";

/**
 * Заготовка карты команды (решение владельца 24.10, уровень 1: «чтобы карта уже начала свою загрузку при открытии
 * приложения»): пока человек на главной, в простое процессора считаются берег, островки, поле дна и маска тумана по
 * уже полученному ответу карты. При нажатии на карточку карта собирается из готовых кусков. Шаги идут по одному в
 * свободные промежутки, чтобы главная не дёргалась.
 */
export function warmTeamMap(map: Pick<MyMapDto, "hexes" | "revealed" | "edges" | "frontier">): void {
  if (typeof window === "undefined" || !map.hexes?.length) return;
  const size = HEX_SIZE;
  const bounds = fieldBounds(map.hexes, size);
  const steps: Array<() => void> = [
    () => { coastCached(map.hexes, size); },
    () => { isletsCached(map.hexes, size, bounds); },
    () => { seabedCached(map.hexes, isletsCached(map.hexes, size, bounds), size, bounds); },
    () => { const f = teamFogInputs(map, size); fogMaskCached(f.fogHexes, size, f.fogPoints, f.fogClear, f.landKeys); },
  ];
  const idle = (cb: () => void) => { if ("requestIdleCallback" in window) (window as Window & { requestIdleCallback: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback(cb, { timeout: 1500 }); else setTimeout(cb, 120); };
  const run = (i: number) => { if (i >= steps.length) return; idle(() => { try { steps[i]!(); } catch { /* заготовка не обязательна: карта посчитает сама */ } run(i + 1); }); };
  run(0);
}
