import { EventIdSchema, type EventView } from "@event-desk/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { FakeEventApi } from "../../testing/fake-event-api";
import { mswServer } from "../../testing/msw-server";
import { createQueryClient, type ToastMessage } from "../query-client";
import { queryKeys } from "../queries/query-keys";
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
});
