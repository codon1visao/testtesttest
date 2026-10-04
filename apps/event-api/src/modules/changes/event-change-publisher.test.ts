import { type EventId, EventIdSchema } from "@event-desk/contracts";
import { describe, expect, it } from "vitest";
import type { ChangeNotifier } from "../../ports/change-notifier.js";
import type { CachedEventView, EventViewCache } from "../../ports/event-view-cache.js";
import { createLogger } from "../../shared/logger.js";
import { CacheBypass } from "./cache-bypass.js";
import { EventChangePublisher } from "./event-change-publisher.js";
import { InProcessChangeNotifier } from "./in-process-change-notifier.js";

const E101 = EventIdSchema.parse("E101");

class FakeCache implements EventViewCache {
  failing = false;
  invalidations = 0;
  lookup(): Promise<CachedEventView> {
    return Promise.resolve({ version: 0, view: null });
  }
  store(): Promise<void> {
    return Promise.resolve();
  }
  invalidate(): Promise<number> {
    this.invalidations += 1;
    return this.failing
      ? Promise.reject(new Error("redis down"))
      : Promise.resolve(this.invalidations);
  }
}

function setup() {
  const lines: string[] = [];
  const logger = createLogger("info", { write: (chunk: string) => void lines.push(chunk) });
  const cache = new FakeCache();
  const bypass = new CacheBypass();
  const notifier = new InProcessChangeNotifier(logger);
  const notified: [EventId, number | null][] = [];
  notifier.subscribe((eventId, version) => notified.push([eventId, version]));
  return {
    cache,
    bypass,
    notified,
    lines,
    publisher: new EventChangePublisher(cache, bypass, notifier, logger),
  };
}

describe("EventChangePublisher", () => {
  it("flushes the cache and notifies with the new view version", async () => {
    const { cache, bypass, notified, publisher } = setup();
    await publisher.publish(E101);
    await publisher.publish(E101);
    expect(cache.invalidations).toBe(2);
    expect(bypass.active).toBe(false);
    expect(notified).toEqual([
      [E101, 1],
      [E101, 2],
    ]);
  });

  it("logs each published change with its event and view version", async () => {
    const { lines, publisher } = setup();
    await publisher.publish(E101);
    const published = lines.filter((line) => line.includes("change published"));
    expect(published.map((line) => JSON.parse(line) as unknown)).toEqual([
      expect.objectContaining({ level: 30, eventId: "E101", version: 1 }),
    ]);
  });

  it("logs a change published without a version when the flush failed", async () => {
    const { cache, lines, publisher } = setup();
    cache.failing = true;
    await publisher.publish(E101);
    const published = lines.find((line) => line.includes("change published")) ?? "{}";
    expect(JSON.parse(published)).toMatchObject({ eventId: "E101", version: null });
  });

  it("switches reads to MySQL when the flush fails, still notifies, never throws", async () => {
    const { cache, bypass, notified, lines, publisher } = setup();
    cache.failing = true;
    await expect(publisher.publish(E101)).resolves.toBeUndefined();
    expect(bypass.active).toBe(true);
    expect(notified).toEqual([[E101, null]]);
    expect(lines.join("")).toContain("cache flush failed");
  });

  it("returns to the cache once a later flush succeeds", async () => {
    const { cache, bypass, publisher } = setup();
    cache.failing = true;
    await publisher.publish(E101);
    cache.failing = false;
    await publisher.publish(E101);
    expect(bypass.active).toBe(false);
  });

  it("never throws when a change listener fails, and logs only the event ID", async () => {
    const { cache, bypass, lines } = setup();
    const logger = createLogger("info", { write: (chunk: string) => void lines.push(chunk) });
    const throwingNotifier: ChangeNotifier = {
      notify: () => {
        throw new Error("listener blew up");
      },
      subscribe: () => () => undefined,
    };
    const publisher = new EventChangePublisher(cache, bypass, throwingNotifier, logger);
    await expect(publisher.publish(E101)).resolves.toBeUndefined();
    const log = lines.join("");
    expect(log).toContain("change notification failed");
    expect(log).toContain('"eventId":"E101"');
  });
});
