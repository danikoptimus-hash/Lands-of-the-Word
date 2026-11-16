import { beforeEach, describe, expect, it, vi } from "vitest";

/** Хранилище телефона для теста: то же поведение, что у localStorage. */
function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return { get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, String(v)); }, removeItem: (k: string) => { m.delete(k); }, clear: () => m.clear() } as Storage;
}
const g = globalThis as unknown as { window?: unknown; document?: unknown };
g.window = { localStorage: fakeStorage(), addEventListener: () => {} };
g.document = { addEventListener: () => {}, visibilityState: "visible" };
const { flushSnaps, loadSnap, persistable, purgeSnaps, saveLastGame, saveSnap, saveUser, savedUser } = await import("./persist");
const ls = () => (g.window as { localStorage: Storage }).localStorage;
const MAP = "/api/games/g1/my-map";

describe("память между запусками", () => {
  beforeEach(() => { purgeSnaps(); ls().clear(); vi.useRealTimers(); });

  it("хранит только ответы, с которых начинается игра", () => {
    expect(persistable("/api/games")).toBe(true);
    expect(persistable("/api/me/teams")).toBe(true);
    expect(persistable("/api/games/g1/teams")).toBe(true);
    expect(persistable(MAP)).toBe(true);
    expect(persistable(MAP + "?have=5")).toBe(false);
    expect(persistable("/api/games/g1/top")).toBe(false);
    expect(persistable("/api/auth/me")).toBe(false);
  });

  it("снимок показывается только своей учётке", () => {
    saveSnap(MAP, "u1", { rev: 7, tasks: [1, 2] }); flushSnaps();
    expect(loadSnap<{ rev: number }>(MAP, "u1")?.rev).toBe(7);
    expect(loadSnap(MAP, "u2")).toBeNull();
    // чужой снимок при попытке показать стирается
    expect(loadSnap(MAP, "u1")).toBeNull();
  });

  it("запись отложена и склеена: в хранилище попадает последнее значение", () => {
    saveSnap(MAP, "u1", { rev: 1 }); saveSnap(MAP, "u1", { rev: 2 }); saveSnap(MAP, "u1", { rev: 3 });
    expect(ls().getItem("lotw.s:" + MAP)).toBeNull();
    flushSnaps();
    expect(loadSnap<{ rev: number }>(MAP, "u1")?.rev).toBe(3);
    // номер версии карты лежит отдельно — его читает index.html до запуска программы
    expect(ls().getItem("lotw.rev:g1")).toBe("u1:3");
  });

  it("у карты «время сервера» переставляется на сейчас, а не остаётся вчерашним", () => {
    const t0 = Date.now();
    saveSnap(MAP, "u1", { rev: 1, now: t0 + 5000, daytime: { now: t0 + 5000 } }); flushSnaps();
    vi.useFakeTimers(); vi.setSystemTime(t0 + 3_600_000);
    const m = loadSnap<{ now: number; daytime: { now: number } }>(MAP, "u1")!;
    // часы сервера спешили на 5 секунд — столько же спешат и через час
    expect(Math.abs(m.daytime.now - (t0 + 3_600_000 + 5000))).toBeLessThan(50);
    expect(Math.abs(m.now - (t0 + 3_600_000 + 5000))).toBeLessThan(50);
  });

  it("снимок старше недели не показывается", () => {
    const t0 = Date.now();
    saveSnap(MAP, "u1", { rev: 1 }); flushSnaps();
    vi.useFakeTimers(); vi.setSystemTime(t0 + 8 * 86_400_000);
    expect(loadSnap(MAP, "u1")).toBeNull();
  });

  it("выход стирает всё запомненное, чужие ключи не трогает", () => {
    ls().setItem("other", "1");
    saveUser({ id: "u1" }); saveLastGame("g1"); saveSnap(MAP, "u1", { rev: 1 }); saveSnap("/api/games", "u1", { games: [] }); flushSnaps();
    expect(savedUser()?.id).toBe("u1");
    purgeSnaps();
    expect(savedUser()).toBeNull();
    expect(loadSnap(MAP, "u1")).toBeNull();
    expect([...Array(ls().length)].map((_, i) => ls().key(i))).toEqual(["other"]);
  });

  it("слишком большой ответ не хранится", () => {
    saveSnap(MAP, "u1", { rev: 1, big: "x".repeat(1_600_000) }); flushSnaps();
    expect(loadSnap(MAP, "u1")).toBeNull();
  });
});
