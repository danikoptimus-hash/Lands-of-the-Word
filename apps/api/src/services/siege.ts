import { prisma } from "../db.js";
import { publish } from "./events.js";
import { notifyTeam } from "./notify.js";
import { fmtDate, msg } from "./i18n.js";
import { onCityOwned } from "./teamMap.js";
import { days, rulesOf, type Rules } from "./rules.js";
import { isLocked } from "./battles.js";
import type { Prisma } from "@prisma/client";

/**
 * Осада делами (решение владельца 18.09). Город, где хранители отбились с максимумом (каждый участник выучил
 * всю книгу), после срока закрепления стихами больше не берётся: претенденты объявляют осаду на 14 дней
 * (настройка), и обе команды делают любые дела из списка игры. Каждое одобренное за это время дело даёт баллы
 * (цена дела — у дела, иначе по умолчанию из правил). У кого больше к концу срока — тот владеет; при равенстве
 * город остаётся у хранителей. Стихов в осаде нет.
 */

/** Баллы команды за дела, одобренные в окне осады. */
async function pointsOf(gameId: string, teamId: string, from: Date, to: Date, rules: Rules): Promise<number> {
  const rows = await prisma.teamEdgeTask.findMany({ where: { gameId, teamId, status: "APPROVED", decidedAt: { gte: from, lte: to } }, select: { deed: { select: { siegePoints: true } } } });
  return rows.reduce((a, r) => a + (r.deed.siegePoints ?? rules.siegeDeedPoints), 0);
}

/** Пересчёт баллов идущих осад (для показа) и разрешение завершившихся. Вызывается из sweep. */
export async function sweepSieges(gameId?: string, now = new Date()): Promise<void> {
  const sieges = await prisma.siege.findMany({ where: { ...(gameId ? { gameId } : {}), status: "ACTIVE" } });
  for (const s of sieges) {
    const rules = rulesOf((await prisma.game.findUnique({ where: { id: s.gameId }, select: { settings: true } }))?.settings);
    const until = s.endsAt.getTime() < now.getTime() ? s.endsAt : now;
    const [a, d] = await Promise.all([pointsOf(s.gameId, s.attackerId, s.startedAt, until, rules), pointsOf(s.gameId, s.defenderId, s.startedAt, until, rules)]);
    if (a !== s.attackerPoints || d !== s.defenderPoints) await prisma.siege.update({ where: { id: s.id }, data: { attackerPoints: a, defenderPoints: d } });
    if (s.endsAt.getTime() > now.getTime()) continue;
    // Срок вышел: больше баллов — город переходит; равенство — остаётся у хранителей.
    const owner = await prisma.teamCityState.findFirst({ where: { gameId: s.gameId, nodeKey: s.nodeKey, capturedAt: { not: null } } });
    const book = (await prisma.mapNode.findUnique({ where: { gameId_key: { gameId: s.gameId, key: s.nodeKey } }, select: { bookCode: true } }))?.bookCode ?? "";
    if (!owner || owner.teamId !== s.defenderId) { await prisma.siege.update({ where: { id: s.id }, data: { status: "CANCELLED", resolvedAt: now } }); continue; }
    if (a > d) {
      await prisma.siege.update({ where: { id: s.id }, data: { status: "WON", resolvedAt: now, attackerPoints: a, defenderPoints: d } });
      await transferCity(s.gameId, s.nodeKey, s.defenderId, s.attackerId, 0);
      notifyTeam(s.gameId, s.attackerId, "осада города {book} удалась", "Дел за время осады: у вас {a}, у хранителей {d}. Город теперь ваш.", { book, a, d });
      notifyTeam(s.gameId, s.defenderId, "город {book} взят осадой", "Дел за время осады: у претендентов {a}, у вас {d}. Город перешёл претендентам; его можно вернуть по тем же правилам.", { book, a, d });
    } else {
      await prisma.siege.update({ where: { id: s.id }, data: { status: "REPELLED", resolvedAt: now, attackerPoints: a, defenderPoints: d } });
      notifyTeam(s.gameId, s.defenderId, "осада города {book} отбита", "Дел за время осады: у вас {d}, у претендентов {a}. Город остаётся вашим.", { book, a, d });
      notifyTeam(s.gameId, s.attackerId, "осада города {book} не удалась", "Дел за время осады: у вас {a}, у хранителей {d}. Город остаётся у хранителей.", { book, a, d });
    }
    publish(s.gameId, { type: "battles" });
    publish(s.gameId, { type: "map" });
    publish(s.gameId, { type: "cities" });
  }
}

