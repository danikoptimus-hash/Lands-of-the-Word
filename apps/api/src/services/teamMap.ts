import { prisma } from "../db.js";
import { bookName, msg } from "./i18n.js";
import { hexCorners, vertexKey, BOOKS } from "@lotw/domain";
import { loadCityContent } from "./cities.js";
import { gameSeas, loadSeaContent } from "./seas.js";
import { notifyTeam, notifyUser } from "./notify.js";
import { publish } from "./events.js";
import { days, type Rules } from "./rules.js";

/**
 * Карта глазами команды.
 * Открытые узлы (TeamNodeState) — команда «стоит» на всех открытых узлах.
 * Фронтир — рёбра из открытых узлов в ещё не открытые; на каждом висит дело (TeamEdgeTask).
 * Одобрение дела открывает узел за ребром.
 */

/** На скольких ближайших векторах хода команды дела не должны повторяться. */

/**
 * Дело для стороны, выходящей из узла fromKey. Если это город, взятый командой, — сначала дела по книге
 * этого города (2.7: «выход из города — дела по книге»), затем общий пул.
 */
/**
 * Вероятность появления дела (решение владельца 04.10): проценты с шагом 20 вместо трёх ступеней. Вес дела при
 * розыгрыше равен его проценту: дело на 100% выпадает в пять раз чаще дела на 20%. Дела до 60% включительно не
 * ставятся рядом с таким же делом; от 80% — могут (это допустимо, а не обязательно).
 */
const NEAR_FREE_CHANCE = 80;
function weightedPick<T extends { chance: number }>(list: T[]): T {
  const total = list.reduce((a, d) => a + (d.chance || 60), 0);
  let r = Math.random() * total;
  for (const d of list) { r -= d.chance || 60; if (r < 0) return d; }
  return list[list.length - 1]!;
}
/**
 * «Рядом» со стороной (решение владельца 03.10: одинаковые дела не должны стоять рядом, даже если дела повторяются —
 * пусть повторяются в разных местах карты): оба её конца и все перекрёстки, соседние с ними, то есть любая сторона
 * в двух шагах. Чистая функция — по рёбрам карты, касающимся концов стороны.
 */
export function nearZone(edges: ReadonlyArray<{ aKey: string; bKey: string }>, fromKey: string, toKey: string): Set<string> {
  const zone = new Set([fromKey, toKey]);
  for (const e of edges) {
    if (e.aKey === fromKey || e.aKey === toKey) zone.add(e.bKey);
    if (e.bKey === fromKey || e.bKey === toKey) zone.add(e.aKey);
  }
  return zone;
}

export async function pickDeed(gameId: string, teamId: string, bookCode: string | null, excludeId?: string, onlyRemote = false, near?: { fromKey: string; toKey: string }): Promise<string | null> {
  // Решение владельца 04.10: дело на новую сторону разыгрывается по вероятностям напрямую — вес дела равен его проценту.
  // Прежние ступени («сначала не встречавшиеся», «не из последних 30», «не те, что уже на свободных сторонах») убраны:
  // они раскладывали дела почти поровну и глушили проценты. Жёсткие правила остались: дело «одно на игру» не берётся,
  // если команда его уже брала или сдавала; дела до 60% не ставятся рядом с таким же (в двух шагах); по книге города — в первую очередь.
  const [deeds, used] = await Promise.all([
    // Выключенные администратором дела на новые дороги не ставятся (решение владельца 06.10).
    prisma.deed.findMany({ where: { gameId, quarry: false, disabled: false, ...(excludeId ? { id: { not: excludeId } } : {}), ...(onlyRemote ? { remote: true } : {}) }, select: { id: true, canRepeat: true, bookCodes: true, chance: true } }),
    prisma.teamEdgeTask.findMany({ where: { teamId, status: { not: "OPEN" } }, select: { deedId: true } }),
  ]);
  if (deeds.length === 0) return null;
  const usedIds = new Set(used.map((u) => u.deedId));
  // Дела на сторонах команды в двух шагах от новой стороны (любой статус: они видны на карте): дело до 60% туда не берётся,
  // пока есть любое другое — хоть из общего пула вместо книжного (замечание владельца 03.10); от 80% — можно (04.10).
  let nearIds = new Set<string>();
  if (near) {
    const keys = [near.fromKey, near.toKey];
    const touching = await prisma.mapEdge.findMany({ where: { gameId, OR: [{ aKey: { in: keys } }, { bKey: { in: keys } }] }, select: { aKey: true, bKey: true } });
    const zone = [...nearZone(touching, near.fromKey, near.toKey)];
    const tasks = await prisma.teamEdgeTask.findMany({ where: { teamId, OR: [{ fromKey: { in: zone } }, { toKey: { in: zone } }] }, select: { deedId: true } });
    nearIds = new Set(tasks.map((t) => t.deedId));
  }
  const eligible = deeds.filter((d) => d.canRepeat || !usedIds.has(d.id));
  const choose = (list: typeof deeds, strict: boolean) => {
    const base = strict ? list.filter((d) => d.chance >= NEAR_FREE_CHANCE || !nearIds.has(d.id)) : list;
    return base.length ? weightedPick(base).id : null;
  };
  // Пустой список книг — дело подходит к любой книге (как в документе; решение владельца 18.09).
  const themed = bookCode ? eligible.filter((d) => d.bookCodes.length === 0 || d.bookCodes.includes(bookCode)) : null;
  // Сначала без дел, стоящих рядом: по книге, потом из общего пула; лишь если иначе никак — рядом тоже можно.
  const tries: Array<[typeof deeds, boolean]> = themed ? [[themed, true], [eligible, true], [themed, false], [eligible, false]] : [[eligible, true], [eligible, false]];
  for (const [list, strict] of tries) { const id = choose(list, strict); if (id) return id; }
  return weightedPick(deeds).id;
}

