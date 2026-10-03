import { EventIdSchema, type EventView } from "@event-desk/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { FakeEventApi } from "../../testing/fake-event-api";
import { mswServer } from "../../testing/msw-server";
import { createQueryClient, type ToastMessage } from "../query-client";
import { queryKeys } from "../queries/query-keys";
import { useSaveAttendance } from "./use-save-attendance";

const E101 = EventIdSchema.parse("E101");

describe("useSaveAttendance", () => {
  it("writes the saved records into the event cache and toasts once", async () => {
    const api = new FakeEventApi();
    mswServer.use(...api.handlers());
    const toasts: ToastMessage[] = [];
    const client = createQueryClient((toast) => toasts.push(toast));
    client.setQueryData<EventView>(queryKeys.event(E101), api.view);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useSaveAttendance(E101), { wrapper });
    await act(() =>
      result.current.mutateAsync({
        baseAttendanceRevision: 0,
        members: api.view.members.map((m) => ({
          id: m.id,
          attendance: m.id === "M03" ? "attended" : m.attendance,
        })),
      }),
    );
    await waitFor(() => {
      expect(client.getQueryData<EventView>(queryKeys.event(E101))?.attendanceRevision).toBe(1);
    });
    expect(toasts).toEqual([{ type: "info", body: "Attendance saved" }]);
  });
});
