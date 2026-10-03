import type { EventId, EventView, SaveBriefingRequest } from "@event-desk/contracts";
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { saveBriefing } from "../api/event-api";
import { queryKeys } from "../queries/query-keys";
import { applyBriefingSaved } from "./briefing-cache";

const saveBriefingKey = (eventId: EventId) => ["save-briefing", eventId] as const;

/** TX8: wording only (D2). Never retried automatically; a lost response is reconciled by the editor (F5). */
export function useSaveBriefing(eventId: EventId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: saveBriefingKey(eventId),
    mutationFn: (body: SaveBriefingRequest) => saveBriefing(eventId, body),
    meta: {
      successToast: "Briefing saved",
      errorToast: "Briefing was not saved",
      unknownOutcomeToast: "Could not confirm the briefing save. Checking the saved briefing…",
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<EventView>(queryKeys.event(eventId), (view) =>
        view === undefined ? view : applyBriefingSaved(view, saved),
      );
    },
    // As for attendance: after an unknown outcome the editor runs its own single re-read (F5).
    onSettled: (_saved, error) =>
      error?.outcomeUnknown === true
        ? undefined
        : queryClient.invalidateQueries({ queryKey: queryKeys.event(eventId) }),
  });
}

/** True while a briefing save for this event is in flight (from any editor instance). */
export function useIsSavingBriefing(eventId: EventId): boolean {
  return useIsMutating({ mutationKey: saveBriefingKey(eventId) }) > 0;
}