/**
 * Подстановка книги в текст дела: [Книга] (в любом регистре) → название книги города, из которого выходит сторона;
 * если стороны из города нет — «на выбор» («проповедь по книге на выбор»).
 */
export function withDeedBook<T extends { title: string; description: string }>(deed: T, bookCode: string | null, seed = ""): T {
  const name = bookCode ? bookName(bookCode, "ru") : "на выбор";
  const needsPlan = /\[главы\]/i.test(deed.title) || /\[главы\]/i.test(deed.description);
  const plan = needsPlan ? readingPlan(bookCode, seed) : "";
  const sub = (text: string) => text.replace(/\[книга\]/gi, name).replace(/\[главы\]/gi, plan);
  return { ...deed, title: sub(deed.title), description: sub(deed.description) };
}

/** Детерминированный хеш строки (FNV-1a), чтобы книга и главы у дела не менялись от запроса к запросу. */
function fnv(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

export const READING_CHAPTERS = 5;

/**
 * Подстановка [Главы] (решение владельца 04.10): игра сама выдаёт книгу и пять глав подряд. Книга — города, из которого
 * выходит сторона; если стороны из города нет — любая книга по хешу. Если в книге меньше пяти глав, главы идут дальше
 * по порядку книг Библии («Авдий, глава 1; Иона, главы 1–4»). Хеш — от id задачи, поэтому у одной стороны главы постоянны.
 */
export function readingPlan(bookCode: string | null, seed: string): string {
  const h = fnv(seed || "x");
  let idx = bookCode ? BOOKS.findIndex((b) => b.code === bookCode) : h % BOOKS.length;
  if (idx < 0) idx = h % BOOKS.length;
  const parts: string[] = [];
  let left = READING_CHAPTERS;
  let first = true;
  while (left > 0) {
    const b = BOOKS[idx % BOOKS.length]!;
    const total = b.chapters;
    const from = first && total >= READING_CHAPTERS ? 1 + ((h >>> 8) % (total - READING_CHAPTERS + 1)) : 1;
    const to = Math.min(total, from + left - 1);
    parts.push(to === from ? `${b.nameRu}, глава ${from}` : `${b.nameRu}, главы ${from}–${to}`);
    left -= to - from + 1; idx += 1; first = false;
  }
  return parts.join("; ");
}

/** Книга города по ключу узла (для подстановки [Книга] в текст дела). */
export async function bookOfNodeKey(gameId: string, key: string): Promise<string | null> {
  const n = await prisma.mapNode.findUnique({ where: { gameId_key: { gameId, key } }, select: { bookCode: true } });
  return n?.bookCode ?? null;
}

/** Создаёт недостающие задачи на рёбрах фронтира. Идемпотентно. */
export async function ensureFrontier(gameId: string, teamId: string): Promise<void> {
  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } });
  if (!team.startNodeKey) return;
  const revealedCount = await prisma.teamNodeState.count({ where: { teamId } });
  if (revealedCount === 0) await prisma.teamNodeState.create({ data: { teamId, nodeKey: team.startNodeKey } });

  const revealed = new Set((await prisma.teamNodeState.findMany({ where: { teamId }, select: { nodeKey: true } })).map((n) => n.nodeKey));
  const edges = await prisma.mapEdge.findMany({ where: { gameId }, select: { aKey: true, bKey: true } });
  const existingTasks = await prisma.teamEdgeTask.findMany({ where: { teamId }, select: { fromKey: true, toKey: true, sea: true, createdAt: true } });
  const existing = new Set(existingTasks.map((t) => `${t.fromKey}>${t.toKey}`));
  const blocked = await blockedCities(gameId, teamId);
  const owned = await ownedCities(gameId, teamId);
  const ownedBooks = new Map([...owned].map(([k, v]) => [k, v.bookCode]));
  // Тематика по книге города задаётся в момент появления стороны — из любого города, не только взятого (решение владельца 29.09:
  // дело, которое уже видно на карте, не подменяется; раньше стороны из взятого города пересчитывались при взятии).
  const cityBooks = new Map((await prisma.mapNode.findMany({ where: { gameId, kind: "CITY", bookCode: { not: null } }, select: { key: true, bookCode: true } })).map((n) => [n.key, n.bookCode!]));
  // Из одного порта — один рейс за взятие: после высадки toKey становится узлом высадки, но дело остаётся.
  // Рейс, начатый до нынешнего взятия порта (порт теряли и вернули), не мешает новому (решение владельца 18.09).
  const sailed = new Set(existingTasks.filter((t) => t.sea && (owned.get(t.fromKey)?.capturedAt.getTime() ?? 0) - 5_000 <= t.createdAt.getTime()).map((t) => t.fromKey));

  const wanted: Array<{ fromKey: string; toKey: string }> = [];
  for (const e of edges) {
    for (const [from, to] of [[e.aKey, e.bKey], [e.bKey, e.aKey]] as const) {
      // Через чужой город без разрешения на проход дальше не идём (2.14 А).
      if (revealed.has(from) && !revealed.has(to) && !existing.has(`${from}>${to}`) && !blocked.has(from)) wanted.push({ fromKey: from, toKey: to });
    }
    // Сторона между двумя уже открытыми узлами тоже получает дело (решение владельца 01.10: пустых сторон между
    // открытыми перекрёстками быть не должно). Одно дело на сторону, в любую сторону; через закрытый город — нет.
    if (revealed.has(e.aKey) && revealed.has(e.bKey) && !existing.has(`${e.aKey}>${e.bKey}`) && !existing.has(`${e.bKey}>${e.aKey}`)) {
      const from = !blocked.has(e.aKey) ? e.aKey : !blocked.has(e.bKey) ? e.bKey : null;
      if (from) wanted.push({ fromKey: from, toKey: from === e.aKey ? e.bKey : e.aKey });
    }
  }
  const created: string[] = [];
  for (const w of wanted) {
    const deedId = await pickDeed(gameId, teamId, cityBooks.get(w.fromKey) ?? null, undefined, false, w);
    if (!deedId) return;
    created.push((await prisma.teamEdgeTask.create({ data: { teamId, gameId, fromKey: w.fromKey, toKey: w.toKey, deedId }, select: { id: true } })).id);
  }
  await ensureRemoteDeed(gameId, teamId, created);
  // Морская сторона: из каждого взятого командой порта (береговой город) — одно дело; после его одобрения
  // капитан выбирает пустой береговой узел другого острова и высаживается там (2.3a).
  const ports = await prisma.mapNode.findMany({ where: { gameId, kind: "CITY", coastal: true, key: { in: [...ownedBooks.keys()] } }, select: { key: true, island: true, bookCode: true } });
  for (const port of ports) {
    if (sailed.has(port.key)) continue;
    // Плыть есть куда, только если на другом острове ещё остались свободные береговые развилки.
    const free = await prisma.mapNode.count({ where: { gameId, kind: "EMPTY", coastal: true, island: { not: port.island } } });
    if (free === 0) continue;
    const deedId = await pickDeed(gameId, teamId, port.bookCode, undefined, false, { fromKey: port.key, toKey: port.key });
    if (!deedId) return;
    await prisma.teamEdgeTask.create({ data: { teamId, gameId, fromKey: port.key, toKey: seaKey(port.key), deedId, sea: true } });
  }
}

