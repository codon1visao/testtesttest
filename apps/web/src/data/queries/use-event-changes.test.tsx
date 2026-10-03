import type { EventId } from "@event-desk/contracts";
import { EventIdSchema } from "@event-desk/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { FakeEventSource } from "../../testing/fake-event-source";
import { useEventChanges } from "./use-event-changes";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe("useEventChanges", () => {
  it("is live only while the stream is open, and not live for another event after a switch", () => {
    const first: EventId = EventIdSchema.parse("E101");
    const second: EventId = EventIdSchema.parse("E102");
    const { result, rerender } = renderHook(({ id }) => useEventChanges(id), {
      wrapper,
      initialProps: { id: first },
    });
    const source = FakeEventSource.instances[0];
    if (source === undefined) throw new Error("no stream");
    expect(result.current.live).toBe(false);
    act(() => {
      source.open();
    });
    expect(result.current.live).toBe(true);

    rerender({ id: second });
    expect(source.readyState).toBe(2);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[1]?.url).toBe("/api/events/E102/changes");
    expect(result.current.live).toBe(false);
  });
});
