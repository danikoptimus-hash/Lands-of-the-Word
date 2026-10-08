import { buildApp } from "./app.js";
import { syncAllGames } from "./services/defaultDeeds.js";
import { reshuffleStartedGamesOnce, repairBooklessDeedsAll } from "./services/teamMap.js";
import { closeTrialsForAllPeaces } from "./services/peace.js";

const app = await buildApp();
// Новая версия стандартного набора дел попадает в идущие игры при каждом запуске (деплое).
await syncAllGames(app.log);
// Разово: в идущих играх, начатых до правила «одинаковые дела не рядом», свободные дела перекомпоновываются (решение владельца 04.10).
await reshuffleStartedGamesOnce(app.log);
// Дела с [Книга] на сторонах не из города заменяются (решение владельца 08.10).
await repairBooklessDeedsAll(app.log);
// Мир закрывает испытания (решение владельца 04.10): при каждом запуске закрываются идущие испытания между командами, у которых действует мир.
await closeTrialsForAllPeaces(app.log);
try {
  await app.listen({ port: app.config.PORT, host: app.config.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
