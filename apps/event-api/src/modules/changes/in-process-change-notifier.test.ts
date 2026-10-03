import { type EventId, EventIdSchema } from "@event-desk/contracts";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../shared/logger.js";
import { InProcessChangeNotifier } from "./in-process-change-notifier.js";

const E101 = EventIdSchema.parse("E101");

describe("InProcessChangeNotifier", () => {
  it("delivers to subscribers until they unsubscribe", () => {
    const notifier = new InProcessChangeNotifier(createLogger("silent"));
    const seen: EventId[] = [];
    const unsubscribe = notifier.subscribe((eventId) => seen.push(eventId));
    notifier.notify(E101);
    unsubscribe();
    notifier.notify(E101);
    expect(seen).toEqual([E101]);
  });

  it("isolates a failing listener from the others", () => {
    const notifier = new InProcessChangeNotifier(createLogger("silent"));
    const seen: EventId[] = [];
    notifier.subscribe(() => {
      throw new Error("listener bug");
    });
    notifier.subscribe((eventId) => seen.push(eventId));
    notifier.notify(E101);
    expect(seen).toEqual([E101]);
  });
});
