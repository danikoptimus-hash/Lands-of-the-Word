import type { FastifyRequest } from "fastify";

/**
 * Наблюдатель (решение владельца 14.10): администратор платформы видит любую игру глазами её администратора,
 * но ничего в ней не меняет. Доступ даётся только запросам чтения (GET); любой запрос на изменение проходит
 * прежнюю проверку — нужно быть администратором именно этой игры. В списках администраторов игры наблюдатель
 * не появляется, членства не создаётся: участники и администраторы его присутствия не видят.
 */
export function isObserver(request: FastifyRequest, admins: ReadonlyArray<{ userId: string }>): boolean {
  const uid = request.user!.id;
  return request.user!.platformRole === "SUPERADMIN" && request.method === "GET" && !admins.some((a) => a.userId === uid);
}

/** Администратор игры — или наблюдатель на запросе чтения. */
export function adminOrObserver(request: FastifyRequest, admins: ReadonlyArray<{ userId: string }>): boolean {
  const uid = request.user!.id;
  return admins.some((a) => a.userId === uid) || isObserver(request, admins);
}
