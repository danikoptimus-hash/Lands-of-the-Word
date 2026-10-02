import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { requireAdmin } from "./teamMap.js";
import { behaviorReport } from "../services/behavior.js";

/** Раздел «Поведение» у администратора игры: факты о том, как участники решают задания городов (решение владельца 02.10). */
export async function behaviorRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);
  app.get("/api/games/:id/behavior", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireAdmin(request, reply, id))) return;
    const { names } = request.query as { names?: string };
    return behaviorReport(id, names === "1");
  });
}
