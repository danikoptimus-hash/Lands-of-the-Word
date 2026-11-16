import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Очередь на действие (ревизия скорости, этап 2). Почти все действия устроены как «прочитать состояние → проверить →
 * записать». Два запроса, пришедшие одновременно, оба видели старое состояние и оба писали: двое получали «дело взято»,
 * двойное нажатие «Принять» давало две записи в летописи, с одним камнем можно было вымостить две дороги, два верных
 * ключа в одну секунду — два владельца города. Следов в базе «Осени» нет: это риск роста числа игроков.
 *
 * Сервер игры — один процесс, поэтому хватает очереди в памяти: действия над одним и тем же (делом, городом, камнями
 * команды) выполняются по одному, второй запрос ждёт первого и проверяет уже новое состояние. Разные дела и города
 * друг друга не ждут. Несколько ключей берутся в алфавитном порядке — взаимной блокировки быть не может.
 * Ожидание ограничено: если предыдущий запрос завис (база не отвечает), следующий через десять секунд идёт без очереди.
 */
const tails = new Map<string, Promise<void>>();
const WAIT_MAX_MS = 10_000;

async function acquire(key: string): Promise<() => void> {
  const prev = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  const tail = prev.then(() => held);
  tails.set(key, tail);
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([prev, new Promise<void>((r) => { timer = setTimeout(r, WAIT_MAX_MS); })]);
  clearTimeout(timer);
  return () => { release(); if (tails.get(key) === tail) tails.delete(key); };
}

export async function withLock<T>(keys: string | string[], fn: () => Promise<T>): Promise<T> {
  const list = [...new Set(typeof keys === "string" ? [keys] : keys)].sort();
  const releases: Array<() => void> = [];
  try {
    for (const k of list) releases.push(await acquire(k));
    return await fn();
  } finally { for (const r of releases.reverse()) r(); }
}

/** Обработчик маршрута в очереди: `keys` — над чем действие (по адресу и вошедшему участнику). */
export function locked(keys: (request: FastifyRequest) => string | string[], handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) {
  return (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => withLock(keys(request), () => handler(request, reply));
}
/** Ключи очереди по параметрам адреса. */
export const byTask = (request: FastifyRequest): string => "task:" + (request.params as { taskId: string }).taskId;
export const byCity = (request: FastifyRequest): string => { const p = request.params as { id: string; nodeKey: string }; return `city:${p.id}:${p.nodeKey}`; };
