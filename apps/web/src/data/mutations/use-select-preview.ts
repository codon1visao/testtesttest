import type { EventId, EventView, SelectPreviewRequest } from "@event-desk/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { selectPreview } from "../api/event-api";
import { queryKeys } from "../queries/query-keys";
import { applyPreviewSelected } from "./briefing-cache";

/**
 * TX7: open the incoming preview for editing. The caller sends the selection this tab works on
 * (the editor's base when it is the selected preview), never one read from a cache another tab may
 * have refreshed: a selection made elsewhere meanwhile is a conflict, never silently replaced
 * (F6 race 3).
 */
export function useSelectPreview(eventId: EventId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SelectPreviewRequest) => selectPreview(eventId, body),
    meta: {
      errorToast: "The new preview was not opened",
      unknownOutcomeToast: "Could not confirm opening the preview. Checking the briefing…",
    },
    onSuccess: (response) => {
      queryClient.setQueryData<EventView>(queryKeys.event(eventId), (view) =>
        view === undefined ? view : applyPreviewSelected(view, response),
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.event(eventId) }),
  });
}