/** Смена владельца города без испытания (осада): уровень защиты задаётся явно, максимум и закрепление сбрасываются. */
export async function transferCity(gameId: string, nodeKey: string, fromTeamId: string, toTeamId: string, level: number): Promise<void> {
  const now = new Date();
  const fromState = await prisma.teamCityState.findUnique({ where: { teamId_nodeKey: { teamId: fromTeamId, nodeKey } } });
  const toState = await prisma.teamCityState.findUnique({ where: { teamId_nodeKey: { teamId: toTeamId, nodeKey } } });
  const wasCapital = fromState?.isCapital ?? false;
  const toHasCapital = (await prisma.teamCityState.count({ where: { teamId: toTeamId, isCapital: true } })) > 0;
  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.mapNode.update({ where: { gameId_key: { gameId, key: nodeKey } }, data: { defenseLevel: level, fatigueAt: null, lockedUntil: null, maxReachedAt: null, sumMode: false } }),
    prisma.teamCityState.updateMany({ where: { teamId: fromTeamId, nodeKey }, data: { capturedAt: null, isCapital: false, secondCapital: false } }),
    prisma.teamCityState.upsert({
      where: { teamId_nodeKey: { teamId: toTeamId, nodeKey } },
      create: { gameId, teamId: toTeamId, nodeKey, orderSolved: true, capturedAt: now, firstCapturedAt: now, isCapital: wasCapital || !toHasCapital, secondCapital: wasCapital && toHasCapital },
      update: { capturedAt: now, firstCapturedAt: toState?.firstCapturedAt ?? now, isCapital: wasCapital || !toHasCapital, secondCapital: wasCapital && toHasCapital },
    }),
    prisma.passageRequest.updateMany({ where: { gameId, nodeKey, status: { in: ["APPROVED", "PENDING"] } }, data: { status: "REVOKED", decidedAt: now } }),
    prisma.battle.updateMany({ where: { gameId, nodeKey, status: { in: ["QUEUED", "ATTACK", "DEFENSE"] } }, data: { status: "CANCELLED", resolvedAt: now } }),
  ];
  if (wasCapital) {
    ops.push(prisma.team.update({ where: { id: fromTeamId }, data: { status: "defeated" } }));
    const others = await prisma.teamCityState.findMany({ where: { teamId: fromTeamId, capturedAt: { not: null }, NOT: { nodeKey } }, select: { nodeKey: true } });
    if (others.length) ops.push(prisma.mapNode.updateMany({ where: { gameId, key: { in: others.map((o) => o.nodeKey) } }, data: { ruined: true, defenseLevel: 0, lockedUntil: null, maxReachedAt: null } }));
    ops.push(prisma.teamCityState.updateMany({ where: { teamId: fromTeamId, capturedAt: { not: null } }, data: { capturedAt: null, isCapital: false, secondCapital: false } }));
    ops.push(prisma.teamEdgeTask.updateMany({ where: { teamId: fromTeamId, status: "TAKEN" }, data: { status: "OPEN", takenById: null, takenAt: null } }));
  }
  await prisma.$transaction(ops);
  await onCityOwned(gameId, nodeKey, toTeamId);
  publish(gameId, { type: "teams" });
  if (wasCapital) {
    const { checkLastTeam } = await import("./game.js");
    await checkLastTeam(gameId);
  }
}

/** Можно ли объявить осаду: город с максимумом защиты, закрепление кончилось, команда изучила город, осада не идёт. */
export async function siegeOptions(gameId: string, teamId: string, nodeKey: string) {
  const node = await prisma.mapNode.findUniqueOrThrow({ where: { gameId_key: { gameId, key: nodeKey } } });
  const [owner, state, active, rules] = await Promise.all([
    prisma.teamCityState.findFirst({ where: { gameId, nodeKey, capturedAt: { not: null } } }),
    prisma.teamCityState.findUnique({ where: { teamId_nodeKey: { teamId, nodeKey } } }),
    prisma.siege.findFirst({ where: { gameId, nodeKey, status: "ACTIVE" } }),
    prisma.game.findUnique({ where: { id: gameId }, select: { settings: true } }).then((g) => rulesOf(g?.settings)),
  ]);
  const maxed = node.maxReachedAt !== null;
  let reason: string | null = null;
  if (!maxed) reason = "Осада делами возможна только для города, где хранители выучили всю книгу";
  else if (!owner || owner.teamId === teamId) reason = "Город не принадлежит другой команде";
  else if (isLocked(node)) reason = "Город закреплён: осаду можно объявить после срока закрепления";
  else if (!state?.orderSolved) reason = "Сначала решите задания всех районов";
  else if (active) reason = active.attackerId === teamId ? "Ваша осада уже идёт" : "Город уже осаждает другая команда";
  return { available: maxed, canDeclare: reason === null, reason, days: rules.siegeDays, deedPoints: rules.siegeDeedPoints, active };
}

export async function declareSiege(gameId: string, teamId: string, nodeKey: string): Promise<{ ok: true; id: string; endsAt: Date } | { ok: false; message: string }> {
  const o = await siegeOptions(gameId, teamId, nodeKey);
  if (!o.canDeclare) return { ok: false, message: o.reason ?? "Осаду объявить нельзя" };
  const owner = await prisma.teamCityState.findFirstOrThrow({ where: { gameId, nodeKey, capturedAt: { not: null } } });
  const endsAt = new Date(Date.now() + days(o.days));
  const s = await prisma.siege.create({ data: { gameId, nodeKey, attackerId: teamId, defenderId: owner.teamId, endsAt } });
  const book = (await prisma.mapNode.findUnique({ where: { gameId_key: { gameId, key: nodeKey } }, select: { bookCode: true } }))?.bookCode ?? "";
  const attacker = await prisma.team.findUniqueOrThrow({ where: { id: teamId }, select: { name: true } });
  publish(gameId, { type: "battles" });
  notifyTeam(gameId, owner.teamId, "осада вашего города {book}", (locale) => msg(locale, "Команда «{team}» объявила осаду делами: до {date} считаются одобренные дела обеих команд ({points} балл(ов) за дело, если у дела не задана своя цена). Кто сделает больше — тот владеет городом; при равенстве город остаётся вашим.", { team: attacker.name, date: fmtDate(endsAt, locale), points: o.deedPoints }), { book });
  notifyTeam(gameId, teamId, "осада города {book} объявлена", (locale) => msg(locale, "До {date} считаются одобренные дела обеих команд. Делайте дела: у кого больше баллов к сроку, тот владеет городом; при равенстве город остаётся у хранителей.", { date: fmtDate(endsAt, locale) }), { book });
  return { ok: true, id: s.id, endsAt };
}
