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
    // Re-read the saved state after every outcome: a lost response may still have been saved (F2).
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.event(eventId) }),
  });
}
