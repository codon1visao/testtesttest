import type { EventId, SubmitFeedbackRequest } from "@event-desk/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { submitFeedback } from "../api/event-api";
import { queryKeys } from "../queries/query-keys";

/** F3 test channel: idempotent per submissionId, so a resend after a lost response is safe. */
export function useSubmitFeedback(eventId: EventId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SubmitFeedbackRequest) => submitFeedback(eventId, body),
    meta: {
      successToast: "Feedback submitted",
      errorToast: "Feedback was not submitted",
      unknownOutcomeToast:
        "Could not confirm your feedback was received. Submit again to make sure.",
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.event(eventId) }),
  });
}