/** mulberry32 и FNV-1a — те же, что в клиенте (pages/Fauna.tsx): воспроизводимая случайность по семени. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hashSeed(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/** Эпоха мира живности на клиенте (секунды) и запас до её конца, чтобы полёт с кружением уместился в эпоху. */
/** Хвост эпохи мира: момент полёта сдвигается так, чтобы перелёт (до ~2 мин) и полторы минуты кружения уместились до конца 15-минутной эпохи. */
const FAUNA_EPOCH = 900, FAUNA_TAIL = 240;
/**
 * Часовой полёт клина птиц (решение владельца 29.09, с 02.10 раз в час): раз в реальный час (по UTC), в случайное время, клин команды летит
 * к ближайшему не открытому ею городу (поиск в ширину от старта команды) и кружит над ним. Время считается от семени
 * «игра + команда + номер суток», поэтому одинаково у всех участников команды и у администратора «глазами команды», а у
 * разных команд — своё; сервер ничего не хранит. Возвращает узел города и момент (мс сервера).
 */
export function dailyBird(
  gameId: string, teamId: string, start: string | null | undefined, revealed: Set<string>,
  nodes: Array<{ key: string; kind: string }>, edges: Array<{ aKey: string; bKey: string }>, now = Date.now(),
): { key: string; at: number } | null {
  if (!start) return null;
  // Решение владельца 04.10: раз в два часа клин летит к случайному не открытому командой городу (раньше — к ближайшему
  // раз в час). Кандидаты — не открытые города, достижимые по дорогам от старта (тот же остров); если таких нет —
  // любые не открытые. Семя — «id игры + id команды + номер двухчасового периода»: у всей команды один и тот же город
  // и момент, у разных команд — свои.
  const adj = new Map<string, string[]>();
  for (const e of edges) { adj.set(e.aKey, [...(adj.get(e.aKey) ?? []), e.bKey]); adj.set(e.bKey, [...(adj.get(e.bKey) ?? []), e.aKey]); }
  const hidden = nodes.filter((n) => n.kind === "CITY" && !revealed.has(n.key)).map((n) => n.key).sort();
  if (hidden.length === 0) return null;
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) { const k = queue.shift()!; for (const nb of adj.get(k) ?? []) if (!seen.has(nb)) { seen.add(nb); queue.push(nb); } }
  const reachable = hidden.filter((k) => seen.has(k));
  const pool = reachable.length ? reachable : hidden;
  const period = Math.floor(now / BIRD_PERIOD_MS);
  const rng = mulberry32(hashSeed(`${gameId}:${teamId}:bird:${period}`));
  const key = pool[Math.floor(rng() * pool.length)]!;
  let at = period * BIRD_PERIOD_MS + Math.floor(rng() * BIRD_PERIOD_MS);
  const phase = (at / 1000) % FAUNA_EPOCH;
  if (phase > FAUNA_EPOCH - FAUNA_TAIL) at -= Math.round((phase - (FAUNA_EPOCH - FAUNA_TAIL)) * 1000);
  return { key, at };
}
/** Период полёта клина к городу: два часа реального времени (решение владельца 04.10). */
export const BIRD_PERIOD_MS = 2 * 3_600_000;
/** Окно, в котором клиенту отдаётся цель полёта: минута до старта и пять минут после (перелёт до ~2 мин и полторы минуты кружения). */
export const BIRD_WINDOW_BEFORE_MS = 60_000, BIRD_WINDOW_AFTER_MS = 300_000;
/**
 * Что уходит клиенту о полёте (решение владельца 05.10, после расследования меток в «Осени»): момент — всегда, а узел города —
 * только в окне самого полёта. Раньше ключ узла (а это его координаты) лежал в ответе карты все два часа, и любой участник,
 * открыв адрес /api/games/:id/my-map в браузере, узнавал город в тумане, не дожидаясь птиц и не глядя на карту.
 */
