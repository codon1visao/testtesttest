import { type EventId, EventIdSchema } from "@event-desk/contracts";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../shared/logger.js";
import { InProcessChangeNotifier } from "./in-process-change-notifier.js";

const E101 = EventIdSchema.parse("E101");

describe("InProcessChangeNotifier", () => {
  it("delivers to subscribers until they unsubscribe", () => {
    const notifier = new InProcessChangeNotifier(createLogger("silent"));
    const seen: [EventId, number | null][] = [];
    const unsubscribe = notifier.subscribe((eventId, version) => seen.push([eventId, version]));
    notifier.notify(E101, 4);
    unsubscribe();
    notifier.notify(E101, 5);
    expect(seen).toEqual([[E101, 4]]);
  });

  it("isolates a failing listener from the others", () => {
    const notifier = new InProcessChangeNotifier(createLogger("silent"));
    const seen: [EventId, number | null][] = [];
    notifier.subscribe(() => {
      throw new Error("listener bug");
    });
    notifier.subscribe((eventId, version) => seen.push([eventId, version]));
    notifier.notify(E101, null);
    expect(seen).toEqual([[E101, null]]);
  });
});
