import express, { type Router } from "express";
import { parseEventId } from "../../http/validate.js";
import type { EventViewService } from "./event-view-service.js";

export function eventRoutes(service: EventViewService): Router {
  const router = express.Router();
  router.get("/events/:eventId", async (req, res) => {
    const view = await service.get(parseEventId(req.params.eventId));
    res.set("Cache-Control", "no-store").json(view);
  });
  return router;
}
