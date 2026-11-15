import fs from "node:fs";
const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, ""); const API = `${ROOT}/apps/api`;
const env = process.env; // DATABASE_URL и SESSION_SECRET — из окружения, как у локального сервера (apps/api/.env)
process.env.DATABASE_URL = env.DATABASE_URL; process.env.SESSION_SECRET = env.SESSION_SECRET; process.env.NODE_ENV = "test"; process.env.WEB_DIST = "../web/dist"; process.chdir(API);
const { prisma } = await import(`${API}/dist/db.js`);
let ops = 0; const orig = prisma._request.bind(prisma); prisma._request = (p) => { ops++; return orig(p); };
const { buildApp } = await import(`${API}/dist/app.js`); const app = await buildApp(); await app.ready();
const line = fs.readFileSync(new URL("./p4.jar", import.meta.url), "utf8").split("\n").find((l) => l.includes("lotw_session\t")); const cookie = "lotw_session=" + line.split("\t").pop();
const asset = fs.readdirSync(`${API}/../web/dist/assets`).find((f) => f.endsWith(".js"));
for (const url of ["/", `/assets/${asset}`, "/manifest.webmanifest", "/sw.js", "/games/abc/team"]) {
  ops = 0; const r = await app.inject({ method: "GET", url, headers: { cookie } }); await new Promise((x) => setTimeout(x, 50));
  console.log(`${String(r.statusCode)} ${url.slice(0, 40).padEnd(40)} обращений к базе: ${ops}  cache-control: ${r.headers["cache-control"] ?? "-"}  etag: ${r.headers.etag ? "есть" : "нет"}  размер ${r.rawPayload.length}`);
}
await app.close(); await prisma.$disconnect();
