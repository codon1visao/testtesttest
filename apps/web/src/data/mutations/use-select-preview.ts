import type { EventId, EventView, GenerationId } from "@event-desk/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { selectPreview } from "../api/event-api";
import { queryKeys } from "../queries/query-keys";
import { applyPreviewSelected } from "./briefing-cache";

/**
 * TX7: open the incoming preview for editing. The expected selection is the one this tab shows
 * now, so another tab's selection meanwhile is a conflict, never silently replaced (F6 race 3).
 */
export function useSelectPreview(eventId: EventId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (generationId: GenerationId) => {
      const view = queryClient.getQueryData<EventView>(queryKeys.event(eventId));
      return selectPreview(eventId, {
        generationId,
        expectedSelectedGenerationId: view?.selectedPreview?.provenance.generationId ?? null,
      });
    },
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
