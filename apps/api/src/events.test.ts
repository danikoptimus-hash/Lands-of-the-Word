import { describe, expect, it } from "vitest";
import type { FastifyReply } from "fastify";
import { onPublish, publish, setBattlePartners, subscribe } from "./services/events.js";

/** Подписчик-заглушка: запоминает, какие события ему записали в поток. */
function listener() {
  const got: Array<{ type: string; teamId?: string }> = [];
  const reply = { raw: { write: (data: string) => { const m = /data: (.*)\n/.exec(data); if (m) got.push(JSON.parse(m[1]!)); return true; } } } as unknown as FastifyReply;
  return { reply, got, types: () => got.map((e) => e.type + (e.teamId ? ":" + e.teamId : "")) };
}
const tick = () => new Promise((r) => setTimeout(r, 10));

describe("адресная рассылка событий", () => {
  it("событие команды получают только она и администратор; общее — все", () => {
    const game = "g-" + Math.random();
    const a = listener(), b = listener(), admin = listener();
    const off = [subscribe(game, a.reply, "A"), subscribe(game, b.reply, "B"), subscribe(game, admin.reply, null)];
    publish(game, { type: "cities", teamId: "A" });
    publish(game, { type: "map", teamId: "B" });
    publish(game, { type: "trades", teamId: "A" });
    publish(game, { type: "cities" });
    expect(a.types()).toEqual(["cities:A", "trades:A", "cities"]);
    expect(b.types()).toEqual(["map:B", "cities"]);
    expect(admin.types()).toEqual(["cities:A", "map:B", "trades:A", "cities"]);
    off.forEach((f) => f());
  });

  it("слушатели внутри сервера узнают, чья команда: по этому сбрасываются карта и готовые ответы только её", () => {
    const game = "g-" + Math.random();
    const seen: Array<string | undefined> = [];
    onPublish((g, ev) => { if (g === game) seen.push(ev.teamId); });
    publish(game, { type: "cities", teamId: "A" });
    publish(game, { type: "cities" });
    expect(seen).toEqual(["A", undefined]);
  });

  it("событие испытания доходит и до других его сторон, администратору — один раз", async () => {
    const game = "g-" + Math.random();
    const a = listener(), b = listener(), c = listener(), admin = listener();
    const off = [subscribe(game, a.reply, "A"), subscribe(game, b.reply, "B"), subscribe(game, c.reply, "C"), subscribe(game, admin.reply, null)];
    const resets: Array<string | undefined> = [];
    onPublish((g, ev) => { if (g === game) resets.push(ev.teamId); });
    // У команды A идёт испытание с командой B; команда C в нём не участвует.
    setBattlePartners(async (_g, teamId) => (teamId === "A" ? ["B"] : teamId === "B" ? ["A"] : []));
    publish(game, { type: "battles", teamId: "A" });
    await tick();
    expect(a.types()).toEqual(["battles:A"]);
    expect(b.types()).toEqual(["battles:A"]);
    expect(c.types()).toEqual([]);
    expect(admin.types()).toEqual(["battles:A"]);
    // готовые ответы сброшены у обеих сторон
    expect(resets).toEqual(["A", "B"]);
    // события других видов сторонам испытания не рассылаются
    publish(game, { type: "cities", teamId: "A" });
    await tick();
    expect(b.types()).toEqual(["battles:A"]);
    off.forEach((f) => f());
    setBattlePartners(async () => []);
  });

  it("если стороны испытания узнать не удалось, своя команда событие всё равно получает", async () => {
    const game = "g-" + Math.random();
    const a = listener();
    const off = subscribe(game, a.reply, "A");
    setBattlePartners(async () => { throw new Error("нет базы"); });
    publish(game, { type: "battles", teamId: "A" });
    await tick();
    expect(a.types()).toEqual(["battles:A"]);
    off();
    setBattlePartners(async () => []);
  });
});
