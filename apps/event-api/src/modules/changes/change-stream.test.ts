import { EventIdSchema } from "@event-desk/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../../shared/logger.js";
import { ChangeStreamHub, formatChanged } from "./change-stream.js";
import { InProcessChangeNotifier } from "./in-process-change-notifier.js";

const E101 = EventIdSchema.parse("E101");
const E102 = EventIdSchema.parse("E102");
afterEach(() => {
  vi.useRealTimers();
});

function sink() {
  const chunks: string[] = [];
  const close = vi.fn();
  return { chunks, close, value: { send: (chunk: string) => void chunks.push(chunk), close } };
}

describe("ChangeStreamHub (T3 §5, A16)", () => {
  it("formats changed messages with the view version, or null", () => {
    expect(formatChanged(5)).toBe('event: changed\ndata: {"version":5}\n\n');
    expect(formatChanged(null)).toBe('event: changed\ndata: {"version":null}\n\n');
  });

  it("forwards only its event's changes, starting with the retry hint, until detached", () => {
    const notifier = new InProcessChangeNotifier(createLogger("silent"));
    const hub = new ChangeStreamHub(notifier);
    const s = sink();
    const detach = hub.open(E101, s.value);
    notifier.notify(E102, 1);
    notifier.notify(E101, 2);
    detach();
    notifier.notify(E101, 3);
    expect(s.chunks).toEqual(["retry: 3000\n\n", formatChanged(2)]);
    expect(hub.openCount).toBe(0);
  });

  it("sends keep-alive comments and ends every stream on closeAll", () => {
    vi.useFakeTimers();
    const hub = new ChangeStreamHub(new InProcessChangeNotifier(createLogger("silent")), {
      heartbeatMs: 1_000,
    });
    const s = sink();
    hub.open(E101, s.value);
    vi.advanceTimersByTime(2_000);
    expect(s.chunks.filter((chunk) => chunk === ": keep-alive\n\n")).toHaveLength(2);
    hub.closeAll();
    expect(s.close).toHaveBeenCalledTimes(1);
    expect(hub.openCount).toBe(0);
    vi.advanceTimersByTime(5_000);
    expect(s.chunks.filter((chunk) => chunk === ": keep-alive\n\n")).toHaveLength(2);
  });
});
