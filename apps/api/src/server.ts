import { buildApp } from "./app.js";
import { syncAllGames } from "./services/defaultDeeds.js";

const app = await buildApp();
// Новая версия стандартного набора дел попадает в идущие игры при каждом запуске (деплое).
await syncAllGames(app.log);
try {
  await app.listen({ port: app.config.PORT, host: app.config.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
