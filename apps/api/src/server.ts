import { buildApp } from "./app.js";
import { syncAllGames } from "./services/defaultDeeds.js";
import { reshuffleStartedGamesOnce } from "./services/teamMap.js";

const app = await buildApp();
// Новая версия стандартного набора дел попадает в идущие игры при каждом запуске (деплое).
await syncAllGames(app.log);
// Разово: в идущих играх, начатых до правила «одинаковые дела не рядом», свободные дела перекомпоновываются (решение владельца 04.10).
await reshuffleStartedGamesOnce(app.log);
try {
  await app.listen({ port: app.config.PORT, host: app.config.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
