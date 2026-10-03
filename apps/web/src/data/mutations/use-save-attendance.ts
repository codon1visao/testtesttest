import type { EventId, EventView, SaveAttendanceRequest } from "@event-desk/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { saveAttendance } from "../api/event-api";
import { queryKeys } from "../queries/query-keys";
import { applyAttendanceSaved } from "./attendance-cache";

export function useSaveAttendance(eventId: EventId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveAttendanceRequest) => saveAttendance(eventId, body),
    meta: {
      successToast: "Attendance saved",
      errorToast: "Attendance was not saved",
      unknownOutcomeToast: "Could not confirm the attendance save. Checking the saved records…",
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<EventView>(queryKeys.event(eventId), (view) =>
        view === undefined ? view : applyAttendanceSaved(view, saved),
      );
    },
    // Re-read the saved state after a known outcome. After an unknown outcome (lost response) the
    // caller reconciles with its own single re-read, whose result tells a failed read from a mismatch (F2).
    onSettled: (_saved, error) =>
      error?.outcomeUnknown === true
        ? undefined
        : queryClient.invalidateQueries({ queryKey: queryKeys.event(eventId) }),
  });
}