export function birdView(bird: { key: string; at: number } | null, now = Date.now()): { at: number; key?: string } | null {
  if (!bird) return null;
  const inWindow = now >= bird.at - BIRD_WINDOW_BEFORE_MS && now <= bird.at + BIRD_WINDOW_AFTER_MS;
  return inWindow ? { at: bird.at, key: bird.key } : { at: bird.at };
}
/** Полёт клина для команды по текущим данным карты: для отдельного запроса клиента в момент полёта. */
export async function birdFor(gameId: string, teamId: string): Promise<{ at: number; key?: string } | null> {
  const [teamRow, revealedRows, nodes, edges] = await Promise.all([
    prisma.team.findUnique({ where: { id: teamId }, select: { startNodeKey: true } }),
    prisma.teamNodeState.findMany({ where: { teamId }, select: { nodeKey: true } }),
    prisma.mapNode.findMany({ where: { gameId }, select: { key: true, kind: true } }),
    prisma.mapEdge.findMany({ where: { gameId }, select: { aKey: true, bKey: true } }),
  ]);
  return birdView(dailyBird(gameId, teamId, teamRow?.startNodeKey, new Set(revealedRows.map((r) => r.nodeKey)), nodes, edges));
}

/** Заглушка toKey морского дела до высадки. */
export const seaKey = (portKey: string) => `sea:${portKey}`;
export const isSeaKey = (key: string) => key.startsWith("sea:");

/** Сколько пристаней предлагается кормчему на один рейс (решение владельца 05.10). */
/**
 * Куда команда может высадиться с этого порта (решение владельца 06.10): все береговые узлы другого острова, ещё не
 * открытые ей, — и пустые, и с городами. Какой из них город, команда не знает: якоря одинаковые, узел раскрывается
 * только после высадки. Попали на город — хорошо, не попали — сами выбирали. До 06.10 города исключались (и береговые
 * углы без якоря выдавали их), потом было десять случайных пристаней; теперь якоря стоят на всех береговых узлах.
 * Параметр voyageId оставлен для совместимости вызовов.
 */
export async function landingCandidates(gameId: string, teamId: string, portKey: string, _voyageId?: string): Promise<string[]> {
  const port = await prisma.mapNode.findUnique({ where: { gameId_key: { gameId, key: portKey } }, select: { island: true } });
  if (!port) return [];
  const [nodes, revealed] = await Promise.all([
    prisma.mapNode.findMany({ where: { gameId, kind: { in: ["EMPTY", "CITY"] }, coastal: true, island: { not: port.island } }, select: { key: true }, orderBy: { key: "asc" } }),
    prisma.teamNodeState.findMany({ where: { teamId }, select: { nodeKey: true } }),
  ]);
  const seen = new Set(revealed.map((r) => r.nodeKey));
  return nodes.map((n) => n.key).filter((k) => !seen.has(k));
}

/** Чужие города, через которые команде нельзя идти дальше: заняты другой командой и нет разрешения на проход. */
export async function blockedCities(gameId: string, teamId: string): Promise<Set<string>> {
  const [foreign, grants] = await Promise.all([
    prisma.teamCityState.findMany({ where: { gameId, capturedAt: { not: null }, NOT: { teamId } }, select: { nodeKey: true } }),
    prisma.passageRequest.findMany({ where: { gameId, requesterId: teamId, status: "APPROVED" }, select: { nodeKey: true } }),
  ]);
  const ok = new Set(grants.map((g) => g.nodeKey));
  return new Set(foreign.map((f) => f.nodeKey).filter((k) => !ok.has(k)));
}

/** Города, взятые командой: книга и момент нынешнего взятия (для тематических дел на выходе и морских рейсов). */
async function ownedCities(gameId: string, teamId: string): Promise<Map<string, { bookCode: string; capturedAt: Date }>> {
  const rows = await prisma.teamCityState.findMany({ where: { teamId, capturedAt: { not: null } }, select: { nodeKey: true, capturedAt: true } });
  if (rows.length === 0) return new Map();
  const nodes = await prisma.mapNode.findMany({ where: { gameId, key: { in: rows.map((r) => r.nodeKey) } }, select: { key: true, bookCode: true } });
  const at = new Map(rows.map((r) => [r.nodeKey, r.capturedAt!]));
  return new Map(nodes.filter((n) => n.bookCode).map((n) => [n.key, { bookCode: n.bookCode!, capturedAt: at.get(n.key)! }]));
}

/**
 * Город получил владельца: другим командам без разрешения дальше через него не пройти — их свободные дела из города
 * убираются. Дела владельца на сторонах из этого города не трогаются (решение владельца 29.09: дело, которое уже
 * видно на карте, остаётся; тематика по книге задаётся при появлении стороны — см. ensureFrontier).
 */
export async function onCityOwned(gameId: string, nodeKey: string, ownerTeamId: string): Promise<void> {
  const grants = await prisma.passageRequest.findMany({ where: { gameId, nodeKey, status: "APPROVED" }, select: { requesterId: true } });
  const gone = await prisma.teamEdgeTask.deleteMany({ where: { gameId, fromKey: nodeKey, status: "OPEN", NOT: { teamId: { in: [ownerTeamId, ...grants.map((g) => g.requesterId)] } } } });
  if (gone.count) publish(gameId, { type: "tasks" });
}

