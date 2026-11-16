import type { FastifyReply } from "fastify";

/**
 * Живые события по игре (Server-Sent Events). Один процесс — подписчики в памяти.
 * Любая мутация в игре вызывает publish(gameId, { type }), клиенты перезагружают нужные данные.
 */
export type GameEventType = "game" | "map" | "teams" | "deeds" | "tasks" | "submissions" | "cities" | "battles" | "journal" | "peace" | "quarry" | "trades" | "awards" | "wrecks";
export interface GameEvent { type: GameEventType; teamId?: string; at: number }

/**
 * Кто слушает: команда участника (null — не состоит ни в одной) и признак «нужно всё» — администратор или наблюдатель.
 * Администратор, который сам играет в команде, — и то и другое: раньше он числился только «тем, кому нужно всё», и
 * «разница» карты его команды до него не доходила (выручало скачивание карты раз в минуту, которого больше нет).
 */
interface Subscriber { reply: FastifyReply; teamId: string | null; all: boolean; /** Приложение понимает карту со справочником текстов дел (services/mapWire.ts). */ wire: boolean }
const subscribers = new Map<string, Set<Subscriber>>();
/**
 * Адресная рассылка (ревизия скорости, этап 2). Событие с `teamId` получают только подписчики этой команды и те, кому
 * нужно всё (администраторы и наблюдатели); по нему же сбрасываются готовая карта и готовые ответы только этой команды.
 * Событие без `teamId` — общее: его получают все. Раньше адресными были только три вида (дела, сдачи, летопись — после
 * нагрузочного прогона 23.10: веерная рассылка всем клала сервер), а остальные будили всю партию: ответ на задание города,
 * метка, разведка — у каждой команды пересчитывалась карта, и каждый телефон перечитывал по три-пять ответов.
 * Перемена, которую видят соседи (взятие города, принятое дело на общей стороне, состав команды в положении),
 * публикуется без `teamId` или отдельным событием каждой затронутой команде (services/eventScope.ts).
 *
 * Испытания — особый случай: у них несколько сторон (претенденты, хранители, союзники). Событие `battles` с `teamId`
 * доходит ещё и до команд, у которых с этой командой есть идущее или только что закрытое испытание.
 */
/** Кто ещё участвует в испытаниях команды (ставит services/eventScope.ts: базы здесь нет, чтобы не было круга импортов). */
let battlePartners: ((gameId: string, teamId: string) => Promise<string[]>) | null = null;
export function setBattlePartners(fn: (gameId: string, teamId: string) => Promise<string[]>): void { battlePartners = fn; }
/** Слушатели публикаций внутри процесса (кэш карты команды сбрасывается по тем же событиям, что обновляют экраны). */
type Listener = (gameId: string, event: Omit<GameEvent, "at">) => void;
const listeners: Listener[] = [];
export function onPublish(fn: Listener): void { listeners.push(fn); }

export function subscribe(gameId: string, reply: FastifyReply, teamId: string | null = null, all = teamId === null, wire = false): () => void {
  let set = subscribers.get(gameId);
  if (!set) { set = new Set(); subscribers.set(gameId, set); }
  const sub: Subscriber = { reply, teamId, all, wire };
  set.add(sub);
  return () => { set!.delete(sub); if (set!.size === 0) subscribers.delete(gameId); };
}

function notify(gameId: string, event: Omit<GameEvent, "at">): void {
  for (const fn of listeners) { try { fn(gameId, event); } catch { /* слушатель не должен ломать публикацию */ } }
}
/**
 * Отправка подписчикам: `only` — одной команде (и тем, кому нужно всё, если `watchers`), null — всем. Тот, кому нужно всё,
 * получает адресное событие ровно один раз — первой рассылкой (`watchers`), а досылку сторонам испытания пропускает.
 */
function send(gameId: string, event: Omit<GameEvent, "at">, only: string | null, watchers: boolean): void {
  const set = subscribers.get(gameId);
  if (!set) return;
  const data = `event: change\ndata: ${JSON.stringify({ ...event, at: Date.now() })}\n\n`;
  for (const sub of set) {
    if (only && (sub.all ? !watchers : sub.teamId !== only)) continue;
    try { sub.reply.raw.write(data); } catch { set.delete(sub); }
  }
}

export function publish(gameId: string, event: Omit<GameEvent, "at">): void {
  // Сброс готовых ответов — сразу, до ответа на запрос: тот, кто сделал действие, перечитает уже свежее.
  notify(gameId, event);
  send(gameId, event, event.teamId ?? null, true);
  if (event.teamId && event.type === "battles" && battlePartners) {
    const self = event.teamId;
    void battlePartners(gameId, self).then((ids) => {
      for (const id of ids) {
        if (id === self) continue;
        notify(gameId, { ...event, teamId: id });
        send(gameId, event, id, false);
      }
    }).catch(() => { /* не узнали стороны — их экраны догонят сверкой */ });
  }
}

export function subscriberCount(gameId: string): number { return subscribers.get(gameId)?.size ?? 0; }
/**
 * Закрыть все потоки событий: сервер останавливается (выкладка). Открытые потоки иначе держали бы его до принудительной
 * остановки; приложения переподключатся сами — через случайную паузу, уже к новому серверу.
 */
export function closeAllStreams(): void {
  for (const set of subscribers.values()) for (const sub of set) { try { sub.reply.raw.end(); } catch { /* уже закрыт */ } }
  subscribers.clear();
}
/** Слушает ли карту кто-то из этой команды (наблюдатели без команды не считаются: им карта команды не рассылается). */
export function hasTeamSubscribers(gameId: string, teamId: string): boolean {
  const k = teamFormats(gameId, teamId);
  return k.wire || k.legacy;
}
/** Какие приложения команды слушают карту: нового формата (со справочником текстов дел) и прежнего. */
export function teamFormats(gameId: string, teamId: string): { wire: boolean; legacy: boolean } {
  const out = { wire: false, legacy: false };
  for (const sub of subscribers.get(gameId) ?? []) if (sub.teamId === teamId) { if (sub.wire) out.wire = true; else out.legacy = true; }
  return out;
}
/**
 * Именованное событие только подписчикам команды — так рассылаются изменения карты (решение владельца 24.10:
 * «пункт 2 тоже делай»): клиент правит карту у себя, не перечитывая её.
 */
export function pushToTeam(gameId: string, teamId: string, name: string, payload: unknown, /** только приложениям нового (true) или прежнего (false) формата карты; не задано — всем */ wire?: boolean): void {
  const set = subscribers.get(gameId);
  if (!set) return;
  const data = `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const sub of set) {
    if (sub.teamId !== teamId || (wire !== undefined && sub.wire !== wire)) continue;
    try { sub.reply.raw.write(data); } catch { set.delete(sub); }
  }
}
