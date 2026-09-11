import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { outbox } from "./services/mail.js";
import { notifyTeam } from "./services/notify.js";
import { msg } from "./services/i18n.js";

const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now();
let adminCookie = "", gameId = "", teamId = "";

async function register(nickname: string, locale: "ru" | "en") {
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nickname, password: "secret123", email: `${nickname}@example.com`, locale } });
  return res.headers["set-cookie"] as string;
}

beforeAll(async () => {
  await app.ready();
  adminCookie = await register(`nadm_${stamp}`, "ru");
  const ru = await register(`nru_${stamp}`, "ru"), en = await register(`nen_${stamp}`, "en");
  const g = await app.inject({ method: "POST", url: "/api/games", headers: { cookie: adminCookie }, payload: { name: "Письма", teamCount: 2 } });
  gameId = g.json().game.id;
  const t = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams`, headers: { cookie: adminCookie }, payload: { name: "Львы" } });
  teamId = t.json().team.id;
  for (const cookie of [ru, en]) {
    const inv = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams/${teamId}/invites`, headers: { cookie: adminCookie }, payload: { role: "MEMBER" } });
    await app.inject({ method: "POST", url: `/api/invites/${inv.json().invite.token}/accept`, headers: { cookie } });
  }
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

describe("письма на языке получателя", () => {
  it("msg подставляет название книги и переводит вложенные слова", () => {
    expect(msg("ru", "город {book} взят", { book: "rut" })).toBe("город Руфь взят");
    expect(msg("en", "город {book} взят", { book: "rut" })).toBe("the city of Ruth is taken");
    expect(msg("en", "{side} отправлен на проверку", { side: "ответ" })).toBe("answer submitted for review");
    expect(msg("en", "нет такого ключа {x}", { x: 1 })).toBe("нет такого ключа 1");
  });

  it("одно событие — русское письмо русскому участнику и английское английскому", async () => {
    outbox.length = 0;
    notifyTeam(gameId, teamId, "город {book} взят", "Город теперь ваш.", { book: "rut" });
    for (let i = 0; i < 50 && outbox.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
    const ru = outbox.find((m) => m.to.startsWith("nru_")), en = outbox.find((m) => m.to.startsWith("nen_"));
    expect(ru?.subject).toBe("Земли Слова: город Руфь взят");
    expect(ru?.text).toContain("Город теперь ваш.");
    expect(ru?.text).toContain("Открыть карту команды: ");
    expect(en?.subject).toBe("Lands of the Word: the city of Ruth is taken");
    expect(en?.text).toContain("The city is now yours.");
    expect(en?.text).toContain("Open the team map: ");
  });

  it("письмо о восстановлении пароля — на языке учётки", async () => {
    outbox.length = 0;
    const r = await app.inject({ method: "POST", url: "/api/auth/forgot", payload: { login: `nen_${stamp}` } });
    expect(r.statusCode).toBe(200);
    expect(outbox[0]?.subject).toBe("Lands of the Word: password reset");
    expect(outbox[0]?.text).toContain("valid for 1 hour");
  });
});
