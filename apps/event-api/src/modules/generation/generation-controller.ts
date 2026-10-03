import {
  GenerateBriefingRequestSchema,
  type GenerateBriefingResponse,
} from "@event-desk/contracts";
import express, { type Router } from "express";
import { parseEventId, validateBody } from "../../http/validate.js";
import type { ManualGenerationCoordinator } from "./manual-generation-coordinator.js";

/** Generate and Retry (A6, D13): synchronous; the body carries only the attendance baseline. */
export function generationRoutes(
  coordinator: Pick<ManualGenerationCoordinator, "generate">,
): Router {
  const router = express.Router();
  router.post("/events/:eventId/briefing-generations", async (req, res) => {
    const eventId = parseEventId(req.params.eventId);
    const body = validateBody(GenerateBriefingRequestSchema, req.body);
    const response: GenerateBriefingResponse = {
      incomingPreview: await coordinator.generate(eventId, body.baseAttendanceRevision),
    };
    res.status(201).json(response);
  });
  return router;
}
