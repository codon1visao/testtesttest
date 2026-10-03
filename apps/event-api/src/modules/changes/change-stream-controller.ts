import express, { type Router } from "express";
import { parseEventId } from "../../http/validate.js";
import type { EventViewService } from "../event/event-view-service.js";
import type { ChangeStreamHub } from "./change-stream.js";

/** GET /events/:id/changes: text/event-stream of "changed" messages; the client re-fetches the event read. */
export function changeStreamRoutes(
  hub: ChangeStreamHub,
  events: Pick<EventViewService, "get">,
): Router {
  const router = express.Router();
  router.get("/events/:eventId/changes", async (req, res) => {
    const eventId = parseEventId(req.params.eventId);
    await events.get(eventId); // an unknown event is 404, before any stream opens
    // The client may have gone away during the read: its "close" has already been emitted.
    if (req.socket.destroyed) return;
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    const detach = hub.open(eventId, {
      send: (chunk) => {
        res.write(chunk);
      },
      close: () => {
        res.end();
      },
    });
    // The response's "close" means the connection ended (the request's fires once its body is read).
    res.on("close", detach);
  });
  return router;
}