/** Взятое и не сданное за N дней дело возвращается в общий список само (решение владельца 18.09). */
export async function returnStaleTasks(gameId: string, rules: Rules, now = new Date()): Promise<void> {
  const stale = await prisma.teamEdgeTask.findMany({ where: { gameId, status: "TAKEN", takenAt: { lt: new Date(now.getTime() - days(rules.deedReturnDays)) } }, include: { deed: { select: { title: true } } } });
  for (const t of stale) {
    await prisma.teamEdgeTask.update({ where: { id: t.id }, data: { status: "OPEN", takenById: null, takenAt: null } });
    publish(gameId, { type: "tasks", teamId: t.teamId });
    if (t.takenById) notifyUser(gameId, t.takenById, "дело вернулось в список", "Дело «{deed}» не было сдано за {days} дней и снова свободно для всей команды.", { deed: t.deed.title, days: rules.deedReturnDays });
  }
}

/**
 * Среди свободных сторон команды должно быть дело «издалека» (решение владельца 18.09). Решение владельца 29.09: дело,
 * которое уже видно на карте, не подменяется, поэтому пометка ставится только на одну из сторон, созданных в этом же
 * вызове (candidates); если новых сторон нет, ничего не меняется. Замена дела по просьбе — нет.
 */
export async function ensureRemoteDeed(gameId: string, teamId: string, candidates: string[]): Promise<void> {
  if (candidates.length === 0) return;
  const open = await prisma.teamEdgeTask.findMany({ where: { teamId, status: "OPEN", sea: false }, select: { id: true, fromKey: true, toKey: true, deed: { select: { remote: true } } } });
  if (open.some((t) => t.deed.remote)) return;
  const target = open.find((t) => t.id === candidates[candidates.length - 1]);
  if (!target) return;
  const remoteId = await pickDeed(gameId, teamId, null, target.id, true, { fromKey: target.fromKey, toKey: target.toKey });
  if (!remoteId) return;
  await prisma.teamEdgeTask.update({ where: { id: target.id }, data: { deedId: remoteId } });
}

const DAY_MS = 86_400_000;
export interface DeedLimit { max: number; taken: number; nextAt: number | null }
/**
 * Лимит дел в сутки для нескольких участников одним запросом: сколько взято за последние 24 часа и когда освободится
 * место (момент выхода самого раннего взятия из окна). Пустая карта — лимита нет. Видят все в составе команды
 * (решение владельца 04.10: таймер до следующего дела у каждого участника).
 */
export async function deedLimitsFor(gameId: string, max: number, userIds: string[]): Promise<Map<string, DeedLimit>> {
  const out = new Map<string, DeedLimit>();
  if (!max || userIds.length === 0) return out;
  const since = new Date(Date.now() - DAY_MS);
  // Возвращённое администратором дело места в лимите не занимает (решение владельца 05.10): таймер у участника сбрасывается,
  // пока он не пересдал это дело (после пересдачи оно снова в окне по времени взятия).
  const rows = await prisma.teamEdgeTask.findMany({ where: { gameId, takenById: { in: userIds }, takenAt: { gte: since }, status: { not: "REJECTED" } }, select: { takenById: true, takenAt: true }, orderBy: { takenAt: "asc" } });
  const byUser = new Map<string, number[]>();
  for (const r of rows) if (r.takenById && r.takenAt) byUser.set(r.takenById, [...(byUser.get(r.takenById) ?? []), r.takenAt.getTime()]);
  for (const id of userIds) { const t = byUser.get(id) ?? []; out.set(id, { max, taken: t.length, nextAt: t.length >= max ? t[t.length - max]! + DAY_MS : null }); }
  return out;
}

/**
 * Перекомпоновка свободных дел (решение владельца 04.10): игра делает это сама, без кнопки. Для каждой свободной
 * стороны (OPEN) команды дело подбирается заново по обычным правилам — по книге города, иначе из общего пула,
 * одинаковые дела не рядом; взятые, сданные и принятые дела не трогаются. Стороны идут по порядку появления,
 * каждый следующий выбор уже видит предыдущие. Дело «издалека» среди свободных сторон сохраняется.
 */
export async function reshuffleOpenDeeds(gameId: string): Promise<{ checked: number; changed: number }> {
  const [teams, cities] = await Promise.all([
    prisma.team.findMany({ where: { gameId }, select: { id: true } }),
    prisma.mapNode.findMany({ where: { gameId, kind: "CITY", bookCode: { not: null } }, select: { key: true, bookCode: true } }),
  ]);
  const cityBooks = new Map(cities.map((n) => [n.key, n.bookCode!]));
  let checked = 0, changed = 0;
  for (const team of teams) {
    const tasks = await prisma.teamEdgeTask.findMany({ where: { teamId: team.id, status: "OPEN" }, orderBy: { createdAt: "asc" }, select: { id: true, fromKey: true, toKey: true, deedId: true, sea: true, deed: { select: { remote: true } } } });
    const touched: string[] = [];
    for (const t of tasks) {
      checked++;
      const next = await pickDeed(gameId, team.id, cityBooks.get(t.fromKey) ?? null, undefined, t.deed.remote, { fromKey: t.fromKey, toKey: t.sea ? t.fromKey : t.toKey });
      if (!next || next === t.deedId) continue;
      await prisma.teamEdgeTask.update({ where: { id: t.id }, data: { deedId: next } });
      if (!t.sea) touched.push(t.id);
      changed++;
    }
    if (touched.length) { await ensureRemoteDeed(gameId, team.id, touched); publish(gameId, { type: "tasks", teamId: team.id }); publish(gameId, { type: "map", teamId: team.id }); }
  }
  return { checked, changed };
}

