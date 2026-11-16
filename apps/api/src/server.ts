import { buildApp } from "./app.js";
import { syncAllGames } from "./services/defaultDeeds.js";
import { reshuffleStartedGamesOnce, repairBooklessDeedsAll } from "./services/teamMap.js";
import { closeTrialsForAllPeaces } from "./services/peace.js";
import { backfillUserDays } from "./services/activity.js";
import { closeAllStreams } from "./services/events.js";

const app = await buildApp();
// Сначала открывается порт, служебные задачи идут следом в фоне (ревизия скорости, этап 2). Раньше пять задач по всем играм
// выполнялись до открытия порта, и всё это время после выкладки игроки ждали ответа. Каждая задача — обычные правки базы,
// безопасные при работающей игре; сбой задачи пишется в журнал и не мешает остальным.
try {
  await app.listen({ port: app.config.PORT, host: app.config.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
const startup: Array<[string, (log: typeof app.log) => Promise<unknown>]> = [
  // Новая версия стандартного набора дел попадает в идущие игры при каждом запуске (деплое).
  ["сверка набора дел", syncAllGames],
  // Разово: в идущих играх, начатых до правила «одинаковые дела не рядом», свободные дела перекомпоновываются (решение владельца 01.10).
  ["перекомпоновка дел", reshuffleStartedGamesOnce],
  // Дела с [Книга] на сторонах не из города заменяются (решение владельца 08.10).
  ["дела без книги", repairBooklessDeedsAll],
  // Мир закрывает испытания (решение владельца 04.10): при каждом запуске закрываются идущие испытания между командами, у которых мир.
  ["испытания при мире", closeTrialsForAllPeaces],
  // Разово: дни активности для аналитики восстанавливаются из действий (решение владельца 23.10).
  ["дни активности", backfillUserDays],
];
void (async () => {
  for (const [name, run] of startup) {
    const at = Date.now();
    try { await run(app.log); app.log.info({ task: name, ms: Date.now() - at }, "startup task done"); }
    catch (err) { app.log.error({ err, task: name }, "startup task failed"); }
  }
})();

// Мягкая остановка (ревизия скорости, этап 2). При выкладке Docker просит процесс завершиться и через 10 секунд убивает
// его. Раньше просьбу никто не слушал: все 10 секунд сервер продолжал принимать запросы, а потом они обрывались на
// полуслове. Теперь сервер перестаёт принимать новые запросы, закрывает потоки событий (приложения переподключатся
// к новому серверу), дожидается идущих запросов и выходит — обычно за доли секунды; через 8 секунд — в любом случае.
let stopping = false;
function stop(signal: string): void {
  if (stopping) return;
  stopping = true;
  app.log.info({ signal }, "stopping: no new requests, waiting for requests in flight");
  setTimeout(() => process.exit(0), 8000).unref();
  closeAllStreams();
  app.close().then(() => process.exit(0), (err) => { app.log.error(err); process.exit(1); });
}
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));
