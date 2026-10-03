import { EventIdSchema, type EventView } from "@event-desk/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { FakeEventApi } from "../../testing/fake-event-api";
import { mswServer } from "../../testing/msw-server";
import { createQueryClient, type ToastMessage } from "../query-client";
import { queryKeys } from "../queries/query-keys";
import { useEventQuery } from "../queries/use-event-query";
import { useGenerateBriefing } from "./use-generate-briefing";

const E101 = EventIdSchema.parse("E101");

function setup() {
  const api = new FakeEventApi();
  mswServer.use(...api.handlers());
  const toasts: ToastMessage[] = [];
  const client = createQueryClient((toast) => toasts.push(toast));
  client.setQueryData<EventView>(queryKeys.event(E101), api.view);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useGenerateBriefing(E101), { wrapper });
  return { api, toasts, client, result };
}

describe("useGenerateBriefing", () => {
  it("writes the incoming preview into the event cache and toasts once", async () => {
    const { toasts, client, result } = setup();
    await act(() => result.current.mutateAsync({ baseAttendanceRevision: 0 }));
    await waitFor(() => {
      expect(client.getQueryData<EventView>(queryKeys.event(E101))?.incomingPreview?.trigger).toBe(
        "manual",
      );
    });
    expect(toasts).toEqual([{ type: "info", body: "Briefing generated" }]);
  });

  it("toasts the reason once on a known failure", async () => {
    const { api, toasts, result } = setup();
    api.generationReplies.push({
      kind: "error",
      status: 502,
      code: "PROVIDER_REFUSED",
      message: "The AI model declined to write this briefing.",
    });
    await act(async () => {
      await result.current.mutateAsync({ baseAttendanceRevision: 0 }).catch(() => undefined);
    });
    expect(toasts).toEqual([
      {
        type: "error",
        body: "Briefing was not generated: The AI model declined to write this briefing.",
      },
    ]);
  });

  it("F4: after a lost response it toasts the unknown outcome once and re-reads the event", async () => {
    const api = new FakeEventApi();
    let reads = 0;
    mswServer.use(...api.handlers());
    mswServer.use(
      http.get("/api/events/:eventId", () => {
        reads += 1;
        return HttpResponse.json(api.view);
      }),
      http.post("/api/events/:eventId/briefing-generations", () => HttpResponse.error()),
    );
    const toasts: ToastMessage[] = [];
    const client = createQueryClient((toast) => toasts.push(toast));
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    // An active observer, as on the event page, so the invalidation refetches.
    const { result } = renderHook(
      () => ({ event: useEventQuery(E101), generation: useGenerateBriefing(E101) }),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.event.isSuccess && !result.current.event.isFetching).toBe(true);
    });
    const readsBefore = reads;

    await act(async () => {
      await result.current.generation
        .mutateAsync({ baseAttendanceRevision: 0 })
        .catch(() => undefined);
    });
    expect(toasts).toEqual([
      { type: "error", body: "Could not confirm the generation. Checking for a new preview…" },
    ]);
    await waitFor(() => {
      expect(reads).toBe(readsBefore + 1);
    });
  });
});