/**
 * Разово при запуске сервера: в идущих играх, начатых до правила «одинаковые дела не рядом», свободные дела
 * перекомпоновываются один раз; отметка `deedsReshuffledAt` не даёт повторить. Игры, начатые позже, получают
 * отметку при старте и не трогаются.
 */
export async function reshuffleStartedGamesOnce(log: { info: (o: object, msg: string) => void; error: (o: object, msg: string) => void }, onlyGameId?: string): Promise<void> {
  const games = await prisma.game.findMany({ where: { status: "ACTIVE", deedsReshuffledAt: null, ...(onlyGameId ? { id: onlyGameId } : {}) }, select: { id: true } }).catch((e: unknown) => { log.error({ err: e }, "deeds reshuffle skipped: database unavailable"); return [] as Array<{ id: string }>; });
  for (const g of games) {
    try {
      const r = await reshuffleOpenDeeds(g.id);
      await prisma.game.update({ where: { id: g.id }, data: { deedsReshuffledAt: new Date() } });
      log.info({ gameId: g.id, ...r }, "open deeds reshuffled");
    } catch (e) { log.error({ err: e, gameId: g.id }, "open deeds reshuffle failed"); }
  }
}

/**
 * Штраф администратора (телефон на собрании; решение владельца 18.09): аннулируется случайный концевой участок пути —
 * пройденная сторона, за которой у команды нет других пройденных сторон; города команды и старт не трогаются.
 * Перекрёсток за стороной снова закрыт, дело на стороне нужно сделать заново.
 */
export async function penalizeTeam(gameId: string, teamId: string, byId: string): Promise<{ fromKey: string; toKey: string; city: boolean } | null> {
  const [approved, owned, team, battling, cities] = await Promise.all([
    prisma.teamEdgeTask.findMany({ where: { teamId, status: "APPROVED", sea: false }, select: { id: true, fromKey: true, toKey: true } }),
    prisma.teamCityState.findMany({ where: { teamId, capturedAt: { not: null } }, select: { nodeKey: true } }),
    prisma.team.findUniqueOrThrow({ where: { id: teamId }, select: { startNodeKey: true } }),
    prisma.battle.findMany({ where: { gameId, attackerId: teamId, status: { in: ["QUEUED", "ATTACK", "DEFENSE"] } }, select: { nodeKey: true } }),
    prisma.mapNode.findMany({ where: { gameId, kind: "CITY" }, select: { key: true } }),
  ]);
  const ownedKeys = new Set(owned.map((o) => o.nodeKey));
  const battleKeys = new Set(battling.map((b) => b.nodeKey));
  const cityKeys = new Set(cities.map((c) => c.key));
  const outgoing = new Map<string, number>();
  const incoming = new Map<string, number>();
  for (const t of approved) { outgoing.set(t.fromKey, (outgoing.get(t.fromKey) ?? 0) + 1); incoming.set(t.toKey, (incoming.get(t.toKey) ?? 0) + 1); }
  // Концевой участок (решение владельца 19.09): за узлом ничего не пройдено и он открыт только этой стороной. Узел может быть
  // перекрёстком или городом, который команда дошла и изучает; не трогаются взятые города, старт и город, на который брошен вызов.
  const ends = approved.filter((t) => !outgoing.has(t.toKey) && (incoming.get(t.toKey) ?? 0) === 1 && !ownedKeys.has(t.toKey) && !battleKeys.has(t.toKey) && t.toKey !== team.startNodeKey);
  if (ends.length === 0) return null;
  const pick = ends[Math.floor(Math.random() * ends.length)]!;
  const city = cityKeys.has(pick.toKey);
  await prisma.$transaction([
    prisma.teamEdgeTask.deleteMany({ where: { teamId, fromKey: pick.toKey } }),
    prisma.teamEdgeTask.deleteMany({ where: { teamId, toKey: pick.toKey, NOT: { id: pick.id } } }),
    prisma.teamNodeState.deleteMany({ where: { teamId, nodeKey: pick.toKey } }),
    prisma.teamPeek.deleteMany({ where: { teamId, nodeKey: pick.toKey } }),
    // Город, до которого дошли и изучали: задания начинаются заново, ничего не открыто (штраф за сгоревшие вызовы остаётся).
    prisma.teamCityState.updateMany({ where: { teamId, nodeKey: pick.toKey }, data: { orderSolved: false, orderAttempts: 0, doneTasks: [], answerAttempts: 0, lastWrongAt: null, hintTasks: [], keyWrong: 0, keyLockedUntil: null } }),
    prisma.teamTaskLock.deleteMany({ where: { teamId, nodeKey: pick.toKey } }),
    prisma.teamEdgeTask.update({ where: { id: pick.id }, data: { status: "OPEN", takenById: null, takenAt: null, links: [], note: "", submittedAt: null, decidedAt: null, decidedById: null, adminComment: "Сторона аннулирована штрафом администратора" } }),
    prisma.teamPenalty.create({ data: { gameId, teamId, fromKey: pick.fromKey, toKey: pick.toKey, byId } }),
  ]);
  await ensureFrontier(gameId, teamId);
  publish(gameId, { type: "map", teamId });
  publish(gameId, { type: "tasks", teamId });
  publish(gameId, { type: "cities", teamId });
  notifyTeam(gameId, teamId, "штраф: участок пути аннулирован", (locale) => msg(locale, city
    ? "Администратор назначил команде штраф: последняя пройденная сторона аннулирована, город за ней снова закрыт, его задания начинаются заново. Дело на этой стороне нужно сделать заново."
    : "Администратор назначил команде штраф: одна пройденная сторона на конце пути аннулирована, перекрёсток за ней снова закрыт. Дело на этой стороне нужно сделать заново."));
  return { fromKey: pick.fromKey, toKey: pick.toKey, city };
}

