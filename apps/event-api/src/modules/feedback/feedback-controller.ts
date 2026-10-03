import { SubmitFeedbackRequestSchema, type SubmitFeedbackResponse } from "@event-desk/contracts";
import express, { type Router } from "express";
import { parseEventId, validateBody } from "../../http/validate.js";
import { AppError } from "../../shared/app-error.js";
import type { FeedbackSubmissionService } from "./feedback-submission-service.js";

/** The test feedback channel (F3 "Adding feedback"): same-origin JSON only, like every mutation. */
export function feedbackRoutes(
  service: Pick<FeedbackSubmissionService, "submit">,
  options: { enabled: boolean },
): Router {
  const router = express.Router();
  router.post("/events/:eventId/feedback", async (req, res) => {
    if (!options.enabled) throw new AppError("NOT_FOUND", "Feedback submission is disabled.");
    const eventId = parseEventId(req.params.eventId);
    const body = validateBody(SubmitFeedbackRequestSchema, req.body);
    const result = await service.submit({
      eventId,
      submissionId: body.submissionId,
      text: body.text,
    });
    const response: SubmitFeedbackResponse = {
      note: result.note,
      automaticBriefing: result.automaticBriefing,
    };
    res.status(result.created ? 201 : 200).json(response);
  });
  return router;
}
