import { SaveBriefingRequestSchema, SelectPreviewRequestSchema } from "@event-desk/contracts";
import express, { type Router } from "express";
import { parseEventId, validateBody } from "../../http/validate.js";
import type { BriefingSaveService } from "./briefing-save-service.js";
import type { PreviewSelectionService } from "./preview-selection-service.js";

export interface BriefingRouteServices {
  selection: Pick<PreviewSelectionService, "select">;
  save: Pick<BriefingSaveService, "save">;
}

/** Explicit coordinator actions on the briefing (F5, F7): select a preview; save the briefing (F5). */
export function briefingRoutes({ selection, save }: BriefingRouteServices): Router {
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
  router.put("/events/:eventId/briefing", async (req, res) => {
    const eventId = parseEventId(req.params.eventId);
    const body = validateBody(SaveBriefingRequestSchema, req.body);
    res.json(
      await save.save({
        eventId,
        baseBriefingRevision: body.baseBriefingRevision,
        generationId: body.generationId,
        textEdits: body.textEdits,
      }),
    );
  });
  return router;
}
