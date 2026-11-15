import { useEffect, useState } from "react";

/**
 * Помощники против лишних перерисовок и пересчётов (ревизия скорости 15.11).
 */

/**
 * Часы для того, кто их показывает. Раньше таймер на секунду стоял в корне экрана команды и раз в секунду заново выполнял
 * всю страницу с картой; теперь часы живут в том компоненте, которому нужны секунды, и перерисовывают только его.
 */
export function useNow(stepMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const tm = setInterval(() => setNow(Date.now()), stepMs); return () => clearInterval(tm); }, [stepMs]);
  return now;
}

const jsonOf = new WeakMap<object, string>();
/** Содержимое строкой; для объектов строка запоминается — прежнюю часть карты не приходится переводить в текст заново. */
function json(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "undefined";
  let s = jsonOf.get(v);
  if (s === undefined) { s = JSON.stringify(v); jsonOf.set(v, s); }
  return s;
}

/**
 * Новый ответ сервера с прежними частями там, где содержимое не изменилось. Сервер на каждый запрос и на каждую «разницу»
 * отдаёт новые объекты, даже если в игре ничего не произошло; всё, что запомнено «по части» (морские пути, сцена карты,
 * списки дел), от этого считалось заново — раз в минуту и после каждого события. Сравнение идёт по содержимому частей
 * верхнего уровня; ключи из `ignore` (часы сервера, номер версии) в сравнении не участвуют. Если не изменилось ничего,
 * возвращается прежний объект целиком — экран не перерисовывается вовсе.
 */
export function keepSame<T extends object>(prev: T | null | undefined, next: T, ignore: readonly string[] = []): T {
  if (!prev) return next;
  const a = prev as Record<string, unknown>, b = next as Record<string, unknown>;
  const out: Record<string, unknown> = { ...b };
  let same = true;
  for (const k of Object.keys(b)) {
    if (ignore.includes(k)) continue;
    if (a[k] === b[k]) continue;
    if (k in a && json(a[k]) === json(b[k])) out[k] = a[k]; else same = false;
  }
  for (const k of Object.keys(a)) if (!(k in b) && !ignore.includes(k)) same = false;
  return same ? prev : (out as T);
}
