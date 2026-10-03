import { SaveAttendanceRequestSchema } from "@event-desk/contracts";
import express, { type Router } from "express";
import { parseEventId, validateBody } from "../../http/validate.js";
import type { AttendanceService } from "./attendance-service.js";

export function attendanceRoutes(service: AttendanceService): Router {
  const router = express.Router();
  router.put("/events/:eventId/attendance", async (req, res) => {
    const eventId = parseEventId(req.params.eventId);
    const body = validateBody(SaveAttendanceRequestSchema, req.body);
    res.json(
      await service.save({
        eventId,
        baseAttendanceRevision: body.baseAttendanceRevision,
        members: body.members,
      }),
    );
  });
  return router;
}
