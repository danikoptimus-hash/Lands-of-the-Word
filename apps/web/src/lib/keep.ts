/**
 * Память заготовок карты (решение владельца 24.10, уровень 1): тяжёлая геометрия (берег, островки, дно, маска тумана)
 * считается один раз на игру и живёт, пока открыта вкладка. Ключ — состав гексов (и что ещё влияет на результат);
 * хранится не больше нескольких игр, старые вытесняются.
 */
const LIMIT = 6;
export function keep<T>(store: Map<string, T>, key: string, make: () => T): T {
  const hit = store.get(key);
  if (hit !== undefined) return hit;
  const v = make();
  store.set(key, v);
  if (store.size > LIMIT) store.delete(store.keys().next().value as string);
  return v;
}
export const hexKeyOf = (hexes: ReadonlyArray<{ q: number; r: number }>) => hexes.map((h) => `${h.q},${h.r}`).join(";");
