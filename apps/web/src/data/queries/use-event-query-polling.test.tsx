import { EventIdSchema } from "@event-desk/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeEventApi } from "../../testing/fake-event-api";
import { mswServer } from "../../testing/msw-server";
import { queryKeys } from "./query-keys";
import { useEventQuery } from "./use-event-query";

const eventId = EventIdSchema.parse("E101");

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  client = new QueryClient();
  mswServer.use(...new FakeEventApi().handlers());
});

/** The interval the mounted query observer is configured with right now. */
function configuredInterval(): unknown {
  const query = client.getQueryCache().find({ queryKey: queryKeys.event(eventId) });
  const interval = query?.observers[0]?.options.refetchInterval;
  if (query === undefined || typeof interval !== "function") return interval;
  return interval(query);
}

describe("useEventQuery wiring (F7 fallback)", () => {
  it("polls every five seconds while the stream is not open", async () => {
    const { result } = renderHook(() => useEventQuery(eventId, { live: false }), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(configuredInterval()).toBe(5_000);
  });

  it("does not poll while the stream is open", async () => {
    const { result } = renderHook(() => useEventQuery(eventId, { live: true }), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(configuredInterval()).toBe(false);
  });
});
