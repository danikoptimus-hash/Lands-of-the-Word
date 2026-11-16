import { describe, expect, it } from "vitest";
import { withLock } from "./services/lock.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("очередь на действие", () => {
  it("действия над одним и тем же идут по одному и в порядке прихода", async () => {
    const log: string[] = [];
    const act = (name: string, ms: number) => withLock("task:1", async () => { log.push(name + ":начал"); await sleep(ms); log.push(name + ":кончил"); return name; });
    const out = await Promise.all([act("а", 30), act("б", 5), act("в", 1)]);
    expect(out).toEqual(["а", "б", "в"]);
    expect(log).toEqual(["а:начал", "а:кончил", "б:начал", "б:кончил", "в:начал", "в:кончил"]);
  });

  it("разные дела друг друга не ждут; сбой одного действия очередь не ломает", async () => {
    const log: string[] = [];
    await Promise.all([
      withLock("task:1", async () => { await sleep(30); log.push("первое"); }),
      withLock("task:2", async () => { log.push("второе"); }),
    ]);
    expect(log).toEqual(["второе", "первое"]);
    await expect(withLock("task:1", async () => { throw new Error("сбой"); })).rejects.toThrow("сбой");
    expect(await withLock("task:1", async () => "дальше")).toBe("дальше");
  });

  it("несколько ключей берутся в одном порядке — взаимной блокировки нет", async () => {
    const out = await Promise.all([
      withLock(["b", "a"], async () => { await sleep(10); return 1; }),
      withLock(["a", "b"], async () => { await sleep(10); return 2; }),
      withLock(["b"], async () => 3),
    ]);
    expect(out).toEqual([1, 2, 3]);
  });
});
