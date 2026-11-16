import type { EdgeTaskDto, MyMapDto } from "./api";

/**
 * Карта команды «с провода» (ревизия скорости, этап 2). Сервер отдаёт тексты дел один раз — справочником `deedTexts`, а у
 * стороны оставляет ключ `deedKey`: ответ на треть меньше (440 → 298 КБ в «Осени»), и столько же меньше разбирает телефон.
 * Экраны читают у стороны `deed`, как и раньше: `hydrateMap` расставляет тексты по сторонам (общие объекты, без копий),
 * `slimMap` снимает их обратно — так карта лежит в памяти готовых ответов и в снимке между запусками.
 * Ответ прежнего вида (текст в каждой стороне, без справочника) обе функции возвращают как есть.
 */
type Deed = EdgeTaskDto["deed"];
type WireTask = Omit<EdgeTaskDto, "deed"> & { deedKey?: string; deed?: Deed };
type Wire = { tasks?: WireTask[]; deedTexts?: Record<string, Deed> };

export function hydrateMap<T extends MyMapDto | null | undefined>(map: T): T {
  const m = map as (MyMapDto & Wire) | null | undefined;
  const dict = m?.deedTexts;
  if (!m || !dict || !m.tasks) return map;
  let changed = false;
  const tasks = (m.tasks as WireTask[]).map((t) => {
    const deed = t.deedKey !== undefined ? dict[t.deedKey] : undefined;
    if (!deed || t.deed === deed) return t;
    changed = true;
    return { ...t, deed };
  });
  return (changed ? { ...m, tasks } : m) as T;
}

const slimmed = new WeakMap<object, WireTask[]>();
export function slimMap<T extends MyMapDto | null | undefined>(map: T): T {
  const m = map as (MyMapDto & Wire) | null | undefined;
  if (!m || !m.deedTexts || !m.tasks) return map;
  // Список сторон между принятыми картами обычно тот же объект (keepSame): облегчённая копия считается один раз.
  let tasks = slimmed.get(m.tasks);
  if (!tasks) {
    tasks = (m.tasks as WireTask[]).map((t) => { if (t.deedKey === undefined || !t.deed) return t; const { deed: _deed, ...rest } = t; return rest; });
    slimmed.set(m.tasks, tasks);
  }
  return { ...m, tasks } as unknown as T;
}