export async function revealNode(gameId: string, teamId: string, nodeKey: string): Promise<void> {
  await prisma.teamNodeState.upsert({ where: { teamId_nodeKey: { teamId, nodeKey } }, create: { teamId, nodeKey }, update: {} });
  await ensureFrontier(gameId, teamId);
}

export async function getTeamMap(gameId: string, teamId: string) {
  await ensureFrontier(gameId, teamId);
  const [revealedRows, rawTasks, hexes, nodes, edges, teamRow] = await Promise.all([
    prisma.teamNodeState.findMany({ where: { teamId }, select: { nodeKey: true, revealedAt: true } }),
    prisma.teamEdgeTask.findMany({
      where: { teamId },
      include: { deed: { select: { id: true, title: true, description: true, direction: true, proofType: true, secret: true, remote: true, donationMin: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.mapHex.findMany({ where: { gameId }, select: { q: true, r: true, terrain: true, rotation: true, island: true, sea: true } }),
    prisma.mapNode.findMany({ where: { gameId }, select: { key: true, corner: true, q: true, r: true, kind: true, bookCode: true, cityType: true, teamIndex: true, ruined: true, island: true, coastal: true, sea: true } }),
    prisma.mapEdge.findMany({ where: { gameId }, select: { aKey: true, bKey: true } }),
    prisma.team.findUnique({ where: { id: teamId }, select: { startNodeKey: true } }),
  ]);
  // Чужие проходы там, где у команды открыт туман: пройденные другими командами стороны, касающиеся открытых
  // перекрёстков (решение владельца 18.09: команда должна понимать, где противник).
  const foreignRows = await prisma.teamEdgeTask.findMany({ where: { gameId, status: "APPROVED", sea: false, NOT: { teamId } }, select: { fromKey: true, toKey: true, team: { select: { index: true, color: true } } } });
  // В тексте дела [Книга] — книга города, из которого выходит сторона (или «на выбор», если это не город).
  const bookOfNode = new Map(nodes.filter((n) => n.bookCode).map((n) => [n.key, n.bookCode!]));
  const tasks = rawTasks.map((t) => ({ ...t, deed: withDeedBook(t.deed, bookOfNode.get(t.fromKey) ?? null, t.id) }));
  const revealed = new Set(revealedRows.map((r) => r.nodeKey));
  const revealedAtOf = new Map(revealedRows.map((r) => [r.nodeKey, r.revealedAt.toISOString()] as const));
  // Города, до которых команда дошла: чей город, и мой прогресс в нём.
  const cityNodes = nodes.filter((n) => n.kind === "CITY" && revealed.has(n.key));
  const [blocked, peeks, marks, passages] = await Promise.all([
    blockedCities(gameId, teamId),
    prisma.teamPeek.findMany({ where: { teamId }, select: { nodeKey: true } }),
    prisma.teamMark.findMany({ where: { teamId }, orderBy: { createdAt: "asc" }, select: { id: true, q: true, r: true, qf: true, rf: true, note: true, createdById: true, createdAt: true } }),
    prisma.passageRequest.findMany({ where: { gameId, requesterId: teamId, status: { in: ["PENDING", "APPROVED", "DECLINED", "EXPIRED", "REVOKED"] } }, orderBy: { createdAt: "desc" }, select: { nodeKey: true, status: true } }),
  ]);
  const passageByKey = new Map<string, string>();
  for (const pr of passages) if (!passageByKey.has(pr.nodeKey)) passageByKey.set(pr.nodeKey, pr.status);
  const [cityStates, owners, battles] = await Promise.all([
    prisma.teamCityState.findMany({ where: { teamId, nodeKey: { in: cityNodes.map((n) => n.key) } } }),
    prisma.teamCityState.findMany({ where: { gameId, nodeKey: { in: cityNodes.map((n) => n.key) }, capturedAt: { not: null } }, select: { nodeKey: true, team: { select: { index: true, name: true, color: true } } } }),
    prisma.battle.findMany({ where: { gameId, status: { in: ["QUEUED", "ATTACK", "DEFENSE"] }, OR: [{ attackerId: teamId }, { defenderId: teamId }] }, select: { nodeKey: true, attackerId: true, status: true } }),
  ]);
  const stateByKey = new Map(cityStates.map((s) => [s.nodeKey, s]));
  const ownerByKey = new Map(owners.map((o) => [o.nodeKey, o.team]));
  // Роль команды в активной битве за город: атакует (синие мечи) или защищается (красные).
  const battleByKey = new Map(battles.map((b) => [b.nodeKey, b.attackerId === teamId ? "ATTACK" : "DEFENSE"]));
  const cities = await Promise.all(cityNodes.map(async (n) => {
    const content = await loadCityContent(n.bookCode ?? "");
    const s = stateByKey.get(n.key);
    return {
      nodeKey: n.key,
      hasContent: content !== null,
      total: content?.tasks.length ?? 0,
      owner: ownerByKey.get(n.key) ?? null,
      orderSolved: s?.orderSolved ?? false,
      done: s?.doneTasks.length ?? 0,
      captured: s?.capturedAt != null,
      capturedAt: s?.capturedAt?.toISOString() ?? null,
      isCapital: s?.isCapital ?? false,
      battle: battleByKey.get(n.key) ?? null,
      ruined: n.ruined,
      // Проход дальше через чужой город: закрыт, пока владелец не разрешит.
      blocked: blocked.has(n.key),
      passage: passageByKey.get(n.key) ?? null,
    };
  }));
  // Разведчик заглянул за ребро: известен только вид узла (город или развилка), без названия.
  const peekKeys = new Set(peeks.map((p) => p.nodeKey));
  const peeked = nodes.filter((n) => peekKeys.has(n.key) && !revealed.has(n.key)).map((n) => ({ key: n.key, kind: n.kind }));
  // Гекс освещён, если хотя бы один его угол открыт командой. Остальные видны только силуэтом в тумане.
  const lit = (h: { q: number; r: number }) => hexCorners(h).some((c) => revealed.has(vertexKey(c)));
  // Край тумана (решение владельца 02.10): все ещё не открытые углы освещённых гексов, даже без стороны с делом к ним.
  // Разведчик может разведать любой из них; на карте они показаны точками.
  const nodeKeys = new Set(nodes.map((n) => n.key));
  const frontier = new Set<string>();
  for (const h of hexes) if (lit(h)) for (const c of hexCorners(h)) { const k = vertexKey(c); if (!revealed.has(k) && nodeKeys.has(k)) frontier.add(k); }
  // Все дела команды видны на карте, в том числе свободные между двумя открытыми перекрёстками: пустых сторон между
  // открытыми перекрёстками быть не должно (решение владельца 01.10; до 04.10 такие свободные дела скрывал старый фильтр,
  // и сторона выглядела пустой — замечание владельца 04.10). Взятое или сданное дело видно всегда (18.09).
  const visibleTasks = tasks;
  const foreign = foreignRows.filter((f) => revealed.has(f.fromKey) || revealed.has(f.toKey)).map((f) => ({ aKey: f.fromKey, bKey: f.toKey, teamIndex: f.team.index, color: f.team.color }));
  const authorRows = marks.length ? await prisma.user.findMany({ where: { id: { in: [...new Set(marks.map((mk) => mk.createdById))] } }, select: { id: true, nickname: true, displayName: true } }) : [];
  const authors = new Map(authorRows.map((u) => [u.id, u.displayName || u.nickname] as const));
  const withLanding = await Promise.all(visibleTasks.map(async (t) => {
    if (!t.sea) return t;
    const landing = t.status === "APPROVED" && isSeaKey(t.toKey);
    return { ...t, landing, candidates: landing ? await landingCandidates(gameId, teamId, t.fromKey, t.id) : undefined };
  }));
  // Моря (решение владельца 06.10): внутреннее море видно, когда команда вышла на его берег (его гексы освещены);
  // Великое море (пролив) видно всегда, а его вахты открываются с берегового узла.
  const seaGeo = await gameSeas(gameId);
  const seaStates = await prisma.teamSeaState.findMany({ where: { teamId }, select: { seaCode: true, doneTasks: true, openedAt: true, crossedAt: true } });
  const seas = await Promise.all(seaGeo.map(async (sg) => {
    const reached = sg.shore.some((k) => revealed.has(k));
    const st = seaStates.find((x) => x.seaCode === sg.code);
    const content = await loadSeaContent(sg.code);
    return { code: sg.code, name: content?.name ?? sg.name, nameEn: content?.nameEn ?? sg.nameEn, hexes: sg.hexes, center: sg.center, visible: sg.code === "great" || reached, reached, done: st?.doneTasks.length ?? 0, total: content?.tasks.length ?? 0, opened: Boolean(st?.openedAt), crossed: Boolean(st?.crossedAt) };
  }));
  return {
    seas: seas.filter((s) => s.visible).map(({ visible: _v, ...s }) => s),
    // Остров известен и у гексов в тумане: по нему подписываются острова.
    hexes: hexes.map((h) => (lit(h) ? { ...h, lit: true } : { q: h.q, r: h.r, island: h.island, lit: false })),
    // Когда узел открыт — для ползунка истории на карте команды (решение владельца 05.10).
    revealed: nodes.filter((n) => revealed.has(n.key)).map(({ ruined: _r, ...n }) => ({ ...n, revealedAt: revealedAtOf.get(n.key) ?? null })),
    // Рёбра, касающиеся открытых узлов: пройденные и фронтир (в туман).
    edges: edges.filter((e) => revealed.has(e.aKey) || revealed.has(e.bKey)),
    tasks: withLanding,
    cities,
    peeked,
    frontier: [...frontier],
    // Метки команды (решение владельца 22.09): видны всем участникам команды; с автором (решение владельца 29.09).
    marks: marks.map(({ createdById, ...mk }) => ({ ...mk, by: { id: createdById, name: authors.get(createdById) ?? "" } })),
    // Для живности: у всех игроков одной игры звери одни и те же и идут по часам сервера (решение владельца 29.09).
    gameId,
    now: Date.now(),
    // Часовой полёт клина к ближайшему неоткрытому городу команды (решение владельца 29.09, с 02.10 раз в час): раз в сутки, в своё случайное время.
    dailyBird: birdView(dailyBird(gameId, teamId, teamRow?.startNodeKey, revealed, nodes, edges)),
    foreign,
  };
}
