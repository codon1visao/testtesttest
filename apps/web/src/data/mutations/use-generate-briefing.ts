import type { EventId, EventView, GenerateBriefingRequest } from "@event-desk/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { generateBriefing } from "../api/event-api";
import { queryKeys } from "../queries/query-keys";
import { applyGenerated } from "./generation-cache";

/** Generate and Retry (A6): one synchronous call; never retried automatically (F4). */
export function useGenerateBriefing(eventId: EventId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: GenerateBriefingRequest) => generateBriefing(eventId, body),
    meta: {
      successToast: "Briefing generated",
      errorToast: "Briefing was not generated",
      unknownOutcomeToast: "Could not confirm the generation. Checking for a new preview…",
    },
    onSuccess: (response) => {
      queryClient.setQueryData<EventView>(queryKeys.event(eventId), (view) =>
        view === undefined ? view : applyGenerated(view, response),
      );
    },
    // Always re-read: after a lost response the server may still have committed the result (F4).
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.event(eventId) }),
  });
}
