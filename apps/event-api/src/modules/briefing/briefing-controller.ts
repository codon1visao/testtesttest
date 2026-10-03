import { SelectPreviewRequestSchema } from "@event-desk/contracts";
import express, { type Router } from "express";
import { parseEventId, validateBody } from "../../http/validate.js";
import type { PreviewSelectionService } from "./preview-selection-service.js";

export interface BriefingRouteServices {
  selection: Pick<PreviewSelectionService, "select">;
}

/** Explicit coordinator actions on the briefing (F5, F7): select a preview; save (Task 4). */
export function briefingRoutes({ selection }: BriefingRouteServices): Router {
  const router = express.Router();
  router.post("/events/:eventId/briefing-preview/select", async (req, res) => {
    const eventId = parseEventId(req.params.eventId);
    const body = validateBody(SelectPreviewRequestSchema, req.body);
    res.json(
      await selection.select({
        eventId,
        generationId: body.generationId,
        expectedSelectedGenerationId: body.expectedSelectedGenerationId,
      }),
    );
  });
  return router;
}
