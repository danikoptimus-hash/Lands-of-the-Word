import { prisma } from "../db.js";

/**
 * Список людей у дела (решение владельца 21.10: «кому звонить» для дела «Позвонить тому, кого давно не было в собрании»).
 * Администратор ведёт у дела список имён; каждая сторона карты с этим делом получает одного человека из списка —
 * равномерно: следующим берётся тот, у кого меньше всего сторон (любого статуса), при равенстве — случайный.
 * Уже назначенные стороны не перераспределяются, поэтому взятое дело не меняет адресата. Имена живут только до конца
 * игры: при завершении список стирается, как и адресаты конвертов.
 */

/** Раздаёт людей сторонам без адресата (свободным и взятым) у всех дел со списком. Возвращает число назначений. */
export async function assignPeople(gameId: string): Promise<number> {
  const people = await prisma.deedPerson.findMany({ where: { gameId }, select: { id: true, deedId: true } });
  if (people.length === 0) return 0;
  const byDeed = new Map<string, string[]>();
  for (const p of people) byDeed.set(p.deedId, [...(byDeed.get(p.deedId) ?? []), p.id]);
  const tasks = await prisma.teamEdgeTask.findMany({ where: { gameId, personId: null, deedId: { in: [...byDeed.keys()] }, status: { in: ["OPEN", "TAKEN"] } }, select: { id: true, deedId: true }, orderBy: { createdAt: "asc" } });
  if (tasks.length === 0) return 0;
  const loads = await prisma.teamEdgeTask.groupBy({ by: ["personId"], where: { gameId, personId: { not: null } }, _count: { _all: true } });
  const load = new Map(people.map((p) => [p.id, 0]));
  for (const l of loads) if (l.personId && load.has(l.personId)) load.set(l.personId, l._count._all);
  const updates = tasks.map((t) => {
    const ids = byDeed.get(t.deedId)!;
    const min = Math.min(...ids.map((id) => load.get(id) ?? 0));
    const pool = ids.filter((id) => (load.get(id) ?? 0) === min);
    const pick = pool[Math.floor(Math.random() * pool.length)]!;
    load.set(pick, (load.get(pick) ?? 0) + 1);
    return prisma.teamEdgeTask.update({ where: { id: t.id }, data: { personId: pick } });
  });
  await prisma.$transaction(updates);
  return updates.length;
}

/** Список людей у дела с цифрами: сколько сторон свободно на карте, в работе (взято, на проверке, возвращено) и сколько принято. */
export async function peopleOf(gameId: string, deedId: string): Promise<Array<{ id: string; name: string; onMap: number; inWork: number; done: number }>> {
  const people = await prisma.deedPerson.findMany({ where: { gameId, deedId }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
  if (people.length === 0) return [];
  const rows = await prisma.teamEdgeTask.groupBy({ by: ["personId", "status"], where: { gameId, personId: { in: people.map((p) => p.id) } }, _count: { _all: true } });
  return people.map((p) => {
    const c = { onMap: 0, inWork: 0, done: 0 };
    for (const r of rows) if (r.personId === p.id) { if (r.status === "OPEN") c.onMap += r._count._all; else if (r.status === "APPROVED") c.done += r._count._all; else c.inWork += r._count._all; }
    return { ...p, ...c };
  });
}

/** Завершение игры: имена стираются (персональные данные не живут дольше игры), у сторон снимается привязка. */
export async function purgePeople(gameId: string): Promise<void> {
  await prisma.deedPerson.deleteMany({ where: { gameId } });
}
