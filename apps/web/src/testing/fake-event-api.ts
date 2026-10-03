import {
  type AttendanceStatus,
  deriveAttendanceCounts,
  type ErrorCode,
  type EventView,
  type MemberId,
  SaveAttendanceRequestSchema,
  type SaveAttendanceResponse,
} from "@event-desk/contracts";
import { buildSeedEventView } from "@event-desk/contracts/testing";
import { http, HttpResponse } from "msw";

export function apiErrorResponse(status: number, code: ErrorCode, message: string) {
  return HttpResponse.json({ error: { code, message } }, { status });
}

/**
 * An in-memory stand-in for the Plan 2 API with the same contract and rules:
 * revision check (409), full-roster check (400), revision bump only on a real change.
 */
export class FakeEventApi {
  view: EventView = buildSeedEventView();
  readonly attendanceRequests: unknown[] = [];

  /** Simulates another tab saving: changes one member and bumps the revision. */
  saveElsewhere(memberId: MemberId, attendance: AttendanceStatus): void {
    const members = this.view.members.map((m) => (m.id === memberId ? { ...m, attendance } : m));
    this.view = {
      ...this.view,
      members,
      counts: deriveAttendanceCounts(members),
      attendanceRevision: this.view.attendanceRevision + 1,
    };
  }

  handlers() {
    return [
      http.get("/api/events/:eventId", ({ params }) =>
        params.eventId === this.view.event.id
          ? HttpResponse.json(this.view)
          : apiErrorResponse(
              404,
              "EVENT_NOT_FOUND",
              `Event ${String(params.eventId)} was not found.`,
            ),
      ),
      http.put("/api/events/:eventId/attendance", async ({ request }) => {
        const body: unknown = await request.json();
        this.attendanceRequests.push(body);
        const parsed = SaveAttendanceRequestSchema.safeParse(body);
        if (!parsed.success)
          return apiErrorResponse(400, "VALIDATION_FAILED", "Invalid attendance body.");
        if (parsed.data.baseAttendanceRevision !== this.view.attendanceRevision) {
          return apiErrorResponse(
            409,
            "ATTENDANCE_CONFLICT",
            "Attendance was saved elsewhere since you loaded it. Reload to see the latest records.",
          );
        }
        const requested = new Map(parsed.data.members.map((m) => [m.id, m.attendance]));
        if (
          requested.size !== this.view.members.length ||
          this.view.members.some((m) => !requested.has(m.id))
        ) {
          return apiErrorResponse(
            400,
            "VALIDATION_FAILED",
            "members must list each registered member exactly once.",
          );
        }
        const members = this.view.members.map((m) => ({
          ...m,
          attendance: requested.get(m.id) ?? m.attendance,
        }));
        const changed = members.some((m, i) => m.attendance !== this.view.members[i]?.attendance);
        this.view = {
          ...this.view,
          members,
          counts: deriveAttendanceCounts(members),
          attendanceRevision: this.view.attendanceRevision + (changed ? 1 : 0),
        };
        const response: SaveAttendanceResponse = {
          members: this.view.members,
          counts: this.view.counts,
          attendanceRevision: this.view.attendanceRevision,
          freshness: { savedBriefing: null, selectedPreview: null, incomingPreview: null },
        };
        return HttpResponse.json(response);
      }),
    ];
  }
}
