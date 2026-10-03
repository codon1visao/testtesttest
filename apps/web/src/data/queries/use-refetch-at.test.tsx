import { EventIdSchema } from "@event-desk/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "./query-keys";
import { useRefetchAt } from "./use-refetch-at";

const eventId = EventIdSchema.parse("E101");
const NOW = Date.parse("2026-10-04T10:00:00.000Z");
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

let client: QueryClient;
let invalidate: ReturnType<typeof vi.spyOn>;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  client = new QueryClient();
  invalidate = vi.spyOn(client, "invalidateQueries");
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useRefetchAt", () => {
  it("invalidates the event read shortly after each future time", () => {
    renderHook(
      () => {
        useRefetchAt(eventId, [at(10_000), null, undefined, at(30_000)]);
      },
      { wrapper },
    );
    vi.advanceTimersByTime(10_000);
    expect(invalidate).not.toHaveBeenCalled(); // the margin has not passed yet
    vi.advanceTimersByTime(250);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.event(eventId) });
    vi.advanceTimersByTime(20_000);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it("ignores past and unparseable times", () => {
    renderHook(
      () => {
        useRefetchAt(eventId, [at(-60_000), "not a date", at(-1_000)]);
      },
      { wrapper },
    );
    vi.advanceTimersByTime(120_000);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("clears its timers on unmount and when the times change", () => {
    const { rerender, unmount } = renderHook(
      ({ times }) => {
        useRefetchAt(eventId, times);
      },
      { wrapper, initialProps: { times: [at(10_000)] } },
    );
    rerender({ times: [at(60_000)] });
    vi.advanceTimersByTime(11_000);
    expect(invalidate).not.toHaveBeenCalled(); // the first time's timer is gone
    unmount();
    vi.advanceTimersByTime(120_000);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
